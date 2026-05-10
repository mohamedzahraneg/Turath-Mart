-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 23K — Order-scoped chat (additive).
--
-- Locks every customer-facing chat read AND write to a SINGLE order via
-- the tracking token, and adds a fast index for per-order queries that
-- the admin / shipping surfaces now run. The shape of
-- `turath_masr_crm_chat` is unchanged — the `order_id` column was added
-- in an earlier phase (Phase 14, customer chat) and is already populated
-- on every customer-side INSERT via `submit_customer_chat`.
--
-- What this migration adds
-- ------------------------
--   1. `turath_masr_crm_chat_order_chat_type_created_idx` —
--        composite index on (order_id, chat_type, created_at) used by
--        the new RPCs and by the admin Realtime filter.
--
--   2. `public.get_order_chat_by_token(p_tracking_token uuid,
--                                      p_chat_type text DEFAULT NULL,
--                                      p_limit integer DEFAULT 200)`
--        SECURITY DEFINER, GRANTed to anon + authenticated. Resolves
--        the tracking token to its order, then returns the last
--        `p_limit` chat rows where `order_id = order_num` and the
--        chat_type matches (NULL means both kinds). Returns the narrow
--        public-safe set (id, sender, message, created_at, chat_type)
--        — `customer_phone` is NEVER returned.
--
--   3. `public.submit_order_chat_by_token(p_tracking_token uuid,
--                                         p_message text,
--                                         p_chat_type text DEFAULT 'support')`
--        SECURITY DEFINER, GRANTed to anon + authenticated. Resolves
--        the token, derives `customer_phone` + `order_id` from the
--        order row, hard-pins `sender='customer'`, runs the same
--        defense-in-depth checks as Phase 14A's `submit_customer_chat`
--        (length, exact-duplicate window, per-phone + global rate),
--        then inserts the chat row. Returns the new row id.
--
-- What this migration does NOT do
-- -------------------------------
--   • Does NOT touch RLS on `turath_masr_crm_chat`. The existing
--     SELECT / INSERT / DELETE policies (r1, r2, r5, r6 for read/write;
--     r1 for delete) remain the only authenticated surface. Customer
--     access continues to flow exclusively through SECURITY DEFINER
--     RPCs; delegate / shipping access continues under the existing
--     authenticated SELECT policy and reaches order-level scope by
--     filtering on `order_id` in the query (the UI changes do this).
--   • Does NOT change column types or add foreign keys. The `order_id`
--     column stays `text NULL` so it can hold either the `order_num`
--     ("TUR-XXXX") or a future UUID without a migration.
--   • Does NOT change `submit_customer_chat` — the Phase 14 path that
--     takes an explicit phone+message remains available for callers
--     that don't have a tracking token (admin tooling / tests).
--
-- Safety properties
-- -----------------
--   • CREATE INDEX IF NOT EXISTS — additive, idempotent
--   • CREATE OR REPLACE FUNCTION — idempotent on re-run
--   • SECURITY DEFINER + REVOKE PUBLIC + explicit GRANTs — no
--     accidental privilege escalation
--   • Functions SET search_path = public — defends against
--     `search_path` shadowing attacks (matches Phase 14A pattern)
--   • No DROP / TRUNCATE / DELETE
--   • Re-runnable in any environment
--
-- DEPLOY GATE — DO NOT APPLY WITHOUT EXPLICIT APPROVAL
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;


-- ─── 1) Order-scoped index ───────────────────────────────────────────────
--
-- The new admin / shipping / customer surfaces all query the chat by
-- `order_id` first, then by `chat_type`, ordered by `created_at`. The
-- existing `idx_crm_chat_phone_created` (phone, created_at DESC) is
-- still the right index for the legacy phone-scoped CRM page.

CREATE INDEX IF NOT EXISTS turath_masr_crm_chat_order_chat_type_created_idx
  ON public.turath_masr_crm_chat (order_id, chat_type, created_at)
  WHERE order_id IS NOT NULL;


-- ─── 2) get_order_chat_by_token ─────────────────────────────────────────
--
-- Customer read path. Pure SELECT. SECURITY DEFINER bypasses RLS so an
-- anonymous browser session can fetch its own order's chat WITHOUT
-- gaining any other read surface on `turath_masr_crm_chat`.
--
-- Token gate
-- ----------
-- The tracking token is a UUID generated server-side per order. It is
-- 122 bits of entropy; an attacker who doesn't know it cannot guess it.
-- We resolve the token strictly — no LIKE / no fuzzy match — and bail
-- out with an empty SETOF if the token is unknown.
--
-- chat_type semantics
-- -------------------
-- The chat table currently uses two chat_type tokens:
--   'support'   — customer ↔ CRM / support staff
--   'delegate'  — customer ↔ delegate (operationally, the staff member
--                 acting on the delegate's behalf via the shipping page)
-- p_chat_type = NULL means "both" (one merged thread); passing a
-- specific token narrows it. We keep the threading optional so the
-- /track/t/[token] page can render the two as separate tabs OR a
-- single merged history without another round-trip.

CREATE OR REPLACE FUNCTION public.get_order_chat_by_token(
  p_tracking_token uuid,
  p_chat_type      text DEFAULT NULL,
  p_limit          integer DEFAULT 200
)
  RETURNS TABLE (
    id         uuid,
    sender     text,
    message    text,
    chat_type  text,
    created_at timestamptz
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_order_num text;
  v_type      text := NULLIF(btrim(coalesce(p_chat_type, '')), '');
  v_limit     integer := GREATEST(1, LEAST(coalesce(p_limit, 200), 500));
BEGIN
  -- Resolve token to the canonical order_num used as `order_id` on
  -- chat rows. We pick `order_num` (not `id`) because the customer-side
  -- writer (`submit_customer_chat` / `submit_order_chat_by_token`)
  -- stores `order_num` in `order_id`.
  SELECT order_num
    INTO v_order_num
    FROM public.turath_masr_orders
   WHERE tracking_token = p_tracking_token
   LIMIT 1;

  -- Unknown / expired token → empty set, NEVER raise. Mirrors the
  -- behaviour of `get_tracking_info_by_token` so the customer page
  -- can render its "order not found" branch off a single fetch.
  IF v_order_num IS NULL THEN
    RETURN;
  END IF;

  -- Whitelist chat_type. Anything outside the allow-list falls back to
  -- "both" rather than raising, so a typo in the param doesn't crash
  -- the customer page.
  IF v_type IS NOT NULL AND v_type NOT IN ('support', 'delegate') THEN
    v_type := NULL;
  END IF;

  RETURN QUERY
    SELECT c.id,
           c.sender,
           c.message,
           c.chat_type,
           c.created_at
      FROM public.turath_masr_crm_chat c
     WHERE c.order_id = v_order_num
       AND (v_type IS NULL OR c.chat_type = v_type)
     ORDER BY c.created_at ASC
     LIMIT v_limit;
END;
$$;

REVOKE ALL    ON FUNCTION public.get_order_chat_by_token(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_order_chat_by_token(uuid, text, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.get_order_chat_by_token(uuid, text, integer) TO authenticated;

COMMENT ON FUNCTION public.get_order_chat_by_token(uuid, text, integer) IS
  'Phase 23K — public-safe order-scoped chat read. SECURITY DEFINER. '
  'Resolves tracking_token to order_num, returns the last N chat rows '
  'with order_id = order_num and (optional) chat_type filter. Never '
  'returns customer_phone. Unknown token => empty set.';


-- ─── 3) submit_order_chat_by_token ──────────────────────────────────────
--
-- Customer write path. Drop-in replacement for the legacy "ask the
-- customer to retype their phone" flow on /track/t/[token]: the token
-- already proves access to the order, so we trust it as the source of
-- both `customer_phone` and `order_id`. Sender is hard-pinned to
-- 'customer' so the caller cannot impersonate staff.
--
-- Defense-in-depth (mirrors Phase 14A `submit_customer_chat`)
-- ----------------------------------------------------------
--   • message presence + length cap (1000)
--   • chat_type whitelist (support / delegate), default 'support'
--   • exact-duplicate window (same phone + same message body in 2 min)
--   • per-phone rate limit (5 customer-sent rows in 10 min)
--   • global cap (120 customer-sent rows in 10 min)
--
-- All limits are charged against the order's resolved phone — token
-- enumeration would still get blocked by the global cap.

CREATE OR REPLACE FUNCTION public.submit_order_chat_by_token(
  p_tracking_token uuid,
  p_message        text,
  p_chat_type      text DEFAULT 'support'
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_phone     text;
  v_order_num text;
  v_msg       text := btrim(coalesce(p_message, ''));
  v_type      text := lower(btrim(coalesce(p_chat_type, 'support')));
  v_id        uuid;
  v_dup_count       integer;
  v_per_phone_count integer;
  v_global_count    integer;
BEGIN
  -- Resolve the token. Unknown / expired token → invalid_token (a new
  -- error code so the caller can branch on it specifically rather than
  -- a generic invalid_input).
  SELECT phone, order_num
    INTO v_phone, v_order_num
    FROM public.turath_masr_orders
   WHERE tracking_token = p_tracking_token
   LIMIT 1;

  IF v_phone IS NULL OR v_order_num IS NULL THEN
    RAISE EXCEPTION 'invalid_token' USING ERRCODE = '22023';
  END IF;

  -- Normalise the resolved phone the same way Phase 14A normalises
  -- caller-supplied phone, so the rate-limit bucket lines up exactly
  -- with the existing customer chat path.
  v_phone := regexp_replace(coalesce(v_phone, ''), '\s+', '', 'g');

  -- Sanity-check the resolved phone — if an order row has somehow
  -- accumulated a malformed phone we don't want to insert a chat row
  -- the legacy CRM page can't address.
  IF length(v_phone) < 5 OR length(v_phone) > 32 OR v_phone !~ '^[+]?[0-9]+$' THEN
    RAISE EXCEPTION 'invalid_phone' USING ERRCODE = '22023';
  END IF;

  -- Message presence + length cap (1000) — same as Phase 14A.
  IF length(v_msg) = 0 THEN
    RAISE EXCEPTION 'empty_message' USING ERRCODE = '22023';
  END IF;
  IF length(v_msg) > 1000 THEN
    RAISE EXCEPTION 'message_too_long' USING ERRCODE = '22023';
  END IF;

  -- Chat type fallback (non-whitelisted → 'support')
  IF v_type NOT IN ('support', 'delegate') THEN
    v_type := 'support';
  END IF;

  -- Exact-duplicate window: same phone + same body in the last 2 min.
  SELECT count(*) INTO v_dup_count
    FROM public.turath_masr_crm_chat
   WHERE customer_phone = v_phone
     AND sender         = 'customer'
     AND message        = v_msg
     AND created_at >= now() - interval '2 minutes';

  IF v_dup_count > 0 THEN
    RAISE EXCEPTION 'duplicate_submission' USING ERRCODE = '54000';
  END IF;

  -- Per-phone rate limit: 5 customer-sent chat rows per 10 minutes.
  SELECT count(*) INTO v_per_phone_count
    FROM public.turath_masr_crm_chat
   WHERE customer_phone = v_phone
     AND sender         = 'customer'
     AND created_at >= now() - interval '10 minutes';

  IF v_per_phone_count >= 5 THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = '54000';
  END IF;

  -- Global safety cap: 120 customer-sent chat rows per 10 minutes.
  SELECT count(*) INTO v_global_count
    FROM public.turath_masr_crm_chat
   WHERE sender = 'customer'
     AND created_at >= now() - interval '10 minutes';

  IF v_global_count >= 120 THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.turath_masr_crm_chat
    (customer_phone, sender, message, chat_type, order_id)
  VALUES
    (v_phone, 'customer', v_msg, v_type, v_order_num)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL    ON FUNCTION public.submit_order_chat_by_token(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_order_chat_by_token(uuid, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_order_chat_by_token(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.submit_order_chat_by_token(uuid, text, text) IS
  'Phase 23K — public-safe order-scoped chat write. SECURITY DEFINER. '
  'Resolves tracking_token to (phone, order_num), hard-pins '
  'sender=''customer'', applies Phase 14A rate / duplicate / length '
  'limits, inserts the row, returns new id. Customer never re-enters '
  'phone — the token is the access proof.';


COMMIT;


-- =============================================================================
-- POST-MIGRATION VERIFICATION (run manually after applying):
--
--   -- 1. Index in place
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname='public'
--      AND tablename='turath_masr_crm_chat'
--    ORDER BY indexname;
--   -- expect: idx_crm_chat_phone_created + turath_masr_crm_chat_order_chat_type_created_idx
--
--   -- 2. Function signatures + privileges
--   SELECT proname,
--          pg_get_function_identity_arguments(oid) AS args,
--          has_function_privilege('anon',          oid, 'EXECUTE') AS anon_exec,
--          has_function_privilege('authenticated', oid, 'EXECUTE') AS auth_exec
--     FROM pg_proc
--    WHERE pronamespace = 'public'::regnamespace
--      AND proname IN ('get_order_chat_by_token','submit_order_chat_by_token')
--    ORDER BY proname;
--   -- expect: both rows, anon_exec=true, auth_exec=true
--
--   -- 3. Smoke read for a known order
--   --     SELECT * FROM public.get_order_chat_by_token('<some_token>'::uuid);
--
--   -- 4. Smoke write for a known order
--   --     SELECT public.submit_order_chat_by_token('<some_token>'::uuid,
--   --                                              'P23K_TEST', 'support');
--   --     -- expect: a uuid back
--   --     -- repeat within 2min: expect duplicate_submission
--
--   -- 5. Cleanup test rows
--   --     DELETE FROM public.turath_masr_crm_chat
--   --      WHERE message LIKE 'P23K_TEST%' AND sender='customer';
-- =============================================================================
