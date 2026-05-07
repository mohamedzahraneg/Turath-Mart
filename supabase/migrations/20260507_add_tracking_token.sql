-- =============================================================================
-- Migration: Add tracking_token (UUID) to turath_masr_orders
-- Date: 2026-05-07 (runs after 20260506b_drop_legacy_permissive_policies.sql)
-- Phase: 13A — DB only. No app code changes in this migration.
-- =============================================================================
--
-- Purpose:
--   The customer-facing /track/[orderId] page currently uses `order_num`
--   (a short, sequential identifier like "2603271"). That is trivially
--   enumerable, allowing an attacker to walk every order's redacted DTO
--   (status, region, product summary, timestamps).
--
--   This migration introduces an unguessable per-order UUID `tracking_token`
--   that will (in Phase 13B/13C) replace `order_num` in public tracking
--   URLs. `order_num` is RETAINED for staff/internal use and for
--   backward-compatible public links during the deprecation window.
--
-- Safety properties of this migration:
--   - Idempotent: every statement uses IF NOT EXISTS or a WHERE-guard.
--   - Non-destructive: no DROP / TRUNCATE / DELETE / data INSERT.
--   - order_num is NOT removed.
--   - Existing rows' columns OTHER than tracking_token are not modified.
--   - The existing public tracking RPCs / API route / UI keep working
--     unchanged (they look up by order_num). This migration ADDS a new
--     column only.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 1: Ensure gen_random_uuid() is available.
--
-- PG13+ ships gen_random_uuid() in the core, but enabling pgcrypto is a
-- safe no-op that also covers older Postgres minor versions and any
-- environment where the function is sourced from the extension.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 2: Add the tracking_token column.
--
-- Because gen_random_uuid() is VOLATILE, ADD COLUMN ... DEFAULT
-- gen_random_uuid() rewrites every existing row with a unique value
-- during the ALTER (Postgres cannot use the fast-path it has for
-- non-volatile defaults). This is the desired behaviour: each existing
-- order receives its own random token. New rows inserted afterwards get
-- a fresh default automatically.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.turath_masr_orders
  ADD COLUMN IF NOT EXISTS tracking_token uuid DEFAULT gen_random_uuid();


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 3: Backfill any rows that may still have NULL tracking_token.
--
-- On a fresh ADD COLUMN with the volatile DEFAULT above, this UPDATE
-- matches zero rows. The statement exists for idempotency: if a previous
-- partial run added the column WITHOUT the default (or somebody set a
-- token to NULL manually), re-running this migration heals the data.
--
-- WHERE tracking_token IS NULL guarantees we never overwrite an existing
-- token (which would invalidate any links already issued).
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE public.turath_masr_orders
   SET tracking_token = gen_random_uuid()
 WHERE tracking_token IS NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 4: Enforce uniqueness with a unique index.
--
-- CREATE UNIQUE INDEX IF NOT EXISTS is idempotent (unlike ADD CONSTRAINT,
-- which has no IF NOT EXISTS form). The unique index gives us:
--   - point-lookup performance for `WHERE tracking_token = $1`
--   - hard uniqueness guarantee at the DB level
-- which is everything a UNIQUE constraint would buy us.
--
-- Naming follows the conventional `<table>_<column>_key` style so the
-- index reads like a natural unique constraint in pg_indexes.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS turath_masr_orders_tracking_token_key
  ON public.turath_masr_orders (tracking_token);


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 5: Documentation.
-- ─────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.turath_masr_orders.tracking_token IS
  'Unguessable UUID used as the public tracking key. Replaces order_num '
  'in customer-facing /track URLs to mitigate enumeration attacks. '
  'order_num is retained for staff/internal use and for backward-'
  'compatible public links during the Phase 13D deprecation window.';


-- =============================================================================
-- POST-MIGRATION VERIFICATION (run manually after applying):
--
--   -- expect: 0
--   SELECT count(*) FROM public.turath_masr_orders WHERE tracking_token IS NULL;
--
--   -- expect: count(*) == count(distinct)
--   SELECT count(*), count(DISTINCT tracking_token) FROM public.turath_masr_orders;
--
--   -- expect: index name appears, idx_scan = 0 immediately after creation
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname = 'public'
--      AND tablename  = 'turath_masr_orders'
--      AND indexname  = 'turath_masr_orders_tracking_token_key';
-- =============================================================================
