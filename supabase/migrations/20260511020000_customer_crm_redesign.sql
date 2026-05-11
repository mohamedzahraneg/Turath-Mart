-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 24A — Customer service CRM redesign — DB scaffolding.
--
-- Adds the three customer-scoped tables the new /customers profile UI
-- needs, plus a small set of optional columns on `turath_masr_customers`
-- the redesigned dashboard cards expose. Pure additive — no existing
-- columns or rows are touched.
--
-- New tables
-- ----------
--   • turath_masr_customer_notes       — internal CRM notes per customer
--   • turath_masr_customer_tasks       — follow-up tasks per customer
--   • turath_masr_customer_attachments — file metadata per customer
--                                        (bytes live in the new private
--                                        storage bucket `customer-attachments`)
--
-- New `customers` columns (all nullable)
-- --------------------------------------
--   city, customer_type, customer_status, account_manager_id,
--   account_manager_name, vip_level
--
-- New storage bucket
-- ------------------
--   `customer-attachments` (public=false) with admin/CRM RLS on
--   `storage.objects`. Customer tracking surfaces never reach this
--   bucket.
--
-- RLS posture (all 3 new tables)
-- ------------------------------
--   SELECT  → r1, r2, r5, r6 (admin / supervisor / CRM mgr / CRM agent)
--             matches the existing `crm_*` table policies. r3 (shipping
--             supervisor) is NOT given access — these are internal CRM
--             concerns. Anon never reaches the tables.
--   INSERT  → r1, r2, r5, r6
--   UPDATE  → r1, r2, r5, r6
--   DELETE  → admin (r1) only — soft-state via `status='archived'`
--             column on notes/tasks/attachments is the normal lifecycle.
--
-- DEPLOY GATE — DO NOT APPLY WITHOUT EXPLICIT APPROVAL
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;


-- ─── 1) Customer table — additive columns ──────────────────────────────

ALTER TABLE public.turath_masr_customers
  ADD COLUMN IF NOT EXISTS city                  text,
  ADD COLUMN IF NOT EXISTS customer_type         text,
  ADD COLUMN IF NOT EXISTS customer_status       text,
  ADD COLUMN IF NOT EXISTS account_manager_id    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS account_manager_name  text,
  ADD COLUMN IF NOT EXISTS vip_level             text;

-- No CHECK constraints — the page uses Arabic labels via a helper
-- (`customerCrm.ts`) and we want to keep the columns forgiving for
-- legacy back-fills.


-- ─── 2) turath_masr_customer_notes ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.turath_masr_customer_notes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_phone     text NOT NULL,
  customer_name      text,
  order_id           text,
  note               text NOT NULL,
  note_type          text NOT NULL DEFAULT 'general',
  -- 'internal' = CRM team only (default).
  -- 'shared' reserved for a future tab that surfaces notes to the
  -- delegate; not exposed in the current UI.
  visibility         text NOT NULL DEFAULT 'internal',
  status             text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'archived')),
  created_by         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by_name    text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz
);

CREATE INDEX IF NOT EXISTS turath_masr_customer_notes_phone_idx
  ON public.turath_masr_customer_notes (customer_phone, created_at DESC);
CREATE INDEX IF NOT EXISTS turath_masr_customer_notes_order_id_idx
  ON public.turath_masr_customer_notes (order_id) WHERE order_id IS NOT NULL;

ALTER TABLE public.turath_masr_customer_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_notes_crm_select ON public.turath_masr_customer_notes;
CREATE POLICY customer_notes_crm_select
  ON public.turath_masr_customer_notes
  FOR SELECT
  TO authenticated
  USING (public.get_current_user_role_id() = ANY (ARRAY['r1','r2','r5','r6']));

DROP POLICY IF EXISTS customer_notes_crm_insert ON public.turath_masr_customer_notes;
CREATE POLICY customer_notes_crm_insert
  ON public.turath_masr_customer_notes
  FOR INSERT
  TO authenticated
  WITH CHECK (public.get_current_user_role_id() = ANY (ARRAY['r1','r2','r5','r6']));

DROP POLICY IF EXISTS customer_notes_crm_update ON public.turath_masr_customer_notes;
CREATE POLICY customer_notes_crm_update
  ON public.turath_masr_customer_notes
  FOR UPDATE
  TO authenticated
  USING      (public.get_current_user_role_id() = ANY (ARRAY['r1','r2','r5','r6']))
  WITH CHECK (public.get_current_user_role_id() = ANY (ARRAY['r1','r2','r5','r6']));

DROP POLICY IF EXISTS customer_notes_admin_delete ON public.turath_masr_customer_notes;
CREATE POLICY customer_notes_admin_delete
  ON public.turath_masr_customer_notes
  FOR DELETE
  TO authenticated
  USING (public.is_admin());


-- ─── 3) turath_masr_customer_tasks ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.turath_masr_customer_tasks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_phone     text NOT NULL,
  customer_name      text,
  order_id           text,
  title              text NOT NULL,
  description        text,
  priority           text NOT NULL DEFAULT 'medium'
                     CHECK (priority IN ('low', 'medium', 'high')),
  status             text NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open', 'in_progress', 'done', 'cancelled')),
  due_at             timestamptz,
  assigned_to        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_to_name   text,
  created_by         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by_name    text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz
);

CREATE INDEX IF NOT EXISTS turath_masr_customer_tasks_phone_idx
  ON public.turath_masr_customer_tasks (customer_phone, created_at DESC);
CREATE INDEX IF NOT EXISTS turath_masr_customer_tasks_status_idx
  ON public.turath_masr_customer_tasks (status);
CREATE INDEX IF NOT EXISTS turath_masr_customer_tasks_assigned_to_idx
  ON public.turath_masr_customer_tasks (assigned_to);

ALTER TABLE public.turath_masr_customer_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_tasks_crm_select ON public.turath_masr_customer_tasks;
CREATE POLICY customer_tasks_crm_select
  ON public.turath_masr_customer_tasks
  FOR SELECT
  TO authenticated
  USING (public.get_current_user_role_id() = ANY (ARRAY['r1','r2','r5','r6']));

DROP POLICY IF EXISTS customer_tasks_crm_insert ON public.turath_masr_customer_tasks;
CREATE POLICY customer_tasks_crm_insert
  ON public.turath_masr_customer_tasks
  FOR INSERT
  TO authenticated
  WITH CHECK (public.get_current_user_role_id() = ANY (ARRAY['r1','r2','r5','r6']));

DROP POLICY IF EXISTS customer_tasks_crm_update ON public.turath_masr_customer_tasks;
CREATE POLICY customer_tasks_crm_update
  ON public.turath_masr_customer_tasks
  FOR UPDATE
  TO authenticated
  USING      (public.get_current_user_role_id() = ANY (ARRAY['r1','r2','r5','r6']))
  WITH CHECK (public.get_current_user_role_id() = ANY (ARRAY['r1','r2','r5','r6']));

DROP POLICY IF EXISTS customer_tasks_admin_delete ON public.turath_masr_customer_tasks;
CREATE POLICY customer_tasks_admin_delete
  ON public.turath_masr_customer_tasks
  FOR DELETE
  TO authenticated
  USING (public.is_admin());


-- ─── 4) turath_masr_customer_attachments ───────────────────────────────

CREATE TABLE IF NOT EXISTS public.turath_masr_customer_attachments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_phone     text NOT NULL,
  customer_name      text,
  order_id           text,
  file_path          text NOT NULL,
  file_name          text,
  mime_type          text,
  size_bytes         bigint
                     CHECK (size_bytes IS NULL OR size_bytes >= 0),
  uploaded_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  uploaded_by_name   text,
  uploaded_at        timestamptz NOT NULL DEFAULT now(),
  note               text,
  status             text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'archived'))
);

CREATE INDEX IF NOT EXISTS turath_masr_customer_attachments_phone_idx
  ON public.turath_masr_customer_attachments (customer_phone, uploaded_at DESC);

ALTER TABLE public.turath_masr_customer_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_attachments_crm_select ON public.turath_masr_customer_attachments;
CREATE POLICY customer_attachments_crm_select
  ON public.turath_masr_customer_attachments
  FOR SELECT
  TO authenticated
  USING (public.get_current_user_role_id() = ANY (ARRAY['r1','r2','r5','r6']));

DROP POLICY IF EXISTS customer_attachments_crm_insert ON public.turath_masr_customer_attachments;
CREATE POLICY customer_attachments_crm_insert
  ON public.turath_masr_customer_attachments
  FOR INSERT
  TO authenticated
  WITH CHECK (public.get_current_user_role_id() = ANY (ARRAY['r1','r2','r5','r6']));

DROP POLICY IF EXISTS customer_attachments_crm_update ON public.turath_masr_customer_attachments;
CREATE POLICY customer_attachments_crm_update
  ON public.turath_masr_customer_attachments
  FOR UPDATE
  TO authenticated
  USING      (public.get_current_user_role_id() = ANY (ARRAY['r1','r2','r5','r6']))
  WITH CHECK (public.get_current_user_role_id() = ANY (ARRAY['r1','r2','r5','r6']));

DROP POLICY IF EXISTS customer_attachments_admin_delete ON public.turath_masr_customer_attachments;
CREATE POLICY customer_attachments_admin_delete
  ON public.turath_masr_customer_attachments
  FOR DELETE
  TO authenticated
  USING (public.is_admin());


-- ─── 5) Storage bucket + storage.objects RLS ───────────────────────────

INSERT INTO storage.buckets (id, name, public, created_at, updated_at)
VALUES ('customer-attachments', 'customer-attachments', false, now(), now())
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS customer_attachments_storage_read ON storage.objects;
CREATE POLICY customer_attachments_storage_read
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'customer-attachments'
    AND public.get_current_user_role_id() = ANY (ARRAY['r1','r2','r5','r6'])
  );

DROP POLICY IF EXISTS customer_attachments_storage_insert ON storage.objects;
CREATE POLICY customer_attachments_storage_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'customer-attachments'
    AND public.get_current_user_role_id() = ANY (ARRAY['r1','r2','r5','r6'])
  );

DROP POLICY IF EXISTS customer_attachments_storage_update ON storage.objects;
CREATE POLICY customer_attachments_storage_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'customer-attachments'
    AND public.get_current_user_role_id() = ANY (ARRAY['r1','r2','r5','r6'])
  )
  WITH CHECK (
    bucket_id = 'customer-attachments'
    AND public.get_current_user_role_id() = ANY (ARRAY['r1','r2','r5','r6'])
  );

DROP POLICY IF EXISTS customer_attachments_storage_delete ON storage.objects;
CREATE POLICY customer_attachments_storage_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'customer-attachments'
    AND public.is_admin()
  );


COMMENT ON TABLE public.turath_masr_customer_notes IS
  'Phase 24A — internal CRM notes per customer. CRM-only (r1/r2/r5/r6) '
  'read/write. Soft-archive via status=''archived''.';

COMMENT ON TABLE public.turath_masr_customer_tasks IS
  'Phase 24A — follow-up tasks per customer. CRM-only (r1/r2/r5/r6).';

COMMENT ON TABLE public.turath_masr_customer_attachments IS
  'Phase 24A — customer attachment metadata. Bytes in storage bucket '
  '`customer-attachments` (private, RLS-gated). No public access.';


COMMIT;


-- =============================================================================
-- POST-MIGRATION VERIFICATION (run manually after applying):
--
--   -- 1. Tables exist
--   SELECT table_name FROM information_schema.tables
--    WHERE table_schema='public'
--      AND table_name IN (
--        'turath_masr_customer_notes',
--        'turath_masr_customer_tasks',
--        'turath_masr_customer_attachments'
--      )
--    ORDER BY table_name;
--
--   -- 2. New customers columns
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='public'
--      AND table_name='turath_masr_customers'
--      AND column_name IN ('city','customer_type','customer_status',
--                          'account_manager_id','account_manager_name','vip_level')
--    ORDER BY column_name;
--
--   -- 3. Policies (expect 4 per table)
--   SELECT tablename, policyname, cmd
--     FROM pg_policies
--    WHERE schemaname='public'
--      AND tablename IN (
--        'turath_masr_customer_notes',
--        'turath_masr_customer_tasks',
--        'turath_masr_customer_attachments'
--      )
--    ORDER BY tablename, policyname;
--
--   -- 4. Bucket
--   SELECT id, name, public FROM storage.buckets WHERE id='customer-attachments';
--
--   -- 5. Storage policies
--   SELECT policyname, cmd FROM pg_policies
--    WHERE schemaname='storage'
--      AND tablename='objects'
--      AND policyname LIKE 'customer_attachments_%'
--    ORDER BY policyname;
-- =============================================================================
