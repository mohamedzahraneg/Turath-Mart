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
  // ─── Staff & role surface (Phase 26A + 26C) ───
  | 'staff.role_changed'
  | 'staff.account_disabled'
  | 'staff.account_suspended'
  | 'staff.account_reactivated'
  | 'staff.account_pending'
  | 'staff.created'
  | 'staff.deleted'
  | 'staff.profile_updated'
  | 'staff.email_change_requested'
  | 'staff.email_changed'
  | 'staff.email_change_failed'
  // ─── Phase 26H-2 — password rotation lifecycle ───
  | 'staff.password_change_required'
  | 'staff.password_change_required_completed'
  | 'staff.password_reset_sent'
  | 'staff.password_reset_failed'
  // ─── Security infrastructure (Phase 26A + 26B) ───
  | 'security.device_blocked'
  | 'security.device_unblocked'
  | 'security.device_renamed'
  | 'security.device_policy_changed'
  | 'security.login_succeeded'
  | 'security.login_blocked'
  | 'security.logout'
  | 'auth_orphan_profile_created'
  | 'auth_user_delete_requested'
  | 'auth_user_delete_blocked'
  | 'auth_user_deleted'
  | 'auth_user_delete_failed'
  | 'role.created'
  | 'role.updated'
  | 'role.deleted'
  | 'role.permissions_changed'
  // ─── Phase 26D-1 — orders ───
  | 'order.created'
  | 'order.updated'
  | 'order.status_changed'
  | 'order.delegate_assigned'
  | 'order.delivery_scheduled'
  | 'order.note_updated'
  // ─── Phase 26D-1 — returns / exchanges ───
  | 'adjustment.created'
  | 'adjustment.approved'
  | 'adjustment.rejected'
  | 'adjustment.completed'
  | 'adjustment.cancelled'
  | 'adjustment.child_order_created'
  // ─── Phase 26D-1 — customers / CRM ───
  | 'customer.created'
  | 'customer.updated'
  | 'customer.note_created'
  | 'customer.task_created'
  | 'customer.task_updated'
  | 'customer.task_status_changed'
  | 'customer.attachment_uploaded'
  | 'customer.complaint_created'
  | 'customer.complaint_updated'
  | 'customer.complaint_closed'
  | 'customer.complaint_reopened'
  | 'customer.complaint_assigned'
  // ─── Phase 26D-2 — delegate management ───
  | 'delegate.created'
  | 'delegate.updated'
  | 'delegate.disabled'
  | 'delegate.enabled'
  | 'delegate.reassigned'
  | 'delegate.change_request_created'
  | 'delegate.change_request_approved'
  | 'delegate.change_request_rejected'
  // ─── Phase 26D-2 — delegate finance ───
  | 'delegate.settlement_created'
  | 'delegate.settlement_updated'
  | 'delegate.settlement_voided'
  | 'delegate.custody_created'
  | 'delegate.custody_updated'
  | 'delegate.custody_returned'
  | 'delegate.custody_voided'
  | 'delegate.expense_created'
  | 'delegate.expense_updated'
  | 'delegate.expense_approved'
  | 'delegate.expense_rejected'
  | 'delegate.expense_voided';

export const STAFF_AUDIT_ACTION_LABEL_AR: Record<StaffAuditAction, string> = {
  'staff.role_changed': 'تغيير الدور',
  'staff.account_disabled': 'تعطيل الحساب',
  'staff.account_suspended': 'إيقاف مؤقت للحساب',
  'staff.account_reactivated': 'إعادة تفعيل الحساب',
  'staff.account_pending': 'تعليق الحساب للمراجعة',
  'staff.created': 'إنشاء حساب جديد',
  'staff.deleted': 'حذف حساب',
  'staff.profile_updated': 'تم تعديل بيانات الموظف',
  'staff.email_change_requested': 'تم طلب تغيير بريد تسجيل الدخول للموظف',
  'staff.email_changed': 'تم تغيير بريد تسجيل الدخول للموظف',
  'staff.email_change_failed': 'فشل تغيير بريد تسجيل الدخول للموظف',
  // Phase 26H-2 — password rotation lifecycle.
  'staff.password_change_required': 'إلزام الموظف بتغيير كلمة المرور',
  'staff.password_change_required_completed': 'اكتمال تغيير كلمة المرور الإجباري',
  'staff.password_reset_sent': 'إرسال رابط تغيير كلمة المرور',
  'staff.password_reset_failed': 'فشل إرسال رابط تغيير كلمة المرور',
  'security.device_blocked': 'حظر جهاز',
  'security.device_unblocked': 'إلغاء حظر جهاز',
  'security.device_renamed': 'تسمية جهاز',
  'security.device_policy_changed': 'تعديل سياسة الأجهزة',
  'security.login_succeeded': 'تسجيل دخول ناجح',
  'security.login_blocked': 'محاولة دخول محظورة',
  'security.logout': 'تسجيل خروج',
  auth_orphan_profile_created: 'إنشاء ملف لحساب Auth مفقود',
  auth_user_delete_requested: 'تم طلب حذف حساب دخول نهائيًا',
  auth_user_delete_blocked: 'تم منع حذف حساب الدخول لأسباب أمان',
  auth_user_deleted: 'حذف نهائي لحساب Auth',
  auth_user_delete_failed: 'فشل حذف حساب Auth',
  'role.created': 'إنشاء دور',
  'role.updated': 'تعديل دور',
  'role.deleted': 'حذف دور',
  'role.permissions_changed': 'تعديل صلاحيات دور',
  // Orders
  'order.created': 'إنشاء طلب',
  'order.updated': 'تعديل طلب',
  'order.status_changed': 'تغيير حالة طلب',
  'order.delegate_assigned': 'تعيين مندوب للطلب',
  'order.delivery_scheduled': 'جدولة موعد التسليم',
  'order.note_updated': 'تحديث ملاحظة الطلب',
  // Returns / exchanges
  'adjustment.created': 'إنشاء تسوية / مرتجع / استبدال',
  'adjustment.approved': 'اعتماد تسوية',
  'adjustment.rejected': 'رفض تسوية',
  'adjustment.completed': 'تنفيذ تسوية',
  'adjustment.cancelled': 'إلغاء تسوية',
  'adjustment.child_order_created': 'إنشاء طلب فرعي للتسوية',
  // Customers
  'customer.created': 'إنشاء عميل',
  'customer.updated': 'تعديل بيانات عميل',
  'customer.note_created': 'إضافة ملاحظة لعميل',
  'customer.task_created': 'إنشاء مهمة عميل',
  'customer.task_updated': 'تعديل مهمة عميل',
  'customer.task_status_changed': 'تغيير حالة مهمة عميل',
  'customer.attachment_uploaded': 'رفع مرفق لعميل',
  'customer.complaint_created': 'إنشاء شكوى عميل',
  'customer.complaint_updated': 'تعديل شكوى عميل',
  'customer.complaint_closed': 'إغلاق شكوى عميل',
  'customer.complaint_reopened': 'إعادة فتح شكوى عميل',
  'customer.complaint_assigned': 'تعيين شكوى عميل',
  // Phase 26D-2 — Delegate management
  'delegate.created': 'إنشاء مندوب جديد',
  'delegate.updated': 'تعديل بيانات مندوب',
  'delegate.disabled': 'تعطيل مندوب',
  'delegate.enabled': 'تفعيل مندوب',
  'delegate.reassigned': 'استبدال مندوب',
  'delegate.change_request_created': 'طلب تعديل بيانات مندوب',
  'delegate.change_request_approved': 'اعتماد طلب تعديل مندوب',
  'delegate.change_request_rejected': 'رفض طلب تعديل مندوب',
  // Phase 26D-2 — Delegate finance
  'delegate.settlement_created': 'تسجيل توريد مندوب',
  'delegate.settlement_updated': 'تعديل توريد مندوب',
  'delegate.settlement_voided': 'إلغاء توريد مندوب',
  'delegate.custody_created': 'تسجيل عهدة للمندوب',
  'delegate.custody_updated': 'تعديل عهدة المندوب',
  'delegate.custody_returned': 'استرجاع عهدة المندوب',
  'delegate.custody_voided': 'إلغاء عهدة المندوب',
  'delegate.expense_created': 'تسجيل مصروف مندوب',
  'delegate.expense_updated': 'تعديل مصروف مندوب',
  'delegate.expense_approved': 'اعتماد مصروف مندوب',
  'delegate.expense_rejected': 'رفض مصروف مندوب',
  'delegate.expense_voided': 'إلغاء مصروف مندوب',
};

/**
 * Phase 26D-1 — group an action into a high-level bucket for the
 * audit-tab filter pills. Keys map to short Arabic labels.
 */
export type StaffAuditActionGroup =
  | 'orders'
  | 'returns'
  | 'customers'
  | 'complaints'
  | 'delegates'
  | 'delegateFinance'
  | 'staff'
  | 'security';

export const STAFF_AUDIT_GROUP_LABEL_AR: Record<StaffAuditActionGroup, string> = {
  orders: 'الطلبات',
  returns: 'المرتجعات والاستبدالات',
  customers: 'العملاء',
  complaints: 'الشكاوى',
  delegates: 'المناديب',
  delegateFinance: 'مالية المناديب',
  staff: 'الموظفون والأدوار',
  security: 'الأمان',
};

/**
 * Phase 26D-2 — finance-specific delegate actions go to their own
 * filter pill (مالية المناديب) so admins can isolate money-moving
 * events from delegate-profile edits.
 */
const DELEGATE_FINANCE_PREFIXES = [
  'delegate.settlement_',
  'delegate.custody_',
  'delegate.expense_',
];

export function groupForAction(action: string): StaffAuditActionGroup {
  if (action.startsWith('order.')) return 'orders';
  if (action.startsWith('adjustment.')) return 'returns';
  if (action.startsWith('customer.complaint_')) return 'complaints';
  if (action.startsWith('customer.')) return 'customers';
  if (DELEGATE_FINANCE_PREFIXES.some((p) => action.startsWith(p))) return 'delegateFinance';
  if (action.startsWith('delegate.')) return 'delegates';
  if (action.startsWith('staff.') || action.startsWith('role.')) return 'staff';
  return 'security';
}

export interface StaffAuditEntity {
  /** `profile`, `device`, `role`, `policy`, etc. */
  type?: string | null;
  /** Stable identifier — UUID for profiles/devices, role id for roles. */
  id?: string | null;
  /** Human-readable label for the audit viewer (e.g. the staff name). */
  label?: string | null;
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

type StaffAuditInsertPayload = {
  actor_id: string | null;
  actor_name: string | null;
  actor_role_id: string | null;
  action: StaffAuditAction;
  entity_type: string | null;
  entity_id: string | null;
  entity_label: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  device_fingerprint: string | null;
};

type StaffAuditInsertError = {
  code?: string;
  message?: string;
};

function buildStaffAuditPayload(
  input: StaffAuditInput,
  actorId: string | null,
  metadata: Record<string, unknown>
): StaffAuditInsertPayload {
  return {
    actor_id: actorId,
    actor_name: input.actorName ?? null,
    actor_role_id: input.actorRoleId ?? null,
    action: input.action,
    entity_type: input.entity?.type ?? null,
    entity_id: input.entity?.id ?? null,
    entity_label: input.entity?.label ?? null,
    description: input.description ?? null,
    metadata,
    ip_address: input.ipAddress ?? null,
    user_agent: input.userAgent ?? null,
    device_fingerprint: input.deviceFingerprint ?? null,
  };
}

function shouldRetryWithoutActorId(error: StaffAuditInsertError): boolean {
  const code = error.code ?? '';
  const message = error.message ?? '';
  return (
    code === '23503' ||
    code === '42501' ||
    /foreign key|violates row-level security|row-level security/i.test(message)
  );
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
    const baseMetadata = input.metadata ?? {};
    const insertPayload = async (payload: StaffAuditInsertPayload) =>
      supabase.from('turath_masr_staff_audit_logs').insert(payload).select('id').single();

    const { data, error } = await insertPayload(
      buildStaffAuditPayload(input, input.actorId ?? null, baseMetadata)
    );
    if (error) {
      if (input.actorId && shouldRetryWithoutActorId(error)) {
        const fallbackMetadata: Record<string, unknown> = {
          ...baseMetadata,
          audit_actor_id_fallback: true,
          audit_actor_original_id: input.actorId,
          audit_actor_insert_error_code: error.code ?? null,
        };
        const { data: fallbackData, error: fallbackError } = await insertPayload(
          buildStaffAuditPayload(input, null, fallbackMetadata)
        );
        if (!fallbackError) {
          console.warn(
            '[staffAudit] insert retried without actor_id after actor reference check failed.'
          );
          return (fallbackData as { id?: string } | null)?.id ?? null;
        }
        console.warn('[staffAudit] fallback insert failed:', fallbackError.message);
        return null;
      }
      console.warn('[staffAudit] insert failed:', error.message);
      return null;
    }
    return (data as { id?: string } | null)?.id ?? null;
  } catch (err) {
    console.warn('[staffAudit] insert exception:', err);
    return null;
  }
}
