-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 22N-Fix3 — persist the customer's neighborhood / village /
-- shiakha selection on every new order.
--
-- Background: Phase 22N introduced a 3-level coverage hierarchy
-- (governorate → area → neighborhood) and added a UI picker on
-- AddOrderModal. Until now the typed neighborhood was validated
-- against `settings_regions` for coverage + used to resolve the
-- shipping fee, but it was NEVER persisted on the order — every
-- downstream surface (admin order view, invoice, tracking page,
-- WhatsApp confirmation) showed only `region` (governorate) and
-- `district` (canonical city/markaz/kism). Customers complained
-- that their neighborhood / village / shiakha didn't appear in any
-- of those views, which made delivery + reporting harder.
--
-- This migration adds a single nullable text column. It is purely
-- additive:
--   • Existing orders keep `neighborhood = NULL` and continue to
--     render exactly as before.
--   • New orders written by the Phase 22N-Fix3 AddOrderModal carry
--     the typed canonical name (or NULL when the selected area has
--     no children — neighborhood is hidden in that case).
--   • Every reader is updated to render the column when present;
--     NULL values fall back to the existing area-only display.
--
-- IF NOT EXISTS makes the migration idempotent — re-running it on
-- a database that already has the column is a no-op.
--
-- No backfill required. No RLS change required. No grant change
-- required (the existing per-row policies on turath_masr_orders
-- cover every column owned by the row's `created_by_user_id`).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.turath_masr_orders
  ADD COLUMN IF NOT EXISTS neighborhood text;

COMMENT ON COLUMN public.turath_masr_orders.neighborhood IS
  'Phase 22N-Fix3 — optional canonical neighborhood / village / shiakha name '
  'from settings_regions[].districts[].children[].name. NULL when the order''s '
  'selected area has no children configured. Validated for coverage at order '
  'creation time; mirrors the parent area''s enabled state.';
