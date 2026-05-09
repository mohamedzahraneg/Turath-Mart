// ─────────────────────────────────────────────────────────────────────────────
// Phase 22M — coverage merge dry-run (READ-ONLY).
//
// Loads the live `settings_regions` row from Supabase, runs it through
// the same `mergeCoverage` helper the app uses, and prints a JSON
// summary describing what the import WOULD change. Writes nothing.
//
// Usage:
//   pnpm tsx scripts/dry-run-coverage-merge.ts
//
// Required env (read at runtime — never logged):
//   NEXT_PUBLIC_SUPABASE_URL
//   NEXT_PUBLIC_SUPABASE_ANON_KEY
//
// The summary it prints is JSON-friendly so it can be tee'd into a
// file or attached to a PR. The merged governorate array is also
// printed at the end so a reviewer can spot-check shape and ordering
// without running the writer half of the import.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';
import { mergeCoverage } from '../src/lib/shipping/coverageMerge';
import type { LegacyGovernorate } from '../src/lib/shipping/types';
import { EGYPT_SHIPPING_COVERAGE_SEED } from '../src/data/egyptShippingCoverage.seed';

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in env.');
    process.exit(1);
  }

  const supabase = createClient(url, key);
  const { data, error } = await supabase
    .from('turath_masr_settings')
    .select('value')
    .eq('key', 'settings_regions')
    .single();

  if (error) {
    console.error('Failed to read settings_regions:', error.message);
    process.exit(1);
  }

  const live = (data?.value ?? null) as LegacyGovernorate[] | null;

  const { merged, summary } = mergeCoverage(live, EGYPT_SHIPPING_COVERAGE_SEED);

  // Helpful counts on the live side only, for the report header.
  const liveGovCount = Array.isArray(live) ? live.length : 0;
  const liveDistrictCount = Array.isArray(live)
    ? live.reduce((acc, g) => acc + (Array.isArray(g.districts) ? g.districts.length : 0), 0)
    : 0;

  const report = {
    live: {
      governorateCount: liveGovCount,
      districtCount: liveDistrictCount,
    },
    seed: {
      governorateCount: EGYPT_SHIPPING_COVERAGE_SEED.length,
      districtCount: EGYPT_SHIPPING_COVERAGE_SEED.reduce((acc, g) => acc + g.districts.length, 0),
    },
    afterMerge: {
      governorateCount: merged.length,
      districtCount: merged.reduce((acc, g) => acc + g.districts.length, 0),
    },
    summary,
    governorateRollup: merged.map((g) => ({
      name: g.name,
      enabled: g.enabled,
      source: g.source ?? 'existing',
      districts: g.districts.length,
      enabledDistricts: g.districts.filter((d) => d.enabled).length,
    })),
  };

  // Pretty-print for human review. Don't dump full district names by
  // default — the rollup gives reviewers enough to judge shape.
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error('dry-run-coverage-merge failed:', err);
  process.exit(1);
});
