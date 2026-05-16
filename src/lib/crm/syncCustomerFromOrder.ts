// ─────────────────────────────────────────────────────────────────────────────
// src/lib/crm/syncCustomerFromOrder.ts
//
// Phase CRM-Customers-Order-Sync-1 — thin client wrapper around the
// SECURITY DEFINER RPC `public.crm_upsert_customer_from_order`.
//
// Why this exists
//   Before this phase, AddOrderModal upserted directly to
//   `turath_masr_customers` via the supabase-js client. That hits the
//   table's RLS, which silently rejects operators outside the CRM team
//   (r1/r2/r5/r6 only). The error is swallowed (the upsert is
//   non-blocking by design — the order still saves) and the customer
//   row never appears on the `/customers` dashboard.
//
//   The new RPC bypasses RLS via `SECURITY DEFINER`, so the upsert
//   lands regardless of caller role. The same migration also installs
//   an AFTER INSERT trigger on `turath_masr_orders` that fires the
//   same upsert, so even a future code path that forgets to call this
//   helper still produces a customer row.
//
// Contract
//   • Always normalises the phone via the shared `normalizeEgyptPhone`
//     so the key matches what AddOrderModal writes to `orders.phone`.
//   • Non-blocking: callers should NOT await this in a way that could
//     fail the surrounding write. The helper catches the rpc error,
//     logs a warning, and resolves with `{ ok: false, ... }`.
//   • Never sends blanks. An empty `fullName` / `address` is passed
//     as `null` so the RPC's COALESCE preserves any existing CRM-
//     curated value rather than nulling it.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeEgyptPhone } from '@/lib/phone/egyptPhone';

export interface SyncCustomerInput {
  phone: string | null | undefined;
  fullName?: string | null;
  address?: string | null;
}

export type SyncCustomerResult =
  | { ok: true; phone: string }
  | { ok: false; reason: 'no_phone' | 'rpc_error' | 'unexpected'; error?: unknown };

/**
 * Idempotently push the customer identity attached to an order into
 * the CRM customers table. Safe to call any number of times — the
 * underlying RPC does `INSERT ... ON CONFLICT (phone) DO UPDATE`.
 *
 * Returns an outcome instead of throwing so the caller can log without
 * having to wrap every call in a try/catch.
 */
export async function syncCustomerFromOrder(
  supabase: SupabaseClient,
  input: SyncCustomerInput
): Promise<SyncCustomerResult> {
  const canonical = normalizeEgyptPhone(input.phone ?? '');
  if (!canonical) {
    return { ok: false, reason: 'no_phone' };
  }
  const fullName = input.fullName ? input.fullName.trim() : '';
  const address = input.address ? input.address.trim() : '';
  try {
    const { error } = await supabase.rpc('crm_upsert_customer_from_order', {
      p_phone: canonical,
      p_full_name: fullName || null,
      p_address: address || null,
    });
    if (error) {
      // Migration not applied yet (function missing) is the most
      // common transient — surface the message verbatim so it's
      // recognisable in the browser console without leaking it to
      // the UI.
      console.warn('[syncCustomerFromOrder] rpc error:', error);
      return { ok: false, reason: 'rpc_error', error };
    }
    return { ok: true, phone: canonical };
  } catch (err) {
    console.warn('[syncCustomerFromOrder] unexpected:', err);
    return { ok: false, reason: 'unexpected', error: err };
  }
}
