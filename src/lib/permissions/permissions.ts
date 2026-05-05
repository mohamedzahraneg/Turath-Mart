// ─────────────────────────────────────────────────────────────────────────────
// Unified permissions layer.
//
// Source of truth for the mapping:
//   permission name → which routes it unlocks
//   role id (r1..r6) → which permissions it grants
//
// Used by:
//   - src/contexts/AuthContext.tsx (re-exports for backward compat)
//   - src/components/AppLayout.tsx (route gating)
//   - src/middleware.ts (server-side route gating)
//   - src/hooks/usePermissions.ts (component-level hook)
//
// IMPORTANT: keep in lock-step with:
//   - src/lib/constants/roles.ts (role helpers — isAdminRole, etc.)
//   - supabase/migrations/20260505_harden_rls_policies.sql (SQL helpers
//     public.is_admin / is_manager_or_above / can_edit_orders)
// ─────────────────────────────────────────────────────────────────────────────

import { ROLE_IDS, type RoleId } from '@/lib/constants/roles';

// ─── Permission → Route mapping ──────────────────────────────────────────────
export const PERMISSION_ROUTE_MAP: Record<string, string[]> = {
  view_dashboard: ['/dashboard'],
  view_orders: ['/orders-management'],
  create_orders: ['/orders-management'],
  edit_orders: ['/orders-management'],
  delete_orders: ['/orders-management'],
  orders_manage: ['/orders-management'],
  update_status: ['/orders-management'],
  view_shipping: ['/shipping'],
  manage_shipping: ['/shipping'],
  assign_courier: ['/shipping'],
  view_delegates: ['/shipping'],
  view_inventory: ['/inventory'],
  edit_inventory: ['/inventory'],
  view_reports: ['/reports'],
  export_reports: ['/reports'],
  manage_users: ['/users', '/roles'],
  manage_roles: ['/roles'],
  view_customers: ['/crm'],
  manage_customers: ['/crm'],
  customer_support: ['/crm'],
  system_settings: ['/settings'],
};

export const ALL_PERMISSIONS = Object.keys(PERMISSION_ROUTE_MAP);

// ─── Role → Permissions mapping ──────────────────────────────────────────────
export interface RoleDefinition {
  id: RoleId;
  name: string;
  permissions: string[];
}

export const DEFAULT_ROLES: RoleDefinition[] = [
  { id: ROLE_IDS.ADMIN, name: 'مدير النظام', permissions: ALL_PERMISSIONS },
  {
    id: ROLE_IDS.SYSTEM_SUPERVISOR,
    name: 'مشرف النظام',
    permissions: [
      'view_dashboard',
      'view_orders',
      'edit_orders',
      'update_status',
      'view_shipping',
      'manage_shipping',
      'view_inventory',
      'view_reports',
      'export_reports',
      'manage_users',
    ],
  },
  {
    id: ROLE_IDS.SHIPPING_SUPERVISOR,
    name: 'مشرف شحن',
    permissions: [
      'view_dashboard',
      'view_orders',
      'create_orders',
      'edit_orders',
      'update_status',
      'view_shipping',
      'manage_shipping',
      'assign_courier',
      'view_inventory',
      'view_reports',
    ],
  },
  {
    id: ROLE_IDS.SHIPPING_REP,
    name: 'مندوب شحن',
    permissions: ['view_orders', 'update_status', 'view_shipping'],
  },
  {
    id: ROLE_IDS.CUSTOMER_SERVICE_MANAGER,
    name: 'مدير خدمة عملاء',
    permissions: [
      'view_dashboard',
      'view_orders',
      'view_shipping',
      'view_reports',
      'export_reports',
      'view_customers',
      'manage_customers',
      'customer_support',
    ],
  },
  {
    id: ROLE_IDS.CUSTOMER_SERVICE,
    name: 'خدمة عملاء',
    permissions: ['view_orders', 'view_shipping', 'view_customers', 'customer_support'],
  },
];

// ─── Default landing route priority ──────────────────────────────────────────
const PERMISSION_DEFAULT_ROUTE_PRIORITY = [
  'view_dashboard',
  'view_orders',
  'view_shipping',
  'view_reports',
  'view_inventory',
  'view_customers',
  'manage_users',
  'system_settings',
];

// ─── Pure helpers ────────────────────────────────────────────────────────────

/** Resolve the default landing route for a set of effective permissions. */
export function getDefaultRouteForPermissions(permissions: string[]): string {
  if (!permissions || permissions.length === 0) return '/shipping';
  for (const perm of PERMISSION_DEFAULT_ROUTE_PRIORITY) {
    if (permissions.includes(perm)) {
      return PERMISSION_ROUTE_MAP[perm]?.[0] ?? '/shipping';
    }
  }
  return '/shipping';
}

/** Get the static permission list for a known role id. */
export function getPermissionsForRoleId(roleId: string | null | undefined): string[] {
  if (!roleId) return [];
  const role = DEFAULT_ROLES.find((r) => r.id === roleId);
  return role?.permissions ?? [];
}

/** Get the route allow-list for a user (roleId + optional custom permissions). */
export function getAllowedRoutes(
  roleId: string | null,
  customPermissions: string[] | null
): string[] {
  let permissions: string[] = [];
  if (customPermissions && Array.isArray(customPermissions) && customPermissions.length > 0) {
    permissions = customPermissions;
  } else if (roleId) {
    permissions = getPermissionsForRoleId(roleId);
  }
  // /track is always allowed — public customer tracking page.
  const routes = new Set<string>(['/track']);
  for (const perm of permissions) {
    const permRoutes = PERMISSION_ROUTE_MAP[perm] ?? [];
    permRoutes.forEach((r) => routes.add(r));
  }
  return Array.from(routes);
}

/** Check whether a user can access a path (matches AppLayout's hasAccess). */
export function canAccessPath(
  pathname: string,
  roleId: string | null,
  customPermissions: string[] | null
): boolean {
  const allowed = getAllowedRoutes(roleId, customPermissions);
  return allowed.some(
    (route) =>
      pathname === route || pathname.startsWith(route + '/') || pathname.startsWith(route + '?')
  );
}

/** Check whether the user has a specific named permission. */
export function hasPermission(
  permission: string,
  roleId: string | null,
  customPermissions: string[] | null
): boolean {
  const effective =
    customPermissions && customPermissions.length > 0
      ? customPermissions
      : getPermissionsForRoleId(roleId);
  return effective.includes(permission);
}
