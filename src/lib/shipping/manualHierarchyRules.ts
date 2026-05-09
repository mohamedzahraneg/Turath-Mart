// ─────────────────────────────────────────────────────────────────────────────
// Phase 22N — manual hierarchy rules.
//
// The live `settings_regions` row carries 6,156 districts but every entry
// is flat:
//
//   • Live "existing" entries (97 rows): plain `{ name, enabled }` with no
//     `parent` / `children` — admin curation from before Phase 22M.
//     Among these, items like `التجمع الخامس` and `الحي الأول` are
//     conceptually neighborhoods of bigger areas (`القاهرة الجديدة`,
//     `مدينة 6 اكتوبر`) but the data doesn't say so.
//   • CAPMAS-imported entries (~6,000 rows): carry the right `parent`
//     pointer (markaz / kism), so they nest correctly without help.
//
// To present a true hierarchy on the new-order modal and the settings
// page WITHOUT writing to the database, we need a small curated map
// from neighborhood Arabic name → its commercial parent. The
// transformer in `coverageHierarchy.ts` consults this map at runtime,
// preserves admin-curated `enabled` / `fee` / metadata, and ONLY adds
// the missing `parent` pointer in-memory. Persistence is unchanged.
//
// Adding a rule here is safe — it cannot disable an existing entry,
// rename it, or delete it. The worst it can do is misroute a
// neighborhood under a parent (which the next reader would still find
// via search). Misroutes are flagged with `needsReview` on the
// generated children when the parent placeholder has to be created.
//
// Rules are scoped per governorate Arabic name. Children listed under a
// parent are matched on Arabic-normalised name equality (alef variants,
// ta-marbuta, yaa, whitespace), so callers can spell the parent any way
// they like.
// ─────────────────────────────────────────────────────────────────────────────

export interface ManualHierarchyParent {
  /** Parent area name as it should be rendered. */
  name: string;
  /** Arabic-normalised aliases that also match this parent. */
  aliases?: string[];
  /** Children in the order they should appear under the parent. */
  children: string[];
}

export interface ManualHierarchyForGovernorate {
  /** Governorate Arabic name. */
  governorate: string;
  parents: ManualHierarchyParent[];
}

export const MANUAL_HIERARCHY_RULES: ManualHierarchyForGovernorate[] = [
  // ─── القاهرة ──────────────────────────────────────────────────────────────
  {
    governorate: 'القاهرة',
    parents: [
      {
        name: 'القاهرة الجديدة',
        aliases: ['قسم أول القاهرة الجديدة', 'قسم ثان القاهرة الجديدة', 'New Cairo'],
        children: [
          'التجمع الأول',
          'التجمع الثالث',
          'التجمع الخامس',
          'النرجس',
          'البنفسج',
          'الياسمين',
          'اللوتس',
          'القرنفل',
          'الأندلس',
          'بيت الوطن',
          'المستثمرين الشمالية',
          'المستثمرين الجنوبية',
          'الدبلوماسيين',
          'الجامعة الأمريكية',
          'الفردوس',
          'الرحاب',
          'مدينتي',
          'الشويفات',
          'ميفيدا',
          'ميراج سيتي',
          'كمبوند ماونتن فيو',
          'الحي الأول',
          'الحي الثاني',
          'الحي الثالث',
          'الحي الرابع',
          'الحي الخامس',
        ],
      },
      {
        name: 'مدينة نصر',
        aliases: ['نصر', 'Nasr City'],
        children: [
          'الحي السابع',
          'الحي الثامن',
          'الحي العاشر',
          'عباس العقاد',
          'مكرم عبيد',
          'مصطفى النحاس',
          'زهراء مدينة نصر',
          'مدينة نصر أول',
          'مدينة نصر ثان',
        ],
      },
      {
        name: 'مصر الجديدة',
        aliases: ['هليوبوليس (مصر الجديدة)', 'قسم مصر الجديدة', 'هليوبوليس'],
        children: [
          'الكوربة',
          'روكسي',
          'سفير',
          'تريومف',
          'الحجاز',
          'ميدان الجامع',
          'شيراتون هليوبوليس',
          'النزهة الجديدة',
          'ألماظة',
          'هليوبوليس',
        ],
      },
      {
        name: 'المعادي',
        aliases: ['قسم المعادى', 'قسم المعادي', 'Maadi'],
        children: [
          'المعادي الجديدة',
          'زهراء المعادي',
          'دجلة',
          'سرايات المعادي',
          'حدائق المعادي',
          'العرب',
        ],
      },
    ],
  },
  // ─── الجيزة ──────────────────────────────────────────────────────────────
  {
    governorate: 'الجيزة',
    parents: [
      {
        name: 'مدينة 6 اكتوبر',
        aliases: ['6 أكتوبر', 'السادس من أكتوبر', '6th of October'],
        children: [
          'الحصري',
          'الحي المتميز',
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
          'غرب سوميد',
          'التوسعات الشمالية',
          'المنطقة الصناعية',
          'حدائق أكتوبر',
          'دريم لاند',
          'بالم هيلز أكتوبر',
          'بيفرلي هيلز',
          'كمبوند الزهور',
          'كمبوند مينا جاردن',
        ],
      },
      {
        name: 'مدينة الشيخ زايد',
        aliases: ['الشيخ زايد', 'Sheikh Zayed', 'Zayed'],
        children: [
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
          'الحي الثالث عشر',
          'الحي الرابع عشر',
          'الحي السادس عشر',
          'بيت الوطن الشيخ زايد',
          'زايد الجديدة',
          'الرابية',
          'بالم هيلز زايد',
          'بيفرلي هيلز زايد',
          'سوديك ويست',
        ],
      },
    ],
  },
  // ─── القليوبية ────────────────────────────────────────────────────────────
  {
    governorate: 'القليوبية',
    parents: [
      {
        name: 'العبور',
        aliases: ['مدينة العبور', 'Obour'],
        children: [
          'الحي الأول',
          'الحي الثاني',
          'الحي الثالث',
          'الحي الرابع',
          'الحي الخامس',
          'الحي السادس',
          'الحي السابع',
          'الحي الثامن',
          'الحي التاسع',
          'المنطقة الصناعية',
          'إسكان الشباب',
          'إسكان المستقبل',
        ],
      },
    ],
  },
];

/**
 * Same-name children can legitimately appear under multiple parents in
 * the same governorate (e.g. `الحي الأول` exists under both 6 أكتوبر AND
 * الشيخ زايد, both under الجيزة). The transformer must NOT auto-pick
 * one — it surfaces both as ambiguous and lets the user disambiguate.
 *
 * This helper returns every parent (in this governorate) that claims a
 * child by the given normalised name. Returns an empty array when
 * unknown — the transformer keeps the entry top-level in that case.
 */
export interface CandidateParent {
  governorate: string;
  parent: string;
}

import { normalizeArabic } from '@/lib/utils/arabic';

export function findManualParents(governorateName: string, childName: string): CandidateParent[] {
  const govNorm = normalizeArabic(governorateName);
  const childNorm = normalizeArabic(childName);
  if (!govNorm || !childNorm) return [];

  const out: CandidateParent[] = [];
  for (const block of MANUAL_HIERARCHY_RULES) {
    if (normalizeArabic(block.governorate) !== govNorm) continue;
    for (const parent of block.parents) {
      // Skip if this child name happens to match the parent itself
      // (e.g. typing "العبور" under القليوبية should not nest under
      // a self-named parent — it stays top-level).
      const parentNorm = normalizeArabic(parent.name);
      if (parentNorm === childNorm) continue;
      const parentAliasNorms = (parent.aliases ?? []).map(normalizeArabic);
      if (parentAliasNorms.includes(childNorm)) continue;
      const matches = parent.children.some((c) => normalizeArabic(c) === childNorm);
      if (matches) {
        out.push({ governorate: block.governorate, parent: parent.name });
      }
    }
  }
  return out;
}

/**
 * Returns true if a name (in the given governorate) is a curated
 * top-level parent or one of its aliases. Used by the transformer to
 * know whether a flat live entry should stay as a parent (rather than
 * being treated as a child somewhere else).
 */
export function isManualParent(governorateName: string, name: string): boolean {
  const govNorm = normalizeArabic(governorateName);
  const nameNorm = normalizeArabic(name);
  if (!govNorm || !nameNorm) return false;
  for (const block of MANUAL_HIERARCHY_RULES) {
    if (normalizeArabic(block.governorate) !== govNorm) continue;
    for (const parent of block.parents) {
      if (normalizeArabic(parent.name) === nameNorm) return true;
      const aliasNorms = (parent.aliases ?? []).map(normalizeArabic);
      if (aliasNorms.includes(nameNorm)) return true;
    }
  }
  return false;
}

/**
 * Listed parents (with curated children) for a given governorate.
 * Used by the transformer to PROPOSE missing children placeholders
 * when the parent exists but the child doesn't (e.g. الجامعة الأمريكية
 * isn't in the live row but is a known commercial label).
 */
export function listManualParents(governorateName: string): ManualHierarchyParent[] {
  const govNorm = normalizeArabic(governorateName);
  if (!govNorm) return [];
  for (const block of MANUAL_HIERARCHY_RULES) {
    if (normalizeArabic(block.governorate) === govNorm) return block.parents;
  }
  return [];
}
