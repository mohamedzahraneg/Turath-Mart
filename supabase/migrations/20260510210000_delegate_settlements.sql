-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 23B — delegate settlements (توريدات المناديب)
--
-- Adds `public.turath_masr_delegate_settlements` so dispatchers can
-- record cash / Vodafone-cash / bank-transfer / safe / other handovers
-- from delegates back to the company. The `/delegates` page (drawer
-- → "التوريدات" tab) reads + writes this table to compute "remaining
-- due" against the delivered-order collected total.
--
-- Design decisions
--   • Plain table, no enum types. `method` is a free-text column with
--     a CHECK constraint listing the five canonical tokens — that
--     way adding a sixth method later is a no-rebuild ALTER TABLE on
--     the constraint, not a CREATE TYPE migration.
--   • `delegate_profile_id` is a soft FK (`ON DELETE SET NULL`) so a
--     deleted profile leaves an audit trail rather than wiping the
--     historical settlement row. The redundant `delegate_name`
--     column captures what the dispatcher saw at submission time so
--     the audit log stays readable even after profile changes.
--   • Symmetric pattern for `received_by` — store the recipient's
--     auth uuid + display name at submission time. ON DELETE SET
--     NULL preserves history.
--   • `amount > 0` CHECK rejects zero / negative settlements. A
--     refund / negative adjustment workflow is out of scope for this
--     phase and would warrant its own table or signed-amount column.
--   • Everything is non-destructive and idempotent (`IF NOT EXISTS`)
--     so re-running the migration is safe.
--
-- DEPLOY GATE — DO NOT APPLY WITHOUT EXPLICIT APPROVAL
--   The Phase 23B PR ships only the migration file + UI wiring. The
--   defensive UI swallows pre-migration "missing relation" errors
--   (42P01) and renders zeros so the page doesn't break before this
--   migration is applied. Once applied, settlements are live.
-- ─────────────────────────────────────────────────────────────────────────────


CREATE TABLE IF NOT EXISTS public.turath_masr_delegate_settlements (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Soft FK so a deleted profile doesn't wipe the audit row. Kept
  -- alongside the snapshot `delegate_name` so historical lookups
  -- still render a name even when the profile is gone.
  delegate_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  delegate_name       text,

  -- Egyptian-pound amount handed over. CHECK > 0 — refunds / negative
  -- adjustments are deferred to a future phase.
  amount              numeric NOT NULL CHECK (amount > 0),

  -- Five canonical methods. UI maps each to an Arabic label:
  --   cash           → كاش
  --   vodafone_cash  → فودافون كاش
  --   bank_transfer  → تحويل بنكي
  --   safe           → خزنة
  --   other          → أخرى
  -- `other` is the catch-all for new methods until they're promoted.
  method              text NOT NULL DEFAULT 'cash'
                      CHECK (method IN ('cash','vodafone_cash','bank_transfer','safe','other')),

  -- Recipient — the dispatcher who acknowledged the handover. Same
  -- soft-FK + snapshot pattern as the delegate fields.
  received_by         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  received_by_name    text,

  -- Free-form admin note. NEVER returned by any customer-facing
  -- endpoint (see Phase 22P privacy convention) — only readable by
  -- admins inside the /delegates drawer.
  note                text,

  -- When the dispatcher recorded the handover. Distinct from
  -- `created_at` so a back-dated entry remains traceable.
  settled_at          timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now()
);


-- Indexed for the two queries the page actually runs:
--   • per-delegate timeline       → delegate_profile_id
--   • global "last settlement"    → settled_at DESC
CREATE INDEX IF NOT EXISTS turath_masr_delegate_settlements_delegate_profile_id_idx
  ON public.turath_masr_delegate_settlements(delegate_profile_id);

CREATE INDEX IF NOT EXISTS turath_masr_delegate_settlements_settled_at_idx
  ON public.turath_masr_delegate_settlements(settled_at);


-- ─── Row Level Security ──────────────────────────────────────────────────
--
-- Posture (matches the conservative "financial writes are admin-only"
-- decision the Phase 23B audit recorded; mirrors `profiles_admin_*`
-- policies):
--
--   • SELECT  →  is_admin()
--   • INSERT  →  is_admin()
--   • UPDATE  →  is_admin()
--   • DELETE  →  is_admin()
--
-- Why admin-only on SELECT too: the default role-permission map
-- only grants `view_delegates` to r1 (admin); r2/r3 don't see the
-- /delegates page from the default landing logic. Limiting reads
-- to admin keeps RLS aligned with the realistic UI gate without
-- inventing a new helper function (`is_shipping_or_above`).
--
-- A future phase that wants r3 to read settlements should add an
-- explicit helper + a separate SELECT policy in its own migration.
-- ────────────────────────────────────────────────────────────────────────

ALTER TABLE public.turath_masr_delegate_settlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS settlements_admin_select ON public.turath_masr_delegate_settlements;
CREATE POLICY settlements_admin_select
  ON public.turath_masr_delegate_settlements
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS settlements_admin_insert ON public.turath_masr_delegate_settlements;
CREATE POLICY settlements_admin_insert
  ON public.turath_masr_delegate_settlements
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS settlements_admin_update ON public.turath_masr_delegate_settlements;
CREATE POLICY settlements_admin_update
  ON public.turath_masr_delegate_settlements
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS settlements_admin_delete ON public.turath_masr_delegate_settlements;
CREATE POLICY settlements_admin_delete
  ON public.turath_masr_delegate_settlements
  FOR DELETE
  TO authenticated
  USING (public.is_admin());


-- Documentation comments — surfaced by `\d+` and any future schema
-- introspection. No behavioural effect.
COMMENT ON TABLE public.turath_masr_delegate_settlements IS
  'Phase 23B — handover (توريد) records from delegates to the '
  'company. Admin-only by RLS. Drives the "remaining due" '
  'calculation on /delegates against the delivered-order total.';

COMMENT ON COLUMN public.turath_masr_delegate_settlements.delegate_profile_id IS
  'Soft FK to profiles.id; ON DELETE SET NULL preserves audit trail.';
COMMENT ON COLUMN public.turath_masr_delegate_settlements.delegate_name IS
  'Snapshot of the delegate display name at submission time.';
COMMENT ON COLUMN public.turath_masr_delegate_settlements.amount IS
  'Egyptian-pound amount handed over. CHECK amount > 0.';
COMMENT ON COLUMN public.turath_masr_delegate_settlements.method IS
  'One of cash / vodafone_cash / bank_transfer / safe / other. '
  'CHECK constraint enforced at DDL.';
COMMENT ON COLUMN public.turath_masr_delegate_settlements.received_by IS
  'Soft FK to profiles.id of the dispatcher who acknowledged the '
  'handover. ON DELETE SET NULL preserves audit trail.';
COMMENT ON COLUMN public.turath_masr_delegate_settlements.settled_at IS
  'When the dispatcher recorded the handover. Distinct from '
  'created_at to allow back-dated entries.';


-- =============================================================================
-- POST-MIGRATION VERIFICATION (run manually after applying):
--
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema='public'
--      AND table_name='turath_masr_delegate_settlements'
--    ORDER BY ordinal_position;
--   -- expect: 10 columns
--
--   SELECT policyname, cmd, qual, with_check
--     FROM pg_policies
--    WHERE schemaname='public'
--      AND tablename='turath_masr_delegate_settlements'
--    ORDER BY policyname;
--   -- expect: 4 policies, all gated on is_admin().
--
--   SELECT relrowsecurity FROM pg_class
--    WHERE relname='turath_masr_delegate_settlements';
--   -- expect: true
-- =============================================================================
