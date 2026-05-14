export type PreviewMode = 'none' | 'preview_only' | 'preview_with_installation';
export type InstallationTarget = 'mosque' | 'customer' | null;
export type InstallationPayer = 'customer' | 'factory';
export type PaymentStatus = 'unpaid' | 'paid' | 'partial';

// Phase Orders-Edit-1 — discount kind. `fixed` is the legacy default
// (an EGP amount the staff member typed directly). `percent` is the
// new mode where the staff member types a 0–100 number and the
// engine derives the amount from the gross total at save time. The
// `null` literal is intentionally absent — when discount.enabled is
// false the type field still carries the last selected mode so the
// UI can re-expand to the same view without losing the user's
// intent. Existing orders that pre-date Phase Orders-Edit-1 carry
// no `type` field; the parse helper defaults them to `fixed`.
export type DiscountType = 'fixed' | 'percent';

export const HOLDER_INSTALLATION_UNIT_PRICE = 20;

export const PAYMENT_METHOD_OPTIONS = [
  'كاش',
  'فودافون كاش',
  'إنستاباي',
  'تحويل بنكي',
  'بطاقة',
  'أخرى',
] as const;

export interface CheckoutDetails {
  version: 1;
  preview_mode: PreviewMode;
  installation: {
    enabled: boolean;
    target: InstallationTarget;
    payer: InstallationPayer | null;
    unit_price: number;
    holder_quantity: number;
    customer_charge: number;
  };
  discount: {
    // Phase Orders-Edit-1 — explicit gate so the staff member can
    // collapse the section back to "no discount" without losing
    // the rest of the values. Pre-26H-2 envelopes (no `enabled`
    // field) are inferred from `amount > 0` at parse time.
    enabled: boolean;
    // Phase Orders-Edit-1 — discount kind (`fixed` | `percent`).
    // Pre-Orders-Edit-1 envelopes default to `fixed`.
    type: DiscountType;
    // Phase Orders-Edit-1 — the raw value the user typed. For
    // `fixed`, this equals `amount`. For `percent`, this is the
    // 0–100 number and `amount` is the derived EGP value at the
    // gross total at save time.
    value: number;
    amount: number;
    reason: string | null;
    by: string | null;
    by_user_id: string | null;
  };
  payment: {
    status: PaymentStatus;
    paid_amount: number;
    paid_to: string | null;
    method: string | null;
    remaining_amount: number;
  };
  totals: {
    products_subtotal: number;
    shipping: number;
    installation_customer_charge: number;
    gross_total: number;
    discount: number;
    final_total: number;
  };
}

const START_MARKER = '[[TURATH_CHECKOUT_DETAILS_V1]]';
const END_MARKER = '[[/TURATH_CHECKOUT_DETAILS_V1]]';

function money(value: number): string {
  return `${Number(value || 0).toLocaleString('en-US')} ج.م`;
}

export function previewModeLabel(mode: PreviewMode): string {
  if (mode === 'preview_only') return 'معاينة بدون تركيب';
  if (mode === 'preview_with_installation') return 'معاينة مع تركيب';
  return 'بدون معاينة';
}

export function paymentStatusLabel(status: PaymentStatus): string {
  if (status === 'paid') return 'مدفوع بالكامل';
  if (status === 'partial') return 'مدفوع جزئيًا';
  return 'غير مدفوع';
}

export function installationSummaryLabel(details: CheckoutDetails): string | null {
  const installation = details.installation;
  if (!installation.enabled || details.preview_mode !== 'preview_with_installation') return null;
  if (installation.target === 'mosque') return 'معاينة مع تركيب للمسجد — مجاني';
  if (installation.target === 'customer' && installation.payer === 'factory') {
    return 'تركيب الحامل: على المصنع — مجاني للعميل';
  }
  if (installation.target === 'customer' && installation.payer === 'customer') {
    return `تركيب الحامل: ${installation.holder_quantity} × ${installation.unit_price} = ${money(
      installation.customer_charge
    )}`;
  }
  return null;
}

export function checkoutDetailsLines(details: CheckoutDetails): string[] {
  const lines = [`المعاينة: ${previewModeLabel(details.preview_mode)}`];
  const installation = installationSummaryLabel(details);
  if (installation) lines.push(installation);
  if (details.discount.amount > 0) {
    // Phase Orders-Edit-1 — surface percent type when present.
    // Pre-Orders-Edit-1 envelopes parse with `type='fixed'`, so the
    // percent branch only triggers for orders saved by the new UI.
    if (details.discount.type === 'percent' && details.discount.value > 0) {
      lines.push(`الخصم: ${details.discount.value}% (${money(details.discount.amount)})`);
    } else {
      lines.push(`الخصم: ${money(details.discount.amount)}`);
    }
    if (details.discount.reason) lines.push(`سبب الخصم: ${details.discount.reason}`);
    if (details.discount.by) lines.push(`تم الخصم بواسطة: ${details.discount.by}`);
  }
  lines.push(`حالة الدفع: ${paymentStatusLabel(details.payment.status)}`);
  if (details.payment.status !== 'unpaid') {
    lines.push(`المدفوع: ${money(details.payment.paid_amount)}`);
    lines.push(`المتبقي: ${money(details.payment.remaining_amount)}`);
    if (details.payment.method) lines.push(`وسيلة الدفع: ${details.payment.method}`);
    if (details.payment.paid_to) lines.push(`مدفوع إلى: ${details.payment.paid_to}`);
  }
  lines.push(`الإجمالي قبل الخصم: ${money(details.totals.gross_total)}`);
  if (details.totals.discount > 0) lines.push(`الخصم: ${money(details.totals.discount)}`);
  lines.push(`الإجمالي النهائي: ${money(details.totals.final_total)}`);
  return lines;
}

export function buildCheckoutDetailsBlock(details: CheckoutDetails): string {
  const readable = [
    'تفاصيل المعاينة والدفع:',
    ...checkoutDetailsLines(details).map((line) => `- ${line}`),
  ];
  return `${readable.join('\n')}\n${START_MARKER}${JSON.stringify(details)}${END_MARKER}`;
}

export function stripCheckoutDetailsBlock(notes: string | null | undefined): string {
  if (!notes) return '';
  const start = notes.indexOf('تفاصيل المعاينة والدفع:');
  const markerStart = notes.indexOf(START_MARKER);
  const markerEnd = notes.indexOf(END_MARKER);
  if (start >= 0 && markerStart >= start && markerEnd >= markerStart) {
    return `${notes.slice(0, start)}${notes.slice(markerEnd + END_MARKER.length)}`.trim();
  }
  if (markerStart >= 0 && markerEnd >= markerStart) {
    return `${notes.slice(0, markerStart)}${notes.slice(markerEnd + END_MARKER.length)}`.trim();
  }
  return notes.trim();
}

export function appendCheckoutDetailsToNotes(
  notes: string | null | undefined,
  details: CheckoutDetails
): string {
  return [stripCheckoutDetailsBlock(notes), buildCheckoutDetailsBlock(details)]
    .filter((part) => part.trim())
    .join('\n\n');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function parseCheckoutDetailsFromNotes(
  notes: string | null | undefined
): CheckoutDetails | null {
  if (!notes) return null;
  const markerStart = notes.indexOf(START_MARKER);
  const markerEnd = notes.indexOf(END_MARKER);
  if (markerStart < 0 || markerEnd <= markerStart) return null;

  try {
    const json = notes.slice(markerStart + START_MARKER.length, markerEnd);
    const raw = asRecord(JSON.parse(json));
    if (!raw || raw.version !== 1) return null;

    const installation = asRecord(raw.installation) ?? {};
    const discount = asRecord(raw.discount) ?? {};
    const payment = asRecord(raw.payment) ?? {};
    const totals = asRecord(raw.totals) ?? {};
    const previewMode =
      raw.preview_mode === 'preview_only' || raw.preview_mode === 'preview_with_installation'
        ? raw.preview_mode
        : 'none';
    const paymentStatus =
      payment.status === 'paid' || payment.status === 'partial' ? payment.status : 'unpaid';

    return {
      version: 1,
      preview_mode: previewMode,
      installation: {
        enabled: installation.enabled === true,
        target:
          installation.target === 'mosque' || installation.target === 'customer'
            ? installation.target
            : null,
        payer:
          installation.payer === 'factory'
            ? 'factory'
            : installation.payer === 'customer'
              ? 'customer'
              : null,
        unit_price: asNumber(installation.unit_price) || HOLDER_INSTALLATION_UNIT_PRICE,
        holder_quantity: asNumber(installation.holder_quantity),
        customer_charge: asNumber(installation.customer_charge),
      },
      discount: (() => {
        // Phase Orders-Edit-1 — backward-compatible parse. Pre-26H-2
        // envelopes carry only `{ amount, reason, by, by_user_id }`;
        // we infer:
        //   • `enabled` from explicit field, falling back to
        //     `amount > 0` (old envelopes that did record a value).
        //   • `type` from explicit field, falling back to `fixed`.
        //   • `value` from explicit field, falling back to `amount`
        //     so legacy fixed-amount envelopes round-trip
        //     unchanged through the new UI.
        const amount = asNumber(discount.amount);
        const explicitEnabled = typeof discount.enabled === 'boolean' ? discount.enabled : null;
        const explicitType =
          discount.type === 'fixed' || discount.type === 'percent' ? discount.type : null;
        const explicitValue =
          typeof discount.value === 'number' && Number.isFinite(discount.value)
            ? discount.value
            : null;
        return {
          enabled: explicitEnabled ?? amount > 0,
          type: explicitType ?? 'fixed',
          value: explicitValue ?? amount,
          amount,
          reason: asString(discount.reason),
          by: asString(discount.by),
          by_user_id: asString(discount.by_user_id),
        };
      })(),
      payment: {
        status: paymentStatus,
        paid_amount: asNumber(payment.paid_amount),
        paid_to: asString(payment.paid_to),
        method: asString(payment.method),
        remaining_amount: asNumber(payment.remaining_amount),
      },
      totals: {
        products_subtotal: asNumber(totals.products_subtotal),
        shipping: asNumber(totals.shipping),
        installation_customer_charge: asNumber(totals.installation_customer_charge),
        gross_total: asNumber(totals.gross_total),
        discount: asNumber(totals.discount),
        final_total: asNumber(totals.final_total),
      },
    };
  } catch {
    return null;
  }
}
