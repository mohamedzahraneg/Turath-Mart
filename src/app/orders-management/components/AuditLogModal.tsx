'use client';
import React, { useEffect, useState } from 'react';
import { X, Clock, User, Edit2, RefreshCw, AlertCircle } from 'lucide-react';

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

const ROLE_LABEL: Record<string, string> = {
  manager: 'مدير',
  admin: 'أدمن',
  supervisor: 'مشرف شحن',
  shipping: 'مندوب',
  data_entry: 'مدخل بيانات',
};

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

export function getAuditLogs(orderId: string): AuditEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const all = JSON.parse(localStorage.getItem('turath_masr_audit_logs') || '[]') as AuditEntry[];
    return all
      .filter((e) => e.orderId === orderId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch {
    return [];
  }
}

export function addAuditLog(entry: Omit<AuditEntry, 'id' | 'createdAt'>) {
  if (typeof window === 'undefined') return;
  try {
    const all = JSON.parse(localStorage.getItem('turath_masr_audit_logs') || '[]') as AuditEntry[];
    const newEntry: AuditEntry = {
      ...entry,
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
    };
    all.unshift(newEntry);
    // Keep last 500 entries
    const trimmed = all.slice(0, 500);
    localStorage.setItem('turath_masr_audit_logs', JSON.stringify(trimmed));
    window.dispatchEvent(
      new CustomEvent('turath_masr_audit_updated', { detail: { orderId: entry.orderId } })
    );
  } catch {}
}

export default function AuditLogModal({ orderId, orderNum, onClose }: Props) {
  const [logs, setLogs] = useState<AuditEntry[]>([]);

  const loadLogs = () => setLogs(getAuditLogs(orderId));

  useEffect(() => {
    loadLogs();
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.orderId || detail.orderId === orderId) loadLogs();
    };
    window.addEventListener('turath_masr_audit_updated', handler);
    return () => window.removeEventListener('turath_masr_audit_updated', handler);
  }, [orderId]);

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return (
        d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) +
        ' — ' +
        d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      );
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
                        <div className="flex items-center gap-1.5 text-xs mb-1">
                          <User size={11} />
                          <span className="font-semibold">{log.changedBy}</span>
                          <span className="opacity-60">
                            ({ROLE_LABEL[log.changedByRole] || log.changedByRole})
                          </span>
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
                        {log.note && (
                          <p className="text-xs mt-1.5 italic opacity-80">"{log.note}"</p>
                        )}
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
