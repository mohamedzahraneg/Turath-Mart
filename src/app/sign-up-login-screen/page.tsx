'use client';
import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast, Toaster } from 'sonner';
import AppLogo from '@/components/ui/AppLogo';
import {
  Eye,
  EyeOff,
  Mail,
  Lock,
  Truck,
  Package,
  BarChart3,
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

function getDeviceType(): string {
  if (typeof window === 'undefined') return 'كمبيوتر';
  const ua = navigator.userAgent;
  if (/tablet|ipad|playbook|silk/i.test(ua)) return 'تابلت';
  if (/mobile|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)) return 'موبايل';
  return 'كمبيوتر';
}

function DeviceIcon({ device }: { device: string }) {
  if (device === 'موبايل')
    return <Smartphone size={14} className="text-white/40" />;
  if (device === 'تابلت')
    return <Tablet size={14} className="text-white/40" />;
  return <Monitor size={14} className="text-white/40" />;
}

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [deviceType, setDeviceType] = useState('كمبيوتر');
  const { signIn } = useAuth();

  useEffect(() => {
    setDeviceType(getDeviceType());
  }, []);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({
    defaultValues: { remember: false },
  });

  const onSubmit = async (data: LoginForm) => {
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
        .select('role')
        .eq('id', authData.user.id)
        .single();

      const userRole = profile?.role || 'employee';
      const finalRoleId = authData.user.user_metadata?.role_id || (userRole === 'admin' ? 'r1' : 'r6');

      if (typeof window !== 'undefined') {
        localStorage.setItem(
          'current_user',
          JSON.stringify({
            email: authData.user.email,
            name: authData.user.user_metadata?.full_name || 'مستخدم',
            role: userRole,
            roleId: finalRoleId,
          })
        );
      }

      toast.success(`مرحباً! تم تسجيل الدخول — ${deviceType}`);
      const permissions = getPermissionsForRoleId(finalRoleId);
      const landingPage = getInitialRoute(permissions);

      setTimeout(() => {
        window.location.href = landingPage;
      }, 800);
    } catch (err: any) {
      console.error('Login exception:', err);
      setLoginError(`بيانات غير صحيحة: ${err.message}`);
      toast.error(`فشل تسجيل الدخول`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen relative flex items-center justify-center overflow-hidden bg-[hsl(222,47%,11%)] animate-gradient-shift"
      style={{
        background: 'linear-gradient(-45deg, hsl(25,60%,15%), hsl(222,47%,11%), hsl(222,47%,20%), hsl(40,80%,30%))',
        backgroundSize: '400% 400%',
      }}
      dir="rtl"
    >
      <Toaster position="top-center" richColors />

      {/* Background Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[10%] left-[10%] w-64 h-64 bg-[hsl(40,80%,50%)]/10 rounded-full blur-[100px] animate-pulse-slow" />
        <div className="absolute bottom-[10%] right-[10%] w-96 h-96 bg-[hsl(25,60%,30%)]/20 rounded-full blur-[120px] animate-pulse-slow" />
        <div className="absolute top-1/4 right-1/4 w-32 h-32 border border-white/5 rounded-full animate-float" style={{ animationDelay: '1s' }} />
        <div className="absolute bottom-1/4 left-1/3 w-48 h-48 border border-white/5 rounded-3xl rotate-45 animate-float" style={{ animationDelay: '2s' }} />
      </div>

      {/* Islamic Overlay */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none">
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="islamic-pattern" x="0" y="0" width="60" height="60" patternUnits="userSpaceOnUse">
              <path d="M30 0 L60 30 L30 60 L0 30 Z" fill="none" stroke="white" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#islamic-pattern)" />
        </svg>
      </div>

      <div className="relative z-10 w-full max-w-[480px] px-6">
        <div className="glass-card rounded-[2.5rem] p-8 lg:p-12 transition-all duration-500 hover:shadow-[0_20px_50px_rgba(0,0,0,0.3)]">
          <div className="flex flex-col items-center mb-10 text-center">
            <div className="reveal-0 mb-4 bg-white/10 p-4 rounded-3xl backdrop-blur-md border border-white/10">
              <AppLogo size={60} />
            </div>
            <h1 className="reveal-1 text-3xl font-extrabold text-white mb-2">تراث مصر</h1>
            <p className="reveal-2 text-white/60 text-sm tracking-wide">نظام الإدارة المتكامل — دخول الموظفين</p>
          </div>

          <div className="reveal-1 flex items-center justify-center gap-2 bg-white/5 backdrop-blur-sm rounded-full py-2 px-4 mb-8 border border-white/10">
            <DeviceIcon device={deviceType} />
            <span className="text-[10px] uppercase tracking-tighter text-white/50">
              متصل عبر: <span className="text-white/80">{deviceType}</span>
            </span>
          </div>

          {loginError && (
            <div className="reveal-1 flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-2xl p-4 mb-6 text-red-200 text-xs">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
            <div className="reveal-1">
              <label className="block text-xs font-bold text-white/50 mb-2 mr-1 uppercase tracking-widest">اسم المستخدم</label>
              <div className="relative">
                <Mail size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30" />
                <input
                  id="email"
                  type="text"
                  className={`input-field glass-input !bg-white/5 !border-white/10 !text-white pr-11 h-14 rounded-2xl focus:!border-amber-500/50 focus:!ring-amber-500/20 ${errors.email ? '!border-red-500/50' : ''}`}
                  placeholder="admin أو البريد الإلكتروني"
                  {...register('email', { required: 'يرجى إدخال اسم المستخدم' })}
                />
              </div>
              {errors.email && <p className="text-red-400 text-[10px] mt-1 mr-1">{errors.email.message}</p>}
            </div>

            <div className="reveal-2">
              <label className="block text-xs font-bold text-white/50 mb-2 mr-1 uppercase tracking-widest">كلمة المرور</label>
              <div className="relative">
                <Lock size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  className={`input-field glass-input !bg-white/5 !border-white/10 !text-white pr-11 pl-12 h-14 rounded-2xl focus:!border-amber-500/50 focus:!ring-amber-500/20 ${errors.password ? '!border-red-500/50' : ''}`}
                  placeholder="••••••••"
                  {...register('password', { required: 'يرجى إدخال كلمة المرور' })}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 hover:text-white transition-colors"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {errors.password && <p className="text-red-400 text-[10px] mt-1 mr-1">{errors.password.message}</p>}
            </div>

            <div className="reveal-3 pt-2">
              <button
                type="submit"
                disabled={isLoading}
                className="w-full h-14 flex items-center justify-center gap-3 bg-gradient-to-r from-amber-600 to-amber-500 text-white rounded-2xl font-bold text-lg shadow-[0_10px_20px_-10px_rgba(217,119,6,0.5)] hover:shadow-[0_15px_30px_-10px_rgba(217,119,6,0.6)] hover:-translate-y-0.5 transition-all duration-300 disabled:opacity-50"
              >
                {isLoading ? (
                  <div className="w-6 h-6 border-3 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <span>تسجيل الدخول</span>
                    <LogIn size={20} />
                  </>
                )}
              </button>
            </div>
          </form>

          <div className="reveal-4 mt-12 pt-8 border-t border-white/5 grid grid-cols-3 gap-2 text-center text-white">
            <div>
              <p className="font-bold text-sm">+5k</p>
              <p className="text-white/30 text-[9px] uppercase">طلب شهري</p>
            </div>
            <div className="border-x border-white/5">
              <p className="font-bold text-sm">98%</p>
              <p className="text-white/30 text-[9px] uppercase">توصيل</p>
            </div>
            <div>
              <p className="font-bold text-sm">4.9</p>
              <p className="text-white/30 text-[9px] uppercase">تقييم</p>
            </div>
          </div>
        </div>
        <p className="reveal-4 text-center text-[10px] text-white/20 mt-8 tracking-[0.2em] font-light">تراث مصر — TURATH MASR &copy; {new Date().getFullYear()}</p>
      </div>
    </div>
  );
}
