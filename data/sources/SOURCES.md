# Egypt shipping coverage — vendored data sources

This directory holds the authoritative reference data the Phase 22M shipping seed
is generated from. The repository's seed (`src/data/egyptShippingCoverage.seed.ts`)
is **derived** from these files — do not edit the seed by hand for items that
came from an upstream source. Edit the JSON or add a manual-supplement block
in the build script and regenerate.

## egypt-admin-boundaries.json

| Field        | Value                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| Origin       | OCHA / CAPMAS — Egypt Subnational Administrative Boundaries (Common Operational Dataset, COD-AB)     |
| Source page  | https://data.humdata.org/dataset/cod-ab-egy                                                          |
| Resource     | `egy_admin_boundaries.xlsx` (workbook with `egy_admin1`, `egy_admin2`, `egy_admin3` sheets)          |
| Resource URL | https://data.humdata.org/dataset/b90d81ba-7c7a-4283-9899-827480d80a79/resource/81126a96-2991-48e1-93cb-24c164a4de88/download/egy_admin_boundaries.xlsx |
| Valid on     | 2017-04-21 (version v01)                                                                             |
| Authority    | Central Agency for Public Mobilization and Statistics (CAPMAS), Egypt                                |
| Distributor  | UN OCHA Regional Office for the Middle East and North Africa                                         |
| Licensing    | Common Operational Datasets are published by OCHA for humanitarian and operational use. Redistribution permitted with attribution. See HDX terms of use. |

The vendored JSON contains only the fields needed for shipping-coverage
generation:

- `governorates[]` — 27 entries: `pcode`, `name_en`, `name_ar`
- `adm2[]`         — 365 entries: `pcode`, `name_en`, `name_ar`, `adm1_pcode`
- `adm3[]`         — 5,716 entries: `pcode`, `name_en`, `name_ar`, `adm2_pcode`, `adm1_pcode`

Geometry (polygons / shapefile data) is **not** vendored — only the names
hierarchy. The original XLSX also contains coordinates and area; we drop them
to keep the file small.

## How this data flows into the app

```
data/sources/egypt-admin-boundaries.json     ← vendored from CAPMAS / OCHA
            │
            ▼
scripts/build-coverage-seed.ts                ← deterministic transform
            │
            ▼
src/data/egyptShippingCoverage.seed.ts        ← committed seed (generated)
            │
            ▼
src/lib/shipping/coverageMerge.ts             ← pure merge helper
            │
            ▼
scripts/dry-run-coverage-merge.ts             ← READ-ONLY report against
                                                turath_masr_settings
```

No part of this pipeline writes to Supabase. The seed is **never** auto-applied
to the live `settings_regions` row. An authorized admin must explicitly trigger
a future write phase.

## Regenerating the seed

```sh
pnpm tsx scripts/build-coverage-seed.ts
```

That command reads `data/sources/egypt-admin-boundaries.json`, applies the
manual-supplement blocks declared inside the build script, and overwrites
`src/data/egyptShippingCoverage.seed.ts`. The output is deterministic — running
it twice produces identical bytes.

## Honesty about completeness

CAPMAS COD-AB is the most authoritative public dataset for Egypt's
administrative hierarchy down to ADM3 (shiakha / village). It does **not**
necessarily mirror how Egyptians colloquially name neighborhoods — many high-
volume commercial areas (e.g. التجمع الخامس internal compounds, الشيخ زايد
phases, 6 أكتوبر districts numbered 1–12) are sub-ADM3 and are not in the
authoritative source.

For those we keep a list of `manual_supplement` entries inside
`scripts/build-coverage-seed.ts`. Each is flagged `source: 'manual_supplement'`
and `needsReview: true` so an admin can audit, dis/enable, or rename them
before exposing to customers.

### Upstream data quality

The CAPMAS / COD-AB Arabic names are kept verbatim. Reviewers will notice
two recurring patterns inherited from the upstream source:

- **Concatenated words.** Many ADM3 entries omit the space between
  segments — e.g. `التبينالبحرية` instead of `التبين البحرية`,
  `حلوانالقبلية` instead of `حلوان القبلية`. This is how the names
  appear in `egy_admin_boundaries.xlsx`. We do **not** post-process them
  with heuristic spacing rules because (a) the rules would be
  approximate, and (b) admins should ultimately edit canonical names
  via the settings UI before exposing them to customers. If a customer
  types the conventional spaced form, the Arabic-normalisation helper
  in `src/lib/utils/arabic.ts` already collapses whitespace, so the
  match still works.
- **Bare ADM3 names without a parent prefix.** CAPMAS sometimes lists a
  shiakha as `الجزيره` with no qualifier; the parent markaz is held
  separately. Our build script preserves that — the `parent` field on
  each district carries the upstream ADM2 Arabic name so the new-order
  modal can render `هذا الحي تابع إلى ${parent}`.

Both patterns are intentional. Anything you'd want to "clean up" should
be done in the live `settings_regions` row by an admin, not in the seed
or the vendored JSON. Edits to the vendored JSON are reserved for
upstream snapshot refreshes.

## Updating the upstream snapshot

If CAPMAS / OCHA publishes a newer COD-AB release:

1. Download the latest `egy_admin_boundaries.xlsx` from the dataset page.
2. Re-run the extractor (see `scripts/build-coverage-seed.ts` header for
   the snippet — it's intentionally Python+openpyxl so it doesn't bloat the
   Node toolchain).
3. Replace `data/sources/egypt-admin-boundaries.json` and update the
   `Valid on` line in this file.
4. Regenerate the seed and re-run the dry-run merge.
5. Open a PR with both the JSON diff and the regenerated seed in the same
   commit so reviewers can verify the transform was deterministic.
