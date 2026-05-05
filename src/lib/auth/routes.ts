// ─────────────────────────────────────────────────────────────────────────────
// Centralised route configuration for authentication / authorisation.
// Used by both middleware.ts (server) and AppLayout.tsx (client).
// ─────────────────────────────────────────────────────────────────────────────

/** Routes accessible without authentication. */
export const PUBLIC_ROUTES: readonly string[] = [
  '/',
  '/track', // /track and /track/[orderId] (customer tracking)
] as const;

/** The authentication entry-point page. */
export const AUTH_ROUTES: readonly string[] = ['/sign-up-login-screen'] as const;

/** Path prefixes the middleware should never inspect. */
export const SKIP_MIDDLEWARE_PREFIXES: readonly string[] = [
  '/_next',
  '/api', // API routes manage their own auth
  '/favicon.ico',
  '/assets',
  '/images',
] as const;

/** localStorage keys owned by this app — cleared on signOut. */
export const APP_STORAGE_KEYS: readonly string[] = [
  'current_user',
  'settings_wa_template',
  'turath_masr_audit_logs',
  'turath_masr_orders',
  'turath_avatars',
  'turath_employees',
  'turath_roles',
  'turath_users',
] as const;

/** Default landing page after a successful login (when no permissions hint exists). */
export const DEFAULT_LANDING_ROUTE = '/dashboard';

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function isPublicRoute(pathname: string): boolean {
  if (!pathname) return false;
  return PUBLIC_ROUTES.some(
    (r) => pathname === r || pathname.startsWith(r + '/') || pathname.startsWith(r + '?')
  );
}

export function isAuthRoute(pathname: string): boolean {
  if (!pathname) return false;
  return AUTH_ROUTES.some(
    (r) => pathname === r || pathname.startsWith(r + '/') || pathname.startsWith(r + '?')
  );
}

export function shouldSkipMiddleware(pathname: string): boolean {
  if (!pathname) return true;
  return SKIP_MIDDLEWARE_PREFIXES.some((p) => pathname.startsWith(p));
}

export function isProtectedRoute(pathname: string): boolean {
  if (!pathname) return false;
  if (shouldSkipMiddleware(pathname)) return false;
  if (isAuthRoute(pathname)) return false;
  if (isPublicRoute(pathname)) return false;
  return true;
}
