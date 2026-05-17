// ─────────────────────────────────────────────────────────────────────────────
// src/app/orders-management/components/EditOrderModal.tsx
//
// Phase Orders-Edit-1 — focused edit surface for an existing order.
// Phase Orders-Edit-2 — expanded to allow full line-item edits.
//
// Editable here:
//   • customer identity: name, phone, phone2
//   • address: region, district, neighborhood, address
//   • shipping flags: free_shipping, express_shipping
//   • per-line: quantity, color, product (via swap dropdown),
//     flashlight add-on, AND adding / removing lines. Last line
//     cannot be deleted (Order with zero products has no meaning;
//     status change is the cancel path). Stock checks fire on
//     swap / add via OrderLinesEditor matching AddOrderModal.
//     Price is read-only from inventory; swapping uses the
//     current inventory price.
//   • preview + installation: preview_mode, installation_target,
//     installation_payer
//   • discount: enabled + type (fixed / percent) + value + reason
//   • payment: status + paid_amount + paid_to + method
//
// NOT editable here (intentionally):
//   • unit price (driven by inventory / settings)
//   • extra_shipping_fee (deprecated by Phase Orders-Checkout-1)
//   • order_num, tracking_token, created_by, created_at, status,
//     delegate, audit / auth metadata
//
// Save flow
// ---------
//   1. Validate the form locally (mirrors AddOrderModal's rules).
//   2. Refetch the live row from `turath_masr_orders` so we diff
//      against the most recent server state — not a stale snapshot
//      the parent loaded minutes ago.
//   3. Recompute subtotal + total + new checkout envelope.
//   4. Update the row atomically (single `.update()`).
//   5. Diff before vs after via `orderChangeDiff` (small payload —
//      no full jsonb, no images, no tokens).
//   6. Emit per-order audit rows (`addAuditLog`, one per changed
//      field) so the existing AuditLogModal timeline shows the
//      edit; PLUS a single staff-wide `order.updated` row with a
//      compact metadata bundle.
//   7. Call `onSaved(updatedOrder)` so the parent refreshes its
//      `liveOrder` without a full list reload.
// ─────────────────────────────────────────────────────────────────────────────
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Edit2, Save, Wallet, Wrench, X } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { writeStaffAuditLog } from '@/lib/security/staffAudit';
import { syncCustomerFromOrder } from '@/lib/crm/syncCustomerFromOrder';
import {
  appendCheckoutDetailsToNotes,
  parseCheckoutDetailsFromNotes,
  PAYMENT_METHOD_OPTIONS,
  type CheckoutDetails,
  type DiscountType,
  type InstallationPayer,
  type InstallationTarget,
  type PaymentStatus,
  type PreviewMode,
} from '@/lib/orders/checkoutDetails';
import {
  buildArabicDescription,
  buildStaffAuditMetadata,
  diffOrders,
  type OrderSnapshot,
  type OrderSnapshotLine,
} from '@/lib/orders/orderChangeDiff';
// Phase Inventory-Reservations-1C — reconcile reservations after a
// successful order edit. Helpers normalise the lines payload and
// gate by status so the Delivery-Fulfillment phase keeps full
// ownership of post-delivery stock effects.
import {
  buildReservationLinesFromOrderLines,
  hasInventoryBackedLines,
  isDeliveredStatus,
} from '@/lib/inventory/orderReservationClient';
// Phase Orders-Edit-2 — shared product catalog + line editor.
// Lifts the AddOrderModal's product-grid block into a reusable
// surface so EditOrderModal supports color / swap / add / delete
// without copy-pasting ~300 lines of JSX.
import {
  lineSubtotal,
  loadProductCards,
  resolveLineColors,
  type DraftOrderLine,
  type InventoryItem,
  type ProductCard,
} from '@/lib/orders/productCards';
import OrderLinesEditor from './OrderLinesEditor';
import AddressCoveragePicker, {
  type AddressCoverageStatus,
  type AddressCoverageValue,
} from './AddressCoveragePicker';
import { addAuditLog } from './AuditLogModal';

// Re-exported from OrderDetailModal; copying the shape here keeps
// this component a leaf module (no circular imports). The parent
// hands us this object via the `order` prop.
interface EditableOrder {
  id: string;
  orderNum: string;
  trackingToken?: string | null;
  customer: string;
  phone: string;
  phone2?: string;
  region: string;
  district?: string;
  neighborhood?: string | null;
  address: string;
  products: string;
  quantity: number;
  subtotal: number;
  shippingFee: number;
  extraShippingFee?: number;
  expressShipping?: boolean;
  total: number;
  status: string;
  notes?: string;
  // Phase Orders-Admin-Actions-1 — optional signals the parent may
  // forward so the address-lock helper can run at render time. Both
  // are also re-checked from the live row inside handleSave so the
  // handler can't be bypassed via stale props.
  delegateName?: string | null;
  scheduledDeliveryDate?: string | null;
  lines?: Array<{
    productType?: string;
    label?: string;
    color?: string | null;
    quantity: number;
    unitPrice: number;
    includeFlashlight?: boolean;
    flashlightPrice?: number;
    total: number;
  }>;
}

// Phase Orders-Admin-Actions-1 — once the order has had any operational
// handling, the shipping address must not be edited. The signals here
// are deliberately conservative: only orders that are strictly `new`
// AND have neither a delegate nor a scheduled delivery date are
// editable. The same helper runs against the live DB row inside the
// save handler so a stale prop can't be the bypass route.
function hasOperationalActivity(o: {
  status?: string | null;
  delegate_name?: string | null;
  delegateName?: string | null;
  assigned_to?: string | null;
  scheduled_delivery_date?: string | null;
  scheduledDeliveryDate?: string | null;
}): boolean {
  // Phase Orders-Admin-Actions-1-Fix — fail-closed. Anything that
  // isn't an explicit `'new'` (including empty / null / undefined
  // from a partial prop or a brief mount-race window before the
  // parent's DB refetch lands) counts as activity and locks the
  // address. The original `s && s !== 'new'` returned false for
  // empty s, leaving the picker editable on a delivered order
  // whose `liveOrder.status` had not yet been populated.
  const s = (o.status ?? '').trim().toLowerCase();
  if (s !== 'new') return true;
  const dn = (o.delegate_name ?? o.delegateName ?? '').toString().trim();
  if (dn) return true;
  const at = (o.assigned_to ?? '').toString().trim();
  if (at) return true;
  const sd = (o.scheduled_delivery_date ?? o.scheduledDeliveryDate ?? '').toString().trim();
  if (sd) return true;
  return false;
}

interface EditOrderModalProps {
  order: EditableOrder;
  onClose: () => void;
  /** Called with the freshly-persisted order after save success.
   *  Parent should update its `liveOrder` state from this. */
  onSaved: (updated: EditableOrder) => void;
}

// Phase Orders-Edit-2 — derive DraftOrderLine[] (the shared shape
// from `productCards.ts`) from the persisted lines JSONB. We
// preserve image metadata so a color-only edit later doesn't drop
// the Phase Egress-Fix1 image_source / image_path placement on the
// row.
function buildInitialLines(order: EditableOrder): DraftOrderLine[] {
  const lines = Array.isArray(order.lines) ? (order.lines as Array<Record<string, unknown>>) : [];
  let idCounter = 0;
  return lines.map((l) => {
    idCounter += 1;
    const productType = typeof l.productType === 'string' ? l.productType : '';
    // Phase Inventory-Order-Identity-1 — carry existing identity
    // forward into the draft. If the row has no explicit
    // `inventory_id` but `productType` happens to be a UUID
    // (legacy pre-Phase-1 inventory linkage) treat that as the
    // identity so the edit save can persist it explicitly.
    const explicitInventoryId =
      typeof l.inventory_id === 'string' && l.inventory_id.trim() ? l.inventory_id.trim() : null;
    const productTypeAsUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productType)
        ? productType
        : null;
    const inferredInventoryId = explicitInventoryId ?? productTypeAsUuid;
    const explicitSku = typeof l.sku === 'string' && l.sku.trim() ? l.sku.trim() : null;
    // Phase Inventory-Variants-1B2 — carry variant identity forward
    // when present on the persisted row. Old orders without
    // `variant_id` simply leave the draft fields null and continue
    // operating at the base product level.
    const explicitVariantId =
      typeof l.variant_id === 'string' && l.variant_id.trim() ? l.variant_id.trim() : null;
    const explicitVariantLabel =
      explicitVariantId && typeof l.variant_label === 'string' && l.variant_label.trim()
        ? l.variant_label.trim()
        : null;
    const explicitVariantSku =
      explicitVariantId && typeof l.variant_sku === 'string' && l.variant_sku.trim()
        ? l.variant_sku.trim()
        : null;
    return {
      id: `existing-${idCounter}-${productType}`,
      productType,
      color: typeof l.color === 'string' ? l.color : '',
      quantity: Math.max(1, Number(l.quantity) || 1),
      unitPrice: Math.max(0, Number(l.unitPrice) || 0),
      includeFlashlight: l.includeFlashlight === true,
      flashlightPrice: Math.max(0, Number(l.flashlightPrice) || 150),
      label: typeof l.label === 'string' ? l.label : undefined,
      emoji: typeof l.emoji === 'string' ? l.emoji : undefined,
      image: typeof l.image === 'string' ? l.image : undefined,
      image_source:
        l.image_source === 'inventory' || l.image_source === 'storage' || l.image_source === 'none'
          ? (l.image_source as 'inventory' | 'storage' | 'none')
          : undefined,
      image_path: typeof l.image_path === 'string' ? l.image_path : undefined,
      inventory_id: inferredInventoryId,
      sku: inferredInventoryId ? explicitSku : null,
      variant_id: explicitVariantId,
      variant_label: explicitVariantLabel,
      variant_sku: explicitVariantSku,
    };
  });
}

function snapshotOrder(order: EditableOrder, parsed: CheckoutDetails | null): OrderSnapshot {
  const lines: OrderSnapshotLine[] = Array.isArray(order.lines)
    ? order.lines.map((l) => ({
        productType: l.productType ?? null,
        label: l.label ?? null,
        color: l.color ?? null,
        quantity: Number(l.quantity) || 0,
        unitPrice: Number(l.unitPrice) || 0,
        total: Number(l.total) || 0,
      }))
    : [];
  return {
    customer: order.customer,
    phone: order.phone,
    phone2: order.phone2 ?? null,
    region: order.region,
    district: order.district ?? null,
    neighborhood: order.neighborhood ?? null,
    address: order.address,
    freeShipping: parsed?.totals ? parsed.totals.shipping === 0 : order.shippingFee === 0,
    expressShipping: order.expressShipping === true,
    subtotal: order.subtotal,
    shippingFee: order.shippingFee,
    total: order.total,
    lines,
    checkoutDetails: parsed,
  };
}

export default function EditOrderModal({ order, onClose, onSaved }: EditOrderModalProps) {
  const { user, profileFullName, currentRoleId } = useAuth();
  const perms = usePermissions();
  const canEdit = perms.isAdmin || perms.can('edit_orders');

  const initialCheckout = useMemo(
    () => parseCheckoutDetailsFromNotes(order.notes ?? null),
    [order.notes]
  );

  const [customerName, setCustomerName] = useState(order.customer || '');
  const [phone, setPhone] = useState(order.phone || '');
  const [phone2, setPhone2] = useState(order.phone2 || '');

  // Phase Orders-Edit-Address-Shipping-1 — single source of truth
  // for the address cascade. Mirrors the four legacy state vars
  // (region / district / neighborhood / address) but lives behind
  // the new `<AddressCoveragePicker>` so the cascade can be filtered
  // against the active coverage hierarchy + drive shipping fee
  // recalculation. The four DB columns
  // (region, district, neighborhood, address) are still persisted
  // separately; only the React state is consolidated.
  const [addressValue, setAddressValue] = useState<AddressCoverageValue>({
    governorate: order.region || '',
    area: order.district || '',
    neighborhood: order.neighborhood ?? '',
    detailedAddress: order.address || '',
  });
  const [coverageStatus, setCoverageStatus] = useState<AddressCoverageStatus>({
    covered: false,
    reason: 'no_governorate',
    fee: null,
    legacyMismatch: false,
    ready: false,
  });
  // Phase Orders-Admin-Actions-1 — address can only be edited while the
  // order is strictly `new` AND has no delegate / no scheduled delivery.
  // Computed from the prop (best-effort for the UI disabled state); the
  // load-bearing check lives inside handleSave against the live DB row.
  const addressLocked = hasOperationalActivity(order);

  const [freeShipping, setFreeShipping] = useState(order.shippingFee === 0);
  const [expressShipping, setExpressShipping] = useState(order.expressShipping === true);

  const [lines, setLines] = useState<DraftOrderLine[]>(() => buildInitialLines(order));
  // Phase Orders-Edit-2 — live product catalog loaded once when the
  // modal opens. `productCards` drives the OrderLinesEditor's grid;
  // `inventoryItems` powers the stock checks. Both stay null until
  // the load resolves; the editor handles the "loading..." state
  // itself when `productCards.length === 0`.
  const [productCards, setProductCards] = useState<ProductCard[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);

  const [previewMode, setPreviewMode] = useState<PreviewMode>(
    initialCheckout?.preview_mode ?? 'none'
  );
  const [installationTarget, setInstallationTarget] = useState<InstallationTarget>(
    initialCheckout?.installation?.target ?? null
  );
  const [installationPayer, setInstallationPayer] = useState<InstallationPayer>(
    (initialCheckout?.installation?.payer as InstallationPayer | null) ?? 'customer'
  );

  const [discountEnabled, setDiscountEnabled] = useState(
    !!initialCheckout?.discount?.enabled || (initialCheckout?.discount?.amount ?? 0) > 0
  );
  const [discountType, setDiscountType] = useState<DiscountType>(
    initialCheckout?.discount?.type === 'percent' ? 'percent' : 'fixed'
  );
  const [discountValue, setDiscountValue] = useState<number>(
    Number(initialCheckout?.discount?.value ?? initialCheckout?.discount?.amount ?? 0)
  );
  const [discountReason, setDiscountReason] = useState<string>(
    initialCheckout?.discount?.reason ?? ''
  );
  const [discountBy, setDiscountBy] = useState<string>(initialCheckout?.discount?.by ?? '');

  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>(
    initialCheckout?.payment?.status ?? 'unpaid'
  );
  const [paidAmount, setPaidAmount] = useState<number>(
    Number(initialCheckout?.payment?.paid_amount ?? 0)
  );
  const [paidTo, setPaidTo] = useState<string>(initialCheckout?.payment?.paid_to ?? '');
  const [paymentMethod, setPaymentMethod] = useState<string>(
    initialCheckout?.payment?.method ?? ''
  );

  const [submitting, setSubmitting] = useState(false);

  // Default the "discount_by" label to the operator running the
  // edit once the auth context resolves, but only when the field is
  // empty AND the section is being newly enabled (don't clobber the
  // original creator's label on an existing discount).
  useEffect(() => {
    if (!discountEnabled) return;
    setDiscountBy((curr) => (curr.trim() ? curr : (profileFullName ?? user?.email ?? '')));
  }, [discountEnabled, profileFullName, user?.email]);

  // Phase Orders-Edit-2 — load the product catalog once when the
  // modal opens. Powers the OrderLinesEditor's clickable grid and
  // the per-line swap dropdown. Inventory drives stock checks; the
  // static fallback (when no inventory rows exist) preserves the
  // legacy AddOrderModal UX.
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
        console.warn('[edit-order] failed to load product catalog:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── Recompute totals ──────────────────────────────────────────────────

  const subtotal = useMemo(() => lines.reduce((acc, l) => acc + lineSubtotal(l), 0), [lines]);
  // Phase Orders-Edit-Address-Shipping-1 — shipping fee is now
  // driven by the coverage picker's status. Priority order:
  //   1. `freeShipping` toggle → 0 (explicit override).
  //   2. Coverage status not yet ready (regions still loading) →
  //      preserve the saved `order.shippingFee` so the totals card
  //      doesn't flash to 0 while the network call lands.
  //   3. Coverage resolved → use the picker's resolved fee.
  //      The resolver already handles the
  //      neighborhood → area → governorate inheritance; `source ===
  //      'none'` means "no fee configured" and produces fee=0.
  // Save-time validation rejects an `'none'`-source fee when the
  // address actually changed (see handleSave).
  const savedShippingFee = Number(order.shippingFee) || 0;
  const resolvedShippingFee = coverageStatus.fee?.fee ?? null;
  const shippingFee = freeShipping
    ? 0
    : resolvedShippingFee !== null
      ? resolvedShippingFee
      : savedShippingFee;
  const shippingFeeDelta = shippingFee - savedShippingFee;
  const holderQuantity = useMemo(
    () =>
      lines.reduce(
        (sum, l) =>
          // Use the same productType-based heuristic as AddOrderModal.
          (l.productType || '').toLowerCase().includes('holder')
            ? sum + (Number(l.quantity) || 0)
            : sum,
        0
      ),
    [lines]
  );
  const installationCharge =
    previewMode === 'preview_with_installation' &&
    installationTarget === 'customer' &&
    installationPayer === 'customer'
      ? holderQuantity * 20 // HOLDER_INSTALLATION_UNIT_PRICE
      : 0;
  const grossTotal = subtotal + shippingFee + installationCharge;

  const normalizedDiscountValue = Math.max(0, Number(discountValue) || 0);
  const rawDiscountAmount = !discountEnabled
    ? 0
    : discountType === 'percent'
      ? Math.round((grossTotal * Math.min(normalizedDiscountValue, 100)) / 100)
      : normalizedDiscountValue;
  const appliedDiscount = Math.min(rawDiscountAmount, grossTotal);
  const grandTotal = Math.max(0, grossTotal - appliedDiscount);
  const effectivePaidAmount =
    paymentStatus === 'unpaid'
      ? 0
      : paymentStatus === 'paid'
        ? grandTotal
        : Math.max(0, Number(paidAmount) || 0);
  const remainingAmount = Math.max(0, grandTotal - effectivePaidAmount);

  // ─── Validations ───────────────────────────────────────────────────────

  const addressChanged =
    addressValue.governorate.trim() !== (order.region || '').trim() ||
    addressValue.area.trim() !== (order.district || '').trim() ||
    addressValue.neighborhood.trim() !== ((order.neighborhood ?? '') as string).trim() ||
    addressValue.detailedAddress.trim() !== (order.address || '').trim();

  const validate = (): string | null => {
    if (!customerName.trim()) return 'اسم العميل مطلوب';
    if (!phone.trim() || phone.trim().length < 7) return 'رقم الهاتف غير صالح';
    if (!addressValue.governorate.trim()) return 'المحافظة مطلوبة';
    if (!addressValue.detailedAddress.trim() || addressValue.detailedAddress.trim().length < 5)
      return 'العنوان قصير جدًا';
    // Phase Orders-Edit-Address-Shipping-1 — when the operator
    // changed the address path, the new selection MUST resolve to
    // active coverage. Untouched legacy addresses (the operator
    // didn't open the picker) can save without a coverage check so
    // pre-existing orders keep editing for non-address fields.
    if (addressChanged && coverageStatus.ready && !coverageStatus.covered && !freeShipping) {
      return 'لا يمكن حفظ الطلب لأن منطقة الشحن غير مفعّلة أو لا يوجد لها سعر شحن.';
    }
    // Even if address path is OK, refuse to save when the resolver
    // returns `source === 'none'` (i.e. no fee configured anywhere
    // up the chain). Free shipping bypasses this guard.
    if (
      addressChanged &&
      coverageStatus.ready &&
      coverageStatus.fee?.source === 'none' &&
      !freeShipping
    ) {
      return 'لا يمكن حفظ الطلب لأن منطقة الشحن غير مفعّلة أو لا يوجد لها سعر شحن.';
    }
    if (lines.length === 0) return 'يجب أن يحتوي الطلب على منتج واحد على الأقل';
    for (const l of lines) {
      if ((Number(l.quantity) || 0) <= 0) return 'كمية كل منتج يجب أن تكون 1 على الأقل';
      // Phase Orders-Edit-2 — when the line's product card carries
      // a colour palette (static holder OR an inventory row with
      // colours), the operator must pick one. Products without a
      // colour picker stay valid with an empty `color`.
      const card = productCards.find((p) => p.value === l.productType) ?? null;
      if (card && resolveLineColors(card).length > 0 && !(l.color || '').trim()) {
        return `اختر لون لكل ${card.label}`;
      }
    }
    if (discountEnabled) {
      if (discountType === 'percent') {
        if (normalizedDiscountValue <= 0 || normalizedDiscountValue > 100)
          return 'نسبة الخصم يجب أن تكون بين 1% و 100%.';
      } else {
        if (normalizedDiscountValue <= 0) return 'قيمة الخصم يجب أن تكون أكبر من صفر.';
        if (normalizedDiscountValue > grossTotal) return 'قيمة الخصم لا يمكن أن تتجاوز الإجمالي.';
      }
      if (!discountReason.trim()) return 'برجاء إدخال سبب الخصم.';
    }
    if (paymentStatus !== 'unpaid') {
      if (!paidTo.trim()) return 'برجاء تحديد المدفوع له.';
      if (!paymentMethod.trim()) return 'برجاء تحديد وسيلة الدفع.';
    }
    if (
      paymentStatus === 'partial' &&
      (effectivePaidAmount <= 0 || effectivePaidAmount >= grandTotal)
    )
      return 'برجاء إدخال مبلغ مدفوع جزئي صحيح.';
    return null;
  };

  // ─── Save ──────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!canEdit) {
      toast.error('ليس لديك صلاحية تعديل الطلب');
      return;
    }
    const validationError = validate();
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setSubmitting(true);
    try {
      const supabase = createClient();
      if (!supabase) {
        toast.error('تعذر الاتصال بقاعدة البيانات');
        return;
      }

      // Refetch live row so the diff is against current server state.
      // Phase Orders-Admin-Actions-1 — also pull `delegate_name`,
      // `assigned_to`, and `scheduled_delivery_date` so the
      // address-lock guard below can run against fresh DB state.
      const { data: liveRow, error: fetchErr } = await supabase
        .from('turath_masr_orders')
        .select(
          'id, order_num, customer, phone, phone2, region, district, neighborhood, address, products, quantity, subtotal, shipping_fee, extra_shipping_fee, total, status, notes, lines, delegate_name, assigned_to, scheduled_delivery_date'
        )
        .eq('id', order.id)
        .single();
      if (fetchErr || !liveRow) {
        console.error('[edit-order] fetch failed:', fetchErr);
        toast.error('تعذر قراءة بيانات الطلب الحالية. حاول مرة أخرى.');
        return;
      }

      // Phase Orders-Admin-Actions-1 — address-lock guard. If the
      // operator changed any address field AND the live row shows the
      // order has had operational handling, refuse the save with the
      // same Arabic message shown under the disabled picker. Non-
      // address edits (notes, lines, prices, etc.) continue to flow
      // through if the address remains identical to the live row.
      const liveAddressChanged =
        addressValue.governorate !== (liveRow.region ?? '') ||
        addressValue.area !== (liveRow.district ?? '') ||
        addressValue.neighborhood !== (liveRow.neighborhood ?? '') ||
        addressValue.detailedAddress !== (liveRow.address ?? '');
      if (liveAddressChanged && hasOperationalActivity(liveRow)) {
        toast.error('لا يمكن تعديل العنوان بعد بدء التعامل على الطلب.');
        return;
      }

      const liveCheckout = parseCheckoutDetailsFromNotes(liveRow.notes ?? null);
      const beforeSnapshot: OrderSnapshot = snapshotOrder(
        {
          id: liveRow.id,
          orderNum: liveRow.order_num,
          customer: liveRow.customer,
          phone: liveRow.phone,
          phone2: liveRow.phone2,
          region: liveRow.region,
          district: liveRow.district,
          neighborhood: liveRow.neighborhood,
          address: liveRow.address,
          products: liveRow.products,
          quantity: liveRow.quantity,
          subtotal: Number(liveRow.subtotal) || 0,
          shippingFee: Number(liveRow.shipping_fee) || 0,
          extraShippingFee: Number(liveRow.extra_shipping_fee) || 0,
          total: Number(liveRow.total) || 0,
          status: liveRow.status,
          notes: liveRow.notes,
          lines: liveRow.lines,
        } as EditableOrder,
        liveCheckout
      );

      // Phase Orders-Edit-2 — rebuild lines from the editable
      // DraftOrderLine[] state. For each draft line:
      //   • If it points at an existing live row (id pattern
      //     `existing-N-…`) AND the productType is unchanged, carry
      //     the live row's image / image_source / image_path / note
      //     forward so a color- or quantity-only edit doesn't drop
      //     Phase Egress-Fix1 image placement.
      //   • If the line was swapped to a different product OR is a
      //     newly-added line, drop the carry-over image metadata.
      //     The new line resolves its image from the live productCard
      //     thumbnail at render time.
      const liveLines = Array.isArray(liveRow.lines)
        ? (liveRow.lines as Array<Record<string, unknown>>)
        : [];
      const existingIdxMatch = /^existing-(\d+)-/;
      const newLines: Record<string, unknown>[] = lines.map((draft) => {
        const m = existingIdxMatch.exec(draft.id);
        const liveIdx = m ? Number(m[1]) - 1 : -1;
        const liveSource = liveIdx >= 0 ? liveLines[liveIdx] : null;
        const liveProductType =
          liveSource && typeof liveSource.productType === 'string' ? liveSource.productType : '';
        const sameProduct = !!liveSource && liveProductType === draft.productType;
        const qty = Math.max(1, Number(draft.quantity) || 1);
        const unitPrice = Math.max(0, Number(draft.unitPrice) || 0);
        const flashlightPrice = Math.max(0, Number(draft.flashlightPrice) || 0);
        const perUnit = unitPrice + (draft.includeFlashlight ? flashlightPrice : 0);
        const payload: Record<string, unknown> = {
          productType: draft.productType,
          label: draft.label ?? '',
          color: (draft.color ?? '').trim(),
          quantity: qty,
          unitPrice,
          includeFlashlight: draft.includeFlashlight,
          flashlightPrice,
          emoji: draft.emoji ?? '',
          total: perUnit * qty,
        };
        if (sameProduct && liveSource) {
          if ('image' in liveSource) payload.image = liveSource.image;
          if ('image_source' in liveSource) payload.image_source = liveSource.image_source;
          if ('image_path' in liveSource) payload.image_path = liveSource.image_path;
          if ('note' in liveSource) payload.note = liveSource.note;
        } else {
          // New product on this row — either a brand-new line or a
          // swap. Use whatever the draft already carries (which the
          // OrderLinesEditor cleared on swap so we don't ship stale
          // inventory thumbnails for the wrong product).
          if (draft.image !== undefined) payload.image = draft.image;
          if (draft.image_source) payload.image_source = draft.image_source;
          if (draft.image_path) payload.image_path = draft.image_path;
        }
        // Phase Inventory-Order-Identity-1 — persist `inventory_id` +
        // `sku` so future stock / reservation phases have a stable
        // handle. Precedence:
        //   1. The draft's own identity (set by createDraftLine when
        //      the user added or swapped a card).
        //   2. For same-product edits, carry the live row's identity.
        //   3. Legacy fallback: when `productType` is a raw UUID
        //      (the pre-Phase-1 inventory linkage), treat it as the
        //      inventory id.
        const draftInventoryId =
          typeof draft.inventory_id === 'string' && draft.inventory_id.trim()
            ? draft.inventory_id.trim()
            : null;
        const liveInventoryId =
          sameProduct && liveSource && typeof liveSource.inventory_id === 'string'
            ? (liveSource.inventory_id as string).trim() || null
            : null;
        const productTypeAsUuid = (() => {
          const pt = (draft.productType ?? '').trim();
          return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pt)
            ? pt
            : null;
        })();
        const resolvedInventoryId = draftInventoryId ?? liveInventoryId ?? productTypeAsUuid;
        const draftSku =
          typeof draft.sku === 'string' && draft.sku.trim() ? draft.sku.trim() : null;
        const liveSku =
          sameProduct && liveSource && typeof liveSource.sku === 'string'
            ? (liveSource.sku as string).trim() || null
            : null;
        payload.inventory_id = resolvedInventoryId;
        payload.sku = resolvedInventoryId ? (draftSku ?? liveSku) : null;
        // Phase Inventory-Variants-1B2 — persist variant identity.
        // Precedence:
        //   1. The draft's own variant_id (set by OrderLinesEditor's
        //      color-change / swap handlers + initial hydration).
        //   2. For same-product edits, the live row's variant_id —
        //      preserves variant identity on color-only edits where
        //      OrderLinesEditor's onChange path didn't re-resolve.
        //   3. Otherwise null (line falls back to base inventory).
        const draftVariantId =
          typeof draft.variant_id === 'string' && draft.variant_id.trim()
            ? draft.variant_id.trim()
            : null;
        const liveVariantId =
          sameProduct && liveSource && typeof liveSource.variant_id === 'string'
            ? (liveSource.variant_id as string).trim() || null
            : null;
        const resolvedVariantId = draftVariantId ?? liveVariantId;
        const draftVariantLabel =
          typeof draft.variant_label === 'string' && draft.variant_label.trim()
            ? draft.variant_label.trim()
            : null;
        const liveVariantLabel =
          sameProduct && liveSource && typeof liveSource.variant_label === 'string'
            ? (liveSource.variant_label as string).trim() || null
            : null;
        const draftVariantSku =
          typeof draft.variant_sku === 'string' && draft.variant_sku.trim()
            ? draft.variant_sku.trim()
            : null;
        const liveVariantSku =
          sameProduct && liveSource && typeof liveSource.variant_sku === 'string'
            ? (liveSource.variant_sku as string).trim() || null
            : null;
        payload.variant_id = resolvedVariantId;
        payload.variant_label = resolvedVariantId ? (draftVariantLabel ?? liveVariantLabel) : null;
        payload.variant_sku = resolvedVariantId ? (draftVariantSku ?? liveVariantSku) : null;
        return payload;
      });
      const newSubtotal = newLines.reduce(
        (acc, l) => acc + (Number((l as { total?: number }).total) || 0),
        0
      );
      const newQuantity = newLines.reduce(
        (acc, l) => acc + (Number((l as { quantity?: number }).quantity) || 0),
        0
      );
      // Phase Orders-Edit-2 — recompute the row's products summary
      // string to match AddOrderModal's format so the orders list +
      // search results reflect the post-edit basket. Without this
      // the column would still show the pre-edit basket and split
      // from the persisted `lines` jsonb.
      const newProductsSummary =
        lines
          .map((l) => {
            const card = productCards.find((p) => p.value === l.productType) ?? null;
            const label = card?.label || l.label || l.productType || 'منتج';
            const colorPart = l.color ? ` ${l.color}` : '';
            const flashPart = l.includeFlashlight ? ' + كشاف' : '';
            const qty = Math.max(1, Number(l.quantity) || 1);
            return `${label}${colorPart}${flashPart} x ${qty}`;
          })
          .join(' + ') || 'لا يوجد منتجات';

      const checkoutDetails: CheckoutDetails = {
        version: 1,
        preview_mode: previewMode,
        installation: {
          enabled: previewMode === 'preview_with_installation',
          target: previewMode === 'preview_with_installation' ? installationTarget : null,
          payer:
            previewMode === 'preview_with_installation' && installationTarget === 'customer'
              ? installationPayer
              : null,
          unit_price: 20,
          holder_quantity: holderQuantity,
          customer_charge: installationCharge,
        },
        discount: {
          enabled: discountEnabled && appliedDiscount > 0,
          type: discountType,
          value: discountEnabled ? normalizedDiscountValue : 0,
          amount: appliedDiscount,
          reason: discountReason.trim() || null,
          by: discountBy.trim() || null,
          by_user_id: user?.id ?? null,
        },
        payment: {
          status: paymentStatus,
          paid_amount: effectivePaidAmount,
          paid_to: paymentStatus === 'unpaid' ? null : paidTo.trim() || null,
          method: paymentStatus === 'unpaid' ? null : paymentMethod.trim() || null,
          remaining_amount: remainingAmount,
        },
        totals: {
          products_subtotal: newSubtotal,
          shipping: shippingFee,
          installation_customer_charge: installationCharge,
          gross_total: newSubtotal + shippingFee + installationCharge,
          discount: appliedDiscount,
          final_total: Math.max(
            0,
            newSubtotal + shippingFee + installationCharge - appliedDiscount
          ),
        },
      };
      const newNotes = appendCheckoutDetailsToNotes(liveRow.notes ?? '', checkoutDetails);

      const newTotal = checkoutDetails.totals.final_total;

      const updatePayload: Record<string, unknown> = {
        customer: customerName.trim(),
        phone: phone.trim(),
        phone2: phone2.trim() || null,
        // Phase Orders-Edit-Address-Shipping-1 — write the cascade
        // fields from the picker's value. Each of the four DB
        // columns stays distinct (no schema change); only the
        // React-side source has consolidated.
        region: addressValue.governorate.trim(),
        district: addressValue.area.trim() || null,
        neighborhood: addressValue.neighborhood.trim() || null,
        address: addressValue.detailedAddress.trim(),
        free_shipping: freeShipping,
        // Preserve the express-shipping flag — we don't have a UI
        // for editing it here; this carries forward the original
        // value. `shipping_fee` is now recomputed from the picker's
        // resolved fee (see derivation above).
        shipping_fee: shippingFee,
        lines: newLines,
        products: newProductsSummary,
        subtotal: newSubtotal,
        quantity: newQuantity,
        total: newTotal,
        notes: newNotes,
        updated_at: new Date().toISOString(),
      };

      const { error: updateErr } = await supabase
        .from('turath_masr_orders')
        .update(updatePayload)
        .eq('id', order.id);
      if (updateErr) {
        console.error('[edit-order] update failed:', updateErr);
        const friendly =
          updateErr.code === '42501'
            ? 'لا تملك صلاحية تعديل هذا الطلب. تواصل مع المدير.'
            : `تعذر حفظ التعديلات: ${updateErr.message}`;
        toast.error(friendly);
        return;
      }

      // Build the after-snapshot from the payload we just sent.
      const afterSnapshot: OrderSnapshot = {
        customer: customerName.trim(),
        phone: phone.trim(),
        phone2: phone2.trim() || null,
        region: addressValue.governorate.trim(),
        district: addressValue.area.trim() || null,
        neighborhood: addressValue.neighborhood.trim() || null,
        address: addressValue.detailedAddress.trim(),
        freeShipping,
        expressShipping: beforeSnapshot.expressShipping,
        subtotal: newSubtotal,
        shippingFee,
        total: newTotal,
        lines: newLines.map((l) => ({
          productType: ((l as { productType?: string }).productType ?? null) as string | null,
          label: ((l as { label?: string }).label ?? null) as string | null,
          color: ((l as { color?: string | null }).color ?? null) as string | null,
          quantity: Number((l as { quantity?: number }).quantity) || 0,
          unitPrice: Number((l as { unitPrice?: number }).unitPrice) || 0,
          total: Number((l as { total?: number }).total) || 0,
        })),
        checkoutDetails,
      };

      const changes = diffOrders(beforeSnapshot, afterSnapshot);

      // Audit: one row per changed field into the per-order log so
      // the existing AuditLogModal timeline renders them as
      // individual entries. Best-effort — never block the save.
      const actorLabel = (profileFullName ?? '').trim() || user?.email || '—';
      for (const change of changes) {
        try {
          await addAuditLog({
            orderId: order.id,
            orderNum: order.orderNum,
            action: 'order_edited',
            fieldChanged: change.label,
            oldValue: change.before == null ? '' : String(change.before),
            newValue: change.after == null ? '' : String(change.after),
            changedBy: actorLabel,
            changedByRole: currentRoleId ?? '—',
          });
        } catch (auditErr) {
          console.warn('[edit-order] per-field audit failed:', auditErr);
        }
      }

      // Staff audit: one row summarising the whole edit.
      // Phase Orders-Edit-Address-Shipping-1 — extend the metadata
      // with structured address + shipping-fee context whenever the
      // address or fee changed. We only attach these keys when
      // there's a delta so untouched edits keep the audit payload
      // small.
      const addressBefore = {
        region: beforeSnapshot.region,
        district: beforeSnapshot.district,
        neighborhood: beforeSnapshot.neighborhood,
        address: beforeSnapshot.address,
      };
      const addressAfter = {
        region: afterSnapshot.region,
        district: afterSnapshot.district,
        neighborhood: afterSnapshot.neighborhood,
        address: afterSnapshot.address,
      };
      const addressDidChange =
        addressBefore.region !== addressAfter.region ||
        (addressBefore.district ?? '') !== (addressAfter.district ?? '') ||
        (addressBefore.neighborhood ?? '') !== (addressAfter.neighborhood ?? '') ||
        addressBefore.address !== addressAfter.address;
      const shippingFeeBefore = beforeSnapshot.shippingFee;
      const shippingFeeAfter = afterSnapshot.shippingFee;
      const shippingFeeDeltaAudit = shippingFeeAfter - shippingFeeBefore;
      const baseAuditMetadata = buildStaffAuditMetadata(
        order.id,
        order.orderNum,
        beforeSnapshot,
        afterSnapshot,
        changes
      );
      const shippingAuditAddendum: Record<string, unknown> =
        addressDidChange || shippingFeeDeltaAudit !== 0
          ? {
              address_before: addressBefore,
              address_after: addressAfter,
              shipping_fee_before: shippingFeeBefore,
              shipping_fee_after: shippingFeeAfter,
              shipping_fee_delta: shippingFeeDeltaAudit,
              // 'free_shipping' / 'governorate' / 'area' /
              // 'neighborhood' / 'none' / 'saved' — `'saved'` is the
              // fallback used when regions weren't ready on save
              // (untouched address), so the audit can tell apart "we
              // re-resolved the fee" from "we kept the previously
              // saved fee verbatim".
              shipping_fee_source: freeShipping
                ? 'free_shipping'
                : (coverageStatus.fee?.source ?? 'saved'),
            }
          : {};
      try {
        await writeStaffAuditLog(supabase, {
          action: 'order.updated',
          description: buildArabicDescription(order.orderNum, changes),
          actorId: user?.id ?? null,
          actorName: actorLabel,
          actorRoleId: currentRoleId,
          entity: {
            type: 'order',
            id: order.id,
            label: order.orderNum,
          },
          metadata: { ...baseAuditMetadata, ...shippingAuditAddendum },
        });
      } catch (staffAuditErr) {
        console.warn('[edit-order] staff audit failed:', staffAuditErr);
      }

      // Phase Inventory-Reservations-1C — reconcile reservations
      // against the new line set. We skip when the live row was
      // already delivered (the Delivery-Fulfillment phase owns
      // post-delivery stock effects) and when neither the old nor
      // the new lines reference inventory (static-only orders never
      // produce reservations, so there is nothing to reconcile).
      // The reconcile RPC itself is idempotent: it releases every
      // active reservation for the order, then re-reserves from the
      // supplied lines, so a partial / mid-edit save converges on
      // the right state.
      const liveStatus = typeof liveRow.status === 'string' ? liveRow.status : null;
      const shouldReconcileReservations =
        !isDeliveredStatus(liveStatus) &&
        (hasInventoryBackedLines(liveLines) || hasInventoryBackedLines(newLines));
      if (shouldReconcileReservations) {
        const reconcileLines = buildReservationLinesFromOrderLines(newLines);
        try {
          const reconcileRes = await supabase.rpc('inventory_reconcile_order_lines', {
            p_order_id: order.id,
            p_order_num: order.orderNum,
            p_lines: reconcileLines,
            p_reason: 'order_edited',
            p_actor_name: actorLabel,
            p_allow_oversell: false,
          });
          if (reconcileRes.error) {
            const errMessage = reconcileRes.error.message || 'reconcile failed';
            console.error('[edit-order] reconcile failed:', reconcileRes.error);
            toast.warning('تم حفظ التعديلات لكن تعذر تحديث حجز المخزون. راجع المخزون يدويًا.');
            try {
              await writeStaffAuditLog(supabase, {
                action: 'inventory.reservation_failed',
                actorId: user?.id ?? null,
                actorName: actorLabel,
                actorRoleId: currentRoleId ?? null,
                entity: { type: 'order', id: order.id, label: `#${order.orderNum}` },
                metadata: {
                  order_id: order.id,
                  order_num: order.orderNum,
                  context: 'reconcile_on_edit',
                  error_message: errMessage,
                  line_count: reconcileLines.length,
                },
              });
            } catch (auditErr) {
              console.warn('[edit-order] reservation_failed audit skipped', auditErr);
            }
          } else {
            const reconcileResult = (reconcileRes.data ?? null) as {
              release?: { released_count?: number; total_quantity?: number } | null;
              reserve?: {
                reserved_count?: number;
                skipped_count?: number;
                total_quantity?: number;
              } | null;
            } | null;
            try {
              await writeStaffAuditLog(supabase, {
                action: 'inventory.reservation_reconciled',
                actorId: user?.id ?? null,
                actorName: actorLabel,
                actorRoleId: currentRoleId ?? null,
                entity: { type: 'order', id: order.id, label: `#${order.orderNum}` },
                metadata: {
                  order_id: order.id,
                  order_num: order.orderNum,
                  line_count: reconcileLines.length,
                  released_count: reconcileResult?.release?.released_count ?? null,
                  released_quantity: reconcileResult?.release?.total_quantity ?? null,
                  reserved_count: reconcileResult?.reserve?.reserved_count ?? null,
                  reserved_quantity: reconcileResult?.reserve?.total_quantity ?? null,
                  skipped_count: reconcileResult?.reserve?.skipped_count ?? null,
                },
              });
            } catch (auditErr) {
              console.warn('[edit-order] reservation_reconciled audit skipped', auditErr);
            }
          }
        } catch (reconcileErr) {
          console.error('[edit-order] reconcile threw:', reconcileErr);
          toast.warning('تم حفظ التعديلات لكن حدث خطأ في تحديث حجز المخزون.');
        }
      }

      // Phase CRM-Customers-Order-Sync-1 — when the customer
      // identity (name / phone / detailed address) was edited, push
      // the new values into the CRM customers table so the
      // /customers dashboard reflects the latest profile. Skipped
      // when none of the three changed so a product- / quantity-
      // only edit doesn't issue a redundant write. Non-blocking:
      // any failure is logged and the edit otherwise succeeds.
      const customerIdentityChanged =
        beforeSnapshot.customer !== afterSnapshot.customer ||
        beforeSnapshot.phone !== afterSnapshot.phone ||
        beforeSnapshot.address !== afterSnapshot.address;
      if (customerIdentityChanged) {
        const syncResult = await syncCustomerFromOrder(supabase, {
          phone: afterSnapshot.phone,
          fullName: afterSnapshot.customer,
          address: afterSnapshot.address,
        });
        if (!syncResult.ok) {
          console.warn('[edit-order] customer sync non-blocking:', syncResult);
        }
      }

      toast.success(
        changes.length === 0 ? 'تم الحفظ بدون تغييرات.' : `تم حفظ ${changes.length} تعديل.`
      );

      const updated: EditableOrder = {
        ...order,
        customer: customerName.trim(),
        phone: phone.trim(),
        phone2: phone2.trim() || undefined,
        region: addressValue.governorate.trim(),
        district: addressValue.area.trim() || undefined,
        neighborhood: addressValue.neighborhood.trim() || null,
        address: addressValue.detailedAddress.trim(),
        products: newProductsSummary,
        subtotal: newSubtotal,
        shippingFee,
        total: newTotal,
        quantity: newQuantity,
        notes: newNotes,
        lines: newLines as EditableOrder['lines'],
      };
      onSaved(updated);
    } catch (err) {
      console.error('[edit-order] unexpected failure:', err);
      toast.error('حدث خطأ غير متوقع. حاول مرة أخرى.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!canEdit) {
    return (
      <div
        className="fixed inset-0 z-[70] flex items-center justify-center p-4"
        dir="rtl"
        role="dialog"
      >
        <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
        <div className="relative bg-white rounded-3xl shadow-modal w-full max-w-md p-6 space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-rose-700" />
            <h3 className="text-base font-bold">ليس لديك صلاحية تعديل الطلب</h3>
          </div>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            تواصل مع المدير لمنحك صلاحية تعديل الأوردرات.
          </p>
          <button
            onClick={onClose}
            className="w-full py-2 rounded-xl bg-[hsl(var(--primary))] text-white text-sm font-bold"
          >
            إغلاق
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      dir="rtl"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative bg-white rounded-3xl shadow-modal w-full max-w-3xl max-h-[92vh] flex flex-col fade-in">
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between p-5 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-2">
            <Edit2 size={18} className="text-[hsl(var(--primary))]" />
            <div>
              <h3 className="text-base font-bold">تعديل الطلب</h3>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                رقم الطلب: <span className="font-mono">{order.orderNum}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-[hsl(var(--muted))]"
            aria-label="إغلاق"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 scrollbar-thin">
          <section className="rounded-2xl border border-[hsl(var(--border))] p-4 space-y-3">
            <h4 className="text-xs font-bold text-[hsl(var(--muted-foreground))]">بيانات العميل</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="اسم العميل *" value={customerName} onChange={setCustomerName} />
              <Field label="رقم الهاتف *" value={phone} onChange={setPhone} dir="ltr" />
              <Field label="رقم هاتف إضافي" value={phone2} onChange={setPhone2} dir="ltr" />
            </div>
            {/* Phase Orders-Edit-Address-Shipping-1 — coverage-aware
                cascade. Filters governorate/area/neighborhood to
                active coverage, surfaces a legacy-mismatch banner
                when the saved address doesn't map to a covered path,
                and drives the shipping fee resolution in the section
                below. */}
            {/* Phase Orders-Admin-Actions-1 — disable the address picker
                once the order has had any operational handling. The
                save handler also re-checks against the live row so this
                isn't only a visual lock. */}
            <AddressCoveragePicker
              value={addressValue}
              onChange={setAddressValue}
              onStatusChange={setCoverageStatus}
              disabled={addressLocked}
            />
            {addressLocked && (
              <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-2">
                لا يمكن تعديل العنوان بعد بدء التعامل على الطلب.
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-[hsl(var(--border))] p-4 space-y-3">
            <OrderLinesEditor
              lines={lines}
              productCards={productCards}
              inventoryItems={inventoryItems}
              onLinesChange={setLines}
              requireAtLeastOne={true}
              renderHeader={true}
            />
          </section>

          <section className="rounded-2xl border border-[hsl(var(--border))] p-4 space-y-3">
            <h4 className="text-xs font-bold text-[hsl(var(--muted-foreground))]">الشحن</h4>
            <div className="flex flex-wrap gap-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={freeShipping}
                  onChange={(e) => setFreeShipping(e.target.checked)}
                />
                شحن مجاني
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer opacity-70">
                <input
                  type="checkbox"
                  checked={expressShipping}
                  disabled
                  onChange={(e) => setExpressShipping(e.target.checked)}
                />
                شحن سريع (يتم تعديله من المنشئ فقط حاليًا)
              </label>
            </div>
            {/* Phase Orders-Edit-Address-Shipping-1 — region-aware
                fee preview. Hidden when free-shipping overrides the
                resolved fee, and while the coverage hierarchy is
                still loading (`fee === null`). The delta row only
                appears when the resolved fee differs from the saved
                one, so non-address edits stay quiet. */}
            {!freeShipping && coverageStatus.fee !== null && (
              <div className="space-y-1">
                <div className="text-xs flex items-center justify-between">
                  <span className="text-[hsl(var(--muted-foreground))]">سعر الشحن حسب المنطقة</span>
                  <span className="font-mono font-semibold" dir="ltr">
                    {coverageStatus.fee.fee.toLocaleString('en-US')} ج.م
                  </span>
                </div>
                {shippingFeeDelta !== 0 && (
                  <div className="text-xs flex items-center justify-between">
                    <span className="text-[hsl(var(--muted-foreground))]">فرق الشحن</span>
                    <span
                      className={`font-mono font-semibold ${shippingFeeDelta > 0 ? 'text-rose-700' : 'text-emerald-700'}`}
                      dir="ltr"
                    >
                      {shippingFeeDelta > 0 ? '+' : ''}
                      {shippingFeeDelta.toLocaleString('en-US')} ج.م
                    </span>
                  </div>
                )}
                {coverageStatus.fee.source !== 'none' && (
                  <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                    {coverageStatus.fee.label}
                  </p>
                )}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-[hsl(var(--border))] p-4 space-y-3">
            <div className="flex items-center gap-1.5">
              <Wrench size={13} className="text-[hsl(var(--primary))]" />
              <h4 className="text-xs font-bold">المعاينة والتركيب</h4>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {(
                [
                  { key: 'none', label: 'بدون معاينة' },
                  { key: 'preview_only', label: 'معاينة بدون تركيب' },
                  { key: 'preview_with_installation', label: 'معاينة مع تركيب' },
                ] as const
              ).map((opt) => (
                <button
                  type="button"
                  key={opt.key}
                  onClick={() => setPreviewMode(opt.key)}
                  className={`text-xs px-3 py-2 rounded-xl border font-semibold transition-colors ${
                    previewMode === opt.key
                      ? 'bg-[hsl(var(--primary))] text-white border-[hsl(var(--primary))]'
                      : 'bg-white border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/30'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {previewMode === 'preview_with_installation' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <select
                  className="input-field"
                  value={installationTarget ?? ''}
                  onChange={(e) =>
                    setInstallationTarget(
                      e.target.value === 'mosque' || e.target.value === 'customer'
                        ? (e.target.value as InstallationTarget)
                        : null
                    )
                  }
                >
                  <option value="">اختر هدف التركيب</option>
                  <option value="mosque">مسجد (مجاني)</option>
                  <option value="customer">عملاء</option>
                </select>
                {installationTarget === 'customer' && (
                  <select
                    className="input-field"
                    value={installationPayer}
                    onChange={(e) => setInstallationPayer(e.target.value as InstallationPayer)}
                  >
                    <option value="customer">على العميل</option>
                    <option value="factory">على المصنع</option>
                  </select>
                )}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-[hsl(var(--border))] p-4 space-y-3">
            <h4 className="text-xs font-bold text-[hsl(var(--muted-foreground))]">الخصم</h4>
            {!discountEnabled ? (
              <button
                type="button"
                onClick={() => setDiscountEnabled(true)}
                className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-rose-200 bg-rose-50/50 px-4 py-2 text-sm font-bold text-rose-700 hover:bg-rose-50"
              >
                <span className="text-lg leading-none">+</span>
                إضافة خصم
              </button>
            ) : (
              <div className="space-y-3">
                <div className="flex gap-2">
                  {(
                    [
                      { key: 'fixed', label: 'قيمة ثابتة' },
                      { key: 'percent', label: 'نسبة مئوية' },
                    ] as const
                  ).map((opt) => (
                    <button
                      type="button"
                      key={opt.key}
                      onClick={() => setDiscountType(opt.key)}
                      className={`flex-1 rounded-xl border px-3 py-2 text-xs font-bold transition-colors ${
                        discountType === opt.key
                          ? 'border-rose-400 bg-white text-rose-800'
                          : 'border-rose-200 bg-rose-50/70 text-rose-600 hover:bg-white'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="label-text">
                      {discountType === 'percent' ? 'نسبة الخصم (%)' : 'قيمة الخصم (ج.م)'}
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={discountType === 'percent' ? 100 : undefined}
                      dir="ltr"
                      className="input-field text-center font-mono"
                      value={discountValue}
                      onChange={(e) => setDiscountValue(Math.max(0, Number(e.target.value) || 0))}
                    />
                  </div>
                  <div>
                    <label className="label-text">سبب الخصم</label>
                    <input
                      className="input-field"
                      value={discountReason}
                      onChange={(e) => setDiscountReason(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label-text">تم الخصم بواسطة</label>
                    <input
                      className="input-field bg-slate-50"
                      value={discountBy}
                      onChange={(e) => setDiscountBy(e.target.value)}
                      readOnly
                    />
                  </div>
                </div>
                {discountType === 'percent' && normalizedDiscountValue > 0 && (
                  <p className="text-xs text-rose-800">
                    سيتم خصم{' '}
                    <span className="font-bold font-mono" dir="ltr">
                      {appliedDiscount.toLocaleString('en-US')} ج.م
                    </span>{' '}
                    من إجمالي{' '}
                    <span className="font-bold font-mono" dir="ltr">
                      {grossTotal.toLocaleString('en-US')} ج.م
                    </span>
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setDiscountEnabled(false);
                    setDiscountValue(0);
                    setDiscountReason('');
                  }}
                  className="text-xs font-bold text-rose-700 underline-offset-2 hover:underline"
                >
                  إلغاء الخصم
                </button>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-[hsl(var(--border))] p-4 space-y-3">
            <div className="flex items-center gap-1.5">
              <Wallet size={13} className="text-[hsl(var(--primary))]" />
              <h4 className="text-xs font-bold">الدفع</h4>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <select
                className="input-field"
                value={paymentStatus}
                onChange={(e) => setPaymentStatus(e.target.value as PaymentStatus)}
              >
                <option value="unpaid">غير مدفوع</option>
                <option value="paid">مدفوع بالكامل</option>
                <option value="partial">مدفوع جزئيًا</option>
              </select>
              {paymentStatus !== 'unpaid' && (
                <>
                  <select
                    className="input-field"
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                  >
                    <option value="">اختر وسيلة الدفع</option>
                    {PAYMENT_METHOD_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                  <Field label="مدفوع إلى" value={paidTo} onChange={setPaidTo} />
                  {paymentStatus === 'partial' && (
                    <div>
                      <label className="label-text">المبلغ المدفوع</label>
                      <input
                        type="number"
                        min={0}
                        dir="ltr"
                        className="input-field text-center font-mono"
                        value={paidAmount}
                        onChange={(e) => setPaidAmount(Math.max(0, Number(e.target.value) || 0))}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-1">
            <h4 className="text-xs font-bold text-slate-700">ملخص الأسعار بعد التعديل</h4>
            <Row label="إجمالي المنتجات" value={`${subtotal.toLocaleString('en-US')} ج.م`} />
            <Row label="مصاريف الشحن" value={`${shippingFee.toLocaleString('en-US')} ج.م`} />
            {installationCharge > 0 && (
              <Row
                label="تركيب الحامل"
                value={`${installationCharge.toLocaleString('en-US')} ج.م`}
              />
            )}
            <Row label="الإجمالي قبل الخصم" value={`${grossTotal.toLocaleString('en-US')} ج.م`} />
            {appliedDiscount > 0 && (
              <Row label="الخصم" value={`- ${appliedDiscount.toLocaleString('en-US')} ج.م`} />
            )}
            <Row
              label="الإجمالي النهائي"
              value={`${grandTotal.toLocaleString('en-US')} ج.م`}
              emphasis
            />
            {paymentStatus !== 'unpaid' && (
              <>
                <Row label="المدفوع" value={`${effectivePaidAmount.toLocaleString('en-US')} ج.م`} />
                <Row label="المتبقي" value={`${remainingAmount.toLocaleString('en-US')} ج.م`} />
              </>
            )}
          </section>
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 border-t border-[hsl(var(--border))] p-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded-xl text-sm font-semibold border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={submitting}
            className="px-5 py-2 rounded-xl text-sm font-bold bg-[hsl(var(--primary))] text-white hover:opacity-90 disabled:opacity-40 flex items-center gap-1.5"
          >
            <Save size={14} />
            {submitting ? 'جارٍ الحفظ...' : 'حفظ التعديلات'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  dir,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  dir?: 'ltr' | 'rtl';
  multiline?: boolean;
}) {
  return (
    <div>
      <label className="label-text">{label}</label>
      {multiline ? (
        <textarea
          className="input-field min-h-[64px]"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          dir={dir}
        />
      ) : (
        <input
          className="input-field"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          dir={dir}
        />
      )}
    </div>
  );
}

function Row({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-slate-600">{label}</span>
      <span
        className={`font-mono ${emphasis ? 'font-bold text-sm text-slate-900' : 'text-slate-800'}`}
      >
        {value}
      </span>
    </div>
  );
}
