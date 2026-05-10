// ─────────────────────────────────────────────────────────────────────────────
// src/lib/delegates/changeRequest.ts
//
// Phase 23M — pure helpers for the delegate profile change-request
// workflow:
//   • whitelist of fields a delegate may propose to change
//   • Arabic labels for each field
//   • validators (phone, dates, national_id, transport)
//   • diff helper that returns ONLY the changed fields between the
//     current profile snapshot and the form's working copy
//   • CSV-safe-ish summary helper for the audit row
//
// Pure module — no React, no Supabase, no DOM. The server-side RPCs
// (`submit_delegate_change_request`, `approve_delegate_change_request`,
// `reject_delegate_change_request`, `cancel_delegate_change_request`)
// re-validate every field against the SAME whitelist before any DB
// write, so this module is the single source of truth for what's
// editable and what's allowed.
// ─────────────────────────────────────────────────────────────────────────────

import { TRANSPORT_TYPE_TOKENS, type TransportType } from './transportTypes';

// ─── Whitelist + labels ──────────────────────────────────────────────────

/** Fields the delegate may propose to change. Tightly scoped — role /
 *  permissions / financial / active-flag are explicitly OUT of the
 *  whitelist. The server-side RPC enforces the same list. */
export const CHANGE_REQUEST_FIELDS = [
  'phone',
  'transport_type',
  'vehicle_license_number',
  'vehicle_license_starts_at',
  'vehicle_license_expires_at',
  'driving_license_number',
  'driving_license_starts_at',
  'driving_license_expires_at',
  'national_id',
] as const;

export type ChangeRequestField = (typeof CHANGE_REQUEST_FIELDS)[number];

/** Sensitive fields — flagged with a red banner on the admin review
 *  surface. Approval is still allowed but the dispatcher is asked to
 *  double-check the supporting document before clicking through. */
export const SENSITIVE_FIELDS: ReadonlyArray<ChangeRequestField> = ['national_id'];

export const CHANGE_REQUEST_LABELS_AR: Record<ChangeRequestField, string> = {
  phone: 'رقم الهاتف',
  transport_type: 'نوع وسيلة المواصلات',
  vehicle_license_number: 'رقم رخصة المركبة',
  vehicle_license_starts_at: 'بداية رخصة المركبة',
  vehicle_license_expires_at: 'نهاية رخصة المركبة',
  driving_license_number: 'رقم رخصة القيادة',
  driving_license_starts_at: 'بداية رخصة القيادة',
  driving_license_expires_at: 'نهاية رخصة القيادة',
  national_id: 'الرقم القومي',
};

export function changeRequestLabel(field: string): string {
  if ((CHANGE_REQUEST_FIELDS as readonly string[]).includes(field)) {
    return CHANGE_REQUEST_LABELS_AR[field as ChangeRequestField];
  }
  return field;
}

// ─── Profile snapshot type ───────────────────────────────────────────────

/** Slim view of `profiles` that the delegate form needs. Strings only
 *  on the wire — the dates ride as `yyyy-mm-dd` strings to keep the
 *  shape symmetrical with `<input type="date">` and the jsonb payload
 *  the server sees. */
export interface DelegateProfileSnapshot {
  phone: string | null;
  transport_type: string | null;
  vehicle_license_number: string | null;
  vehicle_license_starts_at: string | null;
  vehicle_license_expires_at: string | null;
  driving_license_number: string | null;
  driving_license_starts_at: string | null;
  driving_license_expires_at: string | null;
  national_id: string | null;
}

/** A change-request form value. Same shape as the snapshot — null /
 *  empty string mean "no change for this field". */
export type ChangeRequestForm = DelegateProfileSnapshot;

// ─── Validators ──────────────────────────────────────────────────────────

const PHONE_RE = /^01[0-9]{9}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NATIONAL_ID_RE = /^\d{14}$/;

export interface ChangeRequestValidationError {
  field: ChangeRequestField | 'cross_vehicle' | 'cross_driving';
  message: string;
}

/** Validate the user-supplied form. Returns the (possibly empty)
 *  list of errors. The caller surfaces them inline in the form. */
export function validateChangeRequest(form: ChangeRequestForm): ChangeRequestValidationError[] {
  const errors: ChangeRequestValidationError[] = [];

  const trimmed = (v: string | null | undefined): string => (v ?? '').trim();

  const phone = trimmed(form.phone);
  if (phone && !PHONE_RE.test(phone)) {
    errors.push({ field: 'phone', message: 'رقم الهاتف يجب أن يكون 11 رقم ويبدأ بـ 01.' });
  }

  const transport = trimmed(form.transport_type);
  if (transport && !(TRANSPORT_TYPE_TOKENS as readonly string[]).includes(transport)) {
    errors.push({ field: 'transport_type', message: 'نوع وسيلة المواصلات غير صحيح.' });
  }

  const vehStart = trimmed(form.vehicle_license_starts_at);
  const vehEnd = trimmed(form.vehicle_license_expires_at);
  if (vehStart && !DATE_RE.test(vehStart)) {
    errors.push({
      field: 'vehicle_license_starts_at',
      message: 'تاريخ بداية رخصة المركبة غير صحيح.',
    });
  }
  if (vehEnd && !DATE_RE.test(vehEnd)) {
    errors.push({
      field: 'vehicle_license_expires_at',
      message: 'تاريخ نهاية رخصة المركبة غير صحيح.',
    });
  }
  if (vehStart && vehEnd && DATE_RE.test(vehStart) && DATE_RE.test(vehEnd) && vehEnd < vehStart) {
    errors.push({
      field: 'cross_vehicle',
      message: 'نهاية رخصة المركبة يجب أن تكون بعد بدايتها.',
    });
  }

  const drvStart = trimmed(form.driving_license_starts_at);
  const drvEnd = trimmed(form.driving_license_expires_at);
  if (drvStart && !DATE_RE.test(drvStart)) {
    errors.push({
      field: 'driving_license_starts_at',
      message: 'تاريخ بداية رخصة القيادة غير صحيح.',
    });
  }
  if (drvEnd && !DATE_RE.test(drvEnd)) {
    errors.push({
      field: 'driving_license_expires_at',
      message: 'تاريخ نهاية رخصة القيادة غير صحيح.',
    });
  }
  if (drvStart && drvEnd && DATE_RE.test(drvStart) && DATE_RE.test(drvEnd) && drvEnd < drvStart) {
    errors.push({
      field: 'cross_driving',
      message: 'نهاية رخصة القيادة يجب أن تكون بعد بدايتها.',
    });
  }

  const nid = trimmed(form.national_id);
  if (nid && !NATIONAL_ID_RE.test(nid)) {
    errors.push({ field: 'national_id', message: 'الرقم القومي يجب أن يكون 14 رقم.' });
  }

  const vehLic = trimmed(form.vehicle_license_number);
  if (vehLic && vehLic.length > 80) {
    errors.push({ field: 'vehicle_license_number', message: 'رقم رخصة المركبة طويل جدًا.' });
  }
  const drvLic = trimmed(form.driving_license_number);
  if (drvLic && drvLic.length > 80) {
    errors.push({ field: 'driving_license_number', message: 'رقم رخصة القيادة طويل جدًا.' });
  }

  return errors;
}

// ─── Diff ────────────────────────────────────────────────────────────────

/** Per-field diff entry — used by the admin review modal to render
 *  "current → requested" rows. */
export interface ChangeRequestDiffEntry {
  field: ChangeRequestField;
  label: string;
  currentValue: string | null;
  requestedValue: string | null;
  sensitive: boolean;
}

/** Returns ONLY the fields that actually changed between the current
 *  snapshot and the form. Trims strings; empty after trim is treated
 *  as null (so "" → "" doesn't appear as a change). */
export function diffChangeRequest(
  current: DelegateProfileSnapshot,
  form: ChangeRequestForm
): ChangeRequestDiffEntry[] {
  const out: ChangeRequestDiffEntry[] = [];
  for (const field of CHANGE_REQUEST_FIELDS) {
    const cur = normalize(current[field]);
    const req = normalize(form[field]);
    if (cur === req) continue;
    out.push({
      field,
      label: CHANGE_REQUEST_LABELS_AR[field],
      currentValue: cur,
      requestedValue: req,
      sensitive: SENSITIVE_FIELDS.includes(field),
    });
  }
  return out;
}

function normalize(value: string | null | undefined): string | null {
  if (value == null) return null;
  const t = value.trim();
  return t.length === 0 ? null : t;
}

/** Build the jsonb payload to send to the RPC. Returns only changed
 *  fields, with empty/null normalised away. Pre-condition: caller
 *  has already run `validateChangeRequest` and there are no errors. */
export function buildChangePayload(
  current: DelegateProfileSnapshot,
  form: ChangeRequestForm
): Partial<Record<ChangeRequestField, string>> {
  const payload: Partial<Record<ChangeRequestField, string>> = {};
  for (const entry of diffChangeRequest(current, form)) {
    if (entry.requestedValue == null) continue;
    payload[entry.field] = entry.requestedValue;
  }
  return payload;
}

// ─── Status helpers ──────────────────────────────────────────────────────

export type ChangeRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export const CHANGE_REQUEST_STATUS_LABEL_AR: Record<ChangeRequestStatus, string> = {
  pending: 'قيد المراجعة',
  approved: 'تم الاعتماد',
  rejected: 'مرفوض',
  cancelled: 'ملغي',
};

export const CHANGE_REQUEST_STATUS_TONE: Record<ChangeRequestStatus, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
  cancelled:
    'bg-[hsl(var(--muted))]/40 text-[hsl(var(--muted-foreground))] border-[hsl(var(--border))]',
};

export function changeRequestStatusLabel(s: string | null | undefined): string {
  if (!s) return '—';
  if (s in CHANGE_REQUEST_STATUS_LABEL_AR) {
    return CHANGE_REQUEST_STATUS_LABEL_AR[s as ChangeRequestStatus];
  }
  return s;
}

// ─── Snapshot helper ─────────────────────────────────────────────────────

/** Build a DelegateProfileSnapshot from a partial profiles row. */
export function profileToSnapshot(
  p: Partial<DelegateProfileSnapshot> & Record<string, unknown>
): DelegateProfileSnapshot {
  const pick = (k: string): string | null => {
    const v = p[k as keyof typeof p];
    if (v == null) return null;
    if (typeof v !== 'string') return String(v);
    const t = v.trim();
    return t.length === 0 ? null : t;
  };
  return {
    phone: pick('phone'),
    transport_type: pick('transport_type'),
    vehicle_license_number: pick('vehicle_license_number'),
    vehicle_license_starts_at: pick('vehicle_license_starts_at'),
    vehicle_license_expires_at: pick('vehicle_license_expires_at'),
    driving_license_number: pick('driving_license_number'),
    driving_license_starts_at: pick('driving_license_starts_at'),
    driving_license_expires_at: pick('driving_license_expires_at'),
    national_id: pick('national_id'),
  };
}

/** Re-export the transport whitelist so the form can render the
 *  same select options without a second import. */
export { TRANSPORT_TYPE_TOKENS, type TransportType };

// ─── RPC error → friendly Arabic message ─────────────────────────────────

export const CHANGE_REQUEST_ERROR_MAP: Record<string, string> = {
  not_authenticated: 'يجب تسجيل الدخول لإكمال هذه العملية.',
  not_delegate: 'الحساب الحالي ليس حساب مندوب.',
  delegate_inactive: 'هذا الحساب غير نشط حاليًا.',
  pending_request_exists: 'يوجد طلب تعديل قيد المراجعة بالفعل.',
  profile_not_found: 'لم يتم العثور على ملف المستخدم.',
  no_changes: 'لم يتم إجراء أي تعديل لإرساله.',
  invalid_changes_shape: 'تنسيق الطلب غير صحيح.',
  invalid_phone: 'رقم الهاتف غير صحيح (11 رقم يبدأ بـ 01).',
  invalid_transport_type: 'نوع وسيلة المواصلات غير معروف.',
  invalid_license_number: 'رقم الرخصة غير صحيح.',
  invalid_date: 'التاريخ المُدخل غير صحيح.',
  invalid_national_id: 'الرقم القومي يجب أن يكون 14 رقم.',
  vehicle_license_date_order: 'نهاية رخصة المركبة يجب أن تكون بعد بدايتها.',
  driving_license_date_order: 'نهاية رخصة القيادة يجب أن تكون بعد بدايتها.',
  not_admin: 'هذه العملية مسموحة للإدارة فقط.',
  not_allowed: 'لا تملك صلاحية تنفيذ هذه العملية.',
  request_not_found: 'الطلب غير موجود.',
  request_not_pending: 'لا يمكن تعديل طلب تم البت فيه بالفعل.',
  reason_required: 'يجب كتابة سبب الرفض.',
  reason_too_long: 'سبب الرفض طويل جدًا.',
  delegate_missing: 'المندوب المرتبط بهذا الطلب غير موجود.',
};

export function changeRequestErrorMessage(rawCode: string | null | undefined): string {
  if (!rawCode) return 'تعذر إكمال العملية. حاول مرة أخرى.';
  return CHANGE_REQUEST_ERROR_MAP[rawCode] || 'تعذر إكمال العملية. حاول مرة أخرى.';
}
