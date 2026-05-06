-- ============================================================================
-- 20260506a_prepare_existing_production_columns.sql
--
-- WHY THIS PATCH EXISTS
--
-- Production schema predates the RLS hardening migrations
-- (20260505*, 20260506*) and is missing the columns those migrations'
-- policies, indexes, and trigger functions reference.
--
-- Migration 20260505_harden_rls_policies.sql failed on production at line 500:
--   ERROR 42703: column "user_id" does not exist
-- The CREATE TABLE IF NOT EXISTS for public.turath_masr_sessions was a no-op
-- (the table already existed in production with a different shape — uses
-- user_email/user_name for identity, not user_id), and the subsequent
-- CREATE INDEX on the missing user_id column tripped the failure.
--
-- This patch adds every column the four hardening migrations reference, all
-- as NULLABLE with ON DELETE SET NULL FK behavior so:
--   - Existing rows remain valid (new columns default to NULL).
--   - Deleting an auth.users row does NOT cascade-delete operational records.
--   - The columns are idempotent (IF NOT EXISTS) — safe to run multiple times.
--
-- WHAT THIS PATCH DOES NOT DO
--   - No DROP TABLE / DROP COLUMN / TRUNCATE / DELETE.
--   - No UPDATE / INSERT (does not touch existing data).
--   - No CREATE POLICY / CREATE INDEX / ENABLE ROW LEVEL SECURITY
--     (those belong to the hardening migrations).
--   - No NOT NULL constraints on the new columns.
--   - No ON DELETE CASCADE — even where 20260505b declares CASCADE
--     (target_user_id), this patch downgrades to SET NULL to avoid
--     destructive cascades on user deletion. The hardening migration's
--     ADD COLUMN IF NOT EXISTS will be a no-op once this patch runs.
--
-- ORDER OF APPLICATION (Supabase production SQL Editor):
--   1. THIS PATCH (20260506a)
--   2. 20260505_harden_rls_policies.sql       (re-run from start)
--   3. 20260505b_strengthen_rls_policies.sql
--   4. 20260505c_fix_public_rls_exposure.sql
--   5. 20260506_secure_tracking_rpc.sql
--
-- The whole patch is wrapped in a single transaction so any failure rolls
-- back cleanly and re-running is always safe.
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) turath_masr_sessions
--    Used by AuthContext.tsx for session logging.
--    Production columns: id, user_email, user_name, role_id, role_name,
--    action, device, ip, timestamp, created_at.
--    Migration 20260505 line 489 expects user_id. Required for:
--      - line 500: CREATE INDEX idx_turath_masr_sessions_user_id
--      - line 510: sessions_own_insert WITH CHECK (user_id = auth.uid())
--      - line 517: sessions_own_select USING (user_id = auth.uid())
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.turath_masr_sessions
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2) turath_masr_orders
--    Production columns lack uuid traceability — created_by/created_by_device
--    are TEXT (display name + device fingerprint), not foreign keys.
--    Migration 20260505b adds three uuid columns. Required for:
--      - line 41: CREATE INDEX idx_orders_created_by_user_id
--      - line 42: CREATE INDEX idx_orders_assigned_to
--      - SECTION 5 orders_authenticated_insert policy:
--          WITH CHECK (created_by_user_id IS NULL OR created_by_user_id = auth.uid())
--    The updated_by column has no policy reference yet but is added together
--    so the schema is consistent with what 20260505b declares.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.turath_masr_orders
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_to        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3) turath_masr_notifications
--    Production columns: id, type, title, message, order_id, order_num,
--    is_read, created_by, created_at — no per-user/per-role targeting.
--    Migration 20260505b adds two scoping columns. Required for:
--      - line 54: CREATE INDEX idx_notifications_target_user
--      - line 55: CREATE INDEX idx_notifications_target_role
--      - SECTION 6 notifications_scoped_select policy:
--          USING (target_user_id IS NULL
--                 OR target_user_id = auth.uid()
--                 OR target_role_id = public.get_current_user_role_id()
--                 OR public.is_admin())
--      - SECTION 6 notifications_own_update policy: same column refs
--    NOTE: 20260505b declares target_user_id with ON DELETE CASCADE.
--    This patch uses ON DELETE SET NULL instead — deleting a user nullifies
--    the target but preserves the notification history. Once this patch
--    runs, the hardening migration's ADD COLUMN IF NOT EXISTS becomes a
--    no-op and the SET NULL behavior persists.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.turath_masr_notifications
  ADD COLUMN IF NOT EXISTS target_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_role_id text;


-- ─────────────────────────────────────────────────────────────────────────────
-- COLUMNS DELIBERATELY NOT ADDED (and why)
--
-- - turath_masr_audit_logs.user_id          : Not referenced by any policy
--                                              or function in the four
--                                              hardening migrations. Existing
--                                              changed_by TEXT column is used
--                                              for display. Keep schema lean.
-- - turath_masr_crm_chat.created_by_user_id : Not referenced. Public-facing
--                                              chat has no per-staff scoping.
-- - turath_masr_crm_complaints.created_by_user_id : Not referenced. Same.
-- - turath_masr_notifications.role_id       : Distinct from target_role_id;
--                                              not referenced anywhere.
-- - profiles.role_id                        : Already exists in production.
-- ─────────────────────────────────────────────────────────────────────────────

COMMIT;

-- ============================================================================
-- VERIFICATION QUERIES (run AFTER applying this patch, before re-running
-- 20260505_harden_rls_policies.sql). All must return TRUE.
-- ============================================================================
--
-- SELECT EXISTS (
--   SELECT 1 FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='turath_masr_sessions'
--     AND column_name='user_id'
-- ) AS sessions_user_id_exists;
--
-- SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='turath_masr_orders' AND column_name='created_by_user_id') AS orders_created_by_user_id_exists;
-- SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='turath_masr_orders' AND column_name='assigned_to')         AS orders_assigned_to_exists;
-- SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='turath_masr_orders' AND column_name='updated_by')          AS orders_updated_by_exists;
-- SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='turath_masr_notifications' AND column_name='target_user_id') AS notifs_target_user_id_exists;
-- SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='turath_masr_notifications' AND column_name='target_role_id') AS notifs_target_role_id_exists;
