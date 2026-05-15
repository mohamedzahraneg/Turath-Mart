-- ─────────────────────────────────────────────────────────────────────────────
-- 20260515000000_inventory_categories_archive.sql
--
-- Phase Inventory-Categories-Safer-Archive-1 — additive migration:
--
--   1. New table `turath_masr_inventory_categories` (canonical Turath
--      taxonomy: حامل مصحف / مصحف / كشاف / كرسي / كعبة / قطع صيانة /
--      تغليف / هدايا / أخرى).
--   2. Seed the 9 default categories with ON CONFLICT DO NOTHING so the
--      migration is re-runnable.
--   3. Extend `turath_masr_inventory` with `status`, `category_id`,
--      `archived_at`, `archived_by`, `archive_reason`, `updated_at`.
--      All ADD COLUMN IF NOT EXISTS — safe on a table that may have
--      been partially patched.
--   4. CHECK constraint pinning `status` to ('active','inactive',
--      'archived'). Wrapped in a DO block so a re-run is idempotent.
--   5. Backfill `category_id` from the legacy free-text `category`
--      values using a best-effort map (حوامل → حامل مصحف, كتب → مصحف,
--      أثاث → كرسي; everything else → أخرى). The legacy `category`
--      text column is preserved for back-compat.
--   6. Trigger `BEFORE UPDATE` that bumps `updated_at` on every row
--      update — mirrors the existing `update_zahranship_orders_*`
--      pattern.
--   7. RLS for the new categories table — same shape as
--      `turath_masr_inventory`: authenticated SELECT, manager INSERT/
--      UPDATE, admin DELETE.
--
-- DO NOT touch the `available`, `withdrawn`, `price`, `images`,
-- `colors`, `name`, or `sku` columns. DO NOT touch any other table.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─── 1. Categories table ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.turath_masr_inventory_categories (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL UNIQUE,
  slug       text        NOT NULL UNIQUE,
  sort_order integer     NOT NULL DEFAULT 100,
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ─── 2. Seed canonical categories ───────────────────────────────────────────

INSERT INTO public.turath_masr_inventory_categories (name, slug, sort_order) VALUES
  ('حامل مصحف', 'quran-holder',      10),
  ('مصحف',      'quran',             20),
  ('كشاف',      'flashlight',        30),
  ('كرسي',      'chair',             40),
  ('كعبة',      'kaaba-model',       50),
  ('قطع صيانة', 'maintenance-parts', 60),
  ('تغليف',     'packaging',         70),
  ('هدايا',     'gifts',             80),
  ('أخرى',      'other',             99)
ON CONFLICT (name) DO NOTHING;

-- ─── 3. Extend inventory table (additive only) ──────────────────────────────

ALTER TABLE public.turath_masr_inventory
  ADD COLUMN IF NOT EXISTS status         text        NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS category_id    uuid        REFERENCES public.turath_masr_inventory_categories(id),
  ADD COLUMN IF NOT EXISTS archived_at    timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by    uuid        REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS archive_reason text,
  ADD COLUMN IF NOT EXISTS updated_at     timestamptz NOT NULL DEFAULT now();

-- ─── 4. Status CHECK constraint (idempotent) ────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'turath_masr_inventory_status_check'
      AND conrelid = 'public.turath_masr_inventory'::regclass
  ) THEN
    ALTER TABLE public.turath_masr_inventory
      ADD CONSTRAINT turath_masr_inventory_status_check
      CHECK (status IN ('active', 'inactive', 'archived'));
  END IF;
END $$;

-- ─── 5. Backfill category_id from legacy `category` text ────────────────────

UPDATE public.turath_masr_inventory inv
SET category_id = sub.cat_id
FROM (
  SELECT
    i.id AS inv_id,
    cat.id AS cat_id
  FROM public.turath_masr_inventory i
  JOIN public.turath_masr_inventory_categories cat
    ON cat.name = CASE
      WHEN i.category = 'حوامل'      THEN 'حامل مصحف'
      WHEN i.category = 'كتب'        THEN 'مصحف'
      WHEN i.category = 'أثاث'       THEN 'كرسي'
      WHEN i.category = 'إكسسوارات'  THEN 'أخرى'
      WHEN i.category = 'ديكور'      THEN 'أخرى'
      -- Any row whose `category` text already matches a seeded
      -- canonical name (e.g. a brand-new row inserted after the
      -- redesign) gets mapped directly.
      ELSE i.category
    END
  WHERE i.category_id IS NULL
    AND i.category IS NOT NULL
    AND i.category <> ''
) sub
WHERE inv.id = sub.inv_id;

-- Anything still NULL (empty / unknown free-text) gets bucketed into 'أخرى'
UPDATE public.turath_masr_inventory inv
SET category_id = cat.id
FROM public.turath_masr_inventory_categories cat
WHERE inv.category_id IS NULL
  AND cat.name = 'أخرى';

-- ─── 6. updated_at trigger ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.turath_masr_inventory_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS turath_masr_inventory_set_updated_at
  ON public.turath_masr_inventory;

CREATE TRIGGER turath_masr_inventory_set_updated_at
  BEFORE UPDATE ON public.turath_masr_inventory
  FOR EACH ROW
  EXECUTE FUNCTION public.turath_masr_inventory_set_updated_at();

-- ─── 7. RLS on categories table ─────────────────────────────────────────────

ALTER TABLE public.turath_masr_inventory_categories ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'turath_masr_inventory_categories'
      AND policyname = 'inventory_categories_authenticated_select'
  ) THEN
    CREATE POLICY inventory_categories_authenticated_select
      ON public.turath_masr_inventory_categories
      FOR SELECT TO authenticated
      USING (auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'turath_masr_inventory_categories'
      AND policyname = 'inventory_categories_manager_insert'
  ) THEN
    CREATE POLICY inventory_categories_manager_insert
      ON public.turath_masr_inventory_categories
      FOR INSERT TO authenticated
      WITH CHECK (public.is_manager_or_above());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'turath_masr_inventory_categories'
      AND policyname = 'inventory_categories_manager_update'
  ) THEN
    CREATE POLICY inventory_categories_manager_update
      ON public.turath_masr_inventory_categories
      FOR UPDATE TO authenticated
      USING (public.is_manager_or_above())
      WITH CHECK (public.is_manager_or_above());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'turath_masr_inventory_categories'
      AND policyname = 'inventory_categories_admin_delete'
  ) THEN
    CREATE POLICY inventory_categories_admin_delete
      ON public.turath_masr_inventory_categories
      FOR DELETE TO authenticated
      USING (public.is_admin());
  END IF;
END $$;

COMMIT;
