// ─────────────────────────────────────────────────────────────────────────────
// src/lib/security/staffAudit.ts
//
// Phase 26A — thin client-side writer for `turath_masr_staff_audit_logs`.
// Centralises the row shape + Arabic labels so every staff-management
// surface (roles page, device blocking, account disable, etc.) speaks
// the same vocabulary.
//
// What lives here
// ---------------
//   • `StaffAuditAction` — union of every action we currently emit.
//   • `STAFF_AUDIT_ACTION_LABEL_AR` — Arabic label per action for the
//     audit viewer.
//   • `writeStaffAuditLog()` — small wrapper around the Supabase
//     client. Best-effort: a failed write logs to `console.warn` and
//     does not throw. Callers should treat audit failure as non-fatal.
//
// What is NOT here
// ----------------
//   • No DB schema. The table lives in
//     `20260511070000_phase_26a_staff_security.sql`.
//   • No React. Pure TS; safe to call from API routes too.
//   • No IP / user_agent capture — those are filled in by the
//     calling surface (the API route reads them from headers).
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js';

export type StaffAuditAction =
  | 'staff.role_changed'
  | 'staff.account_disabled'
  | 'staff.account_suspended'
  | 'staff.account_reactivated'
  | 'staff.account_pending'
  | 'staff.created'
  | 'staff.deleted'
  | 'security.device_blocked'
  | 'security.device_unblocked'
  | 'security.device_renamed'
  | 'security.device_policy_changed'
  | 'security.login_succeeded'
  | 'security.login_blocked'
  | 'security.logout'
  | 'role.created'
  | 'role.updated'
  | 'role.deleted'
  | 'role.permissions_changed';

export const STAFF_AUDIT_ACTION_LABEL_AR: Record<StaffAuditAction, string> = {
  'staff.role_changed': 'تغيير الدور',
  'staff.account_disabled': 'تعطيل الحساب',
  'staff.account_suspended': 'إيقاف مؤقت للحساب',
  'staff.account_reactivated': 'إعادة تفعيل الحساب',
  'staff.account_pending': 'تعليق الحساب للمراجعة',
  'staff.created': 'إنشاء حساب جديد',
  'staff.deleted': 'حذف حساب',
  'security.device_blocked': 'حظر جهاز',
  'security.device_unblocked': 'إلغاء حظر جهاز',
  'security.device_renamed': 'تسمية جهاز',
  'security.device_policy_changed': 'تعديل سياسة الأجهزة',
  'security.login_succeeded': 'تسجيل دخول ناجح',
  'security.login_blocked': 'محاولة دخول محظورة',
  'security.logout': 'تسجيل خروج',
  'role.created': 'إنشاء دور',
  'role.updated': 'تعديل دور',
  'role.deleted': 'حذف دور',
  'role.permissions_changed': 'تعديل صلاحيات دور',
};

export interface StaffAuditEntity {
  /** `profile`, `device`, `role`, `policy`, etc. */
  type?: string;
  /** Stable identifier — UUID for profiles/devices, role id for roles. */
  id?: string;
  /** Human-readable label for the audit viewer (e.g. the staff name). */
  label?: string;
}

export interface StaffAuditInput {
  action: StaffAuditAction;
  description?: string | null;
  entity?: StaffAuditEntity;
  metadata?: Record<string, unknown>;
  /** Override actor (defaults to `auth.uid()` via Supabase). */
  actorId?: string | null;
  actorName?: string | null;
  actorRoleId?: string | null;
  /** Filled in server-side for API-route writes; pass null on the client. */
  ipAddress?: string | null;
  userAgent?: string | null;
  deviceFingerprint?: string | null;
}

/**
 * Best-effort insert. Returns the inserted row id on success, or
 * `null` on any failure path (including RLS rejection). Never throws.
 */
export async function writeStaffAuditLog(
  supabase: SupabaseClient,
  input: StaffAuditInput
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('turath_masr_staff_audit_logs')
      .insert({
        actor_id: input.actorId ?? null,
        actor_name: input.actorName ?? null,
        actor_role_id: input.actorRoleId ?? null,
        action: input.action,
        entity_type: input.entity?.type ?? null,
        entity_id: input.entity?.id ?? null,
        entity_label: input.entity?.label ?? null,
        description: input.description ?? null,
        metadata: input.metadata ?? {},
        ip_address: input.ipAddress ?? null,
        user_agent: input.userAgent ?? null,
        device_fingerprint: input.deviceFingerprint ?? null,
      })
      .select('id')
      .single();
    if (error) {
      console.warn('[staffAudit] insert failed:', error.message);
      return null;
    }
    return (data as { id?: string } | null)?.id ?? null;
  } catch (err) {
    console.warn('[staffAudit] insert exception:', err);
    return null;
  }
}
