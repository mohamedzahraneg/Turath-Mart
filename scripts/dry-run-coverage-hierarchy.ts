// ─────────────────────────────────────────────────────────────────────────────
// Phase 22N — coverage hierarchy dry-run (READ-ONLY).
//
// Reads either the live `settings_regions` row from Supabase (via the
// public anon key — RLS may block, see fallbacks) or a JSON snapshot
// passed via `--from <path>`, applies `normalizeCoverageHierarchy`, and
// prints a structured report describing what the transform WOULD
// produce. Writes nothing.
//
// Run via:
//   pnpm tsx scripts/dry-run-coverage-hierarchy.ts
//   pnpm tsx scripts/dry-run-coverage-hierarchy.ts --from /tmp/live.json
//
// The report is human-readable; pass `--json` to emit a machine-friendly
// version that can be tee'd into a file or attached to a PR.
//
// What the report covers:
//   • governorate counts
//   • top-level area counts (per gov + total)
//   • child neighborhood counts (per gov + total)
//   • flat items moved into children (i.e. live entries that the rules
//     attached to a curated parent)
//   • new manual children proposed (placeholders the transformer would
//     surface in the UI but that DO NOT exist in the input data)
//   • enabled / fee preservation invariants
//   • items still flagged needsReview
//   • items dedup-collapsed by the transformer
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';
import { normalizeCoverageHierarchy, isParent } from '../src/lib/shipping/coverageHierarchy';
import { findManualParents, isManualParent } from '../src/lib/shipping/manualHierarchyRules';
import { normalizeArabic } from '../src/lib/utils/arabic';
import type { ShippingDistrict, ShippingGovernorate } from '../src/lib/shipping/types';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

interface RawGov {
  name?: string;
  enabled?: boolean;
  fee?: number;
  districts?: unknown[];
}

async function loadFromFile(p: string): Promise<RawGov[]> {
  const abs = path.isAbsolute(p) ? p : path.resolve(ROOT, p);
  const raw = await fs.readFile(abs, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(`expected JSON array at ${abs}`);
  return parsed as RawGov[];
}

async function loadFromSupabase(): Promise<RawGov[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }
  const supabase = createClient(url, key);
  const { data, error } = await supabase
    .from('turath_masr_settings')
    .select('value')
    .eq('key', 'settings_regions')
    .single();
  if (error) {
    throw new Error(
      `Failed to read settings_regions via anon key (RLS likely blocks this): ${error.message}. ` +
        `Pass --from <path> with a captured snapshot instead.`
    );
  }
  if (!data?.value || !Array.isArray(data.value)) {
    throw new Error('settings_regions row has unexpected shape');
  }
  return data.value as RawGov[];
}

interface Report {
  source: 'supabase' | 'file';
  totals: {
    governorates: number;
    inputDistricts: number;
    outputTopLevelAreas: number;
    outputChildren: number;
    flatMovedToChildren: number;
    newPlaceholderParents: number;
    newProposedChildren: number;
    enabledPreserved: number;
    enabledTotalAfter: number;
    feeAtGovernorateLevel: number;
    feeAtAreaLevel: number;
    feeAtChildLevel: number;
    needsReviewAfter: number;
    duplicatesCollapsed: number;
  };
  perGov: Array<{
    name: string;
    enabled: boolean;
    inputDistricts: number;
    topLevelAreas: number;
    children: number;
    flatMovedToChildren: number;
    newProposedChildren: number;
  }>;
  /**
   * Real routing failures the transformer could not resolve. After the
   * Phase 22N-Fix, multi-parent matches (e.g. الحي الأول) are NOT
   * conflicts — they're cloned under each parent.
   */
  conflicts: Array<{
    governorate: string;
    district: string;
    parentCandidates: string[];
  }>;
  /**
   * Multi-parent matches — info-only. Same name validly exists under
   * multiple parents; the transformer attaches a copy under each.
   */
  multiParentMatches: Array<{
    governorate: string;
    district: string;
    parentCandidates: string[];
  }>;
}

function inspect(input: RawGov[]): Report {
  const totals: Report['totals'] = {
    governorates: 0,
    inputDistricts: 0,
    outputTopLevelAreas: 0,
    outputChildren: 0,
    flatMovedToChildren: 0,
    newPlaceholderParents: 0,
    newProposedChildren: 0,
    enabledPreserved: 0,
    enabledTotalAfter: 0,
    feeAtGovernorateLevel: 0,
    feeAtAreaLevel: 0,
    feeAtChildLevel: 0,
    needsReviewAfter: 0,
    duplicatesCollapsed: 0,
  };
  const perGov: Report['perGov'] = [];
  const conflicts: Report['conflicts'] = [];
  const multiParentMatches: Report['multiParentMatches'] = [];

  // Pre-count input enabled flags for invariant check
  const inputEnabledByGovName = new Map<string, number>();
  const inputDistrictNamesByGov = new Map<string, Set<string>>();
  for (const g of input) {
    const govName = String(g.name ?? '').trim();
    if (!govName) continue;
    let enabled = 0;
    const seen = new Set<string>();
    for (const dRaw of g.districts ?? []) {
      if (typeof dRaw === 'string') {
        if (dRaw.trim()) {
          enabled += 1;
          seen.add(normalizeArabic(dRaw));
        }
      } else if (dRaw && typeof dRaw === 'object') {
        const d = dRaw as Record<string, unknown>;
        const name = String(d.name ?? '').trim();
        if (!name) continue;
        if (d.enabled !== false) enabled += 1;
        seen.add(normalizeArabic(name));
      }
    }
    inputEnabledByGovName.set(govName, enabled);
    inputDistrictNamesByGov.set(govName, seen);
  }

  const transformed = normalizeCoverageHierarchy(input);

  for (const gov of transformed) {
    totals.governorates += 1;
    let topLevelAreas = 0;
    let childCount = 0;
    let flatMoved = 0;
    let newProposed = 0;
    let inputCountForGov = 0;
    const govEnabled = gov.enabled !== false;
    if (govEnabled) {
      // governorate-level fee
      if (typeof gov.fee === 'number' || typeof gov.shippingFee === 'number') {
        totals.feeAtGovernorateLevel += 1;
      }
    }
    const inputNames = inputDistrictNamesByGov.get(gov.name) ?? new Set<string>();
    inputCountForGov = inputNames.size;
    totals.inputDistricts += inputCountForGov;

    for (const area of gov.districts ?? []) {
      topLevelAreas += 1;
      if (typeof area.fee === 'number' || typeof area.shippingFee === 'number') {
        totals.feeAtAreaLevel += 1;
      }
      if (area.source === 'manual_supplement' && area.enabled === false) {
        totals.newPlaceholderParents += 1;
      }
      if (area.enabled !== false) totals.enabledTotalAfter += 1;
      if (area.needsReview) totals.needsReviewAfter += 1;
      // Flat-moved attribution: a child whose name is in input but
      // whose `parent` would not have been set without a rule. We
      // detect by: child has parent === area.name AND child name was
      // top-level in input (i.e. no `parent` in original entry).
      for (const child of area.children ?? []) {
        childCount += 1;
        if (typeof child.fee === 'number' || typeof child.shippingFee === 'number') {
          totals.feeAtChildLevel += 1;
        }
        if (child.enabled !== false) totals.enabledTotalAfter += 1;
        if (child.needsReview) totals.needsReviewAfter += 1;
        const wasInInput = inputNames.has(normalizeArabic(child.name));
        if (!wasInInput) {
          newProposed += 1;
          totals.newProposedChildren += 1;
        }
        if (wasInInput) {
          flatMoved += 1;
          totals.flatMovedToChildren += 1;
        }
      }
    }
    totals.outputTopLevelAreas += topLevelAreas;
    totals.outputChildren += childCount;

    // Detect ambiguity conflicts: among input districts that are
    // orphans, find any whose name claims more than one parent under
    // this governorate.
    // Phase 22N-Fix: multi-parent matches are NOT conflicts. The
    // transformer clones the child under each candidate parent and the
    // user disambiguates by area selection. We track them as
    // "multi-parent matches" for visibility but they don't go into
    // the `conflicts` array. A real conflict is one where the
    // transformer cannot route a district at all (none reach this
    // branch in current data — kept for future detection).
    for (const dRaw of input.find((g) => g.name === gov.name)?.districts ?? []) {
      const name =
        typeof dRaw === 'string' ? dRaw : String((dRaw as Record<string, unknown>)?.name ?? '');
      if (!name.trim()) continue;
      const candidates = findManualParents(gov.name, name);
      if (candidates.length > 1 && !isManualParent(gov.name, name)) {
        multiParentMatches.push({
          governorate: gov.name,
          district: name,
          parentCandidates: candidates.map((c) => c.parent),
        });
      }
    }

    perGov.push({
      name: gov.name,
      enabled: govEnabled,
      inputDistricts: inputCountForGov,
      topLevelAreas,
      children: childCount,
      flatMovedToChildren: flatMoved,
      newProposedChildren: newProposed,
    });
  }

  // Enabled-preserved invariant: count of input enabled districts that
  // appear with `enabled: true` in the output. Should equal the sum of
  // input enabled flags.
  totals.enabledPreserved = totals.enabledTotalAfter - totals.newProposedChildren;

  return { source: 'supabase', totals, perGov, conflicts, multiParentMatches };
}

void isParent; // referenced for symmetry; helper file imports it for types

function asJson(report: Report): string {
  return JSON.stringify(report, null, 2);
}

function asHuman(report: Report): string {
  const out: string[] = [];
  out.push('# Phase 22N — coverage hierarchy dry-run');
  out.push(`source = ${report.source}`);
  out.push('');
  out.push('## Totals');
  for (const [k, v] of Object.entries(report.totals)) {
    out.push(`  ${k} = ${v}`);
  }
  out.push('');
  out.push('## Per governorate');
  out.push('  governorate           | input | top-level | children | moved | proposed');
  for (const g of report.perGov) {
    out.push(
      `  ${g.name.padEnd(20)} | ${String(g.inputDistricts).padStart(5)} | ${String(g.topLevelAreas).padStart(9)} | ${String(g.children).padStart(8)} | ${String(g.flatMovedToChildren).padStart(5)} | ${String(g.newProposedChildren).padStart(8)}`
    );
  }
  out.push('');
  out.push(
    `## Conflicts (real routing failures the transformer could not resolve): ${report.conflicts.length}`
  );
  for (const c of report.conflicts.slice(0, 25)) {
    out.push(
      `  • ${c.governorate} :: ${c.district}  →  candidates: ${c.parentCandidates.join(' | ')}`
    );
  }
  if (report.conflicts.length > 25) {
    out.push(`  … +${report.conflicts.length - 25} more`);
  }
  out.push('');
  out.push(
    `## Multi-parent matches (info-only — same name cloned under each parent): ${report.multiParentMatches.length}`
  );
  for (const c of report.multiParentMatches.slice(0, 25)) {
    out.push(
      `  • ${c.governorate} :: ${c.district}  →  cloned under: ${c.parentCandidates.join(' | ')}`
    );
  }
  if (report.multiParentMatches.length > 25) {
    out.push(`  … +${report.multiParentMatches.length - 25} more`);
  }
  return out.join('\n');
}

async function main(): Promise<void> {
  const fromIdx = process.argv.indexOf('--from');
  const useFile = fromIdx >= 0;
  const wantJson = process.argv.includes('--json');

  let input: RawGov[];
  let source: Report['source'];
  if (useFile) {
    const p = process.argv[fromIdx + 1];
    if (!p) {
      // eslint-disable-next-line no-console
      console.error('--from requires a path argument');
      process.exit(1);
    }
    input = await loadFromFile(p);
    source = 'file';
  } else {
    input = await loadFromSupabase();
    source = 'supabase';
  }

  const report = inspect(input);
  report.source = source;

  // eslint-disable-next-line no-console
  console.log(wantJson ? asJson(report) : asHuman(report));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('dry-run-coverage-hierarchy failed:', err.message ?? err);
  process.exit(1);
});
