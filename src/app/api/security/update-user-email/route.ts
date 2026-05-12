// ─────────────────────────────────────────────────────────────────────────────
// /api/security/update-user-email
//
// Phase 26I — server-only login-email correction.
// Auth email is the source of truth; profiles.email is only synced
// after the Supabase Auth admin update succeeds. No passwords,
// tokens, raw metadata, deletes, or browser-side auth admin calls.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

async function requireAdmin() {
  const supabase = buildAuthedClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user ?? null;
  if (!user) return { ok: false, userId: null, name: null, email: null, roleId: null };
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, role_id, email')
    .eq('id', user.id)
    .single();
  const roleId = (profile as { role_id?: string | null } | null)?.role_id ?? null;
  return {
    ok: roleId === 'r1',
    userId: user.id,
    name: (profile as { full_name?: string | null } | null)?.full_name ?? user.email ?? null,
    email: (profile as { email?: string | null } | null)?.email ?? user.email ?? null,
    roleId,
  };
}

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
    console.warn('[update-user-email] audit write failed:', err);
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

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!admin.ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  let body: { user_id?: string; new_email?: string; force_password_change?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: 'invalid_payload' }, { status: 400 });
  }

  const userId = String(body.user_id ?? '').trim();
  const newEmail = normalizeEmail(body.new_email);
  const forcePasswordChange = body.force_password_change !== false;
  const ip = readClientIp(request);
  const userAgent = request.headers.get('user-agent') ?? null;
  const supabase = buildAuthedClient();

  if (!userId || !newEmail || !isValidEmail(newEmail)) {
    return NextResponse.json(
      { ok: false, code: 'invalid_payload', message: 'صيغة البريد الإلكتروني غير صحيحة.' },
      { status: 400 }
    );
  }

  await writeAudit(supabase, {
    action: 'staff.email_change_requested',
    actorId: admin.userId,
    actorName: admin.name,
    actorRoleId: admin.roleId,
    description: 'تم طلب تغيير بريد تسجيل الدخول للموظف.',
    entity: { type: 'profile', id: userId },
    metadata: { target_user_id: userId, new_email: newEmail },
    ipAddress: ip,
    userAgent,
  });

  const serviceClient = buildServiceClient();
  if (!serviceClient) {
    await writeAudit(supabase, {
      action: 'staff.email_change_failed',
      actorId: admin.userId,
      actorName: admin.name,
      actorRoleId: admin.roleId,
      description: 'SUPABASE_SERVICE_ROLE_KEY غير متاح في البيئة.',
      entity: { type: 'profile', id: userId },
      metadata: { target_user_id: userId, new_email: newEmail, reason: 'service_role_unavailable' },
      ipAddress: ip,
      userAgent,
    });
    return NextResponse.json(
      {
        ok: false,
        code: 'service_role_unavailable',
        message: 'تعديل بريد تسجيل الدخول يحتاج صلاحية Auth Admin / Service Role غير مفعلة حاليًا',
      },
      { status: 503 }
    );
  }

  const { data: authRowsData, error: authRowsErr } = await supabase.rpc(
    'list_auth_users_for_admin'
  );
  if (authRowsErr) {
    await writeAudit(supabase, {
      action: 'staff.email_change_failed',
      actorId: admin.userId,
      actorName: admin.name,
      actorRoleId: admin.roleId,
      description: 'تعذر قراءة مستخدمي Auth قبل تغيير البريد.',
      entity: { type: 'profile', id: userId },
      metadata: { target_user_id: userId, new_email: newEmail, reason: 'auth_list_failed' },
      ipAddress: ip,
      userAgent,
    });
    return NextResponse.json({ ok: false, code: 'auth_list_failed' }, { status: 500 });
  }
  const authRows = (authRowsData as Array<{ id: string; email: string | null }>) ?? [];
  const targetAuth = authRows.find((u) => u.id === userId) ?? null;
  if (!targetAuth) {
    return NextResponse.json(
      { ok: false, code: 'auth_user_not_found', message: 'حساب Auth غير موجود لهذا الموظف.' },
      { status: 404 }
    );
  }
  const oldAuthEmail = normalizeEmail(targetAuth.email);
  if (oldAuthEmail === newEmail) {
    return NextResponse.json({ ok: true, code: 'unchanged' }, { status: 200 });
  }
  const authDuplicate = authRows.some(
    (u) => u.id !== userId && normalizeEmail(u.email) === newEmail
  );
  if (authDuplicate) {
    return NextResponse.json(
      { ok: false, code: 'duplicate_email', message: 'البريد مستخدم بالفعل في Auth.' },
      { status: 409 }
    );
  }

  const { data: targetProfile } = await supabase
    .from('profiles')
    .select('id, email, full_name, role_id, account_status')
    .eq('id', userId)
    .maybeSingle();
  if (!targetProfile) {
    return NextResponse.json(
      { ok: false, code: 'profile_not_found', message: 'ملف الموظف غير موجود.' },
      { status: 404 }
    );
  }
  const targetRoleId = (targetProfile as { role_id?: string | null }).role_id ?? null;
  const targetStatus =
    (targetProfile as { account_status?: string | null }).account_status ?? 'active';
  if (targetRoleId === 'r1' && targetStatus === 'active') {
    const { count: activeAdminCount } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role_id', 'r1')
      .eq('account_status', 'active');
    if ((activeAdminCount ?? 0) <= 1) {
      await writeAudit(supabase, {
        action: 'staff.email_change_failed',
        actorId: admin.userId,
        actorName: admin.name,
        actorRoleId: admin.roleId,
        description: 'تم منع تغيير بريد آخر مدير نشط لتجنب قفل الإدارة.',
        entity: { type: 'profile', id: userId, label: targetProfile.full_name ?? newEmail },
        metadata: {
          target_user_id: userId,
          old_email: oldAuthEmail,
          new_email: newEmail,
          reason: 'last_active_admin_guard',
        },
        ipAddress: ip,
        userAgent,
      });
      return NextResponse.json(
        {
          ok: false,
          code: 'last_active_admin_guard',
          message: 'لا يمكن تغيير بريد آخر مدير نشط قبل إضافة مدير نشط آخر.',
        },
        { status: 409 }
      );
    }
  }

  const { data: duplicateProfiles } = await supabase
    .from('profiles')
    .select('id')
    .ilike('email', newEmail);
  const profileDuplicate = ((duplicateProfiles as Array<{ id: string }>) ?? []).some(
    (p) => p.id !== userId
  );
  if (profileDuplicate) {
    return NextResponse.json(
      { ok: false, code: 'duplicate_email', message: 'البريد مستخدم بالفعل في ملف موظف آخر.' },
      { status: 409 }
    );
  }

  const { error: authUpdateErr } = await serviceClient.auth.admin.updateUserById(userId, {
    email: newEmail,
  });
  if (authUpdateErr) {
    await writeAudit(supabase, {
      action: 'staff.email_change_failed',
      actorId: admin.userId,
      actorName: admin.name,
      actorRoleId: admin.roleId,
      description: authUpdateErr.message,
      entity: { type: 'profile', id: userId, label: targetProfile.full_name ?? newEmail },
      metadata: {
        target_user_id: userId,
        old_email: oldAuthEmail,
        new_email: newEmail,
        reason: 'auth_update_failed',
      },
      ipAddress: ip,
      userAgent,
    });
    return NextResponse.json(
      { ok: false, code: 'auth_update_failed', message: authUpdateErr.message },
      { status: 500 }
    );
  }

  const profileUpdate: Record<string, unknown> = { email: newEmail };
  if (forcePasswordChange) profileUpdate.must_change_password = true;
  const { error: profileUpdateErr } = await serviceClient
    .from('profiles')
    .update(profileUpdate)
    .eq('id', userId);
  if (profileUpdateErr) {
    if (oldAuthEmail) {
      await serviceClient.auth.admin.updateUserById(userId, { email: oldAuthEmail });
    }
    await writeAudit(supabase, {
      action: 'staff.email_change_failed',
      actorId: admin.userId,
      actorName: admin.name,
      actorRoleId: admin.roleId,
      description: profileUpdateErr.message,
      entity: { type: 'profile', id: userId, label: targetProfile.full_name ?? newEmail },
      metadata: {
        target_user_id: userId,
        old_email: oldAuthEmail,
        new_email: newEmail,
        reason: 'profile_sync_failed',
        rollback_attempted: Boolean(oldAuthEmail),
      },
      ipAddress: ip,
      userAgent,
    });
    return NextResponse.json(
      {
        ok: false,
        code: 'profile_sync_failed',
        message: 'تم رفض مزامنة بريد الملف؛ لم يتم ترك تحديث جزئي.',
      },
      { status: 500 }
    );
  }

  await writeAudit(supabase, {
    action: 'staff.email_changed',
    actorId: admin.userId,
    actorName: admin.name,
    actorRoleId: admin.roleId,
    description: 'تم تغيير بريد تسجيل الدخول ومزامنة بريد الملف.',
    entity: { type: 'profile', id: userId, label: targetProfile.full_name ?? newEmail },
    metadata: {
      target_user_id: userId,
      old_email: oldAuthEmail,
      new_email: newEmail,
      profile_email_synced: true,
      must_change_password: forcePasswordChange,
    },
    ipAddress: ip,
    userAgent,
  });

  return NextResponse.json({ ok: true, code: 'updated' }, { status: 200 });
}
