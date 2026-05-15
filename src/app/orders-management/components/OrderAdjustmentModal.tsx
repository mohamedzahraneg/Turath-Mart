// ─────────────────────────────────────────────────────────────────────────────
// src/app/orders-management/components/OrderAdjustmentModal.tsx
//
// Phase Returns-Exchange-1 — full rebuild of the return / exchange
// creation surface. Replaces the flat single-form modal (Phase 25A/B)
// with a 3-step wizard:
//
//   Step 1 — نوع التسوية: pick مرتجع/استبدال + كامل/جزئي + سبب (مطلوب)
//   Step 2 — العناصر: select returned items (locked for *_full),
//            add replacement items + maintenance/spare parts (for
//            exchanges only).
//   Step 3 — ملخص التسوية: shipping fee + shipping payer (customer/
//            company), settlement summary card (original value,
//            replacement value, difference, shipping, amount due /
//            refund), preview of the linked shipping order number,
//            and an invoice preview button.
//
// What changed vs Phase 25A/B
// ---------------------------
//   • Wizard structure replaces the long single form. Each step has
//     its own validator + Arabic error strings.
//   • Reason is always shown in step 1 and label-flips per kind
//     ("سبب المرتجع" vs "سبب الاستبدال").
//   • Maintenance / spare-part items get an explicit affordance
//     ("إضافة قطعة صيانة") with name + qty + free toggle + price +
//     note. Same DB shape (`AdjustmentLine.itemType = 'part'` +
//     `isFree`); the rebuild is UX-only.
//   • Shipping payer is binary (customer / company). The legacy
//     'split' value is preserved in the DB schema but no longer
//     surfaced. Existing rows that used 'split' still render fine.
//   • A linked shipping child order is now created at adjustment
//     INSERT time (state `new`) so it appears immediately in
//     /orders-management for scheduling. Previously the child was
//     created on approval; that path now skips creation when the
//     child already exists.
//   • The settlement summary card surfaces every spec row plus a
//     preview of the derived child-order number ({parent}-R1 / -E1).
//   • An invoice preview button opens an HTML doc via
//     `openAdjustmentInvoiceWindow` — browser print only, no PDF
//     library.
//   • Per-order audit + staff audit emissions are enriched with the
//     settlement reason, settlement type, items summaries, financial
//     summary, and the linked shipping order number. No payloads
//     contain images, tokens, or base64 data.
//
// What this surface still doesn't do
// ----------------------------------
//   • Touch inventory (Phase 25A boundary holds).
//   • Auto-approve. The adjustment is created at `pending`; the
//     manager still uses OrderDetailModal's action bar to approve /
//     reject / complete / cancel.
//   • Send tracking-side notifications. The settlement is admin-
//     internal until approval.
// ─────────────────────────────────────────────────────────────────────────────
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  Eye,
  Minus,
  Package,
  Plus,
  Repeat,
  RotateCcw,
  Trash2,
  Truck,
  Wallet,
  Wrench,
  X,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { writeStaffAuditLog } from '@/lib/security/staffAudit';
import {
  ADJUSTMENT_KIND_LABEL_AR,
  buildChildOrderNum,
  computeAdjustmentTotals,
  computeOperationalSettlement,
  sumChargeableReplacementLines,
  validateAdjustmentDraft,
  type AdjustmentDraft,
  type AdjustmentKind,
  type AdjustmentLine,
  type PriceDifferenceDirection,
  type RefundMode,
} from '@/lib/orders/orderAdjustments';
import {
  buildChildOrderRow,
  childOrderTaskLabel,
  countAdjustmentSiblings,
} from '@/lib/orders/adjustmentChildOrder';
import {
  openAdjustmentInvoiceWindow,
  type AdjustmentInvoicePayload,
} from '@/lib/orders/adjustmentInvoice';

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
  /** Optional secondary phone — passed through to the linked child order. */
  phone2?: string | null;
  total: number;
  lines: OrderLine[];
  /** Region fee from the original order, seeds the new shipment leg. */
  shippingFee?: number;
  region?: string;
  district?: string | null;
  neighborhood?: string | null;
  /** Full address line — needed so the child order can ship to the same place. */
  address?: string;
  warranty?: string | null;
}

interface Props {
  order: OrderSummary;
  onClose: () => void;
  onCreated?: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const fmtEgp = (n: number): string => `${(Number.isFinite(n) ? n : 0).toLocaleString('en-US')} ج.م`;

type SettlementType = 'return' | 'exchange';
type Subtype = 'full' | 'partial';
type ShippingPayer = 'customer' | 'company';

interface ReturnRow {
  line: OrderLine;
  selected: boolean;
  qty: number;
}

function deriveKind(t: SettlementType | null, s: Subtype | null): AdjustmentKind | null {
  if (!t || !s) return null;
  return `${t}_${s}` as AdjustmentKind;
}

function reasonLabelFor(type: SettlementType | null): string {
  if (type === 'return') return 'سبب المرتجع *';
  if (type === 'exchange') return 'سبب الاستبدال *';
  return 'سبب التسوية *';
}

function reasonPlaceholderFor(type: SettlementType | null): string {
  if (type === 'return') return 'مثال: العميل أبلغ بعيب في المنتج';
  if (type === 'exchange') return 'مثال: العميل طلب لون مختلف';
  return 'اكتب سبب المرتجع أو الاستبدال...';
}

function addressLabel(order: OrderSummary): string {
  return [order.region, order.district, order.neighborhood, order.address]
    .filter(Boolean)
    .join('، ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function OrderAdjustmentModal({ order, onClose, onCreated }: Props) {
  const { user, profileFullName, currentRoleId } = useAuth();

  // ── Wizard step
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // ── Step 1 state
  const [settlementType, setSettlementType] = useState<SettlementType | null>(null);
  const [subtype, setSubtype] = useState<Subtype | null>(null);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');

  // ── Step 2 state — items
  const [returnRows, setReturnRows] = useState<ReturnRow[]>(() =>
    order.lines.map((line) => ({ line, selected: true, qty: line.quantity }))
  );
  const [replacementLines, setReplacementLines] = useState<AdjustmentLine[]>([]);

  // ── Step 3 state — settlement
  const [shippingBaseAmount, setShippingBaseAmount] = useState<number>(
    Math.max(0, Number(order.shippingFee) || 0)
  );
  const [shippingPayer, setShippingPayer] = useState<ShippingPayer>('company');
  const [operationalNote, setOperationalNote] = useState('');
  /** Cached sibling count for the child-order suffix preview. Loaded
   *  when the user enters step 3 — refetched at submit time so a
   *  parallel creation by another operator can't collide on R1/E1. */
  const [previewSiblingCount, setPreviewSiblingCount] = useState<number | null>(null);

  // ── Submission state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kind = deriveKind(settlementType, subtype);
  const isExchange = settlementType === 'exchange';
  const isFullKind = subtype === 'full';

  // ── Recompute return rows when subtype switches (full locks all,
  // partial preserves selections).
  useEffect(() => {
    if (subtype === 'full') {
      setReturnRows((rows) => rows.map((r) => ({ ...r, selected: true, qty: r.line.quantity })));
    } else if (subtype === 'partial') {
      setReturnRows((rows) =>
        rows.map((r) => ({
          ...r,
          qty: Math.min(r.qty, r.line.quantity),
        }))
      );
    }
  }, [subtype]);

  // ── Clear replacement lines when switching to pure-return.
  useEffect(() => {
    if (settlementType === 'return') setReplacementLines([]);
  }, [settlementType]);

  // ── Build the return-lines payload from the rows.
  const returnLinesPayload: AdjustmentLine[] = useMemo(
    () =>
      returnRows
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
        })),
    [returnRows]
  );

  const totals = useMemo(
    () =>
      computeAdjustmentTotals({
        return_lines: returnLinesPayload,
        replacement_lines: replacementLines,
        // Refund mode is derived below; this call just gives us the
        // returned/replacement totals — `suggestedRefund` is ignored.
        refund_mode: 'none',
      }),
    [returnLinesPayload, replacementLines]
  );

  // Chargeable replacement value (free items excluded) — drives the
  // price-difference math so a courtesy maintenance item doesn't
  // inflate the customer's balance.
  const chargeableReplacementValue = useMemo(
    () => sumChargeableReplacementLines(replacementLines),
    [replacementLines]
  );
  const chargeablePriceDifference = useMemo(
    () => chargeableReplacementValue - totals.returnedValue,
    [chargeableReplacementValue, totals.returnedValue]
  );

  // ── Derived price direction (auto, no UI control).
  const priceDirection: PriceDifferenceDirection = useMemo(() => {
    if (!isExchange) return 'none';
    if (chargeablePriceDifference > 0) return 'customer_pays';
    if (chargeablePriceDifference < 0) return 'company_refunds';
    return 'none';
  }, [isExchange, chargeablePriceDifference]);

  // ── Operational settlement preview.
  const settlement = useMemo(
    () =>
      computeOperationalSettlement({
        shippingBaseAmount,
        shippingCustomerShare: shippingPayer === 'customer' ? shippingBaseAmount : 0,
        priceDifferenceAbs: Math.abs(chargeablePriceDifference),
        priceDifferenceDirection: priceDirection,
      }),
    [shippingBaseAmount, shippingPayer, chargeablePriceDifference, priceDirection]
  );

  // ── Refund mode derivation. The DB still requires a value
  // ('full' | 'partial' | 'none' | 'price_diff'); the new wizard
  // never asks the operator directly. Rules:
  //   • Pure return → 'full' (the customer gets back what they sent)
  //   • Exchange with company refund → 'price_diff'
  //   • Anything else → 'none'
  const derivedRefundMode: RefundMode = useMemo(() => {
    if (!isExchange) return 'full';
    if (priceDirection === 'company_refunds') return 'price_diff';
    return 'none';
  }, [isExchange, priceDirection]);

  const derivedRefundAmount = useMemo(() => {
    if (derivedRefundMode === 'full') return totals.returnedValue;
    if (derivedRefundMode === 'price_diff') return Math.abs(chargeablePriceDifference);
    return 0;
  }, [derivedRefundMode, totals.returnedValue, chargeablePriceDifference]);

  // ── Preview child order number. We use the cached sibling count
  // for display; the actual number is recomputed at submit with a
  // fresh count to avoid collisions if two operators create
  // adjustments in parallel.
  const previewChildOrderNum = useMemo(() => {
    if (!kind || previewSiblingCount === null) return null;
    return buildChildOrderNum(order.orderNum, kind, previewSiblingCount);
  }, [kind, previewSiblingCount, order.orderNum]);

  // ── Fetch the sibling count when entering step 3 so the preview
  // child-order number renders correctly.
  useEffect(() => {
    if (step !== 3 || !kind) {
      setPreviewSiblingCount(null);
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    if (!supabase) return;
    void (async () => {
      const count = await countAdjustmentSiblings(supabase, order.orderNum, kind);
      if (!cancelled) setPreviewSiblingCount(count);
    })();
    return () => {
      cancelled = true;
    };
  }, [step, kind, order.orderNum]);

  // ── Per-step validators
  const validateStep = (target: 1 | 2 | 3): string | null => {
    if (target >= 2) {
      if (!settlementType) return 'برجاء اختيار نوع التسوية.';
      if (!subtype) return 'برجاء اختيار نوع التسوية (كامل / جزئي).';
      if (!reason.trim()) {
        return settlementType === 'exchange'
          ? 'برجاء إدخال سبب الاستبدال.'
          : 'برجاء إدخال سبب المرتجع.';
      }
    }
    if (target >= 3) {
      const selected = returnRows.filter((r) => r.selected && r.qty > 0);
      if (selected.length === 0) return 'برجاء تحديد المنتجات المرتجعة.';
      for (const r of selected) {
        if (r.qty > r.line.quantity) {
          return 'لا يمكن إرجاع كمية أكبر من الكمية الأصلية.';
        }
      }
      if (isExchange) {
        if (replacementLines.length === 0) {
          return 'برجاء اختيار المنتج البديل أو قطعة الصيانة.';
        }
        for (const line of replacementLines) {
          const name = (line.label ?? line.productType ?? '').trim();
          if (!name) {
            return line.itemType === 'part'
              ? 'برجاء إدخال اسم قطعة الصيانة.'
              : 'برجاء إدخال اسم المنتج البديل.';
          }
          if (!Number.isFinite(line.quantity) || line.quantity < 1) {
            return 'الكمية يجب أن تكون 1 على الأقل.';
          }
          if (!line.isFree && (!Number.isFinite(line.unitPrice) || line.unitPrice <= 0)) {
            return line.itemType === 'part'
              ? 'برجاء إدخال سعر قطعة الصيانة المدفوعة.'
              : 'برجاء إدخال سعر المنتج البديل.';
          }
        }
      }
    }
    if (target >= 3) {
      if (shippingPayer !== 'customer' && shippingPayer !== 'company') {
        return 'برجاء تحديد من يتحمل الشحن.';
      }
    }
    return null;
  };

  const handleAdvance = () => {
    if (step === 3) return;
    const next = (step + 1) as 1 | 2 | 3;
    const err = validateStep(next);
    if (err) {
      setError(err);
      toast.error(err);
      return;
    }
    setError(null);
    setStep(next);
  };

  const handleGoBack = () => {
    if (step === 1) return;
    setError(null);
    setStep((s) => (s - 1) as 1 | 2 | 3);
  };

  // ── Invoice preview — opens a new window with the HTML invoice.
  // Disabled until step 3 is reachable so we don't render an empty
  // settlement summary.
  const handlePreviewInvoice = () => {
    if (!kind) {
      toast.error('برجاء اختيار نوع التسوية أولًا.');
      return;
    }
    const stepErr = validateStep(3);
    if (stepErr) {
      toast.error(stepErr);
      return;
    }
    const payload: AdjustmentInvoicePayload = {
      parentOrderNum: order.orderNum,
      customer: order.customer,
      phone: order.phone,
      addressLabel: addressLabel(order),
      kind,
      reason: reason.trim(),
      returnLines: returnLinesPayload,
      replacementLines,
      originalSelectedValue: totals.returnedValue,
      replacementValue: chargeableReplacementValue,
      priceDifferenceAbs: Math.abs(chargeablePriceDifference),
      priceDifferenceDirection: priceDirection,
      shippingBaseAmount,
      shippingCustomerAmount: settlement.shippingCustomerShare,
      shippingCompanyAmount: settlement.shippingCompanyShare,
      customerCollectAmount: settlement.customerCollectAmount,
      companyRefundAmount: settlement.companyRefundAmount,
      childOrderNum: previewChildOrderNum,
      staffName: (profileFullName ?? '').trim() || user?.email || 'مستخدم غير معروف',
      operationalNote: operationalNote.trim() || null,
    };
    const popup = openAdjustmentInvoiceWindow(payload);
    if (!popup) {
      toast.error('برجاء السماح بالنوافذ المنبثقة لمعاينة الفاتورة.');
    }
  };

  // ── Submit
  const handleSubmit = async () => {
    setError(null);
    if (!kind) {
      const msg = 'برجاء اختيار نوع التسوية.';
      setError(msg);
      toast.error(msg);
      return;
    }
    // Run the full per-step validation one last time.
    const stepErr = validateStep(3);
    if (stepErr) {
      setError(stepErr);
      toast.error(stepErr);
      return;
    }

    // Signed price difference: positive = customer pays, negative =
    // company refunds, 0 = no flow. Mirrors the legacy column shape.
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
      refund_mode: derivedRefundMode,
      refund_amount: derivedRefundAmount,
      price_difference: signedPriceDiff,
      shipping_payer: shippingPayer,
      shipping_customer_amount: settlement.shippingCustomerShare,
      shipping_company_amount: settlement.shippingCompanyShare,
      shipping_base_amount: settlement.shippingBaseAmount,
      customer_collect_amount: settlement.customerCollectAmount,
      price_difference_direction: priceDirection,
      operational_note: operationalNote.trim() || null,
    };

    const draftErr = validateAdjustmentDraft(draft);
    if (draftErr) {
      setError(draftErr);
      toast.error(draftErr);
      return;
    }

    setSubmitting(true);
    try {
      const supabase = createClient();
      if (!supabase) {
        const msg = 'تعذر الاتصال بقاعدة البيانات.';
        setError(msg);
        toast.error(msg);
        return;
      }
      const createdByName = (profileFullName ?? '').trim() || user?.email || 'مستخدم غير معروف';

      // 1) Fresh sibling count → child order number.
      const siblings = await countAdjustmentSiblings(supabase, order.orderNum, kind);
      const childOrderNum = buildChildOrderNum(order.orderNum, kind, siblings);

      // 2) INSERT adjustment row (state defaults to 'pending').
      const adjustmentInsertPayload = {
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
        shipping_base_amount: draft.shipping_base_amount ?? 0,
        customer_collect_amount: draft.customer_collect_amount ?? 0,
        price_difference_direction: draft.price_difference_direction ?? 'none',
        operational_note: draft.operational_note,
        created_by: createdByName,
        created_by_role: currentRoleId ?? null,
      };
      const { data: inserted, error: insertErr } = await supabase
        .from('turath_masr_order_adjustments')
        .insert(adjustmentInsertPayload)
        .select('id')
        .single();
      if (insertErr) {
        const msg = insertErr.message || 'تعذر حفظ التسوية.';
        setError(msg);
        toast.error(msg);
        return;
      }
      const adjustmentId = (inserted as { id?: string } | null)?.id ?? null;

      // 3) INSERT linked child shipping order (best-effort). If this
      //    fails we keep the adjustment alive at `pending` without a
      //    child — the existing approval path will then build the
      //    child as a fallback.
      let childOrderId: string | null = null;
      let childCreated = false;
      try {
        const childRow = buildChildOrderRow({
          parent: {
            id: order.id,
            orderNum: order.orderNum,
            customer: order.customer,
            phone: order.phone,
            phone2: order.phone2 ?? null,
            region: order.region ?? '',
            district: order.district ?? null,
            neighborhood: order.neighborhood ?? null,
            address: order.address ?? '',
            warranty: order.warranty ?? null,
          },
          childOrderNum,
          kind,
          returnLines: returnLinesPayload,
          replacementLines: isExchange ? replacementLines : [],
          priceDifference: signedPriceDiff,
          priceDifferenceDirection: priceDirection,
          shippingCustomerAmount: settlement.shippingCustomerShare,
          customerCollectAmount: settlement.customerCollectAmount,
          operationalNote: operationalNote.trim() || null,
          reason: reason.trim(),
          createdBy: createdByName,
          createdByUserId: user?.id ?? null,
        });
        const { data: childInserted, error: childErr } = await supabase
          .from('turath_masr_orders')
          .insert(childRow)
          .select('id, order_num')
          .single();
        if (childErr) {
          console.warn('[OrderAdjustmentModal] child order insert failed:', childErr);
          toast.warning(
            'تم إنشاء التسوية، لكن تعذر إنشاء طلب الشحن المرتبط. سيتم إنشاؤه تلقائيًا عند الاعتماد.'
          );
        } else {
          childOrderId = (childInserted as { id?: string } | null)?.id ?? null;
          childCreated = true;
        }
      } catch (childErr) {
        console.warn('[OrderAdjustmentModal] child order insert exception:', childErr);
        toast.warning(
          'تم إنشاء التسوية، لكن تعذر إنشاء طلب الشحن المرتبط. سيتم إنشاؤه تلقائيًا عند الاعتماد.'
        );
      }

      // 4) UPDATE adjustment with child link (best-effort).
      if (childCreated && childOrderId && adjustmentId) {
        try {
          await supabase
            .from('turath_masr_order_adjustments')
            .update({
              child_order_id: childOrderId,
              child_order_num: childOrderNum,
            })
            .eq('id', adjustmentId);
        } catch (linkErr) {
          console.warn('[OrderAdjustmentModal] child link update failed:', linkErr);
        }
      }

      // 5) Per-order audit row — enriched envelope with the reason,
      //    settlement type, items summaries, financial summary, and
      //    linked shipping order number. No images, tokens, or
      //    base64 — all compact scalars / lightweight lists.
      const returnSummary = returnLinesPayload.map((l) => ({
        productType: l.productType,
        label: l.label ?? null,
        color: l.color ?? null,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
      }));
      const replacementSummary = replacementLines
        .filter((l) => (l.itemType ?? 'product') === 'product')
        .map((l) => ({
          productType: l.productType,
          label: l.label ?? null,
          color: l.color ?? null,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          isFree: Boolean(l.isFree),
        }));
      const maintenanceSummary = replacementLines
        .filter((l) => l.itemType === 'part')
        .map((l) => ({
          name: l.label ?? l.productType ?? '',
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          isFree: Boolean(l.isFree),
          note: l.note ?? null,
        }));
      const financialSummary = {
        original_selected_value: totals.returnedValue,
        replacement_value: chargeableReplacementValue,
        price_difference: signedPriceDiff,
        price_difference_direction: priceDirection,
        shipping_base_amount: settlement.shippingBaseAmount,
        shipping_customer_amount: settlement.shippingCustomerShare,
        shipping_company_amount: settlement.shippingCompanyShare,
        customer_collect_amount: settlement.customerCollectAmount,
        company_refund_amount: settlement.companyRefundAmount,
      };

      try {
        await supabase.from('turath_masr_audit_logs').insert({
          order_id: order.id,
          order_num: order.orderNum,
          action: 'adjustment_created',
          field_changed: 'adjustment',
          old_value: null,
          new_value: `${ADJUSTMENT_KIND_LABEL_AR[kind]} — ${draft.reason}`,
          changed_by: createdByName,
          changed_by_role: currentRoleId ?? null,
          note: JSON.stringify({
            adjustment_id: adjustmentId,
            kind: draft.kind,
            settlement_reason: draft.reason,
            reason: draft.reason,
            refund_mode: draft.refund_mode,
            refund_amount: draft.refund_amount,
            price_difference: draft.price_difference,
            price_difference_direction: draft.price_difference_direction,
            shipping_payer: draft.shipping_payer,
            shipping_customer_amount: draft.shipping_customer_amount,
            shipping_company_amount: draft.shipping_company_amount,
            shipping_base_amount: draft.shipping_base_amount,
            customer_collect_amount: draft.customer_collect_amount,
            child_order_num: childCreated ? childOrderNum : null,
            return_summary: returnSummary,
            replacement_summary: replacementSummary,
            maintenance_summary: maintenanceSummary,
          }),
        });
      } catch (auditErr) {
        console.warn('[OrderAdjustmentModal] per-order audit failed:', auditErr);
      }

      // 6) Staff audit — `adjustment.created` with full metadata.
      try {
        await writeStaffAuditLog(supabase, {
          action: 'adjustment.created',
          actorId: user?.id ?? null,
          actorName: createdByName,
          actorRoleId: currentRoleId ?? null,
          entity: {
            type: 'adjustment',
            id: adjustmentId ?? undefined,
            label: `${ADJUSTMENT_KIND_LABEL_AR[kind]} — #${order.orderNum}`,
          },
          description: `تم إنشاء ${ADJUSTMENT_KIND_LABEL_AR[kind]} للطلب #${order.orderNum} — السبب: ${draft.reason}`,
          metadata: {
            adjustment_id: adjustmentId,
            order_id: order.id,
            order_num: order.orderNum,
            settlement_type: draft.kind,
            settlement_reason: draft.reason,
            refund_mode: draft.refund_mode,
            refund_amount: draft.refund_amount,
            price_difference: draft.price_difference,
            price_difference_direction: draft.price_difference_direction,
            shipping_payer: draft.shipping_payer,
            financial_summary: financialSummary,
            return_items: returnSummary,
            replacement_items: replacementSummary,
            maintenance_items: maintenanceSummary,
            child_order_num: childCreated ? childOrderNum : null,
          },
        });
      } catch (staffAuditErr) {
        console.warn('[OrderAdjustmentModal] staff audit (created) failed:', staffAuditErr);
      }

      // 7) Staff audit — `adjustment.child_order_created` when the
      //    linked shipping order was successfully created.
      if (childCreated && childOrderId) {
        try {
          await writeStaffAuditLog(supabase, {
            action: 'adjustment.child_order_created',
            actorId: user?.id ?? null,
            actorName: createdByName,
            actorRoleId: currentRoleId ?? null,
            entity: {
              type: 'order',
              id: childOrderId,
              label: `#${childOrderNum}`,
            },
            description: `تم إنشاء الطلب الفرعي #${childOrderNum} (${childOrderTaskLabel(kind)}) للتسوية على الطلب #${order.orderNum}`,
            metadata: {
              adjustment_id: adjustmentId,
              parent_order_id: order.id,
              parent_order_num: order.orderNum,
              child_order_id: childOrderId,
              child_order_num: childOrderNum,
              settlement_type: draft.kind,
              settlement_reason: draft.reason,
              task: childOrderTaskLabel(kind),
            },
          });
        } catch (childAuditErr) {
          console.warn(
            '[OrderAdjustmentModal] staff audit (child_order_created) failed:',
            childAuditErr
          );
        }
      }

      toast.success(
        childCreated
          ? `تم إنشاء التسوية وطلب الشحن المرتبط #${childOrderNum}.`
          : 'تم إنشاء التسوية، بانتظار الموافقة.'
      );

      // Broadcast so other open surfaces refresh.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('turath_masr_order_adjustments_updated'));
        window.dispatchEvent(new Event('turath_masr_orders_updated'));
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
      setSubmitting(false);
    }
  };

  // ─── Replacement / maintenance line editor helpers ───
  const addReplacementLine = (preset: 'product' | 'part') => {
    setReplacementLines((arr) => [
      ...arr,
      {
        itemType: preset,
        isFree: false,
        productType: preset === 'part' ? 'maintenance_part' : '',
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

  // ─── Render ───────────────────────────────────────────────────────────────
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

        {/* Step indicator */}
        <Stepper step={step} kind={kind} />

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 scrollbar-thin">
          {step === 1 && (
            <Step1Type
              settlementType={settlementType}
              setSettlementType={setSettlementType}
              subtype={subtype}
              setSubtype={setSubtype}
              reason={reason}
              setReason={setReason}
              notes={notes}
              setNotes={setNotes}
            />
          )}

          {step === 2 && (
            <Step2Items
              isExchange={isExchange}
              isFullKind={isFullKind}
              returnRows={returnRows}
              setReturnRows={setReturnRows}
              returnedValue={totals.returnedValue}
              replacementLines={replacementLines}
              chargeableReplacementValue={chargeableReplacementValue}
              chargeablePriceDifference={chargeablePriceDifference}
              addReplacementLine={addReplacementLine}
              updateReplacementLine={updateReplacementLine}
              removeReplacementLine={removeReplacementLine}
            />
          )}

          {step === 3 && kind && (
            <Step3Summary
              kind={kind}
              order={order}
              returnedValue={totals.returnedValue}
              replacementValue={chargeableReplacementValue}
              priceDifferenceAbs={Math.abs(chargeablePriceDifference)}
              priceDirection={priceDirection}
              shippingBaseAmount={shippingBaseAmount}
              setShippingBaseAmount={setShippingBaseAmount}
              shippingPayer={shippingPayer}
              setShippingPayer={setShippingPayer}
              shippingCustomerShare={settlement.shippingCustomerShare}
              shippingCompanyShare={settlement.shippingCompanyShare}
              customerCollectAmount={settlement.customerCollectAmount}
              companyRefundAmount={settlement.companyRefundAmount}
              previewChildOrderNum={previewChildOrderNum}
              operationalNote={operationalNote}
              setOperationalNote={setOperationalNote}
              onPreviewInvoice={handlePreviewInvoice}
            />
          )}

          {error && (
            <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm text-rose-700">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-[hsl(var(--border))]">
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={submitting}
              className="btn-secondary text-sm py-1.5 px-3"
            >
              إلغاء
            </button>
            {step > 1 && (
              <button
                onClick={handleGoBack}
                disabled={submitting}
                className="text-sm py-1.5 px-3 rounded-xl border border-[hsl(var(--border))] flex items-center gap-1.5 hover:bg-[hsl(var(--muted))]/40"
              >
                <ArrowRight size={14} />
                السابق
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {step < 3 ? (
              <button
                onClick={handleAdvance}
                disabled={submitting}
                className="btn-primary text-sm py-1.5 px-4 flex items-center gap-1.5"
              >
                التالي
                <ArrowLeft size={14} />
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="btn-primary text-sm py-1.5 px-4 flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <CheckCircle size={14} />
                {submitting ? 'جارٍ الإنشاء…' : 'إنشاء التسوية'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step indicator
// ─────────────────────────────────────────────────────────────────────────────

function Stepper({ step, kind }: { step: 1 | 2 | 3; kind: AdjustmentKind | null }) {
  const labels: Array<{ idx: 1 | 2 | 3; label: string }> = [
    { idx: 1, label: 'نوع التسوية' },
    { idx: 2, label: 'العناصر' },
    { idx: 3, label: 'ملخص التسوية' },
  ];
  return (
    <div className="flex items-center justify-between px-5 py-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30">
      <div className="flex items-center gap-3">
        {labels.map((l, i) => (
          <React.Fragment key={l.idx}>
            {i > 0 && <span className="text-[hsl(var(--muted-foreground))] text-xs">←</span>}
            <div
              className={`flex items-center gap-1.5 text-xs font-bold ${
                step === l.idx
                  ? 'text-[hsl(var(--primary))]'
                  : step > l.idx
                    ? 'text-emerald-700'
                    : 'text-[hsl(var(--muted-foreground))]'
              }`}
            >
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
                  step === l.idx
                    ? 'bg-[hsl(var(--primary))] text-white'
                    : step > l.idx
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]'
                }`}
              >
                {l.idx}
              </span>
              <span>{l.label}</span>
            </div>
          </React.Fragment>
        ))}
      </div>
      {kind && (
        <span className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))] bg-white border border-[hsl(var(--border))] rounded-full px-2 py-0.5">
          {ADJUSTMENT_KIND_LABEL_AR[kind]}
        </span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — settlement type + reason
// ─────────────────────────────────────────────────────────────────────────────

function Step1Type(props: {
  settlementType: SettlementType | null;
  setSettlementType: (t: SettlementType) => void;
  subtype: Subtype | null;
  setSubtype: (s: Subtype) => void;
  reason: string;
  setReason: (r: string) => void;
  notes: string;
  setNotes: (n: string) => void;
}) {
  const {
    settlementType,
    setSettlementType,
    subtype,
    setSubtype,
    reason,
    setReason,
    notes,
    setNotes,
  } = props;
  return (
    <>
      <section className="card-section p-4">
        <h4 className="text-sm font-bold mb-3 flex items-center gap-1.5">
          <Package size={14} /> نوع التسوية
        </h4>
        <div className="grid grid-cols-2 gap-3">
          <TypeCard
            value="return"
            current={settlementType}
            onClick={() => setSettlementType('return')}
            icon={<RotateCcw size={18} />}
            label="مرتجع"
            description="إعادة منتجات إلى المخزن واسترداد قيمتها."
          />
          <TypeCard
            value="exchange"
            current={settlementType}
            onClick={() => setSettlementType('exchange')}
            icon={<Repeat size={18} />}
            label="استبدال"
            description="استبدال منتج بآخر، مع تسوية الفرق."
          />
        </div>
      </section>

      {settlementType && (
        <section className="card-section p-4">
          <h4 className="text-sm font-bold mb-2">
            {settlementType === 'return' ? 'نوع المرتجع' : 'نوع الاستبدال'}
          </h4>
          <div className="grid grid-cols-2 gap-2">
            <SubtypeButton
              active={subtype === 'full'}
              onClick={() => setSubtype('full')}
              label={settlementType === 'return' ? 'مرتجع كامل' : 'استبدال كامل'}
              hint="كل منتجات الفاتورة"
            />
            <SubtypeButton
              active={subtype === 'partial'}
              onClick={() => setSubtype('partial')}
              label={settlementType === 'return' ? 'مرتجع جزئي' : 'استبدال جزئي'}
              hint="اختيار منتج أو كمية محددة"
            />
          </div>
        </section>
      )}

      <section className="card-section p-4">
        <label className="flex flex-col">
          <span className="text-sm font-bold mb-1">{reasonLabelFor(settlementType)}</span>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={reasonPlaceholderFor(settlementType)}
            className={`form-input text-sm ${
              !reason.trim() ? 'border-rose-300 focus:border-rose-400' : ''
            }`}
          />
          {!reason.trim() && (
            <span className="text-[11px] text-rose-600 mt-1">
              {settlementType === 'exchange'
                ? 'سبب الاستبدال مطلوب — لن يتم إنشاء التسوية بدونه.'
                : settlementType === 'return'
                  ? 'سبب المرتجع مطلوب — لن يتم إنشاء التسوية بدونه.'
                  : 'برجاء اختيار النوع وكتابة السبب.'}
            </span>
          )}
        </label>
        <label className="flex flex-col mt-3">
          <span className="text-sm font-bold mb-1">ملاحظات داخلية (اختياري)</span>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="ملاحظات تظهر فقط للفريق الداخلي"
            className="form-input text-sm"
          />
        </label>
      </section>
    </>
  );
}

function TypeCard(props: {
  value: SettlementType;
  current: SettlementType | null;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  description: string;
}) {
  const active = props.current === props.value;
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`flex items-start gap-3 text-right rounded-2xl border-2 px-4 py-3 transition-colors ${
        active
          ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5'
          : 'border-[hsl(var(--border))] hover:border-[hsl(var(--primary))]/40'
      }`}
    >
      <span
        className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
          active
            ? 'bg-[hsl(var(--primary))] text-white'
            : 'bg-[hsl(var(--muted))]/60 text-[hsl(var(--muted-foreground))]'
        }`}
      >
        {props.icon}
      </span>
      <div className="min-w-0">
        <p
          className={`text-sm font-bold ${
            active ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--foreground))]'
          }`}
        >
          {props.label}
        </p>
        <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-0.5">
          {props.description}
        </p>
      </div>
    </button>
  );
}

function SubtypeButton(props: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`flex flex-col items-start text-right rounded-xl border px-3 py-2 transition-colors ${
        props.active
          ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5 text-[hsl(var(--primary))]'
          : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/40'
      }`}
    >
      <span className="text-sm font-bold">{props.label}</span>
      <span className="text-[10px] text-[hsl(var(--muted-foreground))] mt-0.5">{props.hint}</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — items
// ─────────────────────────────────────────────────────────────────────────────

function Step2Items(props: {
  isExchange: boolean;
  isFullKind: boolean;
  returnRows: ReturnRow[];
  setReturnRows: React.Dispatch<React.SetStateAction<ReturnRow[]>>;
  returnedValue: number;
  replacementLines: AdjustmentLine[];
  chargeableReplacementValue: number;
  chargeablePriceDifference: number;
  addReplacementLine: (preset: 'product' | 'part') => void;
  updateReplacementLine: (idx: number, patch: Partial<AdjustmentLine>) => void;
  removeReplacementLine: (idx: number) => void;
}) {
  const {
    isExchange,
    isFullKind,
    returnRows,
    setReturnRows,
    returnedValue,
    replacementLines,
    chargeableReplacementValue,
    chargeablePriceDifference,
    addReplacementLine,
    updateReplacementLine,
    removeReplacementLine,
  } = props;

  return (
    <>
      <section className="card-section p-4">
        <h4 className="text-sm font-bold mb-2">العناصر المرتجعة من الطلب الأصلي</h4>
        {isFullKind && (
          <p className="text-[11px] text-[hsl(var(--muted-foreground))] mb-2">
            في التسوية الكاملة يتم اختيار كل المنتجات تلقائيًا. لتخصيص الكميات اختر تسوية جزئية.
          </p>
        )}
        <div className="space-y-2">
          {returnRows.length === 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              لا توجد عناصر مفصلة لهذا الطلب — تأكد من بيانات الفاتورة قبل المتابعة.
            </p>
          )}
          {returnRows.map((row, idx) => {
            const flashlightTotal = row.line.includeFlashlight
              ? (row.line.flashlightPrice ?? 0) * row.qty
              : 0;
            const lineTotal = row.line.unitPrice * row.qty + flashlightTotal;
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
                        rows.map((r, i) => (i === idx ? { ...r, qty: Math.max(1, r.qty - 1) } : r))
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
        </div>
        <div className="mt-3 flex justify-between text-xs">
          <span className="text-[hsl(var(--muted-foreground))]">قيمة العناصر المرتجعة</span>
          <span className="font-bold text-[hsl(var(--foreground))] font-mono">
            {fmtEgp(returnedValue)}
          </span>
        </div>
      </section>

      {isExchange && (
        <section className="card-section p-4">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
            <h4 className="text-sm font-bold">العناصر البديلة</h4>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => addReplacementLine('product')}
                className="text-xs flex items-center gap-1 rounded-lg border border-[hsl(var(--border))] px-2 py-1 hover:bg-[hsl(var(--muted))]/40"
              >
                <Plus size={12} /> إضافة منتج بديل
              </button>
              <button
                type="button"
                onClick={() => addReplacementLine('part')}
                className="text-xs flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50/60 px-2 py-1 text-indigo-700 hover:bg-indigo-50"
              >
                <Wrench size={12} /> إضافة قطعة صيانة
              </button>
            </div>
          </div>
          {replacementLines.length === 0 ? (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              الاستبدال يتطلب عنصر بديل أو قطعة صيانة واحدة على الأقل.
            </p>
          ) : (
            <div className="space-y-3">
              {replacementLines.map((line, idx) => (
                <ReplacementLineRow
                  key={`replace-${idx}`}
                  line={line}
                  idx={idx}
                  onChange={(patch) => updateReplacementLine(idx, patch)}
                  onRemove={() => removeReplacementLine(idx)}
                />
              ))}
              <div className="flex justify-between text-xs text-[hsl(var(--muted-foreground))]">
                <span>قيمة البدائل (المدفوعة)</span>
                <span className="font-bold text-[hsl(var(--foreground))] font-mono">
                  {fmtEgp(chargeableReplacementValue)}
                </span>
              </div>
              {chargeablePriceDifference !== 0 && (
                <div
                  className={`flex justify-between text-xs font-semibold ${
                    chargeablePriceDifference > 0 ? 'text-amber-700' : 'text-emerald-700'
                  }`}
                >
                  <span>
                    {chargeablePriceDifference > 0 ? 'العميل يدفع فرق:' : 'العميل يسترد فرق:'}
                  </span>
                  <span className="font-mono">{fmtEgp(Math.abs(chargeablePriceDifference))}</span>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </>
  );
}

function ReplacementLineRow(props: {
  line: AdjustmentLine;
  idx: number;
  onChange: (patch: Partial<AdjustmentLine>) => void;
  onRemove: () => void;
}) {
  const { line, idx, onChange, onRemove } = props;
  const isPart = line.itemType === 'part';
  const qty = Math.max(0, Number(line.quantity) || 0);
  const unit = Math.max(0, Number(line.unitPrice) || 0);
  const flashlightTotal = line.includeFlashlight
    ? qty * Math.max(0, Number(line.flashlightPrice) || 0)
    : 0;
  const subtotal = qty * unit + flashlightTotal;
  const chargeable = line.isFree ? 0 : subtotal;
  return (
    <div
      className={`rounded-xl border p-3 space-y-2 ${
        line.isFree
          ? 'border-emerald-200 bg-emerald-50/40'
          : isPart
            ? 'border-indigo-200 bg-indigo-50/30'
            : 'border-[hsl(var(--border))]'
      }`}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span
            className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
              isPart ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-700'
            }`}
          >
            {isPart ? `قطعة صيانة #${idx + 1}` : `منتج بديل #${idx + 1}`}
          </span>
          <label className="flex items-center gap-1 text-[11px] cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(line.isFree)}
              onChange={(e) => onChange({ isFree: e.target.checked })}
            />
            <span
              className={
                line.isFree ? 'text-emerald-700 font-bold' : 'text-[hsl(var(--muted-foreground))]'
              }
            >
              مجاني
            </span>
          </label>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="text-rose-600 hover:underline flex items-center gap-1 text-xs"
        >
          <Trash2 size={12} /> حذف
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <input
          type="text"
          value={line.label ?? ''}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder={isPart ? 'اسم القطعة *' : 'اسم المنتج *'}
          className="form-input text-sm"
        />
        {!isPart && (
          <input
            type="text"
            value={line.color ?? ''}
            onChange={(e) => onChange({ color: e.target.value })}
            placeholder="اللون (اختياري)"
            className="form-input text-sm"
          />
        )}
        <label className="flex flex-col">
          <span className="text-[11px] text-[hsl(var(--muted-foreground))] mb-1">الكمية</span>
          <input
            type="number"
            min={1}
            value={line.quantity}
            onChange={(e) => onChange({ quantity: Math.max(1, Number(e.target.value) || 1) })}
            className="form-input text-sm"
          />
        </label>
        <label className="flex flex-col">
          <span className="text-[11px] text-[hsl(var(--muted-foreground))] mb-1">
            سعر الوحدة (ج.م) {line.isFree ? '(مجاني)' : ''}
          </span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={line.unitPrice}
            disabled={line.isFree}
            onChange={(e) => onChange({ unitPrice: Math.max(0, Number(e.target.value) || 0) })}
            className="form-input text-sm disabled:opacity-60"
          />
        </label>
        <input
          type="text"
          value={line.note ?? ''}
          onChange={(e) => onChange({ note: e.target.value })}
          placeholder="ملاحظة (اختياري)"
          className="form-input text-sm col-span-2"
        />
      </div>

      <div className="flex items-center justify-end text-xs">
        {line.isFree ? (
          <span className="flex items-center gap-2">
            <span className="font-mono text-emerald-700 font-bold">{fmtEgp(0)}</span>
            <span className="text-[10px] text-[hsl(var(--muted-foreground))] line-through">
              {fmtEgp(subtotal)}
            </span>
          </span>
        ) : (
          <span className="font-mono text-[hsl(var(--foreground))] font-bold">
            {fmtEgp(chargeable)}
          </span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3 — settlement summary
// ─────────────────────────────────────────────────────────────────────────────

function Step3Summary(props: {
  kind: AdjustmentKind;
  order: OrderSummary;
  returnedValue: number;
  replacementValue: number;
  priceDifferenceAbs: number;
  priceDirection: PriceDifferenceDirection;
  shippingBaseAmount: number;
  setShippingBaseAmount: (n: number) => void;
  shippingPayer: ShippingPayer;
  setShippingPayer: (p: ShippingPayer) => void;
  shippingCustomerShare: number;
  shippingCompanyShare: number;
  customerCollectAmount: number;
  companyRefundAmount: number;
  previewChildOrderNum: string | null;
  operationalNote: string;
  setOperationalNote: (s: string) => void;
  onPreviewInvoice: () => void;
}) {
  const isExchange = props.kind === 'exchange_full' || props.kind === 'exchange_partial';
  return (
    <>
      {/* Shipping */}
      <section className="card-section p-4">
        <h4 className="text-sm font-bold mb-2 flex items-center gap-1.5">
          <Truck size={14} /> الشحن للطلب الفرعي
        </h4>
        <label className="flex flex-col">
          <span className="text-[11px] text-[hsl(var(--muted-foreground))] mb-1">
            مصاريف الشحن
            {props.order.region && (
              <span className="mr-1 text-[10px]">
                ({props.order.region}
                {props.order.district ? ` — ${props.order.district}` : ''})
              </span>
            )}
          </span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={props.shippingBaseAmount}
            onChange={(e) => props.setShippingBaseAmount(Math.max(0, Number(e.target.value) || 0))}
            className="form-input text-sm bg-[hsl(var(--muted))]/40 font-mono"
          />
          <span className="text-[10px] text-[hsl(var(--muted-foreground))] mt-1">
            مأخوذة تلقائيًا من سعر شحن المنطقة. عدّلها فقط للحالات الخاصة.
          </span>
        </label>
        <div className="mt-3">
          <span className="block text-[11px] text-[hsl(var(--muted-foreground))] mb-1">
            من يتحمل الشحن؟
          </span>
          <div className="grid grid-cols-2 gap-2">
            <ShippingPayerButton
              active={props.shippingPayer === 'customer'}
              onClick={() => props.setShippingPayer('customer')}
              label="العميل"
              hint="تخصم/تضاف على فاتورة التسوية"
            />
            <ShippingPayerButton
              active={props.shippingPayer === 'company'}
              onClick={() => props.setShippingPayer('company')}
              label="الشركة"
              hint="الشحن = 0 على العميل"
            />
          </div>
        </div>
      </section>

      {/* Settlement summary card */}
      <section className="card-section p-4">
        <h4 className="text-sm font-bold mb-3 flex items-center gap-1.5">
          <Wallet size={14} /> ملخص التسوية
        </h4>
        <div className="rounded-xl bg-[hsl(var(--muted))]/40 p-3 text-sm space-y-1.5">
          <SummaryRow label="قيمة العناصر المرتجعة" value={fmtEgp(props.returnedValue)} />
          {isExchange && (
            <SummaryRow label="قيمة العناصر البديلة" value={fmtEgp(props.replacementValue)} />
          )}
          {props.priceDifferenceAbs > 0 && (
            <SummaryRow
              label={
                props.priceDirection === 'customer_pays'
                  ? 'فرق سعر (يدفعه العميل)'
                  : 'فرق سعر (يُسترد للعميل)'
              }
              value={fmtEgp(props.priceDifferenceAbs)}
              tone={props.priceDirection === 'customer_pays' ? 'amber' : 'emerald'}
            />
          )}
          <SummaryRow label="مصاريف الشحن" value={fmtEgp(props.shippingBaseAmount)} />
          <SummaryRow label="يتحمل العميل من الشحن" value={fmtEgp(props.shippingCustomerShare)} />
          <SummaryRow label="تتحمل الشركة من الشحن" value={fmtEgp(props.shippingCompanyShare)} />
          <div className="border-t border-[hsl(var(--border))]/60 my-1" />
          {props.customerCollectAmount > 0 ? (
            <SummaryRow
              label="المبلغ المطلوب من العميل"
              value={fmtEgp(props.customerCollectAmount)}
              emphasis
              tone="emerald"
            />
          ) : props.companyRefundAmount > 0 ? (
            <SummaryRow
              label="المبلغ المسترد للعميل"
              value={fmtEgp(props.companyRefundAmount)}
              emphasis
              tone="amber"
            />
          ) : (
            <div className="text-[12px] text-[hsl(var(--muted-foreground))] italic text-center pt-1">
              لا يوجد فرق مالي.
            </div>
          )}
        </div>
      </section>

      {/* Linked child order preview */}
      <section className="card-section p-4">
        <h4 className="text-sm font-bold mb-2">طلب الشحن المرتبط</h4>
        <div className="text-xs text-[hsl(var(--muted-foreground))] space-y-1">
          <p>سيتم إنشاء طلب شحن مباشر يظهر في صفحة الطلبات للجدولة، ومرتبط بالطلب الأصلي:</p>
          <div className="rounded-xl bg-[hsl(var(--muted))]/40 p-3 flex items-center justify-between text-sm">
            <span className="text-[hsl(var(--muted-foreground))]">رقم الطلب الفرعي المتوقع</span>
            <span className="font-mono font-bold text-[hsl(var(--foreground))]">
              {props.previewChildOrderNum ? `#${props.previewChildOrderNum}` : '...'}
            </span>
          </div>
          <p className="text-[10px]">
            نوع المهمة: {childOrderTaskLabel(props.kind)}. سيتم إلغاؤه تلقائيًا إذا تم إلغاء أو رفض
            هذه التسوية.
          </p>
        </div>
      </section>

      {/* Operational note */}
      <section className="card-section p-4">
        <label className="flex flex-col">
          <span className="text-sm font-bold mb-1">تعليمات للمندوب (اختياري)</span>
          <textarea
            rows={2}
            value={props.operationalNote}
            onChange={(e) => props.setOperationalNote(e.target.value)}
            placeholder="مثال: اتصل بالعميل قبل الذهاب — الباب الخلفي"
            className="form-input text-sm"
          />
          <span className="text-[10px] text-[hsl(var(--muted-foreground))] mt-1">
            تظهر هذه التعليمات في صفحة المندوب وفي الفاتورة.
          </span>
        </label>
      </section>

      {/* Invoice preview */}
      <section className="card-section p-4 bg-[hsl(var(--muted))]/20">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-bold">معاينة الفاتورة</h4>
            <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-0.5">
              تفتح في نافذة منفصلة جاهزة للطباعة.
            </p>
          </div>
          <button
            type="button"
            onClick={props.onPreviewInvoice}
            className="text-sm rounded-xl border border-[hsl(var(--primary))] bg-white px-3 py-1.5 text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/5 flex items-center gap-1.5"
          >
            <Eye size={14} />
            معاينة
          </button>
        </div>
      </section>
    </>
  );
}

function ShippingPayerButton(props: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`flex flex-col items-start text-right rounded-xl border px-3 py-2 transition-colors ${
        props.active
          ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5 text-[hsl(var(--primary))]'
          : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/40'
      }`}
    >
      <span className="text-sm font-bold">{props.label}</span>
      <span className="text-[10px] text-[hsl(var(--muted-foreground))] mt-0.5">{props.hint}</span>
    </button>
  );
}

function SummaryRow(props: {
  label: string;
  value: string;
  tone?: 'amber' | 'emerald';
  emphasis?: boolean;
}) {
  const valueColour =
    props.tone === 'emerald'
      ? 'text-emerald-700'
      : props.tone === 'amber'
        ? 'text-amber-700'
        : 'text-[hsl(var(--foreground))]';
  return (
    <div className={`flex items-center justify-between ${props.emphasis ? 'mt-1' : ''}`}>
      <span
        className={`${
          props.emphasis ? 'text-sm font-bold' : 'text-[12px]'
        } text-[hsl(var(--muted-foreground))]`}
      >
        {props.label}
      </span>
      <span
        className={`font-mono ${props.emphasis ? 'text-sm font-bold' : 'text-[12px]'} ${valueColour}`}
      >
        {props.value}
      </span>
    </div>
  );
}
