-- =============================================================================
-- Migration: Tracking RPCs that look up by tracking_token (UUID)
-- Date: 2026-05-07 (runs after 20260507_add_tracking_token.sql)
-- Phase: 13A — DB only. No app code changes in this migration.
-- =============================================================================
--
-- Purpose:
--   Add UUID-based counterparts to the existing text/order_num RPCs:
--     - get_tracking_info(text)        → keeps working unchanged
--     - get_tracking_timeline(text)    → keeps working unchanged
--     - get_tracking_info_by_token(uuid)        ← NEW
--     - get_tracking_timeline_by_token(uuid)    ← NEW
--
--   Both new functions return EXACTLY the same redacted DTO as the
--   existing text functions. They never expose any of:
--     phone, phone2, address, total, subtotal, shipping_fee, notes,
--     extra_shipping_fee, district, customer, ip, created_by_*,
--     delegate_name, assigned_to, lines (which contains prices).
--
-- Safety properties:
--   - Idempotent: CREATE OR REPLACE FUNCTION on every function.
--   - Non-destructive: no DROP / TRUNCATE / DELETE / data INSERT.
--   - The pre-existing RPC `get_tracking_info(text)` is NOT modified
--     and is NOT dropped — backward compatibility for /track/[orderId]
--     and /api/track/[orderId] is preserved.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 1: get_tracking_info_by_token(uuid)
--
-- Mirrors the column projection of public.get_tracking_info(text), but
-- looks up by the new tracking_token UUID. SECURITY DEFINER bypasses RLS
-- because the projection is hand-curated to non-PII columns only.
--
-- PII / internal columns intentionally omitted (must NEVER be added
-- without security review):
--   customer, phone, phone2, address, district, subtotal, shipping_fee,
--   extra_shipping_fee, total, notes, ip, created_by, created_by_ip,
--   created_by_location, created_by_device, created_by_user_id,
--   delegate_name, assigned_to, updated_by, lines (contains prices),
--   tracking_token (the input — leaking it back is pointless and would
--                   make any client log of the response a token store).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_tracking_info_by_token(p_tracking_token uuid)
  RETURNS TABLE (
    order_num   text,
    status      text,
    region      text,        -- governorate only — district is NOT returned
    products    text,        -- product summary string (no prices)
    quantity    integer,
    warranty    text,
    "date"      text,
    created_at  timestamptz,
    updated_at  timestamptz
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT
    o.order_num,
    o.status,
    o.region,
    o.products,
    o.quantity,
    o.warranty,
    o.date,
    o.created_at,
    o.updated_at
  FROM public.turath_masr_orders o
  WHERE o.tracking_token = p_tracking_token
  LIMIT 1;
$$;

REVOKE ALL    ON FUNCTION public.get_tracking_info_by_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tracking_info_by_token(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_tracking_info_by_token(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_tracking_info_by_token(uuid) IS
  'UUID-keyed counterpart of public.get_tracking_info(text). Returns the '
  'same redacted, non-PII DTO for the customer-facing /track page. '
  'SECURITY DEFINER bypasses RLS but only returns hand-whitelisted '
  'columns. Granted to anon so the public tracking page can call it '
  'without auth.';


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 2: get_tracking_timeline_by_token(uuid)
--
-- Mirrors public.get_tracking_timeline(text). Joins audit logs to orders
-- on order_num so we can filter by tracking_token. Returns ONLY the
-- minimum needed for a public timeline — no `changed_by`, no `note`.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_tracking_timeline_by_token(p_tracking_token uuid)
  RETURNS TABLE (
    new_status  text,
    changed_at  timestamptz
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT
    a.new_value AS new_status,
    a.created_at AS changed_at
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
  'UUID-keyed counterpart of public.get_tracking_timeline(text). Returns '
  'the status-change timeline for an order without leaking any '
  'changed_by / changed_by_role / note fields. Public-safe.';


-- =============================================================================
-- POST-MIGRATION VERIFICATION (run manually after applying):
--
--   -- expect: one row matching the order
--   SELECT * FROM public.get_tracking_info_by_token(
--     (SELECT tracking_token FROM public.turath_masr_orders LIMIT 1)
--   );
--
--   -- expect: zero rows for a random/unknown token
--   SELECT * FROM public.get_tracking_info_by_token(gen_random_uuid());
--
--   -- expect: timeline rows ordered by changed_at ASC, max 100
--   SELECT * FROM public.get_tracking_timeline_by_token(
--     (SELECT tracking_token FROM public.turath_masr_orders LIMIT 1)
--   );
--
--   -- expect: anon + authenticated have EXECUTE; PUBLIC does not.
--   SELECT grantee, privilege_type
--     FROM information_schema.routine_privileges
--    WHERE routine_schema = 'public'
--      AND routine_name   = 'get_tracking_info_by_token';
-- =============================================================================
