// ─────────────────────────────────────────────────────────────────────────────
// Phase 22M — coverage merge helper.
//
// Pure function that takes the live `settings_regions` value (whatever
// shape it's in: legacy strings, modern { name, enabled } objects, or
// already-extended Phase 22M shape) and the seed file, and produces a
// new array PLUS a structured summary describing exactly what would
// change. The function MUST NOT mutate either input.
//
// Invariants enforced (matches Phase 22M spec):
//
//   1. Existing governorates are preserved verbatim — name, enabled
//      flag, fee, every district's enabled flag and any other
//      metadata. The seed cannot override admin curation.
//   2. Existing district entries are preserved verbatim. New entries
//      from the seed are appended as `enabled: false` with their
//      source / needsReview metadata.
//   3. New governorates are appended as `enabled: false` with the
//      seed's `source: 'official'` (or 'manual_supplement' as flagged).
//   4. Legacy plain-string districts are normalised to
//      { name, enabled: true, source: 'existing' } objects on the way
//      through. The string-form data is incidentally upgraded but the
//      caller is the only one who decides whether to write back.
//   5. De-duplication is by Arabic-normalised name within the same
//      parent + governorate. The first occurrence wins.
//
// Output `summary` is JSON-friendly so the dry-run script can pretty-
// print it.
// ─────────────────────────────────────────────────────────────────────────────

import { normalizeArabic } from '@/lib/utils/arabic';
import type {
  LegacyDistrictEntry,
  LegacyGovernorate,
  ShippingDistrict,
  ShippingGovernorate,
} from './types';

export interface CoverageMergeSummary {
  governoratesPreserved: number;
  governoratesAdded: number;
  districtsPreserved: number;
  districtsAdded: number;
  enabledPreserved: number;
  /** New entries that landed as `enabled: false` (parents and children combined). */
  newDisabledEntries: number;
  duplicatesCollapsed: number;
  needsReviewCount: number;
  conflicts: Array<{
    governorate: string;
    district: string;
    reason: string;
  }>;
}

export interface CoverageMergeResult {
  merged: ShippingGovernorate[];
  summary: CoverageMergeSummary;
}

/** Coerce a legacy district entry (string OR object) to the canonical object shape. */
function toDistrict(entry: LegacyDistrictEntry): ShippingDistrict {
  if (typeof entry === 'string') {
    return { name: entry.trim(), enabled: true, source: 'existing' };
  }
  return {
    ...entry,
    name: String(entry.name ?? '').trim(),
    enabled: entry.enabled !== false, // default true for legacy rows
    source: entry.source ?? 'existing',
  };
}

/**
 * Build the de-duplication key for a district within one governorate.
 *
 * Phase 22M decision: dedupe by NAME only (ignore parent) so the seed
 * never duplicates an entry the admin already added at the top level.
 * Example: live row has "الحي الأول" as a flat الجيزة district (the
 * pre-Phase-22M shape used flat names). The seed has "الحي الأول"
 * under parent "6 أكتوبر" AND another under "الشيخ زايد". Without
 * this rule the merge would render "الحي الأول" three times. The
 * spec is explicit: "Never delete existing items" → keep the admin's
 * top-level curation, drop the seed children that share its name.
 */
function districtKey(d: ShippingDistrict): string {
  return normalizeArabic(d.name);
}

export function mergeCoverage(
  liveRaw: LegacyGovernorate[] | null | undefined,
  seed: ShippingGovernorate[]
): CoverageMergeResult {
  const summary: CoverageMergeSummary = {
    governoratesPreserved: 0,
    governoratesAdded: 0,
    districtsPreserved: 0,
    districtsAdded: 0,
    enabledPreserved: 0,
    newDisabledEntries: 0,
    duplicatesCollapsed: 0,
    needsReviewCount: 0,
    conflicts: [],
  };

  const seedByName = new Map<string, ShippingGovernorate>();
  for (const g of seed) {
    seedByName.set(normalizeArabic(g.name), g);
  }

  const live = Array.isArray(liveRaw) ? liveRaw : [];
  const liveByName = new Map<string, LegacyGovernorate>();
  for (const g of live) {
    liveByName.set(normalizeArabic(String(g?.name ?? '')), g);
  }

  const merged: ShippingGovernorate[] = [];
  const consumedFromSeed = new Set<string>();

  // Pass 1 — preserve every live governorate in its original order.
  for (const liveGov of live) {
    const liveName = String(liveGov.name ?? '').trim();
    if (!liveName) continue;
    const seedGov = seedByName.get(normalizeArabic(liveName));
    if (seedGov) consumedFromSeed.add(normalizeArabic(seedGov.name));

    summary.governoratesPreserved += 1;

    // De-dup the live districts against themselves first (defensive
    // against accidental duplicates in the live row), then layer in
    // seed children.
    const seen = new Map<string, ShippingDistrict>();

    for (const raw of liveGov.districts ?? []) {
      const d = toDistrict(raw);
      if (!d.name) continue;
      const key = districtKey(d);
      if (seen.has(key)) {
        summary.duplicatesCollapsed += 1;
        continue;
      }
      seen.set(key, d);
      summary.districtsPreserved += 1;
      if (d.enabled) summary.enabledPreserved += 1;
      if (d.needsReview) summary.needsReviewCount += 1;
    }

    if (seedGov) {
      for (const seedD of seedGov.districts) {
        const seedNorm = districtKey(seedD);
        if (seen.has(seedNorm)) {
          // Live wins — the seed's metadata (type / parent / source)
          // does not override admin-curated state.
          summary.duplicatesCollapsed += 1;
          continue;
        }
        // Append a NEW disabled entry. Force enabled=false regardless
        // of what the seed claims, per spec.
        const newEntry: ShippingDistrict = {
          ...seedD,
          enabled: false,
          source: seedD.source ?? 'official',
        };
        seen.set(seedNorm, newEntry);
        summary.districtsAdded += 1;
        summary.newDisabledEntries += 1;
        if (newEntry.needsReview) summary.needsReviewCount += 1;
      }
    }

    merged.push({
      // Preserve every other field from live (id, fee, enabled, …) —
      // the merge MUST NOT change admin-curated values.
      ...(liveGov as ShippingGovernorate),
      name: liveName,
      enabled: liveGov.enabled !== false,
      fee: Number(liveGov.fee) || 0,
      source: liveGov.source ?? 'existing',
      districts: Array.from(seen.values()),
    });
  }

  // Pass 2 — append any seed governorate that didn't exist in live.
  for (const seedGov of seed) {
    const key = normalizeArabic(seedGov.name);
    if (consumedFromSeed.has(key) || liveByName.has(key)) continue;

    summary.governoratesAdded += 1;

    const seen = new Map<string, ShippingDistrict>();
    for (const seedD of seedGov.districts) {
      const dkey = districtKey(seedD);
      if (seen.has(dkey)) {
        summary.duplicatesCollapsed += 1;
        continue;
      }
      const newEntry: ShippingDistrict = {
        ...seedD,
        enabled: false,
        source: seedD.source ?? 'official',
      };
      seen.set(dkey, newEntry);
      summary.districtsAdded += 1;
      summary.newDisabledEntries += 1;
      if (newEntry.needsReview) summary.needsReviewCount += 1;
    }

    merged.push({
      ...seedGov,
      enabled: false, // forced disabled for new govs, per spec
      fee: Number(seedGov.fee) || 0,
      source: seedGov.source ?? 'official',
      districts: Array.from(seen.values()),
    });
  }

  return { merged, summary };
}
