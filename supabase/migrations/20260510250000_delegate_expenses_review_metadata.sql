-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 23G — expense approval workflow.
--
-- Adds the review-metadata columns the /delegates expenses tab now
-- needs to support a real approve / reject flow (Phase 23C shipped
-- the status CHECK with all four tokens — `approved`, `pending`,
-- `rejected`, `voided` — but only `approved` and `voided` had UI
-- paths until now).
--
-- New columns
--   review_reason       text         — required at UI time on reject;
--                                      optional on approve. Stores the
--                                      Arabic reason captured in the
--                                      review dialog.
--   reviewed_at         timestamptz  — wall-clock the approve/reject
--                                      decision was recorded.
--   reviewed_by         uuid         — soft FK to profiles(id) ON DELETE
--                                      SET NULL. Identifies the admin
--                                      who acted on the pending row.
--   reviewed_by_name    text         — snapshot of the reviewer's
--                                      display name at decision time.
--
-- Why both `approved_*` (existing) and `reviewed_*` (new)?
--   `approved_by` / `approved_by_name` were introduced in Phase 23C
--   as "who recorded the row when it was inserted with status=approved".
--   They stay untouched and continue to answer that question for rows
--   that bypass the review dialog.
--   The new `reviewed_*` columns answer a different question: "who
--   made the most recent approve/reject decision on this row?". The
--   audit trail keeps both clean — re-using `approved_*` for the
--   review action would conflate insert-time with decision-time and
--   break historical lookups.
--
-- RLS
--   Unchanged. The four existing `expenses_admin_*` policies already
--   gate every write path on `is_admin()`. The Phase 23F
--   `expenses_finance_reader_select` policy lets r3 read the new
--   columns without any further policy work.
--
-- Idempotent
--   `ADD COLUMN IF NOT EXISTS` on every column. Re-running the
--   migration is safe.
--
-- DEPLOY GATE — DO NOT APPLY WITHOUT EXPLICIT APPROVAL
--   The Phase 23G PR ships only the migration file + UI wiring.
--   Pre-migration the page swallows the 42703 ("column does not
--   exist") on the new SELECT columns and falls back to the existing
--   approve / void surfaces — pending / rejected workflow simply
--   isn't available until the migration applies.
-- ─────────────────────────────────────────────────────────────────────────────


ALTER TABLE public.turath_masr_delegate_expenses
  ADD COLUMN IF NOT EXISTS review_reason     text,
  ADD COLUMN IF NOT EXISTS reviewed_at       timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_by_name  text;


COMMENT ON COLUMN public.turath_masr_delegate_expenses.review_reason IS
  'Phase 23G — Arabic reason captured at the approve/reject decision. '
  'Required by the UI on reject, optional on approve.';
COMMENT ON COLUMN public.turath_masr_delegate_expenses.reviewed_at IS
  'Phase 23G — wall-clock the approve/reject decision was recorded. '
  'Distinct from `created_at` (insert) and `voided_at` (void).';
COMMENT ON COLUMN public.turath_masr_delegate_expenses.reviewed_by IS
  'Phase 23G — soft FK to the admin profile that approved or rejected '
  'this expense. ON DELETE SET NULL preserves the audit row.';
COMMENT ON COLUMN public.turath_masr_delegate_expenses.reviewed_by_name IS
  'Phase 23G — snapshot of the reviewer display name at decision time.';


-- =============================================================================
-- POST-MIGRATION VERIFICATION (run manually after applying):
--
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND table_name = 'turath_masr_delegate_expenses'
--      AND column_name IN (
--        'review_reason', 'reviewed_at', 'reviewed_by', 'reviewed_by_name'
--      )
--    ORDER BY column_name;
--   -- expect: 4 rows, all is_nullable = 'YES'.
--
--   SELECT count(*) FROM public.turath_masr_delegate_expenses
--    WHERE reviewed_at IS NOT NULL;
--   -- expect: 0 immediately after the migration runs.
--
--   -- Re-confirm the policy set is unchanged (4 admin policies +
--   -- 1 finance-reader SELECT from Phase 23F).
--   SELECT policyname, cmd FROM pg_policies
--    WHERE schemaname='public'
--      AND tablename='turath_masr_delegate_expenses'
--    ORDER BY policyname;
-- =============================================================================
