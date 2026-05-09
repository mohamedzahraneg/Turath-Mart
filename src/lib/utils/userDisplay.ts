// ─────────────────────────────────────────────────────────────────────────────
// Phase 22L — single source of truth for user-facing identity stamps.
//
// Background: until this phase, audit logs and the in-modal status history
// rendered "who did this" using whichever string the writer happened to
// have in scope — sometimes a real full name, sometimes the role label,
// sometimes the literal placeholder "مستخدم". The display surfaces also
// each carried their own ROLE_LABEL map (one in AuditLogModal, one in
// StatusUpdateModal, one in Sidebar), and they did NOT agree on r1..r6
// vs legacy English keys. The result: the same user could appear as
// "خدمة عملاء" / "خدمة العملاء" / "customer_service" depending on which
// surface was rendering them.
//
// This file unifies both sides:
//   • getRoleLabel(role) — accepts r1..r6 ids, legacy English names
//     ("manager", "shipping", …), or already-Arabic labels and
//     normalises them all to the canonical Arabic role label.
//   • getDisplayName(candidates, roleLabel?) — picks the first
//     candidate that's clearly a real name, skipping known
//     placeholders like the literal "مستخدم", the legacy hardcoded
//     "موظف خدمة عملاء" used by AddOrderModal pre-22L, and any
//     candidate that exactly matches the role label (which is the
//     bug we're fixing — names like "خدمة عملاء" leaking into the
//     name column).
//
// Pure helpers, no side effects. Safe in any runtime.
// ─────────────────────────────────────────────────────────────────────────────

const ROLE_ID_TO_ARABIC: Record<string, string> = {
  r1: 'مدير النظام',
  r2: 'مشرف النظام',
  r3: 'مشرف شحن',
  r4: 'مندوب شحن',
  r5: 'مدير خدمة عملاء',
  r6: 'خدمة عملاء',
};

const LEGACY_ROLE_TO_ARABIC: Record<string, string> = {
  admin: 'مدير النظام',
  manager: 'مدير النظام',
  supervisor: 'مشرف النظام',
  shipping: 'مندوب شحن',
  delegate: 'مندوب شحن',
  data_entry: 'موظف إدخال بيانات',
  employee: 'موظف',
  customer_service: 'خدمة عملاء',
  cs: 'خدمة عملاء',
};

/**
 * Resolve any role identifier (id `r1..r6`, legacy English name, or
 * already-Arabic label) to the canonical Arabic role label.
 *
 *   getRoleLabel('r6')             // → 'خدمة عملاء'
 *   getRoleLabel('manager')         // → 'مدير النظام'
 *   getRoleLabel('خدمة عملاء')     // → 'خدمة عملاء' (passes through)
 *   getRoleLabel(null)              // → ''
 *
 * Returns the trimmed input unchanged when no mapping is found, so
 * already-canonical Arabic role labels and unknown future roles flow
 * through without surprises.
 */
export function getRoleLabel(role: string | null | undefined): string {
  if (!role) return '';
  const trimmed = String(role).trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  return ROLE_ID_TO_ARABIC[lower] ?? LEGACY_ROLE_TO_ARABIC[lower] ?? trimmed;
}

// Strings that historically leaked into the "name" column when no
// real name was available. Treated as non-names by getDisplayName so
// a real value further down the candidate chain can win.
const KNOWN_NAME_PLACEHOLDERS: ReadonlyArray<string> = [
  'مستخدم',
  'موظف خدمة عملاء',
  'employee',
  'user',
];

/**
 * Pick the best display name from a chain of candidates. The first
 * non-empty, non-placeholder, non-role value wins. When everything
 * fails, returns 'مستخدم' so the caller can always render *something*
 * (the UserStamp component then makes it visually clear that the
 * identity is missing).
 *
 *   getDisplayName(['رحمة', 'rahma@…', 'خدمة عملاء'], 'خدمة عملاء')
 *     → 'رحمة'
 *
 *   getDisplayName(['', null, 'خدمة عملاء'], 'خدمة عملاء')
 *     → 'مستخدم'   (role-shaped candidate is skipped via roleLabel)
 *
 *   getDisplayName(['rahma@example.com'], null)
 *     → 'rahma@example.com'   (email is acceptable when nothing else)
 */
export function getDisplayName(
  candidates: ReadonlyArray<string | null | undefined>,
  roleLabel?: string | null
): string {
  const skipRole = roleLabel ? String(roleLabel).trim() : '';
  for (const c of candidates) {
    if (!c) continue;
    const v = String(c).trim();
    if (!v) continue;
    if (KNOWN_NAME_PLACEHOLDERS.includes(v)) continue;
    if (skipRole && v === skipRole) continue;
    return v;
  }
  return 'مستخدم';
}
