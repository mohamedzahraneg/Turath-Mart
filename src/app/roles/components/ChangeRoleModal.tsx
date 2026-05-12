// ─────────────────────────────────────────────────────────────────────────────
// src/app/roles/components/ChangeRoleModal.tsx
//
// Phase 26G — shared modal that owns the "تعديل الدور" UI surfaced
// from both the employees tab (inline JSX in /roles/page.tsx) and
// the users tab (UsersTab.tsx — row action + drawer button).
//
// What lives here
// ---------------
//   • the role <select> populated from a live `turath_roles` snapshot
//     passed in by the parent (single source of truth)
//   • permission count preview for the selected role
//   • inline warning banners:
//       - self-change (admin demoting themselves)
//       - last active admin (block save)
//       - delegate downgrade (informational)
//       - admin upgrade (informational)
//   • confirm button gated on (a) a real change being requested AND
//     (b) no blocking guard is tripped
//
// What is NOT here
// ----------------
//   • the supabase write. The parent owns `onSave(newRoleId)` so the
//     same modal works equally well over UsersTab's `await load()`
//     refresh path and the page-level inline employees tab.
//   • audit logging. The parent's onSave writes
//     `staff.role_changed` after the supabase update succeeds.
//   • session refresh for self-changes. The parent decides whether
//     to window.location.reload() (or surface a banner).
// ─────────────────────────────────────────────────────────────────────────────
'use client';

import React, { useMemo, useState } from 'react';
import { AlertTriangle, ShieldCheck, X } from 'lucide-react';

export interface ChangeRoleModalRole {
  id: string;
  name: string;
  /** Number of permission strings on the role. Used for the preview
   *  "X صلاحية" pill so the operator can see how a switch impacts
   *  the target user's effective capabilities. */
  permCount: number;
}

export interface ChangeRoleModalTarget {
  id: string;
  email: string | null;
  name: string;
  currentRoleId: string | null;
  currentRoleName: string | null;
}

export interface ChangeRoleModalProps {
  target: ChangeRoleModalTarget;
  roles: ChangeRoleModalRole[];
  /** Caller-supplied — true when target.id === current logged-in user.
   *  Triggers the self-change confirmation banner. */
  isSelf: boolean;
  /** Caller-supplied — number of currently active admin profiles in
   *  the system. Used to block save when the target IS the last
   *  active admin and the new role is not r1. */
  activeAdminCount: number;
  /** Caller-supplied flag indicating whether the target's current
   *  account_status is 'active'. Combined with role_id='r1' to
   *  determine if this profile counts toward the active-admin
   *  total. Passed in (instead of derived) so the modal stays
   *  presentation-only. */
  targetIsActiveAdmin: boolean;
  /** Whether the modal is currently mid-save. Disables the buttons
   *  + spinner-state on the confirm button. */
  busy: boolean;
  onClose: () => void;
  /** Async — resolves when the parent has finished the DB update
   *  and any post-save side effects (audit, reload, toast). */
  onSave: (newRoleId: string) => Promise<void>;
}

const ADMIN_ROLE_ID = 'r1';
const DELEGATE_ROLE_ID = 'r4';

export default function ChangeRoleModal({
  target,
  roles,
  isSelf,
  activeAdminCount,
  targetIsActiveAdmin,
  busy,
  onClose,
  onSave,
}: ChangeRoleModalProps) {
  const [selectedRoleId, setSelectedRoleId] = useState<string>(target.currentRoleId ?? '');
  const [confirmed, setConfirmed] = useState(false);

  const selectedRole = useMemo(
    () => roles.find((r) => r.id === selectedRoleId) ?? null,
    [roles, selectedRoleId]
  );

  const currentRole = useMemo(
    () => roles.find((r) => r.id === target.currentRoleId) ?? null,
    [roles, target.currentRoleId]
  );

  // Phase 26G — display sanity: when the cached `role_name` on the
  // profiles row doesn't match the live turath_roles[role_id].name,
  // surface that to the operator so they know the save will repair
  // it as a side effect.
  const cachedNameStale =
    !!target.currentRoleId &&
    !!currentRole &&
    !!target.currentRoleName &&
    target.currentRoleName.trim() !== currentRole.name;

  const isChange = !!selectedRoleId && selectedRoleId !== target.currentRoleId;

  // Last-active-admin block. Triggers when:
  //   (a) the target is currently the active admin we're touching
  //   (b) `activeAdminCount` says they are also the ONLY active admin
  //   (c) the proposed role is not r1
  const wouldOrphanAdmins =
    targetIsActiveAdmin &&
    target.currentRoleId === ADMIN_ROLE_ID &&
    activeAdminCount <= 1 &&
    selectedRoleId !== ADMIN_ROLE_ID;

  // Self-demote: signed-in operator is downgrading away from admin.
  // Strong confirmation (checkbox), but allowed if there are other
  // active admins — to avoid locking ANYONE out we still defer to
  // `wouldOrphanAdmins` for the hard block.
  const isSelfDemoteFromAdmin =
    isSelf &&
    target.currentRoleId === ADMIN_ROLE_ID &&
    selectedRoleId !== ADMIN_ROLE_ID &&
    !wouldOrphanAdmins;

  // Informational notices.
  const isPromoteToAdmin =
    selectedRoleId === ADMIN_ROLE_ID && target.currentRoleId !== ADMIN_ROLE_ID;
  const isDowngradeToDelegate =
    selectedRoleId === DELEGATE_ROLE_ID && target.currentRoleId !== DELEGATE_ROLE_ID;

  const canSave =
    isChange &&
    !busy &&
    !wouldOrphanAdmins &&
    (!isSelfDemoteFromAdmin || confirmed) &&
    (!isPromoteToAdmin || confirmed);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      dir="rtl"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative bg-white rounded-3xl shadow-modal w-full max-w-lg max-h-[90vh] flex flex-col fade-in">
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between p-5 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-[hsl(var(--primary))]" />
            <div>
              <h3 className="text-base font-bold text-[hsl(var(--foreground))]">تعديل الدور</h3>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                {target.name}
                {target.email ? ` — ${target.email}` : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-[hsl(var(--muted))]"
            aria-label="إغلاق"
            disabled={busy}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 scrollbar-thin">
          {/* Current role */}
          <section className="rounded-2xl border border-[hsl(var(--border))] p-3 space-y-1">
            <p className="text-xs text-[hsl(var(--muted-foreground))]">الدور الحالي</p>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-[hsl(var(--foreground))]">
                {currentRole?.name ?? target.currentRoleName ?? target.currentRoleId ?? '—'}
              </span>
              {target.currentRoleId && (
                <span className="text-[10px] font-mono bg-[hsl(var(--muted))] px-1.5 py-0.5 rounded-md">
                  {target.currentRoleId}
                </span>
              )}
              {currentRole && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-50 text-slate-700 border border-slate-200">
                  {currentRole.permCount} صلاحية
                </span>
              )}
            </div>
            {/* Stale role_name warning */}
            {cachedNameStale && (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 flex items-start gap-1.5">
                <AlertTriangle size={12} className="text-amber-700 mt-0.5 flex-shrink-0" />
                <p className="text-[11px] text-amber-900">
                  اسم الدور المسجل في سجل المستخدم (
                  <span className="font-mono">{target.currentRoleName || '—'}</span>) لا يطابق الاسم
                  الحالي (<span className="font-bold">{currentRole?.name}</span>). سيتم تصحيحه عند
                  الحفظ.
                </p>
              </div>
            )}
            {/* Unknown role_id warning */}
            {target.currentRoleId && !currentRole && (
              <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 flex items-start gap-1.5">
                <AlertTriangle size={12} className="text-rose-700 mt-0.5 flex-shrink-0" />
                <p className="text-[11px] text-rose-900">
                  معرّف الدور (<span className="font-mono">{target.currentRoleId}</span>) غير موجود
                  في جدول الأدوار. اختر دورًا صالحًا للحفظ.
                </p>
              </div>
            )}
          </section>

          {/* New role select */}
          <section className="space-y-2">
            <label
              htmlFor="change-role-select"
              className="text-xs font-bold text-[hsl(var(--foreground))]"
            >
              الدور الجديد
            </label>
            <select
              id="change-role-select"
              value={selectedRoleId}
              onChange={(e) => {
                setSelectedRoleId(e.target.value);
                setConfirmed(false);
              }}
              disabled={busy}
              className="w-full px-3 py-2.5 border border-[hsl(var(--border))] rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
            >
              <option value="" disabled>
                اختر دورًا...
              </option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.id}) — {r.permCount} صلاحية
                </option>
              ))}
            </select>
            {selectedRole && (
              <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                هذا الدور يمنح
                <span className="font-bold mx-1">{selectedRole.permCount} صلاحية</span>
                من أصل المتاحة في النظام.
              </p>
            )}
          </section>

          {/* Guards & notices */}
          {wouldOrphanAdmins && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 flex items-start gap-2">
              <AlertTriangle size={16} className="text-rose-700 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-rose-900">
                <p className="font-bold mb-0.5">لا يمكن إكمال هذا التغيير.</p>
                <p>
                  هذا الحساب هو
                  <span className="font-bold mx-1">آخر مدير نشط</span>
                  في النظام. تغيير دوره سيؤدي إلى فقد كامل للوصول الإداري. عيّن مديرًا آخر أو فعّل
                  حساب مدير قبل المتابعة.
                </p>
              </div>
            </div>
          )}

          {isSelfDemoteFromAdmin && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} className="text-amber-700 mt-0.5 flex-shrink-0" />
                <div className="text-xs text-amber-900">
                  <p className="font-bold mb-0.5">تقوم بتغيير دورك أنت.</p>
                  <p>
                    بمجرد الحفظ ستفقد صلاحيات الإدارة الحالية وقد تخرج من بعض الصفحات. تأكد أن هناك
                    مديرًا نشطًا آخر قبل المتابعة.
                  </p>
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-amber-900 cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  disabled={busy}
                />
                أؤكد أنني أرغب في تخفيض صلاحياتي
              </label>
            </div>
          )}

          {!isSelfDemoteFromAdmin && isPromoteToAdmin && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} className="text-amber-700 mt-0.5 flex-shrink-0" />
                <div className="text-xs text-amber-900">
                  <p className="font-bold mb-0.5">ترقية إلى دور مدير النظام (r1).</p>
                  <p>
                    هذا الدور يمنح صلاحيات إدارية كاملة على النظام، بما في ذلك إدارة المستخدمين
                    والأمان. أكّد الترقية بوضوح.
                  </p>
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-amber-900 cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  disabled={busy}
                />
                أؤكد رفع الحساب إلى صلاحيات مدير
              </label>
            </div>
          )}

          {isDowngradeToDelegate && !wouldOrphanAdmins && (
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3 flex items-start gap-2">
              <AlertTriangle size={16} className="text-blue-700 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-blue-900">
                <p className="font-bold mb-0.5">تحويل الحساب إلى مندوب شحن (r4).</p>
                <p>
                  بعد الحفظ يصبح الوصول مقصورًا على شاشات المناديب. لا يتم تعديل بيانات السائق /
                  وسيلة المواصلات تلقائيًا — أكمل ذلك من تبويب المناديب إذا لزم.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 border-t border-[hsl(var(--border))] p-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 rounded-xl text-sm font-semibold border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-50"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={() => void onSave(selectedRoleId)}
            disabled={!canSave}
            className="px-5 py-2 rounded-xl text-sm font-bold bg-[hsl(var(--primary))] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? 'جارٍ الحفظ...' : 'حفظ التغيير'}
          </button>
        </div>
      </div>
    </div>
  );
}
