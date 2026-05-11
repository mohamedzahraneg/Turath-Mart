// ─────────────────────────────────────────────────────────────────────────────
// POST /api/customer/chat
//
// Phase 14 — Public customer chat submission.
//
// Background
//   Phase 3 RLS hardening removed the "TO public WITH CHECK (true)" insert
//   policy on turath_masr_crm_chat. Customer chat from /track/* used to
//   .insert() directly via the browser anon client; that now silently
//   fails on RLS. This route restores the flow safely by going through
//   the SECURITY DEFINER RPC public.submit_customer_chat (added in
//   migration 20260507b_customer_crm_rpcs.sql) which:
//     - bypasses RLS (function owner)
//     - hard-pins sender='customer' so the caller cannot impersonate staff
//     - validates inputs server-side (length, format)
//     - returns only the new row id — no other column ever leaks
//
// Implementation
//   - Anon Supabase client (no service-role key, no cookies).
//   - Defense-in-depth validation here too (the RPC also validates).
//   - Generic error responses; never echoes the raw Postgres error.
//
// Error semantics (Phase 14A)
//   - 200 { success: true, id }
//   - 400 invalid_input          — malformed JSON or missing/invalid fields
//                                   (also catches Postgres SQLSTATE 22023:
//                                   invalid_phone / empty_message /
//                                   message_too_long / invalid_order_id)
//   - 409 duplicate_submission   — same phone + same message within 2 min
//   - 429 rate_limited           — per-phone or global cap exceeded
//   - 405 method_not_allowed     — anything other than POST
//   - 500 internal_error         — Supabase returned an unexpected error
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
// Phase 24B-Fix1 — convert Arabic-Indic / Persian digits to ASCII
// BEFORE the PHONE_RE check so a customer who types `٠١٠١٢٣٤٥٦٧٨` in
// the public form lands in the table as `01012345678`.
import { toEnglishDigits } from '@/lib/phone/egyptPhone';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Phone allow-list: 5..32 chars, digits / + / spaces only. Mirrors the
// regex inside submit_customer_chat() so we fail fast on the app side
// before paying a Postgres round-trip.
const PHONE_RE = /^[0-9+ ]{5,32}$/;

// Whitelist of chat_type values. The RPC also normalises, but rejecting
// here gives clearer error messaging.
const CHAT_TYPES = new Set(['support', 'delegate']);

interface ChatBody {
  customer_phone?: unknown;
  message?: unknown;
  chat_type?: unknown;
  order_id?: unknown;
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
  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  // customer_phone — required, must match phone allow-list.
  // Phase 24B-Fix1 — accept Arabic-Indic / Persian glyphs in the
  // submitted phone. The hardened RPC (`submit_customer_chat`) also
  // strips whitespace + normalises, but applying `toEnglishDigits`
  // here keeps the route-level PHONE_RE check honest.
  const phoneRaw =
    typeof body.customer_phone === 'string' ? toEnglishDigits(body.customer_phone).trim() : '';
  if (!PHONE_RE.test(phoneRaw)) {
    return NextResponse.json({ error: 'invalid_input', field: 'customer_phone' }, { status: 400 });
  }

  // message — required, 1..2000 after trim.
  const message = pickString(body.message, 2000);
  if (!message) {
    return NextResponse.json({ error: 'invalid_input', field: 'message' }, { status: 400 });
  }

  // chat_type — optional, default 'support'.
  let chatType = 'support';
  if (typeof body.chat_type === 'string') {
    const ct = body.chat_type.trim().toLowerCase();
    if (CHAT_TYPES.has(ct)) {
      chatType = ct;
    } else if (ct.length > 0) {
      return NextResponse.json({ error: 'invalid_input', field: 'chat_type' }, { status: 400 });
    }
  }

  // order_id — optional, max 64 chars (covers both order_num and UUID).
  let orderId: string | null = null;
  if (body.order_id !== undefined && body.order_id !== null && body.order_id !== '') {
    const oid = pickString(body.order_id, 64);
    if (!oid) {
      return NextResponse.json({ error: 'invalid_input', field: 'order_id' }, { status: 400 });
    }
    orderId = oid;
  }

  const supabase = buildAnonClient();
  const { data, error } = await supabase.rpc('submit_customer_chat', {
    p_customer_phone: phoneRaw,
    p_message: message,
    p_chat_type: chatType,
    p_order_id: orderId,
  });

  if (error) {
    // Phase 14A error mapping: classify by Postgres SQLSTATE + message
    // text raised by submit_customer_chat. SQLSTATE comes back on the
    // PostgrestError as `code`; the message text is the bare error
    // identifier we used in `RAISE EXCEPTION '...' USING ERRCODE = ...`.
    const code = (error as { code?: string }).code || '';
    const msg = (error as { message?: string }).message || '';

    // 409 duplicate (exact same body within the duplicate window)
    if (msg === 'duplicate_submission') {
      return NextResponse.json({ error: 'duplicate_submission' }, { status: 409 });
    }
    // 429 rate-limited (per-phone OR global)
    if (msg === 'rate_limited') {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }
    // 400 input validation: SQLSTATE 22023 OR specific known messages
    if (
      code === '22023' ||
      /^(invalid_phone|empty_message|message_too_long|invalid_order_id)$/.test(msg)
    ) {
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    }
    console.error('[customer-chat-api] submit_customer_chat failed', error);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }

  return NextResponse.json({ success: true, id: data as string }, { status: 200 });
}

// Reject any non-POST verb explicitly so we don't accidentally serve a
// page handler. Next.js otherwise responds 405 implicitly, but being
// explicit keeps the contract obvious.
export async function GET() {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
