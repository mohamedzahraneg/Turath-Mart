'use client';
import React, { useState } from 'react';
import { toast } from 'sonner';
import { Toaster } from 'sonner';
import { X, User, Phone, MapPin, Package, FileText, MessageCircle, Mail, Printer, CheckCircle } from 'lucide-react';

interface Order {
  id: string;
  orderNum: string;
  createdBy: string;
  customer: string;
  phone: string;
  phone2?: string;
  region: string;
  address: string;
  products: string;
  quantity: number;
  subtotal: number;
  shippingFee: number;
  total: number;
  status: string;
  date: string;
  time: string;
  day: string;
  notes?: string;
  ip: string;
}

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
  { id: 'dh-001', status: 'new', label: 'جديد', date: '٢٧/٠٣/٢٠٢٦', time: '٠٩:٣٢', day: 'الجمعة', by: 'محمد حسن', note: 'تم تسجيل الأوردر' },
  { id: 'dh-002', status: 'preparing', label: 'جاري التجهيز', date: '٢٧/٠٣/٢٠٢٦', time: '١١:١٥', day: 'الجمعة', by: 'أحمد السيد (مدير)', note: 'تم تجهيز الطلب' },
  { id: 'dh-003', status: 'shipping', label: 'جاري الشحن', date: '٢٧/٠٣/٢٠٢٦', time: '١٣:٤٠', day: 'الجمعة', by: 'علي محمود (مندوب)', note: 'الطلب في الطريق' },
];

const TABS = [
  { id: 'tab-details', label: 'تفاصيل الأوردر' },
  { id: 'tab-history', label: 'سجل الحالات' },
  { id: 'tab-invoice', label: 'الفاتورة' },
];

interface Props {
  order: Order;
  onClose: () => void;
}

export default function OrderDetailModal({ order, onClose }: Props) {
  const [activeTab, setActiveTab] = useState('tab-details');
  const statusInfo = STATUS_BADGE_MAP[order.status] || STATUS_BADGE_MAP['new'];

  const handleSendWhatsApp = () => {
    // TODO: Integrate WhatsApp Business API POST /api/orders/:id/send-whatsapp
    const msg = encodeURIComponent(`مرحباً ${order.customer}، تم استلام طلبك رقم ${order.orderNum} بإجمالي ${order.total} ج.م. سيتم التواصل معك قريباً. شكراً لثقتك في Zahranship`);
    window.open(`https://wa.me/2${order.phone}?text=${msg}`, '_blank');
    toast.success('تم فتح واتساب لإرسال الرسالة');
  };

  const handleSendEmail = () => {
    // TODO: POST /api/orders/:id/send-invoice-email
    toast.success('تم إرسال الفاتورة بالبريد الإلكتروني');
  };

  const handlePrintInvoice = () => {
    // TODO: GET /api/orders/:id/invoice-pdf — generate and open PDF
    toast.success('جاري تحضير الفاتورة للطباعة...');
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
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">{order.day} {order.date} — {order.time}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-[hsl(var(--muted))] transition-colors" aria-label="إغلاق">
            <X size={16} />
          </button>
        </div>

        {/* Quick actions */}
        <div className="flex gap-2 px-5 py-3 bg-[hsl(var(--muted))]/30 border-b border-[hsl(var(--border))]">
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
            طباعة الفاتورة
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[hsl(var(--border))] px-5">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors ${activeTab === tab.id ? 'border-[hsl(var(--primary))] text-[hsl(var(--primary))]' : 'border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'}`}
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
                    <p className="font-semibold">{order.region}</p>
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
                    <span className="font-mono font-semibold">{order.subtotal.toLocaleString('ar-EG')} ج.م</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--muted-foreground))]">تكلفة الشحن:</span>
                    <span className="font-mono">{order.shippingFee} ج.م</span>
                  </div>
                  <div className="flex justify-between py-1.5">
                    <span className="font-bold">الإجمالي الكلي:</span>
                    <span className="font-mono font-bold text-lg text-[hsl(var(--primary))]">{order.total.toLocaleString('ar-EG')} ج.م</span>
                  </div>
                </div>
              </div>

              {/* Meta */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-[hsl(var(--muted))]/40 rounded-xl p-3">
                  <p className="text-[hsl(var(--muted-foreground))] mb-1">المسجِّل</p>
                  <p className="font-semibold">{order.createdBy}</p>
                </div>
                <div className="bg-[hsl(var(--muted))]/40 rounded-xl p-3">
                  <p className="text-[hsl(var(--muted-foreground))] mb-1">IP الجهاز</p>
                  <p className="font-mono">{order.ip}</p>
                </div>
              </div>

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
              <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">
                سجل كامل لجميع تحديثات الحالة مع التوقيت والمسؤول
              </p>
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
                          <span className="text-xs text-[hsl(var(--muted-foreground))]">{h.day} {h.date} — {h.time}</span>
                        </div>
                        <p className="text-xs text-[hsl(var(--muted-foreground))]">بواسطة: <span className="font-semibold text-[hsl(var(--foreground))]">{h.by}</span></p>
                        {h.note && <p className="text-xs text-[hsl(var(--foreground))] mt-1.5 bg-[hsl(var(--muted))]/50 rounded-lg px-2 py-1 italic">"{h.note}"</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'tab-invoice' && (
            <div className="fade-in">
              {/* Invoice preview */}
              <div className="border-2 border-[hsl(var(--border))] rounded-2xl overflow-hidden">
                {/* Invoice header */}
                <div className="bg-[hsl(var(--primary))] text-white p-6 text-center">
                  <h2 className="text-2xl font-bold">Zahranship</h2>
                  <p className="text-blue-200 text-sm mt-1">فاتورة ضريبية مبسطة</p>
                </div>

                <div className="p-6 space-y-4">
                  {/* Invoice meta */}
                  <div className="flex justify-between text-sm border-b border-[hsl(var(--border))] pb-4">
                    <div>
                      <p className="text-[hsl(var(--muted-foreground))] text-xs mb-1">رقم الفاتورة</p>
                      <p className="font-mono font-bold text-[hsl(var(--primary))]">{order.orderNum}</p>
                    </div>
                    <div className="text-left">
                      <p className="text-[hsl(var(--muted-foreground))] text-xs mb-1">تاريخ الإصدار</p>
                      <p className="font-semibold">{order.day} {order.date}</p>
                    </div>
                  </div>

                  {/* Customer */}
                  <div className="text-sm">
                    <p className="text-[hsl(var(--muted-foreground))] text-xs mb-2 font-bold uppercase tracking-wide">بيانات العميل</p>
                    <p className="font-bold text-base">{order.customer}</p>
                    <p className="font-mono text-[hsl(var(--muted-foreground))]">{order.phone}</p>
                    <p className="text-[hsl(var(--muted-foreground))] mt-1">{order.region} — {order.address}</p>
                  </div>

                  {/* Items */}
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
                        <span className="text-left font-mono">{order.subtotal.toLocaleString('ar-EG')} ج.م</span>
                      </div>
                      <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm border-t border-[hsl(var(--border))]">
                        <span className="text-[hsl(var(--muted-foreground))]">تكلفة الشحن</span>
                        <span className="text-center">—</span>
                        <span className="text-left font-mono">{order.shippingFee} ج.م</span>
                      </div>
                    </div>
                  </div>

                  {/* Total */}
                  <div className="bg-[hsl(var(--primary))]/5 border border-[hsl(var(--primary))]/20 rounded-xl p-4 flex justify-between items-center">
                    <span className="font-bold text-lg">الإجمالي الكلي</span>
                    <span className="font-mono font-bold text-2xl text-[hsl(var(--primary))]">{order.total.toLocaleString('ar-EG')} ج.م</span>
                  </div>

                  {/* Footer */}
                  <p className="text-center text-xs text-[hsl(var(--muted-foreground))] pt-2">
                    شكراً لثقتك في Zahranship — للاستفسار: info@zahranship.com
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