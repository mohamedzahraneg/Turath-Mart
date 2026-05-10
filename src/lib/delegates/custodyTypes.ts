// ─────────────────────────────────────────────────────────────────────────────
// src/lib/delegates/custodyTypes.ts
//
// Phase 23C — canonical custody-type and custody-status tokens for
// `turath_masr_delegate_custody`, plus their Arabic display labels.
//
// Type tokens (storage):
//     cash       → فلوس
//     product    → منتجات
//     device     → جهاز
//     bag        → شنطة
//     returns    → مرتجعات
//     documents  → مستندات
//     other      → أخرى
//
// Status tokens (lifecycle):
//     with_delegate → مع المندوب  (seed)
//     returned      → تم الاستلام (terminal)
//     settled       → تمت التسوية (terminal)
//     lost          → مفقود        (terminal)
//
// Storage keeps the English-snake-case token so reports / exports
// stay locale-independent. Adding a new token requires:
//   1. append to the *_TOKENS array
//   2. add the Arabic label to *_LABELS_AR
//   3. widen the CHECK constraint in
//      `supabase/migrations/20260510220000_delegate_custody_and_expenses.sql`
//      (otherwise insert returns 23514).
// ─────────────────────────────────────────────────────────────────────────────

export const CUSTODY_TYPE_TOKENS = [
  'cash',
  'product',
  'device',
  'bag',
  'returns',
  'documents',
  'other',
] as const;

export type CustodyType = (typeof CUSTODY_TYPE_TOKENS)[number];

export const CUSTODY_TYPE_LABELS_AR: Record<CustodyType, string> = {
  cash: 'فلوس',
  product: 'منتجات',
  device: 'جهاز',
  bag: 'شنطة',
  returns: 'مرتجعات',
  documents: 'مستندات',
  other: 'أخرى',
};

export function custodyTypeLabel(token: string | null | undefined): string {
  if (!token) return '';
  if ((CUSTODY_TYPE_TOKENS as readonly string[]).includes(token)) {
    return CUSTODY_TYPE_LABELS_AR[token as CustodyType];
  }
  return token;
}

export const CUSTODY_STATUS_TOKENS = ['with_delegate', 'returned', 'settled', 'lost'] as const;

export type CustodyStatus = (typeof CUSTODY_STATUS_TOKENS)[number];

export const CUSTODY_STATUS_LABELS_AR: Record<CustodyStatus, string> = {
  with_delegate: 'مع المندوب',
  returned: 'تم الاستلام',
  settled: 'تمت التسوية',
  lost: 'مفقود',
};

/** Tailwind colour token per status — driven into the inline pill
 *  className so we don't repeat the colour scale in every render
 *  call-site. Matches the licence-status helper convention. */
export const CUSTODY_STATUS_TONE: Record<CustodyStatus, string> = {
  with_delegate: 'bg-amber-50 text-amber-700 border-amber-200',
  returned: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  settled: 'bg-blue-50 text-blue-700 border-blue-200',
  lost: 'bg-red-50 text-red-700 border-red-200',
};

export function custodyStatusLabel(token: string | null | undefined): string {
  if (!token) return '';
  if ((CUSTODY_STATUS_TOKENS as readonly string[]).includes(token)) {
    return CUSTODY_STATUS_LABELS_AR[token as CustodyStatus];
  }
  return token;
}
