-- ─────────────────────────────────────────────────────────────────────────────
-- 20260516120000_inventory_movement_ledger.sql
--
-- Phase Inventory-Movement-Ledger-1 — additive migration:
--
--   1. New immutable table `turath_masr_inventory_movements`. Every
--      change to a product's `available` count writes one row here.
--   2. CHECK constraint pinning `movement_type` to a canonical set
--      and enforcing simple delta rules. Wrapped in DO blocks so
--      re-running the migration is safe.
--   3. Four indexes covering the common access paths (per-product
--      timeline, global timeline, type filter, order_num lookup).
--   4. RLS on the new table: authenticated SELECT, manager INSERT
--      (via RPC); no UPDATE, no DELETE → immutable ledger.
--   5. Update of the existing `public.inventory_record_addition` RPC
--      so it ALSO writes a movement row alongside the addition row,
--      with accurate quantity_before / quantity_after computed under
--      the same row-lock. Return signature gains `movement_id` —
--      existing callers that destructure only `addition_id` /
--      `new_available` keep working unchanged.
--   6. New `public.inventory_apply_movement` RPC for manual movements
--      (manual_in / manual_out / damage_out / return_in / stock_count_
--      adjustment / correction / price_change). Locks the row, blocks
--      archived products, prevents negative `available`, and writes
--      one movement row.
--   7. Best-effort backfill: for every existing row in
--      `turath_masr_inventory_additions` that doesn't already have a
--      matching `addition` movement (joined by metadata.addition_id),
--      insert a historical movement row with metadata.source =
--      `'backfill_from_additions'`. Backfill DOES NOT touch
--      `available` — it only writes ledger history.
--
-- DO NOT touch order tables, AddOrderModal-facing data, or
-- returns/exchanges in this migration.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Movements table ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.turath_masr_inventory_movements (
  id                   uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id         uuid         NOT NULL REFERENCES public.turath_masr_inventory(id) ON DELETE RESTRICT,
  movement_type        text         NOT NULL,
  quantity_delta       integer      NOT NULL,
  quantity_before      integer      NOT NULL,
  quantity_after       integer      NOT NULL,
  reason               text,
  reference_type       text,
  reference_id         uuid,
  order_num            text,
  supplier_invoice_num text,
  unit_cost            numeric(12,2),
  total_cost           numeric(12,2),
  created_by           uuid         REFERENCES auth.users(id),
  created_by_name      text,
  created_at           timestamptz  NOT NULL DEFAULT now(),
  metadata             jsonb        NOT NULL DEFAULT '{}'::jsonb
);

-- ─── 2. CHECK constraints (idempotent) ──────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'turath_masr_inventory_movements_type_check'
      AND conrelid = 'public.turath_masr_inventory_movements'::regclass
  ) THEN
    ALTER TABLE public.turath_masr_inventory_movements
      ADD CONSTRAINT turath_masr_inventory_movements_type_check
      CHECK (movement_type IN (
        'addition',
        'manual_in',
        'manual_out',
        'damage_out',
        'return_in',
        'exchange_in',
        'exchange_out',
        'stock_count_adjustment',
        'price_change',
        'correction'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'turath_masr_inventory_movements_after_nonneg'
      AND conrelid = 'public.turath_masr_inventory_movements'::regclass
  ) THEN
    ALTER TABLE public.turath_masr_inventory_movements
      ADD CONSTRAINT turath_masr_inventory_movements_after_nonneg
      CHECK (quantity_after >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'turath_masr_inventory_movements_delta_consistency'
      AND conrelid = 'public.turath_masr_inventory_movements'::regclass
  ) THEN
    ALTER TABLE public.turath_masr_inventory_movements
      ADD CONSTRAINT turath_masr_inventory_movements_delta_consistency
      CHECK (quantity_after = quantity_before + quantity_delta);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'turath_masr_inventory_movements_delta_nonzero'
      AND conrelid = 'public.turath_masr_inventory_movements'::regclass
  ) THEN
    ALTER TABLE public.turath_masr_inventory_movements
      ADD CONSTRAINT turath_masr_inventory_movements_delta_nonzero
      CHECK (quantity_delta <> 0 OR movement_type = 'price_change');
  END IF;
END $$;

-- ─── 3. Indexes ─────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_inventory_movements_inventory_id_created_at
  ON public.turath_masr_inventory_movements(inventory_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_created_at
  ON public.turath_masr_inventory_movements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_type
  ON public.turath_masr_inventory_movements(movement_type);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_order_num
  ON public.turath_masr_inventory_movements(order_num);

-- ─── 4. RLS on movements ────────────────────────────────────────────────────

ALTER TABLE public.turath_masr_inventory_movements ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='turath_masr_inventory_movements'
      AND policyname='inventory_movements_authenticated_select'
  ) THEN
    CREATE POLICY inventory_movements_authenticated_select
      ON public.turath_masr_inventory_movements
      FOR SELECT TO authenticated
      USING (auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='turath_masr_inventory_movements'
      AND policyname='inventory_movements_manager_insert'
  ) THEN
    CREATE POLICY inventory_movements_manager_insert
      ON public.turath_masr_inventory_movements
      FOR INSERT TO authenticated
      WITH CHECK (public.is_manager_or_above());
  END IF;
  -- No UPDATE / DELETE policies — the ledger is immutable.
END $$;

-- ─── 5. Backfill historical additions into movements ────────────────────────
--
-- For every existing addition row that doesn't already have a matching
-- movement (joined by metadata.addition_id), insert a historical
-- movement row. `quantity_before` is best-effort: we accumulate the
-- per-product additions in chronological order so the ledger reads
-- monotonically even if the absolute baseline isn't known. The total
-- of accumulated `quantity_after` for each product will not exceed
-- the current `available` (it equals SUM(quantity)), so the
-- non-negative CHECK constraint is always satisfied.
--
-- Backfill DOES NOT modify `turath_masr_inventory.available`.

INSERT INTO public.turath_masr_inventory_movements (
  inventory_id,
  movement_type,
  quantity_delta,
  quantity_before,
  quantity_after,
  unit_cost,
  total_cost,
  supplier_invoice_num,
  created_by,
  created_by_name,
  created_at,
  metadata
)
SELECT
  a.inventory_id,
  'addition' AS movement_type,
  a.quantity AS quantity_delta,
  COALESCE(prev_total, 0) AS quantity_before,
  COALESCE(prev_total, 0) + a.quantity AS quantity_after,
  a.unit_cost,
  a.total_cost,
  a.supplier_invoice_num,
  a.created_by,
  a.created_by_name,
  a.received_at,
  jsonb_build_object(
    'source', 'backfill_from_additions',
    'addition_id', a.id
  )
FROM (
  SELECT
    a.*,
    SUM(a.quantity) OVER (
      PARTITION BY a.inventory_id
      ORDER BY a.received_at ASC, a.created_at ASC
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    ) AS prev_total
  FROM public.turath_masr_inventory_additions a
) a
WHERE NOT EXISTS (
  SELECT 1
  FROM public.turath_masr_inventory_movements m
  WHERE m.movement_type = 'addition'
    AND m.metadata ->> 'addition_id' = a.id::text
);

-- ─── 6. Updated `inventory_record_addition` ─────────────────────────────────
--
-- The function now writes BOTH an additions row and a movements row in
-- the same locked transaction. Return signature gains `movement_id`;
-- existing callers that only destructure `addition_id` / `new_available`
-- continue to work unchanged.

CREATE OR REPLACE FUNCTION public.inventory_record_addition(
  p_inventory_id         uuid,
  p_quantity             integer,
  p_unit_cost            numeric     DEFAULT NULL,
  p_supplier_id          uuid        DEFAULT NULL,
  p_supplier_name        text        DEFAULT NULL,
  p_supplier_invoice_num text        DEFAULT NULL,
  p_received_at          timestamptz DEFAULT NULL,
  p_note                 text        DEFAULT NULL,
  p_created_by_name      text        DEFAULT NULL
)
RETURNS TABLE(addition_id uuid, movement_id uuid, new_available integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller               uuid := auth.uid();
  v_addition_id          uuid;
  v_movement_id          uuid;
  v_resolved_supplier_id uuid := p_supplier_id;
  v_qty_before           integer;
  v_qty_after            integer;
  v_inventory_status     text;
  v_total_cost           numeric(12,2) := NULL;
  v_supplier_name        text := NULLIF(trim(COALESCE(p_supplier_name, '')), '');
  v_supplier_invoice     text := NULLIF(trim(COALESCE(p_supplier_invoice_num, '')), '');
  v_received_at          timestamptz := COALESCE(p_received_at, now());
  v_clean_name           text := NULLIF(trim(COALESCE(p_created_by_name, '')), '');
  v_clean_note           text := NULLIF(trim(COALESCE(p_note, '')), '');
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'inventory_record_addition: not authenticated';
  END IF;
  IF NOT public.is_manager_or_above() THEN
    RAISE EXCEPTION 'inventory_record_addition: insufficient permissions';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'inventory_record_addition: quantity must be > 0';
  END IF;
  IF p_inventory_id IS NULL THEN
    RAISE EXCEPTION 'inventory_record_addition: inventory_id is required';
  END IF;

  SELECT status, COALESCE(available, 0)
    INTO v_inventory_status, v_qty_before
  FROM public.turath_masr_inventory
  WHERE id = p_inventory_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventory_record_addition: inventory % not found', p_inventory_id;
  END IF;
  IF v_inventory_status = 'archived' THEN
    RAISE EXCEPTION 'inventory_record_addition: cannot add stock to an archived product';
  END IF;

  IF v_resolved_supplier_id IS NULL AND v_supplier_name IS NOT NULL THEN
    INSERT INTO public.turath_masr_inventory_suppliers (name)
    VALUES (v_supplier_name)
    ON CONFLICT (name) DO UPDATE
      SET is_active = true
    RETURNING id INTO v_resolved_supplier_id;
  END IF;

  IF p_unit_cost IS NOT NULL THEN
    v_total_cost := round(p_unit_cost * p_quantity, 2);
  END IF;

  v_qty_after := v_qty_before + p_quantity;

  -- 1. Additions row
  INSERT INTO public.turath_masr_inventory_additions (
    inventory_id, quantity, unit_cost, total_cost,
    supplier_id, supplier_name, supplier_invoice_num,
    received_at, created_by, created_by_name, note
  ) VALUES (
    p_inventory_id, p_quantity, p_unit_cost, v_total_cost,
    v_resolved_supplier_id, v_supplier_name, v_supplier_invoice,
    v_received_at, v_caller, v_clean_name, v_clean_note
  )
  RETURNING id INTO v_addition_id;

  -- 2. Movement row mirroring the addition.
  INSERT INTO public.turath_masr_inventory_movements (
    inventory_id, movement_type, quantity_delta,
    quantity_before, quantity_after,
    unit_cost, total_cost, supplier_invoice_num,
    created_by, created_by_name, created_at,
    metadata
  ) VALUES (
    p_inventory_id, 'addition', p_quantity,
    v_qty_before, v_qty_after,
    p_unit_cost, v_total_cost, v_supplier_invoice,
    v_caller, v_clean_name, v_received_at,
    jsonb_build_object('addition_id', v_addition_id)
  )
  RETURNING id INTO v_movement_id;

  -- 3. Bump inventory aggregates.
  UPDATE public.turath_masr_inventory
  SET
    available     = v_qty_after,
    cost_price    = COALESCE(p_unit_cost, cost_price),
    last_added_at = v_received_at,
    last_added_by = v_caller
  WHERE id = p_inventory_id;

  RETURN QUERY SELECT v_addition_id, v_movement_id, v_qty_after;
END;
$$;

REVOKE ALL ON FUNCTION public.inventory_record_addition(
  uuid, integer, numeric, uuid, text, text, timestamptz, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inventory_record_addition(
  uuid, integer, numeric, uuid, text, text, timestamptz, text, text
) TO authenticated;

-- ─── 7. New `inventory_apply_movement` RPC ──────────────────────────────────
--
-- Used by the manual movement modal. Accepts inbound + outbound + zero
-- (price_change) deltas, enforces non-negative `available`, locks the
-- inventory row, refuses on archived. `price_change` rewrites
-- `cost_price` rather than `available`.

CREATE OR REPLACE FUNCTION public.inventory_apply_movement(
  p_inventory_id         uuid,
  p_movement_type        text,
  p_quantity_delta       integer,
  p_reason               text        DEFAULT NULL,
  p_reference_type       text        DEFAULT NULL,
  p_reference_id         uuid        DEFAULT NULL,
  p_order_num            text        DEFAULT NULL,
  p_supplier_invoice_num text        DEFAULT NULL,
  p_unit_cost            numeric     DEFAULT NULL,
  p_created_by_name      text        DEFAULT NULL,
  p_metadata             jsonb       DEFAULT '{}'::jsonb
)
RETURNS TABLE(movement_id uuid, new_available integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller           uuid := auth.uid();
  v_movement_id      uuid;
  v_inventory_status text;
  v_qty_before       integer;
  v_qty_after        integer;
  v_clean_name       text := NULLIF(trim(COALESCE(p_created_by_name, '')), '');
  v_clean_reason     text := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_clean_order_num  text := NULLIF(trim(COALESCE(p_order_num, '')), '');
  v_clean_invoice    text := NULLIF(trim(COALESCE(p_supplier_invoice_num, '')), '');
  v_clean_ref_type   text := NULLIF(trim(COALESCE(p_reference_type, '')), '');
  v_total_cost       numeric(12,2);
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'inventory_apply_movement: not authenticated';
  END IF;
  IF NOT public.is_manager_or_above() THEN
    RAISE EXCEPTION 'inventory_apply_movement: insufficient permissions';
  END IF;
  IF p_inventory_id IS NULL THEN
    RAISE EXCEPTION 'inventory_apply_movement: inventory_id is required';
  END IF;
  IF p_movement_type IS NULL THEN
    RAISE EXCEPTION 'inventory_apply_movement: movement_type is required';
  END IF;
  IF p_movement_type NOT IN (
    'manual_in','manual_out','damage_out','return_in',
    'stock_count_adjustment','price_change','correction'
  ) THEN
    -- The DB CHECK has a wider set (includes addition/exchange_*) but
    -- this RPC intentionally exposes a narrower surface so order /
    -- exchange flows can't be triggered from the manual modal.
    RAISE EXCEPTION 'inventory_apply_movement: unsupported movement_type %', p_movement_type;
  END IF;

  IF p_quantity_delta IS NULL THEN
    RAISE EXCEPTION 'inventory_apply_movement: quantity_delta is required';
  END IF;
  IF p_movement_type = 'price_change' THEN
    IF p_quantity_delta <> 0 THEN
      RAISE EXCEPTION 'inventory_apply_movement: price_change requires quantity_delta = 0';
    END IF;
    IF p_unit_cost IS NULL THEN
      RAISE EXCEPTION 'inventory_apply_movement: price_change requires p_unit_cost';
    END IF;
  ELSIF p_quantity_delta = 0 THEN
    RAISE EXCEPTION 'inventory_apply_movement: quantity_delta cannot be zero for %', p_movement_type;
  END IF;

  -- Outbound movements MUST have negative delta; inbound MUST be positive.
  IF p_movement_type IN ('manual_out','damage_out','exchange_out') AND p_quantity_delta > 0 THEN
    RAISE EXCEPTION 'inventory_apply_movement: % requires negative quantity_delta', p_movement_type;
  END IF;
  IF p_movement_type IN ('manual_in','return_in','exchange_in') AND p_quantity_delta < 0 THEN
    RAISE EXCEPTION 'inventory_apply_movement: % requires positive quantity_delta', p_movement_type;
  END IF;

  SELECT status, COALESCE(available, 0)
    INTO v_inventory_status, v_qty_before
  FROM public.turath_masr_inventory
  WHERE id = p_inventory_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventory_apply_movement: inventory % not found', p_inventory_id;
  END IF;
  IF v_inventory_status = 'archived' THEN
    RAISE EXCEPTION 'inventory_apply_movement: cannot apply movement to an archived product';
  END IF;

  v_qty_after := v_qty_before + p_quantity_delta;
  IF v_qty_after < 0 THEN
    RAISE EXCEPTION 'inventory_apply_movement: resulting available (%) would be negative', v_qty_after;
  END IF;

  IF p_unit_cost IS NOT NULL AND p_quantity_delta <> 0 THEN
    v_total_cost := round(p_unit_cost * ABS(p_quantity_delta), 2);
  ELSE
    v_total_cost := NULL;
  END IF;

  -- Insert the immutable movement row.
  INSERT INTO public.turath_masr_inventory_movements (
    inventory_id, movement_type, quantity_delta,
    quantity_before, quantity_after,
    reason, reference_type, reference_id,
    order_num, supplier_invoice_num,
    unit_cost, total_cost,
    created_by, created_by_name, created_at,
    metadata
  ) VALUES (
    p_inventory_id, p_movement_type, p_quantity_delta,
    v_qty_before, v_qty_after,
    v_clean_reason, v_clean_ref_type, p_reference_id,
    v_clean_order_num, v_clean_invoice,
    p_unit_cost, v_total_cost,
    v_caller, v_clean_name, now(),
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_movement_id;

  -- Apply effects on the inventory row.
  IF p_movement_type = 'price_change' THEN
    UPDATE public.turath_masr_inventory
    SET cost_price = p_unit_cost
    WHERE id = p_inventory_id;
  ELSE
    UPDATE public.turath_masr_inventory
    SET available = v_qty_after
    WHERE id = p_inventory_id;
  END IF;

  RETURN QUERY SELECT v_movement_id, v_qty_after;
END;
$$;

REVOKE ALL ON FUNCTION public.inventory_apply_movement(
  uuid, text, integer, text, text, uuid, text, text, numeric, text, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inventory_apply_movement(
  uuid, text, integer, text, text, uuid, text, text, numeric, text, jsonb
) TO authenticated;
