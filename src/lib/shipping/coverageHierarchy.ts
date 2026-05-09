// ─────────────────────────────────────────────────────────────────────────────
// Phase 22N — coverage hierarchy transformer.
//
// Reads the raw `settings_regions` array (mixed shape: legacy strings,
// modern flat objects with `parent`, hierarchy objects with `children`)
// and produces a CLEAN nested structure where every governorate's
// `districts` array contains only parent-level entries, each carrying
// `children?: ShippingDistrict[]`.
//
// Invariants — every transformer in this file MUST satisfy these:
//
//   1. No data loss. Every input district appears exactly once in the
//      output, either as a top-level area or as a child of its
//      detected parent.
//   2. No silent disabling. `enabled` flags are preserved verbatim.
//      Missing flags default to `true` only on the legacy strings,
//      matching every reader's expectation today.
//   3. No silent fee changes. `fee` and `shippingFee` round-trip
//      unchanged. The transformer never invents a fee.
//   4. No reordering of admin curation. Within a governorate, the
//      RELATIVE order of admin-curated entries is preserved. New
//      placeholders go at the end of their parent's `children` list.
//   5. No DB write. This file is pure — every function returns a fresh
//      array; the input is never mutated.
//
// Detection rules (in priority order, short-circuiting):
//
//   A. If the entry already has `parent`, trust it. The transformer
//      moves the entry under the matching parent.
//   B. If `manualHierarchyRules.findManualParents(...)` returns
//      exactly ONE candidate, attach to it.
//   C. If the candidate set is empty, leave the entry top-level.
//   D. If multiple candidates exist (e.g. `الحي الأول` belongs under
//      both 6 أكتوبر and الشيخ زايد), the transformer CLONES the
//      entry once per candidate parent — the same name can validly
//      live under multiple parents in the same governorate. The
//      child uniqueness key is (governorate, parent, name); it is
//      NOT (governorate, name). The user disambiguates by selecting
//      the area first; the search index emits one row per
//      (parent, child) pair so the customer sees both options.
//
// Adding a placeholder parent:
//
//   When a child has a parent name that doesn't match any existing
//   top-level entry in the governorate, the transformer creates a
//   placeholder parent: `enabled: false`, `source: 'manual_supplement'`,
//   `needsReview: true`. The placeholder cannot accidentally accept
//   orders because `enabled: false` blocks submission. Admins can then
//   open the placeholder, set a fee, and flip enabled in the settings
//   UI; the underlying live row stays untouched until they save.
// ─────────────────────────────────────────────────────────────────────────────

import { normalizeArabic } from '@/lib/utils/arabic';
import type { ShippingDistrict, ShippingGovernorate, ShippingDistrictType } from './types';
import {
  findManualParents,
  isManualParent,
  listManualParents,
  type ManualHierarchyParent,
} from './manualHierarchyRules';

// ─── Public types ────────────────────────────────────────────────────────────

/** A single search row produced by `flattenCoverageHierarchy`. */
export interface CoverageSearchEntry {
  governorateName: string;
  governorateEnabled: boolean;
  /**
   * Hierarchy depth — 0 governorate, 1 area, 2 child neighborhood. Lets
   * UI surface a different chip / icon per level without re-deriving.
   */
  level: 0 | 1 | 2;
  /**
   * Parent area Arabic name when `level === 2`. Otherwise undefined.
   */
  parentAreaName?: string;
  parentAreaEnabled?: boolean;
  /** The entry's own name (governorate / area / neighborhood). */
  name: string;
  /** Pre-built display string for autosuggest rows. */
  displayName: string;
  enabled: boolean;
  source?: ShippingDistrict['source'];
  needsReview?: boolean;
  type?: ShippingDistrictType;
  aliases?: string[];
  fee?: number | null;
  shippingFee?: number | null;
  /** Pre-normalised concatenation of every searchable field. */
  searchableText: string;
  /** The canonical area name to commit on the order's `district` field. */
  canonicalDistrictName: string;
  /** The neighborhood name (only when level === 2). */
  canonicalNeighborhoodName?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function isStringList(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

/** Coerce a legacy entry to a fresh `ShippingDistrict` object. */
function toDistrict(raw: unknown): ShippingDistrict | null {
  if (typeof raw === 'string') {
    const name = raw.trim();
    if (!name) return null;
    return { name, enabled: true };
  }
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = String(r.name ?? '').trim();
  if (!name) return null;

  const out: ShippingDistrict = {
    name,
    // default true matches every reader today (legacy rows often omit
    // `enabled`); explicit `false` is preserved.
    enabled: r.enabled !== false,
  };
  if (typeof r.id === 'string') out.id = r.id;
  if (typeof r.type === 'string') out.type = r.type as ShippingDistrictType;
  if (typeof r.parent === 'string' && r.parent.trim()) out.parent = r.parent.trim();
  if (Array.isArray(r.aliases)) {
    const aliases = r.aliases.filter((a): a is string => typeof a === 'string' && !!a.trim());
    if (aliases.length > 0) out.aliases = aliases;
  }
  if (typeof r.source === 'string') {
    out.source = r.source as ShippingDistrict['source'];
  }
  if (r.needsReview === true) out.needsReview = true;
  // Phase 22N — both fee field names round-trip
  if (r.fee === null) out.fee = null;
  else if (typeof r.fee === 'number' && Number.isFinite(r.fee)) out.fee = r.fee;
  if (r.shippingFee === null) out.shippingFee = null;
  else if (typeof r.shippingFee === 'number' && Number.isFinite(r.shippingFee)) {
    out.shippingFee = r.shippingFee;
  }
  if (Array.isArray(r.children)) {
    const children = r.children.map(toDistrict).filter((c): c is ShippingDistrict => !!c);
    if (children.length > 0) out.children = children;
  }
  return out;
}

function dedupKey(name: string): string {
  return normalizeArabic(name);
}

// ─── normalizeCoverageHierarchy ──────────────────────────────────────────────

/**
 * Public entry point. Takes the raw `settings_regions` array and
 * returns a normalised, hierarchical version. Pure — never mutates
 * input.
 */
export function normalizeCoverageHierarchy(liveRaw: unknown): ShippingGovernorate[] {
  if (!Array.isArray(liveRaw)) return [];
  const out: ShippingGovernorate[] = [];

  for (const govRaw of liveRaw) {
    if (!govRaw || typeof govRaw !== 'object') continue;
    const g = govRaw as Record<string, unknown>;
    const govName = String(g.name ?? '').trim();
    if (!govName) continue;

    // Coerce every district (string or object, with or without children)
    const flat: ShippingDistrict[] = [];
    if (isStringList(g.districts)) {
      for (const dRaw of g.districts) {
        const d = toDistrict(dRaw);
        if (!d) continue;
        flat.push(d);
        // If the input already has `children`, we'll honour them but
        // we ALSO add the children to the flat pool so the rules /
        // parent-pointer detection still applies. The transformer
        // will re-attach them under the right parent.
        if (d.children && d.children.length > 0) {
          for (const c of d.children) {
            // children carry their parent implicitly; copy that into
            // the flat copy so downstream rules see it.
            const copy: ShippingDistrict = { ...c, parent: c.parent ?? d.name };
            // remove nested children to avoid recursion (we never
            // observe more than two levels in production data)
            delete copy.children;
            flat.push(copy);
          }
        }
      }
    }

    const govShape: ShippingGovernorate = {
      ...(g as unknown as ShippingGovernorate),
      name: govName,
      enabled: g.enabled !== false,
      districts: groupGovernorate(govName, flat),
    };
    if (typeof g.fee === 'number' || g.fee === null) {
      govShape.fee = g.fee as number | null;
    }
    if (typeof g.shippingFee === 'number' || g.shippingFee === null) {
      govShape.shippingFee = g.shippingFee as number | null;
    }
    out.push(govShape);
  }

  return out;
}

/**
 * Build the hierarchical `districts` for one governorate. Returns
 * top-level areas, each with `children` populated.
 */
function groupGovernorate(govName: string, flat: ShippingDistrict[]): ShippingDistrict[] {
  // Step 1: separate items that EXPLICITLY have a parent pointer from
  // items that don't. Parent-pointer wins over manual rules — admin
  // curation > heuristic.
  const explicitChildren: ShippingDistrict[] = [];
  const orphans: ShippingDistrict[] = [];
  for (const d of flat) {
    if (d.parent && d.parent.trim()) explicitChildren.push(d);
    else orphans.push(d);
  }

  // Step 2: among orphans, identify which are CURATED top-level
  // parents (`isManualParent`). Those stay top-level; the rest
  // proceed to rule lookup.
  const curatedParents: ShippingDistrict[] = [];
  const remaining: ShippingDistrict[] = [];
  for (const d of orphans) {
    if (isManualParent(govName, d.name)) curatedParents.push(d);
    else remaining.push(d);
  }

  // Step 3: try to attach `remaining` orphans via `findManualParents`.
  //
  // Phase 22N-Fix: same name CAN validly exist under multiple parents in
  // the same governorate (e.g. الحي الأول under both مدينة 6 اكتوبر
  // and مدينة الشيخ زايد). When the rules return more than one
  // candidate, we CLONE the entry under each parent — preserving its
  // `enabled` / `fee` / `source` flags — instead of keeping it
  // top-level + flagged for review. The user disambiguates by
  // selecting the parent area first, and the search index renders one
  // row per (parent, child) pair so customers see both options.
  //
  // Uniqueness key for a child becomes (governorate, parent, child
  // normalised name); the duplicate-collapse rule in Step 5 keys by
  // the same triple, so it's safe to push N copies here.
  const orphanedTopLevel: ShippingDistrict[] = [];
  const attachedFromRules: ShippingDistrict[] = []; // (district, parentName) tuples
  for (const d of remaining) {
    const candidates = findManualParents(govName, d.name);
    if (candidates.length === 0) {
      orphanedTopLevel.push(d);
      continue;
    }
    for (const cand of candidates) {
      attachedFromRules.push({ ...d, parent: cand.parent });
    }
  }

  // Step 4: assemble top-level. Order:
  //   (i)   curated parents in input order
  //   (ii)  orphans that stayed top-level in input order
  //   (iii) placeholder parents that don't yet exist in input but
  //         were referenced by a child via `parent` pointer or via
  //         manual rules
  const topLevel: ShippingDistrict[] = [];
  const topLevelByKey = new Map<string, number>();

  // (i)
  for (const p of curatedParents) {
    const key = dedupKey(p.name);
    if (topLevelByKey.has(key)) continue;
    topLevelByKey.set(key, topLevel.length);
    topLevel.push({ ...p, children: [] });
  }
  // (ii)
  for (const o of orphanedTopLevel) {
    const key = dedupKey(o.name);
    if (topLevelByKey.has(key)) continue;
    topLevelByKey.set(key, topLevel.length);
    topLevel.push({ ...o, children: [] });
  }

  // Step 5: for every (explicitChildren ∪ attachedFromRules), find the
  // parent in topLevel. Create a placeholder if missing.
  const allChildren: ShippingDistrict[] = [...explicitChildren, ...attachedFromRules];
  const seenChildKey = new Set<string>(); // dedup children with same name under same parent
  for (const c of allChildren) {
    const parentName = c.parent ?? '';
    const parentKey = dedupKey(parentName);
    let idx = topLevelByKey.get(parentKey);
    if (idx === undefined) {
      // Create placeholder parent
      const placeholder: ShippingDistrict = {
        name: parentName,
        enabled: false,
        source: 'manual_supplement',
        needsReview: true,
        children: [],
      };
      idx = topLevel.length;
      topLevelByKey.set(parentKey, idx);
      topLevel.push(placeholder);
    }
    const parent = topLevel[idx];
    parent.children = parent.children ?? [];
    const dedup = `${parentKey}::${dedupKey(c.name)}`;
    if (seenChildKey.has(dedup)) continue;
    seenChildKey.add(dedup);
    parent.children.push(c);
  }

  // Step 6: for every curated parent that's a known commercial label,
  // PROPOSE missing children placeholders so the new-order modal can
  // show them in the dropdown. Each placeholder is
  // `enabled: false, source: 'manual_supplement', needsReview: true`
  // — never auto-enabled.
  for (let i = 0; i < topLevel.length; i += 1) {
    const p = topLevel[i];
    if (!isManualParent(govName, p.name)) continue;
    const parents = listManualParents(govName);
    const block = parents.find(
      (mp) =>
        normalizeArabic(mp.name) === normalizeArabic(p.name) ||
        (mp.aliases ?? []).some((a) => normalizeArabic(a) === normalizeArabic(p.name))
    );
    if (!block) continue;
    const existingChildren = (p.children ?? []).map((c) => normalizeArabic(c.name));
    for (const childName of block.children) {
      if (existingChildren.includes(normalizeArabic(childName))) continue;
      // Skip if this name is itself a top-level under the same gov
      // (i.e. an enabled curated parent); attaching it as a child
      // would duplicate the entry. Examples: under 6 أكتوبر, the
      // proposed child `الحي الأول` may already be a top-level entry
      // in the live row — skip.
      const childKey = dedupKey(childName);
      const existsTopLevel = topLevelByKey.has(childKey);
      if (existsTopLevel) continue;

      p.children = p.children ?? [];
      p.children.push({
        name: childName,
        enabled: false,
        source: 'manual_supplement',
        needsReview: true,
        type: 'neighborhood',
        parent: p.name,
      });
    }
    void block; // referenced for clarity; satisfies unused-var if any
  }
  void parentsByPlaceholder(); // tiny ref to keep helper typed; see below

  return topLevel;
}

// no-op helper kept for symmetry with the comments above
function parentsByPlaceholder(): void {
  /* intentionally empty */
}

// ─── flattenCoverageHierarchy ────────────────────────────────────────────────

/**
 * Flatten a normalised hierarchy into a search index. Each entry
 * carries its level + parent context so consumers can render
 * autosuggest rows with one shape.
 *
 * The level-0 governorate row is included so the new-order modal can
 * surface "محافظة القاهرة" hits when the user types a governorate
 * name.
 */
export function flattenCoverageHierarchy(regions: ShippingGovernorate[]): CoverageSearchEntry[] {
  const out: CoverageSearchEntry[] = [];
  for (const gov of regions) {
    const govName = gov.name;
    const govEnabled = gov.enabled !== false;
    out.push(makeGovernorateEntry(gov));
    for (const area of gov.districts ?? []) {
      out.push(makeAreaEntry(govName, govEnabled, area));
      for (const child of area.children ?? []) {
        out.push(makeNeighborhoodEntry(govName, govEnabled, area, child));
      }
    }
  }
  return out;
}

function makeGovernorateEntry(gov: ShippingGovernorate): CoverageSearchEntry {
  const govName = gov.name;
  const enabled = gov.enabled !== false;
  return {
    governorateName: govName,
    governorateEnabled: enabled,
    level: 0,
    name: govName,
    displayName: `محافظة ${govName}`,
    enabled,
    source: gov.source,
    fee: gov.fee ?? null,
    shippingFee: gov.shippingFee ?? null,
    type: 'governorate',
    canonicalDistrictName: '',
    searchableText: normalizeArabic(govName),
  };
}

function makeAreaEntry(
  govName: string,
  govEnabled: boolean,
  area: ShippingDistrict
): CoverageSearchEntry {
  const tokens = [area.name, govName, area.type ?? '', ...(area.aliases ?? [])];
  return {
    governorateName: govName,
    governorateEnabled: govEnabled,
    level: 1,
    name: area.name,
    displayName: `${area.name} — محافظة ${govName}`,
    enabled: area.enabled !== false,
    source: area.source,
    needsReview: area.needsReview,
    type: area.type,
    aliases: area.aliases,
    fee: area.fee ?? null,
    shippingFee: area.shippingFee ?? null,
    canonicalDistrictName: area.name,
    searchableText: tokens
      .map((t) => normalizeArabic(t))
      .filter(Boolean)
      .join(' | '),
  };
}

function makeNeighborhoodEntry(
  govName: string,
  govEnabled: boolean,
  area: ShippingDistrict,
  child: ShippingDistrict
): CoverageSearchEntry {
  const tokens = [child.name, area.name, govName, child.type ?? '', ...(child.aliases ?? [])];
  return {
    governorateName: govName,
    governorateEnabled: govEnabled,
    level: 2,
    parentAreaName: area.name,
    parentAreaEnabled: area.enabled !== false,
    name: child.name,
    displayName: `${child.name} — تابع إلى ${area.name} — محافظة ${govName}`,
    enabled: child.enabled !== false,
    source: child.source,
    needsReview: child.needsReview,
    type: child.type,
    aliases: child.aliases,
    fee: child.fee ?? null,
    shippingFee: child.shippingFee ?? null,
    canonicalDistrictName: area.name,
    canonicalNeighborhoodName: child.name,
    searchableText: tokens
      .map((t) => normalizeArabic(t))
      .filter(Boolean)
      .join(' | '),
  };
}

// ─── Lookup helpers ──────────────────────────────────────────────────────────

export function getAreaChildren(
  governorateName: string,
  areaName: string,
  regions: ShippingGovernorate[]
): ShippingDistrict[] {
  const govNorm = normalizeArabic(governorateName);
  const areaNorm = normalizeArabic(areaName);
  for (const gov of regions) {
    if (normalizeArabic(gov.name) !== govNorm) continue;
    for (const area of gov.districts ?? []) {
      if (normalizeArabic(area.name) !== areaNorm) continue;
      const aliasNorms = (area.aliases ?? []).map(normalizeArabic);
      if (normalizeArabic(area.name) === areaNorm || aliasNorms.includes(areaNorm)) {
        return area.children ?? [];
      }
    }
  }
  return [];
}

export function findArea(
  governorateName: string,
  areaName: string,
  regions: ShippingGovernorate[]
): ShippingDistrict | null {
  const govNorm = normalizeArabic(governorateName);
  const areaNorm = normalizeArabic(areaName);
  for (const gov of regions) {
    if (normalizeArabic(gov.name) !== govNorm) continue;
    for (const area of gov.districts ?? []) {
      if (normalizeArabic(area.name) === areaNorm) return area;
      const aliasNorms = (area.aliases ?? []).map(normalizeArabic);
      if (aliasNorms.includes(areaNorm)) return area;
    }
  }
  return null;
}

export function findNeighborhood(
  governorateName: string,
  areaName: string,
  neighborhoodName: string,
  regions: ShippingGovernorate[]
): ShippingDistrict | null {
  const area = findArea(governorateName, areaName, regions);
  if (!area || !area.children) return null;
  const nbNorm = normalizeArabic(neighborhoodName);
  for (const c of area.children) {
    if (normalizeArabic(c.name) === nbNorm) return c;
    const aliasNorms = (c.aliases ?? []).map(normalizeArabic);
    if (aliasNorms.includes(nbNorm)) return c;
  }
  return null;
}

/**
 * Find every (governorate, area) pair under which a neighborhood
 * matching the given name exists. Used by the order modal's
 * unselected-area path: typing `النرجس` with NO area selection should
 * still surface "تابع إلى القاهرة الجديدة - محافظة القاهرة".
 */
export function findNeighborhoodOccurrences(
  neighborhoodName: string,
  regions: ShippingGovernorate[]
): Array<{
  governorate: ShippingGovernorate;
  area: ShippingDistrict;
  child: ShippingDistrict;
}> {
  const nbNorm = normalizeArabic(neighborhoodName);
  const out: Array<{
    governorate: ShippingGovernorate;
    area: ShippingDistrict;
    child: ShippingDistrict;
  }> = [];
  if (!nbNorm) return out;
  for (const gov of regions) {
    for (const area of gov.districts ?? []) {
      for (const child of area.children ?? []) {
        if (normalizeArabic(child.name) === nbNorm) {
          out.push({ governorate: gov, area, child });
          continue;
        }
        const aliasNorms = (child.aliases ?? []).map(normalizeArabic);
        if (aliasNorms.includes(nbNorm)) {
          out.push({ governorate: gov, area, child });
        }
      }
    }
  }
  return out;
}

/** Type guard / clarity helper. */
export function isParent(area: ShippingDistrict): boolean {
  return Array.isArray(area.children) && area.children.length > 0;
}

// Re-export so consumers can `import { listManualParents } from
// '@/lib/shipping/coverageHierarchy'` and get the rule helpers in one
// import — keeps the public API tight.
export { listManualParents, isManualParent } from './manualHierarchyRules';
export type { ManualHierarchyParent };
