-- ─────────────────────────────────────────────────────────────────────────────
-- Phase Permissions-Audit-Phase-4B — server-side enforcement for the
-- order-driven inventory RPCs.
--
-- Problem
--   The four order-driven inventory RPCs
--     • inventory_reserve_for_order    (called after order creation)
--     • inventory_reconcile_order_lines (called on order edit)
--     • inventory_release_for_order    (called on cancel / return)
--     • inventory_fulfill_for_order    (called on delivery)
--   each gate themselves with `IF NOT public.is_manager_or_above()`. That
--   helper is role-only (r1/r2) and ignores the per-user `permissions`
--   override on `profiles` and the role-defaults edited via `/roles`.
--
--   Phase 4A made order INSERT respect `create_orders`. As a result,
--   r3 / r6 users (and any user whose `customPermissions` include
--   `create_orders`) can now create orders, but the inventory RPC
--   immediately throws `insufficient permissions`. AddOrderModal then
--   tries to auto-cancel the just-created order via UPDATE; for r6 that
--   UPDATE is also denied by RLS (`can_edit_orders()` is r1-r4 only),
--   leaving a zombie active order with no inventory reservation. The
--   smoking-gun query in the Phase 4B root-cause report identified
--   order 2605162 (delivered) and 2605161 (cancelled) as r6-created
--   rows without any reservation_id.
--
-- Fix
--   Three new SECURITY DEFINER helpers that mirror the JS
--   `hasPermission(...)` logic, reading the same DB tables as
--   `can_create_orders()` (the Phase 4A helper):
--
--     • can_modify_order_inventory()   — create_orders / edit_orders /
--                                          orders_manage / admin
--                  used by  inventory_reserve_for_order
--                           inventory_reconcile_order_lines
--
--     • can_release_order_inventory()  — update_status / edit_orders /
--                                          orders_manage / admin
--                  used by  inventory_release_for_order
--
--     • can_fulfill_order_inventory()  — update_status / edit_orders /
--                                          orders_manage / admin
--                  used by  inventory_fulfill_for_order
--
--   `can_release_order_inventory` and `can_fulfill_order_inventory`
--   currently honour the same effective-permission set, but they remain
--   distinct so that future business rules can diverge (e.g. fulfill
--   may later require a dedicated shipping permission) without
--   touching the release-path helpers.
--
-- Why this mirrors the catalog, not the deprecated role helpers
--   Same rationale as Phase 4A. The role-only helpers in
--   `src/lib/constants/roles.ts` and the role-only booleans on
--   `usePermissions()` ignore `customPermissions` and diverge from
--   the catalog. Reading `profiles.permissions` then falling back to
--   `turath_roles.permissions` avoids reintroducing that bug at the
--   SQL layer.
--
-- Why this is safe
--   • SECURITY DEFINER + `SET search_path = public, pg_temp` matches
--     the established pattern (is_admin, is_manager_or_above,
--     can_edit_orders, can_create_orders).
--   • The helpers read only `profiles` and `turath_roles`. Both are
--     tables admins already control via the /roles UI; no new trust
--     surface beyond Phase 4A.
--   • REVOKE FROM PUBLIC + GRANT EXECUTE TO authenticated ensures
--     anonymous callers cannot invoke them.
--   • Each RPC's CREATE OR REPLACE preserves its body byte-for-byte
--     except for the single `IF NOT public.is_manager_or_above() THEN`
--     line, which is swapped for the new helper. Signatures, return
--     types, DECLAREs, reservation / movement logic, oversell checks,
--     archived-product checks, transaction behaviour and exception
--     messages are unchanged.
--   • No data DML. No RLS policy changes. No changes to RLS tables.
--   • Manual inventory RPCs (inventory_apply_movement,
--     inventory_record_addition, inventory_record_stock_count) are
--     INTENTIONALLY NOT TOUCHED — they remain on is_manager_or_above
--     until a later phase decides on `edit_inventory` semantics.
--   • Existing Phase 4A artefacts (can_create_orders, can_edit_orders,
--     and the orders_create_authorized RLS policy) are NOT touched.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─── 1) Effective-permission helpers ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.can_modify_order_inventory()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- True when the caller can drive inventory side-effects from an order
  -- lifecycle event that creates or edits the order itself:
  --   • create_orders   — same as Phase 4A INSERT gate
  --   • edit_orders     — order editing also triggers reconcile
  --   • orders_manage   — catalog-level meta key
  -- Admin short-circuit (is_admin) is the canonical isAdmin || can(...)
  -- pattern; protects against the corner case of an admin whose
  -- customPermissions override is malformed / sparse.
  WITH eff AS (
    SELECT
      CASE
        WHEN cardinality(coalesce(p.permissions, ARRAY[]::text[])) > 0
          THEN p.permissions
        ELSE coalesce(r.permissions, ARRAY[]::text[])
      END AS effective_perms
    FROM public.profiles p
    LEFT JOIN public.turath_roles r ON r.id = p.role_id
    WHERE p.id = auth.uid()
    LIMIT 1
  )
  SELECT public.is_admin() OR EXISTS (
    SELECT 1
    FROM eff
    WHERE effective_perms && ARRAY['create_orders','edit_orders','orders_manage']::text[]
  );
$$;

REVOKE ALL ON FUNCTION public.can_modify_order_inventory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_modify_order_inventory() TO authenticated;

COMMENT ON FUNCTION public.can_modify_order_inventory() IS
'Phase Permissions-Audit-Phase-4B — server-side mirror of the JS hasPermission(...) logic for order-creation / order-edit driven inventory side effects. Prefers profiles.permissions (custom override) when non-empty, else falls back to turath_roles.permissions for the caller''s role. True when effective set contains create_orders, edit_orders, or orders_manage, or when the caller is admin (r1). Used by inventory_reserve_for_order and inventory_reconcile_order_lines.';


CREATE OR REPLACE FUNCTION public.can_release_order_inventory()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- True when the caller can release reservations as part of cancelling,
  -- returning, or re-reconciling an order:
  --   • update_status   — cancel / return is a status change
  --   • edit_orders     — order editing can also drive a release
  --   • orders_manage   — catalog-level meta key
  -- See can_modify_order_inventory() for the same admin-short-circuit
  -- rationale.
  WITH eff AS (
    SELECT
      CASE
        WHEN cardinality(coalesce(p.permissions, ARRAY[]::text[])) > 0
          THEN p.permissions
        ELSE coalesce(r.permissions, ARRAY[]::text[])
      END AS effective_perms
    FROM public.profiles p
    LEFT JOIN public.turath_roles r ON r.id = p.role_id
    WHERE p.id = auth.uid()
    LIMIT 1
  )
  SELECT public.is_admin() OR EXISTS (
    SELECT 1
    FROM eff
    WHERE effective_perms && ARRAY['update_status','edit_orders','orders_manage']::text[]
  );
$$;

REVOKE ALL ON FUNCTION public.can_release_order_inventory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_release_order_inventory() TO authenticated;

COMMENT ON FUNCTION public.can_release_order_inventory() IS
'Phase Permissions-Audit-Phase-4B — server-side mirror of the JS hasPermission(...) logic for cancel / return / re-reconcile driven inventory releases. True when effective set contains update_status, edit_orders, or orders_manage, or when the caller is admin (r1). Used by inventory_release_for_order.';


CREATE OR REPLACE FUNCTION public.can_fulfill_order_inventory()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- True when the caller can move stock from "reserved" to "fulfilled"
  -- as the result of a delivery / status transition:
  --   • update_status   — delivery is a status change
  --   • edit_orders     — order editing may move through delivery
  --   • orders_manage   — catalog-level meta key
  -- Same admin-short-circuit rationale as the sibling helpers.
  WITH eff AS (
    SELECT
      CASE
        WHEN cardinality(coalesce(p.permissions, ARRAY[]::text[])) > 0
          THEN p.permissions
        ELSE coalesce(r.permissions, ARRAY[]::text[])
      END AS effective_perms
    FROM public.profiles p
    LEFT JOIN public.turath_roles r ON r.id = p.role_id
    WHERE p.id = auth.uid()
    LIMIT 1
  )
  SELECT public.is_admin() OR EXISTS (
    SELECT 1
    FROM eff
    WHERE effective_perms && ARRAY['update_status','edit_orders','orders_manage']::text[]
  );
$$;

REVOKE ALL ON FUNCTION public.can_fulfill_order_inventory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_fulfill_order_inventory() TO authenticated;

COMMENT ON FUNCTION public.can_fulfill_order_inventory() IS
'Phase Permissions-Audit-Phase-4B — server-side mirror of the JS hasPermission(...) logic for delivery-driven inventory fulfilment. True when effective set contains update_status, edit_orders, or orders_manage, or when the caller is admin (r1). Used by inventory_fulfill_for_order. Kept distinct from can_release_order_inventory so future business rules can diverge (e.g. dedicated shipping permission) without touching the release path.';


-- ─── 2) Swap permission guard in four order-driven inventory RPCs ────────
--
-- Each CREATE OR REPLACE below preserves the deployed function body
-- byte-for-byte except for the single `IF NOT public.is_manager_or_above()
-- THEN` line, which is swapped for the new helper. Bodies were obtained
-- via `SELECT pg_get_functiondef(...)` against the live database to
-- guarantee no drift.

CREATE OR REPLACE FUNCTION public.inventory_reserve_for_order(p_order_id text, p_order_num text, p_lines jsonb, p_created_by_name text DEFAULT NULL::text, p_allow_oversell boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF NOT public.can_modify_order_inventory() THEN
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
$function$;


CREATE OR REPLACE FUNCTION public.inventory_reconcile_order_lines(p_order_id text, p_order_num text, p_lines jsonb, p_reason text DEFAULT NULL::text, p_actor_name text DEFAULT NULL::text, p_allow_oversell boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_release_result jsonb;
  v_reserve_result jsonb;
BEGIN
  IF NOT public.can_modify_order_inventory() THEN
    RAISE EXCEPTION 'inventory_reconcile_order_lines: insufficient permissions';
  END IF;
  v_release_result := public.inventory_release_for_order(p_order_id, COALESCE(p_reason, 'reconcile'), p_actor_name);
  v_reserve_result := public.inventory_reserve_for_order(p_order_id, p_order_num, p_lines, p_actor_name, p_allow_oversell);
  RETURN jsonb_build_object('release', v_release_result, 'reserve', v_reserve_result);
END;
$function$;


CREATE OR REPLACE FUNCTION public.inventory_release_for_order(p_order_id text, p_reason text DEFAULT NULL::text, p_released_by_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller         uuid := auth.uid();
  v_row            record;
  v_released_count integer := 0;
  v_total_qty      integer := 0;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'inventory_release_for_order: not authenticated';
  END IF;
  IF NOT public.can_release_order_inventory() THEN
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
$function$;


CREATE OR REPLACE FUNCTION public.inventory_fulfill_for_order(p_order_id text, p_order_num text DEFAULT NULL::text, p_fulfilled_by_name text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF NOT public.can_fulfill_order_inventory() THEN
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
$function$;


COMMIT;

-- ─── Manual verification (run after apply, no migration changes) ───────────
--
--   -- 1. Helpers exist + correct attributes.
--   SELECT proname, prosecdef, proconfig
--   FROM pg_proc
--   WHERE pronamespace = 'public'::regnamespace
--     AND proname IN (
--       'can_modify_order_inventory',
--       'can_release_order_inventory',
--       'can_fulfill_order_inventory'
--     );
--   -- expected: 3 rows, prosecdef=true, proconfig contains
--   --           'search_path=public, pg_temp'
--
--   -- 2. Inventory RPCs now reference the new helpers, not is_manager_or_above.
--   SELECT proname, position('is_manager_or_above' IN prosrc) AS legacy_pos,
--          position('can_modify_order_inventory' IN prosrc) AS modify_pos,
--          position('can_release_order_inventory' IN prosrc) AS release_pos,
--          position('can_fulfill_order_inventory' IN prosrc) AS fulfill_pos
--   FROM pg_proc
--   WHERE pronamespace = 'public'::regnamespace
--     AND proname IN (
--       'inventory_reserve_for_order',
--       'inventory_reconcile_order_lines',
--       'inventory_release_for_order',
--       'inventory_fulfill_for_order'
--     )
--   ORDER BY proname;
--   -- expected:
--   --   inventory_fulfill_for_order        legacy=0, fulfill>0
--   --   inventory_reconcile_order_lines    legacy=0, modify>0
--   --   inventory_release_for_order        legacy=0, release>0
--   --   inventory_reserve_for_order        legacy=0, modify>0
--
--   -- 3. Manual inventory RPCs still use is_manager_or_above (untouched).
--   SELECT proname, position('is_manager_or_above' IN prosrc) > 0 AS still_manager_only
--   FROM pg_proc
--   WHERE pronamespace = 'public'::regnamespace
--     AND proname IN (
--       'inventory_apply_movement',
--       'inventory_record_addition',
--       'inventory_record_stock_count'
--     );
--   -- expected: all rows still_manager_only = true
--
--   -- 4. Phase 4A artefacts untouched.
--   SELECT proname FROM pg_proc
--   WHERE pronamespace = 'public'::regnamespace
--     AND proname IN ('can_create_orders','can_edit_orders');
--   SELECT policyname FROM pg_policies
--   WHERE schemaname='public' AND tablename='turath_masr_orders'
--     AND policyname='orders_create_authorized';
--   -- expected: helpers present; INSERT policy present and unchanged.
