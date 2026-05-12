// ─────────────────────────────────────────────────────────────────────────────
// src/app/roles/components/UsersTab.tsx
//
// Phase 26E — Users tab inside /roles. Replaces the legacy inline
// users table that hardcoded login/device counts and silently
// deleted profile rows on click.
//
// Surface goal (per spec): security/account-focused management of
// real staff accounts.
//   • organized table of every `profiles` row joined in-memory with
//     `turath_masr_user_devices` + `turath_masr_login_events` so the
//     status / last-login / devices columns are accurate.
//   • per-row actions for disable / suspend / reactivate (writes
//     `account_status` + staff audit) and block-all-devices.
//   • details drawer with four sections: account, devices, login
//     events, audit — each capped at the latest 20 rows.
//   • hard delete is intentionally NOT implemented from here.
//     Replaced with a disabled affordance + explanation; permanent
//     deletion requires service-role and a dedicated phase.
//   • permission gates: anyone with `view_staff` /
//     `view_security_audit` can see the tab; `manage_staff` is
//     required for status actions; `block_devices` /
//     `manage_device_access` for device actions. RLS already
//     enforces this server-side — the UI matches.
//
// Patterns reused from SecurityTab (Phase 26A):
//   • parallel Promise.all initial load
//   • `writeStaffAuditLog()` fire-and-forget after the mutation
//   • `await load()` to refresh state after a successful write
//   • `window.prompt` for the disable/suspend/block reason — same
//     UX as the existing security tab so users don't see two
//     different dialogs for the same intent.
// ─────────────────────────────────────────────────────────────────────────────
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Ban,
  Check,
  ChevronLeft,
  Clock,
  ExternalLink,
  Eye,
  History,
  Lock,
  Monitor,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Tablet,
  Trash2,
  Unlock,
  UserX,
  Users,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import {
  STAFF_AUDIT_ACTION_LABEL_AR,
  writeStaffAuditLog,
  type StaffAuditAction,
} from '@/lib/security/staffAudit';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ProfileRow {
  id: string;
  email: string | null;
  full_name: string | null;
  role_id: string | null;
  role_name: string | null;
  account_status: string | null;
  disabled_at: string | null;
  disabled_reason: string | null;
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
  blocked_at: string | null;
  blocked_reason: string | null;
}

interface LoginEventRow {
  id: string;
  user_id: string | null;
  user_email: string | null;
  user_name: string | null;
  event_type: string;
  success: boolean;
  failure_reason: string | null;
  ip_address: string | null;
  device_label: string | null;
  device_fingerprint: string | null;
  user_agent: string | null;
  created_at: string;
}

interface AuditRow {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_label: string | null;
  description: string | null;
  created_at: string;
}

interface RoleRow {
  id: string;
  name: string;
}

// ─── Labels / tone helpers ──────────────────────────────────────────────────

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

const EVENT_TYPE_LABEL_AR: Record<string, string> = {
  login: 'دخول',
  logout: 'خروج',
  refresh: 'تحديث جلسة',
  blocked_device: 'جهاز محظور',
  failed_login: 'محاولة دخول فاشلة',
};

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-GB');
  } catch {
    return iso;
  }
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-GB');
  } catch {
    return iso;
  }
}

function deviceIconFor(label: string | null | undefined, size = 14) {
  const lower = (label ?? '').toLowerCase();
  if (lower.includes('mobile') || lower.includes('iphone') || lower.includes('android')) {
    return <Smartphone size={size} />;
  }
  if (lower.includes('tablet') || lower.includes('ipad')) {
    return <Tablet size={size} />;
  }
  return <Monitor size={size} />;
}

// ─── Component ──────────────────────────────────────────────────────────────

export interface UsersTabRoleEditTarget {
  id: string;
  email: string | null;
  name: string;
  currentRoleId: string | null;
  currentRoleName: string | null;
}

export interface UsersTabProps {
  /** Phase 26E — switch the parent /roles page to the Security tab.
   *  Lets the "افتح في الأمان" action stay scoped to the same page
   *  instead of forcing a navigation. */
  onOpenSecurityTab?: () => void;
  /** Phase 26G — open the page-level ChangeRoleModal for the given
   *  target. Page owns the supabase write + audit + safety guards;
   *  UsersTab only describes who to edit. */
  onRequestEditRole?: (target: UsersTabRoleEditTarget) => void;
  /** Phase 26G — bumped by the parent after a successful role
   *  mutation. UsersTab re-fetches its joined data so the role
   *  badge + count update without waiting for the user to refresh. */
  reloadTick?: number;
}

export default function UsersTab({
  onOpenSecurityTab,
  onRequestEditRole,
  reloadTick = 0,
}: UsersTabProps) {
  const { user, currentRoleId, profileFullName } = useAuth();
  const perms = usePermissions();

  // Permission flags. Admin bypasses everything; explicit checks
  // keep the UI honest for non-admin roles (RLS still owns the
  // server-side enforcement).
  const canViewTab = perms.isAdmin || perms.can('view_staff') || perms.can('view_security_audit');
  const canManageStaff = perms.isAdmin || perms.can('manage_staff');
  const canManageDevices =
    perms.isAdmin || perms.can('block_devices') || perms.can('manage_device_access');

  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [loginEvents, setLoginEvents] = useState<LoginEventRow[]>([]);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'active' | 'disabled' | 'suspended' | 'pending'
  >('all');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [extraFilter, setExtraFilter] = useState<'none' | 'blocked_devices' | 'never_logged_in'>(
    'none'
  );

  // Details drawer
  const [drawerUserId, setDrawerUserId] = useState<string | null>(null);
  const [drawerTab, setDrawerTab] = useState<'account' | 'devices' | 'logins' | 'audit'>('account');

  // ─── Load ───────────────────────────────────────────────────────────────

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const supabase = createClient();
      const [
        { data: profs, error: profErr },
        { data: devs, error: devErr },
        { data: events, error: evErr },
        { data: audits, error: auErr },
        { data: dbRoles, error: roleErr },
      ] = await Promise.all([
        supabase
          .from('profiles')
          .select(
            'id, email, full_name, role_id, role_name, account_status, disabled_at, disabled_reason, created_at'
          )
          .order('created_at', { ascending: true }),
        supabase
          .from('turath_masr_user_devices')
          .select(
            'id, user_id, device_fingerprint, device_label, user_agent, first_ip, last_ip, first_seen_at, last_seen_at, login_count, status, blocked_at, blocked_reason'
          )
          .order('last_seen_at', { ascending: false })
          .limit(500),
        supabase
          .from('turath_masr_login_events')
          .select(
            'id, user_id, user_email, user_name, event_type, success, failure_reason, ip_address, device_label, device_fingerprint, user_agent, created_at'
          )
          .order('created_at', { ascending: false })
          .limit(500),
        supabase
          .from('turath_masr_staff_audit_logs')
          .select(
            'id, actor_id, actor_name, action, entity_type, entity_id, entity_label, description, created_at'
          )
          .order('created_at', { ascending: false })
          .limit(500),
        supabase.from('turath_roles').select('id, name').order('id', { ascending: true }),
      ]);
      const firstErr = profErr || devErr || evErr || auErr || roleErr;
      if (firstErr) {
        throw firstErr;
      }
      setProfiles((profs as ProfileRow[]) ?? []);
      setDevices((devs as DeviceRow[]) ?? []);
      setLoginEvents((events as LoginEventRow[]) ?? []);
      setAuditRows((audits as AuditRow[]) ?? []);
      setRoles((dbRoles as RoleRow[]) ?? []);
    } catch (err) {
      console.error('[UsersTab] load failed:', err);
      setLoadError('تعذر تحميل بيانات المستخدمين. حاول التحديث.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!canViewTab) {
      setLoading(false);
      return;
    }
    void load();
    // Phase 26G — `reloadTick` is bumped by the parent after a
    // successful role mutation so we re-fetch profiles + roles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewTab, reloadTick]);

  // ─── Per-user derived stats ─────────────────────────────────────────────

  // Build user-id → device list / login list maps once per data refresh.
  // The lists are already bounded (500 rows each), so a Map walk is
  // cheap and the table render stays O(profiles).
  const devicesByUser = useMemo(() => {
    const m = new Map<string, DeviceRow[]>();
    for (const d of devices) {
      const arr = m.get(d.user_id) ?? [];
      arr.push(d);
      m.set(d.user_id, arr);
    }
    return m;
  }, [devices]);

  const loginsByUser = useMemo(() => {
    const m = new Map<string, LoginEventRow[]>();
    for (const e of loginEvents) {
      if (!e.user_id) continue;
      const arr = m.get(e.user_id) ?? [];
      arr.push(e);
      m.set(e.user_id, arr);
    }
    return m;
  }, [loginEvents]);

  const auditByEntity = useMemo(() => {
    const m = new Map<string, AuditRow[]>();
    for (const a of auditRows) {
      if (!a.entity_id) continue;
      const arr = m.get(a.entity_id) ?? [];
      arr.push(a);
      m.set(a.entity_id, arr);
    }
    return m;
  }, [auditRows]);

  // Per-profile rollup used by the table + the details drawer.
  interface UserRow extends ProfileRow {
    devicesCount: number;
    blockedDevicesCount: number;
    loginCount: number;
    lastLoginAt: string | null;
    lastDeviceLabel: string | null;
  }

  const userRows: UserRow[] = useMemo(() => {
    return profiles.map((p) => {
      const userDevices = devicesByUser.get(p.id) ?? [];
      const userLogins = loginsByUser.get(p.id) ?? [];
      const successLogins = userLogins.filter((e) => e.event_type === 'login' && e.success);
      const lastLogin = successLogins[0] ?? userLogins[0] ?? null;
      return {
        ...p,
        devicesCount: userDevices.length,
        blockedDevicesCount: userDevices.filter((d) => d.status === 'blocked').length,
        loginCount: successLogins.length,
        lastLoginAt: lastLogin?.created_at ?? null,
        lastDeviceLabel: lastLogin?.device_label ?? userDevices[0]?.device_label ?? null,
      };
    });
  }, [profiles, devicesByUser, loginsByUser]);

  // ─── KPIs ───────────────────────────────────────────────────────────────

  const kpis = useMemo(() => {
    const total = userRows.length;
    const active = userRows.filter((u) => (u.account_status ?? 'active') === 'active').length;
    const disabled = userRows.filter((u) => u.account_status === 'disabled').length;
    const suspended = userRows.filter((u) => u.account_status === 'suspended').length;
    const pending = userRows.filter((u) => u.account_status === 'pending').length;
    const withBlocked = userRows.filter((u) => u.blockedDevicesCount > 0).length;
    const neverLoggedIn = userRows.filter((u) => u.loginCount === 0).length;
    return { total, active, disabled, suspended, pending, withBlocked, neverLoggedIn };
  }, [userRows]);

  // ─── Filtered list ──────────────────────────────────────────────────────

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return userRows.filter((u) => {
      if (statusFilter !== 'all' && (u.account_status ?? 'active') !== statusFilter) {
        return false;
      }
      if (roleFilter !== 'all' && (u.role_id ?? '') !== roleFilter) return false;
      if (extraFilter === 'blocked_devices' && u.blockedDevicesCount === 0) return false;
      if (extraFilter === 'never_logged_in' && u.loginCount > 0) return false;
      if (!q) return true;
      const hay = [u.full_name ?? '', u.email ?? '', u.role_name ?? '', u.role_id ?? '']
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [userRows, search, statusFilter, roleFilter, extraFilter]);

  // ─── Mutations ──────────────────────────────────────────────────────────

  const showToast = (kind: 'success' | 'error', message: string) => {
    setToast({ kind, message });
    window.setTimeout(() => setToast(null), 4000);
  };

  const updateAccountStatus = async (
    profile: ProfileRow,
    next: 'active' | 'disabled' | 'suspended',
    reason?: string
  ) => {
    if (!canManageStaff) {
      showToast('error', 'لا تملك صلاحية إدارة حالة الحسابات.');
      return;
    }
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
        update.disabled_reason = (reason ?? '').trim() || null;
      }
      const { error } = await supabase.from('profiles').update(update).eq('id', profile.id);
      if (error) throw error;
      const actionByNext: Record<typeof next, StaffAuditAction> = {
        active: 'staff.account_reactivated',
        disabled: 'staff.account_disabled',
        suspended: 'staff.account_suspended',
      };
      await writeStaffAuditLog(supabase, {
        action: actionByNext[next],
        description: (reason ?? '').trim() || null,
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
      const verb = next === 'active' ? 'إعادة تفعيل' : next === 'suspended' ? 'إيقاف' : 'تعطيل';
      showToast('success', `تم ${verb} الحساب.`);
    } catch (err) {
      console.error('[UsersTab] account status update failed:', err);
      showToast('error', 'تعذر تحديث حالة الحساب. تواصل مع المدير إذا تكرر الخطأ.');
    } finally {
      setBusyId(null);
    }
  };

  const blockAllDevices = async (profile: ProfileRow, reason: string) => {
    if (!canManageDevices) {
      showToast('error', 'لا تملك صلاحية حظر الأجهزة.');
      return;
    }
    const userDevices = devicesByUser.get(profile.id) ?? [];
    const toBlock = userDevices.filter((d) => d.status !== 'blocked');
    if (toBlock.length === 0) {
      showToast('error', 'لا توجد أجهزة قابلة للحظر لهذا المستخدم.');
      return;
    }
    setBusyId(profile.id);
    try {
      const supabase = createClient();
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from('turath_masr_user_devices')
        .update({
          status: 'blocked',
          blocked_at: nowIso,
          blocked_by: user?.id ?? null,
          blocked_reason: reason.trim() || null,
        })
        .in(
          'id',
          toBlock.map((d) => d.id)
        );
      if (error) throw error;
      // One audit row per device — keeps the trail per-entity so a
      // single device unblock later still has the matching block in
      // its history. Cheap: at most ~10 devices per user in practice.
      for (const d of toBlock) {
        try {
          await writeStaffAuditLog(supabase, {
            action: 'security.device_blocked',
            description: reason.trim() || null,
            actorId: user?.id ?? null,
            actorName: profileFullName ?? user?.email ?? null,
            actorRoleId: currentRoleId,
            entity: {
              type: 'device',
              id: d.id,
              label: d.device_label ?? d.device_fingerprint,
            },
            metadata: {
              from: d.status,
              to: 'blocked',
              bulk: true,
              target_user_id: profile.id,
            },
          });
        } catch (auditErr) {
          console.warn('[UsersTab] device audit failed:', auditErr);
        }
      }
      await load();
      showToast('success', `تم حظر ${toBlock.length} جهاز.`);
    } catch (err) {
      console.error('[UsersTab] block all devices failed:', err);
      showToast('error', 'تعذر حظر الأجهزة.');
    } finally {
      setBusyId(null);
    }
  };

  const setSingleDeviceStatus = async (
    device: DeviceRow,
    next: 'allowed' | 'blocked',
    reason?: string
  ) => {
    if (!canManageDevices) {
      showToast('error', 'لا تملك صلاحية إدارة الأجهزة.');
      return;
    }
    setBusyId(device.id);
    try {
      const supabase = createClient();
      const update: Record<string, unknown> = { status: next };
      if (next === 'blocked') {
        update.blocked_at = new Date().toISOString();
        update.blocked_by = user?.id ?? null;
        update.blocked_reason = (reason ?? '').trim() || null;
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
        description: (reason ?? '').trim() || null,
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
      showToast('success', next === 'blocked' ? 'تم حظر الجهاز.' : 'تم إلغاء حظر الجهاز.');
    } catch (err) {
      console.error('[UsersTab] single device update failed:', err);
      showToast('error', 'تعذر تحديث حالة الجهاز.');
    } finally {
      setBusyId(null);
    }
  };

  // ─── UI ─────────────────────────────────────────────────────────────────

  if (!canViewTab) {
    return (
      <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
        لا تملك صلاحية عرض بيانات المستخدمين. تواصل مع المدير.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
        جارٍ تحميل بيانات المستخدمين...
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center">
        <p className="text-sm text-rose-700 font-semibold">{loadError}</p>
        <button
          onClick={() => void load()}
          className="mt-3 text-xs px-3 py-1.5 rounded-lg bg-white border border-rose-200 text-rose-700 hover:bg-rose-100"
        >
          إعادة المحاولة
        </button>
      </div>
    );
  }

  const drawerUser = drawerUserId ? (userRows.find((u) => u.id === drawerUserId) ?? null) : null;

  return (
    <div className="space-y-4" dir="rtl">
      {/* KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-6 gap-3">
        {[
          {
            label: 'إجمالي الحسابات',
            value: kpis.total,
            icon: <Users size={14} />,
            tone: 'bg-slate-50 text-slate-700',
          },
          {
            label: 'نشطة',
            value: kpis.active,
            icon: <Check size={14} />,
            tone: 'bg-emerald-50 text-emerald-700',
          },
          {
            label: 'معطّلة',
            value: kpis.disabled,
            icon: <UserX size={14} />,
            tone: 'bg-rose-50 text-rose-700',
          },
          {
            label: 'موقوفة',
            value: kpis.suspended,
            icon: <Clock size={14} />,
            tone: 'bg-amber-50 text-amber-700',
          },
          {
            label: 'أجهزة محظورة',
            value: kpis.withBlocked,
            icon: <Ban size={14} />,
            tone: 'bg-rose-50 text-rose-700',
          },
          {
            label: 'لم يسجل دخول',
            value: kpis.neverLoggedIn,
            icon: <History size={14} />,
            tone: 'bg-slate-50 text-slate-700',
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

      {/* Hard delete notice */}
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 flex items-start gap-2">
        <ShieldAlert size={16} className="text-amber-700 mt-0.5 flex-shrink-0" />
        <div className="text-xs text-amber-900">
          <p className="font-bold mb-0.5">الحذف النهائي غير متاح من هذا التبويب.</p>
          <p>
            لحذف حساب نهائيًا يتطلب صلاحية Service Role ومرحلة منفصلة. للحفاظ على سجل التدقيق استخدم
            <span className="font-bold mx-1">تعطيل الحساب</span>
            أو
            <span className="font-bold mx-1">إيقاف مؤقت</span>.
          </p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="card-section p-4 flex flex-col gap-3">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search
              size={16}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]"
            />
            <input
              type="text"
              placeholder="بحث بالاسم / البريد / الدور..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pr-9 pl-4 py-2.5 border border-[hsl(var(--border))] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(
                e.target.value as 'all' | 'active' | 'disabled' | 'suspended' | 'pending'
              )
            }
            className="px-3 py-2.5 border border-[hsl(var(--border))] rounded-xl text-sm bg-white"
          >
            <option value="all">كل الحالات</option>
            <option value="active">نشط</option>
            <option value="disabled">معطّل</option>
            <option value="suspended">موقوف مؤقتًا</option>
            <option value="pending">بانتظار المراجعة</option>
          </select>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="px-3 py-2.5 border border-[hsl(var(--border))] rounded-xl text-sm bg-white"
          >
            <option value="all">كل الأدوار</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <select
            value={extraFilter}
            onChange={(e) =>
              setExtraFilter(e.target.value as 'none' | 'blocked_devices' | 'never_logged_in')
            }
            className="px-3 py-2.5 border border-[hsl(var(--border))] rounded-xl text-sm bg-white"
          >
            <option value="none">بدون فلتر إضافي</option>
            <option value="blocked_devices">لديهم أجهزة محظورة</option>
            <option value="never_logged_in">لم يسجلوا دخول</option>
          </select>
        </div>
      </div>

      {/* Users table */}
      <div className="card-section overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm" dir="rtl">
            <thead>
              <tr className="bg-[hsl(var(--muted))]/50 text-[hsl(var(--muted-foreground))] text-xs">
                <th className="text-right px-4 py-3 font-semibold">المستخدم</th>
                <th className="text-right px-4 py-3 font-semibold">الدور</th>
                <th className="text-right px-4 py-3 font-semibold">الحالة</th>
                <th className="text-right px-4 py-3 font-semibold">آخر دخول</th>
                <th className="text-right px-4 py-3 font-semibold">أجهزة</th>
                <th className="text-right px-4 py-3 font-semibold">محظورة</th>
                <th className="text-right px-4 py-3 font-semibold">عدد الدخول</th>
                <th className="text-right px-4 py-3 font-semibold">تاريخ الإنشاء</th>
                <th className="text-right px-4 py-3 font-semibold">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((u) => {
                const status = (u.account_status ?? 'active').toLowerCase();
                const tone = ACCOUNT_STATUS_TONE[status] ?? ACCOUNT_STATUS_TONE.active;
                const label = ACCOUNT_STATUS_LABEL_AR[status] ?? status;
                const busy = busyId === u.id;
                return (
                  <tr
                    key={u.id}
                    className="border-t border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/30"
                  >
                    <td className="px-4 py-3">
                      <p className="font-semibold text-[hsl(var(--foreground))]">
                        {u.full_name || u.email?.split('@')[0] || 'مستخدم'}
                      </p>
                      {u.email && (
                        <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5" dir="ltr">
                          {u.email}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {/* Phase 26G — canonical role label from live
                          `turath_roles` instead of the (possibly stale)
                          cached `profiles.role_name`. Surfaces a small
                          warning chip when the cached name no longer
                          matches the canonical name, or when the
                          stored `role_id` is missing from the roles
                          table altogether. */}
                      {(() => {
                        const canonicalRole = roles.find((r) => r.id === u.role_id);
                        const canonicalName = canonicalRole?.name ?? null;
                        const isUnknownRoleId = !!u.role_id && !canonicalRole;
                        const isStaleName =
                          !!canonicalName &&
                          !!u.role_name &&
                          u.role_name.trim() !== canonicalName.trim();
                        return (
                          <div className="flex items-center gap-1 flex-wrap">
                            <span className="inline-flex items-center gap-1 bg-[hsl(var(--muted))] text-[hsl(var(--foreground))] px-2 py-0.5 rounded-full font-semibold">
                              <Shield size={11} />
                              {canonicalName || u.role_id || '—'}
                            </span>
                            {isUnknownRoleId && (
                              <span
                                className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200"
                                title={`معرّف الدور (${u.role_id}) غير موجود في جدول الأدوار`}
                              >
                                ⚠ غير معروف
                              </span>
                            )}
                            {isStaleName && !isUnknownRoleId && (
                              <span
                                className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200"
                                title={`اسم الدور المسجل (${u.role_name}) قديم؛ الاسم الحالي: ${canonicalName}. سيتم تحديثه عند أي تعديل دور.`}
                              >
                                ⚠ اسم قديم
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${tone}`}
                      >
                        {label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {u.lastLoginAt ? (
                        <span dir="ltr">{fmtDateTime(u.lastLoginAt)}</span>
                      ) : (
                        <span className="text-[hsl(var(--muted-foreground))]">لم يسجل دخول</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-bold text-[hsl(var(--foreground))]">
                        {u.devicesCount}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {u.blockedDevicesCount > 0 ? (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full">
                          <Ban size={11} />
                          {u.blockedDevicesCount}
                        </span>
                      ) : (
                        <span className="text-xs text-[hsl(var(--muted-foreground))]">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono">{u.loginCount}</td>
                    <td className="px-4 py-3 text-xs">
                      <span dir="ltr">{fmtDate(u.created_at)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            setDrawerUserId(u.id);
                            setDrawerTab('account');
                          }}
                          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-blue-50 text-blue-600"
                          title="عرض التفاصيل الأمنية"
                          disabled={busy}
                        >
                          <Eye size={14} />
                        </button>
                        {/* Phase 26G — open the page-level role-edit
                            modal for this user. Hidden when the
                            parent didn't wire the callback. */}
                        {onRequestEditRole && (
                          <button
                            onClick={() => {
                              if (!canManageStaff) return;
                              onRequestEditRole({
                                id: u.id,
                                email: u.email,
                                name: u.full_name || u.email?.split('@')[0] || 'مستخدم',
                                currentRoleId: u.role_id,
                                currentRoleName: u.role_name,
                              });
                            }}
                            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-indigo-50 text-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed"
                            title={canManageStaff ? 'تعديل الدور' : 'لا تملك صلاحية تعديل الأدوار'}
                            disabled={!canManageStaff || busy}
                          >
                            <ShieldCheck size={14} />
                          </button>
                        )}
                        {status !== 'disabled' && (
                          <button
                            onClick={() => {
                              if (!canManageStaff) return;
                              const reason = window.prompt('سبب التعطيل (اختياري):') ?? undefined;
                              void updateAccountStatus(u, 'disabled', reason);
                            }}
                            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-rose-50 text-rose-600 disabled:opacity-40 disabled:cursor-not-allowed"
                            title={
                              canManageStaff ? 'تعطيل الحساب' : 'لا تملك صلاحية تعطيل الحسابات'
                            }
                            disabled={!canManageStaff || busy}
                          >
                            <UserX size={14} />
                          </button>
                        )}
                        {status !== 'suspended' && status !== 'disabled' && (
                          <button
                            onClick={() => {
                              if (!canManageStaff) return;
                              const reason =
                                window.prompt('سبب الإيقاف المؤقت (اختياري):') ?? undefined;
                              void updateAccountStatus(u, 'suspended', reason);
                            }}
                            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-amber-50 text-amber-600 disabled:opacity-40 disabled:cursor-not-allowed"
                            title={canManageStaff ? 'إيقاف مؤقت' : 'لا تملك صلاحية إيقاف الحسابات'}
                            disabled={!canManageStaff || busy}
                          >
                            <Clock size={14} />
                          </button>
                        )}
                        {(status === 'disabled' || status === 'suspended') && (
                          <button
                            onClick={() => void updateAccountStatus(u, 'active')}
                            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-emerald-50 text-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed"
                            title={
                              canManageStaff ? 'إعادة تفعيل الحساب' : 'لا تملك صلاحية إعادة التفعيل'
                            }
                            disabled={!canManageStaff || busy}
                          >
                            <Check size={14} />
                          </button>
                        )}
                        {u.devicesCount > 0 && (
                          <button
                            onClick={() => {
                              if (!canManageDevices) return;
                              const reason = window.prompt('سبب حظر كل الأجهزة (اختياري):') ?? '';
                              const userDevices = devicesByUser.get(u.id) ?? [];
                              const toBlock = userDevices.filter((d) => d.status !== 'blocked');
                              if (toBlock.length === 0) {
                                showToast('error', 'كل الأجهزة محظورة بالفعل لهذا المستخدم.');
                                return;
                              }
                              if (
                                window.confirm(
                                  `سيتم حظر ${toBlock.length} جهاز لهذا المستخدم. هل تريد المتابعة؟`
                                )
                              ) {
                                void blockAllDevices(u, reason);
                              }
                            }}
                            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-rose-50 text-rose-600 disabled:opacity-40 disabled:cursor-not-allowed"
                            title={
                              canManageDevices ? 'حظر كل الأجهزة' : 'لا تملك صلاحية حظر الأجهزة'
                            }
                            disabled={!canManageDevices || busy}
                          >
                            <Lock size={14} />
                          </button>
                        )}
                        {onOpenSecurityTab && (
                          <button
                            onClick={() => onOpenSecurityTab()}
                            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"
                            title="فتح في تبويب الأمان"
                          >
                            <ExternalLink size={14} />
                          </button>
                        )}
                        <button
                          disabled
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))]/40 cursor-not-allowed"
                          title="الحذف النهائي غير متاح من التطبيق. استخدم تعطيل الحساب للحفاظ على سجل التدقيق."
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredRows.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-10 text-center text-sm text-[hsl(var(--muted-foreground))]"
                  >
                    لا توجد بيانات مستخدمين مطابقة للفلتر.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Details drawer */}
      {drawerUser && (
        <UserDetailsDrawer
          user={drawerUser}
          devices={devicesByUser.get(drawerUser.id) ?? []}
          logins={loginsByUser.get(drawerUser.id) ?? []}
          audit={auditByEntity.get(drawerUser.id) ?? []}
          deviceAudit={(() => {
            const dIds = (devicesByUser.get(drawerUser.id) ?? []).map((d) => d.id);
            return dIds.flatMap((id) => auditByEntity.get(id) ?? []);
          })()}
          activeTab={drawerTab}
          onTabChange={setDrawerTab}
          onClose={() => setDrawerUserId(null)}
          canManageStaff={canManageStaff}
          canManageDevices={canManageDevices}
          busy={busyId === drawerUser.id}
          onDisable={(reason) => updateAccountStatus(drawerUser, 'disabled', reason)}
          onSuspend={(reason) => updateAccountStatus(drawerUser, 'suspended', reason)}
          onReactivate={() => updateAccountStatus(drawerUser, 'active')}
          onBlockAllDevices={(reason) => blockAllDevices(drawerUser, reason)}
          onDeviceStatus={setSingleDeviceStatus}
          onOpenSecurityTab={onOpenSecurityTab}
          onRequestEditRole={
            onRequestEditRole
              ? () =>
                  onRequestEditRole({
                    id: drawerUser.id,
                    email: drawerUser.email,
                    name: drawerUser.full_name || drawerUser.email?.split('@')[0] || 'مستخدم',
                    currentRoleId: drawerUser.role_id,
                    currentRoleName: drawerUser.role_name,
                  })
              : undefined
          }
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-[80] max-w-sm fade-in rounded-2xl border px-4 py-3 shadow-lg ${
            toast.kind === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
          role="status"
        >
          <p className="text-sm font-semibold">{toast.message}</p>
        </div>
      )}
    </div>
  );
}

// ─── Details drawer ─────────────────────────────────────────────────────────

interface UserDetailsDrawerProps {
  user: ProfileRow & {
    devicesCount: number;
    blockedDevicesCount: number;
    loginCount: number;
    lastLoginAt: string | null;
    lastDeviceLabel: string | null;
  };
  devices: DeviceRow[];
  logins: LoginEventRow[];
  audit: AuditRow[];
  /** Phase 26E — audit rows targeting the user's devices, surfaced
   *  alongside the profile-targeted audit so the operator sees the
   *  full account-level trail in one place. */
  deviceAudit: AuditRow[];
  activeTab: 'account' | 'devices' | 'logins' | 'audit';
  onTabChange: (tab: 'account' | 'devices' | 'logins' | 'audit') => void;
  onClose: () => void;
  canManageStaff: boolean;
  canManageDevices: boolean;
  busy: boolean;
  onDisable: (reason: string) => Promise<void>;
  onSuspend: (reason: string) => Promise<void>;
  onReactivate: () => Promise<void>;
  onBlockAllDevices: (reason: string) => Promise<void>;
  onDeviceStatus: (
    device: DeviceRow,
    next: 'allowed' | 'blocked',
    reason?: string
  ) => Promise<void>;
  onOpenSecurityTab?: () => void;
  /** Phase 26G — opens the page-level role-edit modal for the user
   *  shown in the drawer. */
  onRequestEditRole?: () => void;
}

function UserDetailsDrawer({
  user,
  devices,
  logins,
  audit,
  deviceAudit,
  activeTab,
  onTabChange,
  onClose,
  canManageStaff,
  canManageDevices,
  busy,
  onDisable,
  onSuspend,
  onReactivate,
  onBlockAllDevices,
  onDeviceStatus,
  onOpenSecurityTab,
  onRequestEditRole,
}: UserDetailsDrawerProps) {
  const status = (user.account_status ?? 'active').toLowerCase();
  const tone = ACCOUNT_STATUS_TONE[status] ?? ACCOUNT_STATUS_TONE.active;
  const statusLabel = ACCOUNT_STATUS_LABEL_AR[status] ?? status;

  const combinedAudit = useMemo(() => {
    const all = [...audit, ...deviceAudit];
    all.sort((a, b) => (b.created_at < a.created_at ? -1 : 1));
    return all.slice(0, 20);
  }, [audit, deviceAudit]);

  return (
    <div className="fixed inset-0 z-[70] flex items-stretch justify-end" dir="rtl">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div className="relative bg-white w-full max-w-2xl h-full flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex-shrink-0 border-b border-[hsl(var(--border))] p-4 flex items-start gap-3">
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-[hsl(var(--muted))]"
            aria-label="إغلاق"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold text-[hsl(var(--foreground))]">
              {user.full_name || user.email?.split('@')[0] || 'مستخدم'}
            </h3>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5" dir="ltr">
              {user.email ?? '—'}
            </p>
          </div>
          <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${tone}`}>
            {statusLabel}
          </span>
          {onOpenSecurityTab && (
            <button
              onClick={() => onOpenSecurityTab()}
              className="text-xs px-3 py-1.5 rounded-xl border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] flex items-center gap-1"
              title="فتح في تبويب الأمان"
            >
              <ExternalLink size={12} />
              الأمان
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex-shrink-0 border-b border-[hsl(var(--border))] px-2 flex gap-1 overflow-x-auto">
          {(
            [
              { key: 'account', label: 'بيانات الحساب' },
              { key: 'devices', label: `الأجهزة (${devices.length})` },
              { key: 'logins', label: `تسجيلات الدخول (${logins.length})` },
              { key: 'audit', label: `آخر أحداث التدقيق (${combinedAudit.length})` },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => onTabChange(t.key)}
              className={`px-3 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors ${
                activeTab === t.key
                  ? 'border-[hsl(var(--primary))] text-[hsl(var(--primary))]'
                  : 'border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 scrollbar-thin space-y-3">
          {activeTab === 'account' && (
            <DrawerAccountTab
              user={user}
              canManageStaff={canManageStaff}
              canManageDevices={canManageDevices}
              busy={busy}
              hasDevices={devices.length > 0}
              hasBlockableDevices={devices.some((d) => d.status !== 'blocked')}
              onDisable={onDisable}
              onSuspend={onSuspend}
              onReactivate={onReactivate}
              onBlockAllDevices={onBlockAllDevices}
              onRequestEditRole={onRequestEditRole}
            />
          )}
          {activeTab === 'devices' && (
            <DrawerDevicesTab
              devices={devices}
              canManageDevices={canManageDevices}
              busy={busy}
              onDeviceStatus={onDeviceStatus}
            />
          )}
          {activeTab === 'logins' && <DrawerLoginsTab logins={logins.slice(0, 20)} />}
          {activeTab === 'audit' && <DrawerAuditTab audit={combinedAudit} />}
        </div>
      </div>
    </div>
  );
}

// ─── Drawer: account section ────────────────────────────────────────────────

function DrawerAccountTab({
  user,
  canManageStaff,
  canManageDevices,
  busy,
  hasDevices,
  hasBlockableDevices,
  onDisable,
  onSuspend,
  onReactivate,
  onBlockAllDevices,
  onRequestEditRole,
}: {
  user: ProfileRow;
  canManageStaff: boolean;
  canManageDevices: boolean;
  busy: boolean;
  hasDevices: boolean;
  hasBlockableDevices: boolean;
  onDisable: (reason: string) => Promise<void>;
  onSuspend: (reason: string) => Promise<void>;
  onReactivate: () => Promise<void>;
  onBlockAllDevices: (reason: string) => Promise<void>;
  onRequestEditRole?: () => void;
}) {
  const status = (user.account_status ?? 'active').toLowerCase();
  return (
    <>
      <section className="rounded-2xl border border-[hsl(var(--border))] p-4 space-y-2">
        <h4 className="text-xs font-bold text-[hsl(var(--muted-foreground))]">بيانات الحساب</h4>
        <FieldRow label="الاسم" value={user.full_name ?? '—'} />
        <FieldRow label="البريد" value={user.email ?? '—'} dir="ltr" />
        <FieldRow label="الدور" value={user.role_name || user.role_id || '—'} />
        <FieldRow label="الحالة" value={ACCOUNT_STATUS_LABEL_AR[status] ?? status} />
        <FieldRow label="تاريخ الإنشاء" value={fmtDate(user.created_at)} />
        {(user.disabled_at || user.disabled_reason) && (
          <>
            <FieldRow label="تاريخ التعطيل" value={fmtDateTime(user.disabled_at)} />
            <FieldRow label="سبب التعطيل" value={user.disabled_reason || '—'} />
          </>
        )}
      </section>

      <section className="rounded-2xl border border-[hsl(var(--border))] p-4 space-y-2">
        <h4 className="text-xs font-bold text-[hsl(var(--muted-foreground))]">الإجراءات</h4>
        <div className="flex flex-wrap gap-2">
          {/* Phase 26G — role-edit launcher inside the drawer. Hidden
              when the parent didn't supply the callback. */}
          {onRequestEditRole && (
            <button
              onClick={() => onRequestEditRole()}
              className="text-xs px-3 py-1.5 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
              disabled={!canManageStaff || busy}
              title={canManageStaff ? '' : 'لا تملك صلاحية تعديل الأدوار'}
            >
              <ShieldCheck size={12} />
              تعديل الدور
            </button>
          )}
          {status !== 'disabled' && (
            <button
              onClick={() => {
                const reason = window.prompt('سبب التعطيل (اختياري):') ?? '';
                void onDisable(reason);
              }}
              className="text-xs px-3 py-1.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
              disabled={!canManageStaff || busy}
              title={canManageStaff ? '' : 'لا تملك صلاحية تعطيل الحسابات'}
            >
              <UserX size={12} />
              تعطيل الحساب
            </button>
          )}
          {status !== 'suspended' && status !== 'disabled' && (
            <button
              onClick={() => {
                const reason = window.prompt('سبب الإيقاف المؤقت (اختياري):') ?? '';
                void onSuspend(reason);
              }}
              className="text-xs px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
              disabled={!canManageStaff || busy}
              title={canManageStaff ? '' : 'لا تملك صلاحية إيقاف الحسابات'}
            >
              <Clock size={12} />
              إيقاف مؤقت
            </button>
          )}
          {(status === 'disabled' || status === 'suspended') && (
            <button
              onClick={() => void onReactivate()}
              className="text-xs px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
              disabled={!canManageStaff || busy}
              title={canManageStaff ? '' : 'لا تملك صلاحية إعادة التفعيل'}
            >
              <Check size={12} />
              إعادة تفعيل
            </button>
          )}
          {hasDevices && (
            <button
              onClick={() => {
                if (!hasBlockableDevices) {
                  window.alert('كل الأجهزة محظورة بالفعل لهذا المستخدم.');
                  return;
                }
                const reason = window.prompt('سبب حظر كل الأجهزة (اختياري):') ?? '';
                if (window.confirm('سيتم حظر كل الأجهزة المسموحة لهذا المستخدم. متابعة؟')) {
                  void onBlockAllDevices(reason);
                }
              }}
              className="text-xs px-3 py-1.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
              disabled={!canManageDevices || busy || !hasBlockableDevices}
              title={
                !canManageDevices
                  ? 'لا تملك صلاحية حظر الأجهزة'
                  : !hasBlockableDevices
                    ? 'كل الأجهزة محظورة بالفعل'
                    : ''
              }
            >
              <Lock size={12} />
              حظر كل الأجهزة
            </button>
          )}
        </div>
        <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-2">
          الحذف النهائي غير متاح من هذا التبويب — استخدم التعطيل للحفاظ على سجل التدقيق.
        </p>
      </section>
    </>
  );
}

function FieldRow({ label, value, dir }: { label: string; value: string; dir?: 'ltr' | 'rtl' }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-[hsl(var(--muted-foreground))]">{label}</span>
      <span className="text-[hsl(var(--foreground))] font-semibold text-end" dir={dir}>
        {value}
      </span>
    </div>
  );
}

// ─── Drawer: devices section ────────────────────────────────────────────────

function DrawerDevicesTab({
  devices,
  canManageDevices,
  busy,
  onDeviceStatus,
}: {
  devices: DeviceRow[];
  canManageDevices: boolean;
  busy: boolean;
  onDeviceStatus: (
    device: DeviceRow,
    next: 'allowed' | 'blocked',
    reason?: string
  ) => Promise<void>;
}) {
  if (devices.length === 0) {
    return (
      <p className="text-sm text-[hsl(var(--muted-foreground))] text-center py-8">
        لا توجد أجهزة مسجلة لهذا المستخدم بعد.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {devices.slice(0, 20).map((d) => {
        const tone = DEVICE_STATUS_TONE[d.status] ?? DEVICE_STATUS_TONE.allowed;
        const label = DEVICE_STATUS_LABEL_AR[d.status] ?? d.status;
        return (
          <div key={d.id} className="rounded-2xl border border-[hsl(var(--border))] p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {deviceIconFor(d.device_label ?? d.user_agent, 14)}
                <p className="text-sm font-semibold text-[hsl(var(--foreground))] truncate">
                  {d.device_label ?? d.device_fingerprint.slice(0, 18)}
                </p>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${tone}`}>
                {label}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px] text-[hsl(var(--muted-foreground))]">
              <FieldRow label="آخر IP" value={d.last_ip ?? '—'} dir="ltr" />
              <FieldRow label="آخر ظهور" value={fmtDateTime(d.last_seen_at)} />
              <FieldRow label="أول ظهور" value={fmtDateTime(d.first_seen_at)} />
              <FieldRow label="عدد الدخول" value={String(d.login_count)} />
              {d.blocked_reason && (
                <div className="col-span-2 text-[11px] text-rose-700">
                  سبب الحظر: {d.blocked_reason}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              {d.status !== 'blocked' && (
                <button
                  onClick={() => {
                    const reason = window.prompt('سبب الحظر (اختياري):') ?? '';
                    void onDeviceStatus(d, 'blocked', reason);
                  }}
                  className="text-xs px-3 py-1.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                  disabled={!canManageDevices || busy}
                  title={canManageDevices ? '' : 'لا تملك صلاحية حظر الأجهزة'}
                >
                  <Lock size={12} />
                  حظر الجهاز
                </button>
              )}
              {d.status === 'blocked' && (
                <button
                  onClick={() => void onDeviceStatus(d, 'allowed')}
                  className="text-xs px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                  disabled={!canManageDevices || busy}
                  title={canManageDevices ? '' : 'لا تملك صلاحية إلغاء الحظر'}
                >
                  <Unlock size={12} />
                  إلغاء الحظر
                </button>
              )}
            </div>
          </div>
        );
      })}
      {devices.length > 20 && (
        <p className="text-[11px] text-center text-[hsl(var(--muted-foreground))]">
          يتم عرض أحدث 20 جهاز فقط. للسجل الكامل افتح تبويب الأمان.
        </p>
      )}
    </div>
  );
}

// ─── Drawer: logins section ─────────────────────────────────────────────────

function DrawerLoginsTab({ logins }: { logins: LoginEventRow[] }) {
  if (logins.length === 0) {
    return (
      <p className="text-sm text-[hsl(var(--muted-foreground))] text-center py-8">
        لا توجد تسجيلات دخول لهذا المستخدم بعد.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {logins.map((e) => {
        const label = EVENT_TYPE_LABEL_AR[e.event_type] ?? e.event_type;
        const tone = e.success
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
          : 'bg-rose-50 text-rose-700 border-rose-200';
        return (
          <div key={e.id} className="rounded-2xl border border-[hsl(var(--border))] p-3 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${tone}`}>
                {label} {e.success ? '✓' : '✗'}
              </span>
              <span className="text-[11px] text-[hsl(var(--muted-foreground))]" dir="ltr">
                {fmtDateTime(e.created_at)}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px] text-[hsl(var(--muted-foreground))]">
              <FieldRow label="IP" value={e.ip_address ?? '—'} dir="ltr" />
              <FieldRow label="الجهاز" value={e.device_label ?? '—'} />
            </div>
            {e.failure_reason && (
              <p className="text-[11px] text-rose-700">سبب الفشل: {e.failure_reason}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Drawer: audit section ──────────────────────────────────────────────────

function DrawerAuditTab({ audit }: { audit: AuditRow[] }) {
  if (audit.length === 0) {
    return (
      <p className="text-sm text-[hsl(var(--muted-foreground))] text-center py-8">
        لا توجد أحداث تدقيق لهذا الحساب بعد.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {audit.map((a) => {
        const label = STAFF_AUDIT_ACTION_LABEL_AR[a.action as StaffAuditAction] ?? a.action;
        return (
          <div key={a.id} className="rounded-2xl border border-[hsl(var(--border))] p-3 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-[hsl(var(--foreground))]">{label}</span>
              <span className="text-[11px] text-[hsl(var(--muted-foreground))]" dir="ltr">
                {fmtDateTime(a.created_at)}
              </span>
            </div>
            {a.actor_name && (
              <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                بواسطة: {a.actor_name}
              </p>
            )}
            {a.description && (
              <p className="text-[11px] text-[hsl(var(--foreground))]">{a.description}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
