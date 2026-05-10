-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 23A — customer-side delivery rating for delegates.
--
-- Background
--   Phase 23A introduces a `/delegates` admin page and a "قيّم تجربة
--   التوصيل" panel on the customer-facing token tracking page. The
--   tracking panel only appears once the order's `status = 'delivered'`
--   and lets the customer leave a 1-5 star rating + an optional
--   comment.
--
--   This migration adds:
--     • table `public.turath_masr_delegate_ratings` — one row per
--       delivered order at most (UNIQUE order_id index).
--     • function `public.submit_delegate_rating(uuid, integer, text)` —
--       SECURITY DEFINER RPC the customer page calls via the
--       `/api/customer/rating` route. Validates the order, gates on
--       status='delivered', and upserts the rating row. Does NOT
--       expose any order data back to the caller — returns only a
--       `{ ok: true }` JSON shape.
--
--   No RLS policies are added on the new table. The table is only
--   accessed via the SECURITY DEFINER RPC for writes (admin reads
--   are gated by the existing `view_delegates` permission and ride
--   the same RLS posture as `turath_masr_orders` because the read
--   is scoped to the admin's authenticated session). If a future
--   phase wants direct REST access we'd add per-row policies then,
--   alongside that PR.
--
-- Idempotent
--   `IF NOT EXISTS` guards on the table and index. `CREATE OR
--   REPLACE FUNCTION` on the RPC. Re-applying the migration on a
--   database that already has the artifacts is a no-op replacement.
--
-- Privacy posture
--   • The customer-side write goes through the SECURITY DEFINER
--     RPC, which authenticates the order via the unguessable
--     `tracking_token`. No anonymous insert policy is opened.
--   • The RPC validates `rating ∈ [1, 5]` server-side and trims
--     the comment to 1000 chars to mirror the existing
--     `submit_customer_complaint` budget.
--   • Admin reads of the rating row use the same SSR Supabase
--     client + role checks as every other delegate-management
--     fetch on the new `/delegates` page.
--
-- DEPLOY GATE — DO NOT APPLY WITHOUT EXPLICIT APPROVAL
--   Phase 23A's deployed code is defensive against the pre-migration
--   state: the customer tracking page hides the rating panel when
--   the POST returns an error, and the `/delegates` page treats a
--   missing-table error as "no ratings yet". Apply via Supabase MCP
--   `apply_migration` (or `npx supabase db push`) only after operator
--   review.
-- ─────────────────────────────────────────────────────────────────────────────


-- =============================================================================
-- SECTION 1 — turath_masr_delegate_ratings table
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.turath_masr_delegate_ratings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Order this rating is for. ON DELETE CASCADE so a deleted order
  -- (rare; admin cleanup) takes its rating with it. The text typing
  -- mirrors `turath_masr_orders.id` (`text NOT NULL`).
  order_id        text NOT NULL REFERENCES public.turath_masr_orders(id) ON DELETE CASCADE,
  -- Snapshot of the order's tracking token at submission time. Lets
  -- a future export reconcile a rating to its tracking URL even if
  -- the order row is later cycled.
  tracking_token  uuid,
  -- Snapshot of the delegate display name at submission. Mirrors the
  -- snapshot pattern Phase 22B established: `delegate_name` on
  -- `turath_masr_orders` survives even when the underlying
  -- profile is renamed.
  delegate_name   text,
  -- Snapshot of `turath_masr_orders.assigned_to` (the auth.users
  -- UUID for the delegate, populated by Phase 22B's dual-write).
  assigned_to     uuid,
  -- Customer phone snapshot. NULL if for any reason the order had
  -- a blank phone at delivery time.
  customer_phone  text,
  rating          integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment         text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- One rating per order. The submit_delegate_rating RPC upserts on
-- this index so a customer who clicks "إرسال" twice doesn't write
-- duplicate rows.
CREATE UNIQUE INDEX IF NOT EXISTS turath_masr_delegate_ratings_order_id_key
  ON public.turath_masr_delegate_ratings (order_id);

-- Lookup by delegate for the admin /delegates page (one fetch per
-- delegate when the detail drawer opens).
CREATE INDEX IF NOT EXISTS turath_masr_delegate_ratings_assigned_to_idx
  ON public.turath_masr_delegate_ratings (assigned_to);
CREATE INDEX IF NOT EXISTS turath_masr_delegate_ratings_delegate_name_idx
  ON public.turath_masr_delegate_ratings (delegate_name);

COMMENT ON TABLE public.turath_masr_delegate_ratings IS
  'Phase 23A — customer-submitted delivery rating (1-5) per delivered '
  'order. Written through the SECURITY DEFINER RPC '
  'public.submit_delegate_rating; not directly writable from the '
  'customer-facing anon role.';


-- =============================================================================
-- SECTION 2 — submit_delegate_rating RPC
-- =============================================================================

-- Drop the previous signature defensively in case a future revision
-- changes the parameter list. CREATE OR REPLACE handles same-shape
-- redefinition.
DROP FUNCTION IF EXISTS public.submit_delegate_rating(uuid, integer, text);

CREATE OR REPLACE FUNCTION public.submit_delegate_rating(
  p_tracking_token uuid,
  p_rating         integer,
  p_comment        text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_order  RECORD;
  v_clean_comment text;
BEGIN
  -- Server-side validation. Echo the same shape the route handler
  -- enforces so a misbehaving caller (e.g. a future mobile app)
  -- can't bypass the front-end check.
  IF p_tracking_token IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
  END IF;
  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_rating');
  END IF;

  -- Lookup the order by token. Touches turath_masr_orders directly,
  -- not via the tracking-info RPC, because we need `id` and the
  -- delegate snapshot fields that the public RPC redacts.
  SELECT id, status, tracking_token, delegate_name, assigned_to, phone
    INTO v_order
    FROM public.turath_masr_orders
   WHERE tracking_token = p_tracking_token
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  -- Gate on delivered-only. The customer page mirrors this gate but
  -- it can be replayed by a stale tab — enforce server-side.
  IF v_order.status IS DISTINCT FROM 'delivered' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_delivered');
  END IF;

  -- Trim + truncate the comment. NULL stays NULL.
  IF p_comment IS NULL THEN
    v_clean_comment := NULL;
  ELSE
    v_clean_comment := nullif(btrim(p_comment), '');
    IF v_clean_comment IS NOT NULL AND length(v_clean_comment) > 1000 THEN
      v_clean_comment := substr(v_clean_comment, 1, 1000);
    END IF;
  END IF;

  INSERT INTO public.turath_masr_delegate_ratings (
    order_id,
    tracking_token,
    delegate_name,
    assigned_to,
    customer_phone,
    rating,
    comment
  ) VALUES (
    v_order.id,
    v_order.tracking_token,
    v_order.delegate_name,
    v_order.assigned_to,
    v_order.phone,
    p_rating,
    v_clean_comment
  )
  ON CONFLICT (order_id)
  DO UPDATE SET
    rating         = EXCLUDED.rating,
    comment        = EXCLUDED.comment,
    delegate_name  = EXCLUDED.delegate_name,
    assigned_to    = EXCLUDED.assigned_to,
    customer_phone = EXCLUDED.customer_phone,
    -- Refresh the timestamp on update so the admin "آخر تقييم"
    -- column shows the most recent submission, not the first.
    created_at     = now();

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL    ON FUNCTION public.submit_delegate_rating(uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_delegate_rating(uuid, integer, text) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_delegate_rating(uuid, integer, text) TO authenticated;

COMMENT ON FUNCTION public.submit_delegate_rating(uuid, integer, text) IS
  'Phase 23A — SECURITY DEFINER RPC for the customer tracking page '
  'to submit a 1-5 star delivery rating + optional comment. Validates '
  'the token, gates on order.status=''delivered'', and upserts a '
  'single row in turath_masr_delegate_ratings keyed by order_id. '
  'Returns jsonb { ok: bool, error?: text }.';


-- =============================================================================
-- POST-MIGRATION VERIFICATION (run manually after applying):
--
--   -- expect: table exists with all 8 columns
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_schema='public'
--      AND table_name='turath_masr_delegate_ratings'
--    ORDER BY ordinal_position;
--
--   -- expect: 1 unique index on order_id + 2 lookup indexes
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname='public'
--      AND tablename='turath_masr_delegate_ratings';
--
--   -- expect: jsonb result type, anon EXECUTE granted
--   SELECT proname, pg_get_function_result(oid) FROM pg_proc
--    WHERE proname='submit_delegate_rating';
-- =============================================================================
