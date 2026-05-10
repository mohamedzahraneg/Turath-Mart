// ─────────────────────────────────────────────────────────────────────────────
// POST /api/customer/rating
//
// Phase 23A — public customer-side delegate rating submission.
//
// Background
//   The customer-facing tracking page on `/track/t/[token]` shows a
//   "قيّم تجربة التوصيل" panel after the order's status flips to
//   `delivered`. The panel posts to this route which proxies to the
//   SECURITY DEFINER RPC `public.submit_delegate_rating` (added in
//   migration `20260510180000_delegate_ratings.sql`):
//     - bypasses RLS (function owner) so no anonymous insert policy
//       has to be opened on `turath_masr_delegate_ratings`;
//     - re-validates `tracking_token` + `rating ∈ [1,5]` + comment
//       length on the database side too (defence in depth);
//     - gates on `order.status = 'delivered'` server-side so a stale
//       customer tab can't beat the status change;
//     - upserts on `order_id` so the customer can correct their own
//       rating without the page having to track submitted state.
//
// Privacy posture
//   - Anonymous Supabase SSR client (no service-role key, no cookies).
//     Mirrors `/api/customer/complaints` and `/api/customer/chat`.
//   - We never echo the raw RPC error or row data back to the caller.
//   - Generic error semantics (the same shape used by
//     `/api/customer/complaints`).
//
// Error semantics:
//   200 { ok: true }
//   400 invalid_input        — malformed JSON, missing token, rating
//                              not 1..5, comment too long
//   404 not_found            — token unknown
//   409 not_delivered        — order is not in `delivered` status
//   500 internal_error       — Supabase returned an unexpected error
//   405 method_not_allowed   — anything other than POST
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RatingBody {
  tracking_token?: unknown;
  rating?: unknown;
  comment?: unknown;
}

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

export async function POST(request: Request) {
  let body: RatingBody;
  try {
    body = (await request.json()) as RatingBody;
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  // 1. tracking_token — strict 36-char hex UUID.
  const token = typeof body.tracking_token === 'string' ? body.tracking_token.trim() : '';
  if (!token || token.length !== 36 || !UUID_RE.test(token)) {
    return NextResponse.json({ error: 'invalid_input', field: 'tracking_token' }, { status: 400 });
  }

  // 2. rating — integer 1..5.
  const rating =
    typeof body.rating === 'number' && Number.isFinite(body.rating) ? Math.trunc(body.rating) : NaN;
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: 'invalid_input', field: 'rating' }, { status: 400 });
  }

  // 3. comment — optional string up to 1000 chars. The RPC also
  //    truncates server-side; this is the friendly client-facing
  //    rejection.
  let comment: string | null = null;
  if (body.comment !== undefined && body.comment !== null) {
    if (typeof body.comment !== 'string') {
      return NextResponse.json({ error: 'invalid_input', field: 'comment' }, { status: 400 });
    }
    const trimmed = body.comment.trim();
    if (trimmed.length > 1000) {
      return NextResponse.json({ error: 'invalid_input', field: 'comment' }, { status: 400 });
    }
    comment = trimmed.length === 0 ? null : trimmed;
  }

  const supabase = buildAnonClient();
  const { data, error } = await supabase.rpc('submit_delegate_rating', {
    p_tracking_token: token,
    p_rating: rating,
    p_comment: comment,
  });

  if (error) {
    console.error('[customer-rating] rpc error', error);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }

  // The RPC returns jsonb `{ ok: bool, error?: string }`.
  const payload = (data ?? {}) as { ok?: boolean; error?: string };
  if (payload.ok) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  switch (payload.error) {
    case 'invalid_token':
    case 'invalid_rating':
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    case 'not_found':
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    case 'not_delivered':
      return NextResponse.json({ error: 'not_delivered' }, { status: 409 });
    default:
      return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
