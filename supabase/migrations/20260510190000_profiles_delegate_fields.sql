-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 23A-Fix1 — extend `public.profiles` with delegate-profile
-- fields so the new `/delegates` admin wizard can capture and persist
-- the operational data the dispatcher needs (phone, national id,
-- transport type, vehicle + driving licence numbers and expiry
-- dates) and so the tracking page can surface the delegate's contact
-- phone for customers.
--
-- Background
--   The `profiles` row was previously a thin wrapper around
--   `auth.users` carrying only `id, email, full_name, role,
--   role_id, role_name, permissions, created_at`. Phase 22Q's
--   audit confirmed `phone` was missing — the tracking-page
--   delegate card today shows "رقم الهاتف غير مسجل" because there
--   is nowhere to read the phone from. Phase 23A added `/delegates`
--   but every drawer field beyond name/role was static text.
--
--   This migration adds the full delegate-profile field set in one
--   additive batch. All columns are NULLable, no backfill, no RLS
--   change. Existing non-delegate profiles (admin, manager,
--   customer service) will continue to render with empty values for
--   the new fields — the UI hides them when blank.
--
-- Why on `profiles` instead of a separate `delegate_profiles` table
--   • Single source of truth — Phase 23A's `/delegates` page
--     already joins `profiles WHERE role_id IN ('r3','r4')` for the
--     list. A side table would force a second fetch + a left-join
--     reconciliation for legacy delegate_name rows on every render.
--   • Several fields (`phone` first and foremost) are useful for
--     non-delegate roles too; admins want to be able to call back
--     a customer-service rep just like a delegate.
--   • The `delegate_*` prefixed fields are intentionally specific
--     in name so a future schema split is easy: a single `pg_dump
--     --table public.profiles` plus a column rename moves them.
--
-- DEPLOY GATE — DO NOT APPLY WITHOUT EXPLICIT APPROVAL
--   Phase 23A-Fix1's deployed code:
--     • Reads profile.phone / national_id / transport_type / licence
--       fields defensively. A `select('*')` returns the new columns
--       only after the migration is applied; before it, the columns
--       are simply absent and every render sees `undefined` and
--       hides the row.
--     • The new wizard's UPSERT into profiles will fail with a
--       42703 ("column does not exist") on the new columns
--       pre-migration; the wizard surfaces a friendly Arabic toast
--       and does NOT roll the auth user back. Apply this migration
--       before opening the wizard in production.
-- ─────────────────────────────────────────────────────────────────────────────


ALTER TABLE public.profiles
  -- Egyptian-mobile contact phone for the delegate. UI validates
  -- the canonical 010/011/012/015-prefix 11-digit shape; we do
  -- NOT add a CHECK constraint at the SQL level so legacy /
  -- imported rows aren't rejected.
  ADD COLUMN IF NOT EXISTS phone                       text,

  -- Egyptian National ID — 14 digits. UI validates the digit
  -- count + first-digit (2 or 3) + 7th-13th locale-id rules; the
  -- column itself is plain text so future formats don't require a
  -- migration.
  ADD COLUMN IF NOT EXISTS national_id                 text,

  -- Vehicle / mode of transport. Free-text by storage but the
  -- wizard restricts the picker to a known set:
  --     motorcycle  / private_car / quarter_truck /
  --     half_truck  / walking
  -- The UI maps each token to the Arabic display label
  -- (موتوسيكل / عربية ملاكي / عربية ربع نقل / عربية نصف نقل /
  -- مترجل). Storing English tokens keeps reports / exports
  -- locale-independent.
  ADD COLUMN IF NOT EXISTS transport_type              text,

  -- "رخصة المركبة" / vehicle registration. Number + the start +
  -- expiry dates so the UI can render a "متبقي N يوم" pill and
  -- the dispatcher can chase renewals before they lapse.
  ADD COLUMN IF NOT EXISTS vehicle_license_number      text,
  ADD COLUMN IF NOT EXISTS vehicle_license_starts_at   date,
  ADD COLUMN IF NOT EXISTS vehicle_license_expires_at  date,

  -- "رخصة القيادة" / driving licence. Same shape; tracked
  -- separately because a dispatcher may rent / share a vehicle
  -- (vehicle licence different from driver) and the two expiries
  -- legitimately move on independent schedules.
  ADD COLUMN IF NOT EXISTS driving_license_number      text,
  ADD COLUMN IF NOT EXISTS driving_license_starts_at   date,
  ADD COLUMN IF NOT EXISTS driving_license_expires_at  date,

  -- Soft active/inactive switch. NULL is treated as TRUE by the
  -- /delegates UI (matches Phase 23A's "any delegate with delivered
  -- or in-flight orders is active" heuristic). Once the dispatcher
  -- toggles a row, the explicit boolean wins over the heuristic.
  ADD COLUMN IF NOT EXISTS delegate_is_active          boolean DEFAULT true;


-- Documentation comments — read by `\d+` and any future schema
-- introspection. No behavioural effect.
COMMENT ON COLUMN public.profiles.phone IS
  'Phase 23A-Fix1 — contact phone (Egyptian mobile shape, '
  'validated client-side).';

COMMENT ON COLUMN public.profiles.national_id IS
  'Phase 23A-Fix1 — Egyptian National ID, 14 digits. Admin-only; '
  'NEVER returned by the customer-facing tracking RPCs.';

COMMENT ON COLUMN public.profiles.transport_type IS
  'Phase 23A-Fix1 — one of: motorcycle, private_car, '
  'quarter_truck, half_truck, walking. UI maps to Arabic labels.';

COMMENT ON COLUMN public.profiles.vehicle_license_number IS
  'Phase 23A-Fix1 — vehicle licence (رخصة المركبة) number. '
  'Admin-only; NEVER returned by the customer-facing tracking RPCs.';

COMMENT ON COLUMN public.profiles.vehicle_license_starts_at IS
  'Phase 23A-Fix1 — vehicle licence start date.';

COMMENT ON COLUMN public.profiles.vehicle_license_expires_at IS
  'Phase 23A-Fix1 — vehicle licence expiry date. UI renders a '
  'colour-coded "متبقي N يوم" / "تنتهي اليوم" / "منتهية" pill.';

COMMENT ON COLUMN public.profiles.driving_license_number IS
  'Phase 23A-Fix1 — driving licence (رخصة القيادة) number. '
  'Admin-only; NEVER returned by the customer-facing tracking RPCs.';

COMMENT ON COLUMN public.profiles.driving_license_starts_at IS
  'Phase 23A-Fix1 — driving licence start date.';

COMMENT ON COLUMN public.profiles.driving_license_expires_at IS
  'Phase 23A-Fix1 — driving licence expiry date.';

COMMENT ON COLUMN public.profiles.delegate_is_active IS
  'Phase 23A-Fix1 — explicit active/inactive flag for delegate '
  'profiles. NULL is treated as active.';


-- =============================================================================
-- POST-MIGRATION VERIFICATION (run manually after applying):
--
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND table_name   = 'profiles'
--      AND column_name IN (
--        'phone', 'national_id', 'transport_type',
--        'vehicle_license_number', 'vehicle_license_starts_at',
--        'vehicle_license_expires_at',
--        'driving_license_number', 'driving_license_starts_at',
--        'driving_license_expires_at',
--        'delegate_is_active'
--      )
--    ORDER BY column_name;
--   -- expect: 10 rows, all is_nullable='YES', delegate_is_active
--   -- has column_default 'true'.
--
--   SELECT count(*) FROM public.profiles
--    WHERE phone IS NOT NULL OR national_id IS NOT NULL;
--   -- expect: 0 immediately after the migration runs.
-- =============================================================================
