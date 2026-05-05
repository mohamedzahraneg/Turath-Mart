// ─────────────────────────────────────────────────────────────────────────────
// Role IDs and helpers — single source of truth shared between the client app
// and the SQL helper functions defined in:
//   supabase/migrations/20260505_harden_rls_policies.sql
//   supabase/migrations/20260505b_strengthen_rls_policies.sql
//
// IMPORTANT: keep this in lock-step with the SQL helpers
//   public.is_admin()           ↔ ROLE_IDS.ADMIN ('r1')
//   public.is_manager_or_above() ↔ ROLE_IDS.ADMIN, ROLE_IDS.SYSTEM_SUPERVISOR
//   public.can_edit_orders()    ↔ ADMIN, SYSTEM_SUPERVISOR, SHIPPING_SUPERVISOR, SHIPPING_REP
// ─────────────────────────────────────────────────────────────────────────────

export const ROLE_IDS = {
  ADMIN: 'r1',
  SYSTEM_SUPERVISOR: 'r2',
  SHIPPING_SUPERVISOR: 'r3',
  SHIPPING_REP: 'r4',
  CUSTOMER_SERVICE_MANAGER: 'r5',
  CUSTOMER_SERVICE: 'r6',
} as const;

export type RoleId = (typeof ROLE_IDS)[keyof typeof ROLE_IDS];

const ALL_ROLE_IDS: readonly RoleId[] = Object.values(ROLE_IDS);

function isKnownRole(roleId: string | null | undefined): roleId is RoleId {
  return !!roleId && (ALL_ROLE_IDS as readonly string[]).includes(roleId);
}

/** True iff the user is the system administrator (r1). */
export function isAdminRole(roleId: string | null | undefined): boolean {
  return roleId === ROLE_IDS.ADMIN;
}

/** True iff the user is admin (r1) or system supervisor (r2). */
export function isManagerOrAbove(roleId: string | null | undefined): boolean {
  return roleId === ROLE_IDS.ADMIN || roleId === ROLE_IDS.SYSTEM_SUPERVISOR;
}

/** Roles allowed to edit / update orders (matches public.can_edit_orders SQL). */
export function canEditOrders(roleId: string | null | undefined): boolean {
  if (!isKnownRole(roleId)) return false;
  return (
    roleId === ROLE_IDS.ADMIN ||
    roleId === ROLE_IDS.SYSTEM_SUPERVISOR ||
    roleId === ROLE_IDS.SHIPPING_SUPERVISOR ||
    roleId === ROLE_IDS.SHIPPING_REP
  );
}

/** Roles allowed to create new orders. */
export function canCreateOrders(roleId: string | null | undefined): boolean {
  if (!isKnownRole(roleId)) return false;
  return (
    roleId === ROLE_IDS.ADMIN ||
    roleId === ROLE_IDS.SYSTEM_SUPERVISOR ||
    roleId === ROLE_IDS.CUSTOMER_SERVICE_MANAGER ||
    roleId === ROLE_IDS.CUSTOMER_SERVICE
  );
}

/** Roles allowed to delete orders (admin only). */
export function canDeleteOrders(roleId: string | null | undefined): boolean {
  return isAdminRole(roleId);
}

/** Roles allowed to use admin-only fields like extraShippingFee. */
export function canUseAdminOnlyFinancialFields(roleId: string | null | undefined): boolean {
  return isAdminRole(roleId);
}
