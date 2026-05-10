// ─────────────────────────────────────────────────────────────────────────────
// src/lib/delegates/licenseStatus.ts
//
// Phase 23A-Fix1 — render the remaining-days pill next to a delegate
// licence expiry date.
//
// Three states drive both copy and colour:
//   • valid   → "متبقي N يوم"               (green,  N > 30)
//   • warning → "متبقي N يوم"               (amber,  0 < N ≤ 30)
//   • today   → "تنتهي اليوم"               (amber)
//   • expired → "منتهية منذ N يوم"          (red,    N > 0)
//
// The function never throws and treats invalid / missing inputs as
// `{ status: 'unknown', label: '' }` so render call-sites can do
// `if (s.label)` without extra guards.
// ─────────────────────────────────────────────────────────────────────────────

export type LicenseStatusKind = 'unknown' | 'expired' | 'today' | 'warning' | 'valid';

export interface LicenseStatus {
  status: LicenseStatusKind;
  /** Localised Arabic label. Empty string for `unknown`. */
  label: string;
  /** Days until expiry. Positive = remaining; negative = expired
   *  (number is a day count, NOT a signed offset — the consumer
   *  uses `status` to know which side of zero we are on). 0 on
   *  the day of expiry. `null` for `unknown`. */
  days: number | null;
  /** Tailwind colour token consumers can interpolate into the
   *  className without owning the colour scale themselves. */
  toneClass: string;
}

/**
 * Compute days until / since the supplied expiry date, working in
 * the local timezone (we compare local-midnight calendar days).
 */
function daysFromTodayToExpiry(yyyyMmDd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyyMmDd.trim());
  if (!m) return null;
  const exp = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(exp.getTime())) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const ms = exp.getTime() - today.getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

export function licenseStatus(yyyyMmDd: string | null | undefined): LicenseStatus {
  if (typeof yyyyMmDd !== 'string' || !yyyyMmDd) {
    return { status: 'unknown', label: '', days: null, toneClass: '' };
  }
  const delta = daysFromTodayToExpiry(yyyyMmDd);
  if (delta == null) {
    return { status: 'unknown', label: '', days: null, toneClass: '' };
  }
  if (delta < 0) {
    return {
      status: 'expired',
      label: `منتهية منذ ${Math.abs(delta)} يوم`,
      days: Math.abs(delta),
      toneClass: 'bg-red-50 text-red-700 border-red-200',
    };
  }
  if (delta === 0) {
    return {
      status: 'today',
      label: 'تنتهي اليوم',
      days: 0,
      toneClass: 'bg-amber-50 text-amber-700 border-amber-200',
    };
  }
  if (delta <= 30) {
    return {
      status: 'warning',
      label: `متبقي ${delta} يوم`,
      days: delta,
      toneClass: 'bg-amber-50 text-amber-700 border-amber-200',
    };
  }
  return {
    status: 'valid',
    label: `متبقي ${delta} يوم`,
    days: delta,
    toneClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  };
}
