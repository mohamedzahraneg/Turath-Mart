// ─────────────────────────────────────────────────────────────────────────────
// POST /api/security/session-event
//
// Phase 26A — staff login / logout / refresh tracking + device control.
//
// What it does
// ------------
// AuthContext POSTs to this endpoint:
//   • On a successful sign-in     → { type: 'login',   fingerprint, label, userAgent }
//   • On a fresh page load / SWR  → { type: 'refresh', fingerprint, label, userAgent }
//   • On sign-out                  → { type: 'logout',  fingerprint, label, userAgent }
//
// The endpoint:
//   1. Confirms the caller is authenticated via the SSR cookie. Anon
//      callers get 401.
//   2. Reads the caller's profile (account_status + role + name).
//   3. If `account_status` is not `active`, refuses + asks the
//      client to sign out. The login_event is still logged with
//      `success=false, failure_reason='account_<status>'`.
//   4. Upserts the device into `turath_masr_user_devices` (incrementing
//      `login_count` on logins, refreshing `last_seen_at` on every
//      type). Enforces the per-user `turath_masr_user_device_policies`:
//        - `allowed_device_count` cap → reject when exceeded
//        - `require_known_device` → new devices land as `pending`
//        - `auto_block_new_devices` → new devices land as `blocked`
//   5. If the device row's `status` is `blocked`, refuses + asks the
//      client to sign out and writes a `blocked_device` login event.
//   6. Logs the event into `turath_masr_login_events`.
//
// Privacy / safety
// ----------------
//   • Never reads tokens; the SSR client gives us `auth.uid()` only.
//   • IP capture is server-side via `x-forwarded-for` → `x-real-ip` →
//     no fallback. No external IP-geolocation lookup is performed.
//   • The endpoint is best-effort. A failure inside the upsert /
//     insert is logged but the caller is told success=true unless the
//     account or device is explicitly blocked — we never lock a user
//     out because of a DB hiccup on the audit path.
//
// Response shape
// --------------
//   200 { ok: true,  blocked: false }                  — normal flow
//   200 { ok: false, blocked: true,  reason: '...' }   — sign-out the client
//   401 { error: 'unauthorized' }                       — no session
//   400 { error: 'invalid_payload' }                    — body is malformed
//   500 { error: 'internal_error' }                     — anything else
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type EventType = 'login' | 'logout' | 'refresh';
const VALID_EVENT_TYPES: ReadonlyArray<EventType> = ['login', 'logout', 'refresh'];

interface SessionEventBody {
  type: EventType;
  fingerprint?: string | null;
  label?: string | null;
  userAgent?: string | null;
}

function buildAuthedClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name) {
          return (
            cookieStore as unknown as { get: (n: string) => { value?: string } | undefined }
          ).get(name)?.value;
        },
        set() {
          /* no-op */
        },
        remove() {
          /* no-op */
        },
      },
    }
  );
}

function readClientIp(request: Request): string | null {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get('x-real-ip');
  if (real && real.trim()) return real.trim();
  return null;
}

function safeString(value: unknown, maxLen: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, maxLen);
}

export async function POST(request: Request) {
  let payload: SessionEventBody;
  try {
    payload = (await request.json()) as SessionEventBody;
  } catch {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  const eventType = VALID_EVENT_TYPES.includes(payload?.type as EventType)
    ? (payload.type as EventType)
    : null;
  if (!eventType) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  const fingerprint = safeString(payload.fingerprint, 200);
  const deviceLabel = safeString(payload.label, 120);
  const userAgent = safeString(payload.userAgent, 512);
  const ipAddress = readClientIp(request);

  const supabase = buildAuthedClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const user = userData.user;

  // Profile lookup — drives the account_status gate. RLS allows the
  // user to SELECT their own profile via `profiles_own_select`.
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, full_name, role_id, role_name, account_status')
    .eq('id', user.id)
    .single();

  const userEmail = profile?.email || user.email || null;
  const userName = profile?.full_name || null;

  // Gate 1 — account status. Disabled / suspended / pending accounts
  // are not allowed to use the app. Log + reject.
  const accountStatus = (profile as { account_status?: string } | null)?.account_status ?? 'active';
  if (accountStatus !== 'active') {
    await supabase.from('turath_masr_login_events').insert({
      user_id: user.id,
      user_email: userEmail,
      user_name: userName,
      event_type: 'blocked_device',
      success: false,
      failure_reason: `account_${accountStatus}`,
      ip_address: ipAddress,
      user_agent: userAgent,
      device_fingerprint: fingerprint,
      device_label: deviceLabel,
    });
    return NextResponse.json(
      { ok: false, blocked: true, reason: `account_${accountStatus}` },
      { status: 200 }
    );
  }

  // Gate 2 — device controls. Skipped entirely when the client could
  // not generate a fingerprint (SSR / private mode). Such requests
  // still log a login_event so admins see them, but cannot be tied to
  // a device.
  let deviceStatus: 'allowed' | 'blocked' | 'pending' = 'allowed';
  if (fingerprint) {
    // Load (or create) the device policy + device row for this user.
    const { data: policyRow } = await supabase
      .from('turath_masr_user_device_policies')
      .select('allowed_device_count, require_known_device, auto_block_new_devices')
      .eq('user_id', user.id)
      .maybeSingle();
    const policy = policyRow as {
      allowed_device_count: number | null;
      require_known_device: boolean;
      auto_block_new_devices: boolean;
    } | null;

    const { data: existingDevice } = await supabase
      .from('turath_masr_user_devices')
      .select('id, status, login_count, blocked_reason')
      .eq('user_id', user.id)
      .eq('device_fingerprint', fingerprint)
      .maybeSingle();

    const isLogin = eventType === 'login';

    if (existingDevice) {
      const ed = existingDevice as {
        id: string;
        status: 'allowed' | 'blocked' | 'pending';
        login_count: number;
        blocked_reason: string | null;
      };
      deviceStatus = ed.status;
      // Refresh last_seen_at + bump login_count on login.
      const update: Record<string, unknown> = {
        last_seen_at: new Date().toISOString(),
        last_ip: ipAddress,
      };
      if (deviceLabel) update.device_label = deviceLabel;
      if (userAgent) update.user_agent = userAgent;
      if (isLogin) update.login_count = ed.login_count + 1;
      await supabase.from('turath_masr_user_devices').update(update).eq('id', ed.id);
    } else {
      // New device — decide initial status from policy.
      let initialStatus: 'allowed' | 'blocked' | 'pending' = 'allowed';
      if (policy?.auto_block_new_devices) {
        initialStatus = 'blocked';
      } else if (policy?.require_known_device) {
        initialStatus = 'pending';
      }

      // Hard cap on device count — block when over the limit.
      if (
        initialStatus === 'allowed' &&
        policy?.allowed_device_count &&
        policy.allowed_device_count >= 1
      ) {
        const { count: currentAllowed } = await supabase
          .from('turath_masr_user_devices')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('status', 'allowed');
        if ((currentAllowed ?? 0) >= policy.allowed_device_count) {
          initialStatus = 'pending';
        }
      }
      deviceStatus = initialStatus;

      await supabase.from('turath_masr_user_devices').insert({
        user_id: user.id,
        device_fingerprint: fingerprint,
        device_label: deviceLabel,
        user_agent: userAgent,
        first_ip: ipAddress,
        last_ip: ipAddress,
        login_count: isLogin ? 1 : 0,
        status: initialStatus,
      });
    }
  }

  // Persist the login event regardless of device gate result.
  const persistedEventType: 'login' | 'logout' | 'refresh' | 'blocked_device' =
    deviceStatus === 'blocked' ? 'blocked_device' : eventType;
  await supabase.from('turath_masr_login_events').insert({
    user_id: user.id,
    user_email: userEmail,
    user_name: userName,
    event_type: persistedEventType,
    success: deviceStatus !== 'blocked',
    failure_reason: deviceStatus === 'blocked' ? 'device_blocked' : null,
    ip_address: ipAddress,
    user_agent: userAgent,
    device_fingerprint: fingerprint,
    device_label: deviceLabel,
  });

  if (deviceStatus === 'blocked') {
    return NextResponse.json(
      { ok: false, blocked: true, reason: 'device_blocked' },
      { status: 200 }
    );
  }
  if (deviceStatus === 'pending') {
    return NextResponse.json(
      { ok: false, blocked: true, reason: 'device_pending_review' },
      { status: 200 }
    );
  }
  return NextResponse.json({ ok: true, blocked: false }, { status: 200 });
}
