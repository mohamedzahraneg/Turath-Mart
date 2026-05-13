// ─────────────────────────────────────────────────────────────────────────────
// /change-password
//
// Phase 26H-2 — standalone authenticated route where a staff member
// rotates their Supabase Auth password. This page is opened in two
// scenarios:
//
//   1) Forced rotation — AppLayout's gate (also Phase 26H-2)
//      redirects every non-admin staff member here when their
//      `profiles.must_change_password` is true, until they complete
//      the change. The `next` query param carries the original
//      intended path so we can resume after success.
//
//   2) Voluntary rotation — the staff member visits the page
//      directly from the sidebar / settings (no `next` param). The
//      form behaves identically; we just redirect to /dashboard
//      after success.
//
// Why this is NOT wrapped by AppLayout
// ------------------------------------
// AppLayout owns the force-change gate. If /change-password were
// wrapped, the gate would re-fire on this very page, creating a
// redirect loop. Instead we render a self-contained shell, with
// our own auth check that redirects unauthenticated visitors to
// /sign-up-login-screen.
//
// Why we call a SECURITY DEFINER RPC after `updateUser`
// -----------------------------------------------------
// `supabase.auth.updateUser({ password })` flips the password in
// Supabase Auth, which is RLS-free. But our `profiles` table has
// admin-only UPDATE (Phase 23M-Fix1 dropped `profiles_own_update`),
// so we can't directly clear `must_change_password` from the
// client. Phase 26H-2's migration adds a narrow SECURITY DEFINER
// RPC `complete_password_change()` that only touches the caller's
// own row and only updates the two flag columns. We invoke it
// right after the auth update succeeds.
//
// Audit logging
// -------------
// After the RPC call we write `staff.password_change_required_completed`
// via the standard `writeStaffAuditLog` helper. The audit row carries
// no password bytes, no token, no raw metadata — just identity and
// timing. The auth-side password change itself is captured by
// Supabase Auth's own logs (out of scope).
// ─────────────────────────────────────────────────────────────────────────────
'use client';

// Phase 26H-2 — `useSearchParams` requires the page to be dynamic;
// without this, Next.js 15's static prerender fails with a CSR
// bailout error. The page is always user-specific anyway, so
// disabling SSG is the right call.
export const dynamic = 'force-dynamic';

import React, { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, Check, Eye, EyeOff, KeyRound, ShieldCheck } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import { writeStaffAuditLog } from '@/lib/security/staffAudit';

// Minimum password length aligned with the Supabase default. We
// deliberately don't add complexity rules client-side beyond this —
// Supabase's `auth.updateUser` enforces project-level password
// policy and surfaces any rejection as an error message.
const MIN_PASSWORD_LENGTH = 8;
const RECOVERY_CHECK_TIMEOUT_MS = 7_000;
const AUTH_CONTEXT_TIMEOUT_MS = 4_000;
const INVALID_RESET_LINK_MESSAGE =
  'رابط تغيير كلمة المرور غير صالح أو انتهت صلاحيته. اطلب رابطًا جديدًا.';
const INVALID_OTP_MESSAGE =
  'الكود غير صحيح أو انتهت صلاحيته. تأكد من البريد والكود أو اطلب رسالة جديدة.';

type RecoveryState = 'checking' | 'not_recovery' | 'processing' | 'ready' | 'invalid';
type AuthOperationResult = { error: { message?: string } | null };
type GetUserResult = { data: { user: User | null }; error: { message?: string } | null };

function readResetParam(key: string) {
  if (typeof window === 'undefined') return null;
  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return searchParams.get(key) || hashParams.get(key);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  return Promise.race<T>([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

function LoadingShell({ message = 'جارٍ تحميل الصفحة...' }: { message?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[hsl(210,20%,97%)]" dir="rtl">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#c6a052] border-t-transparent" />
        <p className="text-sm text-[hsl(var(--muted-foreground))]">{message}</p>
      </div>
    </div>
  );
}

// Phase 26H-2 — Next.js 15 requires `useSearchParams` consumers to
// be wrapped in a Suspense boundary so the static prerender can
// bail out cleanly. The page body lives in `ChangePasswordPageBody`;
// the default export just wraps it in <Suspense>.
export default function ChangePasswordPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <ChangePasswordPageBody />
    </Suspense>
  );
}

function ChangePasswordPageBody() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params?.get('next') || '/dashboard';
  const { user, loading, currentRoleId, profileFullName, mustChangePassword, refreshProfile } =
    useAuth();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [recoveryState, setRecoveryState] = useState<RecoveryState>('checking');
  const [recoveryUser, setRecoveryUser] = useState<User | null>(null);
  const [authWaitExpired, setAuthWaitExpired] = useState(false);
  const [otpEmail, setOtpEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSubmitting, setOtpSubmitting] = useState(false);

  // Supabase recovery links may arrive with either `code` in the query
  // string or access/refresh tokens in the hash. We must bind the form
  // to that recovery session before allowing `updateUser({ password })`;
  // otherwise an already-signed-in admin could accidentally rotate their
  // own password while opening another employee's reset link.
  useEffect(() => {
    let cancelled = false;

    const prepareRecoverySession = async () => {
      if (typeof window === 'undefined') return;

      const type = readResetParam('type');
      const code = readResetParam('code');
      const accessToken = readResetParam('access_token');
      const refreshToken = readResetParam('refresh_token');
      const resetError = readResetParam('error') || readResetParam('error_code');
      const looksLikeRecovery =
        type === 'recovery' || Boolean(code) || Boolean(accessToken || refreshToken || resetError);

      if (resetError) {
        if (!cancelled) {
          setRecoveryState('invalid');
          setError(INVALID_RESET_LINK_MESSAGE);
        }
        return;
      }

      if (!looksLikeRecovery) {
        if (!cancelled) setRecoveryState('not_recovery');
        return;
      }

      setRecoveryState('processing');
      setError(null);

      try {
        const supabase = createClient();
        if (!supabase) throw new Error('تعذر الاتصال بقاعدة البيانات.');

        if (code) {
          const { error: exchangeErr } = await withTimeout<AuthOperationResult>(
            supabase.auth.exchangeCodeForSession(code),
            RECOVERY_CHECK_TIMEOUT_MS,
            INVALID_RESET_LINK_MESSAGE
          );
          if (exchangeErr) throw exchangeErr;
        } else if (accessToken && refreshToken) {
          const { error: sessionErr } = await withTimeout<AuthOperationResult>(
            supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            }),
            RECOVERY_CHECK_TIMEOUT_MS,
            INVALID_RESET_LINK_MESSAGE
          );
          if (sessionErr) throw sessionErr;
        } else {
          throw new Error('رابط تغيير كلمة المرور لا يحتوي جلسة استرداد صالحة.');
        }

        const {
          data: { user: resetUser },
          error: userErr,
        } = await withTimeout<GetUserResult>(
          supabase.auth.getUser(),
          RECOVERY_CHECK_TIMEOUT_MS,
          INVALID_RESET_LINK_MESSAGE
        );
        if (userErr || !resetUser) {
          throw userErr || new Error('تعذر التحقق من حساب رابط الاسترداد.');
        }

        if (!cancelled) {
          setRecoveryUser(resetUser);
          setRecoveryState('ready');
          window.history.replaceState(null, '', '/change-password');
        }
      } catch (err) {
        if (!cancelled) {
          setRecoveryState('invalid');
          const message = err instanceof Error ? err.message : '';
          setError(
            message.includes('رابط تغيير كلمة المرور') ? message : INVALID_RESET_LINK_MESSAGE
          );
        }
      }
    };

    void prepareRecoverySession();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loading || recoveryUser || recoveryState === 'ready' || recoveryState === 'invalid') {
      setAuthWaitExpired(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setAuthWaitExpired(true);
    }, AUTH_CONTEXT_TIMEOUT_MS);

    return () => window.clearTimeout(timeoutId);
  }, [loading, recoveryState, recoveryUser]);

  const recoveryLinkInvalid = recoveryState === 'invalid';
  const activeUser = recoveryUser ?? (recoveryLinkInvalid ? null : user);
  const passwordInputsDisabled =
    submitting ||
    recoveryState === 'processing' ||
    recoveryState === 'invalid' ||
    (!activeUser && authWaitExpired);
  const visibleError =
    error ||
    (authWaitExpired && !activeUser && recoveryState !== 'not_recovery'
      ? 'تعذر التحقق من جلسة المستخدم. افتح رابط تغيير كلمة المرور مرة أخرى أو سجل الدخول من جديد.'
      : null);
  const normalizedOtpEmail = otpEmail.trim().toLowerCase();
  const normalizedOtpCode = otpCode.replace(/\s+/g, '').trim();
  const passwordTooShort = newPassword.length > 0 && newPassword.length < MIN_PASSWORD_LENGTH;
  const passwordsMismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const canSubmit =
    !passwordInputsDisabled &&
    Boolean(activeUser) &&
    newPassword.length >= MIN_PASSWORD_LENGTH &&
    newPassword === confirmPassword;
  const canSubmitOtp =
    !otpSubmitting &&
    normalizedOtpEmail.includes('@') &&
    normalizedOtpCode.length >= 4 &&
    normalizedOtpCode.length <= 10;

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmitOtp) return;
    setError(null);
    setOtpSubmitting(true);
    try {
      const supabase = createClient();
      if (!supabase) {
        setError('تعذر الاتصال بقاعدة البيانات. حاول مرة أخرى.');
        return;
      }

      const { error: verifyErr } = await withTimeout<AuthOperationResult>(
        supabase.auth.verifyOtp({
          email: normalizedOtpEmail,
          token: normalizedOtpCode,
          type: 'recovery',
        }),
        RECOVERY_CHECK_TIMEOUT_MS,
        INVALID_OTP_MESSAGE
      );
      if (verifyErr) throw verifyErr;

      const {
        data: { user: resetUser },
        error: userErr,
      } = await withTimeout<GetUserResult>(
        supabase.auth.getUser(),
        RECOVERY_CHECK_TIMEOUT_MS,
        INVALID_OTP_MESSAGE
      );
      if (userErr || !resetUser) {
        throw userErr || new Error('تعذر التحقق من حساب كود الاسترداد.');
      }

      setRecoveryUser(resetUser);
      setRecoveryState('ready');
      setAuthWaitExpired(false);
      setOtpCode('');
      setError(null);
      window.history.replaceState(null, '', '/change-password');
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      setRecoveryState('invalid');
      setError(message.includes('الكود') ? message : INVALID_OTP_MESSAGE);
    } finally {
      setOtpSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const supabase = createClient();
      if (!supabase) {
        setError('تعذر الاتصال بقاعدة البيانات. حاول مرة أخرى.');
        return;
      }

      const expectedUserId = activeUser?.id;
      const {
        data: { user: sessionUser },
        error: sessionErr,
      } = await supabase.auth.getUser();
      if (sessionErr || !sessionUser || !expectedUserId || sessionUser.id !== expectedUserId) {
        setError(
          'تم إيقاف العملية لحماية الحسابات: جلسة تغيير كلمة المرور لا تطابق الحساب المطلوب. افتح الرابط في نافذة خاصة أو اطلب رابطًا جديدًا.'
        );
        return;
      }

      // 1. Update Supabase Auth password. RLS-free; succeeds for the
      //    authenticated caller. Never log the password.
      const { error: updateErr } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (updateErr) {
        // Supabase surfaces password-policy violations + identical-
        // password errors as a string. Translate the common cases;
        // anything else falls through to the raw message.
        const msg = updateErr.message || 'تعذر تغيير كلمة المرور.';
        if (/at least|too short|min/i.test(msg)) {
          setError('كلمة المرور قصيرة جدًا. يجب ألا تقل عن 8 خانات.');
        } else if (/same|identical/i.test(msg)) {
          setError('كلمة المرور الجديدة لا يمكن أن تكون مطابقة للسابقة.');
        } else {
          setError(`تعذر تغيير كلمة المرور: ${msg}`);
        }
        return;
      }

      // 2. Clear the cached `must_change_password` flag via the
      //    SECURITY DEFINER RPC. Without this call the AppLayout
      //    gate would still redirect us back here on the next page
      //    load. RPC errors don't roll back the auth password
      //    change — we surface them but still proceed (the user can
      //    contact an admin to clear the flag manually if the RPC
      //    is unavailable).
      let rpcError: string | null = null;
      try {
        const { error: rpcErr } = await supabase.rpc('complete_password_change');
        if (rpcErr) rpcError = rpcErr.message ?? String(rpcErr);
      } catch (rpcCatch) {
        rpcError = rpcCatch instanceof Error ? rpcCatch.message : String(rpcCatch);
      }

      // 3. Audit. Best-effort: do not block success on audit failure.
      //    No password / token in metadata.
      try {
        await writeStaffAuditLog(supabase, {
          action: 'staff.password_change_required_completed',
          description: 'أكمل الموظف تغيير كلمة المرور الإجباري',
          actorId: sessionUser.id,
          actorName: recoveryUser
            ? (sessionUser.email ?? null)
            : (profileFullName ?? sessionUser.email ?? null),
          actorRoleId: currentRoleId,
          entity: {
            type: 'profile',
            id: sessionUser.id,
            label: recoveryUser
              ? (sessionUser.email ?? null)
              : (profileFullName ?? sessionUser.email ?? null),
          },
          metadata: {
            self_change: true,
            recovery_flow: Boolean(recoveryUser),
            rpc_error: rpcError, // null on success
          },
        });
      } catch (auditErr) {
        console.warn('[change-password] audit failed:', auditErr);
      }

      // 4. Refresh AuthContext so the gate sees the cleared flag.
      try {
        await refreshProfile();
      } catch (refreshErr) {
        console.warn('[change-password] refreshProfile failed:', refreshErr);
      }

      setSuccess(true);
      setNewPassword('');
      setConfirmPassword('');

      // 5. Redirect to the intended destination after a brief
      //    success state so the user sees the confirmation. If the
      //    RPC failed we still redirect — admins can resolve the
      //    flag separately and the auth password is already set.
      window.setTimeout(() => {
        router.replace(next || '/dashboard');
      }, 1200);
    } catch (err) {
      setError(
        err instanceof Error ? `تعذر تغيير كلمة المرور: ${err.message}` : 'تعذر تغيير كلمة المرور.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (
    recoveryState === 'checking' ||
    recoveryState === 'processing' ||
    (loading && !recoveryUser && !authWaitExpired)
  ) {
    return <LoadingShell message="جارِ التحقق من رابط تغيير كلمة المرور..." />;
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center bg-[hsl(210,20%,97%)] p-4"
      dir="rtl"
    >
      <div className="w-full max-w-md">
        <div className="bg-white rounded-3xl shadow-modal p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[hsl(var(--primary))]/10 flex items-center justify-center">
              <KeyRound size={20} className="text-[hsl(var(--primary))]" />
            </div>
            <div>
              <h1 className="text-base font-bold text-[hsl(var(--foreground))]">
                تغيير كلمة المرور
              </h1>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                {mustChangePassword
                  ? 'مطلوب تغيير كلمة المرور قبل المتابعة في النظام.'
                  : 'يمكنك تغيير كلمة المرور في أي وقت.'}
              </p>
            </div>
          </div>

          {mustChangePassword && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 flex items-start gap-2">
              <AlertTriangle size={16} className="text-amber-700 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-amber-900">
                طلب مدير النظام منك تغيير كلمة المرور. لن تتمكن من استخدام النظام حتى يتم تغييرها.
              </p>
            </div>
          )}

          {success ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 flex items-start gap-2">
              <Check size={18} className="text-emerald-700 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-emerald-900">
                <p className="font-bold mb-0.5">تم تغيير كلمة المرور بنجاح.</p>
                <p className="text-xs">سيتم تحويلك للصفحة المطلوبة خلال لحظات...</p>
              </div>
            </div>
          ) : !activeUser ? (
            <form onSubmit={handleVerifyOtp} className="space-y-3">
              <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-950 leading-6">
                أدخل البريد الإلكتروني وكود الاسترداد الموجود في رسالة تغيير كلمة المرور. هذا المسار
                مفيد إذا فتح مزود البريد الرابط تلقائيًا وانتهت صلاحيته.
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="recovery-email"
                  className="text-xs font-bold text-[hsl(var(--foreground))]"
                >
                  بريد الحساب
                </label>
                <input
                  id="recovery-email"
                  type="email"
                  value={otpEmail}
                  onChange={(e) => setOtpEmail(e.target.value)}
                  autoComplete="email"
                  required
                  disabled={otpSubmitting}
                  className="w-full px-3 py-2.5 border border-[hsl(var(--border))] rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30 disabled:opacity-50"
                  dir="ltr"
                  placeholder="name@example.com"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="recovery-code"
                  className="text-xs font-bold text-[hsl(var(--foreground))]"
                >
                  كود الاسترداد
                </label>
                <input
                  id="recovery-code"
                  type="text"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  disabled={otpSubmitting}
                  className="w-full px-3 py-2.5 border border-[hsl(var(--border))] rounded-xl text-center text-lg tracking-[0.35em] bg-white focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30 disabled:opacity-50"
                  dir="ltr"
                  placeholder="000000"
                />
              </div>

              {visibleError && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 flex items-start gap-2">
                  <AlertTriangle size={14} className="text-rose-700 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-rose-900">{visibleError}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={!canSubmitOtp}
                className="w-full py-2.5 rounded-xl bg-[hsl(var(--primary))] text-white text-sm font-bold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {otpSubmitting ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    جارٍ التحقق...
                  </>
                ) : (
                  <>
                    <ShieldCheck size={14} />
                    التحقق من الكود
                  </>
                )}
              </button>
            </form>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              {recoveryUser?.email && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-950 leading-6">
                  سيتم تغيير كلمة المرور للحساب:
                  <span className="font-bold" dir="ltr">
                    {' '}
                    {recoveryUser.email}
                  </span>
                </div>
              )}

              <div className="space-y-1">
                <label
                  htmlFor="new-password"
                  className="text-xs font-bold text-[hsl(var(--foreground))]"
                >
                  كلمة المرور الجديدة
                </label>
                <div className="relative">
                  <input
                    id="new-password"
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    minLength={MIN_PASSWORD_LENGTH}
                    autoComplete="new-password"
                    required
                    disabled={passwordInputsDisabled}
                    className="w-full px-3 py-2.5 pl-9 border border-[hsl(var(--border))] rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30 disabled:opacity-50"
                    dir="ltr"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))]"
                    aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <p
                  className={`text-[11px] ${
                    passwordTooShort ? 'text-rose-700' : 'text-[hsl(var(--muted-foreground))]'
                  }`}
                >
                  {passwordTooShort
                    ? `كلمة المرور قصيرة جدًا (الحد الأدنى ${MIN_PASSWORD_LENGTH} خانات).`
                    : `الحد الأدنى ${MIN_PASSWORD_LENGTH} خانات.`}
                </p>
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="confirm-password"
                  className="text-xs font-bold text-[hsl(var(--foreground))]"
                >
                  تأكيد كلمة المرور
                </label>
                <input
                  id="confirm-password"
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  minLength={MIN_PASSWORD_LENGTH}
                  autoComplete="new-password"
                  required
                  disabled={passwordInputsDisabled}
                  className="w-full px-3 py-2.5 border border-[hsl(var(--border))] rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30 disabled:opacity-50"
                  dir="ltr"
                />
                {passwordsMismatch && (
                  <p className="text-[11px] text-rose-700">كلمتا المرور غير متطابقتين.</p>
                )}
              </div>

              {visibleError && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 flex items-start gap-2">
                  <AlertTriangle size={14} className="text-rose-700 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-rose-900">{visibleError}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={!canSubmit}
                className="w-full py-2.5 rounded-xl bg-[hsl(var(--primary))] text-white text-sm font-bold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    جارٍ الحفظ...
                  </>
                ) : (
                  <>
                    <ShieldCheck size={14} />
                    تغيير كلمة المرور
                  </>
                )}
              </button>
            </form>
          )}

          <p className="text-[11px] text-center text-[hsl(var(--muted-foreground))]">
            لا يقوم النظام بتخزين كلمة المرور القديمة أو الجديدة بشكل مقروء — يتم تحديثها فقط عبر
            Supabase Auth.
          </p>
        </div>
      </div>
    </div>
  );
}
