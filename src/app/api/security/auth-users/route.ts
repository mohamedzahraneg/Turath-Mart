// ─────────────────────────────────────────────────────────────────────────────
// /api/security/auth-users
//
// Phase 26B — admin-only triage of `auth.users` rows. Backs the
// "الحسابات غير المرتبطة" panel in /roles → الأمان والتدقيق.
//
// Endpoints
// ---------
//   GET   → list auth users + orphan flag + matching profile snapshot.
//   POST { action: 'create-profile', user_id, full_name, role_id, role_name? }
//         → create the missing `public.profiles` row for an existing
//           auth user. Sets `account_status='active'` and writes an
//           `auth_orphan_profile_created` row to the staff audit log.
//   POST { action: 'hard-delete', ... }
//         → deprecated in Phase 26I-Fix1. Auth deletion now lives in
//           /api/security/delete-auth-user where fake/new cleanup is
//           guarded by activity checks. This legacy action returns a
//           clear block instead of retaining the wider old behavior.
//
// Service-role posture
// --------------------
// The listing path (GET) never needs the service role — it calls the
// SECURITY DEFINER RPC `public.list_auth_users_for_admin()` which
// runs as its owner and self-gates with `is_admin()`.
//
// Hard delete is the only operation that requires the service role.
// When `process.env.SUPABASE_SERVICE_ROLE_KEY` is unset the endpoint
// responds with `{ ok: false, code: 'service_role_unavailable' }`
// and the UI surfaces the Arabic message
// "الحذف النهائي غير متاح من التطبيق الحالي. استخدم التعطيل أو
// أنشئ ملفًا للحساب."
//
// Privacy
// -------
//   • Never returns tokens, refresh tokens, MFA secrets, or
//     password hashes — the RPC's projection excludes them.
//   • Never returns raw `identities` payloads.
//   • Authn cookie required for every method; anon requests get 401.
//   • Caller must be `public.is_admin()` for every operation —
//     enforced via direct profile lookup (defence in depth) before
//     any service-role call.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface AdminCheck {
  ok: boolean;
  userId: string | null;
  name: string | null;
  email: string | null;
  roleId: string | null;
}

type ProfileLite = {
  id: string;
  email: string | null;
  full_name: string | null;
  role_id: string | null;
  role_name: string | null;
  account_status: string | null;
  disabled_at: string | null;
  disabled_reason: string | null;
  created_at?: string | null;
};

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

async function requireAdmin(): Promise<AdminCheck> {
  const supabase = buildAuthedClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user ?? null;
  if (!user) {
    return { ok: false, userId: null, name: null, email: null, roleId: null };
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, role_id, email')
    .eq('id', user.id)
    .single();
  const roleId = (profile as { role_id?: string | null } | null)?.role_id ?? null;
  // Admin gate. We rely on the same `r1` convention as
  // `public.is_admin()`. Server-side fail-closed.
  const ok = roleId === 'r1';
  return {
    ok,
    userId: user.id,
    name: (profile as { full_name?: string | null } | null)?.full_name ?? user.email ?? null,
    email: (profile as { email?: string | null } | null)?.email ?? user.email ?? null,
    roleId,
  };
}

/**
 * Best-effort audit write. Mirrors `src/lib/security/staffAudit.ts`
 * but is duplicated here so the API route doesn't pull in the
 * client-bundled module.
 */
async function writeAudit(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  input: {
    action: string;
    actorId?: string | null;
    actorName?: string | null;
    actorRoleId?: string | null;
    description?: string | null;
    entity?: { type?: string; id?: string; label?: string };
    metadata?: Record<string, unknown>;
    ipAddress?: string | null;
    userAgent?: string | null;
  }
) {
  try {
    await supabase.from('turath_masr_staff_audit_logs').insert({
      actor_id: input.actorId ?? null,
      actor_name: input.actorName ?? null,
      actor_role_id: input.actorRoleId ?? null,
      action: input.action,
      entity_type: input.entity?.type ?? null,
      entity_id: input.entity?.id ?? null,
      entity_label: input.entity?.label ?? null,
      description: input.description ?? null,
      metadata: input.metadata ?? {},
      ip_address: input.ipAddress ?? null,
      user_agent: input.userAgent ?? null,
    });
  } catch (err) {
    console.warn('[auth-users] audit write failed:', err);
  }
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

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

function isFakeEmail(email: string | null | undefined): boolean {
  const value = normalizeEmail(email);
  if (!value) return false;
  if (!value.includes('@')) return true;
  const [local, domain = ''] = value.split('@');
  if (!local || !domain || !domain.includes('.')) return true;
  const tokens = ['test', 'fake', 'demo', 'placeholder', 'sample', 'dummy', 'tmp', 'tester'];
  if (tokens.some((token) => value.includes(token))) return true;
  return [
    'turathmart.internal',
    'zahranship.com',
    'example.com',
    'example.net',
    'example.org',
    'invalid.com',
    'mailinator.com',
  ].some((d) => domain === d || domain.endsWith(`.${d}`));
}

function hasPlaceholderName(name: string | null | undefined): boolean {
  return /(test|demo|fake|sample|tmp|tester|user\s*\d+)/i.test((name ?? '').trim());
}

function isRecent(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return false;
  return Date.now() - time <= 14 * 24 * 60 * 60 * 1000;
}

async function safeCountMaybe(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  table: string,
  column: string,
  value: string
): Promise<number | null> {
  try {
    const { count, error } = await supabase
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq(column, value);
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

async function summarizeDeleteSafety(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  row: {
    id: string;
    email: string | null;
    created_at: string | null;
    last_sign_in_at: string | null;
    profile: ProfileLite | null;
  },
  duplicateEmail: boolean
) {
  const checks = await Promise.all([
    safeCountMaybe(supabase, 'turath_masr_login_events', 'user_id', row.id),
    safeCountMaybe(supabase, 'turath_masr_user_devices', 'user_id', row.id),
    safeCountMaybe(supabase, 'turath_masr_staff_audit_logs', 'actor_id', row.id),
    safeCountMaybe(supabase, 'turath_masr_orders', 'created_by_user_id', row.id),
    safeCountMaybe(supabase, 'turath_masr_orders', 'assigned_to', row.id),
    safeCountMaybe(supabase, 'turath_masr_orders', 'updated_by', row.id),
  ]);
  const [loginEvents, devices, actorEvents, createdOrders, assignedOrders, updatedOrders] = checks;
  const activityUnknown = checks.some((v) => v === null);
  const operationalRefs = (createdOrders ?? 0) + (assignedOrders ?? 0) + (updatedOrders ?? 0);
  const fake =
    isFakeEmail(row.email) ||
    isFakeEmail(row.profile?.email) ||
    hasPlaceholderName(row.profile?.full_name);
  const recent = isRecent(row.created_at) || isRecent(row.profile?.created_at);
  const neverUsed = (loginEvents ?? 1) === 0 && (devices ?? 1) === 0 && !row.last_sign_in_at;
  const noCritical = (actorEvents ?? 1) === 0 && operationalRefs === 0 && !activityUnknown;

  let allowed = false;
  let category: string | null = null;
  let blockedReason = 'الحساب ليس ضمن نطاق الحذف الآمن. استخدم التعطيل بدلًا من الحذف.';
  if (activityUnknown) {
    blockedReason = 'تعذر التحقق من نشاط الحساب؛ الحذف محجوب احتياطيًا.';
  } else if (!noCritical) {
    blockedReason = 'يوجد نشاط تشغيلي أو تدقيق مرتبط بالحساب.';
  } else if (!row.profile && (neverUsed || fake || recent)) {
    allowed = true;
    category = 'auth_only_orphan';
    blockedReason = '';
  } else if (row.profile && fake && (neverUsed || recent)) {
    allowed = true;
    category = 'new_fake_profile_backed';
    blockedReason = '';
  } else if (row.profile && duplicateEmail && neverUsed && recent) {
    allowed = true;
    category = 'new_duplicate_or_mistyped';
    blockedReason = '';
  }

  return {
    allowed,
    category,
    blocked_reason: blockedReason || null,
    activity_summary: {
      login_events: loginEvents,
      devices,
      staff_audit_actor_events: actorEvents,
      operational_refs_total: operationalRefs,
      activity_unknown: activityUnknown,
    },
  };
}

// ─── GET — list auth users + orphan flag ─────────────────────────────────────

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!admin.ok) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const supabase = buildAuthedClient();

  // 1) Pull auth users via the SECURITY DEFINER RPC.
  const { data: authRowsData, error: rpcErr } = await supabase.rpc('list_auth_users_for_admin');
  if (rpcErr) {
    console.error('[auth-users] RPC failed:', rpcErr);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
  const authRows =
    (authRowsData as Array<{
      id: string;
      email: string | null;
      created_at: string | null;
      last_sign_in_at: string | null;
      email_confirmed_at: string | null;
      banned_until: string | null;
      deleted_at: string | null;
    }>) ?? [];

  // 2) Pull profiles (admin select policy allows this).
  const { data: profilesData } = await supabase
    .from('profiles')
    .select(
      'id, email, full_name, role_id, role_name, account_status, disabled_at, disabled_reason, created_at'
    );
  const profiles = (profilesData as ProfileLite[]) ?? [];
  const profileById = new Map<string, ProfileLite>(profiles.map((p) => [p.id, p]));

  const emailCounts = new Map<string, number>();
  for (const u of authRows) {
    const email = normalizeEmail(u.email);
    if (email) emailCounts.set(email, (emailCounts.get(email) ?? 0) + 1);
  }
  for (const p of profiles) {
    const email = normalizeEmail(p.email);
    if (email) emailCounts.set(email, (emailCounts.get(email) ?? 0) + 1);
  }

  // 3) Join + classify.
  const rows = await Promise.all(
    authRows.map(async (u) => {
      const profile = profileById.get(u.id) ?? null;
      const emailKey = normalizeEmail(u.email ?? profile?.email);
      const duplicateEmail = Boolean(emailKey && (emailCounts.get(emailKey) ?? 0) > 1);
      const deleteSafety = await summarizeDeleteSafety(
        supabase,
        {
          id: u.id,
          email: u.email,
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at,
          profile,
        },
        duplicateEmail
      );
      return {
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        email_confirmed_at: u.email_confirmed_at,
        banned_until: u.banned_until,
        deleted_at: u.deleted_at,
        has_profile: profile !== null,
        profile,
        delete_safety: deleteSafety,
      };
    })
  );

  return NextResponse.json(
    {
      ok: true,
      service_role_available: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      counts: {
        auth_total: rows.length,
        profiles_total: profiles.length,
        orphans: rows.filter((r) => !r.has_profile).length,
      },
      rows,
    },
    { status: 200 }
  );
}

// ─── POST — create-profile / hard-delete ─────────────────────────────────────

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!admin.ok) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let body: {
    action?: string;
    user_id?: string;
    full_name?: string;
    role_id?: string;
    role_name?: string;
    confirm?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  const ip = readClientIp(request);
  const userAgent = request.headers.get('user-agent') ?? null;
  const supabase = buildAuthedClient();

  // ─── create-profile ────────────────────────────────────────────────────────
  if (body.action === 'create-profile') {
    const userId = String(body.user_id ?? '').trim();
    const fullName = String(body.full_name ?? '').trim();
    const roleId = String(body.role_id ?? '').trim();
    const roleName = String(body.role_name ?? '').trim() || null;
    if (!userId || !fullName || !roleId) {
      return NextResponse.json(
        { ok: false, code: 'invalid_payload', message: 'مطلوب: user_id, full_name, role_id' },
        { status: 400 }
      );
    }

    // Confirm the auth user actually exists (via RPC again — it's
    // narrow, indexed, and admin-only).
    const { data: authRowsData } = await supabase.rpc('list_auth_users_for_admin');
    const authRows = (authRowsData as Array<{ id: string; email: string | null }>) ?? [];
    const target = authRows.find((u) => u.id === userId);
    if (!target) {
      return NextResponse.json({ ok: false, code: 'auth_user_not_found' }, { status: 404 });
    }
    // Guard: profile must not already exist.
    const { data: existing } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ ok: false, code: 'profile_already_exists' }, { status: 409 });
    }
    const { error: insertErr } = await supabase.from('profiles').insert({
      id: userId,
      email: target.email,
      full_name: fullName,
      role_id: roleId,
      role_name: roleName,
      account_status: 'active',
    });
    if (insertErr) {
      console.error('[auth-users] create-profile insert failed:', insertErr);
      return NextResponse.json(
        { ok: false, code: 'insert_failed', message: insertErr.message },
        { status: 500 }
      );
    }
    await writeAudit(supabase, {
      action: 'auth_orphan_profile_created',
      actorId: admin.userId,
      actorName: admin.name,
      actorRoleId: admin.roleId,
      description: `أُنشئ ملف موظف للحساب ${target.email ?? userId}`,
      entity: { type: 'profile', id: userId, label: fullName },
      metadata: {
        auth_user_id: userId,
        email: target.email,
        role_id: roleId,
        role_name: roleName,
      },
      ipAddress: ip,
      userAgent,
    });
    return NextResponse.json({ ok: true, code: 'created' }, { status: 200 });
  }

  // ─── hard-delete deprecated ────────────────────────────────────────────────
  if (body.action === 'hard-delete') {
    await writeAudit(supabase, {
      action: 'auth_user_delete_blocked',
      actorId: admin.userId,
      actorName: admin.name,
      actorRoleId: admin.roleId,
      description: 'تم منع مسار حذف قديم. استخدم /api/security/delete-auth-user.',
      entity: { type: 'auth_user', id: String(body.user_id ?? '').trim() || undefined },
      metadata: {
        target_user_id: String(body.user_id ?? '').trim() || null,
        blocked_reason: 'legacy_hard_delete_route_disabled',
      },
      ipAddress: ip,
      userAgent,
    });
    return NextResponse.json(
      {
        ok: false,
        code: 'legacy_route_disabled',
        message: 'تم نقل الحذف النهائي إلى مسار أكثر أمانًا يتحقق من نشاط الحساب أولًا.',
      },
      { status: 410 }
    );
  }

  return NextResponse.json({ ok: false, code: 'unknown_action' }, { status: 400 });
}
