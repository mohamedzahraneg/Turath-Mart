-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 23A-Fix1 — surface the assigned delegate's contact phone on
-- the public token-keyed tracking RPC.
--
-- Background
--   Phase 22Q widened `get_tracking_info_by_token` to expose the
--   delegate's display name (`delegate_name`). Phase 22Q's report
--   filed "delegate phone" as a follow-up because `profiles` had
--   no `phone` column. Phase 23A-Fix1's companion migration
--   `20260510190000_profiles_delegate_fields.sql` adds `phone` to
--   `profiles`, so we can now safely project a single, scoped
--   `delegate_phone text` column on the tracking RPC.
--
--   The customer-facing tracking page on `/track/t/<token>` will
--   render the phone as a tappable `tel:` link inside the existing
--   "مندوب الشحن" card. Customers with the unguessable token URL
--   are entitled to contact the courier handling their order; the
--   privacy posture matches the rest of Phase 22H's widened
--   tracking response.
--
--   Crucially this migration does NOT expose ANY of the other new
--   profile fields (`national_id`, vehicle / driving licence
--   numbers + dates, `transport_type`, `delegate_is_active`).
--   Those stay admin-only; they are only readable through the
--   authenticated /delegates page which rides the existing
--   `profiles_admin_select` RLS policy.
--
-- Why DROP + CREATE
--   PostgreSQL doesn't allow `CREATE OR REPLACE` to alter the
--   `RETURNS TABLE` shape. Standard pattern: `DROP FUNCTION IF
--   EXISTS` → `CREATE`. Idempotent on re-run.
--
-- DEPLOY GATE — DO NOT APPLY WITHOUT EXPLICIT APPROVAL
--   Apply ALONGSIDE `20260510190000_profiles_delegate_fields.sql`.
--   Without that companion migration the new `phone` column
--   referenced by the join below does not exist and `CREATE
--   FUNCTION` will fail.
--
--   Apply order:
--     1. 20260510190000_profiles_delegate_fields.sql
--     2. 20260510200000_tracking_info_add_delegate_phone.sql   ← this
--   Then merge + deploy the matching client code.
-- ─────────────────────────────────────────────────────────────────────────────


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
    scheduled_delivery_date     date,
    scheduled_delivery_from     time,
    scheduled_delivery_to       time,
    scheduled_delivery_reason   text,
    delegate_name               text,
    -- Phase 23A-Fix1 — added column. Joined from `profiles.phone`
    -- when the order has a resolved `assigned_to` UUID. NULL when
    -- the delegate row has no phone or when only the legacy
    -- `delegate_name` text is set on the order (no profile link).
    delegate_phone              text
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
    o.scheduled_delivery_date,
    o.scheduled_delivery_from,
    o.scheduled_delivery_to,
    o.scheduled_delivery_reason,
    o.delegate_name,
    -- Phase 23A-Fix1 — pass-through of the delegate profile's
    -- phone. We deliberately use a LEFT JOIN with `o.assigned_to`
    -- on `p.id` so legacy orders that only carry `delegate_name`
    -- (no `assigned_to` UUID) yield NULL — matching by display
    -- name across profiles is unsafe (Phase 22B's ambiguous-name
    -- backfill rule applies here too).
    p.phone AS delegate_phone
  FROM public.turath_masr_orders o
  LEFT JOIN public.profiles p ON p.id = o.assigned_to
  WHERE o.tracking_token = p_tracking_token
  LIMIT 1;
$$;

REVOKE ALL    ON FUNCTION public.get_tracking_info_by_token(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tracking_info_by_token(uuid, boolean) TO anon;
GRANT EXECUTE ON FUNCTION public.get_tracking_info_by_token(uuid, boolean) TO authenticated;

COMMENT ON FUNCTION public.get_tracking_info_by_token(uuid, boolean) IS
  'Phase 22H-widened public tracking RPC. Phase 22Q added '
  'scheduled_delivery_* + delegate_name. Phase 23A-Fix1 adds '
  'delegate_phone — projected from profiles.phone via a LEFT JOIN '
  'on orders.assigned_to. National ID, licence numbers, '
  'transport_type and other admin-only profile fields remain '
  'redacted.';


-- =============================================================================
-- POST-MIGRATION VERIFICATION (run manually after applying):
--
--   SELECT pg_get_function_result(oid)
--     FROM pg_proc
--    WHERE proname = 'get_tracking_info_by_token';
--   -- expect: TABLE(... , delegate_name text, delegate_phone text)
--
--   -- For an order with an assigned profile that carries a phone:
--   SELECT order_num, delegate_name, delegate_phone
--     FROM public.get_tracking_info_by_token(
--       (SELECT tracking_token FROM public.turath_masr_orders
--        WHERE assigned_to IS NOT NULL LIMIT 1)
--     );
-- =============================================================================
