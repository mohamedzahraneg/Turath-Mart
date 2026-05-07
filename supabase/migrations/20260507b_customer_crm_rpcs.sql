-- =============================================================================
-- 20260507b_customer_crm_rpcs.sql
--
-- Phase 14 — Customer-side CRM submission RPCs.
--
-- Background
-- ----------
-- Phase 3 RLS hardening (20260505c) closed off public INSERT into:
--   - turath_masr_crm_chat
--   - turath_masr_crm_complaints
-- That was correct: the original "TO public WITH CHECK (true)" policies
-- were a public write surface anyone could spam/abuse. Tightening to
-- CRM staff (r1, r2, r5, r6) was the right call.
--
-- The side effect was that the customer-facing /track page lost its
-- ability to send chat messages or open complaints — those flows used
-- the browser's anon Supabase client to .insert() directly, which now
-- silently fails on RLS.
--
-- This migration adds two SECURITY DEFINER RPCs that the new
-- /api/customer/chat and /api/customer/complaints routes call. The RPCs:
--   - bypass RLS but ONLY allow INSERT into the corresponding table
--   - hard-pin sensitive fields server-side (sender='customer',
--     created_by='customer') so a misbehaving caller can't
--     impersonate staff
--   - validate inputs (phone format, message/subject length)
--   - return only the new row id — no other columns leak
--
-- This migration does NOT
--   - DROP / TRUNCATE / DELETE anything
--   - INSERT data
--   - modify any existing function
--   - touch the existing CRM-staff RLS policies
--   - change order or customer data
--
-- Rollback
-- --------
--   DROP FUNCTION IF EXISTS public.submit_customer_chat(text, text, text, text);
--   DROP FUNCTION IF EXISTS public.submit_customer_complaint(text, text, text);
-- (No data implications.)
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) submit_customer_chat
--
-- Returns the new chat row's UUID. Sender is hard-pinned to 'customer'
-- so the caller cannot impersonate a delegate or staff member.
--
-- Validation:
--   - customer_phone: required, length 5..32, digits/+/spaces only
--   - message:        required, length 1..2000 after trim
--   - chat_type:      optional; falls back to 'support'; whitelist
--   - order_id:       optional; max length 64
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.submit_customer_chat(
  p_customer_phone text,
  p_message        text,
  p_chat_type      text DEFAULT 'support',
  p_order_id       text DEFAULT NULL
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_phone text := btrim(coalesce(p_customer_phone, ''));
  v_msg   text := btrim(coalesce(p_message, ''));
  v_type  text := lower(btrim(coalesce(p_chat_type, 'support')));
  v_oid   text := nullif(btrim(coalesce(p_order_id, '')), '');
  v_id    uuid;
BEGIN
  IF length(v_phone) < 5 OR length(v_phone) > 32
     OR v_phone !~ '^[0-9+ ]+$' THEN
    RAISE EXCEPTION 'invalid_phone' USING ERRCODE = '22023';
  END IF;
  IF length(v_msg) = 0 OR length(v_msg) > 2000 THEN
    RAISE EXCEPTION 'invalid_message' USING ERRCODE = '22023';
  END IF;
  IF v_type NOT IN ('support', 'delegate') THEN
    v_type := 'support';
  END IF;
  IF v_oid IS NOT NULL AND length(v_oid) > 64 THEN
    RAISE EXCEPTION 'invalid_order_id' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.turath_masr_crm_chat
    (customer_phone, sender, message, chat_type, order_id)
  VALUES
    (v_phone, 'customer', v_msg, v_type, v_oid)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL    ON FUNCTION public.submit_customer_chat(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_customer_chat(text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_customer_chat(text, text, text, text) TO authenticated;

COMMENT ON FUNCTION public.submit_customer_chat(text, text, text, text) IS
  'Public-safe customer chat insertion. SECURITY DEFINER bypasses RLS but '
  'only writes to turath_masr_crm_chat with sender=''customer'' hard-pinned. '
  'Returns the new row id. Used by /api/customer/chat (Phase 14).';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2) submit_customer_complaint
--
-- Returns the new complaint row's UUID. created_by is hard-pinned to
-- 'customer' so the caller cannot pretend the row was opened by staff.
-- status defaults to 'open' (DB column default also 'open' — explicit
-- here for clarity and to avoid relying on the default if it changes).
--
-- Validation:
--   - customer_phone: required, length 5..32, digits/+/spaces only
--   - subject:        required, length 1..200 after trim
--   - notes:          optional, max length 2000 after trim
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.submit_customer_complaint(
  p_customer_phone text,
  p_subject        text,
  p_notes          text DEFAULT NULL
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_phone   text := btrim(coalesce(p_customer_phone, ''));
  v_subject text := btrim(coalesce(p_subject, ''));
  v_notes   text := nullif(btrim(coalesce(p_notes, '')), '');
  v_id      uuid;
BEGIN
  IF length(v_phone) < 5 OR length(v_phone) > 32
     OR v_phone !~ '^[0-9+ ]+$' THEN
    RAISE EXCEPTION 'invalid_phone' USING ERRCODE = '22023';
  END IF;
  IF length(v_subject) = 0 OR length(v_subject) > 200 THEN
    RAISE EXCEPTION 'invalid_subject' USING ERRCODE = '22023';
  END IF;
  IF v_notes IS NOT NULL AND length(v_notes) > 2000 THEN
    RAISE EXCEPTION 'invalid_notes' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.turath_masr_crm_complaints
    (customer_phone, subject, notes, status, created_by)
  VALUES
    (v_phone, v_subject, v_notes, 'open', 'customer')
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL    ON FUNCTION public.submit_customer_complaint(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_customer_complaint(text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_customer_complaint(text, text, text) TO authenticated;

COMMENT ON FUNCTION public.submit_customer_complaint(text, text, text) IS
  'Public-safe customer complaint insertion. SECURITY DEFINER bypasses RLS '
  'but only writes to turath_masr_crm_complaints with created_by=''customer'' '
  'and status=''open'' hard-pinned. Returns the new row id. Used by '
  '/api/customer/complaints (Phase 14).';

COMMIT;

-- =============================================================================
-- VERIFICATION (run AFTER applying)
--
--   -- expect: 2 rows (the new functions, both SECURITY DEFINER)
--   SELECT proname, prosecdef
--     FROM pg_proc
--    WHERE pronamespace = 'public'::regnamespace
--      AND proname IN ('submit_customer_chat', 'submit_customer_complaint');
--
--   -- expect: anon + authenticated have EXECUTE; PUBLIC does not
--   SELECT routine_name, grantee, privilege_type
--     FROM information_schema.routine_privileges
--    WHERE routine_schema = 'public'
--      AND routine_name IN ('submit_customer_chat', 'submit_customer_complaint')
--    ORDER BY routine_name, grantee;
--
--   -- smoke test (will create a real test row — clean up afterwards):
--   SELECT public.submit_customer_chat('01000000000', 'test ping', 'support', NULL);
--   -- should return a uuid
-- =============================================================================
