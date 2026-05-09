// ─────────────────────────────────────────────────────────────────────────────
// Phase 22M — Egypt shipping coverage seed.
//
// HONESTY NOTES (read these before judging completeness):
//
//   • This file is a STARTER seed, not a complete administrative
//     boundary import. It covers all 27 governorates with their best-
//     known major cities / markaz / kism plus the commercial area
//     supplements explicitly listed in the Phase 22M spec. It does NOT
//     pretend to enumerate every village, shiakha, or hamlet in Egypt.
//   • Authoritative completion requires a one-shot import from HDX
//     COD-AB Egypt admin-3 boundaries (or a CAPMAS-derived equivalent).
//     The merge tooling under src/lib/shipping/ is shaped so that
//     dataset can be dropped in later without changing anything else.
//   • Every entry that wasn't sourced from an authoritative dataset is
//     marked `needsReview: true` so an admin reviews before exposure.
//   • New entries default to `enabled: false`. The merge helper at
//     src/lib/shipping/coverageMerge.ts NEVER overrides existing
//     `enabled` flags — admin curation is preserved verbatim.
//
// The CONTRACT this seed honours:
//
//   1. The 3 governorates already in production (القاهرة, الجيزة,
//      القليوبية) appear here ONLY to keep the file shape consistent
//      with what gets read on import. They do NOT include district
//      lists — the merge helper takes the live `districts[]` from the
//      DB row as the source of truth for those governorates.
//   2. The other 24 governorates carry a starter set of cities /
//      markaz, all with source='official', needsReview=true,
//      enabled=false.
//   3. The explicit commercial-area supplements (الحصري, الحي الأول..
//      الثاني عشر, التجمع الأول/الثالث/الخامس, النرجس, البنفسج…) are
//      added under their parent governorate as source='manual_
//      supplement', enabled=false. The parent is identified by name so
//      the merge step can attach them to the right city even when its
//      district id is auto-generated.
//
// NEW GOVERNORATES POLICY:
//
//   • All 24 newly-added governorates ship with `enabled: false` so the
//     site does not silently start charging shipping for areas the
//     business doesn't yet serve. An admin must flip the toggle in
//     /settings before customers can pick them.
//   • The seed assigns `fee: 0` for every new governorate. That is a
//     deliberate "neutral" placeholder — it is invisible to customers
//     while `enabled: false`, and an admin must set the real fee at
//     the same time as enabling.
// ─────────────────────────────────────────────────────────────────────────────

import type { ShippingDistrict, ShippingGovernorate } from '@/lib/shipping/types';

/** Helper: create a city/markaz district with consistent metadata. */
function city(
  name: string,
  type: ShippingDistrict['type'] = 'city',
  source: ShippingDistrict['source'] = 'official',
  needsReview = true
): ShippingDistrict {
  return { name, enabled: false, type, source, needsReview };
}

/** Helper: create a child neighborhood/area with a parent reference. */
function area(
  name: string,
  parent: string,
  type: ShippingDistrict['type'] = 'neighborhood',
  source: ShippingDistrict['source'] = 'manual_supplement',
  needsReview = true
): ShippingDistrict {
  return { name, parent, enabled: false, type, source, needsReview };
}

// ─── Manual-supplement neighborhoods explicitly listed in the spec ──────────
// Stored separately so they can be referenced from the governorate seed
// blocks below. parent = the canonical city/area name within the same
// governorate. The merge helper resolves these onto whichever real
// district carries that name (whether it pre-existed in the live row
// or is being added by this seed).

const SIX_OCTOBER_AREAS: ShippingDistrict[] = [
  area('الحصري', '6 أكتوبر'),
  area('الحي المتميز', '6 أكتوبر'),
  area('الحي الأول', '6 أكتوبر', 'district'),
  area('الحي الثاني', '6 أكتوبر', 'district'),
  area('الحي الثالث', '6 أكتوبر', 'district'),
  area('الحي الرابع', '6 أكتوبر', 'district'),
  area('الحي الخامس', '6 أكتوبر', 'district'),
  area('الحي السادس', '6 أكتوبر', 'district'),
  area('الحي السابع', '6 أكتوبر', 'district'),
  area('الحي الثامن', '6 أكتوبر', 'district'),
  area('الحي التاسع', '6 أكتوبر', 'district'),
  area('الحي العاشر', '6 أكتوبر', 'district'),
  area('الحي الحادي عشر', '6 أكتوبر', 'district'),
  area('الحي الثاني عشر', '6 أكتوبر', 'district'),
  area('غرب سوميد', '6 أكتوبر'),
  area('التوسعات الشمالية', '6 أكتوبر'),
  area('المنطقة الصناعية', '6 أكتوبر'),
  area('دريم لاند', '6 أكتوبر', 'compound'),
  area('حدائق أكتوبر', '6 أكتوبر'),
];

const SHEIKH_ZAYED_AREAS: ShippingDistrict[] = [
  area('الحي الأول', 'الشيخ زايد', 'district'),
  area('الحي الثاني', 'الشيخ زايد', 'district'),
  area('الحي الثالث', 'الشيخ زايد', 'district'),
  area('الحي الرابع', 'الشيخ زايد', 'district'),
  area('الحي الخامس', 'الشيخ زايد', 'district'),
  area('الحي السادس', 'الشيخ زايد', 'district'),
  area('الحي السابع', 'الشيخ زايد', 'district'),
  area('الحي الثامن', 'الشيخ زايد', 'district'),
  area('الحي التاسع', 'الشيخ زايد', 'district'),
  area('الحي العاشر', 'الشيخ زايد', 'district'),
  area('الحي الحادي عشر', 'الشيخ زايد', 'district'),
  area('الحي الثاني عشر', 'الشيخ زايد', 'district'),
  area('الحي الثالث عشر', 'الشيخ زايد', 'district'),
  area('الحي الرابع عشر', 'الشيخ زايد', 'district'),
  area('الحي السادس عشر', 'الشيخ زايد', 'district'),
  area('بيت الوطن الشيخ زايد', 'الشيخ زايد', 'compound'),
  area('زايد الجديدة', 'الشيخ زايد'),
];

const NEW_CAIRO_TAGAMOA_AREAS: ShippingDistrict[] = [
  area('التجمع الأول', 'القاهرة الجديدة', 'district'),
  area('التجمع الثالث', 'القاهرة الجديدة', 'district'),
  area('التجمع الخامس', 'القاهرة الجديدة', 'district'),
  area('النرجس', 'القاهرة الجديدة'),
  area('البنفسج', 'القاهرة الجديدة'),
  area('الياسمين', 'القاهرة الجديدة'),
  area('اللوتس', 'القاهرة الجديدة'),
  area('القرنفل', 'القاهرة الجديدة'),
  area('الأندلس', 'القاهرة الجديدة'),
  area('بيت الوطن', 'القاهرة الجديدة', 'compound'),
  area('المستثمرين الشمالية', 'القاهرة الجديدة'),
  area('المستثمرين الجنوبية', 'القاهرة الجديدة'),
  area('الدبلوماسيين', 'القاهرة الجديدة'),
  area('الجامعة الأمريكية', 'القاهرة الجديدة'),
  area('الفردوس', 'القاهرة الجديدة'),
];

const NASR_CITY_AREAS: ShippingDistrict[] = [
  area('الحي السابع', 'مدينة نصر', 'district'),
  area('الحي الثامن', 'مدينة نصر', 'district'),
  area('الحي العاشر', 'مدينة نصر', 'district'),
  area('عباس العقاد', 'مدينة نصر'),
  area('مكرم عبيد', 'مدينة نصر'),
  area('زهراء مدينة نصر', 'مدينة نصر'),
];

const HELIOPOLIS_AREAS: ShippingDistrict[] = [
  area('الكوربة', 'هليوبوليس (مصر الجديدة)'),
  area('روكسي', 'هليوبوليس (مصر الجديدة)'),
  area('سانت فاتيما', 'هليوبوليس (مصر الجديدة)'),
  area('ميدان الحجاز', 'هليوبوليس (مصر الجديدة)'),
  area('شيراتون', 'هليوبوليس (مصر الجديدة)'),
  area('ألماظة', 'هليوبوليس (مصر الجديدة)'),
];

const MAADI_AREAS: ShippingDistrict[] = [
  area('المعادي الجديدة', 'المعادي'),
  area('زهراء المعادي', 'المعادي'),
  area('دجلة', 'المعادي'),
  area('حدائق المعادي', 'المعادي'),
  area('طرة', 'المعادي'),
];

// ─── Cairo (existing in DB) ─────────────────────────────────────────────────
// Live row already carries the curated district list; the merge step
// reads existing districts as-is. We list ONLY the manual supplements
// here (with parent set to the canonical existing entry name) so the
// hierarchy gets attached without disturbing curated state.
const CAIRO: ShippingGovernorate = {
  name: 'القاهرة',
  fee: 150, // value irrelevant — overridden by existing fee on merge
  enabled: true,
  source: 'existing',
  districts: [
    ...NEW_CAIRO_TAGAMOA_AREAS,
    ...NASR_CITY_AREAS,
    ...HELIOPOLIS_AREAS,
    ...MAADI_AREAS,
    area('عين الحياة', 'القاهرة الجديدة', 'compound'),
    area('الجولف', 'القاهرة الجديدة'),
  ],
};

// ─── Giza (existing in DB) ──────────────────────────────────────────────────
const GIZA: ShippingGovernorate = {
  name: 'الجيزة',
  fee: 50, // value irrelevant on merge
  enabled: true,
  source: 'existing',
  districts: [...SIX_OCTOBER_AREAS, ...SHEIKH_ZAYED_AREAS],
};

// ─── Qalyubia (existing in DB) ──────────────────────────────────────────────
// No supplements listed in the spec; the existing live row stays
// authoritative.
const QALYUBIA: ShippingGovernorate = {
  name: 'القليوبية',
  fee: 60,
  enabled: true,
  source: 'existing',
  districts: [],
};

// ─── Alexandria ─────────────────────────────────────────────────────────────
const ALEXANDRIA: ShippingGovernorate = {
  name: 'الإسكندرية',
  fee: 0,
  enabled: false,
  source: 'official',
  districts: [
    city('وسط المدينة', 'kism'),
    city('المنتزه', 'kism'),
    city('شرق', 'kism'),
    city('غرب', 'kism'),
    city('الجمرك', 'kism'),
    city('العامرية', 'kism'),
    city('برج العرب الجديدة', 'city'),
    city('سيدي جابر', 'district'),
    city('سموحة', 'district'),
    city('العصافرة', 'district'),
    city('المعمورة', 'district'),
    city('سيدي بشر', 'district'),
    city('ميامي', 'district'),
    city('الإبراهيمية', 'district'),
    city('محرم بك', 'district'),
    city('الورديان', 'district'),
    city('الأنفوشي', 'district'),
    city('باكوس', 'district'),
    city('فلمنج', 'district'),
    city('بيانكي', 'district'),
    city('السيوف', 'district'),
    city('سيدي كرير', 'area'),
    city('العجمي', 'area'),
    city('برج العرب', 'city'),
  ],
};

// ─── Sharqia ────────────────────────────────────────────────────────────────
const SHARQIA: ShippingGovernorate = {
  name: 'الشرقية',
  fee: 0,
  enabled: false,
  source: 'official',
  districts: [
    city('الزقازيق', 'markaz'),
    city('بلبيس', 'markaz'),
    city('العاشر من رمضان', 'city'),
    city('فاقوس', 'markaz'),
    city('أبو حماد', 'markaz'),
    city('منيا القمح', 'markaz'),
    city('الإبراهيمية', 'markaz'),
    city('كفر صقر', 'markaz'),
    city('ههيا', 'markaz'),
    city('أبو كبير', 'markaz'),
    city('ديرب نجم', 'markaz'),
    city('الحسينية', 'markaz'),
    city('مشتول السوق', 'markaz'),
    city('القنايات', 'markaz'),
    city('القرين', 'markaz'),
    city('أولاد صقر', 'markaz'),
    city('صان الحجر', 'markaz'),
    city('الصالحية الجديدة', 'markaz'),
  ],
};

// ─── Daqahlia ───────────────────────────────────────────────────────────────
const DAQAHLIA: ShippingGovernorate = {
  name: 'الدقهلية',
  fee: 0,
  enabled: false,
  source: 'official',
  districts: [
    city('المنصورة', 'markaz'),
    city('طلخا', 'markaz'),
    city('ميت غمر', 'markaz'),
    city('بلقاس', 'markaz'),
    city('السنبلاوين', 'markaz'),
    city('شربين', 'markaz'),
    city('المطرية', 'markaz'),
    city('دكرنس', 'markaz'),
    city('ميت سلسيل', 'markaz'),
    city('الجمالية', 'markaz'),
    city('بني عبيد', 'markaz'),
    city('أجا', 'markaz'),
    city('منية النصر', 'markaz'),
    city('نبروه', 'markaz'),
    city('تمي الأمديد', 'markaz'),
    city('جمصة', 'city'),
    city('محلة دمنة', 'markaz'),
  ],
};

// ─── Beheira ────────────────────────────────────────────────────────────────
const BEHEIRA: ShippingGovernorate = {
  name: 'البحيرة',
  fee: 0,
  enabled: false,
  source: 'official',
  districts: [
    city('دمنهور', 'markaz'),
    city('كفر الدوار', 'markaz'),
    city('رشيد', 'markaz'),
    city('إدكو', 'markaz'),
    city('أبو حمص', 'markaz'),
    city('الدلنجات', 'markaz'),
    city('المحمودية', 'markaz'),
    city('الرحمانية', 'markaz'),
    city('إيتاي البارود', 'markaz'),
    city('حوش عيسى', 'markaz'),
    city('شبراخيت', 'markaz'),
    city('كوم حمادة', 'markaz'),
    city('بدر', 'markaz'),
    city('وادي النطرون', 'markaz'),
    city('النوبارية الجديدة', 'city'),
  ],
};

// ─── Marsa Matruh ───────────────────────────────────────────────────────────
const MATROUH: ShippingGovernorate = {
  name: 'مطروح',
  fee: 0,
  enabled: false,
  source: 'official',
  districts: [
    city('مطروح', 'markaz'),
    city('الحمام', 'markaz'),
    city('العلمين', 'markaz'),
    city('الضبعة', 'markaz'),
    city('النجيلة', 'markaz'),
    city('سيدي براني', 'markaz'),
    city('السلوم', 'markaz'),
    city('سيوة', 'markaz'),
  ],
};

// ─── Kafr el Sheikh ─────────────────────────────────────────────────────────
const KAFR_EL_SHEIKH: ShippingGovernorate = {
  name: 'كفر الشيخ',
  fee: 0,
  enabled: false,
  source: 'official',
  districts: [
    city('كفر الشيخ', 'markaz'),
    city('دسوق', 'markaz'),
    city('فوه', 'markaz'),
    city('مطوبس', 'markaz'),
    city('بيلا', 'markaz'),
    city('الحامول', 'markaz'),
    city('الرياض', 'markaz'),
    city('سيدي سالم', 'markaz'),
    city('قلين', 'markaz'),
    city('بلطيم', 'markaz'),
  ],
};

// ─── Gharbia ────────────────────────────────────────────────────────────────
const GHARBIA: ShippingGovernorate = {
  name: 'الغربية',
  fee: 0,
  enabled: false,
  source: 'official',
  districts: [
    city('طنطا', 'markaz'),
    city('المحلة الكبرى', 'markaz'),
    city('كفر الزيات', 'markaz'),
    city('زفتى', 'markaz'),
    city('السنطة', 'markaz'),
    city('قطور', 'markaz'),
    city('بسيون', 'markaz'),
    city('سمنود', 'markaz'),
  ],
};

// ─── Monoufia ───────────────────────────────────────────────────────────────
const MONOUFIA: ShippingGovernorate = {
  name: 'المنوفية',
  fee: 0,
  enabled: false,
  source: 'official',
  districts: [
    city('شبين الكوم', 'markaz'),
    city('منوف', 'markaz'),
    city('سرس الليان', 'markaz'),
    city('قويسنا', 'markaz'),
    city('بركة السبع', 'markaz'),
    city('تلا', 'markaz'),
    city('أشمون', 'markaz'),
    city('الباجور', 'markaz'),
    city('الشهداء', 'markaz'),
    city('السادات', 'city'),
  ],
};

// ─── Damietta ───────────────────────────────────────────────────────────────
const DAMIETTA: ShippingGovernorate = {
  name: 'دمياط',
  fee: 0,
  enabled: false,
  source: 'official',
  districts: [
    city('دمياط', 'markaz'),
    city('فارسكور', 'markaz'),
    city('الزرقا', 'markaz'),
    city('كفر سعد', 'markaz'),
    city('كفر البطيخ', 'markaz'),
    city('الروضة', 'markaz'),
    city('ميت أبو غالب', 'markaz'),
    city('السرو', 'markaz'),
    city('رأس البر', 'city'),
    city('عزبة البرج', 'city'),
    city('دمياط الجديدة', 'city'),
  ],
};

// ─── Port Said ──────────────────────────────────────────────────────────────
const PORT_SAID: ShippingGovernorate = {
  name: 'بورسعيد',
  fee: 0,
  enabled: false,
  source: 'official',
  districts: [
    city('المناخ', 'kism'),
    city('الشرق', 'kism'),
    city('الضواحي', 'kism'),
    city('العرب', 'kism'),
    city('الزهور', 'kism'),
    city('الجنوب', 'kism'),
    city('بورفؤاد', 'kism'),
    city('بورسعيد الجديدة', 'city'),
  ],
};

// ─── Ismailia ───────────────────────────────────────────────────────────────
const ISMAILIA: ShippingGovernorate = {
  name: 'الإسماعيلية',
  fee: 0,
  enabled: false,
  source: 'official',
  districts: [
    city('الإسماعيلية', 'markaz'),
    city('فايد', 'markaz'),
    city('القنطرة شرق', 'markaz'),
    city('القنطرة غرب', 'markaz'),
    city('التل الكبير', 'markaz'),
    city('أبو صوير', 'markaz'),
    city('القصاصين الجديدة', 'markaz'),
    city('نفيشة', 'markaz'),
  ],
};

// ─── Suez ───────────────────────────────────────────────────────────────────
const SUEZ: ShippingGovernorate = {
  name: 'السويس',
  fee: 0,
  enabled: false,
  source: 'official',
  districts: [
    city('السويس', 'kism'),
    city('الأربعين', 'kism'),
    city('عتاقة', 'kism'),
    city('الجناين', 'kism'),
    city('فيصل', 'kism'),
  ],
};

// ─── North Sinai ────────────────────────────────────────────────────────────
const NORTH_SINAI: ShippingGovernorate = {
  name: 'شمال سيناء',
  fee: 0,
  enabled: false,
  source: 'official',
  districts: [
    city('العريش', 'markaz'),
    city('الشيخ زويد', 'markaz'),
    city('رفح', 'markaz'),
    city('بئر العبد', 'markaz'),
    city('الحسنة', 'markaz'),
    city('نخل', 'markaz'),
  ],
};

// ─── South Sinai ────────────────────────────────────────────────────────────
const SOUTH_SINAI: ShippingGovernorate = {
  name: 'جنوب سيناء',
  fee: 0,
  enabled: false,
  source: 'official',
  districts: [
    city('الطور', 'markaz'),
    city('شرم الشيخ', 'city'),
    city('دهب', 'city'),
    city('نويبع', 'city'),
    city('طابا', 'city'),
    city('سانت كاترين', 'city'),
    city('أبو رديس', 'markaz'),
    city('أبو زنيمة', 'markaz'),
    city('رأس سدر', 'markaz'),
  ],
};

// ─── Beni Suef ──────────────────────────────────────────────────────────────
const BENI_SUEF: ShippingGovernorate = {
  name: 'بني سويف',
  fee: 0,
  enabled: false,
  source: 'official',
  districts: [
    city('بني سويف', 'markaz'),
    city('الواسطى', 'markaz'),
    city('ناصر', 'markaz'),
    city('إهناسيا', 'markaz'),
    city('ببا', 'markaz'),
    city('سمسطا', 'markaz'),
    city('الفشن', 'markaz'),
    city('بني سويف الجديدة', 'city'),
  ],
};

// ─── Fayoum ─────────────────────────────────────────────────────────────────
const FAYOUM: ShippingGovernorate = {
  name: 'الفيوم',
  fee: 0,
  enabled: false,
  source: 'official',
  districts: [
    city('الفيوم', 'markaz'),
    city('سنورس', 'markaz'),
    city('إطسا', 'markaz'),
    city('طامية', 'markaz'),
    city('يوسف الصديق', 'markaz'),
    city('إبشواي', 'markaz'),
    city('الفيوم الجديدة', 'city'),
  ],
};

// ─── Minya ──────────────────────────────────────────────────────────────────
const MINYA: ShippingGovernorate = {
  name: 'المنيا',
  fee: 0,
  enabled: false,
  source: 'official',
  districts: [
    city('المنيا', 'markaz'),
    city('بني مزار', 'markaz'),
    city('مغاغة', 'markaz'),
    city('مطاي', 'markaz'),
    city('سمالوط', 'markaz'),
    city('ملوي', 'markaz'),
    city('دير مواس', 'markaz'),
    city('أبو قرقاص', 'markaz'),
    city('المنيا الجديدة', 'city'),
  ],
};

// ─── Asyut ──────────────────────────────────────────────────────────────────
const ASYUT: ShippingGovernorate = {
  name: 'أسيوط',
  fee: 0,
  enabled: false,
  source: 'official',
  districts: [
    city('أسيوط', 'markaz'),
    city('ديروط', 'markaz'),
    city('منفلوط', 'markaz'),
    city('القوصية', 'markaz'),
    city('أبنوب', 'markaz'),
    city('أبو تيج', 'markaz'),
    city('الغنايم', 'markaz'),
    city('ساحل سليم', 'markaz'),
    city('البداري', 'markaz'),
    city('صدفا', 'markaz'),
    city('الفتح', 'markaz'),
    city('أسيوط الجديدة', 'city'),
  ],
};

// ─── Sohag ──────────────────────────────────────────────────────────────────
const SOHAG: ShippingGovernorate = {
  name: 'سوهاج',
  fee: 0,
  enabled: false,
  source: 'official',
  districts: [
    city('سوهاج', 'markaz'),
    city('أخميم', 'markaz'),
    city('البلينا', 'markaz'),
    city('جرجا', 'markaz'),
    city('المراغة', 'markaz'),
    city('المنشاه', 'markaz'),
    city('دار السلام', 'markaz'),
    city('ساقلتة', 'markaz'),
    city('طما', 'markaz'),
    city('طهطا', 'markaz'),
    city('جهينة', 'markaz'),
    city('سوهاج الجديدة', 'city'),
    city('أخميم الجديدة', 'city'),
  ],
};

// ─── Qena ───────────────────────────────────────────────────────────────────
const QENA: ShippingGovernorate = {
  name: 'قنا',
  fee: 0,
  enabled: false,
  source: 'official',
  districts: [
    city('قنا', 'markaz'),
    city('قوص', 'markaz'),
    city('نقادة', 'markaz'),
    city('قفط', 'markaz'),
    city('أبو تشت', 'markaz'),
    city('فرشوط', 'markaz'),
    city('نجع حمادي', 'markaz'),
    city('دشنا', 'markaz'),
    city('الوقف', 'markaz'),
    city('قنا الجديدة', 'city'),
  ],
};

// ─── Luxor ──────────────────────────────────────────────────────────────────
const LUXOR: ShippingGovernorate = {
  name: 'الأقصر',
  fee: 0,
  enabled: false,
  source: 'official',
  districts: [
    city('الأقصر', 'markaz'),
    city('إسنا', 'markaz'),
    city('أرمنت', 'markaz'),
    city('الطود', 'markaz'),
    city('البياضية', 'markaz'),
    city('القرنة', 'markaz'),
    city('الزينية', 'markaz'),
    city('الأقصر الجديدة', 'city'),
    city('طيبة الجديدة', 'city'),
  ],
};

// ─── Aswan ──────────────────────────────────────────────────────────────────
const ASWAN: ShippingGovernorate = {
  name: 'أسوان',
  fee: 0,
  enabled: false,
  source: 'official',
  districts: [
    city('أسوان', 'markaz'),
    city('دراو', 'markaz'),
    city('كوم أمبو', 'markaz'),
    city('نصر النوبة', 'markaz'),
    city('إدفو', 'markaz'),
    city('السباعية', 'markaz'),
    city('أبو سمبل السياحية', 'markaz'),
    city('أسوان الجديدة', 'city'),
  ],
};

// ─── Red Sea ────────────────────────────────────────────────────────────────
const RED_SEA: ShippingGovernorate = {
  name: 'البحر الأحمر',
  fee: 0,
  enabled: false,
  source: 'official',
  districts: [
    city('الغردقة', 'markaz'),
    city('سفاجا', 'markaz'),
    city('القصير', 'markaz'),
    city('مرسى علم', 'markaz'),
    city('الشلاتين', 'markaz'),
    city('حلايب', 'markaz'),
    city('رأس غارب', 'markaz'),
    city('الغردقة الجديدة', 'city'),
  ],
};

// ─── New Valley ─────────────────────────────────────────────────────────────
const NEW_VALLEY: ShippingGovernorate = {
  name: 'الوادي الجديد',
  fee: 0,
  enabled: false,
  source: 'official',
  districts: [
    city('الخارجة', 'markaz'),
    city('باريس', 'markaz'),
    city('الداخلة', 'markaz'),
    city('الفرافرة', 'markaz'),
    city('بلاط', 'markaz'),
  ],
};

// ─── Final ordered seed ─────────────────────────────────────────────────────
// Order matches the canonical 27-governorate order (administrative
// regions). Existing govs first so the merge step's "preserve order"
// behaviour keeps the cards in the same place admins are used to.
export const EGYPT_SHIPPING_COVERAGE_SEED: ShippingGovernorate[] = [
  CAIRO,
  GIZA,
  QALYUBIA,
  ALEXANDRIA,
  BEHEIRA,
  MATROUH,
  KAFR_EL_SHEIKH,
  GHARBIA,
  MONOUFIA,
  DAQAHLIA,
  DAMIETTA,
  PORT_SAID,
  ISMAILIA,
  SUEZ,
  SHARQIA,
  NORTH_SINAI,
  SOUTH_SINAI,
  BENI_SUEF,
  FAYOUM,
  MINYA,
  ASYUT,
  SOHAG,
  QENA,
  LUXOR,
  ASWAN,
  RED_SEA,
  NEW_VALLEY,
];

export const SEED_GOVERNORATES_TOTAL = EGYPT_SHIPPING_COVERAGE_SEED.length;
