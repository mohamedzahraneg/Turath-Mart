'use client';
import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Toaster } from 'sonner';
import { X, Clock, AlertTriangle, CheckCircle, MapPin, ShieldOff } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { addAuditLog, getAuditLogs } from './AuditLogModal';
import { createClient } from '@/lib/supabase/client';

interface Order {
  id: string;
  orderNum: string;
  customer: string;
  phone: string;
  status: string;
}

interface StatusFormData {
  newStatus: string;
  note: string;
  reason: string;
}

const STATUS_OPTIONS = [
  { value: 'new', label: 'جديد', color: 'blue' },
  { value: 'preparing', label: 'جاري التجهيز للشحن', color: 'amber' },
  { value: 'warehouse', label: 'جاري تسليمه في المستودع', color: 'purple' },
  { value: 'shipping', label: 'جاري الشحن', color: 'orange' },
  { value: 'delivered', label: 'تم التسليم', color: 'green' },
  { value: 'cancelled', label: 'ملغي', color: 'red' },
  { value: 'returned', label: 'مرتجع', color: 'gray' },
];

const STATUS_BADGE_MAP: Record<string, string> = {
  new: 'status-new',
  preparing: 'status-preparing',
  warehouse: 'status-warehouse',
  shipping: 'status-shipping',
  delivered: 'status-delivered',
  cancelled: 'status-cancelled',
  returned: 'status-returned',
};

// Roles allowed to update order status
const ALLOWED_ROLES = ['manager', 'supervisor', 'shipping'];

const ROLE_LABEL: Record<string, string> = {
  manager: 'مدير',
  supervisor: 'مشرف شحن',
  shipping: 'مندوب',
  data_entry: 'مدخل بيانات',
};

interface Props {
  order: Order;
  onClose: () => void;
  onUpdate?: () => void;
}

export default function StatusUpdateModal({ order, onClose, onUpdate }: Props) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { currentRole } = useAuth();

  const canUpdate = ALLOWED_ROLES.includes(currentRole);

  // Get current user info from localStorage
  const getCurrentUser = () => {
    if (typeof window === 'undefined') return { name: 'مستخدم', role: currentRole };
    try {
      const stored = localStorage.getItem('current_user');
      if (stored) {
        const parsed = JSON.parse(stored);
        return { name: parsed?.name || parsed?.email || 'مستخدم', role: currentRole };
      }
    } catch {}
    return { name: ROLE_LABEL[currentRole] || 'مستخدم', role: currentRole };
  };

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<StatusFormData>({
    defaultValues: { newStatus: order.status, note: '', reason: '' },
  });

  const watchStatus = watch('newStatus');
  const isDestructive = watchStatus === 'cancelled' || watchStatus === 'returned';

  // Load real audit logs for this order
  const auditLogs = getAuditLogs(order.id);
  const statusHistory = auditLogs.filter((l) => l.action === 'status_change');

  const onSubmit = async (data: StatusFormData) => {
    if (!canUpdate) {
      toast.error('ليس لديك صلاحية تحديث حالة الأوردر');
      return;
    }
    setIsSubmitting(true);

    const user = getCurrentUser();
    const statusLabel =
      STATUS_OPTIONS.find((s) => s.value === data.newStatus)?.label || data.newStatus;
    const note = data.reason || data.note || '';

    // Log the status change
    addAuditLog({
      orderId: order.id,
      orderNum: order.orderNum,
      action: 'status_change',
      oldValue: order.status,
      newValue: data.newStatus,
      changedBy: user.name,
      changedByRole: user.role,
      note,
    });

    // Sync status update to Supabase
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('turath_masr_orders')
        .update({ status: data.newStatus })
        .eq('order_num', order.orderNum);

      if (error) {
        throw error;
      }

      // Create a system notification (for dashboard)
      await supabase.from('turath_masr_notifications').insert({
        type: 'status_change',
        title: 'تحديث حالة الأوردر 🔄',
        message: `تم تغيير حالة الأوردر ${order.orderNum} إلى ${statusLabel}`,
        order_id: order.id,
        order_num: order.orderNum,
        created_by: user.name,
        is_read: false
      });

      // Notify Customer (targeting their phone)
      await supabase.from('turath_masr_notifications').insert({
        type: 'customer_order_update',
        title: 'تحديث بخصوص طلبك',
        message: `مرحباً ${order.customer}، نود إخطارك بأن حالة طلبك رقم (${order.orderNum}) هي الآن: ${statusLabel}. شكراً لثقتك بنا.`,
        phone: order.phone,
        order_num: order.orderNum,
        is_read: false
      });

      window.dispatchEvent(new CustomEvent('turath_masr_orders_updated'));
    } catch (err) {
      console.error('Supabase update error:', err);
      toast.error('حدث خطأ أثناء تحديث الحالة في قاعدة البيانات');
      setIsSubmitting(false);
      return;
    }

    await new Promise((r) => setTimeout(r, 600));
    toast.success(`تم تحديث حالة الأوردر ${order.orderNum} إلى: ${statusLabel}`);
    setIsSubmitting(false);
    if (onUpdate) onUpdate();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir="rtl">
      <Toaster position="top-center" richColors />
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-3xl shadow-modal w-full max-w-lg fade-in">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[hsl(var(--border))]">
          <div>
            <h3 className="text-base font-bold text-[hsl(var(--foreground))]">
              تحديث حالة الأوردر
            </h3>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
              <span className="font-mono font-semibold text-[hsl(var(--primary))]">
                {order.orderNum}
              </span>
              {' — '}
              {order.customer}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-[hsl(var(--muted))] transition-colors"
            aria-label="إغلاق"
          >
            <X size={16} />
          </button>
        </div>

        {/* Access denied */}
        {!canUpdate ? (
          <div className="p-6 text-center space-y-4">
            <div className="w-14 h-14 bg-red-100 rounded-2xl flex items-center justify-center mx-auto">
              <ShieldOff size={28} className="text-red-500" />
            </div>
            <div>
              <p className="text-base font-bold text-[hsl(var(--foreground))]">غير مصرح لك</p>
              <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
                تحديث حالة الأوردر متاح فقط للمندوب ومشرف الشحن والمدير
              </p>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-2">
                دورك الحالي:{' '}
                <span className="font-semibold text-[hsl(var(--foreground))]">
                  {ROLE_LABEL[currentRole] || currentRole}
                </span>
              </p>
            </div>
            <button onClick={onClose} className="btn-secondary w-full justify-center">
              إغلاق
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="p-5 space-y-4">
            {/* Role badge */}
            <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2">
              <CheckCircle size={14} className="text-green-600" />
              <span className="text-xs text-green-700 font-semibold">
                لديك صلاحية تحديث الحالة — {ROLE_LABEL[currentRole] || currentRole}
              </span>
            </div>

            {/* Status selector */}
            <div>
              <label className="label-text">الحالة الجديدة *</label>
              <div className="grid grid-cols-2 gap-2 mt-1.5">
                {STATUS_OPTIONS.map((s) => (
                  <label
                    key={`status-opt-${s.value}`}
                    className={`flex items-center gap-2 p-3 rounded-xl border cursor-pointer transition-all ${watchStatus === s.value ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5' : 'border-[hsl(var(--border))] hover:border-gray-400'}`}
                  >
                    <input
                      type="radio"
                      value={s.value}
                      className="w-3.5 h-3.5 text-[hsl(var(--primary))]"
                      {...register('newStatus', { required: true })}
                    />
                    <span className={`badge ${STATUS_BADGE_MAP[s.value]} text-[11px]`}>
                      {s.label}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Reason — required for cancelled/returned */}
            {isDestructive && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 fade-in">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle size={15} className="text-red-500" />
                  <label className="text-sm font-bold text-red-700" htmlFor="reason">
                    سبب {watchStatus === 'cancelled' ? 'الإلغاء' : 'الإرجاع'} *
                  </label>
                </div>
                <textarea
                  id="reason"
                  rows={3}
                  className={`input-field resize-none border-red-300 focus:ring-red-400 ${errors.reason ? 'border-red-500' : ''}`}
                  placeholder={
                    watchStatus === 'cancelled'
                      ? 'اذكر سبب إلغاء الأوردر...'
                      : 'اذكر سبب إرجاع الأوردر...'
                  }
                  {...register('reason', {
                    required: isDestructive ? 'يجب ذكر السبب عند الإلغاء أو الإرجاع' : false,
                    minLength: { value: 10, message: 'السبب قصير جداً' },
                  })}
                />
                {errors.reason && (
                  <p className="text-red-600 text-xs mt-1">{errors.reason.message}</p>
                )}
              </div>
            )}

            {/* Note */}
            <div>
              <label className="label-text" htmlFor="statusNote">
                ملاحظة على هذا التحديث
              </label>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mb-1.5">
                ستظهر في سجل التعديلات
              </p>
              <textarea
                id="statusNote"
                rows={2}
                className="input-field resize-none"
                placeholder="أضف ملاحظة اختيارية..."
                {...register('note')}
              />
            </div>

            {/* Location note for delivery */}
            {watchStatus === 'delivered' && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-3 fade-in">
                <div className="flex items-center gap-2 text-green-700 text-sm">
                  <MapPin size={14} />
                  <span className="font-semibold">سيتم تسجيل موقع التسليم تلقائياً</span>
                </div>
                <p className="text-xs text-green-600 mt-1">
                  يجب التأكد من توقيع العميل أو OTP أو صورة البطاقة
                </p>
              </div>
            )}

            {/* Status history from audit logs */}
            {statusHistory.length > 0 && (
              <div>
                <p className="text-xs font-bold text-[hsl(var(--muted-foreground))] uppercase tracking-wide mb-2 flex items-center gap-1">
                  <Clock size={11} />
                  سجل الحالات السابقة ({statusHistory.length})
                </p>
                <div className="space-y-2 max-h-36 overflow-y-auto scrollbar-thin">
                  {statusHistory.map((h) => {
                    const d = new Date(h.createdAt);
                    const dateStr = d.toLocaleDateString('en-US', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                    });
                    const timeStr = d.toLocaleTimeString('en-US', {
                      hour: '2-digit',
                      minute: '2-digit',
                    });
                    return (
                      <div
                        key={h.id}
                        className="flex items-start gap-3 text-xs bg-[hsl(var(--muted))]/40 rounded-xl p-2.5"
                      >
                        <CheckCircle size={13} className="text-green-500 mt-0.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            {h.newValue && (
                              <span
                                className={`badge ${STATUS_BADGE_MAP[h.newValue] || 'status-new'} text-[10px]`}
                              >
                                {h.newValue === 'new'
                                  ? 'جديد'
                                  : h.newValue === 'preparing'
                                    ? 'جاري التجهيز'
                                    : h.newValue === 'warehouse'
                                      ? 'في المستودع'
                                      : h.newValue === 'shipping'
                                        ? 'جاري الشحن'
                                        : h.newValue === 'delivered'
                                          ? 'تم التسليم'
                                          : h.newValue === 'cancelled'
                                            ? 'ملغي'
                                            : 'مرتجع'}
                              </span>
                            )}
                            <span className="text-[hsl(var(--muted-foreground))]">
                              {dateStr} — {timeStr}
                            </span>
                          </div>
                          <p className="text-[hsl(var(--muted-foreground))] mt-0.5">
                            بواسطة:{' '}
                            <span className="font-semibold text-[hsl(var(--foreground))]">
                              {h.changedBy}
                            </span>{' '}
                            ({ROLE_LABEL[h.changedByRole] || h.changedByRole})
                          </p>
                          {h.note && (
                            <p className="text-[hsl(var(--foreground))] mt-0.5 italic">
                              "{h.note}"
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                className="btn-secondary flex-1 justify-center"
                onClick={onClose}
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className={`flex-1 justify-center ${isDestructive ? 'btn-danger' : 'btn-primary'}`}
              >
                {isSubmitting ? (
                  <>
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    <span>جاري التحديث...</span>
                  </>
                ) : (
                  <span>تأكيد التحديث</span>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
