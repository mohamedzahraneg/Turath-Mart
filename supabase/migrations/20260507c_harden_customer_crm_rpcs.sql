-- =============================================================================
-- 20260507c_harden_customer_crm_rpcs.sql
--
-- Phase 14A — Hardening for the customer CRM RPCs added in 20260507b.
--
-- Why this exists
-- ---------------
-- The Phase 14 RPCs (`submit_customer_chat`, `submit_customer_complaint`)
-- are GRANTed EXECUTE to anon. That makes them callable directly via
-- Supabase's PostgREST without going through any of our API routes —
-- the route is a friendly wrapper, not a security boundary.
--
-- Phase 14 (20260507b) covered input shape (length, phone format, hard-
-- pinned sender/created_by). It did NOT cover abuse vectors that can be
-- mounted directly against the RPC:
--   - one phone hammering the chat with hundreds of messages/min
--   - global flood of complaint rows from any single source
--   - the same exact message submitted again and again (refresh-spam)
--
-- This migration tightens the two functions in three ways while
-- KEEPING the same signatures (callers do not change):
--   1. Per-phone rate limit
--   2. Global safety cap
--   3. Exact-duplicate protection (same phone + same body in a short
--      window)
--
-- Limits chosen
-- -------------
-- chat:
--   - per-phone: ≤ 5 customer-sent messages per 10 minutes
--   - global:    ≤ 120 customer-sent messages per 10 minutes
--   - duplicate: same phone + same message within 2 minutes ⇒ reject
--   - max message length tightened: 2000 → 1000
--
-- complaints:
--   - per-phone: ≤ 3 customer-sent complaints per 1 hour
--   - global:    ≤ 60 customer-sent complaints per 1 hour
--   - duplicate: same phone + same subject within 10 minutes ⇒ reject
--   - max subject length tightened: 200 → 120
--   - notes max stays at 2000
--
-- Why per-phone is rate-limited even though phone is user-controlled:
-- the goal is friction against accidental refresh-spam and naive abuse,
-- not bullet-proof DDoS protection. Real DDoS / IP-based throttling
-- belongs at the edge (CDN / nginx) and is out of scope here.
--
-- Phone normalization
-- -------------------
-- The previous regex `^[0-9+ ]+$` treated "010 1234" and "0101234" as
-- two different phones for any future lookup. We now strip all
-- whitespace before storing/comparing so refresh-spam or copy-paste
-- variations consistently hit the same per-phone bucket.
--
-- Error contract (kept generic)
-- -----------------------------
--   invalid_phone           – malformed phone after normalization
--   empty_message           – chat message is empty
--   empty_subject           – complaint subject is empty
--   message_too_long        – chat message > 1000 chars
--   subject_too_long        – complaint subject > 120 chars
--   notes_too_long          – complaint notes > 2000 chars
--   invalid_order_id        – chat order_id > 64 chars
--   rate_limited            – per-phone OR global cap exceeded
--   duplicate_submission    – exact-duplicate submission detected
--
-- All raised with USING ERRCODE so the API layer can branch cleanly.
-- ERRCODE choice:
--   '22023' – invalid_parameter_value  (validation errors)
--   '54000' – program_limit_exceeded   (rate limits + duplicates)
--
-- Safety properties
-- -----------------
-- - CREATE OR REPLACE FUNCTION only — no schema changes
-- - CREATE INDEX IF NOT EXISTS — additive, safe
-- - No DROP / TRUNCATE / DELETE
-- - No CREATE / ALTER POLICY
-- - No row in turath_masr_orders / customers / profiles is touched
-- - Re-running this migration is a no-op (CREATE OR REPLACE / IF NOT
--   EXISTS) — idempotent
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 14A.1 — Indexes that make the rate-limit / duplicate window
-- queries cheap. Both are simple b-tree composites, additive only.
-- The IF NOT EXISTS guard makes them safe on a re-run.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_crm_chat_phone_created
  ON public.turath_masr_crm_chat (customer_phone, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_crm_complaints_phone_created
  ON public.turath_masr_crm_complaints (customer_phone, created_at DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 14A.2 — Hardened submit_customer_chat
--
-- Same signature as 20260507b: (text, text, text, text) → uuid
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
  -- Normalize: strip ALL whitespace from phone so "010 1234" and
  -- "0101234" land in the same per-phone bucket. Then validate.
  v_phone text := regexp_replace(coalesce(p_customer_phone, ''), '\s+', '', 'g');
  v_msg   text := btrim(coalesce(p_message, ''));
  v_type  text := lower(btrim(coalesce(p_chat_type, 'support')));
  v_oid   text := nullif(btrim(coalesce(p_order_id, '')), '');
  v_id    uuid;
  v_per_phone_count integer;
  v_global_count    integer;
  v_dup_count       integer;
BEGIN
  -- Phone shape: 5..32 chars, digits and an optional leading '+' only
  -- after whitespace stripping. Reject anything else.
  IF length(v_phone) < 5 OR length(v_phone) > 32 OR v_phone !~ '^[+]?[0-9]+$' THEN
    RAISE EXCEPTION 'invalid_phone' USING ERRCODE = '22023';
  END IF;

  -- Message presence + length cap (1000)
  IF length(v_msg) = 0 THEN
    RAISE EXCEPTION 'empty_message' USING ERRCODE = '22023';
  END IF;
  IF length(v_msg) > 1000 THEN
    RAISE EXCEPTION 'message_too_long' USING ERRCODE = '22023';
  END IF;

  -- Chat type fallback to 'support' for any non-whitelisted value
  IF v_type NOT IN ('support', 'delegate') THEN
    v_type := 'support';
  END IF;

  -- Order id length
  IF v_oid IS NOT NULL AND length(v_oid) > 64 THEN
    RAISE EXCEPTION 'invalid_order_id' USING ERRCODE = '22023';
  END IF;

  -- Duplicate protection: same normalized phone + same message body in
  -- the last 2 minutes. Catches refresh-spam and double-clicks.
  SELECT count(*) INTO v_dup_count
  FROM public.turath_masr_crm_chat
  WHERE customer_phone = v_phone
    AND sender = 'customer'
    AND message = v_msg
    AND created_at >= now() - interval '2 minutes';

  IF v_dup_count > 0 THEN
    RAISE EXCEPTION 'duplicate_submission' USING ERRCODE = '54000';
  END IF;

  -- Per-phone rate limit: max 5 customer-sent chat messages / 10 min
  SELECT count(*) INTO v_per_phone_count
  FROM public.turath_masr_crm_chat
  WHERE customer_phone = v_phone
    AND sender = 'customer'
    AND created_at >= now() - interval '10 minutes';

  IF v_per_phone_count >= 5 THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = '54000';
  END IF;

  -- Global safety cap: max 120 customer-sent chat rows / 10 min across
  -- the entire system. Defends against multi-phone fan-out spam.
  SELECT count(*) INTO v_global_count
  FROM public.turath_masr_crm_chat
  WHERE sender = 'customer'
    AND created_at >= now() - interval '10 minutes';

  IF v_global_count >= 120 THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = '54000';
  END IF;

  -- All checks passed — insert.
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
  'Public-safe customer chat insertion (Phase 14A hardened). '
  'SECURITY DEFINER bypasses RLS; sender=''customer'' hard-pinned. '
  'Enforces phone allow-list, msg length ≤ 1000, per-phone 5/10min, '
  'global 120/10min, exact-duplicate window 2min. Returns new row id.';


-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 14A.3 — Hardened submit_customer_complaint
--
-- Same signature as 20260507b: (text, text, text) → uuid
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
  v_phone   text := regexp_replace(coalesce(p_customer_phone, ''), '\s+', '', 'g');
  v_subject text := btrim(coalesce(p_subject, ''));
  v_notes   text := nullif(btrim(coalesce(p_notes, '')), '');
  v_id      uuid;
  v_per_phone_count integer;
  v_global_count    integer;
  v_dup_count       integer;
BEGIN
  IF length(v_phone) < 5 OR length(v_phone) > 32 OR v_phone !~ '^[+]?[0-9]+$' THEN
    RAISE EXCEPTION 'invalid_phone' USING ERRCODE = '22023';
  END IF;

  IF length(v_subject) = 0 THEN
    RAISE EXCEPTION 'empty_subject' USING ERRCODE = '22023';
  END IF;
  IF length(v_subject) > 120 THEN
    RAISE EXCEPTION 'subject_too_long' USING ERRCODE = '22023';
  END IF;

  IF v_notes IS NOT NULL AND length(v_notes) > 2000 THEN
    RAISE EXCEPTION 'notes_too_long' USING ERRCODE = '22023';
  END IF;

  -- Duplicate protection: same phone + same subject in the last 10 min.
  -- We compare on subject only (notes is optional and may legitimately
  -- be amended on a re-submit).
  SELECT count(*) INTO v_dup_count
  FROM public.turath_masr_crm_complaints
  WHERE customer_phone = v_phone
    AND subject = v_subject
    AND created_by = 'customer'
    AND created_at >= now() - interval '10 minutes';

  IF v_dup_count > 0 THEN
    RAISE EXCEPTION 'duplicate_submission' USING ERRCODE = '54000';
  END IF;

  -- Per-phone rate limit: max 3 customer-opened complaints / 1 hour
  SELECT count(*) INTO v_per_phone_count
  FROM public.turath_masr_crm_complaints
  WHERE customer_phone = v_phone
    AND created_by = 'customer'
    AND created_at >= now() - interval '1 hour';

  IF v_per_phone_count >= 3 THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = '54000';
  END IF;

  -- Global safety cap: max 60 customer-opened complaints / 1 hour
  SELECT count(*) INTO v_global_count
  FROM public.turath_masr_crm_complaints
  WHERE created_by = 'customer'
    AND created_at >= now() - interval '1 hour';

  IF v_global_count >= 60 THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = '54000';
  END IF;

  -- All checks passed — insert.
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
  'Public-safe customer complaint insertion (Phase 14A hardened). '
  'SECURITY DEFINER bypasses RLS; created_by=''customer''/status=''open'' '
  'hard-pinned. Enforces phone allow-list, subject ≤ 120, notes ≤ 2000, '
  'per-phone 3/hour, global 60/hour, exact-duplicate window 10min. '
  'Returns new row id.';

COMMIT;

-- =============================================================================
-- VERIFICATION (run AFTER applying — see /tmp/p14a-sql/verify_*.sql)
--
--   -- expect 1: a valid call returns a uuid
--   SELECT public.submit_customer_chat('01099999999','HARDEN_TEST','support',NULL);
--
--   -- expect 2: the SAME call within 2 minutes raises duplicate_submission
--   SELECT public.submit_customer_chat('01099999999','HARDEN_TEST','support',NULL);
--
--   -- expect 3: malformed phone raises invalid_phone
--   SELECT public.submit_customer_chat('abc','HARDEN_TEST','support',NULL);
--
--   -- expect 4: too-long message raises message_too_long
--   SELECT public.submit_customer_chat('01088888888', repeat('x', 1001), 'support', NULL);
--
--   -- expect 5: empty message raises empty_message
--   SELECT public.submit_customer_chat('01088888888', '', 'support', NULL);
--
--   -- expect 6: 6th call within 10 minutes from a single phone raises rate_limited
--   -- (run 5 valid distinct messages first, then a 6th)
--
--   -- afterwards: clean up test rows
--   DELETE FROM public.turath_masr_crm_chat
--    WHERE message LIKE 'HARDEN_TEST%' AND sender='customer';
--   DELETE FROM public.turath_masr_crm_complaints
--    WHERE subject LIKE 'HARDEN_TEST%' AND created_by='customer';
-- =============================================================================
