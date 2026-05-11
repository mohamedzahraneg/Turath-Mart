// ─────────────────────────────────────────────────────────────────────────────
// src/lib/phone/egyptPhone.ts
//
// Phase 24B-Fix1 — single source of truth for Egyptian-phone handling.
// Every phone-writing surface in the app (Add Order, Edit Order,
// customer CRM, complaints + chat API routes, customer tracking) calls
// into this module so we never store Arabic-Indic (`٠-٩`) or Persian
// (`۰-۹`) digits anywhere downstream.
//
// Public API:
//   toEnglishDigits(input)          → normalise just the digit glyphs.
//   normalizeEgyptPhone(input)      → canonical 01XXXXXXXXX form, or null.
//   normalizeEgyptPhoneLoose(input) → best-effort digits string, never null.
//   isLikelyEgyptMobile(input)      → strict mobile-prefix validator.
//   formatPhoneDisplay(input)       → user-facing display string.
//
// Pure module — no React, no Supabase, no DOM.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert Arabic-Indic (U+0660..U+0669) and Eastern Arabic / Persian
 * (U+06F0..U+06F9) digit glyphs to ASCII `0`–`9`. Non-digit
 * characters are passed through unchanged so callers can still do
 * regex / display work on the result.
 */
export function toEnglishDigits(input: string | null | undefined): string {
  if (input == null) return '';
  return String(input).replace(/[٠-٩۰-۹]/g, (ch) => {
    const code = ch.charCodeAt(0);
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
    if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
    return ch;
  });
}

/**
 * Canonical Egyptian-mobile normaliser.
 *
 *   01012345678         → 01012345678
 *   +201012345678       → 01012345678
 *   00201012345678      → 01012345678
 *   ٠١٠١٢٣٤٥٦٧٨        → 01012345678  (Arabic-Indic digits)
 *   ۰۱۰۱۲۳۴۵۶۷۸        → 01012345678  (Persian digits)
 *   1012345678          → 01012345678
 *
 * Anything that yields fewer than 5 digits returns `null` so the
 * caller can flag invalid input. The helper is intentionally tolerant
 * with shape — strict mobile-pattern validation is `isLikelyEgyptMobile`.
 */
export function normalizeEgyptPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const ascii = toEnglishDigits(input);
  let digits = ascii.replace(/\D+/g, '');
  if (digits.length === 0) return null;
  if (digits.startsWith('0020')) digits = digits.slice(4);
  else if (digits.startsWith('002')) digits = digits.slice(3);
  else if (digits.startsWith('20') && digits.length >= 12) digits = digits.slice(2);
  if (digits.length < 5) return null;
  // Re-apply the canonical leading 0 for the local EG mobile pattern.
  if (digits.length === 10 && digits.startsWith('1')) digits = '0' + digits;
  return digits;
}

/**
 * Best-effort normaliser. Returns the digit-only representation of
 * the input (Arabic / Persian glyphs converted), even when shorter
 * than 5 chars. Used by input `onChange` handlers that want to
 * live-update the field value without flickering "null" while the
 * user is mid-typing.
 */
export function normalizeEgyptPhoneLoose(input: string | null | undefined): string {
  if (input == null) return '';
  return toEnglishDigits(input).replace(/[^\d+]/g, '');
}

/**
 * Strict Egyptian mobile validator. Returns `true` only when the
 * normalised value matches `^01[0125][0-9]{8}$` — 11 digits, leading
 * `01`, and the second digit in the carrier-prefix set {0, 1, 2, 5}.
 */
export function isLikelyEgyptMobile(input: string | null | undefined): boolean {
  const n = normalizeEgyptPhone(input);
  if (!n) return false;
  return /^01[0125][0-9]{8}$/.test(n);
}

/**
 * Display helper — guarantees a Latin-digit string for any UI render
 * path. Trims whitespace and falls back to an em-dash on empty input
 * so dashboards never paint a blank cell.
 */
export function formatPhoneDisplay(input: string | null | undefined): string {
  if (input == null) return '—';
  const ascii = toEnglishDigits(input).trim();
  return ascii.length > 0 ? ascii : '—';
}

/**
 * Phase 24B-Fix1 — `<input>` change-handler helper. Returns a string
 * with Arabic / Persian digits live-converted to ASCII while keeping
 * the user's chosen `+` / leading-zero shape intact. Caller wires it
 * as `onChange={(e) => setPhone(sanitizePhoneInput(e.target.value))}`.
 */
export function sanitizePhoneInput(raw: string): string {
  // Convert glyphs first so the user sees ASCII as they type.
  const ascii = toEnglishDigits(raw);
  // Allow digits + `+` + spaces / dashes / parens so the user can
  // still type "01 234 5678" while we're storing the digit-only form.
  // Strip everything else so a paste of "tel:0100…" doesn't survive.
  return ascii.replace(/[^\d+\s\-()]/g, '');
}
