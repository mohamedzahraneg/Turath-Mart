-- 1. FIX: Allow public access to CRM complaints (so customers can submit them)
ALTER TABLE public.turath_masr_crm_complaints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_insert_complaints" ON public.turath_masr_crm_complaints;
CREATE POLICY "public_insert_complaints"
  ON public.turath_masr_crm_complaints
  FOR INSERT
  TO public
  WITH CHECK (true);

DROP POLICY IF EXISTS "public_read_complaints" ON public.turath_masr_crm_complaints;
CREATE POLICY "public_read_complaints"
  ON public.turath_masr_crm_complaints
  FOR SELECT
  TO public
  USING (true);

-- 2. FIX: Allow public access to CRM chat (so customers can communicate)
ALTER TABLE public.turath_masr_crm_chat ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_insert_chat" ON public.turath_masr_crm_chat;
CREATE POLICY "public_insert_chat"
  ON public.turath_masr_crm_chat
  FOR INSERT
  TO public
  WITH CHECK (true);

DROP POLICY IF EXISTS "public_read_chat" ON public.turath_masr_crm_chat;
CREATE POLICY "public_read_chat"
  ON public.turath_masr_crm_chat
  FOR SELECT
  TO public
  USING (true);

-- 3. Ensure Real-time is enabled for these tables
BEGIN;
  -- Add to publication if not already there
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'turath_masr_crm_chat') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE turath_masr_crm_chat;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'turath_masr_crm_complaints') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE turath_masr_crm_complaints;
    END IF;
  END $$;
COMMIT;
