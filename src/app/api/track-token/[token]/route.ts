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
//   - Calls the SECURITY DEFINER RPC `public.get_tracking_info_by_token`.
//     The RPC enforces the privacy boundary: phone is masked server-side,
//     and internal columns (phone2, notes, ip, audit fields, delegate_name,
//     assigned_to, tracking_token, lines.image, lines.note) are stripped
//     before the response leaves the database.
//   - Also calls `public.get_tracking_timeline_by_token` for the status
//     timeline (no `changed_by`, no `note`).
//   - Uses the public anon key — no service-role key needed (the RPC is
//     the security boundary).
//
// Phase 22H: the RPC was widened to return customer-facing order details
// (customer name, masked phone, address, lines, totals, free_shipping)
// because the token URL is unguessable. /api/track/[orderId] stays
// redacted — its key is enumerable.
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

// Phase 22H: a per-order line item as returned by the widened RPC.
// `image` and `note` are stripped server-side (image was 70-200 KB
// base64; note may carry delegate-only annotations).
interface TrackingLineDTO {
  productType: string | null;
  label: string | null;
  emoji: string | null;
  color: string | null;
  quantity: number | null;
  unitPrice: number | null;
  total: number | null;
  includeFlashlight: boolean | null;
  flashlightPrice: number | null;
}

interface TrackingDTO {
  orderNum: string;
  status: string;
  // Phase 22H — customer identity + delivery details.
  customer: string | null;
  /** Masked server-side, e.g. `0101****678`. The full phone never leaves the DB. */
  phone: string | null;
  region: string | null;
  district: string | null;
  // Phase 22N-Fix3 — optional neighborhood / village / shiakha. NULL
  // for orders created before the column existed. The
  // `get_tracking_info_by_token` RPC was updated to include the
  // column in its whitelist (see
  // 20260510130000_tracking_rpc_add_neighborhood.sql) so the typed
  // neighborhood is visible on the public token-tracking page in
  // parity with the admin views.
  neighborhood: string | null;
  address: string | null;
  // Existing free-text product summary kept as a fallback when `lines` is null.
  products: string | null;
  quantity: number | null;
  // Phase 22H — itemised lines (image/note already stripped by the RPC).
  lines: TrackingLineDTO[] | null;
  // Phase 22H — money fields. delivered-only invariant lives elsewhere
  // in the system (Phase 22E reports). Here we just pass through.
  subtotal: number | null;
  shippingFee: number | null;
  extraShippingFee: number | null;
  freeShipping: boolean | null;
  total: number | null;
  warranty: string | null;
  date: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  // Phase 22P — `returnReason` is the customer-safe extract of the
  // structured `note` payload. Populated only for status='returned'
  // rows by the `get_tracking_timeline_by_token` RPC; null/undefined
  // otherwise (and for legacy plain-text notes that don't carry the
  // JSON envelope). Free-form admin notes remain redacted server-side
  // and never reach this DTO.
  statusTimeline: Array<{ status: string; changedAt: string; returnReason?: string | null }>;
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

  // Phase 22H: normalise the line-items array. The RPC strips `image`
  // and `note` server-side, but lines may legitimately be null (older
  // orders pre-Phase-13). We preserve null so the UI can fall back to
  // the free-text `products` summary, and we coerce numerics defensively
  // since Postgres numeric → JSON returns strings under PostgREST.
  const rpcLines: unknown = row.lines;
  let lines: TrackingLineDTO[] | null = null;
  if (Array.isArray(rpcLines)) {
    lines = (rpcLines as Record<string, unknown>[]).map((l) => ({
      productType: typeof l.productType === 'string' ? l.productType : null,
      label: typeof l.label === 'string' ? l.label : null,
      emoji: typeof l.emoji === 'string' ? l.emoji : null,
      color: typeof l.color === 'string' ? l.color : null,
      quantity: l.quantity == null ? null : Number(l.quantity),
      unitPrice: l.unitPrice == null ? null : Number(l.unitPrice),
      total: l.total == null ? null : Number(l.total),
      includeFlashlight:
        typeof l.includeFlashlight === 'boolean'
          ? l.includeFlashlight
          : l.includeFlashlight === 'true',
      flashlightPrice: l.flashlightPrice == null ? null : Number(l.flashlightPrice),
    }));
  }

  const toNum = (v: unknown): number | null => (v == null ? null : Number(v));

  const dto: TrackingDTO = {
    orderNum: row.order_num,
    status: row.status,
    customer: typeof row.customer === 'string' ? row.customer : null,
    phone: typeof row.phone_masked === 'string' ? row.phone_masked : null,
    region: row.region ?? null,
    district: row.district ?? null,
    // Phase 22N-Fix3 — RPC whitelists this column (see
    // 20260510130000_tracking_rpc_add_neighborhood.sql). The cast
    // via `Record<string, unknown>` is here because the local `row`
    // type doesn't enumerate every RPC column; the runtime shape is
    // checked by the SQL function signature. NULL for legacy
    // orders.
    neighborhood:
      ((row as Record<string, unknown>).neighborhood as string | null | undefined) ?? null,
    address: row.address ?? null,
    products: row.products ?? null,
    quantity: row.quantity ?? null,
    lines,
    subtotal: toNum(row.subtotal),
    shippingFee: toNum(row.shipping_fee),
    extraShippingFee: toNum(row.extra_shipping_fee),
    freeShipping: typeof row.free_shipping === 'boolean' ? row.free_shipping : null,
    total: toNum(row.total),
    warranty: row.warranty ?? null,
    date: row.date ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    statusTimeline: Array.isArray(timelineRows)
      ? timelineRows.map(
          (t: { new_status: string; changed_at: string; return_reason?: string | null }) => ({
            status: t.new_status,
            changedAt: t.changed_at,
            // Phase 22P — pass through the RPC's `return_reason` (NULL
            // until the Phase 22P migration is applied; the page
            // render is defensive against undefined either way).
            returnReason: t.return_reason ?? null,
          })
        )
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
