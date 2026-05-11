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
