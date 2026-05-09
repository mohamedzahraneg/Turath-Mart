'use client';
import React, { useEffect, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import {
  useAuth,
  getDefaultRouteForPermissions,
  getPermissionsForRoleId,
} from '@/contexts/AuthContext';
import { isPublicRoute, isAuthRoute } from '@/lib/auth/routes';
import { isAdminRole } from '@/lib/constants/roles';

interface AppLayoutProps {
  children: React.ReactNode;
  currentPath?: string;
}

function AuthLoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[hsl(210,20%,97%)]" dir="rtl">
      <div className="flex flex-col items-center gap-3 text-[hsl(var(--foreground))]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#c6a052] border-t-transparent" />
        <p className="text-sm text-[hsl(var(--muted-foreground))]">جارٍ التحقق من الجلسة…</p>
      </div>
    </div>
  );
}

export default function AppLayout({ children, currentPath = '' }: AppLayoutProps) {
  const { currentRole, currentRoleId, customPermissions, hasAccess, roleLoading, user, loading } =
    useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const activePath = currentPath || pathname || '';

  const isPublic = useMemo(
    () => isPublicRoute(activePath) || isAuthRoute(activePath),
    [activePath]
  );

  useEffect(() => {
    if (!activePath) return;
    if (isPublic) return;

    // Wait until auth and role are fully loaded
    if (loading || roleLoading) return;

    // Not logged in → middleware should already have caught this, but keep
    // a client-side fallback for edge cases (e.g. session expiry mid-session).
    if (!user && !currentRoleId) {
      router.replace(`/sign-up-login-screen?next=${encodeURIComponent(activePath)}`);
      return;
    }

    // Phase 22J-Fix2 — wait when the user is signed in but the role
    // has not yet been resolved.
    //
    // Background: AuthContext gates its syncProfile effect on
    // `onAuthRoute`. When a user signs in on /sign-up-login-screen,
    // syncProfile takes the bail-out branch and sets
    // `roleLoading = false` without loading the role; `currentRoleId`
    // stays null. The login page then router.replace's to a protected
    // route (e.g. /dashboard). Pathname flips → onAuthRoute flips →
    // AuthContext's syncProfile re-runs and queues
    // `setRoleLoading(true)` — but that state update is committed on
    // the NEXT render. The CURRENT render commit still carries the
    // stale `roleLoading = false`. AppLayout's effect runs in this
    // same commit, sees `user` truthy + `currentRoleId` null +
    // `roleLoading` false, falls through to the redirect block, and
    // bounces the freshly-signed-in user back to
    // /sign-up-login-screen → middleware redirects again to
    // DEFAULT_LANDING_ROUTE → AppLayout redirects again → loop. The
    // loop self-resolves once syncProfile commits its real role on a
    // later render, but by then the URL has flickered through login
    // and the user typically perceives "I had to log in twice".
    //
    // The fix: never make routing decisions when user is set but
    // currentRoleId is null. Treat it as still-loading and wait.
    // syncProfile always settles to either a real role or the r6
    // fallback in its catch branch, so this guard is bounded — it
    // never indefinitely blocks. The render-side guard below (in the
    // bail-out block) shows AuthLoadingScreen during the same window.
    if (user && !currentRoleId) return;

    // Admin (r1) has full access
    if (isAdminRole(currentRoleId)) return;

    // Check route access — redirect to a route the user actually has access to
    if (!hasAccess(activePath)) {
      let permissions: string[] = [];
      if (customPermissions && Array.isArray(customPermissions) && customPermissions.length > 0) {
        permissions = customPermissions;
      } else if (currentRoleId) {
        permissions = getPermissionsForRoleId(currentRoleId);
      }

      // Phase 22I-Fix1: getDefaultRouteForPermissions is now strictly
      // permission-aware and returns null when the user has no
      // priority-matched permission. We never blind-fall to /dashboard
      // or /shipping — instead, an authed user with no accessible
      // route is forwarded to the login page, which surfaces a
      // "no permissions configured" error and stops the redirect
      // loop that the previous '/dashboard' fallback would create
      // for users without view_dashboard.
      const defaultRoute = getDefaultRouteForPermissions(permissions);
      if (defaultRoute) {
        router.replace(defaultRoute);
      } else {
        router.replace(`/sign-up-login-screen?next=${encodeURIComponent(activePath)}`);
      }
    }
  }, [
    activePath,
    isPublic,
    currentRole,
    currentRoleId,
    customPermissions,
    hasAccess,
    roleLoading,
    loading,
    user,
    router,
  ]);

  // Block protected content from flashing while auth is resolving or while
  // a redirect is pending.
  if (!isPublic) {
    if (loading || roleLoading) return <AuthLoadingScreen />;
    if (!user && !currentRoleId) return <AuthLoadingScreen />;
    // Phase 22J-Fix2 — same condition as the effect guard above.
    // Show the loading screen while syncProfile is in the queued-but-
    // not-committed window after a fresh signIn navigation, instead
    // of either flashing protected content or letting child queries
    // run with an unresolved role.
    if (user && !currentRoleId) return <AuthLoadingScreen />;
    if (!isAdminRole(currentRoleId) && !hasAccess(activePath)) return <AuthLoadingScreen />;
  }

  return (
    <div className="flex min-h-screen bg-[hsl(210,20%,97%)]" dir="rtl">
      <Sidebar currentPath={activePath} />
      <main className="flex-1 min-w-0 overflow-auto">
        <div className="max-w-screen-2xl mx-auto px-4 lg:px-6 xl:px-8 2xl:px-10 py-6">
          {children}
        </div>
      </main>
    </div>
  );
}
