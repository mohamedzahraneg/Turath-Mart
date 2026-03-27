'use client';
import React, { useState } from 'react';

import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Toaster } from 'sonner';
import AppLogo from '@/components/ui/AppLogo';
import {
  Eye,
  EyeOff,
  Mail,
  Lock,
  Truck,
  Package,
  BarChart3,
  Shield,
  ChevronDown,
  LogIn,
  AlertCircle,
} from 'lucide-react';

interface LoginForm {
  email: string;
  password: string;
  role: string;
  remember: boolean;
}

const MOCK_CREDENTIALS = [
  { role: 'مدير', email: 'manager@zahranship.com', password: 'Zahran@2026', label: 'مدير النظام' },
  { role: 'data_entry', email: 'staff@zahranship.com', password: 'Staff@2026', label: 'موظف إدخال بيانات' },
  { role: 'shipping', email: 'driver@zahranship.com', password: 'Driver@2026', label: 'مندوب شحن' },
  { role: 'supervisor', email: 'supervisor@zahranship.com', password: 'Super@2026', label: 'مشرف' },
];

const ROLES = [
  { value: 'manager', label: 'مدير النظام' },
  { value: 'data_entry', label: 'موظف إدخال بيانات' },
  { value: 'shipping', label: 'مندوب شحن' },
  { value: 'supervisor', label: 'مشرف (عرض فقط)' },
];

const STATS = [
  { icon: <Package size={22} />, value: '١٢,٤٨٧', label: 'أوردر محلّى' },
  { icon: <Truck size={22} />, value: '٩٨.٢٪', label: 'نسبة التسليم' },
  { icon: <BarChart3 size={22} />, value: '٣ مناطق', label: 'تغطية القاهرة الكبرى' },
];

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loginError, setLoginError] = useState('');

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<LoginForm>({
    defaultValues: { role: 'manager', remember: false },
  });

  const onSubmit = async (data: LoginForm) => {
    setIsLoading(true);
    setLoginError('');
    // TODO: Connect to Laravel backend POST /api/auth/login
    await new Promise((r) => setTimeout(r, 1200));

    const valid = MOCK_CREDENTIALS.find(
      (c) => c.email === data.email && c.password === data.password
    );

    if (valid) {
      toast.success(`مرحباً! تم تسجيل الدخول كـ ${valid.label}`);
      setTimeout(() => {
        window.location.href = '/dashboard';
      }, 800);
    } else {
      setLoginError(
        `بيانات الدخول غير صحيحة. جرّب: manager@zahranship.com / Zahran@2026`
      );
      toast.error('فشل تسجيل الدخول — تحقق من البيانات');
    }
    setIsLoading(false);
  };

  const fillCredentials = (cred: typeof MOCK_CREDENTIALS[0]) => {
    setValue('email', cred.email);
    setValue('password', cred.password);
    setValue('role', cred.role);
  };

  return (
    <div className="min-h-screen flex" dir="rtl">
      <Toaster position="top-center" richColors />

      {/* Right: Brand Panel */}
      <div className="hidden lg:flex lg:w-[52%] relative overflow-hidden flex-col justify-between p-10"
        style={{ background: 'linear-gradient(135deg, hsl(211,67%,18%) 0%, hsl(211,67%,32%) 60%, hsl(28,80%,45%) 100%)' }}>

        {/* Background pattern */}
        <div className="absolute inset-0 opacity-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={`pattern-row-${i + 1}`}
              className="flex gap-8 mb-8"
              style={{ marginTop: i === 0 ? '2rem' : undefined }}
            >
              {Array.from({ length: 6 }).map((_, j) => (
                <Truck key={`pattern-icon-${i + 1}-${j + 1}`} size={40} className="text-white" />
              ))}
            </div>
          ))}
        </div>

        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-12">
            <AppLogo size={48} />
            <div>
              <h1 className="text-3xl font-bold text-white tracking-tight">Zahranship</h1>
              <p className="text-blue-200 text-sm">نظام إدارة الشحن المتكامل</p>
            </div>
          </div>

          <h2 className="text-4xl font-bold text-white leading-relaxed mb-4">
            إدارة شحنك<br />
            <span className="text-[hsl(28,80%,72%)]">بكل احترافية</span>
          </h2>
          <p className="text-blue-200 text-lg leading-relaxed max-w-md">
            منصة متكاملة لتسجيل الأوردرات، تتبع الشحن، إدارة المخزون، وتقارير مالية دقيقة — كل شيء في مكان واحد.
          </p>
        </div>

        {/* Stats */}
        <div className="relative z-10 grid grid-cols-3 gap-4">
          {STATS.map((stat, i) => (
            <div key={`stat-${i + 1}`} className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 border border-white/20">
              <div className="text-[hsl(28,80%,72%)] mb-2">{stat.icon}</div>
              <p className="text-2xl font-bold text-white">{stat.value}</p>
              <p className="text-blue-200 text-xs mt-1">{stat.label}</p>
            </div>
          ))}
        </div>

        <div className="relative z-10 flex items-center gap-2 text-blue-200 text-sm">
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
            <span className="font-bold text-xl text-[hsl(var(--primary))]">Zahranship</span>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-[hsl(var(--foreground))]">تسجيل الدخول</h2>
            <p className="text-[hsl(var(--muted-foreground))] text-sm mt-1">أدخل بياناتك للوصول إلى النظام</p>
          </div>

          {/* Error */}
          {loginError && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 mb-4 text-red-700 text-sm fade-in">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
            {/* Email */}
            <div>
              <label className="label-text" htmlFor="email">البريد الإلكتروني</label>
              <div className="relative">
                <Mail size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
                <input
                  id="email"
                  type="email"
                  className={`input-field pr-9 ${errors.email ? 'border-red-400 focus:ring-red-400' : ''}`}
                  placeholder="example@zahranship.com"
                  autoComplete="email"
                  {...register('email', {
                    required: 'البريد الإلكتروني مطلوب',
                    pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'صيغة البريد غير صحيحة' },
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
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>}
            </div>

            {/* Role */}
            <div>
              <label className="label-text" htmlFor="role">الدور الوظيفي</label>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mb-1.5">اختر دورك لتحديد الصلاحيات المناسبة</p>
              <div className="relative">
                <select
                  id="role"
                  className="input-field appearance-none pl-8"
                  {...register('role', { required: 'الدور الوظيفي مطلوب' })}
                >
                  {ROLES.map((r) => (
                    <option key={`role-${r.value}`} value={r.value}>{r.label}</option>
                  ))}
                </select>
                <ChevronDown size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] pointer-events-none" />
              </div>
              {errors.role && <p className="text-red-500 text-xs mt-1">{errors.role.message}</p>}
            </div>

            {/* Remember me */}
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-[hsl(var(--border))] text-[hsl(var(--primary))] focus:ring-[hsl(var(--primary))]"
                  {...register('remember')}
                />
                <span className="text-sm text-[hsl(var(--foreground))]">تذكرني</span>
              </label>
              <button type="button" className="text-sm text-[hsl(var(--primary))] hover:underline font-medium">
                نسيت كلمة المرور؟
              </button>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading}
              className="btn-primary w-full justify-center py-3 text-base"
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span>جاري تسجيل الدخول...</span>
                </>
              ) : (
                <>
                  <LogIn size={18} />
                  <span>تسجيل الدخول</span>
                </>
              )}
            </button>
          </form>

          {/* Demo credentials */}
          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-xl">
            <p className="text-xs font-semibold text-blue-700 mb-3 flex items-center gap-1">
              <Shield size={12} />
              بيانات تجريبية للاختبار — اضغط للملء التلقائي
            </p>
            <div className="space-y-2">
              {MOCK_CREDENTIALS.map((cred, i) => (
                <button
                  key={`demo-cred-${i + 1}`}
                  type="button"
                  onClick={() => fillCredentials(cred)}
                  className="w-full text-right flex items-center justify-between bg-white hover:bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 transition-colors group"
                >
                  <div>
                    <p className="text-xs font-semibold text-[hsl(var(--foreground))] group-hover:text-blue-700 transition-colors">{cred.label}</p>
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">{cred.email}</p>
                  </div>
                  <span className="text-xs text-blue-600 font-mono bg-blue-50 px-2 py-0.5 rounded">{cred.password}</span>
                </button>
              ))}
            </div>
          </div>

          <p className="text-center text-xs text-[hsl(var(--muted-foreground))] mt-6">
            © 2026 Zahranship — جميع الحقوق محفوظة
          </p>
        </div>
      </div>
    </div>
  );
}