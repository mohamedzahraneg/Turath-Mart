// ─────────────────────────────────────────────────────────────────────────────
// Phase 22M-Fix1 — coverage search index.
//
// Flattens the live `settings_regions` value (whatever shape it carries —
// legacy plain strings, modern { name, enabled } objects, or the Phase 22M
// hierarchy with `parent` / `type` / `source` / `needsReview`) into a
// single typed list ready for client-side autosuggest + smart-error UX.
//
// The flattening is OBJECT-shape-tolerant on purpose: the live row in
// production today carries a mix (the original 3 govs use the legacy
// `{ name, enabled }` shape; the 24 new govs imported in Phase 22M-Import
// carry full hierarchy metadata). Both must search well together.
//
// Pure functions, no side effects, no React or Supabase dependency.
// Safe in any context (server, edge, client).
// ─────────────────────────────────────────────────────────────────────────────
import { normalizeArabic } from '@/lib/utils/arabic';

/** A single shipping-search row. */
export interface CoverageSearchEntry {
  /** Governorate (ADM1) Arabic name. */
  governorateName: string;
  /** Whether the governorate as a whole is in coverage. */
  governorateEnabled: boolean;
  /** District (ADM2 / ADM3 / manual) Arabic name as stored. */
  areaName: string;
  /** Whether this entry is in coverage. */
  areaEnabled: boolean;
  /** Pre-computed display string for autosuggest rows. */
  displayName: string;
  /** Pre-normalised concatenation of every searchable field. */
  searchableText: string;
  /** Optional hierarchy classification — drives UI badges only. */
  type?: string;
  /** Parent district within the same governorate, if known. */
  parent?: string;
  /** Alternate spellings; matched alongside `areaName`. */
  aliases?: string[];
  /** Provenance — 'existing' / 'official' / 'manual_supplement'. */
  source?: string;
  /** Whether this entry should be reviewed by an admin before exposure. */
  needsReview?: boolean;
  /** The canonical name that should be persisted on an order. */
  canonicalDistrictName: string;
  /**
   * If this entry is a neighborhood (has a `parent`), the neighborhood
   * name itself; otherwise undefined. Lets callers decide whether to
   * show a separate hint or treat the entry as the city/area.
   */
  canonicalNeighborhoodName?: string;
}

// ─── Tolerant input types ────────────────────────────────────────────────────
// Keep these wide on purpose — every legacy shape the live row can hold
// must parse. We never write into these types from the helper.

export type RawDistrictEntry =
  | string
  | {
      name?: unknown;
      enabled?: unknown;
      type?: unknown;
      parent?: unknown;
      aliases?: unknown;
      source?: unknown;
      needsReview?: unknown;
    };

export interface RawGovernorate {
  name?: unknown;
  enabled?: unknown;
  fee?: unknown;
  districts?: unknown;
  source?: unknown;
}

// ─── Flatten ────────────────────────────────────────────────────────────────
function isStringList(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

/**
 * Flatten the live `settings_regions` array into a list of search
 * entries. The output is ordered: live order is preserved, the rare
 * case of duplicate names within a governorate keeps every occurrence
 * (the consumer dedupes if it needs to).
 *
 * Empty / nullish input returns `[]` so callers can chain `.filter`.
 */
export function buildCoverageSearchIndex(liveRaw: unknown): CoverageSearchEntry[] {
  if (!Array.isArray(liveRaw)) return [];
  const out: CoverageSearchEntry[] = [];

  for (const govRaw of liveRaw) {
    if (!govRaw || typeof govRaw !== 'object') continue;
    const g = govRaw as RawGovernorate;
    const govName = String(g.name ?? '').trim();
    if (!govName) continue;
    const govEnabled = g.enabled !== false;
    const districtsRaw = isStringList(g.districts) ? g.districts : [];

    for (const dRaw of districtsRaw) {
      const entry = buildEntryFromDistrict(dRaw, govName, govEnabled);
      if (entry) out.push(entry);
    }
  }

  return out;
}

function buildEntryFromDistrict(
  dRaw: unknown,
  govName: string,
  govEnabled: boolean
): CoverageSearchEntry | null {
  if (typeof dRaw === 'string') {
    const name = dRaw.trim();
    if (!name) return null;
    return makeEntry({
      areaName: name,
      areaEnabled: true,
      governorateName: govName,
      governorateEnabled: govEnabled,
    });
  }
  if (!dRaw || typeof dRaw !== 'object') return null;
  const d = dRaw as Exclude<RawDistrictEntry, string>;

  const name = String(d.name ?? '').trim();
  if (!name) return null;
  const enabled = d.enabled !== false; // default true for legacy rows
  const parent = typeof d.parent === 'string' && d.parent.trim() ? d.parent.trim() : undefined;
  const type = typeof d.type === 'string' ? d.type : undefined;
  const source = typeof d.source === 'string' ? d.source : undefined;
  const needsReview = d.needsReview === true;
  const aliases = Array.isArray(d.aliases)
    ? (d.aliases.filter((a) => typeof a === 'string' && a.trim()) as string[])
    : undefined;

  return makeEntry({
    areaName: name,
    areaEnabled: enabled,
    governorateName: govName,
    governorateEnabled: govEnabled,
    type,
    parent,
    aliases,
    source,
    needsReview,
  });
}

function makeEntry(input: {
  areaName: string;
  areaEnabled: boolean;
  governorateName: string;
  governorateEnabled: boolean;
  type?: string;
  parent?: string;
  aliases?: string[];
  source?: string;
  needsReview?: boolean;
}): CoverageSearchEntry {
  const isNeighborhood = !!input.parent;
  const displayName = isNeighborhood
    ? `${input.areaName} — ${input.parent} — ${input.governorateName}`
    : `${input.areaName} — ${input.governorateName}`;

  const searchableTokens = [
    input.areaName,
    input.governorateName,
    input.parent ?? '',
    input.type ?? '',
    ...(input.aliases ?? []),
  ];
  const searchableText = searchableTokens
    .map((t) => normalizeArabic(t))
    .filter(Boolean)
    .join(' | ');

  return {
    governorateName: input.governorateName,
    governorateEnabled: input.governorateEnabled,
    areaName: input.areaName,
    areaEnabled: input.areaEnabled,
    displayName,
    searchableText,
    type: input.type,
    parent: input.parent,
    aliases: input.aliases,
    source: input.source,
    needsReview: input.needsReview,
    // Persisted district — for a neighborhood, the city/area is the
    // canonical entry the order's `district` field should carry.
    canonicalDistrictName: isNeighborhood ? (input.parent as string) : input.areaName,
    canonicalNeighborhoodName: isNeighborhood ? input.areaName : undefined,
  };
}

// ─── Search helpers ──────────────────────────────────────────────────────────

/** Returns true if `entry` matches the (already normalised) needle. */
export function entryMatches(entry: CoverageSearchEntry, neeleNorm: string): boolean {
  if (!neeleNorm) return true;
  return entry.searchableText.includes(neeleNorm);
}

export interface CoverageSearchOptions {
  /** Restrict to a specific governorate (Arabic name). */
  governorate?: string;
  /** If true, only return entries with `areaEnabled === true`. */
  enabledOnly?: boolean;
  /** If true, also drop entries whose governorate is disabled. */
  governorateEnabledOnly?: boolean;
  /** Cap on the number of entries returned. Defaults to no cap. */
  limit?: number;
}

/**
 * Filter the index. A null/empty `query` means "no text filter" — the
 * other flags still apply.
 */
export function searchCoverage(
  index: CoverageSearchEntry[],
  query: string | null | undefined,
  opts: CoverageSearchOptions = {}
): CoverageSearchEntry[] {
  const needle = normalizeArabic(query);
  const govNorm = opts.governorate ? normalizeArabic(opts.governorate) : null;

  const out: CoverageSearchEntry[] = [];
  for (const e of index) {
    if (govNorm && normalizeArabic(e.governorateName) !== govNorm) continue;
    if (opts.enabledOnly && !e.areaEnabled) continue;
    if (opts.governorateEnabledOnly && !e.governorateEnabled) continue;
    if (!entryMatches(e, needle)) continue;
    out.push(e);
    if (opts.limit && out.length >= opts.limit) break;
  }
  return out;
}

/** Find the canonical entry for an exact `areaName` match in a governorate. */
export function findExactAreaInGov(
  index: CoverageSearchEntry[],
  governorate: string,
  query: string
): CoverageSearchEntry | null {
  const govNorm = normalizeArabic(governorate);
  const qNorm = normalizeArabic(query);
  if (!govNorm || !qNorm) return null;
  return (
    index.find(
      (e) => normalizeArabic(e.governorateName) === govNorm && normalizeArabic(e.areaName) === qNorm
    ) ?? null
  );
}

/** Distinct list of areas (name + enabled) within a governorate, in insertion order. */
export function listAreasInGov(
  index: CoverageSearchEntry[],
  governorate: string
): Array<{ name: string; enabled: boolean; type?: string; source?: string }> {
  const govNorm = normalizeArabic(governorate);
  const seen = new Set<string>();
  const out: Array<{ name: string; enabled: boolean; type?: string; source?: string }> = [];
  for (const e of index) {
    if (normalizeArabic(e.governorateName) !== govNorm) continue;
    // For neighborhoods, the parent is the area; for top-level entries
    // the entry itself is the area.
    const areaName = e.parent ?? e.areaName;
    const key = normalizeArabic(areaName);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: areaName,
      enabled: e.parent ? true : e.areaEnabled,
      type: e.parent ? undefined : e.type,
      source: e.parent ? undefined : e.source,
    });
  }
  return out;
}

/** Distinct list of neighborhoods under a given governorate + parent area. */
export function listNeighborhoodsInArea(
  index: CoverageSearchEntry[],
  governorate: string,
  area: string
): CoverageSearchEntry[] {
  const govNorm = normalizeArabic(governorate);
  const areaNorm = normalizeArabic(area);
  const out: CoverageSearchEntry[] = [];
  for (const e of index) {
    if (!e.parent) continue;
    if (normalizeArabic(e.governorateName) !== govNorm) continue;
    if (normalizeArabic(e.parent) !== areaNorm) continue;
    out.push(e);
  }
  return out;
}

// ─── Smart error message helpers ─────────────────────────────────────────────

export type CoverageDecisionKind =
  | 'empty'
  | 'valid'
  | 'neighborhood-other-area' // typed entry is a neighborhood under a different area in the same gov
  | 'disabled-in-gov' // matches an entry but it's disabled in the same gov
  | 'gov-disabled' // gov as a whole is disabled
  | 'cross-gov' // exact match exists, but in a different governorate
  | 'unknown'; // not found anywhere

export interface CoverageDecision {
  kind: CoverageDecisionKind;
  /** The matched entry (if any) used to derive the message. */
  match?: CoverageSearchEntry;
  /** Cross-gov hits, distinct on governorate. */
  crossGovs?: string[];
  /** Human Arabic message; null for `valid` / `empty`. */
  message: string | null;
}

/**
 * Build a single decision describing what the typed area means in the
 * context of `governorate`. Re-used by AddOrderModal for both the inline
 * hint and the submit validator so the wording cannot drift.
 *
 * Priority ladder (matches the Phase 22M spec):
 *   1. empty input            → 'empty', no message.
 *   2. exact area match in gov, enabled, gov enabled
 *                              → 'valid'.
 *   3. exact match in gov but gov is disabled
 *                              → 'gov-disabled'.
 *   4. neighborhood (entry has parent) match in current gov but parent
 *      != current area selection (here we treat current area as not yet
 *      narrowed; just surface the parent + governorate)
 *                              → 'neighborhood-other-area'.
 *   5. exact area in current gov but entry disabled
 *                              → 'disabled-in-gov'.
 *   6. exact area in another gov
 *                              → 'cross-gov'.
 *   7. otherwise
 *                              → 'unknown'.
 */
export function decideAreaCoverage(
  index: CoverageSearchEntry[],
  governorate: string,
  query: string
): CoverageDecision {
  const q = (query ?? '').trim();
  if (!q) return { kind: 'empty', message: null };
  const qNorm = normalizeArabic(q);
  const govNorm = normalizeArabic(governorate);

  // Pass 1 — exact area match in current gov (top-level entry, not a
  // neighborhood — the city/area level)
  let inGov: CoverageSearchEntry | null = null;
  let inGovDisabled: CoverageSearchEntry | null = null;
  let neighborhoodInGov: CoverageSearchEntry | null = null;
  const crossGovHits: CoverageSearchEntry[] = [];
  for (const e of index) {
    const sameGov = govNorm && normalizeArabic(e.governorateName) === govNorm;
    if (normalizeArabic(e.areaName) !== qNorm) continue;
    if (sameGov) {
      if (e.parent) {
        // It's a neighborhood under some parent within the same gov.
        if (!neighborhoodInGov) neighborhoodInGov = e;
      } else if (e.areaEnabled) {
        if (!inGov) inGov = e;
      } else {
        if (!inGovDisabled) inGovDisabled = e;
      }
    } else {
      crossGovHits.push(e);
    }
  }

  if (inGov) {
    if (!inGov.governorateEnabled) {
      return {
        kind: 'gov-disabled',
        match: inGov,
        message: `محافظة ${inGov.governorateName} غير مفعلة ضمن التغطية حاليًا.`,
      };
    }
    return { kind: 'valid', match: inGov, message: null };
  }

  if (neighborhoodInGov) {
    return {
      kind: 'neighborhood-other-area',
      match: neighborhoodInGov,
      message: `هذا الحي تابع إلى ${neighborhoodInGov.parent} - محافظة ${neighborhoodInGov.governorateName}.`,
    };
  }

  if (inGovDisabled) {
    return {
      kind: 'disabled-in-gov',
      match: inGovDisabled,
      message: 'هذه المنطقة موجودة ولكنها غير مفعلة ضمن التغطية حاليًا.',
    };
  }

  if (crossGovHits.length > 0) {
    const seen = new Set<string>();
    const govs: string[] = [];
    for (const h of crossGovHits) {
      if (seen.has(h.governorateName)) continue;
      seen.add(h.governorateName);
      govs.push(h.governorateName);
    }
    if (govs.length === 1) {
      return {
        kind: 'cross-gov',
        crossGovs: govs,
        message: `هذه المنطقة تابعة إلى محافظة ${govs[0]}. برجاء تغيير المحافظة لاختيارها.`,
      };
    }
    return {
      kind: 'cross-gov',
      crossGovs: govs,
      message: `هذه المنطقة تابعة إلى محافظات: ${govs.join('، ')}. برجاء تغيير المحافظة لاختيارها.`,
    };
  }

  return {
    kind: 'unknown',
    message: 'هذه المنطقة خارج نطاق التغطية حاليًا.',
  };
}

export interface NeighborhoodDecision {
  kind:
    | 'empty'
    | 'valid'
    | 'other-area' // exists but under a different parent in same gov
    | 'cross-gov' // exists in another governorate
    | 'disabled' // exists under selected area but disabled
    | 'unknown';
  match?: CoverageSearchEntry;
  message: string | null;
}

/**
 * Decide what a neighborhood query means once the user has already
 * chosen a governorate AND an area. Used by the second input in
 * AddOrderModal.
 *
 * `area` is the parent the user selected/typed at the area level; if
 * empty, this returns a hint that points the user to a parent +
 * governorate.
 */
export function decideNeighborhoodCoverage(
  index: CoverageSearchEntry[],
  governorate: string,
  area: string,
  query: string
): NeighborhoodDecision {
  const q = (query ?? '').trim();
  if (!q) return { kind: 'empty', message: null };
  const qNorm = normalizeArabic(q);
  const govNorm = normalizeArabic(governorate);
  const areaNorm = normalizeArabic(area);

  // Find a neighborhood entry matching the typed name anywhere in
  // this gov, then narrow.
  let inAreaEnabled: CoverageSearchEntry | null = null;
  let inAreaDisabled: CoverageSearchEntry | null = null;
  let inGovOtherArea: CoverageSearchEntry | null = null;
  const crossGovHits: CoverageSearchEntry[] = [];

  for (const e of index) {
    if (!e.parent) continue;
    if (normalizeArabic(e.areaName) !== qNorm) continue;
    const sameGov = govNorm && normalizeArabic(e.governorateName) === govNorm;
    if (sameGov) {
      if (areaNorm && normalizeArabic(e.parent) === areaNorm) {
        if (e.areaEnabled) {
          if (!inAreaEnabled) inAreaEnabled = e;
        } else {
          if (!inAreaDisabled) inAreaDisabled = e;
        }
      } else if (!inGovOtherArea) {
        inGovOtherArea = e;
      }
    } else {
      crossGovHits.push(e);
    }
  }

  if (inAreaEnabled) return { kind: 'valid', match: inAreaEnabled, message: null };
  if (inAreaDisabled) {
    return {
      kind: 'disabled',
      match: inAreaDisabled,
      message: 'هذا الحي موجود ولكنه غير مفعل ضمن التغطية حاليًا.',
    };
  }
  if (inGovOtherArea) {
    return {
      kind: 'other-area',
      match: inGovOtherArea,
      message: `هذا الحي تابع إلى ${inGovOtherArea.parent} - محافظة ${inGovOtherArea.governorateName}.`,
    };
  }
  if (crossGovHits.length > 0) {
    const first = crossGovHits[0];
    return {
      kind: 'cross-gov',
      match: first,
      message: `هذا الحي تابع إلى ${first.parent} - محافظة ${first.governorateName}.`,
    };
  }
  return {
    kind: 'unknown',
    message: 'هذا الحي خارج نطاق التغطية حاليًا.',
  };
}
