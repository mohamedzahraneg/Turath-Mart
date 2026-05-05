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

interface AppLayoutProps {
  children: React.ReactNode;
  currentPath?: string;
}

function AuthLoadingScreen() {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-[hsl(210,20%,97%)]"
      dir="rtl"
    >
      <div className="flex flex-col items-center gap-3 text-[hsl(var(--foreground))]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#c6a052] border-t-transparent" />
        <p className="text-sm text-[hsl(var(--muted-foreground))]">جارٍ التحقق من الجلسة…</p>
      </div>
    </div>
  );
}

export default function AppLayout({ children, currentPath = '' }: AppLayoutProps) {
  const { currentRole, currentRoleId, customPermissions, hasAccess, roleLoading, user, loading } = useAuth();
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

    // Admin (r1) has full access
    if (currentRoleId === 'r1') return;

    // Check route access — redirect to a route the user actually has access to
    if (!hasAccess(activePath)) {
      let permissions: string[] = [];
      if (customPermissions && Array.isArray(customPermissions) && customPermissions.length > 0) {
        permissions = customPermissions;
      } else if (currentRoleId) {
        permissions = getPermissionsForRoleId(currentRoleId);
      }

      const defaultRoute = permissions.length > 0
        ? getDefaultRouteForPermissions(permissions)
        : '/shipping';
      router.replace(defaultRoute);
    }
  }, [activePath, isPublic, currentRole, currentRoleId, customPermissions, hasAccess, roleLoading, loading, user, router]);

  // Block protected content from flashing while auth is resolving or while
  // a redirect is pending.
  if (!isPublic) {
    if (loading || roleLoading) return <AuthLoadingScreen />;
    if (!user && !currentRoleId) return <AuthLoadingScreen />;
    if (currentRoleId !== 'r1' && !hasAccess(activePath)) return <AuthLoadingScreen />;
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
