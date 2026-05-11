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
  // Phase 24A — customer-service CRM was relocated from /crm to
  // /customers. Both paths are listed so legacy bookmarks (the /crm
  // route now redirects server-side) still resolve to a permitted
  // route during permission checks.
  view_customers: ['/customers', '/crm'],
  manage_customers: ['/customers', '/crm'],
  customer_support: ['/customers', '/crm'],
  system_settings: ['/settings'],
  // Phase 26A — new permissions (additive). Routes are best-fit:
  // returns / complaints + customer-attachments use the customer
  // surfaces; staff / security permissions resolve to /roles, which is
  // the staff & security workspace.
  view_returns_exchanges: ['/customers', '/customers/returns-exchanges', '/orders-management'],
  manage_returns_exchanges: ['/customers', '/customers/returns-exchanges', '/orders-management'],
  approve_returns_exchanges: ['/customers/returns-exchanges', '/orders-management'],
  view_complaints: ['/customers'],
  manage_complaints: ['/customers'],
  view_customer_chat: ['/customers'],
  reply_customer_chat: ['/customers'],
  manage_customer_notes: ['/customers'],
  manage_customer_tasks: ['/customers'],
  manage_customer_attachments: ['/customers'],
  view_customer_attachments: ['/customers'],
  schedule_delivery: ['/orders-management', '/shipping'],
  view_order_audit: ['/orders-management'],
  assign_delegate: ['/orders-management', '/shipping'],
  view_delegate_finance: ['/delegates'],
  manage_delegate_settlements: ['/delegates'],
  manage_delegate_custody: ['/delegates'],
  manage_delegate_expenses: ['/delegates'],
  approve_delegate_expenses: ['/delegates'],
  view_delegate_reports: ['/delegates', '/reports'],
  export_delegate_reports: ['/delegates', '/reports'],
  manage_delegates: ['/delegates'],
  manage_inventory: ['/inventory'],
  view_products: ['/inventory'],
  manage_products: ['/inventory'],
  view_settings: ['/settings'],
  manage_settings: ['/settings'],
  view_roles: ['/roles'],
  view_staff: ['/roles'],
  manage_staff: ['/roles'],
  manage_permissions: ['/roles'],
  view_security_audit: ['/roles'],
  view_login_sessions: ['/roles'],
  manage_device_access: ['/roles'],
  block_devices: ['/roles'],
  view_staff_activity: ['/roles'],
  export_audit_logs: ['/roles'],
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
  // Phase 24A — default landing for CRM permission holders is now
  // /customers (the new dashboard). /crm still resolves because it
  // redirects to /customers server-side.
  { route: '/customers', permissions: ['view_customers', 'manage_customers', 'customer_support'] },
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

// ─────────────────────────────────────────────────────────────────────────────
// Phase 26A — permission catalog
//
// One place that lists every permission known to the system, grouped
// the way the staff/roles page renders the matrix. Adding a new
// permission means appending it here AND mapping it to a route in
// PERMISSION_ROUTE_MAP. The roles UI iterates this list to draw the
// checkbox grid, and the DB role rows are kept in sync via the Phase
// 26A migration's `array_agg(DISTINCT … || ARRAY[…])` seed.
//
// Each entry carries:
//   • `key`   — stable identifier (matches DB + RLS helpers)
//   • `label` — Arabic UI label
//   • `group` — section header in the matrix
// ─────────────────────────────────────────────────────────────────────────────

export interface PermissionCatalogEntry {
  key: string;
  label: string;
  group: PermissionGroup;
}

export type PermissionGroup =
  | 'dashboard'
  | 'orders'
  | 'returns'
  | 'shipping'
  | 'delegates'
  | 'customers'
  | 'complaints'
  | 'inventory'
  | 'reports'
  | 'staff'
  | 'security'
  | 'settings';

export const PERMISSION_GROUP_LABEL_AR: Record<PermissionGroup, string> = {
  dashboard: 'لوحة التحكم',
  orders: 'الأوردرات',
  returns: 'المرتجعات والاستبدالات',
  shipping: 'الشحن',
  delegates: 'المناديب',
  customers: 'العملاء',
  complaints: 'الشكاوى والمحادثات',
  inventory: 'المخزون',
  reports: 'التقارير',
  staff: 'الموظفون والأدوار',
  security: 'الأمان والتدقيق',
  settings: 'الإعدادات',
};

export const PERMISSION_CATALOG: PermissionCatalogEntry[] = [
  { key: 'view_dashboard', label: 'عرض لوحة التحكم', group: 'dashboard' },

  // Orders
  { key: 'view_orders', label: 'عرض الأوردرات', group: 'orders' },
  { key: 'create_orders', label: 'إنشاء أوردر', group: 'orders' },
  { key: 'edit_orders', label: 'تعديل أوردر', group: 'orders' },
  { key: 'delete_orders', label: 'حذف أوردر', group: 'orders' },
  { key: 'orders_manage', label: 'إدارة الأوردرات', group: 'orders' },
  { key: 'update_status', label: 'تحديث حالة الأوردر', group: 'orders' },
  { key: 'assign_delegate', label: 'تعيين مندوب', group: 'orders' },
  { key: 'schedule_delivery', label: 'جدولة التسليم', group: 'orders' },
  { key: 'view_order_audit', label: 'عرض سجل تعديلات الأوردر', group: 'orders' },

  // Returns / exchanges
  { key: 'view_returns_exchanges', label: 'عرض المرتجعات والاستبدالات', group: 'returns' },
  { key: 'manage_returns_exchanges', label: 'إدارة المرتجعات والاستبدالات', group: 'returns' },
  { key: 'approve_returns_exchanges', label: 'اعتماد المرتجعات والاستبدالات', group: 'returns' },

  // Shipping
  { key: 'view_shipping', label: 'عرض الشحن', group: 'shipping' },
  { key: 'manage_shipping', label: 'إدارة الشحن', group: 'shipping' },
  { key: 'assign_courier', label: 'إسناد المندوب', group: 'shipping' },

  // Delegates
  { key: 'view_delegates', label: 'عرض المناديب', group: 'delegates' },
  { key: 'manage_delegates', label: 'إدارة المناديب', group: 'delegates' },
  { key: 'view_delegate_finance', label: 'عرض مالية المناديب', group: 'delegates' },
  { key: 'manage_delegate_settlements', label: 'إدارة تسويات المناديب', group: 'delegates' },
  { key: 'manage_delegate_custody', label: 'إدارة عُهد المناديب', group: 'delegates' },
  { key: 'manage_delegate_expenses', label: 'إدارة مصروفات المناديب', group: 'delegates' },
  { key: 'approve_delegate_expenses', label: 'اعتماد مصروفات المناديب', group: 'delegates' },
  { key: 'view_delegate_reports', label: 'عرض تقارير المناديب', group: 'delegates' },
  { key: 'export_delegate_reports', label: 'تصدير تقارير المناديب', group: 'delegates' },

  // Customers
  { key: 'view_customers', label: 'عرض العملاء', group: 'customers' },
  { key: 'manage_customers', label: 'إدارة العملاء', group: 'customers' },
  { key: 'customer_support', label: 'دعم العملاء', group: 'customers' },
  { key: 'manage_customer_notes', label: 'إدارة ملاحظات العملاء', group: 'customers' },
  { key: 'manage_customer_tasks', label: 'إدارة مهام العملاء', group: 'customers' },
  { key: 'manage_customer_attachments', label: 'إدارة مرفقات العملاء', group: 'customers' },
  { key: 'view_customer_attachments', label: 'عرض مرفقات العملاء', group: 'customers' },

  // Complaints / chat
  { key: 'view_complaints', label: 'عرض الشكاوى', group: 'complaints' },
  { key: 'manage_complaints', label: 'إدارة الشكاوى', group: 'complaints' },
  { key: 'view_customer_chat', label: 'عرض محادثات العملاء', group: 'complaints' },
  { key: 'reply_customer_chat', label: 'الرد على محادثات العملاء', group: 'complaints' },

  // Inventory / products
  { key: 'view_inventory', label: 'عرض المخزون', group: 'inventory' },
  { key: 'edit_inventory', label: 'تعديل المخزون', group: 'inventory' },
  { key: 'manage_inventory', label: 'إدارة المخزون', group: 'inventory' },
  { key: 'view_products', label: 'عرض المنتجات', group: 'inventory' },
  { key: 'manage_products', label: 'إدارة المنتجات', group: 'inventory' },

  // Reports
  { key: 'view_reports', label: 'عرض التقارير', group: 'reports' },
  { key: 'export_reports', label: 'تصدير التقارير', group: 'reports' },

  // Staff / roles
  { key: 'manage_users', label: 'إدارة المستخدمين', group: 'staff' },
  { key: 'manage_roles', label: 'إدارة الأدوار', group: 'staff' },
  { key: 'view_roles', label: 'عرض الأدوار', group: 'staff' },
  { key: 'view_staff', label: 'عرض الموظفين', group: 'staff' },
  { key: 'manage_staff', label: 'إدارة الموظفين', group: 'staff' },
  { key: 'manage_permissions', label: 'إدارة الصلاحيات', group: 'staff' },

  // Security
  { key: 'view_security_audit', label: 'عرض سجل التدقيق الأمني', group: 'security' },
  { key: 'view_login_sessions', label: 'عرض جلسات الدخول', group: 'security' },
  { key: 'view_staff_activity', label: 'عرض نشاط الموظفين', group: 'security' },
  { key: 'manage_device_access', label: 'إدارة الوصول من الأجهزة', group: 'security' },
  { key: 'block_devices', label: 'حظر الأجهزة', group: 'security' },
  { key: 'export_audit_logs', label: 'تصدير سجلات التدقيق', group: 'security' },

  // Settings
  { key: 'system_settings', label: 'إعدادات النظام', group: 'settings' },
  { key: 'view_settings', label: 'عرض الإعدادات', group: 'settings' },
  { key: 'manage_settings', label: 'تعديل الإعدادات', group: 'settings' },
];

/**
 * Grouped catalog for the staff/roles permission matrix UI. Keeps the
 * Arabic group labels next to the permission rows.
 */
export function getGroupedPermissionCatalog(): {
  group: PermissionGroup;
  label: string;
  permissions: PermissionCatalogEntry[];
}[] {
  const out = new Map<PermissionGroup, PermissionCatalogEntry[]>();
  for (const entry of PERMISSION_CATALOG) {
    const bucket = out.get(entry.group) ?? [];
    bucket.push(entry);
    out.set(entry.group, bucket);
  }
  return Array.from(out.entries()).map(([group, permissions]) => ({
    group,
    label: PERMISSION_GROUP_LABEL_AR[group],
    permissions,
  }));
}
