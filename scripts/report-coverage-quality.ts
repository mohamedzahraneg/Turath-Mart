// ─────────────────────────────────────────────────────────────────────────────
// Phase 22M-Fix1 — coverage-quality report (READ-ONLY).
//
// Inspects the deployed seed (`src/data/egyptShippingCoverage.seed.ts`)
// and surfaces likely data-quality issues for an admin to look at:
//
//   • very long Arabic names without spaces (CAPMAS concatenation),
//   • duplicate normalised names within the same governorate,
//   • disabled entries under an enabled governorate,
//   • manual_supplement entries with no parent set,
//   • official entries flagged needsReview.
//
// The script writes nothing to the DB. It prints one summary block per
// category, capped to a sensible number of examples so the output stays
// readable. Run with:
//
//   pnpm tsx scripts/report-coverage-quality.ts
//   # or, if tsx is not installed:
//   node --experimental-strip-types scripts/report-coverage-quality.ts
//
// Notes:
//   • The script reads the SEED (committed source-of-truth) by default
//     so a reviewer can audit the file PR-side without database access.
//   • The same logic applies cleanly to the live `settings_regions`
//     row; pass a JSON-file path (e.g. a captured backup) as
//     `--from <path>` to inspect production state instead.
//
// All output is human-readable Arabic + English, never JSON. The intent
// is "what should an admin look at next", not a machine artefact.
//
// Imports use extension-less specifiers so `tsc --noEmit` (which runs
// in the project's typecheck pass) is happy. Run the script via tsx
// (`npx tsx scripts/report-coverage-quality.ts`) which resolves the
// `.ts` files transparently. Plain `node --experimental-strip-types`
// would also work but requires explicit `.ts` extensions on the
// imports, which tsc disallows in this project's config.
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeArabic } from '../src/lib/utils/arabic';
import type { ShippingGovernorate } from '../src/lib/shipping/types';
import { EGYPT_SHIPPING_COVERAGE_SEED } from '../src/data/egyptShippingCoverage.seed';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

interface Issue {
  governorate: string;
  area: string;
  parent?: string;
  enabled: boolean;
  source?: string;
  reason: string;
}

const MAX_EXAMPLES_PER_CATEGORY = 25;

async function loadGovernorates(): Promise<ShippingGovernorate[]> {
  const fromIdx = process.argv.indexOf('--from');
  if (fromIdx < 0) return EGYPT_SHIPPING_COVERAGE_SEED;
  const p = process.argv[fromIdx + 1];
  if (!p) {
    // eslint-disable-next-line no-console
    console.error('--from requires a path argument');
    process.exit(1);
  }
  const abs = path.isAbsolute(p) ? p : path.resolve(ROOT, p);
  const raw = await fs.readFile(abs, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(`expected a JSON array at ${abs}`);
  return parsed as ShippingGovernorate[];
}

function inspect(govs: ShippingGovernorate[]): {
  longNames: Issue[];
  noSpaceNames: Issue[];
  duplicates: Issue[];
  disabledUnderEnabledGov: Issue[];
  manualWithoutParent: Issue[];
  officialNeedsReview: Issue[];
  // Phase 22N — additional categories
  childrenWithoutParent: Issue[];
  feeOverrides: Issue[];
  totals: {
    governorates: number;
    districts: number;
    enabled: number;
    disabled: number;
    manual: number;
    needsReview: number;
    feeOverridesCount: number;
  };
} {
  const longNames: Issue[] = [];
  const noSpaceNames: Issue[] = [];
  const duplicates: Issue[] = [];
  const disabledUnderEnabledGov: Issue[] = [];
  const manualWithoutParent: Issue[] = [];
  const officialNeedsReview: Issue[] = [];
  const childrenWithoutParent: Issue[] = [];
  const feeOverrides: Issue[] = [];
  const totals = {
    governorates: 0,
    districts: 0,
    enabled: 0,
    disabled: 0,
    manual: 0,
    needsReview: 0,
    feeOverridesCount: 0,
  };

  for (const gov of govs) {
    totals.governorates += 1;
    const govEnabled = gov.enabled !== false;
    const seen = new Map<string, number>(); // normalised name → first-seen index

    for (let i = 0; i < gov.districts.length; i += 1) {
      const d = gov.districts[i];
      totals.districts += 1;
      if (d.enabled) totals.enabled += 1;
      else totals.disabled += 1;
      if (d.source === 'manual_supplement') totals.manual += 1;
      if (d.needsReview) totals.needsReview += 1;

      const name = String(d.name ?? '');
      const norm = normalizeArabic(name);

      // Long names — likely copy/paste glitch
      if (name.length > 24) {
        longNames.push({
          governorate: gov.name,
          area: name,
          parent: d.parent,
          enabled: !!d.enabled,
          source: d.source,
          reason: `long name (${name.length} chars)`,
        });
      }
      // CAPMAS concatenation: 12+ chars, no spaces, Arabic-only
      if (name.length >= 12 && !/\s/.test(name) && /[؀-ۿ]/.test(name)) {
        noSpaceNames.push({
          governorate: gov.name,
          area: name,
          parent: d.parent,
          enabled: !!d.enabled,
          source: d.source,
          reason: 'no internal whitespace — likely CAPMAS concatenation',
        });
      }
      // Duplicates within same gov
      if (seen.has(norm)) {
        duplicates.push({
          governorate: gov.name,
          area: name,
          parent: d.parent,
          enabled: !!d.enabled,
          source: d.source,
          reason: `duplicate of district at index ${seen.get(norm)}`,
        });
      } else {
        seen.set(norm, i);
      }
      // Disabled under enabled gov — common after the import, but
      // worth surfacing so admins know which they're sitting on
      if (govEnabled && d.enabled === false) {
        disabledUnderEnabledGov.push({
          governorate: gov.name,
          area: name,
          parent: d.parent,
          enabled: false,
          source: d.source,
          reason: 'disabled under enabled governorate',
        });
      }
      // Manual supplements without parent
      if (d.source === 'manual_supplement' && !d.parent) {
        manualWithoutParent.push({
          governorate: gov.name,
          area: name,
          parent: undefined,
          enabled: !!d.enabled,
          source: d.source,
          reason: 'manual_supplement without parent',
        });
      }
      // Official entries flagged needsReview — should ideally be empty
      if (d.source === 'official' && d.needsReview) {
        officialNeedsReview.push({
          governorate: gov.name,
          area: name,
          parent: d.parent,
          enabled: !!d.enabled,
          source: d.source,
          reason: 'official entry flagged needsReview',
        });
      }
      // Phase 22N — children of a non-existent parent. The parent
      // pointer references a name that isn't a top-level area in
      // this governorate. The hierarchy transformer would create a
      // placeholder for these, but admins should review them.
      if (d.parent) {
        const parentNorm = normalizeArabic(d.parent);
        const parentExists = gov.districts.some(
          (other) =>
            other !== d &&
            !other.parent && // top-level only
            normalizeArabic(other.name) === parentNorm
        );
        if (!parentExists) {
          childrenWithoutParent.push({
            governorate: gov.name,
            area: name,
            parent: d.parent,
            enabled: !!d.enabled,
            source: d.source,
            reason: `parent "${d.parent}" not found as a top-level area`,
          });
        }
      }
      // Phase 22N — fee overrides at district level (either field).
      const feeNumber =
        typeof d.fee === 'number'
          ? d.fee
          : typeof d.shippingFee === 'number'
            ? d.shippingFee
            : null;
      if (feeNumber !== null) {
        totals.feeOverridesCount += 1;
        feeOverrides.push({
          governorate: gov.name,
          area: name,
          parent: d.parent,
          enabled: !!d.enabled,
          source: d.source,
          reason: `district-level fee = ${feeNumber} EGP`,
        });
      }
    }
  }

  return {
    longNames,
    noSpaceNames,
    duplicates,
    disabledUnderEnabledGov,
    manualWithoutParent,
    officialNeedsReview,
    childrenWithoutParent,
    feeOverrides,
    totals,
  };
}

function printSection(title: string, items: Issue[]): void {
  // eslint-disable-next-line no-console
  console.log(`\n## ${title}  (${items.length})`);
  if (items.length === 0) {
    // eslint-disable-next-line no-console
    console.log('  (none)');
    return;
  }
  const slice = items.slice(0, MAX_EXAMPLES_PER_CATEGORY);
  for (const it of slice) {
    const parent = it.parent ? `  ضمن: ${it.parent}` : '';
    const src = it.source ? `  (${it.source})` : '';
    // eslint-disable-next-line no-console
    console.log(`  • ${it.governorate}: ${it.area}${parent}${src}`);
  }
  if (items.length > slice.length) {
    // eslint-disable-next-line no-console
    console.log(`  … +${items.length - slice.length} more`);
  }
}

async function main(): Promise<void> {
  const govs = await loadGovernorates();
  const r = inspect(govs);

  // eslint-disable-next-line no-console
  console.log('# Phase 22N — coverage-quality report');
  // eslint-disable-next-line no-console
  console.log(`source = ${process.argv.includes('--from') ? 'file' : 'committed seed'}`);
  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log(`governorates = ${r.totals.governorates}`);
  // eslint-disable-next-line no-console
  console.log(`total districts = ${r.totals.districts}`);
  // eslint-disable-next-line no-console
  console.log(`enabled = ${r.totals.enabled}`);
  // eslint-disable-next-line no-console
  console.log(`disabled = ${r.totals.disabled}`);
  // eslint-disable-next-line no-console
  console.log(`manual_supplement entries = ${r.totals.manual}`);
  // eslint-disable-next-line no-console
  console.log(`needsReview entries = ${r.totals.needsReview}`);
  // eslint-disable-next-line no-console
  console.log(`fee overrides = ${r.totals.feeOverridesCount}`);

  printSection('Long names (>24 chars)', r.longNames);
  printSection('No-space Arabic names (CAPMAS concatenation)', r.noSpaceNames);
  printSection('Duplicate normalised names within same governorate', r.duplicates);
  printSection('Children with parent pointer to non-existent area', r.childrenWithoutParent);
  printSection('Fee overrides (district-level)', r.feeOverrides);
  printSection('Manual supplements without parent', r.manualWithoutParent);
  printSection('Official entries flagged needsReview', r.officialNeedsReview);
  printSection('Disabled districts under enabled governorate (sample)', r.disabledUnderEnabledGov);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('report-coverage-quality failed:', err);
  process.exit(1);
});
