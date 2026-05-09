// ─────────────────────────────────────────────────────────────────────────────
// Phase 22M — coverage seed builder.
//
// Reads the vendored CAPMAS / OCHA Egypt admin-boundary JSON and emits the
// committed seed at `src/data/egyptShippingCoverage.seed.ts`.
//
// Run with:
//   pnpm tsx scripts/build-coverage-seed.ts
//
// The script is deterministic — running it twice produces byte-identical
// output. That is a soft contract a reviewer relies on: the diff in the
// committed seed must match the diff in the vendored JSON plus any change
// to MANUAL_SUPPLEMENTS below.
//
// What this script DOES:
//   • Reads `data/sources/egypt-admin-boundaries.json`.
//   • Builds 27 governorates with `enabled: false, source: 'official'` and
//     `fee: 0` (admin sets fees later).
//   • Maps ADM2 rows to districts with type=markaz/kism/city based on the
//     Arabic prefix of the entry. ADM2 carries `enabled: false,
//     source: 'official'`.
//   • Maps ADM3 rows to districts with type=village/shiakha (heuristic on
//     parent type), `parent: <ADM2 Arabic name>` so the new-order modal
//     can render "هذا الحي تابع إلى …".
//   • Appends MANUAL_SUPPLEMENT entries (commercial neighborhoods that are
//     not in CAPMAS) with `source: 'manual_supplement', needsReview: true`.
//
// What this script does NOT do:
//   • Touch the live Supabase row. The seed is the *input* to the merge
//     helper; it never reaches the database without an authorized writer.
//   • Set any entry to `enabled: true`. Every entry the seed produces is
//     disabled by default — admins flip flags during review.
//   • De-dup. The merge helper handles dedup against live data; the seed
//     itself stays faithful to the upstream source plus declared
//     supplements.
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ShippingDistrict,
  ShippingDistrictType,
  ShippingGovernorate,
} from '../src/lib/shipping/types.ts';

interface RawAdm1 { pcode: string; name_en: string; name_ar: string }
interface RawAdm2 { pcode: string; name_en: string; name_ar: string; adm1_pcode: string }
interface RawAdm3 { pcode: string; name_en: string | null; name_ar: string; adm2_pcode: string; adm1_pcode: string }
interface VendoredDoc {
  _meta: Record<string, unknown>;
  governorates: RawAdm1[];
  adm2: RawAdm2[];
  adm3: RawAdm3[];
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SOURCE = path.join(ROOT, 'data', 'sources', 'egypt-admin-boundaries.json');
const OUT = path.join(ROOT, 'src', 'data', 'egyptShippingCoverage.seed.ts');

// ─── Manual supplements ──────────────────────────────────────────────────────
// Commercial / known neighborhoods that don't appear in CAPMAS COD-AB but are
// commonly used by customers when entering shipping addresses. Each is
// marked `source: 'manual_supplement'` and `needsReview: true` so admins
// audit before exposing.
//
// Adding entries here requires NO change to the build pipeline — just add a
// row, regenerate, and the dry-run will show one extra disabled entry per
// supplement.
//
// Parent strings MUST match the upstream ADM2 Arabic name verbatim, because
// the merge dedupes by name within a governorate (parent is metadata only,
// not a key). If the parent ADM2 is missing in the source, the entry will
// still land — it just won't be visually nested in the UI.

interface ManualSupplement {
  governorate: string; // matches CAPMAS adm1.name_ar
  parent: string;      // matches CAPMAS adm2.name_ar (or any string for display)
  names: string[];     // canonical Arabic names
}

const MANUAL_SUPPLEMENTS: ManualSupplement[] = [
  // ─── 6 October — phases 1..12 + areas ──────────────────────────────────────
  {
    governorate: 'الجيزة',
    parent: 'مدينة 6 اكتوبر',
    // Phase 22M-Fix1 — added الحصري and غرب سوميد per the Phase 22M-Fix1
    // brief. Both are widely used commercial labels for sub-zones of
    // 6 أكتوبر that don't appear in CAPMAS COD-AB.
    names: [
      'الحي الأول',
      'الحي الثاني',
      'الحي الثالث',
      'الحي الرابع',
      'الحي الخامس',
      'الحي السادس',
      'الحي السابع',
      'الحي الثامن',
      'الحي التاسع',
      'الحي العاشر',
      'الحي الحادي عشر',
      'الحي الثاني عشر',
      'الحي المتميز',
      'الحصري',
      'غرب سوميد',
      'حدائق أكتوبر',
      'دريم لاند',
      'بيفرلي هيلز',
      'كمبوند الزهور',
      'بالم هيلز أكتوبر',
      'كمبوند مينا جاردن',
    ],
  },
  // ─── Sheikh Zayed phases + areas ───────────────────────────────────────────
  // Phase 22M-Fix1 — `بيت الوطن` exists as a separate development under
  // both القاهرة الجديدة and الشيخ زايد; it's listed in both blocks so
  // the merge produces a needsReview entry under each parent.
  {
    governorate: 'الجيزة',
    parent: 'مدينة الشيخ زايد',
    names: [
      'الحي الأول',
      'الحي الثاني',
      'الحي الثالث',
      'الحي الرابع',
      'الحي الخامس',
      'الحي السادس',
      'الحي السابع',
      'الحي الثامن',
      'الحي التاسع',
      'الحي العاشر',
      'الحي الحادي عشر',
      'الحي الثاني عشر',
      'الحي السادس عشر',
      'بيفرلي هيلز زايد',
      'الرابية',
      'بالم هيلز زايد',
      'سوديك ويست',
      'بيت الوطن',
    ],
  },
  // ─── New Cairo / Tagamoa neighborhoods ─────────────────────────────────────
  // Phase 22M-Fix1 — added المستثمرين الشمالية and المستثمرين الجنوبية
  // per the Phase 22M-Fix1 brief. Both are commercial labels heavily
  // used in customer addresses around التجمع الخامس.
  {
    governorate: 'القاهرة',
    parent: 'القاهرة الجديدة',
    names: [
      'التجمع الأول',
      'التجمع الثالث',
      'التجمع الخامس',
      'الحي الأول',
      'الحي الثاني',
      'الحي الثالث',
      'الحي الرابع',
      'الحي الخامس',
      'النرجس',
      'اللوتس',
      'بيت الوطن',
      'الياسمين',
      'الأندلس',
      'الجولف',
      'البنفسج',
      'الشويفات',
      'المستثمرين الشمالية',
      'المستثمرين الجنوبية',
      'كمبوند ميفيدا',
      'كمبوند ماونتن فيو',
      'كمبوند ميراج سيتي',
    ],
  },
  // ─── Nasr City sub-areas ───────────────────────────────────────────────────
  {
    governorate: 'القاهرة',
    parent: 'مدينة نصر',
    names: [
      'مدينة نصر أول',
      'مدينة نصر ثان',
      'الحي السابع',
      'الحي العاشر',
      'منطقة الواحات',
      'مكرم عبيد',
      'عباس العقاد',
      'مصطفى النحاس',
    ],
  },
  // ─── Heliopolis / Masr el-Gedida sub-areas ─────────────────────────────────
  {
    governorate: 'القاهرة',
    parent: 'قسم مصر الجديدة',
    names: [
      'الكوربة',
      'روكسي',
      'النزهة الجديدة',
      'الحجاز',
      'سفير',
      'ميدان الجامع',
      'شيراتون هليوبوليس',
      'تريومف',
    ],
  },
  // ─── Maadi sub-areas ───────────────────────────────────────────────────────
  {
    governorate: 'القاهرة',
    parent: 'قسم المعادى',
    names: [
      'المعادي الجديدة',
      'زهراء المعادي',
      'دجلة',
      'حلوان',
      'العرب',
      'النصر',
      'سرايات المعادي',
    ],
  },
];

// ─── Type heuristics ─────────────────────────────────────────────────────────
function adm2Type(nameAr: string): ShippingDistrictType {
  if (nameAr.startsWith('مركز')) return 'markaz';
  if (nameAr.startsWith('قسم')) return 'kism';
  return 'city';
}

function adm3Type(parentType: ShippingDistrictType): ShippingDistrictType {
  // Heuristic: ADM3 children of a markaz are villages, children of a kism
  // are shiakhas, children of cities (rare) are neighborhoods.
  if (parentType === 'markaz') return 'village';
  if (parentType === 'kism') return 'shiakha';
  return 'neighborhood';
}

// ─── Build pipeline ──────────────────────────────────────────────────────────
async function main() {
  const raw = await fs.readFile(SOURCE, 'utf8');
  const doc = JSON.parse(raw) as VendoredDoc;

  const adm2ByGov = new Map<string, RawAdm2[]>();
  for (const a2 of doc.adm2) {
    if (!adm2ByGov.has(a2.adm1_pcode)) adm2ByGov.set(a2.adm1_pcode, []);
    adm2ByGov.get(a2.adm1_pcode)!.push(a2);
  }

  const adm3ByAdm2 = new Map<string, RawAdm3[]>();
  for (const a3 of doc.adm3) {
    if (!adm3ByAdm2.has(a3.adm2_pcode)) adm3ByAdm2.set(a3.adm2_pcode, []);
    adm3ByAdm2.get(a3.adm2_pcode)!.push(a3);
  }

  const supplementsByGov = new Map<string, ManualSupplement[]>();
  for (const s of MANUAL_SUPPLEMENTS) {
    if (!supplementsByGov.has(s.governorate)) supplementsByGov.set(s.governorate, []);
    supplementsByGov.get(s.governorate)!.push(s);
  }

  const seed: ShippingGovernorate[] = doc.governorates
    .slice()
    .sort((a, b) => a.pcode.localeCompare(b.pcode))
    .map((gov): ShippingGovernorate => {
      const districts: ShippingDistrict[] = [];
      const govAdm2 = (adm2ByGov.get(gov.pcode) ?? []).slice().sort((a, b) =>
        a.pcode.localeCompare(b.pcode)
      );
      for (const a2 of govAdm2) {
        const a2Type = adm2Type(a2.name_ar);
        districts.push({
          name: a2.name_ar,
          enabled: false,
          type: a2Type,
          source: 'official',
        });
        const children = (adm3ByAdm2.get(a2.pcode) ?? []).slice().sort((a, b) =>
          a.pcode.localeCompare(b.pcode)
        );
        for (const a3 of children) {
          districts.push({
            name: a3.name_ar,
            enabled: false,
            type: adm3Type(a2Type),
            parent: a2.name_ar,
            source: 'official',
          });
        }
      }

      const govSupplements = supplementsByGov.get(gov.name_ar) ?? [];
      for (const sup of govSupplements) {
        for (const n of sup.names) {
          districts.push({
            name: n,
            enabled: false,
            type: 'neighborhood',
            parent: sup.parent,
            source: 'manual_supplement',
            needsReview: true,
          });
        }
      }

      return {
        name: gov.name_ar,
        fee: 0,
        enabled: false,
        source: 'official',
        districts,
      };
    });

  // Stats — we put these into the file header so reviewers can see at a glance.
  const stats = {
    governorates: seed.length,
    adm2: doc.adm2.length,
    adm3: doc.adm3.length,
    manual: MANUAL_SUPPLEMENTS.reduce((acc, s) => acc + s.names.length, 0),
    totalDistricts: seed.reduce((acc, g) => acc + g.districts.length, 0),
  };

  const ts = renderTypescript(seed, stats);
  await fs.writeFile(OUT, ts, 'utf8');

  // eslint-disable-next-line no-console
  console.log(`wrote ${path.relative(ROOT, OUT)}`);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(stats, null, 2));
}

// ─── TS-style serializer ─────────────────────────────────────────────────────
// JSON.stringify produces double-quoted keys + values, which clashes with the
// project Prettier config (singleQuote, no unnecessary quoted keys). We emit
// a minimal TS literal hand-rolled so the committed seed reads natively in
// the codebase — and so lint doesn't trip on each of the ~6k entries.
//
// The renderer is intentionally NOT general-purpose: it knows the shape of
// `ShippingGovernorate` and `ShippingDistrict` and produces a stable,
// deterministic layout (one district per line, governorates separated by a
// blank line). Reviewers can scan the diff per-governorate.

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function tsKey(k: string): string {
  return IDENT_RE.test(k) ? k : `'${k.replace(/'/g, "\\'")}'`;
}

function tsString(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function tsValue(v: unknown): string {
  if (v === null || v === undefined) return 'undefined';
  if (typeof v === 'string') return tsString(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.map(tsValue).join(', ')}]`;
  if (typeof v === 'object') {
    const pairs = Object.entries(v as Record<string, unknown>)
      .filter(([, val]) => val !== undefined)
      .map(([k, val]) => `${tsKey(k)}: ${tsValue(val)}`);
    return `{ ${pairs.join(', ')} }`;
  }
  throw new Error(`unsupported value: ${String(v)}`);
}

function renderTypescript(seed: ShippingGovernorate[], stats: Record<string, number>): string {
  const lines: string[] = [
    '// ─────────────────────────────────────────────────────────────────────────────',
    '// Phase 22M — Egypt shipping coverage seed (GENERATED — do not edit by hand).',
    '//',
    '// Source: data/sources/egypt-admin-boundaries.json',
    '//   (CAPMAS via OCHA HDX COD-AB, valid 2017-04-21).',
    '// Generator: scripts/build-coverage-seed.ts',
    '// Regenerate with: pnpm tsx scripts/build-coverage-seed.ts',
    '//',
    `// Counts:`,
    `//   governorates            = ${stats.governorates}`,
    `//   ADM2 (markaz/kism/city) = ${stats.adm2}`,
    `//   ADM3 (village/shiakha)  = ${stats.adm3}`,
    `//   manual supplements      = ${stats.manual}`,
    `//   total districts         = ${stats.totalDistricts}`,
    '//',
    '// Every entry produced here is `enabled: false`. The merge helper in',
    '// `src/lib/shipping/coverageMerge.ts` preserves admin-curated state',
    '// from the live `settings_regions` row and forces every NEW entry to',
    '// `enabled: false`. The seed never overrides admin curation.',
    '// ─────────────────────────────────────────────────────────────────────────────',
    '',
    "/* eslint-disable prettier/prettier */",
    '',
    "import type { ShippingGovernorate } from '@/lib/shipping/types';",
    '',
    'export const EGYPT_SHIPPING_COVERAGE_SEED: ShippingGovernorate[] = [',
  ];

  for (const gov of seed) {
    lines.push('  {');
    lines.push(`    name: ${tsString(gov.name)},`);
    lines.push(`    fee: ${gov.fee},`);
    lines.push(`    enabled: ${gov.enabled},`);
    if (gov.source) lines.push(`    source: ${tsString(gov.source)},`);
    lines.push('    districts: [');
    for (const d of gov.districts) {
      lines.push(`      ${tsValue(d)},`);
    }
    lines.push('    ],');
    lines.push('  },');
  }

  lines.push('];');
  lines.push('');

  return lines.join('\n');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('build-coverage-seed failed:', err);
  process.exit(1);
});
