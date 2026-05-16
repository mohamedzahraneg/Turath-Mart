-- ─────────────────────────────────────────────────────────────────────────────
-- 20260516220000_inventory_stock_counts.sql
--
-- Phase Inventory-Stock-Count-1 — physical stock count workflow.
--
-- Operators periodically count what's physically on the shelves and need
-- a way to reconcile the discrepancy against `turath_masr_inventory.available`.
-- Phase Inventory-Movement-Ledger-1 already supports `stock_count_adjustment`
-- as a movement type, and Phase Inventory-Movement-Ledger-1's
-- `inventory_apply_movement` RPC already accepts that type — but that
-- RPC asks for a `quantity_delta`, not a "counted quantity", and it
-- doesn't record the count event as a first-class business object.
--
-- This migration adds:
--
--   1. New table `turath_masr_inventory_stock_counts` — one row per
--      physical count event. Captures the counted quantity, the system
--      `available` at the moment of the count, the resulting delta, the
--      operator-supplied reason / note, and (when delta ≠ 0) a link to
--      the movement row that was written to reconcile.
--
--   2. New SECURITY DEFINER RPC `inventory_record_stock_count` that:
--        • locks the inventory row,
--        • computes `delta = counted - available`,
--        • when delta ≠ 0: writes one `stock_count_adjustment` movement
--          + updates `available` (under the same row-lock),
--        • when delta = 0: still records the no-op count (movement_id NULL),
--        • always inserts the stock_count row,
--        • returns a summary jsonb.
--
-- What this migration does NOT do:
--   • No backfill of historical counts.
--   • No change to `inventory_apply_movement` — it stays available for
--     ad-hoc manual adjustments.
--   • No changes to order / return / exchange / delivery flows.
--   • No changes to RLS on `turath_masr_inventory` or
--     `turath_masr_inventory_movements`.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. turath_masr_inventory_stock_counts ──────────────────────────────────

CREATE TABLE IF NOT EXISTS public.turath_masr_inventory_stock_counts (
  id                       uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id             uuid         NOT NULL REFERENCES public.turath_masr_inventory(id) ON DELETE RESTRICT,
  counted_quantity         integer      NOT NULL CHECK (counted_quantity >= 0),
  system_available_before  integer      NOT NULL CHECK (system_available_before >= 0),
  quantity_delta           integer      NOT NULL,
  reason                   text         NOT NULL CHECK (length(btrim(reason)) > 0),
  note                     text,
  movement_id              uuid         REFERENCES public.turath_masr_inventory_movements(id) ON DELETE RESTRICT,
  counted_by               uuid         REFERENCES auth.users(id),
  counted_by_name          text,
  counted_at               timestamptz  NOT NULL DEFAULT now(),
  metadata                 jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz  NOT NULL DEFAULT now()
);

-- Per-product timeline of counts (most-recent-first) + global timeline.
CREATE INDEX IF NOT EXISTS idx_inventory_stock_counts_inventory_id_counted_at
  ON public.turath_masr_inventory_stock_counts(inventory_id, counted_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_stock_counts_counted_at
  ON public.turath_masr_inventory_stock_counts(counted_at DESC);

-- Reinforce the relationship: delta must equal counted - system_before.
-- The RPC enforces this in code, but a constraint guards against any
-- alternative insert path (e.g. a direct SQL insert by a service-role
-- script). Wrapped in DO block so the migration is idempotent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'turath_masr_inventory_stock_counts_delta_consistency'
      AND conrelid = 'public.turath_masr_inventory_stock_counts'::regclass
  ) THEN
    ALTER TABLE public.turath_masr_inventory_stock_counts
      ADD CONSTRAINT turath_masr_inventory_stock_counts_delta_consistency
      CHECK (quantity_delta = counted_quantity - system_available_before);
  END IF;
END $$;

-- ─── 2. RLS ─────────────────────────────────────────────────────────────────

ALTER TABLE public.turath_masr_inventory_stock_counts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='turath_masr_inventory_stock_counts'
      AND policyname='inventory_stock_counts_authenticated_select'
  ) THEN
    CREATE POLICY inventory_stock_counts_authenticated_select
      ON public.turath_masr_inventory_stock_counts
      FOR SELECT TO authenticated
      USING (auth.role() = 'authenticated');
  END IF;

  -- INSERT only via the SECURITY DEFINER RPC below.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='turath_masr_inventory_stock_counts'
      AND policyname='inventory_stock_counts_manager_insert'
  ) THEN
    CREATE POLICY inventory_stock_counts_manager_insert
      ON public.turath_masr_inventory_stock_counts
      FOR INSERT TO authenticated
      WITH CHECK (public.is_manager_or_above());
  END IF;
  -- No UPDATE / DELETE — counts are append-only.
END $$;

-- ─── 3. inventory_record_stock_count RPC ────────────────────────────────────
--
-- Single entry point for the physical-count workflow. Always writes a
-- stock_count row; writes a movement row + bumps `available` when the
-- counted quantity differs from the current system `available`. The two
-- writes happen under a single transaction with `FOR UPDATE` on the
-- inventory row so concurrent counts on the same product can't race.
--
-- Idempotency: this RPC is NOT idempotent in the way the reservation
-- RPCs are. Each call recording a count is treated as a new business
-- event — the operator scanned the shelves, this is what they saw. The
-- table records every count attempt for an audit-friendly history.
-- Re-running the same RPC with the same args produces a second row
-- (the second count happens to agree with the first one).

CREATE OR REPLACE FUNCTION public.inventory_record_stock_count(
  p_inventory_id     uuid,
  p_counted_quantity integer,
  p_reason           text,
  p_note             text   DEFAULT NULL,
  p_counted_by_name  text   DEFAULT NULL,
  p_metadata         jsonb  DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller            uuid    := auth.uid();
  v_inventory_status  text;
  v_qty_before        integer;
  v_qty_after         integer;
  v_delta             integer;
  v_movement_id       uuid;
  v_stock_count_id    uuid;
  v_clean_reason      text    := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_clean_note        text    := NULLIF(trim(COALESCE(p_note, '')), '');
  v_clean_actor_name  text    := NULLIF(trim(COALESCE(p_counted_by_name, '')), '');
  v_extra_metadata    jsonb   := COALESCE(p_metadata, '{}'::jsonb);
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'inventory_record_stock_count: not authenticated';
  END IF;
  IF NOT public.is_manager_or_above() THEN
    RAISE EXCEPTION 'inventory_record_stock_count: insufficient permissions';
  END IF;
  IF p_inventory_id IS NULL THEN
    RAISE EXCEPTION 'inventory_record_stock_count: inventory_id is required';
  END IF;
  IF p_counted_quantity IS NULL OR p_counted_quantity < 0 THEN
    RAISE EXCEPTION 'inventory_record_stock_count: counted_quantity must be >= 0';
  END IF;
  IF v_clean_reason IS NULL THEN
    RAISE EXCEPTION 'inventory_record_stock_count: reason is required';
  END IF;

  -- Lock the inventory row and read current state.
  SELECT status, COALESCE(available, 0)
    INTO v_inventory_status, v_qty_before
  FROM public.turath_masr_inventory
  WHERE id = p_inventory_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventory_record_stock_count: inventory % not found', p_inventory_id;
  END IF;
  -- Phase rule: refuse counts against archived products. Archived rows
  -- shouldn't be physically on the shelves; if they are, unarchive first.
  IF v_inventory_status = 'archived' THEN
    RAISE EXCEPTION
      'inventory_record_stock_count: cannot record count against archived inventory %',
      p_inventory_id;
  END IF;

  v_qty_after := p_counted_quantity;
  v_delta     := v_qty_after - v_qty_before;

  -- When the count agrees with the system, no movement is written —
  -- the immutable ledger stays clean. The stock_count row still
  -- records that the operator confirmed the system value.
  IF v_delta <> 0 THEN
    INSERT INTO public.turath_masr_inventory_movements (
      inventory_id, movement_type, quantity_delta,
      quantity_before, quantity_after,
      reason, reference_type, reference_id,
      created_by, created_by_name, created_at,
      metadata
    ) VALUES (
      p_inventory_id, 'stock_count_adjustment', v_delta,
      v_qty_before, v_qty_after,
      v_clean_reason, 'stock_count', NULL,
      v_caller, v_clean_actor_name, now(),
      v_extra_metadata || jsonb_build_object(
        'source',                 'stock_count_workflow',
        'system_available_before', v_qty_before,
        'counted_quantity',        v_qty_after
      )
    )
    RETURNING id INTO v_movement_id;

    UPDATE public.turath_masr_inventory
    SET available = v_qty_after
    WHERE id = p_inventory_id;
  END IF;

  -- Always record the count event (whether or not a movement was
  -- written). The stock_count_id is the canonical handle the UI uses
  -- to render the count history.
  INSERT INTO public.turath_masr_inventory_stock_counts (
    inventory_id, counted_quantity, system_available_before, quantity_delta,
    reason, note, movement_id,
    counted_by, counted_by_name, counted_at,
    metadata
  ) VALUES (
    p_inventory_id, v_qty_after, v_qty_before, v_delta,
    v_clean_reason, v_clean_note, v_movement_id,
    v_caller, v_clean_actor_name, now(),
    v_extra_metadata
  )
  RETURNING id INTO v_stock_count_id;

  -- After a successful update, link the stock_count_id back into the
  -- movement's metadata so a movement-only viewer can drill into the
  -- originating count event. Best-effort: skipped silently when no
  -- movement was written (delta = 0).
  IF v_movement_id IS NOT NULL THEN
    UPDATE public.turath_masr_inventory_movements
    SET metadata = metadata || jsonb_build_object('stock_count_id', v_stock_count_id)
    WHERE id = v_movement_id;
  END IF;

  RETURN jsonb_build_object(
    'stock_count_id', v_stock_count_id,
    'movement_id',    v_movement_id,
    'quantity_delta', v_delta,
    'quantity_before', v_qty_before,
    'new_available',  v_qty_after
  );
END;
$$;

REVOKE ALL ON FUNCTION public.inventory_record_stock_count(uuid, integer, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inventory_record_stock_count(uuid, integer, text, text, text, jsonb) TO authenticated;
