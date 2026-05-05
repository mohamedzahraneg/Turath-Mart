-- =============================================================================
-- Migration: Secure customer-tracking RPC + status-change notification trigger
-- Date: 2026-05-06 (runs after 20260505c_fix_public_rls_exposure.sql)
-- =============================================================================
--
-- Two coupled changes:
--
-- (A) public.get_tracking_info(p_order_num text)
--     SECURITY DEFINER function that returns ONLY non-PII columns from
--     turath_masr_orders. Replaces the direct `select * from
--     turath_masr_orders` that the customer-facing tracking page used to
--     do — that path is now blocked by orders_authenticated_select.
--
-- (B) AFTER UPDATE OF status trigger on turath_masr_orders
--     Auto-inserts a row in turath_masr_notifications when an order's
--     status changes. Runs as SECURITY DEFINER so the new RLS policy
--     `notifications_managers_insert` (which blocks r4 + r6) does not
--     break the notification side-effect that StatusUpdateModal +
--     CRM page used to fire from the client.
--
-- After these two pieces are in place, the application can be migrated to:
--   - fetch tracking data via the API route (which calls the RPC)
--   - rely on the DB trigger for status-change notifications
--   - drop the per-component `supabase.from('turath_masr_notifications').
--     insert(...)` calls that fail under the strict RLS.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 1: Tracking RPC
--
-- Returns a strict, hand-curated set of columns. NEVER add the columns
-- listed in the "PII / internal" comment without security review.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_tracking_info(p_order_num text)
  RETURNS TABLE (
    order_num   text,
    status      text,
    region      text,        -- governorate only — district is intentionally NOT returned
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
  -- PII / internal columns intentionally omitted from the projection:
  --   customer, phone, phone2, address, district, subtotal, shipping_fee,
  --   extra_shipping_fee, total, notes, ip, created_by, created_by_ip,
  --   created_by_location, created_by_device, created_by_user_id,
  --   delegate_name, assigned_to, updated_by, lines (contains prices)
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
  WHERE o.order_num = p_order_num
  LIMIT 1;
$$;

REVOKE ALL    ON FUNCTION public.get_tracking_info(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tracking_info(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_tracking_info(text) TO authenticated;

COMMENT ON FUNCTION public.get_tracking_info(text) IS
  'Returns a redacted DTO for the customer-facing /track/[orderId] page. '
  'SECURITY DEFINER bypasses RLS but only returns non-PII columns. '
  'Granted to anon so the public tracking page can call it without auth.';


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 2: Public status-timeline RPC (no audit-log internals)
--
-- The /track page used to read turath_masr_audit_logs directly to build a
-- status timeline. That table now requires authenticated access. We expose
-- only the minimum needed for a public timeline: the status changes plus
-- their timestamps. No `changed_by`, no `changed_by_role`, no `note`.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_tracking_timeline(p_order_num text)
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
  'Returns the status-change timeline for an order without leaking any '
  '`changed_by` / `changed_by_role` / `note` fields. Public-safe.';


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 3: Status-change notification trigger
--
-- After Phase 2 RLS, `notifications_managers_insert` only allows
-- r1/r2/r3/r5 (or self-targeted) to insert. That breaks the client-side
-- notification inserts done by:
--   - StatusUpdateModal.tsx (used by r4 delegates)
--   - track/[orderId]/page.tsx (anonymous customer)
-- We move that side-effect into a DB trigger that fires AFTER UPDATE OF
-- status on turath_masr_orders. The trigger function is SECURITY DEFINER,
-- so it bypasses the insert RLS.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notify_on_order_status_change()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_status_label text;
BEGIN
  -- Only fire when status actually changed (not on every UPDATE).
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Map the status code to the Arabic label used by the dashboard.
  v_status_label := CASE NEW.status
    WHEN 'new'        THEN 'جديد'
    WHEN 'preparing'  THEN 'جاري التجهيز للشحن'
    WHEN 'warehouse'  THEN 'جاري تسليمه في المستودع'
    WHEN 'shipping'   THEN 'جاري الشحن'
    WHEN 'delivered'  THEN 'تم التسليم'
    WHEN 'cancelled'  THEN 'ملغي'
    WHEN 'returned'   THEN 'مرتجع'
    ELSE NEW.status
  END;

  INSERT INTO public.turath_masr_notifications (
    type,
    title,
    message,
    order_id,
    order_num,
    is_read,
    created_by,
    created_at
  ) VALUES (
    'status_change',
    'تحديث حالة الأوردر 🔄',
    'تم تغيير حالة الأوردر ' || NEW.order_num || ' إلى ' || v_status_label,
    NEW.id,
    NEW.order_num,
    false,
    'system',
    now()
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_on_order_status_change ON public.turath_masr_orders;

CREATE TRIGGER trg_notify_on_order_status_change
  AFTER UPDATE OF status ON public.turath_masr_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_on_order_status_change();

COMMENT ON FUNCTION public.notify_on_order_status_change() IS
  'AFTER UPDATE OF status trigger on turath_masr_orders. Inserts a '
  'system notification on every real status change. SECURITY DEFINER so '
  'low-privilege roles (r4 delegate, r6 CRM) can still trigger '
  'notifications via their normal status update flow without needing '
  'the notifications_managers_insert RLS exception.';


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 4: New-order notification trigger
--
-- AddOrderModal.tsx (run by r6 customer service) used to insert a
-- "new_order" notification right after creating the order. That insert
-- now fails under notifications_managers_insert. Move the side-effect
-- into a DB trigger that fires AFTER INSERT on turath_masr_orders.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notify_on_new_order()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  INSERT INTO public.turath_masr_notifications (
    type,
    title,
    message,
    order_id,
    order_num,
    is_read,
    created_by,
    created_at
  ) VALUES (
    'new_order',
    'أوردر جديد 📦',
    'تم تسجيل أوردر جديد برقم ' || NEW.order_num ||
      COALESCE(' للعميل ' || NEW.customer, ''),
    NEW.id,
    NEW.order_num,
    false,
    COALESCE(NEW.created_by, 'system'),
    now()
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_on_new_order ON public.turath_masr_orders;

CREATE TRIGGER trg_notify_on_new_order
  AFTER INSERT ON public.turath_masr_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_on_new_order();

COMMENT ON FUNCTION public.notify_on_new_order() IS
  'AFTER INSERT trigger on turath_masr_orders. Replaces the client-side '
  'new-order notification insert that previously ran in AddOrderModal.tsx '
  '(now blocked for r6 by notifications_managers_insert).';


-- =============================================================================
-- POST-DEPLOY APP-CODE TODOS (handled in the same PR as this migration)
--   - Replace `supabase.from('turath_masr_orders').select(...)` in
--     /track with `fetch('/api/track/[orderNum]')` → server-side RPC call.
--   - Drop the duplicate `notifications.insert({ type:'status_change', ...})`
--     calls in StatusUpdateModal.tsx and track/[orderId]/page.tsx — the
--     trigger above now produces them automatically.
--   - Customer-side CRM chat / complaints from the tracking page need
--     their own dedicated API routes / RPCs in a follow-up phase
--     (out of scope for 8B). The chat widget is disabled in the meantime.
-- =============================================================================
