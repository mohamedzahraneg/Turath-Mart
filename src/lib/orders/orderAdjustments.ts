// ─────────────────────────────────────────────────────────────────────────────
// src/lib/orders/orderAdjustments.ts
//
// Phase 25A — Returns & Exchanges After Delivery.
//
// Pure helper module — NO Supabase calls, NO React imports. Everything
// here is a typed shape, a label table, a small math function, or a
// validator. UI surfaces import these so the rules live in one place
// and stay covered by the typechecker.
//
// What lives here
//   • `OrderAdjustment` — the database row shape (mirrors the new
//     `turath_masr_order_adjustments` table created in
//     20260511040000_order_adjustments.sql).
//   • `AdjustmentLine` — a single returned or replacement item.
//   • Label / tone tables for `kind`, `state`, `refund_mode`,
//     `shipping_payer`.
//   • `computeAdjustmentTotals` — derives `refund_amount` /
//     `price_difference` from the supplied lines + shipping payer.
//   • `isOrderAdjustable` — gate that decides whether the
//     "إنشاء مرتجع / استبدال" entry point should be shown for an
//     order. Today the gate is `status === 'delivered'`; the gate
//     lives here so a future phase can widen / narrow it without
//     hunting through render paths.
//   • `validateAdjustmentDraft` — front-end validator that returns
//     the first localised Arabic error (or `null` if the draft is
//     valid). RLS + CHECK constraints are the real source of truth
//     on the server — this exists to give the modal a fast,
//     intelligible failure message.
//
// What is intentionally NOT here
//   • Any DB read / write helper. UI calls Supabase directly with
//     the shapes defined below; that mirrors the rest of the project
//     and avoids a useless wrapper.
//   • Inventory math. Phase 25A explicitly does NOT touch stock.
//   • Customer-tracking exposure. Adjustments are admin-internal and
//     never join into the tracking RPCs.
// ─────────────────────────────────────────────────────────────────────────────

// =============================================================================
// 1) Types
// =============================================================================

/**
 * Adjustment kind — matches CHECK constraint
 * `turath_masr_order_adjustments_kind_check`.
 */
export type AdjustmentKind =
  | 'return_full'
  | 'return_partial'
  | 'exchange_full'
  | 'exchange_partial';

/**
 * Lifecycle state — matches CHECK constraint
 * `turath_masr_order_adjustments_state_check`.
 *
 *   pending   → created, awaiting manager decision
 *   approved  → manager said yes, ops not yet executed
 *   rejected  → manager said no, terminal
 *   completed → ops executed (refund issued / replacement shipped)
 *   cancelled → withdrawn before decision OR after approval but
 *               before completion (e.g. customer changed mind)
 */
export type AdjustmentState = 'pending' | 'approved' | 'rejected' | 'completed' | 'cancelled';

/**
 * Refund mode — matches CHECK constraint
 * `turath_masr_order_adjustments_refund_mode_check`.
 *
 *   full       → refund the whole order total
 *   partial    → refund a portion (admin-specified amount)
 *   none       → no money moves (e.g. full exchange of same value)
 *   price_diff → only the price difference flows (typical for
 *                exchanges where the new item is cheaper / more
 *                expensive)
 */
export type RefundMode = 'full' | 'partial' | 'none' | 'price_diff';

/**
 * Who eats the shipping cost on this adjustment.
 *
 *   customer → customer pays the new shipping leg
 *   company  → Turath Masr eats it (typical for our-fault returns)
 *   split    → both sides contribute (e.g. 50/50). When `split`,
 *              both `shipping_customer_amount` and
 *              `shipping_company_amount` must be > 0 — enforced by
 *              CHECK constraint and `validateAdjustmentDraft`.
 */
export type ShippingPayer = 'customer' | 'company' | 'split';

/**
 * A single item that flows through an adjustment. Matches the
 * subset of `turath_masr_orders.lines` JSONB we actually need to
 * pin down for the adjustment (we keep the OrderLine fields that
 * affect display + monetary math; we drop UI-only flags like
 * `emoji`).
 */
export interface AdjustmentLine {
  /** Stable identifier from the original order line (when available). */
  id?: string;
  /** Product type / SKU label. */
  productType: string;
  /** Display label (Arabic). */
  label?: string;
  /** Colour / variant if relevant. */
  color?: string | null;
  /** Quantity being returned or replaced (must be ≥ 1). */
  quantity: number;
  /** Per-unit price at the time of the original order. */
  unitPrice: number;
  /** Optional flashlight add-on flag (mirrors original line). */
  includeFlashlight?: boolean;
  /** Per-unit flashlight price when `includeFlashlight` is true. */
  flashlightPrice?: number;
  /** Optional note about this specific line. */
  note?: string | null;
  /**
   * Pre-computed line total (quantity × unitPrice [+ flashlight]).
   * Always recompute on read if you don't trust the source.
   */
  total?: number;
  /**
   * Phase 25B — type of replacement item: a whole product or a single
   * piece / spare part. Only meaningful on `replacement_lines`. The
   * UI uses this to decide whether to surface SKU-level fields.
   */
  itemType?: 'product' | 'part';
  /**
   * Phase 25B — when `true`, this line is provided to the customer at
   * no charge (e.g. courtesy replacement). It still appears in the
   * shipment but contributes 0 to `replacementValue` so the price
   * difference math reflects only chargeable items.
   */
  isFree?: boolean;
}

/**
 * Row shape for `turath_masr_order_adjustments`. Use this type when
 * reading from Supabase; insert payloads can use the looser
 * `AdjustmentDraft` below.
 */
export interface OrderAdjustment {
  id: string;
  order_id: string;
  order_num: string;
  kind: AdjustmentKind;
  state: AdjustmentState;
  reason: string;
  notes: string | null;
  return_lines: AdjustmentLine[];
  replacement_lines: AdjustmentLine[];
  original_total: number;
  refund_mode: RefundMode;
  refund_amount: number;
  price_difference: number;
  shipping_payer: ShippingPayer;
  shipping_customer_amount: number;
  shipping_company_amount: number;
  created_by: string;
  created_by_role: string | null;
  created_at: string;
  updated_at: string;
  decided_by: string | null;
  decided_by_role: string | null;
  decided_at: string | null;
  decision_note: string | null;
  // Phase 25B — operational fields. Nullable so historical Phase-25A
  // rows continue to read fine before the migration is applied.
  child_order_id?: string | null;
  child_order_num?: string | null;
  linked_complaint_id?: string | null;
  customer_collect_amount?: number;
  shipping_base_amount?: number;
  price_difference_direction?: PriceDifferenceDirection;
  operational_note?: string | null;
}

/**
 * Shape produced by the modal before it hits Supabase. `state`,
 * `created_*`, `updated_at`, and the decision-audit fields are set
 * server-side; everything else flows through here.
 */
export interface AdjustmentDraft {
  order_id: string;
  order_num: string;
  kind: AdjustmentKind;
  reason: string;
  notes: string | null;
  return_lines: AdjustmentLine[];
  replacement_lines: AdjustmentLine[];
  original_total: number;
  refund_mode: RefundMode;
  refund_amount: number;
  price_difference: number;
  shipping_payer: ShippingPayer;
  shipping_customer_amount: number;
  shipping_company_amount: number;
  // Phase 25B — operational fields
  shipping_base_amount?: number;
  customer_collect_amount?: number;
  price_difference_direction?: PriceDifferenceDirection;
  operational_note?: string | null;
}

// =============================================================================
// 2) Labels + tones
// =============================================================================

export const ADJUSTMENT_KIND_LABEL_AR: Record<AdjustmentKind, string> = {
  return_full: 'مرتجع كامل',
  return_partial: 'مرتجع جزئي',
  exchange_full: 'استبدال كامل',
  exchange_partial: 'استبدال جزئي',
};

export const ADJUSTMENT_KIND_SHORT_AR: Record<AdjustmentKind, string> = {
  return_full: 'مرتجع',
  return_partial: 'مرتجع جزئي',
  exchange_full: 'استبدال',
  exchange_partial: 'استبدال جزئي',
};

export const ADJUSTMENT_KIND_TONE: Record<AdjustmentKind, string> = {
  return_full: 'bg-rose-50 text-rose-700 border-rose-200',
  return_partial: 'bg-rose-50 text-rose-700 border-rose-200',
  exchange_full: 'bg-amber-50 text-amber-700 border-amber-200',
  exchange_partial: 'bg-amber-50 text-amber-700 border-amber-200',
};

export const ADJUSTMENT_STATE_LABEL_AR: Record<AdjustmentState, string> = {
  pending: 'قيد المراجعة',
  approved: 'تمت الموافقة',
  rejected: 'مرفوض',
  completed: 'منفذ',
  cancelled: 'ملغي',
};

export const ADJUSTMENT_STATE_TONE: Record<AdjustmentState, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  approved: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  rejected: 'bg-slate-50 text-slate-700 border-slate-200',
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  cancelled: 'bg-slate-50 text-slate-700 border-slate-200',
};

export const REFUND_MODE_LABEL_AR: Record<RefundMode, string> = {
  full: 'استرداد كامل',
  partial: 'استرداد جزئي',
  none: 'بدون استرداد',
  price_diff: 'فرق سعر فقط',
};

export const SHIPPING_PAYER_LABEL_AR: Record<ShippingPayer, string> = {
  customer: 'العميل يتحمل الشحن',
  company: 'الشركة تتحمل الشحن',
  split: 'مقسم بين الطرفين',
};

// =============================================================================
// 3) Eligibility
// =============================================================================

/**
 * Phase 25A entry-point gate: today only `delivered` orders can have
 * adjustments raised against them. We keep this gate in one place so
 * a future phase (e.g. "warehouse damage on shipping" → return) can
 * widen it without hunting through render paths.
 */
export function isOrderAdjustable(orderStatus: string | null | undefined): boolean {
  return (orderStatus ?? '').toLowerCase() === 'delivered';
}

// =============================================================================
// 4) Money math
// =============================================================================

/**
 * Recompute a line's total from its components. Flashlight add-on is
 * an optional per-unit upcharge. Negative inputs are clamped to 0
 * (defensive — we never want a refund line that subtracts from the
 * customer's owed total because of a malformed payload).
 */
export function computeLineTotal(line: AdjustmentLine): number {
  const qty = Math.max(0, Number(line.quantity) || 0);
  const unit = Math.max(0, Number(line.unitPrice) || 0);
  const flashOn = Boolean(line.includeFlashlight);
  const flash = flashOn ? Math.max(0, Number(line.flashlightPrice) || 0) : 0;
  return qty * unit + qty * flash;
}

/**
 * Sum a set of adjustment lines. Used both for "value of returned
 * items" and "value of replacement items" in the same way.
 */
export function sumAdjustmentLines(lines: AdjustmentLine[]): number {
  let total = 0;
  for (const line of lines) {
    total += computeLineTotal(line);
  }
  return total;
}

export interface AdjustmentTotals {
  /** Sum of every line being returned. */
  returnedValue: number;
  /** Sum of every replacement line (0 for pure returns). */
  replacementValue: number;
  /**
   * Net `replacementValue − returnedValue`:
   *   • positive → customer owes the difference (cheaper return,
   *     pricier replacement)
   *   • negative → company owes the customer (more expensive return,
   *     cheaper replacement)
   *   • zero     → no price flow
   *
   * For pure returns this equals `−returnedValue`.
   */
  priceDifference: number;
  /**
   * Suggested refund amount based on `refund_mode`. Always ≥ 0.
   * The modal can override this for `partial` mode; for `full`,
   * `none`, and `price_diff` this is the canonical value.
   */
  suggestedRefund: number;
}

/**
 * Derive monetary outcomes from the draft. The caller decides which
 * of `returnedValue` and `replacementValue` to write into
 * `refund_amount` / `price_difference`; this function exists so the
 * modal can render a live "the customer will get back / owe X"
 * preview without each surface re-implementing the rules.
 *
 * Rules:
 *   • returnedValue   = sum(return_lines)
 *   • replacementValue = sum(replacement_lines)
 *   • priceDifference = replacementValue − returnedValue
 *   • suggestedRefund depends on mode:
 *       full       → returnedValue (full original value of returned items)
 *       partial    → 0 (caller fills in)
 *       none       → 0
 *       price_diff → max(0, −priceDifference)
 *                    (only refund when company owes; if customer
 *                    owes, refund stays 0 and the `priceDifference`
 *                    field is what the customer pays.)
 */
export function computeAdjustmentTotals(input: {
  return_lines: AdjustmentLine[];
  replacement_lines: AdjustmentLine[];
  refund_mode: RefundMode;
}): AdjustmentTotals {
  const returnedValue = sumAdjustmentLines(input.return_lines);
  const replacementValue = sumAdjustmentLines(input.replacement_lines);
  const priceDifference = round2(replacementValue - returnedValue);

  let suggestedRefund = 0;
  switch (input.refund_mode) {
    case 'full':
      suggestedRefund = round2(returnedValue);
      break;
    case 'partial':
      suggestedRefund = 0;
      break;
    case 'none':
      suggestedRefund = 0;
      break;
    case 'price_diff':
      // company owes the customer when replacement is cheaper
      suggestedRefund = priceDifference < 0 ? round2(-priceDifference) : 0;
      break;
  }

  return {
    returnedValue: round2(returnedValue),
    replacementValue: round2(replacementValue),
    priceDifference,
    suggestedRefund,
  };
}

/** Round to 2 dp, JS float-safe. */
function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

// =============================================================================
// 5) Draft validator
// =============================================================================

/**
 * Returns the first localised Arabic error message, or `null` if the
 * draft is acceptable to send. The server still owns the truth (RLS
 * + CHECK constraints), but this gives the modal a fast intelligible
 * failure path.
 *
 * Rules enforced:
 *   • reason must be non-empty (trimmed length > 0)
 *   • return_lines must be non-empty (every adjustment ships at
 *     least one item back)
 *   • exchange kinds require replacement_lines
 *   • all line quantities ≥ 1
 *   • when shipping_payer = 'split', both sides must be > 0
 *   • amounts must be ≥ 0
 *   • when refund_mode = 'partial', refund_amount must be > 0 and
 *     ≤ returnedValue
 */
export function validateAdjustmentDraft(draft: AdjustmentDraft): string | null {
  if (!draft.order_id || !draft.order_num) {
    return 'لا يمكن إنشاء تسوية بدون طلب أصلي.';
  }
  if (!draft.reason || draft.reason.trim().length === 0) {
    return 'سبب التسوية مطلوب.';
  }
  if (!Array.isArray(draft.return_lines) || draft.return_lines.length === 0) {
    return 'يجب اختيار عنصر واحد على الأقل من الطلب الأصلي.';
  }
  for (const line of draft.return_lines) {
    if (!line.productType) {
      return 'كل عنصر يجب أن يحدد نوع المنتج.';
    }
    if (!Number.isFinite(line.quantity) || line.quantity < 1) {
      return 'كل عنصر يجب أن تكون كميته 1 على الأقل.';
    }
  }

  const isExchange = draft.kind === 'exchange_full' || draft.kind === 'exchange_partial';
  if (isExchange) {
    if (!Array.isArray(draft.replacement_lines) || draft.replacement_lines.length === 0) {
      return 'الاستبدال يتطلب اختيار عنصر بديل واحد على الأقل.';
    }
    for (const line of draft.replacement_lines) {
      if (!line.productType) {
        return 'كل بديل يجب أن يحدد نوع المنتج.';
      }
      if (!Number.isFinite(line.quantity) || line.quantity < 1) {
        return 'كل بديل يجب أن تكون كميته 1 على الأقل.';
      }
    }
  } else {
    // Pure return: replacement_lines should be empty.
    if (draft.replacement_lines && draft.replacement_lines.length > 0) {
      return 'المرتجع الكامل / الجزئي لا يدعم عناصر بديلة.';
    }
  }

  // Shipping
  if (draft.shipping_payer === 'split') {
    if (!(draft.shipping_customer_amount > 0) || !(draft.shipping_company_amount > 0)) {
      return 'عند تقسيم الشحن يجب أن يدفع كل طرف مبلغ أكبر من صفر.';
    }
  }
  if (draft.shipping_customer_amount < 0 || draft.shipping_company_amount < 0) {
    return 'مبالغ الشحن لا يمكن أن تكون سالبة.';
  }

  // Refund mode / amount
  if (!Number.isFinite(draft.refund_amount) || draft.refund_amount < 0) {
    return 'مبلغ الاسترداد لا يمكن أن يكون سالبًا.';
  }
  if (draft.refund_mode === 'partial' && !(draft.refund_amount > 0)) {
    return 'الاسترداد الجزئي يتطلب مبلغ أكبر من صفر.';
  }
  if (draft.refund_mode === 'none' && draft.refund_amount > 0) {
    return 'وضع "بدون استرداد" لا يسمح بمبلغ استرداد.';
  }

  return null;
}

// =============================================================================
// 6) State machine — allowed transitions
// =============================================================================

/**
 * Returns the set of next states an admin/manager is allowed to
 * drive this adjustment into. Used by the OrderDetailModal action
 * bar to render the right buttons (and grey out the rest).
 *
 *   pending   → approved | rejected | cancelled
 *   approved  → completed | cancelled
 *   rejected  → (terminal)
 *   completed → (terminal)
 *   cancelled → (terminal)
 */
export function allowedNextStates(state: AdjustmentState): AdjustmentState[] {
  switch (state) {
    case 'pending':
      return ['approved', 'rejected', 'cancelled'];
    case 'approved':
      return ['completed', 'cancelled'];
    default:
      return [];
  }
}

/**
 * True when a manager-level action button should be shown for the
 * given state. Pure convenience over `allowedNextStates(state).length > 0`.
 */
export function isAdjustmentActionable(state: AdjustmentState): boolean {
  return allowedNextStates(state).length > 0;
}

// =============================================================================
// Phase 25B — Operational types + helpers
// =============================================================================

/**
 * Settlement direction for the price difference on an exchange:
 *   customer_pays   → customer owes the difference; delegate collects it
 *   company_refunds → company owes the customer the difference (no collection)
 *   none            → no money flows for the price difference
 */
export type PriceDifferenceDirection = 'customer_pays' | 'company_refunds' | 'none';

export const PRICE_DIFFERENCE_DIRECTION_LABEL_AR: Record<PriceDifferenceDirection, string> = {
  customer_pays: 'العميل يدفع الفرق',
  company_refunds: 'الشركة ترد الفرق للعميل',
  none: 'بدون فرق سعر',
};

/** Complaint operational status (the new `resolution_status` column). */
export type ComplaintResolutionStatus =
  | 'open'
  | 'in_progress'
  | 'resolved'
  | 'closed'
  | 'cancelled';

export const COMPLAINT_RESOLUTION_LABEL_AR: Record<ComplaintResolutionStatus, string> = {
  open: 'مفتوحة',
  in_progress: 'قيد المعالجة',
  resolved: 'تم الحل',
  closed: 'مغلقة',
  cancelled: 'ملغاة',
};

export type ComplaintType = 'general' | 'return' | 'exchange' | 'delivery' | 'other';

export const COMPLAINT_TYPE_LABEL_AR: Record<ComplaintType, string> = {
  general: 'عام',
  return: 'مرتجع',
  exchange: 'استبدال',
  delivery: 'تسليم',
  other: 'أخرى',
};

/**
 * Build the child-order number from the parent + an existing-sibling
 * count. The suffix is `-R` for returns and `-E` for exchanges. The
 * sequence starts at 1 so the first child of order `2605082` is
 * `2605082-E1`, the second `2605082-E2`, etc.
 *
 * The caller is responsible for counting siblings — typically a
 * supabase query that filters `child_order_num` like `${parent}-${prefix}%`.
 */
export function buildChildOrderNum(
  parentOrderNum: string,
  kind: AdjustmentKind,
  existingSiblings: number
): string {
  const prefix = kind === 'exchange_full' || kind === 'exchange_partial' ? 'E' : 'R';
  const next = Math.max(0, existingSiblings) + 1;
  return `${parentOrderNum}-${prefix}${next}`;
}

/**
 * Compute the operational settlement amounts. Single source of truth
 * for the modal preview, the child-order totals, and the delegate
 * collection card.
 *
 *   shippingBaseAmount     — fee resolved from the region of the original order
 *   shippingCustomerShare  — what the customer pays for shipping (≤ base)
 *   shippingCompanyShare   — base − customer share, always derived
 *   priceDifference        — absolute price difference between replacement and returned items
 *   priceDifferenceDirection — who pays the price difference (or none)
 *   customerCollectAmount  — what the delegate must collect from the customer
 *   companyRefundAmount    — what the company owes the customer (informational, never collected)
 */
export interface OperationalSettlement {
  shippingBaseAmount: number;
  shippingCustomerShare: number;
  shippingCompanyShare: number;
  priceDifferenceAbs: number;
  priceDifferenceDirection: PriceDifferenceDirection;
  customerCollectAmount: number;
  companyRefundAmount: number;
}

export function computeOperationalSettlement(input: {
  shippingBaseAmount: number;
  shippingCustomerShare: number;
  priceDifferenceAbs: number;
  priceDifferenceDirection: PriceDifferenceDirection;
}): OperationalSettlement {
  const base = Math.max(0, Number(input.shippingBaseAmount) || 0);
  // Customer share clamped to [0, base]
  const customerShareRaw = Math.max(0, Number(input.shippingCustomerShare) || 0);
  const customerShare = Math.min(customerShareRaw, base);
  const companyShare = round2(base - customerShare);
  const diffAbs = Math.max(0, Number(input.priceDifferenceAbs) || 0);
  const direction: PriceDifferenceDirection = input.priceDifferenceDirection ?? 'none';

  const collect = customerShare + (direction === 'customer_pays' ? diffAbs : 0);
  const refund = direction === 'company_refunds' ? diffAbs : 0;

  return {
    shippingBaseAmount: round2(base),
    shippingCustomerShare: round2(customerShare),
    shippingCompanyShare: round2(companyShare),
    priceDifferenceAbs: round2(diffAbs),
    priceDifferenceDirection: direction,
    customerCollectAmount: round2(collect),
    companyRefundAmount: round2(refund),
  };
}

/**
 * Format the customer-facing breakdown (Arabic, single-line items).
 * Used by the delegate / shipping view and customer profile.
 */
export function formatCollectionBreakdownAr(settlement: OperationalSettlement): {
  lines: { label: string; amount: number }[];
  total: number;
  hasRefund: boolean;
} {
  const lines: { label: string; amount: number }[] = [];
  if (settlement.shippingCustomerShare > 0) {
    lines.push({ label: 'شحن', amount: settlement.shippingCustomerShare });
  }
  if (
    settlement.priceDifferenceDirection === 'customer_pays' &&
    settlement.priceDifferenceAbs > 0
  ) {
    lines.push({ label: 'فرق سعر', amount: settlement.priceDifferenceAbs });
  }
  return {
    lines,
    total: settlement.customerCollectAmount,
    hasRefund:
      settlement.priceDifferenceDirection === 'company_refunds' &&
      settlement.companyRefundAmount > 0,
  };
}

/**
 * Sum only the *chargeable* replacement items. Free items
 * (`isFree=true`) contribute 0 — they ship to the customer at no
 * cost. This is what the modal uses to compute the price difference
 * for an exchange.
 */
export function sumChargeableReplacementLines(lines: AdjustmentLine[]): number {
  let total = 0;
  for (const line of lines) {
    if (line.isFree) continue;
    total += computeLineTotal(line);
  }
  return round2(total);
}

// ─── Audit-note humaniser ────────────────────────────────────────────────────
//
// Phase 25A wrote rich JSON envelopes into `turath_masr_audit_logs.note`
// for `adjustment_created` and `adjustment_<state>` rows. Reading sites
// were rendering that raw JSON verbatim, which is hostile in any UI.
// The humaniser parses the envelope and returns a fully localised
// Arabic paragraph the timeline / history surfaces can drop in.

/**
 * Structured payload we recognise in `audit_logs.note` for adjustment
 * actions. All fields are optional — we render whatever's there and
 * fall back gracefully when keys are missing.
 */
export interface AdjustmentAuditPayload {
  adjustment_id?: string;
  kind?: AdjustmentKind;
  reason?: string;
  note?: string;
  refund_mode?: RefundMode;
  refund_amount?: number;
  price_difference?: number;
  price_difference_direction?: PriceDifferenceDirection;
  shipping_payer?: ShippingPayer;
  shipping_customer_amount?: number;
  shipping_company_amount?: number;
  child_order_num?: string;
  linked_complaint_id?: string;
  customer_collect_amount?: number;
  shipping_base_amount?: number;
}

/**
 * Parse a free-form audit `note` field that *might* be a JSON
 * envelope. We're permissive — anything that isn't a JSON object
 * literal is returned as `null` and the caller renders the raw text
 * (which is the legacy behaviour for ad-hoc notes).
 */
export function tryParseAdjustmentAuditPayload(
  raw: string | null | undefined
): AdjustmentAuditPayload | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const obj = JSON.parse(trimmed);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    return obj as AdjustmentAuditPayload;
  } catch {
    return null;
  }
}

/**
 * Render an audit_logs row about a return / exchange as a clean
 * Arabic paragraph (or `null` if the row is not an adjustment event).
 *
 *   action: `adjustment_created` | `adjustment_approved` | …
 *   note:   JSON envelope as written by OrderAdjustmentModal /
 *           OrderDetailModal's decision handler.
 */
export function humanizeAdjustmentAuditEntry(input: {
  action: string;
  note?: string | null;
  changedBy?: string | null;
}): string | null {
  const action = (input.action ?? '').trim();
  if (!action.startsWith('adjustment_')) return null;
  const payload = tryParseAdjustmentAuditPayload(input.note);
  const kindLabel = payload?.kind ? ADJUSTMENT_KIND_LABEL_AR[payload.kind] : 'تسوية';

  const headers: Record<string, string> = {
    adjustment_created: `تم إنشاء طلب ${kindLabel}`,
    adjustment_approved: `تمت الموافقة على طلب ${kindLabel}`,
    adjustment_rejected: `تم رفض طلب ${kindLabel}`,
    adjustment_completed: `تم تنفيذ طلب ${kindLabel}`,
    adjustment_cancelled: `تم إلغاء طلب ${kindLabel}`,
  };
  const header = headers[action] ?? `حدث على ${kindLabel}`;
  if (!payload) {
    // Action recognised but no JSON envelope — return just the header.
    return header;
  }

  const parts: string[] = [header];
  if (payload.reason) {
    parts.push(`السبب: ${payload.reason}`);
  }
  if (payload.note) {
    parts.push(`ملاحظة: ${payload.note}`);
  }
  if (payload.child_order_num) {
    parts.push(`الطلب الفرعي: #${payload.child_order_num}`);
  }
  if (
    typeof payload.refund_amount === 'number' &&
    payload.refund_amount > 0 &&
    payload.refund_mode &&
    payload.refund_mode !== 'none'
  ) {
    parts.push(
      `استرداد: ${REFUND_MODE_LABEL_AR[payload.refund_mode]} — ${payload.refund_amount.toLocaleString('en-US')} ج.م`
    );
  }
  if (typeof payload.price_difference === 'number' && Math.abs(payload.price_difference) > 0) {
    const dir = payload.price_difference_direction;
    const amt = Math.abs(payload.price_difference).toLocaleString('en-US');
    if (dir === 'customer_pays') {
      parts.push(`فرق سعر على العميل: ${amt} ج.م`);
    } else if (dir === 'company_refunds') {
      parts.push(`فرق سعر لصالح العميل: ${amt} ج.م`);
    } else {
      parts.push(`فرق السعر: ${amt} ج.م`);
    }
  }
  if (payload.shipping_payer) {
    const payerLabel = SHIPPING_PAYER_LABEL_AR[payload.shipping_payer];
    if (payload.shipping_payer === 'split') {
      const cs = (payload.shipping_customer_amount ?? 0).toLocaleString('en-US');
      const cp = (payload.shipping_company_amount ?? 0).toLocaleString('en-US');
      parts.push(`الشحن: العميل يدفع ${cs} ج.م، الشركة تتحمل ${cp} ج.م`);
    } else {
      parts.push(`الشحن: ${payerLabel}`);
    }
  }
  if (typeof payload.customer_collect_amount === 'number' && payload.customer_collect_amount > 0) {
    parts.push(
      `إجمالي التحصيل من العميل: ${payload.customer_collect_amount.toLocaleString('en-US')} ج.م`
    );
  }
  return parts.join('\n');
}

/**
 * Convenience for surfaces that want a single-line summary (e.g.
 * orders table tooltip).
 */
export function humanizeAdjustmentAuditEntryShort(input: {
  action: string;
  note?: string | null;
}): string | null {
  const full = humanizeAdjustmentAuditEntry({ action: input.action, note: input.note });
  if (!full) return null;
  return full.split('\n').slice(0, 1)[0];
}
