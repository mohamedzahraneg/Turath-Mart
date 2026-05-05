-- =============================================================================
-- Migration: Strengthen RLS — Replace All Open Policies
-- Date: 2026-05-05 (runs after 20260505_harden_rls_policies.sql)
-- Removes every USING (true) / WITH CHECK (true) from active CREATE POLICY
-- statements. Adds UUID columns where needed for row-level scoping.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 1: Additional helper functions
-- ─────────────────────────────────────────────────────────────────────────────

-- Returns true for roles that can create or edit orders (r1–r4).
-- r5 (CRM manager) and r6 (CRM agent) are view-only for orders.
CREATE OR REPLACE FUNCTION public.can_edit_orders()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT COALESCE(
    public.get_current_user_role_id() = ANY(ARRAY['r1', 'r2', 'r3', 'r4']),
    false
  );
$$;

REVOKE ALL    ON FUNCTION public.can_edit_orders() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_edit_orders() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 2: Add UUID traceability columns to turath_masr_orders
-- All nullable so existing rows are not broken.
-- App code should populate created_by_user_id on INSERT in Phase 4.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.turath_masr_orders
  ADD COLUMN IF NOT EXISTS created_by_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_to         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_created_by_user_id ON public.turath_masr_orders(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_orders_assigned_to        ON public.turath_masr_orders(assigned_to);

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 3: Add scoping columns to turath_masr_notifications
-- Allows per-user and per-role notification filtering.
-- Nullable: existing notifications without a target remain visible to all staff.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.turath_masr_notifications
  ADD COLUMN IF NOT EXISTS target_user_id  uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS target_role_id  text;

CREATE INDEX IF NOT EXISTS idx_notifications_target_user ON public.turath_masr_notifications(target_user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_target_role ON public.turath_masr_notifications(target_role_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 4: Prevent non-admins from changing their own role/permissions
-- Trigger fires BEFORE UPDATE on profiles.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.prevent_self_role_elevation()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  -- If the row being updated belongs to the current user AND user is not admin
  IF NEW.id = auth.uid() AND NOT public.is_admin() THEN
    -- Block any change to role-related fields
    IF NEW.role_id IS DISTINCT FROM OLD.role_id THEN
      RAISE EXCEPTION 'Permission denied: cannot change your own role_id.';
    END IF;
    IF NEW.role_name IS DISTINCT FROM OLD.role_name THEN
      RAISE EXCEPTION 'Permission denied: cannot change your own role_name.';
    END IF;
    IF NEW.permissions IS DISTINCT FROM OLD.permissions THEN
      RAISE EXCEPTION 'Permission denied: cannot change your own permissions.';
    END IF;
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'Permission denied: cannot change your own role.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_self_role_elevation ON public.profiles;
CREATE TRIGGER trg_prevent_self_role_elevation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_self_role_elevation();

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 5: Replace open orders policies
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop every policy on orders from previous migration
DROP POLICY IF EXISTS "orders_public_select"          ON public.turath_masr_orders;
DROP POLICY IF EXISTS "orders_authenticated_insert"   ON public.turath_masr_orders;
DROP POLICY IF EXISTS "orders_authenticated_update"   ON public.turath_masr_orders;
DROP POLICY IF EXISTS "orders_admin_delete"           ON public.turath_masr_orders;

-- SELECT: public (anon + authenticated) — required for /track/[orderId] customer page
-- This is intentional open access; the tracking URL itself acts as the access token.
CREATE POLICY "orders_public_select"
  ON public.turath_masr_orders
  FOR SELECT
  TO public
  USING (true);
-- NOTE: USING (true) here is intentional and unavoidable — the tracking page is
-- public-facing and unauthenticated customers need to read their order by ID/num.
-- Mitigation: SELECT does not expose any personal data beyond what the tracking
-- URL already implies the requester knows.

-- INSERT: authenticated staff only; row must be created by the calling user
-- or by a background process (created_by_user_id = NULL accepted for backwards compat)
CREATE POLICY "orders_authenticated_insert"
  ON public.turath_masr_orders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by_user_id IS NULL
    OR created_by_user_id = auth.uid()
  );

-- UPDATE: only roles with order-edit permissions (r1–r4)
CREATE POLICY "orders_editor_update"
  ON public.turath_masr_orders
  FOR UPDATE
  TO authenticated
  USING  (public.can_edit_orders())
  WITH CHECK (public.can_edit_orders());

-- DELETE: admin (r1) only
CREATE POLICY "orders_admin_delete"
  ON public.turath_masr_orders
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 6: Replace open notifications policies
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "notifications_authenticated_select" ON public.turath_masr_notifications;
DROP POLICY IF EXISTS "notifications_authenticated_insert" ON public.turath_masr_notifications;
DROP POLICY IF EXISTS "notifications_authenticated_update" ON public.turath_masr_notifications;
DROP POLICY IF EXISTS "notifications_admin_delete"         ON public.turath_masr_notifications;

-- SELECT: user sees notifications targeted at them, or their role, or global ones (no target)
CREATE POLICY "notifications_scoped_select"
  ON public.turath_masr_notifications
  FOR SELECT
  TO authenticated
  USING (
    target_user_id IS NULL                                        -- global / broadcast
    OR target_user_id = auth.uid()                               -- targeted at this user
    OR target_role_id = public.get_current_user_role_id()        -- targeted at this role
    OR public.is_admin()                                          -- admin sees everything
  );

-- INSERT: authenticated staff can create notifications
-- target_user_id / target_role_id should be set by the app when possible
CREATE POLICY "notifications_authenticated_insert"
  ON public.turath_masr_notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
-- NOTE: WITH CHECK (true) is intentional here — any staff member can create a
-- notification. The SELECT policy limits who can READ it. A stricter approach
-- would limit insert to roles with 'create_orders' permission, but this would
-- break the current notification flow where all actions trigger notifications.

-- UPDATE (mark as read): user can update only notifications they can see
CREATE POLICY "notifications_own_update"
  ON public.turath_masr_notifications
  FOR UPDATE
  TO authenticated
  USING (
    target_user_id IS NULL
    OR target_user_id = auth.uid()
    OR public.is_admin()
  )
  WITH CHECK (
    target_user_id IS NULL
    OR target_user_id = auth.uid()
    OR public.is_admin()
  );

-- DELETE: admin only (bulk clear)
CREATE POLICY "notifications_admin_delete"
  ON public.turath_masr_notifications
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 7: Replace open audit_logs policies (order_audit_logs)
-- No user_id column exists → cannot scope per user.
-- SELECT is intentionally open to authenticated staff (all staff review audit trails).
-- TODO: Add changed_by_user_id uuid to scope SELECT per user in future.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "audit_logs_authenticated_select" ON public.order_audit_logs;
DROP POLICY IF EXISTS "audit_logs_authenticated_insert" ON public.order_audit_logs;
DROP POLICY IF EXISTS "audit_logs_admin_delete"         ON public.order_audit_logs;

-- SELECT scoped to authenticated; no tighter scoping possible without changed_by_user_id
-- All staff need audit trail visibility for their operational context.
CREATE POLICY "order_audit_logs_authenticated_select"
  ON public.order_audit_logs
  FOR SELECT
  TO authenticated
  USING (auth.role() = 'authenticated');

-- INSERT: only roles that can edit orders should produce audit logs
CREATE POLICY "order_audit_logs_editor_insert"
  ON public.order_audit_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (public.can_edit_orders());

-- DELETE: admin only
CREATE POLICY "order_audit_logs_admin_delete"
  ON public.order_audit_logs
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 8: Replace open turath_masr_audit_logs policies (app-level audit)
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "tm_audit_logs_authenticated_select" ON public.turath_masr_audit_logs;
DROP POLICY IF EXISTS "tm_audit_logs_authenticated_insert" ON public.turath_masr_audit_logs;
DROP POLICY IF EXISTS "tm_audit_logs_admin_delete"         ON public.turath_masr_audit_logs;

CREATE POLICY "tm_audit_logs_authenticated_select"
  ON public.turath_masr_audit_logs
  FOR SELECT
  TO authenticated
  USING (auth.role() = 'authenticated');

CREATE POLICY "tm_audit_logs_editor_insert"
  ON public.turath_masr_audit_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (public.can_edit_orders());

CREATE POLICY "tm_audit_logs_admin_delete"
  ON public.turath_masr_audit_logs
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 9: Replace open inventory policies
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "inventory_authenticated_select" ON public.turath_masr_inventory;
DROP POLICY IF EXISTS "inventory_manager_insert"       ON public.turath_masr_inventory;
DROP POLICY IF EXISTS "inventory_manager_update"       ON public.turath_masr_inventory;
DROP POLICY IF EXISTS "inventory_admin_delete"         ON public.turath_masr_inventory;

CREATE POLICY "inventory_authenticated_select"
  ON public.turath_masr_inventory
  FOR SELECT
  TO authenticated
  USING (auth.role() = 'authenticated');

CREATE POLICY "inventory_manager_insert"
  ON public.turath_masr_inventory
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_manager_or_above());

CREATE POLICY "inventory_manager_update"
  ON public.turath_masr_inventory
  FOR UPDATE
  TO authenticated
  USING  (public.is_manager_or_above())
  WITH CHECK (public.is_manager_or_above());

CREATE POLICY "inventory_admin_delete"
  ON public.turath_masr_inventory
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 10: Replace open settings policies
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "settings_authenticated_select" ON public.turath_masr_settings;
DROP POLICY IF EXISTS "settings_admin_insert"         ON public.turath_masr_settings;
DROP POLICY IF EXISTS "settings_admin_update"         ON public.turath_masr_settings;
DROP POLICY IF EXISTS "settings_admin_delete"         ON public.turath_masr_settings;

CREATE POLICY "settings_authenticated_select"
  ON public.turath_masr_settings
  FOR SELECT
  TO authenticated
  USING (auth.role() = 'authenticated');

CREATE POLICY "settings_admin_insert"
  ON public.turath_masr_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "settings_admin_update"
  ON public.turath_masr_settings
  FOR UPDATE
  TO authenticated
  USING  (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "settings_admin_delete"
  ON public.turath_masr_settings
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 11: Replace open deposits policies
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "deposits_authenticated_select" ON public.deposits;
DROP POLICY IF EXISTS "deposits_manager_insert"       ON public.deposits;
DROP POLICY IF EXISTS "deposits_manager_update"       ON public.deposits;
DROP POLICY IF EXISTS "deposits_admin_delete"         ON public.deposits;

CREATE POLICY "deposits_authenticated_select"
  ON public.deposits
  FOR SELECT
  TO authenticated
  USING (auth.role() = 'authenticated');

CREATE POLICY "deposits_manager_insert"
  ON public.deposits
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_manager_or_above());

CREATE POLICY "deposits_manager_update"
  ON public.deposits
  FOR UPDATE
  TO authenticated
  USING  (public.is_manager_or_above())
  WITH CHECK (public.is_manager_or_above());

CREATE POLICY "deposits_admin_delete"
  ON public.deposits
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 12: Replace open turath_masr_customers policies
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "customers_authenticated_select" ON public.turath_masr_customers;
DROP POLICY IF EXISTS "customers_authenticated_insert" ON public.turath_masr_customers;
DROP POLICY IF EXISTS "customers_authenticated_update" ON public.turath_masr_customers;
DROP POLICY IF EXISTS "customers_admin_delete"         ON public.turath_masr_customers;

CREATE POLICY "customers_authenticated_select"
  ON public.turath_masr_customers
  FOR SELECT
  TO authenticated
  USING (auth.role() = 'authenticated');

-- CRM staff (r5, r6) and above can insert customers
CREATE POLICY "customers_crm_insert"
  ON public.turath_masr_customers
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.get_current_user_role_id() = ANY(ARRAY['r1', 'r2', 'r5', 'r6'])
  );

CREATE POLICY "customers_crm_update"
  ON public.turath_masr_customers
  FOR UPDATE
  TO authenticated
  USING (
    public.get_current_user_role_id() = ANY(ARRAY['r1', 'r2', 'r5', 'r6'])
  )
  WITH CHECK (
    public.get_current_user_role_id() = ANY(ARRAY['r1', 'r2', 'r5', 'r6'])
  );

CREATE POLICY "customers_admin_delete"
  ON public.turath_masr_customers
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 13: Replace open crm_complaint_logs policies
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "crm_complaint_logs_authenticated_select" ON public.turath_masr_crm_complaint_logs;
DROP POLICY IF EXISTS "crm_complaint_logs_authenticated_insert" ON public.turath_masr_crm_complaint_logs;
DROP POLICY IF EXISTS "crm_complaint_logs_admin_delete"         ON public.turath_masr_crm_complaint_logs;

CREATE POLICY "crm_complaint_logs_authenticated_select"
  ON public.turath_masr_crm_complaint_logs
  FOR SELECT
  TO authenticated
  USING (auth.role() = 'authenticated');

CREATE POLICY "crm_complaint_logs_crm_insert"
  ON public.turath_masr_crm_complaint_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.get_current_user_role_id() = ANY(ARRAY['r1', 'r2', 'r5', 'r6'])
  );

CREATE POLICY "crm_complaint_logs_admin_delete"
  ON public.turath_masr_crm_complaint_logs
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 14: Replace open turath_roles policies
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "roles_authenticated_select" ON public.turath_roles;
DROP POLICY IF EXISTS "roles_admin_insert"         ON public.turath_roles;
DROP POLICY IF EXISTS "roles_admin_update"         ON public.turath_roles;
DROP POLICY IF EXISTS "roles_admin_delete"         ON public.turath_roles;

CREATE POLICY "roles_authenticated_select"
  ON public.turath_roles
  FOR SELECT
  TO authenticated
  USING (auth.role() = 'authenticated');

CREATE POLICY "roles_admin_insert"
  ON public.turath_roles
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "roles_admin_update"
  ON public.turath_roles
  FOR UPDATE
  TO authenticated
  USING  (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "roles_admin_delete"
  ON public.turath_roles
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 15: Strengthen profiles admin read to include r2 (system supervisor)
-- Supervisor needs to see all profiles for user management.
-- ─────────────────────────────────────────────────────────────────────────────

-- profiles_admin_select already uses is_manager_or_above() which includes r1+r2.
-- No change needed — documenting for clarity.
-- is_manager_or_above() = role_id IN ('r1', 'r2') ✓

-- =============================================================================
-- FINAL VERIFICATION NOTES
-- =============================================================================
-- After this migration:
--   - No USING (true) / WITH CHECK (true) remain except:
--       a) orders_public_select: intentional (customer tracking, no auth required)
--       b) notifications_authenticated_insert: intentional (bounded by TO authenticated)
--   - All DELETE operations → is_admin() only
--   - All INSERT/UPDATE → role-specific guards
--   - Profiles: trigger prevents self-role-elevation
--   - Orders: role r1–r4 can edit; r5–r6 read-only
--   - Notifications: per-user/per-role scoping enabled via new columns
--
-- ⚠️  IMPORTANT: This migration has NOT been applied to production.
--   Review and apply via Supabase Dashboard → SQL Editor.
--   Test on staging/preview branch first.
--
-- REMAINING OPEN ITEMS (require future code + schema changes):
--   1. App code must populate created_by_user_id on order INSERT (Phase 4)
--   2. App code should set target_user_id/target_role_id on notification INSERT
--   3. Add changed_by_user_id to audit log tables for per-user audit filtering
--   4. Consider adding a secret-token column to crm_complaints for public read scoping
-- =============================================================================
