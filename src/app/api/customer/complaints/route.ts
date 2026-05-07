// ─────────────────────────────────────────────────────────────────────────────
// POST /api/customer/complaints
//
// Phase 14 — Public customer complaint submission.
//
// Background
//   Phase 3 RLS hardening removed the public insert policy on
//   turath_masr_crm_complaints. Customer flows from /track/* used to
//   .insert() directly via the browser anon client; that now silently
//   fails on RLS. This route restores the flow safely by going through
//   the SECURITY DEFINER RPC public.submit_customer_complaint (added in
//   migration 20260507b_customer_crm_rpcs.sql) which:
//     - bypasses RLS (function owner)
//     - hard-pins created_by='customer' so the caller cannot pretend
//       the complaint was opened by staff
//     - hard-pins status='open'
//     - validates inputs server-side (length, format)
//     - returns only the new row id — no other column ever leaks
//
// Implementation
//   - Anon Supabase client (no service-role key, no cookies).
//   - Defense-in-depth validation here too (the RPC also validates).
//   - Generic error responses; never echoes the raw Postgres error.
//
// Note on schema
//   turath_masr_crm_complaints does NOT have an order_id column. We
//   intentionally do NOT accept an order_id in this payload — wiring
//   complaints to a specific order would need a separate additive
//   migration (out of scope for Phase 14).
//
// Error semantics
//   - 400 invalid_input  — malformed JSON or missing/invalid fields
//   - 405 method_not_allowed — anything other than POST
//   - 500 internal_error — Supabase returned an unexpected error
//   - 200 { success: true, id }
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PHONE_RE = /^[0-9+ ]{5,32}$/;

interface ComplaintBody {
  customer_phone?: unknown;
  subject?: unknown;
  notes?: unknown;
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

function pickString(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (t.length === 0 || t.length > max) return null;
  return t;
}

export async function POST(request: Request) {
  let body: ComplaintBody;
  try {
    body = (await request.json()) as ComplaintBody;
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  // customer_phone — required, must match phone allow-list.
  const phoneRaw = typeof body.customer_phone === 'string' ? body.customer_phone.trim() : '';
  if (!PHONE_RE.test(phoneRaw)) {
    return NextResponse.json({ error: 'invalid_input', field: 'customer_phone' }, { status: 400 });
  }

  // subject — required, 1..200 after trim.
  const subject = pickString(body.subject, 200);
  if (!subject) {
    return NextResponse.json({ error: 'invalid_input', field: 'subject' }, { status: 400 });
  }

  // notes — optional, 0..2000.
  let notes: string | null = null;
  if (body.notes !== undefined && body.notes !== null && body.notes !== '') {
    const n = pickString(body.notes, 2000);
    if (!n) {
      return NextResponse.json({ error: 'invalid_input', field: 'notes' }, { status: 400 });
    }
    notes = n;
  }

  const supabase = buildAnonClient();
  const { data, error } = await supabase.rpc('submit_customer_complaint', {
    p_customer_phone: phoneRaw,
    p_subject: subject,
    p_notes: notes,
  });

  if (error) {
    const msg = (error as { message?: string }).message || '';
    if (/invalid_phone|invalid_subject|invalid_notes|22023/i.test(msg)) {
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    }
    console.error('[customer-complaints-api] submit_customer_complaint failed', error);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }

  return NextResponse.json({ success: true, id: data as string }, { status: 200 });
}

export async function GET() {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
