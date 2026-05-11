// ─────────────────────────────────────────────────────────────────────────────
// src/app/roles/components/SecurityTab.tsx
//
// Phase 26A — Security tab inside /roles. Renders five sections:
//
//   1. KPI strip — total staff, active, disabled, devices, logins today
//   2. Orphan accounts banner — lists `auth.users` rows with no
//      matching `public.profiles` row. We can't query `auth.users`
//      directly from the client, so the banner reads from
//      `turath_masr_login_events` to identify users who have logged
//      in recently without a profile. Read-only.
//   3. Staff list — name / email / role / account_status / last
//      login + per-row "disable / suspend / reactivate" controls.
//   4. Login events — most-recent 100 with device + IP + outcome.
//   5. User devices — most-recent 100 with status + block / unblock.
//   6. Staff audit log — most-recent 100 audit entries with Arabic
//      labels.
//
// The component is rendered by /roles/page.tsx via a new "Security"
// tab; the existing tabs stay untouched. Only admins (`is_admin()`)
// can view this content — RLS guarantees this server-side, and the
// page gate stops rendering for non-admins.
// ─────────────────────────────────────────────────────────────────────────────
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Smartphone,
  History,
  Ban,
  Check,
  X,
  Clock,
  UserX,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  STAFF_AUDIT_ACTION_LABEL_AR,
  STAFF_AUDIT_GROUP_LABEL_AR,
  groupForAction,
  type StaffAuditAction,
  type StaffAuditActionGroup,
  writeStaffAuditLog,
} from '@/lib/security/staffAudit';
// Phase 26B — orphan auth users + suspicious profiles panel.
import OrphanAuthUsersPanel from './OrphanAuthUsersPanel';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ProfileRow {
  id: string;
  email: string | null;
  full_name: string | null;
  role_id: string | null;
  role_name: string | null;
  account_status?: string | null;
  disabled_at?: string | null;
  disabled_reason?: string | null;
}

interface LoginEventRow {
  id: string;
  user_id: string | null;
  user_email: string | null;
  user_name: string | null;
  event_type: 'login' | 'logout' | 'refresh' | 'blocked_device' | 'failed_login';
  success: boolean;
  failure_reason: string | null;
  ip_address: string | null;
  device_label: string | null;
  device_fingerprint: string | null;
  user_agent: string | null;
  created_at: string;
}

interface DeviceRow {
  id: string;
  user_id: string;
  device_fingerprint: string;
  device_label: string | null;
  user_agent: string | null;
  first_ip: string | null;
  last_ip: string | null;
  first_seen_at: string;
  last_seen_at: string;
  login_count: number;
  status: 'allowed' | 'blocked' | 'pending';
  blocked_reason: string | null;
}

interface StaffAuditRow {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_role_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_label: string | null;
  description: string | null;
  metadata: Record<string, unknown> | null;
  ip_address: string | null;
  device_fingerprint: string | null;
  created_at: string;
}

const ACCOUNT_STATUS_LABEL_AR: Record<string, string> = {
  active: 'نشط',
  disabled: 'معطّل',
  suspended: 'موقوف مؤقتًا',
  pending: 'بانتظار المراجعة',
};

const ACCOUNT_STATUS_TONE: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  disabled: 'bg-rose-50 text-rose-700 border-rose-200',
  suspended: 'bg-amber-50 text-amber-700 border-amber-200',
  pending: 'bg-slate-50 text-slate-700 border-slate-200',
};

const EVENT_TYPE_LABEL_AR: Record<LoginEventRow['event_type'], string> = {
  login: 'دخول',
  logout: 'خروج',
  refresh: 'تحديث جلسة',
  blocked_device: 'جهاز محظور',
  failed_login: 'محاولة دخول فاشلة',
};

const DEVICE_STATUS_LABEL_AR: Record<DeviceRow['status'], string> = {
  allowed: 'مسموح',
  blocked: 'محظور',
  pending: 'بانتظار الموافقة',
};

const DEVICE_STATUS_TONE: Record<DeviceRow['status'], string> = {
  allowed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  blocked: 'bg-rose-50 text-rose-700 border-rose-200',
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
};

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-GB');
  } catch {
    return iso;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function SecurityTab() {
  const { user, currentRoleId, profileFullName } = useAuth();

  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [loginEvents, setLoginEvents] = useState<LoginEventRow[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [auditRows, setAuditRows] = useState<StaffAuditRow[]>([]);
  // Phase 26D-1 — filter state for the audit list.
  const [auditGroupFilter, setAuditGroupFilter] = useState<'all' | StaffAuditActionGroup>('all');
  const [auditUserFilter, setAuditUserFilter] = useState<string>('all');
  const [auditSearch, setAuditSearch] = useState('');
  const [auditExpandedId, setAuditExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const [{ data: profs }, { data: events }, { data: devs }, { data: audits }] =
        await Promise.all([
          supabase
            .from('profiles')
            .select(
              'id, email, full_name, role_id, role_name, account_status, disabled_at, disabled_reason'
            )
            .order('created_at', { ascending: true }),
          supabase
            .from('turath_masr_login_events')
            .select(
              'id, user_id, user_email, user_name, event_type, success, failure_reason, ip_address, device_label, device_fingerprint, user_agent, created_at'
            )
            .order('created_at', { ascending: false })
            .limit(100),
          supabase
            .from('turath_masr_user_devices')
            .select(
              'id, user_id, device_fingerprint, device_label, user_agent, first_ip, last_ip, first_seen_at, last_seen_at, login_count, status, blocked_reason'
            )
            .order('last_seen_at', { ascending: false })
            .limit(100),
          supabase
            .from('turath_masr_staff_audit_logs')
            .select(
              'id, actor_id, actor_name, actor_role_id, action, entity_type, entity_id, entity_label, description, metadata, ip_address, device_fingerprint, created_at'
            )
            .order('created_at', { ascending: false })
            .limit(100),
        ]);
      setProfiles((profs as ProfileRow[]) ?? []);
      setLoginEvents((events as LoginEventRow[]) ?? []);
      setDevices((devs as DeviceRow[]) ?? []);
      setAuditRows((audits as StaffAuditRow[]) ?? []);
    } catch (err) {
      console.error('[SecurityTab] load failed:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── KPIs ───
  const kpis = useMemo(() => {
    const total = profiles.length;
    const active = profiles.filter((p) => (p.account_status ?? 'active') === 'active').length;
    const disabled = profiles.filter(
      (p) => p.account_status === 'disabled' || p.account_status === 'suspended'
    ).length;
    const pending = profiles.filter((p) => p.account_status === 'pending').length;
    const blockedDevices = devices.filter((d) => d.status === 'blocked').length;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const loginsToday = loginEvents.filter(
      (e) => e.event_type === 'login' && e.success && new Date(e.created_at) >= todayStart
    ).length;
    return { total, active, disabled, pending, blockedDevices, loginsToday };
  }, [profiles, devices, loginEvents]);

  // ─── Orphan auth users (best-effort proxy via login_events) ───
  // We cannot read `auth.users` from the client. As a proxy, surface
  // login events whose `user_id` is not present in the profiles list
  // — those are auth.users rows still able to sign in without a
  // profile (exactly the bug the audit found).
  const orphanCandidates = useMemo(() => {
    const profileIds = new Set(profiles.map((p) => p.id));
    const byEmail = new Map<string, { user_id: string; email: string; lastSeen: string }>();
    for (const e of loginEvents) {
      if (!e.user_id || profileIds.has(e.user_id)) continue;
      const email = e.user_email ?? '';
      const existing = byEmail.get(e.user_id);
      if (!existing || existing.lastSeen < e.created_at) {
        byEmail.set(e.user_id, {
          user_id: e.user_id,
          email,
          lastSeen: e.created_at,
        });
      }
    }
    return Array.from(byEmail.values());
  }, [profiles, loginEvents]);

  // Phase 26D-1 — derived audit list (group + user + free-text filters)
  // + the unique actor set for the user dropdown.
  const auditActors = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of auditRows) {
      if (!a.actor_id) continue;
      const label = (a.actor_name ?? '').trim() || a.actor_id.slice(0, 8);
      if (!map.has(a.actor_id)) map.set(a.actor_id, label);
    }
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [auditRows]);

  const filteredAudit = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    return auditRows.filter((a) => {
      if (auditGroupFilter !== 'all' && groupForAction(a.action) !== auditGroupFilter) {
        return false;
      }
      if (auditUserFilter !== 'all' && a.actor_id !== auditUserFilter) {
        return false;
      }
      if (!q) return true;
      const hay = [
        a.actor_name,
        a.entity_label,
        a.entity_id,
        a.description,
        STAFF_AUDIT_ACTION_LABEL_AR[a.action as StaffAuditAction] ?? a.action,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [auditRows, auditGroupFilter, auditUserFilter, auditSearch]);

  // ─── Mutations ───

  const updateAccountStatus = async (
    profile: ProfileRow,
    next: 'active' | 'disabled' | 'suspended' | 'pending',
    reason?: string
  ) => {
    setBusyId(profile.id);
    try {
      const supabase = createClient();
      const update: Record<string, unknown> = { account_status: next };
      if (next === 'active') {
        update.disabled_at = null;
        update.disabled_by = null;
        update.disabled_reason = null;
      } else {
        update.disabled_at = new Date().toISOString();
        update.disabled_by = user?.id ?? null;
        update.disabled_reason = reason ?? null;
      }
      const { error } = await supabase.from('profiles').update(update).eq('id', profile.id);
      if (error) throw error;
      const actionByNext: Record<typeof next, StaffAuditAction> = {
        active: 'staff.account_reactivated',
        disabled: 'staff.account_disabled',
        suspended: 'staff.account_suspended',
        pending: 'staff.account_pending',
      };
      await writeStaffAuditLog(supabase, {
        action: actionByNext[next],
        description: reason ?? null,
        actorId: user?.id ?? null,
        actorName: profileFullName ?? user?.email ?? null,
        actorRoleId: currentRoleId,
        entity: {
          type: 'profile',
          id: profile.id,
          label: profile.full_name ?? profile.email ?? '',
        },
        metadata: { from: profile.account_status ?? 'active', to: next },
      });
      await load();
    } catch (err) {
      console.error('[SecurityTab] status update failed:', err);
      window.alert('تعذر تحديث حالة الحساب.');
    } finally {
      setBusyId(null);
    }
  };

  const updateDeviceStatus = async (
    device: DeviceRow,
    next: 'allowed' | 'blocked' | 'pending',
    reason?: string
  ) => {
    setBusyId(device.id);
    try {
      const supabase = createClient();
      const update: Record<string, unknown> = { status: next };
      if (next === 'blocked') {
        update.blocked_at = new Date().toISOString();
        update.blocked_by = user?.id ?? null;
        update.blocked_reason = reason ?? null;
      } else {
        update.blocked_at = null;
        update.blocked_by = null;
        update.blocked_reason = null;
      }
      const { error } = await supabase
        .from('turath_masr_user_devices')
        .update(update)
        .eq('id', device.id);
      if (error) throw error;
      await writeStaffAuditLog(supabase, {
        action: next === 'blocked' ? 'security.device_blocked' : 'security.device_unblocked',
        description: reason ?? null,
        actorId: user?.id ?? null,
        actorName: profileFullName ?? user?.email ?? null,
        actorRoleId: currentRoleId,
        entity: {
          type: 'device',
          id: device.id,
          label: device.device_label ?? device.device_fingerprint,
        },
        metadata: { from: device.status, to: next },
      });
      await load();
    } catch (err) {
      console.error('[SecurityTab] device update failed:', err);
      window.alert('تعذر تحديث حالة الجهاز.');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="p-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
        جارٍ تحميل لوحة الأمان...
      </div>
    );
  }

  return (
    <div className="space-y-4" dir="rtl">
      {/* KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-6 gap-3">
        {[
          {
            label: 'إجمالي الموظفين',
            value: kpis.total,
            icon: <ShieldCheck size={14} />,
            tone: 'bg-slate-50 text-slate-700',
          },
          {
            label: 'حسابات نشطة',
            value: kpis.active,
            icon: <Check size={14} />,
            tone: 'bg-emerald-50 text-emerald-700',
          },
          {
            label: 'معطّلة / موقوفة',
            value: kpis.disabled,
            icon: <UserX size={14} />,
            tone: 'bg-rose-50 text-rose-700',
          },
          {
            label: 'بانتظار المراجعة',
            value: kpis.pending,
            icon: <Clock size={14} />,
            tone: 'bg-amber-50 text-amber-700',
          },
          {
            label: 'أجهزة محظورة',
            value: kpis.blockedDevices,
            icon: <Ban size={14} />,
            tone: 'bg-rose-50 text-rose-700',
          },
          {
            label: 'دخول اليوم',
            value: kpis.loginsToday,
            icon: <History size={14} />,
            tone: 'bg-indigo-50 text-indigo-700',
          },
        ].map((k) => (
          <div
            key={k.label}
            className={`rounded-2xl border border-[hsl(var(--border))] p-3 ${k.tone}`}
          >
            <div className="flex items-center gap-2 text-xs font-bold">
              {k.icon}
              {k.label}
            </div>
            <p className="text-xl font-bold mt-1">{k.value.toLocaleString('en-US')}</p>
          </div>
        ))}
      </div>

      {/* Phase 26B — orphan auth users + suspicious profiles panel
          (authoritative data via /api/security/auth-users). Mounted
          here so admins see the full picture in one tab. */}
      <OrphanAuthUsersPanel />

      {/* Legacy login-events proxy banner (Phase 26A). Kept as a
          secondary signal; with the panel above, this is usually a
          subset of the same orphans. */}
      {orphanCandidates.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="text-amber-700 mt-0.5" size={18} />
            <div>
              <h3 className="text-sm font-bold text-amber-900">حسابات Auth بدون ملف موظف</h3>
              <p className="text-xs text-amber-800 mt-1">
                هذه الحسابات قادرة على تسجيل الدخول لكنها بلا صف في جدول
                <code className="mx-1 font-mono text-[11px] bg-amber-100 px-1 rounded">
                  profiles
                </code>
                . السبب: عملية الحذف القديمة كانت تحذف صف الـ profile فقط دون مستخدم Supabase Auth.
                الحل الموصى به: تعطيل الحساب على مستوى Supabase Auth Admin يدويًا، أو إعادة إنشاء صف
                الـ profile.
              </p>
              <ul className="mt-2 space-y-1 text-xs">
                {orphanCandidates.map((o) => (
                  <li key={o.user_id} className="flex flex-wrap gap-2 items-center">
                    <span className="font-mono">{o.email || '(بريد غير معروف)'}</span>
                    <span className="text-amber-800">آخر دخول:</span>
                    <span className="font-mono">{fmtDateTime(o.lastSeen)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}

      {/* Staff with status */}
      <section className="card-section overflow-hidden">
        <div className="p-3 border-b border-[hsl(var(--border))] flex items-center gap-2">
          <ShieldCheck size={15} />
          <h3 className="text-sm font-bold">الموظفون وحالة الحسابات</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[hsl(var(--muted))]/40 text-[hsl(var(--muted-foreground))]">
              <tr>
                <th className="text-right px-3 py-2 font-semibold">الموظف</th>
                <th className="text-right px-3 py-2 font-semibold">الدور</th>
                <th className="text-right px-3 py-2 font-semibold">الحالة</th>
                <th className="text-right px-3 py-2 font-semibold">سبب التعطيل</th>
                <th className="text-right px-3 py-2 font-semibold">آخر تعطيل</th>
                <th className="text-center px-3 py-2 font-semibold">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => {
                const status = (p.account_status ??
                  'active') as keyof typeof ACCOUNT_STATUS_LABEL_AR;
                const isActive = status === 'active';
                return (
                  <tr key={p.id} className="border-t border-[hsl(var(--border))]">
                    <td className="px-3 py-2">
                      <div className="leading-tight">
                        <p className="font-semibold">{p.full_name || '—'}</p>
                        <p className="text-[10px] text-[hsl(var(--muted-foreground))] font-mono">
                          {p.email || '—'}
                        </p>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-[10px] bg-[hsl(var(--muted))]/40 px-2 py-0.5 rounded-full font-bold">
                        {p.role_name || p.role_id || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                          ACCOUNT_STATUS_TONE[status] ?? ACCOUNT_STATUS_TONE.active
                        }`}
                      >
                        {ACCOUNT_STATUS_LABEL_AR[status] ?? status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[hsl(var(--muted-foreground))]">
                      {p.disabled_reason || '—'}
                    </td>
                    <td className="px-3 py-2 text-[10px] text-[hsl(var(--muted-foreground))] font-mono">
                      {fmtDateTime(p.disabled_at)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <div className="flex flex-wrap justify-center gap-1">
                        {isActive ? (
                          <>
                            <button
                              disabled={busyId === p.id}
                              className="text-[10px] bg-amber-100 text-amber-800 px-2 py-1 rounded-lg font-bold hover:bg-amber-200 disabled:opacity-50"
                              onClick={() => {
                                const reason = window.prompt('سبب الإيقاف المؤقت:') ?? undefined;
                                if (reason === undefined) return;
                                void updateAccountStatus(p, 'suspended', reason);
                              }}
                              title="إيقاف مؤقت"
                            >
                              إيقاف مؤقت
                            </button>
                            <button
                              disabled={busyId === p.id}
                              className="text-[10px] bg-rose-100 text-rose-800 px-2 py-1 rounded-lg font-bold hover:bg-rose-200 disabled:opacity-50"
                              onClick={() => {
                                const reason = window.prompt('سبب التعطيل:') ?? undefined;
                                if (reason === undefined) return;
                                void updateAccountStatus(p, 'disabled', reason);
                              }}
                              title="تعطيل"
                            >
                              تعطيل
                            </button>
                          </>
                        ) : (
                          <button
                            disabled={busyId === p.id}
                            className="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-1 rounded-lg font-bold hover:bg-emerald-200 disabled:opacity-50"
                            onClick={() => updateAccountStatus(p, 'active')}
                            title="إعادة تفعيل"
                          >
                            إعادة تفعيل
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Devices */}
      <section className="card-section overflow-hidden">
        <div className="p-3 border-b border-[hsl(var(--border))] flex items-center gap-2">
          <Smartphone size={15} />
          <h3 className="text-sm font-bold">الأجهزة المعروفة (أحدث {devices.length})</h3>
        </div>
        {devices.length === 0 ? (
          <p className="p-4 text-xs text-[hsl(var(--muted-foreground))]">
            لا توجد بيانات أجهزة بعد. ستظهر هنا بعد أول دخول من جهاز جديد.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[hsl(var(--muted))]/40 text-[hsl(var(--muted-foreground))]">
                <tr>
                  <th className="text-right px-3 py-2 font-semibold">المستخدم</th>
                  <th className="text-right px-3 py-2 font-semibold">الجهاز</th>
                  <th className="text-right px-3 py-2 font-semibold">IP الأخير</th>
                  <th className="text-center px-3 py-2 font-semibold">مرات الدخول</th>
                  <th className="text-right px-3 py-2 font-semibold">أول دخول</th>
                  <th className="text-right px-3 py-2 font-semibold">آخر دخول</th>
                  <th className="text-center px-3 py-2 font-semibold">الحالة</th>
                  <th className="text-center px-3 py-2 font-semibold">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => {
                  const profile = profiles.find((p) => p.id === d.user_id);
                  return (
                    <tr key={d.id} className="border-t border-[hsl(var(--border))]">
                      <td className="px-3 py-2">
                        {profile?.full_name || profile?.email || d.user_id.slice(0, 8)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="leading-tight">
                          <p className="font-semibold">{d.device_label || 'جهاز'}</p>
                          <p className="text-[10px] text-[hsl(var(--muted-foreground))] font-mono">
                            {d.device_fingerprint.slice(0, 12)}…
                          </p>
                        </div>
                      </td>
                      <td className="px-3 py-2 font-mono text-[10px]">{d.last_ip || '—'}</td>
                      <td className="px-3 py-2 text-center font-mono">{d.login_count}</td>
                      <td className="px-3 py-2 text-[10px] font-mono">
                        {fmtDateTime(d.first_seen_at)}
                      </td>
                      <td className="px-3 py-2 text-[10px] font-mono">
                        {fmtDateTime(d.last_seen_at)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${DEVICE_STATUS_TONE[d.status]}`}
                        >
                          {DEVICE_STATUS_LABEL_AR[d.status]}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        {d.status === 'blocked' ? (
                          <button
                            disabled={busyId === d.id}
                            className="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-1 rounded-lg font-bold hover:bg-emerald-200 disabled:opacity-50"
                            onClick={() => updateDeviceStatus(d, 'allowed')}
                          >
                            إلغاء الحظر
                          </button>
                        ) : (
                          <button
                            disabled={busyId === d.id}
                            className="text-[10px] bg-rose-100 text-rose-800 px-2 py-1 rounded-lg font-bold hover:bg-rose-200 disabled:opacity-50"
                            onClick={() => {
                              const reason = window.prompt('سبب الحظر (اختياري):') ?? undefined;
                              void updateDeviceStatus(d, 'blocked', reason);
                            }}
                          >
                            حظر الجهاز
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Login events */}
      <section className="card-section overflow-hidden">
        <div className="p-3 border-b border-[hsl(var(--border))] flex items-center gap-2">
          <History size={15} />
          <h3 className="text-sm font-bold">آخر {loginEvents.length} حدث دخول</h3>
        </div>
        {loginEvents.length === 0 ? (
          <p className="p-4 text-xs text-[hsl(var(--muted-foreground))]">لا توجد أحداث دخول بعد.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[hsl(var(--muted))]/40 text-[hsl(var(--muted-foreground))]">
                <tr>
                  <th className="text-right px-3 py-2 font-semibold">التاريخ</th>
                  <th className="text-right px-3 py-2 font-semibold">المستخدم</th>
                  <th className="text-right px-3 py-2 font-semibold">نوع الحدث</th>
                  <th className="text-right px-3 py-2 font-semibold">النتيجة</th>
                  <th className="text-right px-3 py-2 font-semibold">السبب</th>
                  <th className="text-right px-3 py-2 font-semibold">الجهاز</th>
                  <th className="text-right px-3 py-2 font-semibold">IP</th>
                </tr>
              </thead>
              <tbody>
                {loginEvents.map((e) => (
                  <tr key={e.id} className="border-t border-[hsl(var(--border))]">
                    <td className="px-3 py-2 text-[10px] font-mono">{fmtDateTime(e.created_at)}</td>
                    <td className="px-3 py-2">
                      <div className="leading-tight">
                        <p className="font-semibold">{e.user_name || '—'}</p>
                        <p className="text-[10px] text-[hsl(var(--muted-foreground))] font-mono">
                          {e.user_email || '—'}
                        </p>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-[10px] bg-[hsl(var(--muted))]/40 px-2 py-0.5 rounded-full font-bold">
                        {EVENT_TYPE_LABEL_AR[e.event_type]}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {e.success ? (
                        <span className="text-emerald-700 inline-flex items-center gap-1">
                          <Check size={11} /> ناجح
                        </span>
                      ) : (
                        <span className="text-rose-700 inline-flex items-center gap-1">
                          <X size={11} /> فاشل
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[hsl(var(--muted-foreground))]">
                      {e.failure_reason || '—'}
                    </td>
                    <td className="px-3 py-2">{e.device_label || '—'}</td>
                    <td className="px-3 py-2 font-mono text-[10px]">{e.ip_address || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Staff audit log (Phase 26D-1 — filters + Arabic-first rendering) */}
      <section className="card-section overflow-hidden">
        <div className="p-3 border-b border-[hsl(var(--border))] flex items-center gap-2 flex-wrap">
          <ShieldAlert size={15} />
          <h3 className="text-sm font-bold flex-1">
            سجل التدقيق الإداري ({filteredAudit.length} / {auditRows.length})
          </h3>
        </div>
        <div className="p-3 border-b border-[hsl(var(--border))] flex flex-wrap items-center gap-2 bg-[hsl(var(--muted))]/20">
          <select
            value={auditGroupFilter}
            onChange={(e) => setAuditGroupFilter(e.target.value as 'all' | StaffAuditActionGroup)}
            className="input-field text-xs w-auto"
          >
            <option value="all">كل الأقسام</option>
            {(Object.keys(STAFF_AUDIT_GROUP_LABEL_AR) as StaffAuditActionGroup[]).map((g) => (
              <option key={g} value={g}>
                {STAFF_AUDIT_GROUP_LABEL_AR[g]}
              </option>
            ))}
          </select>
          <select
            value={auditUserFilter}
            onChange={(e) => setAuditUserFilter(e.target.value)}
            className="input-field text-xs w-auto max-w-[200px]"
          >
            <option value="all">كل المستخدمين</option>
            {auditActors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={auditSearch}
            onChange={(e) => setAuditSearch(e.target.value)}
            placeholder="ابحث في الوصف، الكيان، أو الإجراء..."
            className="input-field text-xs flex-1 min-w-[200px]"
          />
          {(auditGroupFilter !== 'all' || auditUserFilter !== 'all' || auditSearch) && (
            <button
              onClick={() => {
                setAuditGroupFilter('all');
                setAuditUserFilter('all');
                setAuditSearch('');
              }}
              className="text-[10px] text-[hsl(var(--primary))] hover:underline"
            >
              مسح الفلاتر
            </button>
          )}
        </div>
        {filteredAudit.length === 0 ? (
          <p className="p-4 text-xs text-[hsl(var(--muted-foreground))]">
            {auditRows.length === 0
              ? 'لا توجد إدخالات بعد. ستظهر هنا عند إنشاء طلب، تغيير حالة، اعتماد تسوية، أو تعديل صلاحيات.'
              : 'لا توجد إدخالات مطابقة لهذه الفلاتر.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[hsl(var(--muted))]/40 text-[hsl(var(--muted-foreground))]">
                <tr>
                  <th className="text-right px-3 py-2 font-semibold">التاريخ</th>
                  <th className="text-right px-3 py-2 font-semibold">المنفّذ</th>
                  <th className="text-right px-3 py-2 font-semibold">الإجراء</th>
                  <th className="text-right px-3 py-2 font-semibold">الوصف</th>
                  <th className="text-right px-3 py-2 font-semibold">العنصر</th>
                </tr>
              </thead>
              <tbody>
                {filteredAudit.map((a) => {
                  const group = groupForAction(a.action);
                  const isExpanded = auditExpandedId === a.id;
                  const hasMetadata =
                    a.metadata &&
                    typeof a.metadata === 'object' &&
                    Object.keys(a.metadata as Record<string, unknown>).length > 0;
                  return (
                    <React.Fragment key={a.id}>
                      <tr className="border-t border-[hsl(var(--border))]">
                        <td className="px-3 py-2 text-[10px] font-mono align-top">
                          {fmtDateTime(a.created_at)}
                        </td>
                        <td className="px-3 py-2 align-top">
                          {a.actor_name || a.actor_id?.slice(0, 8) || '—'}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div className="flex flex-col gap-0.5 items-start">
                            <span className="text-[10px] bg-indigo-50 text-indigo-800 border border-indigo-200 px-2 py-0.5 rounded-full font-bold">
                              {STAFF_AUDIT_ACTION_LABEL_AR[a.action as StaffAuditAction] ??
                                a.action}
                            </span>
                            <span className="text-[9px] text-[hsl(var(--muted-foreground))]">
                              {STAFF_AUDIT_GROUP_LABEL_AR[group]}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <p className="leading-snug text-[hsl(var(--foreground))]">
                            {a.description || '—'}
                          </p>
                          {hasMetadata && (
                            <button
                              onClick={() => setAuditExpandedId(isExpanded ? null : a.id)}
                              className="text-[10px] text-[hsl(var(--primary))] hover:underline mt-1"
                            >
                              {isExpanded ? 'إخفاء التفاصيل' : 'تفاصيل إضافية'}
                            </button>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div className="leading-tight">
                            <p className="font-semibold text-[11px]">
                              {a.entity_label || a.entity_type || '—'}
                            </p>
                            {a.entity_id && (
                              <p className="text-[10px] text-[hsl(var(--muted-foreground))] font-mono">
                                {a.entity_id.slice(0, 12)}
                              </p>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isExpanded && hasMetadata && (
                        <tr className="bg-[hsl(var(--muted))]/20">
                          <td colSpan={5} className="px-3 py-2">
                            <pre className="text-[10px] font-mono overflow-x-auto leading-tight whitespace-pre-wrap">
                              {JSON.stringify(a.metadata, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
