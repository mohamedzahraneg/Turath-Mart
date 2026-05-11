-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 25A — Returns & Exchanges After Delivery
--
-- Adds a *new* table `turath_masr_order_adjustments` that captures every
-- return / exchange request raised against an existing order *after* it
-- has been marked `delivered`. The table records:
--
--   • The kind of adjustment (full / partial return, full / partial exchange)
--   • Which items go OUT of the customer (returned lines)
--   • Which items go BACK to the customer (replacement lines, exchanges only)
--   • Reason text (required)
--   • Refund mode + amount
--   • Price difference (positive = customer pays extra, negative = refund extra)
--   • Shipping payer (customer / company / split) + split amounts
--   • A pending → approved/rejected/completed/cancelled state machine
--   • Audit fields (who created, who decided, timestamps, notes)
--
-- IMPORTANT — Out of scope for this migration / phase:
--   • The original order's `status` is NEVER mutated here. The orders table
--     keeps `status='delivered'`; the adjustment lives alongside.
--   • No inventory mutation (stock is owned by other surfaces).
--   • No customer-tracking exposure (RLS keeps this internal-only).
--   • No widening / narrowing of existing CHECK constraints elsewhere.
--   • No deletes of historical orders.
--
-- Safety properties
-- -----------------
--   • Brand-new table — zero impact on existing rows
--   • CREATE TABLE IF NOT EXISTS — idempotent
--   • No DROP TABLE / TRUNCATE / DELETE / ALTER COLUMN on existing tables
--   • No RLS changes on existing tables
--   • RLS enabled by default; only admins (r1) and managers (r2) can
--     create / approve / reject — CRM (r5/r6) can create requests, only
--     managers/admin can transition state. Reads are limited to authenticated
--     internal users.
--   • Reversible: a future phase can DROP TABLE if abandoned (data lives in
--     audit logs as well).
--
-- DEPLOY GATE — DO NOT APPLY WITHOUT EXPLICIT APPROVAL
-- ─────────────────────────────────────────────────────────────────────────────

-- =============================================================================
-- 1) Table
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.turath_masr_order_adjustments (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Foreign key style reference to the original delivered order.
  order_id                    TEXT NOT NULL,
  order_num                   TEXT NOT NULL,

  -- Adjustment kind
  kind                        TEXT NOT NULL,

  -- State machine
  state                       TEXT NOT NULL DEFAULT 'pending',

  -- Business fields
  reason                      TEXT NOT NULL,
  notes                       TEXT,

  -- Item payloads (mirrors turath_masr_orders.lines JSONB shape)
  return_lines                JSONB NOT NULL DEFAULT '[]'::jsonb,
  replacement_lines           JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Monetary fields
  original_total              NUMERIC NOT NULL DEFAULT 0,
  refund_mode                 TEXT NOT NULL DEFAULT 'none',
  refund_amount               NUMERIC NOT NULL DEFAULT 0,
  price_difference            NUMERIC NOT NULL DEFAULT 0,

  -- Shipping payer breakdown
  shipping_payer              TEXT NOT NULL DEFAULT 'company',
  shipping_customer_amount    NUMERIC NOT NULL DEFAULT 0,
  shipping_company_amount     NUMERIC NOT NULL DEFAULT 0,

  -- Authorship
  created_by                  TEXT NOT NULL DEFAULT '',
  created_by_role             TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Decision audit (approve / reject / complete / cancel)
  decided_by                  TEXT,
  decided_by_role             TEXT,
  decided_at                  TIMESTAMPTZ,
  decision_note               TEXT,

  -- CHECK constraints
  CONSTRAINT turath_masr_order_adjustments_kind_check
    CHECK (kind IN ('return_full', 'return_partial', 'exchange_full', 'exchange_partial')),

  CONSTRAINT turath_masr_order_adjustments_state_check
    CHECK (state IN ('pending', 'approved', 'rejected', 'completed', 'cancelled')),

  CONSTRAINT turath_masr_order_adjustments_reason_nonempty
    CHECK (length(btrim(reason)) > 0),

  CONSTRAINT turath_masr_order_adjustments_refund_mode_check
    CHECK (refund_mode IN ('full', 'partial', 'none', 'price_diff')),

  CONSTRAINT turath_masr_order_adjustments_shipping_payer_check
    CHECK (shipping_payer IN ('customer', 'company', 'split')),

  CONSTRAINT turath_masr_order_adjustments_amounts_nonneg
    CHECK (
      refund_amount >= 0
      AND shipping_customer_amount >= 0
      AND shipping_company_amount >= 0
      AND original_total >= 0
    ),

  -- Split shipping must have at least one side > 0
  CONSTRAINT turath_masr_order_adjustments_split_balanced
    CHECK (
      shipping_payer <> 'split'
      OR (shipping_customer_amount > 0 AND shipping_company_amount > 0)
    )
);

COMMENT ON TABLE public.turath_masr_order_adjustments IS
  'Phase 25A — Returns & exchanges raised after an order is delivered. '
  'Does not mutate the original order row; lives as a sibling record.';


-- =============================================================================
-- 2) Indexes
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_tm_order_adjustments_order_id
  ON public.turath_masr_order_adjustments (order_id);

CREATE INDEX IF NOT EXISTS idx_tm_order_adjustments_order_num
  ON public.turath_masr_order_adjustments (order_num);

CREATE INDEX IF NOT EXISTS idx_tm_order_adjustments_state
  ON public.turath_masr_order_adjustments (state);

CREATE INDEX IF NOT EXISTS idx_tm_order_adjustments_created_at_desc
  ON public.turath_masr_order_adjustments (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tm_order_adjustments_kind
  ON public.turath_masr_order_adjustments (kind);


-- =============================================================================
-- 3) updated_at trigger
-- =============================================================================
CREATE OR REPLACE FUNCTION public.turath_masr_order_adjustments_touch()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tm_order_adjustments_touch
  ON public.turath_masr_order_adjustments;

CREATE TRIGGER tm_order_adjustments_touch
  BEFORE UPDATE ON public.turath_masr_order_adjustments
  FOR EACH ROW
  EXECUTE FUNCTION public.turath_masr_order_adjustments_touch();


-- =============================================================================
-- 4) RLS
--
-- Read:    any authenticated internal user (admins, managers, shipping ops,
--          delegates, CRM agents/managers). This stays internal — the
--          customer-tracking surfaces never join this table.
--
-- Insert:  admin (r1), system supervisor (r2), CRM manager (r5),
--          CRM agent (r6). Shipping reps (r3/r4) cannot raise adjustments.
--
-- Update:  admin (r1) and system supervisor (r2) only. They drive the
--          approve / reject / complete / cancel state transitions.
--
-- Delete:  admin (r1) only — hard delete should be exceptional.
-- =============================================================================

ALTER TABLE public.turath_masr_order_adjustments ENABLE ROW LEVEL SECURITY;

-- SELECT — all internal authenticated users (no anon).
DROP POLICY IF EXISTS tm_order_adjustments_authenticated_select
  ON public.turath_masr_order_adjustments;
CREATE POLICY tm_order_adjustments_authenticated_select
  ON public.turath_masr_order_adjustments
  FOR SELECT
  TO authenticated
  USING (true);

-- INSERT — admin, system supervisor, CRM manager, CRM agent
DROP POLICY IF EXISTS tm_order_adjustments_crm_insert
  ON public.turath_masr_order_adjustments;
CREATE POLICY tm_order_adjustments_crm_insert
  ON public.turath_masr_order_adjustments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.get_current_user_role_id() = ANY (ARRAY['r1','r2','r5','r6'])
  );

-- UPDATE — admin or system supervisor (managers approve/reject/complete)
DROP POLICY IF EXISTS tm_order_adjustments_manager_update
  ON public.turath_masr_order_adjustments;
CREATE POLICY tm_order_adjustments_manager_update
  ON public.turath_masr_order_adjustments
  FOR UPDATE
  TO authenticated
  USING (
    public.get_current_user_role_id() = ANY (ARRAY['r1','r2'])
  )
  WITH CHECK (
    public.get_current_user_role_id() = ANY (ARRAY['r1','r2'])
  );

-- DELETE — admin only
DROP POLICY IF EXISTS tm_order_adjustments_admin_delete
  ON public.turath_masr_order_adjustments;
CREATE POLICY tm_order_adjustments_admin_delete
  ON public.turath_masr_order_adjustments
  FOR DELETE
  TO authenticated
  USING (public.is_admin());


-- =============================================================================
-- POST-MIGRATION VERIFICATION
--
--   -- Table + checks
--   SELECT con.conname, pg_get_constraintdef(con.oid)
--     FROM pg_constraint con
--     JOIN pg_class cls ON cls.oid = con.conrelid
--     JOIN pg_namespace ns ON ns.oid = cls.relnamespace
--    WHERE ns.nspname='public'
--      AND cls.relname='turath_masr_order_adjustments'
--    ORDER BY con.conname;
--
--   -- Policies
--   SELECT policyname, cmd, qual, with_check
--     FROM pg_policies
--    WHERE schemaname='public'
--      AND tablename='turath_masr_order_adjustments'
--    ORDER BY policyname;
--
--   -- Indexes
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname='public'
--      AND tablename='turath_masr_order_adjustments'
--    ORDER BY indexname;
-- =============================================================================
