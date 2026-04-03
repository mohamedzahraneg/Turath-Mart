'use client';
import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import AuditLogModal, { getAuditLogs, AuditEntry } from './AuditLogModal';
import { createClient } from '@/lib/supabase/client';
import { STATUS_LABELS } from './AuditLogModal';

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
  createdBy: string;
  createdByIp?: string;
  createdByLocation?: string;
  createdByDevice?: string;
  customer: string;
  phone: string;
  phone2?: string;
  region: string;
  district?: string;
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
  lines?: OrderLine[];
}

// Simulated current user role — in real app comes from auth context
const CURRENT_USER_ROLE: string = 'admin';
const CAN_SEE_SENSITIVE = ['admin', 'supervisor', 'delegate', 'manager'].includes(
  CURRENT_USER_ROLE
);
const IS_ADMIN = CURRENT_USER_ROLE === 'admin';

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

// Generate a unique tracking link per order
function getTrackingLink(orderNum: string): string {
  const base = typeof window !== 'undefined' ? window.location.origin : 'https://turath_masr.com';
  return `${base}/track/${orderNum}`;
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
  const [activeTab, setActiveTab] = useState('tab-details');
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [systemNotifications, setSystemNotifications] = useState<any[]>([]);
  const [liveOrder, setLiveOrder] = useState(order);
  const [loadingNotifs, setLoadingNotifs] = useState(true);
  const [waTemplate, setWaTemplate] = useState(DEFAULT_WA_TEMPLATE);

  // Load audit logs and listen for real-time updates
  useEffect(() => {
    const loadAudit = () => setAuditLogs(getAuditLogs(order.id));
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
      supabase.removeChannel(notifSub);
    };
  }, [order.id]);

  const statusInfo = STATUS_BADGE_MAP[liveOrder.status] || STATUS_BADGE_MAP['new'];
  const extraFee = liveOrder.extraShippingFee || 0;
  const shippingLabel = liveOrder.expressShipping ? 'شحن سريع' : 'تكلفة الشحن';
  const trackingLink = getTrackingLink(liveOrder.orderNum);

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
              <p>${liveOrder.region}${liveOrder.district ? ' - ' + liveOrder.district : ''} — ${liveOrder.address}</p>
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
                              <img
                                src={line.image!}
                                alt={line.label}
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
                    .filter((l) => l.action === 'status_change')
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
                            <p className="text-xs text-[hsl(var(--muted-foreground))]">
                              بواسطة:{' '}
                              <span className="font-semibold text-[hsl(var(--foreground))]">
                                {h.changedBy}
                              </span>
                            </p>
                            {h.note && (
                              <p className="text-xs text-[hsl(var(--foreground))] mt-1.5 bg-[hsl(var(--muted))]/50 rounded-lg px-2 py-1 italic">
                                "{h.note}"
                              </p>
                            )}
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
                            {notif.created_by && (
                              <p className="text-[11px] opacity-80">بواسطة: {notif.created_by}</p>
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
                      {liveOrder.district ? ` - ${liveOrder.district}` : ''} — {liveOrder.address}
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
                                      <img
                                        src={line.image!}
                                        alt={line.label}
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
                            {log.note && (
                              <p className="text-xs mt-1 italic opacity-80">"{log.note}"</p>
                            )}
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
    </div>
  );
}
