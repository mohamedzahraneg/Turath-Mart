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
//   POST { action: 'hard-delete', user_id, confirm: 'حذف نهائي' }
//         → only when `SUPABASE_SERVICE_ROLE_KEY` is set in the
//           server env. Calls `supabase.auth.admin.deleteUser()`,
//           refuses if the caller is not an admin, and writes
//           `auth_user_deleted` (or `auth_user_delete_failed`) to
//           the staff audit log. NEVER touches the matching profile
//           row; the panel sets `account_status='disabled'` on it
//           separately so audit trails for past actions remain
//           intact.
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
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HARD_DELETE_PHRASE = 'حذف نهائي';

interface AdminCheck {
  ok: boolean;
  userId: string | null;
  name: string | null;
  email: string | null;
  roleId: string | null;
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

function buildServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
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
      'id, email, full_name, role_id, role_name, account_status, disabled_at, disabled_reason'
    );
  type ProfileLite = {
    id: string;
    email: string | null;
    full_name: string | null;
    role_id: string | null;
    role_name: string | null;
    account_status: string | null;
    disabled_at: string | null;
    disabled_reason: string | null;
  };
  const profiles = (profilesData as ProfileLite[]) ?? [];
  const profileById = new Map<string, ProfileLite>(profiles.map((p) => [p.id, p]));

  // 3) Join + classify.
  const rows = authRows.map((u) => {
    const profile = profileById.get(u.id) ?? null;
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
    };
  });

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

  // ─── hard-delete ───────────────────────────────────────────────────────────
  if (body.action === 'hard-delete') {
    const userId = String(body.user_id ?? '').trim();
    const confirm = String(body.confirm ?? '').trim();
    if (!userId) {
      return NextResponse.json({ ok: false, code: 'invalid_payload' }, { status: 400 });
    }
    if (confirm !== HARD_DELETE_PHRASE) {
      return NextResponse.json({ ok: false, code: 'confirm_phrase_mismatch' }, { status: 400 });
    }
    const serviceClient = buildServiceClient();
    if (!serviceClient) {
      // Log the attempt for visibility.
      await writeAudit(supabase, {
        action: 'auth_user_delete_failed',
        actorId: admin.userId,
        actorName: admin.name,
        actorRoleId: admin.roleId,
        description: 'SUPABASE_SERVICE_ROLE_KEY غير متاح في البيئة.',
        entity: { type: 'auth_user', id: userId },
        metadata: { reason: 'service_role_unavailable' },
        ipAddress: ip,
        userAgent,
      });
      return NextResponse.json(
        {
          ok: false,
          code: 'service_role_unavailable',
          message: 'الحذف النهائي غير متاح من التطبيق الحالي. استخدم التعطيل أو أنشئ ملفًا للحساب.',
        },
        { status: 503 }
      );
    }
    // Snapshot profile (if any) before the delete so the audit row
    // captures who/what we removed.
    const { data: snapshotData } = await supabase
      .from('profiles')
      .select('id, email, full_name, role_id, role_name, account_status')
      .eq('id', userId)
      .maybeSingle();
    const hadProfile = Boolean(snapshotData);
    // Phase 26B note: when a profile exists, we DO NOT delete it.
    // Instead we flip account_status='disabled' with an explanatory
    // reason so historical audit trails + linked rows stay intact.
    if (hadProfile) {
      await supabase
        .from('profiles')
        .update({
          account_status: 'disabled',
          disabled_at: new Date().toISOString(),
          disabled_by: admin.userId,
          disabled_reason: 'auth user deleted',
        })
        .eq('id', userId);
    }
    // Now the auth-side hard delete.
    const { error: deleteErr } = await serviceClient.auth.admin.deleteUser(userId);
    if (deleteErr) {
      await writeAudit(supabase, {
        action: 'auth_user_delete_failed',
        actorId: admin.userId,
        actorName: admin.name,
        actorRoleId: admin.roleId,
        description: deleteErr.message,
        entity: { type: 'auth_user', id: userId },
        metadata: { reason: 'admin_api_error', had_profile: hadProfile },
        ipAddress: ip,
        userAgent,
      });
      return NextResponse.json(
        { ok: false, code: 'delete_failed', message: deleteErr.message },
        { status: 500 }
      );
    }
    await writeAudit(supabase, {
      action: 'auth_user_deleted',
      actorId: admin.userId,
      actorName: admin.name,
      actorRoleId: admin.roleId,
      description: `حذف نهائي من Supabase Auth`,
      entity: { type: 'auth_user', id: userId, label: snapshotData?.email ?? userId },
      metadata: {
        auth_user_id: userId,
        email: snapshotData?.email ?? null,
        had_profile: hadProfile,
        profile_disabled_instead_of_deleted: hadProfile,
      },
      ipAddress: ip,
      userAgent,
    });
    return NextResponse.json({ ok: true, code: 'deleted' }, { status: 200 });
  }

  return NextResponse.json({ ok: false, code: 'unknown_action' }, { status: 400 });
}
