-- ─────────────────────────────────────────────────────────────────────────────
-- 20260516260000_inventory_variants_operations.sql
--
-- Phase Inventory-Variants-1B1 — variant-level stock operations.
--
-- Phase Inventory-Variants-1A (20260516240000) shipped the variants
-- table + read-only drawer tab. This phase wires variant_id through
-- the existing reservation / movement / addition / stock-count
-- machinery so a future 1B2 / 1B3 UI can resolve a variant_id and
-- pass it through, without ANY changes to existing behaviour for
-- callers that don't supply one.
--
-- Two-tier strategy
--
--   1. ALTER existing operational tables to carry an optional
--      `variant_id uuid` column referencing the variants table.
--      ON DELETE SET NULL so archiving a variant never breaks a
--      historical row.
--
--   2. Rewrite the seven existing RPCs so that:
--        • when variant_id is supplied (per-call parameter for
--          single-product RPCs; per-line jsonb field for the
--          reserve / reconcile RPCs; per-row column for
--          release / fulfill) the variant is locked, its
--          available / reserved are mutated, the resulting
--          movement / reservation / addition / count row stores
--          BOTH inventory_id AND variant_id;
--        • when variant_id is null, behaviour is **byte-for-byte
--          identical** to the pre-1B1 RPC. Old client code that
--          never sets variant_id sees no change in production.
--
-- What this migration does NOT do
--   • No automatic split of `turath_masr_inventory.available /
--     reserved` across variants. The base product remains the
--     source of truth until operators set per-variant baselines
--     via the stock-count workflow (which now supports variant_id).
--   • No backfill of historical movement / reservation / addition
--     / stock-count rows with a variant_id — historical rows stay
--     untouched (and `variant_id` is NULL on those rows).
--   • No UI changes. AddOrder / EditOrder / OrderAdjustment / the
--     three inventory modals continue to behave exactly as today
--     because none of them pass a variant_id yet. UI wiring lands
--     in subsequent phases (Variants-1B2 = order flow, 1B3 =
--     returns/exchanges/inventory modals).
--   • No DELETE policies on the variants table (1A's RLS stays).
--   • No new audit action keys — existing keys gain `variant_id`
--     in their metadata payloads via the UI wiring phases, not
--     here.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── 1. Add nullable variant_id columns ─────────────────────────────────────
--
-- Each `ADD COLUMN IF NOT EXISTS` is idempotent. ON DELETE SET NULL
-- means archiving / deleting a variant in a future operator workflow
-- (1B2 / 1B3) never cascades into the historical ledger — the
-- movement / reservation simply loses its variant pointer and falls
-- back to the inventory_id reference, which is what 1A's "base
-- product is the source of truth" model already assumes.

ALTER TABLE public.turath_masr_inventory_reservations
  ADD COLUMN IF NOT EXISTS variant_id uuid
  REFERENCES public.turath_masr_inventory_variants(id) ON DELETE SET NULL;

ALTER TABLE public.turath_masr_inventory_movements
  ADD COLUMN IF NOT EXISTS variant_id uuid
  REFERENCES public.turath_masr_inventory_variants(id) ON DELETE SET NULL;

ALTER TABLE public.turath_masr_inventory_additions
  ADD COLUMN IF NOT EXISTS variant_id uuid
  REFERENCES public.turath_masr_inventory_variants(id) ON DELETE SET NULL;

ALTER TABLE public.turath_masr_inventory_stock_counts
  ADD COLUMN IF NOT EXISTS variant_id uuid
  REFERENCES public.turath_masr_inventory_variants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_reservations_variant_id
  ON public.turath_masr_inventory_reservations(variant_id)
  WHERE variant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_movements_variant_id
  ON public.turath_masr_inventory_movements(variant_id)
  WHERE variant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_additions_variant_id
  ON public.turath_masr_inventory_additions(variant_id)
  WHERE variant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_stock_counts_variant_id
  ON public.turath_masr_inventory_stock_counts(variant_id)
  WHERE variant_id IS NOT NULL;


-- ─── 2. inventory_apply_movement — add p_variant_id ─────────────────────────
--
-- The old signature (11 params) is dropped so the new signature
-- (12 params) replaces it cleanly. Callers using named arguments
-- (which the Supabase JS client always does via `.rpc(name, {...})`)
-- continue to resolve unchanged because every old parameter name
-- exists with the same type in the new signature; `p_variant_id`
-- defaults to NULL.
--
-- When p_variant_id is NULL: behaviour is identical to the prior
-- implementation — locks the inventory row, validates non-negative
-- result, writes the movement row with `variant_id = NULL`, and
-- updates `turath_masr_inventory.available` (or `cost_price` for
-- `price_change`).
--
-- When p_variant_id is set: locks the variant row (and reads the
-- inventory row for archive / status checks); validates that the
-- variant belongs to p_inventory_id; mutates only the variant's
-- available (base product untouched); writes the movement row
-- with both inventory_id AND variant_id populated. `price_change`
-- is rejected when a variant is supplied — pricing remains a
-- product-level concern in 1B1.

DROP FUNCTION IF EXISTS public.inventory_apply_movement(
  uuid, text, integer, text, text, uuid, text, text, numeric, text, jsonb
);

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
  p_metadata             jsonb       DEFAULT '{}'::jsonb,
  p_variant_id           uuid        DEFAULT NULL
)
RETURNS TABLE(movement_id uuid, new_available integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller             uuid    := auth.uid();
  v_movement_id        uuid;
  v_inventory_status   text;
  v_qty_before         integer;
  v_qty_after          integer;
  v_variant_inv_id     uuid;
  v_variant_status     text;
  v_clean_name         text    := NULLIF(trim(COALESCE(p_created_by_name, '')), '');
  v_clean_reason       text    := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_clean_order_num    text    := NULLIF(trim(COALESCE(p_order_num, '')), '');
  v_clean_invoice      text    := NULLIF(trim(COALESCE(p_supplier_invoice_num, '')), '');
  v_clean_ref_type     text    := NULLIF(trim(COALESCE(p_reference_type, '')), '');
  v_total_cost         numeric(12,2);
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
    RAISE EXCEPTION 'inventory_apply_movement: unsupported movement_type %', p_movement_type;
  END IF;
  IF p_quantity_delta IS NULL THEN
    RAISE EXCEPTION 'inventory_apply_movement: quantity_delta is required';
  END IF;
  IF p_movement_type = 'price_change' THEN
    IF p_variant_id IS NOT NULL THEN
      RAISE EXCEPTION 'inventory_apply_movement: price_change is not supported on variants';
    END IF;
    IF p_quantity_delta <> 0 THEN
      RAISE EXCEPTION 'inventory_apply_movement: price_change requires quantity_delta = 0';
    END IF;
    IF p_unit_cost IS NULL THEN
      RAISE EXCEPTION 'inventory_apply_movement: price_change requires p_unit_cost';
    END IF;
  ELSIF p_quantity_delta = 0 THEN
    RAISE EXCEPTION 'inventory_apply_movement: quantity_delta cannot be zero for %', p_movement_type;
  END IF;
  IF p_movement_type IN ('manual_out','damage_out','exchange_out') AND p_quantity_delta > 0 THEN
    RAISE EXCEPTION 'inventory_apply_movement: % requires negative quantity_delta', p_movement_type;
  END IF;
  IF p_movement_type IN ('manual_in','return_in','exchange_in') AND p_quantity_delta < 0 THEN
    RAISE EXCEPTION 'inventory_apply_movement: % requires positive quantity_delta', p_movement_type;
  END IF;

  IF p_variant_id IS NULL THEN
    -- ── BASE-PRODUCT PATH (unchanged from pre-1B1) ─────────────────────────
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

    INSERT INTO public.turath_masr_inventory_movements (
      inventory_id, variant_id, movement_type, quantity_delta,
      quantity_before, quantity_after,
      reason, reference_type, reference_id,
      order_num, supplier_invoice_num,
      unit_cost, total_cost,
      created_by, created_by_name, created_at,
      metadata
    ) VALUES (
      p_inventory_id, NULL, p_movement_type, p_quantity_delta,
      v_qty_before, v_qty_after,
      v_clean_reason, v_clean_ref_type, p_reference_id,
      v_clean_order_num, v_clean_invoice,
      p_unit_cost, v_total_cost,
      v_caller, v_clean_name, now(),
      COALESCE(p_metadata, '{}'::jsonb)
    )
    RETURNING id INTO v_movement_id;

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
    RETURN;
  END IF;

  -- ── VARIANT PATH ─────────────────────────────────────────────────────────
  -- Validate the variant exists, belongs to p_inventory_id, and is
  -- not archived. We also read the parent inventory's status to
  -- block movements on archived parents (a variant's status alone
  -- is not enough — operator intent is to retire the whole product
  -- when the base is archived).
  SELECT status INTO v_inventory_status
  FROM public.turath_masr_inventory
  WHERE id = p_inventory_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventory_apply_movement: inventory % not found', p_inventory_id;
  END IF;
  IF v_inventory_status = 'archived' THEN
    RAISE EXCEPTION 'inventory_apply_movement: cannot apply movement to an archived product';
  END IF;

  SELECT inventory_id, status, COALESCE(available, 0)
    INTO v_variant_inv_id, v_variant_status, v_qty_before
  FROM public.turath_masr_inventory_variants
  WHERE id = p_variant_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventory_apply_movement: variant % not found', p_variant_id;
  END IF;
  IF v_variant_inv_id <> p_inventory_id THEN
    RAISE EXCEPTION
      'inventory_apply_movement: variant % does not belong to inventory %',
      p_variant_id, p_inventory_id;
  END IF;
  IF v_variant_status = 'archived' THEN
    RAISE EXCEPTION 'inventory_apply_movement: cannot apply movement to an archived variant';
  END IF;

  v_qty_after := v_qty_before + p_quantity_delta;
  IF v_qty_after < 0 THEN
    RAISE EXCEPTION 'inventory_apply_movement: resulting variant available (%) would be negative', v_qty_after;
  END IF;

  IF p_unit_cost IS NOT NULL AND p_quantity_delta <> 0 THEN
    v_total_cost := round(p_unit_cost * ABS(p_quantity_delta), 2);
  ELSE
    v_total_cost := NULL;
  END IF;

  INSERT INTO public.turath_masr_inventory_movements (
    inventory_id, variant_id, movement_type, quantity_delta,
    quantity_before, quantity_after,
    reason, reference_type, reference_id,
    order_num, supplier_invoice_num,
    unit_cost, total_cost,
    created_by, created_by_name, created_at,
    metadata
  ) VALUES (
    p_inventory_id, p_variant_id, p_movement_type, p_quantity_delta,
    v_qty_before, v_qty_after,
    v_clean_reason, v_clean_ref_type, p_reference_id,
    v_clean_order_num, v_clean_invoice,
    p_unit_cost, v_total_cost,
    v_caller, v_clean_name, now(),
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_movement_id;

  UPDATE public.turath_masr_inventory_variants
  SET available = v_qty_after
  WHERE id = p_variant_id;

  RETURN QUERY SELECT v_movement_id, v_qty_after;
END;
$$;

REVOKE ALL ON FUNCTION public.inventory_apply_movement(
  uuid, text, integer, text, text, uuid, text, text, numeric, text, jsonb, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inventory_apply_movement(
  uuid, text, integer, text, text, uuid, text, text, numeric, text, jsonb, uuid
) TO authenticated;


-- ─── 3. inventory_record_addition — add p_variant_id ────────────────────────
--
-- Same pattern: p_variant_id at the end with DEFAULT NULL. The old
-- 9-arg signature is dropped first. When variant_id is null,
-- existing behaviour is unchanged (increment base.available, write
-- one additions row + one `addition` movement row with
-- variant_id = NULL). When set, validate the variant belongs to
-- p_inventory_id, increment ONLY variant.available, and stamp
-- variant_id into both the additions row AND the movement row.

DROP FUNCTION IF EXISTS public.inventory_record_addition(
  uuid, integer, numeric, uuid, text, text, timestamptz, text, text
);

CREATE OR REPLACE FUNCTION public.inventory_record_addition(
  p_inventory_id         uuid,
  p_quantity             integer,
  p_unit_cost            numeric     DEFAULT NULL,
  p_supplier_id          uuid        DEFAULT NULL,
  p_supplier_name        text        DEFAULT NULL,
  p_supplier_invoice_num text        DEFAULT NULL,
  p_received_at          timestamptz DEFAULT NULL,
  p_note                 text        DEFAULT NULL,
  p_created_by_name      text        DEFAULT NULL,
  p_variant_id           uuid        DEFAULT NULL
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
  v_variant_inv_id       uuid;
  v_variant_status       text;
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

  -- Always lock the parent inventory row for status / archive check.
  SELECT status INTO v_inventory_status
  FROM public.turath_masr_inventory
  WHERE id = p_inventory_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventory_record_addition: inventory % not found', p_inventory_id;
  END IF;
  IF v_inventory_status = 'archived' THEN
    RAISE EXCEPTION 'inventory_record_addition: cannot add stock to an archived product';
  END IF;

  IF p_variant_id IS NULL THEN
    -- ── BASE-PRODUCT PATH ─────────────────────────────────────────────────
    SELECT COALESCE(available, 0) INTO v_qty_before
    FROM public.turath_masr_inventory
    WHERE id = p_inventory_id;
  ELSE
    -- ── VARIANT PATH ──────────────────────────────────────────────────────
    SELECT inventory_id, status, COALESCE(available, 0)
      INTO v_variant_inv_id, v_variant_status, v_qty_before
    FROM public.turath_masr_inventory_variants
    WHERE id = p_variant_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'inventory_record_addition: variant % not found', p_variant_id;
    END IF;
    IF v_variant_inv_id <> p_inventory_id THEN
      RAISE EXCEPTION
        'inventory_record_addition: variant % does not belong to inventory %',
        p_variant_id, p_inventory_id;
    END IF;
    IF v_variant_status = 'archived' THEN
      RAISE EXCEPTION 'inventory_record_addition: cannot add stock to an archived variant';
    END IF;
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
    inventory_id, variant_id, quantity, unit_cost, total_cost,
    supplier_id, supplier_name, supplier_invoice_num,
    received_at, created_by, created_by_name, note
  ) VALUES (
    p_inventory_id, p_variant_id, p_quantity, p_unit_cost, v_total_cost,
    v_resolved_supplier_id, v_supplier_name, v_supplier_invoice,
    v_received_at, v_caller, v_clean_name, v_clean_note
  )
  RETURNING id INTO v_addition_id;

  -- 2. Movement row mirroring the addition.
  INSERT INTO public.turath_masr_inventory_movements (
    inventory_id, variant_id, movement_type, quantity_delta,
    quantity_before, quantity_after,
    unit_cost, total_cost, supplier_invoice_num,
    created_by, created_by_name, created_at,
    metadata
  ) VALUES (
    p_inventory_id, p_variant_id, 'addition', p_quantity,
    v_qty_before, v_qty_after,
    p_unit_cost, v_total_cost, v_supplier_invoice,
    v_caller, v_clean_name, v_received_at,
    jsonb_build_object('addition_id', v_addition_id)
  )
  RETURNING id INTO v_movement_id;

  -- 3. Bump the aggregate — variant when variant_id is supplied,
  --    base product otherwise. `cost_price` and `last_added_*`
  --    stay on the base product in both cases (variant pricing
  --    arrives in a future phase).
  IF p_variant_id IS NULL THEN
    UPDATE public.turath_masr_inventory
    SET
      available     = v_qty_after,
      cost_price    = COALESCE(p_unit_cost, cost_price),
      last_added_at = v_received_at,
      last_added_by = v_caller
    WHERE id = p_inventory_id;
  ELSE
    UPDATE public.turath_masr_inventory_variants
    SET available = v_qty_after
    WHERE id = p_variant_id;
    -- Track timing on the parent product even for variant
    -- additions so the existing "last added" indicators stay
    -- accurate. `cost_price` only moves when the user explicitly
    -- supplied one and we're already on the base path.
    UPDATE public.turath_masr_inventory
    SET
      last_added_at = v_received_at,
      last_added_by = v_caller,
      cost_price    = COALESCE(p_unit_cost, cost_price)
    WHERE id = p_inventory_id;
  END IF;

  RETURN QUERY SELECT v_addition_id, v_movement_id, v_qty_after;
END;
$$;

REVOKE ALL ON FUNCTION public.inventory_record_addition(
  uuid, integer, numeric, uuid, text, text, timestamptz, text, text, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inventory_record_addition(
  uuid, integer, numeric, uuid, text, text, timestamptz, text, text, uuid
) TO authenticated;


-- ─── 4. inventory_record_stock_count — add p_variant_id ─────────────────────
--
-- Same pattern. When variant_id is null: existing 1A behaviour
-- (lock inventory, compute delta from inventory.available, write
-- stock_count row + optional `stock_count_adjustment` movement,
-- update inventory.available). When set: lock variant, compute
-- delta from variant.available, mutate ONLY variant.available,
-- stamp variant_id into both the count row and the movement row.

DROP FUNCTION IF EXISTS public.inventory_record_stock_count(
  uuid, integer, text, text, text, jsonb
);

CREATE OR REPLACE FUNCTION public.inventory_record_stock_count(
  p_inventory_id     uuid,
  p_counted_quantity integer,
  p_reason           text,
  p_note             text   DEFAULT NULL,
  p_counted_by_name  text   DEFAULT NULL,
  p_metadata         jsonb  DEFAULT '{}'::jsonb,
  p_variant_id       uuid   DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller            uuid    := auth.uid();
  v_inventory_status  text;
  v_variant_inv_id    uuid;
  v_variant_status    text;
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

  -- Always lock the parent inventory row first.
  SELECT status INTO v_inventory_status
  FROM public.turath_masr_inventory
  WHERE id = p_inventory_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventory_record_stock_count: inventory % not found', p_inventory_id;
  END IF;
  IF v_inventory_status = 'archived' THEN
    RAISE EXCEPTION
      'inventory_record_stock_count: cannot record count against archived inventory %',
      p_inventory_id;
  END IF;

  IF p_variant_id IS NULL THEN
    SELECT COALESCE(available, 0) INTO v_qty_before
    FROM public.turath_masr_inventory
    WHERE id = p_inventory_id;
  ELSE
    SELECT inventory_id, status, COALESCE(available, 0)
      INTO v_variant_inv_id, v_variant_status, v_qty_before
    FROM public.turath_masr_inventory_variants
    WHERE id = p_variant_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'inventory_record_stock_count: variant % not found', p_variant_id;
    END IF;
    IF v_variant_inv_id <> p_inventory_id THEN
      RAISE EXCEPTION
        'inventory_record_stock_count: variant % does not belong to inventory %',
        p_variant_id, p_inventory_id;
    END IF;
    IF v_variant_status = 'archived' THEN
      RAISE EXCEPTION
        'inventory_record_stock_count: cannot record count against archived variant %',
        p_variant_id;
    END IF;
  END IF;

  v_qty_after := p_counted_quantity;
  v_delta     := v_qty_after - v_qty_before;

  IF v_delta <> 0 THEN
    INSERT INTO public.turath_masr_inventory_movements (
      inventory_id, variant_id, movement_type, quantity_delta,
      quantity_before, quantity_after,
      reason, reference_type, reference_id,
      created_by, created_by_name, created_at,
      metadata
    ) VALUES (
      p_inventory_id, p_variant_id, 'stock_count_adjustment', v_delta,
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

    IF p_variant_id IS NULL THEN
      UPDATE public.turath_masr_inventory
      SET available = v_qty_after
      WHERE id = p_inventory_id;
    ELSE
      UPDATE public.turath_masr_inventory_variants
      SET available = v_qty_after
      WHERE id = p_variant_id;
    END IF;
  END IF;

  INSERT INTO public.turath_masr_inventory_stock_counts (
    inventory_id, variant_id, counted_quantity, system_available_before, quantity_delta,
    reason, note, movement_id,
    counted_by, counted_by_name, counted_at,
    metadata
  ) VALUES (
    p_inventory_id, p_variant_id, v_qty_after, v_qty_before, v_delta,
    v_clean_reason, v_clean_note, v_movement_id,
    v_caller, v_clean_actor_name, now(),
    v_extra_metadata
  )
  RETURNING id INTO v_stock_count_id;

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

REVOKE ALL ON FUNCTION public.inventory_record_stock_count(uuid, integer, text, text, text, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inventory_record_stock_count(uuid, integer, text, text, text, jsonb, uuid) TO authenticated;


-- ─── 5. inventory_reserve_for_order — read variant_id per line ──────────────
--
-- Signature unchanged. Each element of p_lines may now carry an
-- optional `variant_id` field. When present:
--   • lock the variant row,
--   • validate it belongs to inventory_id (or skip the line if
--     the validation fails — same skip-with-reason pattern the
--     RPC already uses for invalid inventory ids),
--   • check sellable against variant.available - variant.reserved
--     (instead of the base product),
--   • increment variant.reserved (instead of base.reserved),
--   • stamp variant_id into the inserted reservation row.
-- When the line carries no variant_id: behaviour is identical to
-- the prior implementation.

CREATE OR REPLACE FUNCTION public.inventory_reserve_for_order(
  p_order_id         text,
  p_order_num        text,
  p_lines            jsonb,
  p_created_by_name  text        DEFAULT NULL,
  p_allow_oversell   boolean     DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller            uuid := auth.uid();
  v_line              jsonb;
  v_inventory_id      text;
  v_variant_id        text;
  v_line_id           text;
  v_quantity          integer;
  v_status            text;
  v_variant_inv_id    uuid;
  v_variant_status    text;
  v_current_avail     integer;
  v_current_reserved  integer;
  v_sellable          integer;
  v_reserved_count    integer := 0;
  v_skipped_count     integer := 0;
  v_total_qty         integer := 0;
  v_outcomes          jsonb   := '[]'::jsonb;
  v_existing_qty      integer;
  v_existing_variant  uuid;
  v_inv_uuid          uuid;
  v_var_uuid          uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'inventory_reserve_for_order: not authenticated';
  END IF;
  IF NOT public.is_manager_or_above() THEN
    RAISE EXCEPTION 'inventory_reserve_for_order: insufficient permissions';
  END IF;
  IF p_order_id IS NULL OR length(trim(p_order_id)) = 0 THEN
    RAISE EXCEPTION 'inventory_reserve_for_order: order_id is required';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'inventory_reserve_for_order: p_lines must be a JSON array';
  END IF;

  FOR v_line IN SELECT jsonb_array_elements(p_lines)
  LOOP
    v_inventory_id := NULLIF(trim(COALESCE(v_line ->> 'inventory_id', '')), '');
    IF v_inventory_id IS NULL THEN
      v_inventory_id := NULLIF(trim(COALESCE(v_line ->> 'productType', '')), '');
      IF v_inventory_id IS NOT NULL AND v_inventory_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        v_inventory_id := NULL;
      END IF;
    END IF;
    v_variant_id := NULLIF(trim(COALESCE(v_line ->> 'variant_id', '')), '');
    v_line_id := NULLIF(trim(COALESCE(v_line ->> 'line_id', v_line ->> 'id', '')), '');
    v_quantity := COALESCE((v_line ->> 'quantity')::integer, 0);
    v_var_uuid := NULL;

    IF v_inventory_id IS NULL OR v_quantity <= 0 THEN
      v_skipped_count := v_skipped_count + 1;
      v_outcomes := v_outcomes || jsonb_build_object(
        'line_id', v_line_id,
        'inventory_id', v_inventory_id,
        'quantity', v_quantity,
        'skipped', true,
        'reason', CASE
          WHEN v_inventory_id IS NULL THEN 'missing_inventory_id'
          ELSE 'quantity_not_positive'
        END
      );
      CONTINUE;
    END IF;

    BEGIN
      v_inv_uuid := v_inventory_id::uuid;
    EXCEPTION WHEN others THEN
      v_skipped_count := v_skipped_count + 1;
      v_outcomes := v_outcomes || jsonb_build_object(
        'line_id', v_line_id,
        'inventory_id', v_inventory_id,
        'quantity', v_quantity,
        'skipped', true,
        'reason', 'invalid_inventory_id'
      );
      CONTINUE;
    END;

    -- Lock the inventory row for status / archive checks.
    SELECT status
      INTO v_status
    FROM public.turath_masr_inventory
    WHERE id = v_inv_uuid
    FOR UPDATE;
    IF NOT FOUND THEN
      v_skipped_count := v_skipped_count + 1;
      v_outcomes := v_outcomes || jsonb_build_object(
        'line_id', v_line_id,
        'inventory_id', v_inventory_id,
        'quantity', v_quantity,
        'skipped', true,
        'reason', 'inventory_not_found'
      );
      CONTINUE;
    END IF;
    IF v_status = 'archived' THEN
      RAISE EXCEPTION 'inventory_reserve_for_order: cannot reserve archived product %', v_inventory_id;
    END IF;
    IF v_status = 'inactive' THEN
      RAISE EXCEPTION 'inventory_reserve_for_order: cannot reserve inactive product %', v_inventory_id;
    END IF;

    IF v_variant_id IS NOT NULL THEN
      BEGIN
        v_var_uuid := v_variant_id::uuid;
      EXCEPTION WHEN others THEN
        v_skipped_count := v_skipped_count + 1;
        v_outcomes := v_outcomes || jsonb_build_object(
          'line_id', v_line_id,
          'inventory_id', v_inventory_id,
          'variant_id', v_variant_id,
          'quantity', v_quantity,
          'skipped', true,
          'reason', 'invalid_variant_id'
        );
        CONTINUE;
      END;

      SELECT inventory_id, status, COALESCE(available, 0), COALESCE(reserved, 0)
        INTO v_variant_inv_id, v_variant_status, v_current_avail, v_current_reserved
      FROM public.turath_masr_inventory_variants
      WHERE id = v_var_uuid
      FOR UPDATE;
      IF NOT FOUND OR v_variant_inv_id <> v_inv_uuid OR v_variant_status = 'archived' THEN
        v_skipped_count := v_skipped_count + 1;
        v_outcomes := v_outcomes || jsonb_build_object(
          'line_id', v_line_id,
          'inventory_id', v_inventory_id,
          'variant_id', v_variant_id,
          'quantity', v_quantity,
          'skipped', true,
          'reason', CASE
            WHEN NOT FOUND THEN 'variant_not_found'
            WHEN v_variant_inv_id <> v_inv_uuid THEN 'variant_inventory_mismatch'
            ELSE 'variant_archived'
          END
        );
        CONTINUE;
      END IF;
    ELSE
      SELECT COALESCE(available, 0), COALESCE(reserved, 0)
        INTO v_current_avail, v_current_reserved
      FROM public.turath_masr_inventory
      WHERE id = v_inv_uuid;
    END IF;

    -- Idempotency: an existing active reservation for
    -- (order_id, line_id) is released first so the new one
    -- replaces it. The release scope (variant vs base) matches
    -- the existing row's `variant_id`, not the new line's — old
    -- reservations stay consistent even if the line gets swapped
    -- to a variant on re-save.
    IF v_line_id IS NOT NULL THEN
      SELECT quantity, variant_id
        INTO v_existing_qty, v_existing_variant
      FROM public.turath_masr_inventory_reservations
      WHERE order_id = p_order_id
        AND line_id = v_line_id
        AND status = 'active';
      IF FOUND THEN
        UPDATE public.turath_masr_inventory_reservations
        SET status = 'released', released_at = now()
        WHERE order_id = p_order_id
          AND line_id = v_line_id
          AND status = 'active';
        IF v_existing_variant IS NOT NULL THEN
          UPDATE public.turath_masr_inventory_variants
          SET reserved = GREATEST(0, COALESCE(reserved, 0) - COALESCE(v_existing_qty, 0))
          WHERE id = v_existing_variant;
        ELSE
          UPDATE public.turath_masr_inventory
          SET reserved = GREATEST(0, COALESCE(reserved, 0) - COALESCE(v_existing_qty, 0))
          WHERE id = v_inv_uuid;
        END IF;
        -- Re-read the relevant `reserved` for the sellable check.
        IF v_var_uuid IS NOT NULL THEN
          SELECT COALESCE(available, 0), COALESCE(reserved, 0)
            INTO v_current_avail, v_current_reserved
          FROM public.turath_masr_inventory_variants
          WHERE id = v_var_uuid;
        ELSE
          SELECT COALESCE(available, 0), COALESCE(reserved, 0)
            INTO v_current_avail, v_current_reserved
          FROM public.turath_masr_inventory
          WHERE id = v_inv_uuid;
        END IF;
      END IF;
    END IF;

    v_sellable := v_current_avail - v_current_reserved;
    IF v_quantity > v_sellable AND NOT p_allow_oversell THEN
      RAISE EXCEPTION 'inventory_reserve_for_order: oversell for % (sellable=%, requested=%)',
        COALESCE(v_variant_id, v_inventory_id), v_sellable, v_quantity;
    END IF;

    INSERT INTO public.turath_masr_inventory_reservations (
      inventory_id, variant_id, order_id, order_num, line_id,
      sku, product_label, color, quantity,
      status, created_by, created_by_name, metadata
    ) VALUES (
      v_inv_uuid, v_var_uuid, p_order_id, p_order_num, v_line_id,
      NULLIF(trim(COALESCE(v_line ->> 'sku', '')), ''),
      NULLIF(trim(COALESCE(v_line ->> 'label', '')), ''),
      NULLIF(trim(COALESCE(v_line ->> 'color', '')), ''),
      v_quantity,
      'active',
      v_caller,
      NULLIF(trim(COALESCE(p_created_by_name, '')), ''),
      jsonb_build_object('source', 'inventory_reserve_for_order')
    );

    IF v_var_uuid IS NOT NULL THEN
      UPDATE public.turath_masr_inventory_variants
      SET reserved = COALESCE(reserved, 0) + v_quantity
      WHERE id = v_var_uuid;
    ELSE
      UPDATE public.turath_masr_inventory
      SET reserved = COALESCE(reserved, 0) + v_quantity
      WHERE id = v_inv_uuid;
    END IF;

    v_reserved_count := v_reserved_count + 1;
    v_total_qty := v_total_qty + v_quantity;
    v_outcomes := v_outcomes || jsonb_build_object(
      'line_id', v_line_id,
      'inventory_id', v_inventory_id,
      'variant_id', v_variant_id,
      'quantity', v_quantity,
      'skipped', false
    );
  END LOOP;

  RETURN jsonb_build_object(
    'reserved_count', v_reserved_count,
    'skipped_count', v_skipped_count,
    'total_quantity', v_total_qty,
    'outcomes', v_outcomes
  );
END;
$$;

REVOKE ALL ON FUNCTION public.inventory_reserve_for_order(text, text, jsonb, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inventory_reserve_for_order(text, text, jsonb, text, boolean) TO authenticated;


-- ─── 6. inventory_release_for_order — read variant_id per row ───────────────
--
-- Signature unchanged. Iterates active reservations; for each, if
-- the reservation carries a variant_id, decrement the variant's
-- reserved (clamped). Otherwise decrement the base inventory's
-- reserved (existing behaviour).

CREATE OR REPLACE FUNCTION public.inventory_release_for_order(
  p_order_id          text,
  p_reason            text        DEFAULT NULL,
  p_released_by_name  text        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller         uuid := auth.uid();
  v_row            record;
  v_released_count integer := 0;
  v_total_qty      integer := 0;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'inventory_release_for_order: not authenticated';
  END IF;
  IF NOT public.is_manager_or_above() THEN
    RAISE EXCEPTION 'inventory_release_for_order: insufficient permissions';
  END IF;
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'inventory_release_for_order: order_id is required';
  END IF;

  FOR v_row IN
    SELECT id, inventory_id, variant_id, quantity
    FROM public.turath_masr_inventory_reservations
    WHERE order_id = p_order_id AND status = 'active'
    ORDER BY inventory_id
    FOR UPDATE
  LOOP
    IF v_row.variant_id IS NOT NULL THEN
      UPDATE public.turath_masr_inventory_variants
      SET reserved = GREATEST(0, COALESCE(reserved, 0) - v_row.quantity)
      WHERE id = v_row.variant_id;
    ELSE
      UPDATE public.turath_masr_inventory
      SET reserved = GREATEST(0, COALESCE(reserved, 0) - v_row.quantity)
      WHERE id = v_row.inventory_id;
    END IF;

    UPDATE public.turath_masr_inventory_reservations
    SET status = 'released',
        released_at = now(),
        metadata = metadata || jsonb_build_object(
          'released_reason', NULLIF(trim(COALESCE(p_reason, '')), ''),
          'released_by_name', NULLIF(trim(COALESCE(p_released_by_name, '')), '')
        )
    WHERE id = v_row.id;

    v_released_count := v_released_count + 1;
    v_total_qty := v_total_qty + v_row.quantity;
  END LOOP;

  RETURN jsonb_build_object(
    'released_count', v_released_count,
    'total_quantity', v_total_qty
  );
END;
$$;

REVOKE ALL ON FUNCTION public.inventory_release_for_order(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inventory_release_for_order(text, text, text) TO authenticated;


-- ─── 7. inventory_fulfill_for_order — variant-aware decrements ──────────────
--
-- Signature unchanged. For each active reservation: if the row
-- carries a variant_id, fulfill that variant (decrement
-- variant.reserved + variant.available, error if variant.available
-- would go negative). Otherwise fulfill the base inventory row
-- (existing 1D behaviour). The order_out movement row stamps both
-- inventory_id AND variant_id.

CREATE OR REPLACE FUNCTION public.inventory_fulfill_for_order(
  p_order_id           text,
  p_order_num          text        DEFAULT NULL,
  p_fulfilled_by_name  text        DEFAULT NULL,
  p_metadata           jsonb       DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller             uuid    := auth.uid();
  v_row                record;
  v_qty_before         integer;
  v_qty_after          integer;
  v_inventory_status   text;
  v_variant_status     text;
  v_movement_id        uuid;
  v_clean_actor_name   text    := NULLIF(trim(COALESCE(p_fulfilled_by_name, '')), '');
  v_resolved_order_num text;
  v_fulfilled_count    integer := 0;
  v_total_qty          integer := 0;
  v_movement_count     integer := 0;
  v_extra_metadata     jsonb   := COALESCE(p_metadata, '{}'::jsonb);
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'inventory_fulfill_for_order: not authenticated';
  END IF;
  IF NOT public.is_manager_or_above() THEN
    RAISE EXCEPTION 'inventory_fulfill_for_order: insufficient permissions';
  END IF;
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'inventory_fulfill_for_order: order_id is required';
  END IF;

  FOR v_row IN
    SELECT id, inventory_id, variant_id, order_id, order_num, line_id, sku,
           product_label, color, quantity
    FROM public.turath_masr_inventory_reservations
    WHERE order_id = p_order_id AND status = 'active'
    ORDER BY inventory_id
    FOR UPDATE
  LOOP
    IF v_row.variant_id IS NOT NULL THEN
      -- ── VARIANT FULFILLMENT ────────────────────────────────────────────
      SELECT status, COALESCE(available, 0)
        INTO v_variant_status, v_qty_before
      FROM public.turath_masr_inventory_variants
      WHERE id = v_row.variant_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION
          'inventory_fulfill_for_order: variant % missing for reservation %',
          v_row.variant_id, v_row.id;
      END IF;
      IF v_variant_status = 'archived' THEN
        RAISE EXCEPTION
          'inventory_fulfill_for_order: cannot fulfill against archived variant % (reservation %)',
          v_row.variant_id, v_row.id;
      END IF;

      v_qty_after := v_qty_before - v_row.quantity;
      IF v_qty_after < 0 THEN
        RAISE EXCEPTION
          'inventory_fulfill_for_order: resulting variant available (%) would be negative for variant % (reservation % qty %)',
          v_qty_after, v_row.variant_id, v_row.id, v_row.quantity;
      END IF;

      UPDATE public.turath_masr_inventory_variants
      SET reserved  = GREATEST(0, COALESCE(reserved, 0) - v_row.quantity),
          available = v_qty_after
      WHERE id = v_row.variant_id;
    ELSE
      -- ── BASE-PRODUCT FULFILLMENT (1D behaviour) ────────────────────────
      SELECT status, COALESCE(available, 0)
        INTO v_inventory_status, v_qty_before
      FROM public.turath_masr_inventory
      WHERE id = v_row.inventory_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION
          'inventory_fulfill_for_order: inventory % missing for reservation %',
          v_row.inventory_id, v_row.id;
      END IF;
      IF v_inventory_status = 'archived' THEN
        RAISE EXCEPTION
          'inventory_fulfill_for_order: cannot fulfill against archived inventory % (reservation %)',
          v_row.inventory_id, v_row.id;
      END IF;

      v_qty_after := v_qty_before - v_row.quantity;
      IF v_qty_after < 0 THEN
        RAISE EXCEPTION
          'inventory_fulfill_for_order: resulting available (%) would be negative for inventory % (reservation % qty %)',
          v_qty_after, v_row.inventory_id, v_row.id, v_row.quantity;
      END IF;

      UPDATE public.turath_masr_inventory
      SET reserved  = GREATEST(0, COALESCE(reserved, 0) - v_row.quantity),
          available = v_qty_after
      WHERE id = v_row.inventory_id;
    END IF;

    UPDATE public.turath_masr_inventory_reservations
    SET status       = 'fulfilled',
        fulfilled_at = now(),
        metadata     = metadata || jsonb_build_object(
          'fulfilled_reason',   'delivery_fulfillment',
          'fulfilled_by_name',  v_clean_actor_name,
          'fulfilled_order_num', COALESCE(NULLIF(trim(COALESCE(p_order_num, '')), ''), v_row.order_num)
        )
    WHERE id = v_row.id;

    v_resolved_order_num := COALESCE(
      NULLIF(trim(COALESCE(p_order_num, '')), ''),
      v_row.order_num
    );

    INSERT INTO public.turath_masr_inventory_movements (
      inventory_id, variant_id, movement_type, quantity_delta,
      quantity_before, quantity_after,
      reason, reference_type, reference_id,
      order_num,
      created_by, created_by_name, created_at,
      metadata
    ) VALUES (
      v_row.inventory_id, v_row.variant_id, 'order_out', -v_row.quantity,
      v_qty_before, v_qty_after,
      'delivery_fulfillment', 'order', NULL,
      v_resolved_order_num,
      v_caller, v_clean_actor_name, now(),
      v_extra_metadata || jsonb_build_object(
        'source',          'delivery_fulfillment',
        'reservation_id',  v_row.id,
        'order_id',        v_row.order_id,
        'line_id',         v_row.line_id,
        'sku',             v_row.sku,
        'product_label',   v_row.product_label,
        'color',           v_row.color
      )
    )
    RETURNING id INTO v_movement_id;

    v_fulfilled_count := v_fulfilled_count + 1;
    v_total_qty       := v_total_qty + v_row.quantity;
    v_movement_count  := v_movement_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'fulfilled_count',           v_fulfilled_count,
    'total_fulfilled_quantity',  v_total_qty,
    'movement_count',            v_movement_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.inventory_fulfill_for_order(text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inventory_fulfill_for_order(text, text, text, jsonb) TO authenticated;
