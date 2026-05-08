// Phase 22E — single source of truth for order metric formulas.
// Imported by /dashboard (DashboardKPIs) and /reports so the two
// surfaces never disagree on what "delivered", "failed", or
// "successRate" means.
//
// Conventions (per Phase 22E spec):
//   - returnedOrders and cancelledOrders are SEPARATE buckets.
//   - failedOrders = returnedOrders + cancelledOrders. Use this name
//     in any UI card that bundles the two — never call the bundle
//     "returned" alone.
//   - grossRevenue, shippingFees, productRevenue are all
//     delivered-only by design. shippingFees aggregated over the
//     full period mixes shipping cost of orders we didn't earn from
//     into the same number as the revenue we did earn — leading to
//     misleading "remaining" math. Keep the delivered-only invariant.
//   - successRate = delivered / totalOrders. Includes zero-total
//     orders in the denominator on purpose — a delivered order with
//     total = 0 (e.g. complimentary) is still a successful delivery.
//   - Zero-total and null-total orders count toward totalOrders.
//     Use validOrders separately if a UI specifically wants
//     "paid orders only" framing.

export type OrderStatus =
  | 'new'
  | 'preparing'
  | 'warehouse'
  | 'shipping'
  | 'delivered'
  | 'cancelled'
  | 'returned';

export interface OrderForMetrics {
  status?: string | null;
  total?: number | null;
  shipping_fee?: number | null;
}

// Maps both English codes (the truth in the DB today) and the Arabic
// labels seen in legacy / defensive code paths. Lookup is case-
// insensitive on the English side; Arabic strings are matched as-is.
const STATUS_MAP: Record<string, OrderStatus> = {
  new: 'new',
  preparing: 'preparing',
  warehouse: 'warehouse',
  shipping: 'shipping',
  delivered: 'delivered',
  cancelled: 'cancelled',
  returned: 'returned',
  جديد: 'new',
  'جاري التجهيز للشحن': 'preparing',
  'جاري التجهيز': 'preparing',
  'جاري تسليمه في المستودع': 'warehouse',
  'في المستودع': 'warehouse',
  'جاري الشحن': 'shipping',
  'تم التسليم': 'delivered',
  ملغي: 'cancelled',
  مرتجع: 'returned',
};

export function normalizeStatus(raw: string | null | undefined): OrderStatus | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  return STATUS_MAP[trimmed.toLowerCase()] ?? STATUS_MAP[trimmed] ?? null;
}

export interface OrderMetrics {
  totalOrders: number;
  deliveredOrders: number;
  shippingOrders: number;
  /** new + preparing + warehouse + any unknown bucket. */
  pendingOrders: number;
  returnedOrders: number;
  cancelledOrders: number;
  /** returnedOrders + cancelledOrders. Surface as "Failed/Returns & Cancellations". */
  failedOrders: number;
  /** totalOrders - failedOrders. */
  activeOrders: number;
  /** Orders with total > 0. Informational, do NOT use as a default denominator. */
  validOrders: number;
  /** sum(total) over delivered orders. */
  grossRevenue: number;
  /** sum(shipping_fee) over delivered orders only — never period-wide. */
  shippingFees: number;
  /** grossRevenue - shippingFees, clamped at 0. */
  productRevenue: number;
  /** delivered / totalOrders, in [0, 1]. Multiply by 100 for percentage. */
  successRate: number;
}

export function calculateOrderMetrics(orders: OrderForMetrics[]): OrderMetrics {
  let delivered = 0;
  let shipping = 0;
  let pending = 0;
  let returned = 0;
  let cancelled = 0;
  let valid = 0;
  let grossRevenue = 0;
  let shippingFees = 0;

  for (const o of orders) {
    const norm = normalizeStatus(o.status);
    const total = Number(o.total) || 0;
    const sf = Number(o.shipping_fee) || 0;

    if (total > 0) valid++;

    if (norm === 'delivered') {
      delivered++;
      grossRevenue += total;
      shippingFees += sf;
    } else if (norm === 'shipping') {
      shipping++;
    } else if (norm === 'returned') {
      returned++;
    } else if (norm === 'cancelled') {
      cancelled++;
    } else {
      // new / preparing / warehouse / unknown
      pending++;
    }
  }

  const totalOrders = orders.length;
  const failedOrders = returned + cancelled;
  const productRevenue = Math.max(0, grossRevenue - shippingFees);
  const successRate = totalOrders > 0 ? delivered / totalOrders : 0;

  return {
    totalOrders,
    deliveredOrders: delivered,
    shippingOrders: shipping,
    pendingOrders: pending,
    returnedOrders: returned,
    cancelledOrders: cancelled,
    failedOrders,
    activeOrders: totalOrders - failedOrders,
    validOrders: valid,
    grossRevenue,
    shippingFees,
    productRevenue,
    successRate,
  };
}
