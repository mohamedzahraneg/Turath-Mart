'use client';

import { useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  isAdminRole,
  isManagerOrAbove,
  canEditOrders,
  canCreateOrders,
  canDeleteOrders,
  canUseAdminOnlyFinancialFields,
} from '@/lib/constants/roles';
import {
  canAccessPath,
  hasPermission,
  getPermissionsForRoleId,
} from '@/lib/permissions/permissions';

// ─────────────────────────────────────────────────────────────────────────────
// usePermissions
//
// Single hook combining the auth context with the permission helpers, so
// components don't need to import both useAuth + a pile of helpers.
//
// Returned predicates close over the current user's roleId and effective
// permissions, so the caller just writes:
//
//   const perms = usePermissions();
//   if (perms.isAdmin) { ... }
//   if (perms.can('manage_users')) { ... }
//
// All predicates are memoised by roleId/customPermissions so referential
// equality is stable across renders unless those actually change.
// ─────────────────────────────────────────────────────────────────────────────

export interface PermissionFlags {
  /** Raw role id from the database (e.g. 'r1'). */
  roleId: string | null;
  /** Effective permission strings (custom override or role defaults). */
  effectivePermissions: string[];
  /** True iff the user is the system administrator (r1). */
  isAdmin: boolean;
  /** True iff the user is r1 or r2. */
  isManagerOrAbove: boolean;
  /** True iff the user is in r1..r4 (matches RLS can_edit_orders). */
  canEditOrders: boolean;
  /** True iff the user can create new orders. */
  canCreateOrders: boolean;
  /** True iff the user can delete orders (admin only). */
  canDeleteOrders: boolean;
  /** True iff the user can use admin-only financial fields like extra fees. */
  canUseAdminOnlyFinancialFields: boolean;
  /** Generic per-permission lookup. */
  can: (permission: string) => boolean;
  /** Check whether the user can navigate to the given pathname. */
  canAccessPath: (pathname: string) => boolean;
  /** Auth still loading (initial session fetch / role resolution). */
  loading: boolean;
}

export function usePermissions(): PermissionFlags {
  const { currentRoleId, customPermissions, loading, roleLoading } = useAuth();

  return useMemo(() => {
    const effective =
      Array.isArray(customPermissions) && customPermissions.length > 0
        ? customPermissions
        : getPermissionsForRoleId(currentRoleId);

    return {
      roleId: currentRoleId,
      effectivePermissions: effective,
      isAdmin: isAdminRole(currentRoleId),
      isManagerOrAbove: isManagerOrAbove(currentRoleId),
      canEditOrders: canEditOrders(currentRoleId),
      canCreateOrders: canCreateOrders(currentRoleId),
      canDeleteOrders: canDeleteOrders(currentRoleId),
      canUseAdminOnlyFinancialFields: canUseAdminOnlyFinancialFields(currentRoleId),
      can: (permission: string) => hasPermission(permission, currentRoleId, customPermissions),
      canAccessPath: (pathname: string) =>
        canAccessPath(pathname, currentRoleId, customPermissions),
      loading: loading || roleLoading,
    };
  }, [currentRoleId, customPermissions, loading, roleLoading]);
}
