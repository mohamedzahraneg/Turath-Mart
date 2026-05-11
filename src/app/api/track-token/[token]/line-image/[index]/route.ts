// ─────────────────────────────────────────────────────────────────────────────
// GET /api/track-token/[token]/line-image/[index]
//
// Phase 22H-Fix1 — serve a single product image for the order behind
// `token`, one line at a time, as raw image bytes (Content-Type:
// image/<jpeg|png|...>). Decodes the base64 `data:` URL stored in
// turath_masr_orders.lines[index].image and returns it with
// aggressive Cache-Control so the browser + CDN load it once.
//
// Why not pass base64 through the polling DTO?
//   /track/t/[token] polls /api/track-token/[token] every 30 s. The
//   line images are 70-200 KB of base64 each (avg ~100 KB). Stuffing
//   them into the polling DTO would burn ~200 KB / 30 s for the
//   entire viewing session. Phase 22H deliberately stripped them
//   server-side for that reason.
//
//   This endpoint serves the same bytes once per (token, index),
//   on demand, with `Cache-Control: public, max-age=86400, immutable`.
//   Order content never mutates after creation, so the cache is safe.
//
// Privacy:
//   - The token is the same unguessable per-order UUID used by
//     /api/track-token/[token]. Anyone with the token already has
//     read access to every public-facing detail of the order via
//     the existing endpoint. Allowing them to load the product
//     image they ordered is consistent with that trust model.
//   - The endpoint never returns base64 strings on the wire — it
//     decodes server-side and ships raw image bytes.
//   - The DB still owns masking / projection: this endpoint calls
//     the existing SECURITY DEFINER RPC `get_tracking_info_by_token`
//     with `p_include_images = true`, so all the same withholds
//     (phone2, notes, audit fields, delegate identity, tracking_token
//     itself, lines.note) apply.
//
// Error semantics:
//   400 invalid_token   — token is not a 36-char hex UUID
//   400 invalid_index   — index is not a small non-negative integer
//   404 not_found       — token unknown OR line out of range OR no image
//   500 internal_error  — Supabase RPC error
//   500 bad_image_format — stored image is not a recognised data URL
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Sanity bound on line index. Real orders have <10 lines; 50 is a
// generous upper bound that still rejects path-walking attempts.
const MAX_LINE_INDEX = 50;

function buildAnonClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: () => undefined,
        set: () => {},
        remove: () => {},
      },
    }
  );
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string; index: string }> }
) {
  const { token, index } = await context.params;

  if (!token || typeof token !== 'string' || token.length !== 36 || !UUID_RE.test(token)) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 400 });
  }

  const idx = Number.parseInt(index, 10);
  if (!Number.isInteger(idx) || idx < 0 || idx > MAX_LINE_INDEX || String(idx) !== index) {
    return NextResponse.json({ error: 'invalid_index' }, { status: 400 });
  }

  const supabase = buildAnonClient();

  const { data: rows, error } = await supabase.rpc('get_tracking_info_by_token', {
    p_tracking_token: token,
    p_include_images: true,
  });

  if (error) {
    console.error('[track-token-line-image] RPC failed', error);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }

  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const lines = (row as { lines?: unknown }).lines;
  if (!Array.isArray(lines) || idx >= lines.length) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const line = lines[idx] as {
    image?: unknown;
    image_source?: unknown;
    image_path?: unknown;
    productType?: unknown;
  } | null;

  // Phase Egress-Fix1 — after the cleanup script runs, `image` is no
  // longer a base64 data URL. Lines now carry one of:
  //
  //   • `image_source: 'inventory'` + `productType` — 302 to the
  //     existing inventory thumbnail endpoint (raw bytes, hard cache).
  //   • `image_source: 'storage'` + `image_path` — 302 to a 60-s
  //     signed URL on the private `order-line-images` bucket.
  //   • Legacy: `image` still holds a `data:image/...` URL because
  //     the cleanup hasn't run for this row yet. We decode + serve
  //     bytes as we did pre-Phase-Egress-Fix1 (backward compat).
  //
  // The 60-s cache header on the redirect keeps the browser following
  // the 302 only when the underlying signed URL is fresh, which
  // matches the signed-URL TTL.

  if (line && line.image_source === 'inventory' && typeof line.productType === 'string') {
    return NextResponse.redirect(
      new URL(
        `/api/inventory/${encodeURIComponent(line.productType)}/thumbnail`,
        new URL(_request.url)
      ),
      {
        status: 302,
        headers: { 'Cache-Control': 'public, max-age=86400' },
      }
    );
  }

  if (line && line.image_source === 'storage' && typeof line.image_path === 'string') {
    const path = line.image_path;
    if (!path.startsWith('order-line-images/')) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    const objectPath = path.slice('order-line-images/'.length);
    const { data: signed, error: signedErr } = await supabase.storage
      .from('order-line-images')
      .createSignedUrl(objectPath, 60);
    if (signedErr || !signed?.signedUrl) {
      console.error('[track-token-line-image] storage signed URL failed', signedErr);
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.redirect(signed.signedUrl, {
      status: 302,
      headers: { 'Cache-Control': 'public, max-age=55' },
    });
  }

  // Legacy `data:image/...` path — kept until every row is cleaned up.
  const dataUrl = line && typeof line.image === 'string' ? line.image : '';
  if (!dataUrl.startsWith('data:image/')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  // Parse `data:image/<subtype>[;params];base64,<payload>`. We accept
  // optional ;charset= or other params before the base64 marker.
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+)(?:;[^,]+)?;base64,([\s\S]+)$/);
  if (!match) {
    console.error('[track-token-line-image] unrecognised data URL format');
    return NextResponse.json({ error: 'bad_image_format' }, { status: 500 });
  }

  const mimeType = match[1];
  const base64 = match[2];
  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64, 'base64');
  } catch (e) {
    console.error('[track-token-line-image] base64 decode failed', e);
    return NextResponse.json({ error: 'bad_image_format' }, { status: 500 });
  }

  // The image is a stable property of an existing order line. Cache
  // hard so the browser + CDN don't repeat the decode + transfer on
  // every poll. `immutable` tells well-behaved caches not to
  // revalidate within max-age.
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': mimeType,
      'Content-Length': String(bytes.length),
      'Cache-Control': 'public, max-age=86400, immutable',
    },
  });
}
