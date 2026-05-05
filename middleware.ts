import { NextResponse, type NextRequest } from 'next/server';
import { createMiddlewareSupabaseClient } from '@/lib/supabase/middleware';
import {
  isAuthRoute,
  isProtectedRoute,
  isPublicRoute,
  shouldSkipMiddleware,
  DEFAULT_LANDING_ROUTE,
} from '@/lib/auth/routes';

/**
 * Server-side route guard.
 *
 * - Skips _next, /api, static assets, /favicon.ico
 * - Allows public routes (/, /track/*) without auth
 * - Redirects unauthenticated users away from protected routes → /sign-up-login-screen?next=...
 * - Redirects already-authenticated users away from /sign-up-login-screen → DEFAULT_LANDING_ROUTE
 *
 * Uses ANON_KEY only. Service-role key is never imported here.
 */
export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // 1. Bypass static / API / framework paths entirely.
  if (shouldSkipMiddleware(pathname)) {
    return NextResponse.next();
  }

  // 2. Wire up Supabase against this request's cookies.
  const { supabase, response } = createMiddlewareSupabaseClient(request);

  // 3. Read session (refreshes the access token via the cookie handler if needed).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const authed = !!user;

  // 4. If user is already signed in and visits the login screen → bounce them home.
  if (authed && isAuthRoute(pathname)) {
    const url = request.nextUrl.clone();
    const next = request.nextUrl.searchParams.get('next');
    url.pathname = next && next.startsWith('/') ? next : DEFAULT_LANDING_ROUTE;
    url.search = '';
    return NextResponse.redirect(url);
  }

  // 5. Public routes (including /track/*) — let them through.
  if (isPublicRoute(pathname) || isAuthRoute(pathname)) {
    return response;
  }

  // 6. Protected route + no session → send to login with ?next= for round-trip.
  if (!authed && isProtectedRoute(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/sign-up-login-screen';
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  // 7. Authenticated request to a protected route → continue.
  return response;
}

// Run on every request except _next internals, static assets, and Next API.
// We still call shouldSkipMiddleware() inside for defence-in-depth.
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|assets/|images/|api/).*)',
  ],
};
