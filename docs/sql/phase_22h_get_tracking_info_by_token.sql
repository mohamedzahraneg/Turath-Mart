-- Phase 22H + Phase 22H-Fix1 — final state of
-- public.get_tracking_info_by_token(uuid, boolean).
--
-- This file is documentation-only. The SQL below has ALREADY BEEN
-- APPLIED to production via the Supabase MCP across three migrations:
--
--   Phase 22H — PR #25:
--   1. phase_22h_widen_get_tracking_info_by_token
--      DROP + CREATE that added customer, phone_masked (server-side
--      masking), district, address, lines, subtotal, shipping_fee,
--      extra_shipping_fee, free_shipping, total to the projection.
--
--   2. phase_22h_strip_image_and_note_from_tracking_lines
--      CREATE OR REPLACE that narrowed the lines element shape via
--      `jsonb_agg(elem - 'image' - 'note')` so per-line base64 image
--      data and delegate-only notes never reach the wire on the
--      polling DTO.
--
--   Phase 22H-Fix1 — PR (this PR):
--   3. phase_22h_fix1_token_rpc_optional_images
--      DROP + CREATE that adds an optional `p_include_images boolean
--      DEFAULT false` parameter. The default behaviour matches
--      Phase 22H exactly (image+note stripped from lines). When the
--      caller passes `p_include_images = true`, lines.image is kept
--      while lines.note is still stripped — used only by the
--      /api/track-token/[token]/line-image/[index] endpoint, which
--      decodes the base64 data URL and serves raw image bytes
--      with `Cache-Control: public, max-age=86400, immutable`.
--      The polling endpoint /api/track-token/[token] still calls
--      this RPC without the second argument so the polling DTO
--      stays at ~430 bytes for `lines`.
--
-- DO NOT RE-RUN this script as part of any deploy. The Supabase
-- migration history table is the source of truth; this file exists so
-- the final RPC body is reviewable in git diffs and replayable to a
-- fresh staging / disaster-recovery database if ever needed.
--
-- Companion code:
--   src/app/api/track-token/[token]/route.ts                       — slim DTO
--   src/app/api/track-token/[token]/line-image/[index]/route.ts    — image bytes
--   src/app/track/t/[token]/page.tsx                                — render
--
-- Privacy boundary (unchanged from pre-Phase-22H):
--   • SECURITY DEFINER + explicit search_path = public.
--   • EXECUTE granted to anon + authenticated.
--   • The token URL is an unguessable per-order UUID (Phase 13B), so
--     a holder of the token is treated as the customer.
--   • Withheld vs the underlying turath_masr_orders row by design:
--       phone2, notes, ip,
--       created_by, created_by_ip, created_by_location,
--       created_by_device, created_by_user_id,
--       updated_by, assigned_to, delegate_name,
--       tracking_token itself.
--   • Phone is masked SERVER-SIDE so the un-masked number never leaves
--     the database. Format keeps the operator prefix (010, 011, 012,
--     015) and the last 3 digits visible.
--   • lines.note is always stripped per element before the jsonb leaves
--     the function.
--   • lines.image is stripped UNLESS the caller explicitly opts in via
--     p_include_images=true. Even when included, the base64 data URL
--     is never returned to the browser — the dedicated /line-image/
--     endpoint decodes it server-side and serves raw image bytes.
--
-- IMPORTANT: do NOT widen public.get_tracking_info(text). That RPC is
-- keyed by the short / sequential `order_num` and must stay redacted
-- to avoid enumeration risk.

DROP FUNCTION IF EXISTS public.get_tracking_info_by_token(uuid);
DROP FUNCTION IF EXISTS public.get_tracking_info_by_token(uuid, boolean);

CREATE FUNCTION public.get_tracking_info_by_token(
  p_tracking_token uuid,
  p_include_images boolean DEFAULT false
)
 RETURNS TABLE(
   order_num text,
   status text,
   customer text,
   phone_masked text,
   region text,
   district text,
   address text,
   products text,
   quantity integer,
   lines jsonb,
   subtotal numeric,
   shipping_fee numeric,
   extra_shipping_fee numeric,
   free_shipping boolean,
   total numeric,
   warranty text,
   date text,
   created_at timestamp with time zone,
   updated_at timestamp with time zone
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    o.address,
    o.products,
    o.quantity,
    -- Default mode (polling): strip image + note. ~430 bytes per line.
    -- p_include_images=true: keep image, still strip note. Used only
    -- by /api/track-token/[token]/line-image/[index].
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
$function$;

GRANT EXECUTE ON FUNCTION public.get_tracking_info_by_token(uuid, boolean) TO anon;
GRANT EXECUTE ON FUNCTION public.get_tracking_info_by_token(uuid, boolean) TO authenticated;
