'use client';
import React, { Suspense, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { toast, Toaster } from 'sonner';
import {
  Eye,
  EyeOff,
  User,
  Lock,
  ArrowLeft,
  AlertCircle,
  Monitor,
  Smartphone,
  Tablet,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import {
  getDefaultRouteForPermissions,
  getPermissionsForRoleId,
  canAccessPath,
} from '@/lib/permissions/permissions';
import { getDeviceLabel } from '@/lib/utils/device';

interface LoginForm {
  email: string;
  password: string;
  remember: boolean;
}

/* ─── helpers ─── */
function DeviceIcon({ device }: { device: string }) {
  if (device === 'موبايل') return <Smartphone size={13} className="text-[#c6a052]/70" />;
  if (device === 'تابلت') return <Tablet size={13} className="text-[#c6a052]/70" />;
  return <Monitor size={13} className="text-[#c6a052]/70" />;
}

/* ─── Floating particle (memoized, gold dust) ─── */
function Particle({
  delay,
  size,
  left,
  duration,
}: {
  delay: number;
  size: number;
  left: number;
  duration: number;
}) {
  return (
    <div
      className="islamic-particle"
      style={{
        width: size,
        height: size,
        left: `${left}%`,
        animationDelay: `${delay}s`,
        animationDuration: `${duration}s`,
      }}
    />
  );
}

/* ─── Heritage geometric ornament — subtle, decorative ─── */
function HeritageOrnament({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <polygon
        points="50,5 61,35 95,35 68,57 79,90 50,70 21,90 32,57 5,35 39,35"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.18"
      />
      <polygon
        points="50,15 58,38 85,38 63,53 72,80 50,65 28,80 37,53 15,38 42,38"
        stroke="currentColor"
        strokeWidth="0.5"
        opacity="0.12"
      />
    </svg>
  );
}

/* ─── Heritage Hexagon (drifting decorative shape for the BG) ─── */
function HexShape({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <polygon
        points="50,3 95,28 95,72 50,97 5,72 5,28"
        stroke="currentColor"
        strokeWidth="0.8"
        opacity="0.7"
      />
      <polygon
        points="50,15 83,33 83,67 50,85 17,67 17,33"
        stroke="currentColor"
        strokeWidth="0.5"
        opacity="0.45"
      />
      <circle cx="50" cy="50" r="3" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

/* ─── Heritage Emblem Logo — pure SVG with multi-layer SMIL animation ─── */
function HeritageLogo({ size = 64, className = '' }: { size?: number; className?: string }) {
  // Unique gradient ids so multiple instances on a page do not clash
  const goldId = 'tm-logo-gold';
  const glowId = 'tm-logo-glow';
  const jewelId = 'tm-logo-jewel';
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="شعار تراث مصر"
    >
      <defs>
        <linearGradient id={goldId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fff5d0" />
          <stop offset="40%" stopColor="#e8d5a0" />
          <stop offset="60%" stopColor="#c6a052" />
          <stop offset="100%" stopColor="#8a6a26" />
        </linearGradient>
        <radialGradient id={glowId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#c6a052" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#c6a052" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={jewelId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff5d0" />
          <stop offset="60%" stopColor="#e8d5a0" />
          <stop offset="100%" stopColor="#c6a052" />
        </radialGradient>
      </defs>

      {/* Soft golden glow halo — gentle breathing */}
      <circle cx="60" cy="60" r="58" fill={`url(#${glowId})`}>
        <animate attributeName="opacity" values="0.55;1;0.55" dur="3.5s" repeatCount="indefinite" />
      </circle>

      {/* Outer solid ring — subtle pulse */}
      <circle cx="60" cy="60" r="48" fill="none" stroke={`url(#${goldId})`} strokeWidth="2.2">
        <animate attributeName="r" values="48;49.4;48" dur="4s" repeatCount="indefinite" />
      </circle>

      {/* Dashed ring — counter-rotating */}
      <g>
        <animateTransform
          attributeName="transform"
          attributeType="XML"
          type="rotate"
          from="360 60 60"
          to="0 60 60"
          dur="28s"
          repeatCount="indefinite"
        />
        <circle
          cx="60"
          cy="60"
          r="48"
          fill="none"
          stroke={`url(#${goldId})`}
          strokeWidth="0.9"
          strokeDasharray="3 6"
          opacity="0.55"
        />
      </g>

      {/* Inner thin ring — opacity pulse */}
      <circle
        cx="60"
        cy="60"
        r="36"
        fill="none"
        stroke={`url(#${goldId})`}
        strokeWidth="0.9"
        opacity="0.7"
      >
        <animate
          attributeName="opacity"
          values="0.45;0.85;0.45"
          dur="4s"
          repeatCount="indefinite"
        />
      </circle>

      {/* 8-point Islamic star — clockwise rotation */}
      <g>
        <animateTransform
          attributeName="transform"
          attributeType="XML"
          type="rotate"
          from="0 60 60"
          to="360 60 60"
          dur="22s"
          repeatCount="indefinite"
        />
        <polygon
          points="60,30 67,53 90,60 67,67 60,90 53,67 30,60 53,53"
          fill={`url(#${goldId})`}
          stroke="#8a6a26"
          strokeWidth="0.4"
        />
        <polygon
          points="60,38 65,55 82,60 65,65 60,82 55,65 38,60 55,55"
          fill="#0e1a2c"
          opacity="0.55"
        />
      </g>

      {/* Central jewel — heartbeat pulse */}
      <circle cx="60" cy="60" r="6.5" fill={`url(#${jewelId})`}>
        <animate attributeName="r" values="6.2;7.6;6.2" dur="2s" repeatCount="indefinite" />
      </circle>
      <circle cx="60" cy="60" r="2.8" fill="#fff5d0">
        <animate attributeName="r" values="2.5;3.6;2.5" dur="2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.85;1;0.85" dur="2s" repeatCount="indefinite" />
      </circle>

      {/* Cardinal markers — staggered twinkling (4 phases of a 3s cycle) */}
      <circle cx="60" cy="9" r="1.8" fill="#c6a052">
        <animate
          attributeName="opacity"
          values="0.3;1;0.3"
          dur="3s"
          begin="0s"
          repeatCount="indefinite"
        />
      </circle>
      <circle cx="111" cy="60" r="1.8" fill="#c6a052">
        <animate
          attributeName="opacity"
          values="0.3;1;0.3"
          dur="3s"
          begin="0.75s"
          repeatCount="indefinite"
        />
      </circle>
      <circle cx="60" cy="111" r="1.8" fill="#c6a052">
        <animate
          attributeName="opacity"
          values="0.3;1;0.3"
          dur="3s"
          begin="1.5s"
          repeatCount="indefinite"
        />
      </circle>
      <circle cx="9" cy="60" r="1.8" fill="#c6a052">
        <animate
          attributeName="opacity"
          values="0.3;1;0.3"
          dur="3s"
          begin="2.25s"
          repeatCount="indefinite"
        />
      </circle>

      {/* Diagonal markers — twinkling at half speed */}
      <circle cx="24" cy="24" r="1" fill="#c6a052">
        <animate
          attributeName="opacity"
          values="0.2;0.85;0.2"
          dur="4s"
          begin="0s"
          repeatCount="indefinite"
        />
      </circle>
      <circle cx="96" cy="24" r="1" fill="#c6a052">
        <animate
          attributeName="opacity"
          values="0.2;0.85;0.2"
          dur="4s"
          begin="1s"
          repeatCount="indefinite"
        />
      </circle>
      <circle cx="96" cy="96" r="1" fill="#c6a052">
        <animate
          attributeName="opacity"
          values="0.2;0.85;0.2"
          dur="4s"
          begin="2s"
          repeatCount="indefinite"
        />
      </circle>
      <circle cx="24" cy="96" r="1" fill="#c6a052">
        <animate
          attributeName="opacity"
          values="0.2;0.85;0.2"
          dur="4s"
          begin="3s"
          repeatCount="indefinite"
        />
      </circle>
    </svg>
  );
}

/* ─── Resolve a username to an email by appending the company domain ─── */
const COMPANY_DOMAIN =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_COMPANY_DOMAIN) || 'turathmasr.com';

function resolveLoginIdentifier(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  // If it already looks like an email, use as-is.
  if (trimmed.includes('@')) return trimmed;
  // Otherwise treat it as a username and append the configured company domain.
  return `${trimmed}@${COMPANY_DOMAIN}`;
}

// useSearchParams() forces this page out of static rendering, so the inner
// component must live inside a <Suspense> boundary (Next.js 15 requirement).
function LoginPageInner() {
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [deviceType, setDeviceType] = useState('كمبيوتر');
  const [mounted, setMounted] = useState(false);
  // Phase 11C: client-side cooldown after a Supabase Auth rate-limit hit.
  // Prevents the user from re-submitting (and re-throttling themselves)
  // while the per-IP window is still cooling down. Counts down in the
  // submit button so the user has a clear "wait this many seconds" cue.
  const [cooldownSec, setCooldownSec] = useState(0);
  const { signIn } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    setDeviceType(getDeviceLabel());
    setMounted(true);
  }, []);

  // Phase 18 / 22J: clear any stale local auth state when the login page
  // mounts.
  //
  // Phase 18 background — when the browser holds a refresh token that
  // the auth server has already rotated/invalidated, the supabase-js
  // auto-refresh path retries the bad token in a tight loop (observed:
  // 100 calls to /auth/v1/token?grant_type=refresh_token in 7s, all
  // 400/429), which burns the per-IP rate budget on /token. The next
  // legitimate signInWithPassword() then comes back as 429 and the
  // user sees "تم تجاوز عدد محاولات الدخول" on what looks like a
  // first attempt.
  //
  // Phase 22J fix — the previous implementation was fire-and-forget
  // (`void supabase.auth.signOut(...)`), which races a concurrent
  // signIn(): if the user (or a password manager) submits the form
  // before the cleanup signOut completes, signOut's storage-clear
  // can land AFTER signIn's storage-write, wiping the freshly-issued
  // session tokens. The next router.replace(...) then hits middleware
  // with no cookies, bounces back to /sign-up-login-screen, and the
  // user has to log in again — the "double login" symptom.
  //
  // The fix exposes the cleanup as a Promise on a ref. onSubmit awaits
  // it (see below) before calling signIn(), so the storage operations
  // are strictly sequential: cleanup → signIn write. No race possible.
  // The cleanup itself still runs eagerly on mount so it doesn't add
  // latency to the typical login (cleanup completes long before the
  // user finishes typing).
  //
  // signOut({ scope: 'local' }) is purely client-side: it clears the
  // SDK's in-memory session and the auth cookie/localStorage, with
  // NO network call to /auth/v1/logout (so it cannot itself contribute
  // to rate-limit pressure). Already-signed-in users who somehow land
  // on this URL are caught earlier by the middleware redirect at
  // middleware.ts:40-46, so this cleanup only runs when the page is
  // actually rendered (i.e. user is unauthenticated or holding stale
  // tokens — which is exactly when we want it to run).
  //
  // The hasCleanedRef guard prevents React 18 StrictMode from running
  // the effect twice in dev, which would (harmlessly) double the
  // signOut call. We also explicitly skip if there is no client (SSR
  // safety) so the effect only runs in the browser.
  const hasCleanedRef = useRef(false);
  const cleanupPromiseRef = useRef<Promise<unknown> | null>(null);
  const loginInFlightRef = useRef(false);
  useEffect(() => {
    if (hasCleanedRef.current) return;
    hasCleanedRef.current = true;
    const supabase = createClient();
    if (!supabase) return;
    cleanupPromiseRef.current = supabase.auth.signOut({ scope: 'local' }).catch(() => {
      // Local cleanup failure is non-fatal — the user can still try to
      // sign in. Swallow rather than surface a confusing toast.
    });
  }, []);

  // Cooldown ticker — decrements once per second until zero.
  useEffect(() => {
    if (cooldownSec <= 0) return;
    const t = setTimeout(() => setCooldownSec((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [cooldownSec]);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({
    defaultValues: { remember: false },
  });

  /* ─── Generate particles (memoized) ─── */
  const particles = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => ({
        id: i,
        delay: Math.random() * 14,
        size: Math.random() * 4 + 2,
        left: Math.random() * 100,
        duration: Math.random() * 18 + 14,
      })),
    []
  );

  /* ─── Auth logic — UNCHANGED except for the username→email resolver. ─── */
  const onSubmit = useCallback(
    async (data: LoginForm) => {
      if (loginInFlightRef.current || cooldownSec > 0) return;
      loginInFlightRef.current = true;
      setIsLoading(true);
      setLoginError('');
      let shouldUnlock = true;

      try {
        // Allow the user to type either a full email OR just their username.
        // Pure usernames get the configured company domain appended (defaults
        // to turathmasr.com if NEXT_PUBLIC_COMPANY_DOMAIN is unset).
        const identifier = resolveLoginIdentifier(data.email);
        if (!identifier || !identifier.includes('@')) {
          setLoginError('يرجى إدخال البريد الإلكتروني أو اسم المستخدم');
          setIsLoading(false);
          return;
        }
        // Phase 22J: wait for the mount-time cleanup signOut to complete
        // before issuing signInWithPassword. This serialises the two
        // storage operations and prevents the cleanup from clobbering
        // the freshly-issued session tokens. Without this await, a
        // password-manager auto-fill + auto-submit would routinely race
        // the cleanup, triggering the "have to log in twice" symptom.
        if (cleanupPromiseRef.current) {
          try {
            await cleanupPromiseRef.current;
          } catch {
            // cleanup errors are already swallowed in the effect; the
            // double-await here is just defensive in case the promise
            // somehow rejects again.
          }
          cleanupPromiseRef.current = null;
        }
        const authData = await signIn(identifier, data.password);

        // Phase 22I-Fix1: resolve the user's permissions BEFORE
        // computing the landing route. Strictly permission-driven —
        // no role-name special-casing, no r4/r6/etc. hardcoding, no
        // "if userRole === 'delegate' then r4" fallback chain. We
        // read role_id and permissions from the profile, fall back
        // to user_metadata.role_id if the profile is missing the
        // column, and let getPermissionsForRoleId resolve role_id →
        // permission set generically. If the resulting permission
        // set is empty, the landing pick below will return null and
        // the user will see the "no permissions" error — never
        // routed to /dashboard or /shipping by accident.
        const supabase = createClient();
        const { data: profile } = await supabase
          .from('profiles')
          .select('role_id, permissions')
          .eq('id', authData.user.id)
          .single();

        const finalRoleId: string = profile?.role_id || authData.user.user_metadata?.role_id || '';

        const rawPerms = profile?.permissions;
        const dbPerms: string[] = Array.isArray(rawPerms) ? rawPerms : [];
        const customPerms: string[] | null = dbPerms.length > 0 ? dbPerms : null;
        const effectivePerms = dbPerms.length > 0 ? dbPerms : getPermissionsForRoleId(finalRoleId);

        toast.success(`مرحباً! تم تسجيل الدخول — ${deviceType}`);

        // Phase 22I-Fix1: permission-aware landing pick.
        //   • Honour `?next=` only when it's a same-origin path AND
        //     the user actually has access to it (canAccessPath).
        //   • Otherwise fall through to the permission-aware default
        //     returned by getDefaultRouteForPermissions — which is
        //     route-keyed and never returns a route the user can't
        //     reach.
        //   • If no permission-matched route exists, bail with a
        //     user-facing error and stay on the login screen.
        const nextParam = searchParams?.get('next');
        const nextIsSafe =
          typeof nextParam === 'string' &&
          nextParam.startsWith('/') &&
          canAccessPath(nextParam, finalRoleId || null, customPerms);
        const defaultLanding = getDefaultRouteForPermissions(effectivePerms);
        const landingPage: string | null = nextIsSafe ? nextParam : defaultLanding;

        if (!landingPage) {
          // Authed but the permission set yields no routable
          // destination. Surface a clear error and let the user (or
          // an admin) intervene. Avoid sending them to /dashboard or
          // /shipping when they have no permission to see either.
          toast.error('لم يتم تعيين صلاحيات لحسابك. يرجى التواصل مع المدير.');
          setLoginError('لم يتم تعيين صلاحيات لحسابك. يرجى التواصل مع المدير.');
          setIsLoading(false);
          return;
        }

        setTimeout(() => {
          router.replace(landingPage);
        }, 800);
        shouldUnlock = false;
      } catch (err: any) {
        // Phase 11B/11C: classify the error so the user-facing copy matches
        // the actual failure mode. The previous catch labeled every error
        // "بيانات غير صحيحة" (wrong credentials) — including rate-limit,
        // network, and email-not-confirmed errors — which misled users.
        //
        // Raw Supabase error messages are deliberately kept OUT of the UI;
        // they go to console.error only (visible to devs in DevTools).
        // The user-facing string is one of a small fixed set of Arabic
        // copies, picked by pattern-matching err.message.
        //
        // Phase 11C addition: when we detect a rate-limit, also start a
        // 60-second client-side cooldown so the user can't re-submit and
        // make their own throttle window worse. The toast message echoes
        // the same specific copy as the inline alert (was generic before,
        // which obscured the real failure mode).
        console.error('Login exception:', err);
        const rawMsg: string = (err && typeof err.message === 'string' && err.message) || '';
        const status: number | undefined =
          (err && typeof err.status === 'number' && err.status) || undefined;

        let userMsg: string;
        let isRateLimited = false;
        if (status === 429 || /rate.?limit|too.?many.?requests/i.test(rawMsg)) {
          userMsg = 'تم تجاوز عدد محاولات الدخول. يرجى الانتظار قليلًا ثم المحاولة مرة أخرى.';
          isRateLimited = true;
        } else if (/invalid.?(login.?)?credentials|invalid.?email.?or.?password/i.test(rawMsg)) {
          userMsg = 'البريد الإلكتروني أو كلمة المرور غير صحيحة.';
        } else if (/email.?not.?confirmed|not.?confirmed/i.test(rawMsg)) {
          userMsg = 'البريد الإلكتروني لم يتم تأكيده بعد.';
        } else if (/failed.?to.?fetch|network|networkerror|fetch.?error/i.test(rawMsg)) {
          userMsg = 'تعذّر الاتصال بالخادم. تحقق من الإنترنت ثم حاول مرة أخرى.';
        } else {
          userMsg = 'فشل تسجيل الدخول. حاول مرة أخرى لاحقًا.';
        }
        setLoginError(userMsg);
        // Toast carries the SAME specific message — used to be the generic
        // "فشل تسجيل الدخول" which made the toast useless to a user trying
        // to debug their own attempt.
        toast.error(userMsg);
        if (isRateLimited) {
          // 60 seconds is well under the typical Supabase per-IP window
          // (~30 attempts/hour) but enough to break the user's instinct to
          // hammer the button. The button text counts down so they see
          // progress.
          setCooldownSec(60);
        }
      } finally {
        if (shouldUnlock) {
          setIsLoading(false);
          loginInFlightRef.current = false;
        }
      }
    },
    [signIn, deviceType, router, searchParams, cooldownSec]
  );

  return (
    <div
      className="min-h-screen relative flex items-center justify-center overflow-x-hidden overflow-y-auto islamic-login-bg px-3 sm:px-4 py-6 sm:py-10"
      dir="rtl"
    >
      <Toaster position="top-center" richColors />

      {/* ─── Floating golden particles (decorative) ─── */}
      {mounted &&
        particles.map((p) => (
          <Particle key={p.id} delay={p.delay} size={p.size} left={p.left} duration={p.duration} />
        ))}

      {/* ─── Aurora-like blurred orbs (depth) ─── */}
      <div
        aria-hidden
        className="absolute top-[-18%] right-[-10%] w-[560px] h-[560px] bg-[#c6a052]/10 rounded-full blur-[130px] animate-pulse-slow pointer-events-none"
      />
      <div
        aria-hidden
        className="absolute bottom-[-18%] left-[-10%] w-[640px] h-[640px] bg-[#1a3a5c]/25 rounded-full blur-[150px] animate-pulse-slow pointer-events-none"
      />
      <div
        aria-hidden
        className="absolute top-[35%] left-[48%] w-[340px] h-[340px] bg-[#c6a052]/6 rounded-full blur-[110px] animate-float pointer-events-none"
      />

      {/* ─── Subtle Islamic geometric pattern overlay ─── */}
      <div aria-hidden className="absolute inset-0 opacity-[0.045] pointer-events-none">
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern
              id="heritage-geo"
              x="0"
              y="0"
              width="80"
              height="80"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M40 0 L80 40 L40 80 L0 40 Z"
                fill="none"
                stroke="#c6a052"
                strokeWidth="0.5"
              />
              <circle cx="40" cy="40" r="15" fill="none" stroke="#c6a052" strokeWidth="0.3" />
              <path d="M20 0 L40 20 L60 0" fill="none" stroke="#c6a052" strokeWidth="0.3" />
              <path d="M0 20 L20 40 L0 60" fill="none" stroke="#c6a052" strokeWidth="0.3" />
              <path d="M80 20 L60 40 L80 60" fill="none" stroke="#c6a052" strokeWidth="0.3" />
              <path d="M20 80 L40 60 L60 80" fill="none" stroke="#c6a052" strokeWidth="0.3" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#heritage-geo)" />
        </svg>
      </div>

      {/* ─── Decorative heritage stars (slowly rotating) ─── */}
      <HeritageOrnament
        aria-hidden
        className="absolute top-[6%] left-[10%] w-20 h-20 text-[#c6a052] animate-slow-rotate opacity-30 hidden md:block"
      />
      <HeritageOrnament
        aria-hidden
        className="absolute bottom-[8%] right-[6%] w-16 h-16 text-[#c6a052] animate-slow-rotate opacity-20 hidden md:block"
      />

      {/* ─── Drifting heritage hexagons (orbit-style motion) ─── */}
      <HexShape
        aria-hidden
        className="absolute top-[14%] right-[18%] w-28 h-28 text-[#c6a052] animate-drift-a opacity-[0.18] hidden md:block"
      />
      <HexShape
        aria-hidden
        className="absolute bottom-[18%] left-[14%] w-24 h-24 text-[#4be0ff] animate-drift-b opacity-[0.10] hidden md:block"
      />
      <HexShape
        aria-hidden
        className="absolute top-[55%] left-[28%] w-16 h-16 text-[#c6a052] animate-drift-a opacity-[0.12] hidden lg:block"
      />

      {/* ─── Diagonal scan-sweep highlight (atmospheric) ─── */}
      <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 -left-1/3 w-1/2 h-full bg-gradient-to-r from-transparent via-[#c6a052]/8 to-transparent animate-scan-sweep" />
      </div>

      {/* ─── Main content ─── */}
      <div className="relative z-10 w-full max-w-[520px] flex flex-col items-center">
        {/* ─── Welcome / brand strip ─── */}
        <header className="text-center mb-5 sm:mb-7 reveal-0 px-2">
          <span className="inline-flex items-center gap-1.5 text-[9px] sm:text-[10px] uppercase tracking-[0.3em] sm:tracking-[0.4em] text-[#c6a052]/80 mb-2 sm:mb-3">
            <Sparkles size={10} className="opacity-70" />
            <span>Heritage Management</span>
            <Sparkles size={10} className="opacity-70" />
          </span>
          <h1 className="text-[22px] sm:text-[28px] md:text-[36px] font-extrabold text-white leading-tight drop-shadow-lg">
            مرحبًا بك في لوحة تحكم{' '}
            <span className="islamic-shimmer bg-clip-text text-transparent">تراث مصر</span>
          </h1>
          <p className="text-white/55 text-[11.5px] sm:text-[12.5px] md:text-sm mt-2 sm:mt-2.5 max-w-[340px] sm:max-w-[420px] mx-auto leading-relaxed">
            إدارة الطلبات، الشحن، المخزون وخدمة العملاء من مكان واحد
          </p>
        </header>

        {/* ─── Electric Circle ─── */}
        <div
          className="electric-circle relative w-[min(98vw,360px)] sm:w-[min(94vw,460px)] aspect-square mx-auto reveal-1"
          aria-label="نموذج تسجيل الدخول"
        >
          {/* Inner content layer (z-index above the ::before/::after pseudos) */}
          <div className="absolute inset-0 flex items-center justify-center">
            <form
              onSubmit={handleSubmit(onSubmit)}
              className="w-full max-w-[210px] sm:max-w-[280px]"
              noValidate
            >
              {/* Logo (inline SVG, no external image) */}
              <div className="flex justify-center mb-2 sm:mb-3">
                <div className="relative group">
                  <div
                    aria-hidden
                    className="absolute inset-0 rounded-full bg-[#c6a052]/25 blur-xl opacity-60 group-hover:opacity-95 transition-opacity duration-500"
                  />
                  <HeritageLogo
                    size={56}
                    className="relative sm:[&]:w-[68px] sm:[&]:h-[68px] transition-transform duration-500 group-hover:scale-[1.06] drop-shadow-[0_4px_24px_rgba(198,160,82,0.45)]"
                  />
                </div>
              </div>

              {/* Title */}
              <h2 className="text-center text-[17px] sm:text-[22px] font-bold text-white tracking-wide drop-shadow-[0_0_18px_rgba(75,224,255,0.35)]">
                تسجيل الدخول
              </h2>
              <p className="text-center text-white/50 text-[10px] sm:text-[11px] mt-0.5 mb-3 sm:mb-5">
                أدخل بياناتك للمتابعة بأمان
              </p>

              {/* Error message */}
              {loginError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 bg-red-500/12 border border-red-500/30 rounded-lg p-2.5 mb-3 text-red-200 text-[11px]"
                >
                  <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
                  <span className="leading-snug">{loginError}</span>
                </div>
              )}

              {/* Email or username */}
              <div className="mb-2.5 sm:mb-3">
                <label htmlFor="email" className="sr-only">
                  البريد الإلكتروني أو اسم المستخدم
                </label>
                <div className="relative group">
                  <User
                    size={14}
                    aria-hidden
                    className="absolute right-2.5 sm:right-3 top-1/2 -translate-y-1/2 text-[#c6a052]/55 group-focus-within:text-[#c6a052] transition-colors duration-300"
                  />
                  <input
                    id="email"
                    type="text"
                    dir="ltr"
                    autoComplete="username"
                    aria-invalid={errors.email ? 'true' : 'false'}
                    disabled={isLoading || cooldownSec > 0}
                    placeholder="البريد أو اسم المستخدم"
                    className={`w-full pr-8 sm:pr-9 pl-2.5 sm:pl-3 py-2 sm:py-2.5 bg-white/[0.05] border rounded-lg text-[12px] sm:text-[13px] text-white placeholder-white/35 text-right
                      focus:ring-2 focus:ring-[#4be0ff]/40 focus:border-[#4be0ff]/40 outline-none transition-all duration-300
                      backdrop-blur-sm shadow-inner shadow-black/20
                      disabled:opacity-60 disabled:cursor-not-allowed
                      ${errors.email ? 'border-red-500/55' : 'border-white/10 hover:border-white/20'}`}
                    {...register('email', {
                      required: 'يرجى إدخال البريد أو اسم المستخدم',
                    })}
                  />
                </div>
                {errors.email && (
                  <p role="alert" className="text-red-400 text-[10px] sm:text-[10.5px] mt-1 mr-1">
                    {errors.email.message}
                  </p>
                )}
              </div>

              {/* Password */}
              <div className="mb-3 sm:mb-4">
                <label htmlFor="password" className="sr-only">
                  كلمة المرور
                </label>
                <div className="relative group">
                  <Lock
                    size={14}
                    aria-hidden
                    className="absolute right-2.5 sm:right-3 top-1/2 -translate-y-1/2 text-[#c6a052]/55 group-focus-within:text-[#c6a052] transition-colors duration-300"
                  />
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    dir="ltr"
                    placeholder="كلمة المرور"
                    autoComplete="current-password"
                    aria-invalid={errors.password ? 'true' : 'false'}
                    disabled={isLoading || cooldownSec > 0}
                    className={`w-full pr-8 sm:pr-9 pl-8 sm:pl-9 py-2 sm:py-2.5 bg-white/[0.05] border rounded-lg text-[12px] sm:text-[13px] text-white placeholder-white/35 text-right
                      focus:ring-2 focus:ring-[#4be0ff]/40 focus:border-[#4be0ff]/40 outline-none transition-all duration-300
                      backdrop-blur-sm shadow-inner shadow-black/20
                      disabled:opacity-60 disabled:cursor-not-allowed
                      ${errors.password ? 'border-red-500/55' : 'border-white/10 hover:border-white/20'}`}
                    {...register('password', { required: 'يرجى إدخال كلمة المرور' })}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                    className="absolute left-2.5 sm:left-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-[#c6a052] focus:text-[#c6a052] focus:outline-none transition-colors duration-300"
                  >
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                {errors.password && (
                  <p role="alert" className="text-red-400 text-[10px] sm:text-[10.5px] mt-1 mr-1">
                    {errors.password.message}
                  </p>
                )}
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={isLoading || cooldownSec > 0}
                aria-busy={isLoading}
                className="relative overflow-hidden w-full py-2 sm:py-2.5 bg-gradient-to-l from-[#c6a052] via-[#b9913f] to-[#a07d2e]
                  hover:from-[#d4af61] hover:via-[#c79c47] hover:to-[#b8912e]
                  text-white font-bold text-[12.5px] sm:text-[13.5px] tracking-wide rounded-lg
                  shadow-[0_10px_30px_-10px_rgba(198,160,82,0.6)]
                  hover:shadow-[0_18px_44px_-10px_rgba(198,160,82,0.75),0_0_24px_-4px_rgba(75,224,255,0.4)]
                  hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99]
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4be0ff]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0e1a2c]
                  transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0
                  flex items-center justify-center gap-2 group"
              >
                <span
                  aria-hidden
                  className="absolute inset-0 -translate-x-full group-hover:translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700"
                />
                {isLoading ? (
                  <>
                    <span className="w-3.5 h-3.5 border-[2.5px] border-white/30 border-t-white rounded-full animate-spin" />
                    <span>جاري التحقق...</span>
                  </>
                ) : cooldownSec > 0 ? (
                  // Phase 11C: cooldown after rate-limit. Counts down so the
                  // user has a clear "wait this many seconds" cue and is
                  // mechanically prevented from re-throttling themselves.
                  <span>يرجى الانتظار {cooldownSec} ثانية</span>
                ) : (
                  <>
                    <span>دخول آمن</span>
                    <ArrowLeft
                      size={15}
                      className="transition-transform duration-300 group-hover:-translate-x-1"
                    />
                  </>
                )}
              </button>
            </form>
          </div>
        </div>

        {/* ─── Below circle: device, trust, stats ─── */}
        <div className="mt-5 sm:mt-7 flex flex-col items-center gap-3 sm:gap-4 reveal-2 w-full px-2">
          {/* Device */}
          <div
            className="flex items-center justify-center gap-2 bg-white/[0.04] backdrop-blur-sm rounded-full py-1 sm:py-1.5 px-3 sm:px-3.5 border border-[#c6a052]/15"
            aria-label="نوع الجهاز"
          >
            <DeviceIcon device={deviceType} />
            <span className="text-[9px] sm:text-[10px] uppercase tracking-[0.15em] sm:tracking-[0.18em] text-white/45">
              متصل عبر: <span className="text-[#c6a052]/80">{deviceType}</span>
            </span>
          </div>

          {/* Trust */}
          <div className="flex items-center justify-center gap-2 text-[10px] sm:text-[11px] text-white/45 text-center">
            <ShieldCheck size={12} className="text-emerald-400/70 flex-shrink-0" />
            <span>اتصال آمن مشفّر · بياناتك محمية</span>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3 sm:gap-10 text-center text-white max-w-[340px]">
            <div>
              <p className="font-bold text-sm sm:text-base text-[#c6a052]">+5k</p>
              <p className="text-white/35 text-[8px] sm:text-[9px] uppercase tracking-[0.15em] sm:tracking-[0.18em] mt-0.5 whitespace-nowrap">
                طلب شهري
              </p>
            </div>
            <div className="border-x border-white/[0.08] px-3 sm:px-10">
              <p className="font-bold text-sm sm:text-base text-[#c6a052]">98%</p>
              <p className="text-white/35 text-[8px] sm:text-[9px] uppercase tracking-[0.15em] sm:tracking-[0.18em] mt-0.5">
                توصيل
              </p>
            </div>
            <div>
              <p className="font-bold text-sm sm:text-base text-[#c6a052]">4.9</p>
              <p className="text-white/35 text-[8px] sm:text-[9px] uppercase tracking-[0.15em] sm:tracking-[0.18em] mt-0.5">
                تقييم
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <p className="reveal-2 text-center text-[9px] sm:text-[10px] text-white/25 mt-4 sm:mt-6 tracking-[0.18em] sm:tracking-[0.22em] font-light">
          تراث مصر — TURATH MASR &copy; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}

// Default export — wraps the inner component in <Suspense> as required by
// Next.js 15 when useSearchParams() is used in a client component.
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center islamic-login-bg" dir="rtl">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#c6a052] border-t-transparent" />
        </div>
      }
    >
      <LoginPageInner />
    </Suspense>
  );
}
