'use client';
import React, { useState, useEffect } from 'react';

import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Toaster } from 'sonner';
import AppLogo from '@/components/ui/AppLogo';
import { Eye, EyeOff, Mail, Lock, Truck, Package, BarChart3, Shield, LogIn, AlertCircle, Monitor, Smartphone, Tablet } from 'lucide-react';

interface LoginForm {
  email: string;
  password: string;
  role: string;
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

// Map role name → UserRole type for routing
function getRoleTypeFromName(roleName: string): string {
  const name = roleName.toLowerCase();
  if (name.includes('مدير') && name.includes('نظام')) return 'manager';
  if (name.includes('مدير')) return 'manager';
  if (name.includes('مشرف')) return 'supervisor';
  if (name.includes('شحن') && name.includes('مندوب')) return 'shipping';
  if (name.includes('شحن')) return 'shipping';
  if (name.includes('عملاء') || name.includes('خدمة')) return 'supervisor';
  if (name.includes('بيانات') || name.includes('إدخال')) return 'data_entry';
  return 'data_entry';
}

// Get default redirect route based on role permissions
function getDefaultRouteForPermissions(permissions: string[]): string {
  if (permissions.includes('view_dashboard')) return '/dashboard';
  if (permissions.includes('view_orders')) return '/orders-management';
  if (permissions.includes('view_shipping')) return '/shipping';
  return '/shipping';
}

// Load roles from localStorage
function loadStoredRoles(): StoredRole[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem('turath_roles');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Load employees from localStorage
function loadStoredEmployees(): StoredEmployee[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem('turath_employees');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Default employees always available as fallback
const DEFAULT_EMPLOYEES: StoredEmployee[] = [
  { id: 'e1', name: 'محمد الزهراني', username: 'admin', password: 'Admin@123', roleId: 'r1', status: 'active', createdAt: '01/01/2026' },
  { id: 'e2', name: 'أحمد علي', username: 'ahmed.ali', password: 'Ahmed@2026', roleId: 'r3', status: 'active', createdAt: '15/01/2026' },
  { id: 'e3', name: 'سارة محمود', username: 'sara.m', password: 'Sara@2026', roleId: 'r5', status: 'active', createdAt: '20/01/2026' },
];

// Default roles always available as fallback
const DEFAULT_ROLES: StoredRole[] = [
  { id: 'r1', name: 'مدير النظام', permissions: ['view_dashboard','view_orders','create_orders','edit_orders','delete_orders','update_status','view_shipping','manage_shipping','assign_courier','view_inventory','edit_inventory','view_reports','export_reports','manage_users','manage_roles','view_customers','manage_customers','customer_support','system_settings'] },
  { id: 'r2', name: 'مشرف النظام', permissions: ['view_dashboard','view_orders','edit_orders','update_status','view_shipping','manage_shipping','view_inventory','view_reports','export_reports','manage_users'] },
  { id: 'r3', name: 'مشرف شحن', permissions: ['view_dashboard','view_orders','create_orders','edit_orders','update_status','view_shipping','manage_shipping','assign_courier','view_inventory','view_reports'] },
  { id: 'r4', name: 'مندوب شحن', permissions: ['view_orders','update_status','view_shipping'] },
  { id: 'r5', name: 'مدير خدمة عملاء', permissions: ['view_dashboard','view_orders','view_shipping','view_reports','export_reports','view_customers','manage_customers','customer_support'] },
  { id: 'r6', name: 'خدمة عملاء', permissions: ['view_orders','view_shipping','view_customers','customer_support'] },
];

const BASE_CREDENTIALS = [
  { role: 'manager', roleId: 'r1', email: 'manager@turathmart.com', password: 'Turath@2026', label: 'مدير النظام' },
  { role: 'data_entry', roleId: 'r6', email: 'staff@turathmart.com', password: 'Staff@2026', label: 'موظف إدخال بيانات' },
  { role: 'shipping', roleId: 'r4', email: 'driver@turathmart.com', password: 'Driver@2026', label: 'مندوب شحن' },
  { role: 'supervisor', roleId: 'r2', email: 'supervisor@turathmart.com', password: 'Super@2026', label: 'مشرف' },
  { role: 'manager', roleId: 'r1', email: 'manager@zahranship.com', password: 'Zahran@2026', label: 'مدير النظام' },
  { role: 'data_entry', roleId: 'r6', email: 'staff@zahranship.com', password: 'Staff@2026', label: 'موظف إدخال بيانات' },
  { role: 'shipping', roleId: 'r4', email: 'driver@zahranship.com', password: 'Driver@2026', label: 'مندوب شحن' },
  { role: 'supervisor', roleId: 'r2', email: 'supervisor@zahranship.com', password: 'Super@2026', label: 'مشرف' },
];

const STATS = [
  { icon: <Package size={22} />, value: '١٢,٤٨٧', label: 'أوردر محلّى' },
  { icon: <Truck size={22} />, value: '٩٨.٢٪', label: 'نسبة التسليم' },
  { icon: <BarChart3 size={22} />, value: '٣ مناطق', label: 'تغطية القاهرة الكبرى' },
];

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

  useEffect(() => {
    setDeviceType(getDeviceType());
  }, []);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({
    defaultValues: { role: 'manager', remember: false },
  });

  const getRedirectForRole = (roleId: string, roleName: string): string => {
    // Try to get redirect from stored role permissions
    const storedRoles = loadStoredRoles();
    const allRoles = storedRoles.length > 0 ? storedRoles : DEFAULT_ROLES;
    const role = allRoles.find(r => r.id === roleId);
    if (role) return getDefaultRouteForPermissions(role.permissions);

    // Fallback by role type
    const roleType = getRoleTypeFromName(roleName);
    const fallbacks: Record<string, string> = {
      manager: '/dashboard',
      supervisor: '/dashboard',
      data_entry: '/orders-management',
      shipping: '/shipping',
    };
    return fallbacks[roleType] ?? '/shipping';
  };

  const onSubmit = async (data: LoginForm) => {
    setIsLoading(true);
    setLoginError('');

    const inputValue = data.email.trim();
    const inputPassword = data.password;

    // ── Step 1: Check base credentials (static list) ──────────────────────────
    const validBase = BASE_CREDENTIALS.find(
      (c) => c.email === inputValue && c.password === inputPassword
    );

    if (validBase) {
      if (typeof window !== 'undefined') {
        localStorage.setItem('current_user', JSON.stringify({
          email: validBase.email,
          name: validBase.label,
          role: validBase.role,
          roleId: validBase.roleId,
        }));
      }
      toast.success(`مرحباً! تم تسجيل الدخول كـ ${validBase.label} — ${deviceType}`);
      const redirect = getRedirectForRole(validBase.roleId, validBase.label);
      setTimeout(() => { window.location.href = redirect; }, 800);
      setIsLoading(false);
      return;
    }

    // ── Step 2: Check employees in localStorage (primary for custom employees) ─
    const storedEmployees = loadStoredEmployees();
    const storedIds = new Set(storedEmployees.map((e: StoredEmployee) => e.id));
    // Merge: stored employees take priority, add defaults not already stored
    const mergedEmployees: StoredEmployee[] = [
      ...storedEmployees,
      ...DEFAULT_EMPLOYEES.filter(e => !storedIds.has(e.id)),
    ];

    const emp = mergedEmployees.find(
      (e) =>
        e.status === 'active' &&
        e.password === inputPassword &&
        (
          e.username === inputValue ||
          e.username === inputValue.split('@')[0] ||
          (e.email && e.email === inputValue)
        )
    );

    if (emp) {
      // Look up role from stored roles
      const storedRoles = loadStoredRoles();
      const allRoles = storedRoles.length > 0 ? storedRoles : DEFAULT_ROLES;
      const empRole = allRoles.find(r => r.id === emp.roleId);
      const roleType = empRole ? getRoleTypeFromName(empRole.name) : 'data_entry';
      const roleName = empRole?.name || emp.roleId;

      if (typeof window !== 'undefined') {
        localStorage.setItem('current_user', JSON.stringify({
          email: inputValue,
          name: emp.name,
          role: roleType,
          roleId: emp.roleId,
        }));
      }
      toast.success(`مرحباً ${emp.name}! تم تسجيل الدخول — ${deviceType}`);
      const redirect = getRedirectForRole(emp.roleId, roleName);
      setTimeout(() => { window.location.href = redirect; }, 800);
      setIsLoading(false);
      return;
    }

    setLoginError('بيانات الدخول غير صحيحة. تأكد من اسم المستخدم وكلمة المرور');
    toast.error('فشل تسجيل الدخول — تحقق من البيانات');
    setIsLoading(false);
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