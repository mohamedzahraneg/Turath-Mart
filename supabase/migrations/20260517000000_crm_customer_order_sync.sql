-- ─────────────────────────────────────────────────────────────────────────────
-- Phase CRM-Customers-Order-Sync-1 — ensure every order customer
-- lands in `turath_masr_customers`.
--
-- Problem
--   The client-side upsert in AddOrderModal is `RLS-authoritative`:
--   the policy `customers_authenticated_insert` (defined in
--   20260505_harden_rls_policies.sql) lets any authenticated user
--   write, BUT downstream policies tied to specific role IDs
--   (r1/r2/r5/r6) silently reject operators outside the CRM team.
--   AddOrderModal swallows the error (best-effort, non-blocking) and
--   the order saves anyway — so customer rows for operators like
--   "Rahma" never appear in the CRM dashboard while their orders
--   continue to land in `turath_masr_orders` cleanly.
--
--   Read-only audit confirmed the gap:
--     • 99 distinct phones in orders
--     • 88 rows in turath_masr_customers
--     • 11 phones missing from CRM (all attributable to one operator
--       whose role lacks write access)
--
-- Fix
--   Two layers, both SECURITY DEFINER so RLS no longer gates the
--   write:
--
--   1. `public.crm_upsert_customer_from_order(p_phone, p_full_name,
--      p_address)` — an explicit RPC the client helper calls. Returns
--      void; idempotent. Empty/blank names + addresses are coalesced
--      so a re-order from a customer with a populated profile does
--      NOT clobber their existing data with a stripped-down envelope.
--
--   2. `trg_sync_customer_on_new_order` — AFTER INSERT trigger on
--      `turath_masr_orders` that calls the same upsert function with
--      the row's phone + customer + address. This is the safety net:
--      even if the client helper fails (network, code path that
--      forgets to call it, future scripts that bypass the modal), the
--      trigger guarantees the customer row exists.
--
-- What this migration does NOT do
--   • No backfill of existing orphan customers — that ships in the
--     follow-up Phase CRM-Customers-Backfill-From-Orders-1.
--   • No change to `turath_masr_customers` schema or RLS policies.
--   • No change to `total_orders` / `total_spent` columns (the CRM
--     dashboard already derives those live from orders for the last
--     365 days, so the stored counters can stay stale; this migration
--     does not touch them).
--   • No change to AddOrderModal's customer DETECTION code path —
--     that lookup logic stays exactly as it is.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─── 1) Upsert RPC ─────────────────────────────────────────────────────
-- SECURITY DEFINER so any authenticated user creating an order can
-- land its customer row regardless of the per-role RLS guard. The
-- function only writes the three identity columns the order flow
-- knows about; segment / customer_type / etc. are CRM-team-curated
-- and stay untouched.

CREATE OR REPLACE FUNCTION public.crm_upsert_customer_from_order(
  p_phone     text,
  p_full_name text DEFAULT NULL,
  p_address   text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_phone text;
  v_name  text;
  v_addr  text;
BEGIN
  -- Reject anonymous calls. The orders RLS already requires auth,
  -- so the trigger path is implicitly authed too; this guard is
  -- belt-and-suspenders for the RPC path.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE = '42501';
  END IF;

  -- Normalize: trim whitespace, drop empties. The order flow's
  -- canonical phone is already normalized client-side via
  -- `normalizeEgyptPhone()` before the order INSERT, so we don't
  -- re-implement that here — just guard against blanks.
  v_phone := nullif(btrim(coalesce(p_phone, '')), '');
  IF v_phone IS NULL THEN
    RETURN;
  END IF;

  v_name := nullif(btrim(coalesce(p_full_name, '')), '');
  v_addr := nullif(btrim(coalesce(p_address,   '')), '');

  -- ON CONFLICT preserves existing CRM-curated fields:
  --   • full_name + address use COALESCE on the new value so blanks
  --     never overwrite a populated field (a re-order that didn't
  --     re-capture the address must not wipe it).
  --   • updated_at always bumps so the dashboard's
  --     `.order('updated_at', desc)` surfaces the freshest customer.
  --   • segment / customer_type / customer_status / vip_level /
  --     account_manager_* / notes / city / email / total_spent /
  --     total_orders are intentionally NOT touched — they're CRM-
  --     team-curated.
  INSERT INTO public.turath_masr_customers (phone, full_name, address, created_at, updated_at)
  VALUES (
    v_phone,
    v_name,
    v_addr,
    now(),
    now()
  )
  ON CONFLICT (phone) DO UPDATE
    SET
      full_name  = COALESCE(EXCLUDED.full_name, public.turath_masr_customers.full_name),
      address    = COALESCE(EXCLUDED.address,   public.turath_masr_customers.address),
      updated_at = now();
END;
$$;

-- Allow authenticated users (any logged-in operator) to call. The
-- function itself runs as definer so the underlying RLS doesn't
-- matter for the write side. Anon stays revoked.
REVOKE ALL ON FUNCTION public.crm_upsert_customer_from_order(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_upsert_customer_from_order(text, text, text) TO authenticated;

COMMENT ON FUNCTION public.crm_upsert_customer_from_order(text, text, text)
IS 'Phase CRM-Customers-Order-Sync-1. Idempotently lands an order customer in turath_masr_customers regardless of caller role RLS. Used by the AddOrder/EditOrder client helper and by the AFTER INSERT trigger on turath_masr_orders. Never clobbers populated full_name/address with blanks.';


-- ─── 2) AFTER INSERT trigger on orders ─────────────────────────────────
-- Belt-and-suspenders coverage. Even if the client helper never gets
-- called (network failure, future code path that forgets), every
-- order INSERT lands its customer row here.

CREATE OR REPLACE FUNCTION public.trg_sync_customer_on_new_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Phone-only rows are useless to the CRM dashboard; skip when
  -- there's no phone (legacy / partial inserts). The function below
  -- has the same guard but the early skip avoids the function call
  -- overhead on the hot order-insert path.
  IF NEW.phone IS NULL OR btrim(NEW.phone) = '' THEN
    RETURN NEW;
  END IF;

  PERFORM public.crm_upsert_customer_from_order(
    NEW.phone,
    NEW.customer,
    NEW.address
  );

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Never break the order insert. The client helper logs the same
    -- info from the modal side; the trigger swallows here so a
    -- runaway exception in the upsert can never roll back an order.
    RAISE WARNING '[trg_sync_customer_on_new_order] upsert failed: %', SQLERRM;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_sync_customer_on_new_order() FROM PUBLIC;

COMMENT ON FUNCTION public.trg_sync_customer_on_new_order()
IS 'Phase CRM-Customers-Order-Sync-1 — AFTER INSERT trigger on turath_masr_orders. Calls crm_upsert_customer_from_order with the order phone/customer/address. SECURITY DEFINER so role-based RLS does not block the write. Failures are warned, never raised, so a CRM-side hiccup can never roll back an order.';

DROP TRIGGER IF EXISTS trg_sync_customer_on_new_order ON public.turath_masr_orders;
CREATE TRIGGER trg_sync_customer_on_new_order
  AFTER INSERT ON public.turath_masr_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_customer_on_new_order();


COMMIT;

-- ─── Manual verification ─────────────────────────────────────────────
--   -- 1. RPC exists and is callable.
--   SELECT proname, prosecdef, proacl
--   FROM   pg_proc
--   WHERE  proname IN ('crm_upsert_customer_from_order',
--                      'trg_sync_customer_on_new_order')
--     AND  pronamespace = 'public'::regnamespace;
--
--   -- 2. Trigger is attached.
--   SELECT tgname, tgrelid::regclass, tgenabled
--   FROM   pg_trigger
--   WHERE  tgname = 'trg_sync_customer_on_new_order';
--
--   -- 3. After insert smoke test (do this in a transaction you ROLLBACK).
--   --    Then SELECT to confirm the customer row exists for the new phone.
