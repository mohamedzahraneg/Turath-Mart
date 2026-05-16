// ─────────────────────────────────────────────────────────────────────────────
// src/lib/inventory/orderReservationClient.ts
//
// Phase Inventory-Reservations-1C — shared client-side helpers for the
// reserve / release / reconcile RPCs introduced in 1A and first wired
// in 1B. Keeps the call sites in EditOrderModal, StatusUpdateModal,
// and OrdersTableSection in sync on:
//
//   • what counts as a "delivered" / "cancelled" status (so the
//     phase-split skip rule — "Delivery-Fulfillment owns post-delivery
//     stock effects" — has one source of truth);
//   • how to derive a reservation-ready `p_lines` payload from a
//     persisted order's `lines` jsonb (i.e. drop anything without
//     `inventory_id`, normalise the quantity);
//   • whether a given line set has any inventory-backed entries at
//     all (used to skip reconcile calls for static-only orders).
//
// This module is pure JS, no React, no Supabase imports. Each call
// site supplies its own `supabase` client and does its own audit
// writes — we just hand back the validated payload.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Statuses that we treat as "already delivered" — the Delivery-
 * Fulfillment phase owns stock effects past this point, so reserve /
 * release / reconcile RPCs are skipped here.
 */
const DELIVERED_STATUSES = new Set(['delivered']);

/**
 * Statuses that we treat as "cancelled" for the release path.
 * Kept narrow on purpose — `returned` is a separate flow with its
 * own stock effects (Phase Inventory-Returns-Stock-1).
 */
const CANCELLED_STATUSES = new Set(['cancelled']);

export function isDeliveredStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return DELIVERED_STATUSES.has(status.trim().toLowerCase());
}

export function isCancelledStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return CANCELLED_STATUSES.has(status.trim().toLowerCase());
}

/**
 * Shape of an order line as it appears in `turath_masr_orders.lines`
 * (jsonb) — typed loosely because we accept both freshly built
 * client-side draft objects and historic rows that may be missing
 * Phase Identity-1 fields.
 */
type OrderLineInput = {
  id?: string | null;
  line_id?: string | null;
  inventory_id?: string | null;
  sku?: string | null;
  productType?: string | null;
  label?: string | null;
  color?: string | null;
  quantity?: number | string | null;
};

/**
 * Payload shape passed to the reserve / reconcile RPCs' `p_lines`
 * jsonb argument. Only `inventory_id` + `quantity` are strictly
 * required by the RPC; the other fields are stored on the reservation
 * row for human-readable auditing.
 */
export type ReservationLinePayload = {
  id?: string;
  inventory_id: string;
  sku: string | null;
  quantity: number;
  productType?: string;
  label?: string;
  color: string | null;
};

/**
 * Filter and normalise an order's `lines` array into the payload the
 * reserve / reconcile RPCs expect. Lines without an `inventory_id`
 * (static products, legacy rows) are dropped — they have no stock to
 * reserve against.
 */
export function buildReservationLinesFromOrderLines(
  lines: ReadonlyArray<OrderLineInput | null | undefined> | null | undefined
): ReservationLinePayload[] {
  if (!Array.isArray(lines)) return [];
  const result: ReservationLinePayload[] = [];
  for (const line of lines) {
    if (!line) continue;
    const inventoryId =
      typeof line.inventory_id === 'string' && line.inventory_id.trim()
        ? line.inventory_id.trim()
        : null;
    if (!inventoryId) continue;
    const rawQty = Number(line.quantity);
    const quantity = Number.isFinite(rawQty) && rawQty > 0 ? Math.floor(rawQty) : 1;
    const lineId =
      typeof line.id === 'string' && line.id.trim()
        ? line.id.trim()
        : typeof line.line_id === 'string' && line.line_id.trim()
          ? line.line_id.trim()
          : undefined;
    const sku = typeof line.sku === 'string' && line.sku.trim() ? line.sku.trim() : null;
    const productType =
      typeof line.productType === 'string' && line.productType.trim()
        ? line.productType.trim()
        : undefined;
    const label =
      typeof line.label === 'string' && line.label.trim() ? line.label.trim() : undefined;
    const color = typeof line.color === 'string' && line.color.trim() ? line.color.trim() : null;
    result.push({
      id: lineId,
      inventory_id: inventoryId,
      sku,
      quantity,
      productType,
      label,
      color,
    });
  }
  return result;
}

/**
 * Does this line set contain at least one inventory-backed line?
 * Used to decide whether to call the reconcile RPC at all — for
 * static-only orders we skip the round trip and the audit row.
 */
export function hasInventoryBackedLines(
  lines: ReadonlyArray<OrderLineInput | null | undefined> | null | undefined
): boolean {
  if (!Array.isArray(lines)) return false;
  return lines.some(
    (l) => !!l && typeof l.inventory_id === 'string' && l.inventory_id.trim().length > 0
  );
}
