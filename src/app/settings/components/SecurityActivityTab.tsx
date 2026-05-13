'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  LogIn,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type ActivityKind = 'audit' | 'login';

type StaffAuditRow = {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_label: string | null;
  description: string | null;
  created_at: string;
};

type LoginEventRow = {
  id: string;
  user_id: string | null;
  user_email: string | null;
  user_name: string | null;
  event_type: string;
  success: boolean | null;
  failure_reason: string | null;
  device_label: string | null;
  created_at: string;
};

const PAGE_SIZE = 20;

const actionLabels: Record<string, string> = {
  'order.created': 'إنشاء طلب',
  'order.status_changed': 'تغيير حالة طلب',
  'order.customer_updated': 'تعديل بيانات عميل',
  'staff.profile_updated': 'تعديل بيانات موظف',
  'staff.email_changed': 'تغيير بريد موظف',
  auth_user_deleted: 'حذف حساب دخول',
};

const eventLabels: Record<string, string> = {
  login: 'تسجيل دخول',
  refresh: 'تجديد جلسة',
  blocked: 'محاولة محظورة',
};

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat('ar-EG', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function pageRange(page: number) {
  const from = (page - 1) * PAGE_SIZE;
  return { from, to: from + PAGE_SIZE - 1 };
}

export default function SecurityActivityTab() {
  const [kind, setKind] = useState<ActivityKind>('audit');
  const [auditRows, setAuditRows] = useState<StaffAuditRow[]>([]);
  const [loginRows, setLoginRows] = useState<LoginEventRow[]>([]);
  const [auditPage, setAuditPage] = useState(1);
  const [loginPage, setLoginPage] = useState(1);
  const [auditTotal, setAuditTotal] = useState(0);
  const [loginTotal, setLoginTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentPage = kind === 'audit' ? auditPage : loginPage;
  const total = kind === 'audit' ? auditTotal : loginTotal;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { from, to } = pageRange(currentPage);

    if (kind === 'audit') {
      const {
        data,
        error: queryError,
        count,
      } = await supabase
        .from('turath_masr_staff_audit_logs')
        .select(
          'id, actor_id, actor_name, action, entity_type, entity_id, entity_label, description, created_at',
          {
            count: 'exact',
          }
        )
        .order('created_at', { ascending: false })
        .range(from, to);

      if (queryError) {
        setError(`تعذر تحميل سجل التدقيق: ${queryError.message}`);
      } else {
        setAuditRows((data ?? []) as StaffAuditRow[]);
        setAuditTotal(count ?? 0);
      }
    } else {
      const {
        data,
        error: queryError,
        count,
      } = await supabase
        .from('turath_masr_login_events')
        .select(
          'id, user_id, user_email, user_name, event_type, success, failure_reason, device_label, created_at',
          {
            count: 'exact',
          }
        )
        .order('created_at', { ascending: false })
        .range(from, to);

      if (queryError) {
        setError(`تعذر تحميل أحداث الدخول: ${queryError.message}`);
      } else {
        setLoginRows((data ?? []) as LoginEventRow[]);
        setLoginTotal(count ?? 0);
      }
    }

    setLoading(false);
  }, [currentPage, kind]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const summary = useMemo(() => {
    if (kind === 'audit') {
      return {
        title: 'سجل التدقيق',
        description:
          'آخر الإجراءات الإدارية والتشغيلية، محملة على صفحات صغيرة عند فتح هذا التبويب فقط.',
      };
    }

    return {
      title: 'أحداث الدخول',
      description:
        'آخر جلسات الدخول وتجديد الجلسات بدون تحميل سجل النشاط بالكامل مع صفحة الإعدادات.',
    };
  }, [kind]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-5">
        <div>
          <div className="flex items-center gap-3 text-blue-600 mb-2">
            <ShieldCheck size={20} />
            <span className="text-[11px] font-black uppercase tracking-widest">
              Security Activity
            </span>
          </div>
          <h2 className="text-2xl font-black text-gray-900">{summary.title}</h2>
          <p className="text-sm text-gray-500 mt-2 leading-relaxed">{summary.description}</p>
        </div>

        <div className="flex items-center bg-gray-100 p-1.5 rounded-2xl gap-1">
          <button
            type="button"
            onClick={() => setKind('audit')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black transition-all ${
              kind === 'audit'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            <Activity size={15} />
            التدقيق
          </button>
          <button
            type="button"
            onClick={() => setKind('login')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black transition-all ${
              kind === 'login'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            <LogIn size={15} />
            الدخول
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 bg-gray-50 border border-gray-100 rounded-3xl px-5 py-4">
        <div className="text-xs font-bold text-gray-500">
          يعرض {PAGE_SIZE} سجل في الصفحة. الإجمالي الحالي:{' '}
          <span className="text-gray-900">{total}</span>
        </div>
        <button
          type="button"
          onClick={loadRows}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-gray-100 text-xs font-black text-gray-700 hover:bg-gray-900 hover:text-white disabled:opacity-50 transition-all"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          تحديث
        </button>
      </div>

      {error ? (
        <div className="flex items-start gap-3 rounded-3xl border border-red-100 bg-red-50 p-5 text-sm font-bold text-red-700">
          <AlertTriangle size={18} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="space-y-3 min-h-[240px]">
        {loading ? (
          <div className="p-8 bg-gray-50 rounded-3xl text-center text-gray-400 font-black text-sm">
            جارِ تحميل السجلات...
          </div>
        ) : kind === 'audit' ? (
          auditRows.length ? (
            auditRows.map((row) => (
              <div
                key={row.id}
                className="rounded-3xl border border-gray-100 p-5 hover:border-blue-100 transition-colors"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-black text-gray-900">
                      <span>{actionLabels[row.action] ?? row.action}</span>
                      {row.entity_label ? (
                        <span className="text-gray-300">#{row.entity_label}</span>
                      ) : null}
                    </div>
                    <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                      {row.description || row.entity_type || 'إجراء بدون وصف'}
                    </p>
                  </div>
                  <div className="text-left">
                    <div className="text-xs font-black text-gray-700">
                      {row.actor_name || 'مستخدم غير محدد'}
                    </div>
                    <div className="text-[11px] font-bold text-gray-400 mt-1">
                      {formatDate(row.created_at)}
                    </div>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <EmptyState label="لا توجد سجلات تدقيق في هذه الصفحة" />
          )
        ) : loginRows.length ? (
          loginRows.map((row) => (
            <div
              key={row.id}
              className="rounded-3xl border border-gray-100 p-5 hover:border-blue-100 transition-colors"
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-black text-gray-900">
                    <span>{eventLabels[row.event_type] ?? row.event_type}</span>
                    <span className={row.success ? 'text-emerald-600' : 'text-red-600'}>
                      {row.success ? 'ناجح' : 'غير ناجح'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                    {row.user_name || row.user_email || 'مستخدم غير محدد'}
                    {row.device_label ? ` - ${row.device_label}` : ''}
                    {row.failure_reason ? ` - ${row.failure_reason}` : ''}
                  </p>
                </div>
                <div className="text-left text-[11px] font-bold text-gray-400">
                  {formatDate(row.created_at)}
                </div>
              </div>
            </div>
          ))
        ) : (
          <EmptyState label="لا توجد أحداث دخول في هذه الصفحة" />
        )}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2">
        <div className="text-xs font-bold text-gray-400">
          صفحة {currentPage} من {totalPages}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              kind === 'audit'
                ? setAuditPage((page) => Math.max(1, page - 1))
                : setLoginPage((page) => Math.max(1, page - 1))
            }
            disabled={currentPage <= 1 || loading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-100 text-xs font-black text-gray-600 hover:bg-gray-900 hover:text-white disabled:opacity-40 transition-all"
          >
            <ChevronRight size={14} />
            السابق
          </button>
          <button
            type="button"
            onClick={() =>
              kind === 'audit'
                ? setAuditPage((page) => Math.min(totalPages, page + 1))
                : setLoginPage((page) => Math.min(totalPages, page + 1))
            }
            disabled={currentPage >= totalPages || loading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-100 text-xs font-black text-gray-600 hover:bg-gray-900 hover:text-white disabled:opacity-40 transition-all"
          >
            التالي
            <ChevronLeft size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="p-8 bg-gray-50 rounded-3xl text-center text-gray-400 font-black text-sm">
      {label}
    </div>
  );
}
