-- ─────────────────────────────────────────────────────────────────────────────
-- Phase Permissions-Audit-Phase-4A — server-side enforcement for
-- `create_orders`.
--
-- Problem
--   The previous RLS policy on `turath_masr_orders` INSERT only checked
--   `created_by_user_id IS NULL OR created_by_user_id = auth.uid()` —
--   i.e. *any* authenticated user could insert an order, regardless of
--   role or permission. The UI gate (`perms.isAdmin || perms.can(
--   'create_orders')`, landed in PR #134) was the only barrier. An
--   operator without `create_orders` could open browser DevTools and
--   POST directly to `/rest/v1/turath_masr_orders` to bypass the UI.
--
-- Fix
--   New SECURITY DEFINER helper `public.can_create_orders()` that
--   mirrors the JS `hasPermission('create_orders', roleId,
--   customPermissions)` logic exactly:
--
--     • If `profiles.permissions` is non-empty for the current user,
--       treat it as the effective permission set (the custom
--       override an admin assigned via the /roles Users tab).
--     • Otherwise fall back to `turath_roles.permissions` for the
--       caller's `role_id` — the DB-mirrored role-defaults table that
--       the /roles admin UI edits.
--     • Return true iff `'create_orders'` is in the resulting set.
--     • Fail closed on missing profile / missing auth.uid().
--
-- Why this mirrors the catalog, not the deprecated role helpers
--   The previous role helpers in src/lib/constants/roles.ts
--   (`canCreateOrders(roleId)`) and the role-only booleans on
--   usePermissions() (deprecated in PR #135) all ignored
--   customPermissions and diverged from the catalog in multiple
--   directions. Reading the DB tables directly avoids reintroducing
--   that bug at the SQL layer.
--
-- Why this is safe
--   • SECURITY DEFINER + `SET search_path = public, pg_temp` is the
--     established pattern (matches is_admin, is_manager_or_above,
--     can_edit_orders, etc.).
--   • The function reads only `profiles` and `turath_roles`. Both
--     are tables admins already control via the /roles UI; no new
--     trust surface.
--   • REVOKE FROM PUBLIC + GRANT EXECUTE TO authenticated ensures
--     anonymous callers cannot invoke it (defense-in-depth on top of
--     the runtime `auth.uid() IS NULL` fail-closed return).
--   • Only the INSERT policy on `turath_masr_orders` is touched.
--     UPDATE (`can_edit_orders`) and DELETE (`is_admin`) policies
--     are intentionally NOT modified in this phase — see the Phase 4
--     audit report for the deferred work.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─── 1) Effective-permission helper for `create_orders` ────────────────

CREATE OR REPLACE FUNCTION public.can_create_orders()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- Mirror of the JS hasPermission('create_orders', roleId,
  -- customPermissions) logic:
  --   • If the caller's profile carries a non-empty `permissions`
  --     array (the per-user custom override an admin set via
  --     /roles), use that as the effective set.
  --   • Otherwise fall back to the role's default permissions
  --     stored in `turath_roles.permissions` (the live source of
  --     truth edited via /roles for role defaults; NOT the JS
  --     DEFAULT_ROLES constant, which may be stale).
  --   • Return true only when 'create_orders' is in the effective
  --     set. Returns false when no profile row matches auth.uid()
  --     (unauthenticated path or unknown user) — fail-closed.
  WITH eff AS (
    SELECT
      CASE
        WHEN cardinality(coalesce(p.permissions, ARRAY[]::text[])) > 0
          THEN p.permissions
        ELSE coalesce(r.permissions, ARRAY[]::text[])
      END AS effective_perms
    FROM public.profiles p
    LEFT JOIN public.turath_roles r ON r.id = p.role_id
    WHERE p.id = auth.uid()
    LIMIT 1
  )
  SELECT EXISTS (
    SELECT 1
    FROM eff
    WHERE 'create_orders' = ANY(effective_perms)
  );
$$;

REVOKE ALL ON FUNCTION public.can_create_orders() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_create_orders() TO authenticated;

COMMENT ON FUNCTION public.can_create_orders() IS
'Phase Permissions-Audit-Phase-4A — server-side mirror of the JS hasPermission("create_orders", roleId, customPermissions). Prefers profiles.permissions (custom override) when non-empty, else falls back to turath_roles.permissions for the caller''s role. Used by the orders INSERT RLS policy to align server enforcement with the UI permission catalog. Does not hardcode any role list; does not consult the deprecated role-only helpers in src/lib/constants/roles.ts.';


-- ─── 2) Replace the wide-open INSERT policy ────────────────────────────

-- The previous policy let any authenticated user insert an order so
-- long as `created_by_user_id` matched auth.uid() (or was NULL).
-- The new policy keeps that stamp check AND adds the
-- can_create_orders() gate.

DROP POLICY IF EXISTS orders_authenticated_insert ON public.turath_masr_orders;

CREATE POLICY orders_create_authorized
  ON public.turath_masr_orders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.can_create_orders()
    AND (created_by_user_id IS NULL OR created_by_user_id = auth.uid())
  );


COMMIT;

-- ─── Manual verification (run after apply, no migration changes) ─────
--   -- 1. Helper exists and is SECURITY DEFINER.
--   SELECT proname, prosecdef FROM pg_proc
--   WHERE  proname = 'can_create_orders'
--     AND  pronamespace = 'public'::regnamespace;
--   -- expected: 1 row, prosecdef = true
--
--   -- 2. New INSERT policy is attached and uses the helper.
--   SELECT policyname, cmd, with_check
--   FROM   pg_policies
--   WHERE  schemaname='public'
--     AND  tablename='turath_masr_orders'
--     AND  cmd='INSERT';
--   -- expected: 1 row, policyname='orders_create_authorized',
--   --                  with_check references can_create_orders()
--
--   -- 3. Old policy is gone.
--   SELECT COUNT(*) FROM pg_policies
--   WHERE  schemaname='public'
--     AND  tablename='turath_masr_orders'
--     AND  policyname='orders_authenticated_insert';
--   -- expected: 0
--
--   -- 4. UPDATE / DELETE policies unchanged.
--   SELECT policyname, cmd, qual
--   FROM   pg_policies
--   WHERE  schemaname='public'
--     AND  tablename='turath_masr_orders'
--     AND  cmd IN ('UPDATE','DELETE')
--   ORDER  BY cmd;
--   -- expected: UPDATE uses can_edit_orders(); DELETE uses is_admin()
