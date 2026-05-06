'use client';
import React, { Suspense, useState, useEffect, useMemo, useCallback } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { toast, Toaster } from 'sonner';
import {
  Eye,
  EyeOff,
  Mail,
  Lock,
  ArrowLeft,
  AlertCircle,
  Monitor,
  Smartphone,
  Tablet,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  useAuth,
  getDefaultRouteForPermissions as getInitialRoute,
  getPermissionsForRoleId,
} from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
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

// useSearchParams() forces this page out of static rendering, so the inner
// component must live inside a <Suspense> boundary (Next.js 15 requirement).
function LoginPageInner() {
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [deviceType, setDeviceType] = useState('كمبيوتر');
  const [mounted, setMounted] = useState(false);
  const { signIn } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    setDeviceType(getDeviceLabel());
    setMounted(true);
  }, []);

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
      Array.from({ length: 28 }, (_, i) => ({
        id: i,
        delay: Math.random() * 14,
        size: Math.random() * 4 + 2,
        left: Math.random() * 100,
        duration: Math.random() * 18 + 14,
      })),
    []
  );

  /* ─── Auth logic — UNCHANGED from previous version ─── */
  const onSubmit = useCallback(
    async (data: LoginForm) => {
      setIsLoading(true);
      setLoginError('');

      try {
        const identifier = data.email.trim();
        // NOTE: login requires a real email address.
        // The previous "admin" alias and auto-domain-append shortcuts have been
        // removed for security — they leaked the admin email and made identity
        // probing trivial.
        if (!identifier.includes('@')) {
          setLoginError('يرجى إدخال البريد الإلكتروني الكامل');
          setIsLoading(false);
          return;
        }
        const authData = await signIn(identifier, data.password);
        const supabase = createClient();
        const { data: profile } = await supabase
          .from('profiles')
          .select('role, role_id, role_name, permissions, full_name')
          .eq('id', authData.user.id)
          .single();

        const userRole = profile?.role || 'employee';
        let finalRoleId: string = profile?.role_id || authData.user.user_metadata?.role_id || '';
        if (!finalRoleId) {
          if (userRole === 'admin') finalRoleId = 'r1';
          else if (userRole === 'supervisor') finalRoleId = 'r2';
          else if (userRole === 'delegate') finalRoleId = 'r4';
          else finalRoleId = 'r6';
        }
        const roleName = profile?.role_name || userRole;
        const rawPerms = profile?.permissions;
        const dbPerms: string[] = Array.isArray(rawPerms) ? rawPerms : [];
        const effectivePerms = dbPerms.length > 0 ? dbPerms : getPermissionsForRoleId(finalRoleId);

        // No localStorage needed - AuthContext reads from Supabase directly

        toast.success(`مرحباً! تم تسجيل الدخول — ${deviceType}`);
        const permissions =
          effectivePerms.length > 0 ? effectivePerms : getPermissionsForRoleId(finalRoleId);
        const computedLanding = getInitialRoute(permissions);
        const nextParam = searchParams?.get('next');
        const landingPage = nextParam && nextParam.startsWith('/') ? nextParam : computedLanding;

        setTimeout(() => {
          router.replace(landingPage);
        }, 800);
      } catch (err: any) {
        console.error('Login exception:', err);
        setLoginError(`بيانات غير صحيحة: ${err.message}`);
        toast.error('فشل تسجيل الدخول');
      } finally {
        setIsLoading(false);
      }
    },
    [signIn, deviceType, router, searchParams]
  );

  return (
    <div
      className="min-h-screen relative flex items-center justify-center overflow-hidden islamic-login-bg px-4 py-10"
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

      {/* ─── Decorative heritage stars (background depth) ─── */}
      <HeritageOrnament
        aria-hidden
        className="absolute top-[8%] left-[12%] w-20 h-20 text-[#c6a052] animate-float opacity-30 hidden md:block"
      />
      <HeritageOrnament
        aria-hidden
        className="absolute bottom-[10%] right-[8%] w-16 h-16 text-[#c6a052] animate-float opacity-20 hidden md:block"
      />
      <HeritageOrnament
        aria-hidden
        className="absolute top-[58%] left-[6%] w-12 h-12 text-[#c6a052] animate-float opacity-15 hidden lg:block"
      />

      {/* ─── Main content ─── */}
      <div className="relative z-10 w-full max-w-[480px]">
        {/* ─── Welcome / brand strip ─── */}
        <header className="text-center mb-7 reveal-0">
          <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.4em] text-[#c6a052]/80 mb-4">
            <Sparkles size={11} className="opacity-70" />
            <span>Heritage Management</span>
            <Sparkles size={11} className="opacity-70" />
          </span>
          <h1 className="text-[34px] sm:text-[40px] font-extrabold text-white leading-tight drop-shadow-lg">
            مرحبًا بك في لوحة تحكم{' '}
            <span className="islamic-shimmer bg-clip-text text-transparent">تراث مصر</span>
          </h1>
          <p className="text-white/55 text-[13px] sm:text-sm mt-3 max-w-[420px] mx-auto leading-relaxed">
            إدارة الطلبات، الشحن، المخزون وخدمة العملاء من مكان واحد
          </p>
        </header>

        {/* ─── Glass card ─── */}
        <section
          className="islamic-glass-card rounded-[28px] p-7 sm:p-9 reveal-1"
          aria-label="نموذج تسجيل الدخول"
        >
          {/* ─── Logo + heading ─── */}
          <div className="flex flex-col items-center mb-7">
            <div className="relative mb-4 group">
              <div
                aria-hidden
                className="absolute inset-0 rounded-full bg-[#c6a052]/30 blur-xl opacity-60 group-hover:opacity-90 transition-opacity duration-500"
              />
              <Image
                src="/assets/images/new_logo.jpg"
                alt="تراث مصر"
                width={92}
                height={92}
                priority
                className="relative w-[92px] h-[92px] rounded-full object-cover shadow-[0_8px_32px_rgba(198,160,82,0.45)] border-2 border-[#c6a052]/30 transition-transform duration-500 group-hover:scale-[1.04]"
              />
            </div>
            <h2 className="text-lg font-bold text-white tracking-wide">تسجيل الدخول</h2>
            <p className="text-white/45 text-xs mt-1">أدخل بياناتك للمتابعة بأمان</p>
          </div>

          {/* ─── Device badge ─── */}
          <div
            className="flex items-center justify-center gap-2 bg-white/[0.04] backdrop-blur-sm rounded-full py-1.5 px-4 mb-6 border border-[#c6a052]/15"
            aria-label="نوع الجهاز"
          >
            <DeviceIcon device={deviceType} />
            <span className="text-[10px] uppercase tracking-[0.18em] text-white/45">
              متصل عبر: <span className="text-[#c6a052]/80">{deviceType}</span>
            </span>
          </div>

          {/* ─── Error message ─── */}
          {loginError && (
            <div
              role="alert"
              className="flex items-start gap-2 bg-red-500/10 border border-red-500/25 rounded-xl p-4 mb-6 text-red-200 text-xs reveal-1"
            >
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
              <span>{loginError}</span>
            </div>
          )}

          {/* ─── Form ─── */}
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
            {/* Email */}
            <div className="reveal-1">
              <label
                htmlFor="email"
                className="block text-[13px] font-medium text-white/65 mb-2 mr-1"
              >
                البريد الإلكتروني
              </label>
              <div className="relative group">
                <Mail
                  size={18}
                  aria-hidden
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-[#c6a052]/45 group-focus-within:text-[#c6a052] transition-colors duration-300"
                />
                <input
                  id="email"
                  type="email"
                  dir="ltr"
                  className={`w-full pr-11 pl-4 py-3.5 bg-white/[0.06] border rounded-xl text-white placeholder-white/25
                    focus:ring-2 focus:ring-[#c6a052]/45 focus:border-[#c6a052]/40 outline-none transition-all duration-300
                    backdrop-blur-sm shadow-inner shadow-black/10
                    ${errors.email ? 'border-red-500/55' : 'border-white/[0.09] hover:border-white/15'}`}
                  placeholder="name@example.com"
                  autoComplete="email"
                  aria-invalid={errors.email ? 'true' : 'false'}
                  {...register('email', { required: 'يرجى إدخال البريد الإلكتروني' })}
                />
              </div>
              {errors.email && (
                <p role="alert" className="text-red-400 text-xs mt-1.5 mr-1">
                  {errors.email.message}
                </p>
              )}
            </div>

            {/* Password */}
            <div className="reveal-2">
              <label
                htmlFor="password"
                className="block text-[13px] font-medium text-white/65 mb-2 mr-1"
              >
                كلمة المرور
              </label>
              <div className="relative group">
                <Lock
                  size={18}
                  aria-hidden
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-[#c6a052]/45 group-focus-within:text-[#c6a052] transition-colors duration-300"
                />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  className={`w-full pr-11 pl-12 py-3.5 bg-white/[0.06] border rounded-xl text-white placeholder-white/25
                    focus:ring-2 focus:ring-[#c6a052]/45 focus:border-[#c6a052]/40 outline-none transition-all duration-300
                    backdrop-blur-sm shadow-inner shadow-black/10
                    ${errors.password ? 'border-red-500/55' : 'border-white/[0.09] hover:border-white/15'}`}
                  placeholder="••••••••"
                  dir="ltr"
                  aria-invalid={errors.password ? 'true' : 'false'}
                  {...register('password', { required: 'يرجى إدخال كلمة المرور' })}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-white/35 hover:text-[#c6a052] focus:text-[#c6a052] focus:outline-none transition-colors duration-300"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {errors.password && (
                <p role="alert" className="text-red-400 text-xs mt-1.5 mr-1">
                  {errors.password.message}
                </p>
              )}
            </div>

            {/* Submit */}
            <div className="reveal-3 pt-2">
              <button
                type="submit"
                disabled={isLoading}
                aria-busy={isLoading}
                className="relative overflow-hidden w-full py-[15px] bg-gradient-to-l from-[#c6a052] via-[#b9913f] to-[#a07d2e]
                  hover:from-[#d4af61] hover:via-[#c79c47] hover:to-[#b8912e]
                  text-white font-bold text-[15px] tracking-wide rounded-xl
                  shadow-[0_10px_30px_-10px_rgba(198,160,82,0.55)]
                  hover:shadow-[0_18px_44px_-10px_rgba(198,160,82,0.7)]
                  hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99]
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c6a052]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c1929]
                  transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0
                  flex items-center justify-center gap-3 group"
              >
                {/* Shimmer sweep on hover */}
                <span
                  aria-hidden
                  className="absolute inset-0 -translate-x-full group-hover:translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700"
                />
                {isLoading ? (
                  <>
                    <span className="w-5 h-5 border-[3px] border-white/30 border-t-white rounded-full animate-spin" />
                    <span>جاري التحقق...</span>
                  </>
                ) : (
                  <>
                    <span>دخول آمن</span>
                    <ArrowLeft
                      size={18}
                      className="transition-transform duration-300 group-hover:-translate-x-1"
                    />
                  </>
                )}
              </button>
            </div>
          </form>

          {/* ─── Trust note ─── */}
          <div className="reveal-4 mt-7 flex items-center justify-center gap-2 text-[11px] text-white/45">
            <ShieldCheck size={13} className="text-emerald-400/70" />
            <span>اتصال آمن مشفّر · بياناتك محمية</span>
          </div>

          {/* ─── Stats strip ─── */}
          <div className="reveal-4 mt-6 pt-5 border-t border-white/[0.06] grid grid-cols-3 gap-2 text-center text-white">
            <div>
              <p className="font-bold text-sm text-[#c6a052]">+5k</p>
              <p className="text-white/35 text-[9px] uppercase tracking-[0.18em] mt-0.5">
                طلب شهري
              </p>
            </div>
            <div className="border-x border-white/[0.06]">
              <p className="font-bold text-sm text-[#c6a052]">98%</p>
              <p className="text-white/35 text-[9px] uppercase tracking-[0.18em] mt-0.5">توصيل</p>
            </div>
            <div>
              <p className="font-bold text-sm text-[#c6a052]">4.9</p>
              <p className="text-white/35 text-[9px] uppercase tracking-[0.18em] mt-0.5">تقييم</p>
            </div>
          </div>
        </section>

        {/* ─── Footer ─── */}
        <p className="reveal-4 text-center text-[10px] text-white/25 mt-7 tracking-[0.22em] font-light">
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
