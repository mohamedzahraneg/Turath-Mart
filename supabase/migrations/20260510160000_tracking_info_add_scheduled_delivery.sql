-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 22Q — surface the customer-facing delivery schedule and the
-- assigned delegate name on the public token-keyed tracking RPC.
--
-- Background
--   Phase 22Q's StatusUpdateModal writes
--     scheduled_delivery_date / from / to / reason
--   onto `turath_masr_orders` (added in
--   `20260510150000_orders_add_scheduled_delivery.sql`). The
--   customer-facing tracking page on `/track/t/<token>` should
--   render those fields plus a "مندوب الشحن" card with the
--   admin-entered delegate display name.
--
--   The token-tracking endpoint reads through the SECURITY DEFINER
--   RPC `public.get_tracking_info_by_token`, which whitelists the
--   columns it returns. To expose the new fields, this migration
--   re-issues the function with five new columns added to the
--   RETURNS TABLE and the SELECT projection:
--     • `scheduled_delivery_date    date`
--     • `scheduled_delivery_from    time`
--     • `scheduled_delivery_to      time`
--     • `scheduled_delivery_reason  text`
--     • `delegate_name              text`
--
--   The privacy decision per Phase 22Q follows the same posture as
--   Phase 22N-Fix3: the unguessable token URL means anyone with the
--   link is treated as the customer for that one order. Showing
--   them the schedule + delegate display name is consistent with
--   showing them the customer name, address, and itemised lines
--   (already exposed by Phase 22H on the same RPC). We do NOT
--   expose:
--     • `scheduled_delivery_updated_at` / `_updated_by` — admin
--       audit metadata, not customer-relevant.
--     • `assigned_to` (uuid → auth.users) — internal user identity.
--     • `notes`, `phone2`, internal admin fields — already redacted.
--
--   The order-num-keyed RPC `public.get_tracking_info(text)` is NOT
--   widened. Its key is enumerable, so we keep its column whitelist
--   conservative; the customer who has the unguessable token URL is
--   the only viewer who sees the schedule + delegate.
--
-- Why DROP + CREATE
--   PostgreSQL doesn't allow `CREATE OR REPLACE FUNCTION` to alter
--   the row type of a function that returns a TABLE. The standard
--   pattern is `DROP FUNCTION IF EXISTS` → `CREATE`. Re-running this
--   migration on a database that already has the new shape rewrites
--   the definition idempotently.
--
-- DEPLOY GATE — DO NOT APPLY WITHOUT EXPLICIT APPROVAL
--   Apply ALONGSIDE `20260510150000_orders_add_scheduled_delivery.sql`.
--   Without that companion migration the new columns referenced by
--   the SELECT below do not exist and `CREATE FUNCTION` will fail.
--   Apply order:
--     1. 20260510150000_orders_add_scheduled_delivery.sql
--     2. 20260510160000_tracking_info_add_scheduled_delivery.sql   ← this
--   Then merge + deploy the matching client code in PR.
--
-- All grant / revoke statements at the bottom mirror the previous
-- definition (Phase 22N-Fix3) so re-running on a fresh database
-- reproduces the production state exactly.
-- ─────────────────────────────────────────────────────────────────────────────


-- The two-arg signature (with `p_include_images boolean DEFAULT false`)
-- is what production has after Phase 22N-Fix3. We DROP first because
-- the RETURNS TABLE shape is changing (added columns) and PostgreSQL
-- won't allow CREATE OR REPLACE to redefine the row type.
DROP FUNCTION IF EXISTS public.get_tracking_info_by_token(uuid, boolean);
DROP FUNCTION IF EXISTS public.get_tracking_info_by_token(uuid);

CREATE OR REPLACE FUNCTION public.get_tracking_info_by_token(
  p_tracking_token uuid,
  p_include_images boolean DEFAULT false
)
  RETURNS TABLE (
    order_num                   text,
    status                      text,
    customer                    text,
    phone_masked                text,
    region                      text,
    district                    text,
    neighborhood                text,
    address                     text,
    products                    text,
    quantity                    integer,
    lines                       jsonb,
    subtotal                    numeric,
    shipping_fee                numeric,
    extra_shipping_fee          numeric,
    free_shipping               boolean,
    total                       numeric,
    warranty                    text,
    "date"                      text,
    created_at                  timestamptz,
    updated_at                  timestamptz,
    -- Phase 22Q — added columns. Same privacy posture as the rest
    -- of the Phase 22H widened response: customer-relevant fields
    -- only, no admin-internal audit metadata.
    scheduled_delivery_date     date,
    scheduled_delivery_from     time,
    scheduled_delivery_to       time,
    scheduled_delivery_reason   text,
    delegate_name               text
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT
    o.order_num,
    o.status,
    o.customer,
    -- Server-side phone masking (same shape as Phase 22N-Fix3).
    CASE
      WHEN o.phone IS NULL OR o.phone = '' THEN ''
      WHEN length(o.phone) >= 11 THEN
        substr(o.phone, 1, 4) || '****' || substr(o.phone, length(o.phone) - 2)
      WHEN length(o.phone) >= 7 THEN
        substr(o.phone, 1, 3) || '****' || substr(o.phone, length(o.phone) - 2)
      ELSE '****'
    END AS phone_masked,
    o.region,
    o.district,
    o.neighborhood,
    o.address,
    o.products,
    o.quantity,
    CASE
      WHEN o.lines IS NULL THEN NULL
      WHEN p_include_images THEN (
        SELECT COALESCE(jsonb_agg(elem - 'note'), '[]'::jsonb)
        FROM jsonb_array_elements(o.lines) AS elem
      )
      ELSE (
        SELECT COALESCE(jsonb_agg(elem - 'image' - 'note'), '[]'::jsonb)
        FROM jsonb_array_elements(o.lines) AS elem
      )
    END AS lines,
    o.subtotal,
    o.shipping_fee,
    o.extra_shipping_fee,
    o.free_shipping,
    o.total,
    o.warranty,
    o.date,
    o.created_at,
    o.updated_at,
    -- Phase 22Q — pass-through. NULL for orders that never received
    -- a schedule from the admin StatusUpdateModal.
    o.scheduled_delivery_date,
    o.scheduled_delivery_from,
    o.scheduled_delivery_to,
    o.scheduled_delivery_reason,
    o.delegate_name
  FROM public.turath_masr_orders o
  WHERE o.tracking_token = p_tracking_token
  LIMIT 1;
$$;

REVOKE ALL    ON FUNCTION public.get_tracking_info_by_token(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tracking_info_by_token(uuid, boolean) TO anon;
GRANT EXECUTE ON FUNCTION public.get_tracking_info_by_token(uuid, boolean) TO authenticated;

COMMENT ON FUNCTION public.get_tracking_info_by_token(uuid, boolean) IS
  'Phase 22H-widened public tracking RPC. Phase 22Q adds the '
  '`scheduled_delivery_*` window and the assigned `delegate_name` '
  'to the column whitelist so the public token-tracking page can '
  'render a delivery-schedule card and a delegate card. Admin-only '
  'audit metadata (`scheduled_delivery_updated_at`, '
  '`scheduled_delivery_updated_by`, `assigned_to`, `notes`, '
  '`phone2`) remains redacted.';


-- =============================================================================
-- POST-MIGRATION VERIFICATION (run manually after applying):
--
--   -- expect: function returns the new shape with five added columns.
--   SELECT pg_get_function_result(oid)
--     FROM pg_proc
--    WHERE proname = 'get_tracking_info_by_token';
--
--   -- expect: a single row with the new columns visible (NULL for
--   -- orders that never received a schedule, populated for orders
--   -- where StatusUpdateModal saved a delivery window).
--   SELECT order_num, scheduled_delivery_date, scheduled_delivery_from,
--          scheduled_delivery_to, scheduled_delivery_reason, delegate_name
--     FROM public.get_tracking_info_by_token(
--       (SELECT tracking_token FROM public.turath_masr_orders LIMIT 1)
--     );
-- =============================================================================
