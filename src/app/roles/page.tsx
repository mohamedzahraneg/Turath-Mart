'use client';
import React, { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import AppLayout from '@/components/AppLayout';
import {
  ShieldCheck,
  Plus,
  Edit2,
  Trash2,
  X,
  Save,
  Check,
  Users,
  Eye,
  EyeOff,
  Key,
  UserPlus,
  Camera,
  Upload,
  ShieldAlert,
  // Phase 26E-Fix1 — icons for the new safe-action buttons in the
  // employees tab (disable / suspend / reactivate). Mirrors the
  // pattern already used by UsersTab.tsx.
  UserX,
  Clock,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
// Phase 26E-Fix1 — auth context + permission helper + staff-audit
// writer so the employees tab can replace its silent .delete() with
// gated status mutations that emit audit rows.
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { writeStaffAuditLog, type StaffAuditAction } from '@/lib/security/staffAudit';
// Phase 26A — security tab (devices, login events, staff audit log).
import SecurityTab from './components/SecurityTab';
// Phase 26C — permissions matrix tab (role × permission grid with
// filters, dirty state, sensitive guard, and audit logging).
import PermissionsMatrixTab from './components/PermissionsMatrixTab';
// Phase 26E — users tab (security/account-focused management of
// real staff accounts). Replaces the legacy inline users table
// that hardcoded login/device counts and silently deleted rows.
import UsersTab from './components/UsersTab';
// Phase 26G — shared modal for "تعديل الدور" surfaced from both
// the employees tab and the users tab. Writes role_id +
// role_name + role to profiles via the page-level handler.
import ChangeRoleModal, { type ChangeRoleModalTarget } from './components/ChangeRoleModal';

// ─── Types ─────────────────────────────────────────────────────────────────────
interface Permission {
  id: string;
  label: string;
  group: string;
}

interface Role {
  id: string;
  name: string;
  description: string;
  color: string;
  permissions: string[];
  usersCount: number;
}

interface Employee {
  id: string;
  name: string;
  /** Phase 26E-Fix1 — full canonical email. Kept alongside `username`
   *  (the local-part) so audit rows and status updates can match the
   *  real DB column, not a reconstructed `{username}@turathmasr.com`. */
  email: string;
  username: string;
  password: string;
  roleId: string;
  /** Phase 26G — cached `profiles.role_name` straight from the DB.
   *  Used only to detect drift against the live `turath_roles`
   *  lookup; never rendered directly in the UI (the badge uses
   *  `getRoleName(roleId)` for canonical truth). */
  roleName?: string | null;
  /** Legacy `status` left in place for the role-summary card that
   *  counts active employees; real Phase 26A status lives in
   *  `accountStatus` below. */
  status: 'active' | 'inactive';
  /** Phase 26E-Fix1 — real `profiles.account_status` so the employees
   *  tab badge + safe actions track the same data as the users tab. */
  accountStatus: 'active' | 'disabled' | 'suspended' | 'pending';
  disabledAt: string | null;
  disabledReason: string | null;
  createdAt: string;
  avatar?: string;
}

interface SessionLog {
  id: string;
  userId: string;
  type: 'login' | 'logout';
  device: 'كمبيوتر' | 'موبايل' | 'تابلت';
  timestamp: string;
  day: string;
  date: string;
  time: string;
}

interface AppUser {
  id: string;
  name: string;
  email: string;
  roleId: string;
  status: 'active' | 'inactive';
  avatar: string;
  loginCount: number;
  logoutCount: number;
  lastDevice?: string;
  lastLogin?: string;
  sessions: SessionLog[];
}

// ─── Permissions ───────────────────────────────────────────────────────────────
const allPermissions: Permission[] = [
  { id: 'view_dashboard', label: 'عرض لوحة التحكم', group: 'لوحة التحكم' },
  { id: 'view_orders', label: 'عرض الأوردرات', group: 'الأوردرات' },
  { id: 'create_orders', label: 'إنشاء أوردرات', group: 'الأوردرات' },
  { id: 'edit_orders', label: 'تعديل الأوردرات', group: 'الأوردرات' },
  { id: 'delete_orders', label: 'حذف الأوردرات', group: 'الأوردرات' },
  { id: 'update_status', label: 'تحديث حالة الأوردر', group: 'الأوردرات' },
  { id: 'view_shipping', label: 'عرض الشحن', group: 'الشحن' },
  { id: 'manage_shipping', label: 'إدارة الشحن', group: 'الشحن' },
  { id: 'assign_courier', label: 'تعيين مندوب شحن', group: 'الشحن' },
  { id: 'view_inventory', label: 'عرض المخزون', group: 'المخزون' },
  { id: 'edit_inventory', label: 'تعديل المخزون', group: 'المخزون' },
  { id: 'view_reports', label: 'عرض التقارير', group: 'التقارير' },
  { id: 'export_reports', label: 'تصدير التقارير', group: 'التقارير' },
  { id: 'manage_users', label: 'إدارة المستخدمين', group: 'المستخدمون' },
  { id: 'manage_roles', label: 'إدارة الأدوار والصلاحيات', group: 'المستخدمون' },
  { id: 'view_customers', label: 'عرض العملاء', group: 'خدمة العملاء' },
  { id: 'manage_customers', label: 'إدارة شكاوى العملاء', group: 'خدمة العملاء' },
  { id: 'customer_support', label: 'دعم العملاء', group: 'خدمة العملاء' },
  { id: 'system_settings', label: 'إعدادات النظام', group: 'الإعدادات' },
];

const permGroups = [
  'لوحة التحكم',
  'الأوردرات',
  'الشحن',
  'المخزون',
  'التقارير',
  'المستخدمون',
  'خدمة العملاء',
  'الإعدادات',
];

// ─── Initial Data ──────────────────────────────────────────────────────────────
const initialRoles: Role[] = [
  {
    id: 'r1',
    name: 'مدير النظام',
    description: 'صلاحيات كاملة على جميع أقسام النظام',
    color: 'purple',
    permissions: allPermissions.map((p) => p.id),
    usersCount: 1,
  },
  {
    id: 'r2',
    name: 'مشرف النظام',
    description: 'إشراف على النظام وإدارة المستخدمين والتقارير',
    color: 'indigo',
    permissions: [
      'view_dashboard',
      'view_orders',
      'edit_orders',
      'update_status',
      'view_shipping',
      'manage_shipping',
      'view_inventory',
      'view_reports',
      'export_reports',
      'manage_users',
    ],
    usersCount: 1,
  },
  {
    id: 'r3',
    name: 'مشرف شحن',
    description: 'إدارة عمليات الشحن وتعيين المناديب وتحديث الحالات',
    color: 'blue',
    permissions: [
      'view_dashboard',
      'view_orders',
      'create_orders',
      'edit_orders',
      'update_status',
      'view_shipping',
      'manage_shipping',
      'assign_courier',
      'view_inventory',
      'view_reports',
    ],
    usersCount: 2,
  },
  {
    id: 'r4',
    name: 'مندوب شحن',
    description: 'تنفيذ عمليات التوصيل وتحديث حالة الشحنات',
    color: 'cyan',
    permissions: ['view_orders', 'update_status', 'view_shipping'],
    usersCount: 3,
  },
  {
    id: 'r5',
    name: 'مدير خدمة عملاء',
    description: 'إدارة فريق خدمة العملاء والإشراف على الشكاوى',
    color: 'green',
    permissions: [
      'view_dashboard',
      'view_orders',
      'view_shipping',
      'view_reports',
      'export_reports',
      'view_customers',
      'manage_customers',
      'customer_support',
    ],
    usersCount: 1,
  },
  {
    id: 'r6',
    name: 'خدمة عملاء',
    description: 'التواصل مع العملاء ومتابعة الطلبات والشكاوى',
    color: 'teal',
    permissions: [
      'view_orders',
      'create_orders',
      'update_status',
      'view_shipping',
      'view_customers',
      'customer_support',
    ],
    usersCount: 2,
  },
];

// No default employees - all employees are loaded from Supabase
const defaultEmployees: Employee[] = [];

// Phase 26G — legacy free-text `profiles.role` value kept in sync
// with `role_id`. Pre-26A code paths still read this column for a
// coarse-grained admin/manager/employee/delegate flag; the
// employee-create wizard already set it via the same lookup table.
// Promoted to module scope so the new role-update handler reuses
// the exact same mapping (single source of truth).
const LEGACY_ROLE_TEXT: Record<string, string> = {
  r1: 'admin',
  r2: 'manager',
  r3: 'manager',
  r4: 'delegate',
  r5: 'employee',
  r6: 'employee',
};
function legacyRoleText(roleId: string | null | undefined): string {
  return (roleId && LEGACY_ROLE_TEXT[roleId]) || 'employee';
}

const DAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

function formatSession(iso: string) {
  const d = new Date(iso);
  return {
    day: DAYS_AR[d.getDay()],
    date: d.toLocaleDateString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit' }),
    time: d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }),
  };
}

// No default users - all users are loaded from Supabase
const defaultUsers: AppUser[] = [];

const colorMap: Record<string, { bg: string; text: string; border: string; avatar: string }> = {
  purple: {
    bg: 'bg-purple-50',
    text: 'text-purple-700',
    border: 'border-purple-200',
    avatar: 'bg-purple-500',
  },
  indigo: {
    bg: 'bg-indigo-50',
    text: 'text-indigo-700',
    border: 'border-indigo-200',
    avatar: 'bg-indigo-500',
  },
  blue: {
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    border: 'border-blue-200',
    avatar: 'bg-blue-500',
  },
  cyan: {
    bg: 'bg-cyan-50',
    text: 'text-cyan-700',
    border: 'border-cyan-200',
    avatar: 'bg-cyan-500',
  },
  green: {
    bg: 'bg-green-50',
    text: 'text-green-700',
    border: 'border-green-200',
    avatar: 'bg-green-500',
  },
  teal: {
    bg: 'bg-teal-50',
    text: 'text-teal-700',
    border: 'border-teal-200',
    avatar: 'bg-teal-500',
  },
  amber: {
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    border: 'border-amber-200',
    avatar: 'bg-amber-500',
  },
  orange: {
    bg: 'bg-orange-50',
    text: 'text-orange-700',
    border: 'border-orange-200',
    avatar: 'bg-orange-500',
  },
};

// ─── localStorage helpers ──────────────────────────────────────────────────────
const LS_EMPLOYEES = 'turath_employees';
const LS_USERS = 'turath_users';
const LS_AVATARS = 'turath_avatars';
const LS_ROLES = 'turath_roles';

function saveRolesToStorage(_roles: Role[]) {
  // No-op: roles are saved to Supabase only via handleSaveRole
  return;
}

function loadAvatars(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(LS_AVATARS);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveAvatar(empId: string, avatarData: string) {
  if (typeof window === 'undefined') return;
  try {
    const avatars = loadAvatars();
    avatars[empId] = avatarData;
    localStorage.setItem(LS_AVATARS, JSON.stringify(avatars));
  } catch {
    // storage unavailable
  }
}

function removeAvatar(empId: string) {
  if (typeof window === 'undefined') return;
  try {
    const avatars = loadAvatars();
    delete avatars[empId];
    localStorage.setItem(LS_AVATARS, JSON.stringify(avatars));
  } catch {}
}

function loadFromStorage<T>(_key: string, fallback: T[]): T[] {
  // No-op: all data comes from Supabase
  return fallback;
}

function saveEmployeesToStorage(_employees: Employee[]) {
  // No-op: employees are loaded from Supabase profiles
  return;
}

async function saveUsersToStorage(_users: AppUser[]) {
  // No-op: users are loaded from Supabase profiles
  return;
}
// Phase 26E — `DeviceIcon` helper removed alongside the inline
// users tab. The new UsersTab component has its own device-icon
// helper scoped to that component.

// ─── Role Modal ────────────────────────────────────────────────────────────────
interface RoleModalProps {
  role: Role | null;
  onClose: () => void;
  onSave: (role: Role) => void;
}

function RoleModal({ role, onClose, onSave }: RoleModalProps) {
  const [form, setForm] = useState<Role>(
    role || {
      id: `r${Date.now()}`,
      name: '',
      description: '',
      color: 'blue',
      permissions: [],
      usersCount: 0,
    }
  );

  const togglePerm = (id: string) => {
    setForm((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(id)
        ? prev.permissions.filter((p) => p !== id)
        : [...prev.permissions, id],
    }));
  };

  const toggleGroup = (group: string) => {
    const groupPerms = allPermissions.filter((p) => p.group === group).map((p) => p.id);
    const allSelected = groupPerms.every((p) => form.permissions.includes(p));
    setForm((prev) => ({
      ...prev,
      permissions: allSelected
        ? prev.permissions.filter((p) => !groupPerms.includes(p))
        : [...new Set([...prev.permissions, ...groupPerms])],
    }));
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-[hsl(var(--border))]">
          <h2 className="text-lg font-bold">{role ? 'تعديل دور' : 'إضافة دور جديد'}</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[hsl(var(--muted))] rounded-xl transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-semibold mb-1.5">اسم الدور</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-semibold mb-1.5">الوصف</label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1.5">اللون</label>
              <select
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
                className="w-full border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
              >
                {Object.keys(colorMap).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <p className="text-sm font-semibold mb-3">
              الصلاحيات ({form.permissions.length} / {allPermissions.length})
            </p>
            <div className="space-y-3">
              {permGroups.map((group) => {
                const groupPerms = allPermissions.filter((p) => p.group === group);
                const allSelected = groupPerms.every((p) => form.permissions.includes(p.id));
                return (
                  <div
                    key={group}
                    className="border border-[hsl(var(--border))] rounded-xl overflow-hidden"
                  >
                    <button
                      onClick={() => toggleGroup(group)}
                      className="w-full flex items-center justify-between px-4 py-2.5 bg-[hsl(var(--muted))]/50 hover:bg-[hsl(var(--muted))] transition-colors"
                    >
                      <span className="text-sm font-semibold">{group}</span>
                      <div
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${allSelected ? 'bg-[hsl(var(--primary))] border-[hsl(var(--primary))]' : 'border-gray-300'}`}
                      >
                        {allSelected && <Check size={12} className="text-white" />}
                      </div>
                    </button>
                    <div className="p-3 grid grid-cols-2 gap-2">
                      {groupPerms.map((perm) => (
                        <button
                          key={perm.id}
                          onClick={() => togglePerm(perm.id)}
                          className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg border transition-all text-right ${form.permissions.includes(perm.id) ? 'bg-[hsl(var(--primary))]/10 border-[hsl(var(--primary))]/30 text-[hsl(var(--primary))]' : 'border-[hsl(var(--border))]'}`}
                        >
                          <div
                            className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${form.permissions.includes(perm.id) ? 'bg-[hsl(var(--primary))]' : 'border-gray-300'}`}
                          >
                            {form.permissions.includes(perm.id) && (
                              <Check size={10} className="text-white" />
                            )}
                          </div>
                          {perm.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="flex gap-3 p-5 border-t border-[hsl(var(--border))]">
          <button
            onClick={() => onSave(form)}
            className="flex-1 flex items-center justify-center gap-2 bg-[hsl(var(--primary))] text-white rounded-xl py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            <Save size={16} />
            حفظ
          </button>
          <button
            onClick={onClose}
            className="px-5 border border-[hsl(var(--border))] rounded-xl text-sm font-semibold hover:bg-[hsl(var(--muted))] transition-colors"
          >
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Unified Employee+User Modal ───────────────────────────────────────────────
// This single form creates/edits BOTH an Employee record (for login) AND an AppUser record (for the users tab)
interface UnifiedMemberModalProps {
  employee: Employee | null;
  roles: Role[];
  onClose: () => void;
  onSave: (emp: Employee) => void;
}

function UnifiedMemberModal({ employee, roles, onClose, onSave }: UnifiedMemberModalProps) {
  const stableId = useRef(`e${Math.random().toString(36).slice(2)}`);
  const [form, setForm] = useState<Employee>(
    employee || {
      id: stableId.current,
      name: '',
      email: '',
      username: '',
      password: '',
      roleId: roles[0]?.id || '',
      status: 'active',
      // Phase 26E-Fix1 — new employees default to `active`; the
      // disable / suspend / reactivate flow updates these from the
      // employees-tab actions, never the create form.
      accountStatus: 'active',
      disabledAt: null,
      disabledReason: null,
      createdAt: new Date().toLocaleDateString('en-GB'),
      avatar: '',
    }
  );
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setErrors((prev) => ({ ...prev, avatar: 'حجم الصورة يجب أن يكون أقل من 2MB' }));
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      setForm((prev) => ({ ...prev, avatar: ev.target?.result as string }));
      setErrors((prev) => {
        const n = { ...prev };
        delete n.avatar;
        return n;
      });
    };
    reader.readAsDataURL(file);
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = 'الاسم مطلوب';
    if (!form.username.trim()) errs.username = 'اسم المستخدم مطلوب';
    if (form.username.includes(' ')) errs.username = 'اسم المستخدم لا يجب أن يحتوي على مسافات';
    if (!employee && form.password.length < 6)
      errs.password = 'كلمة المرور يجب أن تكون 6 أحرف على الأقل';
    if (!form.roleId) errs.roleId = 'الدور مطلوب';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const roleColor =
    colorMap[roles.find((r) => r.id === form.roleId)?.color || 'blue'] || colorMap.blue;
  const selectedRole = roles.find((r) => r.id === form.roleId);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-2">
            <UserPlus size={20} className="text-[hsl(var(--primary))]" />
            <h2 className="text-lg font-bold">
              {employee ? 'تعديل موظف / مستخدم' : 'إضافة موظف / مستخدم جديد'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[hsl(var(--muted))] rounded-xl transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Avatar */}
          <div className="flex flex-col items-center gap-3">
            <div className="relative">
              <div
                className={`w-20 h-20 rounded-full overflow-hidden flex items-center justify-center text-white text-2xl font-bold ${form.avatar ? '' : roleColor.avatar}`}
              >
                {form.avatar ? (
                  <Image
                    src={form.avatar}
                    alt="صورة المستخدم"
                    width={80}
                    height={80}
                    className="w-full h-full object-cover"
                    unoptimized={form.avatar.startsWith('data:')}
                  />
                ) : (
                  <span>{form.name ? form.name.charAt(0) : <Camera size={28} />}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="absolute bottom-0 left-0 w-7 h-7 bg-[hsl(var(--primary))] text-white rounded-full flex items-center justify-center shadow-md hover:opacity-90 transition-opacity"
              >
                <Upload size={13} />
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarChange}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-xs text-[hsl(var(--primary))] font-semibold hover:underline"
            >
              {form.avatar ? 'تغيير الصورة' : 'رفع صورة (اختياري)'}
            </button>
            {errors.avatar && <p className="text-red-500 text-xs">{errors.avatar}</p>}
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm font-semibold mb-1.5">الاسم الكامل *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={`w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30 ${errors.name ? 'border-red-400' : 'border-[hsl(var(--border))]'}`}
              placeholder="الاسم الكامل للموظف"
            />
            {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name}</p>}
          </div>

          {/* Username */}
          <div>
            <label className="block text-sm font-semibold mb-1.5">اسم المستخدم (للدخول) *</label>
            <input
              type="text"
              value={form.username}
              onChange={(e) =>
                setForm({ ...form, username: e.target.value.toLowerCase().replace(/\s/g, '') })
              }
              className={`w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30 ${errors.username ? 'border-red-400' : 'border-[hsl(var(--border))]'}`}
              placeholder="مثال: ahmed.ali"
              dir="ltr"
            />
            {errors.username && <p className="text-red-500 text-xs mt-1">{errors.username}</p>}
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-semibold mb-1.5">
              {employee
                ? 'كلمة المرور الجديدة (اتركها فارغة للإبقاء على القديمة)'
                : 'كلمة المرور *'}
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className={`w-full border rounded-xl px-3 py-2.5 pl-10 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30 ${errors.password ? 'border-red-400' : 'border-[hsl(var(--border))]'}`}
                placeholder="••••••••"
                dir="ltr"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password}</p>}
          </div>

          {/* Role & Status */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold mb-1.5">الدور الوظيفي *</label>
              <select
                value={form.roleId}
                onChange={(e) => setForm({ ...form, roleId: e.target.value })}
                className={`w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30 ${errors.roleId ? 'border-red-400' : 'border-[hsl(var(--border))]'}`}
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              {errors.roleId && <p className="text-red-500 text-xs mt-1">{errors.roleId}</p>}
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1.5">الحالة</label>
              <select
                value={form.status}
                onChange={(e) =>
                  setForm({ ...form, status: e.target.value as 'active' | 'inactive' })
                }
                className="w-full border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
              >
                <option value="active">نشط</option>
                <option value="inactive">غير نشط</option>
              </select>
            </div>
          </div>

          {/* Role permissions preview */}
          {selectedRole && (
            <div className={`rounded-xl border ${roleColor.border} p-3 ${roleColor.bg}`}>
              <div className="flex items-center gap-2 mb-2">
                <ShieldCheck size={14} className={roleColor.text} />
                <span className={`text-xs font-semibold ${roleColor.text}`}>
                  صلاحيات هذا الدور: {selectedRole.permissions.length} صلاحية
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {selectedRole.permissions.slice(0, 5).map((pid) => {
                  const perm = allPermissions.find((p) => p.id === pid);
                  return perm ? (
                    <span
                      key={pid}
                      className={`text-[10px] px-2 py-0.5 rounded-full font-semibold bg-white ${roleColor.text}`}
                    >
                      {perm.label}
                    </span>
                  ) : null;
                })}
                {selectedRole.permissions.length > 5 && (
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-semibold bg-white ${roleColor.text}`}
                  >
                    +{selectedRole.permissions.length - 5} أخرى
                  </span>
                )}
              </div>
            </div>
          )}

          <p className="text-xs text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))]/50 rounded-xl px-3 py-2">
            ✅ سيتم إنشاء حساب الدخول فوراً — يمكن تسجيل الدخول باسم المستخدم وكلمة المرور بعد الحفظ
            مباشرةً
          </p>
        </div>
        <div className="flex gap-3 p-5 border-t border-[hsl(var(--border))]">
          <button
            onClick={() => {
              if (validate()) onSave(form);
            }}
            className="flex-1 flex items-center justify-center gap-2 bg-[hsl(var(--primary))] text-white rounded-xl py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            <Save size={16} />
            حفظ وتفعيل
          </button>
          <button
            onClick={onClose}
            className="px-5 border border-[hsl(var(--border))] rounded-xl text-sm font-semibold hover:bg-[hsl(var(--muted))] transition-colors"
          >
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}

// Phase 26E — SessionsPanel and UserPermissionsPanel removed
// alongside the inline users tab. Their replacements live inside
// UsersTab.tsx (drawer sections).

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>(initialRoles);

  // Fix hydration: start with defaults on both server and client, then load from localStorage in useEffect
  const [employees, setEmployees] = useState<Employee[]>(defaultEmployees);
  const [appUsers, setAppUsers] = useState<AppUser[]>(defaultUsers);
  const [hydrated, setHydrated] = useState(false);

  // Phase 26E-Fix1 — auth + permissions used by the employees-tab
  // safe-action buttons (disable / suspend / reactivate) and the
  // staff audit writer.
  const { user, profileFullName, currentRoleId } = useAuth();
  const perms = usePermissions();
  const canManageStaff = perms.isAdmin || perms.can('manage_staff');
  // Phase 26E-Fix1 — local toast for employees-tab feedback.
  // UsersTab keeps its own toast; the inline employees tab gets a
  // matching one so no mutation is silent.
  const [employeesToast, setEmployeesToast] = useState<{
    kind: 'success' | 'error';
    message: string;
  } | null>(null);
  const [employeesBusyId, setEmployeesBusyId] = useState<string | null>(null);
  const showEmployeesToast = (kind: 'success' | 'error', message: string) => {
    setEmployeesToast({ kind, message });
    window.setTimeout(() => setEmployeesToast(null), 4000);
  };

  // Phase 26G — shared role-edit modal state. Both the employees
  // tab (inline JSX) and the UsersTab open this same modal; the
  // page owns the supabase write so audit + state refresh happen
  // in one place.
  const [roleEditTarget, setRoleEditTarget] = useState<ChangeRoleModalTarget | null>(null);
  const [roleEditBusy, setRoleEditBusy] = useState(false);
  // Bumped on every successful page-level profile mutation so the
  // UsersTab re-fetches its joined data (devices / login events /
  // audit / roles) on its own without us reaching into its state.
  const [usersTabReloadTick, setUsersTabReloadTick] = useState(0);

  // Load ALL data from Supabase (source of truth) - roles, employees, users
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const loadFromSupabase = async () => {
      try {
        const supabase = createClient();
        if (!supabase) {
          setHydrated(true);
          return;
        }

        // 1. Load ROLES from turath_roles table
        const { data: dbRoles, error: rolesError } = await supabase
          .from('turath_roles')
          .select('id, name, permissions')
          .order('id', { ascending: true });

        if (!rolesError && dbRoles && dbRoles.length > 0) {
          const mappedRoles: Role[] = dbRoles.map((r: any) => {
            // Find matching initialRole for description and color
            const initial = initialRoles.find((ir) => ir.id === r.id);
            return {
              id: r.id,
              name: r.name,
              description: initial?.description || '',
              color: initial?.color || 'gray',
              permissions: Array.isArray(r.permissions) ? r.permissions : [],
              usersCount: initial?.usersCount || 0,
            };
          });
          setRoles(mappedRoles);
        }

        // 2. Load all users from Supabase profiles
        // Phase 26E-Fix1 — extended SELECT to pull `account_status`,
        // `disabled_at`, `disabled_reason` so the employees tab status
        // badge reflects the real DB row instead of a hardcoded
        // 'active' (matches the Phase 26E UsersTab fetch).
        const { data: profiles, error } = await supabase
          .from('profiles')
          .select(
            'id, email, full_name, role, role_id, role_name, permissions, created_at, account_status, disabled_at, disabled_reason'
          )
          .order('created_at', { ascending: true });

        if (!error && profiles && profiles.length > 0) {
          const avatars = loadAvatars();
          // Map profiles to Employee format for the employees tab
          const emps: Employee[] = profiles.map((p: any) => {
            const rawStatus = (p.account_status ?? 'active').toLowerCase();
            const accountStatus: Employee['accountStatus'] =
              rawStatus === 'disabled' ||
              rawStatus === 'suspended' ||
              rawStatus === 'pending' ||
              rawStatus === 'active'
                ? rawStatus
                : 'active';
            return {
              id: p.id,
              name: p.full_name || p.email?.split('@')[0] || 'مستخدم',
              email: p.email || '',
              username: p.email?.split('@')[0] || p.id,
              password: '••••••••',
              roleId: p.role_id || 'r6',
              // Phase 26G — capture the cached `profiles.role_name`
              // so the employees tab can detect drift against the
              // live `turath_roles` lookup. The badge column still
              // renders the canonical name via getRoleName(); this
              // field exists to surface the stale-cache warning.
              roleName: p.role_name ?? null,
              // Legacy `status` mirrors the real account status so the
              // role-summary card's active-employees count stays
              // honest now that account_status is loaded.
              status: accountStatus === 'active' ? 'active' : 'inactive',
              accountStatus,
              disabledAt: p.disabled_at ?? null,
              disabledReason: p.disabled_reason ?? null,
              createdAt: p.created_at ? new Date(p.created_at).toLocaleDateString('en-GB') : '',
              avatar: avatars[p.id] || '',
            };
          });
          setEmployees(emps);
          // Map profiles to AppUser format for the users tab
          const users: AppUser[] = profiles.map((p: any) => ({
            id: p.id,
            name: p.full_name || p.email?.split('@')[0] || 'مستخدم',
            email: p.email || '',
            roleId: p.role_id || 'r6',
            status: 'active' as const,
            avatar: (p.full_name || p.email || 'م').charAt(0).toUpperCase(),
            loginCount: 0,
            logoutCount: 0,
            lastDevice: '—',
            lastLogin: p.created_at || '',
            sessions: [],
          }));
          setAppUsers(users);
        }
      } catch (err) {
        console.error('Error loading from Supabase:', err);
      }
      setHydrated(true);
    };
    loadFromSupabase();
  }, []);

  const [editRole, setEditRole] = useState<Role | null | undefined>(undefined);
  // unified modal: undefined = closed, null = new, Employee = edit
  const [editMember, setEditMember] = useState<Employee | null | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<
    'roles' | 'employees' | 'users' | 'security' | 'matrix'
  >('roles');
  const [showPasswords, setShowPasswords] = useState<Set<string>>(new Set());
  // Phase 26E — users-tab state moved into UsersTab.tsx. The page
  // keeps `appUsers` because the roles tab summary + tab-count
  // badge still read from it.

  const handleSaveRole = async (role: Role) => {
    // 1. Update local state
    setRoles((prev) => {
      const exists = prev.find((r) => r.id === role.id);
      return exists ? prev.map((r) => (r.id === role.id ? role : r)) : [...prev, role];
    });

    // 2. Save role to turath_roles table in Supabase
    try {
      const supabase = createClient();
      if (supabase) {
        // Upsert into turath_roles
        const { error: roleError } = await supabase.from('turath_roles').upsert(
          {
            id: role.id,
            name: role.name,
            permissions: role.permissions,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'id' }
        );

        if (roleError) {
          console.error('Failed to save role to turath_roles:', roleError);
        }

        // 3. Also update permissions in profiles for ALL users with this role_id
        const { error: profileError } = await supabase
          .from('profiles')
          .update({
            permissions: role.permissions,
            role_name: role.name,
          })
          .eq('role_id', role.id);

        if (profileError) {
          console.error('Failed to update profiles:', profileError);
        }
      }
    } catch (err) {
      console.error('Error saving role to Supabase:', err);
    }
    setEditRole(undefined);
  };

  // Phase 26G — `staff.role_changed` mutation surfaced from both
  // the employees tab and the users tab. Writes the canonical
  // `role_id` + `role_name` + legacy free-text `role` to the
  // profiles row, emits an audit log entry, refreshes local
  // state, and toasts. Self-changes trigger a session reload so
  // AuthContext re-reads the new role from the DB instead of
  // serving the cached 5-min profile.
  const handleProfileRoleUpdate = async (target: ChangeRoleModalTarget, newRoleId: string) => {
    if (!canManageStaff) {
      showEmployeesToast('error', 'لا تملك صلاحية تعديل الأدوار.');
      return;
    }
    const newRole = roles.find((r) => r.id === newRoleId);
    if (!newRole) {
      showEmployeesToast('error', 'الدور المختار غير موجود.');
      return;
    }
    setRoleEditBusy(true);
    try {
      const supabase = createClient();
      if (!supabase) {
        showEmployeesToast('error', 'تعذر الاتصال بقاعدة البيانات.');
        return;
      }
      const { error } = await supabase
        .from('profiles')
        .update({
          role_id: newRoleId,
          role_name: newRole.name,
          role: legacyRoleText(newRoleId),
          permissions: newRole.permissions,
        })
        .eq('id', target.id);
      if (error) throw error;
      try {
        await writeStaffAuditLog(supabase, {
          action: 'staff.role_changed',
          description: `تم تغيير دور المستخدم من "${target.currentRoleName ?? target.currentRoleId ?? '—'}" إلى "${newRole.name}"`,
          actorId: user?.id ?? null,
          actorName: profileFullName ?? user?.email ?? null,
          actorRoleId: currentRoleId,
          entity: {
            type: 'profile',
            id: target.id,
            label: target.name || target.email || '',
          },
          metadata: {
            target_user_id: target.id,
            target_email: target.email,
            old_role_id: target.currentRoleId,
            old_role_name: target.currentRoleName,
            new_role_id: newRoleId,
            new_role_name: newRole.name,
            self_change: target.id === (user?.id ?? null),
          },
        });
      } catch (auditErr) {
        console.warn('[role-edit] staff audit failed:', auditErr);
      }
      // Phase 26G — refresh local state so the employees tab,
      // users tab tab-count, and roles-tab summary all reflect the
      // new role without a hard reload (except for self-changes,
      // which need a session refresh to clear the AuthContext
      // profile cache).
      setEmployees((prev) =>
        prev.map((e) =>
          e.id === target.id ? { ...e, roleId: newRoleId, roleName: newRole.name } : e
        )
      );
      setAppUsers((prev) =>
        prev.map((u) => (u.id === target.id ? { ...u, roleId: newRoleId } : u))
      );
      setUsersTabReloadTick((n) => n + 1);
      setRoleEditTarget(null);
      const isSelf = target.id === (user?.id ?? null);
      if (isSelf) {
        showEmployeesToast('success', 'تم تغيير دورك. سيتم تحديث الجلسة والصلاحيات تلقائيًا...');
        // Brief delay so the toast is readable before the reload.
        window.setTimeout(() => window.location.reload(), 1500);
      } else {
        showEmployeesToast('success', `تم تغيير الدور إلى ${newRole.name}.`);
      }
    } catch (err) {
      console.error('[role-edit] update failed:', err);
      const msg = err instanceof Error ? err.message : String(err);
      // RLS rejections surface as 42501 — translate to Arabic.
      const friendly = msg.includes('42501')
        ? 'لا تملك صلاحية تعديل أدوار المستخدمين. تواصل مع المدير.'
        : 'تعذر تغيير الدور. حاول مرة أخرى.';
      showEmployeesToast('error', friendly);
    } finally {
      setRoleEditBusy(false);
    }
  };

  // Phase 26E-Fix1 — safe replacement for the legacy silent delete
  // button on the employees tab. Mirrors UsersTab.tsx's
  // `updateAccountStatus`: updates `profiles.account_status` +
  // disabled-meta columns, writes a `staff.account_*` audit row,
  // refreshes local state, and toasts. Never deletes auth or
  // profile rows.
  const handleEmployeeStatusUpdate = async (
    emp: Employee,
    next: 'active' | 'disabled' | 'suspended',
    reason?: string
  ) => {
    if (!canManageStaff) {
      showEmployeesToast('error', 'لا تملك صلاحية إدارة حالة الحسابات.');
      return;
    }
    setEmployeesBusyId(emp.id);
    try {
      const supabase = createClient();
      if (!supabase) {
        showEmployeesToast('error', 'تعذر الاتصال بقاعدة البيانات.');
        setEmployeesBusyId(null);
        return;
      }
      const update: Record<string, unknown> = { account_status: next };
      if (next === 'active') {
        update.disabled_at = null;
        update.disabled_by = null;
        update.disabled_reason = null;
      } else {
        update.disabled_at = new Date().toISOString();
        update.disabled_by = user?.id ?? null;
        update.disabled_reason = (reason ?? '').trim() || null;
      }
      const { error } = await supabase.from('profiles').update(update).eq('id', emp.id);
      if (error) throw error;
      const actionByNext: Record<typeof next, StaffAuditAction> = {
        active: 'staff.account_reactivated',
        disabled: 'staff.account_disabled',
        suspended: 'staff.account_suspended',
      };
      try {
        await writeStaffAuditLog(supabase, {
          action: actionByNext[next],
          description: (reason ?? '').trim() || null,
          actorId: user?.id ?? null,
          actorName: profileFullName ?? user?.email ?? null,
          actorRoleId: currentRoleId,
          entity: {
            type: 'profile',
            id: emp.id,
            label: emp.name || emp.email || '',
          },
          metadata: { from: emp.accountStatus, to: next },
        });
      } catch (auditErr) {
        console.warn('[employees] staff audit failed:', auditErr);
      }
      // Phase 26E-Fix1 — local state refresh so the tab reflects the
      // new status without a full reload. We mirror the DB row shape
      // updated above so the badge + action buttons re-render in one
      // pass, matching the UsersTab `await load()` pattern.
      const nowIso = new Date().toISOString();
      setEmployees((prev) =>
        prev.map((e) =>
          e.id === emp.id
            ? {
                ...e,
                accountStatus: next,
                disabledAt: next === 'active' ? null : nowIso,
                disabledReason: next === 'active' ? null : (reason ?? '').trim() || null,
                status: next === 'active' ? 'active' : 'inactive',
              }
            : e
        )
      );
      setAppUsers((prev) =>
        prev.map((u) =>
          u.id === emp.id ? { ...u, status: next === 'active' ? 'active' : 'inactive' } : u
        )
      );
      const verb = next === 'active' ? 'إعادة تفعيل' : next === 'suspended' ? 'إيقاف' : 'تعطيل';
      showEmployeesToast('success', `تم ${verb} الحساب.`);
    } catch (err) {
      console.error('[employees] account status update failed:', err);
      showEmployeesToast('error', 'تعذر تحديث حالة الحساب. تواصل مع المدير إذا تكرر الخطأ.');
    } finally {
      setEmployeesBusyId(null);
    }
  };

  // Unified save: persists employee for login AND syncs AppUser for the users tab
  const handleSaveMember = async (emp: Employee) => {
    const existingEmp = employees.find((e) => e.id === emp.id);

    // Avatar handling: only update/remove avatar if user explicitly changed it
    // If emp.avatar is empty but existing employee had a stored avatar, preserve it
    if (emp.avatar) {
      // User uploaded a new avatar — save it
      saveAvatar(emp.id, emp.avatar);
    } else if (existingEmp) {
      // Editing existing employee: check if they had a stored avatar
      const storedAvatars = loadAvatars();
      if (storedAvatars[emp.id]) {
        // Preserve existing avatar — user didn't change it, just left field empty
        emp = { ...emp, avatar: storedAvatars[emp.id] };
      }
      // If no stored avatar either, nothing to do (no removeAvatar call)
    }
    // For new employees with no avatar: nothing to save/remove

    const isNew = !employees.find((e) => e.id === emp.id);

    setEmployees((prev) => {
      const exists = prev.find((e) => e.id === emp.id);
      const finalEmp = exists
        ? prev.map((e) =>
            e.id === emp.id ? (emp.password ? emp : { ...emp, password: e.password }) : e
          )
        : [...prev, emp];
      saveEmployeesToStorage(finalEmp);
      return finalEmp;
    });

    // Sync AppUser: update existing or create new
    setAppUsers((prev) => {
      const existingUser = prev.find((u) => {
        return u.email === `emp:${emp.id}` || (u.name === emp.name && u.email.startsWith('emp:'));
      });

      let updatedUsers: AppUser[];
      if (existingUser) {
        // Update existing user record
        updatedUsers = prev.map((u) =>
          u.id === existingUser.id
            ? {
                ...u,
                name: emp.name,
                roleId: emp.roleId,
                status: emp.status,
                avatar: emp.name.trim().charAt(0) || '؟',
              }
            : u
        );
      } else {
        // Check if there's a user with same name (pre-existing default user)
        const matchByName = prev.find((u) => u.name === emp.name);
        if (matchByName) {
          updatedUsers = prev.map((u) =>
            u.id === matchByName.id ? { ...u, roleId: emp.roleId, status: emp.status } : u
          );
        } else {
          // Create new AppUser linked to this employee
          const newUser: AppUser = {
            id: `u_${emp.id}`,
            name: emp.name,
            email: `emp:${emp.id}`,
            roleId: emp.roleId,
            status: emp.status,
            avatar: emp.name.trim().charAt(0) || '؟',
            loginCount: 0,
            logoutCount: 0,
            lastDevice: undefined,
            lastLogin: undefined,
            sessions: [],
          };
          updatedUsers = [...prev, newUser];
        }
      }
      saveUsersToStorage(updatedUsers);
      return updatedUsers;
    });

    // Register new employee in Supabase Auth so they can log in via Supabase
    if (isNew && emp.password) {
      try {
        const supabase = createClient();
        if (supabase) {
          const authEmail = `${emp.username}@turathmasr.com`;
          // Phase 26G — use the shared `legacyRoleText` helper so the
          // free-text `role` column stays in sync with `role_id` here
          // and in `handleProfileRoleUpdate`.
          const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
            email: authEmail,
            password: emp.password,
            options: {
              data: {
                full_name: emp.name,
                name: emp.name,
                role: legacyRoleText(emp.roleId),
                role_id: emp.roleId,
                username: emp.username,
              },
            },
          });
          if (signUpError) {
            console.error('Supabase signUp error:', signUpError.message);
            alert(`خطأ في إنشاء الحساب: ${signUpError.message}`);
          } else if (signUpData?.user) {
            // Phase 26G — derive `role_name` from the live `roles`
            // state (turath_roles lookup) so a stale `emp.roleName`
            // form value can't desync the cached column.
            const canonicalNewRoleName =
              roles.find((r) => r.id === emp.roleId)?.name || emp.roleName || '';
            await supabase.from('profiles').upsert({
              id: signUpData.user.id,
              email: authEmail,
              full_name: emp.name,
              role: legacyRoleText(emp.roleId),
              role_id: emp.roleId,
              role_name: canonicalNewRoleName,
            });
          }
        }
      } catch (err) {
        console.error('Supabase unavailable:', err);
      }
    }

    setEditMember(undefined);
  };

  const toggleShowPassword = (id: string) => {
    setShowPasswords((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const getRoleName = (roleId: string) => roles.find((r) => r.id === roleId)?.name || '—';
  const getRoleById = (roleId: string) => roles.find((r) => r.id === roleId);
  const getRoleColors = (roleId: string) => {
    const role = roles.find((r) => r.id === roleId);
    return colorMap[role?.color || 'blue'] || colorMap.blue;
  };

  // Phase 26E — `filteredUsers` removed alongside the inline users
  // tab; UsersTab.tsx now owns search/filter state internally.
  // `activeUsersCount` is still consumed by the roles-tab summary
  // card below so we keep it (it reads from appUsers which the
  // page-level loader populates).
  const activeUsersCount = appUsers.filter((u) => u.status === 'active').length;

  return (
    <AppLayout currentPath="/roles">
      <div className="space-y-6 fade-in" dir="rtl">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">
              المستخدمون والأدوار والصلاحيات
            </h1>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
              إدارة موحدة للمستخدمين والأدوار وتفعيل الصلاحيات على كل مستخدم
            </p>
          </div>
          <button
            onClick={() => {
              if (activeTab === 'roles') setEditRole(null);
              else setEditMember(null); // both employees and users tabs use unified modal
            }}
            className="flex items-center gap-2 px-4 py-2.5 bg-[hsl(var(--primary))] text-white rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            <Plus size={18} />
            {activeTab === 'roles' ? 'إضافة دور' : 'إضافة موظف / مستخدم'}
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="card-section p-4 text-center">
            <p className="text-2xl font-bold text-[hsl(var(--primary))]">{roles.length}</p>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">إجمالي الأدوار</p>
          </div>
          <div className="card-section p-4 text-center">
            <p className="text-2xl font-bold text-green-600">
              {employees.filter((e) => e.status === 'active').length}
            </p>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">موظفون نشطون</p>
          </div>
          <div className="card-section p-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{activeUsersCount}</p>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">مستخدمون نشطون</p>
          </div>
          <div className="card-section p-4 text-center">
            <p className="text-2xl font-bold text-purple-600">{allPermissions.length}</p>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">إجمالي الصلاحيات</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex bg-[hsl(var(--muted))] rounded-xl p-1 gap-1 w-fit">
          {[
            { key: 'roles', label: `الأدوار (${roles.length})`, icon: <ShieldCheck size={15} /> },
            {
              key: 'employees',
              label: `الموظفون (${employees.length})`,
              icon: <UserPlus size={15} />,
            },
            { key: 'users', label: `المستخدمون (${appUsers.length})`, icon: <Users size={15} /> },
            // Phase 26A — new security tab. Shows orphan-account
            // banner, per-user status controls, devices, login events,
            // and the staff audit log. RLS gates the data server-side
            // to admins only.
            { key: 'security', label: 'الأمان والتدقيق', icon: <ShieldAlert size={15} /> },
            // Phase 26C — permissions matrix tab. Read/write grid that
            // lets admins reshape role permissions with confirmation,
            // sensitive-perm guards, last-admin lock protection, and a
            // mandatory audit-log write on save.
            {
              key: 'matrix',
              label: 'مصفوفة الصلاحيات',
              icon: <ShieldCheck size={15} />,
            },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() =>
                setActiveTab(tab.key as 'roles' | 'employees' | 'users' | 'security' | 'matrix')
              }
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === tab.key ? 'bg-white text-[hsl(var(--primary))] shadow-sm' : 'text-[hsl(var(--muted-foreground))]'}`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Roles Tab ── */}
        {activeTab === 'roles' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
            {roles.map((role) => {
              const colors = colorMap[role.color] || colorMap.blue;
              const roleEmployees = employees.filter((e) => e.roleId === role.id);
              const roleUsers = appUsers.filter((u) => u.roleId === role.id);
              return (
                <div
                  key={role.id}
                  className={`card-section p-5 border-2 ${colors.border} hover:shadow-md transition-shadow`}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-11 h-11 rounded-xl ${colors.bg} ${colors.text} flex items-center justify-center`}
                      >
                        <ShieldCheck size={22} />
                      </div>
                      <div>
                        <p className="font-bold text-[hsl(var(--foreground))]">{role.name}</p>
                        <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                          {roleEmployees.length + roleUsers.length} مستخدم
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => setEditRole(role)}
                        className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))] transition-colors"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={async () => {
                          setRoles((prev) => prev.filter((r) => r.id !== role.id));
                          try {
                            const supabase = createClient();
                            if (supabase) {
                              await supabase.from('turath_roles').delete().eq('id', role.id);
                            }
                          } catch (e) {
                            console.error('Delete role error:', e);
                          }
                        }}
                        className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-red-500 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-[hsl(var(--muted-foreground))] mb-3">
                    {role.description}
                  </p>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {role.permissions.slice(0, 3).map((p) => {
                      const perm = allPermissions.find((ap) => ap.id === p);
                      return perm ? (
                        <span
                          key={p}
                          className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${colors.bg} ${colors.text}`}
                        >
                          {perm.label}
                        </span>
                      ) : null;
                    })}
                    {role.permissions.length > 3 && (
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${colors.bg} ${colors.text}`}
                      >
                        +{role.permissions.length - 3} أخرى
                      </span>
                    )}
                    {role.permissions.length === 0 && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-gray-100 text-gray-500">
                        لا توجد صلاحيات
                      </span>
                    )}
                  </div>
                  {roleEmployees.length > 0 && (
                    <div className="flex -space-x-2 space-x-reverse mb-3">
                      {roleEmployees.slice(0, 4).map((emp) => (
                        <div
                          key={emp.id}
                          className={`w-7 h-7 rounded-full border-2 border-white overflow-hidden flex items-center justify-center text-white text-xs font-bold ${colors.avatar}`}
                        >
                          {emp.avatar ? (
                            <Image
                              src={emp.avatar}
                              alt={emp.name}
                              width={28}
                              height={28}
                              className="w-full h-full object-cover"
                              unoptimized={emp.avatar.startsWith('data:')}
                            />
                          ) : (
                            <span>{emp.name.charAt(0)}</span>
                          )}
                        </div>
                      ))}
                      {roleEmployees.length > 4 && (
                        <div className="w-7 h-7 rounded-full border-2 border-white bg-gray-200 flex items-center justify-center text-gray-600 text-xs font-bold">
                          +{roleEmployees.length - 4}
                        </div>
                      )}
                    </div>
                  )}
                  <button
                    onClick={() => setEditRole(role)}
                    className={`w-full flex items-center justify-center gap-1.5 text-xs py-2 rounded-xl border ${colors.border} ${colors.text} transition-colors font-semibold`}
                  >
                    <ShieldCheck size={13} />
                    تعديل الصلاحيات
                  </button>
                </div>
              );
            })}
            <button
              onClick={() => setEditRole(null)}
              className="card-section p-5 border-2 border-dashed border-[hsl(var(--border))] hover:border-[hsl(var(--primary))]/50 hover:bg-[hsl(var(--primary))]/5 transition-all flex flex-col items-center justify-center gap-3 min-h-[180px] group"
            >
              <div className="w-11 h-11 rounded-xl bg-[hsl(var(--muted))] group-hover:bg-[hsl(var(--primary))]/10 flex items-center justify-center transition-colors">
                <Plus
                  size={22}
                  className="text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--primary))]"
                />
              </div>
              <p className="text-sm font-semibold text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--primary))] transition-colors">
                إضافة دور جديد
              </p>
            </button>
          </div>
        )}

        {/* ── Employees Tab ── */}
        {activeTab === 'employees' && (
          <div className="space-y-3">
            {/* Phase 26E-Fix1 — banner explaining the new safe-action
                model. Mirrors the UsersTab notice so admins see the
                same message in both tabs. */}
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 flex items-start gap-2">
              <ShieldAlert size={16} className="text-amber-700 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-amber-900">
                <p className="font-bold mb-0.5">الحذف النهائي غير متاح من هذا التبويب.</p>
                <p>
                  لحذف حساب نهائيًا يتطلب صلاحية Service Role ومرحلة منفصلة. للحفاظ على سجل التدقيق
                  استخدم
                  <span className="font-bold mx-1">تعطيل الحساب</span>
                  أو
                  <span className="font-bold mx-1">إيقاف مؤقت</span>.
                </p>
              </div>
            </div>
            <div className="card-section overflow-hidden">
              <div className="p-4 border-b border-[hsl(var(--border))]">
                <p className="text-sm font-semibold">قائمة الموظفين وبيانات الدخول</p>
                <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                  يمكنك عرض وتعديل بيانات كل موظف. التحكم في حالة الحساب من خلال أزرار الإجراءات في
                  كل صف؛ تفاصيل الأجهزة وتسجيلات الدخول في تبويب المستخدمون.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" dir="rtl">
                  <thead>
                    <tr className="bg-[hsl(var(--muted))]/50 text-[hsl(var(--muted-foreground))] text-xs">
                      <th className="text-right px-4 py-3 font-semibold">الموظف</th>
                      <th className="text-right px-4 py-3 font-semibold">اسم المستخدم</th>
                      <th className="text-right px-4 py-3 font-semibold">كلمة المرور</th>
                      <th className="text-right px-4 py-3 font-semibold">الدور</th>
                      <th className="text-right px-4 py-3 font-semibold">الصلاحيات</th>
                      <th className="text-right px-4 py-3 font-semibold">الحالة</th>
                      <th className="text-right px-4 py-3 font-semibold">تاريخ الإنشاء</th>
                      <th className="text-right px-4 py-3 font-semibold">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((emp) => {
                      const rc = getRoleColors(emp.roleId);
                      const empRole = getRoleById(emp.roleId);
                      const isShowingPass = showPasswords.has(emp.id);
                      return (
                        <tr
                          key={emp.id}
                          className="border-t border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/30 transition-colors"
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div
                                className={`w-9 h-9 rounded-full overflow-hidden flex items-center justify-center text-white text-sm font-bold flex-shrink-0 ${emp.avatar ? '' : rc.avatar}`}
                              >
                                {emp.avatar ? (
                                  <Image
                                    src={emp.avatar}
                                    alt={emp.name}
                                    width={36}
                                    height={36}
                                    className="w-full h-full object-cover"
                                    unoptimized={emp.avatar.startsWith('data:')}
                                  />
                                ) : (
                                  <span>{emp.name.charAt(0)}</span>
                                )}
                              </div>
                              <span className="font-semibold">{emp.name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <Key size={13} className="text-[hsl(var(--muted-foreground))]" />
                              <span className="font-mono text-xs bg-[hsl(var(--muted))] px-2 py-1 rounded-lg">
                                {emp.username}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-xs bg-[hsl(var(--muted))] px-2 py-1 rounded-lg">
                                {isShowingPass ? emp.password : '••••••••'}
                              </span>
                              <button
                                onClick={() => toggleShowPassword(emp.id)}
                                className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                              >
                                {isShowingPass ? <EyeOff size={14} /> : <Eye size={14} />}
                              </button>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {/* Phase 26G — canonical role display from live
                                `turath_roles`. The stale-cache warning fires
                                when the cached `profiles.role_name` (held in
                                `emp.roleName`) doesn't match the live name —
                                a side effect of pre-26G code paths that
                                updated `role_id` without keeping
                                `role_name` in sync. The save handler
                                repairs it the moment the role is edited. */}
                            {(() => {
                              const canonicalRole = roles.find((r) => r.id === emp.roleId);
                              const canonicalName = canonicalRole?.name ?? null;
                              const isUnknownRoleId = !canonicalRole;
                              const isStaleName =
                                !!canonicalName &&
                                !!emp.roleName &&
                                emp.roleName.trim() !== canonicalName.trim();
                              return (
                                <div className="flex items-center gap-1 flex-wrap">
                                  <span
                                    className={`text-xs px-2.5 py-1 rounded-full font-semibold ${rc.bg} ${rc.text}`}
                                  >
                                    {canonicalName ?? emp.roleId}
                                  </span>
                                  {isUnknownRoleId && (
                                    <span
                                      className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200"
                                      title={`معرّف الدور (${emp.roleId}) غير موجود في جدول الأدوار`}
                                    >
                                      ⚠ غير معروف
                                    </span>
                                  )}
                                  {isStaleName && !isUnknownRoleId && (
                                    <span
                                      className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200"
                                      title={`اسم الدور المسجل (${emp.roleName}) قديم؛ الاسم الحالي: ${canonicalName}. سيتم تحديثه عند أي تعديل دور.`}
                                    >
                                      ⚠ اسم قديم
                                    </span>
                                  )}
                                </div>
                              );
                            })()}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full font-semibold ${rc.bg} ${rc.text}`}
                            >
                              {empRole ? `${empRole.permissions.length} صلاحية` : '—'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {/* Phase 26E-Fix1 — reads real `account_status`
                              instead of hardcoded `active`. Includes a
                              compact disabled-reason line so reviewers
                              don't have to open the users tab to see why
                              an account is off. */}
                            {(() => {
                              const tone =
                                emp.accountStatus === 'active'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : emp.accountStatus === 'disabled'
                                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                                    : emp.accountStatus === 'suspended'
                                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                                      : 'bg-slate-50 text-slate-700 border-slate-200';
                              const label =
                                emp.accountStatus === 'active'
                                  ? 'نشط'
                                  : emp.accountStatus === 'disabled'
                                    ? 'معطّل'
                                    : emp.accountStatus === 'suspended'
                                      ? 'موقوف مؤقتًا'
                                      : 'بانتظار المراجعة';
                              return (
                                <div className="flex flex-col gap-0.5">
                                  <span
                                    className={`text-xs px-2.5 py-1 rounded-full font-semibold border w-fit ${tone}`}
                                  >
                                    {label}
                                  </span>
                                  {emp.disabledReason && emp.accountStatus !== 'active' && (
                                    <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
                                      {emp.disabledReason}
                                    </span>
                                  )}
                                </div>
                              );
                            })()}
                          </td>
                          <td className="px-4 py-3 text-xs text-[hsl(var(--muted-foreground))]">
                            {emp.createdAt}
                          </td>
                          <td className="px-4 py-3">
                            {/* Phase 26E-Fix1 — silent `.delete()` button
                              replaced with three safe actions
                              (disable / suspend / reactivate) plus a
                              disabled Trash2 tooltip explaining that
                              permanent deletion isn't available from
                              the app. Mirrors the UsersTab pattern so
                              both tabs offer the same status semantics. */}
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => setEditMember(emp)}
                                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))] transition-colors"
                                title="تعديل البيانات"
                              >
                                <Edit2 size={14} />
                              </button>
                              {/* Phase 26G — open the shared role-edit modal.
                                  Page owns the supabase write + audit; the
                                  modal renders the live `roles` list +
                                  safety guards. */}
                              <button
                                onClick={() => {
                                  if (!canManageStaff) return;
                                  setRoleEditTarget({
                                    id: emp.id,
                                    email: emp.email || null,
                                    name: emp.name,
                                    currentRoleId: emp.roleId,
                                    currentRoleName: emp.roleName ?? null,
                                  });
                                }}
                                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-indigo-50 text-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                title={
                                  canManageStaff ? 'تعديل الدور' : 'لا تملك صلاحية تعديل الأدوار'
                                }
                                disabled={!canManageStaff || roleEditBusy}
                              >
                                <ShieldCheck size={14} />
                              </button>
                              {emp.accountStatus !== 'disabled' && (
                                <button
                                  onClick={() => {
                                    if (!canManageStaff) return;
                                    const reason =
                                      window.prompt('سبب التعطيل (اختياري):') ?? undefined;
                                    void handleEmployeeStatusUpdate(emp, 'disabled', reason);
                                  }}
                                  className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-rose-50 text-rose-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                  title={
                                    canManageStaff
                                      ? 'تعطيل الحساب'
                                      : 'لا تملك صلاحية تعطيل الحسابات'
                                  }
                                  disabled={!canManageStaff || employeesBusyId === emp.id}
                                >
                                  <UserX size={14} />
                                </button>
                              )}
                              {emp.accountStatus !== 'suspended' &&
                                emp.accountStatus !== 'disabled' && (
                                  <button
                                    onClick={() => {
                                      if (!canManageStaff) return;
                                      const reason =
                                        window.prompt('سبب الإيقاف المؤقت (اختياري):') ?? undefined;
                                      void handleEmployeeStatusUpdate(emp, 'suspended', reason);
                                    }}
                                    className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-amber-50 text-amber-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                    title={
                                      canManageStaff
                                        ? 'إيقاف مؤقت'
                                        : 'لا تملك صلاحية إيقاف الحسابات'
                                    }
                                    disabled={!canManageStaff || employeesBusyId === emp.id}
                                  >
                                    <Clock size={14} />
                                  </button>
                                )}
                              {(emp.accountStatus === 'disabled' ||
                                emp.accountStatus === 'suspended') && (
                                <button
                                  onClick={() => void handleEmployeeStatusUpdate(emp, 'active')}
                                  className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-emerald-50 text-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                  title={
                                    canManageStaff
                                      ? 'إعادة تفعيل الحساب'
                                      : 'لا تملك صلاحية إعادة التفعيل'
                                  }
                                  disabled={!canManageStaff || employeesBusyId === emp.id}
                                >
                                  <Check size={14} />
                                </button>
                              )}
                              <button
                                disabled
                                className="w-8 h-8 flex items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))]/40 cursor-not-allowed"
                                title="الحذف النهائي غير متاح من التطبيق. استخدم تعطيل الحساب للحفاظ على سجل التدقيق."
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {employees.length === 0 && (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-4 py-8 text-center text-[hsl(var(--muted-foreground))] text-sm"
                        >
                          لا يوجد موظفون
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── Users Tab (Phase 26E redesign) ──
            Security/account-focused: joins profiles with devices +
            login events + staff audit log via the new UsersTab
            component. Replaces the legacy inline table that
            hardcoded login/device counts and silently deleted rows
            on click. Hard delete is intentionally removed from
            here; see UsersTab.tsx for the explanation banner. */}
        {activeTab === 'users' && (
          <UsersTab
            onOpenSecurityTab={() => setActiveTab('security')}
            /* Phase 26G — page owns the role-edit modal; UsersTab
               just opens it with a target descriptor. */
            onRequestEditRole={(t) => setRoleEditTarget(t)}
            /* Phase 26G — page signals UsersTab to refetch after a
               successful page-level role mutation. */
            reloadTick={usersTabReloadTick}
          />
        )}

        {/* Phase 26A — Security tab */}
        {activeTab === 'security' && <SecurityTab />}

        {/* Phase 26C — Permissions matrix tab */}
        {activeTab === 'matrix' && <PermissionsMatrixTab />}
      </div>

      {/* Modals */}
      {editRole !== undefined && (
        <RoleModal role={editRole} onClose={() => setEditRole(undefined)} onSave={handleSaveRole} />
      )}
      {editMember !== undefined && (
        <UnifiedMemberModal
          employee={editMember}
          roles={roles}
          onClose={() => setEditMember(undefined)}
          onSave={handleSaveMember}
        />
      )}
      {/* Phase 26G — shared role-edit modal. Mounted at the page
          level so both the employees tab and the users tab open
          the same UI. Active-admin count + self-flag computed
          from in-memory profiles list so the guards reflect the
          latest data without an extra DB roundtrip. */}
      {roleEditTarget && (
        <ChangeRoleModal
          target={roleEditTarget}
          roles={roles.map((r) => ({
            id: r.id,
            name: r.name,
            permCount: r.permissions.length,
          }))}
          isSelf={roleEditTarget.id === (user?.id ?? null)}
          activeAdminCount={
            employees.filter((e) => e.roleId === 'r1' && e.accountStatus === 'active').length
          }
          targetIsActiveAdmin={
            !!employees.find(
              (e) => e.id === roleEditTarget.id && e.roleId === 'r1' && e.accountStatus === 'active'
            )
          }
          busy={roleEditBusy}
          onClose={() => {
            if (!roleEditBusy) setRoleEditTarget(null);
          }}
          onSave={(newRoleId) => handleProfileRoleUpdate(roleEditTarget, newRoleId)}
        />
      )}
      {/* Phase 26E-Fix1 — toast for the new employees-tab safe
          actions. UsersTab keeps its own toast scoped to that
          component; the inline employees tab needed one too so
          success/error feedback isn't silent. */}
      {employeesToast && (
        <div
          className={`fixed bottom-6 right-6 z-[80] max-w-sm rounded-2xl border px-4 py-3 shadow-lg ${
            employeesToast.kind === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
          role="status"
        >
          <p className="text-sm font-semibold">{employeesToast.message}</p>
        </div>
      )}
    </AppLayout>
  );
}
