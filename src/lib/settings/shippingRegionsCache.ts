// ─────────────────────────────────────────────────────────────────────────────
// src/lib/settings/shippingRegionsCache.ts
//
// Phase E1-Fix2 — client-side cache for the shipping-regions payload
// served by `/api/settings/shipping-regions`.
//
// Why this exists
//   `turath_masr_settings.settings_regions` carries ~754 KB of
//   governorate / area / neighborhood JSON. Before this PR, every
//   AddOrderModal mount fetched it directly from Supabase
//   (`from('turath_masr_settings').select('value').eq('key',
//   'settings_regions')`). After PR #41 + #42 it remained the single
//   largest egress source on every modal open. Caching the response
//   for 5 minutes per browser session removes that repeat cost
//   entirely while keeping admin edits visible within the same tab
//   (the `/settings` save flow calls `clearShippingRegionsCache()`
//   after a successful upsert of `settings_regions`).
//
// Cache layout (two layers, both 5-minute TTL):
//   1. Module-level in-memory cache. Fast path — survives across
//      React renders within the same SPA navigation.
//   2. `sessionStorage` under `turath:settings_regions:v1`. Survives
//      a browser hard refresh inside the same tab. Cleared
//      automatically on tab close. Capped at 5 MB by the browser; the
//      ~754 KB regions payload fits comfortably.
//
// Reads consult both layers in order; writes update both. Expiry is
// checked on every read.
//
// Why NOT localStorage
//   Tab-scoped is the right scope for an admin tool: a different
//   user signing in on the same browser shouldn't get the previous
//   admin's cached regions snapshot. `sessionStorage` is also cleared
//   automatically on logout via the auth flow's storage scrub.
//
// Why NOT a service worker / IndexedDB
//   This single key, this small (in cache terms), this short TTL,
//   does not warrant the operational complexity. A trivial in-memory
//   + sessionStorage layer matches the cost shape exactly.
//
// Cache-key versioning
//   The `:v1` suffix lets us bust the cache by bumping the version
//   if the payload shape ever changes (e.g. if `settings_regions`
//   stops being a plain array). No-op for now; reserved for safety.
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_KEY = 'turath:settings_regions:v1';
const TTL_MS = 5 * 60 * 1000; // 5 minutes
const ENDPOINT = '/api/settings/shipping-regions';

type RegionsPayload = unknown[];

interface CacheEntry {
  value: RegionsPayload;
  expiresAt: number;
}

// Module-level cache. Lives for the duration of the SPA session
// (re-instantiated on hard refresh). Reset to null on TTL expiry.
let memCache: CacheEntry | null = null;

function readMem(): CacheEntry | null {
  if (memCache && memCache.expiresAt > Date.now()) {
    return memCache;
  }
  if (memCache && memCache.expiresAt <= Date.now()) {
    memCache = null;
  }
  return null;
}

function readSessionStorage(): CacheEntry | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray(parsed.value) &&
      typeof parsed.expiresAt === 'number' &&
      parsed.expiresAt > Date.now()
    ) {
      return parsed;
    }
    // Expired or malformed — clean up.
    window.sessionStorage.removeItem(CACHE_KEY);
    return null;
  } catch {
    return null;
  }
}

function writeCache(value: RegionsPayload) {
  const entry: CacheEntry = { value, expiresAt: Date.now() + TTL_MS };
  memCache = entry;
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // sessionStorage quota exceeded or disabled (Safari private mode).
    // Memory cache still works for the rest of this SPA session.
  }
}

/**
 * Drop the cached shipping-regions payload from both layers.
 * Called by `/settings` after a successful save of `settings_regions`
 * so admin edits surface within the same tab without waiting for the
 * 5-minute TTL.
 */
export function clearShippingRegionsCache(): void {
  memCache = null;
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(CACHE_KEY);
  } catch {
    // best-effort
  }
}

/**
 * Fetch the shipping-regions payload, preferring the cached copy when
 * available. Used by `AddOrderModal` to avoid re-issuing the heavy
 * `select('value').eq('key', 'settings_regions')` Supabase query on
 * every modal open.
 *
 * Behaviour:
 *   - Hit on memory cache       → returns synchronously-resolved promise.
 *   - Hit on sessionStorage     → re-hydrates memory cache, returns.
 *   - Miss on both              → fetches `/api/settings/shipping-regions`,
 *                                 writes both cache layers, returns.
 *   - Network / parse error     → throws; the caller is expected to
 *                                 fall back to an empty list (matching
 *                                 the pre-route behaviour where a
 *                                 missing row rendered an empty regions
 *                                 picker). No silent caching of empty
 *                                 results from a failure.
 */
export async function getShippingRegions(): Promise<RegionsPayload> {
  const fromMem = readMem();
  if (fromMem) return fromMem.value;

  const fromStorage = readSessionStorage();
  if (fromStorage) {
    memCache = fromStorage;
    return fromStorage.value;
  }

  // Cache miss — fetch through the new server route.
  // `cache: 'no-store'` is intentional: we don't want a stale browser
  // HTTP cache hit to override our explicit application-side TTL.
  // The server route still emits its own Cache-Control header so a
  // future SPA navigation that re-instantiates this module without
  // remounting the tab can be served from the browser HTTP cache.
  const res = await fetch(ENDPOINT, { method: 'GET', cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`shipping-regions fetch failed: ${res.status}`);
  }
  const json: unknown = await res.json();
  const value: RegionsPayload = Array.isArray(json) ? (json as unknown[]) : [];
  writeCache(value);
  return value;
}
