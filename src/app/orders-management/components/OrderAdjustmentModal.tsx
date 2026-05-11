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
import {
  ADJUSTMENT_KIND_LABEL_AR,
  REFUND_MODE_LABEL_AR,
  SHIPPING_PAYER_LABEL_AR,
  computeAdjustmentTotals,
  validateAdjustmentDraft,
  type AdjustmentDraft,
  type AdjustmentKind,
  type AdjustmentLine,
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

  // ── 5) Shipping
  const [shippingPayer, setShippingPayer] = useState<ShippingPayer>('company');
  const [shippingCustomerAmount, setShippingCustomerAmount] = useState<number>(0);
  const [shippingCompanyAmount, setShippingCompanyAmount] = useState<number>(0);

  // ── 6) Reason + notes
  const [reason, setReason] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

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

  // Live totals preview
  const totals = useMemo(
    () =>
      computeAdjustmentTotals({
        return_lines: returnLinesPayload,
        replacement_lines: replacementLines,
        refund_mode: refundMode,
      }),
    [returnLinesPayload, replacementLines, refundMode]
  );

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

  // ── Submit
  const handleSubmit = async () => {
    setError(null);

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
      price_difference: totals.priceDifference,
      shipping_payer: shippingPayer,
      shipping_customer_amount:
        shippingPayer === 'split' || shippingPayer === 'customer'
          ? Math.max(0, shippingCustomerAmount)
          : 0,
      shipping_company_amount:
        shippingPayer === 'split' || shippingPayer === 'company'
          ? Math.max(0, shippingCompanyAmount)
          : 0,
    };

    const validationError = validateAdjustmentDraft(draft);
    if (validationError) {
      setError(validationError);
      toast.error(validationError);
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
            shipping_payer: draft.shipping_payer,
            reason: draft.reason,
          }),
        });
      } catch (auditErr) {
        console.warn('[OrderAdjustmentModal] audit log mirror failed:', auditErr);
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
  const addReplacementLine = () => {
    setReplacementLines((arr) => [
      ...arr,
      {
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
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-bold">العناصر البديلة</h4>
                <button
                  type="button"
                  onClick={addReplacementLine}
                  className="text-xs flex items-center gap-1 text-[hsl(var(--primary))] hover:underline"
                >
                  <Plus size={12} /> إضافة بديل
                </button>
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
                    return (
                      <div
                        key={`replace-${idx}`}
                        className="rounded-xl border border-[hsl(var(--border))] p-3 space-y-2"
                      >
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            type="text"
                            value={line.productType}
                            onChange={(e) =>
                              updateReplacementLine(idx, { productType: e.target.value })
                            }
                            placeholder="نوع المنتج (productType)"
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
                          <span className="font-mono text-[hsl(var(--foreground))] font-bold">
                            {fmtEgp(subtotal)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  <div className="flex justify-between text-xs text-[hsl(var(--muted-foreground))]">
                    <span>قيمة البدائل</span>
                    <span className="font-bold text-[hsl(var(--foreground))] font-mono">
                      {fmtEgp(totals.replacementValue)}
                    </span>
                  </div>
                  <div
                    className={`flex justify-between text-xs font-semibold mt-1 ${
                      totals.priceDifference > 0
                        ? 'text-amber-700'
                        : totals.priceDifference < 0
                          ? 'text-emerald-700'
                          : 'text-[hsl(var(--muted-foreground))]'
                    }`}
                  >
                    <span>
                      {totals.priceDifference > 0
                        ? 'العميل يدفع فرق السعر'
                        : totals.priceDifference < 0
                          ? 'الشركة ترد فرق السعر للعميل'
                          : 'لا يوجد فرق سعر'}
                    </span>
                    <span className="font-mono">{fmtEgp(Math.abs(totals.priceDifference))}</span>
                  </div>
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

          {/* 5 — Shipping */}
          <section className="card-section p-4">
            <h4 className="text-sm font-bold mb-2 flex items-center gap-1.5">
              <Truck size={14} /> من يتحمل تكلفة الشحن؟
            </h4>
            <div className="grid grid-cols-3 gap-2">
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
            {shippingPayer !== 'company' && (
              <label className="mt-3 flex flex-col">
                <span className="text-[11px] text-[hsl(var(--muted-foreground))] mb-1">
                  ما يدفعه العميل (ج.م)
                </span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={shippingCustomerAmount}
                  onChange={(e) =>
                    setShippingCustomerAmount(Math.max(0, Number(e.target.value) || 0))
                  }
                  className="form-input text-sm"
                />
              </label>
            )}
            {shippingPayer !== 'customer' && (
              <label className="mt-2 flex flex-col">
                <span className="text-[11px] text-[hsl(var(--muted-foreground))] mb-1">
                  ما تتحمله الشركة (ج.م)
                </span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={shippingCompanyAmount}
                  onChange={(e) =>
                    setShippingCompanyAmount(Math.max(0, Number(e.target.value) || 0))
                  }
                  className="form-input text-sm"
                />
              </label>
            )}
            {shippingPayer === 'split' && (
              <p className="text-[11px] text-amber-700 mt-2">
                التقسيم يتطلب أن يدفع كل طرف مبلغ أكبر من صفر.
              </p>
            )}
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
