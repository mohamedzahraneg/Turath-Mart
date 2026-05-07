// ─────────────────────────────────────────────────────────────────────────────
// GET /api/track-token/[token]
//
// Phase 13B: token-keyed counterpart of /api/track/[orderId].
//
// Why a separate route?
//   /api/track/[orderId] continues to look up by `order_num` for backward
//   compatibility with all tracking links already issued to customers via
//   WhatsApp / SMS. The new public links generated in Phase 13C will use
//   an unguessable per-order UUID `tracking_token` instead, mitigating the
//   enumeration risk inherent in the short, sequential `order_num`.
//
// Implementation:
//   - Validates the [token] param as a strict v4-shaped UUID before any
//     DB call (zero round-trip on garbage input).
//   - Calls the SECURITY DEFINER RPC `public.get_tracking_info_by_token`
//     which returns ONLY whitelisted, non-PII columns (no phone, no
//     address, no financials, no notes, no audit-log internals,
//     no tracking_token in the response — leaking it back would defeat
//     the unguessable-link property).
//   - Also calls `public.get_tracking_timeline_by_token` for the status
//     timeline (no `changed_by`, no `note`).
//   - Uses the public anon key — no service-role key needed.
//
// Cache: identical to /api/track/[orderId] — 30s CDN, 60s SWR.
//
// Error semantics (mirror /api/track/[orderId] error shape):
//   - 400 invalid_token  — malformed / wrong-shape input
//   - 404 not_found      — UUID is well-formed but no matching order
//   - 500 internal_error — Supabase returned an unexpected error
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export const runtime = 'nodejs';
// Tracking responses are dynamic (status changes); don't statically cache
// at build time, but DO emit Cache-Control headers below for CDN caching.
export const dynamic = 'force-dynamic';

interface TrackingDTO {
  orderNum: string;
  status: string;
  region: string | null;
  products: string | null;
  quantity: number | null;
  warranty: string | null;
  date: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  statusTimeline: Array<{ status: string; changedAt: string }>;
}

// Strict 8-4-4-4-12 hex UUID. We do NOT enforce a specific UUID version
// because gen_random_uuid() can produce v4 today but the format-level
// guarantee is what we need: 36 chars, lowercase hex with dashes.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function buildAnonClient() {
  // Server-side, request-scoped, anon-only Supabase client.
  // We do NOT pass cookies — this endpoint is anonymous on purpose.
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

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;

  // Reject anything that isn't a well-formed UUID before hitting the DB.
  // Length check first (cheapest), then regex.
  if (!token || typeof token !== 'string' || token.length !== 36 || !UUID_RE.test(token)) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 400 });
  }

  const supabase = buildAnonClient();

  // (1) Fetch the redacted order DTO.
  const { data: rows, error: orderErr } = await supabase.rpc('get_tracking_info_by_token', {
    p_tracking_token: token,
  });

  if (orderErr) {
    console.error('[track-token-api] get_tracking_info_by_token failed', orderErr);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }

  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // (2) Fetch the status timeline (also redacted — no changed_by / note).
  const { data: timelineRows, error: timelineErr } = await supabase.rpc(
    'get_tracking_timeline_by_token',
    { p_tracking_token: token }
  );

  if (timelineErr) {
    console.error('[track-token-api] get_tracking_timeline_by_token failed', timelineErr);
    // Non-fatal — return order data without timeline rather than 500.
  }

  const dto: TrackingDTO = {
    orderNum: row.order_num,
    status: row.status,
    region: row.region ?? null,
    products: row.products ?? null,
    quantity: row.quantity ?? null,
    warranty: row.warranty ?? null,
    date: row.date ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    statusTimeline: Array.isArray(timelineRows)
      ? timelineRows.map((t: { new_status: string; changed_at: string }) => ({
          status: t.new_status,
          changedAt: t.changed_at,
        }))
      : [],
  };

  return NextResponse.json(dto, {
    status: 200,
    headers: {
      // Edge / CDN may cache for 30s. Browser must revalidate.
      'Cache-Control': 'public, max-age=0, s-maxage=30, stale-while-revalidate=60',
    },
  });
}
