-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 23C — delegate custody (الأمانات / العهد) + expenses (المصاريف)
--
-- Co-introduces TWO tables in one migration because they're a paired
-- feature on the `/delegates` page (drawer tabs + KPI row + register
-- modals) and admins want them either both present or both absent —
-- splitting them into two migrations would create an awkward
-- intermediate state where one tab works and the other 404s.
--
-- 1. `public.turath_masr_delegate_custody` — physical / non-monetary
--    items the dispatcher hands the delegate (cash float, devices,
--    documents, returns to bring back). Tracks lifecycle:
--    `with_delegate → returned | settled | lost`.
--
-- 2. `public.turath_masr_delegate_expenses` — out-of-pocket expenses
--    the delegate incurred on the company's behalf (fuel, transport,
--    extra shipping, parking, etc.). Status is `approved` by default
--    in Phase 23C; an approval workflow with `pending` / `rejected`
--    is parked for a follow-up phase.
--
-- Design decisions
--   • Both tables follow the same Phase 23B `*_settlements` pattern:
--     soft FKs (`ON DELETE SET NULL`) with name-snapshot columns so
--     audit history survives profile deletions.
--   • CHECK constraints lock the canonical token sets at DDL time so
--     a typo at insert returns 23514 instead of silently storing
--     garbage. UI maps each token to an Arabic label (lib/delegates
--     helper modules).
--   • RLS enabled with the same admin-only posture introduced in
--     Phase 23B (`is_admin()` on every command). Mirrors
--     `settlements_admin_*` exactly so a future helper that loosens
--     read access (e.g. `is_shipping_or_above`) can be added in one
--     consistent place.
--   • Idempotent — `IF NOT EXISTS` on tables/indexes,
--     `DROP POLICY IF EXISTS … CREATE POLICY …` on the policies. Re-
--     running the migration is safe.
--
-- DEPLOY GATE — DO NOT APPLY WITHOUT EXPLICIT APPROVAL
--   The Phase 23C PR ships only the migration file + UI wiring. The
--   defensive UI swallows pre-migration "missing relation" errors
--   (42P01) and renders zeros so the page doesn't break before this
--   migration is applied.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── 1) Custody (الأمانات / العهد) ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.turath_masr_delegate_custody (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Soft FK so a deleted profile doesn't wipe the audit row. Kept
  -- alongside the snapshot `delegate_name` so historical lookups
  -- still render even after profile changes.
  delegate_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  delegate_name       text,

  -- Seven canonical custody types. UI maps each to an Arabic label:
  --   cash      → فلوس
  --   product   → منتجات
  --   device    → جهاز
  --   bag       → شنطة
  --   returns   → مرتجعات
  --   documents → مستندات
  --   other     → أخرى
  custody_type        text NOT NULL DEFAULT 'other'
                      CHECK (custody_type IN (
                        'cash','product','device','bag','returns','documents','other'
                      )),

  -- Free-form short description. Required so the audit row is never
  -- ambiguous ("جهاز" alone is useless without "iPhone 11 Pro").
  description         text NOT NULL,

  -- Quantity defaults to 1 because the most common case is a single
  -- item. Cash custody uses estimated_value and ignores qty.
  quantity            numeric DEFAULT 1
                      CHECK (quantity > 0),

  -- EGP estimate used in the "قيمة الأمانات الحالية" KPI. May be 0
  -- for items we can't price (e.g. company badge), so the constraint
  -- is `>= 0` rather than `> 0`.
  estimated_value     numeric DEFAULT 0
                      CHECK (estimated_value >= 0),

  -- Lifecycle. `with_delegate` is the seed state. The other three
  -- are terminal.
  --   with_delegate → مع المندوب
  --   returned      → تم الاستلام
  --   settled       → تمت التسوية
  --   lost          → مفقود
  status              text NOT NULL DEFAULT 'with_delegate'
                      CHECK (status IN ('with_delegate','returned','settled','lost')),

  -- Who handed the item over (almost always the dispatcher recording
  -- the row). Soft FK + snapshot pattern again.
  handed_by           uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  handed_by_name      text,

  -- Who received the item back (or marked it settled / lost). NULL
  -- while status='with_delegate'.
  received_by         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  received_by_name    text,

  handed_at           timestamptz NOT NULL DEFAULT now(),

  -- When the row left `with_delegate`. Populated by the UI's
  -- receive/settle/lost actions; NULL otherwise.
  returned_at         timestamptz,

  note                text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Two operational indexes:
--   • per-delegate query (drawer custody tab)
--   • status filter (page-level "active custody" KPI)
-- + handed_at for the timeline ordering.
CREATE INDEX IF NOT EXISTS turath_masr_delegate_custody_delegate_profile_id_idx
  ON public.turath_masr_delegate_custody(delegate_profile_id);
CREATE INDEX IF NOT EXISTS turath_masr_delegate_custody_status_idx
  ON public.turath_masr_delegate_custody(status);
CREATE INDEX IF NOT EXISTS turath_masr_delegate_custody_handed_at_idx
  ON public.turath_masr_delegate_custody(handed_at);

ALTER TABLE public.turath_masr_delegate_custody ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS custody_admin_select ON public.turath_masr_delegate_custody;
CREATE POLICY custody_admin_select
  ON public.turath_masr_delegate_custody
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS custody_admin_insert ON public.turath_masr_delegate_custody;
CREATE POLICY custody_admin_insert
  ON public.turath_masr_delegate_custody
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS custody_admin_update ON public.turath_masr_delegate_custody;
CREATE POLICY custody_admin_update
  ON public.turath_masr_delegate_custody
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS custody_admin_delete ON public.turath_masr_delegate_custody;
CREATE POLICY custody_admin_delete
  ON public.turath_masr_delegate_custody
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

COMMENT ON TABLE public.turath_masr_delegate_custody IS
  'Phase 23C — items handed to a delegate (cash / product / docs / '
  'etc.) with a lifecycle (with_delegate → returned/settled/lost). '
  'Admin-only by RLS.';


-- ─── 2) Expenses (المصاريف) ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.turath_masr_delegate_expenses (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  delegate_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  delegate_name       text,

  -- Optional link back to a specific order. Plain text (not a FK)
  -- because `turath_masr_orders.id` is text and we don't want a
  -- delete cascade — the expense row stays in the audit trail even
  -- if the order is later deleted.
  order_id            text,

  -- Seven canonical expense types. UI maps each to an Arabic label:
  --   fuel            → بنزين
  --   transport       → مواصلات
  --   extra_shipping  → شحن إضافي
  --   waiting         → انتظار
  --   toll            → كارتة / بوابة
  --   parking         → ركن / جراج
  --   other           → أخرى
  expense_type        text NOT NULL DEFAULT 'other'
                      CHECK (expense_type IN (
                        'fuel','transport','extra_shipping','waiting','toll','parking','other'
                      )),

  -- EGP amount; CHECK > 0 because zero/negative expenses don't make
  -- business sense (refunds would be a separate workflow).
  amount              numeric NOT NULL CHECK (amount > 0),

  -- Approval lifecycle. Phase 23C ships `approved` only by default;
  -- the `pending` / `rejected` tokens exist so a future approval
  -- workflow can land without a schema change.
  --   approved → معتمد
  --   pending  → قيد المراجعة
  --   rejected → مرفوض
  status              text NOT NULL DEFAULT 'approved'
                      CHECK (status IN ('approved','pending','rejected')),

  approved_by         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_by_name    text,

  note                text,

  -- When the expense actually happened (back-datable). Distinct
  -- from `created_at` so the report-style aggregates can use the
  -- real-world date.
  expense_at          timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS turath_masr_delegate_expenses_delegate_profile_id_idx
  ON public.turath_masr_delegate_expenses(delegate_profile_id);
CREATE INDEX IF NOT EXISTS turath_masr_delegate_expenses_expense_at_idx
  ON public.turath_masr_delegate_expenses(expense_at);
CREATE INDEX IF NOT EXISTS turath_masr_delegate_expenses_status_idx
  ON public.turath_masr_delegate_expenses(status);

ALTER TABLE public.turath_masr_delegate_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS expenses_admin_select ON public.turath_masr_delegate_expenses;
CREATE POLICY expenses_admin_select
  ON public.turath_masr_delegate_expenses
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS expenses_admin_insert ON public.turath_masr_delegate_expenses;
CREATE POLICY expenses_admin_insert
  ON public.turath_masr_delegate_expenses
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS expenses_admin_update ON public.turath_masr_delegate_expenses;
CREATE POLICY expenses_admin_update
  ON public.turath_masr_delegate_expenses
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS expenses_admin_delete ON public.turath_masr_delegate_expenses;
CREATE POLICY expenses_admin_delete
  ON public.turath_masr_delegate_expenses
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

COMMENT ON TABLE public.turath_masr_delegate_expenses IS
  'Phase 23C — out-of-pocket expenses delegates incurred on the '
  'company''s behalf (fuel, transport, parking, etc.). Default '
  'status=approved; approval workflow deferred. Admin-only by RLS.';


-- =============================================================================
-- POST-MIGRATION VERIFICATION (run manually after applying):
--
--   SELECT table_name FROM information_schema.tables
--    WHERE table_schema='public'
--      AND table_name IN (
--        'turath_masr_delegate_custody',
--        'turath_masr_delegate_expenses'
--      );
--   -- expect: 2 rows
--
--   SELECT tablename, count(*) AS policies
--     FROM pg_policies
--    WHERE schemaname='public'
--      AND tablename IN (
--        'turath_masr_delegate_custody',
--        'turath_masr_delegate_expenses'
--      )
--    GROUP BY tablename;
--   -- expect: each table has 4 admin-only policies
--
--   SELECT relname, relrowsecurity
--     FROM pg_class
--    WHERE relname IN (
--      'turath_masr_delegate_custody',
--      'turath_masr_delegate_expenses'
--    );
--   -- expect: relrowsecurity = true for both
-- =============================================================================
