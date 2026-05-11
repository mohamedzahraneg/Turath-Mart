-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 24D — Widen `turath_masr_customer_tasks.priority` CHECK to
-- include the new `urgent` tier alongside the existing `low / medium /
-- high`. Pure additive — no rows are touched, no columns added or
-- removed, no RLS changes.
--
-- Why
-- ---
-- Phase 24A shipped the tasks table with three priority tokens. The
-- Phase 24D workflow spec asks for a fourth, hotter tier (`urgent`)
-- that drives the red badge + the dashboard "مهام عاجلة" panel. The
-- helper module and UI already render the new token; this migration
-- is the DB-side catch-up so an `INSERT … VALUES (priority='urgent')`
-- doesn't trip 23514.
--
-- Safety properties
-- -----------------
--   • DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT — idempotent
--   • Single statement pair, no transaction needed
--   • Reversible: re-adding the three-token constraint is a one-line
--     ALTER if a future phase needs to narrow back
--   • No DROP TABLE / TRUNCATE / DELETE / ALTER COLUMN
--   • No RLS changes
--   • Existing rows remain valid (all already use low/medium/high)
--
-- DEPLOY GATE — DO NOT APPLY WITHOUT EXPLICIT APPROVAL
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.turath_masr_customer_tasks
  DROP CONSTRAINT IF EXISTS turath_masr_customer_tasks_priority_check;

ALTER TABLE public.turath_masr_customer_tasks
  ADD CONSTRAINT turath_masr_customer_tasks_priority_check
  CHECK (priority IN ('low', 'medium', 'high', 'urgent'));


-- =============================================================================
-- POST-MIGRATION VERIFICATION
--
--   SELECT con.conname, pg_get_constraintdef(con.oid)
--     FROM pg_constraint con
--     JOIN pg_class cls ON cls.oid = con.conrelid
--     JOIN pg_namespace ns ON ns.oid = cls.relnamespace
--    WHERE ns.nspname='public'
--      AND cls.relname='turath_masr_customer_tasks'
--      AND con.conname='turath_masr_customer_tasks_priority_check';
--   -- expect: CHECK ((priority = ANY (ARRAY['low','medium','high','urgent'])))
-- =============================================================================
