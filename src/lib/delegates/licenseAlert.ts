// ─────────────────────────────────────────────────────────────────────────────
// src/lib/delegates/licenseAlert.ts
//
// Phase 23I — per-delegate alert level rolling up:
//   • vehicle licence expiry  (profiles.vehicle_license_expires_at)
//   • driving licence expiry  (profiles.driving_license_expires_at)
//   • required-document completeness (presence of national_id_front /
//     national_id_back / driving_license / vehicle_license active rows
//     in `turath_masr_delegate_documents`)
//
// Returns a single discriminated alert level the UI uses for:
//   • the page-level "رخص منتهية" / "تنتهي خلال 30 يوم" /
//     "مستندات ناقصة" KPI counts
//   • the row-level licence pill (already rendered in the delegates
//     table — this module's `worst()` helper picks the worst of the
//     two existing licence statuses + the new "missing docs" check)
//   • the page-level filter pills (الكل / رخص سارية / تنتهي قريبًا /
//     رخص منتهية / مستندات ناقصة)
//
// Pure module — no React, no Supabase. Imports `licenseStatus` from
// the existing Phase 23A-Fix1 helper.
// ─────────────────────────────────────────────────────────────────────────────

import { licenseStatus, type LicenseStatusKind } from './licenseStatus';
import { REQUIRED_DOCUMENT_TYPES, type DocumentType } from './documentTypes';

export type DelegateAlertLevel =
  | 'expired' // any licence expired today or earlier
  | 'expiring' // any licence in the warning window (≤30 days OR today)
  | 'missing_docs' // all licences valid but a required document hasn't been uploaded
  | 'valid' // licences valid AND all required docs present
  | 'unknown'; // legacy delegate_name-only row, no profile data

export interface DelegateAlertSummary {
  level: DelegateAlertLevel;
  /** Worst licence status across the two licences. */
  worstLicense: LicenseStatusKind;
  /** Days until the soonest licence expires. Null if both are
   *  unknown / missing. Negative when at least one is past expiry. */
  daysToSoonestExpiry: number | null;
  /** Document types that are required but have no `active` row. */
  missingRequiredDocs: ReadonlyArray<DocumentType>;
}

const LICENSE_RANK: Record<LicenseStatusKind, number> = {
  expired: 4,
  today: 3,
  warning: 2,
  unknown: 1,
  valid: 0,
};

function worse(a: LicenseStatusKind, b: LicenseStatusKind): LicenseStatusKind {
  return LICENSE_RANK[a] >= LICENSE_RANK[b] ? a : b;
}

/** Inputs for the alert computation. The caller (page aggregator)
 *  feeds the two licence-expiry strings + the `active` document-
 *  type set the delegate has on file. */
export interface DelegateAlertInput {
  vehicleLicenseExpiresAt: string | null | undefined;
  drivingLicenseExpiresAt: string | null | undefined;
  /** Set of document_type tokens for which an `active` (non-archived)
   *  document row exists for this delegate. Pass an empty Set if
   *  the documents fetch failed (pre-migration / RLS deny). */
  activeDocumentTypes: ReadonlySet<string>;
  /** Pass `false` when the row is a legacy `delegate_name`-only
   *  delegate without a profile id; alerts collapse to `unknown`. */
  hasProfile: boolean;
}

export function computeDelegateAlert(input: DelegateAlertInput): DelegateAlertSummary {
  if (!input.hasProfile) {
    return {
      level: 'unknown',
      worstLicense: 'unknown',
      daysToSoonestExpiry: null,
      missingRequiredDocs: [],
    };
  }

  const veh = licenseStatus(input.vehicleLicenseExpiresAt ?? null);
  const drv = licenseStatus(input.drivingLicenseExpiresAt ?? null);
  const worstLicense = worse(veh.status, drv.status);

  // Soonest signed days. veh/drv `days` are unsigned (always >= 0
  // for `valid` / `warning` / `today`, or magnitude for `expired`),
  // so flip the sign for expired statuses to reflect "past".
  function signed(s: typeof veh): number | null {
    if (s.status === 'unknown' || s.days == null) return null;
    if (s.status === 'expired') return -s.days;
    return s.days;
  }
  const sVeh = signed(veh);
  const sDrv = signed(drv);
  const candidates = [sVeh, sDrv].filter((d): d is number => d != null);
  const daysToSoonestExpiry = candidates.length === 0 ? null : Math.min(...candidates);

  // Required-document gap analysis
  const missingRequiredDocs = REQUIRED_DOCUMENT_TYPES.filter(
    (t) => !input.activeDocumentTypes.has(t)
  );

  // Severity rules per spec:
  //   expired       — any licence expired today or earlier
  //   expiring      — any licence in the next 30 days or today
  //   missing_docs  — licences fine but at least one required doc missing
  //   valid         — licences fine + all required docs present
  let level: DelegateAlertLevel;
  if (worstLicense === 'expired') {
    level = 'expired';
  } else if (worstLicense === 'today' || worstLicense === 'warning') {
    level = 'expiring';
  } else if (missingRequiredDocs.length > 0) {
    level = 'missing_docs';
  } else if (worstLicense === 'valid') {
    level = 'valid';
  } else {
    // worstLicense === 'unknown' (no expiry dates set) AND no missing
    // required docs (delegate happens to have all uploads).
    // Treat as missing_docs because the licence dates themselves are
    // missing — that's still incomplete data the dispatcher should fix.
    level = 'missing_docs';
  }

  return { level, worstLicense, daysToSoonestExpiry, missingRequiredDocs };
}

/** Tone token map for badge rendering. The page interpolates the
 *  return value into a Tailwind class string. */
export const ALERT_LEVEL_TONE: Record<DelegateAlertLevel, string> = {
  expired: 'bg-red-50 text-red-700 border-red-200',
  expiring: 'bg-amber-50 text-amber-700 border-amber-200',
  missing_docs: 'bg-blue-50 text-blue-700 border-blue-200',
  valid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  unknown:
    'bg-[hsl(var(--muted))]/40 text-[hsl(var(--muted-foreground))] border-[hsl(var(--border))]',
};

export const ALERT_LEVEL_LABEL_AR: Record<DelegateAlertLevel, string> = {
  expired: 'رخص منتهية',
  expiring: 'تنتهي قريبًا',
  missing_docs: 'مستندات ناقصة',
  valid: 'سارية',
  unknown: '—',
};

export function alertLevelLabel(level: DelegateAlertLevel): string {
  return ALERT_LEVEL_LABEL_AR[level];
}
