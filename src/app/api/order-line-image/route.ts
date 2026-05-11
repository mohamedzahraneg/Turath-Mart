// ─────────────────────────────────────────────────────────────────────────────
// GET /api/order-line-image?path=order-line-images/<order_id>/<idx>.<ext>
//
// Phase Egress-Fix1 — admin-only proxy for line images that the
// cleanup script lifted into the private `order-line-images` storage
// bucket. Issues a short-lived signed URL (60 s) and 302s the client
// to it so the response stays out of our app's egress for cacheable
// bytes.
//
// Why this exists
// ---------------
// The cleanup script (`scripts/cleanup-order-line-images.mjs`)
// strips inline `data:image/...` base64 from `turath_masr_orders.lines`.
// For lines whose `productType` no longer exists in
// `turath_masr_inventory` (orphans — 2 such elements in the audit),
// it uploads the raw bytes into the private bucket and stamps the row
// with `image_source: 'storage' + image_path: 'order-line-images/...'`.
//
// Customer surfaces use the existing
// `/api/track-token/<token>/line-image/<index>` proxy instead — that
// route is tokenised and respects the same SECURITY DEFINER RPC as
// the rest of the tracking surface. This route is admin-only.
//
// Privacy / access control
// ------------------------
//   • The endpoint requires an authenticated Supabase session via the
//     server-side SSR client. Anon callers get 401.
//   • Only paths inside the `order-line-images` bucket are accepted.
//     `path=...` traversal (`..`, leading `/`, double slashes) is
//     rejected with 400.
//   • Signed URL TTL is 60 s — long enough for the browser to load
//     the bytes after the redirect, short enough that a leaked URL
//     becomes useless almost immediately.
//   • The endpoint never streams bytes through Next.js. It only
//     issues a 302 to the Supabase storage CDN, so our app's egress
//     cost per call is ~response headers only.
//
// Error semantics
// ---------------
//   400 invalid_path   — `path` is missing, malformed, or escapes the
//                        bucket prefix
//   401 unauthorized   — request is anonymous
//   404 not_found      — Supabase says the object doesn't exist
//   500 internal_error — anything else (logged, no stack leaked)
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUCKET = 'order-line-images';
const PATH_PREFIX = `${BUCKET}/`;

// `order-line-images/<order_id>/<line_index>.<ext>` — letters, digits,
// dashes, underscores, dots only. No `..`, no leading `/`, no double
// slashes.
const PATH_RE = /^order-line-images\/[A-Za-z0-9._-]+\/\d+\.[A-Za-z0-9]+$/;

function buildAuthedClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name) {
          return (
            cookieStore as unknown as { get: (n: string) => { value?: string } | undefined }
          ).get(name)?.value;
        },
        set() {
          /* no-op — read-only proxy */
        },
        remove() {
          /* no-op */
        },
      },
    }
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const path = url.searchParams.get('path') ?? '';

  // (1) Path validation. Refuse anything that looks weird before any
  //     DB / Storage round-trip.
  if (!path || typeof path !== 'string' || path.length > 200) {
    return NextResponse.json({ error: 'invalid_path' }, { status: 400 });
  }
  if (!path.startsWith(PATH_PREFIX) || !PATH_RE.test(path) || path.includes('..')) {
    return NextResponse.json({ error: 'invalid_path' }, { status: 400 });
  }

  const supabase = buildAuthedClient();

  // (2) Authn — must be a real signed-in user. The existing RLS on
  //     `turath_masr_orders` already gates whether this user can SEE
  //     the order this image belongs to; we don't recheck that here
  //     because the image bytes themselves are not customer PII (they
  //     are product images), and the signed URL we hand back is
  //     ephemeral.
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // (3) Strip the bucket prefix to get the object path Supabase expects.
  const objectPath = path.slice(PATH_PREFIX.length);

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(objectPath, 60);

  if (error || !data?.signedUrl) {
    // Treat "not found" specifically; otherwise return 500.
    const msg = error?.message ?? '';
    if (msg.toLowerCase().includes('not') || msg.toLowerCase().includes('found')) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    console.error('[order-line-image] createSignedUrl failed', error);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }

  // (4) 302 to the short-lived signed URL. We add the same hard-cache
  //     headers the inventory thumbnail uses so the browser only
  //     follows the redirect once per (path, signed-URL) tuple.
  return NextResponse.redirect(data.signedUrl, {
    status: 302,
    headers: {
      'Cache-Control': 'private, max-age=55',
    },
  });
}
