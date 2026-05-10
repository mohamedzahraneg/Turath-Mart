-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 22P — surface the customer-relevant `return_reason` on the
-- public tracking timeline RPCs.
--
-- Background
--   StatusUpdateModal now writes the structured payload
--   `JSON.stringify({ reason?, note? })` into
--   `turath_masr_audit_logs.note` (Phase 22P client change). The
--   `reason` field carries the cancellation / return reason — the
--   piece of information a customer SHOULD see on
--   `/track/[order_num]` and `/track/t/[token]` when their order
--   ends up returned. The free-form `note` stays admin-only.
--
--   Phase 22H + Phase 13B's tracking-timeline RPCs hand-whitelist
--   the columns that leave the database, and they intentionally
--   redact the entire `note` column (along with `changed_by` and
--   `changed_by_role`) for privacy. To expose ONLY the structured
--   `reason` while keeping the rest of `note` locked away, this
--   migration drops + recreates both RPCs with a fourth column
--   `return_reason text` populated by extracting `"reason"` from
--   the JSON envelope when the status change is `returned`.
--
-- Why a regex extract instead of `note::jsonb ->> 'reason'`
--   `text::jsonb` raises an exception on invalid input, and a
--   non-trivial fraction of legacy rows hold plain free-form text in
--   the `note` column (Phase 22L and earlier). Using
--   `regexp_match(note, '"reason"\s*:\s*"((?:[^"\\]|\\.)*)"')` does a
--   best-effort extract that returns NULL for legacy plain-text
--   rows without throwing. Phase 22P's `buildAuditNote()` always
--   produces a well-formed `{"reason":"..."}` JSON object so the
--   regex captures cleanly for all newly-written rows.
--
--   The match group escapes both `\"` (escaped quote inside a JSON
--   string) and `\\` (literal backslash) so a reason containing
--   either character is preserved verbatim — the JSON encoder on
--   the client side guarantees those are the only forms requiring
--   escaping.
--
-- Privacy posture
--   The `note` column itself is NEVER returned by these RPCs. The
--   only addition is a single column that mirrors the structured
--   `reason` field, gated to status='returned' rows so a free-form
--   note that happens to match the regex on a non-return event
--   doesn't leak. `changed_by`, `changed_by_role`, and the
--   underlying `note` text remain redacted.
--
-- Idempotent
--   `DROP FUNCTION IF EXISTS` + `CREATE` is the standard pattern
--   for changing a `RETURNS TABLE` shape (PostgreSQL doesn't allow
--   `CREATE OR REPLACE` to redefine the row type). Running this
--   migration on a database that already has the new shape is a
--   no-op replacement that emits the same definition.
--
-- DEPLOY GATE — DO NOT APPLY WITHOUT EXPLICIT APPROVAL
--   Phase 22P's user-facing UI changes (modal layout, structured
--   note rendering in admin surfaces) are independent of this
--   migration and ship in the same PR. The migration itself adds
--   nothing visible until the customer pages start reading
--   `returnReason` from the timeline DTO. The page render code is
--   written to gracefully fall back when the field is absent
--   (legacy RPC), so this migration can be applied at any later
--   moment without a coordinated deploy. Apply via:
--     `npx supabase db push` or the Supabase MCP `apply_migration`
--   tool — only after operator review.
-- ─────────────────────────────────────────────────────────────────────────────


-- =============================================================================
-- SECTION 1 — get_tracking_timeline(text)
-- =============================================================================

DROP FUNCTION IF EXISTS public.get_tracking_timeline(text);

CREATE OR REPLACE FUNCTION public.get_tracking_timeline(p_order_num text)
  RETURNS TABLE (
    new_status      text,
    changed_at      timestamptz,
    -- Phase 22P — added column. NULL for non-returned events and
    -- for legacy rows whose `note` column doesn't carry the JSON
    -- envelope. Customer-facing tracking pages render this only
    -- when the surrounding step's status is `returned`.
    return_reason   text
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT
    a.new_value AS new_status,
    a.created_at AS changed_at,
    CASE
      WHEN a.new_value = 'returned' AND a.note IS NOT NULL THEN
        (regexp_match(a.note, '"reason"\s*:\s*"((?:[^"\\]|\\.)*)"'))[1]
      ELSE NULL
    END AS return_reason
  FROM public.turath_masr_audit_logs a
  WHERE a.order_num = p_order_num
    AND a.action = 'status_change'
    AND a.new_value IS NOT NULL
  ORDER BY a.created_at ASC
  LIMIT 100;
$$;

REVOKE ALL    ON FUNCTION public.get_tracking_timeline(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tracking_timeline(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_tracking_timeline(text) TO authenticated;

COMMENT ON FUNCTION public.get_tracking_timeline(text) IS
  'Phase 22P — public status timeline for an order. Returns '
  '`new_status`, `changed_at`, and a customer-safe `return_reason` '
  'extracted from the structured JSON `note` payload when the '
  'status change is `returned`. The free-form `note`, `changed_by` '
  'and `changed_by_role` columns remain redacted.';


-- =============================================================================
-- SECTION 2 — get_tracking_timeline_by_token(uuid)
-- =============================================================================

DROP FUNCTION IF EXISTS public.get_tracking_timeline_by_token(uuid);

CREATE OR REPLACE FUNCTION public.get_tracking_timeline_by_token(p_tracking_token uuid)
  RETURNS TABLE (
    new_status      text,
    changed_at      timestamptz,
    return_reason   text
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT
    a.new_value AS new_status,
    a.created_at AS changed_at,
    CASE
      WHEN a.new_value = 'returned' AND a.note IS NOT NULL THEN
        (regexp_match(a.note, '"reason"\s*:\s*"((?:[^"\\]|\\.)*)"'))[1]
      ELSE NULL
    END AS return_reason
  FROM public.turath_masr_audit_logs a
  JOIN public.turath_masr_orders   o ON o.order_num = a.order_num
  WHERE o.tracking_token = p_tracking_token
    AND a.action = 'status_change'
    AND a.new_value IS NOT NULL
  ORDER BY a.created_at ASC
  LIMIT 100;
$$;

REVOKE ALL    ON FUNCTION public.get_tracking_timeline_by_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tracking_timeline_by_token(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_tracking_timeline_by_token(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_tracking_timeline_by_token(uuid) IS
  'Phase 22P — UUID-keyed counterpart of '
  'public.get_tracking_timeline(text). Returns the same shape '
  'including a customer-safe `return_reason` extracted from the '
  'structured JSON `note` payload when the status change is '
  '`returned`. Free-form `note`, `changed_by`, and '
  '`changed_by_role` remain redacted.';


-- =============================================================================
-- POST-MIGRATION VERIFICATION (run manually after applying):
--
--   -- expect: timeline rows for an order that has a returned event
--   --         carry a populated return_reason; other events have NULL.
--   SELECT new_status, changed_at, return_reason
--     FROM public.get_tracking_timeline('ORDER-NUM-WITH-RETURN');
--
--   -- expect: same shape via the token RPC.
--   SELECT new_status, changed_at, return_reason
--     FROM public.get_tracking_timeline_by_token(
--       (SELECT tracking_token FROM public.turath_masr_orders
--        WHERE status = 'returned' LIMIT 1)
--     );
--
--   -- expect: the function signature carries the new column.
--   SELECT pg_get_function_result(oid)
--     FROM pg_proc
--    WHERE proname IN
--          ('get_tracking_timeline', 'get_tracking_timeline_by_token');
-- =============================================================================
