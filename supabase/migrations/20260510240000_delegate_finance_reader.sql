-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 23F (Part A) — read-only access on the three delegate financial
-- tables for the shipping supervisor (r3).
--
-- Background
--   The /delegates UI now exposes settlements / custody / expenses /
--   account-statement tabs. Until this migration only the admin (r1)
--   could `view_delegates` (per the default permissions map) AND only
--   the admin could SELECT from the three financial tables (per the
--   23B/23C admin-only RLS).
--
--   The shipping supervisor (r3) needs read access to do their job —
--   spot-check delegate balances, audit pending settlements before
--   approving them — without being able to mutate anything. This
--   phase grants that strictly via SELECT-only RLS plus a UI permission
--   change in `src/lib/permissions/permissions.ts` (NOT in this
--   migration — the permissions module is the canonical UI gate).
--
-- Design decisions
--   • New helper function `public.is_delegate_finance_reader()`. Returns
--     true for r1 OR r3 only. STABLE + SECURITY DEFINER so RLS policies
--     can call it cheaply, with `SET search_path = public` to harden
--     against search-path attacks (matches Phase 22 conventions).
--   • Per-table additive SELECT policies (`*_finance_reader_select`).
--     The existing admin-only `*_admin_select` policies are LEFT IN
--     PLACE — Postgres OR's `permissive` policies, so adding a second
--     SELECT policy widens read access without changing the write side.
--     Concretely: r1 still passes both policies, r3 passes the new
--     one, everyone else still gets denied by the absence of any
--     matching policy.
--   • INSERT / UPDATE / DELETE policies are NOT touched. Writes stay
--     admin-only, exactly as Phase 23B/23C/23E shipped them.
--   • Idempotent — DROP POLICY IF EXISTS + CREATE.
--
-- DEPLOY GATE — DO NOT APPLY WITHOUT EXPLICIT APPROVAL
--   Once applied, any user with role_id='r3' immediately gains read
--   access to the three financial tables. The Phase 23F PR ships the
--   matching UI permission update (adding `view_delegates` to r3's
--   role definition) so a shipping supervisor lands on /delegates
--   cleanly the first time they sign in after the deploy.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── 1) Helper function ──────────────────────────────────────────────────

-- We use a function rather than inlining `role_id IN ('r1','r3')` so
-- the policies stay readable AND so a future widening (e.g. add r2,
-- add a CS auditor role) is a one-line edit instead of a six-policy
-- rewrite. SECURITY DEFINER + SET search_path = public follows the
-- pattern set by `is_admin()` and `is_manager_or_above()`.
CREATE OR REPLACE FUNCTION public.is_delegate_finance_reader()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    public.get_current_user_role_id() = ANY (ARRAY['r1', 'r3']),
    false
  );
$$;

COMMENT ON FUNCTION public.is_delegate_finance_reader() IS
  'Phase 23F — true for admin (r1) or shipping supervisor (r3). '
  'Used by SELECT policies on the three delegate financial tables '
  'to grant read-only access without widening the existing admin-'
  'only INSERT/UPDATE/DELETE policies.';


-- ─── 2) Read-only SELECT policies (additive) ─────────────────────────────
--
-- Permissive policies are OR'd by Postgres, so adding the
-- `*_finance_reader_select` policies in parallel with the existing
-- `*_admin_select` policies gives admins both paths and shipping
-- supervisors only the new path. Existing INSERT / UPDATE / DELETE
-- policies on these tables are NOT touched.

-- Settlements
DROP POLICY IF EXISTS settlements_finance_reader_select
  ON public.turath_masr_delegate_settlements;
CREATE POLICY settlements_finance_reader_select
  ON public.turath_masr_delegate_settlements
  FOR SELECT
  TO authenticated
  USING (public.is_delegate_finance_reader());

-- Custody
DROP POLICY IF EXISTS custody_finance_reader_select
  ON public.turath_masr_delegate_custody;
CREATE POLICY custody_finance_reader_select
  ON public.turath_masr_delegate_custody
  FOR SELECT
  TO authenticated
  USING (public.is_delegate_finance_reader());

-- Expenses
DROP POLICY IF EXISTS expenses_finance_reader_select
  ON public.turath_masr_delegate_expenses;
CREATE POLICY expenses_finance_reader_select
  ON public.turath_masr_delegate_expenses
  FOR SELECT
  TO authenticated
  USING (public.is_delegate_finance_reader());


-- =============================================================================
-- POST-MIGRATION VERIFICATION (run manually after applying):
--
--   SELECT public.is_delegate_finance_reader();
--   -- expect: true  iff signed in as r1 or r3, false otherwise
--
--   SELECT tablename, policyname, cmd
--     FROM pg_policies
--    WHERE schemaname = 'public'
--      AND policyname LIKE '%_finance_reader_select'
--    ORDER BY tablename;
--   -- expect: 3 rows, all cmd='SELECT'.
--
--   -- Manual smoke as r3:
--   SELECT count(*) FROM public.turath_masr_delegate_settlements;  -- should succeed
--   INSERT INTO public.turath_masr_delegate_settlements (...);     -- should 42501
-- =============================================================================
