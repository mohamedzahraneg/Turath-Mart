// ─────────────────────────────────────────────────────────────────────────────
// src/app/orders-management/components/OrderAdjustmentModal.tsx
//
// Phase 25A — Create a return / exchange against an already-delivered
// order. Mounted from OrderDetailModal's action bar when
// `isOrderAdjustable(liveOrder.status)` returns true.
//
// What it does
//   • Lets an admin / manager / CRM agent pick the adjustment kind
//     (full / partial return, full / partial exchange).
//   • For partial returns / exchanges, lets them tick which order
//     lines (and how many units of each) are being returned.
//   • For exchanges, lets them add replacement lines using the same
//     line shape as the original order.
//   • Records refund mode + amount, optional price difference, and
//     who pays the new shipping leg (with split-validation).
//   • Requires a reason — enforced by both the front-end validator
//     and the DB CHECK constraint.
//   • Submits an INSERT into `turath_masr_order_adjustments` with
//     `state='pending'` and writes a matching `turath_masr_audit_logs`
//     row so the order's audit timeline reflects the new request.
//   • Never mutates `turath_masr_orders.status` — the original order
//     stays as `delivered` per Phase 25A scope discipline.
//
// What it intentionally does NOT do
//   • Touch inventory.
//   • Auto-approve. State always starts at `pending`. A manager
//     drives the approval workflow via OrderDetailModal.
//   • Send anything to the customer-tracking surfaces. The
//     adjustment is admin-internal.
// ─────────────────────────────────────────────────────────────────────────────
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  X,
  AlertTriangle,
  Package,
  RotateCcw,
  Repeat,
  Wallet,
  Truck,
  CheckCircle,
  Minus,
  Plus,
  Trash2,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
// Phase 26D-1 — staff audit log mirror for adjustment creation.
import { writeStaffAuditLog } from '@/lib/security/staffAudit';
import {
  ADJUSTMENT_KIND_LABEL_AR,
  PRICE_DIFFERENCE_DIRECTION_LABEL_AR,
  REFUND_MODE_LABEL_AR,
  SHIPPING_PAYER_LABEL_AR,
  computeAdjustmentTotals,
  computeOperationalSettlement,
  sumChargeableReplacementLines,
  validateAdjustmentDraft,
  type AdjustmentDraft,
  type AdjustmentKind,
  type AdjustmentLine,
  type PriceDifferenceDirection,
  type RefundMode,
  type ShippingPayer,
} from '@/lib/orders/orderAdjustments';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface OrderLine {
  productType: string;
  label: string;
  image?: string | null;
  emoji?: string;
  color?: string | null;
  quantity: number;
  unitPrice: number;
  includeFlashlight?: boolean;
  flashlightPrice?: number;
  note?: string | null;
  total: number;
}

interface OrderSummary {
  id: string;
  orderNum: string;
  customer: string;
  phone: string;
  total: number;
  lines: OrderLine[];
  /** Phase 25B — used to seed base shipping for the new shipment leg. */
  shippingFee?: number;
  region?: string;
  district?: string | null;
  neighborhood?: string | null;
}

interface Props {
  order: OrderSummary;
  onClose: () => void;
  onCreated?: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const fmtEgp = (n: number) => `${(Number.isFinite(n) ? n : 0).toLocaleString('en-US')} ج.م`;

const KIND_OPTIONS: { value: AdjustmentKind; label: string; icon: React.ReactNode }[] = [
  {
    value: 'return_full',
    label: ADJUSTMENT_KIND_LABEL_AR.return_full,
    icon: <RotateCcw size={14} />,
  },
  {
    value: 'return_partial',
    label: ADJUSTMENT_KIND_LABEL_AR.return_partial,
    icon: <RotateCcw size={14} />,
  },
  {
    value: 'exchange_full',
    label: ADJUSTMENT_KIND_LABEL_AR.exchange_full,
    icon: <Repeat size={14} />,
  },
  {
    value: 'exchange_partial',
    label: ADJUSTMENT_KIND_LABEL_AR.exchange_partial,
    icon: <Repeat size={14} />,
  },
];

const REFUND_OPTIONS: { value: RefundMode; label: string }[] = [
  { value: 'full', label: REFUND_MODE_LABEL_AR.full },
  { value: 'partial', label: REFUND_MODE_LABEL_AR.partial },
  { value: 'none', label: REFUND_MODE_LABEL_AR.none },
  { value: 'price_diff', label: REFUND_MODE_LABEL_AR.price_diff },
];

const SHIPPING_OPTIONS: { value: ShippingPayer; label: string }[] = [
  { value: 'company', label: SHIPPING_PAYER_LABEL_AR.company },
  { value: 'customer', label: SHIPPING_PAYER_LABEL_AR.customer },
  { value: 'split', label: SHIPPING_PAYER_LABEL_AR.split },
];

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function OrderAdjustmentModal({ order, onClose, onCreated }: Props) {
  const { user, profileFullName, currentRoleId } = useAuth();

  // ── 1) Kind
  const [kind, setKind] = useState<AdjustmentKind>('return_full');

  // ── 2) Lines being returned. Each original-order line has its own
  //       "qty being returned" counter. We pre-populate full quantities
  //       when kind === '*_full' and zero-everything for '*_partial'.
  type ReturnRow = {
    line: OrderLine;
    selected: boolean;
    qty: number;
  };
  const [returnRows, setReturnRows] = useState<ReturnRow[]>(() =>
    order.lines.map((line) => ({
      line,
      selected: true,
      qty: line.quantity,
    }))
  );

  // ── 3) Replacement lines (exchanges only)
  const [replacementLines, setReplacementLines] = useState<AdjustmentLine[]>([]);

  // ── 4) Refund
  const [refundMode, setRefundMode] = useState<RefundMode>('full');
  const [refundAmount, setRefundAmount] = useState<number>(0);

  // ── 5) Shipping — Phase 25B: base comes from the original order's
  //     region fee (read-only). Only the customer share is editable
  //     (when the payer is `customer` or `split`); the company share
  //     is always derived as `base − customer share`.
  const [shippingPayer, setShippingPayer] = useState<ShippingPayer>('company');
  const initialBase = Math.max(0, Number(order.shippingFee) || 0);
  const [shippingBaseAmount, setShippingBaseAmount] = useState<number>(initialBase);
  const [shippingCustomerShare, setShippingCustomerShare] = useState<number>(0);

  // ── 5b) Price difference direction (Phase 25B). Explicit settlement
  //       direction for exchanges replacing the old implicit
  //       `refund_mode: price_diff` behaviour.
  const [priceDirection, setPriceDirection] = useState<PriceDifferenceDirection>('none');

  // ── 6) Reason + notes
  const [reason, setReason] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [operationalNote, setOperationalNote] = useState<string>('');

  // Submission state
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Switching kind reseeds the returnRows + clears replacement lines
  // for the kinds that don't need them.
  useEffect(() => {
    if (kind === 'return_full' || kind === 'exchange_full') {
      // Full kinds: every line is selected at full quantity, locked.
      setReturnRows((rows) => rows.map((r) => ({ ...r, selected: true, qty: r.line.quantity })));
    } else if (kind === 'return_partial' || kind === 'exchange_partial') {
      // Partial kinds: leave the current selections so the user can
      // edit them; only seed sensible defaults the first time.
      setReturnRows((rows) =>
        rows.map((r) => ({
          ...r,
          selected: r.selected,
          qty: Math.min(r.qty, r.line.quantity),
        }))
      );
    }
    if (kind === 'return_full' || kind === 'return_partial') {
      // Pure returns clear any leftover replacement lines.
      setReplacementLines([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const isExchange = kind === 'exchange_full' || kind === 'exchange_partial';
  const isFullKind = kind === 'return_full' || kind === 'exchange_full';

  // Build the AdjustmentLine[] payload for `return_lines` from the
  // ticked rows + their per-row qty.
  const returnLinesPayload: AdjustmentLine[] = useMemo(() => {
    return returnRows
      .filter((r) => r.selected && r.qty > 0)
      .map((r) => ({
        productType: r.line.productType,
        label: r.line.label,
        color: r.line.color ?? null,
        quantity: r.qty,
        unitPrice: r.line.unitPrice,
        includeFlashlight: r.line.includeFlashlight,
        flashlightPrice: r.line.flashlightPrice,
        note: r.line.note ?? null,
      }));
  }, [returnRows]);

  // Live totals preview (Phase 25A math: returned / replacement value
  // + suggested refund). Phase 25B adds `sumChargeableReplacementLines`
  // so free replacement items don't inflate the price difference.
  const totals = useMemo(
    () =>
      computeAdjustmentTotals({
        return_lines: returnLinesPayload,
        replacement_lines: replacementLines,
        refund_mode: refundMode,
      }),
    [returnLinesPayload, replacementLines, refundMode]
  );
  const chargeableReplacementValue = useMemo(
    () => sumChargeableReplacementLines(replacementLines),
    [replacementLines]
  );
  // Recompute the price difference using *only* chargeable replacement
  // lines so a courtesy replacement doesn't show as company-refundable.
  const chargeablePriceDifference = useMemo(
    () => chargeableReplacementValue - totals.returnedValue,
    [chargeableReplacementValue, totals.returnedValue]
  );

  // Phase 25B — operational settlement preview. Drives both the
  // sub-section and the final submit payload.
  const settlement = useMemo(
    () =>
      computeOperationalSettlement({
        shippingBaseAmount,
        shippingCustomerShare:
          shippingPayer === 'company'
            ? 0
            : shippingPayer === 'customer'
              ? shippingBaseAmount
              : Math.min(shippingCustomerShare, shippingBaseAmount),
        priceDifferenceAbs: Math.abs(chargeablePriceDifference),
        priceDifferenceDirection: priceDirection,
      }),
    [
      shippingBaseAmount,
      shippingCustomerShare,
      shippingPayer,
      chargeablePriceDifference,
      priceDirection,
    ]
  );

  // Auto-pick a sensible default direction when the user changes the
  // returned / replacement mix, but don't trample an explicit choice.
  // The user can override any time.
  const [priceDirectionTouched, setPriceDirectionTouched] = useState(false);
  useEffect(() => {
    if (priceDirectionTouched) return;
    if (!isExchange || chargeablePriceDifference === 0) {
      setPriceDirection('none');
    } else if (chargeablePriceDifference > 0) {
      setPriceDirection('customer_pays');
    } else {
      setPriceDirection('company_refunds');
    }
  }, [chargeablePriceDifference, isExchange, priceDirectionTouched]);

  // When the refund mode produces a suggested value, auto-fill the
  // amount field (the user can still override for `partial`).
  useEffect(() => {
    if (refundMode === 'full' || refundMode === 'price_diff') {
      setRefundAmount(totals.suggestedRefund);
    } else if (refundMode === 'none') {
      setRefundAmount(0);
    }
    // partial: keep whatever the user typed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refundMode, totals.suggestedRefund]);

  // Clamp customer share when base or payer changes
  useEffect(() => {
    setShippingCustomerShare((cur) => Math.min(Math.max(0, cur), shippingBaseAmount));
  }, [shippingBaseAmount]);
  useEffect(() => {
    if (shippingPayer === 'company') setShippingCustomerShare(0);
    if (shippingPayer === 'customer') setShippingCustomerShare(shippingBaseAmount);
  }, [shippingPayer, shippingBaseAmount]);

  // ── Submit
  const handleSubmit = async () => {
    setError(null);

    // Phase 25B — store the signed price difference (positive when
    // customer pays, negative when company refunds, 0 otherwise). The
    // *operational* direction lives in `price_difference_direction`.
    const signedPriceDiff =
      priceDirection === 'customer_pays'
        ? Math.abs(chargeablePriceDifference)
        : priceDirection === 'company_refunds'
          ? -Math.abs(chargeablePriceDifference)
          : 0;

    const draft: AdjustmentDraft = {
      order_id: order.id,
      order_num: order.orderNum,
      kind,
      reason: reason.trim(),
      notes: notes.trim() || null,
      return_lines: returnLinesPayload,
      replacement_lines: isExchange ? replacementLines : [],
      original_total: order.total ?? 0,
      refund_mode: refundMode,
      refund_amount: Number.isFinite(refundAmount) ? Math.max(0, refundAmount) : 0,
      price_difference: signedPriceDiff,
      shipping_payer: shippingPayer,
      shipping_customer_amount: settlement.shippingCustomerShare,
      shipping_company_amount: settlement.shippingCompanyShare,
      shipping_base_amount: settlement.shippingBaseAmount,
      customer_collect_amount: settlement.customerCollectAmount,
      price_difference_direction: priceDirection,
      operational_note: operationalNote.trim() || null,
    };

    const validationError = validateAdjustmentDraft(draft);
    if (validationError) {
      setError(validationError);
      toast.error(validationError);
      return;
    }

    // Phase 25B — extra validation: customer share must be ≤ base.
    if (shippingPayer === 'split' && shippingCustomerShare > shippingBaseAmount) {
      const msg = 'حصة العميل من الشحن لا يمكن أن تتجاوز تكلفة الشحن الأساسية.';
      setError(msg);
      toast.error(msg);
      return;
    }

    setSaving(true);
    try {
      const supabase = createClient();
      const createdByName = (profileFullName ?? '').trim() || user?.email || 'مستخدم غير معروف';

      const insertPayload = {
        order_id: draft.order_id,
        order_num: draft.order_num,
        kind: draft.kind,
        reason: draft.reason,
        notes: draft.notes,
        return_lines: draft.return_lines,
        replacement_lines: draft.replacement_lines,
        original_total: draft.original_total,
        refund_mode: draft.refund_mode,
        refund_amount: draft.refund_amount,
        price_difference: draft.price_difference,
        shipping_payer: draft.shipping_payer,
        shipping_customer_amount: draft.shipping_customer_amount,
        shipping_company_amount: draft.shipping_company_amount,
        // Phase 25B — operational columns
        shipping_base_amount: draft.shipping_base_amount ?? 0,
        customer_collect_amount: draft.customer_collect_amount ?? 0,
        price_difference_direction: draft.price_difference_direction ?? 'none',
        operational_note: draft.operational_note,
        created_by: createdByName,
        created_by_role: currentRoleId ?? null,
      };

      const { data: inserted, error: insertErr } = await supabase
        .from('turath_masr_order_adjustments')
        .insert(insertPayload)
        .select('id')
        .single();

      if (insertErr) {
        const msg = insertErr.message || 'تعذر حفظ التسوية.';
        setError(msg);
        toast.error(msg);
        setSaving(false);
        return;
      }

      // Mirror to audit log so the order's existing timeline shows
      // the event. Failure here is non-fatal — the adjustment row
      // is the source of truth.
      try {
        await supabase.from('turath_masr_audit_logs').insert({
          order_id: order.id,
          order_num: order.orderNum,
          action: 'adjustment_created',
          field_changed: 'adjustment',
          old_value: null,
          new_value: `${ADJUSTMENT_KIND_LABEL_AR[draft.kind]} — ${draft.reason}`,
          changed_by: createdByName,
          changed_by_role: currentRoleId ?? null,
          note: JSON.stringify({
            adjustment_id: inserted?.id ?? null,
            kind: draft.kind,
            refund_mode: draft.refund_mode,
            refund_amount: draft.refund_amount,
            price_difference: draft.price_difference,
            price_difference_direction: draft.price_difference_direction,
            shipping_payer: draft.shipping_payer,
            shipping_customer_amount: draft.shipping_customer_amount,
            shipping_company_amount: draft.shipping_company_amount,
            shipping_base_amount: draft.shipping_base_amount,
            customer_collect_amount: draft.customer_collect_amount,
            reason: draft.reason,
          }),
        });
      } catch (auditErr) {
        console.warn('[OrderAdjustmentModal] audit log mirror failed:', auditErr);
      }

      // Phase 26D-1 — staff audit log for the adjustment creation.
      // Mirrors the per-order timeline entry above but lives in
      // `turath_masr_staff_audit_logs` so it shows up in /roles →
      // الأمان والتدقيق alongside other staff actions.
      try {
        await writeStaffAuditLog(supabase, {
          action: 'adjustment.created',
          actorId: user?.id ?? null,
          actorName: createdByName,
          actorRoleId: currentRoleId ?? null,
          entity: {
            type: 'adjustment',
            id: inserted?.id ?? undefined,
            label: `${ADJUSTMENT_KIND_LABEL_AR[draft.kind]} — #${order.orderNum}`,
          },
          description: `تم إنشاء ${ADJUSTMENT_KIND_LABEL_AR[draft.kind]} للطلب #${order.orderNum} — السبب: ${draft.reason}`,
          metadata: {
            adjustment_id: inserted?.id ?? null,
            order_id: order.id,
            order_num: order.orderNum,
            kind: draft.kind,
            refund_mode: draft.refund_mode,
            refund_amount: draft.refund_amount,
            price_difference: draft.price_difference,
            customer_collect_amount: draft.customer_collect_amount ?? 0,
            shipping_payer: draft.shipping_payer,
          },
        });
      } catch (staffAuditErr) {
        console.warn('[OrderAdjustmentModal] staff audit failed:', staffAuditErr);
      }

      toast.success('تم إنشاء طلب التسوية، بانتظار الموافقة.');
      // Broadcast so other open OrderDetail modals refresh.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('turath_masr_order_adjustments_updated'));
        window.dispatchEvent(new Event('turath_masr_audit_updated'));
      }
      onCreated?.();
      onClose();
    } catch (err) {
      console.error('[OrderAdjustmentModal] submit failed:', err);
      const msg = err instanceof Error ? err.message : 'حدث خطأ غير متوقع.';
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  // ─── Replacement line editor helpers ───
  const addReplacementLine = (presetIsFree = false) => {
    setReplacementLines((arr) => [
      ...arr,
      {
        itemType: 'product',
        isFree: presetIsFree,
        productType: '',
        label: '',
        color: '',
        quantity: 1,
        unitPrice: 0,
        includeFlashlight: false,
        flashlightPrice: 0,
        note: '',
      },
    ]);
  };

  const updateReplacementLine = (idx: number, patch: Partial<AdjustmentLine>) => {
    setReplacementLines((arr) => arr.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const removeReplacementLine = (idx: number) => {
    setReplacementLines((arr) => arr.filter((_, i) => i !== idx));
  };

  // ─── Render ───
  return (
    <div className="fixed inset-0 z-[200] bg-black/40 flex items-center justify-center p-3">
      <div
        className="bg-white w-full max-w-3xl max-h-[92vh] flex flex-col rounded-2xl shadow-2xl"
        dir="rtl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-2">
            <RotateCcw size={18} className="text-amber-600" />
            <div>
              <h3 className="text-base font-bold">إنشاء مرتجع / استبدال</h3>
              <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                الطلب #{order.orderNum} — {order.customer}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
            aria-label="إغلاق"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 scrollbar-thin">
          {/* 1 — Kind */}
          <section className="card-section p-4">
            <h4 className="text-sm font-bold mb-2 flex items-center gap-1.5">
              <Package size={14} /> نوع التسوية
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {KIND_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setKind(opt.value)}
                  className={`flex items-center gap-2 text-sm rounded-xl border px-3 py-2 transition-colors ${
                    kind === opt.value
                      ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5 text-[hsl(var(--primary))] font-semibold'
                      : 'border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]/40'
                  }`}
                >
                  {opt.icon}
                  {opt.label}
                </button>
              ))}
            </div>
          </section>

          {/* 2 — Returned lines */}
          <section className="card-section p-4">
            <h4 className="text-sm font-bold mb-2">العناصر المعادة من الطلب الأصلي</h4>
            <div className="space-y-2">
              {returnRows.map((row, idx) => {
                const lineTotal =
                  row.line.unitPrice * row.qty +
                  (row.line.includeFlashlight ? (row.line.flashlightPrice ?? 0) * row.qty : 0);
                return (
                  <div
                    key={`return-row-${idx}`}
                    className={`flex items-start gap-2 rounded-xl border p-3 ${
                      row.selected
                        ? 'border-[hsl(var(--border))] bg-white'
                        : 'border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 opacity-70'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={row.selected}
                      disabled={isFullKind}
                      onChange={(e) =>
                        setReturnRows((rows) =>
                          rows.map((r, i) => (i === idx ? { ...r, selected: e.target.checked } : r))
                        )
                      }
                      className="mt-1"
                      aria-label="تحديد"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">
                        {row.line.label}
                        {row.line.color ? ` — ${row.line.color}` : ''}
                        {row.line.includeFlashlight ? ' + كشاف' : ''}
                      </p>
                      <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-0.5">
                        الأصلي: {row.line.quantity} × {fmtEgp(row.line.unitPrice)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={isFullKind || !row.selected || row.qty <= 1}
                        className="w-6 h-6 rounded-md border border-[hsl(var(--border))] text-xs disabled:opacity-40"
                        onClick={() =>
                          setReturnRows((rows) =>
                            rows.map((r, i) =>
                              i === idx ? { ...r, qty: Math.max(1, r.qty - 1) } : r
                            )
                          )
                        }
                        aria-label="إنقاص"
                      >
                        <Minus size={12} className="mx-auto" />
                      </button>
                      <span className="w-8 text-center text-sm font-mono">{row.qty}</span>
                      <button
                        type="button"
                        disabled={isFullKind || !row.selected || row.qty >= row.line.quantity}
                        className="w-6 h-6 rounded-md border border-[hsl(var(--border))] text-xs disabled:opacity-40"
                        onClick={() =>
                          setReturnRows((rows) =>
                            rows.map((r, i) =>
                              i === idx ? { ...r, qty: Math.min(r.line.quantity, r.qty + 1) } : r
                            )
                          )
                        }
                        aria-label="زيادة"
                      >
                        <Plus size={12} className="mx-auto" />
                      </button>
                    </div>
                    <div className="text-left text-sm font-mono font-bold w-[110px] flex-shrink-0">
                      {fmtEgp(lineTotal)}
                    </div>
                  </div>
                );
              })}
              {returnRows.length === 0 && (
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  لا توجد عناصر مفصلة لهذا الطلب — يجب إدخال البديل يدويًا.
                </p>
              )}
            </div>
            <div className="mt-3 flex justify-between text-xs text-[hsl(var(--muted-foreground))]">
              <span>قيمة العناصر المعادة</span>
              <span className="font-bold text-[hsl(var(--foreground))] font-mono">
                {fmtEgp(totals.returnedValue)}
              </span>
            </div>
          </section>

          {/* 3 — Replacement lines (exchanges only) */}
          {isExchange && (
            <section className="card-section p-4">
              <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
                <h4 className="text-sm font-bold">العناصر البديلة</h4>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => addReplacementLine(false)}
                    className="text-xs flex items-center gap-1 text-[hsl(var(--primary))] hover:underline"
                  >
                    <Plus size={12} /> إضافة بديل
                  </button>
                  <button
                    type="button"
                    onClick={() => addReplacementLine(true)}
                    className="text-xs flex items-center gap-1 text-emerald-700 hover:underline"
                  >
                    <Plus size={12} /> إضافة بديل مجاني
                  </button>
                </div>
              </div>
              {replacementLines.length === 0 ? (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  الاستبدال يتطلب عنصر بديل واحد على الأقل.
                </p>
              ) : (
                <div className="space-y-3">
                  {replacementLines.map((line, idx) => {
                    const subtotal =
                      Math.max(0, Number(line.quantity) || 0) *
                        Math.max(0, Number(line.unitPrice) || 0) +
                      (line.includeFlashlight
                        ? Math.max(0, Number(line.quantity) || 0) *
                          Math.max(0, Number(line.flashlightPrice) || 0)
                        : 0);
                    const chargeableSubtotal = line.isFree ? 0 : subtotal;
                    return (
                      <div
                        key={`replace-${idx}`}
                        className={`rounded-xl border p-3 space-y-2 ${
                          line.isFree
                            ? 'border-emerald-200 bg-emerald-50/40'
                            : 'border-[hsl(var(--border))]'
                        }`}
                      >
                        {/* Phase 25B — item type + free checkbox row */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="flex bg-[hsl(var(--muted))]/50 rounded-lg p-0.5 text-[11px]">
                            <button
                              type="button"
                              onClick={() => updateReplacementLine(idx, { itemType: 'product' })}
                              className={`px-2 py-0.5 rounded-md transition-colors ${
                                (line.itemType ?? 'product') === 'product'
                                  ? 'bg-white shadow-sm font-bold text-[hsl(var(--foreground))]'
                                  : 'text-[hsl(var(--muted-foreground))]'
                              }`}
                            >
                              منتج
                            </button>
                            <button
                              type="button"
                              onClick={() => updateReplacementLine(idx, { itemType: 'part' })}
                              className={`px-2 py-0.5 rounded-md transition-colors ${
                                line.itemType === 'part'
                                  ? 'bg-white shadow-sm font-bold text-[hsl(var(--foreground))]'
                                  : 'text-[hsl(var(--muted-foreground))]'
                              }`}
                            >
                              قطعة
                            </button>
                          </div>
                          <label className="flex items-center gap-1 text-[11px] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={Boolean(line.isFree)}
                              onChange={(e) =>
                                updateReplacementLine(idx, { isFree: e.target.checked })
                              }
                            />
                            <span
                              className={
                                line.isFree
                                  ? 'text-emerald-700 font-bold'
                                  : 'text-[hsl(var(--muted-foreground))]'
                              }
                            >
                              مجاني
                            </span>
                          </label>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <input
                            type="text"
                            value={line.productType}
                            onChange={(e) =>
                              updateReplacementLine(idx, { productType: e.target.value })
                            }
                            placeholder={
                              line.itemType === 'part' ? 'نوع القطعة' : 'نوع المنتج (productType)'
                            }
                            className="form-input text-sm"
                          />
                          <input
                            type="text"
                            value={line.label ?? ''}
                            onChange={(e) => updateReplacementLine(idx, { label: e.target.value })}
                            placeholder="اسم المنتج (للعرض)"
                            className="form-input text-sm"
                          />
                          <input
                            type="text"
                            value={line.color ?? ''}
                            onChange={(e) => updateReplacementLine(idx, { color: e.target.value })}
                            placeholder="اللون (اختياري)"
                            className="form-input text-sm"
                          />
                          <input
                            type="text"
                            value={line.note ?? ''}
                            onChange={(e) => updateReplacementLine(idx, { note: e.target.value })}
                            placeholder="ملاحظة (اختياري)"
                            className="form-input text-sm"
                          />
                          <label className="flex flex-col">
                            <span className="text-[11px] text-[hsl(var(--muted-foreground))] mb-1">
                              الكمية
                            </span>
                            <input
                              type="number"
                              min={1}
                              value={line.quantity}
                              onChange={(e) =>
                                updateReplacementLine(idx, {
                                  quantity: Math.max(1, Number(e.target.value) || 1),
                                })
                              }
                              className="form-input text-sm"
                            />
                          </label>
                          <label className="flex flex-col">
                            <span className="text-[11px] text-[hsl(var(--muted-foreground))] mb-1">
                              سعر الوحدة (ج.م)
                            </span>
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={line.unitPrice}
                              onChange={(e) =>
                                updateReplacementLine(idx, {
                                  unitPrice: Math.max(0, Number(e.target.value) || 0),
                                })
                              }
                              className="form-input text-sm"
                            />
                          </label>
                          <label className="flex items-center gap-2 col-span-2 text-xs">
                            <input
                              type="checkbox"
                              checked={Boolean(line.includeFlashlight)}
                              onChange={(e) =>
                                updateReplacementLine(idx, {
                                  includeFlashlight: e.target.checked,
                                })
                              }
                            />
                            تضمين كشاف
                            {line.includeFlashlight && (
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                value={line.flashlightPrice ?? 0}
                                onChange={(e) =>
                                  updateReplacementLine(idx, {
                                    flashlightPrice: Math.max(0, Number(e.target.value) || 0),
                                  })
                                }
                                placeholder="سعر الكشاف"
                                className="form-input text-xs w-28"
                              />
                            )}
                          </label>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <button
                            type="button"
                            onClick={() => removeReplacementLine(idx)}
                            className="text-rose-600 hover:underline flex items-center gap-1"
                          >
                            <Trash2 size={12} /> حذف هذا البديل
                          </button>
                          {line.isFree ? (
                            <span className="flex items-center gap-1">
                              <span className="font-mono text-emerald-700 font-bold">
                                {fmtEgp(0)}
                              </span>
                              <span className="text-[10px] text-[hsl(var(--muted-foreground))] line-through">
                                {fmtEgp(subtotal)}
                              </span>
                            </span>
                          ) : (
                            <span className="font-mono text-[hsl(var(--foreground))] font-bold">
                              {fmtEgp(chargeableSubtotal)}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <div className="flex justify-between text-xs text-[hsl(var(--muted-foreground))]">
                    <span>قيمة البدائل (المدفوعة)</span>
                    <span className="font-bold text-[hsl(var(--foreground))] font-mono">
                      {fmtEgp(chargeableReplacementValue)}
                    </span>
                  </div>
                  {chargeablePriceDifference !== 0 && (
                    <div
                      className={`flex justify-between text-xs font-semibold mt-1 ${
                        chargeablePriceDifference > 0 ? 'text-amber-700' : 'text-emerald-700'
                      }`}
                    >
                      <span>فرق السعر الناتج عن البدائل (المدفوعة فقط):</span>
                      <span className="font-mono">
                        {fmtEgp(Math.abs(chargeablePriceDifference))}
                      </span>
                    </div>
                  )}
                  <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-1 italic">
                    اختر اتجاه فرق السعر في قسم &laquo;اتجاه فرق السعر&raquo; أدناه.
                  </p>
                </div>
              )}
            </section>
          )}

          {/* 4 — Refund */}
          <section className="card-section p-4">
            <h4 className="text-sm font-bold mb-2 flex items-center gap-1.5">
              <Wallet size={14} /> طريقة الاسترداد
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {REFUND_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setRefundMode(opt.value)}
                  className={`text-sm rounded-xl border px-3 py-2 transition-colors ${
                    refundMode === opt.value
                      ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5 text-[hsl(var(--primary))] font-semibold'
                      : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/40'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="flex flex-col">
                <span className="text-[11px] text-[hsl(var(--muted-foreground))] mb-1">
                  مبلغ الاسترداد (ج.م)
                </span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={refundAmount}
                  disabled={refundMode === 'none'}
                  onChange={(e) => setRefundAmount(Math.max(0, Number(e.target.value) || 0))}
                  className="form-input text-sm"
                />
              </label>
              <div className="flex flex-col">
                <span className="text-[11px] text-[hsl(var(--muted-foreground))] mb-1">
                  المقترح بناءً على القيم أعلاه
                </span>
                <span className="form-input text-sm bg-[hsl(var(--muted))]/40 font-mono">
                  {fmtEgp(totals.suggestedRefund)}
                </span>
              </div>
            </div>
            {refundMode === 'partial' && (
              <p className="text-[11px] text-amber-700 mt-2">
                الاسترداد الجزئي يتطلب إدخال مبلغ يدويًا.
              </p>
            )}
          </section>

          {/* 5 — Shipping (Phase 25B) */}
          <section className="card-section p-4">
            <h4 className="text-sm font-bold mb-2 flex items-center gap-1.5">
              <Truck size={14} /> الشحن للطلب الفرعي
            </h4>

            {/* Base shipping — auto from order region, read-only by default */}
            <label className="flex flex-col">
              <span className="text-[11px] text-[hsl(var(--muted-foreground))] mb-1">
                تكلفة الشحن حسب المنطقة
                {order.region && (
                  <span className="mr-1 text-[10px]">
                    ({order.region}
                    {order.district ? ` — ${order.district}` : ''})
                  </span>
                )}
              </span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={shippingBaseAmount}
                onChange={(e) => setShippingBaseAmount(Math.max(0, Number(e.target.value) || 0))}
                className="form-input text-sm bg-[hsl(var(--muted))]/40 font-mono"
              />
              <span className="text-[10px] text-[hsl(var(--muted-foreground))] mt-1">
                مأخوذة تلقائيًا من سعر شحن الطلب الأصلي. يمكن تعديلها يدويًا للحالات الخاصة.
              </span>
            </label>

            <div className="mt-3 grid grid-cols-3 gap-2">
              {SHIPPING_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setShippingPayer(opt.value)}
                  className={`text-sm rounded-xl border px-3 py-2 transition-colors ${
                    shippingPayer === opt.value
                      ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5 text-[hsl(var(--primary))] font-semibold'
                      : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/40'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Split: only the customer-share input is editable. Company
                share is derived (base − customer share). */}
            {shippingPayer === 'split' && (
              <label className="mt-3 flex flex-col">
                <span className="text-[11px] text-[hsl(var(--muted-foreground))] mb-1">
                  ما يدفعه العميل من الشحن (ج.م)
                </span>
                <input
                  type="number"
                  min={0}
                  max={shippingBaseAmount}
                  step="0.01"
                  value={shippingCustomerShare}
                  onChange={(e) =>
                    setShippingCustomerShare(
                      Math.min(shippingBaseAmount, Math.max(0, Number(e.target.value) || 0))
                    )
                  }
                  className="form-input text-sm"
                />
                <span className="text-[10px] text-[hsl(var(--muted-foreground))] mt-1">
                  تتحمل الشركة الباقي تلقائيًا:{' '}
                  <span className="font-mono font-bold text-[hsl(var(--foreground))]">
                    {fmtEgp(settlement.shippingCompanyShare)}
                  </span>
                </span>
              </label>
            )}

            {/* Live preview */}
            <div className="mt-3 rounded-xl bg-[hsl(var(--muted))]/40 p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-[hsl(var(--muted-foreground))]">شحن العميل</span>
                <span className="font-mono font-bold">
                  {fmtEgp(settlement.shippingCustomerShare)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[hsl(var(--muted-foreground))]">شحن الشركة</span>
                <span className="font-mono font-bold">
                  {fmtEgp(settlement.shippingCompanyShare)}
                </span>
              </div>
            </div>
          </section>

          {/* 5b — Price-difference direction (exchanges only) */}
          {isExchange && (
            <section className="card-section p-4">
              <h4 className="text-sm font-bold mb-2">اتجاه فرق السعر</h4>
              <div className="grid grid-cols-3 gap-2">
                {(['customer_pays', 'company_refunds', 'none'] as const).map((dir) => (
                  <button
                    key={dir}
                    type="button"
                    onClick={() => {
                      setPriceDirection(dir);
                      setPriceDirectionTouched(true);
                    }}
                    className={`text-xs rounded-xl border px-3 py-2 transition-colors ${
                      priceDirection === dir
                        ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5 text-[hsl(var(--primary))] font-semibold'
                        : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/40'
                    }`}
                  >
                    {PRICE_DIFFERENCE_DIRECTION_LABEL_AR[dir]}
                  </button>
                ))}
              </div>
              <div
                className={`mt-3 text-xs ${
                  priceDirection === 'customer_pays'
                    ? 'text-amber-700'
                    : priceDirection === 'company_refunds'
                      ? 'text-emerald-700'
                      : 'text-[hsl(var(--muted-foreground))]'
                }`}
              >
                {priceDirection === 'customer_pays' && (
                  <>
                    فرق سعر مستحق على العميل:{' '}
                    <span className="font-mono font-bold">
                      {fmtEgp(settlement.priceDifferenceAbs)}
                    </span>
                  </>
                )}
                {priceDirection === 'company_refunds' && (
                  <>
                    فرق سعر لصالح العميل:{' '}
                    <span className="font-mono font-bold">
                      {fmtEgp(settlement.companyRefundAmount)}
                    </span>
                  </>
                )}
                {priceDirection === 'none' && <>لن يتم تسوية فرق السعر في هذا الطلب.</>}
              </div>
            </section>
          )}

          {/* 5c — Collection breakdown shown to the delegate */}
          <section className="card-section p-4 bg-emerald-50/30 border border-emerald-100">
            <h4 className="text-sm font-bold mb-2 text-emerald-800 flex items-center gap-1.5">
              <Wallet size={14} /> إجمالي التحصيل من العميل
            </h4>
            <div className="text-xs space-y-1">
              {settlement.shippingCustomerShare > 0 && (
                <div className="flex justify-between">
                  <span className="text-[hsl(var(--muted-foreground))]">شحن</span>
                  <span className="font-mono font-bold">
                    {fmtEgp(settlement.shippingCustomerShare)}
                  </span>
                </div>
              )}
              {priceDirection === 'customer_pays' && settlement.priceDifferenceAbs > 0 && (
                <div className="flex justify-between">
                  <span className="text-[hsl(var(--muted-foreground))]">فرق سعر</span>
                  <span className="font-mono font-bold">
                    {fmtEgp(settlement.priceDifferenceAbs)}
                  </span>
                </div>
              )}
              <div className="flex justify-between border-t border-emerald-200 pt-1 mt-1">
                <span className="font-bold text-emerald-800">الإجمالي</span>
                <span className="font-mono font-bold text-emerald-800">
                  {fmtEgp(settlement.customerCollectAmount)}
                </span>
              </div>
              {settlement.companyRefundAmount > 0 && (
                <p className="text-[11px] text-emerald-700 mt-2 italic">
                  ⚠ هناك مبلغ{' '}
                  <span className="font-mono font-bold">
                    {fmtEgp(settlement.companyRefundAmount)}
                  </span>{' '}
                  لصالح العميل، لا يقوم المندوب بتحصيله — تسوية مالية لاحقة.
                </p>
              )}
              {settlement.customerCollectAmount === 0 && settlement.companyRefundAmount === 0 && (
                <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1 italic">
                  لا يتم تحصيل أي مبلغ من العميل لهذا الطلب.
                </p>
              )}
            </div>
          </section>

          {/* 6 — Reason + notes */}
          <section className="card-section p-4">
            <label className="flex flex-col">
              <span className="text-sm font-bold mb-1">السبب *</span>
              <textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="مثال: العميل أبلغ بعيب في المنتج"
                className={`form-input text-sm ${
                  !reason.trim() ? 'border-rose-300 focus:border-rose-400' : ''
                }`}
              />
              {!reason.trim() && (
                <span className="text-[11px] text-rose-600 mt-1">السبب مطلوب لإنشاء التسوية.</span>
              )}
            </label>
            <label className="flex flex-col mt-3">
              <span className="text-sm font-bold mb-1">ملاحظات داخلية</span>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="ملاحظات اختيارية للفريق"
                className="form-input text-sm"
              />
            </label>
            <label className="flex flex-col mt-3">
              <span className="text-sm font-bold mb-1">تعليمات للمندوب (اختياري)</span>
              <textarea
                rows={2}
                value={operationalNote}
                onChange={(e) => setOperationalNote(e.target.value)}
                placeholder="مثال: اتصل بالعميل قبل الذهاب — الباب الخلفي"
                className="form-input text-sm"
              />
              <span className="text-[10px] text-[hsl(var(--muted-foreground))] mt-1">
                هذه التعليمات ستظهر في صفحة المندوب عند تنفيذ الطلب الفرعي.
              </span>
            </label>
          </section>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm text-rose-700">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[hsl(var(--border))]">
          <button onClick={onClose} disabled={saving} className="btn-secondary text-sm py-1.5 px-4">
            إلغاء
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !reason.trim()}
            className="btn-primary text-sm py-1.5 px-4 flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <CheckCircle size={14} />
            {saving ? 'جارٍ الإنشاء…' : 'إنشاء التسوية'}
          </button>
        </div>
      </div>
    </div>
  );
}
