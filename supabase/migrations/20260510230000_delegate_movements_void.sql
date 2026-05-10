-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 23E — soft-void support for the three delegate financial tables.
--
-- Adds the metadata columns the `/delegates` page needs to record an
-- "edit" or "void" action against settlements / expenses / custody
-- without ever hard-deleting a row. Voided rows remain in the table
-- (auditable) but are excluded from the financial aggregates by the
-- application layer.
--
-- The migration is purely ADDITIVE:
--   • Settlements — gets a brand-new `status` column (the table had
--     none) with CHECK ('active','voided') + 5 audit columns. Default
--     `'active'` so every existing row is treated as live.
--   • Expenses — already has a `status` column with a 3-token CHECK.
--     The CHECK is dropped and re-created with the widened token set
--     ('approved','pending','rejected','voided'). 5 audit columns are
--     added (the existing `approved_by` / `_name` are kept untouched
--     because they answer a different question — "who approved" vs
--     "who voided"). Idempotent via `IF EXISTS` on the DROP.
--   • Custody — same shape as expenses: drop + re-create CHECK with
--     a widened set ('with_delegate','returned','settled','lost',
--     'voided'). 5 audit columns added.
--
-- Column conventions (uniform across all three tables):
--   void_reason        text         — required at UI; nullable in DB
--                                     so legacy / future bypass paths
--                                     still insert.
--   voided_at          timestamptz  — wall-clock when the void was
--                                     recorded (back-dating handled
--                                     by `updated_at`).
--   voided_by          uuid         — soft FK to profiles, ON DELETE
--                                     SET NULL (preserves audit).
--   voided_by_name     text         — snapshot of the dispatcher's
--                                     display name.
--   updated_at         timestamptz  — populated by the app on every
--                                     edit/void (no DB trigger by
--                                     design — keeps the table
--                                     boring and predictable).
--
-- RLS: NO changes. Every existing UPDATE policy is already gated on
-- `is_admin()`, which covers both the "edit" and "void" paths
-- shipping in this PR.
--
-- DEPLOY GATE — DO NOT APPLY WITHOUT EXPLICIT APPROVAL
--   The Phase 23E PR ships only the migration file + UI wiring. The
--   defensive UI swallows the pre-migration "column does not exist"
--   error (42703) on the new columns and treats every legacy row as
--   active so the page stays usable before the migration is applied.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── 1) Settlements ───────────────────────────────────────────────────────

ALTER TABLE public.turath_masr_delegate_settlements
  ADD COLUMN IF NOT EXISTS status           text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS void_reason      text,
  ADD COLUMN IF NOT EXISTS voided_at        timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS voided_by_name   text,
  ADD COLUMN IF NOT EXISTS updated_at       timestamptz;

-- Settlements had no `status` constraint before; introduce one keyed
-- to the new column. The constraint name is namespaced so a future
-- widening (e.g. adding 'reversed') can DROP the same name.
ALTER TABLE public.turath_masr_delegate_settlements
  DROP CONSTRAINT IF EXISTS settlements_status_check;
ALTER TABLE public.turath_masr_delegate_settlements
  ADD CONSTRAINT settlements_status_check
  CHECK (status IN ('active', 'voided'));

COMMENT ON COLUMN public.turath_masr_delegate_settlements.status IS
  'Phase 23E — lifecycle. active = live row counted in totals. '
  'voided = soft-cancelled, still readable but excluded from aggregates.';
COMMENT ON COLUMN public.turath_masr_delegate_settlements.void_reason IS
  'Phase 23E — required Arabic reason captured at void time.';
COMMENT ON COLUMN public.turath_masr_delegate_settlements.voided_at IS
  'Phase 23E — wall-clock the void was recorded.';
COMMENT ON COLUMN public.turath_masr_delegate_settlements.voided_by IS
  'Phase 23E — soft FK to the dispatcher who voided the row.';
COMMENT ON COLUMN public.turath_masr_delegate_settlements.voided_by_name IS
  'Phase 23E — snapshot of the dispatcher display name at void time.';
COMMENT ON COLUMN public.turath_masr_delegate_settlements.updated_at IS
  'Phase 23E — bumped by the application on every edit / void.';


-- ─── 2) Expenses ──────────────────────────────────────────────────────────

ALTER TABLE public.turath_masr_delegate_expenses
  ADD COLUMN IF NOT EXISTS void_reason      text,
  ADD COLUMN IF NOT EXISTS voided_at        timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS voided_by_name   text,
  ADD COLUMN IF NOT EXISTS updated_at       timestamptz;

-- Widen the existing status CHECK to include 'voided'. The previous
-- constraint name was `turath_masr_delegate_expenses_status_check`
-- (verified in the audit). Drop + re-create under the same name.
ALTER TABLE public.turath_masr_delegate_expenses
  DROP CONSTRAINT IF EXISTS turath_masr_delegate_expenses_status_check;
ALTER TABLE public.turath_masr_delegate_expenses
  ADD CONSTRAINT turath_masr_delegate_expenses_status_check
  CHECK (status IN ('approved', 'pending', 'rejected', 'voided'));

COMMENT ON COLUMN public.turath_masr_delegate_expenses.void_reason IS
  'Phase 23E — required Arabic reason captured at void time.';
COMMENT ON COLUMN public.turath_masr_delegate_expenses.voided_at IS
  'Phase 23E — wall-clock the void was recorded.';
COMMENT ON COLUMN public.turath_masr_delegate_expenses.voided_by IS
  'Phase 23E — soft FK to the dispatcher who voided the row.';
COMMENT ON COLUMN public.turath_masr_delegate_expenses.voided_by_name IS
  'Phase 23E — snapshot of the dispatcher display name at void time.';
COMMENT ON COLUMN public.turath_masr_delegate_expenses.updated_at IS
  'Phase 23E — bumped by the application on every edit / void.';


-- ─── 3) Custody ───────────────────────────────────────────────────────────

ALTER TABLE public.turath_masr_delegate_custody
  ADD COLUMN IF NOT EXISTS void_reason      text,
  ADD COLUMN IF NOT EXISTS voided_at        timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS voided_by_name   text,
  ADD COLUMN IF NOT EXISTS updated_at       timestamptz;

-- Widen the existing status CHECK to include 'voided'. The previous
-- constraint name was `turath_masr_delegate_custody_status_check`
-- (verified in the audit). Drop + re-create under the same name.
ALTER TABLE public.turath_masr_delegate_custody
  DROP CONSTRAINT IF EXISTS turath_masr_delegate_custody_status_check;
ALTER TABLE public.turath_masr_delegate_custody
  ADD CONSTRAINT turath_masr_delegate_custody_status_check
  CHECK (status IN ('with_delegate', 'returned', 'settled', 'lost', 'voided'));

COMMENT ON COLUMN public.turath_masr_delegate_custody.void_reason IS
  'Phase 23E — required Arabic reason captured at void time.';
COMMENT ON COLUMN public.turath_masr_delegate_custody.voided_at IS
  'Phase 23E — wall-clock the void was recorded.';
COMMENT ON COLUMN public.turath_masr_delegate_custody.voided_by IS
  'Phase 23E — soft FK to the dispatcher who voided the row.';
COMMENT ON COLUMN public.turath_masr_delegate_custody.voided_by_name IS
  'Phase 23E — snapshot of the dispatcher display name at void time.';
COMMENT ON COLUMN public.turath_masr_delegate_custody.updated_at IS
  'Phase 23E — bumped by the application on every edit / void.';


-- =============================================================================
-- POST-MIGRATION VERIFICATION (run manually after applying):
--
--   SELECT table_name, column_name
--     FROM information_schema.columns
--    WHERE table_schema='public'
--      AND table_name IN (
--        'turath_masr_delegate_settlements',
--        'turath_masr_delegate_expenses',
--        'turath_masr_delegate_custody'
--      )
--      AND column_name IN (
--        'status', 'void_reason', 'voided_at', 'voided_by',
--        'voided_by_name', 'updated_at'
--      )
--    ORDER BY table_name, column_name;
--   -- expect: 6 columns on settlements, 5 on expenses + 5 on custody
--   --         (the latter two already had `status`).
--
--   SELECT conname, pg_get_constraintdef(oid)
--     FROM pg_constraint
--    WHERE conname IN (
--      'settlements_status_check',
--      'turath_masr_delegate_expenses_status_check',
--      'turath_masr_delegate_custody_status_check'
--    );
--   -- expect: settlements CHECK includes ('active','voided');
--   --         expenses CHECK includes 'voided';
--   --         custody CHECK includes 'voided'.
--
--   SELECT count(*) FROM public.turath_masr_delegate_settlements
--    WHERE status IS NULL;
--   -- expect: 0 (DEFAULT 'active' backfills every existing row).
-- =============================================================================
