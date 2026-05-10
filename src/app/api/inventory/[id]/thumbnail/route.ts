// ─────────────────────────────────────────────────────────────────────────────
// GET /api/inventory/[id]/thumbnail
//
// Phase E1-Fix1.1 — serve a single inventory product thumbnail as raw
// image bytes (Content-Type: image/<jpeg|png|webp|...>). Used by the
// Add Order modal product-card grid to populate per-product images
// WITHOUT shipping the heavy `images` jsonb / text[] payload through
// the JSON list query.
//
// Why this endpoint exists
//   The previous flow opened `AddOrderModal` with
//   `turath_masr_inventory.select('*')`, which pulled the `images`
//   array (base64 thumbnails — currently ~108 KB per row, ~648 KB
//   total). Phase E1-Fix1 narrowed the list query to drop `images`
//   from the wire entirely, which removed the egress cost but also
//   removed the per-card thumbnail. This route restores the
//   thumbnail one image at a time, lazily, so the browser only pays
//   for images of the products the admin actually scrolls past — and
//   pays exactly once per (id, viewport size) thanks to aggressive
//   cache headers + Next.js `<Image>` optimisation.
//
// Wire-cost arithmetic
//   - Old flow: 1 list query × ~648 KB ≈ 648 KB per modal open
//   - New flow: ≤ N parallel thumbnail requests at first paint, each
//     served as raw bytes (no base64 expansion ≈ -33% size before
//     resizing) and cached for 24 h. After the first paint,
//     Next.js's `/_next/image` optimiser serves resized WebP/AVIF
//     from its own LRU cache, so repeat renders are near-zero
//     egress.
//
// Privacy / authorisation
//   - We use the SSR Supabase client with the request's cookies, so
//     RLS gates access exactly as the existing list query does:
//     authenticated users (admins) read freely, anonymous browsers
//     get the same RLS rejection they would get hitting
//     `/rest/v1/turath_masr_inventory` directly. No service-role
//     bypass.
//   - We project ONLY the `images` column for the row. No other
//     inventory columns leave the DB on this path.
//   - The 200 response carries `Cache-Control: public` because the
//     payload is the inventory product photo — already intended for
//     end-customer viewing once orders ship. The 404 / 400 responses
//     intentionally carry no long-cache header so a session change
//     (anonymous → admin) isn't blocked by a stale rejection.
//
// Image-format handling
//   1. If the stored value is a `data:image/<subtype>;base64,...` URL
//      we decode + serve the raw bytes with the original mime type.
//      This is the format actually present in production today.
//   2. If the stored value is `http://` / `https://` we 302-redirect
//      to it. Same-origin remote storage (e.g. Supabase Storage) is
//      already a viable destination for future uploads.
//   3. If the stored value is a relative `/...` path we 302-redirect
//      to the same-origin URL.
//   4. Anything else, no image stored, or RLS rejection → 404 so the
//      <Image> client component can fall back to its emoji glyph via
//      `onError`.
//
// We deliberately do NOT add `sharp` here. Next.js's `/_next/image`
// optimiser already resizes + transcodes to WebP/AVIF on demand
// based on the `<Image>` component's `sizes` prop, so a second
// resize layer would only duplicate work. If a future phase adds
// `sharp` for other reasons we can swap in server-side resizing
// here without changing the public contract.
//
// Error semantics:
//   400 invalid_id     — path param is not a 36-char hex UUID
//   404 not_found      — RLS rejection, missing row, empty images,
//                        or unknown image-string shape
//   500 bad_image_format — a stored data: URL didn't parse
//   500 internal_error — Supabase client error
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

export const runtime = 'nodejs';
// Tracking responses are gated by a session-bound RLS check, so
// we don't want a build-time pre-render. Cache-Control on the
// successful response handles edge / browser caching instead.
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function buildSupabaseClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value, options } of cookiesToSet) {
            try {
              cookieStore.set(name, value, options);
            } catch {
              // Route handlers can't always mutate cookies; ignored
              // on purpose — the SSR client only sets when refreshing
              // an access token, which is fine to skip on a thumbnail
              // GET (the next user-driven request will refresh).
            }
          }
        },
      },
    }
  );
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  // Cheap shape-level rejection before we hit the DB.
  if (!id || typeof id !== 'string' || id.length !== 36 || !UUID_RE.test(id)) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  }

  const supabase = await buildSupabaseClient();

  // Project only the column we actually need. RLS on
  // turath_masr_inventory gates this to authenticated readers; an
  // anonymous browser will receive an empty / errored result here
  // and we'll fall through to the 404 path below.
  const { data, error } = await supabase
    .from('turath_masr_inventory')
    .select('images')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    // Distinguish RLS rejection from a real Supabase failure.
    // PostgREST returns 4xx / 5xx through the JS client as `error`;
    // we treat all of them as 404 from the client's POV (so the
    // emoji fallback fires) but log for diagnostics.
    if (error.code !== 'PGRST116') {
      console.error('[inventory-thumbnail] supabase error', { id, error });
    }
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  if (!data) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const images = (data as { images?: unknown }).images;
  const first =
    Array.isArray(images) && images.length > 0 && typeof images[0] === 'string'
      ? (images[0] as string)
      : null;

  if (!first) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // 1. data:image/<subtype>[;params];base64,<payload>
  if (first.startsWith('data:image/')) {
    const match = first.match(/^data:(image\/[a-zA-Z0-9+.-]+)(?:;[^,]+)?;base64,([\s\S]+)$/);
    if (!match) {
      console.error('[inventory-thumbnail] unrecognised data URL format', { id });
      return NextResponse.json({ error: 'bad_image_format' }, { status: 500 });
    }
    const mimeType = match[1];
    const base64 = match[2];
    let bytes: Buffer;
    try {
      bytes = Buffer.from(base64, 'base64');
    } catch (e) {
      console.error('[inventory-thumbnail] base64 decode failed', { id, e });
      return NextResponse.json({ error: 'bad_image_format' }, { status: 500 });
    }
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(bytes.length),
        // Inventory product photos rarely change; treat as immutable
        // for one day. If admins re-upload, the worst case is a
        // 24-hour stale thumbnail in browsers / CDN.
        'Cache-Control': 'public, max-age=86400, immutable',
      },
    });
  }

  // 2. http(s):// — let the browser fetch the upstream directly.
  //    We avoid proxying the bytes here so we don't double the
  //    egress through this server.
  if (first.startsWith('http://') || first.startsWith('https://')) {
    return NextResponse.redirect(first, { status: 302 });
  }

  // 3. /-prefixed local path — same-origin redirect.
  if (first.startsWith('/')) {
    return NextResponse.redirect(new URL(first, request.url), { status: 302 });
  }

  // Unknown shape — let the client fall back to the emoji.
  return NextResponse.json({ error: 'not_found' }, { status: 404 });
}
