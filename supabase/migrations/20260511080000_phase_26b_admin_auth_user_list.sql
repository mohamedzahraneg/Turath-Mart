-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 26B — admin-only RPC for listing `auth.users` from the app.
--
-- Why this exists
-- ---------------
-- Phase 26A's audit found 4 `auth.users` rows that lost their matching
-- `public.profiles` row to the old broken delete UX. Those orphans
-- are invisible to the Phase 26A SecurityTab because the client
-- Supabase SDK cannot read `auth.users` directly (it's outside the
-- public schema and gated by an `authenticated` GRANT that only
-- exists for the row's own user).
--
-- This RPC is a `SECURITY DEFINER` function that runs as its owner
-- (postgres), reads `auth.users`, and only returns rows when the
-- caller is an admin (`public.is_admin()`). Nothing here lets the
-- caller WRITE to `auth.users` — only read a narrow projection.
--
-- What the function returns
-- -------------------------
--   id                 — auth user UUID (matches profiles.id)
--   email              — the login email
--   created_at         — when the auth user was created
--   last_sign_in_at    — last successful sign-in
--   email_confirmed_at — null when email isn't confirmed
--   banned_until       — non-null when Supabase Auth Admin banned the user
--   deleted_at         — non-null when soft-deleted via Supabase Admin
--
-- What it deliberately does NOT return
-- ------------------------------------
--   • password_hash / encrypted_password — never readable by anyone
--     except the postgres role; this projection skips it for clarity.
--   • Any tokens, refresh tokens, MFA secrets.
--   • Raw user_metadata / identities — those can carry provider
--     payloads and are not needed for orphan triage.
--
-- Why a function (not a view)
-- ---------------------------
-- A function gives us a single hook to enforce `is_admin()` at runtime
-- and revoke from `anon` cleanly. A view would inherit `auth.users`'s
-- own RLS, which is owned by the supabase_auth_admin role and not
-- something we want to extend.
--
-- Safety properties
-- -----------------
--   • CREATE OR REPLACE FUNCTION — idempotent.
--   • No destructive SQL. No DROP, no TRUNCATE, no DELETE.
--   • SECURITY DEFINER + STABLE + explicit `SET search_path = public,
--     auth` — does not leak schema lookups.
--   • Granted to `authenticated` only; revoked from `anon` and
--     `PUBLIC`.
--   • Returns zero rows for non-admin callers — no leak.
--
-- DEPLOY GATE — DO NOT APPLY WITHOUT EXPLICIT APPROVAL
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.list_auth_users_for_admin()
RETURNS TABLE (
  id                 UUID,
  email              TEXT,
  created_at         TIMESTAMPTZ,
  last_sign_in_at    TIMESTAMPTZ,
  email_confirmed_at TIMESTAMPTZ,
  banned_until       TIMESTAMPTZ,
  deleted_at         TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $function$
  SELECT
    u.id,
    u.email::text,
    u.created_at,
    u.last_sign_in_at,
    u.email_confirmed_at,
    u.banned_until,
    u.deleted_at
  FROM auth.users u
  WHERE public.is_admin()
  ORDER BY u.created_at DESC;
$function$;

-- Tighten the grants. We deliberately allow `authenticated` here —
-- the `is_admin()` predicate inside the function decides whether to
-- emit rows.
REVOKE ALL ON FUNCTION public.list_auth_users_for_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_auth_users_for_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.list_auth_users_for_admin() TO authenticated;

COMMENT ON FUNCTION public.list_auth_users_for_admin() IS
  'Phase 26B — admin-only narrow projection of auth.users for the orphan-cleanup UI in /roles. Returns zero rows for non-admin callers.';


-- =============================================================================
-- POST-MIGRATION VERIFICATION (read-only — run manually after apply)
--
--   -- Existence + grants
--   SELECT proname, prosecdef, prokind
--     FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public' AND p.proname='list_auth_users_for_admin';
--
--   -- Should return rows for admin caller, zero for non-admin.
--   SELECT count(*) FROM public.list_auth_users_for_admin();
-- =============================================================================
