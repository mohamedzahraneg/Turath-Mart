// ─────────────────────────────────────────────────────────────────────────────
// Minimal email validator.
//
// We don't need a full RFC 5322 parser — the goal is to catch obvious
// client-side input mistakes before round-tripping to Supabase auth.
// ─────────────────────────────────────────────────────────────────────────────

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(input: string | null | undefined): boolean {
  if (!input) return false;
  return EMAIL_REGEX.test(input.trim());
}
