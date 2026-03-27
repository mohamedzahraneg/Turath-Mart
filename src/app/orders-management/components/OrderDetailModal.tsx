'use client';
import React, { useState } from 'react';
import { toast } from 'sonner';
import { Toaster } from 'sonner';
import { X, User, Phone, MapPin, Package, FileText, MessageCircle, Mail, Printer, CheckCircle, Shield, Monitor, Smartphone, Tablet } from 'lucide-react';

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
}

// Simulated current user role — in real app comes from auth context
const CURRENT_USER_ROLE: 'admin' | 'supervisor' | 'delegate' | 'customer_service' | 'manager' = 'admin';
const CAN_SEE_SENSITIVE = ['admin', 'supervisor', 'delegate', 'manager'].includes(CURRENT_USER_ROLE);
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

const MOCK_STATUS_HISTORY = [
  { id: 'dh-001', status: 'new', label: 'جديد', date: '27/03/2026', time: '09:32:14', day: 'الجمعة', by: 'محمد حسن', note: 'تم تسجيل الأوردر', device: 'كمبيوتر' },
  { id: 'dh-002', status: 'preparing', label: 'جاري التجهيز', date: '27/03/2026', time: '11:15:42', day: 'الجمعة', by: 'أحمد السيد (مدير)', note: 'تم تجهيز الطلب', device: 'موبايل' },
  { id: 'dh-003', status: 'shipping', label: 'جاري الشحن', date: '27/03/2026', time: '13:40:07', day: 'الجمعة', by: 'علي محمود (مندوب)', note: 'الطلب في الطريق', device: 'موبايل' },
];

// Mock notifications log
const MOCK_NOTIFICATIONS = [
  { id: 'notif-001', type: 'status_change', message: 'تم تغيير حالة الأوردر إلى "جاري الشحن"', date: '27/03/2026', time: '13:40:07', by: 'علي محمود' },
  { id: 'notif-002', type: 'whatsapp', message: 'تم إرسال رسالة واتساب للعميل', date: '27/03/2026', time: '13:41:22', by: 'النظام' },
  { id: 'notif-003', type: 'status_change', message: 'تم تغيير حالة الأوردر إلى "جاري التجهيز"', date: '27/03/2026', time: '11:15:42', by: 'أحمد السيد' },
  { id: 'notif-004', type: 'order_created', message: 'تم إنشاء الأوردر بنجاح', date: '27/03/2026', time: '09:32:14', by: 'محمد حسن' },
];

const TABS = [
  { id: 'tab-details', label: 'تفاصيل الأوردر' },
  { id: 'tab-history', label: 'سجل الحالات' },
  { id: 'tab-notifications', label: 'سجل الإشعارات' },
  { id: 'tab-invoice', label: 'الفاتورة' },
];

function DeviceIcon({ device }: { device?: string }) {
  if (!device) return <Monitor size={12} />;
  if (device === 'موبايل') return <Smartphone size={12} />;
  if (device === 'تابلت') return <Tablet size={12} />;
  return <Monitor size={12} />;
}

interface Props {
  order: Order;
  onClose: () => void;
}

export default function OrderDetailModal({ order, onClose }: Props) {
  const [activeTab, setActiveTab] = useState('tab-details');
  const statusInfo = STATUS_BADGE_MAP[order.status] || STATUS_BADGE_MAP['new'];
  const extraFee = order.extraShippingFee || 0;

  // Express shipping: replaces default shipping fee
  const shippingLabel = order.expressShipping ? 'شحن سريع' : 'تكلفة الشحن';

  const handleSendWhatsApp = () => {
    const msg = encodeURIComponent(`مرحبا ${order.customer}، تم استلام طلبك رقم ${order.orderNum} بإجمالي ${order.total.toLocaleString('en-US')} ج.م. سيتم التواصل معك قريبا. شكرا لثقتك في Zahranship`);
    window.open(`https://wa.me/2${order.phone}?text=${msg}`, '_blank');
    toast.success('تم فتح واتساب لإرسال الرسالة');
  };

  const handleSendEmail = () => {
    toast.success('تم إرسال الفاتورة بالبريد الإلكتروني');
  };

  const handlePrintInvoice = () => {
    const win = window.open('', '_blank', 'width=800,height=600');
    if (!win) {
      toast.error('يرجى السماح بالنوافذ المنبثقة في إعدادات المتصفح');
      return;
    }
    win.document.write(`
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8" />
        <title>فاتورة - ${order.orderNum}</title>
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
          td { padding: 10px 12px; border-bottom: 1px solid #f3f4f6; font-size: 13px; }
          .total-row { background: #eff6ff; }
          .total-row td { font-weight: 700; font-size: 16px; color: #1e3a5f; }
          .footer { text-align: center; font-size: 12px; color: #9ca3af; margin-top: 20px; padding-top: 16px; border-top: 1px solid #e5e7eb; }
          @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
        </style>
      </head>
      <body>
        <div class="invoice-wrap">
          <div class="inv-header">
            <h1>Zahranship</h1>
            <p>فاتورة ضريبية مبسطة</p>
          </div>
          <div class="inv-body">
            <div class="inv-meta">
              <div><p>رقم الفاتورة</p><p>${order.orderNum}</p></div>
              <div><p>تاريخ الإصدار</p><p>${order.day} ${order.date}</p></div>
              <div><p>الوقت</p><p>${order.time}</p></div>
            </div>
            <div class="customer-info">
              <p class="section-title">بيانات العميل</p>
              <p class="name">${order.customer}</p>
              <p>${order.phone}${order.phone2 ? ' / ' + order.phone2 : ''}</p>
              <p>${order.region}${order.district ? ' - ' + order.district : ''} — ${order.address}</p>
            </div>
            <p class="section-title">المنتجات</p>
            <table>
              <thead><tr><th>المنتج</th><th>الكمية</th><th>الإجمالي</th></tr></thead>
              <tbody>
                <tr><td>${order.products}</td><td>${order.quantity}</td><td>${order.subtotal.toLocaleString('en-US')} ج.م</td></tr>
                <tr><td>${shippingLabel}</td><td>—</td><td>${order.shippingFee.toLocaleString('en-US')} ج.م</td></tr>
                ${extraFee > 0 ? `<tr><td>مصاريف شحن إضافية</td><td>—</td><td>${extraFee.toLocaleString('en-US')} ج.م</td></tr>` : ''}
                <tr class="total-row"><td colspan="2"><strong>الإجمالي الكلي</strong></td><td><strong>${order.total.toLocaleString('en-US')} ج.م</strong></td></tr>
              </tbody>
            </table>
            ${order.notes ? `<p style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px;font-size:13px;"><strong>ملاحظات:</strong> ${order.notes}</p>` : ''}
            <div class="footer">شكرا لثقتك في Zahranship — للاستفسار: info@zahranship.com</div>
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
                <h3 className="text-base font-bold text-[hsl(var(--foreground))]">{order.orderNum}</h3>
                <span className={`badge ${statusInfo.cls}`}>{statusInfo.label}</span>
              </div>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5 font-mono">{order.day} {order.date} — {order.time}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-[hsl(var(--muted))] transition-colors" aria-label="إغلاق">
            <X size={16} />
          </button>
        </div>

        {/* Quick actions */}
        <div className="flex gap-2 px-5 py-3 bg-[hsl(var(--muted))]/30 border-b border-[hsl(var(--border))] flex-wrap">
          <button onClick={handleSendWhatsApp} className="flex items-center gap-1.5 bg-green-500 hover:bg-green-600 text-white text-xs px-3 py-1.5 rounded-xl font-semibold transition-colors">
            <MessageCircle size={13} />
            إرسال واتساب
          </button>
          <button onClick={handleSendEmail} className="flex items-center gap-1.5 bg-blue-500 hover:bg-blue-600 text-white text-xs px-3 py-1.5 rounded-xl font-semibold transition-colors">
            <Mail size={13} />
            إرسال بريد
          </button>
          <button onClick={handlePrintInvoice} className="flex items-center gap-1.5 btn-secondary text-xs py-1.5">
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
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-5 scrollbar-thin">
          {activeTab === 'tab-details' && (
            <div className="space-y-5 fade-in">
              {/* Customer info */}
              <div className="card-section p-4">
                <div className="flex items-center gap-2 mb-3">
                  <User size={15} className="text-[hsl(var(--primary))]" />
                  <h4 className="text-sm font-bold">بيانات العميل</h4>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-[11px] text-[hsl(var(--muted-foreground))] mb-0.5">الاسم</p>
                    <p className="font-semibold">{order.customer}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-[hsl(var(--muted-foreground))] mb-0.5">المنطقة</p>
                    <p className="font-semibold">{order.region}{order.district ? ` - ${order.district}` : ''}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-[hsl(var(--muted-foreground))] mb-0.5 flex items-center gap-1"><Phone size={10} /> الموبايل</p>
                    <p className="font-mono font-semibold">{order.phone}</p>
                  </div>
                  {order.phone2 && (
                    <div>
                      <p className="text-[11px] text-[hsl(var(--muted-foreground))] mb-0.5">موبايل إضافي</p>
                      <p className="font-mono">{order.phone2}</p>
                    </div>
                  )}
                  <div className="col-span-2">
                    <p className="text-[11px] text-[hsl(var(--muted-foreground))] mb-0.5 flex items-center gap-1"><MapPin size={10} /> العنوان</p>
                    <p className="leading-relaxed">{order.address}</p>
                  </div>
                </div>
              </div>

              {/* Products */}
              <div className="card-section p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Package size={15} className="text-[hsl(var(--primary))]" />
                  <h4 className="text-sm font-bold">المنتجات</h4>
                </div>
                <div className="bg-[hsl(var(--muted))]/40 rounded-xl p-3">
                  <p className="text-sm font-medium">{order.products}</p>
                  <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">إجمالي الكمية: {order.quantity} قطعة</p>
                </div>
              </div>

              {/* Financials */}
              <div className="card-section p-4">
                <div className="flex items-center gap-2 mb-3">
                  <FileText size={15} className="text-[hsl(var(--primary))]" />
                  <h4 className="text-sm font-bold">الملخص المالي</h4>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between py-1.5 border-b border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--muted-foreground))]">المنتجات:</span>
                    <span className="font-mono font-semibold">{order.subtotal.toLocaleString('en-US')} ج.م</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--muted-foreground))]">
                      {shippingLabel}:
                      {order.expressShipping && <span className="text-[10px] text-amber-600 mr-1">(بدلاً من الشحن الافتراضي)</span>}
                    </span>
                    <span className={`font-mono ${order.expressShipping ? 'text-amber-700 font-semibold' : ''}`}>{order.shippingFee.toLocaleString('en-US')} ج.م</span>
                  </div>
                  {/* Extra fee: only shown to admin */}
                  {IS_ADMIN && extraFee > 0 && (
                    <div className="flex justify-between py-1.5 border-b border-[hsl(var(--border))] text-orange-700">
                      <span>مصاريف شحن إضافية (أدمن):</span>
                      <span className="font-mono">+ {extraFee.toLocaleString('en-US')} ج.م</span>
                    </div>
                  )}
                  <div className="flex justify-between py-1.5">
                    <span className="font-bold">الإجمالي الكلي:</span>
                    <span className="font-mono font-bold text-lg text-[hsl(var(--primary))]">{order.total.toLocaleString('en-US')} ج.م</span>
                  </div>
                </div>
              </div>

              {/* Sensitive info — only for admin/supervisor/delegate/manager */}
              {CAN_SEE_SENSITIVE && (
                <div className="border border-amber-200 bg-amber-50 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Shield size={14} className="text-amber-600" />
                    <h4 className="text-sm font-bold text-amber-800">معلومات التسجيل (للمفوضين فقط)</h4>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div className="bg-white rounded-lg p-2.5 border border-amber-100">
                      <p className="text-[hsl(var(--muted-foreground))] mb-1">المسجِّل</p>
                      <p className="font-semibold">{order.createdBy}</p>
                    </div>
                    <div className="bg-white rounded-lg p-2.5 border border-amber-100">
                      <p className="text-[hsl(var(--muted-foreground))] mb-1">IP الجهاز</p>
                      <p className="font-mono">{order.ip || order.createdByIp || '—'}</p>
                    </div>
                    <div className="bg-white rounded-lg p-2.5 border border-amber-100">
                      <p className="text-[hsl(var(--muted-foreground))] mb-1 flex items-center gap-1"><MapPin size={10} /> الموقع</p>
                      <p className="font-semibold">{order.createdByLocation || 'القاهرة، مصر'}</p>
                    </div>
                    <div className="bg-white rounded-lg p-2.5 border border-amber-100">
                      <p className="text-[hsl(var(--muted-foreground))] mb-1 flex items-center gap-1"><Monitor size={10} /> الجهاز</p>
                      <p className="font-semibold flex items-center gap-1">
                        <DeviceIcon device={order.createdByDevice} />
                        {order.createdByDevice || 'كمبيوتر'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {order.notes && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <p className="text-xs font-bold text-amber-700 mb-1">ملاحظات</p>
                  <p className="text-sm text-[hsl(var(--foreground))]">{order.notes}</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'tab-history' && (
            <div className="space-y-3 fade-in">
              <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">سجل كامل لجميع تحديثات الحالة مع التوقيت الكامل والمسؤول</p>
              <div className="relative">
                <div className="absolute right-4 top-0 bottom-0 w-0.5 bg-[hsl(var(--border))]" />
                <div className="space-y-4">
                  {MOCK_STATUS_HISTORY.map((h, i) => (
                    <div key={h.id} className="flex items-start gap-4 relative">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center z-10 flex-shrink-0 ${i === MOCK_STATUS_HISTORY.length - 1 ? 'bg-[hsl(var(--primary))] text-white' : 'bg-green-100 text-green-600'}`}>
                        <CheckCircle size={16} />
                      </div>
                      <div className="flex-1 bg-white border border-[hsl(var(--border))] rounded-xl p-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className={`badge ${STATUS_BADGE_MAP[h.status]?.cls || 'status-new'} text-[11px]`}>{h.label}</span>
                          <span className="text-xs text-[hsl(var(--muted-foreground))] font-mono">{h.day} {h.date} — {h.time}</span>
                        </div>
                        <p className="text-xs text-[hsl(var(--muted-foreground))]">بواسطة: <span className="font-semibold text-[hsl(var(--foreground))]">{h.by}</span></p>
                        {CAN_SEE_SENSITIVE && (
                          <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1 flex items-center gap-1">
                            <DeviceIcon device={h.device} />
                            <span>{h.device}</span>
                          </p>
                        )}
                        {h.note && <p className="text-xs text-[hsl(var(--foreground))] mt-1.5 bg-[hsl(var(--muted))]/50 rounded-lg px-2 py-1 italic">"{h.note}"</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'tab-notifications' && (
            <div className="space-y-3 fade-in">
              <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">سجل جميع الإشعارات المرتبطة بهذا الأوردر</p>
              {MOCK_NOTIFICATIONS.length === 0 ? (
                <div className="text-center py-10 text-[hsl(var(--muted-foreground))]">
                  <p className="text-sm">لا توجد إشعارات لهذا الأوردر</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {MOCK_NOTIFICATIONS.map((notif) => {
                    const typeConfig: Record<string, { color: string; label: string }> = {
                      status_change: { color: 'bg-blue-50 border-blue-200 text-blue-700', label: 'تغيير حالة' },
                      whatsapp: { color: 'bg-green-50 border-green-200 text-green-700', label: 'واتساب' },
                      order_created: { color: 'bg-purple-50 border-purple-200 text-purple-700', label: 'إنشاء أوردر' },
                    };
                    const cfg = typeConfig[notif.type] || { color: 'bg-gray-50 border-gray-200 text-gray-700', label: 'إشعار' };
                    return (
                      <div key={notif.id} className={`border rounded-xl p-3 ${cfg.color}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/60">{cfg.label}</span>
                              <span className="text-xs font-semibold">{notif.message}</span>
                            </div>
                            <p className="text-[11px] opacity-80">بواسطة: {notif.by}</p>
                          </div>
                          <div className="text-left flex-shrink-0">
                            <p className="text-[10px] font-mono opacity-70">{notif.date}</p>
                            <p className="text-[10px] font-mono opacity-70">{notif.time}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === 'tab-invoice' && (
            <div className="fade-in">
              <div id="invoice-print-area" className="border-2 border-[hsl(var(--border))] rounded-2xl overflow-hidden">
                <div className="bg-[hsl(var(--primary))] text-white p-6 text-center">
                  <h2 className="text-2xl font-bold">Zahranship</h2>
                  <p className="text-blue-200 text-sm mt-1">فاتورة ضريبية مبسطة</p>
                </div>

                <div className="p-6 space-y-4">
                  <div className="flex justify-between text-sm border-b border-[hsl(var(--border))] pb-4">
                    <div>
                      <p className="text-[hsl(var(--muted-foreground))] text-xs mb-1">رقم الفاتورة</p>
                      <p className="font-mono font-bold text-[hsl(var(--primary))]">{order.orderNum}</p>
                    </div>
                    <div className="text-left">
                      <p className="text-[hsl(var(--muted-foreground))] text-xs mb-1">تاريخ الإصدار</p>
                      <p className="font-semibold">{order.day} {order.date}</p>
                      <p className="text-xs font-mono text-[hsl(var(--muted-foreground))]">{order.time}</p>
                    </div>
                  </div>

                  <div className="text-sm">
                    <p className="text-[hsl(var(--muted-foreground))] text-xs mb-2 font-bold uppercase tracking-wide">بيانات العميل</p>
                    <p className="font-bold text-base">{order.customer}</p>
                    <p className="font-mono text-[hsl(var(--muted-foreground))]">{order.phone}</p>
                    <p className="text-[hsl(var(--muted-foreground))] mt-1">{order.region}{order.district ? ` - ${order.district}` : ''} — {order.address}</p>
                  </div>

                  <div>
                    <p className="text-[hsl(var(--muted-foreground))] text-xs mb-2 font-bold uppercase tracking-wide">المنتجات</p>
                    <div className="bg-[hsl(var(--muted))]/40 rounded-xl overflow-hidden">
                      <div className="grid grid-cols-3 gap-4 px-4 py-2 bg-[hsl(var(--muted))] text-xs font-bold text-[hsl(var(--muted-foreground))]">
                        <span>المنتج</span>
                        <span className="text-center">الكمية</span>
                        <span className="text-left">الإجمالي</span>
                      </div>
                      <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm border-t border-[hsl(var(--border))]">
                        <span>{order.products}</span>
                        <span className="text-center">{order.quantity}</span>
                        <span className="text-left font-mono">{order.subtotal.toLocaleString('en-US')} ج.م</span>
                      </div>
                      <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm border-t border-[hsl(var(--border))]">
                        <span className={`text-[hsl(var(--muted-foreground))] ${order.expressShipping ? 'text-amber-700 font-semibold' : ''}`}>{shippingLabel}</span>
                        <span className="text-center">—</span>
                        <span className="text-left font-mono">{order.shippingFee.toLocaleString('en-US')} ج.م</span>
                      </div>
                      {/* Extra fee only shown to admin in invoice preview */}
                      {IS_ADMIN && extraFee > 0 && (
                        <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm border-t border-[hsl(var(--border))] text-orange-700">
                          <span>مصاريف شحن إضافية</span>
                          <span className="text-center">—</span>
                          <span className="text-left font-mono">{extraFee.toLocaleString('en-US')} ج.م</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="bg-[hsl(var(--primary))]/5 border border-[hsl(var(--primary))]/20 rounded-xl p-4 flex justify-between items-center">
                    <span className="font-bold text-lg">الإجمالي الكلي</span>
                    <span className="font-mono font-bold text-2xl text-[hsl(var(--primary))]">{order.total.toLocaleString('en-US')} ج.م</span>
                  </div>

                  <p className="text-center text-xs text-[hsl(var(--muted-foreground))] pt-2">
                    شكرا لثقتك في Zahranship — للاستفسار: info@zahranship.com
                  </p>
                </div>
              </div>

              <div className="flex gap-3 mt-4">
                <button onClick={handlePrintInvoice} className="btn-primary flex-1 justify-center">
                  <Printer size={15} />
                  طباعة / تحميل PDF
                </button>
                <button onClick={handleSendWhatsApp} className="flex-1 flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors active:scale-95">
                  <MessageCircle size={15} />
                  إرسال واتساب
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}