'use client';
import React, { useState, useEffect } from 'react';

import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Toaster } from 'sonner';
import AppLogo from '@/components/ui/AppLogo';
import { Eye, EyeOff, Mail, Lock, Truck, Package, BarChart3, Shield, LogIn, AlertCircle, Monitor, Smartphone, Tablet } from 'lucide-react';
import { getDefaultRouteForPermissions, getPermissionsForRoleId } from '@/contexts/AuthContext';

interface LoginForm {
  email: string;
  password: string;
  remember: boolean;
}

interface StoredEmployee {
  id: string;
  name: string;
  username: string;
  email?: string;
  password: string;
  roleId: string;
  status: 'active' | 'inactive';
  createdAt: string;
  avatar?: string;
}

interface StoredRole {
  id: string;
  name: string;
  permissions: string[];
  color?: string;
}

import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';

function getDeviceType(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/tablet|ipad|playbook|silk/i.test(ua)) return 'تابلت';
  if (/mobile|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)) return 'موبايل';
  return 'كمبيوتر';
}

function DeviceIcon({ device }: { device: string }) {
  if (device === 'موبايل') return <Smartphone size={14} className="text-[hsl(var(--muted-foreground))]" />;
  if (device === 'تابلت') return <Tablet size={14} className="text-[hsl(var(--muted-foreground))]" />;
  return <Monitor size={14} className="text-[hsl(var(--muted-foreground))]" />;
}

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [deviceType, setDeviceType] = useState('كمبيوتر');
  
  const { signIn } = useAuth();

  const STATS = [
    { icon: <Package className="w-8 h-8" />, value: '+5,000', label: 'طلب شهري' },
    { icon: <Truck className="w-8 h-8" />, value: '98%', label: 'نسبة التوصيل' },
    { icon: <BarChart3 className="w-8 h-8" />, value: '4.9', label: 'تقييم العملاء' },
  ];

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
      const authData = await signIn(data.email.trim(), data.password);
      
      const supabase = createClient();
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', authData.user.id)
        .single();

      const userRole = profile?.role || 'employee';

      // Setting localStorage purely for Legacy AuthContext support
      if (typeof window !== 'undefined') {
        localStorage.setItem('current_user', JSON.stringify({
          email: authData.user.email,
          name: authData.user.user_metadata?.full_name || 'مستخدم',
          role: userRole,
          roleId: userRole === 'admin' ? 'r1' : 'r3', 
        }));
      }

      toast.success(`مرحباً! تم تسجيل الدخول — ${deviceType}`);
      setTimeout(() => { window.location.href = '/dashboard'; }, 800);
    } catch (err: any) {
      setLoginError('بيانات الدخول غير صحيحة. تأكد من البريد الإلكتروني وكلمة المرور');
      toast.error('فشل تسجيل الدخول — تحقق من البيانات');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex" dir="rtl">
      <Toaster position="top-center" richColors />

      {/* Right: Brand Panel */}
      <div className="hidden lg:flex lg:w-[52%] relative overflow-hidden flex-col justify-between p-10"
        style={{ background: 'linear-gradient(135deg, hsl(25,60%,20%) 0%, hsl(25,55%,35%) 60%, hsl(40,80%,45%) 100%)' }}>

        {/* Islamic geometric background pattern */}
        <div className="absolute inset-0 opacity-10">
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="islamic-star" x="0" y="0" width="80" height="80" patternUnits="userSpaceOnUse">
                <polygon points="40,5 47,28 70,28 52,43 59,66 40,52 21,66 28,43 10,28 33,28" fill="none" stroke="white" strokeWidth="1.5"/>
                <polygon points="40,15 44,28 58,28 47,36 51,50 40,42 29,50 33,36 22,28 36,28" fill="none" stroke="white" strokeWidth="0.8" opacity="0.5"/>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#islamic-star)" />
          </svg>
        </div>

        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-12">
            <AppLogo size={48} />
            <div>
              <h1 className="text-3xl font-bold text-white tracking-tight">تراث مارت</h1>
              <p className="text-amber-200 text-sm">Turath Mart — نظام الإدارة المتكامل</p>
            </div>
          </div>

          <h2 className="text-4xl font-bold text-white leading-relaxed mb-4">
            إدارة نشاطك<br />
            <span className="text-[hsl(40,80%,72%)]">بكل احترافية</span>
          </h2>
          <p className="text-amber-100 text-lg leading-relaxed max-w-md">
            منصة متكاملة لتسجيل الأوردرات، تتبع الشحن، إدارة المخزون، وتقارير مالية دقيقة — كل شيء في مكان واحد.
          </p>
        </div>

        {/* Stats */}
        <div className="relative z-10 grid grid-cols-3 gap-4">
          {STATS.map((stat, i) => (
            <div key={`stat-${i + 1}`} className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 border border-white/20">
              <div className="text-[hsl(40,80%,72%)] mb-2">{stat.icon}</div>
              <p className="text-2xl font-bold text-white">{stat.value}</p>
              <p className="text-amber-200 text-xs mt-1">{stat.label}</p>
            </div>
          ))}
        </div>

        <div className="relative z-10 flex items-center gap-2 text-amber-200 text-sm">
          <Shield size={16} />
          <span>بيانات محمية بتشفير SSL — خوادم آمنة</span>
        </div>
      </div>

      {/* Left: Form Panel */}
      <div className="flex-1 flex flex-col justify-center items-center px-6 py-10 bg-[hsl(210,20%,97%)]">
        <div className="w-full max-w-[420px]">
          {/* Mobile logo */}
          <div className="flex items-center gap-2 mb-8 lg:hidden">
            <AppLogo size={36} />
            <span className="font-bold text-xl text-[hsl(var(--primary))]">تراث مارت</span>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-[hsl(var(--foreground))]">تسجيل الدخول</h2>
            <p className="text-[hsl(var(--muted-foreground))] text-sm mt-1">أدخل بياناتك للوصول إلى نظام تراث مارت</p>
          </div>

          {/* Device indicator */}
          <div className="flex items-center gap-2 bg-[hsl(var(--muted))]/50 rounded-xl px-3 py-2 mb-4 text-xs text-[hsl(var(--muted-foreground))]">
            <DeviceIcon device={deviceType} />
            <span>الجهاز الحالي: <span className="font-semibold text-[hsl(var(--foreground))]">{deviceType}</span></span>
          </div>

          {/* Error */}
          {loginError && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 mb-4 text-red-700 text-sm fade-in">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
            {/* Username / Email */}
            <div>
              <label className="label-text" htmlFor="email">اسم المستخدم أو البريد الإلكتروني</label>
              <div className="relative">
                <Mail size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
                <input
                  id="email"
                  type="text"
                  className={`input-field pr-9 ${errors.email ? 'border-red-400 focus:ring-red-400' : ''}`}
                  placeholder="اسم المستخدم أو البريد الإلكتروني"
                  autoComplete="username"
                  {...register('email', {
                    required: 'اسم المستخدم أو البريد الإلكتروني مطلوب',
                  })}
                />
              </div>
              {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
            </div>

            {/* Password */}
            <div>
              <label className="label-text" htmlFor="password">كلمة المرور</label>
              <div className="relative">
                <Lock size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  className={`input-field pr-9 pl-9 ${errors.password ? 'border-red-400 focus:ring-red-400' : ''}`}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  {...register('password', {
                    required: 'كلمة المرور مطلوبة',
                    minLength: { value: 6, message: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' },
                  })}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 bg-[hsl(var(--primary))] text-white rounded-xl py-3 font-semibold hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <LogIn size={18} />
                  تسجيل الدخول
                </>
              )}
            </button>
          </form>

          <p className="text-center text-xs text-[hsl(var(--muted-foreground))] mt-8">
            تراث مارت — Turath Mart &copy; {new Date().getFullYear()}
          </p>
        </div>
      </div>
    </div>
  );
}