// ─────────────────────────────────────────────────────────────────────────────
// GET /api/track/[orderId]
//
// Public, anonymous read endpoint that powers the customer-facing
// /track/[orderId] page after the RLS migrations (which removed direct
// public SELECT access to turath_masr_orders).
//
// Implementation:
//   - Calls the SECURITY DEFINER RPC `public.get_tracking_info(text)` which
//     returns ONLY whitelisted, non-PII columns (no phone, no address, no
//     financials, no internal notes, no audit-log internals).
//   - Also calls `public.get_tracking_timeline(text)` for the status timeline.
//   - Uses the public anon key — no service-role key needed (the RPC is the
//     security boundary).
//
// Cache:
//   - 30 seconds CDN, 60 seconds stale-while-revalidate. Matches the
//     existing 30-second client polling cadence and reduces DB load.
//
// Error semantics:
//   - 400 if orderId is missing or malformed.
//   - 404 if the RPC returns no rows.
//   - 500 if Supabase returns an unexpected error.
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
  // Phase 22Q — schedule + delegate. The order_num-keyed RPC
  // `get_tracking_info` is enumerable, so by privacy decision we do
  // NOT widen it to expose the schedule or the assigned delegate
  // here (only the unguessable token URL gets that). The fields stay
  // typed for type-shape parity with the token DTO, but always
  // emitted as null on this endpoint.
  scheduledDelivery: {
    date: string;
    from: string;
    to: string;
    reason: string | null;
  } | null;
  delegateName: string | null;
  // Phase 22P — `returnReason` is the customer-safe extract of the
  // structured `note` payload. Populated only for status='returned'
  // rows by the `get_tracking_timeline` RPC; null/undefined for
  // other events and for legacy plain-text notes. Free-form admin
  // notes remain redacted server-side.
  statusTimeline: Array<{ status: string; changedAt: string; returnReason?: string | null }>;
}

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

export async function GET(_request: Request, context: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await context.params;

  // Reject obvious junk before hitting the DB.
  if (!orderId || typeof orderId !== 'string' || orderId.length > 64) {
    return NextResponse.json({ error: 'invalid_order_id' }, { status: 400 });
  }

  const supabase = buildAnonClient();

  // (1) Fetch the redacted order DTO.
  const { data: rows, error: orderErr } = await supabase.rpc('get_tracking_info', {
    p_order_num: orderId,
  });

  if (orderErr) {
    console.error('[track-api] get_tracking_info failed', orderErr);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }

  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // (2) Fetch the status timeline (also redacted — no changed_by / note).
  const { data: timelineRows, error: timelineErr } = await supabase.rpc('get_tracking_timeline', {
    p_order_num: orderId,
  });

  if (timelineErr) {
    console.error('[track-api] get_tracking_timeline failed', timelineErr);
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
    // Phase 22Q — privacy decision: the order_num-keyed RPC is
    // enumerable so we never expose the schedule or the assigned
    // delegate here. Always emit null. Customers who need this info
    // use the unguessable `/track/t/<token>` URL.
    scheduledDelivery: null,
    delegateName: null,
    statusTimeline: Array.isArray(timelineRows)
      ? timelineRows.map(
          (t: { new_status: string; changed_at: string; return_reason?: string | null }) => ({
            status: t.new_status,
            changedAt: t.changed_at,
            // Phase 22P — passes through the RPC's `return_reason`
            // (NULL until the Phase 22P migration is applied).
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
