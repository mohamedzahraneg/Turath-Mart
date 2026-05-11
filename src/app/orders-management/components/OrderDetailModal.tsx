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
  History,
  Headphones,
  Truck,
  Send,
  RotateCcw,
  XCircle,
  PlayCircle,
} from 'lucide-react';
import AuditLogModal, { getAuditLogs, AuditEntry } from './AuditLogModal';
import { createClient } from '@/lib/supabase/client';
import { STATUS_LABELS } from './AuditLogModal';
import { useAuth } from '@/contexts/AuthContext';
import {
  canUseAdminOnlyFinancialFields,
  canEditOrders,
  isManagerOrAbove,
  ROLE_IDS,
} from '@/lib/constants/roles';
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
import { UserStamp } from '@/components/UserStamp';

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
  { id: 'tab-audit', label: 'سجل التعديلات' },
  { id: 'tab-notifications', label: 'سجل الإشعارات' },
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

// Load WhatsApp template from localStorage
function getWATemplate(): string {
  if (typeof window === 'undefined') return '';
  try {
    const saved = localStorage.getItem('settings_wa_template');
    return saved ? JSON.parse(saved) : '';
  } catch {
    return '';
  }
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

export default function OrderDetailModal({ order, onClose }: Props) {
  const { currentRoleId, user, profileFullName } = useAuth();
  const IS_ADMIN = canUseAdminOnlyFinancialFields(currentRoleId);
  const CAN_SEE_SENSITIVE = canEditOrders(currentRoleId);

  const [activeTab, setActiveTab] = useState('tab-details');
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [systemNotifications, setSystemNotifications] = useState<any[]>([]);
  const [liveOrder, setLiveOrder] = useState(order);
  const [loadingNotifs, setLoadingNotifs] = useState(true);
  const [waTemplate, setWaTemplate] = useState(DEFAULT_WA_TEMPLATE);

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

    const fetchOrderNotifications = async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from('turath_masr_notifications')
          .select('*')
          .eq('order_id', order.id)
          .order('created_at', { ascending: false });

        if (!error && data) {
          setSystemNotifications(data);
        }
      } catch (err) {
        console.error('Failed to fetch order notifications:', err);
      } finally {
        setLoadingNotifs(false);
      }
    };

    fetchOrderNotifications();

    const handleNotifs = () => fetchOrderNotifications();

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

    // Subscribe to notification changes for this order
    const supabase = createClient();
    const notifSub = supabase
      .channel(`order-notifs-${order.id}`)
      .on(
        'postgres_changes' as any,
        {
          event: '*',
          schema: 'public',
          table: 'turath_masr_notifications',
          filter: `order_id=eq.${order.id}`,
        },
        handleNotifs
      )
      .subscribe();

    return () => {
      window.removeEventListener('turath_masr_audit_updated', handleAudit);
      window.removeEventListener('turath_masr_orders_updated', handleOrders);
      window.removeEventListener('turath_masr_order_adjustments_updated', handleAdjustments);
      supabase.removeChannel(notifSub);
    };
  }, [order.id]);

  const statusInfo = STATUS_BADGE_MAP[liveOrder.status] || STATUS_BADGE_MAP['new'];
  const extraFee = liveOrder.extraShippingFee || 0;
  const shippingLabel = liveOrder.expressShipping ? 'شحن سريع' : 'تكلفة الشحن';
  const trackingLink = getTrackingLink(liveOrder);

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
      toast.success(
        nextState === 'approved' && childOrderNum
          ? `تمت الموافقة، وإنشاء الطلب الفرعي #${childOrderNum}`
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
              const hasImg =
                line.image &&
                (line.image.startsWith('data:') ||
                  line.image.startsWith('http') ||
                  line.image.startsWith('/'));
              const imgHtml = hasImg
                ? `<img src="${line.image}" alt="${line.label}" style="width:40px;height:40px;object-fit:cover;border-radius:6px;border:1px solid #e5e7eb;" />`
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
                ${warrantyRow}
                <tr class="total-row"><td colspan="3"><strong>الإجمالي الكلي</strong></td><td><strong>${liveOrder.total.toLocaleString('en-US')} ج.م</strong></td></tr>
              </tbody>
            </table>
            ${liveOrder.notes ? `<p style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px;font-size:13px;"><strong>ملاحظات:</strong> ${liveOrder.notes}</p>` : ''}
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
        <div className="flex border-b border-[hsl(var(--border))] px-5 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${activeTab === tab.id ? 'border-[hsl(var(--primary))] text-[hsl(var(--primary))]' : 'border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'}`}
            >
              {tab.label}
              {tab.id === 'tab-audit' && auditLogs.length > 0 && (
                <span className="mr-1.5 bg-amber-100 text-amber-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  {auditLogs.length}
                </span>
              )}
            </button>
          ))}
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
                      const hasImg =
                        line.image &&
                        (line.image.startsWith('data:') ||
                          line.image.startsWith('http') ||
                          line.image.startsWith('/'));
                      return (
                        <div
                          key={`detail-line-${idx}`}
                          className="flex items-center gap-3 bg-[hsl(var(--muted))]/40 rounded-xl p-3 border border-[hsl(var(--border))]"
                        >
                          <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 bg-white border border-[hsl(var(--border))] flex items-center justify-center">
                            {hasImg ? (
                              <Image
                                src={line.image!}
                                alt={line.label}
                                width={48}
                                height={48}
                                className="w-full h-full object-cover"
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
                  <div className="flex justify-between py-1.5">
                    <span className="font-bold">الإجمالي الكلي:</span>
                    <span className="font-mono font-bold text-lg text-[hsl(var(--primary))]">
                      {liveOrder.total.toLocaleString('en-US')} ج.م
                    </span>
                  </div>
                </div>
              </div>

              {CAN_SEE_SENSITIVE && (
                <div className="border border-amber-200 bg-amber-50 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Shield size={14} className="text-amber-600" />
                    <h4 className="text-sm font-bold text-amber-800">
                      معلومات التسجيل (للمفوضين فقط)
                    </h4>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div className="bg-white rounded-lg p-2.5 border border-amber-100">
                      <p className="text-[hsl(var(--muted-foreground))] mb-1">المسجِّل</p>
                      <p className="font-semibold">{liveOrder.createdBy}</p>
                    </div>
                    <div className="bg-white rounded-lg p-2.5 border border-amber-100">
                      <p className="text-[hsl(var(--muted-foreground))] mb-1">IP الجهاز</p>
                      <p className="font-mono">{liveOrder.ip || liveOrder.createdByIp || '—'}</p>
                    </div>
                    <div className="bg-white rounded-lg p-2.5 border border-amber-100">
                      <p className="text-[hsl(var(--muted-foreground))] mb-1 flex items-center gap-1">
                        <MapPin size={10} /> الموقع
                      </p>
                      <p className="font-semibold">
                        {liveOrder.createdByLocation || 'القاهرة، مصر'}
                      </p>
                    </div>
                    <div className="bg-white rounded-lg p-2.5 border border-amber-100">
                      <p className="text-[hsl(var(--muted-foreground))] mb-1 flex items-center gap-1">
                        <Monitor size={10} /> الجهاز
                      </p>
                      <p className="font-semibold flex items-center gap-1">
                        <DeviceIcon device={liveOrder.createdByDevice} />
                        {liveOrder.createdByDevice || 'كمبيوتر'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {liveOrder.notes && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <p className="text-xs font-bold text-amber-700 mb-1">ملاحظات</p>
                  <p className="text-sm text-[hsl(var(--foreground))]">{liveOrder.notes}</p>
                </div>
              )}

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
          {activeTab === 'tab-chat' && (
            <OrderChatTab orderNum={liveOrder.orderNum} customerPhone={liveOrder.phone} />
          )}

          {/* History Tab */}
          {activeTab === 'tab-history' && (
            <div className="space-y-3 fade-in">
              <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">
                سجل كامل لجميع تحديثات الحالة مع التوقيت الكامل والمسؤول
              </p>
              <div className="relative">
                <div className="absolute right-4 top-0 bottom-0 w-0.5 bg-[hsl(var(--border))]" />
                <div className="space-y-4">
                  {auditLogs
                    .filter(
                      (l) => l.action === 'status_change' || l.action.startsWith('adjustment_')
                    )
                    .map((h, i, arr) => {
                      const d = new Date(h.createdAt);
                      const days = [
                        'الأحد',
                        'الاثنين',
                        'الثلاثاء',
                        'الأربعاء',
                        'الخميس',
                        'الجمعة',
                        'السبت',
                      ];
                      return (
                        <div key={h.id} className="flex items-start gap-4 relative">
                          <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center z-10 flex-shrink-0 ${i === 0 ? 'bg-[hsl(var(--primary))] text-white' : 'bg-green-100 text-green-600'}`}
                          >
                            <CheckCircle size={16} />
                          </div>
                          <div className="flex-1 bg-white border border-[hsl(var(--border))] rounded-xl p-3">
                            <div className="flex items-center justify-between mb-1.5">
                              <span
                                className={`badge ${STATUS_BADGE_MAP[h.newValue || '']?.cls || 'status-new'} text-[11px]`}
                              >
                                {STATUS_LABELS[h.newValue || ''] || h.newValue}
                              </span>
                              <span className="text-xs text-[hsl(var(--muted-foreground))] font-mono">
                                {days[d.getDay()]} {d.toLocaleDateString('en-US')} —{' '}
                                {d.toLocaleTimeString('en-US', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </div>
                            {/* Phase 22L — show full_name on top +
                                Arabic role label below. Replaces the
                                inline "بواسطة: name" form so this
                                surface matches the audit log modal
                                and the in-modal status history. */}
                            <div className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))]">
                              <span>بواسطة:</span>
                              <UserStamp name={h.changedBy} role={h.changedByRole} size="sm" />
                            </div>
                            {/* Phase 22P / 22Q — split structured note.
                                Phase 25B — when the action is an
                                adjustment event, render the humanised
                                Arabic paragraph instead of the raw
                                JSON envelope. */}
                            {(() => {
                              const humanised = humanizeAdjustmentAuditEntry({
                                action: h.action,
                                note: h.note,
                              });
                              if (humanised) {
                                return (
                                  <div className="text-xs text-[hsl(var(--foreground))] mt-1.5 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1 whitespace-pre-line leading-relaxed">
                                    {humanised}
                                  </div>
                                );
                              }
                              const parsed = parseAuditNote(h.note);
                              if (
                                !parsed.reason &&
                                !parsed.note &&
                                !parsed.schedule &&
                                !parsed.raw
                              ) {
                                return null;
                              }
                              return (
                                <div className="text-xs text-[hsl(var(--foreground))] mt-1.5 bg-[hsl(var(--muted))]/50 rounded-lg px-2 py-1 space-y-0.5">
                                  {parsed.reason && (
                                    <p className="leading-snug">
                                      <span className="font-bold text-red-700">سبب الإرجاع:</span>{' '}
                                      <span className="italic">{parsed.reason}</span>
                                    </p>
                                  )}
                                  {/* Phase 22Q — schedule snapshot. */}
                                  {parsed.schedule && (
                                    <div className="leading-snug">
                                      <p>
                                        <span className="font-bold text-emerald-700">
                                          موعد التسليم:
                                        </span>{' '}
                                        {formatScheduleDateAr(parsed.schedule.date)}
                                      </p>
                                      <p>
                                        من الساعة {formatTime12hAr(parsed.schedule.from)} إلى الساعة{' '}
                                        {formatTime12hAr(parsed.schedule.to)}
                                      </p>
                                      {parsed.schedule.reason && (
                                        <p>
                                          <span className="font-bold text-orange-700">
                                            سبب الترحيل:
                                          </span>{' '}
                                          <span className="italic">{parsed.schedule.reason}</span>
                                        </p>
                                      )}
                                    </div>
                                  )}
                                  {parsed.note && (
                                    <p className="leading-snug">
                                      <span className="font-bold">ملاحظة:</span>{' '}
                                      <span className="italic">{parsed.note}</span>
                                    </p>
                                  )}
                                  {parsed.raw && (
                                    <p className="italic leading-snug">
                                      &ldquo;{parsed.raw}&rdquo;
                                    </p>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          )}

          {/* Notifications Tab */}
          {activeTab === 'tab-notifications' && (
            <div className="space-y-3 fade-in">
              <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">
                سجل جميع الإشعارات المرتبطة بهذا الأوردر
              </p>
              <div className="space-y-3">
                {loadingNotifs ? (
                  <div className="p-10 text-center text-xs text-[hsl(var(--muted-foreground))]">
                    جاري التحميل...
                  </div>
                ) : systemNotifications.length === 0 ? (
                  <div className="p-10 text-center text-xs text-[hsl(var(--muted-foreground))]">
                    لا توجد إشعارات مسجلة لهذا الأوردر
                  </div>
                ) : (
                  systemNotifications.map((notif) => {
                    const typeConfig: Record<string, { color: string; label: string }> = {
                      status_change: {
                        color: 'bg-blue-50 border-blue-200 text-blue-700',
                        label: 'تغيير حالة',
                      },
                      whatsapp: {
                        color: 'bg-green-50 border-green-200 text-green-700',
                        label: 'واتساب',
                      },
                      new_order: {
                        color: 'bg-purple-50 border-purple-200 text-purple-700',
                        label: 'إنشاء أوردر',
                      },
                    };
                    const cfg = typeConfig[notif.type] || {
                      color: 'bg-gray-50 border-gray-200 text-gray-700',
                      label: 'إشعار',
                    };
                    const d = new Date(notif.created_at);
                    return (
                      <div key={notif.id} className={`border rounded-xl p-3 ${cfg.color}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/60">
                                {cfg.label}
                              </span>
                              <span className="text-xs font-semibold">{notif.message}</span>
                            </div>
                            {/* Phase 22L — notifications carry only
                                the writer's display name string in
                                turath_masr_notifications.created_by;
                                no role column. UserStamp degrades
                                gracefully and just renders the name
                                line when role is absent. */}
                            {notif.created_by && (
                              <div className="flex items-center gap-1.5 text-[11px] opacity-80">
                                <span>بواسطة:</span>
                                <UserStamp name={notif.created_by} size="sm" />
                              </div>
                            )}
                          </div>
                          <div className="text-left flex-shrink-0">
                            <p className="text-[10px] font-mono opacity-70">
                              {d.toLocaleDateString('en-US')}
                            </p>
                            <p className="text-[10px] font-mono opacity-70">
                              {d.toLocaleTimeString('en-US', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
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

          {/* Audit Log Tab */}
          {activeTab === 'tab-audit' && (
            <div className="space-y-3 fade-in">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-[hsl(var(--muted-foreground))]">
                  سجل كامل لجميع التعديلات مع اسم من عدّل
                </p>
                <button
                  onClick={() => setShowAuditModal(true)}
                  className="flex items-center gap-1.5 text-xs bg-amber-50 border border-amber-200 text-amber-700 px-3 py-1.5 rounded-xl font-semibold hover:bg-amber-100 transition-colors"
                >
                  <History size={13} />
                  عرض كامل
                </button>
              </div>
              {auditLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 gap-3">
                  <div className="w-12 h-12 bg-[hsl(var(--muted))] rounded-2xl flex items-center justify-center">
                    <Clock size={24} className="text-[hsl(var(--muted-foreground))]" />
                  </div>
                  <p className="text-sm font-semibold text-[hsl(var(--foreground))]">
                    لا توجد تعديلات مسجلة
                  </p>
                  <p className="text-xs text-[hsl(var(--muted-foreground))] text-center">
                    ستظهر هنا جميع التعديلات عند تحديث الحالة أو تعديل الأوردر
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {auditLogs.slice(0, 10).map((log) => {
                    const d = new Date(log.createdAt);
                    const dateStr = d.toLocaleDateString('en-US', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                    });
                    const timeStr = d.toLocaleTimeString('en-US', {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    });
                    const actionColors: Record<string, string> = {
                      status_change: 'bg-blue-50 border-blue-200',
                      order_created: 'bg-green-50 border-green-200',
                      order_edited: 'bg-amber-50 border-amber-200',
                      order_deleted: 'bg-red-50 border-red-200',
                    };
                    const actionLabels: Record<string, string> = {
                      status_change: 'تغيير الحالة',
                      order_created: 'إنشاء الأوردر',
                      order_edited: 'تعديل الأوردر',
                      order_deleted: 'حذف الأوردر',
                    };
                    const statusLabels: Record<string, string> = {
                      new: 'جديد',
                      preparing: 'جاري التجهيز',
                      warehouse: 'في المستودع',
                      shipping: 'جاري الشحن',
                      delivered: 'تم التسليم',
                      cancelled: 'ملغي',
                      returned: 'مرتجع',
                    };
                    return (
                      <div
                        key={log.id}
                        className={`border rounded-xl p-3 ${actionColors[log.action] || 'bg-gray-50 border-gray-200'}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/60 text-[hsl(var(--foreground))]">
                                {actionLabels[log.action] || log.action}
                              </span>
                              {log.action === 'status_change' && log.newValue && (
                                <span
                                  className={`badge ${STATUS_BADGE_MAP[log.newValue]?.cls || 'status-new'} text-[10px]`}
                                >
                                  {statusLabels[log.newValue] || log.newValue}
                                </span>
                              )}
                            </div>
                            <p className="text-xs font-semibold text-[hsl(var(--foreground))]">
                              {log.changedBy}
                            </p>
                            <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                              {log.changedByRole === 'manager'
                                ? 'مدير'
                                : log.changedByRole === 'supervisor'
                                  ? 'مشرف شحن'
                                  : log.changedByRole === 'shipping'
                                    ? 'مندوب'
                                    : log.changedByRole}
                            </p>
                            {/* Phase 22P / 22Q — split structured note.
                                Phase 25B — render adjustment events as
                                Arabic paragraphs. */}
                            {(() => {
                              const humanised = humanizeAdjustmentAuditEntry({
                                action: log.action,
                                note: log.note,
                              });
                              if (humanised) {
                                return (
                                  <div className="text-xs mt-1 opacity-90 whitespace-pre-line leading-relaxed">
                                    {humanised}
                                  </div>
                                );
                              }
                              const parsed = parseAuditNote(log.note);
                              if (
                                !parsed.reason &&
                                !parsed.note &&
                                !parsed.schedule &&
                                !parsed.raw
                              ) {
                                return null;
                              }
                              return (
                                <div className="text-xs mt-1 space-y-0.5 opacity-80">
                                  {parsed.reason && (
                                    <p className="leading-snug">
                                      <span className="font-bold">سبب الإرجاع:</span>{' '}
                                      <span className="italic">{parsed.reason}</span>
                                    </p>
                                  )}
                                  {/* Phase 22Q — schedule snapshot. */}
                                  {parsed.schedule && (
                                    <div className="leading-snug">
                                      <p>
                                        <span className="font-bold">موعد التسليم:</span>{' '}
                                        {formatScheduleDateAr(parsed.schedule.date)}
                                      </p>
                                      <p>
                                        من الساعة {formatTime12hAr(parsed.schedule.from)} إلى الساعة{' '}
                                        {formatTime12hAr(parsed.schedule.to)}
                                      </p>
                                      {parsed.schedule.reason && (
                                        <p>
                                          <span className="font-bold">سبب الترحيل:</span>{' '}
                                          <span className="italic">{parsed.schedule.reason}</span>
                                        </p>
                                      )}
                                    </div>
                                  )}
                                  {parsed.note && (
                                    <p className="leading-snug">
                                      <span className="font-bold">ملاحظة:</span>{' '}
                                      <span className="italic">{parsed.note}</span>
                                    </p>
                                  )}
                                  {parsed.raw && (
                                    <p className="italic leading-snug">
                                      &ldquo;{parsed.raw}&rdquo;
                                    </p>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                          <div className="text-left flex-shrink-0">
                            <p className="text-[10px] font-mono opacity-70">{dateStr}</p>
                            <p className="text-[10px] font-mono opacity-70">{timeStr}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {auditLogs.length > 10 && (
                    <button
                      onClick={() => setShowAuditModal(true)}
                      className="w-full text-xs text-[hsl(var(--primary))] font-semibold py-2 hover:underline"
                    >
                      عرض {auditLogs.length - 10} تعديل إضافي...
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {showAuditModal && (
        <AuditLogModal
          orderId={order.id}
          orderNum={order.orderNum}
          onClose={() => setShowAuditModal(false)}
        />
      )}

      {/* Phase 25A — create return / exchange modal */}
      {showAdjustmentModal && (
        <OrderAdjustmentModal
          order={{
            id: liveOrder.id,
            orderNum: liveOrder.orderNum,
            customer: liveOrder.customer,
            phone: liveOrder.phone,
            total: liveOrder.total,
            lines: liveOrder.lines ?? [],
            // Phase 25B — pass region + base shipping so the modal can
            // seed the new shipment leg automatically.
            shippingFee: liveOrder.shippingFee,
            region: liveOrder.region,
            district: liveOrder.district ?? null,
            neighborhood: liveOrder.neighborhood ?? null,
          }}
          onClose={() => setShowAdjustmentModal(false)}
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
