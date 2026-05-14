// ─────────────────────────────────────────────────────────────────────────────
// src/lib/orders/orderChangeDiff.ts
//
// Phase Orders-Edit-1 — pure helper that turns a before/after pair
// of order snapshots into a small, audit-friendly diff. The
// EditOrderModal calls this on save to feed both the per-order
// (`turath_masr_audit_logs`) and the staff-wide
// (`turath_masr_staff_audit_logs`) audit writers.
//
// Design notes
// ------------
//   • The diff only describes fields the customer or operator
//     genuinely cares about (identity, address, totals, payment,
//     discount, preview/installation, shipping flags). Line-level
//     changes are summarised — count + label list + subtotal —
//     instead of a per-cell jsonb diff so the audit row stays
//     small.
//   • No images, no full `lines` arrays, no `notes` raw text, no
//     tokens, no auth metadata. Every value is short enough to
//     fit comfortably inside `turath_masr_audit_logs.old_value /
//     new_value` (text) and the staff audit `metadata` jsonb.
//   • The helper is intentionally pure (no Supabase client, no
//     React imports) so it stays trivially testable and can be
//     reused by future surfaces (e.g. an OPS-driven status fix).
// ─────────────────────────────────────────────────────────────────────────────

import type { CheckoutDetails } from '@/lib/orders/checkoutDetails';

/** Whitelisted scalar values an order field can carry on either side. */
type ScalarValue = string | number | boolean | null;

export interface OrderChange {
  /** Stable machine key, e.g. `customer_name`, `discount`, `payment_status`. */
  field: string;
  /** Short Arabic label rendered in the per-order audit timeline. */
  label: string;
  before: ScalarValue;
  after: ScalarValue;
}

/**
 * Minimal projection of an order — the fields EditOrderModal owns
 * and the diff helper reasons about. Loaders just spread the row
 * into this shape; missing fields fall back to `null` / `[]`.
 */
export interface OrderSnapshot {
  customer: string | null;
  phone: string | null;
  phone2: string | null;
  region: string | null;
  district: string | null;
  neighborhood: string | null;
  address: string | null;
  freeShipping: boolean;
  expressShipping: boolean;
  /** Subtotal as the row carries it. The diff doesn't recompute. */
  subtotal: number;
  shippingFee: number;
  total: number;
  /** Lightweight line summary — never the full jsonb. */
  lines: OrderSnapshotLine[];
  /** Parsed envelope, or null when the order pre-dates checkout V1. */
  checkoutDetails: CheckoutDetails | null;
}

export interface OrderSnapshotLine {
  productType: string | null;
  label: string | null;
  color: string | null;
  quantity: number;
  unitPrice: number;
  total: number;
}

const NUMERIC_EPSILON = 0.005;

function numEq(a: number, b: number): boolean {
  return Math.abs(a - b) < NUMERIC_EPSILON;
}

function strOrEmpty(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function moneyLabel(value: number): string {
  return `${Number(value || 0).toLocaleString('en-US')} ج.م`;
}

function discountSignature(c: CheckoutDetails | null): {
  enabled: boolean;
  type: 'fixed' | 'percent';
  value: number;
  amount: number;
  reason: string;
  by: string;
} {
  const d = c?.discount;
  return {
    enabled: !!d?.enabled,
    type: d?.type === 'percent' ? 'percent' : 'fixed',
    value: Number(d?.value ?? 0),
    amount: Number(d?.amount ?? 0),
    reason: strOrEmpty(d?.reason),
    by: strOrEmpty(d?.by),
  };
}

function paymentSignature(c: CheckoutDetails | null): {
  status: 'unpaid' | 'paid' | 'partial';
  paid: number;
  method: string;
  paidTo: string;
} {
  const p = c?.payment;
  return {
    status: p?.status ?? 'unpaid',
    paid: Number(p?.paid_amount ?? 0),
    method: strOrEmpty(p?.method),
    paidTo: strOrEmpty(p?.paid_to),
  };
}

function previewSignature(c: CheckoutDetails | null): {
  mode: 'none' | 'preview_only' | 'preview_with_installation';
  target: 'mosque' | 'customer' | 'none';
  payer: 'customer' | 'factory' | 'none';
} {
  const mode = c?.preview_mode ?? 'none';
  const target = c?.installation?.target ?? null;
  const payer = c?.installation?.payer ?? null;
  return {
    mode,
    target: target ?? 'none',
    payer: payer ?? 'none',
  };
}

function discountLabel(sig: ReturnType<typeof discountSignature>): string {
  if (!sig.enabled || sig.amount <= 0) return 'بدون خصم';
  if (sig.type === 'percent') return `${sig.value}% (${moneyLabel(sig.amount)})`;
  return moneyLabel(sig.amount);
}

function previewModeLabel(mode: ReturnType<typeof previewSignature>['mode']): string {
  if (mode === 'preview_only') return 'معاينة بدون تركيب';
  if (mode === 'preview_with_installation') return 'معاينة مع تركيب';
  return 'بدون معاينة';
}

function paymentStatusLabel(status: ReturnType<typeof paymentSignature>['status']): string {
  if (status === 'paid') return 'مدفوع بالكامل';
  if (status === 'partial') return 'مدفوع جزئيًا';
  return 'غير مدفوع';
}

function linesProductLabel(lines: OrderSnapshotLine[]): string {
  if (lines.length === 0) return 'لا توجد منتجات';
  // Compact comma-separated product label list, capped so a
  // 10-item order doesn't blow up the audit row. Phase Orders-Edit-2
  // — include color when present (e.g. "حامل مصحف (بني)") so a
  // pure color swap registers as a `products` diff and lands in the
  // audit timeline.
  const labels = lines.slice(0, 5).map((l) => {
    const base = l.label || l.productType || '—';
    const color = (l.color ?? '').trim();
    return color ? `${base} (${color})` : base;
  });
  const more = lines.length > 5 ? ` و${lines.length - 5} منتج إضافي` : '';
  return `${labels.join('، ')}${more}`;
}

function pushScalar(
  out: OrderChange[],
  field: string,
  label: string,
  before: ScalarValue,
  after: ScalarValue
) {
  const beforeNorm = typeof before === 'string' ? before.trim() : before;
  const afterNorm = typeof after === 'string' ? after.trim() : after;
  if (typeof beforeNorm === 'number' && typeof afterNorm === 'number') {
    if (numEq(beforeNorm, afterNorm)) return;
  } else if (beforeNorm === afterNorm) {
    return;
  }
  out.push({ field, label, before, after });
}

/**
 * Compute a diff between two order snapshots. Each entry carries a
 * machine key + short Arabic label + before/after scalars. Lines
 * are summarised as product-count + label-list + subtotal so the
 * audit row never embeds the full jsonb.
 */
export function diffOrders(before: OrderSnapshot, after: OrderSnapshot): OrderChange[] {
  const out: OrderChange[] = [];

  pushScalar(out, 'customer_name', 'اسم العميل', before.customer ?? '', after.customer ?? '');
  pushScalar(out, 'phone', 'رقم الهاتف', before.phone ?? '', after.phone ?? '');
  pushScalar(out, 'phone2', 'رقم هاتف إضافي', before.phone2 ?? '', after.phone2 ?? '');
  pushScalar(out, 'region', 'المحافظة', before.region ?? '', after.region ?? '');
  pushScalar(out, 'district', 'المنطقة', before.district ?? '', after.district ?? '');
  pushScalar(
    out,
    'neighborhood',
    'الحي / القرية',
    before.neighborhood ?? '',
    after.neighborhood ?? ''
  );
  pushScalar(out, 'address', 'العنوان', before.address ?? '', after.address ?? '');

  pushScalar(
    out,
    'free_shipping',
    'شحن مجاني',
    before.freeShipping ? 'نعم' : 'لا',
    after.freeShipping ? 'نعم' : 'لا'
  );
  pushScalar(
    out,
    'express_shipping',
    'شحن سريع',
    before.expressShipping ? 'نعم' : 'لا',
    after.expressShipping ? 'نعم' : 'لا'
  );

  // Lines: count + label-list + subtotal summary.
  if (before.lines.length !== after.lines.length) {
    pushScalar(out, 'lines_count', 'عدد المنتجات', before.lines.length, after.lines.length);
  }
  const beforeLabels = linesProductLabel(before.lines);
  const afterLabels = linesProductLabel(after.lines);
  if (beforeLabels !== afterLabels) {
    pushScalar(out, 'products', 'المنتجات', beforeLabels, afterLabels);
  }
  if (!numEq(before.subtotal, after.subtotal)) {
    pushScalar(
      out,
      'subtotal',
      'إجمالي المنتجات',
      moneyLabel(before.subtotal),
      moneyLabel(after.subtotal)
    );
  }
  if (!numEq(before.shippingFee, after.shippingFee)) {
    pushScalar(
      out,
      'shipping_fee',
      'مصاريف الشحن',
      moneyLabel(before.shippingFee),
      moneyLabel(after.shippingFee)
    );
  }
  if (!numEq(before.total, after.total)) {
    pushScalar(out, 'total', 'الإجمالي', moneyLabel(before.total), moneyLabel(after.total));
  }

  // Discount.
  const beforeDiscount = discountSignature(before.checkoutDetails);
  const afterDiscount = discountSignature(after.checkoutDetails);
  const discountChanged =
    beforeDiscount.enabled !== afterDiscount.enabled ||
    beforeDiscount.type !== afterDiscount.type ||
    !numEq(beforeDiscount.value, afterDiscount.value) ||
    !numEq(beforeDiscount.amount, afterDiscount.amount);
  if (discountChanged) {
    pushScalar(
      out,
      'discount',
      'الخصم',
      discountLabel(beforeDiscount),
      discountLabel(afterDiscount)
    );
  }
  if (beforeDiscount.reason !== afterDiscount.reason) {
    pushScalar(out, 'discount_reason', 'سبب الخصم', beforeDiscount.reason, afterDiscount.reason);
  }
  if (beforeDiscount.by !== afterDiscount.by) {
    pushScalar(out, 'discount_by', 'تم الخصم بواسطة', beforeDiscount.by, afterDiscount.by);
  }

  // Payment.
  const beforePayment = paymentSignature(before.checkoutDetails);
  const afterPayment = paymentSignature(after.checkoutDetails);
  if (beforePayment.status !== afterPayment.status) {
    pushScalar(
      out,
      'payment_status',
      'حالة الدفع',
      paymentStatusLabel(beforePayment.status),
      paymentStatusLabel(afterPayment.status)
    );
  }
  if (!numEq(beforePayment.paid, afterPayment.paid)) {
    pushScalar(
      out,
      'paid_amount',
      'المبلغ المدفوع',
      moneyLabel(beforePayment.paid),
      moneyLabel(afterPayment.paid)
    );
  }
  if (beforePayment.method !== afterPayment.method) {
    pushScalar(out, 'payment_method', 'وسيلة الدفع', beforePayment.method, afterPayment.method);
  }
  if (beforePayment.paidTo !== afterPayment.paidTo) {
    pushScalar(out, 'paid_to', 'مدفوع إلى', beforePayment.paidTo, afterPayment.paidTo);
  }

  // Preview + installation.
  const beforePreview = previewSignature(before.checkoutDetails);
  const afterPreview = previewSignature(after.checkoutDetails);
  if (beforePreview.mode !== afterPreview.mode) {
    pushScalar(
      out,
      'preview_mode',
      'نوع المعاينة',
      previewModeLabel(beforePreview.mode),
      previewModeLabel(afterPreview.mode)
    );
  }
  if (beforePreview.target !== afterPreview.target) {
    pushScalar(
      out,
      'installation_target',
      'هدف التركيب',
      beforePreview.target,
      afterPreview.target
    );
  }
  if (beforePreview.payer !== afterPreview.payer) {
    pushScalar(out, 'installation_payer', 'دافع التركيب', beforePreview.payer, afterPreview.payer);
  }

  return out;
}

/** Short Arabic description for the audit row description column. */
export function buildArabicDescription(orderNum: string, changes: OrderChange[]): string {
  if (changes.length === 0) return `تم حفظ الطلب ${orderNum} بدون تغييرات`;
  const top = changes
    .slice(0, 5)
    .map((c) => c.label)
    .join('، ');
  const more = changes.length > 5 ? ` و${changes.length - 5} حقل آخر` : '';
  return `تم تعديل الطلب ${orderNum}: ${top}${more}`;
}

/** Compact metadata payload for `turath_masr_staff_audit_logs.metadata`. */
export function buildStaffAuditMetadata(
  orderId: string,
  orderNum: string,
  before: OrderSnapshot,
  after: OrderSnapshot,
  changes: OrderChange[]
): Record<string, unknown> {
  return {
    order_id: orderId,
    order_num: orderNum,
    changed_fields: changes.map((c) => c.field),
    changes: changes.map((c) => ({
      field: c.field,
      label: c.label,
      before: c.before,
      after: c.after,
    })),
    lines_count_before: before.lines.length,
    lines_count_after: after.lines.length,
    subtotal_before: before.subtotal,
    subtotal_after: after.subtotal,
    total_before: before.total,
    total_after: after.total,
  };
}
