-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 22N-Fix3 — expose `neighborhood` on the customer-facing
-- token-tracking RPC.
--
-- Background: Phase 22N-Fix3 added a `neighborhood` column on
-- `turath_masr_orders` (see 20260510120000_orders_add_neighborhood.sql).
-- Every admin / direct-link reader was updated to surface it. The
-- public token-tracking endpoint at /api/track-token/[token] reads
-- through `public.get_tracking_info_by_token`, which whitelists the
-- columns it returns. To keep the customer-facing tracking page in
-- parity with every other surface, we re-issue the function with
-- `neighborhood text` added to the RETURNS TABLE and the SELECT.
--
-- Privacy note: `district` (markaz / kism / city) was already exposed
-- by Phase 22H. `neighborhood` is the same level of granularity (the
-- customer's own typed value) and the same privacy posture applies —
-- the token URL is unguessable so a customer who has the link is
-- already entitled to see their full delivery address. We do NOT
-- expose neighborhood on the order-num-keyed RPC
-- (`get_tracking_info`) which is keyed by the enumerable `order_num`.
--
-- Idempotent: `CREATE OR REPLACE FUNCTION` rewrites the definition.
-- The function signature changes (the RETURNS TABLE adds a column),
-- so PostgreSQL requires a DROP first when the new shape disagrees
-- with the old one. The standard pattern is `DROP FUNCTION IF EXISTS`
-- → `CREATE`.
--
-- All grant / revoke statements at the bottom mirror the original
-- 20260507a_tracking_rpc_by_token.sql so re-running this migration
-- on a fresh database reproduces the production state exactly.
-- ─────────────────────────────────────────────────────────────────────────────

-- The two-arg signature (with `p_include_images boolean DEFAULT false`)
-- is what production currently has after Phase 22H. We DROP first
-- because the RETURNS TABLE shape is changing (added column) and
-- PostgreSQL won't allow CREATE OR REPLACE to redefine the row type.
DROP FUNCTION IF EXISTS public.get_tracking_info_by_token(uuid, boolean);
DROP FUNCTION IF EXISTS public.get_tracking_info_by_token(uuid);

CREATE OR REPLACE FUNCTION public.get_tracking_info_by_token(
  p_tracking_token uuid,
  p_include_images boolean DEFAULT false
)
  RETURNS TABLE (
    order_num          text,
    status             text,
    customer           text,
    phone_masked       text,
    region             text,
    district           text,
    -- Phase 22N-Fix3 — added column. Same privacy posture as district.
    neighborhood       text,
    address            text,
    products           text,
    quantity           integer,
    lines              jsonb,
    subtotal           numeric,
    shipping_fee       numeric,
    extra_shipping_fee numeric,
    free_shipping      boolean,
    total              numeric,
    warranty           text,
    "date"             text,
    created_at         timestamptz,
    updated_at         timestamptz
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
    -- Server-side phone masking. Strings shorter than 7 chars degrade
    -- to '****' rather than risk fingerprinting via a short tail.
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
    -- Phase 22N-Fix3 — pass-through. NULL for orders created before
    -- the column existed; AddOrderModal writes the canonical name on
    -- new orders.
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
    o.updated_at
  FROM public.turath_masr_orders o
  WHERE o.tracking_token = p_tracking_token
  LIMIT 1;
$$;

REVOKE ALL    ON FUNCTION public.get_tracking_info_by_token(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tracking_info_by_token(uuid, boolean) TO anon;
GRANT EXECUTE ON FUNCTION public.get_tracking_info_by_token(uuid, boolean) TO authenticated;

COMMENT ON FUNCTION public.get_tracking_info_by_token(uuid, boolean) IS
  'Phase 22H-widened public tracking RPC. Returns customer-facing '
  'order details for the unguessable token-keyed /track/t/<token> '
  'page. Phase 22N-Fix3 adds `neighborhood` to the column whitelist '
  'so the customer''s typed neighborhood / village / shiakha appears '
  'on the public tracking page in parity with the admin views.';

-- =============================================================================
-- POST-MIGRATION VERIFICATION (run manually after applying):
--
--   -- expect: a single row with neighborhood IS NOT NULL when the
--   -- order has a typed neighborhood; otherwise NULL.
--   SELECT order_num, neighborhood
--   FROM public.get_tracking_info_by_token(
--     (SELECT tracking_token FROM public.turath_masr_orders WHERE neighborhood IS NOT NULL LIMIT 1)
--   );
--
--   -- expect: function returns the same shape with the new column.
--   SELECT pg_get_function_result(oid)
--   FROM pg_proc
--   WHERE proname = 'get_tracking_info_by_token';
-- =============================================================================
