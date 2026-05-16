-- ─────────────────────────────────────────────────────────────────────────────
-- 20260516180000_inventory_reservations.sql
--
-- Phase Inventory-Reservations-1A — additive migration. SCHEMA + RPCs ONLY.
-- This migration introduces the reservation primitives but does NOT touch
-- any order flow — no call sites exist yet in the application. A future
-- 1B PR wires AddOrderModal to call `inventory_reserve_for_order`, 1C
-- wires Edit/Status to call the release/reconcile RPCs, and the
-- subsequent Delivery-Fulfillment PR wires status='delivered' to write
-- order_out movements + decrement available.
--
-- What this migration adds:
--
--   1. `turath_masr_inventory.reserved integer NOT NULL DEFAULT 0` with
--      a non-negative CHECK constraint.
--   2. New table `turath_masr_inventory_reservations` — append-mostly
--      record of every reserve / release event keyed to (order_id,
--      line_id). Active reservations are uniquely indexed on
--      (order_id, line_id) so the reserve RPC is naturally idempotent.
--   3. RLS: authenticated SELECT, manager INSERT/UPDATE (via RPC); no
--      DELETE. UPDATE allowed for status transitions through the RPC.
--   4. Three SECURITY DEFINER RPCs:
--        • `inventory_reserve_for_order` — given an order id + lines
--          jsonb, locks each inventory row, refuses on archived /
--          inactive, blocks oversell unless override, increments
--          `reserved`, inserts an `active` reservation row per line.
--          Idempotent: an existing `active` reservation for the same
--          (order_id, line_id) is released first, then the new one is
--          created (so re-running with adjusted quantities is safe).
--        • `inventory_release_for_order` — set all `active`
--          reservations for the order to `released`, decrement
--          `reserved` accordingly.
--        • `inventory_reconcile_order_lines` — naive but safe diff:
--          release all `active` reservations for the order, then
--          re-reserve from the supplied lines.
--
-- What this migration does NOT do:
--   • No decrement of `available` anywhere.
--   • No movement-ledger writes (no `order_out` rows).
--   • No status='delivered' side-effects (that's Phase Delivery-
--     Fulfillment-1).
--   • No return / exchange stock effects.
--   • No order-table changes.
--
-- DO NOT touch order tables, AddOrderModal-facing data, or returns/
-- exchanges in this migration.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Inventory `reserved` column ─────────────────────────────────────────

ALTER TABLE public.turath_masr_inventory
  ADD COLUMN IF NOT EXISTS reserved integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'turath_masr_inventory_reserved_nonneg'
      AND conrelid = 'public.turath_masr_inventory'::regclass
  ) THEN
    ALTER TABLE public.turath_masr_inventory
      ADD CONSTRAINT turath_masr_inventory_reserved_nonneg
      CHECK (reserved >= 0);
  END IF;
END $$;

-- ─── 2. Reservations table ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.turath_masr_inventory_reservations (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id    uuid         NOT NULL REFERENCES public.turath_masr_inventory(id) ON DELETE RESTRICT,
  order_id        text         REFERENCES public.turath_masr_orders(id) ON DELETE CASCADE,
  order_num       text,
  line_id         text,
  sku             text,
  product_label   text,
  color           text,
  quantity        integer      NOT NULL CHECK (quantity > 0),
  status          text         NOT NULL DEFAULT 'active',
  reserved_at     timestamptz  NOT NULL DEFAULT now(),
  released_at     timestamptz,
  fulfilled_at    timestamptz,
  created_by      uuid         REFERENCES auth.users(id),
  created_by_name text,
  metadata        jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz  NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'turath_masr_inventory_reservations_status_check'
      AND conrelid = 'public.turath_masr_inventory_reservations'::regclass
  ) THEN
    ALTER TABLE public.turath_masr_inventory_reservations
      ADD CONSTRAINT turath_masr_inventory_reservations_status_check
      CHECK (status IN ('active', 'released', 'fulfilled', 'cancelled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_inventory_reservations_inventory_id_status
  ON public.turath_masr_inventory_reservations(inventory_id, status);
CREATE INDEX IF NOT EXISTS idx_inventory_reservations_order_id
  ON public.turath_masr_inventory_reservations(order_id);
CREATE INDEX IF NOT EXISTS idx_inventory_reservations_order_num
  ON public.turath_masr_inventory_reservations(order_num);

-- Partial unique index — at most one ACTIVE reservation per
-- (order_id, line_id). This is the idempotency guard the reserve RPC
-- relies on. line_id may be NULL on legacy lines; the partial WHERE
-- skips those rows so the index doesn't reject NULL-line inserts.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_inventory_reservations_active_line
  ON public.turath_masr_inventory_reservations(order_id, line_id)
  WHERE status = 'active' AND line_id IS NOT NULL;

-- ─── 3. RLS on the new table ────────────────────────────────────────────────

ALTER TABLE public.turath_masr_inventory_reservations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='turath_masr_inventory_reservations'
      AND policyname='inventory_reservations_authenticated_select'
  ) THEN
    CREATE POLICY inventory_reservations_authenticated_select
      ON public.turath_masr_inventory_reservations
      FOR SELECT TO authenticated
      USING (auth.role() = 'authenticated');
  END IF;

  -- INSERT / UPDATE only through the SECURITY DEFINER RPCs below.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='turath_masr_inventory_reservations'
      AND policyname='inventory_reservations_manager_insert'
  ) THEN
    CREATE POLICY inventory_reservations_manager_insert
      ON public.turath_masr_inventory_reservations
      FOR INSERT TO authenticated
      WITH CHECK (public.is_manager_or_above());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='turath_masr_inventory_reservations'
      AND policyname='inventory_reservations_manager_update'
  ) THEN
    CREATE POLICY inventory_reservations_manager_update
      ON public.turath_masr_inventory_reservations
      FOR UPDATE TO authenticated
      USING (public.is_manager_or_above())
      WITH CHECK (public.is_manager_or_above());
  END IF;
  -- No DELETE policy — reservations are append/transition only.
END $$;

-- ─── 4. inventory_reserve_for_order RPC ─────────────────────────────────────
--
-- Reserve the quantities supplied in `p_lines`. Idempotent on
-- (order_id, line_id): an existing `active` row for that key is
-- released first, then a fresh row is inserted with the latest
-- quantity. Returns a summary jsonb describing per-line outcomes.

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
  v_caller          uuid := auth.uid();
  v_line            jsonb;
  v_inventory_id    text;
  v_line_id         text;
  v_quantity        integer;
  v_status          text;
  v_current_avail   integer;
  v_current_reserved integer;
  v_sellable        integer;
  v_reserved_count  integer := 0;
  v_skipped_count   integer := 0;
  v_total_qty       integer := 0;
  v_outcomes        jsonb   := '[]'::jsonb;
  v_existing_qty    integer;
  v_inv_uuid        uuid;
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
    -- Fallback: legacy lines may carry the inventory id under `productType`.
    IF v_inventory_id IS NULL THEN
      v_inventory_id := NULLIF(trim(COALESCE(v_line ->> 'productType', '')), '');
      IF v_inventory_id IS NOT NULL AND v_inventory_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        v_inventory_id := NULL;
      END IF;
    END IF;
    v_line_id := NULLIF(trim(COALESCE(v_line ->> 'line_id', v_line ->> 'id', '')), '');
    v_quantity := COALESCE((v_line ->> 'quantity')::integer, 0);

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

    -- Validate the id is a real UUID before casting.
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

    -- Lock the inventory row. Skip silently if it doesn't exist.
    SELECT status, COALESCE(available, 0), COALESCE(reserved, 0)
      INTO v_status, v_current_avail, v_current_reserved
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

    -- Idempotency: if an active reservation for (order_id, line_id)
    -- already exists, release it first so the new quantity replaces it.
    IF v_line_id IS NOT NULL THEN
      SELECT quantity INTO v_existing_qty
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
        UPDATE public.turath_masr_inventory
        SET reserved = GREATEST(0, COALESCE(reserved, 0) - COALESCE(v_existing_qty, 0))
        WHERE id = v_inv_uuid;
        -- Re-fetch the row's reserved after the release.
        SELECT COALESCE(reserved, 0) INTO v_current_reserved
        FROM public.turath_masr_inventory
        WHERE id = v_inv_uuid;
      END IF;
    END IF;

    v_sellable := v_current_avail - v_current_reserved;
    IF v_quantity > v_sellable AND NOT p_allow_oversell THEN
      RAISE EXCEPTION 'inventory_reserve_for_order: oversell for % (sellable=%, requested=%)',
        v_inventory_id, v_sellable, v_quantity;
    END IF;

    INSERT INTO public.turath_masr_inventory_reservations (
      inventory_id, order_id, order_num, line_id,
      sku, product_label, color, quantity,
      status, created_by, created_by_name, metadata
    ) VALUES (
      v_inv_uuid, p_order_id, p_order_num, v_line_id,
      NULLIF(trim(COALESCE(v_line ->> 'sku', '')), ''),
      NULLIF(trim(COALESCE(v_line ->> 'label', '')), ''),
      NULLIF(trim(COALESCE(v_line ->> 'color', '')), ''),
      v_quantity,
      'active',
      v_caller,
      NULLIF(trim(COALESCE(p_created_by_name, '')), ''),
      jsonb_build_object('source', 'inventory_reserve_for_order')
    );

    UPDATE public.turath_masr_inventory
    SET reserved = COALESCE(reserved, 0) + v_quantity
    WHERE id = v_inv_uuid;

    v_reserved_count := v_reserved_count + 1;
    v_total_qty := v_total_qty + v_quantity;
    v_outcomes := v_outcomes || jsonb_build_object(
      'line_id', v_line_id,
      'inventory_id', v_inventory_id,
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

-- ─── 5. inventory_release_for_order RPC ─────────────────────────────────────

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

  -- Lock the rows in inventory-id order so concurrent calls don't deadlock.
  FOR v_row IN
    SELECT id, inventory_id, quantity
    FROM public.turath_masr_inventory_reservations
    WHERE order_id = p_order_id AND status = 'active'
    ORDER BY inventory_id
    FOR UPDATE
  LOOP
    UPDATE public.turath_masr_inventory
    SET reserved = GREATEST(0, COALESCE(reserved, 0) - v_row.quantity)
    WHERE id = v_row.inventory_id;

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

-- ─── 6. inventory_reconcile_order_lines RPC ─────────────────────────────────
--
-- Diff strategy: release all active reservations for the order, then
-- reserve again from the supplied lines. Naive but safe — guarantees
-- the final state matches the new lines regardless of how complex
-- the edit was.

CREATE OR REPLACE FUNCTION public.inventory_reconcile_order_lines(
  p_order_id        text,
  p_order_num       text,
  p_lines           jsonb,
  p_reason          text        DEFAULT NULL,
  p_actor_name      text        DEFAULT NULL,
  p_allow_oversell  boolean     DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_release_result jsonb;
  v_reserve_result jsonb;
BEGIN
  IF NOT public.is_manager_or_above() THEN
    RAISE EXCEPTION 'inventory_reconcile_order_lines: insufficient permissions';
  END IF;

  v_release_result := public.inventory_release_for_order(
    p_order_id,
    COALESCE(p_reason, 'reconcile'),
    p_actor_name
  );
  v_reserve_result := public.inventory_reserve_for_order(
    p_order_id,
    p_order_num,
    p_lines,
    p_actor_name,
    p_allow_oversell
  );

  RETURN jsonb_build_object(
    'release', v_release_result,
    'reserve', v_reserve_result
  );
END;
$$;

REVOKE ALL ON FUNCTION public.inventory_reconcile_order_lines(text, text, jsonb, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inventory_reconcile_order_lines(text, text, jsonb, text, text, boolean) TO authenticated;
