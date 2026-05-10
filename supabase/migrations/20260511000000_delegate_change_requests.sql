-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 23M — Delegate profile change-request workflow.
--
-- Adds a new admin-mediated path for a delegate (r4) to propose changes
-- to their own `profiles` row. The delegate NEVER writes to `profiles`
-- directly from the UI — they submit a `turath_masr_delegate_change_requests`
-- row, an admin reviews and approves or rejects, and the approval RPC
-- (SECURITY DEFINER) applies the change to `profiles` atomically. Every
-- request stays in the table indefinitely as an audit trail.
--
-- What this migration adds (additive only)
-- ----------------------------------------
--   1. `turath_masr_delegate_change_requests` table — one row per
--      submitted request, with current snapshot + requested changes
--      + review metadata. Soft-state column `status` carries the four
--      lifecycle states: pending / approved / rejected / cancelled.
--
--   2. Three indexes (`delegate_profile_id`, `status`, `created_at`)
--      to back the admin list ("show me all pending"), the delegate
--      list ("my requests"), and the recency sort.
--
--   3. Four RLS policies:
--        • delegate_select_own        — delegate sees their own rows
--        • finance_reader_select      — r1 + r3 (read scope mirrors
--                                       Phase 23F's other delegate
--                                       tables; r3 is "read-only" so
--                                       admins-only get the writes)
--        • delegate_insert_own        — delegate inserts ONLY their own
--                                       request (delegate_profile_id =
--                                       auth.uid())
--        • admin_write_all            — admin INSERT / UPDATE / DELETE
--
--   4. Four SECURITY DEFINER RPCs. All four GRANT EXECUTE to
--      authenticated only — anon never reaches this surface.
--        • submit_delegate_change_request(p_changes jsonb, p_note)
--        • approve_delegate_change_request(p_request_id, p_admin_note)
--        • reject_delegate_change_request (p_request_id, p_reason)
--        • cancel_delegate_change_request (p_request_id)
--
-- What this migration does NOT do
-- -------------------------------
--   • Does NOT change `profiles`. No new columns, no schema change.
--     The approval RPC writes to existing columns only.
--   • Does NOT widen the existing `profiles_own_update` policy. That
--     policy still allows a delegate to update their own row directly
--     via PostgREST — but the new UI path NEVER exposes that
--     affordance. Tightening `profiles_own_update` to a narrow column
--     whitelist is a separate, larger cutover; flagging it as
--     follow-up rather than risking a regression in this migration.
--   • Does NOT touch settlements / custody / expenses / ratings /
--     documents / chat / orders. Pure new surface.
--
-- Safety properties
-- -----------------
--   • CREATE TABLE IF NOT EXISTS — additive, idempotent
--   • CREATE INDEX IF NOT EXISTS — additive, idempotent
--   • CREATE OR REPLACE FUNCTION — idempotent on re-run
--   • RLS policies DROPped + recreated atomically (DROP IF EXISTS + CREATE)
--   • All RPCs SECURITY DEFINER + SET search_path=public
--   • REVOKE ALL FROM PUBLIC + explicit GRANT EXECUTE TO authenticated
--     (NOT anon — this surface is fully authenticated)
--   • No DROP TABLE, no TRUNCATE, no DELETE.
--
-- DEPLOY GATE — DO NOT APPLY WITHOUT EXPLICIT APPROVAL
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── 1) Request table ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.turath_masr_delegate_change_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ON DELETE CASCADE: if a delegate profile is hard-deleted, drop
  -- their pending / historical requests with it. Soft-deactivation
  -- (`delegate_is_active=false`) is the normal lifecycle and never
  -- touches this column. Matches the Phase 23I documents posture.
  delegate_profile_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  delegate_name       text,

  -- Who hit "submit". For Phase 23M this is always the same as
  -- `delegate_profile_id`, but we record it separately so a future
  -- admin-on-behalf path doesn't need another migration.
  requested_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  requested_by_name   text,

  -- 4-state lifecycle. CHECK enforced below to keep storage clean.
  status              text NOT NULL DEFAULT 'pending',

  -- The delta the delegate proposed. ALWAYS scoped to the field
  -- whitelist on the application side; the approval RPC re-whitelists
  -- before applying so a malicious payload can never leak through.
  --   { "phone": "0100…", "vehicle_license_number": "…", … }
  requested_changes   jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Profile values at submit time. Audit-only — never used for the
  -- approval write path. Lets an admin see what changed AND what the
  -- original value was, even if the profile has since drifted from
  -- another approved request.
  current_snapshot    jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Admin's review note. Required when rejecting (carries the reason);
  -- optional on approve.
  admin_note          text,

  reviewed_by         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_by_name    text,
  reviewed_at         timestamptz,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz
);

-- Status CHECK as a separate ALTER so re-running the migration on a
-- pre-existing table picks up the constraint cleanly.
ALTER TABLE public.turath_masr_delegate_change_requests
  DROP CONSTRAINT IF EXISTS turath_masr_delegate_change_requests_status_check;
ALTER TABLE public.turath_masr_delegate_change_requests
  ADD  CONSTRAINT turath_masr_delegate_change_requests_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'));

CREATE INDEX IF NOT EXISTS turath_masr_delegate_change_requests_delegate_profile_id_idx
  ON public.turath_masr_delegate_change_requests(delegate_profile_id);
CREATE INDEX IF NOT EXISTS turath_masr_delegate_change_requests_status_idx
  ON public.turath_masr_delegate_change_requests(status);
CREATE INDEX IF NOT EXISTS turath_masr_delegate_change_requests_created_at_idx
  ON public.turath_masr_delegate_change_requests(created_at);

ALTER TABLE public.turath_masr_delegate_change_requests ENABLE ROW LEVEL SECURITY;


-- ─── 2) RLS policies ────────────────────────────────────────────────────
--
-- Posture
--   • Delegate (r4) → SELECT own rows + INSERT own rows. NEVER UPDATE
--     or DELETE — cancellation goes through the SECURITY DEFINER RPC.
--   • Shipping supervisor (r3) + admin (r1) → SELECT all rows. r3 has
--     `view_delegates` (Phase 23F) and operationally benefits from
--     seeing the queue, but never writes.
--   • Admin (r1) → INSERT / UPDATE / DELETE (matches the rest of the
--     delegate-finance admin write surface).
--   • Anon → NO access at any policy.

DROP POLICY IF EXISTS delegate_change_requests_delegate_select ON public.turath_masr_delegate_change_requests;
CREATE POLICY delegate_change_requests_delegate_select
  ON public.turath_masr_delegate_change_requests
  FOR SELECT
  TO authenticated
  USING (delegate_profile_id = auth.uid());

DROP POLICY IF EXISTS delegate_change_requests_finance_reader_select ON public.turath_masr_delegate_change_requests;
CREATE POLICY delegate_change_requests_finance_reader_select
  ON public.turath_masr_delegate_change_requests
  FOR SELECT
  TO authenticated
  USING (public.is_delegate_finance_reader());

DROP POLICY IF EXISTS delegate_change_requests_delegate_insert ON public.turath_masr_delegate_change_requests;
CREATE POLICY delegate_change_requests_delegate_insert
  ON public.turath_masr_delegate_change_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    delegate_profile_id = auth.uid()
    AND requested_by    = auth.uid()
    -- Status pinned to 'pending' on insert; a row inserted in any
    -- other state is rejected so the lifecycle starts cleanly even
    -- if the client tries to bypass the SECURITY DEFINER RPC.
    AND status = 'pending'
  );

DROP POLICY IF EXISTS delegate_change_requests_admin_insert ON public.turath_masr_delegate_change_requests;
CREATE POLICY delegate_change_requests_admin_insert
  ON public.turath_masr_delegate_change_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS delegate_change_requests_admin_update ON public.turath_masr_delegate_change_requests;
CREATE POLICY delegate_change_requests_admin_update
  ON public.turath_masr_delegate_change_requests
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS delegate_change_requests_admin_delete ON public.turath_masr_delegate_change_requests;
CREATE POLICY delegate_change_requests_admin_delete
  ON public.turath_masr_delegate_change_requests
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

COMMENT ON TABLE public.turath_masr_delegate_change_requests IS
  'Phase 23M — admin-mediated delegate profile change requests. '
  'Delegate (r4) inserts own pending row; admin approves / rejects via '
  'SECURITY DEFINER RPC; cancel via SECURITY DEFINER RPC. No direct '
  'profile writes from the delegate side. r3 has read-only access. '
  'No anon access at any policy.';


-- ─── 3) submit_delegate_change_request RPC ──────────────────────────────
--
-- Delegate-facing submit RPC. Validates the proposed changes against
-- the whitelist + per-field shape rules, snapshots the current
-- profile, inserts the request, and returns the new request id.
-- Notifications are best-effort: a failed insert into
-- `turath_masr_notifications` does NOT roll back the request.

CREATE OR REPLACE FUNCTION public.submit_delegate_change_request(
  p_requested_changes jsonb,
  p_note              text DEFAULT NULL
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_uid               uuid := auth.uid();
  v_profile           public.profiles%ROWTYPE;
  v_existing_pending  uuid;
  v_request_id        uuid;
  v_snapshot          jsonb;
  v_clean_changes     jsonb := '{}'::jsonb;
  v_key               text;
  v_value             jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  -- Load the caller's profile. Re-check role + active flag so a
  -- deactivated delegate cannot keep filing requests after the admin
  -- flipped them off.
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_uid;

  IF v_profile.id IS NULL THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = '22023';
  END IF;
  IF v_profile.role_id IS DISTINCT FROM 'r4' THEN
    RAISE EXCEPTION 'not_delegate' USING ERRCODE = '42501';
  END IF;
  IF v_profile.delegate_is_active = false THEN
    RAISE EXCEPTION 'delegate_inactive' USING ERRCODE = '42501';
  END IF;

  -- Block second pending request for the same delegate. The UI also
  -- blocks this on the client, but enforcing at the RPC keeps an
  -- abusive direct-call path from spamming pending rows.
  SELECT id INTO v_existing_pending
    FROM public.turath_masr_delegate_change_requests
   WHERE delegate_profile_id = v_uid
     AND status = 'pending'
   LIMIT 1;
  IF v_existing_pending IS NOT NULL THEN
    RAISE EXCEPTION 'pending_request_exists' USING ERRCODE = '54000';
  END IF;

  -- Build the cleaned-changes object by ITERATING the input and only
  -- pulling whitelisted keys with the right shape. The server-side
  -- whitelist matches the client-side helper exactly — anything
  -- outside it is silently dropped (defence in depth).
  IF p_requested_changes IS NULL OR jsonb_typeof(p_requested_changes) <> 'object' THEN
    RAISE EXCEPTION 'invalid_changes_shape' USING ERRCODE = '22023';
  END IF;

  FOR v_key, v_value IN SELECT * FROM jsonb_each(p_requested_changes) LOOP
    -- Skip nulls / explicit empty strings (treat as "no change").
    IF v_value IS NULL OR jsonb_typeof(v_value) = 'null' THEN
      CONTINUE;
    END IF;
    IF jsonb_typeof(v_value) = 'string' AND length(trim(both '"' FROM v_value::text)) = 0 THEN
      CONTINUE;
    END IF;

    -- Whitelist + per-field validation. Anything outside the
    -- whitelist falls through to the end of the loop with no append.
    IF v_key = 'phone' THEN
      IF jsonb_typeof(v_value) <> 'string' THEN
        RAISE EXCEPTION 'invalid_phone' USING ERRCODE = '22023';
      END IF;
      IF NOT (v_value::text #>> '{}') ~ '^01[0-9]{9}$' THEN
        RAISE EXCEPTION 'invalid_phone' USING ERRCODE = '22023';
      END IF;
      v_clean_changes := v_clean_changes || jsonb_build_object('phone', v_value);

    ELSIF v_key = 'transport_type' THEN
      IF (v_value::text #>> '{}') NOT IN ('motorcycle','private_car','quarter_truck','half_truck','walking') THEN
        RAISE EXCEPTION 'invalid_transport_type' USING ERRCODE = '22023';
      END IF;
      v_clean_changes := v_clean_changes || jsonb_build_object('transport_type', v_value);

    ELSIF v_key = 'vehicle_license_number'
       OR v_key = 'driving_license_number' THEN
      IF jsonb_typeof(v_value) <> 'string' THEN
        RAISE EXCEPTION 'invalid_license_number' USING ERRCODE = '22023';
      END IF;
      IF length(v_value::text #>> '{}') > 80 THEN
        RAISE EXCEPTION 'invalid_license_number' USING ERRCODE = '22023';
      END IF;
      v_clean_changes := v_clean_changes || jsonb_build_object(v_key, v_value);

    ELSIF v_key IN (
        'vehicle_license_starts_at',
        'vehicle_license_expires_at',
        'driving_license_starts_at',
        'driving_license_expires_at'
    ) THEN
      IF jsonb_typeof(v_value) <> 'string' THEN
        RAISE EXCEPTION 'invalid_date' USING ERRCODE = '22023';
      END IF;
      -- Strict yyyy-mm-dd (matches <input type="date"> output).
      IF NOT (v_value::text #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$' THEN
        RAISE EXCEPTION 'invalid_date' USING ERRCODE = '22023';
      END IF;
      v_clean_changes := v_clean_changes || jsonb_build_object(v_key, v_value);

    ELSIF v_key = 'national_id' THEN
      -- Sensitive: still allowed, but strictly shaped. Egyptian
      -- national ID is 14 digits. The admin UI surfaces a red banner
      -- when a request modifies this field.
      IF jsonb_typeof(v_value) <> 'string' THEN
        RAISE EXCEPTION 'invalid_national_id' USING ERRCODE = '22023';
      END IF;
      IF NOT (v_value::text #>> '{}') ~ '^\d{14}$' THEN
        RAISE EXCEPTION 'invalid_national_id' USING ERRCODE = '22023';
      END IF;
      v_clean_changes := v_clean_changes || jsonb_build_object('national_id', v_value);

    -- Anything else (role / permissions / delegate_is_active / etc.)
    -- is silently dropped. We never raise on unknown keys so a UI
    -- that adds a new field later doesn't fail loudly for an old
    -- caller; the field just doesn't make it through.
    END IF;
  END LOOP;

  -- Cross-field validation: end date >= start date for each licence.
  -- Done after the per-field whitelist so the comparison is between
  -- already-shaped strings.
  IF v_clean_changes ? 'vehicle_license_starts_at'
     AND v_clean_changes ? 'vehicle_license_expires_at'
     AND (v_clean_changes->>'vehicle_license_expires_at') < (v_clean_changes->>'vehicle_license_starts_at') THEN
    RAISE EXCEPTION 'vehicle_license_date_order' USING ERRCODE = '22023';
  END IF;
  IF v_clean_changes ? 'driving_license_starts_at'
     AND v_clean_changes ? 'driving_license_expires_at'
     AND (v_clean_changes->>'driving_license_expires_at') < (v_clean_changes->>'driving_license_starts_at') THEN
    RAISE EXCEPTION 'driving_license_date_order' USING ERRCODE = '22023';
  END IF;

  -- Reject if nothing survived the whitelist — no point storing a
  -- request that would be a no-op approval.
  IF jsonb_typeof(v_clean_changes) <> 'object' OR v_clean_changes = '{}'::jsonb THEN
    RAISE EXCEPTION 'no_changes' USING ERRCODE = '22023';
  END IF;

  -- Snapshot the relevant profile fields for the audit trail.
  v_snapshot := jsonb_strip_nulls(jsonb_build_object(
    'phone',                       v_profile.phone,
    'transport_type',              v_profile.transport_type,
    'vehicle_license_number',      v_profile.vehicle_license_number,
    'vehicle_license_starts_at',   v_profile.vehicle_license_starts_at,
    'vehicle_license_expires_at',  v_profile.vehicle_license_expires_at,
    'driving_license_number',      v_profile.driving_license_number,
    'driving_license_starts_at',   v_profile.driving_license_starts_at,
    'driving_license_expires_at',  v_profile.driving_license_expires_at,
    'national_id',                 v_profile.national_id
  ));

  INSERT INTO public.turath_masr_delegate_change_requests
    (delegate_profile_id, delegate_name, requested_by, requested_by_name,
     status, requested_changes, current_snapshot, admin_note, created_at)
  VALUES
    (v_uid, v_profile.full_name, v_uid, v_profile.full_name,
     'pending', v_clean_changes, v_snapshot, p_note, now())
  RETURNING id INTO v_request_id;

  -- Best-effort admin notification. The notifications table may not
  -- support an `r1` broadcast on every install; we swallow any error
  -- so the request itself still lands.
  BEGIN
    INSERT INTO public.turath_masr_notifications (type, title, message, target_role_id, created_by)
    VALUES (
      'delegate_change_request',
      'طلب تعديل بيانات مندوب',
      coalesce(v_profile.full_name, 'مندوب') || ' قدّم طلب تعديل بياناته.',
      'r1',
      v_profile.full_name
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN v_request_id;
END;
$$;

REVOKE ALL    ON FUNCTION public.submit_delegate_change_request(jsonb, text) FROM PUBLIC;
REVOKE ALL    ON FUNCTION public.submit_delegate_change_request(jsonb, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_delegate_change_request(jsonb, text) TO authenticated;

COMMENT ON FUNCTION public.submit_delegate_change_request(jsonb, text) IS
  'Phase 23M — delegate submits a profile change request. SECURITY '
  'DEFINER. Whitelists fields, validates phone / dates / national_id, '
  'rejects when no pending request exists or when changes are empty. '
  'Returns the new request id.';


-- ─── 4) approve_delegate_change_request RPC ─────────────────────────────
--
-- Admin-facing approve. Loads the request, re-validates the change
-- set against the whitelist (defence-in-depth in case the server
-- whitelist evolves between submit and approve), then applies the
-- changes to `profiles` and stamps the review metadata on the
-- request row. Returns a jsonb summary with `applied_fields`.

CREATE OR REPLACE FUNCTION public.approve_delegate_change_request(
  p_request_id  uuid,
  p_admin_note  text DEFAULT NULL
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_admin_uid    uuid := auth.uid();
  v_admin_name   text;
  v_request      public.turath_masr_delegate_change_requests%ROWTYPE;
  v_changes      jsonb;
  v_applied      jsonb := '[]'::jsonb;
  v_key          text;
  v_value        jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;

  SELECT full_name INTO v_admin_name FROM public.profiles WHERE id = v_admin_uid;

  SELECT * INTO v_request
    FROM public.turath_masr_delegate_change_requests
   WHERE id = p_request_id
   FOR UPDATE;

  IF v_request.id IS NULL THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = '22023';
  END IF;
  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'request_not_pending' USING ERRCODE = '54000';
  END IF;
  IF v_request.delegate_profile_id IS NULL THEN
    RAISE EXCEPTION 'delegate_missing' USING ERRCODE = '22023';
  END IF;

  v_changes := v_request.requested_changes;

  -- Re-whitelist on apply. We refuse to spread the jsonb directly
  -- into the UPDATE — every field gets its own typed assignment so
  -- a payload that smuggled `role_id`/`permissions` via a future
  -- bypass can't escalate privileges here.
  FOR v_key, v_value IN SELECT * FROM jsonb_each(v_changes) LOOP
    IF v_key = 'phone' THEN
      UPDATE public.profiles SET phone = v_value::text #>> '{}' WHERE id = v_request.delegate_profile_id;
      v_applied := v_applied || to_jsonb(v_key);
    ELSIF v_key = 'transport_type' THEN
      UPDATE public.profiles SET transport_type = v_value::text #>> '{}' WHERE id = v_request.delegate_profile_id;
      v_applied := v_applied || to_jsonb(v_key);
    ELSIF v_key = 'vehicle_license_number' THEN
      UPDATE public.profiles SET vehicle_license_number = v_value::text #>> '{}' WHERE id = v_request.delegate_profile_id;
      v_applied := v_applied || to_jsonb(v_key);
    ELSIF v_key = 'driving_license_number' THEN
      UPDATE public.profiles SET driving_license_number = v_value::text #>> '{}' WHERE id = v_request.delegate_profile_id;
      v_applied := v_applied || to_jsonb(v_key);
    ELSIF v_key = 'vehicle_license_starts_at' THEN
      UPDATE public.profiles SET vehicle_license_starts_at = (v_value::text #>> '{}')::date WHERE id = v_request.delegate_profile_id;
      v_applied := v_applied || to_jsonb(v_key);
    ELSIF v_key = 'vehicle_license_expires_at' THEN
      UPDATE public.profiles SET vehicle_license_expires_at = (v_value::text #>> '{}')::date WHERE id = v_request.delegate_profile_id;
      v_applied := v_applied || to_jsonb(v_key);
    ELSIF v_key = 'driving_license_starts_at' THEN
      UPDATE public.profiles SET driving_license_starts_at = (v_value::text #>> '{}')::date WHERE id = v_request.delegate_profile_id;
      v_applied := v_applied || to_jsonb(v_key);
    ELSIF v_key = 'driving_license_expires_at' THEN
      UPDATE public.profiles SET driving_license_expires_at = (v_value::text #>> '{}')::date WHERE id = v_request.delegate_profile_id;
      v_applied := v_applied || to_jsonb(v_key);
    ELSIF v_key = 'national_id' THEN
      UPDATE public.profiles SET national_id = v_value::text #>> '{}' WHERE id = v_request.delegate_profile_id;
      v_applied := v_applied || to_jsonb(v_key);
    END IF;
    -- Any other key → ignored (defence in depth).
  END LOOP;

  UPDATE public.turath_masr_delegate_change_requests
     SET status            = 'approved',
         admin_note        = p_admin_note,
         reviewed_by       = v_admin_uid,
         reviewed_by_name  = v_admin_name,
         reviewed_at       = now(),
         updated_at        = now()
   WHERE id = p_request_id;

  -- Notify the delegate (best-effort).
  BEGIN
    INSERT INTO public.turath_masr_notifications (type, title, message, target_user_id, created_by)
    VALUES (
      'delegate_change_request_approved',
      'تم اعتماد طلب التعديل',
      'تم اعتماد طلب تعديل بياناتك.',
      v_request.delegate_profile_id,
      v_admin_name
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'request_id',       p_request_id,
    'status',           'approved',
    'applied_fields',   v_applied,
    'reviewed_at',      now()
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.approve_delegate_change_request(uuid, text) FROM PUBLIC;
REVOKE ALL    ON FUNCTION public.approve_delegate_change_request(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.approve_delegate_change_request(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.approve_delegate_change_request(uuid, text) IS
  'Phase 23M — admin approves a pending delegate change request. '
  'SECURITY DEFINER. Re-whitelists every field before writing to '
  'profiles. Returns jsonb with applied_fields list.';


-- ─── 5) reject_delegate_change_request RPC ──────────────────────────────

CREATE OR REPLACE FUNCTION public.reject_delegate_change_request(
  p_request_id uuid,
  p_reason     text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_admin_uid   uuid := auth.uid();
  v_admin_name  text;
  v_reason      text := btrim(coalesce(p_reason, ''));
  v_request     public.turath_masr_delegate_change_requests%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;

  IF length(v_reason) = 0 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;
  IF length(v_reason) > 1000 THEN
    RAISE EXCEPTION 'reason_too_long' USING ERRCODE = '22023';
  END IF;

  SELECT full_name INTO v_admin_name FROM public.profiles WHERE id = v_admin_uid;

  SELECT * INTO v_request
    FROM public.turath_masr_delegate_change_requests
   WHERE id = p_request_id
   FOR UPDATE;

  IF v_request.id IS NULL THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = '22023';
  END IF;
  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'request_not_pending' USING ERRCODE = '54000';
  END IF;

  UPDATE public.turath_masr_delegate_change_requests
     SET status            = 'rejected',
         admin_note        = v_reason,
         reviewed_by       = v_admin_uid,
         reviewed_by_name  = v_admin_name,
         reviewed_at       = now(),
         updated_at        = now()
   WHERE id = p_request_id;

  BEGIN
    INSERT INTO public.turath_masr_notifications (type, title, message, target_user_id, created_by)
    VALUES (
      'delegate_change_request_rejected',
      'تم رفض طلب التعديل',
      'تم رفض طلب تعديل بياناتك. السبب: ' || v_reason,
      v_request.delegate_profile_id,
      v_admin_name
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'request_id',  p_request_id,
    'status',      'rejected',
    'reviewed_at', now()
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.reject_delegate_change_request(uuid, text) FROM PUBLIC;
REVOKE ALL    ON FUNCTION public.reject_delegate_change_request(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.reject_delegate_change_request(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.reject_delegate_change_request(uuid, text) IS
  'Phase 23M — admin rejects a pending delegate change request. '
  'SECURITY DEFINER. Reason is required (non-empty, ≤1000 chars).';


-- ─── 6) cancel_delegate_change_request RPC ──────────────────────────────
--
-- Either the delegate (their own row) or an admin can cancel a
-- still-pending request. Cancellation is terminal — once cancelled
-- the row stays for audit but never resurfaces in the admin queue.

CREATE OR REPLACE FUNCTION public.cancel_delegate_change_request(
  p_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_caller_uid  uuid := auth.uid();
  v_caller_name text;
  v_caller_admin boolean := public.is_admin();
  v_request     public.turath_masr_delegate_change_requests%ROWTYPE;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT full_name INTO v_caller_name FROM public.profiles WHERE id = v_caller_uid;

  SELECT * INTO v_request
    FROM public.turath_masr_delegate_change_requests
   WHERE id = p_request_id
   FOR UPDATE;

  IF v_request.id IS NULL THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = '22023';
  END IF;

  -- Authorisation: delegate of the request OR admin.
  IF v_request.delegate_profile_id <> v_caller_uid AND NOT v_caller_admin THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'request_not_pending' USING ERRCODE = '54000';
  END IF;

  UPDATE public.turath_masr_delegate_change_requests
     SET status            = 'cancelled',
         admin_note        = CASE WHEN v_caller_admin THEN 'إلغاء من قبل الإدارة' ELSE 'إلغاء بواسطة المندوب' END,
         reviewed_by       = v_caller_uid,
         reviewed_by_name  = v_caller_name,
         reviewed_at       = now(),
         updated_at        = now()
   WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'request_id',  p_request_id,
    'status',      'cancelled',
    'cancelled_at', now()
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.cancel_delegate_change_request(uuid) FROM PUBLIC;
REVOKE ALL    ON FUNCTION public.cancel_delegate_change_request(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.cancel_delegate_change_request(uuid) TO authenticated;

COMMENT ON FUNCTION public.cancel_delegate_change_request(uuid) IS
  'Phase 23M — cancel a pending delegate change request. Delegate '
  '(own request) or admin. SECURITY DEFINER. No effect on profiles.';


-- =============================================================================
-- POST-MIGRATION VERIFICATION (run manually after applying):
--
--   -- Table + indexes
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_schema='public'
--      AND table_name='turath_masr_delegate_change_requests'
--    ORDER BY ordinal_position;
--
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname='public'
--      AND tablename='turath_masr_delegate_change_requests'
--    ORDER BY indexname;
--
--   -- Policies
--   SELECT policyname, cmd FROM pg_policies
--    WHERE schemaname='public'
--      AND tablename='turath_masr_delegate_change_requests'
--    ORDER BY policyname;
--   -- expect 6 rows
--
--   -- RPCs + grants
--   SELECT proname,
--          pg_get_function_identity_arguments(oid) AS args,
--          has_function_privilege('anon',          oid, 'EXECUTE') AS anon_exec,
--          has_function_privilege('authenticated', oid, 'EXECUTE') AS auth_exec
--     FROM pg_proc
--    WHERE pronamespace = 'public'::regnamespace
--      AND proname IN (
--        'submit_delegate_change_request',
--        'approve_delegate_change_request',
--        'reject_delegate_change_request',
--        'cancel_delegate_change_request'
--      )
--    ORDER BY proname;
--   -- expect 4 rows; anon_exec=false, auth_exec=true on every one.
-- =============================================================================
