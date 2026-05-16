-- ─────────────────────────────────────────────────────────────────────────────
-- 20260516200000_inventory_delivery_fulfillment.sql
--
-- Phase Inventory-Delivery-Fulfillment-1 — fulfill reserved stock when an
-- order is marked delivered. Builds on:
--
--   • Phase Inventory-Reservations-1A (20260516180000) — schema + reserve
--     / release / reconcile RPCs.
--   • Phase Inventory-Reservations-1B — reserve on order creation.
--   • Phase Inventory-Reservations-1C — reconcile on edit, release on
--     cancel / archive.
--
-- What this migration adds:
--
--   1. Expands the `turath_masr_inventory_movements_type_check`
--      CHECK constraint to include the new `order_out` movement type.
--      All other constraints and policies are unchanged.
--   2. New SECURITY DEFINER RPC `inventory_fulfill_for_order` — given an
--      order id, locks each inventory row referenced by an `active`
--      reservation, decrements `reserved` (clamped), decrements
--      `available` (errors on negative), transitions the reservation
--      to `fulfilled`, and writes one `order_out` row into the
--      movement ledger. Naturally idempotent: subsequent calls find
--      no `active` rows and return a zero-count summary without side
--      effects.
--
-- What this migration does NOT do:
--
--   • No order-table changes; the UI is responsible for moving status
--     to `delivered` and then calling this RPC.
--   • No return / exchange stock effects (Phase Returns-Stock-1).
--   • No auto-fulfillment trigger on the orders table — fulfillment is
--     explicit so the UI surface controls audit + actor name + retry.
--   • No backfill of historical delivered orders. Past deliveries do
--     not generate `order_out` rows retroactively; only deliveries
--     processed after this RPC ships are fulfilled. Manual catch-up
--     can be scripted later if needed.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Expand the movement_type CHECK to include `order_out` ───────────────
--
-- The existing constraint name is `turath_masr_inventory_movements_type_check`
-- (created by 20260516120000). The list is a strict superset of the old one,
-- so dropping and recreating is safe — every existing row's movement_type is
-- still accepted by the new constraint.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'turath_masr_inventory_movements_type_check'
      AND conrelid = 'public.turath_masr_inventory_movements'::regclass
  ) THEN
    ALTER TABLE public.turath_masr_inventory_movements
      DROP CONSTRAINT turath_masr_inventory_movements_type_check;
  END IF;

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
      'correction',
      'order_out'
    ));
END $$;

-- ─── 2. inventory_fulfill_for_order RPC ─────────────────────────────────────
--
-- Transitions every `active` reservation for the order to `fulfilled`,
-- decrements `reserved` (clamped to zero) and `available` (errors on
-- negative) on the linked inventory rows, and writes one `order_out`
-- row to the movement ledger per fulfilled reservation. Returns a
-- summary jsonb suitable for UI surfacing.
--
-- Idempotency
--   • Subsequent calls find no `active` rows for the order and return
--     { fulfilled_count: 0, total_fulfilled_quantity: 0,
--       movement_count: 0 } without touching inventory or movements.
--   • Reservations already in `released` / `cancelled` / `fulfilled`
--     status are skipped (the WHERE clause picks only `active`).
--
-- Failure modes
--   • RLS / auth: errors before any locks. No side effects.
--   • Insufficient `available`: raises an exception → entire
--     transaction rolls back; the order status is unchanged at the
--     RPC level (the caller already set it; the caller must surface
--     a "fulfillment failed" warning and decide whether to revert).
--   • Inventory row missing / archived: raises an exception → rolls
--     back. Reservations for missing inventory ids should not exist
--     under normal operation; if they do, the row predates the
--     ON DELETE RESTRICT FK and is a data quality issue surfaced
--     here.

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

  -- Lock the rows in inventory-id order so concurrent fulfillments
  -- on different orders that happen to touch overlapping inventory
  -- products don't deadlock.
  FOR v_row IN
    SELECT id, inventory_id, order_id, order_num, line_id, sku,
           product_label, color, quantity
    FROM public.turath_masr_inventory_reservations
    WHERE order_id = p_order_id AND status = 'active'
    ORDER BY inventory_id
    FOR UPDATE
  LOOP
    -- Lock the inventory row and read current available + status.
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

    -- Decrement reserved (clamped) AND available in one statement.
    UPDATE public.turath_masr_inventory
    SET reserved  = GREATEST(0, COALESCE(reserved, 0) - v_row.quantity),
        available = v_qty_after
    WHERE id = v_row.inventory_id;

    -- Mark the reservation fulfilled. Metadata preserves whatever
    -- the reserve / reconcile path set, plus our delivery context.
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

    -- Write the immutable ledger row. quantity_delta is negative
    -- because the order shipped out; quantity_after is the new
    -- post-decrement `available` value.
    INSERT INTO public.turath_masr_inventory_movements (
      inventory_id, movement_type, quantity_delta,
      quantity_before, quantity_after,
      reason, reference_type, reference_id,
      order_num,
      created_by, created_by_name, created_at,
      metadata
    ) VALUES (
      v_row.inventory_id, 'order_out', -v_row.quantity,
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
