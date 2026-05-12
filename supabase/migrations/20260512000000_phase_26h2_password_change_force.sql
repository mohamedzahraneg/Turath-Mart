-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 26H-2 — Password reset + force-password-change scaffold.
--
-- DEPLOY GATE — DO NOT APPLY WITHOUT EXPLICIT APPROVAL
--
-- What this migration does
-- ------------------------
-- 1) Adds two additive columns to `public.profiles`:
--      • `must_change_password boolean NOT NULL DEFAULT false` —
--        flipped to true by an admin (via `إجبار تغيير كلمة المرور`)
--        or by the new-employee creation flow. Cleared back to false
--        when the staff member completes a password change at the
--        `/change-password` page.
--      • `password_changed_at timestamptz` — stamped to `now()` the
--        moment the staff member successfully calls
--        `supabase.auth.updateUser({ password })` from the
--        `/change-password` page. NULL means "never changed via this
--        app flow" (the legacy Supabase login still works).
--
--    Both default to safe values so the migration is non-disruptive:
--    every existing row gets `must_change_password = false` (no
--    forced rotation), and `password_changed_at` stays NULL until
--    each user organically rotates.
--
-- 2) Adds a SECURITY DEFINER RPC `complete_password_change()` that
--    lets the *caller* — and only the caller — flip their own
--    profile row's `must_change_password` to false and stamp
--    `password_changed_at`. Required because Phase 23M-Fix1
--    (20260511010000_profiles_drop_own_update.sql) intentionally
--    removed the `profiles_own_update` RLS policy, so a staff user
--    can no longer PATCH their own profile row directly from the
--    client. Without this RPC, the `/change-password` page would
--    succeed at `supabase.auth.updateUser({password})` (Supabase
--    Auth, RLS-free) but fail to clear the cached must-change flag
--    (RLS-gated), leaving the user stuck in a redirect loop.
--
--    The RPC's surface area is intentionally narrow:
--      • no parameters — caller can only touch *their own* row
--      • only two columns updated — the flag + the timestamp
--      • runs as the function owner (postgres role) so the
--        admin-only RLS on `profiles` is bypassed safely
--      • EXECUTE granted to `authenticated` only; revoked from
--        PUBLIC (anon).
--
-- 3) (Optional, NOT applied here) — a backfill that sets
--    `must_change_password = true` for all current non-admin
--    profiles would force every staff member to rotate on next
--    login. This is INTENTIONALLY omitted: per Phase 26H-2 spec,
--    forcing the entire org to rotate at once is a separate
--    decision that needs its own explicit approval.
--
-- What this migration does NOT do
-- -------------------------------
--   • No new RLS policies on profiles. The admin-only update path
--     (`profiles_admin_update`) is unchanged and serves the admin
--     `إجبار تغيير كلمة المرور` button. The RPC above handles
--     the staff-side self-clear case.
--   • No schema changes to `auth.users` or any Supabase-managed
--     table.
--   • No service-role grants, no service-role-required functions.
--   • No password storage, hashing, or comparison logic. Password
--     state is owned by Supabase Auth. This migration only tracks
--     "did the staff member complete the forced rotation?".
--
-- Safety properties
-- -----------------
--   • ADD COLUMN IF NOT EXISTS — idempotent, no-op on re-run.
--   • Both new columns NOT NULL DEFAULT (or nullable timestamp)
--     so existing rows backfill to the safe value automatically.
--   • CREATE OR REPLACE FUNCTION — idempotent.
--   • No DROP, TRUNCATE, DELETE, ALTER COLUMN ... DROP, or any
--     other destructive statement.
--   • Function is SECURITY DEFINER but the body limits writes to
--     `auth.uid()` — the caller can never patch someone else's row.
--   • EXECUTE granted only to `authenticated`; REVOKE FROM PUBLIC
--     blocks the `anon` role.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;

COMMENT ON COLUMN public.profiles.must_change_password IS
  'Phase 26H-2 — true when an admin has forced this staff member to rotate '
  'their password on next login. Cleared by the SECURITY DEFINER RPC '
  '`public.complete_password_change()` after the staff member completes '
  'the rotation at /change-password.';

COMMENT ON COLUMN public.profiles.password_changed_at IS
  'Phase 26H-2 — last time the staff member completed a password rotation '
  'via /change-password. NULL means "never rotated via this app flow"; the '
  'Supabase Auth-side password may have changed independently (e.g. through '
  'a reset email link the staff member opened without landing on '
  '/change-password).';

CREATE OR REPLACE FUNCTION public.complete_password_change()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  -- Reject unauthenticated callers explicitly. PostgREST already
  -- rejects anon callers via the EXECUTE grant below, but defence in
  -- depth: even if a future grant change widens access, the function
  -- still refuses to run without an auth.uid().
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'complete_password_change requires an authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles
     SET must_change_password = false,
         password_changed_at = now()
   WHERE id = auth.uid();

  -- If the caller has no profile row, the UPDATE matches zero rows
  -- and we silently no-op. That matches the policy elsewhere in the
  -- codebase: a missing profile row is not a fatal error — the
  -- AuthContext + sign-in screen treat the absence as "default to
  -- r6 fallback" rather than blowing up.
END;
$function$;

COMMENT ON FUNCTION public.complete_password_change() IS
  'Phase 26H-2 — staff-side self-clear of the must_change_password flag. '
  'SECURITY DEFINER because Phase 23M-Fix1 removed profiles_own_update; '
  'narrow body limits writes to auth.uid() so the caller can only clear '
  'their own row.';

REVOKE EXECUTE ON FUNCTION public.complete_password_change() FROM PUBLIC;
-- Supabase's project-level default grants extend EXECUTE on any new
-- function in `public` to the `anon` role automatically (alongside
-- `authenticated` and `service_role`). REVOKE FROM PUBLIC alone is
-- not enough to block anon here — verified post-apply on
-- 2026-05-12. We REVOKE from anon explicitly so an unauthenticated
-- caller can never reach this function even if the body's
-- `auth.uid() IS NULL` guard is later relaxed.
REVOKE EXECUTE ON FUNCTION public.complete_password_change() FROM anon;
GRANT  EXECUTE ON FUNCTION public.complete_password_change() TO authenticated;


-- =============================================================================
-- POST-MIGRATION VERIFICATION (run manually after applying):
--
--   -- 1. Columns exist on profiles.
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema='public'
--      AND table_name='profiles'
--      AND column_name IN ('must_change_password', 'password_changed_at');
--   -- expected:
--   --   must_change_password | boolean                  | NO  | false
--   --   password_changed_at  | timestamp with time zone | YES | (null)
--
--   -- 2. RPC exists, runs as SECURITY DEFINER, search_path locked.
--   SELECT p.proname, p.prosecdef, p.proconfig
--     FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public'
--      AND p.proname='complete_password_change';
--   -- expected: prosecdef = true, proconfig contains 'search_path=public'.
--
--   -- 3. EXECUTE granted only to authenticated; PUBLIC revoked.
--   SELECT grantee, privilege_type
--     FROM information_schema.role_routine_grants
--    WHERE routine_schema='public'
--      AND routine_name='complete_password_change'
--    ORDER BY grantee;
--   -- expected exactly:
--   --   authenticated | EXECUTE
-- =============================================================================
