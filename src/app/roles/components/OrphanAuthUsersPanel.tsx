// ─────────────────────────────────────────────────────────────────────────────
// src/app/roles/components/OrphanAuthUsersPanel.tsx
//
// Phase 26B — orphan auth users + suspicious profiles panel inside
// /roles → الأمان والتدقيق.
//
// What it renders
// ---------------
//   1. Two KPI strips: auth total / profiles total / orphans count;
//      then suspicious profile counts (dup-email / missing-email /
//      invalid-role / placeholder-name / no-recent-login).
//   2. الحسابات غير المرتبطة — every `auth.users` row joined with its
//      profile (if any). Each row shows email / auth user id / last
//      sign-in / created_at / recommendation chip. Actions per row:
//        • إنشاء ملف موظف (orphans only) — opens an inline modal
//          and POSTs `create-profile`.
//        • تعطيل / إيقاف مؤقت / إعادة تفعيل (profile-backed rows)
//          — reuse the existing SecurityTab status flow by writing
//          to `profiles.account_status` directly + audit log.
//        • حذف نهائي من Auth — opens a dangerous modal that
//          requires typing the literal Arabic phrase `حذف نهائي`,
//          then POSTs `hard-delete`. The button is disabled +
//          replaced with an explanatory pill when the server reports
//          `service_role_unavailable`.
//   3. Profiles مشبوهة — flag-based table for: missing email,
//      invalid role_id (not in `turath_roles`), duplicated email,
//      account_status != 'active', placeholder-named accounts
//      (`test`, `demo`, `fake`, `tmp`, `tester`, ...). Read-only —
//      the existing SecurityTab handles disable / reactivate.
//
// What it does NOT do
// -------------------
//   • Never deletes a profile row. Hard-delete only targets
//     `auth.users` and (when a matching profile exists) flips
//     `account_status='disabled'` with reason 'auth user deleted'.
//   • Never bypasses RLS — the GET path uses the SECURITY DEFINER
//     RPC, every action endpoint re-checks `is_admin()` server-side.
//   • Never shows tokens / refresh tokens / password hashes.
// ─────────────────────────────────────────────────────────────────────────────
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  UserPlus,
  UserX,
  ShieldOff,
  RefreshCcw,
  CheckCircle,
  PauseCircle,
  XCircle,
  Eye,
  Lock,
} from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { writeStaffAuditLog } from '@/lib/security/staffAudit';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface AuthUserRow {
  id: string;
  email: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  banned_until: string | null;
  deleted_at: string | null;
  has_profile: boolean;
  profile: {
    id: string;
    email: string | null;
    full_name: string | null;
    role_id: string | null;
    role_name: string | null;
    account_status: string | null;
    disabled_at: string | null;
    disabled_reason: string | null;
  } | null;
  delete_safety?: {
    allowed: boolean;
    category: string | null;
    blocked_reason: string | null;
    activity_summary?: {
      login_events: number | null;
      devices: number | null;
      staff_audit_actor_events: number | null;
      operational_refs_total: number;
      activity_unknown: boolean;
    };
  };
}

interface RoleOption {
  id: string;
  name: string;
}

interface ApiResponse {
  ok: boolean;
  service_role_available?: boolean;
  counts?: { auth_total: number; profiles_total: number; orphans: number };
  rows?: AuthUserRow[];
  error?: string;
}

const PLACEHOLDER_RE = /(test|demo|fake|admin2|user1|user2|sample|tmp|tester)/i;
const HARD_DELETE_PHRASE = 'حذف نهائي';
const ACCOUNT_STATUS_LABEL_AR: Record<string, string> = {
  active: 'نشط',
  disabled: 'معطّل',
  suspended: 'موقوف مؤقتًا',
  pending: 'بانتظار المراجعة',
};

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-GB');
  } catch {
    return String(iso);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function OrphanAuthUsersPanel() {
  const { user, currentRoleId, profileFullName } = useAuth();

  const [rows, setRows] = useState<AuthUserRow[]>([]);
  const [serviceRoleAvailable, setServiceRoleAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [accessDenied, setAccessDenied] = useState(false);

  const [createForUser, setCreateForUser] = useState<AuthUserRow | null>(null);
  const [createFullName, setCreateFullName] = useState('');
  const [createRoleId, setCreateRoleId] = useState('');

  const [deleteForUser, setDeleteForUser] = useState<AuthUserRow | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteReason, setDeleteReason] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [resp, rolesResp] = await Promise.all([
        fetch('/api/security/auth-users', { credentials: 'same-origin' }),
        (async () => {
          const sb = createClient();
          return sb.from('turath_roles').select('id, name').order('id');
        })(),
      ]);
      if (resp.status === 401) {
        setAccessDenied(true);
        setError('غير مصرّح بالدخول.');
        return;
      }
      if (resp.status === 403) {
        setAccessDenied(true);
        setError('هذه الصفحة متاحة لمدراء النظام فقط.');
        return;
      }
      const json = (await resp.json()) as ApiResponse;
      if (!resp.ok || !json.ok) {
        throw new Error(json.error ?? 'تعذر تحميل بيانات الحسابات.');
      }
      setRows(json.rows ?? []);
      setServiceRoleAvailable(Boolean(json.service_role_available));
      setRoles((rolesResp.data as RoleOption[]) ?? []);
    } catch (err) {
      console.error('[OrphanAuthUsersPanel] load failed:', err);
      setError(err instanceof Error ? err.message : 'تعذر تحميل بيانات الحسابات.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Derived KPIs ───

  const kpis = useMemo(() => {
    const orphans = rows.filter((r) => !r.has_profile);
    const banned = rows.filter(
      (r) => r.banned_until !== null && r.banned_until > new Date().toISOString()
    );
    const deleted = rows.filter((r) => r.deleted_at !== null);
    return {
      authTotal: rows.length,
      profileTotal: rows.filter((r) => r.has_profile).length,
      orphanCount: orphans.length,
      bannedCount: banned.length,
      softDeletedCount: deleted.length,
    };
  }, [rows]);

  // ─── Suspicious profile flags ───
  const suspicious = useMemo(() => {
    const dupEmail = new Map<string, number>();
    for (const r of rows) {
      const email = (r.profile?.email ?? r.email ?? '').trim().toLowerCase();
      if (!email) continue;
      dupEmail.set(email, (dupEmail.get(email) ?? 0) + 1);
    }
    const flagged: Array<{
      row: AuthUserRow;
      flags: string[];
    }> = [];
    for (const r of rows) {
      const flags: string[] = [];
      const profile = r.profile;
      if (!profile) continue; // orphans are handled in their own section
      const email = (profile.email ?? '').trim();
      const name = (profile.full_name ?? '').trim();
      const status = profile.account_status ?? 'active';
      if (!email) flags.push('بدون بريد');
      if (!profile.role_id) flags.push('بدون دور');
      if (PLACEHOLDER_RE.test(name) || PLACEHOLDER_RE.test(email)) {
        flags.push('اسم/بريد افتراضي');
      }
      const emailKey = email.toLowerCase();
      if (emailKey && (dupEmail.get(emailKey) ?? 0) > 1) {
        flags.push('بريد مكرر');
      }
      if (status !== 'active') {
        flags.push(`الحالة: ${ACCOUNT_STATUS_LABEL_AR[status] ?? status}`);
      }
      if (flags.length > 0) flagged.push({ row: r, flags });
    }
    return flagged;
  }, [rows]);

  // ─── Mutations ───

  const handleCreateProfile = async () => {
    if (!createForUser) return;
    if (!createFullName.trim() || !createRoleId) {
      toast.error('الاسم الكامل والدور مطلوبان.');
      return;
    }
    setBusyId(createForUser.id);
    try {
      const roleName = roles.find((r) => r.id === createRoleId)?.name ?? null;
      const resp = await fetch('/api/security/auth-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          action: 'create-profile',
          user_id: createForUser.id,
          full_name: createFullName.trim(),
          role_id: createRoleId,
          role_name: roleName,
        }),
      });
      const json = (await resp.json()) as { ok: boolean; code?: string; message?: string };
      if (!resp.ok || !json.ok) {
        throw new Error(json.message ?? json.code ?? 'تعذر إنشاء الملف.');
      }
      toast.success('تم إنشاء الملف للحساب.');
      setCreateForUser(null);
      setCreateFullName('');
      setCreateRoleId('');
      await load();
    } catch (err) {
      console.error('[OrphanAuthUsersPanel] create-profile failed:', err);
      toast.error(err instanceof Error ? err.message : 'تعذر إنشاء الملف.');
    } finally {
      setBusyId(null);
    }
  };

  const updateProfileStatus = async (
    row: AuthUserRow,
    next: 'active' | 'disabled' | 'suspended' | 'pending',
    reason?: string
  ) => {
    if (!row.profile) return;
    setBusyId(row.id);
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
      const { error: updateErr } = await supabase.from('profiles').update(update).eq('id', row.id);
      if (updateErr) throw updateErr;
      const actionByNext = {
        active: 'staff.account_reactivated',
        disabled: 'staff.account_disabled',
        suspended: 'staff.account_suspended',
        pending: 'staff.account_pending',
      } as const;
      await writeStaffAuditLog(supabase, {
        action: actionByNext[next],
        actorId: user?.id ?? null,
        actorName: profileFullName ?? user?.email ?? null,
        actorRoleId: currentRoleId,
        entity: {
          type: 'profile',
          id: row.id,
          label: row.profile.full_name ?? row.profile.email ?? row.id,
        },
        description: reason ?? null,
        metadata: { from: row.profile.account_status ?? 'active', to: next },
      });
      toast.success('تم تحديث حالة الحساب.');
      await load();
    } catch (err) {
      console.error('[OrphanAuthUsersPanel] status update failed:', err);
      toast.error('تعذر تحديث حالة الحساب.');
    } finally {
      setBusyId(null);
    }
  };

  const handleHardDelete = async () => {
    if (!deleteForUser) return;
    if (deleteConfirm.trim() !== HARD_DELETE_PHRASE) {
      toast.error('الرجاء كتابة العبارة بالضبط.');
      return;
    }
    setBusyId(deleteForUser.id);
    try {
      const resp = await fetch('/api/security/delete-auth-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          user_id: deleteForUser.id,
          confirmation: deleteConfirm.trim(),
          reason: deleteReason.trim(),
        }),
      });
      const json = (await resp.json()) as { ok: boolean; code?: string; message?: string };
      if (resp.status === 503 && json.code === 'service_role_unavailable') {
        toast.error(json.message ?? 'الحذف النهائي غير متاح من التطبيق الحالي.');
        return;
      }
      if (!resp.ok || !json.ok) {
        throw new Error(json.message ?? json.code ?? 'تعذر الحذف النهائي.');
      }
      toast.success('تم الحذف النهائي للحساب.');
      setDeleteForUser(null);
      setDeleteConfirm('');
      setDeleteReason('');
      await load();
    } catch (err) {
      console.error('[OrphanAuthUsersPanel] hard-delete failed:', err);
      toast.error(err instanceof Error ? err.message : 'تعذر الحذف النهائي.');
    } finally {
      setBusyId(null);
    }
  };

  // ─── Render ───

  if (loading) {
    return (
      <div className="p-6 text-center text-sm text-[hsl(var(--muted-foreground))]">
        جارٍ تحميل الحسابات...
      </div>
    );
  }

  if (accessDenied) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 flex items-start gap-2">
        <Lock size={16} className="mt-0.5" /> {error ?? 'غير مصرّح بالدخول.'}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        {error}
        <button onClick={load} className="mr-2 underline">
          إعادة المحاولة
        </button>
      </div>
    );
  }

  const orphans = rows.filter((r) => !r.has_profile);

  return (
    <div className="space-y-4" dir="rtl">
      {/* KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
        {[
          {
            label: 'مستخدمو Auth',
            value: kpis.authTotal,
            tone: 'bg-slate-50 text-slate-700',
          },
          {
            label: 'ملفات الموظفين',
            value: kpis.profileTotal,
            tone: 'bg-indigo-50 text-indigo-700',
          },
          {
            label: 'حسابات بدون ملف',
            value: kpis.orphanCount,
            tone: 'bg-amber-50 text-amber-700',
          },
          {
            label: 'محظورة في Supabase',
            value: kpis.bannedCount,
            tone: 'bg-rose-50 text-rose-700',
          },
          {
            label: 'محذوفة مؤقتًا (Auth)',
            value: kpis.softDeletedCount,
            tone: 'bg-slate-50 text-slate-700',
          },
        ].map((k) => (
          <div
            key={k.label}
            className={`rounded-2xl border border-[hsl(var(--border))] p-3 ${k.tone}`}
          >
            <p className="text-xs font-bold">{k.label}</p>
            <p className="text-xl font-bold mt-1">{k.value.toLocaleString('en-US')}</p>
          </div>
        ))}
      </div>

      {!serviceRoleAvailable && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 flex items-start gap-2 text-xs text-amber-900">
          <AlertTriangle size={14} className="mt-0.5" />
          <span>
            <span className="font-bold">الحذف النهائي غير متاح من التطبيق الحالي.</span> استخدم
            التعطيل أو أنشئ ملفًا للحساب. لتمكين الحذف لاحقًا، يجب ضبط{' '}
            <code className="bg-amber-100 px-1 rounded">SUPABASE_SERVICE_ROLE_KEY</code> في بيئة
            الخادم — خارج نطاق هذه المرحلة.
          </span>
        </div>
      )}

      {/* Orphan auth users */}
      <section className="card-section overflow-hidden">
        <div className="p-3 border-b border-[hsl(var(--border))] flex items-center gap-2">
          <UserX size={15} className="text-amber-700" />
          <h3 className="text-sm font-bold">الحسابات غير المرتبطة ({orphans.length})</h3>
        </div>
        {orphans.length === 0 ? (
          <p className="p-4 text-xs text-[hsl(var(--muted-foreground))]">
            كل حسابات Supabase Auth مرتبطة بملف موظف. لا حاجة لإجراء.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[hsl(var(--muted))]/40 text-[hsl(var(--muted-foreground))]">
                <tr>
                  <th className="text-right px-3 py-2 font-semibold">البريد</th>
                  <th className="text-right px-3 py-2 font-semibold">UUID</th>
                  <th className="text-right px-3 py-2 font-semibold">أُنشئ في</th>
                  <th className="text-right px-3 py-2 font-semibold">آخر دخول</th>
                  <th className="text-center px-3 py-2 font-semibold">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {orphans.map((r) => (
                  <tr key={r.id} className="border-t border-[hsl(var(--border))]">
                    <td className="px-3 py-2 font-mono text-[11px]">{r.email ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                      {r.id.slice(0, 8)}…
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px]">{fmtDateTime(r.created_at)}</td>
                    <td className="px-3 py-2 font-mono text-[10px]">
                      {fmtDateTime(r.last_sign_in_at)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <div className="flex flex-wrap justify-center gap-1">
                        <button
                          disabled={busyId === r.id}
                          className="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-1 rounded-lg font-bold hover:bg-emerald-200 disabled:opacity-50 inline-flex items-center gap-1"
                          onClick={() => {
                            setCreateForUser(r);
                            setCreateFullName(
                              (r.email ?? '').split('@')[0]?.replace(/[._-]/g, ' ').trim() ?? ''
                            );
                            setCreateRoleId('r6');
                          }}
                        >
                          <UserPlus size={11} /> إنشاء ملف
                        </button>
                        <button
                          disabled={
                            busyId === r.id || !serviceRoleAvailable || !r.delete_safety?.allowed
                          }
                          className="text-[10px] bg-rose-100 text-rose-800 px-2 py-1 rounded-lg font-bold hover:bg-rose-200 disabled:opacity-40 inline-flex items-center gap-1"
                          title={
                            !serviceRoleAvailable
                              ? 'الحذف النهائي غير متاح لأن مفتاح Service Role غير مفعّل على السيرفر'
                              : r.delete_safety?.allowed
                                ? 'حذف نهائي من Auth'
                                : r.delete_safety?.blocked_reason ||
                                  'الحذف النهائي غير مسموح لهذا الحساب'
                          }
                          onClick={() => {
                            setDeleteForUser(r);
                            setDeleteConfirm('');
                            setDeleteReason('');
                          }}
                        >
                          <ShieldOff size={11} /> حذف نهائي
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Suspicious profiles */}
      <section className="card-section overflow-hidden">
        <div className="p-3 border-b border-[hsl(var(--border))] flex items-center gap-2">
          <AlertTriangle size={15} className="text-amber-700" />
          <h3 className="text-sm font-bold">ملفات مشبوهة ({suspicious.length})</h3>
        </div>
        {suspicious.length === 0 ? (
          <p className="p-4 text-xs text-[hsl(var(--muted-foreground))]">
            لا توجد ملفات تحتاج مراجعة.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[hsl(var(--muted))]/40 text-[hsl(var(--muted-foreground))]">
                <tr>
                  <th className="text-right px-3 py-2 font-semibold">الموظف</th>
                  <th className="text-right px-3 py-2 font-semibold">الدور</th>
                  <th className="text-right px-3 py-2 font-semibold">العلامات</th>
                  <th className="text-right px-3 py-2 font-semibold">آخر دخول</th>
                  <th className="text-center px-3 py-2 font-semibold">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {suspicious.map(({ row, flags }) => (
                  <tr key={row.id} className="border-t border-[hsl(var(--border))]">
                    <td className="px-3 py-2">
                      <div className="leading-tight">
                        <p className="font-semibold">{row.profile?.full_name || '—'}</p>
                        <p className="text-[10px] text-[hsl(var(--muted-foreground))] font-mono">
                          {row.profile?.email || '—'}
                        </p>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-[10px] bg-[hsl(var(--muted))]/40 px-2 py-0.5 rounded-full font-bold">
                        {row.profile?.role_name ?? row.profile?.role_id ?? '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {flags.map((f) => (
                          <span
                            key={f}
                            className="text-[10px] bg-amber-100 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded-full font-bold"
                          >
                            {f}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px]">
                      {fmtDateTime(row.last_sign_in_at)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <div className="flex flex-wrap justify-center gap-1">
                        {row.profile?.account_status === 'active' ? (
                          <>
                            <button
                              disabled={busyId === row.id}
                              className="text-[10px] bg-amber-100 text-amber-800 px-2 py-1 rounded-lg font-bold hover:bg-amber-200 disabled:opacity-50 inline-flex items-center gap-1"
                              onClick={() => {
                                const reason = window.prompt('سبب الإيقاف المؤقت:');
                                if (reason === null) return;
                                void updateProfileStatus(row, 'suspended', reason || undefined);
                              }}
                            >
                              <PauseCircle size={11} /> إيقاف
                            </button>
                            <button
                              disabled={busyId === row.id}
                              className="text-[10px] bg-rose-100 text-rose-800 px-2 py-1 rounded-lg font-bold hover:bg-rose-200 disabled:opacity-50 inline-flex items-center gap-1"
                              onClick={() => {
                                const reason = window.prompt('سبب التعطيل:');
                                if (reason === null) return;
                                void updateProfileStatus(row, 'disabled', reason || undefined);
                              }}
                            >
                              <XCircle size={11} /> تعطيل
                            </button>
                          </>
                        ) : (
                          <button
                            disabled={busyId === row.id}
                            className="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-1 rounded-lg font-bold hover:bg-emerald-200 disabled:opacity-50 inline-flex items-center gap-1"
                            onClick={() => updateProfileStatus(row, 'active')}
                          >
                            <CheckCircle size={11} /> إعادة تفعيل
                          </button>
                        )}
                        <button
                          disabled={
                            busyId === row.id ||
                            !serviceRoleAvailable ||
                            !row.delete_safety?.allowed
                          }
                          className="text-[10px] bg-rose-100 text-rose-800 px-2 py-1 rounded-lg font-bold hover:bg-rose-200 disabled:opacity-40 inline-flex items-center gap-1"
                          title={
                            !serviceRoleAvailable
                              ? 'الحذف النهائي غير متاح لأن مفتاح Service Role غير مفعّل على السيرفر'
                              : row.delete_safety?.allowed
                                ? 'حذف نهائي آمن'
                                : row.delete_safety?.blocked_reason ||
                                  'الحذف النهائي غير مسموح لهذا الحساب'
                          }
                          onClick={() => {
                            setDeleteForUser(row);
                            setDeleteConfirm('');
                            setDeleteReason('');
                          }}
                        >
                          <ShieldOff size={11} /> حذف نهائي
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <button
        onClick={load}
        className="text-xs text-[hsl(var(--primary))] hover:underline inline-flex items-center gap-1"
      >
        <RefreshCcw size={12} /> تحديث القائمة
      </button>

      {/* Create profile modal */}
      {createForUser && (
        <Modal onClose={() => setCreateForUser(null)} title="إنشاء ملف موظف">
          <div className="space-y-3 text-xs">
            <p className="text-[hsl(var(--muted-foreground))]">
              للحساب{' '}
              <code className="font-mono bg-[hsl(var(--muted))]/40 px-1 rounded">
                {createForUser.email}
              </code>
            </p>
            <label className="flex flex-col gap-1">
              الاسم الكامل
              <input
                type="text"
                value={createFullName}
                onChange={(e) => setCreateFullName(e.target.value)}
                className="form-input text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              الدور
              <select
                value={createRoleId}
                onChange={(e) => setCreateRoleId(e.target.value)}
                className="input-field text-sm"
              >
                <option value="">اختر دورًا...</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.id})
                  </option>
                ))}
              </select>
            </label>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setCreateForUser(null)}
                className="btn-secondary text-xs py-1 px-3"
              >
                إلغاء
              </button>
              <button
                onClick={handleCreateProfile}
                disabled={busyId === createForUser.id}
                className="btn-primary text-xs py-1 px-3 inline-flex items-center gap-1"
              >
                <UserPlus size={12} /> إنشاء الملف
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Hard delete modal */}
      {deleteForUser && (
        <Modal
          onClose={() => setDeleteForUser(null)}
          title="حذف نهائي من Supabase Auth"
          tone="danger"
        >
          <div className="space-y-3 text-xs">
            <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-rose-900">
              <p className="font-bold mb-1 flex items-center gap-1">
                <AlertTriangle size={14} /> هذا الإجراء لا يمكن التراجع عنه
              </p>
              <ul className="space-y-0.5 leading-relaxed">
                <li>
                  البريد: <code className="font-mono">{deleteForUser.email ?? '—'}</code>
                </li>
                <li>
                  UUID: <code className="font-mono">{deleteForUser.id}</code>
                </li>
                <li>آخر دخول: {fmtDateTime(deleteForUser.last_sign_in_at)}</li>
                <li>أُنشئ في: {fmtDateTime(deleteForUser.created_at)}</li>
                <li>
                  ملف الموظف:{' '}
                  {deleteForUser.profile ? (
                    <span>سيتم تعطيله (لا يُحذف للحفاظ على سجل التدقيق)</span>
                  ) : (
                    <span>غير موجود</span>
                  )}
                </li>
                <li>
                  النشاط: دخول {deleteForUser.delete_safety?.activity_summary?.login_events ?? '؟'}،
                  أجهزة {deleteForUser.delete_safety?.activity_summary?.devices ?? '؟'}، تشغيل{' '}
                  {deleteForUser.delete_safety?.activity_summary?.operational_refs_total ?? '؟'}
                </li>
              </ul>
            </div>
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-amber-900 leading-relaxed">
              <p>الحذف النهائي لا يمكن التراجع عنه من ناحية تسجيل الدخول.</p>
              <p>لن يتم حذف سجلات التشغيل أو التدقيق.</p>
              <p>سيتم تعطيل ملف الموظف بدل حذفه للحفاظ على السجل.</p>
            </div>
            <label className="flex flex-col gap-1">
              سبب الحذف
              <textarea
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                className="form-input text-sm min-h-[72px]"
                placeholder="مثال: حساب وهمي جديد تم إنشاؤه بالخطأ"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span>
                للتأكيد، اكتب العبارة بالضبط:{' '}
                <code className="font-mono bg-rose-100 px-1 rounded">{HARD_DELETE_PHRASE}</code>
              </span>
              <input
                type="text"
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                className="form-input text-sm"
                dir="rtl"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteForUser(null)}
                className="btn-secondary text-xs py-1 px-3"
              >
                إلغاء
              </button>
              <button
                onClick={handleHardDelete}
                disabled={
                  busyId === deleteForUser.id ||
                  deleteConfirm.trim() !== HARD_DELETE_PHRASE ||
                  !deleteReason.trim() ||
                  !serviceRoleAvailable ||
                  !deleteForUser.delete_safety?.allowed
                }
                className="bg-rose-600 text-white text-xs py-1 px-3 rounded-lg font-bold inline-flex items-center gap-1 disabled:opacity-50"
              >
                <ShieldOff size={12} />
                {serviceRoleAvailable ? 'تأكيد الحذف النهائي' : 'الحذف النهائي غير متاح'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Small modal helper ───
function Modal({
  title,
  children,
  onClose,
  tone = 'neutral',
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  tone?: 'neutral' | 'danger';
}) {
  return (
    <div className="fixed inset-0 z-[200] bg-black/40 flex items-center justify-center p-3">
      <div
        className={`bg-white w-full max-w-md rounded-2xl shadow-2xl ${
          tone === 'danger' ? 'border-2 border-rose-300' : ''
        }`}
        dir="rtl"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))]">
          <h3 className="text-sm font-bold">{title}</h3>
          <button onClick={onClose}>
            <Eye size={16} className="rotate-45 text-[hsl(var(--muted-foreground))]" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
