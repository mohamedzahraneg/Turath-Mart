// ─────────────────────────────────────────────────────────────────────────────
// src/app/orders-management/components/OrderAdjustmentModal.tsx
//
// Phase Returns-Exchange-1 — 3-step wizard for return / exchange
// creation with reason mandatory + maintenance-item affordance +
// linked child shipping order at create time + invoice preview.
//
// Phase Returns-Exchange-1 Fix1 — UX + math corrections layered on
// top of the Phase Returns-Exchange-1 wizard:
//
//   1. Shipping is now auto-resolved from the active address's region
//      coverage (settings_regions). The number is read-only; only
//      changes when the operator picks a different address.
//   2. Address picker in step 3: "same as original order" (default)
//      or "new address". When new, the operator fills gov/area/
//      neighborhood + address line and the fee re-resolves live.
//      The new address rides the child shipping order, which means
//      the next past-addresses lookup for this customer surfaces it.
//   3. Replacement products MUST come from the inventory catalog
//      (the same product-card grid used by AddOrderModal /
//      EditOrderModal). Free-text product entry is gone. Maintenance
//      / spare parts remain manual via a dedicated affordance.
//   4. Per-line partial-value mode: the operator can mark a returned
//      item as a "partial piece" worth only N ج.م rather than the
//      whole product price (e.g. swapping a single broken bolt on
//      a holder). Stored on the line as `value_mode='partial'` +
//      `partial_value` and honoured by `computeLineContribution`.
//   5. Refund mode is user-controlled (full / partial / none /
//      price_diff). Partial mode requires a refund-amount input.
//      Company deduction can also reduce the refund.
//   6. Final settlement math distinguishes refund-side vs amount-due-
//      side: customer-shipping reduces refund when refund > 0;
//      adds to amount-due when refund = 0. Company deduction always
//      reduces refund.
//   7. Invoice preview popup uses the safer pattern: synchronous
//      `window.open` inside the click handler with a loading shell
//      written first, then the real HTML, with auto-print after a
//      300 ms delay. Popup blockers fall through to an in-page iframe
//      modal so the operator can still print.
//
// Boundaries (unchanged)
// ----------------------
//   • No inventory mutations.
//   • No DB migration. `value_mode` / `partial_value` live inside
//     existing JSONB columns; company deduction is folded into
//     `customer_collect_amount` math + audit metadata.
//   • No auto-approval. State always starts at `pending`.
// ─────────────────────────────────────────────────────────────────────────────
'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  Download,
  Eye,
  Home,
  MapPin,
  Minus,
  Package,
  Plus,
  Printer,
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
  REFUND_MODE_LABEL_AR,
  buildChildOrderNum,
  computeAdjustmentTotals,
  computeLineTotal,
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
  type ChildOrderShipAddress,
} from '@/lib/orders/adjustmentChildOrder';
import {
  openAdjustmentInvoiceWindow,
  type AdjustmentInvoicePayload,
} from '@/lib/orders/adjustmentInvoice';
import {
  loadProductCards,
  resolveLineColors,
  type InventoryItem,
  type ProductCard,
} from '@/lib/orders/productCards';
import { InventoryThumbnail } from '@/lib/inventory/InventoryThumbnail';
import { getShippingRegions } from '@/lib/settings/shippingRegionsCache';
import { resolveShippingFeeFromCoverage } from '@/lib/shipping/resolveShippingFee';
import {
  findArea,
  findNeighborhood,
  normalizeCoverageHierarchy,
} from '@/lib/shipping/coverageHierarchy';
import type { ShippingDistrict, ShippingGovernorate } from '@/lib/shipping/types';

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
  phone2?: string | null;
  total: number;
  lines: OrderLine[];
  shippingFee?: number;
  region?: string;
  district?: string | null;
  neighborhood?: string | null;
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
type AddressMode = 'same' | 'new';

interface ReturnRow {
  line: OrderLine;
  selected: boolean;
  qty: number;
  /** Phase Returns-Exchange-1 Fix1 — full product value vs partial
   *  piece value. */
  valueMode: 'full' | 'partial';
  /** Only used when `valueMode === 'partial'`. */
  partialValue: number;
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

function addressLabelOf(parts: {
  region: string | null | undefined;
  district: string | null | undefined;
  neighborhood: string | null | undefined;
  address: string | null | undefined;
}): string {
  return [parts.region, parts.district, parts.neighborhood, parts.address]
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join('، ');
}

function fullLineValue(line: OrderLine, qty: number): number {
  const unit = Math.max(0, Number(line.unitPrice) || 0);
  const flashOn = line.includeFlashlight === true;
  const flash = flashOn ? Math.max(0, Number(line.flashlightPrice) || 0) : 0;
  return qty * unit + qty * flash;
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
    order.lines.map((line) => ({
      line,
      selected: true,
      qty: line.quantity,
      valueMode: 'full',
      partialValue: 0,
    }))
  );
  const [replacementLines, setReplacementLines] = useState<AdjustmentLine[]>([]);
  const [productCards, setProductCards] = useState<ProductCard[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [showProductPicker, setShowProductPicker] = useState(false);

  // ── Step 3 state — settlement
  const [shippingPayer, setShippingPayer] = useState<ShippingPayer>('company');
  const [operationalNote, setOperationalNote] = useState('');
  /** Cached sibling count for the child-order suffix preview. */
  const [previewSiblingCount, setPreviewSiblingCount] = useState<number | null>(null);

  // Phase Returns-Exchange-1 Fix1 — address picker state.
  const [addressMode, setAddressMode] = useState<AddressMode>('same');
  const [newAddressRegion, setNewAddressRegion] = useState('');
  const [newAddressDistrict, setNewAddressDistrict] = useState('');
  const [newAddressNeighborhood, setNewAddressNeighborhood] = useState('');
  const [newAddressLine, setNewAddressLine] = useState('');
  const [dbRegions, setDbRegions] = useState<unknown[]>([]);

  // Phase Returns-Exchange-1 Fix1 — refund mode + amount + company
  // deduction. Refund mode replaces the legacy auto-derivation;
  // company deduction reduces the refund before shipping.
  const [refundMode, setRefundMode] = useState<RefundMode>('full');
  const [refundAmountInput, setRefundAmountInput] = useState(0);
  const [companyDeductionEnabled, setCompanyDeductionEnabled] = useState(false);
  const [companyDeductionAmount, setCompanyDeductionAmount] = useState(0);
  const [companyDeductionReason, setCompanyDeductionReason] = useState('');

  // Invoice preview state. When the browser blocks the popup, fall
  // back to an in-page iframe modal so the operator still has a path
  // to print.
  const [invoiceFallback, setInvoiceFallback] = useState<{ html: string } | null>(null);

  // ── Submission state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kind = deriveKind(settlementType, subtype);
  const isExchange = settlementType === 'exchange';
  const isFullKind = subtype === 'full';

  // ── Recompute return rows when subtype switches.
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

  // ── Load shipping regions once.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const regs = (await getShippingRegions()) as unknown[];
        if (!cancelled && Array.isArray(regs)) setDbRegions(regs);
      } catch (err) {
        console.warn('[OrderAdjustmentModal] shipping regions load failed:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Load product catalog once for the replacement picker.
  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;
    let cancelled = false;
    void (async () => {
      try {
        const { items, cards } = await loadProductCards(supabase);
        if (cancelled) return;
        setProductCards(cards);
        setInventoryItems(items);
      } catch (err) {
        console.warn('[OrderAdjustmentModal] product catalog load failed:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Region hierarchy for address picker / fee resolution.
  const hierarchicalRegions = useMemo(() => {
    if (dbRegions.length === 0) return [] as ShippingGovernorate[];
    return normalizeCoverageHierarchy(dbRegions, {});
  }, [dbRegions]);

  // ── Active address: same-as-parent or new.
  const activeAddress: ChildOrderShipAddress = useMemo(() => {
    if (addressMode === 'new') {
      return {
        region: newAddressRegion.trim(),
        district: newAddressDistrict.trim() || null,
        neighborhood: newAddressNeighborhood.trim() || null,
        address: newAddressLine.trim(),
      };
    }
    return {
      region: (order.region ?? '').trim(),
      district: (order.district ?? '').trim() || null,
      neighborhood: (order.neighborhood ?? '').trim() || null,
      address: (order.address ?? '').trim(),
    };
  }, [
    addressMode,
    newAddressRegion,
    newAddressDistrict,
    newAddressNeighborhood,
    newAddressLine,
    order.region,
    order.district,
    order.neighborhood,
    order.address,
  ]);

  // ── Resolve shipping fee from the active address's coverage tree.
  const feeResolution = useMemo(() => {
    const govEntry = hierarchicalRegions.find((g) => g.name === activeAddress.region) ?? null;
    const areaEntry: ShippingDistrict | null = activeAddress.district
      ? findArea(activeAddress.region, activeAddress.district, hierarchicalRegions)
      : null;
    const neighEntry: ShippingDistrict | null =
      areaEntry && activeAddress.neighborhood
        ? findNeighborhood(
            activeAddress.region,
            areaEntry.name,
            activeAddress.neighborhood,
            hierarchicalRegions
          )
        : null;
    const resolution = resolveShippingFeeFromCoverage({
      governorate: govEntry,
      area: areaEntry,
      neighborhood: neighEntry,
    });
    return {
      ...resolution,
      // When the address is the parent order's and the regions data
      // isn't loaded yet, fall back to the original order's
      // `shippingFee` so the preview isn't a blank "0 ج.م".
      fee:
        resolution.source !== 'none'
          ? resolution.fee
          : addressMode === 'same' && Number.isFinite(order.shippingFee)
            ? Math.max(0, Number(order.shippingFee) || 0)
            : resolution.fee,
      source: resolution.source,
      label: resolution.label,
    };
  }, [
    hierarchicalRegions,
    activeAddress.region,
    activeAddress.district,
    activeAddress.neighborhood,
    addressMode,
    order.shippingFee,
  ]);

  const shippingBaseAmount = Math.max(0, Number(feeResolution.fee) || 0);

  // ── Build return-lines payload — propagates value_mode + partial_value
  // through to the JSONB so audit + invoice can render it.
  const returnLinesPayload: AdjustmentLine[] = useMemo(
    () =>
      returnRows
        .filter((r) => r.selected && r.qty > 0)
        .map((r) => {
          const base: AdjustmentLine = {
            productType: r.line.productType,
            label: r.line.label,
            color: r.line.color ?? null,
            quantity: r.qty,
            unitPrice: r.line.unitPrice,
            includeFlashlight: r.line.includeFlashlight,
            flashlightPrice: r.line.flashlightPrice,
            note: r.line.note ?? null,
          };
          if (r.valueMode === 'partial') {
            base.value_mode = 'partial';
            base.partial_value = Math.max(0, Number(r.partialValue) || 0);
          } else {
            base.value_mode = 'full';
          }
          return base;
        }),
    [returnRows]
  );

  // ── Totals — `computeAdjustmentTotals` already honours
  // `computeLineContribution` (Fix1) so the returnedValue here
  // reflects the partial-value lump sums.
  const totals = useMemo(
    () =>
      computeAdjustmentTotals({
        return_lines: returnLinesPayload,
        replacement_lines: replacementLines,
        refund_mode: 'none',
      }),
    [returnLinesPayload, replacementLines]
  );
  const chargeableReplacementValue = useMemo(
    () => sumChargeableReplacementLines(replacementLines),
    [replacementLines]
  );
  const chargeablePriceDifference = useMemo(
    () => chargeableReplacementValue - totals.returnedValue,
    [chargeableReplacementValue, totals.returnedValue]
  );

  // ── Derived price direction.
  const priceDirection: PriceDifferenceDirection = useMemo(() => {
    if (!isExchange) return 'none';
    if (chargeablePriceDifference > 0) return 'customer_pays';
    if (chargeablePriceDifference < 0) return 'company_refunds';
    return 'none';
  }, [isExchange, chargeablePriceDifference]);

  // ── Refund eligibility — the natural refund before mode override.
  // For pure returns it's the returned value; for exchanges where
  // the company owes the customer it's the absolute price difference.
  const eligibleRefund = useMemo(() => {
    if (!isExchange) return totals.returnedValue;
    if (priceDirection === 'company_refunds') return Math.abs(chargeablePriceDifference);
    return 0;
  }, [isExchange, priceDirection, totals.returnedValue, chargeablePriceDifference]);

  // ── Effective refund after the operator's mode + amount choice.
  const effectiveRefund = useMemo(() => {
    if (eligibleRefund <= 0) return 0;
    switch (refundMode) {
      case 'full':
        return eligibleRefund;
      case 'partial':
        return Math.min(Math.max(0, Number(refundAmountInput) || 0), eligibleRefund);
      case 'none':
        return 0;
      case 'price_diff':
        // For exchanges this equals abs(priceDiff) when company owes;
        // for pure returns there is no price difference so 0.
        if (isExchange && priceDirection === 'company_refunds') {
          return Math.abs(chargeablePriceDifference);
        }
        return 0;
    }
  }, [
    eligibleRefund,
    refundMode,
    refundAmountInput,
    isExchange,
    priceDirection,
    chargeablePriceDifference,
  ]);

  const customerPaysDifference =
    isExchange && priceDirection === 'customer_pays' ? Math.abs(chargeablePriceDifference) : 0;

  const customerShippingShare = shippingPayer === 'customer' ? shippingBaseAmount : 0;
  const companyShippingShare = shippingPayer === 'company' ? shippingBaseAmount : 0;

  const companyDeduction = companyDeductionEnabled
    ? Math.max(0, Number(companyDeductionAmount) || 0)
    : 0;

  // ── Final settlement: refund-side vs amount-due-side.
  // When effectiveRefund > 0, customer-shipping + deduction reduce
  // the refund. When effectiveRefund == 0 but customer owes
  // money, customer-shipping adds to the amount due.
  const finalRefundToCustomer = Math.max(
    0,
    effectiveRefund - customerShippingShare - companyDeduction
  );
  const finalAmountDueFromCustomer =
    effectiveRefund > 0 ? customerPaysDifference : customerPaysDifference + customerShippingShare;

  // ── Preview child order number.
  const previewChildOrderNum = useMemo(() => {
    if (!kind || previewSiblingCount === null) return null;
    return buildChildOrderNum(order.orderNum, kind, previewSiblingCount);
  }, [kind, previewSiblingCount, order.orderNum]);

  // ── Fetch sibling count when entering step 3.
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

  // ── Reset refund mode when settlementType changes so an old
  // "price_diff" pick doesn't linger into a pure return.
  useEffect(() => {
    if (!isExchange) setRefundMode('full');
  }, [isExchange]);

  // ── Sync refund-amount input with eligible refund changes.
  useEffect(() => {
    if (refundMode === 'partial') {
      setRefundAmountInput((curr) => Math.min(Math.max(0, Number(curr) || 0), eligibleRefund));
    }
  }, [refundMode, eligibleRefund]);

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
        if (r.valueMode === 'partial') {
          const full = fullLineValue(r.line, r.qty);
          if (!(r.partialValue > 0)) {
            return 'برجاء إدخال قيمة جزئية أكبر من صفر.';
          }
          if (r.partialValue > full) {
            return 'لا يمكن أن تتجاوز قيمة الجزء قيمة المنتج الأصلي.';
          }
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
              : 'برجاء اختيار المنتج البديل من المخزن.';
          }
          if (!Number.isFinite(line.quantity) || line.quantity < 1) {
            return 'الكمية يجب أن تكون 1 على الأقل.';
          }
          if (!line.isFree && (!Number.isFinite(line.unitPrice) || line.unitPrice <= 0)) {
            return line.itemType === 'part'
              ? 'برجاء إدخال سعر قطعة الصيانة المدفوعة.'
              : 'سعر المنتج البديل غير متاح من المخزن.';
          }
        }
      }
    }
    if (target >= 3) {
      if (shippingPayer !== 'customer' && shippingPayer !== 'company') {
        return 'برجاء تحديد من يتحمل الشحن.';
      }
      // Address validation
      if (addressMode === 'new') {
        if (!newAddressRegion.trim()) return 'برجاء اختيار المحافظة للعنوان الجديد.';
        if (!newAddressLine.trim()) return 'برجاء إدخال العنوان الجديد.';
      }
      if (!activeAddress.region) return 'برجاء اختيار عنوان شحن صحيح.';
      if (feeResolution.source === 'none') {
        return 'برجاء تحديد المنطقة لحساب الشحن.';
      }
      // Refund mode validation
      if (refundMode === 'partial') {
        if (!(refundAmountInput > 0)) {
          return 'برجاء إدخال مبلغ استرداد جزئي أكبر من صفر.';
        }
        if (refundAmountInput > eligibleRefund) {
          return 'لا يمكن أن يتجاوز الاسترداد الجزئي المبلغ المستحق.';
        }
      }
      if (companyDeductionEnabled) {
        if (!(companyDeduction > 0)) {
          return 'برجاء إدخال قيمة الاستقطاع أكبر من صفر.';
        }
        if (companyDeduction > eligibleRefund) {
          return 'لا يمكن أن يتجاوز الاستقطاع قيمة الاسترداد.';
        }
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

  // ── Build the invoice payload from current state.
  const buildInvoicePayload = (childOrderNum: string | null): AdjustmentInvoicePayload | null => {
    if (!kind) return null;
    return {
      parentOrderNum: order.orderNum,
      customer: order.customer,
      phone: order.phone,
      addressLabel: addressLabelOf({
        region: activeAddress.region,
        district: activeAddress.district,
        neighborhood: activeAddress.neighborhood,
        address: activeAddress.address,
      }),
      addressChoice: addressMode,
      kind,
      reason: reason.trim(),
      returnLines: returnLinesPayload,
      replacementLines,
      originalSelectedValue: totals.returnedValue,
      replacementValue: chargeableReplacementValue,
      priceDifferenceAbs: Math.abs(chargeablePriceDifference),
      priceDifferenceDirection: priceDirection,
      shippingBaseAmount,
      shippingCustomerAmount: customerShippingShare,
      shippingCompanyAmount: companyShippingShare,
      shippingFeeSourceLabel: feeResolution.label,
      customerCollectAmount: finalAmountDueFromCustomer,
      companyRefundAmount: finalRefundToCustomer,
      refundMode,
      companyDeductionAmount: companyDeduction,
      companyDeductionReason: companyDeductionReason.trim() || null,
      childOrderNum,
      staffName: (profileFullName ?? '').trim() || user?.email || 'مستخدم غير معروف',
      operationalNote: operationalNote.trim() || null,
    };
  };

  // ── Invoice preview — synchronous popup with fallback iframe.
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
    const payload = buildInvoicePayload(previewChildOrderNum);
    if (!payload) return;
    const result = openAdjustmentInvoiceWindow(payload);
    if (!result.opened) {
      // Popup blocked — fall back to an in-page iframe modal.
      setInvoiceFallback({ html: result.html });
      toast.message('المتصفح منع فتح نافذة منبثقة. تم فتح الفاتورة داخل الصفحة.');
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
    const stepErr = validateStep(3);
    if (stepErr) {
      setError(stepErr);
      toast.error(stepErr);
      return;
    }

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
      refund_amount: effectiveRefund,
      price_difference: signedPriceDiff,
      shipping_payer: shippingPayer,
      shipping_customer_amount: customerShippingShare,
      shipping_company_amount: companyShippingShare,
      shipping_base_amount: shippingBaseAmount,
      customer_collect_amount: finalAmountDueFromCustomer,
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

      const siblings = await countAdjustmentSiblings(supabase, order.orderNum, kind);
      const childOrderNum = buildChildOrderNum(order.orderNum, kind, siblings);

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

      // INSERT linked child shipping order with the active address.
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
          shippingCustomerAmount: customerShippingShare,
          customerCollectAmount: finalAmountDueFromCustomer,
          operationalNote: operationalNote.trim() || null,
          reason: reason.trim(),
          createdBy: createdByName,
          createdByUserId: user?.id ?? null,
          shipAddress: addressMode === 'new' ? activeAddress : null,
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

      // Audit summaries — enriched with Fix1 fields.
      const returnSummary = returnLinesPayload.map((l) => ({
        productType: l.productType,
        label: l.label ?? null,
        color: l.color ?? null,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        value_mode: l.value_mode ?? 'full',
        partial_value: l.value_mode === 'partial' ? (l.partial_value ?? 0) : null,
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
        shipping_base_amount: shippingBaseAmount,
        shipping_customer_amount: customerShippingShare,
        shipping_company_amount: companyShippingShare,
        shipping_fee_source: feeResolution.source,
        refund_mode: refundMode,
        eligible_refund: eligibleRefund,
        effective_refund: effectiveRefund,
        company_deduction: companyDeduction,
        company_deduction_reason: companyDeductionReason.trim() || null,
        customer_collect_amount: finalAmountDueFromCustomer,
        company_refund_amount: finalRefundToCustomer,
        address_choice: addressMode,
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
            company_refund_amount: finalRefundToCustomer,
            company_deduction: companyDeduction,
            company_deduction_reason: companyDeductionReason.trim() || null,
            address_choice: addressMode,
            child_order_num: childCreated ? childOrderNum : null,
            return_summary: returnSummary,
            replacement_summary: replacementSummary,
            maintenance_summary: maintenanceSummary,
          }),
        });
      } catch (auditErr) {
        console.warn('[OrderAdjustmentModal] per-order audit failed:', auditErr);
      }

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
              address_choice: addressMode,
              ship_region: activeAddress.region,
              ship_district: activeAddress.district,
              ship_neighborhood: activeAddress.neighborhood,
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

  // ─── Replacement editor helpers ───
  const addInventoryReplacement = (card: ProductCard) => {
    const colors = resolveLineColors(card);
    setReplacementLines((arr) => [
      ...arr,
      {
        itemType: 'product',
        isFree: false,
        productType: card.value,
        label: card.label,
        color: colors[0]?.value ?? null,
        quantity: 1,
        unitPrice: Math.max(0, Number(card.basePrice) || 0),
        includeFlashlight: false,
        flashlightPrice: card.value === 'holder' ? 150 : 0,
        note: '',
      },
    ]);
    setShowProductPicker(false);
  };

  const addMaintenancePart = () => {
    setReplacementLines((arr) => [
      ...arr,
      {
        itemType: 'part',
        isFree: false,
        productType: 'maintenance_part',
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

  // ─── Render ──────────────────────────────────────────────────────────────
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
              productCards={productCards}
              inventoryItems={inventoryItems}
              showProductPicker={showProductPicker}
              setShowProductPicker={setShowProductPicker}
              chargeableReplacementValue={chargeableReplacementValue}
              chargeablePriceDifference={chargeablePriceDifference}
              onAddInventory={addInventoryReplacement}
              onAddMaintenance={addMaintenancePart}
              onUpdateLine={updateReplacementLine}
              onRemoveLine={removeReplacementLine}
            />
          )}

          {step === 3 && kind && (
            <Step3Summary
              kind={kind}
              order={order}
              activeAddress={activeAddress}
              addressMode={addressMode}
              setAddressMode={setAddressMode}
              newAddressRegion={newAddressRegion}
              setNewAddressRegion={setNewAddressRegion}
              newAddressDistrict={newAddressDistrict}
              setNewAddressDistrict={setNewAddressDistrict}
              newAddressNeighborhood={newAddressNeighborhood}
              setNewAddressNeighborhood={setNewAddressNeighborhood}
              newAddressLine={newAddressLine}
              setNewAddressLine={setNewAddressLine}
              hierarchicalRegions={hierarchicalRegions}
              feeResolution={feeResolution}
              shippingPayer={shippingPayer}
              setShippingPayer={setShippingPayer}
              shippingBaseAmount={shippingBaseAmount}
              customerShippingShare={customerShippingShare}
              companyShippingShare={companyShippingShare}
              returnedValue={totals.returnedValue}
              replacementValue={chargeableReplacementValue}
              priceDifferenceAbs={Math.abs(chargeablePriceDifference)}
              priceDirection={priceDirection}
              eligibleRefund={eligibleRefund}
              effectiveRefund={effectiveRefund}
              refundMode={refundMode}
              setRefundMode={setRefundMode}
              refundAmountInput={refundAmountInput}
              setRefundAmountInput={setRefundAmountInput}
              companyDeductionEnabled={companyDeductionEnabled}
              setCompanyDeductionEnabled={setCompanyDeductionEnabled}
              companyDeductionAmount={companyDeductionAmount}
              setCompanyDeductionAmount={setCompanyDeductionAmount}
              companyDeductionReason={companyDeductionReason}
              setCompanyDeductionReason={setCompanyDeductionReason}
              companyDeduction={companyDeduction}
              finalRefundToCustomer={finalRefundToCustomer}
              finalAmountDueFromCustomer={finalAmountDueFromCustomer}
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

      {/* Phase Returns-Exchange-1 Fix1 — popup fallback. When the
          browser blocks the popup, render the invoice HTML in an
          in-page modal via an iframe `srcDoc`. The user can print
          from the iframe or via the embedded "طباعة" button. */}
      {invoiceFallback && (
        <InvoicePreviewFallback
          html={invoiceFallback.html}
          onClose={() => setInvoiceFallback(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Invoice preview fallback (in-page iframe)
// ─────────────────────────────────────────────────────────────────────────────

function InvoicePreviewFallback({ html, onClose }: { html: string; onClose: () => void }) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const handlePrint = () => {
    try {
      iframeRef.current?.contentWindow?.print();
    } catch (err) {
      console.warn('[InvoicePreviewFallback] iframe print failed:', err);
      toast.error('تعذر فتح نافذة الطباعة. حاول تنزيل الفاتورة بدلًا من ذلك.');
    }
  };

  const handleDownload = () => {
    try {
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'invoice.html';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      console.warn('[InvoicePreviewFallback] download failed:', err);
      toast.error('تعذر تحميل ملف الفاتورة.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[300] bg-black/60 flex items-center justify-center p-3"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white w-full max-w-4xl max-h-[94vh] flex flex-col rounded-2xl shadow-2xl"
        dir="rtl"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-[hsl(var(--border))]">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <Eye size={16} /> معاينة الفاتورة
          </h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="text-xs rounded-lg border border-[hsl(var(--primary))] bg-white px-3 py-1.5 text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/5 flex items-center gap-1"
            >
              <Printer size={12} /> طباعة
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="text-xs rounded-lg border border-[hsl(var(--border))] bg-white px-3 py-1.5 hover:bg-[hsl(var(--muted))]/40 flex items-center gap-1"
            >
              <Download size={12} /> تحميل
            </button>
            <button
              onClick={onClose}
              className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
              aria-label="إغلاق"
            >
              <X size={18} />
            </button>
          </div>
        </div>
        <iframe
          ref={iframeRef}
          srcDoc={html}
          title="معاينة الفاتورة"
          className="flex-1 w-full border-0"
        />
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
// Step 1
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
  productCards: ProductCard[];
  inventoryItems: InventoryItem[];
  showProductPicker: boolean;
  setShowProductPicker: (open: boolean) => void;
  chargeableReplacementValue: number;
  chargeablePriceDifference: number;
  onAddInventory: (card: ProductCard) => void;
  onAddMaintenance: () => void;
  onUpdateLine: (idx: number, patch: Partial<AdjustmentLine>) => void;
  onRemoveLine: (idx: number) => void;
}) {
  const {
    isExchange,
    isFullKind,
    returnRows,
    setReturnRows,
    returnedValue,
    replacementLines,
    productCards,
    inventoryItems,
    showProductPicker,
    setShowProductPicker,
    chargeableReplacementValue,
    chargeablePriceDifference,
    onAddInventory,
    onAddMaintenance,
    onUpdateLine,
    onRemoveLine,
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
          {returnRows.map((row, idx) => (
            <ReturnRowEditor
              key={`return-row-${idx}`}
              row={row}
              isFullKind={isFullKind}
              onChange={(patch) =>
                setReturnRows((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
              }
            />
          ))}
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
                onClick={() => setShowProductPicker(!showProductPicker)}
                className="text-xs flex items-center gap-1 rounded-lg border border-[hsl(var(--border))] px-2 py-1 hover:bg-[hsl(var(--muted))]/40"
              >
                <Plus size={12} /> إضافة منتج بديل (من المخزن)
              </button>
              <button
                type="button"
                onClick={onAddMaintenance}
                className="text-xs flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50/60 px-2 py-1 text-indigo-700 hover:bg-indigo-50"
              >
                <Wrench size={12} /> إضافة قطعة صيانة
              </button>
            </div>
          </div>

          {showProductPicker && (
            <InventoryProductPicker
              productCards={productCards}
              inventoryItems={inventoryItems}
              onPick={onAddInventory}
              onClose={() => setShowProductPicker(false)}
            />
          )}

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
                  onChange={(patch) => onUpdateLine(idx, patch)}
                  onRemove={() => onRemoveLine(idx)}
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

function ReturnRowEditor(props: {
  row: ReturnRow;
  isFullKind: boolean;
  onChange: (patch: Partial<ReturnRow>) => void;
}) {
  const { row, isFullKind, onChange } = props;
  const fullLineTotal = fullLineValue(row.line, row.qty);
  const partialClamped = Math.min(row.partialValue, fullLineTotal);
  const lineValue = row.valueMode === 'partial' ? partialClamped : fullLineTotal;
  return (
    <div
      className={`rounded-xl border p-3 ${
        row.selected
          ? 'border-[hsl(var(--border))] bg-white'
          : 'border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 opacity-70'
      }`}
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={row.selected}
          disabled={isFullKind}
          onChange={(e) => onChange({ selected: e.target.checked })}
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
            onClick={() => onChange({ qty: Math.max(1, row.qty - 1) })}
            aria-label="إنقاص"
          >
            <Minus size={12} className="mx-auto" />
          </button>
          <span className="w-8 text-center text-sm font-mono">{row.qty}</span>
          <button
            type="button"
            disabled={isFullKind || !row.selected || row.qty >= row.line.quantity}
            className="w-6 h-6 rounded-md border border-[hsl(var(--border))] text-xs disabled:opacity-40"
            onClick={() => onChange({ qty: Math.min(row.line.quantity, row.qty + 1) })}
            aria-label="زيادة"
          >
            <Plus size={12} className="mx-auto" />
          </button>
        </div>
        <div className="text-left text-sm font-mono font-bold w-[110px] flex-shrink-0">
          {fmtEgp(lineValue)}
        </div>
      </div>

      {row.selected && (
        <div className="mt-3 pt-2 border-t border-[hsl(var(--border))]/40 space-y-2">
          <div>
            <span className="text-[11px] text-[hsl(var(--muted-foreground))] block mb-1">
              نوع قيمة العنصر
            </span>
            <div className="flex bg-[hsl(var(--muted))]/40 rounded-lg p-0.5 text-[11px] w-fit">
              <button
                type="button"
                onClick={() => onChange({ valueMode: 'full' })}
                className={`px-2 py-0.5 rounded-md transition-colors ${
                  row.valueMode === 'full'
                    ? 'bg-white shadow-sm font-bold text-[hsl(var(--foreground))]'
                    : 'text-[hsl(var(--muted-foreground))]'
                }`}
              >
                قيمة المنتج كاملة
              </button>
              <button
                type="button"
                onClick={() => onChange({ valueMode: 'partial' })}
                className={`px-2 py-0.5 rounded-md transition-colors ${
                  row.valueMode === 'partial'
                    ? 'bg-white shadow-sm font-bold text-[hsl(var(--foreground))]'
                    : 'text-[hsl(var(--muted-foreground))]'
                }`}
              >
                قيمة جزئية / قطعة من المنتج
              </button>
            </div>
          </div>
          {row.valueMode === 'partial' && (
            <label className="flex items-center justify-between gap-2 text-xs">
              <span className="text-[hsl(var(--muted-foreground))]">
                قيمة الجزء المستبدل / المرتجع (ج.م)
              </span>
              <input
                type="number"
                min={0}
                step="0.01"
                max={fullLineTotal}
                value={row.partialValue}
                onChange={(e) =>
                  onChange({ partialValue: Math.max(0, Number(e.target.value) || 0) })
                }
                className="form-input text-sm w-32 font-mono"
                dir="ltr"
              />
            </label>
          )}
          {row.valueMode === 'partial' && row.partialValue > fullLineTotal && (
            <p className="text-[10px] text-rose-600">
              لا يمكن أن تتجاوز قيمة الجزء قيمة المنتج الأصلي ({fmtEgp(fullLineTotal)}).
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Replacement-line row (inventory product OR maintenance part)
// ─────────────────────────────────────────────────────────────────────────────

function ReplacementLineRow(props: {
  line: AdjustmentLine;
  idx: number;
  onChange: (patch: Partial<AdjustmentLine>) => void;
  onRemove: () => void;
}) {
  const { line, idx, onChange, onRemove } = props;
  const isPart = line.itemType === 'part';
  const subtotal = computeLineTotal(line);
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
          {!isPart && (
            <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
              {line.label || line.productType}
            </span>
          )}
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
        {isPart ? (
          <input
            type="text"
            value={line.label ?? ''}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder="اسم القطعة *"
            className="form-input text-sm col-span-2"
          />
        ) : (
          <input
            type="text"
            value={line.label ?? ''}
            disabled
            placeholder="اسم المنتج"
            className="form-input text-sm col-span-2 bg-slate-50 cursor-not-allowed"
          />
        )}
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
            سعر الوحدة (ج.م) {line.isFree ? '(مجاني)' : isPart ? '' : '(من المخزن)'}
          </span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={line.unitPrice}
            disabled={line.isFree || !isPart}
            onChange={(e) => onChange({ unitPrice: Math.max(0, Number(e.target.value) || 0) })}
            className="form-input text-sm disabled:opacity-60 disabled:bg-slate-50 disabled:cursor-not-allowed"
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
// Inventory product picker (replacement lines)
// ─────────────────────────────────────────────────────────────────────────────

function InventoryProductPicker(props: {
  productCards: ProductCard[];
  inventoryItems: InventoryItem[];
  onPick: (card: ProductCard) => void;
  onClose: () => void;
}) {
  const { productCards, inventoryItems, onPick, onClose } = props;
  if (productCards.length === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed border-[hsl(var(--border))] p-4 text-center text-xs text-[hsl(var(--muted-foreground))]">
        جارٍ تحميل قائمة المنتجات…
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20 p-3 mb-3">
      <div className="flex items-center justify-between mb-2">
        <h5 className="text-xs font-bold">اختر منتج بديل من المخزن</h5>
        <button
          type="button"
          onClick={onClose}
          className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
          aria-label="إغلاق"
        >
          <X size={14} />
        </button>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {productCards.map((card) => {
          const inv = card.isInventory
            ? (inventoryItems.find((i) => i.id === card.value) ?? null)
            : null;
          const outOfStock = (inv?.available ?? 1) <= 0;
          return (
            <button
              type="button"
              key={`pick-${card.value}`}
              onClick={() => onPick(card)}
              disabled={outOfStock}
              className={`relative w-full aspect-square rounded-xl border-2 flex flex-col items-center justify-center gap-1 overflow-hidden transition-all ${
                outOfStock
                  ? 'border-red-200 bg-red-50 opacity-50 cursor-not-allowed'
                  : 'border-[hsl(var(--border))] hover:border-[hsl(var(--primary))]/50 bg-white'
              }`}
            >
              <InventoryThumbnail
                src={card.image}
                alt={card.label}
                emoji={card.emoji}
                fill
                sizes="(max-width: 768px) 30vw, 120px"
                className="object-cover"
                emojiClassName="text-2xl"
              />
              {inv && (
                <div
                  className={`absolute top-1 right-1 px-1.5 py-0.5 rounded-full text-[8px] font-bold z-10 ${
                    inv.available > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                  }`}
                >
                  {inv.available} متاح
                </div>
              )}
              <span className="text-[10px] font-bold text-white bg-black/50 px-1 rounded absolute bottom-1 z-10">
                {card.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3 — settlement
// ─────────────────────────────────────────────────────────────────────────────

interface Step3Props {
  kind: AdjustmentKind;
  order: OrderSummary;
  activeAddress: ChildOrderShipAddress;
  addressMode: AddressMode;
  setAddressMode: (m: AddressMode) => void;
  newAddressRegion: string;
  setNewAddressRegion: (s: string) => void;
  newAddressDistrict: string;
  setNewAddressDistrict: (s: string) => void;
  newAddressNeighborhood: string;
  setNewAddressNeighborhood: (s: string) => void;
  newAddressLine: string;
  setNewAddressLine: (s: string) => void;
  hierarchicalRegions: ShippingGovernorate[];
  feeResolution: { fee: number; source: string; label: string };
  shippingPayer: ShippingPayer;
  setShippingPayer: (p: ShippingPayer) => void;
  shippingBaseAmount: number;
  customerShippingShare: number;
  companyShippingShare: number;
  returnedValue: number;
  replacementValue: number;
  priceDifferenceAbs: number;
  priceDirection: PriceDifferenceDirection;
  eligibleRefund: number;
  effectiveRefund: number;
  refundMode: RefundMode;
  setRefundMode: (m: RefundMode) => void;
  refundAmountInput: number;
  setRefundAmountInput: (n: number) => void;
  companyDeductionEnabled: boolean;
  setCompanyDeductionEnabled: (b: boolean) => void;
  companyDeductionAmount: number;
  setCompanyDeductionAmount: (n: number) => void;
  companyDeductionReason: string;
  setCompanyDeductionReason: (s: string) => void;
  companyDeduction: number;
  finalRefundToCustomer: number;
  finalAmountDueFromCustomer: number;
  previewChildOrderNum: string | null;
  operationalNote: string;
  setOperationalNote: (s: string) => void;
  onPreviewInvoice: () => void;
}

function Step3Summary(props: Step3Props) {
  const isExchange = props.kind === 'exchange_full' || props.kind === 'exchange_partial';
  return (
    <>
      {/* Address picker */}
      <AddressPicker
        order={props.order}
        addressMode={props.addressMode}
        setAddressMode={props.setAddressMode}
        newAddressRegion={props.newAddressRegion}
        setNewAddressRegion={props.setNewAddressRegion}
        newAddressDistrict={props.newAddressDistrict}
        setNewAddressDistrict={props.setNewAddressDistrict}
        newAddressNeighborhood={props.newAddressNeighborhood}
        setNewAddressNeighborhood={props.setNewAddressNeighborhood}
        newAddressLine={props.newAddressLine}
        setNewAddressLine={props.setNewAddressLine}
        hierarchicalRegions={props.hierarchicalRegions}
        activeAddress={props.activeAddress}
      />

      {/* Shipping */}
      <section className="card-section p-4">
        <h4 className="text-sm font-bold mb-2 flex items-center gap-1.5">
          <Truck size={14} /> الشحن للطلب الفرعي
        </h4>
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 p-3 text-xs space-y-1">
          <div className="flex justify-between items-center">
            <span className="text-[hsl(var(--muted-foreground))]">مصاريف الشحن</span>
            <span className="font-mono font-bold">{fmtEgp(props.shippingBaseAmount)}</span>
          </div>
          <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
            {props.feeResolution.source === 'none'
              ? 'لا يوجد سعر شحن مكوّن للمنطقة المحددة — راجع الإعدادات.'
              : `محسوبة تلقائيًا من إعدادات المنطقة (${props.feeResolution.label}).`}
          </p>
        </div>
        <div className="mt-3">
          <span className="block text-[11px] text-[hsl(var(--muted-foreground))] mb-1">
            من يتحمل الشحن؟
          </span>
          <div className="grid grid-cols-2 gap-2">
            <ShippingPayerButton
              active={props.shippingPayer === 'customer'}
              onClick={() => props.setShippingPayer('customer')}
              label="العميل"
              hint="يخصم من الاسترداد أو يضاف على التحصيل"
            />
            <ShippingPayerButton
              active={props.shippingPayer === 'company'}
              onClick={() => props.setShippingPayer('company')}
              label="الشركة"
              hint="الشحن = 0 على العميل"
            />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-white border border-[hsl(var(--border))] px-2 py-1.5">
              <span className="text-[hsl(var(--muted-foreground))] block text-[10px]">
                يتحمل العميل
              </span>
              <span className="font-mono font-bold">{fmtEgp(props.customerShippingShare)}</span>
            </div>
            <div className="rounded-lg bg-white border border-[hsl(var(--border))] px-2 py-1.5">
              <span className="text-[hsl(var(--muted-foreground))] block text-[10px]">
                تتحمل الشركة
              </span>
              <span className="font-mono font-bold">{fmtEgp(props.companyShippingShare)}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Refund mode (only meaningful when there's a refund possibility) */}
      {props.eligibleRefund > 0 && (
        <section className="card-section p-4">
          <h4 className="text-sm font-bold mb-2 flex items-center gap-1.5">
            <Wallet size={14} /> طريقة الاسترداد / التسوية المالية
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(['full', 'partial', 'none', 'price_diff'] as RefundMode[])
              .filter((m) => isExchange || m !== 'price_diff')
              .map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => props.setRefundMode(m)}
                  className={`text-xs rounded-xl border px-3 py-2 transition-colors ${
                    props.refundMode === m
                      ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5 text-[hsl(var(--primary))] font-semibold'
                      : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/40'
                  }`}
                >
                  {REFUND_MODE_LABEL_AR[m]}
                </button>
              ))}
          </div>
          {props.refundMode === 'partial' && (
            <label className="flex flex-col mt-2">
              <span className="text-[11px] text-[hsl(var(--muted-foreground))] mb-1">
                المبلغ المسترد للعميل (الحد الأقصى: {fmtEgp(props.eligibleRefund)})
              </span>
              <input
                type="number"
                min={0}
                max={props.eligibleRefund}
                step="0.01"
                value={props.refundAmountInput}
                onChange={(e) =>
                  props.setRefundAmountInput(Math.max(0, Number(e.target.value) || 0))
                }
                className="form-input text-sm font-mono"
                dir="ltr"
              />
            </label>
          )}
          {props.refundMode === 'none' && (
            <p className="text-[11px] text-amber-700 mt-2">
              العميل لن يسترد أي مبلغ. تأكد من اختيارك قبل المتابعة.
            </p>
          )}
        </section>
      )}

      {/* Company deduction */}
      {props.eligibleRefund > 0 && (
        <section className="card-section p-4">
          <label className="flex items-center gap-2 text-sm font-bold mb-2 cursor-pointer">
            <input
              type="checkbox"
              checked={props.companyDeductionEnabled}
              onChange={(e) => props.setCompanyDeductionEnabled(e.target.checked)}
            />
            استقطاع من مبلغ الاسترداد
          </label>
          {props.companyDeductionEnabled && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="flex flex-col">
                <span className="text-[11px] text-[hsl(var(--muted-foreground))] mb-1">
                  قيمة الاستقطاع (ج.م)
                </span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  max={props.eligibleRefund}
                  value={props.companyDeductionAmount}
                  onChange={(e) =>
                    props.setCompanyDeductionAmount(Math.max(0, Number(e.target.value) || 0))
                  }
                  className="form-input text-sm font-mono"
                  dir="ltr"
                />
              </label>
              <label className="flex flex-col">
                <span className="text-[11px] text-[hsl(var(--muted-foreground))] mb-1">
                  سبب الاستقطاع
                </span>
                <input
                  type="text"
                  value={props.companyDeductionReason}
                  onChange={(e) => props.setCompanyDeductionReason(e.target.value)}
                  placeholder="مثال: استخدام بسيط للمنتج"
                  className="form-input text-sm"
                />
              </label>
            </div>
          )}
        </section>
      )}

      {/* Settlement summary card */}
      <section className="card-section p-4">
        <h4 className="text-sm font-bold mb-3 flex items-center gap-1.5">
          <Wallet size={14} /> ملخص التسوية
        </h4>
        <div className="rounded-xl bg-[hsl(var(--muted))]/40 p-3 text-sm space-y-1.5">
          <SummaryRow label="قيمة العناصر المرتجعة/المستبدلة" value={fmtEgp(props.returnedValue)} />
          {isExchange && (
            <SummaryRow label="قيمة العناصر البديلة" value={fmtEgp(props.replacementValue)} />
          )}
          {props.priceDifferenceAbs > 0 && (
            <SummaryRow
              label={
                props.priceDirection === 'customer_pays'
                  ? 'فرق سعر على العميل'
                  : 'فرق سعر لصالح العميل'
              }
              value={fmtEgp(props.priceDifferenceAbs)}
              tone={props.priceDirection === 'customer_pays' ? 'amber' : 'emerald'}
            />
          )}
          <SummaryRow label="مصاريف الشحن" value={fmtEgp(props.shippingBaseAmount)} />
          <SummaryRow label="يتحمل العميل من الشحن" value={fmtEgp(props.customerShippingShare)} />
          <SummaryRow label="تتحمل الشركة من الشحن" value={fmtEgp(props.companyShippingShare)} />
          {props.companyDeduction > 0 && (
            <SummaryRow
              label="استقطاع من الاسترداد"
              value={fmtEgp(props.companyDeduction)}
              tone="amber"
            />
          )}
          <div className="border-t border-[hsl(var(--border))]/60 my-1" />
          {props.finalAmountDueFromCustomer > 0 ? (
            <SummaryRow
              label="الإجمالي المطلوب من العميل"
              value={fmtEgp(props.finalAmountDueFromCustomer)}
              emphasis
              tone="emerald"
            />
          ) : props.finalRefundToCustomer > 0 ? (
            <SummaryRow
              label="صافي المسترد للعميل"
              value={fmtEgp(props.finalRefundToCustomer)}
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
          <p>سيتم إنشاء طلب شحن مباشر يظهر في صفحة الطلبات للجدولة:</p>
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
              تفتح في نافذة منفصلة جاهزة للطباعة — أو داخل الصفحة لو منع المتصفح النوافذ المنبثقة.
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

// ─────────────────────────────────────────────────────────────────────────────
// Address picker
// ─────────────────────────────────────────────────────────────────────────────

function AddressPicker(props: {
  order: OrderSummary;
  addressMode: AddressMode;
  setAddressMode: (m: AddressMode) => void;
  newAddressRegion: string;
  setNewAddressRegion: (s: string) => void;
  newAddressDistrict: string;
  setNewAddressDistrict: (s: string) => void;
  newAddressNeighborhood: string;
  setNewAddressNeighborhood: (s: string) => void;
  newAddressLine: string;
  setNewAddressLine: (s: string) => void;
  hierarchicalRegions: ShippingGovernorate[];
  activeAddress: ChildOrderShipAddress;
}) {
  const sameLabel = addressLabelOf({
    region: props.order.region,
    district: props.order.district,
    neighborhood: props.order.neighborhood,
    address: props.order.address,
  });

  const selectedGov: ShippingGovernorate | null =
    props.hierarchicalRegions.find((g) => g.name === props.newAddressRegion) ?? null;
  // Top-level areas under the governorate. After
  // `normalizeCoverageHierarchy` the area entries are the ones
  // without a `parent` field (their nested neighborhoods live in
  // `.children`).
  const areas: ShippingDistrict[] = (selectedGov?.districts ?? []).filter(
    (d: ShippingDistrict) => !d.parent
  );
  const selectedArea: ShippingDistrict | null =
    areas.find((a: ShippingDistrict) => a.name === props.newAddressDistrict) ?? null;
  const neighborhoods: ShippingDistrict[] = selectedArea?.children ?? [];

  return (
    <section className="card-section p-4">
      <h4 className="text-sm font-bold mb-2 flex items-center gap-1.5">
        <MapPin size={14} /> عنوان الشحن
      </h4>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => props.setAddressMode('same')}
          className={`flex items-start gap-2 text-right rounded-xl border px-3 py-2 transition-colors ${
            props.addressMode === 'same'
              ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5 text-[hsl(var(--primary))]'
              : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/40'
          }`}
        >
          <Home size={14} className="mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold">نفس عنوان الطلب</p>
            <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-0.5 truncate">
              {sameLabel || 'غير محدد'}
            </p>
          </div>
        </button>
        <button
          type="button"
          onClick={() => props.setAddressMode('new')}
          className={`flex items-start gap-2 text-right rounded-xl border px-3 py-2 transition-colors ${
            props.addressMode === 'new'
              ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5 text-[hsl(var(--primary))]'
              : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/40'
          }`}
        >
          <Plus size={14} className="mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold">إضافة عنوان جديد</p>
            <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-0.5">
              يستخدم للطلب الفرعي ويُضاف للعميل تلقائيًا.
            </p>
          </div>
        </button>
      </div>

      {props.addressMode === 'new' && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="flex flex-col col-span-2 sm:col-span-1">
            <span className="text-[11px] text-[hsl(var(--muted-foreground))] mb-1">المحافظة *</span>
            <select
              value={props.newAddressRegion}
              onChange={(e) => {
                props.setNewAddressRegion(e.target.value);
                props.setNewAddressDistrict('');
                props.setNewAddressNeighborhood('');
              }}
              className="form-input text-sm"
            >
              <option value="">اختر المحافظة</option>
              {props.hierarchicalRegions.map((g) => (
                <option key={g.name} value={g.name}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col col-span-2 sm:col-span-1">
            <span className="text-[11px] text-[hsl(var(--muted-foreground))] mb-1">
              المنطقة / الحي
            </span>
            <select
              value={props.newAddressDistrict}
              onChange={(e) => {
                props.setNewAddressDistrict(e.target.value);
                props.setNewAddressNeighborhood('');
              }}
              disabled={!selectedGov}
              className="form-input text-sm disabled:opacity-50"
            >
              <option value="">اختر المنطقة</option>
              {areas.map((a) => (
                <option key={a.name} value={a.name}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          {neighborhoods.length > 0 && (
            <label className="flex flex-col col-span-2 sm:col-span-1">
              <span className="text-[11px] text-[hsl(var(--muted-foreground))] mb-1">
                القرية / الشياخة
              </span>
              <select
                value={props.newAddressNeighborhood}
                onChange={(e) => props.setNewAddressNeighborhood(e.target.value)}
                className="form-input text-sm"
              >
                <option value="">اختر القرية</option>
                {neighborhoods.map((n) => (
                  <option key={n.name} value={n.name}>
                    {n.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-col col-span-2">
            <span className="text-[11px] text-[hsl(var(--muted-foreground))] mb-1">
              العنوان التفصيلي *
            </span>
            <textarea
              rows={2}
              value={props.newAddressLine}
              onChange={(e) => props.setNewAddressLine(e.target.value)}
              placeholder="مثال: شارع ٩، الدور ٢، شقة ٣"
              className="form-input text-sm"
            />
          </label>
        </div>
      )}
    </section>
  );
}
