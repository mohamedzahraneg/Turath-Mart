// ─────────────────────────────────────────────────────────────────────────────
// src/lib/delegates/transportTypes.ts
//
// Phase 23A-Fix1 — canonical list of `profiles.transport_type` tokens
// + their Arabic display labels.
//
// Storage keeps the English-snake-case token (motorcycle / private_car /
// quarter_truck / half_truck / walking) so reports and exports are
// locale-independent. Every render path goes through `transportLabel()`
// to surface the Arabic copy:
//
//     motorcycle      → موتوسيكل
//     private_car     → عربية ملاكي
//     quarter_truck   → عربية ربع نقل
//     half_truck      → عربية نصف نقل
//     walking         → مترجل
//
// Adding a new mode:
//   1. Append the storage token to `TRANSPORT_TYPE_TOKENS`.
//   2. Add the Arabic label to `TRANSPORT_TYPE_LABELS_AR`.
//   3. (Optional) bump the migration if you want a CHECK constraint.
//      The current schema deliberately leaves this column as plain
//      text so legacy rows survive future expansions.
// ─────────────────────────────────────────────────────────────────────────────

export const TRANSPORT_TYPE_TOKENS = [
  'motorcycle',
  'private_car',
  'quarter_truck',
  'half_truck',
  'walking',
] as const;

export type TransportType = (typeof TRANSPORT_TYPE_TOKENS)[number];

export const TRANSPORT_TYPE_LABELS_AR: Record<TransportType, string> = {
  motorcycle: 'موتوسيكل',
  private_car: 'عربية ملاكي',
  quarter_truck: 'عربية ربع نقل',
  half_truck: 'عربية نصف نقل',
  walking: 'مترجل',
};

/**
 * Resolve the Arabic display label for a stored transport_type token.
 * Returns the raw input when it doesn't match a known token, so any
 * future / legacy values still render rather than collapsing to an
 * empty string.
 */
export function transportLabel(token: string | null | undefined): string {
  if (!token) return '';
  if ((TRANSPORT_TYPE_TOKENS as readonly string[]).includes(token)) {
    return TRANSPORT_TYPE_LABELS_AR[token as TransportType];
  }
  return token;
}
