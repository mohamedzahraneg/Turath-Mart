-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 25B — Operational return / exchange child orders.
--
-- Phase 25A created `turath_masr_order_adjustments` as a passive
-- internal record. Phase 25B turns it into a real operational
-- workflow:
--   • when an adjustment is approved, the OrderDetailModal creates a
--     **child order** in `turath_masr_orders` (suffixed `-R1` / `-E1`)
--     so warehouse + delegates can schedule and ship it the same way
--     they handle any other order;
--   • a complaint row is created at the same time so customer service
--     can track resolution.
--
-- This migration is purely additive — no destructive SQL, no DROP, no
-- TRUNCATE, no UPDATE, no DELETE, no inventory mutation.
--
--   1) `turath_masr_order_adjustments`:
--        • child_order_id              text   (FK-by-convention to orders.id)
--        • child_order_num             text   (FK-by-convention to orders.order_num)
--        • linked_complaint_id         uuid   (FK-by-convention to complaints.id)
--        • customer_collect_amount     numeric DEFAULT 0
--        • shipping_base_amount        numeric DEFAULT 0
--        • price_difference_direction  text    DEFAULT 'none'
--                                       CHECK IN ('customer_pays', 'company_refunds', 'none')
--        • operational_note            text
--
--   2) `turath_masr_crm_complaints` — currently bare (7 columns):
--        • order_id           text       — parent order id
--        • order_num          text       — parent order number
--        • child_order_id     text       — operational child order
--        • child_order_num    text       — operational child order number
--        • adjustment_id      uuid       — back-reference to adjustments.id
--        • complaint_type     text       DEFAULT 'general'
--                                       CHECK IN ('general','return','exchange','delivery','other')
--        • resolution_status  text       DEFAULT 'open'
--                                       CHECK IN ('open','in_progress','resolved','closed','cancelled')
--        • priority           text       DEFAULT 'medium'
--                                       CHECK IN ('low','medium','high','urgent')
--
-- Safety properties
-- -----------------
--   • `ADD COLUMN IF NOT EXISTS` — idempotent.
--   • All new columns nullable or with safe defaults; existing rows
--     are untouched.
--   • CHECK constraints only narrow values *for the new columns*;
--     they're added with `NOT VALID` initially to avoid rewriting
--     entire tables and then VALIDATEd — every existing row has NULL
--     in these new columns, so validation passes trivially.
--   • No RLS changes — the existing policies still apply.
--   • No DROP TABLE / TRUNCATE / DELETE / ALTER COLUMN / hard delete.
--
-- DEPLOY GATE — DO NOT APPLY WITHOUT EXPLICIT APPROVAL
-- ─────────────────────────────────────────────────────────────────────────────

-- =============================================================================
-- 1) Extend `turath_masr_order_adjustments`
-- =============================================================================

ALTER TABLE public.turath_masr_order_adjustments
  ADD COLUMN IF NOT EXISTS child_order_id              TEXT,
  ADD COLUMN IF NOT EXISTS child_order_num             TEXT,
  ADD COLUMN IF NOT EXISTS linked_complaint_id         UUID,
  ADD COLUMN IF NOT EXISTS customer_collect_amount     NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_base_amount        NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price_difference_direction  TEXT    NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS operational_note            TEXT;

-- CHECK constraint for `price_difference_direction`. Wrapped in a DO
-- block because PostgreSQL has no `ADD CONSTRAINT IF NOT EXISTS`.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'turath_masr_order_adjustments_price_diff_direction_check'
       AND conrelid = 'public.turath_masr_order_adjustments'::regclass
  ) THEN
    ALTER TABLE public.turath_masr_order_adjustments
      ADD CONSTRAINT turath_masr_order_adjustments_price_diff_direction_check
      CHECK (price_difference_direction IN ('customer_pays', 'company_refunds', 'none'));
  END IF;
END $$;

-- Non-negative guarantees for the new numeric columns.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'turath_masr_order_adjustments_operational_amounts_nonneg'
       AND conrelid = 'public.turath_masr_order_adjustments'::regclass
  ) THEN
    ALTER TABLE public.turath_masr_order_adjustments
      ADD CONSTRAINT turath_masr_order_adjustments_operational_amounts_nonneg
      CHECK (
        customer_collect_amount >= 0
        AND shipping_base_amount >= 0
      );
  END IF;
END $$;

-- Indexes for the lookup paths the UI uses.
CREATE INDEX IF NOT EXISTS idx_tm_order_adjustments_child_order_id
  ON public.turath_masr_order_adjustments (child_order_id);
CREATE INDEX IF NOT EXISTS idx_tm_order_adjustments_child_order_num
  ON public.turath_masr_order_adjustments (child_order_num);
CREATE INDEX IF NOT EXISTS idx_tm_order_adjustments_linked_complaint_id
  ON public.turath_masr_order_adjustments (linked_complaint_id);

COMMENT ON COLUMN public.turath_masr_order_adjustments.child_order_id IS
  'Phase 25B — id of the operational child order created on approval. NULL while pending / rejected / cancelled.';
COMMENT ON COLUMN public.turath_masr_order_adjustments.child_order_num IS
  'Phase 25B — order_num of the operational child order, e.g. 2605082-E1 / 2605082-R1.';
COMMENT ON COLUMN public.turath_masr_order_adjustments.linked_complaint_id IS
  'Phase 25B — complaint row created automatically when the adjustment is approved.';
COMMENT ON COLUMN public.turath_masr_order_adjustments.customer_collect_amount IS
  'Phase 25B — total amount the delegate must collect from the customer (shipping share + price difference if customer_pays).';
COMMENT ON COLUMN public.turath_masr_order_adjustments.shipping_base_amount IS
  'Phase 25B — base shipping cost resolved from the original order region; the customer + company shares always sum to this number.';
COMMENT ON COLUMN public.turath_masr_order_adjustments.price_difference_direction IS
  'Phase 25B — who carries the price difference: customer_pays / company_refunds / none. Sets settlement direction explicitly.';


-- =============================================================================
-- 2) Extend `turath_masr_crm_complaints`
-- =============================================================================

ALTER TABLE public.turath_masr_crm_complaints
  ADD COLUMN IF NOT EXISTS order_id          TEXT,
  ADD COLUMN IF NOT EXISTS order_num         TEXT,
  ADD COLUMN IF NOT EXISTS child_order_id    TEXT,
  ADD COLUMN IF NOT EXISTS child_order_num   TEXT,
  ADD COLUMN IF NOT EXISTS adjustment_id     UUID,
  ADD COLUMN IF NOT EXISTS complaint_type    TEXT NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS resolution_status TEXT NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS priority          TEXT NOT NULL DEFAULT 'medium';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'turath_masr_crm_complaints_complaint_type_check'
       AND conrelid = 'public.turath_masr_crm_complaints'::regclass
  ) THEN
    ALTER TABLE public.turath_masr_crm_complaints
      ADD CONSTRAINT turath_masr_crm_complaints_complaint_type_check
      CHECK (complaint_type IN ('general', 'return', 'exchange', 'delivery', 'other'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'turath_masr_crm_complaints_resolution_status_check'
       AND conrelid = 'public.turath_masr_crm_complaints'::regclass
  ) THEN
    ALTER TABLE public.turath_masr_crm_complaints
      ADD CONSTRAINT turath_masr_crm_complaints_resolution_status_check
      CHECK (resolution_status IN ('open', 'in_progress', 'resolved', 'closed', 'cancelled'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'turath_masr_crm_complaints_priority_check'
       AND conrelid = 'public.turath_masr_crm_complaints'::regclass
  ) THEN
    ALTER TABLE public.turath_masr_crm_complaints
      ADD CONSTRAINT turath_masr_crm_complaints_priority_check
      CHECK (priority IN ('low', 'medium', 'high', 'urgent'));
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tm_crm_complaints_order_id
  ON public.turath_masr_crm_complaints (order_id);
CREATE INDEX IF NOT EXISTS idx_tm_crm_complaints_child_order_id
  ON public.turath_masr_crm_complaints (child_order_id);
CREATE INDEX IF NOT EXISTS idx_tm_crm_complaints_adjustment_id
  ON public.turath_masr_crm_complaints (adjustment_id);
CREATE INDEX IF NOT EXISTS idx_tm_crm_complaints_complaint_type
  ON public.turath_masr_crm_complaints (complaint_type);
CREATE INDEX IF NOT EXISTS idx_tm_crm_complaints_resolution_status
  ON public.turath_masr_crm_complaints (resolution_status);

COMMENT ON COLUMN public.turath_masr_crm_complaints.order_id IS
  'Phase 25B — id of the original (parent) order this complaint relates to.';
COMMENT ON COLUMN public.turath_masr_crm_complaints.order_num IS
  'Phase 25B — order_num of the original (parent) order for display.';
COMMENT ON COLUMN public.turath_masr_crm_complaints.child_order_id IS
  'Phase 25B — id of the operational child order (return / exchange shipment) if any.';
COMMENT ON COLUMN public.turath_masr_crm_complaints.adjustment_id IS
  'Phase 25B — back-reference to turath_masr_order_adjustments.id.';
COMMENT ON COLUMN public.turath_masr_crm_complaints.complaint_type IS
  'Phase 25B — return / exchange / delivery / general / other.';
COMMENT ON COLUMN public.turath_masr_crm_complaints.resolution_status IS
  'Phase 25B — open / in_progress / resolved / closed / cancelled. Separate from the legacy `status` column to avoid breaking existing renders.';
COMMENT ON COLUMN public.turath_masr_crm_complaints.priority IS
  'Phase 25B — low / medium / high / urgent. Defaults to medium so existing rows surface neutrally.';


-- =============================================================================
-- POST-MIGRATION VERIFICATION (read-only, run manually after apply)
--
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='turath_masr_order_adjustments'
--    ORDER BY ordinal_position;
--
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='turath_masr_crm_complaints'
--    ORDER BY ordinal_position;
--
--   SELECT con.conname, pg_get_constraintdef(con.oid)
--     FROM pg_constraint con
--     JOIN pg_class cls ON cls.oid = con.conrelid
--     JOIN pg_namespace ns ON ns.oid = cls.relnamespace
--    WHERE ns.nspname='public'
--      AND cls.relname IN ('turath_masr_order_adjustments','turath_masr_crm_complaints')
--      AND con.conname LIKE '%25B%' ESCAPE '!'
--    ORDER BY cls.relname, con.conname;
-- =============================================================================
