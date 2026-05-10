-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 23I — delegate documents storage + metadata.
--
-- Enables per-delegate document upload (national-ID images, driving /
-- vehicle licence scans, vehicle photos, optional misc) with file
-- bytes living in Supabase Storage and metadata in a new public
-- table. The /delegates documents tab reads metadata directly and
-- generates short-lived signed URLs on preview/download click —
-- nothing is ever served via a public URL.
--
-- Schema decisions
--   • `delegate_profile_id REFERENCES profiles(id) ON DELETE CASCADE`
--     per the spec — if a delegate profile is hard-deleted the
--     documents go with it. This is consistent with the spec's
--     intent to avoid orphaned audit rows; soft-deactivation
--     (`delegate_is_active=false`) is the normal path and never
--     touches documents.
--   • `document_type` constrained to a 6-token CHECK matching the UI
--     label module (`src/lib/delegates/documentTypes.ts`):
--       national_id_front / national_id_back / driving_license /
--       vehicle_license / vehicle_photo / other
--   • `status` constrained to `active` / `archived`. Phase 23I has
--     no hard-delete path; archive is a soft-hide.
--   • `expires_at` (date) is OPTIONAL — useful for licence images
--     that should be flagged when their underlying licence is about
--     to expire. The page-level filter currently uses
--     `profiles.{vehicle,driving}_license_expires_at` directly, but
--     this column gives a future "document-level expiry" hook.
--
-- Storage decisions
--   • Single private bucket `delegate-documents`, `public=false`.
--     Every read goes through `createSignedUrl` from the client
--     after the RLS policies grant SELECT to the user.
--   • RLS posture mirrors Phase 23F:
--       SELECT  → is_delegate_finance_reader() (r1 + r3)
--       INSERT  → is_admin()
--       UPDATE  → is_admin()
--       DELETE  → is_admin()
--   • No anon access. No public bucket flag. No service-role usage.
--
-- DEPLOY GATE — DO NOT APPLY WITHOUT EXPLICIT APPROVAL
--   This migration is the first storage integration in the app, so
--   the bucket creation + policies are deliberately conservative.
--   Apply only after reviewing the storage policy block below.
--   Pre-migration the page swallows the 42P01 ("table does not
--   exist") + storage 404s and renders the documents tab with a
--   "ميزة المستندات غير مفعّلة بعد" placeholder.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── 1) Metadata table ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.turath_masr_delegate_documents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ON DELETE CASCADE per the Phase 23I spec — delegate profile
  -- hard-deletes pull their documents with them. Soft-deactivation
  -- (`delegate_is_active=false`) is the normal lifecycle and never
  -- touches this column.
  delegate_profile_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  delegate_name       text,

  -- 6 canonical document types. UI maps each to an Arabic label.
  document_type       text NOT NULL
                      CHECK (document_type IN (
                        'national_id_front',
                        'national_id_back',
                        'driving_license',
                        'vehicle_license',
                        'vehicle_photo',
                        'other'
                      )),

  -- Storage object key (bucket-relative). Caller composes:
  --   delegates/<delegate_profile_id>/<document_type>/<ts>-<safe_filename>
  -- We never expose this directly — the UI always wraps it in a
  -- short-lived signed URL.
  file_path           text NOT NULL,
  file_name           text,
  mime_type           text,
  size_bytes          bigint
                      CHECK (size_bytes IS NULL OR size_bytes >= 0),

  -- Soft FK on uploader so a deleted dispatcher profile doesn't wipe
  -- the audit trail (asymmetric to the delegate cascade — the
  -- uploader is incidental, not the principal of the record).
  uploaded_by         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  uploaded_by_name    text,
  uploaded_at         timestamptz NOT NULL DEFAULT now(),

  -- Document-level expiry hook (future use). The page currently
  -- pulls expiry from `profiles.{vehicle,driving}_license_expires_at`
  -- (Phase 23A-Fix1) and ignores this column; the column is staged
  -- so a future per-document expiry never needs another migration.
  expires_at          date,
  note                text,

  -- 'archived' is the soft-hide path for documents that have been
  -- replaced or are no longer relevant. UI hides archived rows from
  -- the default view but keeps them readable for audit.
  status              text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'archived')),

  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Three operational indexes that match the actual queries the page runs:
--   • per-delegate document list (drawer documents tab)
--   • per-type filter ("show all driving_license documents")
--   • expiry sort ("documents expiring soon" report)
CREATE INDEX IF NOT EXISTS turath_masr_delegate_documents_delegate_profile_id_idx
  ON public.turath_masr_delegate_documents(delegate_profile_id);
CREATE INDEX IF NOT EXISTS turath_masr_delegate_documents_document_type_idx
  ON public.turath_masr_delegate_documents(document_type);
CREATE INDEX IF NOT EXISTS turath_masr_delegate_documents_expires_at_idx
  ON public.turath_masr_delegate_documents(expires_at);

ALTER TABLE public.turath_masr_delegate_documents ENABLE ROW LEVEL SECURITY;

-- Read: same r1 + r3 group as Phase 23F's financial tables. r3
-- (shipping supervisor) needs to see if a delegate's documents are
-- on file but never to upload / replace.
DROP POLICY IF EXISTS documents_finance_reader_select ON public.turath_masr_delegate_documents;
CREATE POLICY documents_finance_reader_select
  ON public.turath_masr_delegate_documents
  FOR SELECT
  TO authenticated
  USING (public.is_delegate_finance_reader());

-- Write paths admin-only (r1) — matches the rest of the delegate
-- write surface (settlements, custody, expenses, profile edits).
DROP POLICY IF EXISTS documents_admin_insert ON public.turath_masr_delegate_documents;
CREATE POLICY documents_admin_insert
  ON public.turath_masr_delegate_documents
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS documents_admin_update ON public.turath_masr_delegate_documents;
CREATE POLICY documents_admin_update
  ON public.turath_masr_delegate_documents
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS documents_admin_delete ON public.turath_masr_delegate_documents;
CREATE POLICY documents_admin_delete
  ON public.turath_masr_delegate_documents
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

COMMENT ON TABLE public.turath_masr_delegate_documents IS
  'Phase 23I — metadata for delegate documents (national ID, '
  'licence scans, vehicle photos). File bytes live in the private '
  'storage bucket `delegate-documents`. Admin-only writes; r1+r3 '
  'read via is_delegate_finance_reader(). No public access.';


-- ─── 2) Storage bucket ─────────────────────────────────────────────────────
--
-- Private bucket. `public=false` ensures no anonymous access via the
-- raw `<supabase>/storage/v1/object/public/...` path. The page reads
-- objects via `createSignedUrl` after the policies below grant SELECT
-- to the requesting role.

INSERT INTO storage.buckets (id, name, public, created_at, updated_at)
VALUES ('delegate-documents', 'delegate-documents', false, now(), now())
ON CONFLICT (id) DO NOTHING;


-- ─── 3) Storage RLS policies ──────────────────────────────────────────────
--
-- Storage RLS lives on `storage.objects` and key off `bucket_id` plus
-- whichever helper / role we hand it. We scope every policy to the
-- new `delegate-documents` bucket so no other (current or future)
-- bucket inherits these grants by accident.

DROP POLICY IF EXISTS delegate_documents_storage_read ON storage.objects;
CREATE POLICY delegate_documents_storage_read
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'delegate-documents'
    AND public.is_delegate_finance_reader()
  );

DROP POLICY IF EXISTS delegate_documents_storage_insert ON storage.objects;
CREATE POLICY delegate_documents_storage_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'delegate-documents'
    AND public.is_admin()
  );

DROP POLICY IF EXISTS delegate_documents_storage_update ON storage.objects;
CREATE POLICY delegate_documents_storage_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'delegate-documents'
    AND public.is_admin()
  )
  WITH CHECK (
    bucket_id = 'delegate-documents'
    AND public.is_admin()
  );

DROP POLICY IF EXISTS delegate_documents_storage_delete ON storage.objects;
CREATE POLICY delegate_documents_storage_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'delegate-documents'
    AND public.is_admin()
  );


-- =============================================================================
-- POST-MIGRATION VERIFICATION (run manually after applying):
--
--   -- 1. Metadata table
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_schema='public'
--      AND table_name='turath_masr_delegate_documents'
--    ORDER BY ordinal_position;
--   -- expect: 14 columns
--
--   SELECT count(*) FROM public.turath_masr_delegate_documents;
--   -- expect: 0
--
--   -- 2. Bucket
--   SELECT id, name, public FROM storage.buckets WHERE id='delegate-documents';
--   -- expect: 1 row, public=false
--
--   -- 3. RLS policies
--   SELECT policyname, cmd FROM pg_policies
--    WHERE schemaname='public'
--      AND tablename='turath_masr_delegate_documents'
--    ORDER BY policyname;
--   -- expect: 4 policies — finance_reader_select + admin_insert/update/delete
--
--   SELECT policyname, cmd FROM pg_policies
--    WHERE schemaname='storage'
--      AND tablename='objects'
--      AND policyname LIKE 'delegate_documents_%'
--    ORDER BY policyname;
--   -- expect: 4 policies on storage.objects scoped to bucket_id
-- =============================================================================
