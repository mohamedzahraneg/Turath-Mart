// ─────────────────────────────────────────────────────────────────────────────
// src/lib/delegates/expenseTypes.ts
//
// Phase 23C — canonical expense-type and expense-status tokens for
// `turath_masr_delegate_expenses`, plus their Arabic display labels.
//
// Type tokens (storage):
//     fuel            → بنزين
//     transport       → مواصلات
//     extra_shipping  → شحن إضافي
//     waiting         → انتظار
//     toll            → كارتة / بوابة
//     parking         → ركن / جراج
//     other           → أخرى
//
// Status tokens (approval lifecycle):
//     approved → معتمد         (default in Phase 23C)
//     pending  → قيد المراجعة  (placeholder for a later approval flow)
//     rejected → مرفوض         (placeholder)
//
// Storage keeps the English-snake-case token so reports / exports
// stay locale-independent. Adding a new token requires widening the
// CHECK constraint in
// `supabase/migrations/20260510220000_delegate_custody_and_expenses.sql`
// before it can be inserted.
// ─────────────────────────────────────────────────────────────────────────────

export const EXPENSE_TYPE_TOKENS = [
  'fuel',
  'transport',
  'extra_shipping',
  'waiting',
  'toll',
  'parking',
  'other',
] as const;

export type ExpenseType = (typeof EXPENSE_TYPE_TOKENS)[number];

export const EXPENSE_TYPE_LABELS_AR: Record<ExpenseType, string> = {
  fuel: 'بنزين',
  transport: 'مواصلات',
  extra_shipping: 'شحن إضافي',
  waiting: 'انتظار',
  toll: 'كارتة / بوابة',
  parking: 'ركن / جراج',
  other: 'أخرى',
};

export function expenseTypeLabel(token: string | null | undefined): string {
  if (!token) return '';
  if ((EXPENSE_TYPE_TOKENS as readonly string[]).includes(token)) {
    return EXPENSE_TYPE_LABELS_AR[token as ExpenseType];
  }
  return token;
}

export const EXPENSE_STATUS_TOKENS = ['approved', 'pending', 'rejected'] as const;

export type ExpenseStatus = (typeof EXPENSE_STATUS_TOKENS)[number];

export const EXPENSE_STATUS_LABELS_AR: Record<ExpenseStatus, string> = {
  approved: 'معتمد',
  pending: 'قيد المراجعة',
  rejected: 'مرفوض',
};

/** Tailwind colour token per status. Matches the custody-status
 *  convention so a future shared "Status pill" component can pick
 *  the tone class without per-table specials. */
export const EXPENSE_STATUS_TONE: Record<ExpenseStatus, string> = {
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
};

export function expenseStatusLabel(token: string | null | undefined): string {
  if (!token) return '';
  if ((EXPENSE_STATUS_TOKENS as readonly string[]).includes(token)) {
    return EXPENSE_STATUS_LABELS_AR[token as ExpenseStatus];
  }
  return token;
}
