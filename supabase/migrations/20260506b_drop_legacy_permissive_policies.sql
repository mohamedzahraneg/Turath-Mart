-- ============================================================================
-- 20260506b_drop_legacy_permissive_policies.sql
--
-- WHY THIS PATCH EXISTS
--
-- Production has 19 pre-existing permissive RLS policies that pre-date the
-- hardening migrations and were not dropped by name in 20260505*/20260506*.
-- PostgreSQL OR-combines policies on the same table — so leaving them in
-- place would let any USING (true) / WITH CHECK (true) policy override the
-- restrictive policies the hardening migrations create.
--
-- This patch drops those 19 legacy policies by exact name. Each DROP uses
-- IF EXISTS, so re-running is safe and any policy already removed is a
-- no-op (no error).
--
-- WHAT THIS PATCH DOES NOT DO
--   - No DROP TABLE / TRUNCATE / DELETE / INSERT / UPDATE.
--   - No ALTER TABLE — RLS stays enabled wherever it was already enabled,
--     and the hardening migrations will (re-)enable it where needed.
--   - No CREATE POLICY — the four hardening migrations create the
--     replacement restrictive policies in their own sections.
--   - No data is touched. Only policy definitions are removed.
--
-- ORDER OF APPLICATION (Supabase production):
--   1. 20260506a_prepare_existing_production_columns.sql  (column patch)
--   2. THIS PATCH (20260506b_drop_legacy_permissive_policies.sql)
--   3. 20260505_harden_rls_policies.sql                   (Migration 1)
--   4. 20260505b_strengthen_rls_policies.sql              (Migration 2)
--   5. 20260505c_fix_public_rls_exposure.sql              (Migration 3)
--   6. 20260506_secure_tracking_rpc.sql                   (Migration 4)
-- ============================================================================

BEGIN;

-- ─── turath_masr_crm_chat ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow all actions for authenticated users" ON public.turath_masr_crm_chat;

-- ─── turath_masr_crm_complaints ─────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow all actions for authenticated users" ON public.turath_masr_crm_complaints;
DROP POLICY IF EXISTS "public_insert_complaints"                  ON public.turath_masr_crm_complaints;
DROP POLICY IF EXISTS "public_read_complaints"                    ON public.turath_masr_crm_complaints;

-- ─── turath_masr_inventory ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow all actions for authenticated users" ON public.turath_masr_inventory;

-- ─── turath_masr_notifications (incl. PG-truncated 63-char name) ────────────
DROP POLICY IF EXISTS "Allow all actions for authenticated users"                          ON public.turath_masr_notifications;
DROP POLICY IF EXISTS "Allow authenticated users to update own notifications read stat"    ON public.turath_masr_notifications;

-- ─── turath_masr_orders ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow all actions for authenticated users" ON public.turath_masr_orders;

-- ─── turath_masr_settings ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow all actions for authenticated users" ON public.turath_masr_settings;

-- ─── turath_masr_customers ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow all actions for authenticated users on customers" ON public.turath_masr_customers;

-- ─── deposits ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow all actions on deposits" ON public.deposits;

-- ─── turath_masr_audit_logs ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow all for authenticated" ON public.turath_masr_audit_logs;
DROP POLICY IF EXISTS "Allow anon insert"           ON public.turath_masr_audit_logs;
DROP POLICY IF EXISTS "Allow anon select"           ON public.turath_masr_audit_logs;

-- ─── turath_masr_sessions ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow all for authenticated" ON public.turath_masr_sessions;
DROP POLICY IF EXISTS "Allow anon insert"           ON public.turath_masr_sessions;
DROP POLICY IF EXISTS "Allow anon select"           ON public.turath_masr_sessions;

-- ─── turath_roles ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow all for authenticated" ON public.turath_roles;
DROP POLICY IF EXISTS "Allow anon read"             ON public.turath_roles;

-- ─── turath_masr_crm_complaint_logs ─────────────────────────────────────────
DROP POLICY IF EXISTS "Allow all for authenticated users on complaint logs" ON public.turath_masr_crm_complaint_logs;

COMMIT;
