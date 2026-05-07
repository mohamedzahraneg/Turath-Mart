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
  const phoneRaw = typeof body.customer_phone === 'string' ? body.customer_phone.trim() : '';
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
    // Map RPC validation errors to 400, anything else to 500.
    const msg = (error as { message?: string }).message || '';
    if (/invalid_phone|invalid_message|invalid_order_id|22023/i.test(msg)) {
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
