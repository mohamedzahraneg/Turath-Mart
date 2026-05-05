// ─────────────────────────────────────────────────────────────────────────────
// Egyptian mobile number validators.
//
// Matches the existing pattern used across the app: an 11-digit number that
// starts with `01`. The four real EG mobile operator prefixes are 010, 011,
// 012, 015 — but we keep the looser `01[0-9]` check on purpose so this
// extraction is behaviour-neutral with the inline regex it replaces.
//
// TODO: tighten to `^01[0125][0-9]{8}$` once we confirm no legacy data
// relies on out-of-range prefixes.
// ─────────────────────────────────────────────────────────────────────────────

const EG_MOBILE_REGEX = /^01[0-9]{9}$/;

/** True if the given string is a valid Egyptian mobile number. */
export function isValidEgyptianMobile(input: string | null | undefined): boolean {
  if (!input) return false;
  return EG_MOBILE_REGEX.test(input.trim());
}

/** Return a normalised version (digits only, trimmed) or null if invalid. */
export function normaliseEgyptianMobile(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/\D/g, '');
  return EG_MOBILE_REGEX.test(digits) ? digits : null;
}
