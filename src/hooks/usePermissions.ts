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

// Phase Permissions-Audit-Phase-2 — the five role-only helpers
// below are marked `@deprecated` because they derive solely from
// `currentRoleId` and ignore `customPermissions`. UI action gates
// must respect per-user `customPermissions` overrides (admin-editable
// via the /roles Users tab); these booleans cannot. The canonical
// gating expression elsewhere in the codebase is:
//
//   perms.isAdmin || perms.can('<existing_permission_key>')
//
// `isAdmin` is intentionally NOT deprecated — it represents
// "is the system administrator (role r1)" which is a pure role
// concept, not a permission gate. Likewise `can`, `canAccessPath`,
// `effectivePermissions`, `roleId`, and `loading` remain stable.
//
// This phase is documentation-only — no runtime behaviour changes.
// Existing callers continue to compile and run. New callers should
// pick the canonical pattern above.
export interface PermissionFlags {
  /** Raw role id from the database (e.g. 'r1'). */
  roleId: string | null;
  /** Effective permission strings (custom override or role defaults). */
  effectivePermissions: string[];
  /** True iff the user is the system administrator (r1). */
  isAdmin: boolean;
  /**
   * True iff the user is r1 or r2.
   *
   * @deprecated Role-only helper. Does not respect customPermissions.
   * For UI action gates, use `perms.isAdmin || perms.can('<existing_permission_key>')`
   * with an existing key from PERMISSION_CATALOG.
   */
  isManagerOrAbove: boolean;
  /**
   * True iff the user is in r1..r4 (matches RLS `can_edit_orders`).
   *
   * @deprecated Role-only helper. Does not respect customPermissions.
   * For UI action gates, use `perms.isAdmin || perms.can('edit_orders')`
   * (existing key in PERMISSION_CATALOG). The role-only set here is
   * preserved for parity with the matching SQL helper and must not
   * be consumed for visibility/action gates.
   */
  canEditOrders: boolean;
  /**
   * True iff the user can create new orders.
   *
   * @deprecated Role-only helper. Does not respect customPermissions.
   * For UI action gates, use `perms.isAdmin || perms.can('create_orders')`
   * (existing key in PERMISSION_CATALOG).
   */
  canCreateOrders: boolean;
  /**
   * True iff the user can delete orders (admin only).
   *
   * @deprecated Role-only helper. Does not respect customPermissions.
   * For UI action gates, use `perms.isAdmin || perms.can('delete_orders')`
   * (existing key in PERMISSION_CATALOG).
   */
  canDeleteOrders: boolean;
  /**
   * True iff the user can use admin-only financial fields like extra fees.
   *
   * @deprecated Role-only helper. Does not respect customPermissions.
   * For UI action gates, use `perms.isAdmin || perms.can('<existing_permission_key>')`
   * with an existing key from PERMISSION_CATALOG. Note: no dedicated
   * catalog key matches the historical "admin financial fields"
   * semantics today — callers needing strict admin-only behaviour
   * should use `perms.isAdmin` directly.
   */
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
