'use client';
import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Toaster } from 'sonner';
import { X, Clock, AlertTriangle, CheckCircle, MapPin, ShieldOff } from 'lucide-react';
import { useAuth, getPermissionsForRoleId } from '@/contexts/AuthContext';
import { addAuditLog, getAuditLogs } from './AuditLogModal';
import { createClient } from '@/lib/supabase/client';
// Phase 22P — structured `note` payload. The audit-log `note`
// column carries `JSON.stringify({ reason?, note? })` so cancellation
// / return reasons and free-form admin notes survive into every
// history surface; legacy plain-text rows are still understood.
import { buildAuditNote, parseAuditNote } from '@/lib/orders/auditNote';
import { isAdminRole } from '@/lib/constants/roles';
import { getDisplayName, getRoleLabel } from '@/lib/utils/userDisplay';
import { UserStamp } from '@/components/UserStamp';

interface Order {
  id: string;
  orderNum: string;
  customer: string;
  phone: string;
  status: string;
  delegateName?: string;
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

// Phase 22L — local ROLE_LABEL replaced by the shared getRoleLabel
// helper imported above. Centralised mapping covers r1..r6 ids,
// legacy English names, and already-Arabic labels with a single
// source of truth, eliminating the per-file drift.

interface Props {
  order: Order;
  onClose: () => void;
  onUpdate?: () => void;
}

export default function StatusUpdateModal({ order, onClose, onUpdate }: Props) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [delegates, setDelegates] = useState<string[]>([]);
  const [selectedDelegate, setSelectedDelegate] = useState(order.delegateName || '');
  // Phase 22B: maintain a name → profile.id resolver so the status
  // write can populate `assigned_to` (UUID) alongside `delegate_name`
  // (text). Names that are shared by ≥ 2 profiles are tracked in
  // `ambiguousDelegateNames` and resolve to null on write — matching
  // the conservative rule from the Phase 22B SQL backfill.
  const [delegateNameToProfileId, setDelegateNameToProfileId] = useState<Record<string, string>>(
    {}
  );
  const [ambiguousDelegateNames, setAmbiguousDelegateNames] = useState<Set<string>>(new Set());

  // Load delegates from Supabase profiles (role_id r3 or r4)
  React.useEffect(() => {
    const loadDelegates = async () => {
      const delegateSet = new Set<string>();
      const nameToId: Record<string, string> = {};
      const ambiguous = new Set<string>();
      try {
        const supabase = createClient();
        // 1. PRIMARY SOURCE: Load delegates from Supabase profiles table
        const { data: profileDelegates } = await supabase
          .from('profiles')
          .select('id, full_name, email')
          .in('role_id', ['r3', 'r4']);
        if (profileDelegates) {
          profileDelegates.forEach((p: any) => {
            const rawName = p.full_name || p.email?.split('@')[0] || '';
            if (!rawName) return;
            const norm = String(rawName).trim();
            if (!norm) return;
            delegateSet.add(rawName);
            if (nameToId[norm] && nameToId[norm] !== p.id) {
              ambiguous.add(norm);
            } else {
              nameToId[norm] = p.id;
            }
          });
        }
        // 2. SECONDARY SOURCE: Also include delegate names from existing orders
        const { data: orderDelegates } = await supabase
          .from('turath_masr_orders')
          .select('delegate_name')
          .not('delegate_name', 'is', null)
          .not('delegate_name', 'eq', '');
        if (orderDelegates) {
          orderDelegates.forEach((row: any) => {
            if (row.delegate_name) delegateSet.add(row.delegate_name);
          });
        }
      } catch (err) {
        console.error('Error loading delegates:', err);
      }
      setDelegates(Array.from(delegateSet).sort());
      setDelegateNameToProfileId(nameToId);
      setAmbiguousDelegateNames(ambiguous);
    };
    loadDelegates();
  }, []);
  // `authUser` is the Supabase auth.users object (has `id` UUID for RLS).
  // The local `getCurrentUser()` below is a display-name helper that
  // shadows nothing since we renamed the destructured user here.
  const { user: authUser, currentRole, currentRoleId, profileFullName } = useAuth();

  // Permission-based check: check if user has 'update_status' permission
  const userPermissions = currentRoleId ? getPermissionsForRoleId(currentRoleId) : [];
  const canUpdate = isAdminRole(currentRoleId) || userPermissions.includes('update_status');

  // Phase 22L — resolve the actor for audit logs from AuthContext, not
  // localStorage. The previous implementation read `current_user` from
  // localStorage and, when missing, fell back to ROLE_LABEL[currentRole]
  // as the *name* — which is exactly how 162 audit_log rows ended up
  // with `changed_by="مستخدم"` and `changed_by_role="خدمة عملاء"`. The
  // new chain prefers the cached profile.full_name (Phase 20D-Fix2), then
  // user_metadata.full_name, then email; getDisplayName drops any
  // candidate that exactly equals the role label or the legacy
  // "مستخدم" placeholder so a real name further down the chain can
  // win. The role line uses currentRole (the Arabic profile.role_name)
  // so it lines up with the audit_log display surface 1-for-1.
  const getCurrentUser = () => {
    const role =
      currentRole && currentRole.trim() ? currentRole : getRoleLabel(currentRoleId ?? '');
    const candidates = [profileFullName, authUser?.user_metadata?.full_name, authUser?.email];
    return { name: getDisplayName(candidates, role), role };
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

  // Load real audit logs for this order (async)
  const [statusHistory, setStatusHistory] = React.useState<any[]>([]);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const logs = await getAuditLogs(order.id);
        if (!cancelled) {
          setStatusHistory(logs.filter((l) => l.action === 'status_change'));
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [order.id]);

  const onSubmit = async (data: StatusFormData) => {
    if (!canUpdate) {
      toast.error('ليس لديك صلاحية تحديث حالة الأوردر');
      return;
    }
    setIsSubmitting(true);

    const user = getCurrentUser();
    const statusLabel =
      STATUS_OPTIONS.find((s) => s.value === data.newStatus)?.label || data.newStatus;

    // Phase 22P — persist BOTH the destructive-status reason and the
    // free-form admin note instead of OR-collapsing them into one
    // string (the previous `data.reason || data.note || ''` dropped
    // the note whenever a reason was present, so admins lost half
    // their input the moment they cancelled or returned an order).
    // The reason field is only surfaced for cancelled / returned
    // statuses (the form hides the input otherwise), so we gate it
    // on `isDestructive` to avoid persisting a stale draft if the
    // user toggled the status away from a destructive option.
    const noteValue = buildAuditNote({
      reason: isDestructive ? data.reason : undefined,
      note: data.note,
    });

    // Log the status change
    await addAuditLog({
      orderId: order.id,
      orderNum: order.orderNum,
      action: 'status_change',
      oldValue: order.status,
      newValue: data.newStatus,
      changedBy: user.name,
      changedByRole: user.role ?? '',
      // `addAuditLog` writes `entry.note || null` to the DB, so an
      // undefined here cleanly maps to NULL when neither input was
      // supplied. The shape stays compatible with the Phase 22L
      // legacy callers that still pass plain strings.
      note: noteValue ?? undefined,
    });

    // Sync status update to Supabase
    try {
      const supabase = createClient();
      // Add updated_by traceability for the orders_editor_update RLS policy
      // and for the post-migration audit trail. authUser.id is the auth.users UUID.
      //
      // Phase 22B: dual-write delegate identity. `delegate_name` (text)
      // stays as a display cache — old orders without `assigned_to`
      // still render. `assigned_to` (UUID → auth.users) is the new
      // primary key; we resolve it from `delegate_name` via the
      // profiles map built at mount. Names shared by ≥2 profiles
      // (e.g. duplicate "Ali") resolve to null — same conservative
      // rule used by the Phase 22B SQL backfill — so the dropdown
      // stays usable but we never commit to the wrong UUID silently.
      const normDelegate = (selectedDelegate || '').trim();
      const resolvedAssignedTo =
        normDelegate && !ambiguousDelegateNames.has(normDelegate)
          ? delegateNameToProfileId[normDelegate] || null
          : null;
      const updatePayload: Record<string, unknown> = {
        status: data.newStatus,
        delegate_name: selectedDelegate || null,
        assigned_to: resolvedAssignedTo,
      };
      if (authUser?.id) {
        updatePayload.updated_by = authUser.id;
      }
      const { error } = await supabase
        .from('turath_masr_orders')
        .update(updatePayload)
        .eq('order_num', order.orderNum);

      if (error) {
        throw error;
      }

      // The "status_change" system notification is now produced by the
      // AFTER UPDATE OF status trigger trg_notify_on_order_status_change
      // on turath_masr_orders (see migration 20260506_secure_tracking_rpc.sql).
      // The trigger runs as SECURITY DEFINER so r4 / r6 / anon callers all
      // get the notification recorded — without needing a relaxed insert
      // policy on turath_masr_notifications.
      //
      // The previous client-side insert was duplicated by every status
      // update and would silently fail under the new RLS for r4/r6.
      //
      // The customer-targeted notification (type='customer_order_update')
      // is intentionally dropped here — there is no customer-facing
      // notification surface yet (no SMS / push), so writing it to the
      // staff-only notifications table just produced noise. TODO: when a
      // customer notification channel is built, add it via a separate
      // SECURITY DEFINER RPC that knows how to deliver it.

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
      {/* Phase 22P — bound the card to 90 % viewport height and lay it
          out as a flex column so the header pins at top, the body
          scrolls, and the action footer pins at bottom. Before this
          phase the form rendered as a single unbounded column: when
          the status grid + return-reason + delegate + note + history
          all stacked, the "تأكيد التحديث" / "إلغاء" buttons fell
          below the viewport on standard laptop screens and admins had
          no way to reach them without scrolling the page itself. */}
      <div className="relative bg-white rounded-3xl shadow-modal w-full max-w-lg max-h-[90vh] flex flex-col fade-in">
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between p-5 border-b border-[hsl(var(--border))]">
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
                  {getRoleLabel(currentRole ?? currentRoleId ?? '') ||
                    (currentRoleId ? `دور #${currentRoleId}` : currentRole)}
                </span>
              </p>
            </div>
            <button onClick={onClose} className="btn-secondary w-full justify-center">
              إغلاق
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="flex-1 flex flex-col min-h-0">
            {/* Phase 22P — body scrolls between the fixed header and
                the sticky action footer so long forms (status grid +
                reason + delegate + note + history) never push the
                buttons off the viewport. */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4 scrollbar-thin">
              {/* Role badge */}
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2">
                <CheckCircle size={14} className="text-green-600" />
                <span className="text-xs text-green-700 font-semibold">
                  لديك صلاحية تحديث الحالة —{' '}
                  {getRoleLabel(currentRole ?? currentRoleId ?? '') ||
                    (currentRoleId ? `دور #${currentRoleId}` : currentRole)}
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

              {/* Delegate Assignment */}
              <div>
                <label className="label-text">تعيين مندوب</label>
                <p className="text-xs text-[hsl(var(--muted-foreground))] mb-1.5">
                  اختر المندوب المسؤول عن هذا الأوردر
                </p>
                <select
                  className="input-field w-full"
                  value={selectedDelegate}
                  onChange={(e) => setSelectedDelegate(e.target.value)}
                >
                  <option value="">— بدون مندوب —</option>
                  {delegates.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

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
                  {/* Phase 22P — removed the inner `max-h-36
                    overflow-y-auto` scroll. The body wrapper above now
                    owns scrolling for the whole form, so the history
                    can grow naturally without nested scroll regions
                    fighting for the user's wheel events. */}
                  <div className="space-y-2">
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
                      // Phase 22P — split the structured note payload
                      // (`{ reason?, note? }`) for separate rendering so
                      // admins can tell return reasons from free-form
                      // notes at a glance. Legacy plain-text rows fall
                      // through to `parsed.raw` and render as a single
                      // italic quote (same as before this phase).
                      const parsedNote = parseAuditNote(h.note);
                      const hasNoteBlock =
                        Boolean(parsedNote.reason) ||
                        Boolean(parsedNote.note) ||
                        Boolean(parsedNote.raw);
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
                            {/* Phase 22L — two-line user stamp: real
                              name on top, role on the bottom. Replaces
                              the previous "name (role)" inline form
                              that, on legacy rows, rendered as
                              "مستخدم (خدمة عملاء)". */}
                            <div className="mt-0.5 flex items-center gap-1 text-[hsl(var(--muted-foreground))]">
                              <span>بواسطة:</span>
                              <UserStamp name={h.changedBy} role={h.changedByRole} size="sm" />
                            </div>
                            {hasNoteBlock && (
                              <div className="mt-1 space-y-0.5 text-[hsl(var(--foreground))]">
                                {parsedNote.reason && (
                                  <p className="leading-snug">
                                    <span className="font-semibold text-red-700">سبب الإرجاع:</span>{' '}
                                    <span className="italic">{parsedNote.reason}</span>
                                  </p>
                                )}
                                {parsedNote.note && (
                                  <p className="leading-snug">
                                    <span className="font-semibold">ملاحظة:</span>{' '}
                                    <span className="italic">{parsedNote.note}</span>
                                  </p>
                                )}
                                {parsedNote.raw && (
                                  <p className="italic leading-snug">"{parsedNote.raw}"</p>
                                )}
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

            {/* Phase 22P — sticky action footer. Sits OUTSIDE the
                scroll body but INSIDE the form so submit still wires
                up to the onSubmit handler. `flex-shrink-0` keeps the
                footer at its intrinsic height regardless of body
                content; the white bg + top border separate it
                visually from the scrolling content above. */}
            <div className="flex-shrink-0 flex gap-3 p-4 border-t border-[hsl(var(--border))] bg-white rounded-b-3xl">
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
