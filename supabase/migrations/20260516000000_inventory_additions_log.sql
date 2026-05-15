-- ─────────────────────────────────────────────────────────────────────────────
-- 20260516000000_inventory_additions_log.sql
--
-- Phase Inventory-Additions-Log-1 — additive migration:
--
--   1. Adds `cost_price`, `last_added_at`, `last_added_by` to
--      `turath_masr_inventory`. All NULL by default; nothing else
--      changes on the table.
--   2. New table `turath_masr_inventory_suppliers` (light supplier
--      ledger — name unique, optional phone / address / note).
--   3. New IMMUTABLE table `turath_masr_inventory_additions` — every
--      stock receipt writes one row. UPDATE/DELETE are not granted
--      by RLS so the ledger can't be silently rewritten.
--   4. SECURITY DEFINER function `public.inventory_record_addition`
--      that, in one transaction:
--         • validates caller via `public.is_manager_or_above()`,
--         • validates quantity > 0,
--         • locks the inventory row + refuses if it's archived,
--         • upserts the supplier if a free-text name is supplied
--           without an id,
--         • inserts the addition row (with computed total_cost),
--         • bumps `available`, refreshes `cost_price`,
--           `last_added_at`, `last_added_by`,
--         • returns the new addition id + the updated available.
--      `search_path` is locked to `public` so the function behaves
--      identically regardless of caller's search path.
--   5. RLS on both new tables:
--        • suppliers: authenticated SELECT / manager INSERT/UPDATE /
--          admin DELETE.
--        • additions: authenticated SELECT / manager INSERT (via the
--          RPC); no UPDATE, no DELETE policies → immutable.
--
-- DO NOT touch any other table. DO NOT modify `available`,
-- `withdrawn`, `price`, `images`, `colors`, `name`, or `sku` columns
-- directly here. DO NOT change `turath_masr_inventory_categories` or
-- order-flow tables.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Inventory cost / last-added columns ─────────────────────────────────

ALTER TABLE public.turath_masr_inventory
  ADD COLUMN IF NOT EXISTS cost_price    numeric(12,2),
  ADD COLUMN IF NOT EXISTS last_added_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_added_by uuid REFERENCES auth.users(id);

-- ─── 2. Suppliers table ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.turath_masr_inventory_suppliers (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL UNIQUE,
  phone      text,
  address    text,
  note       text,
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_suppliers_active
  ON public.turath_masr_inventory_suppliers(is_active);

-- ─── 3. Additions table (immutable ledger) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS public.turath_masr_inventory_additions (
  id                   uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id         uuid         NOT NULL REFERENCES public.turath_masr_inventory(id) ON DELETE RESTRICT,
  quantity             integer      NOT NULL CHECK (quantity > 0),
  unit_cost            numeric(12,2),
  total_cost           numeric(12,2),
  supplier_id          uuid         REFERENCES public.turath_masr_inventory_suppliers(id),
  supplier_name        text,
  supplier_invoice_num text,
  received_at          timestamptz  NOT NULL DEFAULT now(),
  created_by           uuid         REFERENCES auth.users(id),
  created_by_name      text,
  note                 text,
  created_at           timestamptz  NOT NULL DEFAULT now(),
  metadata             jsonb        NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_inventory_additions_inventory_id
  ON public.turath_masr_inventory_additions(inventory_id);
CREATE INDEX IF NOT EXISTS idx_inventory_additions_received_at
  ON public.turath_masr_inventory_additions(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_additions_supplier_id
  ON public.turath_masr_inventory_additions(supplier_id);

-- ─── 4. Atomic addition RPC ─────────────────────────────────────────────────

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
RETURNS TABLE(addition_id uuid, new_available integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller               uuid := auth.uid();
  v_addition_id          uuid;
  v_resolved_supplier_id uuid := p_supplier_id;
  v_new_available        integer;
  v_inventory_status     text;
  v_total_cost           numeric(12,2) := NULL;
  v_supplier_name        text := NULLIF(trim(COALESCE(p_supplier_name, '')), '');
BEGIN
  -- Auth + permission gates.
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'inventory_record_addition: not authenticated';
  END IF;
  IF NOT public.is_manager_or_above() THEN
    RAISE EXCEPTION 'inventory_record_addition: insufficient permissions';
  END IF;

  -- Validate input.
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'inventory_record_addition: quantity must be > 0';
  END IF;
  IF p_inventory_id IS NULL THEN
    RAISE EXCEPTION 'inventory_record_addition: inventory_id is required';
  END IF;

  -- Lock the row + refuse if archived.
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

  -- Resolve supplier: upsert when only a free-text name was supplied.
  IF v_resolved_supplier_id IS NULL AND v_supplier_name IS NOT NULL THEN
    INSERT INTO public.turath_masr_inventory_suppliers (name)
    VALUES (v_supplier_name)
    ON CONFLICT (name) DO UPDATE
      SET is_active = true
    RETURNING id INTO v_resolved_supplier_id;
  END IF;

  -- Compute total_cost only when a unit cost was supplied.
  IF p_unit_cost IS NOT NULL THEN
    v_total_cost := round(p_unit_cost * p_quantity, 2);
  END IF;

  -- Insert the immutable addition row.
  INSERT INTO public.turath_masr_inventory_additions (
    inventory_id,
    quantity,
    unit_cost,
    total_cost,
    supplier_id,
    supplier_name,
    supplier_invoice_num,
    received_at,
    created_by,
    created_by_name,
    note
  ) VALUES (
    p_inventory_id,
    p_quantity,
    p_unit_cost,
    v_total_cost,
    v_resolved_supplier_id,
    v_supplier_name,
    NULLIF(trim(COALESCE(p_supplier_invoice_num, '')), ''),
    COALESCE(p_received_at, now()),
    v_caller,
    NULLIF(trim(COALESCE(p_created_by_name, '')), ''),
    NULLIF(trim(COALESCE(p_note, '')), '')
  )
  RETURNING id INTO v_addition_id;

  -- Bump available + refresh cost/last-added metadata. cost_price gets
  -- the latest unit cost when one is supplied (simple overwrite — a
  -- future phase can move to a weighted-average policy).
  UPDATE public.turath_masr_inventory
  SET
    available    = COALESCE(available, 0) + p_quantity,
    cost_price   = COALESCE(p_unit_cost, cost_price),
    last_added_at = COALESCE(p_received_at, now()),
    last_added_by = v_caller
  WHERE id = p_inventory_id
  RETURNING available INTO v_new_available;

  RETURN QUERY SELECT v_addition_id, v_new_available;
END;
$$;

REVOKE ALL ON FUNCTION public.inventory_record_addition(
  uuid, integer, numeric, uuid, text, text, timestamptz, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inventory_record_addition(
  uuid, integer, numeric, uuid, text, text, timestamptz, text, text
) TO authenticated;

-- ─── 5. RLS on new tables ───────────────────────────────────────────────────

ALTER TABLE public.turath_masr_inventory_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.turath_masr_inventory_additions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- ── suppliers ────────────────────────────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='turath_masr_inventory_suppliers'
      AND policyname='inventory_suppliers_authenticated_select'
  ) THEN
    CREATE POLICY inventory_suppliers_authenticated_select
      ON public.turath_masr_inventory_suppliers
      FOR SELECT TO authenticated
      USING (auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='turath_masr_inventory_suppliers'
      AND policyname='inventory_suppliers_manager_insert'
  ) THEN
    CREATE POLICY inventory_suppliers_manager_insert
      ON public.turath_masr_inventory_suppliers
      FOR INSERT TO authenticated
      WITH CHECK (public.is_manager_or_above());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='turath_masr_inventory_suppliers'
      AND policyname='inventory_suppliers_manager_update'
  ) THEN
    CREATE POLICY inventory_suppliers_manager_update
      ON public.turath_masr_inventory_suppliers
      FOR UPDATE TO authenticated
      USING (public.is_manager_or_above())
      WITH CHECK (public.is_manager_or_above());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='turath_masr_inventory_suppliers'
      AND policyname='inventory_suppliers_admin_delete'
  ) THEN
    CREATE POLICY inventory_suppliers_admin_delete
      ON public.turath_masr_inventory_suppliers
      FOR DELETE TO authenticated
      USING (public.is_admin());
  END IF;

  -- ── additions ────────────────────────────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='turath_masr_inventory_additions'
      AND policyname='inventory_additions_authenticated_select'
  ) THEN
    CREATE POLICY inventory_additions_authenticated_select
      ON public.turath_masr_inventory_additions
      FOR SELECT TO authenticated
      USING (auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='turath_masr_inventory_additions'
      AND policyname='inventory_additions_manager_insert'
  ) THEN
    CREATE POLICY inventory_additions_manager_insert
      ON public.turath_masr_inventory_additions
      FOR INSERT TO authenticated
      WITH CHECK (public.is_manager_or_above());
  END IF;
  -- No UPDATE / DELETE policies — the ledger is immutable.
END $$;
