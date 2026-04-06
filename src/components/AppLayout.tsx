'use client';
import React, { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import {
  useAuth,
  getDefaultRouteForPermissions,
  getPermissionsForRoleId,
} from '@/contexts/AuthContext';

interface AppLayoutProps {
  children: React.ReactNode;
  currentPath?: string;
}

export default function AppLayout({ children, currentPath = '' }: AppLayoutProps) {
  const { currentRole, currentRoleId, customPermissions, hasAccess, roleLoading, user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const activePath = currentPath || pathname || '';

  useEffect(() => {
    if (!activePath) return;

    // Skip guard for login/public pages
    if (
      activePath.startsWith('/sign-up-login-screen') ||
      activePath.startsWith('/track') ||
      activePath === '/'
    ) return;

    // Wait until auth and role are fully loaded
    if (loading || roleLoading) return;

    // If not logged in, redirect to login
    if (!user && !currentRoleId) {
      router.replace('/sign-up-login-screen');
      return;
    }

    // Manager/Admin has FULL access
    if (currentRoleId === 'r1') return;

    // Check route access
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
  }, [activePath, currentRole, currentRoleId, customPermissions, hasAccess, roleLoading, loading, user, router]);

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
