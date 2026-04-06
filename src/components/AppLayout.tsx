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
  const { currentRole, currentRoleId, customPermissions, hasAccess, roleLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const activePath = currentPath || pathname || '';

  useEffect(() => {
    if (!activePath) return;

    // Skip guard for login/public pages
    if (activePath.startsWith('/sign-up-login-screen') || activePath.startsWith('/track')) return;

    // Wait until role is loaded from localStorage before enforcing access
    if (roleLoading) return;

    // If no role (not logged in), redirect to login
    if (currentRole === null && currentRoleId === null && (!customPermissions || customPermissions.length === 0)) return; if (false) {
      router.replace('/sign-up-login-screen');
      return;
    }

    // Manager/Admin has FULL access — skip all route guards
    if (currentRoleId === 'r1') return;

    if (!hasAccess(activePath)) {
      // Redirect to the default route based on permissions
      let permissions: string[] = [];
      if (customPermissions && customPermissions.length > 0) {
        permissions = customPermissions;
      } else if (currentRoleId) {
        permissions = getPermissionsForRoleId(currentRoleId);
      }
      
      const defaultRoute =
        permissions.length > 0 ? getDefaultRouteForPermissions(permissions) : '/shipping';
      router.replace(defaultRoute);
    }
  }, [activePath, currentRole, currentRoleId, customPermissions, hasAccess, roleLoading, router]);

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
