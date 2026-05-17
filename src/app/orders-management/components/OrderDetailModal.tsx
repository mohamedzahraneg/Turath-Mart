'use client';
import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { toast } from 'sonner';
import { Toaster } from 'sonner';
import {
  X,
  User,
  Phone,
  MapPin,
  Package,
  FileText,
  MessageCircle,
  Mail,
  Printer,
  CheckCircle,
  Shield,
  Monitor,
  Smartphone,
  Tablet,
  Link,
  Copy,
  Clock,
  Headphones,
  Truck,
  Send,
  RotateCcw,
  XCircle,
  PlayCircle,
  // Phase Orders-Edit-1 — pencil icon for the new "تعديل الطلب"
  // action button in the modal header.
  Edit2,
} from 'lucide-react';
import { getAuditLogs, STATUS_LABELS, type AuditEntry } from './AuditLogModal';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { canUseAdminOnlyFinancialFields, isManagerOrAbove, ROLE_IDS } from '@/lib/constants/roles';
// Phase 22P — split structured `{ reason, note }` payloads in the
// status-history + audit timeline render paths below.
// Phase 22Q — also surfaces the optional `schedule` fragment.
import { parseAuditNote } from '@/lib/orders/auditNote';
// Phase 22Q — Arabic-locale formatters for the delivery schedule.
import { formatScheduleDateAr, formatTime12hAr } from '@/lib/orders/scheduleFormat';
// Phase 25A — returns & exchanges helper + modal.
import {
  ADJUSTMENT_KIND_LABEL_AR,
  ADJUSTMENT_KIND_TONE,
  ADJUSTMENT_STATE_LABEL_AR,
  ADJUSTMENT_STATE_TONE,
  PRICE_DIFFERENCE_DIRECTION_LABEL_AR,
  REFUND_MODE_LABEL_AR,
  SHIPPING_PAYER_LABEL_AR,
  allowedNextStates,
  buildChildOrderNum,
  humanizeAdjustmentAuditEntry,
  isAdjustmentActionable,
  isOrderAdjustable,
  type AdjustmentState,
  type OrderAdjustment,
} from '@/lib/orders/orderAdjustments';
import OrderAdjustmentModal from './OrderAdjustmentModal';
// Phase Orders-Edit-1 — focused edit surface gated behind the
// `edit_orders` permission. Opens via the new action button below.
import EditOrderModal from './EditOrderModal';
import { usePermissions } from '@/hooks/usePermissions';
// Phase Egress-Fix1 — resolve line image URL across legacy / inventory /
// storage sources so consumers stop hard-coding `line.image`.
import { resolveLineImageUrl } from '@/lib/orders/lineImage';
import {
  checkoutDetailsLines,
  parseCheckoutDetailsFromNotes,
  stripCheckoutDetailsBlock,
} from '@/lib/orders/checkoutDetails';
// Phase 26D-1 — staff audit log on adjustment decisions + child order
// + auto-created complaint.
import { writeStaffAuditLog } from '@/lib/security/staffAudit';
// Phase Inventory-Returns-Stock-1 — fires `return_in` movements
// against `inventory_apply_movement` when a return adjustment
// transitions to `completed` with `return_to_stock` lines.
import { applyReturnStockEffects } from '@/lib/inventory/returnStockClient';
// Phase Inventory-Exchange-Stock-1 — sibling helper. Fires the two
// legs of exchange stock effects when an exchange adjustment hits
// `completed`: returned items via `exchange_in`, replacement items
// via `exchange_out`.
import { applyExchangeStockEffects } from '@/lib/inventory/exchangeStockClient';
import { UserStamp } from '@/components/UserStamp';

interface OrderLine {
  productType: string;
  label: string;
  image?: string | null;
  /** Phase Egress-Fix1 — set by the cleanup script. */
  image_source?: 'inventory' | 'storage' | 'none';
  image_path?: string | null;
  emoji?: string;
  color?: string | null;
  quantity: number;
  unitPrice: number;
  includeFlashlight?: boolean;
  flashlightPrice?: number;
  note?: string | null;
  total: number;
}

interface Order {
  id: string;
  orderNum: string;
  // Phase 13C: per-order unguessable UUID used by the new
  // /track/t/<token> public URL. May be undefined for legacy callers
  // that have not yet selected the column from the DB row.
  trackingToken?: string | null;
  createdBy: string;
  createdByIp?: string;
  createdByLocation?: string;
  createdByDevice?: string;
  customer: string;
  phone: string;
  phone2?: string;
  region: string;
  district?: string;
  // Phase 22N-Fix3 — optional neighborhood / village / shiakha
  // surfaced in the order detail header, invoice print, WhatsApp
  // template, and PDF.
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
  date: string;
  time: string;
  day: string;
  notes?: string;
  ip: string;
  warranty?: string;
  delegate?: string;
  // Phase 22Q — delivery schedule snapshot. NULL until an admin sets
  // a schedule from StatusUpdateModal. The four customer-facing
  // pieces are surfaced on the order detail card and on the public
  // tracking page; the audit metadata (`scheduledDeliveryUpdatedAt`,
  // `_UpdatedBy`) is admin-internal.
  scheduledDeliveryDate?: string | null;
  scheduledDeliveryFrom?: string | null;
  scheduledDeliveryTo?: string | null;
  scheduledDeliveryReason?: string | null;
  scheduledDeliveryUpdatedAt?: string | null;
  scheduledDeliveryUpdatedBy?: string | null;
  lines?: OrderLine[];
}

// NOTE: role-based gating now derives from useAuth() inside the component.
// The previous hardcoded `CURRENT_USER_ROLE = 'admin'` made every viewer see
// admin-only content (extra fee badge, sensitive sections), regardless of
// their actual permissions.

const STATUS_BADGE_MAP: Record<string, { label: string; cls: string }> = {
  new: { label: 'جديد', cls: 'status-new' },
  preparing: { label: 'جاري التجهيز', cls: 'status-preparing' },
  warehouse: { label: 'في المستودع', cls: 'status-warehouse' },
  shipping: { label: 'جاري الشحن', cls: 'status-shipping' },
  delivered: { label: 'تم التسليم', cls: 'status-delivered' },
  cancelled: { label: 'ملغي', cls: 'status-cancelled' },
  returned: { label: 'مرتجع', cls: 'status-returned' },
};

// Tabs configuration
const TABS = [
  { id: 'tab-details', label: 'تفاصيل الأوردر' },
  { id: 'tab-tracking', label: 'رابط التتبع' },
  { id: 'tab-chat', label: 'محادثة الطلب' },
  { id: 'tab-history', label: 'سجل الحالات' },
  { id: 'tab-invoice', label: 'الفاتورة' },
];

function DeviceIcon({ device }: { device?: string }) {
  if (!device) return <Monitor size={12} />;
  if (device === 'موبايل') return <Smartphone size={12} />;
  if (device === 'تابلت') return <Tablet size={12} />;
  return <Monitor size={12} />;
}

// Generate a unique tracking link per order.
// Phase 13C: prefer the unguessable /track/t/<tracking_token> URL when the
// order has a token (every order does after Phase 13A backfilled). Falls
// back to /track/<order_num> defensively when the token is missing.
function getTrackingLink(order: { orderNum: string; trackingToken?: string | null }): string {
  const base = typeof window !== 'undefined' ? window.location.origin : 'https://turathmasr.com';
  return order.trackingToken
    ? `${base}/track/t/${order.trackingToken}`
    : `${base}/track/${order.orderNum}`;
}

const DEFAULT_WA_TEMPLATE = `مرحبا {customerName}،
تم استلام طلبك رقم {orderNum} بإجمالي {total} ج.م.
يمكنك تتبع شحنتك عبر الرابط: {trackingLink}
سيتواصل معك المندوب قريباً.
شكراً لثقتك في Turath Masr 🚚`;

interface Props {
  order: Order;
  onClose: () => void;
}

type TimelineTone = 'green' | 'blue' | 'amber' | 'slate' | 'purple';

interface OrderTimelineItem {
  id: string;
  timestamp: number;
  dateLabel: string;
  title: string;
  badge?: string;
  badgeClass?: string;
  actorName?: string | null;
  actorRole?: string | null;
  body?: string | null;
  tone: TimelineTone;
}

function parseOrderDateTime(order: Order): number {
  const dateMatch = order.date?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dateMatch) {
    const [, day, month, year] = dateMatch;
    const [hour = '0', minute = '0', second = '0'] = (order.time ?? '').split(':');
    const parsed = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    ).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }
  const candidates = [`${order.date ?? ''} ${order.time ?? ''}`.trim(), order.date].filter(Boolean);
  for (const candidate of candidates) {
    const t = new Date(candidate).getTime();
    if (Number.isFinite(t)) return t;
  }
  return 0;
}

function formatTimelineDate(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const d = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const days = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  return `${days[d.getDay()]} ${d.toLocaleDateString('en-GB')} — ${d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

function timelineToneClasses(tone: TimelineTone): { dot: string; card: string } {
  const map: Record<TimelineTone, { dot: string; card: string }> = {
    green: { dot: 'bg-emerald-500 text-white', card: 'bg-emerald-50 border-emerald-200' },
    blue: { dot: 'bg-blue-500 text-white', card: 'bg-blue-50 border-blue-200' },
    amber: { dot: 'bg-amber-500 text-white', card: 'bg-amber-50 border-amber-200' },
    slate: { dot: 'bg-slate-500 text-white', card: 'bg-slate-50 border-slate-200' },
    purple: { dot: 'bg-purple-500 text-white', card: 'bg-purple-50 border-purple-200' },
  };
  return map[tone];
}

function buildAuditTimelineItem(log: AuditEntry): OrderTimelineItem {
  const timestamp = new Date(log.createdAt).getTime();
  const safeTimestamp = Number.isFinite(timestamp) ? timestamp : 0;
  const humanised = humanizeAdjustmentAuditEntry({ action: log.action, note: log.note });
  const parsed = parseAuditNote(log.note);
  const parsedBody = [
    parsed.reason ? `سبب الإرجاع: ${parsed.reason}` : null,
    parsed.schedule
      ? [
          `موعد التسليم: ${formatScheduleDateAr(parsed.schedule.date)}`,
          `من الساعة ${formatTime12hAr(parsed.schedule.from)} إلى الساعة ${formatTime12hAr(
            parsed.schedule.to
          )}`,
          parsed.schedule.reason ? `سبب الترحيل: ${parsed.schedule.reason}` : null,
        ]
          .filter(Boolean)
          .join('\n')
      : null,
    parsed.note ? `ملاحظة: ${parsed.note}` : null,
    parsed.raw ?? null,
  ]
    .filter(Boolean)
    .join('\n');

  if (log.action === 'status_change') {
    const nextLabel = STATUS_LABELS[log.newValue || ''] || log.newValue || 'حالة غير محددة';
    const previousLabel = log.oldValue ? STATUS_LABELS[log.oldValue] || log.oldValue : null;
    return {
      id: log.id,
      timestamp: safeTimestamp,
      dateLabel: formatTimelineDate(log.createdAt),
      title: `تغيير الحالة إلى ${nextLabel}`,
      badge: nextLabel,
      badgeClass: STATUS_BADGE_MAP[log.newValue || '']?.cls ?? 'status-new',
      actorName: log.changedBy,
      actorRole: log.changedByRole,
      body: [previousLabel ? `من: ${previousLabel}` : null, parsedBody || null]
        .filter(Boolean)
        .join('\n'),
      tone: 'blue',
    };
  }

  if (log.action.startsWith('adjustment_')) {
    return {
      id: log.id,
      timestamp: safeTimestamp,
      dateLabel: formatTimelineDate(log.createdAt),
      title: 'حدث مرتجع / استبدال',
      badge: 'تسوية',
      actorName: log.changedBy,
      actorRole: log.changedByRole,
      body: humanised || parsedBody || null,
      tone: 'amber',
    };
  }

  const actionLabels: Record<string, string> = {
    order_created: 'تم إنشاء الطلب',
    order_edited: 'تم تعديل الطلب',
    order_deleted: 'تم حذف الطلب',
  };

  return {
    id: log.id,
    timestamp: safeTimestamp,
    dateLabel: formatTimelineDate(log.createdAt),
    title: actionLabels[log.action] || log.action,
    badge: log.action === 'order_created' ? 'إنشاء' : undefined,
    actorName: log.changedBy,
    actorRole: log.changedByRole,
    body:
      log.action === 'order_edited' && log.fieldChanged
        ? `الحقل: ${log.fieldChanged}${
            log.oldValue && log.newValue ? `\n${log.oldValue} ← ${log.newValue}` : ''
          }${parsedBody ? `\n${parsedBody}` : ''}`
        : parsedBody || null,
    tone: log.action === 'order_created' ? 'green' : 'slate',
  };
}

export default function OrderDetailModal({ order, onClose }: Props) {
  const { currentRoleId, user, profileFullName } = useAuth();
  const IS_ADMIN = canUseAdminOnlyFinancialFields(currentRoleId);

  const [activeTab, setActiveTab] = useState('tab-details');
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [liveOrder, setLiveOrder] = useState(order);
  const [waTemplate, setWaTemplate] = useState(DEFAULT_WA_TEMPLATE);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);

  // Phase 25A — returns & exchanges
  const [adjustments, setAdjustments] = useState<OrderAdjustment[]>([]);
  const [showAdjustmentModal, setShowAdjustmentModal] = useState(false);
  const [adjustmentBusyId, setAdjustmentBusyId] = useState<string | null>(null);
  const ADJUSTMENT_CREATOR_ROLES: string[] = [
    ROLE_IDS.ADMIN,
    ROLE_IDS.SYSTEM_SUPERVISOR,
    ROLE_IDS.CUSTOMER_SERVICE_MANAGER,
    ROLE_IDS.CUSTOMER_SERVICE,
  ];
  const canCreateAdjustment = !!currentRoleId && ADJUSTMENT_CREATOR_ROLES.includes(currentRoleId);
  const canDecideAdjustment = isManagerOrAbove(currentRoleId);

  // Phase Orders-Edit-1 — `edit_orders` permission gate + modal
  // visibility state. Admin (r1) bypasses via `perms.isAdmin`.
  const perms = usePermissions();
  const canEditOrder = perms.isAdmin || perms.can('edit_orders');
  const [showEditModal, setShowEditModal] = useState(false);

  // Load audit logs and listen for real-time updates
  useEffect(() => {
    const loadAudit = async () => {
      const logs = await getAuditLogs(order.id);
      setAuditLogs(logs);
    };
    loadAudit();

    const fetchSettings = async () => {
      try {
        const supabase = createClient();
        const { data: waData } = await supabase
          .from('turath_masr_settings')
          .select('value')
          .eq('key', 'settings_whatsapp_template')
          .single();
        if (waData?.value) {
          setWaTemplate(waData.value as string);
        }
      } catch (err) {
        console.error('Failed to fetch WA template:', err);
      }
    };
    fetchSettings();

    const handleAudit = () => loadAudit();
    const handleOrders = async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from('turath_masr_orders')
          .select('*')
          .eq('id', order.id)
          .single();

        if (data && !error) {
          // Map DB snake_case columns back to the Order interface camelCase
          const mappedOrder: Order = {
            id: data.id,
            orderNum: data.order_num,
            // Phase 13C: forwarded so getTrackingLink() can build the
            // /track/t/<token> share URL.
            trackingToken: data.tracking_token ?? null,
            createdBy: data.created_by,
            createdByIp: data.created_by_ip || undefined,
            createdByLocation: data.created_by_location || undefined,
            createdByDevice: data.created_by_device || undefined,
            customer: data.customer,
            phone: data.phone,
            phone2: data.phone2 || undefined,
            region: data.region,
            district: data.district || undefined,
            address: data.address,
            products: data.products,
            quantity: data.quantity,
            subtotal: data.subtotal,
            shippingFee: data.shipping_fee,
            extraShippingFee: data.extra_shipping_fee || undefined,
            expressShipping: data.express_shipping || undefined,
            total: data.total,
            status: data.status,
            date: data.date,
            time: data.time,
            day: data.day || '',
            notes: data.notes || undefined,
            ip: data.ip_address || '',
            warranty: data.warranty || undefined,
            delegate: data.delegate || undefined,
            // Phase 22Q — delivery schedule. The columns may not
            // exist yet (migration staged but not applied); a
            // `select('*')` simply omits them in that case so the
            // optional fields land as undefined and the render path
            // skips the schedule card. After the migration is
            // applied they flow through automatically.
            scheduledDeliveryDate: data.scheduled_delivery_date ?? null,
            scheduledDeliveryFrom: data.scheduled_delivery_from ?? null,
            scheduledDeliveryTo: data.scheduled_delivery_to ?? null,
            scheduledDeliveryReason: data.scheduled_delivery_reason ?? null,
            scheduledDeliveryUpdatedAt: data.scheduled_delivery_updated_at ?? null,
            scheduledDeliveryUpdatedBy: data.scheduled_delivery_updated_by ?? null,
            lines: data.lines || [],
          };
          setLiveOrder(mappedOrder);
        }
      } catch (err) {
        console.error('Failed to reload order:', err);
      }
    };

    // Phase 25A — fetch adjustments tied to this order.
    const fetchAdjustments = async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from('turath_masr_order_adjustments')
          .select('*')
          .eq('order_id', order.id)
          .order('created_at', { ascending: false });
        if (!error && data) {
          setAdjustments(data as OrderAdjustment[]);
        }
      } catch (err) {
        // The table may not yet be applied in non-prod environments;
        // failure here is non-fatal. Suppress noise.
        console.info('[OrderDetailModal] adjustments fetch skipped:', err);
      }
    };
    fetchAdjustments();
    const handleAdjustments = () => fetchAdjustments();
    window.addEventListener('turath_masr_order_adjustments_updated', handleAdjustments);

    // Phase 13C: kick off one fetch on mount so liveOrder picks up
    // tracking_token (parent table queries do not yet select it). Without
    // this the first paint of the "tracking link" tab would fall back to
    // /track/<order_num> until a window event arrives.
    handleOrders();

    window.addEventListener('turath_masr_audit_updated', handleAudit);
    window.addEventListener('turath_masr_orders_updated', handleOrders);

    return () => {
      window.removeEventListener('turath_masr_audit_updated', handleAudit);
      window.removeEventListener('turath_masr_orders_updated', handleOrders);
      window.removeEventListener('turath_masr_order_adjustments_updated', handleAdjustments);
    };
  }, [order.id]);

  const statusInfo = STATUS_BADGE_MAP[liveOrder.status] || STATUS_BADGE_MAP['new'];
  const extraFee = liveOrder.extraShippingFee || 0;
  const shippingLabel = liveOrder.expressShipping ? 'شحن سريع' : 'تكلفة الشحن';
  const trackingLink = getTrackingLink(liveOrder);
  const printableNotes = stripCheckoutDetailsBlock(liveOrder.notes);
  const checkoutDetails = parseCheckoutDetailsFromNotes(liveOrder.notes);
  const checkoutLines = checkoutDetails ? checkoutDetailsLines(checkoutDetails) : [];
  const customerNotes = stripCheckoutDetailsBlock(liveOrder.notes);
  const timelineItems = React.useMemo<OrderTimelineItem[]>(() => {
    const items = auditLogs.map(buildAuditTimelineItem);
    const createdAt = parseOrderDateTime(liveOrder);
    const hasCreatedAudit = auditLogs.some((log) => log.action === 'order_created');

    if (!hasCreatedAudit) {
      items.push({
        id: `order-created-${liveOrder.id}`,
        timestamp: createdAt,
        dateLabel: createdAt
          ? formatTimelineDate(createdAt)
          : `${liveOrder.day} ${liveOrder.date} — ${liveOrder.time}`,
        title: 'تم إنشاء الطلب',
        badge: 'إنشاء',
        actorName: liveOrder.createdBy || null,
        body: `تم تسجيل الطلب للعميل ${liveOrder.customer} بإجمالي ${liveOrder.total.toLocaleString(
          'en-US'
        )} ج.م`,
        tone: 'green',
      });
    }

    const trimmedNotes = customerNotes.trim();
    if (trimmedNotes) {
      items.push({
        id: `order-note-${liveOrder.id}`,
        timestamp: createdAt ? createdAt + 1 : 1,
        dateLabel: createdAt ? formatTimelineDate(createdAt + 1) : 'ضمن بيانات الطلب',
        title: 'ملاحظة الطلب',
        badge: 'ملاحظة',
        actorName: liveOrder.createdBy || null,
        body: trimmedNotes,
        tone: 'purple',
      });
    }

    return items.sort((a, b) => a.timestamp - b.timestamp);
  }, [auditLogs, liveOrder, customerNotes]);

  const buildWAMessage = () => {
    return waTemplate
      .replace('{customerName}', liveOrder.customer)
      .replace('{orderNum}', liveOrder.orderNum)
      .replace('{total}', liveOrder.total.toLocaleString('en-US'))
      .replace('{trackingLink}', trackingLink)
      .replace('{delegate}', liveOrder.delegate || 'المندوب')
      .replace('{status}', statusInfo.label);
  };

  const handleSendWhatsApp = () => {
    const msg = encodeURIComponent(buildWAMessage());
    window.open(`https://wa.me/2${liveOrder.phone}?text=${msg}`, '_blank');
    toast.success('تم فتح واتساب مع رابط التتبع');
  };

  const handleSendEmail = () => {
    toast.success('تم إرسال الفاتورة بالبريد الإلكتروني');
  };

  const handleCopyTracking = () => {
    navigator.clipboard.writeText(trackingLink).then(() => {
      toast.success('تم نسخ رابط التتبع');
    });
  };

  // Phase 25A → 25B — drive an adjustment through its state machine.
  // On `approved` we additionally:
  //   • create an operational child order in `turath_masr_orders`
  //   • create / link a complaint row in `turath_masr_crm_complaints`
  // Both side effects are best-effort — a failure on the child-order
  // insert short-circuits and surfaces an error; a failure on the
  // complaint insert is logged but the approval still completes (the
  // child order is the operational source of truth).
  const handleAdjustmentDecision = async (
    adjustment: OrderAdjustment,
    nextState: AdjustmentState,
    decisionNote?: string
  ) => {
    if (!canDecideAdjustment) {
      toast.error('ليس لديك صلاحية اتخاذ هذا القرار.');
      return;
    }
    setAdjustmentBusyId(adjustment.id);
    try {
      const supabase = createClient();
      const decidedByName = (profileFullName ?? '').trim() || user?.email || 'مستخدم غير معروف';

      // ─── Phase 25B — on approve: create child order + complaint ───
      let childOrderId: string | null = adjustment.child_order_id ?? null;
      let childOrderNum: string | null = adjustment.child_order_num ?? null;
      let linkedComplaintId: string | null = adjustment.linked_complaint_id ?? null;

      if (nextState === 'approved' && !adjustment.child_order_id) {
        try {
          // Count existing siblings for the suffix (R1/R2/E1/E2 …)
          const childPrefix =
            adjustment.kind === 'exchange_full' || adjustment.kind === 'exchange_partial'
              ? `${adjustment.order_num}-E`
              : `${adjustment.order_num}-R`;
          const { count: siblingCount } = await supabase
            .from('turath_masr_order_adjustments')
            .select('child_order_num', { count: 'exact', head: true })
            .like('child_order_num', `${childPrefix}%`);
          childOrderNum = buildChildOrderNum(
            adjustment.order_num,
            adjustment.kind,
            siblingCount ?? 0
          );

          const isExchange =
            adjustment.kind === 'exchange_full' || adjustment.kind === 'exchange_partial';
          const productsLabel = isExchange
            ? `طلب استبدال للطلب ${adjustment.order_num}`
            : `طلب مرتجع للطلب ${adjustment.order_num}`;

          // For exchanges the child order carries the replacement lines
          // (what we ship OUT to the customer). For returns the child
          // order is the pickup leg carrying the returned items.
          const childLines = isExchange
            ? ((adjustment.replacement_lines as unknown as Array<Record<string, unknown>>) ?? [])
            : ((adjustment.return_lines as unknown as Array<Record<string, unknown>>) ?? []);
          const childQty = childLines.reduce(
            (sum, ln) => sum + (Number((ln as { quantity?: number }).quantity) || 0),
            0
          );

          // Subtotal: only the chargeable price-difference amount when
          // the customer is paying it; otherwise 0. The child order is
          // an operational shipment, not a product sale.
          const priceDirection = adjustment.price_difference_direction ?? 'none';
          const subtotal =
            priceDirection === 'customer_pays'
              ? Math.abs(Number(adjustment.price_difference) || 0)
              : 0;
          const shippingForChild = Number(adjustment.shipping_customer_amount) || 0;
          const customerCollect =
            Number(adjustment.customer_collect_amount) || subtotal + shippingForChild;

          const childOrderRow = {
            id: `order-${Date.now()}`,
            order_num: childOrderNum,
            created_by: decidedByName,
            created_by_user_id: user?.id ?? null,
            customer: liveOrder.customer,
            phone: liveOrder.phone,
            phone2: liveOrder.phone2 ?? null,
            region: liveOrder.region,
            district: liveOrder.district ?? null,
            neighborhood: liveOrder.neighborhood ?? null,
            address: liveOrder.address,
            products: productsLabel,
            quantity: childQty || 1,
            subtotal,
            shipping_fee: shippingForChild,
            extra_shipping_fee: 0,
            express_shipping: false,
            free_shipping: shippingForChild === 0,
            total: customerCollect,
            status: 'new' as const,
            date: new Date().toLocaleDateString('en-GB').replace(/\//g, '/'),
            time: new Date().toLocaleTimeString('en-GB', { hour12: false }),
            day: new Date().toLocaleDateString('ar-EG', { weekday: 'long' }),
            notes: adjustment.operational_note ?? null,
            warranty: liveOrder.warranty ?? null,
            lines: childLines as unknown,
          };

          const { data: childOrderInserted, error: childErr } = await supabase
            .from('turath_masr_orders')
            .insert(childOrderRow)
            .select('id, order_num')
            .single();
          if (childErr) {
            toast.error(`تعذر إنشاء الطلب الفرعي: ${childErr.message}`);
            console.error('[OrderDetailModal] child order insert failed:', childErr);
            return;
          }
          childOrderId = (childOrderInserted as { id?: string } | null)?.id ?? null;
          childOrderNum =
            (childOrderInserted as { order_num?: string } | null)?.order_num ?? childOrderNum;
          // Phase 26D-1 — staff audit for the child order spawn.
          try {
            await writeStaffAuditLog(supabase, {
              action: 'adjustment.child_order_created',
              actorId: user?.id ?? null,
              actorName: decidedByName,
              actorRoleId: currentRoleId ?? null,
              entity: {
                type: 'order',
                id: childOrderId ?? undefined,
                label: childOrderNum ? `#${childOrderNum}` : 'طلب فرعي',
              },
              description: `تم إنشاء الطلب الفرعي #${childOrderNum} عند الموافقة على ${ADJUSTMENT_KIND_LABEL_AR[adjustment.kind]} للطلب #${adjustment.order_num}`,
              metadata: {
                adjustment_id: adjustment.id,
                parent_order_id: adjustment.order_id,
                parent_order_num: adjustment.order_num,
                child_order_id: childOrderId,
                child_order_num: childOrderNum,
                kind: adjustment.kind,
              },
            });
          } catch (auditErr) {
            console.warn('[OrderDetailModal] child-order staff audit failed:', auditErr);
          }
        } catch (childCreateErr) {
          console.error('[OrderDetailModal] child order create exception:', childCreateErr);
          toast.error('فشل إنشاء الطلب الفرعي.');
          return;
        }

        // Best-effort complaint creation. Failure is logged but the
        // approval transition still proceeds.
        try {
          const subject =
            adjustment.kind === 'exchange_full' || adjustment.kind === 'exchange_partial'
              ? `طلب استبدال للطلب ${adjustment.order_num}`
              : `طلب مرتجع للطلب ${adjustment.order_num}`;
          const complaintType: 'return' | 'exchange' =
            adjustment.kind === 'exchange_full' || adjustment.kind === 'exchange_partial'
              ? 'exchange'
              : 'return';
          const complaintNotes = [
            `السبب: ${adjustment.reason}`,
            childOrderNum ? `الطلب الفرعي: #${childOrderNum}` : null,
            adjustment.operational_note ? `ملاحظات: ${adjustment.operational_note}` : null,
          ]
            .filter(Boolean)
            .join('\n');
          const { data: complaintInserted, error: complaintErr } = await supabase
            .from('turath_masr_crm_complaints')
            .insert({
              customer_phone: liveOrder.phone,
              subject,
              status: 'open',
              notes: complaintNotes,
              created_by: decidedByName,
              order_id: adjustment.order_id,
              order_num: adjustment.order_num,
              child_order_id: childOrderId,
              child_order_num: childOrderNum,
              adjustment_id: adjustment.id,
              complaint_type: complaintType,
              resolution_status: 'open',
              priority: 'medium',
            })
            .select('id')
            .single();
          if (complaintErr) {
            console.warn('[OrderDetailModal] complaint create failed:', complaintErr);
          } else {
            linkedComplaintId = (complaintInserted as { id?: string } | null)?.id ?? null;
            // Phase 26D-1 — staff audit for the auto-created complaint.
            try {
              await writeStaffAuditLog(supabase, {
                action: 'customer.complaint_created',
                actorId: user?.id ?? null,
                actorName: decidedByName,
                actorRoleId: currentRoleId ?? null,
                entity: {
                  type: 'complaint',
                  id: linkedComplaintId ?? undefined,
                  label: subject,
                },
                description: `تم فتح شكوى تلقائيًا بعد اعتماد ${ADJUSTMENT_KIND_LABEL_AR[adjustment.kind]} للطلب #${adjustment.order_num}`,
                metadata: {
                  complaint_id: linkedComplaintId,
                  adjustment_id: adjustment.id,
                  order_id: adjustment.order_id,
                  order_num: adjustment.order_num,
                  child_order_num: childOrderNum,
                  customer_phone: liveOrder.phone,
                  complaint_type: complaintType,
                },
              });
            } catch (auditErr) {
              console.warn('[OrderDetailModal] complaint staff audit failed:', auditErr);
            }
          }
        } catch (complaintExc) {
          console.warn('[OrderDetailModal] complaint create exception:', complaintExc);
        }
      }

      // Move the adjustment forward + persist child/complaint links.
      const { error: updateErr } = await supabase
        .from('turath_masr_order_adjustments')
        .update({
          state: nextState,
          decided_by: decidedByName,
          decided_by_role: currentRoleId ?? null,
          decided_at: new Date().toISOString(),
          decision_note: decisionNote?.trim() || null,
          ...(childOrderId ? { child_order_id: childOrderId } : {}),
          ...(childOrderNum ? { child_order_num: childOrderNum } : {}),
          ...(linkedComplaintId ? { linked_complaint_id: linkedComplaintId } : {}),
        })
        .eq('id', adjustment.id);
      if (updateErr) {
        toast.error(updateErr.message || 'تعذر تحديث حالة التسوية.');
        return;
      }

      // Phase Returns-Exchange-1 — cascade-cancel the linked child
      // shipping order when the adjustment is cancelled or rejected.
      // The child was created upfront at adjustment-creation time so
      // it appeared in the scheduling list; once the parent settlement
      // dies it must not stay live. Best-effort: log + carry on if the
      // update fails so the parent transition still completes.
      let childCascadeCancelled = false;
      if ((nextState === 'cancelled' || nextState === 'rejected') && childOrderId) {
        try {
          const { error: childCancelErr } = await supabase
            .from('turath_masr_orders')
            .update({
              status: 'cancelled',
              updated_at: new Date().toISOString(),
            })
            .eq('id', childOrderId)
            .neq('status', 'cancelled')
            // Phase Orders-Delivered-Readonly-1 — belt-and-suspenders:
            // never cascade-cancel a delivered child order. Frontend
            // gates already block the human transition into a delivered
            // child, but a database-level filter here makes the
            // adjustment-cascade path defensive too.
            .neq('status', 'delivered');
          if (childCancelErr) {
            console.warn('[OrderDetailModal] cascade-cancel child order failed:', childCancelErr);
          } else {
            childCascadeCancelled = true;
          }
        } catch (cascadeErr) {
          console.warn('[OrderDetailModal] cascade-cancel child exception:', cascadeErr);
        }
      }

      try {
        await supabase.from('turath_masr_audit_logs').insert({
          order_id: adjustment.order_id,
          order_num: adjustment.order_num,
          action: `adjustment_${nextState}`,
          field_changed: 'adjustment_state',
          old_value: adjustment.state,
          new_value: nextState,
          changed_by: decidedByName,
          changed_by_role: currentRoleId ?? null,
          note: JSON.stringify({
            adjustment_id: adjustment.id,
            kind: adjustment.kind,
            reason: adjustment.reason,
            refund_mode: adjustment.refund_mode,
            refund_amount: adjustment.refund_amount,
            price_difference: adjustment.price_difference,
            price_difference_direction: adjustment.price_difference_direction,
            shipping_payer: adjustment.shipping_payer,
            shipping_customer_amount: adjustment.shipping_customer_amount,
            shipping_company_amount: adjustment.shipping_company_amount,
            customer_collect_amount: adjustment.customer_collect_amount,
            ...(childOrderNum ? { child_order_num: childOrderNum } : {}),
            ...(linkedComplaintId ? { linked_complaint_id: linkedComplaintId } : {}),
            ...(decisionNote?.trim() ? { note: decisionNote.trim() } : {}),
          }),
        });
      } catch (auditErr) {
        console.warn('[OrderDetailModal] audit log mirror failed:', auditErr);
      }
      // Phase 26D-1 — staff audit for the state transition.
      try {
        const STATE_ACTION_MAP: Record<
          AdjustmentState,
          | 'adjustment.approved'
          | 'adjustment.rejected'
          | 'adjustment.completed'
          | 'adjustment.cancelled'
          | null
        > = {
          pending: null,
          approved: 'adjustment.approved',
          rejected: 'adjustment.rejected',
          completed: 'adjustment.completed',
          cancelled: 'adjustment.cancelled',
        };
        const staffAction = STATE_ACTION_MAP[nextState];
        if (staffAction) {
          const STATE_LABEL_AR: Record<AdjustmentState, string> = {
            pending: 'قيد المراجعة',
            approved: 'تمت الموافقة',
            rejected: 'مرفوضة',
            completed: 'منفذة',
            cancelled: 'ملغاة',
          };
          await writeStaffAuditLog(supabase, {
            action: staffAction,
            actorId: user?.id ?? null,
            actorName: decidedByName,
            actorRoleId: currentRoleId ?? null,
            entity: {
              type: 'adjustment',
              id: adjustment.id,
              label: `${ADJUSTMENT_KIND_LABEL_AR[adjustment.kind]} — #${adjustment.order_num}`,
            },
            description: `${STATE_LABEL_AR[nextState]} — ${ADJUSTMENT_KIND_LABEL_AR[adjustment.kind]} للطلب #${adjustment.order_num}`,
            metadata: {
              adjustment_id: adjustment.id,
              order_id: adjustment.order_id,
              order_num: adjustment.order_num,
              before: adjustment.state,
              after: nextState,
              kind: adjustment.kind,
              ...(childOrderNum ? { child_order_num: childOrderNum } : {}),
              ...(linkedComplaintId ? { linked_complaint_id: linkedComplaintId } : {}),
              ...(decisionNote?.trim() ? { decision_note: decisionNote.trim() } : {}),
              ...(childCascadeCancelled ? { child_order_cascade_cancelled: true } : {}),
            },
          });
        }
      } catch (auditErr) {
        console.warn('[OrderDetailModal] staff audit decision failed:', auditErr);
      }

      // Phase Inventory-Returns-Stock-1 — when a return adjustment
      // is COMPLETED (physical goods received), apply the per-line
      // stock dispositions. We fire only on transitions INTO
      // `completed`, only for `return_*` kinds, and only for lines
      // marked `return_to_stock` with an inventory id. The helper is
      // idempotent: a second completion attempt skips any line whose
      // `return_in` movement is already on the ledger.
      let returnStockResult: Awaited<ReturnType<typeof applyReturnStockEffects>> | null = null;
      if (
        nextState === 'completed' &&
        (adjustment.kind === 'return_full' || adjustment.kind === 'return_partial')
      ) {
        try {
          returnStockResult = await applyReturnStockEffects({
            supabase,
            adjustment,
            actorName: decidedByName,
          });
          // Per-line outcome bundle goes into staff audit. Success
          // (any applied) and warning (any failed) get separate rows
          // so the audit timeline shows actionable signal.
          if (returnStockResult.failedCount > 0) {
            try {
              await writeStaffAuditLog(supabase, {
                action: 'inventory.return_stock_failed',
                actorId: user?.id ?? null,
                actorName: decidedByName,
                actorRoleId: currentRoleId ?? null,
                entity: {
                  type: 'adjustment',
                  id: adjustment.id,
                  label: `${ADJUSTMENT_KIND_LABEL_AR[adjustment.kind]} — #${adjustment.order_num}`,
                },
                description: `فشل إرجاع ${returnStockResult.failedCount} سطر إلى المخزون من المرتجع #${adjustment.order_num}`,
                metadata: {
                  adjustment_id: adjustment.id,
                  order_id: adjustment.order_id,
                  order_num: adjustment.order_num,
                  applied_count: returnStockResult.appliedCount,
                  total_applied_quantity: returnStockResult.totalAppliedQuantity,
                  skipped_count: returnStockResult.skippedCount,
                  failed_count: returnStockResult.failedCount,
                  outcomes: returnStockResult.outcomes,
                },
              });
            } catch (auditErr) {
              console.warn('[OrderDetailModal] return_stock_failed audit skipped:', auditErr);
            }
            toast.warning(
              `تم إكمال المرتجع، لكن فشل إرجاع ${returnStockResult.failedCount} سطر إلى المخزون. راجع السجل.`
            );
          }
          if (returnStockResult.appliedCount > 0) {
            try {
              await writeStaffAuditLog(supabase, {
                action: 'inventory.return_stock_applied',
                actorId: user?.id ?? null,
                actorName: decidedByName,
                actorRoleId: currentRoleId ?? null,
                entity: {
                  type: 'adjustment',
                  id: adjustment.id,
                  label: `${ADJUSTMENT_KIND_LABEL_AR[adjustment.kind]} — #${adjustment.order_num}`,
                },
                description: `تم إرجاع ${returnStockResult.appliedCount} سطر (${returnStockResult.totalAppliedQuantity} قطعة) إلى المخزون من المرتجع #${adjustment.order_num}`,
                metadata: {
                  adjustment_id: adjustment.id,
                  order_id: adjustment.order_id,
                  order_num: adjustment.order_num,
                  applied_count: returnStockResult.appliedCount,
                  total_applied_quantity: returnStockResult.totalAppliedQuantity,
                  skipped_count: returnStockResult.skippedCount,
                  failed_count: returnStockResult.failedCount,
                  outcomes: returnStockResult.outcomes,
                },
              });
            } catch (auditErr) {
              console.warn('[OrderDetailModal] return_stock_applied audit skipped:', auditErr);
            }
          }
        } catch (returnStockErr) {
          console.error('[OrderDetailModal] applyReturnStockEffects threw:', returnStockErr);
          toast.warning(
            'تم إكمال المرتجع، لكن حدث خطأ في تطبيق تأثير المخزون. راجع المخزون يدويًا.'
          );
        }
      }

      // Phase Inventory-Exchange-Stock-1 — sibling to the return
      // stock block. When an EXCHANGE adjustment is completed, the
      // helper fires both legs: returned items → `exchange_in`
      // (positive delta), replacement items → `exchange_out`
      // (negative delta). Both legs are idempotent per-line and
      // gated by inventory identity. Errors on one leg do not abort
      // the other; the audit row captures every outcome.
      let exchangeStockResult: Awaited<ReturnType<typeof applyExchangeStockEffects>> | null = null;
      if (
        nextState === 'completed' &&
        (adjustment.kind === 'exchange_full' || adjustment.kind === 'exchange_partial')
      ) {
        try {
          exchangeStockResult = await applyExchangeStockEffects({
            supabase,
            adjustment,
            actorName: decidedByName,
          });
          if (exchangeStockResult.failedCount > 0) {
            try {
              await writeStaffAuditLog(supabase, {
                action: 'inventory.exchange_stock_failed',
                actorId: user?.id ?? null,
                actorName: decidedByName,
                actorRoleId: currentRoleId ?? null,
                entity: {
                  type: 'adjustment',
                  id: adjustment.id,
                  label: `${ADJUSTMENT_KIND_LABEL_AR[adjustment.kind]} — #${adjustment.order_num}`,
                },
                description: `فشل تطبيق ${exchangeStockResult.failedCount} حركة استبدال على المخزون للطلب #${adjustment.order_num}`,
                metadata: {
                  adjustment_id: adjustment.id,
                  order_id: adjustment.order_id,
                  order_num: adjustment.order_num,
                  exchange_in_count: exchangeStockResult.exchangeInCount,
                  exchange_out_count: exchangeStockResult.exchangeOutCount,
                  total_in_quantity: exchangeStockResult.totalInQuantity,
                  total_out_quantity: exchangeStockResult.totalOutQuantity,
                  skipped_count: exchangeStockResult.skippedCount,
                  failed_count: exchangeStockResult.failedCount,
                  outcomes: exchangeStockResult.outcomes,
                },
              });
            } catch (auditErr) {
              console.warn('[OrderDetailModal] exchange_stock_failed audit skipped:', auditErr);
            }
            toast.warning(
              `تم إكمال الاستبدال، لكن فشل تطبيق ${exchangeStockResult.failedCount} حركة على المخزون. راجع السجل.`
            );
          }
          if (exchangeStockResult.exchangeInCount > 0 || exchangeStockResult.exchangeOutCount > 0) {
            try {
              await writeStaffAuditLog(supabase, {
                action: 'inventory.exchange_stock_applied',
                actorId: user?.id ?? null,
                actorName: decidedByName,
                actorRoleId: currentRoleId ?? null,
                entity: {
                  type: 'adjustment',
                  id: adjustment.id,
                  label: `${ADJUSTMENT_KIND_LABEL_AR[adjustment.kind]} — #${adjustment.order_num}`,
                },
                description: `تم تطبيق ${exchangeStockResult.exchangeInCount} رجوع و ${exchangeStockResult.exchangeOutCount} خروج بديل للاستبدال #${adjustment.order_num}`,
                metadata: {
                  adjustment_id: adjustment.id,
                  order_id: adjustment.order_id,
                  order_num: adjustment.order_num,
                  exchange_in_count: exchangeStockResult.exchangeInCount,
                  exchange_out_count: exchangeStockResult.exchangeOutCount,
                  total_in_quantity: exchangeStockResult.totalInQuantity,
                  total_out_quantity: exchangeStockResult.totalOutQuantity,
                  skipped_count: exchangeStockResult.skippedCount,
                  failed_count: exchangeStockResult.failedCount,
                  outcomes: exchangeStockResult.outcomes,
                },
              });
            } catch (auditErr) {
              console.warn('[OrderDetailModal] exchange_stock_applied audit skipped:', auditErr);
            }
          }
        } catch (exchangeStockErr) {
          console.error('[OrderDetailModal] applyExchangeStockEffects threw:', exchangeStockErr);
          toast.warning(
            'تم إكمال الاستبدال، لكن حدث خطأ في تطبيق تأثيرات المخزون. راجع المخزون يدويًا.'
          );
        }
      }

      toast.success(
        nextState === 'approved' && childOrderNum
          ? `تمت الموافقة، وإنشاء الطلب الفرعي #${childOrderNum}`
          : nextState === 'completed' && returnStockResult && returnStockResult.appliedCount > 0
            ? `تم إكمال المرتجع وإرجاع ${returnStockResult.totalAppliedQuantity} قطعة إلى المخزون.`
            : nextState === 'completed' &&
                exchangeStockResult &&
                (exchangeStockResult.exchangeInCount > 0 ||
                  exchangeStockResult.exchangeOutCount > 0)
              ? `تم إكمال الاستبدال وتحديث المخزون (دخول ${exchangeStockResult.totalInQuantity}، خروج ${exchangeStockResult.totalOutQuantity}).`
              : childCascadeCancelled && childOrderNum
                ? `تم تحديث حالة التسوية، وإلغاء الطلب الفرعي #${childOrderNum}.`
                : 'تم تحديث حالة التسوية.'
      );
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('turath_masr_order_adjustments_updated'));
        window.dispatchEvent(new Event('turath_masr_orders_updated'));
        window.dispatchEvent(new Event('turath_masr_audit_updated'));
      }
    } catch (err) {
      console.error('[OrderDetailModal] adjustment decision failed:', err);
      toast.error('حدث خطأ غير متوقع.');
    } finally {
      setAdjustmentBusyId(null);
    }
  };

  const handlePrintInvoice = () => {
    const win = window.open('', '_blank', 'width=800,height=600');
    if (!win) {
      toast.error('يرجى السماح بالنوافذ المنبثقة في إعدادات المتصفح');
      return;
    }
    const warrantyRow =
      liveOrder.warranty && liveOrder.warranty !== 'بدون ضمان'
        ? `<tr><td colspan="3">فترة الضمان</td><td>—</td><td>${liveOrder.warranty}</td></tr>`
        : '';

    const productRows =
      liveOrder.lines && liveOrder.lines.length > 0
        ? liveOrder.lines
            .map((line) => {
              // Phase Egress-Fix1 — resolve through helper so this
              // path handles legacy data URLs, the inventory-thumbnail
              // pointer, and the storage proxy uniformly.
              const imgUrl = resolveLineImageUrl(line);
              const imgHtml = imgUrl
                ? `<img src="${imgUrl}" alt="${line.label}" style="width:40px;height:40px;object-fit:cover;border-radius:6px;border:1px solid #e5e7eb;" />`
                : `<span style="font-size:24px;">${line.emoji || '📦'}</span>`;
              const noteHtml = line.note
                ? `<br/><span style="font-size:11px;color:#d97706;font-style:italic;">ملاحظة: ${line.note}</span>`
                : '';
              const colorHtml = line.color ? ` (${line.color})` : '';
              const flashHtml = line.includeFlashlight ? ' + كشاف' : '';
              return `<tr>
            <td style="display:flex;align-items:center;gap:10px;padding:10px 12px;">
              ${imgHtml}
              <div>
                <strong>${line.label}${colorHtml}${flashHtml}</strong>${noteHtml}
              </div>
            </td>
            <td>${line.quantity}</td>
            <td>${line.unitPrice.toLocaleString('en-US')} ج.م</td>
            <td>${line.total.toLocaleString('en-US')} ج.م</td>
          </tr>`;
            })
            .join('')
        : `<tr><td>${liveOrder.products}</td><td>${liveOrder.quantity}</td><td>—</td><td>${liveOrder.subtotal.toLocaleString('en-US')} ج.م</td></tr>`;

    win.document.write(`
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8" />
        <title>فاتورة - ${liveOrder.orderNum}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; direction: rtl; background: #fff; color: #1a1a1a; }
          .invoice-wrap { max-width: 700px; margin: 0 auto; padding: 20px; }
          .inv-header { background: #1e3a5f; color: white; padding: 24px; text-align: center; border-radius: 12px 12px 0 0; }
          .inv-header h1 { font-size: 26px; font-weight: 800; }
          .inv-header p { font-size: 13px; opacity: 0.8; margin-top: 4px; }
          .inv-body { border: 2px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px; padding: 24px; }
          .inv-meta { display: flex; justify-content: space-between; border-bottom: 1px solid #e5e7eb; padding-bottom: 16px; margin-bottom: 16px; }
          .inv-meta div p:first-child { font-size: 11px; color: #6b7280; margin-bottom: 4px; }
          .inv-meta div p:last-child { font-weight: 700; font-size: 14px; }
          .section-title { font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
          .customer-info { margin-bottom: 16px; }
          .customer-info p { font-size: 14px; margin-bottom: 4px; }
          .customer-info .name { font-size: 18px; font-weight: 700; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
          th { background: #f3f4f6; padding: 10px 12px; text-align: right; font-size: 12px; font-weight: 700; color: #374151; }
          td { padding: 10px 12px; border-bottom: 1px solid #f3f4f6; font-size: 13px; vertical-align: middle; }
          .total-row { background: #eff6ff; }
          .total-row td { font-weight: 700; font-size: 16px; color: #1e3a5f; }
          .warranty-row { background: #f0fdf4; }
          .warranty-row td { color: #166534; font-weight: 600; }
          .tracking-box { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 12px; margin-bottom: 16px; }
          .tracking-box p { font-size: 12px; color: #1e40af; }
          .tracking-box a { font-size: 13px; color: #1d4ed8; font-weight: 700; word-break: break-all; }
          .footer { text-align: center; font-size: 12px; color: #9ca3af; margin-top: 20px; padding-top: 16px; border-top: 1px solid #e5e7eb; }
          @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
        </style>
      </head>
      <body>
        <div class="invoice-wrap">
          <div class="inv-header">
            <h1>Turath Masr</h1>
            <p>فاتورة ضريبية مبسطة</p>
          </div>
          <div class="inv-body">
            <div class="inv-meta">
              <div><p>رقم الفاتورة</p><p>${liveOrder.orderNum}</p></div>
              <div><p>تاريخ الإصدار</p><p>${liveOrder.day} ${liveOrder.date}</p></div>
              <div><p>الوقت</p><p>${liveOrder.time}</p></div>
            </div>
            <div class="customer-info">
              <p class="section-title">بيانات العميل</p>
              <p class="name">${liveOrder.customer}</p>
              <p>${liveOrder.phone}${liveOrder.phone2 ? ' / ' + liveOrder.phone2 : ''}</p>
              <p>${liveOrder.region}${liveOrder.district ? ' - ' + liveOrder.district : ''}${liveOrder.neighborhood ? ' - ' + liveOrder.neighborhood : ''} — ${liveOrder.address}</p>
            </div>
            <div class="tracking-box">
              <p>رابط تتبع الشحنة:</p>
              <a href="${trackingLink}">${trackingLink}</a>
            </div>
            <p class="section-title">المنتجات</p>
            <table>
              <thead><tr><th>المنتج</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead>
              <tbody>
                ${productRows}
                <tr><td>${shippingLabel}</td><td>—</td><td>—</td><td>${liveOrder.shippingFee.toLocaleString('en-US')} ج.م</td></tr>
                ${extraFee > 0 ? `<tr><td>مصاريف شحن إضافية</td><td>—</td><td>—</td><td>${extraFee.toLocaleString('en-US')} ج.م</td></tr>` : ''}
                ${checkoutLines.map((line) => `<tr><td colspan="4">${line}</td></tr>`).join('')}
                ${warrantyRow}
                <tr class="total-row"><td colspan="3"><strong>الإجمالي الكلي</strong></td><td><strong>${liveOrder.total.toLocaleString('en-US')} ج.م</strong></td></tr>
              </tbody>
            </table>
            ${printableNotes ? `<p style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px;font-size:13px;"><strong>ملاحظات:</strong> ${printableNotes}</p>` : ''}
            <div class="footer">شكرا لثقتك في Turath Masr — للاستفسار: info@turath_masr.com</div>
          </div>
        </div>
        <script>window.onload = function(){ window.print(); }<\/script>
      </body>
      </html>
    `);
    win.document.close();
    toast.success('جاري فتح نافذة الطباعة / PDF...');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir="rtl">
      <Toaster position="top-center" richColors />
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-3xl shadow-modal w-full max-w-2xl max-h-[90vh] flex flex-col fade-in">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[hsl(var(--primary))]/10 rounded-xl flex items-center justify-center">
              <FileText size={20} className="text-[hsl(var(--primary))]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-[hsl(var(--foreground))]">
                  {liveOrder.orderNum}
                </h3>
                <span className={`badge ${statusInfo.cls}`}>{statusInfo.label}</span>
              </div>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5 font-mono">
                {liveOrder.day} {liveOrder.date} — {liveOrder.time}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-[hsl(var(--muted))] transition-colors"
            aria-label="إغلاق"
          >
            <X size={16} />
          </button>
        </div>

        {/* Quick actions */}
        <div className="flex gap-2 px-5 py-3 bg-[hsl(var(--muted))]/30 border-b border-[hsl(var(--border))] flex-wrap">
          <button
            onClick={handleSendWhatsApp}
            className="flex items-center gap-1.5 bg-green-500 hover:bg-green-600 text-white text-xs px-3 py-1.5 rounded-xl font-semibold transition-colors"
          >
            <MessageCircle size={13} />
            إرسال واتساب + تتبع
          </button>
          <button
            onClick={handleSendEmail}
            className="flex items-center gap-1.5 bg-blue-500 hover:bg-blue-600 text-white text-xs px-3 py-1.5 rounded-xl font-semibold transition-colors"
          >
            <Mail size={13} />
            إرسال بريد
          </button>
          <button
            onClick={handleCopyTracking}
            className="flex items-center gap-1.5 bg-purple-500 hover:bg-purple-600 text-white text-xs px-3 py-1.5 rounded-xl font-semibold transition-colors"
          >
            <Link size={13} />
            نسخ رابط التتبع
          </button>
          <button
            onClick={handlePrintInvoice}
            className="flex items-center gap-1.5 btn-secondary text-xs py-1.5"
          >
            <Printer size={13} />
            طباعة / PDF
          </button>
          {/* Phase Orders-Edit-1 — edit button gated by `edit_orders`.
              Sits before the adjustment button so the natural read of
              action order is: print → edit → adjustment. Disabled
              callers see the tooltip explanation rather than a
              missing button so they know who to contact. */}
          {canEditOrder ? (
            <button
              onClick={() => setShowEditModal(true)}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-3 py-1.5 rounded-xl font-semibold transition-colors"
            >
              <Edit2 size={13} />
              تعديل الطلب
            </button>
          ) : (
            <button
              disabled
              title="ليس لديك صلاحية تعديل الطلب"
              className="flex items-center gap-1.5 bg-slate-200 text-slate-400 text-xs px-3 py-1.5 rounded-xl font-semibold cursor-not-allowed"
            >
              <Edit2 size={13} />
              تعديل الطلب
            </button>
          )}
          {/* Phase 25A — returns & exchanges entry point. Shown only
              when the order is `delivered` and the current role is
              allowed to raise an adjustment. */}
          {isOrderAdjustable(liveOrder.status) && canCreateAdjustment && (
            <button
              onClick={() => setShowAdjustmentModal(true)}
              className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs px-3 py-1.5 rounded-xl font-semibold transition-colors"
            >
              <RotateCcw size={13} />
              إنشاء مرتجع / استبدال
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="border-b border-[hsl(var(--border))] px-4 py-3">
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
            {/* Phase Orders-Admin-Actions-1 — `tab-chat` (محادثة الطلب) and
                `tab-history` (سجل الحالات) are strict admin-only. CS-side
                conversations remain available via /crm/customer/<phone> and
                /customers/returns-exchanges; non-admins see the other 3 tabs. */}
            {TABS.filter(
              (tab) => perms.isAdmin || (tab.id !== 'tab-chat' && tab.id !== 'tab-history')
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`min-h-10 rounded-xl border px-3 py-2 text-xs sm:text-sm font-semibold transition-colors text-center leading-snug ${
                  activeTab === tab.id
                    ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]'
                    : 'border-[hsl(var(--border))] bg-white text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]/40'
                }`}
              >
                <span>{tab.label}</span>
                {perms.isAdmin && tab.id === 'tab-history' && timelineItems.length > 0 && (
                  <span className="mr-1.5 inline-flex min-w-5 justify-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                    {timelineItems.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-5 scrollbar-thin">
          {/* Details Tab */}
          {activeTab === 'tab-details' && (
            <div className="space-y-5 fade-in">
              {/* Phase 22Q — current delivery schedule. Shown only
                  when an admin has actually set a date (the row in
                  Supabase has `scheduled_delivery_date IS NOT NULL`);
                  otherwise the section stays hidden so existing
                  orders without a schedule don't render an awkward
                  empty card. The data flows through the
                  `select('*')` reader at line ~200 and the row
                  mapper above. */}
              {liveOrder.scheduledDeliveryDate && (
                <div className="card-section p-4 bg-emerald-50/30 border border-emerald-200">
                  <div className="flex items-center gap-2 mb-3">
                    <Clock size={15} className="text-emerald-700" />
                    <h4 className="text-sm font-bold text-emerald-800">موعد التسليم المتوقع</h4>
                  </div>
                  <p className="text-sm font-semibold text-[hsl(var(--foreground))]">
                    {formatScheduleDateAr(liveOrder.scheduledDeliveryDate)}
                  </p>
                  {liveOrder.scheduledDeliveryFrom && liveOrder.scheduledDeliveryTo && (
                    <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                      من الساعة{' '}
                      <span className="font-semibold text-[hsl(var(--foreground))]">
                        {formatTime12hAr(liveOrder.scheduledDeliveryFrom)}
                      </span>{' '}
                      إلى الساعة{' '}
                      <span className="font-semibold text-[hsl(var(--foreground))]">
                        {formatTime12hAr(liveOrder.scheduledDeliveryTo)}
                      </span>
                    </p>
                  )}
                  {liveOrder.scheduledDeliveryReason && (
                    <p className="text-xs text-orange-700 mt-2">
                      <span className="font-bold">سبب الترحيل:</span>{' '}
                      <span className="italic">{liveOrder.scheduledDeliveryReason}</span>
                    </p>
                  )}
                  {liveOrder.scheduledDeliveryUpdatedBy && (
                    <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-2">
                      آخر تعديل بواسطة:{' '}
                      <span className="font-semibold">{liveOrder.scheduledDeliveryUpdatedBy}</span>
                    </p>
                  )}
                </div>
              )}

              <div className="card-section p-4">
                <div className="flex items-center gap-2 mb-3">
                  <User size={15} className="text-[hsl(var(--primary))]" />
                  <h4 className="text-sm font-bold">بيانات العميل</h4>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-[11px] text-[hsl(var(--muted-foreground))] mb-0.5">الاسم</p>
                    <p className="font-semibold">{liveOrder.customer}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-[hsl(var(--muted-foreground))] mb-0.5">
                      المنطقة
                    </p>
                    <p className="font-semibold">
                      {liveOrder.region}
                      {liveOrder.district ? ` - ${liveOrder.district}` : ''}
                      {liveOrder.neighborhood ? ` - ${liveOrder.neighborhood}` : ''}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-[hsl(var(--muted-foreground))] mb-0.5 flex items-center gap-1">
                      <Phone size={10} /> الموبايل
                    </p>
                    <p className="font-mono font-semibold">{liveOrder.phone}</p>
                  </div>
                  {liveOrder.phone2 && (
                    <div>
                      <p className="text-[11px] text-[hsl(var(--muted-foreground))] mb-0.5">
                        موبايل إضافي
                      </p>
                      <p className="font-mono">{liveOrder.phone2}</p>
                    </div>
                  )}
                  <div className="col-span-2">
                    <p className="text-[11px] text-[hsl(var(--muted-foreground))] mb-0.5 flex items-center gap-1">
                      <MapPin size={10} /> العنوان
                    </p>
                    <p className="leading-relaxed">{liveOrder.address}</p>
                  </div>
                </div>
              </div>

              <div className="card-section p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Package size={15} className="text-[hsl(var(--primary))]" />
                  <h4 className="text-sm font-bold">المنتجات</h4>
                </div>
                {liveOrder.lines && liveOrder.lines.length > 0 ? (
                  <div className="space-y-2">
                    {liveOrder.lines.map((line, idx) => {
                      // Phase Egress-Fix1 — resolve image through helper.
                      const imgUrl = resolveLineImageUrl(line);
                      return (
                        <div
                          key={`detail-line-${idx}`}
                          className="flex items-center gap-3 bg-[hsl(var(--muted))]/40 rounded-xl p-3 border border-[hsl(var(--border))]"
                        >
                          <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 bg-white border border-[hsl(var(--border))] flex items-center justify-center">
                            {imgUrl ? (
                              <Image
                                src={imgUrl}
                                alt={line.label}
                                width={48}
                                height={48}
                                className="w-full h-full object-cover"
                                unoptimized
                              />
                            ) : (
                              <span className="text-2xl">{line.emoji || '📦'}</span>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-[hsl(var(--foreground))] truncate">
                              {line.label}
                              {line.color ? ` — ${line.color}` : ''}
                              {line.includeFlashlight ? ' + كشاف' : ''}
                            </p>
                            {line.note && (
                              <p className="text-xs text-amber-600 italic mt-0.5">
                                ملاحظة: {line.note}
                              </p>
                            )}
                            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                              {line.quantity} × {line.unitPrice.toLocaleString('en-US')} ج.م
                            </p>
                          </div>
                          <div className="text-left flex-shrink-0">
                            <p className="text-sm font-bold font-mono text-[hsl(var(--primary))]">
                              {line.total.toLocaleString('en-US')} ج.م
                            </p>
                          </div>
                        </div>
                      );
                    })}
                    {liveOrder.warranty && liveOrder.warranty !== 'بدون ضمان' && (
                      <div className="flex items-center gap-1.5 mt-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-2 py-1 w-fit">
                        <Clock size={11} />
                        <span>
                          فترة الضمان: <strong>{liveOrder.warranty}</strong>
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-[hsl(var(--muted))]/40 rounded-xl p-3">
                    <p className="text-sm font-medium">{liveOrder.products}</p>
                    <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                      إجمالي الكمية: {liveOrder.quantity} قطعة
                    </p>
                    {liveOrder.warranty && liveOrder.warranty !== 'بدون ضمان' && (
                      <div className="flex items-center gap-1.5 mt-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-2 py-1 w-fit">
                        <Clock size={11} />
                        <span>
                          فترة الضمان: <strong>{liveOrder.warranty}</strong>
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="card-section p-4">
                <div className="flex items-center gap-2 mb-3">
                  <FileText size={15} className="text-[hsl(var(--primary))]" />
                  <h4 className="text-sm font-bold">الملخص المالي</h4>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between py-1.5 border-b border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--muted-foreground))]">المنتجات:</span>
                    <span className="font-mono font-semibold">
                      {liveOrder.subtotal.toLocaleString('en-US')} ج.م
                    </span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--muted-foreground))]">
                      {shippingLabel}:
                      {liveOrder.expressShipping && (
                        <span className="text-[10px] text-amber-600 mr-1">
                          (بدلاً من الشحن الافتراضي)
                        </span>
                      )}
                    </span>
                    <span
                      className={`font-mono ${liveOrder.expressShipping ? 'text-amber-700 font-semibold' : ''}`}
                    >
                      {liveOrder.shippingFee.toLocaleString('en-US')} ج.م
                    </span>
                  </div>
                  {IS_ADMIN && extraFee > 0 && (
                    <div className="flex justify-between py-1.5 border-b border-[hsl(var(--border))] text-orange-700">
                      <span>مصاريف شحن إضافية (أدمن):</span>
                      <span className="font-mono">+ {extraFee.toLocaleString('en-US')} ج.م</span>
                    </div>
                  )}
                  {checkoutLines.map((line) => (
                    <div
                      key={line}
                      className="flex justify-between gap-3 py-1.5 border-b border-[hsl(var(--border))] text-blue-700"
                    >
                      <span>{line}</span>
                    </div>
                  ))}
                  <div className="flex justify-between py-1.5">
                    <span className="font-bold">الإجمالي الكلي:</span>
                    <span className="font-mono font-bold text-lg text-[hsl(var(--primary))]">
                      {liveOrder.total.toLocaleString('en-US')} ج.م
                    </span>
                  </div>
                </div>
              </div>

              <div className="border border-amber-200 bg-amber-50 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <FileText size={14} className="text-amber-600" />
                  <div>
                    <h4 className="text-sm font-bold text-amber-800">ملاحظات الطلب</h4>
                    <p className="text-[11px] text-amber-700 mt-0.5">
                      ملاحظات داخلية مرتبطة بهذا الطلب، وتظهر أيضًا ضمن سجل الحالات.
                    </p>
                  </div>
                </div>
                {customerNotes ? (
                  <p className="text-sm text-[hsl(var(--foreground))] whitespace-pre-wrap leading-relaxed bg-white border border-amber-100 rounded-xl p-3">
                    {customerNotes}
                  </p>
                ) : (
                  <p className="text-sm text-[hsl(var(--muted-foreground))] bg-white border border-amber-100 rounded-xl p-3">
                    لا توجد ملاحظات مسجلة لهذا الطلب.
                  </p>
                )}

                {IS_ADMIN && (
                  <div className="mt-3 border-t border-amber-200 pt-3">
                    <button
                      type="button"
                      onClick={() => setShowTechnicalDetails((value) => !value)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-100"
                    >
                      <Shield size={12} />
                      بيانات تقنية
                    </button>

                    {showTechnicalDetails && (
                      <div>
                        <p className="mt-2 text-[11px] text-amber-700">
                          بيانات فنية للمتابعة الداخلية فقط. الحقول غير المتاحة تظهر كغير مسجلة.
                        </p>
                        <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                          <div className="bg-white rounded-lg p-2.5 border border-amber-100">
                            <p className="text-[hsl(var(--muted-foreground))] mb-1">المسجِّل</p>
                            <p className="font-semibold">{liveOrder.createdBy || 'غير مسجل'}</p>
                          </div>
                          <div className="bg-white rounded-lg p-2.5 border border-amber-100">
                            <p className="text-[hsl(var(--muted-foreground))] mb-1">
                              IP وقت التسجيل
                            </p>
                            <p className="font-mono">
                              {liveOrder.createdByIp || liveOrder.ip || 'غير مسجل'}
                            </p>
                          </div>
                          <div className="bg-white rounded-lg p-2.5 border border-amber-100">
                            <p className="text-[hsl(var(--muted-foreground))] mb-1 flex items-center gap-1">
                              <MapPin size={10} /> الموقع
                            </p>
                            <p className="font-semibold">
                              {liveOrder.createdByLocation || 'غير مسجل'}
                            </p>
                          </div>
                          <div className="bg-white rounded-lg p-2.5 border border-amber-100">
                            <p className="text-[hsl(var(--muted-foreground))] mb-1 flex items-center gap-1">
                              <Monitor size={10} /> الجهاز
                            </p>
                            <p className="font-semibold flex items-center gap-1">
                              <DeviceIcon device={liveOrder.createdByDevice} />
                              {liveOrder.createdByDevice || 'غير مسجل'}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Phase 25A — Returns & Exchanges section. Only shown
                  when at least one adjustment exists OR the order is
                  eligible to receive one. */}
              {(adjustments.length > 0 || isOrderAdjustable(liveOrder.status)) && (
                <div className="card-section p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <RotateCcw size={15} className="text-amber-600" />
                      <h4 className="text-sm font-bold">المرتجعات والاستبدالات</h4>
                      {adjustments.length > 0 && (
                        <span className="text-[10px] bg-[hsl(var(--muted))]/60 px-2 py-0.5 rounded-full font-bold">
                          {adjustments.length}
                        </span>
                      )}
                    </div>
                    {isOrderAdjustable(liveOrder.status) && canCreateAdjustment && (
                      <button
                        onClick={() => setShowAdjustmentModal(true)}
                        className="text-xs text-[hsl(var(--primary))] hover:underline flex items-center gap-1"
                      >
                        <RotateCcw size={11} /> طلب جديد
                      </button>
                    )}
                  </div>
                  {adjustments.length === 0 ? (
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">
                      لا توجد تسويات مسجلة لهذا الطلب.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {adjustments.map((adj) => {
                        const nextStates = allowedNextStates(adj.state);
                        const actionable = isAdjustmentActionable(adj.state) && canDecideAdjustment;
                        return (
                          <div
                            key={adj.id}
                            className="rounded-xl border border-[hsl(var(--border))] p-3 bg-white"
                          >
                            <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${ADJUSTMENT_KIND_TONE[adj.kind]}`}
                                >
                                  {ADJUSTMENT_KIND_LABEL_AR[adj.kind]}
                                </span>
                                <span
                                  className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${ADJUSTMENT_STATE_TONE[adj.state]}`}
                                >
                                  {ADJUSTMENT_STATE_LABEL_AR[adj.state]}
                                </span>
                              </div>
                              <span className="text-[11px] text-[hsl(var(--muted-foreground))] font-mono">
                                {new Date(adj.created_at).toLocaleString('en-GB')}
                              </span>
                            </div>
                            <p className="text-sm">
                              <span className="font-bold">السبب: </span>
                              <span className="text-[hsl(var(--foreground))]">{adj.reason}</span>
                            </p>
                            {/* Phase 25B — child order + complaint quick links */}
                            {(adj.child_order_num || adj.linked_complaint_id) && (
                              <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px]">
                                {adj.child_order_num && (
                                  <span className="inline-flex items-center gap-1 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-full px-2 py-0.5 font-bold">
                                    <RotateCcw size={10} />
                                    الطلب الفرعي #{adj.child_order_num}
                                  </span>
                                )}
                                {adj.linked_complaint_id && (
                                  <span className="inline-flex items-center gap-1 bg-amber-50 border border-amber-200 text-amber-700 rounded-full px-2 py-0.5 font-bold">
                                    شكوى مرتبطة
                                  </span>
                                )}
                              </div>
                            )}
                            <div className="grid grid-cols-2 gap-2 mt-2 text-[11px]">
                              <div className="text-[hsl(var(--muted-foreground))]">
                                <span className="font-bold">الاسترداد: </span>
                                {REFUND_MODE_LABEL_AR[adj.refund_mode]} —{' '}
                                <span className="font-mono">
                                  {Number(adj.refund_amount).toLocaleString('en-US')} ج.م
                                </span>
                              </div>
                              <div className="text-[hsl(var(--muted-foreground))]">
                                <span className="font-bold">الشحن: </span>
                                {adj.shipping_payer === 'split'
                                  ? `العميل ${Number(adj.shipping_customer_amount ?? 0).toLocaleString('en-US')} ج.م / الشركة ${Number(adj.shipping_company_amount ?? 0).toLocaleString('en-US')} ج.م`
                                  : SHIPPING_PAYER_LABEL_AR[adj.shipping_payer]}
                              </div>
                              {Number(adj.price_difference) !== 0 && (
                                <div
                                  className={`col-span-2 ${
                                    adj.price_difference_direction === 'customer_pays'
                                      ? 'text-amber-700'
                                      : adj.price_difference_direction === 'company_refunds'
                                        ? 'text-emerald-700'
                                        : 'text-[hsl(var(--muted-foreground))]'
                                  }`}
                                >
                                  <span className="font-bold">فرق السعر: </span>
                                  <span className="font-mono">
                                    {Math.abs(Number(adj.price_difference)).toLocaleString('en-US')}{' '}
                                    ج.م
                                  </span>
                                  {adj.price_difference_direction
                                    ? ` — ${PRICE_DIFFERENCE_DIRECTION_LABEL_AR[adj.price_difference_direction]}`
                                    : Number(adj.price_difference) > 0
                                      ? ' (يدفعه العميل)'
                                      : ' (يرد للعميل)'}
                                </div>
                              )}
                              {/* Phase 25B — delegate collection breakdown */}
                              {(adj.customer_collect_amount ?? 0) > 0 && (
                                <div className="col-span-2 text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-2 py-1">
                                  <span className="font-bold">إجمالي التحصيل من العميل: </span>
                                  <span className="font-mono font-bold">
                                    {Number(adj.customer_collect_amount).toLocaleString('en-US')}{' '}
                                    ج.م
                                  </span>
                                </div>
                              )}
                              <div className="col-span-2 text-[hsl(var(--muted-foreground))]">
                                <span className="font-bold">أنشأ بواسطة: </span>
                                {adj.created_by || '—'}
                                {adj.decided_by && (
                                  <>
                                    <span className="mx-1">•</span>
                                    <span className="font-bold">قرار: </span>
                                    {adj.decided_by}
                                    {adj.decided_at && (
                                      <span className="font-mono ml-1">
                                        ({new Date(adj.decided_at).toLocaleDateString('en-GB')})
                                      </span>
                                    )}
                                  </>
                                )}
                              </div>
                              {adj.notes && (
                                <div className="col-span-2 text-[hsl(var(--muted-foreground))]">
                                  <span className="font-bold">ملاحظات: </span>
                                  <span className="italic">{adj.notes}</span>
                                </div>
                              )}
                              {adj.operational_note && (
                                <div className="col-span-2 text-[hsl(var(--muted-foreground))]">
                                  <span className="font-bold">تعليمات للمندوب: </span>
                                  <span className="italic">{adj.operational_note}</span>
                                </div>
                              )}
                              {adj.decision_note && (
                                <div className="col-span-2 text-[hsl(var(--muted-foreground))]">
                                  <span className="font-bold">ملاحظة القرار: </span>
                                  <span className="italic">{adj.decision_note}</span>
                                </div>
                              )}
                            </div>
                            {actionable && (
                              <div className="flex flex-wrap gap-2 mt-3">
                                {nextStates.includes('approved') && (
                                  <button
                                    disabled={adjustmentBusyId === adj.id}
                                    onClick={() => handleAdjustmentDecision(adj, 'approved')}
                                    className="text-xs px-3 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white font-semibold disabled:opacity-50 flex items-center gap-1"
                                  >
                                    <CheckCircle size={12} /> الموافقة
                                  </button>
                                )}
                                {nextStates.includes('rejected') && (
                                  <button
                                    disabled={adjustmentBusyId === adj.id}
                                    onClick={() => {
                                      const note =
                                        window.prompt('سبب الرفض (اختياري):') ?? undefined;
                                      handleAdjustmentDecision(adj, 'rejected', note);
                                    }}
                                    className="text-xs px-3 py-1.5 rounded-lg bg-slate-500 hover:bg-slate-600 text-white font-semibold disabled:opacity-50 flex items-center gap-1"
                                  >
                                    <XCircle size={12} /> رفض
                                  </button>
                                )}
                                {nextStates.includes('completed') && (
                                  <button
                                    disabled={adjustmentBusyId === adj.id}
                                    onClick={() => handleAdjustmentDecision(adj, 'completed')}
                                    className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold disabled:opacity-50 flex items-center gap-1"
                                  >
                                    <PlayCircle size={12} /> تنفيذ
                                  </button>
                                )}
                                {nextStates.includes('cancelled') && (
                                  <button
                                    disabled={adjustmentBusyId === adj.id}
                                    onClick={() => {
                                      const note =
                                        window.prompt('سبب الإلغاء (اختياري):') ?? undefined;
                                      handleAdjustmentDecision(adj, 'cancelled', note);
                                    }}
                                    className="text-xs px-3 py-1.5 rounded-lg btn-secondary font-semibold disabled:opacity-50 flex items-center gap-1"
                                  >
                                    <X size={12} /> إلغاء
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Tracking Tab */}
          {activeTab === 'tab-tracking' && (
            <div className="space-y-5 fade-in">
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Link size={16} className="text-blue-600" />
                  <h4 className="text-sm font-bold text-blue-800">رابط تتبع الشحنة</h4>
                </div>
                <p className="text-xs text-blue-600 mb-3">
                  هذا الرابط فريد لهذا الأوردر. يمكن إرساله للعميل عبر الواتساب أو البريد
                  الإلكتروني.
                </p>
                <div className="flex items-center gap-2 bg-white border border-blue-200 rounded-xl p-3">
                  <p className="flex-1 text-sm font-mono text-[hsl(var(--foreground))] break-all">
                    {trackingLink}
                  </p>
                  <button
                    onClick={handleCopyTracking}
                    className="flex-shrink-0 flex items-center gap-1.5 bg-blue-600 text-white text-xs px-3 py-1.5 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
                  >
                    <Copy size={12} />
                    نسخ
                  </button>
                </div>
              </div>

              {/* Delegate info */}
              <div className="card-section p-4">
                <div className="flex items-center gap-2 mb-3">
                  <User size={15} className="text-[hsl(var(--primary))]" />
                  <h4 className="text-sm font-bold">تفاصيل المندوب</h4>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="bg-[hsl(var(--muted))]/40 rounded-xl p-3">
                    <p className="text-[11px] text-[hsl(var(--muted-foreground))] mb-1">
                      اسم المندوب
                    </p>
                    <p className="font-semibold">{liveOrder.delegate || 'لم يُعيَّن بعد'}</p>
                  </div>
                  <div className="bg-[hsl(var(--muted))]/40 rounded-xl p-3">
                    <p className="text-[11px] text-[hsl(var(--muted-foreground))] mb-1">
                      حالة التوصيل
                    </p>
                    <span className={`badge ${statusInfo.cls} text-xs`}>{statusInfo.label}</span>
                  </div>
                  <div className="col-span-2 bg-[hsl(var(--muted))]/40 rounded-xl p-3">
                    <p className="text-[11px] text-[hsl(var(--muted-foreground))] mb-1 flex items-center gap-1">
                      <MapPin size={10} /> موقع المندوب الحالي
                    </p>
                    <p className="text-sm font-medium">
                      {liveOrder.region}
                      {liveOrder.district ? ` — ${liveOrder.district}` : ''}
                      {liveOrder.neighborhood ? ` — ${liveOrder.neighborhood}` : ''}
                    </p>
                    <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                      آخر تحديث: {liveOrder.time} — {liveOrder.date}
                    </p>
                  </div>
                </div>
              </div>

              {/* WhatsApp preview */}
              <div className="card-section p-4">
                <div className="flex items-center gap-2 mb-3">
                  <MessageCircle size={15} className="text-green-600" />
                  <h4 className="text-sm font-bold">معاينة رسالة الواتساب</h4>
                  <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                    تتضمن رابط التتبع
                  </span>
                </div>
                <div className="bg-[#dcf8c6] rounded-2xl rounded-tl-sm p-4 text-sm leading-relaxed whitespace-pre-wrap font-sans shadow-sm border border-green-200 max-w-sm">
                  {buildWAMessage()}
                </div>
                <button
                  onClick={handleSendWhatsApp}
                  className="mt-3 flex items-center gap-2 bg-green-500 hover:bg-green-600 text-white text-sm px-4 py-2 rounded-xl font-semibold transition-colors"
                >
                  <MessageCircle size={15} />
                  إرسال للعميل عبر الواتساب
                </button>
              </div>
            </div>
          )}

          {/* Chat Tab — Phase 23K: order-scoped chat history.
              Reads `turath_masr_crm_chat` filtered to this order's
              `order_id` (= order_num) so we never bleed messages from
              another order with the same customer phone. Two sub-tabs
              isolate the support thread from the delegate thread,
              matching the customer-side /track/t/[token] UX. */}
          {/* Phase Orders-Admin-Actions-1 — defence-in-depth: even if a
              stale `activeTab` survives a role change, non-admin sees no
              chat / history content. */}
          {perms.isAdmin && activeTab === 'tab-chat' && (
            <OrderChatTab orderNum={liveOrder.orderNum} customerPhone={liveOrder.phone} />
          )}

          {/* History Tab */}
          {perms.isAdmin && activeTab === 'tab-history' && (
            <div className="space-y-3 fade-in">
              <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">
                سجل موحد يبدأ من إنشاء الطلب ويجمع الحالات والتسويات والملاحظات المهمة.
              </p>
              {timelineItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 gap-3">
                  <div className="w-12 h-12 bg-[hsl(var(--muted))] rounded-2xl flex items-center justify-center">
                    <Clock size={24} className="text-[hsl(var(--muted-foreground))]" />
                  </div>
                  <p className="text-sm font-semibold text-[hsl(var(--foreground))]">
                    لا توجد أحداث مسجلة
                  </p>
                </div>
              ) : (
                <div className="relative">
                  <div className="absolute right-4 top-0 bottom-0 w-0.5 bg-[hsl(var(--border))]" />
                  <div className="space-y-4">
                    {timelineItems.map((item, index) => {
                      const tone = timelineToneClasses(item.tone);
                      const isLatest = index === timelineItems.length - 1;
                      return (
                        <div key={item.id} className="flex items-start gap-4 relative">
                          <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center z-10 flex-shrink-0 ${tone.dot}`}
                          >
                            <CheckCircle size={16} />
                          </div>
                          <div className={`flex-1 border rounded-xl p-3 ${tone.card}`}>
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-bold text-[hsl(var(--foreground))]">
                                  {item.title}
                                </p>
                                {item.badge && (
                                  <span
                                    className={
                                      item.badgeClass
                                        ? `badge ${item.badgeClass} text-[10px]`
                                        : 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/70 text-[hsl(var(--foreground))]'
                                    }
                                  >
                                    {item.badge}
                                  </span>
                                )}
                                {isLatest && timelineItems.length > 1 && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/70 text-[hsl(var(--primary))]">
                                    آخر حدث
                                  </span>
                                )}
                              </div>
                              <span className="text-[11px] text-[hsl(var(--muted-foreground))] font-mono text-left flex-shrink-0">
                                {item.dateLabel}
                              </span>
                            </div>
                            {item.actorName && (
                              <div className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))]">
                                <span>بواسطة:</span>
                                <UserStamp
                                  name={item.actorName}
                                  role={item.actorRole ?? undefined}
                                  size="sm"
                                />
                              </div>
                            )}
                            {item.body && (
                              <div className="text-xs text-[hsl(var(--foreground))] mt-2 bg-white/70 border border-white/60 rounded-lg px-2 py-1 whitespace-pre-line leading-relaxed">
                                {item.body}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Invoice Tab */}
          {activeTab === 'tab-invoice' && (
            <div className="fade-in">
              <div
                id="invoice-print-area"
                className="border-2 border-[hsl(var(--border))] rounded-2xl overflow-hidden"
              >
                <div className="bg-[hsl(var(--primary))] text-white p-6 text-center">
                  <h2 className="text-2xl font-bold">Turath Masr</h2>
                  <p className="text-blue-200 text-sm mt-1">فاتورة ضريبية مبسطة</p>
                </div>

                <div className="p-6 space-y-4">
                  <div className="flex justify-between text-sm border-b border-[hsl(var(--border))] pb-4">
                    <div>
                      <p className="text-[hsl(var(--muted-foreground))] text-xs mb-1">
                        رقم الفاتورة
                      </p>
                      <p className="font-mono font-bold text-[hsl(var(--primary))]">
                        {liveOrder.orderNum}
                      </p>
                    </div>
                    <div className="text-left">
                      <p className="text-[hsl(var(--muted-foreground))] text-xs mb-1">
                        تاريخ الإصدار
                      </p>
                      <p className="font-semibold">
                        {liveOrder.day} {liveOrder.date}
                      </p>
                      <p className="text-xs font-mono text-[hsl(var(--muted-foreground))]">
                        {liveOrder.time}
                      </p>
                    </div>
                  </div>

                  <div className="text-sm">
                    <p className="text-[hsl(var(--muted-foreground))] text-xs mb-2 font-bold uppercase tracking-wide">
                      بيانات العميل
                    </p>
                    <p className="font-bold text-base">{liveOrder.customer}</p>
                    <p className="font-mono text-[hsl(var(--muted-foreground))]">
                      {liveOrder.phone}
                    </p>
                    <p className="text-[hsl(var(--muted-foreground))] mt-1">
                      {liveOrder.region}
                      {liveOrder.district ? ` - ${liveOrder.district}` : ''}
                      {liveOrder.neighborhood ? ` - ${liveOrder.neighborhood}` : ''} —{' '}
                      {liveOrder.address}
                    </p>
                  </div>

                  {/* Tracking link in invoice */}
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                    <p className="text-xs font-bold text-blue-700 mb-1 flex items-center gap-1">
                      <Link size={11} /> رابط تتبع الشحنة
                    </p>
                    <p className="text-xs font-mono text-blue-600 break-all">{trackingLink}</p>
                  </div>

                  <div>
                    <p className="text-[hsl(var(--muted-foreground))] text-xs mb-2 font-bold uppercase tracking-wide">
                      المنتجات
                    </p>
                    <div className="bg-[hsl(var(--muted))]/40 rounded-xl overflow-hidden">
                      <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-[hsl(var(--muted))] text-xs font-bold text-[hsl(var(--muted-foreground))]">
                        <span className="col-span-5">المنتج</span>
                        <span className="col-span-2 text-center">الكمية</span>
                        <span className="col-span-2 text-center">السعر</span>
                        <span className="col-span-3 text-left">الإجمالي</span>
                      </div>
                      {liveOrder.lines && liveOrder.lines.length > 0 ? (
                        liveOrder.lines.map((line, idx) => {
                          const hasImg =
                            line.image &&
                            (line.image.startsWith('data:') ||
                              line.image.startsWith('http') ||
                              line.image.startsWith('/'));
                          return (
                            <div
                              key={`inv-line-${idx}`}
                              className="border-t border-[hsl(var(--border))]"
                            >
                              <div className="grid grid-cols-12 gap-2 px-4 py-3 text-sm items-center">
                                <div className="col-span-5 flex items-center gap-2">
                                  <div className="w-9 h-9 rounded-lg overflow-hidden flex-shrink-0 bg-white border border-[hsl(var(--border))] flex items-center justify-center">
                                    {hasImg ? (
                                      <Image
                                        src={line.image!}
                                        alt={line.label}
                                        width={36}
                                        height={36}
                                        className="w-full h-full object-cover"
                                      />
                                    ) : (
                                      <span className="text-lg">{line.emoji || '📦'}</span>
                                    )}
                                  </div>
                                  <div className="min-w-0">
                                    <p className="font-medium text-xs leading-tight truncate">
                                      {line.label}
                                      {line.color ? ` (${line.color})` : ''}
                                      {line.includeFlashlight ? ' + كشاف' : ''}
                                    </p>
                                    {line.note && (
                                      <p className="text-[10px] text-amber-600 italic truncate">
                                        ملاحظة: {line.note}
                                      </p>
                                    )}
                                  </div>
                                </div>
                                <span className="col-span-2 text-center">{line.quantity}</span>
                                <span className="col-span-2 text-center font-mono text-xs">
                                  {line.unitPrice.toLocaleString('en-US')}
                                </span>
                                <span className="col-span-3 text-left font-mono font-semibold">
                                  {line.total.toLocaleString('en-US')} ج.م
                                </span>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="grid grid-cols-12 gap-2 px-4 py-3 text-sm border-t border-[hsl(var(--border))]">
                          <span className="col-span-5">{liveOrder.products}</span>
                          <span className="col-span-2 text-center">{liveOrder.quantity}</span>
                          <span className="col-span-2 text-center">—</span>
                          <span className="col-span-3 text-left font-mono">
                            {liveOrder.subtotal.toLocaleString('en-US')} ج.م
                          </span>
                        </div>
                      )}
                      <div className="grid grid-cols-12 gap-2 px-4 py-3 text-sm border-t border-[hsl(var(--border))]">
                        <span
                          className={`col-span-5 text-[hsl(var(--muted-foreground))] ${liveOrder.expressShipping ? 'text-amber-700 font-semibold' : ''}`}
                        >
                          {shippingLabel}
                        </span>
                        <span className="col-span-2 text-center">—</span>
                        <span className="col-span-2 text-center">—</span>
                        <span className="col-span-3 text-left font-mono">
                          {liveOrder.shippingFee.toLocaleString('en-US')} ج.م
                        </span>
                      </div>
                      {IS_ADMIN && extraFee > 0 && (
                        <div className="grid grid-cols-12 gap-2 px-4 py-3 text-sm border-t border-[hsl(var(--border))] text-orange-700">
                          <span className="col-span-5">مصاريف شحن إضافية</span>
                          <span className="col-span-2 text-center">—</span>
                          <span className="col-span-2 text-center">—</span>
                          <span className="col-span-3 text-left font-mono">
                            {extraFee.toLocaleString('en-US')} ج.م
                          </span>
                        </div>
                      )}
                      {checkoutLines.map((line) => (
                        <div
                          key={`checkout-invoice-${line}`}
                          className="grid grid-cols-12 gap-2 px-4 py-3 text-sm border-t border-[hsl(var(--border))] text-blue-700"
                        >
                          <span className="col-span-12">{line}</span>
                        </div>
                      ))}
                      {/* Warranty row */}
                      {liveOrder.warranty && liveOrder.warranty !== 'بدون ضمان' && (
                        <div className="grid grid-cols-12 gap-2 px-4 py-3 text-sm border-t border-[hsl(var(--border))] bg-green-50">
                          <span className="col-span-5 text-green-700 font-semibold flex items-center gap-1">
                            <Clock size={12} /> فترة الضمان
                          </span>
                          <span className="col-span-2 text-center">—</span>
                          <span className="col-span-2 text-center">—</span>
                          <span className="col-span-3 text-left font-semibold text-green-700">
                            {liveOrder.warranty}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="bg-[hsl(var(--primary))]/5 border border-[hsl(var(--primary))]/20 rounded-xl p-4 flex justify-between items-center">
                    <span className="font-bold text-lg">الإجمالي الكلي</span>
                    <span className="font-mono font-bold text-2xl text-[hsl(var(--primary))]">
                      {liveOrder.total.toLocaleString('en-US')} ج.م
                    </span>
                  </div>

                  <p className="text-center text-xs text-[hsl(var(--muted-foreground))] pt-2">
                    شكرا لثقتك في Turath Masr — للاستفسار: info@turath_masr.com
                  </p>
                </div>
              </div>

              <div className="flex gap-3 mt-4">
                <button onClick={handlePrintInvoice} className="btn-primary flex-1 justify-center">
                  <Printer size={15} />
                  طباعة / تحميل PDF
                </button>
                <button
                  onClick={handleSendWhatsApp}
                  className="flex-1 flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors active:scale-95"
                >
                  <MessageCircle size={15} />
                  إرسال واتساب + تتبع
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Phase Returns-Exchange-1 — create return / exchange modal.
          The wizard now creates a linked shipping child order at the
          same time as the adjustment, so we must hand it the full
          parent context (phone2 / address / warranty) it needs to
          seed that child row. */}
      {showAdjustmentModal && (
        <OrderAdjustmentModal
          order={{
            id: liveOrder.id,
            orderNum: liveOrder.orderNum,
            customer: liveOrder.customer,
            phone: liveOrder.phone,
            phone2: liveOrder.phone2 ?? null,
            total: liveOrder.total,
            lines: liveOrder.lines ?? [],
            shippingFee: liveOrder.shippingFee,
            region: liveOrder.region,
            district: liveOrder.district ?? null,
            neighborhood: liveOrder.neighborhood ?? null,
            address: liveOrder.address,
            warranty: liveOrder.warranty ?? null,
          }}
          onClose={() => setShowAdjustmentModal(false)}
        />
      )}

      {/* Phase Orders-Edit-1 — edit modal. Mounted lazily so the
          editor only loads when invoked. `onSaved` swaps the
          parent's `liveOrder` so the rest of the detail panes
          (header totals, audit timeline) reflect the new state
          without a full reload. The cast is safe — EditOrderModal
          only patches the editable subset, and the lines payload
          retains every original field plus the new quantity/total. */}
      {showEditModal && (
        <EditOrderModal
          order={liveOrder}
          onClose={() => setShowEditModal(false)}
          onSaved={(updated) => {
            setLiveOrder((curr) => ({ ...curr, ...updated }) as Order);
            setShowEditModal(false);
          }}
        />
      )}
    </div>
  );
}

// ─── Phase 23K — Order-scoped chat tab ─────────────────────────────────────
//
// Renders the per-order chat history for the admin / dispatcher reading
// the order detail modal. Reads `turath_masr_crm_chat` directly under
// the existing r1/r2/r5/r6 SELECT policy — admins are already authorised
// for the whole table; what's new here is filtering by `order_id` so
// the rendered thread is strictly the chat of THIS order. Sister
// messages on other orders for the same customer phone are no longer
// mixed in.
//
// Two sub-tabs (support / delegate) match the customer-side /track/t/[token]
// experience. Sending posts a row with the matching `chat_type`, sender
// pinned to `'support'` or `'delegate'` (no admin impersonation toggle).
// Realtime channel is scoped to this order via the `order_id` filter,
// so two admins viewing different orders do not receive each other's
// INSERTs.

type OrderChatThread = 'support' | 'delegate';

interface OrderChatRow {
  id: string;
  sender: string;
  message: string;
  chat_type: string;
  created_at: string;
}

function formatOrderChatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dayNames = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  return `${d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })} • ${dayNames[d.getDay()]} ${d.toLocaleDateString('en-GB')}`;
}

function OrderChatTab({ orderNum, customerPhone }: { orderNum: string; customerPhone: string }) {
  const [thread, setThread] = useState<OrderChatThread>('support');
  const [messages, setMessages] = useState<OrderChatRow[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = React.useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessages([]);
    setError(null);
    const supabase = createClient();

    const load = async () => {
      const { data, error: fetchErr } = await supabase
        .from('turath_masr_crm_chat')
        .select('id, sender, message, chat_type, created_at')
        .eq('order_id', orderNum)
        .eq('chat_type', thread)
        .order('created_at', { ascending: true })
        .limit(500);
      if (cancelled) return;
      if (fetchErr) {
        // 42P01 (table missing) / 42501 (RLS deny) → silent empty;
        // anything else surfaces a small inline banner.
        const code = (fetchErr as { code?: string }).code || '';
        if (code !== '42P01' && code !== '42501') {
          setError('تعذر تحميل الرسائل. حاول لاحقًا.');
        }
        setMessages([]);
      } else {
        setMessages((data as OrderChatRow[]) || []);
      }
      setLoading(false);
    };
    load();

    // Realtime — narrow to THIS order. The Postgres replication filter
    // is server-evaluated, so other orders' INSERTs never reach the
    // client (and the user can't spy on adjacent orders via DevTools).
    const channel = supabase
      .channel(`order-chat-${orderNum}-${thread}`)
      .on(
        'postgres_changes' as any,
        {
          event: 'INSERT',
          schema: 'public',
          table: 'turath_masr_crm_chat',
          filter: `order_id=eq.${orderNum}`,
        },
        (payload: { new: OrderChatRow }) => {
          const m = payload.new;
          if (!m || m.chat_type !== thread) return;
          setMessages((prev) => {
            if (prev.some((p) => p.id === m.id)) return prev;
            return [...prev, m];
          });
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [orderNum, thread]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const sendMessage = async () => {
    if (sending) return;
    const msg = input.trim();
    if (!msg) return;
    if (msg.length > 1000) {
      setError('الرسالة طويلة جدًا (الحد 1000 حرف).');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const supabase = createClient();
      // Sender mirrors the existing convention:
      //   - 'support' thread → sender='support' (CRM page convention)
      //   - 'delegate' thread → sender='delegate' (shipping page convention)
      // Both render as the "staff" bubble on the customer side, so we
      // stay aligned with both legacy surfaces without inventing a
      // third sender label.
      const senderRole: 'support' | 'delegate' = thread;
      const { error: insertErr } = await supabase.from('turath_masr_crm_chat').insert({
        customer_phone: customerPhone,
        sender: senderRole,
        message: msg,
        chat_type: thread,
        order_id: orderNum,
      });
      if (insertErr) {
        const code = (insertErr as { code?: string }).code || '';
        if (code === '42501') {
          setError('ليست لديك صلاحية إرسال الرسائل.');
        } else {
          setError('تعذر إرسال الرسالة. حاول لاحقًا.');
        }
      } else {
        setInput('');
      }
    } catch {
      setError('تعذر الاتصال. حاول مرة أخرى.');
    } finally {
      setSending(false);
    }
  };

  const threadLabel = thread === 'support' ? 'محادثة الدعم' : 'محادثة المندوب';
  const threadAccent =
    thread === 'support'
      ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
      : 'bg-[hsl(211,67%,28%)] hover:bg-[hsl(211,67%,22%)] text-white';

  return (
    <div className="fade-in" dir="rtl">
      {/* Thread switcher — support vs delegate */}
      <div className="flex items-center gap-2 mb-3">
        <button
          type="button"
          onClick={() => setThread('support')}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold border transition-colors ${
            thread === 'support'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : 'bg-white border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-emerald-50/40'
          }`}
        >
          <Headphones size={14} />
          محادثة الدعم
        </button>
        <button
          type="button"
          onClick={() => setThread('delegate')}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold border transition-colors ${
            thread === 'delegate'
              ? 'bg-[hsl(211,67%,28%)]/10 border-[hsl(211,67%,28%)]/30 text-[hsl(211,67%,28%)]'
              : 'bg-white border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(211,67%,28%)]/5'
          }`}
        >
          <Truck size={14} />
          محادثة المندوب
        </button>
      </div>

      {/* Scope hint */}
      <p className="text-xs text-[hsl(var(--muted-foreground))] mb-3 leading-relaxed">
        هذه المحادثة مقتصرة على رسائل الطلب <span className="font-mono">{orderNum}</span> فقط. لن
        تظهر هنا أي رسائل من طلبات أخرى لنفس العميل.
      </p>

      <div className="rounded-2xl border border-[hsl(var(--border))] bg-white overflow-hidden flex flex-col h-[480px]">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto bg-gray-50 px-3 py-3 space-y-2">
          {loading ? (
            <p className="text-xs text-center text-gray-400 py-8">جارٍ التحميل…</p>
          ) : messages.length === 0 ? (
            <div className="text-center text-gray-400 py-10 px-4">
              <MessageCircle size={32} className="mx-auto mb-2 opacity-40" />
              <p className="text-xs leading-relaxed">
                لا توجد رسائل في {threadLabel} لهذا الطلب بعد.
              </p>
            </div>
          ) : (
            messages.map((m) => {
              const isCustomer = m.sender === 'customer';
              return (
                <div
                  key={m.id}
                  className={`max-w-[80%] rounded-2xl px-3 py-2 shadow-sm ${
                    isCustomer
                      ? 'bg-white border border-gray-200 text-gray-800 mr-auto rounded-br-md'
                      : `${threadAccent.split(' ')[0]} text-white ml-auto rounded-bl-md`
                  }`}
                >
                  <p className="text-[11px] font-semibold opacity-80 mb-1">
                    {isCustomer ? 'العميل' : m.sender === 'delegate' ? 'المندوب' : 'فريق الدعم'}
                  </p>
                  <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
                    {m.message}
                  </p>
                  <p
                    className={`text-[10px] mt-1 ${isCustomer ? 'text-gray-400' : 'text-white/70'}`}
                  >
                    {formatOrderChatTime(m.created_at)}
                  </p>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        {error && (
          <div className="px-3 pt-2 flex-shrink-0">
            <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          </div>
        )}

        {/* Composer */}
        <div className="border-t border-[hsl(var(--border))] px-3 py-3 flex-shrink-0 bg-white">
          <div className="flex items-end gap-2">
            <textarea
              className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(211,67%,28%)] resize-none"
              placeholder={`اكتب رسالتك في ${threadLabel}...`}
              rows={2}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                if (error) setError(null);
              }}
              maxLength={1000}
              disabled={sending}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void sendMessage();
                }
              }}
            />
            <button
              type="button"
              onClick={sendMessage}
              disabled={sending || !input.trim()}
              className={`flex items-center justify-center gap-1 ${threadAccent} rounded-xl px-4 py-2.5 text-sm font-bold transition-colors disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed flex-shrink-0`}
              aria-label="إرسال"
            >
              <Send size={14} />
              {sending ? '…' : 'إرسال'}
            </button>
          </div>
          <p className="mt-1 text-[10px] text-gray-400 text-left">{input.length}/1000</p>
        </div>
      </div>
    </div>
  );
}
