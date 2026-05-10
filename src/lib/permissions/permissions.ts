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
  // Phase 23A — `view_delegates` now also unlocks the new
  // `/delegates` admin page. The previous `/shipping` mapping is
  // preserved so r3/r4 holders continue to reach the live shipping
  // dashboard. Admin (r1) has all permissions, so they get both
  // routes regardless.
  view_delegates: ['/shipping', '/delegates'],
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
      // Phase 23F — read-only access to /delegates. The matching
      // RLS migration (20260510240000_delegate_finance_reader.sql)
      // wires the actual read permission on the financial tables
      // via `public.is_delegate_finance_reader()`. Write
      // operations stay admin-only at both layers (UI gate +
      // existing `*_admin_*` policies).
      'view_delegates',
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
//
// Route-keyed priority list (Phase 22I-Fix1 follow-up). Each entry pairs
// a candidate landing route with the FULL set of permissions that grant
// access to it — not just the read-prefixed `view_*` flag. A user holds
// any one of those permissions and the route becomes a valid landing.
// The list is iterated top-to-bottom; the first route the user can
// access is returned.
//
// Examples:
//   • holds `view_dashboard` → /dashboard
//   • holds only `customer_support` (no `view_customers`) → /crm
//   • holds only `update_status` (no `view_orders`) → /orders-management
//   • holds only `manage_roles` (no `manage_users`) → /roles
//   • holds no permission in this list → null (caller surfaces error)
//
// IMPORTANT: keep the per-route permission set in sync with
// PERMISSION_ROUTE_MAP above. Any permission that maps to a route in
// PERMISSION_ROUTE_MAP must also appear here, otherwise users holding
// only that permission would land on null despite having access.
const ROUTE_DEFAULT_PRIORITY: ReadonlyArray<{
  route: string;
  permissions: ReadonlyArray<string>;
}> = [
  { route: '/dashboard', permissions: ['view_dashboard'] },
  {
    route: '/orders-management',
    permissions: [
      'view_orders',
      'create_orders',
      'edit_orders',
      'delete_orders',
      'orders_manage',
      'update_status',
    ],
  },
  {
    route: '/shipping',
    permissions: ['view_shipping', 'manage_shipping', 'assign_courier', 'view_delegates'],
  },
  { route: '/reports', permissions: ['view_reports', 'export_reports'] },
  { route: '/inventory', permissions: ['view_inventory', 'edit_inventory'] },
  { route: '/crm', permissions: ['view_customers', 'manage_customers', 'customer_support'] },
  { route: '/users', permissions: ['manage_users'] },
  { route: '/roles', permissions: ['manage_roles'] },
  { route: '/settings', permissions: ['system_settings'] },
];

// ─── Pure helpers ────────────────────────────────────────────────────────────

/**
 * Resolve the default landing route for a set of effective permissions.
 *
 * Phase 22I-Fix1 (clarified): returns `null` when the permission set
 * yields no routable destination — never blindly falls back to
 * /dashboard or /shipping. The lookup is strictly permission-driven:
 * no role IDs are referenced anywhere, and any permission that grants
 * access to a route makes that route a valid landing candidate (so a
 * user with only `customer_support` lands on /crm, a user with only
 * `update_status` lands on /orders-management, and so on).
 *
 * Behaviour by case:
 *   • holds `view_dashboard`         → '/dashboard'
 *   • holds any orders permission    → '/orders-management'
 *   • holds any shipping permission  → '/shipping'
 *   • holds any reports permission   → '/reports'
 *   • holds any inventory permission → '/inventory'
 *   • holds any CRM permission       → '/crm'
 *   • holds `manage_users`           → '/users'
 *   • holds `manage_roles`           → '/roles'
 *   • holds `system_settings`        → '/settings'
 *   • permissions empty or no match  → null
 *
 * Callers handle null by either staying on the login page with an error
 * (login flow) or forcing a re-auth round-trip (AppLayout).
 * DEFAULT_LANDING_ROUTE remains the server-side middleware constant
 * but is no longer consulted as a fallback here.
 */
export function getDefaultRouteForPermissions(permissions: string[]): string | null {
  if (!permissions || permissions.length === 0) return null;
  const held = new Set(permissions);
  for (const { route, permissions: candidates } of ROUTE_DEFAULT_PRIORITY) {
    if (candidates.some((p) => held.has(p))) return route;
  }
  return null;
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
