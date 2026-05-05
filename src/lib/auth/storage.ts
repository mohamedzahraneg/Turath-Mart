import { APP_STORAGE_KEYS } from './routes';

/**
 * Clear ONLY app-owned localStorage keys.
 * Does NOT touch Supabase auth keys (those are owned by supabase.auth.signOut())
 * and does NOT clear unrelated data from other apps on the same origin.
 */
export function clearAppStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    for (const key of APP_STORAGE_KEYS) {
      try {
        localStorage.removeItem(key);
      } catch {
        // ignore individual key failures (e.g. SecurityError in private mode)
      }
    }
  } catch {
    // ignore — localStorage may be unavailable
  }
}
