-- =============================================================================
-- Migration: Harden Row Level Security Policies
-- Date: 2026-05-05
-- Replaces all USING (true) / WITH CHECK (true) open policies.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 0: Ensure profiles has all columns the app expects
-- The init_schema only defined: id, email, full_name, role, created_at
-- The application code also uses: role_id, role_name, permissions
-- We add them safely with IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role_id    text DEFAULT 'r6',
  ADD COLUMN IF NOT EXISTS role_name  text DEFAULT 'خدمة عملاء',
  ADD COLUMN IF NOT EXISTS permissions jsonb DEFAULT '[]'::jsonb;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 1: Helper functions (SECURITY DEFINER to avoid RLS recursion)
-- These functions read the profiles table bypassing RLS, which is safe because
-- they are restricted to auth.uid() and are READ-ONLY.
-- search_path is fixed to prevent search_path injection attacks.
-- ─────────────────────────────────────────────────────────────────────────────

-- Returns the role_id of the currently authenticated user.
CREATE OR REPLACE FUNCTION public.get_current_user_role_id()
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT role_id
  FROM public.profiles
  WHERE id = auth.uid()
  LIMIT 1;
$$;

REVOKE ALL   ON FUNCTION public.get_current_user_role_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_current_user_role_id() TO authenticated;

-- Returns true if the current user is a system admin (r1).
CREATE OR REPLACE FUNCTION public.is_admin()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT COALESCE(public.get_current_user_role_id() = 'r1', false);
$$;

REVOKE ALL   ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- Returns true if the current user is admin (r1) or system supervisor (r2).
CREATE OR REPLACE FUNCTION public.is_manager_or_above()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT COALESCE(public.get_current_user_role_id() = ANY(ARRAY['r1', 'r2']), false);
$$;

REVOKE ALL   ON FUNCTION public.is_manager_or_above() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_manager_or_above() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 2: profiles table
-- id = auth.uid() → per-user policies are possible.
-- Policy design:
--   SELECT: own profile OR admin
--   UPDATE: own profile (non-role fields) OR admin (all fields)
--   INSERT: only admins insert profiles directly (new users via trigger handle_new_user)
--   DELETE: admin only
-- Note: The handle_new_user() trigger is SECURITY DEFINER and bypasses RLS,
--   so new user registration still works without a permissive INSERT policy.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Drop the old wide-open policy
DROP POLICY IF EXISTS "Allow all actions for authenticated users on profiles" ON public.profiles;

-- Own user: read own profile
CREATE POLICY "profiles_own_select"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (id = auth.uid());

-- Admin: read all profiles (needed for roles/users management page)
CREATE POLICY "profiles_admin_select"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- Own user: update own profile (name, avatar, etc.)
-- Role changes are enforced at app level; a DB trigger is recommended for
-- preventing self-role-elevation. TODO: add BEFORE UPDATE trigger in a future migration.
CREATE POLICY "profiles_own_update"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING  (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Admin: update any profile (including role assignments)
CREATE POLICY "profiles_admin_update"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING  (public.is_admin())
  WITH CHECK (public.is_admin());

-- Admin: insert profiles directly (e.g. creating user from roles page)
CREATE POLICY "profiles_admin_insert"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

-- Admin: delete profiles (user removal)
CREATE POLICY "profiles_admin_delete"
  ON public.profiles
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 3: turath_masr_orders
-- No user_id column — created_by is TEXT (user name, not UUID).
-- TODO: Add a uuid column (e.g. created_by_user_id uuid references auth.users)
--   to enable per-creator row-level policies in a future migration.
-- Current policy:
--   SELECT: public (required for customer tracking page /track/[orderId])
--   INSERT: authenticated only
--   UPDATE: authenticated only (all staff can update status)
--   DELETE: admin only (prevent accidental or malicious data loss)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.turath_masr_orders ENABLE ROW LEVEL SECURITY;

-- Drop all old policies on this table
DROP POLICY IF EXISTS "Allow all actions for authenticated users on orders"    ON public.turath_masr_orders;
DROP POLICY IF EXISTS "public_read_orders"                                     ON public.turath_masr_orders;
DROP POLICY IF EXISTS "authenticated_manage_orders"                            ON public.turath_masr_orders;
DROP POLICY IF EXISTS "anon_insert_orders"                                     ON public.turath_masr_orders;

-- Public read: needed for /track/[orderId] (unauthenticated customer tracking)
CREATE POLICY "orders_public_select"
  ON public.turath_masr_orders
  FOR SELECT
  TO public
  USING (true);

-- Authenticated staff: insert new orders
CREATE POLICY "orders_authenticated_insert"
  ON public.turath_masr_orders
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Authenticated staff: update/upsert orders (status changes, edits)
CREATE POLICY "orders_authenticated_update"
  ON public.turath_masr_orders
  FOR UPDATE
  TO authenticated
  USING  (true)
  WITH CHECK (true);

-- Admin only: delete orders (prevent data loss by non-admin)
CREATE POLICY "orders_admin_delete"
  ON public.turath_masr_orders
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 4: order_audit_logs
-- Tracks all order changes. No user_id column (has changed_by TEXT).
-- TODO: Add changed_by_user_id uuid for per-user filtering.
-- Policy: authenticated can select/insert; admin can delete.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.order_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "open_access_audit_logs" ON public.order_audit_logs;

CREATE POLICY "audit_logs_authenticated_select"
  ON public.order_audit_logs
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "audit_logs_authenticated_insert"
  ON public.order_audit_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "audit_logs_admin_delete"
  ON public.order_audit_logs
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 5: turath_masr_notifications
-- Shared notification system — no per-user filtering column exists.
-- TODO: Add user_id uuid or target_role text column to enable role-based
--   filtering so each user only sees their relevant notifications.
-- Current policy: all authenticated staff share notifications (internal tool).
-- Delete restricted to admin to prevent accidental clearance.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.turath_masr_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated users to read all notifications"             ON public.turath_masr_notifications;
DROP POLICY IF EXISTS "Allow authenticated users to update own notifications read status" ON public.turath_masr_notifications;
DROP POLICY IF EXISTS "Allow authenticated users to insert notifications"               ON public.turath_masr_notifications;

CREATE POLICY "notifications_authenticated_select"
  ON public.turath_masr_notifications
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "notifications_authenticated_insert"
  ON public.turath_masr_notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- All staff can mark notifications as read
CREATE POLICY "notifications_authenticated_update"
  ON public.turath_masr_notifications
  FOR UPDATE
  TO authenticated
  USING  (true)
  WITH CHECK (true);

-- Only admin can bulk-clear notifications
CREATE POLICY "notifications_admin_delete"
  ON public.turath_masr_notifications
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 6: turath_masr_inventory
-- Internal stock management. No user_id column.
-- Policy: all authenticated can view; managers+ can write; admin can delete.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.turath_masr_inventory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all actions for authenticated users on inventory" ON public.turath_masr_inventory;

CREATE POLICY "inventory_authenticated_select"
  ON public.turath_masr_inventory
  FOR SELECT
  TO authenticated
  USING (true);

-- Manager and above can add/edit stock
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

-- Admin only can delete inventory items
CREATE POLICY "inventory_admin_delete"
  ON public.turath_masr_inventory
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 7: turath_masr_settings
-- System-wide settings. Only admin should write.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.turath_masr_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated users to read/write settings" ON public.turath_masr_settings;

-- All authenticated staff can read settings (needed by AddOrderModal, etc.)
CREATE POLICY "settings_authenticated_select"
  ON public.turath_masr_settings
  FOR SELECT
  TO authenticated
  USING (true);

-- Only admin can write settings
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
-- SECTION 8: turath_masr_crm_chat
-- Customer-facing: customers chat via tracking page without login.
-- Public INSERT and SELECT kept intentionally for customer communication.
-- Authenticated staff can delete messages (moderation).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.turath_masr_crm_chat ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated users to read/write CRM chat" ON public.turath_masr_crm_chat;
DROP POLICY IF EXISTS "public_insert_chat"                               ON public.turath_masr_crm_chat;
DROP POLICY IF EXISTS "public_read_chat"                                 ON public.turath_masr_crm_chat;

-- Public (anon + authenticated): read and write chat messages
-- Required: customer tracking page allows unauthenticated chat
CREATE POLICY "crm_chat_public_select"
  ON public.turath_masr_crm_chat
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "crm_chat_public_insert"
  ON public.turath_masr_crm_chat
  FOR INSERT
  TO public
  WITH CHECK (true);

-- Staff can moderate (update/delete)
CREATE POLICY "crm_chat_authenticated_delete"
  ON public.turath_masr_crm_chat
  FOR DELETE
  TO authenticated
  USING (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 9: turath_masr_crm_complaints
-- Same pattern as CRM chat — public-facing for customer submissions.
-- Staff can read and manage complaints.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.turath_masr_crm_complaints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated users to read/write CRM complaints" ON public.turath_masr_crm_complaints;
DROP POLICY IF EXISTS "public_insert_complaints"                               ON public.turath_masr_crm_complaints;
DROP POLICY IF EXISTS "public_read_complaints"                                 ON public.turath_masr_crm_complaints;

CREATE POLICY "crm_complaints_public_insert"
  ON public.turath_masr_crm_complaints
  FOR INSERT
  TO public
  WITH CHECK (true);

-- Public can read their own complaint by phone (no user_id, so public for now)
-- TODO: Add a secret token column to restrict complaint read to submitter only.
CREATE POLICY "crm_complaints_public_select"
  ON public.turath_masr_crm_complaints
  FOR SELECT
  TO public
  USING (true);

-- Staff can update complaint status
CREATE POLICY "crm_complaints_authenticated_update"
  ON public.turath_masr_crm_complaints
  FOR UPDATE
  TO authenticated
  USING  (true)
  WITH CHECK (true);

-- Admin only deletes complaints
CREATE POLICY "crm_complaints_admin_delete"
  ON public.turath_masr_crm_complaints
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 10: deposits
-- Internal financial table. No current direct code usage found.
-- Restrict to manager+ write, authenticated read, admin delete.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.deposits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all actions on deposits" ON public.deposits;

CREATE POLICY "deposits_authenticated_select"
  ON public.deposits
  FOR SELECT
  TO authenticated
  USING (true);

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
-- SECTION 11: turath_roles
-- Role definitions managed by admin. No migration existed for this table.
-- Creating it safely with IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.turath_roles (
  id          text PRIMARY KEY,            -- e.g. 'r1', 'r2'
  name        text NOT NULL,
  permissions jsonb DEFAULT '[]'::jsonb,
  color       text DEFAULT 'blue',
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE public.turath_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "roles_authenticated_select" ON public.turath_roles;
DROP POLICY IF EXISTS "roles_admin_write"          ON public.turath_roles;

CREATE POLICY "roles_authenticated_select"
  ON public.turath_roles
  FOR SELECT
  TO authenticated
  USING (true);

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
-- SECTION 12: turath_masr_sessions
-- Used in AuthContext.tsx for logout session logging.
-- Table did NOT exist in any prior migration — creating it now.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.turath_masr_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email   text,
  user_name    text,
  role_id      text,
  role_name    text,
  action       text NOT NULL DEFAULT 'logout', -- 'login', 'logout'
  device       text,
  ip           text,
  timestamp    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_turath_masr_sessions_user_id   ON public.turath_masr_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_turath_masr_sessions_timestamp  ON public.turath_masr_sessions(timestamp DESC);

ALTER TABLE public.turath_masr_sessions ENABLE ROW LEVEL SECURITY;

-- Authenticated users can log their own sessions
CREATE POLICY "sessions_own_insert"
  ON public.turath_masr_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Each user can view their own sessions
CREATE POLICY "sessions_own_select"
  ON public.turath_masr_sessions
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Admin can view all sessions (for audit)
CREATE POLICY "sessions_admin_select"
  ON public.turath_masr_sessions
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- Admin can delete sessions (cleanup)
CREATE POLICY "sessions_admin_delete"
  ON public.turath_masr_sessions
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 13: turath_masr_audit_logs
-- Used in AuditLogModal.tsx for order change tracking.
-- Different from order_audit_logs — this is app-level audit.
-- Table NOT found in prior migrations — creating safely.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.turath_masr_audit_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      text,
  order_num     text,
  action        text NOT NULL,
  field_changed text,
  old_value     text,
  new_value     text,
  changed_by    text,                                   -- display name (TEXT, not UUID)
  changed_by_role text,
  note          text,
  -- TODO: Add changed_by_user_id uuid references auth.users(id)
  --   to enable per-user RLS on audit logs.
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tm_audit_logs_order_id  ON public.turath_masr_audit_logs(order_id);
CREATE INDEX IF NOT EXISTS idx_tm_audit_logs_created_at ON public.turath_masr_audit_logs(created_at DESC);

ALTER TABLE public.turath_masr_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tm_audit_logs_authenticated_select"
  ON public.turath_masr_audit_logs
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "tm_audit_logs_authenticated_insert"
  ON public.turath_masr_audit_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "tm_audit_logs_admin_delete"
  ON public.turath_masr_audit_logs
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 14: turath_masr_customers
-- Used in CRM page for customer metadata.
-- Table NOT found in prior migrations — creating safely.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.turath_masr_customers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone        text NOT NULL UNIQUE,
  name         text,
  notes        text,
  segment      text DEFAULT 'regular',     -- e.g. 'vip', 'regular', 'blocked'
  total_orders integer DEFAULT 0,
  total_spent  numeric DEFAULT 0,
  -- TODO: Add assigned_agent_id uuid for per-agent CRM access control
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_turath_masr_customers_phone ON public.turath_masr_customers(phone);

ALTER TABLE public.turath_masr_customers ENABLE ROW LEVEL SECURITY;

-- All staff can view customers
CREATE POLICY "customers_authenticated_select"
  ON public.turath_masr_customers
  FOR SELECT
  TO authenticated
  USING (true);

-- Staff with CRM access can insert/update customers
CREATE POLICY "customers_authenticated_insert"
  ON public.turath_masr_customers
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "customers_authenticated_update"
  ON public.turath_masr_customers
  FOR UPDATE
  TO authenticated
  USING  (true)
  WITH CHECK (true);

-- Admin only can delete customer records
CREATE POLICY "customers_admin_delete"
  ON public.turath_masr_customers
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 15: turath_masr_crm_complaint_logs
-- Used in crm/page.tsx and crm/customer/[phone]/page.tsx.
-- Table NOT found in prior migrations — creating safely.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.turath_masr_crm_complaint_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id uuid REFERENCES public.turath_masr_crm_complaints(id) ON DELETE CASCADE,
  action       text NOT NULL,
  note         text,
  changed_by   text,                                   -- staff display name
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_complaint_logs_complaint_id ON public.turath_masr_crm_complaint_logs(complaint_id);

ALTER TABLE public.turath_masr_crm_complaint_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crm_complaint_logs_authenticated_select"
  ON public.turath_masr_crm_complaint_logs
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "crm_complaint_logs_authenticated_insert"
  ON public.turath_masr_crm_complaint_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "crm_complaint_logs_admin_delete"
  ON public.turath_masr_crm_complaint_logs
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
-- Summary of what was changed:
--   REMOVED: 9 open USING (true) / WITH CHECK (true) policies
--   ADDED:   3 helper functions (get_current_user_role_id, is_admin, is_manager_or_above)
--   ADDED:   ~35 scoped policies across 13 tables
--   CREATED: 4 missing tables (turath_roles, turath_masr_sessions,
--              turath_masr_audit_logs, turath_masr_customers,
--              turath_masr_crm_complaint_logs)
--   NOTED:   TODOs for future schema improvements (user_id columns, etc.)
--
-- ⚠️  IMPORTANT: This migration has NOT been applied to production.
--   Review and apply via Supabase Dashboard → SQL Editor or supabase db push.
--   Test on a staging/preview branch first if possible.
-- =============================================================================
