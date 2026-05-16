-- ─────────────────────────────────────────────────────────────────────────────
-- 20260516240000_inventory_variants.sql
--
-- Phase Inventory-Variants-1A — scaffold for per-variant inventory.
--
-- Goal
--   Add a first-class table for product variants (color today, sizes /
--   patterns / etc. tomorrow) WITHOUT yet wiring it into the order
--   flow's reserve / fulfill / movement RPCs. The 1A boundary is:
--
--     • new `turath_masr_inventory_variants` table,
--     • seed variants from each inventory row's existing `colors[]`
--       array (one row per color, quantity = 0),
--     • RLS gated to manager+ for INSERT/UPDATE, no DELETE,
--     • read-only UI surfacing in the inventory drawer.
--
--   Phase Inventory-Variants-1B (future PR) will:
--     • add `variant_id` to movements / reservations / stock_counts,
--     • teach the reserve / fulfill / return / exchange / count RPCs
--       to operate on a variant when supplied,
--     • wire AddOrderModal / EditOrderModal to persist variant_id,
--     • migrate quantities from product-level → variant-level once
--       operators have set baselines via the existing stock-count
--       workflow.
--
-- Seeding policy
--   For each product row with a non-empty `colors[]` array, we insert
--   one variant per color with `available = 0`. The base product's
--   `available / reserved` stay as the source of truth in 1A so the
--   ordering / fulfillment flow keeps working unchanged. Operators
--   set per-variant baselines later via the stock-count workflow
--   (Phase Stock-Count-1) once 1B teaches that RPC about variant_id.
--
--   For products with NO colors[] (or empty array), no variant is
--   seeded. The drawer tab renders an honest "no variants yet" empty
--   state in that case. We deliberately do NOT seed a "default"
--   variant matching product.available — that would create a
--   misleading second source of truth.
--
-- What this migration does NOT do
--   • No backfill of historical quantities into variants.
--   • No changes to `turath_masr_inventory` columns.
--   • No changes to movements / reservations / stock_counts schemas.
--   • No changes to RLS or RPCs on any existing table.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. turath_masr_inventory_variants ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.turath_masr_inventory_variants (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id    uuid         NOT NULL REFERENCES public.turath_masr_inventory(id) ON DELETE CASCADE,

  -- Variant axis. Today only `color`. The column exists so future
  -- multi-axis variants (size, material, …) slot in without a
  -- migration on this table.
  variant_type    text         NOT NULL DEFAULT 'color',
  -- Canonical machine value (used for joins / dedup).
  variant_value   text         NOT NULL,
  -- Operator-facing label (Arabic). For color variants today this
  -- equals `variant_value`; future axes may differ.
  variant_label   text         NOT NULL,

  sku             text,
  barcode         text,

  available       integer      NOT NULL DEFAULT 0 CHECK (available >= 0),
  reserved        integer      NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  min_stock       integer      NOT NULL DEFAULT 0 CHECK (min_stock >= 0),

  status          text         NOT NULL DEFAULT 'active',
  sort_order      integer      NOT NULL DEFAULT 0,

  metadata        jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'turath_masr_inventory_variants_status_check'
      AND conrelid = 'public.turath_masr_inventory_variants'::regclass
  ) THEN
    ALTER TABLE public.turath_masr_inventory_variants
      ADD CONSTRAINT turath_masr_inventory_variants_status_check
      CHECK (status IN ('active', 'inactive', 'archived'));
  END IF;

  -- Uniqueness on the natural key — one variant per (product, axis,
  -- value). Re-seeding the same color is a no-op.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'turath_masr_inventory_variants_unique_value'
      AND conrelid = 'public.turath_masr_inventory_variants'::regclass
  ) THEN
    ALTER TABLE public.turath_masr_inventory_variants
      ADD CONSTRAINT turath_masr_inventory_variants_unique_value
      UNIQUE (inventory_id, variant_type, variant_value);
  END IF;
END $$;

-- ─── 2. Indexes ─────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_inventory_variants_inventory_id
  ON public.turath_masr_inventory_variants(inventory_id);
CREATE INDEX IF NOT EXISTS idx_inventory_variants_status
  ON public.turath_masr_inventory_variants(status);
CREATE INDEX IF NOT EXISTS idx_inventory_variants_sku
  ON public.turath_masr_inventory_variants(sku) WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_variants_inventory_sort
  ON public.turath_masr_inventory_variants(inventory_id, sort_order, variant_label);

-- ─── 3. RLS ─────────────────────────────────────────────────────────────────

ALTER TABLE public.turath_masr_inventory_variants ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='turath_masr_inventory_variants'
      AND policyname='inventory_variants_authenticated_select'
  ) THEN
    CREATE POLICY inventory_variants_authenticated_select
      ON public.turath_masr_inventory_variants
      FOR SELECT TO authenticated
      USING (auth.role() = 'authenticated');
  END IF;

  -- Manager-or-above can INSERT / UPDATE. There is no UI writer yet
  -- in 1A (a future phase will add the variant CRUD modal); the
  -- policies are pre-declared so 1B doesn't need to revisit RLS.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='turath_masr_inventory_variants'
      AND policyname='inventory_variants_manager_insert'
  ) THEN
    CREATE POLICY inventory_variants_manager_insert
      ON public.turath_masr_inventory_variants
      FOR INSERT TO authenticated
      WITH CHECK (public.is_manager_or_above());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='turath_masr_inventory_variants'
      AND policyname='inventory_variants_manager_update'
  ) THEN
    CREATE POLICY inventory_variants_manager_update
      ON public.turath_masr_inventory_variants
      FOR UPDATE TO authenticated
      USING (public.is_manager_or_above())
      WITH CHECK (public.is_manager_or_above());
  END IF;
  -- No DELETE policy — archive (status='archived') is the right
  -- exit ramp; deletion would orphan downstream movement rows once
  -- 1B wires `movements.variant_id`.
END $$;

-- ─── 4. Seed variants from existing colors[] ────────────────────────────────
--
-- For each inventory row with a non-empty colors array, insert one
-- variant per color with available=0. ON CONFLICT skips colors
-- that have already been seeded (re-running this migration is a
-- no-op). Products with an empty colors array contribute zero rows
-- — they get no default variant, intentionally.

INSERT INTO public.turath_masr_inventory_variants (
  inventory_id, variant_type, variant_value, variant_label,
  available, reserved, status, sort_order, metadata
)
SELECT
  i.id                          AS inventory_id,
  'color'                       AS variant_type,
  trim(c.color)                 AS variant_value,
  trim(c.color)                 AS variant_label,
  0                             AS available,
  0                             AS reserved,
  'active'                      AS status,
  c.ord                         AS sort_order,
  jsonb_build_object('source', 'seed_from_colors_array') AS metadata
FROM public.turath_masr_inventory i
CROSS JOIN LATERAL unnest(COALESCE(i.colors, ARRAY[]::text[]))
  WITH ORDINALITY AS c(color, ord)
WHERE i.colors IS NOT NULL
  AND array_length(i.colors, 1) IS NOT NULL
  AND trim(c.color) <> ''
ON CONFLICT (inventory_id, variant_type, variant_value) DO NOTHING;

-- ─── 5. updated_at trigger ──────────────────────────────────────────────────
--
-- Keep `updated_at` in sync on any UPDATE so the drawer's "last
-- modified" indicator is honest. Idempotent — the function is
-- shared with other tables, so we check existence first.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'set_updated_at_timestamp'
      AND pronamespace = 'public'::regnamespace
  ) THEN
    CREATE FUNCTION public.set_updated_at_timestamp()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $body$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $body$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_inventory_variants_set_updated_at'
      AND tgrelid = 'public.turath_masr_inventory_variants'::regclass
  ) THEN
    CREATE TRIGGER trg_inventory_variants_set_updated_at
      BEFORE UPDATE ON public.turath_masr_inventory_variants
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at_timestamp();
  END IF;
END $$;
