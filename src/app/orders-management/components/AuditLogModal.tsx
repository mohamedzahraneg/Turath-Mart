'use client';
import React, { useEffect, useState, useCallback } from 'react';
import { X, Clock, User, Edit2, RefreshCw, AlertCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { UserStamp } from '@/components/UserStamp';
// Phase 22P — split structured `{ reason, note }` payloads in the
// audit log timeline so cancellation / return reasons stand apart
// from free-form admin notes. Legacy plain-text rows fall through
// to a single italic quote (same look as pre-Phase-22P).
import { parseAuditNote } from '@/lib/orders/auditNote';
// Phase 22Q — Arabic-locale formatters for the delivery schedule
// fragment that may live inside the audit note JSON.
import { formatScheduleDateAr, formatTime12hAr } from '@/lib/orders/scheduleFormat';

export interface AuditEntry {
  id: string;
  orderId: string;
  orderNum: string;
  action: string;
  fieldChanged?: string;
  oldValue?: string;
  newValue?: string;
  changedBy: string;
  changedByRole: string;
  note?: string;
  createdAt: string;
}

// Phase 22L — local ROLE_LABEL replaced by the shared getRoleLabel
// helper imported below. The previous local map didn't recognise
// r1..r6 ids and used a different "supervisor → مشرف شحن" mapping
// from the canonical "مشرف النظام", causing role labels to drift
// between this modal and the rest of the system.

const ACTION_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  status_change: {
    label: 'تغيير الحالة',
    color: 'bg-blue-50 border-blue-200 text-blue-700',
    icon: <RefreshCw size={13} />,
  },
  order_created: {
    label: 'إنشاء الأوردر',
    color: 'bg-green-50 border-green-200 text-green-700',
    icon: <Edit2 size={13} />,
  },
  order_edited: {
    label: 'تعديل الأوردر',
    color: 'bg-amber-50 border-amber-200 text-amber-700',
    icon: <Edit2 size={13} />,
  },
  order_deleted: {
    label: 'حذف الأوردر',
    color: 'bg-red-50 border-red-200 text-red-700',
    icon: <AlertCircle size={13} />,
  },
};

export const STATUS_LABELS: Record<string, string> = {
  new: 'جديد',
  preparing: 'جاري التجهيز',
  warehouse: 'في المستودع',
  shipping: 'جاري الشحن',
  delivered: 'تم التسليم',
  cancelled: 'ملغي',
  returned: 'مرتجع',
};

interface Props {
  orderId: string;
  orderNum: string;
  onClose: () => void;
}

export async function getAuditLogs(orderId: string): Promise<AuditEntry[]> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('turath_masr_audit_logs')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((row: any) => ({
      id: row.id,
      orderId: row.order_id,
      orderNum: row.order_num,
      action: row.action,
      fieldChanged: row.field_changed,
      oldValue: row.old_value,
      newValue: row.new_value,
      changedBy: row.changed_by,
      changedByRole: row.changed_by_role,
      note: row.note,
      createdAt: row.created_at,
    }));
  } catch {
    // Fallback to localStorage
    if (typeof window === 'undefined') return [];
    try {
      const all = JSON.parse(
        localStorage.getItem('turath_masr_audit_logs') || '[]'
      ) as AuditEntry[];
      return all
        .filter((e) => e.orderId === orderId)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch {
      return [];
    }
  }
}

export async function addAuditLog(entry: Omit<AuditEntry, 'id' | 'createdAt'>) {
  const now = new Date().toISOString();
  // Save to Supabase
  try {
    const supabase = createClient();
    await supabase.from('turath_masr_audit_logs').insert({
      order_id: entry.orderId,
      order_num: entry.orderNum,
      action: entry.action,
      field_changed: entry.fieldChanged || null,
      old_value: entry.oldValue || null,
      new_value: entry.newValue || null,
      changed_by: entry.changedBy,
      changed_by_role: entry.changedByRole,
      note: entry.note || null,
      created_at: now,
    });
  } catch (e) {
    console.error('Supabase audit log error:', e);
  }
  // Also save to localStorage as backup
  if (typeof window !== 'undefined') {
    try {
      const all = JSON.parse(
        localStorage.getItem('turath_masr_audit_logs') || '[]'
      ) as AuditEntry[];
      const newEntry: AuditEntry = {
        ...entry,
        id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        createdAt: now,
      };
      all.unshift(newEntry);
      const trimmed = all.slice(0, 500);
      localStorage.setItem('turath_masr_audit_logs', JSON.stringify(trimmed));
    } catch {}
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('turath_masr_audit_updated', { detail: { orderId: entry.orderId } })
    );
  }
}

export default function AuditLogModal({ orderId, orderNum, onClose }: Props) {
  const [logs, setLogs] = useState<AuditEntry[]>([]);

  // Stable reference so it can sit safely inside the useEffect deps array.
  const loadLogs = useCallback(async () => {
    const entries = await getAuditLogs(orderId);
    setLogs(entries);
  }, [orderId]);

  useEffect(() => {
    loadLogs();
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.orderId || detail.orderId === orderId) loadLogs();
    };
    window.addEventListener('turath_masr_audit_updated', handler);
    return () => window.removeEventListener('turath_masr_audit_updated', handler);
  }, [orderId, loadLogs]);

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      const days = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
      const dayName = days[d.getDay()];
      const date = d.toLocaleDateString('en-GB');
      const time = d.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
      return `${dayName} ${date} — ${time}`;
    } catch {
      return iso;
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-3xl shadow-modal w-full max-w-lg max-h-[85vh] flex flex-col fade-in">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-amber-100 rounded-xl flex items-center justify-center">
              <Clock size={18} className="text-amber-600" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[hsl(var(--foreground))]">سجل التعديلات</h3>
              <p className="text-xs text-[hsl(var(--muted-foreground))] font-mono mt-0.5">
                {orderNum}
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

        {/* Log list */}
        <div className="flex-1 overflow-y-auto p-5 scrollbar-thin">
          {logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="w-12 h-12 bg-[hsl(var(--muted))] rounded-2xl flex items-center justify-center">
                <Clock size={24} className="text-[hsl(var(--muted-foreground))]" />
              </div>
              <p className="text-sm font-semibold text-[hsl(var(--foreground))]">
                لا توجد تعديلات مسجلة
              </p>
              <p className="text-xs text-[hsl(var(--muted-foreground))] text-center">
                ستظهر هنا جميع التعديلات التي تُجرى على هذا الأوردر
              </p>
            </div>
          ) : (
            <div className="relative">
              <div className="absolute right-4 top-0 bottom-0 w-0.5 bg-[hsl(var(--border))]" />
              <div className="space-y-4">
                {logs.map((log, i) => {
                  const cfg = ACTION_CONFIG[log.action] || {
                    label: log.action,
                    color: 'bg-gray-50 border-gray-200 text-gray-700',
                    icon: <Edit2 size={13} />,
                  };
                  return (
                    <div key={log.id} className="flex items-start gap-4 relative">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center z-10 flex-shrink-0 ${i === 0 ? 'bg-[hsl(var(--primary))] text-white' : 'bg-white border-2 border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]'}`}
                      >
                        {cfg.icon}
                      </div>
                      <div className={`flex-1 border rounded-xl p-3 ${cfg.color}`}>
                        <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-white/60">
                            {cfg.label}
                          </span>
                          <span className="text-[10px] font-mono opacity-70">
                            {formatDate(log.createdAt)}
                          </span>
                        </div>
                        {/* Phase 22L — two-line user stamp instead
                            of the legacy inline "name (role)" form.
                            UserStamp shows full_name on top + Arabic
                            role label below; resolves r1..r6 ids and
                            legacy English role names through the
                            shared getRoleLabel helper so this modal
                            renders identically to every other audit
                            surface. Legacy rows that stored
                            "مستخدم" as the name still render — the
                            stamp degrades gracefully — but every
                            new row written via the fixed
                            StatusUpdateModal carries a real name. */}
                        <div className="flex items-center gap-1.5 mb-1">
                          <User size={11} />
                          <UserStamp name={log.changedBy} role={log.changedByRole} size="sm" />
                        </div>
                        {log.action === 'status_change' && log.oldValue && log.newValue && (
                          <div className="flex items-center gap-2 text-xs mt-1.5 bg-white/50 rounded-lg px-2 py-1">
                            <span className="line-through opacity-60">
                              {STATUS_LABELS[log.oldValue] || log.oldValue}
                            </span>
                            <span className="opacity-60">←</span>
                            <span className="font-bold">
                              {STATUS_LABELS[log.newValue] || log.newValue}
                            </span>
                          </div>
                        )}
                        {log.action === 'order_edited' && log.fieldChanged && (
                          <div className="text-xs mt-1.5 bg-white/50 rounded-lg px-2 py-1">
                            <span className="opacity-70">الحقل: </span>
                            <span className="font-semibold">{log.fieldChanged}</span>
                            {log.oldValue && log.newValue && (
                              <span className="opacity-70">
                                {' '}
                                ({log.oldValue} ← {log.newValue})
                              </span>
                            )}
                          </div>
                        )}
                        {/* Phase 22P — render reason + note from the
                            structured JSON envelope when present;
                            fall back to plain text for legacy rows
                            (`parsed.raw`). */}
                        {(() => {
                          const parsed = parseAuditNote(log.note);
                          if (!parsed.reason && !parsed.note && !parsed.schedule && !parsed.raw) {
                            return null;
                          }
                          return (
                            <div className="text-xs mt-1.5 space-y-0.5">
                              {parsed.reason && (
                                <p className="leading-snug">
                                  <span className="font-bold opacity-80">سبب الإرجاع:</span>{' '}
                                  <span className="italic opacity-80">{parsed.reason}</span>
                                </p>
                              )}
                              {/* Phase 22Q — schedule snapshot. */}
                              {parsed.schedule && (
                                <div className="leading-snug opacity-90">
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
                                  <span className="font-bold opacity-80">ملاحظة:</span>{' '}
                                  <span className="italic opacity-80">{parsed.note}</span>
                                </p>
                              )}
                              {parsed.raw && (
                                <p className="italic opacity-80 leading-snug">
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
          )}
        </div>

        <div className="p-4 border-t border-[hsl(var(--border))]">
          <p className="text-xs text-center text-[hsl(var(--muted-foreground))]">
            إجمالي التعديلات:{' '}
            <span className="font-bold text-[hsl(var(--foreground))]">{logs.length}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
