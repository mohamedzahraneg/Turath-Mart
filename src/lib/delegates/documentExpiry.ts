// ─────────────────────────────────────────────────────────────────────────────
// src/lib/delegates/documentExpiry.ts
//
// Phase 23J — per-document expiry status driven by the
// `turath_masr_delegate_documents.expires_at` column (Phase 23I added
// the column; this module wires it into the UI).
//
// Four statuses drive both copy and colour:
//   • valid          → ساري                  (green,  > 30 days away)
//   • expiring_soon  → ينتهي خلال N يوم      (amber,  ≤ 30 days, ≥ 0)
//   • expired        → منتهي منذ N يوم       (red,    < 0)
//   • missing_expiry → بدون تاريخ انتهاء      (gray,   no date set)
//
// Mirrors the shape of `licenseStatus.ts` (Phase 23A-Fix1) so the UI
// can swap one helper for the other in the same render slot. Stays a
// pure module — no React, no Supabase, no DOM.
// ─────────────────────────────────────────────────────────────────────────────

export type DocumentExpiryKind = 'valid' | 'expiring_soon' | 'expired' | 'missing_expiry';

export interface DocumentExpiryStatus {
  status: DocumentExpiryKind;
  /** Localised Arabic label. Empty string is never returned —
   *  `missing_expiry` carries "بدون تاريخ انتهاء". */
  label: string;
  /** Days until / since expiry. Magnitude only — the consumer uses
   *  `status` to know which side of zero we are on. `null` for
   *  `missing_expiry`. */
  days: number | null;
  /** Tailwind colour token consumers interpolate into the className
   *  without owning the colour scale themselves. Same shape as the
   *  Phase 23A-Fix1 licence helper. */
  toneClass: string;
}

/**
 * Compute days until / since expiry, working in the local timezone
 * (we compare local-midnight calendar days). Returns null on
 * unparseable input.
 *
 * Accepts both `yyyy-mm-dd` (the canonical date string Postgres
 * returns) and full ISO timestamps (in case the caller has already
 * converted somewhere upstream).
 */
function daysFromTodayToExpiry(input: string): number | null {
  const trimmed = input.trim();
  // First pattern: pure date string — same fast path as the Phase
  // 23A-Fix1 licence helper.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    const exp = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    if (Number.isNaN(exp.getTime())) return null;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((exp.getTime() - today.getTime()) / 86_400_000);
  }
  // Fallback: parse a full ISO timestamp and compare local-midnights.
  const ts = new Date(trimmed);
  if (Number.isNaN(ts.getTime())) return null;
  const exp = new Date(ts.getFullYear(), ts.getMonth(), ts.getDate());
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((exp.getTime() - today.getTime()) / 86_400_000);
}

const TONE_BY_STATUS: Record<DocumentExpiryKind, string> = {
  valid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  expiring_soon: 'bg-amber-50 text-amber-700 border-amber-200',
  expired: 'bg-red-50 text-red-700 border-red-200',
  missing_expiry:
    'bg-[hsl(var(--muted))]/40 text-[hsl(var(--muted-foreground))] border-[hsl(var(--border))]',
};

const LABEL_BY_STATUS: Record<DocumentExpiryKind, string> = {
  valid: 'ساري',
  expiring_soon: 'ينتهي قريبًا',
  expired: 'منتهي',
  missing_expiry: 'بدون تاريخ انتهاء',
};

/** Returns the discriminated status + a localised label + days +
 *  tone class. `null` / undefined / empty / unparseable input all
 *  collapse to `missing_expiry`. */
export function documentExpiryStatus(expiresAt: string | null | undefined): DocumentExpiryStatus {
  if (typeof expiresAt !== 'string' || !expiresAt.trim()) {
    return {
      status: 'missing_expiry',
      label: LABEL_BY_STATUS.missing_expiry,
      days: null,
      toneClass: TONE_BY_STATUS.missing_expiry,
    };
  }
  const delta = daysFromTodayToExpiry(expiresAt);
  if (delta == null) {
    return {
      status: 'missing_expiry',
      label: LABEL_BY_STATUS.missing_expiry,
      days: null,
      toneClass: TONE_BY_STATUS.missing_expiry,
    };
  }
  if (delta < 0) {
    return {
      status: 'expired',
      label: `منتهي منذ ${Math.abs(delta)} يوم`,
      days: Math.abs(delta),
      toneClass: TONE_BY_STATUS.expired,
    };
  }
  if (delta <= 30) {
    return {
      status: 'expiring_soon',
      label: delta === 0 ? 'ينتهي اليوم' : `ينتهي خلال ${delta} يوم`,
      days: delta,
      toneClass: TONE_BY_STATUS.expiring_soon,
    };
  }
  return {
    status: 'valid',
    label: `ساري — ${delta} يوم متبقي`,
    days: delta,
    toneClass: TONE_BY_STATUS.valid,
  };
}

/** Map of stable Arabic labels for the filter pills + KPI cards. */
export const DOCUMENT_EXPIRY_LABEL_AR: Record<DocumentExpiryKind, string> = {
  valid: 'ساري',
  expiring_soon: 'ينتهي قريبًا',
  expired: 'منتهي',
  missing_expiry: 'بدون تاريخ انتهاء',
};

/** Tone token map exposed for the filter / KPI rendering surfaces
 *  that don't go through the per-status struct. */
export const DOCUMENT_EXPIRY_TONE: Record<DocumentExpiryKind, string> = TONE_BY_STATUS;

// ─── Per-delegate aggregation ─────────────────────────────────────────────

export interface DelegateDocumentExpirySummary {
  /** Count of `active` documents whose expires_at is < today. */
  expired: number;
  /** Count of `active` documents whose expires_at is in the next
   *  30 days inclusive. */
  expiringSoon: number;
  /** Count of `active` documents that have no expires_at at all. */
  missingExpiry: number;
  /** Count of `active` documents with valid (> 30 days) expiry. */
  valid: number;
  /** True iff at least one of the buckets above is non-zero on the
   *  three "needs attention" sides (expired / expiring_soon /
   *  missingExpiry). Useful for the filter pills. */
  needsAttention: boolean;
}

/** Compute the per-delegate document-expiry summary from the
 *  delegate's `active` document list. Caller is expected to filter
 *  to `status === 'active'` before passing in — archived rows are
 *  history, not current state. */
export function summariseDocumentExpiry(
  activeDocs: ReadonlyArray<{ expires_at: string | null }>
): DelegateDocumentExpirySummary {
  let expired = 0;
  let expiringSoon = 0;
  let missingExpiry = 0;
  let valid = 0;
  for (const doc of activeDocs) {
    const status = documentExpiryStatus(doc.expires_at);
    if (status.status === 'expired') expired += 1;
    else if (status.status === 'expiring_soon') expiringSoon += 1;
    else if (status.status === 'missing_expiry') missingExpiry += 1;
    else valid += 1;
  }
  return {
    expired,
    expiringSoon,
    missingExpiry,
    valid,
    needsAttention: expired > 0 || expiringSoon > 0 || missingExpiry > 0,
  };
}
