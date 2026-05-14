-- Phase Orders-Checkout-1 (staged only)
--
-- The checkout additions are stored in the existing orders.notes field
-- as a compact JSON envelope because the orders table has no metadata
-- column. The token tracking page needs only that safe checkout envelope,
-- not raw staff notes, so this RPC exposes `checkout_details` without
-- widening public access to internal notes.

DROP FUNCTION IF EXISTS public.get_tracking_info_by_token(uuid, boolean);

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
    checkout_details            jsonb,
    warranty                    text,
    "date"                      text,
    created_at                  timestamptz,
    updated_at                  timestamptz,
    scheduled_delivery_date     date,
    scheduled_delivery_from     time,
    scheduled_delivery_to       time,
    scheduled_delivery_reason   text,
    delegate_name               text,
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
    CASE
      WHEN o.notes LIKE '%[[TURATH_CHECKOUT_DETAILS_V1]]%[[/TURATH_CHECKOUT_DETAILS_V1]]%' THEN
        substring(
          o.notes
          FROM '\[\[TURATH_CHECKOUT_DETAILS_V1\]\](.*)\[\[/TURATH_CHECKOUT_DETAILS_V1\]\]'
        )::jsonb
      ELSE NULL
    END AS checkout_details,
    o.warranty,
    o.date,
    o.created_at,
    o.updated_at,
    o.scheduled_delivery_date,
    o.scheduled_delivery_from,
    o.scheduled_delivery_to,
    o.scheduled_delivery_reason,
    o.delegate_name,
    p.phone AS delegate_phone
  FROM public.turath_masr_orders o
  LEFT JOIN public.profiles p ON p.id = o.assigned_to
  WHERE o.tracking_token = p_tracking_token
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_tracking_info_by_token(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tracking_info_by_token(uuid, boolean) TO anon;

COMMENT ON FUNCTION public.get_tracking_info_by_token(uuid, boolean) IS
  'Public token tracking DTO. Exposes safe checkout_details JSON only; raw notes remain private.';
