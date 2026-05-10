// ─────────────────────────────────────────────────────────────────────────────
// src/lib/delegates/settlementMethods.ts
//
// Phase 23B — canonical list of `turath_masr_delegate_settlements.method`
// tokens + their Arabic display labels.
//
// Storage keeps the English-snake-case token (cash / vodafone_cash /
// bank_transfer / safe / other) so reports and exports stay locale-
// independent. Every render path goes through `settlementMethodLabel()`
// to surface the Arabic copy:
//
//     cash           → كاش
//     vodafone_cash  → فودافون كاش
//     bank_transfer  → تحويل بنكي
//     safe           → خزنة
//     other          → أخرى
//
// Adding a method:
//   1. Append the storage token to `SETTLEMENT_METHOD_TOKENS`.
//   2. Add the Arabic label to `SETTLEMENT_METHOD_LABELS_AR`.
//   3. Bump the migration to widen the CHECK constraint on
//      `turath_masr_delegate_settlements.method`. The current CHECK
//      enforces this exact set, so a new token would otherwise
//      surface as `23514 check_violation` at INSERT time.
// ─────────────────────────────────────────────────────────────────────────────

export const SETTLEMENT_METHOD_TOKENS = [
  'cash',
  'vodafone_cash',
  'bank_transfer',
  'safe',
  'other',
] as const;

export type SettlementMethod = (typeof SETTLEMENT_METHOD_TOKENS)[number];

export const SETTLEMENT_METHOD_LABELS_AR: Record<SettlementMethod, string> = {
  cash: 'كاش',
  vodafone_cash: 'فودافون كاش',
  bank_transfer: 'تحويل بنكي',
  safe: 'خزنة',
  other: 'أخرى',
};

/**
 * Resolve the Arabic display label for a stored settlement-method token.
 * Falls back to the raw input on unknown tokens so legacy / future
 * values still render rather than collapsing to an empty string.
 */
export function settlementMethodLabel(token: string | null | undefined): string {
  if (!token) return '';
  if ((SETTLEMENT_METHOD_TOKENS as readonly string[]).includes(token)) {
    return SETTLEMENT_METHOD_LABELS_AR[token as SettlementMethod];
  }
  return token;
}
