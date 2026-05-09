// ─────────────────────────────────────────────────────────────────────────────
// Arabic-friendly string utilities.
//
// Phase 22K — added for the district smart-search in AddOrderModal so that
// users can type "هرم", "الهرم" or "الـهرم  " and still match the canonical
// "الهرم" entry in shipping settings. The same helpers are useful anywhere
// we need fuzzy Arabic comparison (CRM customer search, etc.).
//
// `normalizeArabic` does the four classes of normalisation Arabic search
// users expect:
//
//   1. Whitespace: trim + collapse internal runs of whitespace into one
//      space.
//   2. Case: lowercase the whole string. (Egyptian shipping data is
//      Arabic-only in practice but mixed-case English place names can
//      sneak in via free-form admin edits.)
//   3. Alef forms: أ / إ / آ / ٱ → ا.
//   4. Yaa / taa-marbuta: ى → ي and ة → ه. (Some inputs use ي for ى and
//      vice versa; some use ة where ه is expected. Treat them as equal.)
//
// We deliberately do NOT strip Arabic diacritics (tashkeel) here — the
// shipping settings data doesn't carry them, but if a future flow needs
// them stripped we can extend in one place.
//
// Pure function, no side effects, safe in any context (server, client,
// edge runtime).
// ─────────────────────────────────────────────────────────────────────────────

const ALEF_VARIANTS_RE = /[أإآٱ]/g; // أ إ آ ٱ
const YAA_VARIANTS_RE = /ى/g; // ى → ي
const TAA_MARBUTA_RE = /ة/g; // ة → ه
const COLLAPSE_WS_RE = /\s+/g;

/**
 * Normalise an Arabic-or-mixed string for case-insensitive, fuzzy
 * comparison. Returns an empty string for null/undefined/empty input
 * so callers can call `.includes(...)` without a null check.
 */
export function normalizeArabic(input: string | null | undefined): string {
  if (!input) return '';
  return String(input)
    .replace(COLLAPSE_WS_RE, ' ')
    .trim()
    .replace(ALEF_VARIANTS_RE, 'ا') // ا
    .replace(YAA_VARIANTS_RE, 'ي') // ي
    .replace(TAA_MARBUTA_RE, 'ه') // ه
    .toLowerCase();
}

/**
 * Convenience: returns true if `haystack` contains `needle` after both
 * have been normalised. An empty needle matches everything (including
 * empty strings) — the caller should usually short-circuit on
 * empty-needle to "no filtering applied".
 */
export function arabicIncludes(
  haystack: string | null | undefined,
  needle: string | null | undefined
): boolean {
  const n = normalizeArabic(needle);
  if (!n) return true;
  return normalizeArabic(haystack).includes(n);
}
