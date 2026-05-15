// ─────────────────────────────────────────────────────────────────────────────
// src/lib/orders/adjustmentChildOrder.ts
//
// Phase Returns-Exchange-1 — pure builder for the linked child shipping
// order row that gets inserted into `turath_masr_orders` alongside a
// new adjustment. The previous flow created the child only on
// approval (inside OrderDetailModal). This phase creates it at the
// same time as the adjustment so it appears in /orders-management for
// scheduling immediately.
//
// The builder is intentionally side-effect-free so the same row shape
// can be reused by both the new creation path (OrderAdjustmentModal)
// and any future server-side flow that wants to spawn a child order
// without going through the modal.
//
// What this module is NOT
// -----------------------
//   • No Supabase calls inside the builder. The caller does the
//     INSERT so it can fold the resulting child id + order_num back
//     onto the adjustment row in the same transaction.
//   • No inventory mutations. Phase 25A boundary holds — adjustments
//     never touch `turath_masr_inventory.available`.
//   • No invoice rendering. Live in `adjustmentInvoice.ts`.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdjustmentKind, AdjustmentLine, PriceDifferenceDirection } from './orderAdjustments';

/** Minimal projection of the parent order needed to seed the child. */
export interface ChildOrderParentSnapshot {
  id: string;
  orderNum: string;
  customer: string;
  phone: string;
  phone2?: string | null;
  region: string;
  district?: string | null;
  neighborhood?: string | null;
  address: string;
  warranty?: string | null;
}

/**
 * Phase Returns-Exchange-1 Fix1 — the address the child shipping
 * order actually ships to / picks up from. Defaults to the parent's
 * address but the operator can pick a new one in step 3 of the
 * wizard. When the new address differs from the parent's, the next
 * past-addresses lookup for this customer surfaces it automatically
 * (the dedup runs off `turath_masr_orders`).
 */
export interface ChildOrderShipAddress {
  region: string;
  district?: string | null;
  neighborhood?: string | null;
  address: string;
  /** Optional secondary phone for delivery — falls back to parent.phone2. */
  phone2?: string | null;
}

export interface ChildOrderInputs {
  parent: ChildOrderParentSnapshot;
  /** Derived from `buildChildOrderNum(parent.orderNum, kind, siblings)`. */
  childOrderNum: string;
  kind: AdjustmentKind;
  returnLines: AdjustmentLine[];
  replacementLines: AdjustmentLine[];
  /** Signed: positive = customer pays, negative = company refunds, 0 = no flow. */
  priceDifference: number;
  priceDifferenceDirection: PriceDifferenceDirection;
  /** Customer's share of the new shipping leg (≤ base). */
  shippingCustomerAmount: number;
  /** Phase Returns-Exchange-1 Fix2 — the resolved system-side base
   *  shipping fee for the new shipping leg, and the company's share.
   *  Both surface in the child order's notes so the shipping team
   *  sees the full split breakdown next to the reason. */
  shippingBaseAmount?: number;
  shippingCompanyAmount?: number;
  /** What the delegate must collect from the customer at delivery. */
  customerCollectAmount: number;
  /** Free-form instructions written by the operator (shown on the
   *  delegate's screen + audit timeline). Optional. */
  operationalNote?: string | null;
  /** Required reason from the adjustment. We mirror it onto the child
   *  order's `notes` so the shipping team sees why this leg exists. */
  reason: string;
  createdBy: string;
  createdByUserId: string | null;
  /** Phase Returns-Exchange-1 Fix1 — address override. When null the
   *  builder reuses the parent's address. When supplied the child
   *  order ships to / picks up from this address instead. */
  shipAddress?: ChildOrderShipAddress | null;
}

/** Render a stable shipping-task label for the products column. */
export function childOrderTaskLabel(kind: AdjustmentKind): string {
  return kind === 'exchange_full' || kind === 'exchange_partial' ? 'شحن استبدال' : 'شحن مرتجع';
}

/** Reason-label prefix matching the modal copy. */
function reasonLabelFor(kind: AdjustmentKind): string {
  return kind === 'exchange_full' || kind === 'exchange_partial' ? 'سبب الاستبدال' : 'سبب المرتجع';
}

/**
 * Build the row object to insert into `turath_masr_orders` for the
 * linked shipping leg. Mirrors the legacy OrderDetailModal approval
 * path so existing readers (orders list, customer page, tracking)
 * keep working.
 *
 * Field rules
 * -----------
 *   • `products` carries the task label (`شحن مرتجع`/`شحن استبدال`)
 *     and a reference to the parent order number so the orders list
 *     reads sensibly without joining the adjustment row.
 *   • `lines` carries the items being shipped (return items for
 *     pickup; replacement items for exchange dispatch).
 *   • `subtotal` is the chargeable price-difference when the customer
 *     is paying it — 0 otherwise. The child is an operational leg,
 *     not a fresh sale.
 *   • `shipping_fee` is the customer's share. The company share never
 *     hits the child row (that's a financial-only book entry).
 *   • `notes` always carries the reason. The operational instructions
 *     follow on a new line when present.
 *   • `status` starts at `new` so the order appears immediately in
 *     /orders-management for scheduling. If the parent adjustment is
 *     cancelled later, the caller cascades by setting status to
 *     `cancelled`.
 */
export function buildChildOrderRow(inputs: ChildOrderInputs): Record<string, unknown> {
  const isExchange = inputs.kind === 'exchange_full' || inputs.kind === 'exchange_partial';
  const taskLabel = childOrderTaskLabel(inputs.kind);
  const productsLabel = `${taskLabel} — للطلب ${inputs.parent.orderNum}`;
  const childLines = isExchange ? inputs.replacementLines : inputs.returnLines;
  const childQty = childLines.reduce(
    (sum, line) => sum + Math.max(0, Number(line.quantity) || 0),
    0
  );
  const shippingForChild = Math.max(0, Number(inputs.shippingCustomerAmount) || 0);
  const subtotal =
    inputs.priceDifferenceDirection === 'customer_pays'
      ? Math.abs(Number(inputs.priceDifference) || 0)
      : 0;
  const customerCollect = Math.max(
    0,
    Number(inputs.customerCollectAmount) || subtotal + shippingForChild
  );
  const now = new Date();
  const notesParts: string[] = [
    `${reasonLabelFor(inputs.kind)}: ${inputs.reason}`,
    `الطلب الأصلي: #${inputs.parent.orderNum}`,
  ];
  // Phase Returns-Exchange-1 Fix2 — include the shipping split
  // breakdown in the child order's notes so the dispatcher /
  // delegate sees exactly who pays what without re-opening the
  // adjustment row.
  const baseAmount = Math.max(0, Number(inputs.shippingBaseAmount ?? 0) || 0);
  const companyAmount = Math.max(0, Number(inputs.shippingCompanyAmount ?? 0) || 0);
  if (baseAmount > 0 || shippingForChild > 0 || companyAmount > 0) {
    notesParts.push(`مصروف الشحن من السيستم: ${baseAmount.toLocaleString('en-US')} ج.م`);
    notesParts.push(`يدفع العميل من الشحن: ${shippingForChild.toLocaleString('en-US')} ج.م`);
    notesParts.push(`تتحمل الشركة من الشحن: ${companyAmount.toLocaleString('en-US')} ج.م`);
  }
  if (inputs.operationalNote && inputs.operationalNote.trim()) {
    notesParts.push(`ملاحظات للمندوب: ${inputs.operationalNote.trim()}`);
  }
  // Phase Returns-Exchange-1 Fix1 — pick the actual ship address.
  // Falls back to the parent's address when the wizard didn't
  // override it (most cases). When overridden, the new address
  // automatically lands in the customer's past-addresses list the
  // next time someone queries `turath_masr_orders` for this phone.
  const ship = inputs.shipAddress ?? null;
  const shipRegion = ship?.region ?? inputs.parent.region;
  const shipDistrict = ship ? (ship.district ?? null) : (inputs.parent.district ?? null);
  const shipNeighborhood = ship
    ? (ship.neighborhood ?? null)
    : (inputs.parent.neighborhood ?? null);
  const shipAddressLine = ship?.address ?? inputs.parent.address;
  const shipPhone2 = ship?.phone2 ?? inputs.parent.phone2 ?? null;
  return {
    id: `order-${now.getTime()}`,
    order_num: inputs.childOrderNum,
    created_by: inputs.createdBy,
    created_by_user_id: inputs.createdByUserId,
    customer: inputs.parent.customer,
    phone: inputs.parent.phone,
    phone2: shipPhone2,
    region: shipRegion,
    district: shipDistrict,
    neighborhood: shipNeighborhood,
    address: shipAddressLine,
    products: productsLabel,
    quantity: childQty || 1,
    subtotal,
    shipping_fee: shippingForChild,
    extra_shipping_fee: 0,
    express_shipping: false,
    free_shipping: shippingForChild === 0,
    total: customerCollect,
    status: 'new',
    date: now.toLocaleDateString('en-GB').replace(/\//g, '/'),
    time: now.toLocaleTimeString('en-GB', { hour12: false }),
    day: now.toLocaleDateString('ar-EG', { weekday: 'long' }),
    notes: notesParts.join('\n'),
    warranty: inputs.parent.warranty ?? null,
    lines: childLines,
  };
}

/**
 * Count existing sibling child orders for a given parent + kind so
 * the next suffix lands on R{n+1}/E{n+1}. Best-effort: a count error
 * falls back to 0 (first sibling) and the caller can decide whether
 * to surface a toast.
 */
export async function countAdjustmentSiblings(
  supabase: SupabaseClient,
  parentOrderNum: string,
  kind: AdjustmentKind
): Promise<number> {
  const prefix =
    kind === 'exchange_full' || kind === 'exchange_partial'
      ? `${parentOrderNum}-E`
      : `${parentOrderNum}-R`;
  try {
    const { count, error } = await supabase
      .from('turath_masr_order_adjustments')
      .select('child_order_num', { count: 'exact', head: true })
      .like('child_order_num', `${prefix}%`);
    if (error) {
      console.warn('[adjustmentChildOrder] sibling count failed:', error);
      return 0;
    }
    return count ?? 0;
  } catch (err) {
    console.warn('[adjustmentChildOrder] sibling count exception:', err);
    return 0;
  }
}
