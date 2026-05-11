-- ─────────────────────────────────────────────────────────────────────────────
-- Phase Egress-Fix1 — order-line-images private storage bucket.
--
-- This bucket is the spillover destination for the legacy base64 line
-- images that `scripts/cleanup-order-line-images.ts` extracts from
-- `turath_masr_orders.lines`. Only lines whose `productType` UUID does
-- not exist in `turath_masr_inventory` need a copy here — inventory-
-- backed lines just drop `image` and read the inventory thumbnail.
--
-- Egress audit (read-only) found 2 such orphan line elements out of
-- 106 (≈331 kB of base64). After cleanup, those will live here as
-- raw JPEG bytes (~33% smaller than base64), served privately on
-- demand via a signed URL.
--
-- Safety properties
-- -----------------
--   • Brand-new bucket. Idempotent via `ON CONFLICT (id) DO NOTHING`.
--   • Private (`public=false`). All access is via signed URLs created
--     by the service role on the server side.
--   • No public read access. No anon access.
--   • No destructive SQL. No DROP / DELETE / TRUNCATE.
--   • No changes to existing buckets / policies / RLS on other tables.
--
-- DEPLOY GATE — DO NOT APPLY WITHOUT EXPLICIT APPROVAL
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('order-line-images', 'order-line-images', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies are managed by Supabase platform via
-- `storage.objects` RLS. The default Supabase setup grants service-role
-- full read/write on every bucket; authenticated users get read access
-- only via signed URLs (which the platform validates without consulting
-- RLS). We deliberately do NOT add an authenticated SELECT policy here
-- because the server creates short-lived signed URLs on demand.

COMMENT ON TABLE storage.buckets IS
  'Phase Egress-Fix1 — `order-line-images` is private. Server-side service-role uploads + signed URLs only.';


-- =============================================================================
-- POST-MIGRATION VERIFICATION (read-only)
--
--   SELECT id, name, public, file_size_limit, allowed_mime_types
--     FROM storage.buckets WHERE id='order-line-images';
--   -- expect: 1 row, public=false
-- =============================================================================
