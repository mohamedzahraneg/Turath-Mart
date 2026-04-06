'use client';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { toast, Toaster } from 'sonner';
import {
  Eye,
  EyeOff,
  Mail,
  Lock,
  LogIn,
  AlertCircle,
  Monitor,
  Smartphone,
  Tablet,
} from 'lucide-react';
import {
  useAuth,
  getDefaultRouteForPermissions as getInitialRoute,
  getPermissionsForRoleId,
} from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';

interface LoginForm {
  email: string;
  password: string;
  remember: boolean;
}

/* ─── helpers ─── */
function getDeviceType(): string {
  if (typeof window === 'undefined') return 'كمبيوتر';
  const ua = navigator.userAgent;
  if (/tablet|ipad|playbook|silk/i.test(ua)) return 'تابلت';
  if (/mobile|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)) return 'موبايل';
  return 'كمبيوتر';
}

function DeviceIcon({ device }: { device: string }) {
  if (device === 'موبايل') return <Smartphone size={14} className="text-gold-400/60" />;
  if (device === 'تابلت') return <Tablet size={14} className="text-gold-400/60" />;
  return <Monitor size={14} className="text-gold-400/60" />;
}

/* ─── Particle component ─── */
function Particle({ delay, size, left, duration }: { delay: number; size: number; left: number; duration: number }) {
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

/* ─── Islamic geometric star SVG ─── */
function IslamicStar({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <polygon
        points="50,5 61,35 95,35 68,57 79,90 50,70 21,90 32,57 5,35 39,35"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.15"
      />
      <polygon
        points="50,15 58,38 85,38 63,53 72,80 50,65 28,80 37,53 15,38 42,38"
        stroke="currentColor"
        strokeWidth="0.5"
        opacity="0.1"
      />
    </svg>
  );
}

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [deviceType, setDeviceType] = useState('كمبيوتر');
  const [mounted, setMounted] = useState(false);
  const { signIn } = useAuth();

  useEffect(() => {
    setDeviceType(getDeviceType());
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
      Array.from({ length: 35 }, (_, i) => ({
        id: i,
        delay: Math.random() * 12,
        size: Math.random() * 5 + 2,
        left: Math.random() * 100,
        duration: Math.random() * 18 + 12,
      })),
    []
  );

  const onSubmit = useCallback(
    async (data: LoginForm) => {
      setIsLoading(true);
      setLoginError('');

      try {
        let identifier = data.email.trim();
        if (!identifier.includes('@')) {
          if (identifier.toLowerCase() === 'admin') {
            identifier = 'zahran@turathmasr.com';
          } else {
            identifier = `${identifier}@turathmasr.internal`;
          }
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

        if (typeof window !== 'undefined') {
          localStorage.setItem(
            'current_user',
            JSON.stringify({
              email: authData.user.email,
              name: profile?.full_name || authData.user.user_metadata?.full_name || authData.user.email?.split('@')[0] || 'مستخدم',
              role: roleName,
              roleId: finalRoleId,
              customPermissions: effectivePerms.length > 0 ? effectivePerms : null,
            })
          );
        }

        toast.success(`مرحباً! تم تسجيل الدخول — ${deviceType}`);
        const permissions = effectivePerms.length > 0 ? effectivePerms : getPermissionsForRoleId(finalRoleId);
        const landingPage = getInitialRoute(permissions);

        setTimeout(() => {
          window.location.href = landingPage;
        }, 800);
      } catch (err: any) {
        console.error('Login exception:', err);
        setLoginError(`بيانات غير صحيحة: ${err.message}`);
        toast.error('فشل تسجيل الدخول');
      } finally {
        setIsLoading(false);
      }
    },
    [signIn, deviceType]
  );

  return (
    <div
      className="min-h-screen relative flex items-center justify-center overflow-hidden islamic-login-bg"
      dir="rtl"
    >
      <Toaster position="top-center" richColors />

      {/* ─── Floating golden particles ─── */}
      {mounted &&
        particles.map((p) => <Particle key={p.id} delay={p.delay} size={p.size} left={p.left} duration={p.duration} />)}

      {/* ─── Decorative blurred orbs ─── */}
      <div className="absolute top-[-15%] right-[-8%] w-[500px] h-[500px] bg-[#c6a052]/8 rounded-full blur-[120px] animate-pulse-slow pointer-events-none" />
      <div className="absolute bottom-[-15%] left-[-8%] w-[600px] h-[600px] bg-[#1a3a5c]/20 rounded-full blur-[140px] animate-pulse-slow pointer-events-none" />
      <div className="absolute top-[40%] left-[50%] w-[300px] h-[300px] bg-[#c6a052]/5 rounded-full blur-[100px] animate-float pointer-events-none" />

      {/* ─── Islamic geometric pattern overlay ─── */}
      <div className="absolute inset-0 opacity-[0.04] pointer-events-none">
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="islamic-geo" x="0" y="0" width="80" height="80" patternUnits="userSpaceOnUse">
              <path d="M40 0 L80 40 L40 80 L0 40 Z" fill="none" stroke="#c6a052" strokeWidth="0.5" />
              <circle cx="40" cy="40" r="15" fill="none" stroke="#c6a052" strokeWidth="0.3" />
              <path d="M20 0 L40 20 L60 0" fill="none" stroke="#c6a052" strokeWidth="0.3" />
              <path d="M0 20 L20 40 L0 60" fill="none" stroke="#c6a052" strokeWidth="0.3" />
              <path d="M80 20 L60 40 L80 60" fill="none" stroke="#c6a052" strokeWidth="0.3" />
              <path d="M20 80 L40 60 L60 80" fill="none" stroke="#c6a052" strokeWidth="0.3" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#islamic-geo)" />
        </svg>
      </div>

      {/* ─── Floating Islamic stars ─── */}
      <IslamicStar className="absolute top-[8%] left-[12%] w-20 h-20 text-[#c6a052] animate-float opacity-30" />
      <IslamicStar className="absolute bottom-[12%] right-[8%] w-16 h-16 text-[#c6a052] animate-float opacity-20" />
      <IslamicStar className="absolute top-[60%] left-[5%] w-12 h-12 text-[#c6a052] animate-float opacity-15" />

      {/* ─── Main login card ─── */}
      <div className="relative z-10 w-full max-w-[460px] px-5">
        {/* ─── Welcome text ─── */}
        <div className="text-center mb-8 reveal-0">
          <p className="text-[#c6a052] text-lg mb-3 font-semibold tracking-wide islamic-shimmer">
            السلام عليكم ورحمة الله وبركاته
          </p>
          <h1 className="text-4xl font-extrabold text-white mb-2 drop-shadow-lg">
            تراث مصر
          </h1>
          <p className="text-white/50 text-sm">مرحبًا بك في نظام الإدارة المتكامل</p>
        </div>

        {/* ─── Glass card ─── */}
        <div className="islamic-glass-card rounded-[2rem] p-8 lg:p-10 reveal-1">
          {/* ─── Logo icon ─── */}
          <div className="flex flex-col items-center mb-8">
            <div className="w-24 h-24 mb-4 hover:scale-105 transition-transform duration-500">
              <img src="/assets/images/new_logo.jpg" alt="تراث مصر" className="w-full h-full rounded-full object-cover shadow-[0_8px_30px_rgba(198,160,82,0.4)] border-2 border-[#c6a052]/30" />
            </div>
            <h2 className="text-xl font-bold text-white">تسجيل الدخول</h2>
            <p className="text-white/40 text-sm mt-1">أدخل بياناتك للمتابعة</p>
          </div>

          {/* ─── Device badge ─── */}
          <div className="flex items-center justify-center gap-2 bg-white/5 backdrop-blur-sm rounded-full py-2 px-4 mb-6 border border-[#c6a052]/15">
            <DeviceIcon device={deviceType} />
            <span className="text-[10px] uppercase tracking-wider text-white/40">
              متصل عبر: <span className="text-[#c6a052]/70">{deviceType}</span>
            </span>
          </div>

          {/* ─── Error message ─── */}
          {loginError && (
            <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-6 text-red-200 text-xs reveal-1">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
              <span>{loginError}</span>
            </div>
          )}

          {/* ─── Form ─── */}
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
            {/* Email */}
            <div className="reveal-1">
              <label className="block text-sm font-medium text-white/50 mb-2 mr-1">
                البريد الإلكتروني
              </label>
              <div className="relative">
                <Mail
                  size={18}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-[#c6a052]/40"
                />
                <input
                  id="email"
                  type="text"
                  className={`w-full pr-11 pl-4 py-3.5 bg-white/[0.07] border rounded-xl text-white placeholder-white/25
                    focus:ring-2 focus:ring-[#c6a052]/40 focus:border-[#c6a052]/30 outline-none transition-all duration-300
                    backdrop-blur-sm ${errors.email ? 'border-red-500/50' : 'border-white/10'}`}
                  placeholder="admin أو البريد الإلكتروني"
                  {...register('email', { required: 'يرجى إدخال اسم المستخدم' })}
                />
              </div>
              {errors.email && (
                <p className="text-red-400 text-xs mt-1.5 mr-1">{errors.email.message}</p>
              )}
            </div>

            {/* Password */}
            <div className="reveal-2">
              <label className="block text-sm font-medium text-white/50 mb-2 mr-1">
                كلمة المرور
              </label>
              <div className="relative">
                <Lock
                  size={18}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-[#c6a052]/40"
                />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  className={`w-full pr-11 pl-12 py-3.5 bg-white/[0.07] border rounded-xl text-white placeholder-white/25
                    focus:ring-2 focus:ring-[#c6a052]/40 focus:border-[#c6a052]/30 outline-none transition-all duration-300
                    backdrop-blur-sm ${errors.password ? 'border-red-500/50' : 'border-white/10'}`}
                  placeholder="••••••••"
                  dir="ltr"
                  {...register('password', { required: 'يرجى إدخال كلمة المرور' })}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 hover:text-[#c6a052] transition-colors"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {errors.password && (
                <p className="text-red-400 text-xs mt-1.5 mr-1">{errors.password.message}</p>
              )}
            </div>

            {/* Submit */}
            <div className="reveal-3 pt-2">
              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-4 bg-gradient-to-l from-[#c6a052] to-[#a07d2e] hover:from-[#d4af61] hover:to-[#b8912e]
                  text-white font-bold text-lg rounded-xl shadow-[0_10px_30px_-10px_rgba(198,160,82,0.5)]
                  hover:shadow-[0_15px_40px_-10px_rgba(198,160,82,0.6)] hover:-translate-y-0.5
                  transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed
                  flex items-center justify-center gap-3"
              >
                {isLoading ? (
                  <div className="w-6 h-6 border-3 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <span>دخول</span>
                    <LogIn size={20} />
                  </>
                )}
              </button>
            </div>
          </form>

          {/* ─── Stats ─── */}
          <div className="reveal-4 mt-10 pt-6 border-t border-white/[0.06] grid grid-cols-3 gap-2 text-center text-white">
            <div>
              <p className="font-bold text-sm text-[#c6a052]">+5k</p>
              <p className="text-white/30 text-[9px] uppercase tracking-wider">طلب شهري</p>
            </div>
            <div className="border-x border-white/[0.06]">
              <p className="font-bold text-sm text-[#c6a052]">98%</p>
              <p className="text-white/30 text-[9px] uppercase tracking-wider">توصيل</p>
            </div>
            <div>
              <p className="font-bold text-sm text-[#c6a052]">4.9</p>
              <p className="text-white/30 text-[9px] uppercase tracking-wider">تقييم</p>
            </div>
          </div>
        </div>

        {/* ─── Footer ─── */}
        <p className="reveal-4 text-center text-[10px] text-white/20 mt-8 tracking-[0.2em] font-light">
          تراث مصر — TURATH MASR &copy; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
