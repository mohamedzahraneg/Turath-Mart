-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 22Q — persist a customer-facing delivery schedule on every order.
--
-- Background
--   Phase 22Q adds a "جدولة التسليم" section to StatusUpdateModal so
--   admins can pick a day from the next 7 days, a time window, and an
--   optional reschedule reason when changing an existing schedule. The
--   schedule needs to round-trip to:
--     • the admin status-history + audit trail (already covered by
--       Phase 22P's structured note JSON);
--     • the customer-facing tracking page card;
--     • a future export / report so deliveries can be planned.
--
--   This migration adds six nullable columns on `turath_masr_orders`.
--   It is purely additive:
--     • Existing orders keep the new columns as NULL and continue to
--       render exactly as before (every reader is defensive against
--       null, including the deployed UI).
--     • New orders are unaffected unless an admin opens
--       StatusUpdateModal and chooses to schedule a delivery.
--     • No backfill, no data movement, no row-level rewrites.
--
-- Idempotent
--   `ADD COLUMN IF NOT EXISTS` makes re-applying this migration a
--   no-op on a database that already has the columns.
--
-- No RLS change
--   The table-level policies already gate write access to authenticated
--   admins/managers/shippers via `orders_editor_update`. The new
--   columns inherit those policies — no additional grants required.
--
-- DEPLOY GATE — DO NOT APPLY WITHOUT EXPLICIT APPROVAL
--   Phase 22Q's deployed code reads + writes the new columns. To keep
--   production stable, this migration must be applied BEFORE the
--   matching code merges and ships. The companion migration
--   `20260510160000_tracking_info_add_scheduled_delivery.sql` widens
--   the customer-tracking RPC to expose the schedule fields and
--   should be applied at the same time. Both files are staged here;
--   apply via Supabase MCP `apply_migration` (or `npx supabase db
--   push`) only after operator review.
-- ─────────────────────────────────────────────────────────────────────────────


ALTER TABLE public.turath_masr_orders
  -- Customer-promised delivery DATE. Local calendar date — no time
  -- zone — because the time-of-day component lives in the two
  -- companion `time` columns. Naming mirrors the existing
  -- `date text` column (which carries the human-readable creation
  -- date for the receipt) so future readers can quickly tell the
  -- two apart.
  ADD COLUMN IF NOT EXISTS scheduled_delivery_date        date,

  -- Lower bound of the customer-promised delivery window, in the
  -- store's local time. `time` (without time-zone) is appropriate
  -- because the store + every delivery operates in the same Egypt
  -- TZ and the data is read against the local-calendar
  -- `scheduled_delivery_date` directly — no UTC shifting required.
  ADD COLUMN IF NOT EXISTS scheduled_delivery_from        time,

  -- Upper bound of the customer-promised delivery window. Validated
  -- on the client to be strictly greater than `scheduled_delivery_from`.
  ADD COLUMN IF NOT EXISTS scheduled_delivery_to          time,

  -- Free-text reason an admin types when they MOVE an existing
  -- schedule (date, from, or to changes). Required by the
  -- StatusUpdateModal validation when any of those three fields
  -- already had a value and the user is editing it; optional / null
  -- on first-time scheduling. The reason is mirrored into the
  -- structured `note` payload on `turath_masr_audit_logs` so the
  -- history can be reconstructed later if this column is ever
  -- truncated.
  ADD COLUMN IF NOT EXISTS scheduled_delivery_reason      text,

  -- Audit metadata — when the schedule was last touched. Set by the
  -- StatusUpdateModal write path on every save (`new Date().toISOString()`).
  ADD COLUMN IF NOT EXISTS scheduled_delivery_updated_at  timestamptz,

  -- Audit metadata — display name of the admin who last updated the
  -- schedule. Mirrors the `created_by text` convention already in use
  -- on this table; the staff `auth.uid` UUID reaches the row via the
  -- existing `updated_by uuid` audit column written on every status
  -- update by the orders_editor_update RLS path.
  ADD COLUMN IF NOT EXISTS scheduled_delivery_updated_by  text;


-- Documentation only; no behavioural effect.
COMMENT ON COLUMN public.turath_masr_orders.scheduled_delivery_date IS
  'Phase 22Q — customer-promised delivery date (local calendar). NULL '
  'when the order has no schedule yet.';

COMMENT ON COLUMN public.turath_masr_orders.scheduled_delivery_from IS
  'Phase 22Q — lower bound of the customer-promised delivery window '
  '(local time, no TZ).';

COMMENT ON COLUMN public.turath_masr_orders.scheduled_delivery_to IS
  'Phase 22Q — upper bound of the customer-promised delivery window. '
  'Must be > scheduled_delivery_from (validated client-side).';

COMMENT ON COLUMN public.turath_masr_orders.scheduled_delivery_reason IS
  'Phase 22Q — free-text reason for moving an existing schedule. '
  'Required by the UI when date/from/to is being changed; null on '
  'first-time scheduling. Mirrored into the structured audit note.';

COMMENT ON COLUMN public.turath_masr_orders.scheduled_delivery_updated_at IS
  'Phase 22Q — wall-clock instant when the schedule was last edited.';

COMMENT ON COLUMN public.turath_masr_orders.scheduled_delivery_updated_by IS
  'Phase 22Q — display name of the admin who last edited the '
  'schedule. Surfaces on the admin status-history view alongside the '
  'standard changed_by stamp.';


-- =============================================================================
-- POST-MIGRATION VERIFICATION (run manually after applying):
--
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND table_name   = 'turath_masr_orders'
--      AND column_name LIKE 'scheduled_delivery_%'
--    ORDER BY column_name;
--   -- expect: 6 rows, all is_nullable='YES'.
--
--   SELECT count(*)
--     FROM public.turath_masr_orders
--    WHERE scheduled_delivery_date IS NOT NULL;
--   -- expect: 0 rows immediately after the migration runs.
-- =============================================================================
