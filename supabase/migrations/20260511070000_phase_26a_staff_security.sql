-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 26A — staff / roles / security overhaul.
--
-- What this migration does
-- ------------------------
-- 1) Adds account-status fields to `public.profiles` so admins can
--    disable / suspend staff without resorting to deleting them
--    (which currently only removes the profile row and leaves
--    `auth.users` intact — exactly the symptom the audit found:
--    4 orphan auth users still able to sign in).
--
-- 2) Adds `public.turath_masr_staff_audit_logs` — a free-form audit
--    trail for staff-level actions (role change, account disable,
--    device block, etc.). Distinct from
--    `turath_masr_audit_logs` which is order-scoped.
--
-- 3) Adds `public.turath_masr_login_events` — every login / logout /
--    refresh / blocked attempt with IP + user agent + device
--    fingerprint. Replaces the bare `turath_masr_sessions` table
--    (which we keep around for backward compatibility; it remains
--    valid but new code writes here).
--
-- 4) Adds `public.turath_masr_user_devices` — per-user known-device
--    registry with login_count, first_seen_at, last_seen_at, status
--    (allowed / blocked / pending). Drives the "block this device"
--    UX.
--
-- 5) Adds `public.turath_masr_user_device_policies` — per-user knob
--    for allowed_device_count and require_known_device. Empty rows
--    mean "no restriction" so existing accounts keep working
--    untouched.
--
-- 6) Seeds new permissions onto the existing `turath_roles` rows.
--    Only the admin role (r1) gets the new security-management
--    permissions added; the operational permissions are added to
--    the roles that already exercise those modules in production.
--    We never *remove* a permission from a role — strictly
--    additive.
--
-- Safety properties
-- -----------------
--   • Every ADD COLUMN uses `IF NOT EXISTS`; every CREATE TABLE uses
--     `IF NOT EXISTS`; every CREATE INDEX uses `IF NOT EXISTS`. The
--     migration is fully idempotent.
--   • No DROP, no DELETE, no TRUNCATE, no ALTER COLUMN of an
--     existing column type.
--   • The CHECK constraints land via DO-blocks that test
--     `pg_constraint` first so re-running the migration after a
--     partial apply doesn't error.
--   • New RLS policies on each new table grant access strictly to
--     `authenticated` users — admins (`is_admin()`) for security
--     tables, and self-rows for login events / devices.
--   • Existing tables (profiles, turath_roles, turath_masr_sessions)
--     keep all their current policies — none are touched.
--
-- DEPLOY GATE — DO NOT APPLY WITHOUT EXPLICIT APPROVAL
-- ─────────────────────────────────────────────────────────────────────────────

-- =============================================================================
-- 1) profiles — account status fields
-- =============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_status  TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS disabled_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS disabled_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS disabled_reason TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'profiles_account_status_check'
       AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_account_status_check
      CHECK (account_status IN ('active','disabled','suspended','pending'));
  END IF;
END $$;

COMMENT ON COLUMN public.profiles.account_status IS
  'Phase 26A — active / disabled / suspended / pending. Drives sign-out + UI gating.';
COMMENT ON COLUMN public.profiles.disabled_at IS
  'Phase 26A — when an admin disabled / suspended this account.';
COMMENT ON COLUMN public.profiles.disabled_by IS
  'Phase 26A — admin who flipped the status; nullable so deleting the admin profile does not cascade.';
COMMENT ON COLUMN public.profiles.disabled_reason IS
  'Phase 26A — free-text reason shown to other admins on the staff list.';


-- =============================================================================
-- 2) Staff audit logs
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.turath_masr_staff_audit_logs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id            UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_name          TEXT,
  actor_role_id       TEXT,
  action              TEXT NOT NULL,
  entity_type         TEXT,
  entity_id           TEXT,
  entity_label        TEXT,
  description         TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address          TEXT,
  user_agent          TEXT,
  device_fingerprint  TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS turath_masr_staff_audit_actor_idx
  ON public.turath_masr_staff_audit_logs(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS turath_masr_staff_audit_entity_idx
  ON public.turath_masr_staff_audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS turath_masr_staff_audit_created_at_idx
  ON public.turath_masr_staff_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS turath_masr_staff_audit_action_idx
  ON public.turath_masr_staff_audit_logs(action);

ALTER TABLE public.turath_masr_staff_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_audit_admin_select ON public.turath_masr_staff_audit_logs;
CREATE POLICY staff_audit_admin_select
  ON public.turath_masr_staff_audit_logs
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS staff_audit_authenticated_insert ON public.turath_masr_staff_audit_logs;
CREATE POLICY staff_audit_authenticated_insert
  ON public.turath_masr_staff_audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    -- The actor must be the logged-in user (or NULL for service-role
    -- writes via API routes that establish their own identity).
    actor_id IS NULL OR actor_id = auth.uid()
  );


-- =============================================================================
-- 3) Login events
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.turath_masr_login_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  user_email         TEXT,
  user_name          TEXT,
  event_type         TEXT NOT NULL,
  success            BOOLEAN NOT NULL DEFAULT true,
  failure_reason     TEXT,
  ip_address         TEXT,
  user_agent         TEXT,
  device_fingerprint TEXT,
  device_label       TEXT,
  country            TEXT,
  city               TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'turath_masr_login_events_event_type_check'
       AND conrelid = 'public.turath_masr_login_events'::regclass
  ) THEN
    ALTER TABLE public.turath_masr_login_events
      ADD CONSTRAINT turath_masr_login_events_event_type_check
      CHECK (event_type IN ('login','logout','refresh','blocked_device','failed_login'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS turath_masr_login_events_user_idx
  ON public.turath_masr_login_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS turath_masr_login_events_event_idx
  ON public.turath_masr_login_events(event_type);
CREATE INDEX IF NOT EXISTS turath_masr_login_events_created_at_idx
  ON public.turath_masr_login_events(created_at DESC);
CREATE INDEX IF NOT EXISTS turath_masr_login_events_device_idx
  ON public.turath_masr_login_events(device_fingerprint);

ALTER TABLE public.turath_masr_login_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS login_events_admin_select ON public.turath_masr_login_events;
CREATE POLICY login_events_admin_select
  ON public.turath_masr_login_events
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS login_events_own_select ON public.turath_masr_login_events;
CREATE POLICY login_events_own_select
  ON public.turath_masr_login_events
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS login_events_own_insert ON public.turath_masr_login_events;
CREATE POLICY login_events_own_insert
  ON public.turath_masr_login_events
  FOR INSERT TO authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());


-- =============================================================================
-- 4) User devices
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.turath_masr_user_devices (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  device_fingerprint  TEXT NOT NULL,
  device_label        TEXT,
  user_agent          TEXT,
  first_ip            TEXT,
  last_ip             TEXT,
  first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  login_count         INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'allowed',
  blocked_at          TIMESTAMPTZ,
  blocked_by          UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  blocked_reason      TEXT,
  UNIQUE(user_id, device_fingerprint)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'turath_masr_user_devices_status_check'
       AND conrelid = 'public.turath_masr_user_devices'::regclass
  ) THEN
    ALTER TABLE public.turath_masr_user_devices
      ADD CONSTRAINT turath_masr_user_devices_status_check
      CHECK (status IN ('allowed','blocked','pending'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS turath_masr_user_devices_user_idx
  ON public.turath_masr_user_devices(user_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS turath_masr_user_devices_status_idx
  ON public.turath_masr_user_devices(status);

ALTER TABLE public.turath_masr_user_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_devices_admin_select ON public.turath_masr_user_devices;
CREATE POLICY user_devices_admin_select
  ON public.turath_masr_user_devices
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS user_devices_own_select ON public.turath_masr_user_devices;
CREATE POLICY user_devices_own_select
  ON public.turath_masr_user_devices
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_devices_own_upsert ON public.turath_masr_user_devices;
CREATE POLICY user_devices_own_upsert
  ON public.turath_masr_user_devices
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_devices_own_update_meta ON public.turath_masr_user_devices;
CREATE POLICY user_devices_own_update_meta
  ON public.turath_masr_user_devices
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_devices_admin_update ON public.turath_masr_user_devices;
CREATE POLICY user_devices_admin_update
  ON public.turath_masr_user_devices
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS user_devices_admin_delete ON public.turath_masr_user_devices;
CREATE POLICY user_devices_admin_delete
  ON public.turath_masr_user_devices
  FOR DELETE TO authenticated
  USING (public.is_admin());


-- =============================================================================
-- 5) User device policies
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.turath_masr_user_device_policies (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  allowed_device_count     INTEGER,
  require_known_device     BOOLEAN NOT NULL DEFAULT false,
  auto_block_new_devices   BOOLEAN NOT NULL DEFAULT false,
  updated_by               UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'turath_masr_user_device_policies_count_check'
       AND conrelid = 'public.turath_masr_user_device_policies'::regclass
  ) THEN
    ALTER TABLE public.turath_masr_user_device_policies
      ADD CONSTRAINT turath_masr_user_device_policies_count_check
      CHECK (allowed_device_count IS NULL OR allowed_device_count >= 1);
  END IF;
END $$;

ALTER TABLE public.turath_masr_user_device_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_device_policies_admin_select
  ON public.turath_masr_user_device_policies;
CREATE POLICY user_device_policies_admin_select
  ON public.turath_masr_user_device_policies
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS user_device_policies_own_select
  ON public.turath_masr_user_device_policies;
CREATE POLICY user_device_policies_own_select
  ON public.turath_masr_user_device_policies
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_device_policies_admin_upsert
  ON public.turath_masr_user_device_policies;
CREATE POLICY user_device_policies_admin_upsert
  ON public.turath_masr_user_device_policies
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS user_device_policies_admin_update
  ON public.turath_masr_user_device_policies;
CREATE POLICY user_device_policies_admin_update
  ON public.turath_masr_user_device_policies
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS user_device_policies_admin_delete
  ON public.turath_masr_user_device_policies;
CREATE POLICY user_device_policies_admin_delete
  ON public.turath_masr_user_device_policies
  FOR DELETE TO authenticated USING (public.is_admin());


-- =============================================================================
-- 6) Permission seeds — strictly additive, never removes
-- =============================================================================
--
-- The existing r1 admin role gets every new security permission so the
-- redesigned roles UI can render and operate immediately after deploy.
-- r5 (CRM manager) gets returns / complaints / customer-attachment
-- permissions to mirror the surfaces shipped in Phases 25A / 25B. Other
-- roles are unchanged here — the Phase 26A roles UI will let admins
-- grant additional permissions interactively.

UPDATE public.turath_roles
SET permissions = (
  SELECT array_agg(DISTINCT p)
  FROM unnest(permissions || ARRAY[
    -- Returns / exchanges (Phase 25A / 25B)
    'manage_returns_exchanges',
    'approve_returns_exchanges',
    'view_returns_exchanges',
    -- Complaints + customer chat
    'view_complaints',
    'manage_complaints',
    'view_customer_chat',
    'reply_customer_chat',
    -- CRM extras
    'manage_customer_notes',
    'manage_customer_tasks',
    'manage_customer_attachments',
    'view_customer_attachments',
    -- Schedule + audit
    'schedule_delivery',
    'view_order_audit',
    'assign_delegate',
    -- Delegate finance
    'view_delegate_finance',
    'manage_delegate_settlements',
    'manage_delegate_custody',
    'manage_delegate_expenses',
    'approve_delegate_expenses',
    'view_delegate_reports',
    'export_delegate_reports',
    'manage_delegates',
    -- Inventory / products
    'manage_inventory',
    'view_products',
    'manage_products',
    -- Settings / roles / staff
    'view_settings',
    'manage_settings',
    'view_roles',
    'view_staff',
    'manage_staff',
    'manage_permissions',
    -- Security
    'view_security_audit',
    'view_login_sessions',
    'manage_device_access',
    'block_devices',
    'view_staff_activity',
    'export_audit_logs'
  ]) AS p
)
WHERE id = 'r1';

-- r5 — CRM manager. Add the CRM-flavoured permissions that mirror
-- production surfaces.
UPDATE public.turath_roles
SET permissions = (
  SELECT array_agg(DISTINCT p)
  FROM unnest(permissions || ARRAY[
    'view_returns_exchanges',
    'manage_returns_exchanges',
    'view_complaints',
    'manage_complaints',
    'view_customer_chat',
    'reply_customer_chat',
    'manage_customer_notes',
    'manage_customer_tasks',
    'manage_customer_attachments',
    'view_customer_attachments',
    'view_order_audit'
  ]) AS p
)
WHERE id = 'r5';

-- r6 — CRM agent. Read + light-touch permissions only.
UPDATE public.turath_roles
SET permissions = (
  SELECT array_agg(DISTINCT p)
  FROM unnest(permissions || ARRAY[
    'view_returns_exchanges',
    'view_complaints',
    'view_customer_chat',
    'reply_customer_chat',
    'manage_customer_notes',
    'manage_customer_tasks',
    'view_customer_attachments'
  ]) AS p
)
WHERE id = 'r6';

-- r2 — system supervisor. Operational + returns approval.
UPDATE public.turath_roles
SET permissions = (
  SELECT array_agg(DISTINCT p)
  FROM unnest(permissions || ARRAY[
    'view_returns_exchanges',
    'manage_returns_exchanges',
    'approve_returns_exchanges',
    'view_complaints',
    'schedule_delivery',
    'view_order_audit',
    'assign_delegate'
  ]) AS p
)
WHERE id = 'r2';

-- r3 — shipping supervisor. Read shipping + assign delegate + view
-- finance.
UPDATE public.turath_roles
SET permissions = (
  SELECT array_agg(DISTINCT p)
  FROM unnest(permissions || ARRAY[
    'schedule_delivery',
    'assign_delegate',
    'view_delegate_finance',
    'manage_delegate_settlements',
    'view_delegate_reports'
  ]) AS p
)
WHERE id = 'r3';

-- r4 — delegate. NO additions — strictly own-order updates as today.


-- =============================================================================
-- POST-MIGRATION VERIFICATION (read-only — run manually after apply)
--
--   SELECT id, name, array_length(permissions, 1) AS perms_count
--     FROM public.turath_roles ORDER BY id;
--   SELECT column_name, data_type, column_default
--     FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='profiles'
--      AND column_name IN ('account_status','disabled_at','disabled_by','disabled_reason')
--    ORDER BY column_name;
--   SELECT relname, relrowsecurity AS rls_enabled
--     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname='public'
--      AND c.relname IN ('turath_masr_staff_audit_logs','turath_masr_login_events',
--                        'turath_masr_user_devices','turath_masr_user_device_policies');
-- =============================================================================
