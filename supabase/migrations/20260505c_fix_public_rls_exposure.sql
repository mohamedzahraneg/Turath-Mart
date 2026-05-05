-- =============================================================================
-- Migration: Remove Unsafe Public RLS Exposure
-- Date: 2026-05-05 (runs after 20260505b_strengthen_rls_policies.sql)
-- =============================================================================
--
-- This migration eliminates ALL `TO public` policies on internal tables and
-- restricts every CREATE POLICY to authenticated users with a role guard.
--
-- BREAKING CHANGE for the application:
--   - The customer tracking page (/track/[orderId]) will no longer work via
--     direct supabase-js calls from the browser.
--     → It must be re-implemented using one of:
--       (a) A SECURITY DEFINER RPC function that returns only safe columns
--           when given a valid tracking code/token
--       (b) A Next.js API route (app/api/track/route.ts) using the service-role
--           key server-side, returning a redacted DTO
--       (c) A signed URL / unguessable tracking_token column on orders
--   - The customer-facing CRM chat / complaints widgets on /track/[orderId]
--     will no longer work without authentication.
--     → Same remediation options as above.
--
-- Until those remediations land, the tracking & customer-chat features are
-- effectively disabled — but the system is no longer leaking customer data
-- to anonymous Supabase API callers.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 1: turath_masr_orders — REMOVE public SELECT
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "orders_public_select" ON public.turath_masr_orders;

-- Authenticated read is already covered by the editor/admin policies in v2,
-- but those only allow UPDATE/DELETE. SELECT from authenticated staff needs
-- its own policy.
CREATE POLICY "orders_authenticated_select"
  ON public.turath_masr_orders
  FOR SELECT
  TO authenticated
  USING (auth.role() = 'authenticated');

-- TODO (post-migration code work):
--   Implement secure customer tracking via either:
--     (a) RPC: CREATE FUNCTION public.get_tracking_info(p_order_num text)
--               RETURNS table(...safe columns only...) SECURITY DEFINER
--               SET search_path = public; revoke from PUBLIC; grant to anon;
--     (b) API route: src/app/api/track/[orderNum]/route.ts using service-role
--               key server-side, returning only allowed fields.
--     (c) Add a tracking_token uuid column to turath_masr_orders, generate
--         on INSERT, and require ?token=... in the tracking URL.

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 2: turath_masr_crm_chat — REMOVE public access
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "crm_chat_public_select"           ON public.turath_masr_crm_chat;
DROP POLICY IF EXISTS "crm_chat_public_insert"           ON public.turath_masr_crm_chat;
DROP POLICY IF EXISTS "crm_chat_authenticated_delete"    ON public.turath_masr_crm_chat;

-- CRM staff (r1, r2, r5, r6) can read chat threads
CREATE POLICY "crm_chat_crm_select"
  ON public.turath_masr_crm_chat
  FOR SELECT
  TO authenticated
  USING (
    public.get_current_user_role_id() = ANY(ARRAY['r1', 'r2', 'r5', 'r6'])
  );

-- CRM staff can post messages
CREATE POLICY "crm_chat_crm_insert"
  ON public.turath_masr_crm_chat
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.get_current_user_role_id() = ANY(ARRAY['r1', 'r2', 'r5', 'r6'])
  );

-- Admin only can delete messages (moderation)
CREATE POLICY "crm_chat_admin_delete"
  ON public.turath_masr_crm_chat
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- TODO: customer-side chat (from /track/[orderId]) requires an API route
--   or RPC that validates a tracking token before inserting on the customer's
--   behalf using elevated credentials.

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 3: turath_masr_crm_complaints — REMOVE public access
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "crm_complaints_public_select"           ON public.turath_masr_crm_complaints;
DROP POLICY IF EXISTS "crm_complaints_public_insert"           ON public.turath_masr_crm_complaints;
DROP POLICY IF EXISTS "crm_complaints_authenticated_update"    ON public.turath_masr_crm_complaints;
DROP POLICY IF EXISTS "crm_complaints_admin_delete"            ON public.turath_masr_crm_complaints;

-- CRM staff can read all complaints
CREATE POLICY "crm_complaints_crm_select"
  ON public.turath_masr_crm_complaints
  FOR SELECT
  TO authenticated
  USING (
    public.get_current_user_role_id() = ANY(ARRAY['r1', 'r2', 'r5', 'r6'])
  );

-- CRM staff can record complaints (e.g. when handling a phone call)
CREATE POLICY "crm_complaints_crm_insert"
  ON public.turath_masr_crm_complaints
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.get_current_user_role_id() = ANY(ARRAY['r1', 'r2', 'r5', 'r6'])
  );

-- CRM staff can update complaint status / notes
CREATE POLICY "crm_complaints_crm_update"
  ON public.turath_masr_crm_complaints
  FOR UPDATE
  TO authenticated
  USING (
    public.get_current_user_role_id() = ANY(ARRAY['r1', 'r2', 'r5', 'r6'])
  )
  WITH CHECK (
    public.get_current_user_role_id() = ANY(ARRAY['r1', 'r2', 'r5', 'r6'])
  );

-- Admin only can delete complaints
CREATE POLICY "crm_complaints_admin_delete"
  ON public.turath_masr_crm_complaints
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- TODO: customer-submitted complaint form (if it exists on the public site)
--   must go through an API route that validates the submission and inserts
--   on the customer's behalf using server-side credentials.

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 4: turath_masr_notifications — restrict INSERT to managers/editors
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "notifications_authenticated_insert" ON public.turath_masr_notifications;

-- Only manager/editor roles (r1, r2, r3, r5) can create notifications.
-- This prevents low-privilege users (r4 delegate, r6 CRM agent) from spamming
-- the notification feed for all staff.
-- An authenticated user may also create notifications targeted explicitly at
-- themselves (target_user_id = auth.uid()) for self-acknowledgement flows.
CREATE POLICY "notifications_managers_insert"
  ON public.turath_masr_notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.get_current_user_role_id() = ANY(ARRAY['r1', 'r2', 'r3', 'r5'])
    OR target_user_id = auth.uid()
  );

-- TODO (Phase 4 / app code work):
--   - StatusUpdateModal.tsx (used by r4 delegates) must EITHER:
--       a) be elevated to call an RPC that does the insert with elevated rights
--       b) have its notification side-effects moved to a database trigger
--          on UPDATE OF status on turath_masr_orders
--   - Notifications from the public tracking page (track/[orderId]:754) must
--     be moved to an API route once tracking is re-implemented.
--   - CRM agent (r6) actions in crm/page.tsx:337 must trigger notifications
--     via an admin-owned trigger or RPC.

-- =============================================================================
-- FINAL STATE AFTER THIS MIGRATION
-- =============================================================================
--
-- TO public policies remaining:    0
-- TO anon policies remaining:      0
-- USING (true) in active CREATE POLICY: 0 (all replaced with role guards or
--                                          auth.role() = 'authenticated' checks)
--
-- Tables still readable by all authenticated staff (no per-row scoping yet):
--   - turath_masr_orders            (auth.role() = authenticated)
--   - order_audit_logs              (auth.role() = authenticated)
--   - turath_masr_audit_logs        (auth.role() = authenticated)
--   - turath_masr_inventory         (auth.role() = authenticated)
--   - turath_masr_settings          (auth.role() = authenticated)
--   - deposits                      (auth.role() = authenticated)
--   - turath_roles                  (auth.role() = authenticated)
--
-- These are internal-only tools for an internal team — broad authenticated
-- read is acceptable. Per-user row scoping would require schema changes that
-- are out of scope for the security hardening phase.
--
-- ⚠️  Like the previous two migrations, this has NOT been applied to production.
--   Apply via Supabase Dashboard → SQL Editor in the order:
--     1. 20260505_harden_rls_policies.sql
--     2. 20260505b_strengthen_rls_policies.sql
--     3. 20260505c_fix_public_rls_exposure.sql  (this one)
--   Test on a staging branch first.
-- =============================================================================
