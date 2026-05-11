// ─────────────────────────────────────────────────────────────────────────────
// src/lib/security/deviceFingerprint.ts
//
// Phase 26A — privacy-conscious device id for staff sign-ins.
//
// We do NOT want to do invasive browser fingerprinting (canvas / fonts /
// WebGL etc.). Instead:
//
//   1. The first time the app sees a tab, it generates a random UUID
//      and stores it in localStorage under `turath_device_id`. This
//      survives reloads + reopens on the same browser profile but is
//      naturally scoped to the user's own machine — nothing in the
//      string identifies the device beyond "this browser profile".
//
//   2. We compute a short human-readable label from `navigator.userAgent`
//      so admins can recognise a row at a glance (`Chrome on macOS`,
//      `Safari on iPhone`, …) without staring at the raw UA.
//
//   3. The full `userAgent` is stored alongside as `user_agent` for
//      later analysis, but it's never used as the fingerprint itself.
//
// Server-side IP capture lives in `/api/security/session-event` — we
// take the first hop of `x-forwarded-for` and fall back to `x-real-ip`.
// Nothing here touches IP.
//
// Pure-client module. Safe to import from anywhere. SSR-safe: every
// function checks for `typeof window` before touching DOM globals.
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'turath_device_id';

/**
 * Read the stable device id from localStorage, or generate + persist
 * one on first call. Returns `null` on the server / when storage is
 * unavailable.
 */
export function getOrCreateDeviceId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing && /^[0-9a-f-]{32,36}$/i.test(existing)) {
      return existing;
    }
    const fresh = generateUuid();
    window.localStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // Private mode, storage disabled, etc.
    return null;
  }
}

/**
 * UUID v4 with a crypto-grade fallback. `crypto.randomUUID()` is
 * widely available (Safari 15.4+, Chrome 92+); for older browsers we
 * fall back to `crypto.getRandomValues()` with the standard v4 byte
 * pattern.
 */
function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // Last-resort fallback. Not crypto-grade but enough to deduplicate
  // device rows; admin review still gates blocking.
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}

/**
 * Render a short Arabic-friendly device label from the browser's user
 * agent. The label is for admin readability only — the fingerprint is
 * what actually identifies the row.
 *
 * Examples:
 *   `Chrome على Windows`
 *   `Safari على iPhone`
 *   `Firefox على macOS`
 *   `متصفح غير معروف`
 */
export function describeUserAgent(userAgent?: string | null): string {
  const ua = (
    userAgent ??
    (typeof navigator !== 'undefined' ? navigator.userAgent : '') ??
    ''
  ).trim();
  if (!ua) return 'متصفح غير معروف';
  const browser = /edg\//i.test(ua)
    ? 'Edge'
    : /opr\//i.test(ua)
      ? 'Opera'
      : /chrome\//i.test(ua) && !/edg\//i.test(ua)
        ? 'Chrome'
        : /firefox\//i.test(ua)
          ? 'Firefox'
          : /safari\//i.test(ua)
            ? 'Safari'
            : 'متصفح';
  const platform = /iphone/i.test(ua)
    ? 'iPhone'
    : /ipad/i.test(ua)
      ? 'iPad'
      : /android/i.test(ua)
        ? 'Android'
        : /mac os x|macintosh/i.test(ua)
          ? 'macOS'
          : /windows/i.test(ua)
            ? 'Windows'
            : /linux/i.test(ua)
              ? 'Linux'
              : 'جهاز';
  return `${browser} على ${platform}`;
}

export interface DeviceContext {
  fingerprint: string | null;
  label: string;
  userAgent: string;
}

/**
 * Convenience bundle for callers that want both the fingerprint and a
 * label in one call. Returns `null` fingerprint server-side.
 */
export function collectDeviceContext(): DeviceContext {
  if (typeof window === 'undefined') {
    return { fingerprint: null, label: '', userAgent: '' };
  }
  const userAgent = navigator.userAgent ?? '';
  return {
    fingerprint: getOrCreateDeviceId(),
    label: describeUserAgent(userAgent),
    userAgent,
  };
}

/**
 * Convenience for test / sign-out flows to forget the local device id
 * (e.g. when the admin tells the staff member "wipe + re-register").
 * The next call to `getOrCreateDeviceId` will mint a fresh one.
 */
export function clearDeviceId(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
