// ─────────────────────────────────────────────────────────────────────────────
// src/app/roles/components/PermissionsMatrixTab.tsx
//
// Phase 26C — admin-only permissions matrix editor.
//
// What it renders
// ---------------
//   1. Five summary cards (roles total, permissions total, sensitive
//      perms, unused perms, roles with admin perms).
//   2. Permission-gaps panel — four findings in one card:
//        • catalog perms not granted to any role
//        • DB perms not present in the catalog
//        • sensitive perms granted to non-r1 roles
//        • roles with zero permissions
//   3. Filter strip — Arabic / key search, group filter, sensitive
//      only, enabled only, missing-from-all-roles only.
//   4. The matrix itself — one column per role, one row per
//      permission, grouped by Arabic section. Click a cell to flip
//      it in the local draft (never writes immediately).
//   5. Action bar — "حفظ التغييرات" / "تجاهل التغييرات" with a per-
//      role diff modal. Save runs UPDATE on changed roles only and
//      writes a `role.permissions_changed` row to
//      `turath_masr_staff_audit_logs`.
//
// Safety rails
// ------------
//   • The component never deletes permissions outside the catalog.
//     "Save" computes the next permission set as `(unknown legacy
//     perms preserved) ∪ (catalog perms checked in the draft)`,
//     so a permission the catalog doesn't mention is never
//     accidentally dropped.
//   • SENSITIVE_PERMISSIONS toggles trigger an extra confirmation
//     step in the diff modal.
//   • Last-admin guard: refuses to remove `manage_permissions` from
//     the very last active admin (`profiles.account_status='active'`
//     and `role_id='r1'`) holding that permission. The guard is
//     consulted client-side, server RLS is the final gate.
//   • Delegate guard: blocks granting any sensitive permission to
//     r4 (mندوب شحن) unless the operator types a literal Arabic
//     confirmation phrase.
//   • Best-effort audit: a failed audit insert never blocks the
//     role update; the UI surfaces an Arabic warning toast.
// ─────────────────────────────────────────────────────────────────────────────
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  Search,
  Save,
  X,
  Check,
  Filter,
  Eye,
  EyeOff,
  Layers,
  ShieldAlert,
  Sparkles,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  PERMISSION_CATALOG,
  PERMISSION_GROUP_LABEL_AR,
  type PermissionGroup,
  type PermissionCatalogEntry,
} from '@/lib/permissions/permissions';
import { writeStaffAuditLog } from '@/lib/security/staffAudit';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Permission keys we treat as sensitive — toggling any of these in
 * either direction requires confirmation in the diff modal, and
 * granting them to r4 (delegate) is blocked unless the operator
 * types the override phrase below.
 */
const SENSITIVE_PERMISSIONS: ReadonlySet<string> = new Set([
  'manage_roles',
  'manage_permissions',
  'manage_staff',
  'manage_users',
  'view_security_audit',
  'manage_device_access',
  'block_devices',
  'manage_settings',
  'system_settings',
  'approve_returns_exchanges',
  'approve_delegate_expenses',
  'export_audit_logs',
  'view_login_sessions',
  'view_staff_activity',
]);

/** Permission that locks the editor for the last active admin. */
const LAST_ADMIN_LOCK_PERMISSION = 'manage_permissions';

/** Delegate role id — blocked from receiving sensitive permissions. */
const DELEGATE_ROLE_ID = 'r4';

/** Override phrase required to grant sensitive perms to the delegate role. */
const DELEGATE_OVERRIDE_PHRASE = 'موافق';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface RoleRow {
  id: string;
  name: string;
  permissions: string[] | null;
}

interface ProfileRow {
  id: string;
  email: string | null;
  full_name: string | null;
  role_id: string | null;
  account_status: string | null;
}

interface DraftDelta {
  added: string[];
  removed: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function PermissionsMatrixTab() {
  const { user, currentRoleId, profileFullName } = useAuth();

  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Local draft. Keyed by roleId → Set of permission keys checked.
  // Initialised from the DB rows on first load and after each save.
  const [draft, setDraft] = useState<Record<string, Set<string>>>({});
  const [saving, setSaving] = useState(false);
  const [diffModal, setDiffModal] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState<'all' | PermissionGroup>('all');
  const [sensitiveOnly, setSensitiveOnly] = useState(false);
  const [grantedOnly, setGrantedOnly] = useState(false);
  const [unusedOnly, setUnusedOnly] = useState(false);

  // ─── Load ───
  const load = async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const [{ data: rolesData }, { data: profilesData }] = await Promise.all([
        supabase.from('turath_roles').select('id, name, permissions').order('id'),
        supabase
          .from('profiles')
          .select('id, email, full_name, role_id, account_status')
          .order('created_at', { ascending: true }),
      ]);
      const rs = (rolesData as RoleRow[]) ?? [];
      setRoles(rs);
      setProfiles((profilesData as ProfileRow[]) ?? []);
      // Seed the draft from the DB.
      const seed: Record<string, Set<string>> = {};
      for (const r of rs) {
        seed[r.id] = new Set(r.permissions ?? []);
      }
      setDraft(seed);
    } catch (err) {
      console.error('[PermissionsMatrixTab] load failed:', err);
      toast.error('تعذر تحميل الأدوار والصلاحيات.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Derived state ───

  const catalogKeys = useMemo(() => new Set(PERMISSION_CATALOG.map((p) => p.key)), []);

  /** Which permissions are present in the DB rows but missing from the catalog. */
  const legacyPermissions = useMemo(() => {
    const out = new Set<string>();
    for (const r of roles) {
      for (const p of r.permissions ?? []) {
        if (!catalogKeys.has(p)) out.add(p);
      }
    }
    return Array.from(out).sort();
  }, [roles, catalogKeys]);

  /** Set of permission keys currently granted to at least one role (in the DRAFT). */
  const draftGrantedSet = useMemo(() => {
    const s = new Set<string>();
    for (const set of Object.values(draft)) {
      for (const k of set) s.add(k);
    }
    return s;
  }, [draft]);

  /** Active r1 admins who currently hold the lock permission in the draft. */
  const activeAdminsHoldingLock = useMemo(() => {
    const adminIds = profiles
      .filter((p) => p.role_id === 'r1' && (p.account_status ?? 'active') === 'active')
      .map((p) => p.id);
    // We only know about role-level permissions here, not custom
    // per-user permissions. A profile with role r1 inherits r1's
    // permissions. So count = number of active r1 admins IF r1 still
    // holds the lock perm in the draft.
    const r1Has = draft['r1']?.has(LAST_ADMIN_LOCK_PERMISSION) ?? false;
    return r1Has ? adminIds.length : 0;
  }, [profiles, draft]);

  /** Per-role diff between DB and draft. */
  const diffs = useMemo<Record<string, DraftDelta>>(() => {
    const out: Record<string, DraftDelta> = {};
    for (const r of roles) {
      const current = new Set(r.permissions ?? []);
      const next = draft[r.id] ?? new Set<string>();
      const added: string[] = [];
      const removed: string[] = [];
      for (const k of next) if (!current.has(k)) added.push(k);
      for (const k of current) if (!next.has(k)) removed.push(k);
      added.sort();
      removed.sort();
      if (added.length > 0 || removed.length > 0) {
        out[r.id] = { added, removed };
      }
    }
    return out;
  }, [roles, draft]);

  const hasUnsavedChanges = Object.keys(diffs).length > 0;

  // ─── Filtering ───

  const filteredCatalog = useMemo(() => {
    const q = search.trim().toLowerCase();
    return PERMISSION_CATALOG.filter((p) => {
      if (groupFilter !== 'all' && p.group !== groupFilter) return false;
      if (sensitiveOnly && !SENSITIVE_PERMISSIONS.has(p.key)) return false;
      const granted = draftGrantedSet.has(p.key);
      if (grantedOnly && !granted) return false;
      if (unusedOnly && granted) return false;
      if (!q) return true;
      const hay = `${p.label} ${p.key} ${PERMISSION_GROUP_LABEL_AR[p.group]}`.toLowerCase();
      return hay.includes(q);
    });
  }, [search, groupFilter, sensitiveOnly, grantedOnly, unusedOnly, draftGrantedSet]);

  const groupedFiltered = useMemo(() => {
    // Preserve catalog ordering inside groups.
    const map = new Map<PermissionGroup, PermissionCatalogEntry[]>();
    for (const p of filteredCatalog) {
      const bucket = map.get(p.group) ?? [];
      bucket.push(p);
      map.set(p.group, bucket);
    }
    return Array.from(map.entries());
  }, [filteredCatalog]);

  // ─── Summary cards ───
  const summary = useMemo(() => {
    const totalRoles = roles.length;
    const totalPermsInCatalog = PERMISSION_CATALOG.length;
    const sensitiveCount = PERMISSION_CATALOG.filter((p) =>
      SENSITIVE_PERMISSIONS.has(p.key)
    ).length;
    const unusedCount = PERMISSION_CATALOG.filter((p) => !draftGrantedSet.has(p.key)).length;
    const rolesWithSensitive = roles.filter((r) => {
      const set = draft[r.id] ?? new Set<string>();
      for (const k of set) {
        if (SENSITIVE_PERMISSIONS.has(k)) return true;
      }
      return false;
    }).length;
    return {
      totalRoles,
      totalPermsInCatalog,
      sensitiveCount,
      unusedCount,
      rolesWithSensitive,
    };
  }, [roles, draft, draftGrantedSet]);

  // ─── Gaps panel ───
  const gaps = useMemo(() => {
    const catalogNotGranted = PERMISSION_CATALOG.filter((p) => !draftGrantedSet.has(p.key)).map(
      (p) => p.key
    );
    const sensitiveOnNonAdmin: { role: RoleRow; perms: string[] }[] = [];
    for (const r of roles) {
      if (r.id === 'r1') continue;
      const set = draft[r.id] ?? new Set<string>();
      const perms: string[] = [];
      for (const k of set) {
        if (SENSITIVE_PERMISSIONS.has(k)) perms.push(k);
      }
      if (perms.length > 0) {
        sensitiveOnNonAdmin.push({ role: r, perms: perms.sort() });
      }
    }
    const zeroPermRoles = roles.filter((r) => (draft[r.id]?.size ?? 0) === 0);
    return {
      catalogNotGranted,
      legacyInDb: legacyPermissions,
      sensitiveOnNonAdmin,
      zeroPermRoles,
    };
  }, [roles, draft, draftGrantedSet, legacyPermissions]);

  // ─── Mutations ───

  const togglePermission = (roleId: string, permKey: string) => {
    setDraft((prev) => {
      const next = { ...prev };
      const set = new Set(next[roleId] ?? []);
      if (set.has(permKey)) {
        set.delete(permKey);
      } else {
        set.add(permKey);
      }
      next[roleId] = set;
      return next;
    });
  };

  const resetDraft = () => {
    const seed: Record<string, Set<string>> = {};
    for (const r of roles) {
      seed[r.id] = new Set(r.permissions ?? []);
    }
    setDraft(seed);
  };

  /**
   * Final pre-save guard. Returns an Arabic error message when the
   * draft would lock out the last admin, or null when it's safe.
   */
  const preflightLockGuard = (): string | null => {
    // Phase 26C — refuse to remove `manage_permissions` from r1 when
    // r1 currently has 1+ active admin profile.
    const r1Now = draft['r1'] ?? new Set<string>();
    if (!r1Now.has(LAST_ADMIN_LOCK_PERMISSION) && activeAdminsHoldingLock === 0) {
      // We're trying to remove it. Check before-state — if r1 had it.
      const r1Before = new Set(roles.find((r) => r.id === 'r1')?.permissions ?? []);
      if (r1Before.has(LAST_ADMIN_LOCK_PERMISSION)) {
        const activeR1Count = profiles.filter(
          (p) => p.role_id === 'r1' && (p.account_status ?? 'active') === 'active'
        ).length;
        if (activeR1Count > 0) {
          return `لا يمكن إزالة "${LAST_ADMIN_LOCK_PERMISSION}" من دور المدير: ${activeR1Count} حساب مدير نشط يعتمد عليه.`;
        }
      }
    }
    return null;
  };

  const handleSave = async () => {
    if (!hasUnsavedChanges) return;
    const lockMsg = preflightLockGuard();
    if (lockMsg) {
      toast.error(lockMsg);
      return;
    }
    // Delegate sensitivity guard
    const delegateDiff = diffs[DELEGATE_ROLE_ID];
    if (delegateDiff) {
      const sensitiveAdds = delegateDiff.added.filter((k) => SENSITIVE_PERMISSIONS.has(k));
      if (sensitiveAdds.length > 0) {
        const phrase = window.prompt(
          `تنبيه: ستمنح دور المندوب الصلاحيات الحساسة التالية:\n${sensitiveAdds.join(
            ', '
          )}\nاكتب "${DELEGATE_OVERRIDE_PHRASE}" للمتابعة.`
        );
        if (phrase !== DELEGATE_OVERRIDE_PHRASE) {
          toast.error('تم إلغاء الحفظ.');
          return;
        }
      }
    }
    setDiffModal(true);
  };

  const handleConfirmSave = async () => {
    setSaving(true);
    let auditFailedCount = 0;
    try {
      const supabase = createClient();
      const actorName = (profileFullName ?? '').trim() || user?.email || 'مستخدم غير معروف';
      // Process changed roles only
      for (const r of roles) {
        const delta = diffs[r.id];
        if (!delta) continue;
        // Preserve legacy permissions not in catalog UNLESS the
        // operator explicitly toggled them off via the draft.
        const draftSet = draft[r.id] ?? new Set<string>();
        const currentSet = new Set(r.permissions ?? []);
        const nextSet = new Set<string>();
        // Add every catalog perm still checked in the draft.
        for (const p of PERMISSION_CATALOG) {
          if (draftSet.has(p.key)) nextSet.add(p.key);
        }
        // Preserve legacy (non-catalog) perms — they are not
        // visible in the matrix so the operator never had a chance
        // to toggle them. Save preserves whatever was already there.
        for (const k of currentSet) {
          if (!catalogKeys.has(k)) nextSet.add(k);
        }
        const sortedPerms = Array.from(nextSet).sort();
        const { error: updateErr } = await supabase
          .from('turath_roles')
          .update({ permissions: sortedPerms, updated_at: new Date().toISOString() })
          .eq('id', r.id);
        if (updateErr) {
          throw new Error(`فشل تحديث الدور "${r.name}": ${updateErr.message}`);
        }
        // Best-effort audit. Failures DON'T undo the save.
        const auditId = await writeStaffAuditLog(supabase, {
          action: 'role.permissions_changed',
          actorId: user?.id ?? null,
          actorName,
          actorRoleId: currentRoleId,
          entity: { type: 'role', id: r.id, label: r.name },
          description: `أُضيف ${delta.added.length}، أُزيل ${delta.removed.length}`,
          metadata: {
            added: delta.added,
            removed: delta.removed,
            before_count: (r.permissions ?? []).length,
            after_count: sortedPerms.length,
            sensitive_added: delta.added.filter((k) => SENSITIVE_PERMISSIONS.has(k)),
            sensitive_removed: delta.removed.filter((k) => SENSITIVE_PERMISSIONS.has(k)),
          },
        });
        if (!auditId) auditFailedCount += 1;
      }
      if (auditFailedCount > 0) {
        toast.warning('تم حفظ الصلاحيات لكن فشل تسجيل التدقيق لبعض الأدوار.');
      } else {
        toast.success('تم حفظ الصلاحيات وتسجيل التدقيق بنجاح.');
      }
      setDiffModal(false);
      await load();
    } catch (err) {
      console.error('[PermissionsMatrixTab] save failed:', err);
      toast.error(err instanceof Error ? err.message : 'تعذر حفظ التعديلات.');
    } finally {
      setSaving(false);
    }
  };

  // ─── Render ───

  if (loading) {
    return (
      <div className="p-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
        جارٍ تحميل مصفوفة الصلاحيات...
      </div>
    );
  }

  return (
    <div className="space-y-4" dir="rtl">
      {/* Summary cards */}
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
        {[
          {
            label: 'إجمالي الأدوار',
            value: summary.totalRoles,
            icon: <Layers size={14} />,
            tone: 'bg-slate-50 text-slate-700',
          },
          {
            label: 'إجمالي الصلاحيات',
            value: summary.totalPermsInCatalog,
            icon: <ShieldCheck size={14} />,
            tone: 'bg-indigo-50 text-indigo-700',
          },
          {
            label: 'صلاحيات حساسة',
            value: summary.sensitiveCount,
            icon: <ShieldAlert size={14} />,
            tone: 'bg-rose-50 text-rose-700',
          },
          {
            label: 'صلاحيات غير مستخدمة',
            value: summary.unusedCount,
            icon: <Sparkles size={14} />,
            tone: 'bg-amber-50 text-amber-700',
          },
          {
            label: 'أدوار بصلاحيات حساسة',
            value: summary.rolesWithSensitive,
            icon: <Users size={14} />,
            tone: 'bg-emerald-50 text-emerald-700',
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

      {/* Permission-gaps panel */}
      <section className="card-section p-4">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle size={15} className="text-amber-700" />
          <h3 className="text-sm font-bold">تقرير الفجوات في الصلاحيات</h3>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 text-xs">
          <GapBlock
            label="صلاحيات في الكتالوج بدون أي دور"
            items={gaps.catalogNotGranted}
            emptyMsg="كل صلاحيات الكتالوج ممنوحة لدور واحد على الأقل."
            tone="amber"
          />
          <GapBlock
            label="صلاحيات قديمة في قاعدة البيانات وليست في الكتالوج"
            items={gaps.legacyInDb}
            emptyMsg="لا توجد صلاحيات قديمة معلّقة."
            tone="slate"
          />
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-rose-900">
            <p className="font-bold mb-1">صلاحيات حساسة ممنوحة لأدوار غير المدير</p>
            {gaps.sensitiveOnNonAdmin.length === 0 ? (
              <p className="text-[11px] opacity-80">لا توجد صلاحيات حساسة على أدوار غير المدير.</p>
            ) : (
              <ul className="space-y-1">
                {gaps.sensitiveOnNonAdmin.map((s) => (
                  <li key={s.role.id} className="leading-tight">
                    <span className="font-bold">{s.role.name}:</span>{' '}
                    <code className="text-[10px]">{s.perms.join(', ')}</code>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-slate-900">
            <p className="font-bold mb-1">أدوار بلا أي صلاحيات</p>
            {gaps.zeroPermRoles.length === 0 ? (
              <p className="text-[11px] opacity-80">كل دور لديه صلاحيات.</p>
            ) : (
              <ul className="space-y-1">
                {gaps.zeroPermRoles.map((r) => (
                  <li key={r.id} className="leading-tight">
                    <span className="font-bold">{r.name}</span>{' '}
                    <code className="text-[10px] opacity-70">({r.id})</code>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* Filter strip */}
      <section className="card-section p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search
            size={14}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث بالاسم أو المفتاح..."
            className="input-field w-full text-sm pr-8"
          />
        </div>
        <select
          value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value as 'all' | PermissionGroup)}
          className="input-field text-sm w-auto"
        >
          <option value="all">كل المجموعات</option>
          {(Object.keys(PERMISSION_GROUP_LABEL_AR) as PermissionGroup[]).map((g) => (
            <option key={g} value={g}>
              {PERMISSION_GROUP_LABEL_AR[g]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={sensitiveOnly}
            onChange={(e) => setSensitiveOnly(e.target.checked)}
          />
          <span className="text-rose-700 font-bold">حساسة فقط</span>
        </label>
        <label className="flex items-center gap-1 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={grantedOnly}
            onChange={(e) => setGrantedOnly(e.target.checked)}
          />
          ممنوحة فقط
        </label>
        <label className="flex items-center gap-1 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={unusedOnly}
            onChange={(e) => setUnusedOnly(e.target.checked)}
          />
          غير ممنوحة فقط
        </label>
        <Filter size={14} className="text-[hsl(var(--muted-foreground))]" />
      </section>

      {/* Dirty banner */}
      {hasUnsavedChanges && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 flex items-center justify-between gap-3">
          <p className="text-sm text-amber-900 flex items-center gap-2">
            <AlertTriangle size={14} /> يوجد تغييرات غير محفوظة على{' '}
            <span className="font-bold">{Object.keys(diffs).length}</span> دور.
          </p>
          <div className="flex gap-2">
            <button
              onClick={resetDraft}
              disabled={saving}
              className="btn-secondary text-xs py-1 px-3 flex items-center gap-1"
            >
              <X size={12} /> تجاهل التغييرات
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-primary text-xs py-1 px-3 flex items-center gap-1"
            >
              <Save size={12} /> حفظ التغييرات
            </button>
          </div>
        </div>
      )}

      {/* Matrix */}
      <section className="card-section overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[hsl(var(--muted))]/50">
              <tr>
                <th className="text-right px-3 py-2 font-semibold sticky right-0 bg-[hsl(var(--muted))]/50 min-w-[280px]">
                  الصلاحية
                </th>
                {roles.map((r) => (
                  <th key={r.id} className="text-center px-3 py-2 font-semibold min-w-[100px]">
                    <div className="leading-tight">
                      <p>{r.name}</p>
                      <p className="text-[9px] text-[hsl(var(--muted-foreground))] font-mono">
                        {r.id} · {draft[r.id]?.size ?? 0} صلاحية
                      </p>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groupedFiltered.length === 0 ? (
                <tr>
                  <td
                    colSpan={1 + roles.length}
                    className="px-3 py-8 text-center text-[hsl(var(--muted-foreground))]"
                  >
                    لا توجد صلاحيات مطابقة لهذه الفلاتر.
                  </td>
                </tr>
              ) : (
                groupedFiltered.map(([groupKey, items]) => (
                  <React.Fragment key={groupKey}>
                    <tr className="bg-[hsl(var(--muted))]/30">
                      <td
                        colSpan={1 + roles.length}
                        className="px-3 py-1.5 text-[11px] font-bold text-[hsl(var(--foreground))]"
                      >
                        {PERMISSION_GROUP_LABEL_AR[groupKey]}
                      </td>
                    </tr>
                    {items.map((p) => {
                      const sensitive = SENSITIVE_PERMISSIONS.has(p.key);
                      return (
                        <tr
                          key={p.key}
                          className="border-t border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/15"
                        >
                          <td className="px-3 py-1.5 sticky right-0 bg-white">
                            <div className="flex items-center gap-2">
                              <span className="text-sm">{p.label}</span>
                              {sensitive && (
                                <span className="text-[9px] bg-rose-100 text-rose-800 border border-rose-200 px-1.5 py-0.5 rounded-full font-bold">
                                  حساسة
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-[hsl(var(--muted-foreground))] font-mono mt-0.5">
                              {p.key}
                            </p>
                          </td>
                          {roles.map((r) => {
                            const checked = draft[r.id]?.has(p.key) ?? false;
                            const wasChecked = new Set(r.permissions ?? []).has(p.key) ?? false;
                            const changed = checked !== wasChecked;
                            return (
                              <td
                                key={`${r.id}-${p.key}`}
                                className={`px-3 py-1.5 text-center ${
                                  changed ? 'bg-amber-50/60' : ''
                                }`}
                              >
                                <label className="inline-flex items-center justify-center cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => togglePermission(r.id, p.key)}
                                    className="w-4 h-4 rounded"
                                  />
                                </label>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="px-3 py-2 text-[10px] text-[hsl(var(--muted-foreground))] border-t border-[hsl(var(--border))]">
          صلاحيات قديمة خارج الكتالوج ({legacyPermissions.length}) محفوظة دون عرض هنا وتنتقل
          تلقائيًا عند الحفظ.
        </p>
      </section>

      {/* Diff modal */}
      {diffModal && (
        <DiffModal
          diffs={diffs}
          roles={roles}
          onCancel={() => setDiffModal(false)}
          onConfirm={handleConfirmSave}
          saving={saving}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────────────────────

function GapBlock({
  label,
  items,
  emptyMsg,
  tone,
}: {
  label: string;
  items: string[];
  emptyMsg: string;
  tone: 'amber' | 'slate';
}) {
  const colours =
    tone === 'amber'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : 'border-slate-200 bg-slate-50 text-slate-900';
  return (
    <div className={`rounded-xl border p-3 ${colours}`}>
      <p className="font-bold mb-1">{label}</p>
      {items.length === 0 ? (
        <p className="text-[11px] opacity-80">{emptyMsg}</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {items.map((k) => (
            <code key={k} className="text-[10px] bg-white/60 px-1.5 py-0.5 rounded font-mono">
              {k}
            </code>
          ))}
        </div>
      )}
    </div>
  );
}

function DiffModal({
  diffs,
  roles,
  onCancel,
  onConfirm,
  saving,
}: {
  diffs: Record<string, DraftDelta>;
  roles: RoleRow[];
  onCancel: () => void;
  onConfirm: () => void;
  saving: boolean;
}) {
  const changedRoles = roles.filter((r) => diffs[r.id]);
  // Detect any sensitive changes.
  const anySensitive = changedRoles.some((r) => {
    const d = diffs[r.id]!;
    return (
      d.added.some((k) => SENSITIVE_PERMISSIONS.has(k)) ||
      d.removed.some((k) => SENSITIVE_PERMISSIONS.has(k))
    );
  });
  const [confirmedSensitive, setConfirmedSensitive] = useState(false);
  return (
    <div className="fixed inset-0 z-[200] bg-black/40 flex items-center justify-center p-3">
      <div
        className="bg-white w-full max-w-2xl max-h-[92vh] flex flex-col rounded-2xl shadow-2xl"
        dir="rtl"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-[hsl(var(--primary))]" />
            <div>
              <h3 className="text-sm font-bold">تأكيد حفظ التعديلات</h3>
              <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                {changedRoles.length} دور سيتم تحديثها
              </p>
            </div>
          </div>
          <button onClick={onCancel} className="text-[hsl(var(--muted-foreground))]">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {changedRoles.map((r) => {
            const d = diffs[r.id]!;
            return (
              <div key={r.id} className="rounded-xl border border-[hsl(var(--border))] p-3">
                <p className="text-sm font-bold mb-2">
                  {r.name}{' '}
                  <code className="text-[10px] text-[hsl(var(--muted-foreground))] font-mono">
                    ({r.id})
                  </code>
                </p>
                {d.added.length > 0 && (
                  <div className="mb-2">
                    <p className="text-[11px] text-emerald-700 font-bold mb-1 flex items-center gap-1">
                      <Eye size={11} /> صلاحيات مضافة ({d.added.length})
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {d.added.map((k) => (
                        <code
                          key={k}
                          className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                            SENSITIVE_PERMISSIONS.has(k)
                              ? 'bg-rose-100 text-rose-800 font-bold border border-rose-200'
                              : 'bg-emerald-50 text-emerald-800'
                          }`}
                        >
                          {k}
                          {SENSITIVE_PERMISSIONS.has(k) && ' ⚠'}
                        </code>
                      ))}
                    </div>
                  </div>
                )}
                {d.removed.length > 0 && (
                  <div>
                    <p className="text-[11px] text-rose-700 font-bold mb-1 flex items-center gap-1">
                      <EyeOff size={11} /> صلاحيات مزالة ({d.removed.length})
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {d.removed.map((k) => (
                        <code
                          key={k}
                          className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                            SENSITIVE_PERMISSIONS.has(k)
                              ? 'bg-rose-100 text-rose-800 font-bold border border-rose-200'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {k}
                          {SENSITIVE_PERMISSIONS.has(k) && ' ⚠'}
                        </code>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {anySensitive && (
            <label className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmedSensitive}
                onChange={(e) => setConfirmedSensitive(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-xs text-rose-900">
                هذا التعديل يشمل صلاحيات حساسة (محددة بـ ⚠). أؤكد قراءة التغييرات وأرغب في المتابعة.
              </span>
            </label>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[hsl(var(--border))]">
          <button
            onClick={onCancel}
            disabled={saving}
            className="btn-secondary text-sm py-1.5 px-4"
          >
            إلغاء
          </button>
          <button
            onClick={onConfirm}
            disabled={saving || (anySensitive && !confirmedSensitive)}
            className="btn-primary text-sm py-1.5 px-4 flex items-center gap-1 disabled:opacity-50"
          >
            <Check size={14} />
            {saving ? 'جارٍ الحفظ...' : 'تأكيد وحفظ'}
          </button>
        </div>
      </div>
    </div>
  );
}
