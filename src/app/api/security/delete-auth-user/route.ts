// ─────────────────────────────────────────────────────────────────────────────
// /api/security/delete-auth-user
//
// Phase 26I-Fix1 — narrowly-scoped Auth cleanup for fake/new accounts.
// Uses the service role only on the server. It never deletes profile
// rows or operational data; profile-backed cleanup disables the profile
// after Auth deletion so audit and linked records remain intact.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CONFIRMATION_PHRASE = 'حذف نهائي';
const RECENT_ACCOUNT_DAYS = 14;

type SafeDeleteCategory =
  | 'auth_only_orphan'
  | 'new_fake_profile_backed'
  | 'new_duplicate_or_mistyped';

interface AdminCheck {
  ok: boolean;
  userId: string | null;
  name: string | null;
  email: string | null;
  roleId: string | null;
}

interface AuthUserLite {
  id: string;
  email: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
}

interface ProfileLite {
  id: string;
  email: string | null;
  full_name: string | null;
  role_id: string | null;
  role_name: string | null;
  account_status: string | null;
  created_at?: string | null;
}

interface ActivitySummary {
  login_events: number;
  devices: number;
  staff_audit_actor_events: number;
  operational_refs: Record<string, number>;
  operational_refs_total: number;
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
    console.warn('[delete-auth-user] audit write failed:', err);
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
  const placeholderDomains = [
    'turathmart.internal',
    'zahranship.com',
    'example.com',
    'example.net',
    'example.org',
    'invalid.com',
    'mailinator.com',
  ];
  return placeholderDomains.some((d) => domain === d || domain.endsWith(`.${d}`));
}

function hasPlaceholderName(name: string | null | undefined): boolean {
  return /(test|demo|fake|sample|tmp|tester|user\s*\d+)/i.test((name ?? '').trim());
}

function isRecent(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return false;
  return Date.now() - time <= RECENT_ACCOUNT_DAYS * 24 * 60 * 60 * 1000;
}

async function safeCount(
  supabase: SupabaseClient,
  table: string,
  column: string,
  value: string
): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq(column, value);
  if (error) {
    throw new Error(`activity_check_failed:${table}.${column}:${error.message}`);
  }
  return count ?? 0;
}

async function buildActivitySummary(
  supabase: SupabaseClient,
  userId: string
): Promise<ActivitySummary> {
  const operationalChecks: Array<[string, string]> = [
    ['turath_masr_orders', 'created_by_user_id'],
    ['turath_masr_orders', 'assigned_to'],
    ['turath_masr_orders', 'updated_by'],
    ['turath_masr_customer_notes', 'created_by'],
    ['turath_masr_customer_tasks', 'created_by'],
    ['turath_masr_customer_tasks', 'assigned_to'],
    ['turath_masr_delegate_change_requests', 'delegate_profile_id'],
    ['turath_masr_delegate_change_requests', 'requested_by'],
    ['turath_masr_delegate_change_requests', 'reviewed_by'],
    ['turath_masr_delegate_expenses', 'delegate_profile_id'],
    ['turath_masr_delegate_expenses', 'approved_by'],
    ['turath_masr_delegate_expenses', 'reviewed_by'],
    ['turath_masr_delegate_expenses', 'voided_by'],
    ['turath_masr_delegate_ratings', 'assigned_to'],
  ];

  const [loginEvents, devices, actorEvents] = await Promise.all([
    safeCount(supabase, 'turath_masr_login_events', 'user_id', userId),
    safeCount(supabase, 'turath_masr_user_devices', 'user_id', userId),
    safeCount(supabase, 'turath_masr_staff_audit_logs', 'actor_id', userId),
  ]);

  const operationalRefs: Record<string, number> = {};
  for (const [table, column] of operationalChecks) {
    const count = await safeCount(supabase, table, column, userId);
    if (count > 0) operationalRefs[`${table}.${column}`] = count;
  }

  const operationalRefsTotal = Object.values(operationalRefs).reduce((sum, n) => sum + n, 0);
  return {
    login_events: loginEvents,
    devices,
    staff_audit_actor_events: actorEvents,
    operational_refs: operationalRefs,
    operational_refs_total: operationalRefsTotal,
  };
}

function classifySafeDelete(input: {
  authUser: AuthUserLite;
  profile: ProfileLite | null;
  duplicateEmail: boolean;
  activity: ActivitySummary;
}): { allowed: true; category: SafeDeleteCategory } | { allowed: false; reason: string } {
  const { authUser, profile, duplicateEmail, activity } = input;
  const fake =
    isFakeEmail(authUser.email) ||
    isFakeEmail(profile?.email) ||
    hasPlaceholderName(profile?.full_name);
  const recent = isRecent(authUser.created_at) || isRecent(profile?.created_at);
  const neverUsed =
    activity.login_events === 0 && activity.devices === 0 && !authUser.last_sign_in_at;
  const noCriticalActivity =
    activity.staff_audit_actor_events === 0 && activity.operational_refs_total === 0;

  if (!noCriticalActivity) {
    return { allowed: false, reason: 'يوجد نشاط تشغيلي أو تدقيق مرتبط بالحساب.' };
  }

  if (!profile) {
    if (neverUsed || fake || recent) return { allowed: true, category: 'auth_only_orphan' };
    return {
      allowed: false,
      reason: 'الحساب غير مرتبط لكنه ليس جديدًا/وهميًا ولم يثبت أنه غير مستخدم.',
    };
  }

  if (fake && (neverUsed || recent)) {
    return { allowed: true, category: 'new_fake_profile_backed' };
  }

  if (duplicateEmail && neverUsed && recent) {
    return { allowed: true, category: 'new_duplicate_or_mistyped' };
  }

  return {
    allowed: false,
    reason: 'الحساب ليس ضمن نطاق الحذف الآمن. استخدم التعطيل بدلًا من الحذف.',
  };
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!admin.ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  let body: { user_id?: string; confirmation?: string; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: 'invalid_payload' }, { status: 400 });
  }

  const userId = String(body.user_id ?? '').trim();
  const confirmation = String(body.confirmation ?? '').trim();
  const reason = String(body.reason ?? '').trim();
  const ip = readClientIp(request);
  const userAgent = request.headers.get('user-agent') ?? null;
  const supabase = buildAuthedClient();

  if (!userId || !reason) {
    return NextResponse.json(
      { ok: false, code: 'invalid_payload', message: 'مطلوب: user_id وسبب الحذف.' },
      { status: 400 }
    );
  }

  if (confirmation !== CONFIRMATION_PHRASE) {
    return NextResponse.json(
      { ok: false, code: 'confirm_phrase_mismatch', message: 'عبارة التأكيد غير مطابقة.' },
      { status: 400 }
    );
  }

  await writeAudit(supabase, {
    action: 'auth_user_delete_requested',
    actorId: admin.userId,
    actorName: admin.name,
    actorRoleId: admin.roleId,
    description: reason,
    entity: { type: 'auth_user', id: userId },
    metadata: { target_user_id: userId, reason },
    ipAddress: ip,
    userAgent,
  });

  if (userId === admin.userId) {
    return blockDelete(supabase, admin, request, userId, reason, 'لا يمكن حذف حسابك الحالي.');
  }

  const serviceClient = buildServiceClient();
  if (!serviceClient) {
    return blockDelete(
      supabase,
      admin,
      request,
      userId,
      reason,
      'الحذف النهائي غير متاح لأن مفتاح Service Role غير مفعّل على السيرفر',
      'service_role_unavailable',
      503
    );
  }

  const { data: authRowsData, error: authRowsErr } = await supabase.rpc(
    'list_auth_users_for_admin'
  );
  if (authRowsErr) {
    return blockDelete(
      supabase,
      admin,
      request,
      userId,
      reason,
      'تعذر قراءة حسابات Auth قبل الحذف.',
      'auth_list_failed',
      500
    );
  }
  const authRows = (authRowsData as AuthUserLite[]) ?? [];
  const authUser = authRows.find((u) => u.id === userId) ?? null;
  if (!authUser) {
    return blockDelete(
      supabase,
      admin,
      request,
      userId,
      reason,
      'حساب Auth غير موجود.',
      'auth_user_not_found',
      404
    );
  }

  const { data: profileData } = await supabase
    .from('profiles')
    .select('id, email, full_name, role_id, role_name, account_status, created_at')
    .eq('id', userId)
    .maybeSingle();
  const profile = (profileData as ProfileLite | null) ?? null;

  if (profile?.role_id === 'r1' && (profile.account_status ?? 'active') === 'active') {
    const { count: otherActiveAdmins } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role_id', 'r1')
      .eq('account_status', 'active')
      .neq('id', userId);
    if ((otherActiveAdmins ?? 0) < 2) {
      return blockDelete(
        supabase,
        admin,
        request,
        userId,
        reason,
        'لا يمكن حذف حساب مدير نشط إلا بوجود مديرين نشطين آخرين على الأقل.',
        'last_admin_guard',
        409
      );
    }
  }

  let activity: ActivitySummary;
  try {
    activity = await buildActivitySummary(supabase, userId);
  } catch (err) {
    return blockDelete(
      supabase,
      admin,
      request,
      userId,
      reason,
      'تعذر التحقق من نشاط الحساب، لذلك تم منع الحذف.',
      'activity_check_failed',
      500,
      { error: err instanceof Error ? err.message : 'unknown' }
    );
  }

  const normalizedTargetEmail = normalizeEmail(authUser.email || profile?.email);
  const duplicateEmail = Boolean(
    normalizedTargetEmail &&
    authRows.some((u) => u.id !== userId && normalizeEmail(u.email) === normalizedTargetEmail)
  );
  const classification = classifySafeDelete({ authUser, profile, duplicateEmail, activity });
  if (!classification.allowed) {
    return blockDelete(
      supabase,
      admin,
      request,
      userId,
      reason,
      classification.reason,
      'safe_delete_guard',
      409,
      { activity_summary: activity }
    );
  }

  const { error: deleteErr } = await serviceClient.auth.admin.deleteUser(userId);
  if (deleteErr) {
    await writeAudit(supabase, {
      action: 'auth_user_delete_failed',
      actorId: admin.userId,
      actorName: admin.name,
      actorRoleId: admin.roleId,
      description: deleteErr.message,
      entity: { type: 'auth_user', id: userId, label: authUser.email ?? userId },
      metadata: {
        target_user_id: userId,
        target_email: authUser.email ?? profile?.email ?? null,
        had_profile: Boolean(profile),
        reason,
        safe_delete_category: classification.category,
        activity_summary: activity,
      },
      ipAddress: ip,
      userAgent,
    });
    return NextResponse.json(
      { ok: false, code: 'delete_failed', message: deleteErr.message },
      { status: 500 }
    );
  }

  if (profile) {
    await serviceClient
      .from('profiles')
      .update({
        account_status: 'disabled',
        disabled_at: new Date().toISOString(),
        disabled_by: admin.userId,
        disabled_reason: 'auth user deleted: fake/new account cleanup',
      })
      .eq('id', userId);

    await writeAudit(supabase, {
      action: 'staff.account_disabled',
      actorId: admin.userId,
      actorName: admin.name,
      actorRoleId: admin.roleId,
      description: 'auth user deleted: fake/new account cleanup',
      entity: {
        type: 'profile',
        id: userId,
        label: profile.full_name ?? profile.email ?? authUser.email ?? userId,
      },
      metadata: {
        target_user_id: userId,
        target_email: authUser.email ?? profile.email,
        reason,
        safe_delete_category: classification.category,
      },
      ipAddress: ip,
      userAgent,
    });
  }

  await writeAudit(supabase, {
    action: 'auth_user_deleted',
    actorId: admin.userId,
    actorName: admin.name,
    actorRoleId: admin.roleId,
    description: 'تم حذف حساب الدخول نهائيًا ضمن تنظيف آمن.',
    entity: { type: 'auth_user', id: userId, label: authUser.email ?? userId },
    metadata: {
      target_user_id: userId,
      target_email: authUser.email ?? profile?.email ?? null,
      had_profile: Boolean(profile),
      reason,
      safe_delete_category: classification.category,
      activity_summary: activity,
      profile_disabled_instead_of_deleted: Boolean(profile),
    },
    ipAddress: ip,
    userAgent,
  });

  return NextResponse.json(
    { ok: true, code: 'deleted', safe_delete_category: classification.category },
    { status: 200 }
  );
}

async function blockDelete(
  supabase: ReturnType<typeof buildAuthedClient>,
  admin: AdminCheck,
  request: Request,
  userId: string,
  reason: string,
  blockedReason: string,
  code = 'delete_blocked',
  status = 409,
  extraMetadata: Record<string, unknown> = {}
) {
  const ip = readClientIp(request);
  const userAgent = request.headers.get('user-agent') ?? null;
  await writeAudit(supabase, {
    action: 'auth_user_delete_blocked',
    actorId: admin.userId,
    actorName: admin.name,
    actorRoleId: admin.roleId,
    description: blockedReason,
    entity: { type: 'auth_user', id: userId },
    metadata: {
      target_user_id: userId,
      reason,
      blocked_reason: blockedReason,
      ...extraMetadata,
    },
    ipAddress: ip,
    userAgent,
  });
  return NextResponse.json(
    { ok: false, code, message: blockedReason, blocked_reason: blockedReason },
    { status }
  );
}
