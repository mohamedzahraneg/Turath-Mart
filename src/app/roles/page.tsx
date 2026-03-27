'use client';
import React, { useState, useRef, useEffect } from 'react';
import AppLayout from '@/components/AppLayout';
import { ShieldCheck, Plus, Edit2, Trash2, X, Save, Check, Users, Eye, EyeOff, Key, UserPlus, Camera, Upload, Monitor, Smartphone, Tablet, LogIn, LogOut, Calendar, Clock, Search, CheckCircle, XCircle, ChevronDown, ChevronUp, Lock, Unlock } from 'lucide-react';

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
  username: string;
  password: string;
  roleId: string;
  status: 'active' | 'inactive';
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

const permGroups = ['لوحة التحكم', 'الأوردرات', 'الشحن', 'المخزون', 'التقارير', 'المستخدمون', 'خدمة العملاء', 'الإعدادات'];

// ─── Initial Data ──────────────────────────────────────────────────────────────
const initialRoles: Role[] = [
  { id: 'r1', name: 'مدير النظام', description: 'صلاحيات كاملة على جميع أقسام النظام', color: 'purple', permissions: allPermissions.map(p => p.id), usersCount: 1 },
  { id: 'r2', name: 'مشرف النظام', description: 'إشراف على النظام وإدارة المستخدمين والتقارير', color: 'indigo', permissions: ['view_dashboard', 'view_orders', 'edit_orders', 'update_status', 'view_shipping', 'manage_shipping', 'view_inventory', 'view_reports', 'export_reports', 'manage_users'], usersCount: 1 },
  { id: 'r3', name: 'مشرف شحن', description: 'إدارة عمليات الشحن وتعيين المناديب وتحديث الحالات', color: 'blue', permissions: ['view_dashboard', 'view_orders', 'create_orders', 'edit_orders', 'update_status', 'view_shipping', 'manage_shipping', 'assign_courier', 'view_inventory', 'view_reports'], usersCount: 2 },
  { id: 'r4', name: 'مندوب شحن', description: 'تنفيذ عمليات التوصيل وتحديث حالة الشحنات', color: 'cyan', permissions: ['view_orders', 'update_status', 'view_shipping'], usersCount: 3 },
  { id: 'r5', name: 'مدير خدمة عملاء', description: 'إدارة فريق خدمة العملاء والإشراف على الشكاوى', color: 'green', permissions: ['view_dashboard', 'view_orders', 'view_shipping', 'view_reports', 'export_reports', 'view_customers', 'manage_customers', 'customer_support'], usersCount: 1 },
  { id: 'r6', name: 'خدمة عملاء', description: 'التواصل مع العملاء ومتابعة الطلبات والشكاوى', color: 'teal', permissions: ['view_orders', 'view_shipping', 'view_customers', 'customer_support'], usersCount: 2 },
];

const defaultEmployees: Employee[] = [
  { id: 'e1', name: 'محمد الزهراني', username: 'admin', password: 'Admin@123', roleId: 'r1', status: 'active', createdAt: '01/01/2026', avatar: '' },
  { id: 'e2', name: 'أحمد علي', username: 'ahmed.ali', password: 'Ahmed@2026', roleId: 'r3', status: 'active', createdAt: '15/01/2026', avatar: '' },
  { id: 'e3', name: 'سارة محمود', username: 'sara.m', password: 'Sara@2026', roleId: 'r5', status: 'active', createdAt: '20/01/2026', avatar: '' },
];

const DAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

function formatSession(iso: string) {
  const d = new Date(iso);
  return {
    day: DAYS_AR[d.getDay()],
    date: d.toLocaleDateString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit' }),
    time: d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }),
  };
}

const defaultUsers: AppUser[] = [
  {
    id: 'u1', name: 'محمد الزهراني', email: 'manager@zahranship.com', roleId: 'r1', status: 'active', avatar: 'م', loginCount: 47, logoutCount: 46, lastDevice: 'كمبيوتر', lastLogin: '2026-03-27T09:32:14',
    sessions: [
      { id: 's1', userId: 'u1', type: 'login', device: 'كمبيوتر', timestamp: '2026-03-27T09:32:14', ...formatSession('2026-03-27T09:32:14') },
      { id: 's2', userId: 'u1', type: 'logout', device: 'كمبيوتر', timestamp: '2026-03-27T14:10:00', ...formatSession('2026-03-27T14:10:00') },
      { id: 's3', userId: 'u1', type: 'login', device: 'موبايل', timestamp: '2026-03-26T08:15:00', ...formatSession('2026-03-26T08:15:00') },
      { id: 's4', userId: 'u1', type: 'logout', device: 'موبايل', timestamp: '2026-03-26T17:00:00', ...formatSession('2026-03-26T17:00:00') },
    ],
  },
  {
    id: 'u2', name: 'أحمد علي', email: 'ahmed@zahranship.com', roleId: 'r3', status: 'active', avatar: 'أ', loginCount: 32, logoutCount: 31, lastDevice: 'موبايل', lastLogin: '2026-03-26T11:15:42',
    sessions: [
      { id: 's5', userId: 'u2', type: 'login', device: 'موبايل', timestamp: '2026-03-26T11:15:42', ...formatSession('2026-03-26T11:15:42') },
      { id: 's6', userId: 'u2', type: 'logout', device: 'موبايل', timestamp: '2026-03-26T18:30:00', ...formatSession('2026-03-26T18:30:00') },
      { id: 's7', userId: 'u2', type: 'login', device: 'كمبيوتر', timestamp: '2026-03-25T09:00:00', ...formatSession('2026-03-25T09:00:00') },
    ],
  },
  {
    id: 'u3', name: 'سارة محمود', email: 'sara@zahranship.com', roleId: 'r5', status: 'active', avatar: 'س', loginCount: 28, logoutCount: 28, lastDevice: 'كمبيوتر', lastLogin: '2026-03-25T08:40:51',
    sessions: [
      { id: 's8', userId: 'u3', type: 'login', device: 'كمبيوتر', timestamp: '2026-03-25T08:40:51', ...formatSession('2026-03-25T08:40:51') },
      { id: 's9', userId: 'u3', type: 'logout', device: 'كمبيوتر', timestamp: '2026-03-25T16:00:00', ...formatSession('2026-03-25T16:00:00') },
    ],
  },
  {
    id: 'u4', name: 'خالد عمر', email: 'khaled@zahranship.com', roleId: 'r4', status: 'inactive', avatar: 'خ', loginCount: 15, logoutCount: 15, lastDevice: 'تابلت', lastLogin: '2026-03-20T14:22:05',
    sessions: [
      { id: 's10', userId: 'u4', type: 'login', device: 'تابلت', timestamp: '2026-03-20T14:22:05', ...formatSession('2026-03-20T14:22:05') },
      { id: 's11', userId: 'u4', type: 'logout', device: 'تابلت', timestamp: '2026-03-20T19:00:00', ...formatSession('2026-03-20T19:00:00') },
    ],
  },
  {
    id: 'u5', name: 'فاطمة حسن', email: 'fatma@zahranship.com', roleId: 'r6', status: 'active', avatar: 'ف', loginCount: 22, logoutCount: 22, lastDevice: 'موبايل', lastLogin: '2026-03-27T13:40:07',
    sessions: [
      { id: 's12', userId: 'u5', type: 'login', device: 'موبايل', timestamp: '2026-03-27T13:40:07', ...formatSession('2026-03-27T13:40:07') },
      { id: 's13', userId: 'u5', type: 'logout', device: 'موبايل', timestamp: '2026-03-27T20:00:00', ...formatSession('2026-03-27T20:00:00') },
    ],
  },
];

const colorMap: Record<string, { bg: string; text: string; border: string; avatar: string }> = {
  purple: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', avatar: 'bg-purple-500' },
  indigo: { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200', avatar: 'bg-indigo-500' },
  blue: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', avatar: 'bg-blue-500' },
  cyan: { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200', avatar: 'bg-cyan-500' },
  green: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200', avatar: 'bg-green-500' },
  teal: { bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200', avatar: 'bg-teal-500' },
  amber: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', avatar: 'bg-amber-500' },
  orange: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', avatar: 'bg-orange-500' },
};

// ─── localStorage helpers ──────────────────────────────────────────────────────
const LS_EMPLOYEES = 'turath_employees';
const LS_USERS = 'turath_users';
const LS_AVATARS = 'turath_avatars';

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

function loadFromStorage<T>(key: string, fallback: T[]): T[] {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function saveEmployeesToStorage(employees: Employee[]) {
  if (typeof window === 'undefined') return;
  try {
    // Strip avatar (base64) to avoid quota exceeded — avatars saved separately in LS_AVATARS
    const lightweight = employees.map(({ avatar, ...rest }) => ({ ...rest, avatar: '' }));
    localStorage.setItem(LS_EMPLOYEES, JSON.stringify(lightweight));
  } catch {
    try {
      const minimal = employees.map(({ id, username, password, roleId, status, name, createdAt }) => ({ id, username, password, roleId, status, name, createdAt, avatar: '' }));
      localStorage.setItem(LS_EMPLOYEES, JSON.stringify(minimal));
    } catch {
      // storage unavailable
    }
  }
}

function saveUsersToStorage(users: AppUser[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LS_USERS, JSON.stringify(users));
  } catch {
    // storage unavailable
  }
}

// ─── Device Icon ───────────────────────────────────────────────────────────────
function DeviceIcon({ device, size = 14 }: { device?: string; size?: number }) {
  if (device === 'موبايل') return <Smartphone size={size} />;
  if (device === 'تابلت') return <Tablet size={size} />;
  return <Monitor size={size} />;
}

// ─── Role Modal ────────────────────────────────────────────────────────────────
interface RoleModalProps { role: Role | null; onClose: () => void; onSave: (role: Role) => void; }

function RoleModal({ role, onClose, onSave }: RoleModalProps) {
  const [form, setForm] = useState<Role>(
    role || { id: `r${Date.now()}`, name: '', description: '', color: 'blue', permissions: [], usersCount: 0 }
  );

  const togglePerm = (id: string) => {
    setForm(prev => ({ ...prev, permissions: prev.permissions.includes(id) ? prev.permissions.filter(p => p !== id) : [...prev.permissions, id] }));
  };

  const toggleGroup = (group: string) => {
    const groupPerms = allPermissions.filter(p => p.group === group).map(p => p.id);
    const allSelected = groupPerms.every(p => form.permissions.includes(p));
    setForm(prev => ({ ...prev, permissions: allSelected ? prev.permissions.filter(p => !groupPerms.includes(p)) : [...new Set([...prev.permissions, ...groupPerms])] }));
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-[hsl(var(--border))]">
          <h2 className="text-lg font-bold">{role ? 'تعديل دور' : 'إضافة دور جديد'}</h2>
          <button onClick={onClose} className="p-2 hover:bg-[hsl(var(--muted))] rounded-xl transition-colors"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-semibold mb-1.5">اسم الدور</label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-semibold mb-1.5">الوصف</label>
              <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30" />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1.5">اللون</label>
              <select value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="w-full border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30">
                {Object.keys(colorMap).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <p className="text-sm font-semibold mb-3">الصلاحيات ({form.permissions.length} / {allPermissions.length})</p>
            <div className="space-y-3">
              {permGroups.map(group => {
                const groupPerms = allPermissions.filter(p => p.group === group);
                const allSelected = groupPerms.every(p => form.permissions.includes(p.id));
                return (
                  <div key={group} className="border border-[hsl(var(--border))] rounded-xl overflow-hidden">
                    <button onClick={() => toggleGroup(group)} className="w-full flex items-center justify-between px-4 py-2.5 bg-[hsl(var(--muted))]/50 hover:bg-[hsl(var(--muted))] transition-colors">
                      <span className="text-sm font-semibold">{group}</span>
                      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${allSelected ? 'bg-[hsl(var(--primary))] border-[hsl(var(--primary))]' : 'border-gray-300'}`}>
                        {allSelected && <Check size={12} className="text-white" />}
                      </div>
                    </button>
                    <div className="p-3 grid grid-cols-2 gap-2">
                      {groupPerms.map(perm => (
                        <button key={perm.id} onClick={() => togglePerm(perm.id)} className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg border transition-all text-right ${form.permissions.includes(perm.id) ? 'bg-[hsl(var(--primary))]/10 border-[hsl(var(--primary))]/30 text-[hsl(var(--primary))]' : 'border-[hsl(var(--border))]'}`}>
                          <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${form.permissions.includes(perm.id) ? 'bg-[hsl(var(--primary))]' : 'border-gray-300'}`}>
                            {form.permissions.includes(perm.id) && <Check size={10} className="text-white" />}
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
          <button onClick={() => onSave(form)} className="flex-1 flex items-center justify-center gap-2 bg-[hsl(var(--primary))] text-white rounded-xl py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity">
            <Save size={16} />حفظ
          </button>
          <button onClick={onClose} className="px-5 border border-[hsl(var(--border))] rounded-xl text-sm font-semibold hover:bg-[hsl(var(--muted))] transition-colors">إلغاء</button>
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
      username: '',
      password: '',
      roleId: roles[0]?.id || '',
      status: 'active',
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
    if (file.size > 2 * 1024 * 1024) { setErrors(prev => ({ ...prev, avatar: 'حجم الصورة يجب أن يكون أقل من 2MB' })); return; }
    const reader = new FileReader();
    reader.onload = (ev) => { setForm(prev => ({ ...prev, avatar: ev.target?.result as string })); setErrors(prev => { const n = { ...prev }; delete n.avatar; return n; }); };
    reader.readAsDataURL(file);
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = 'الاسم مطلوب';
    if (!form.username.trim()) errs.username = 'اسم المستخدم مطلوب';
    if (form.username.includes(' ')) errs.username = 'اسم المستخدم لا يجب أن يحتوي على مسافات';
    if (!employee && form.password.length < 6) errs.password = 'كلمة المرور يجب أن تكون 6 أحرف على الأقل';
    if (!form.roleId) errs.roleId = 'الدور مطلوب';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const roleColor = colorMap[roles.find(r => r.id === form.roleId)?.color || 'blue'] || colorMap.blue;
  const selectedRole = roles.find(r => r.id === form.roleId);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-2">
            <UserPlus size={20} className="text-[hsl(var(--primary))]" />
            <h2 className="text-lg font-bold">{employee ? 'تعديل موظف / مستخدم' : 'إضافة موظف / مستخدم جديد'}</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-[hsl(var(--muted))] rounded-xl transition-colors"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Avatar */}
          <div className="flex flex-col items-center gap-3">
            <div className="relative">
              <div className={`w-20 h-20 rounded-full overflow-hidden flex items-center justify-center text-white text-2xl font-bold ${form.avatar ? '' : roleColor.avatar}`}>
                {form.avatar ? <img src={form.avatar} alt="صورة المستخدم" className="w-full h-full object-cover" /> : <span>{form.name ? form.name.charAt(0) : <Camera size={28} />}</span>}
              </div>
              <button type="button" onClick={() => fileInputRef.current?.click()} className="absolute bottom-0 left-0 w-7 h-7 bg-[hsl(var(--primary))] text-white rounded-full flex items-center justify-center shadow-md hover:opacity-90 transition-opacity">
                <Upload size={13} />
              </button>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
            <button type="button" onClick={() => fileInputRef.current?.click()} className="text-xs text-[hsl(var(--primary))] font-semibold hover:underline">
              {form.avatar ? 'تغيير الصورة' : 'رفع صورة (اختياري)'}
            </button>
            {errors.avatar && <p className="text-red-500 text-xs">{errors.avatar}</p>}
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm font-semibold mb-1.5">الاسم الكامل *</label>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30 ${errors.name ? 'border-red-400' : 'border-[hsl(var(--border))]'}`} placeholder="الاسم الكامل للموظف" />
            {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name}</p>}
          </div>

          {/* Username */}
          <div>
            <label className="block text-sm font-semibold mb-1.5">اسم المستخدم (للدخول) *</label>
            <input type="text" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase().replace(/\s/g, '') })} className={`w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30 ${errors.username ? 'border-red-400' : 'border-[hsl(var(--border))]'}`} placeholder="مثال: ahmed.ali" dir="ltr" />
            {errors.username && <p className="text-red-500 text-xs mt-1">{errors.username}</p>}
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-semibold mb-1.5">{employee ? 'كلمة المرور الجديدة (اتركها فارغة للإبقاء على القديمة)' : 'كلمة المرور *'}</label>
            <div className="relative">
              <input type={showPassword ? 'text' : 'password'} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={`w-full border rounded-xl px-3 py-2.5 pl-10 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30 ${errors.password ? 'border-red-400' : 'border-[hsl(var(--border))]'}`} placeholder="••••••••" dir="ltr" />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password}</p>}
          </div>

          {/* Role & Status */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold mb-1.5">الدور الوظيفي *</label>
              <select value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })} className={`w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30 ${errors.roleId ? 'border-red-400' : 'border-[hsl(var(--border))]'}`}>
                {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              {errors.roleId && <p className="text-red-500 text-xs mt-1">{errors.roleId}</p>}
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1.5">الحالة</label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as 'active' | 'inactive' })} className="w-full border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30">
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
                <span className={`text-xs font-semibold ${roleColor.text}`}>صلاحيات هذا الدور: {selectedRole.permissions.length} صلاحية</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {selectedRole.permissions.slice(0, 5).map(pid => {
                  const perm = allPermissions.find(p => p.id === pid);
                  return perm ? <span key={pid} className={`text-[10px] px-2 py-0.5 rounded-full font-semibold bg-white ${roleColor.text}`}>{perm.label}</span> : null;
                })}
                {selectedRole.permissions.length > 5 && <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold bg-white ${roleColor.text}`}>+{selectedRole.permissions.length - 5} أخرى</span>}
              </div>
            </div>
          )}

          <p className="text-xs text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))]/50 rounded-xl px-3 py-2">
            ✅ سيتم إنشاء حساب الدخول فوراً — يمكن تسجيل الدخول باسم المستخدم وكلمة المرور بعد الحفظ مباشرةً
          </p>
        </div>
        <div className="flex gap-3 p-5 border-t border-[hsl(var(--border))]">
          <button onClick={() => { if (validate()) onSave(form); }} className="flex-1 flex items-center justify-center gap-2 bg-[hsl(var(--primary))] text-white rounded-xl py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity">
            <Save size={16} />حفظ وتفعيل
          </button>
          <button onClick={onClose} className="px-5 border border-[hsl(var(--border))] rounded-xl text-sm font-semibold hover:bg-[hsl(var(--muted))] transition-colors">إلغاء</button>
        </div>
      </div>
    </div>
  );
}

// ─── Sessions Panel ────────────────────────────────────────────────────────────
function SessionsPanel({ user, onClose }: { user: AppUser; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[hsl(var(--primary))] flex items-center justify-center text-white font-bold">{user.avatar}</div>
            <div>
              <h2 className="text-base font-bold">{user.name}</h2>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">سجل الدخول والخروج</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-[hsl(var(--muted))] rounded-xl transition-colors"><X size={18} /></button>
        </div>
        <div className="p-4 grid grid-cols-3 gap-3 border-b border-[hsl(var(--border))]">
          <div className="bg-green-50 rounded-xl p-3 text-center">
            <p className="text-xl font-bold text-green-700">{user.loginCount}</p>
            <p className="text-xs text-green-600 mt-0.5">مرات الدخول</p>
          </div>
          <div className="bg-red-50 rounded-xl p-3 text-center">
            <p className="text-xl font-bold text-red-700">{user.logoutCount}</p>
            <p className="text-xs text-red-600 mt-0.5">مرات الخروج</p>
          </div>
          <div className="bg-blue-50 rounded-xl p-3 text-center">
            <div className="flex items-center justify-center gap-1 text-blue-700">
              <DeviceIcon device={user.lastDevice} size={16} />
              <p className="text-sm font-bold">{user.lastDevice || '—'}</p>
            </div>
            <p className="text-xs text-blue-600 mt-0.5">آخر جهاز</p>
          </div>
        </div>
        <div className="overflow-y-auto flex-1">
          <table className="w-full text-sm" dir="rtl">
            <thead className="sticky top-0 bg-[hsl(var(--muted))]/80 backdrop-blur-sm">
              <tr className="text-[hsl(var(--muted-foreground))] text-xs">
                <th className="text-right px-4 py-3 font-semibold">النوع</th>
                <th className="text-right px-4 py-3 font-semibold">الجهاز</th>
                <th className="text-right px-4 py-3 font-semibold">اليوم</th>
                <th className="text-right px-4 py-3 font-semibold">التاريخ</th>
                <th className="text-right px-4 py-3 font-semibold">الوقت</th>
              </tr>
            </thead>
            <tbody>
              {user.sessions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).map(s => (
                <tr key={s.id} className="border-t border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/30 transition-colors">
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-semibold ${s.type === 'login' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                      {s.type === 'login' ? <LogIn size={11} /> : <LogOut size={11} />}
                      {s.type === 'login' ? 'دخول' : 'خروج'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 text-xs text-[hsl(var(--foreground))]">
                      <DeviceIcon device={s.device} size={13} />
                      {s.device}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-[hsl(var(--muted-foreground))]">{s.day}</td>
                  <td className="px-4 py-3 text-xs text-[hsl(var(--foreground))]">{s.date}</td>
                  <td className="px-4 py-3 text-xs font-mono text-[hsl(var(--foreground))]" dir="ltr">{s.time}</td>
                </tr>
              ))}
              {user.sessions.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-[hsl(var(--muted-foreground))] text-sm">لا يوجد سجل جلسات</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── User Permissions Panel (inline) ──────────────────────────────────────────
function UserPermissionsPanel({ user, role }: { user: AppUser; role: Role | undefined }) {
  if (!role) return <div className="px-6 py-3 text-xs text-[hsl(var(--muted-foreground))]">لا يوجد دور محدد</div>;
  const colors = colorMap[role.color] || colorMap.blue;
  const grouped = permGroups.map(g => ({
    group: g,
    perms: allPermissions.filter(p => p.group === g),
  }));
  return (
    <div className="px-6 py-4 bg-[hsl(var(--muted))]/20">
      <div className="flex items-center gap-2 mb-3">
        <ShieldCheck size={14} className={colors.text} />
        <span className="text-xs font-bold text-[hsl(var(--foreground))]">صلاحيات دور "{role.name}" المطبقة على هذا المستخدم</span>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${colors.bg} ${colors.text}`}>{role.permissions.length} صلاحية</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {grouped.map(({ group, perms }) => (
          <div key={group} className="bg-white rounded-xl border border-[hsl(var(--border))] p-2.5">
            <p className="text-[10px] font-bold text-[hsl(var(--muted-foreground))] mb-1.5 uppercase tracking-wide">{group}</p>
            <div className="space-y-1">
              {perms.map(perm => {
                const has = role.permissions.includes(perm.id);
                return (
                  <div key={perm.id} className={`flex items-center gap-1.5 text-[10px] ${has ? 'text-[hsl(var(--foreground))]' : 'text-gray-300'}`}>
                    {has ? <Unlock size={9} className={colors.text} /> : <Lock size={9} className="text-gray-300" />}
                    <span className={has ? 'font-semibold' : ''}>{perm.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>(initialRoles);

  // Load employees from localStorage on mount (persisted data takes priority)
  // Also restore avatars from separate storage
  const [employees, setEmployees] = useState<Employee[]>(() => {
    const loaded = loadFromStorage<Employee>(LS_EMPLOYEES, defaultEmployees);
    // Restore avatars from separate key
    if (typeof window !== 'undefined') {
      const avatars = loadAvatars();
      return loaded.map(e => ({ ...e, avatar: avatars[e.id] || '' }));
    }
    return loaded;
  });

  // Load users from localStorage on mount
  const [appUsers, setAppUsers] = useState<AppUser[]>(() => loadFromStorage<AppUser>(LS_USERS, defaultUsers));

  // On first mount: ensure default employees are persisted so login page can find them
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = localStorage.getItem(LS_EMPLOYEES);
    if (!stored || stored === '[]') {
      saveEmployeesToStorage(defaultEmployees);
    }
  }, []);

  const [editRole, setEditRole] = useState<Role | null | undefined>(undefined);
  // unified modal: undefined = closed, null = new, Employee = edit
  const [editMember, setEditMember] = useState<Employee | null | undefined>(undefined);
  const [viewSessionsUser, setViewSessionsUser] = useState<AppUser | null>(null);
  const [activeTab, setActiveTab] = useState<'roles' | 'employees' | 'users'>('roles');
  const [showPasswords, setShowPasswords] = useState<Set<string>>(new Set());
  const [userSearch, setUserSearch] = useState('');
  const [userFilter, setUserFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [expandedUserPerms, setExpandedUserPerms] = useState<string | null>(null);

  const handleSaveRole = (role: Role) => {
    setRoles(prev => { const exists = prev.find(r => r.id === role.id); if (exists) return prev.map(r => r.id === role.id ? role : r); return [...prev, role]; });
    setEditRole(undefined);
  };

  // Unified save: persists employee for login AND syncs AppUser for the users tab
  const handleSaveMember = (emp: Employee) => {
    // Save avatar separately if present
    if (emp.avatar) {
      saveAvatar(emp.id, emp.avatar);
    } else {
      removeAvatar(emp.id);
    }

    setEmployees(prev => {
      const exists = prev.find(e => e.id === emp.id);
      const finalEmp = exists
        ? prev.map(e => e.id === emp.id ? (emp.password ? emp : { ...emp, password: e.password }) : e)
        : [...prev, emp];
      saveEmployeesToStorage(finalEmp);
      return finalEmp;
    });

    // Sync AppUser: update existing or create new
    setAppUsers(prev => {
      const existingUser = prev.find(u => {
        // Match by linked employee id stored in email field as fallback, or by name
        return u.email === `emp:${emp.id}` || (u.name === emp.name && u.email.startsWith('emp:'));
      });

      let updatedUsers: AppUser[];
      if (existingUser) {
        // Update existing user record
        updatedUsers = prev.map(u =>
          u.id === existingUser.id
            ? { ...u, name: emp.name, roleId: emp.roleId, status: emp.status, avatar: emp.name.trim().charAt(0) || '؟' }
            : u
        );
      } else {
        // Check if there's a user with same name (pre-existing default user)
        const matchByName = prev.find(u => u.name === emp.name);
        if (matchByName) {
          updatedUsers = prev.map(u =>
            u.id === matchByName.id
              ? { ...u, roleId: emp.roleId, status: emp.status }
              : u
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

    setEditMember(undefined);
  };

  const toggleShowPassword = (id: string) => {
    setShowPasswords(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  const getRoleName = (roleId: string) => roles.find(r => r.id === roleId)?.name || '—';
  const getRoleById = (roleId: string) => roles.find(r => r.id === roleId);
  const getRoleColors = (roleId: string) => { const role = roles.find(r => r.id === roleId); return colorMap[role?.color || 'blue'] || colorMap.blue; };

  const filteredUsers = appUsers.filter(u => {
    const roleName = getRoleName(u.roleId);
    const displayEmail = u.email.startsWith('emp:') ? '' : u.email;
    const matchSearch = u.name.includes(userSearch) || displayEmail.includes(userSearch) || roleName.includes(userSearch);
    const matchStatus = userFilter === 'all' || u.status === userFilter;
    return matchSearch && matchStatus;
  });

  const activeUsersCount = appUsers.filter(u => u.status === 'active').length;

  return (
    <AppLayout currentPath="/roles">
      <div className="space-y-6 fade-in" dir="rtl">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">المستخدمون والأدوار والصلاحيات</h1>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">إدارة موحدة للمستخدمين والأدوار وتفعيل الصلاحيات على كل مستخدم</p>
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
            <p className="text-2xl font-bold text-green-600">{employees.filter(e => e.status === 'active').length}</p>
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
            { key: 'employees', label: `الموظفون (${employees.length})`, icon: <UserPlus size={15} /> },
            { key: 'users', label: `المستخدمون (${appUsers.length})`, icon: <Users size={15} /> },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as 'roles' | 'employees' | 'users')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === tab.key ? 'bg-white text-[hsl(var(--primary))] shadow-sm' : 'text-[hsl(var(--muted-foreground))]'}`}
            >
              {tab.icon}{tab.label}
            </button>
          ))}
        </div>

        {/* ── Roles Tab ── */}
        {activeTab === 'roles' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
            {roles.map(role => {
              const colors = colorMap[role.color] || colorMap.blue;
              const roleEmployees = employees.filter(e => e.roleId === role.id);
              const roleUsers = appUsers.filter(u => u.roleId === role.id);
              return (
                <div key={role.id} className={`card-section p-5 border-2 ${colors.border} hover:shadow-md transition-shadow`}>
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-11 h-11 rounded-xl ${colors.bg} ${colors.text} flex items-center justify-center`}><ShieldCheck size={22} /></div>
                      <div>
                        <p className="font-bold text-[hsl(var(--foreground))]">{role.name}</p>
                        <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">{roleEmployees.length + roleUsers.length} مستخدم</p>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => setEditRole(role)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))] transition-colors"><Edit2 size={14} /></button>
                      <button onClick={() => setRoles(prev => prev.filter(r => r.id !== role.id))} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-red-500 transition-colors"><Trash2 size={14} /></button>
                    </div>
                  </div>
                  <p className="text-xs text-[hsl(var(--muted-foreground))] mb-3">{role.description}</p>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {role.permissions.slice(0, 3).map(p => { const perm = allPermissions.find(ap => ap.id === p); return perm ? <span key={p} className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${colors.bg} ${colors.text}`}>{perm.label}</span> : null; })}
                    {role.permissions.length > 3 && <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${colors.bg} ${colors.text}`}>+{role.permissions.length - 3} أخرى</span>}
                    {role.permissions.length === 0 && <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-gray-100 text-gray-500">لا توجد صلاحيات</span>}
                  </div>
                  {roleEmployees.length > 0 && (
                    <div className="flex -space-x-2 space-x-reverse mb-3">
                      {roleEmployees.slice(0, 4).map(emp => (
                        <div key={emp.id} className={`w-7 h-7 rounded-full border-2 border-white overflow-hidden flex items-center justify-center text-white text-xs font-bold ${colors.avatar}`}>
                          {emp.avatar ? <img src={emp.avatar} alt={emp.name} className="w-full h-full object-cover" /> : <span>{emp.name.charAt(0)}</span>}
                        </div>
                      ))}
                      {roleEmployees.length > 4 && <div className="w-7 h-7 rounded-full border-2 border-white bg-gray-200 flex items-center justify-center text-gray-600 text-xs font-bold">+{roleEmployees.length - 4}</div>}
                    </div>
                  )}
                  <button onClick={() => setEditRole(role)} className={`w-full flex items-center justify-center gap-1.5 text-xs py-2 rounded-xl border ${colors.border} ${colors.text} transition-colors font-semibold`}>
                    <ShieldCheck size={13} />تعديل الصلاحيات
                  </button>
                </div>
              );
            })}
            <button onClick={() => setEditRole(null)} className="card-section p-5 border-2 border-dashed border-[hsl(var(--border))] hover:border-[hsl(var(--primary))]/50 hover:bg-[hsl(var(--primary))]/5 transition-all flex flex-col items-center justify-center gap-3 min-h-[180px] group">
              <div className="w-11 h-11 rounded-xl bg-[hsl(var(--muted))] group-hover:bg-[hsl(var(--primary))]/10 flex items-center justify-center transition-colors">
                <Plus size={22} className="text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--primary))]" />
              </div>
              <p className="text-sm font-semibold text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--primary))] transition-colors">إضافة دور جديد</p>
            </button>
          </div>
        )}

        {/* ── Employees Tab ── */}
        {activeTab === 'employees' && (
          <div className="card-section overflow-hidden">
            <div className="p-4 border-b border-[hsl(var(--border))]">
              <p className="text-sm font-semibold">قائمة الموظفين وبيانات الدخول</p>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">يمكنك عرض وتعديل بيانات كل موظف وصورته الشخصية</p>
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
                  {employees.map(emp => {
                    const rc = getRoleColors(emp.roleId);
                    const empRole = getRoleById(emp.roleId);
                    const isShowingPass = showPasswords.has(emp.id);
                    return (
                      <tr key={emp.id} className="border-t border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/30 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className={`w-9 h-9 rounded-full overflow-hidden flex items-center justify-center text-white text-sm font-bold flex-shrink-0 ${emp.avatar ? '' : rc.avatar}`}>
                              {emp.avatar ? <img src={emp.avatar} alt={emp.name} className="w-full h-full object-cover" /> : <span>{emp.name.charAt(0)}</span>}
                            </div>
                            <span className="font-semibold">{emp.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3"><div className="flex items-center gap-1.5"><Key size={13} className="text-[hsl(var(--muted-foreground))]" /><span className="font-mono text-xs bg-[hsl(var(--muted))] px-2 py-1 rounded-lg">{emp.username}</span></div></td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-xs bg-[hsl(var(--muted))] px-2 py-1 rounded-lg">{isShowingPass ? emp.password : '••••••••'}</span>
                            <button onClick={() => toggleShowPassword(emp.id)} className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">
                              {isShowingPass ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                          </div>
                        </td>
                        <td className="px-4 py-3"><span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${rc.bg} ${rc.text}`}>{getRoleName(emp.roleId)}</span></td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${rc.bg} ${rc.text}`}>
                            {empRole ? `${empRole.permissions.length} صلاحية` : '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3"><span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${emp.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{emp.status === 'active' ? 'نشط' : 'غير نشط'}</span></td>
                        <td className="px-4 py-3 text-xs text-[hsl(var(--muted-foreground))]">{emp.createdAt}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            <button onClick={() => setEditMember(emp)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))] transition-colors"><Edit2 size={14} /></button>
                            <button onClick={() => {
                              const updated = employees.filter(e => e.id !== emp.id);
                              setEmployees(updated);
                              saveEmployeesToStorage(updated);
                              // Also remove linked user
                              setAppUsers(prev => {
                                let updatedUsers = prev.filter(u => u.email !== `emp:${emp.id}`);
                                saveUsersToStorage(updatedUsers);
                                return updatedUsers;
                              });
                            }} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-red-500 transition-colors"><Trash2 size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {employees.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-[hsl(var(--muted-foreground))] text-sm">لا يوجد موظفون</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Users Tab ── */}
        {activeTab === 'users' && (
          <div className="space-y-4">
            {/* KPIs */}
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
              {[
                { label: 'إجمالي المستخدمين', value: appUsers.length, icon: <Users size={20} />, color: 'blue' },
                { label: 'نشطون', value: activeUsersCount, icon: <CheckCircle size={20} />, color: 'green' },
                { label: 'غير نشطين', value: appUsers.length - activeUsersCount, icon: <XCircle size={20} />, color: 'red' },
                { label: 'إجمالي الدخول', value: appUsers.reduce((s, u) => s + u.loginCount, 0), icon: <LogIn size={20} />, color: 'purple' },
              ].map((card, i) => (
                <div key={i} className="kpi-card">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${card.color === 'blue' ? 'bg-blue-50 text-blue-600' : card.color === 'green' ? 'bg-green-50 text-green-600' : card.color === 'red' ? 'bg-red-50 text-red-600' : 'bg-purple-50 text-purple-600'}`}>{card.icon}</div>
                  <p className="text-xs text-[hsl(var(--muted-foreground))] mb-1">{card.label}</p>
                  <p className="text-2xl font-bold text-[hsl(var(--foreground))] font-mono">{card.value}</p>
                </div>
              ))}
            </div>

            {/* Search & Filter */}
            <div className="card-section p-4 flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
                <input type="text" placeholder="بحث بالاسم أو الدور..." value={userSearch} onChange={(e) => setUserSearch(e.target.value)} className="w-full pr-9 pl-4 py-2.5 border border-[hsl(var(--border))] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30" />
              </div>
              <div className="flex bg-[hsl(var(--muted))] rounded-xl p-1 gap-1">
                {[{ key: 'all', label: 'الكل' }, { key: 'active', label: 'نشط' }, { key: 'inactive', label: 'غير نشط' }].map(opt => (
                  <button key={opt.key} onClick={() => setUserFilter(opt.key as 'all' | 'active' | 'inactive')} className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-all ${userFilter === opt.key ? 'bg-white text-[hsl(var(--primary))] shadow-sm' : 'text-[hsl(var(--muted-foreground))]'}`}>{opt.label}</button>
                ))}
              </div>
            </div>

            {/* Users Table */}
            <div className="card-section overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm" dir="rtl">
                  <thead>
                    <tr className="bg-[hsl(var(--muted))]/50 text-[hsl(var(--muted-foreground))] text-xs">
                      <th className="text-right px-4 py-3 font-semibold">المستخدم</th>
                      <th className="text-right px-4 py-3 font-semibold">الدور والصلاحيات</th>
                      <th className="text-right px-4 py-3 font-semibold">الجهاز</th>
                      <th className="text-right px-4 py-3 font-semibold">مرات الدخول</th>
                      <th className="text-right px-4 py-3 font-semibold">مرات الخروج</th>
                      <th className="text-right px-4 py-3 font-semibold">آخر دخول</th>
                      <th className="text-right px-4 py-3 font-semibold">الحالة</th>
                      <th className="text-right px-4 py-3 font-semibold">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map(user => {
                      const userRole = getRoleById(user.roleId);
                      const rc = getRoleColors(user.roleId);
                      const lastSession = user.sessions.length > 0
                        ? user.sessions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0]
                        : null;
                      const isExpanded = expandedUser === user.id;
                      const isPermsExpanded = expandedUserPerms === user.id;
                      const displayEmail = user.email.startsWith('emp:') ? '' : user.email;
                      return (
                        <React.Fragment key={user.id}>
                          <tr className="border-t border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/30 transition-colors">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0 ${rc.avatar}`}>{user.avatar}</div>
                                <div>
                                  <p className="font-semibold text-[hsl(var(--foreground))]">{user.name}</p>
                                  {displayEmail && <p className="text-xs text-[hsl(var(--muted-foreground))]" dir="ltr">{displayEmail}</p>}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-col gap-1">
                                <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${rc.bg} ${rc.text}`}>{getRoleName(user.roleId)}</span>
                                {userRole && (
                                  <button
                                    onClick={() => setExpandedUserPerms(isPermsExpanded ? null : user.id)}
                                    className={`flex items-center gap-1 text-[10px] font-semibold transition-colors w-fit ${isPermsExpanded ? rc.text : 'text-[hsl(var(--muted-foreground))]'}`}
                                  >
                                    <ShieldCheck size={10} />
                                    {userRole.permissions.length} صلاحية
                                    {isPermsExpanded ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <span className="inline-flex items-center gap-1.5 text-xs text-[hsl(var(--foreground))] bg-[hsl(var(--muted))] px-2.5 py-1 rounded-lg">
                                <DeviceIcon device={user.lastDevice} size={13} />
                                {user.lastDevice || '—'}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span className="inline-flex items-center gap-1 text-xs font-bold text-green-700 bg-green-50 px-2.5 py-1 rounded-lg">
                                <LogIn size={12} />{user.loginCount}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span className="inline-flex items-center gap-1 text-xs font-bold text-red-700 bg-red-50 px-2.5 py-1 rounded-lg">
                                <LogOut size={12} />{user.logoutCount}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              {lastSession ? (
                                <div className="text-xs">
                                  <div className="flex items-center gap-1 text-[hsl(var(--foreground))]"><Calendar size={11} className="text-[hsl(var(--muted-foreground))]" />{lastSession.date}</div>
                                  <div className="flex items-center gap-1 text-[hsl(var(--muted-foreground))] mt-0.5"><Clock size={11} /><span dir="ltr">{lastSession.time}</span><span className="mr-1">({lastSession.day})</span></div>
                                </div>
                              ) : <span className="text-xs text-[hsl(var(--muted-foreground))]">—</span>}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${user.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                {user.status === 'active' ? 'نشط' : 'غير نشط'}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex gap-1">
                                <button onClick={() => setExpandedUser(isExpanded ? null : user.id)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-blue-50 text-blue-600 transition-colors" title="عرض السجل">
                                  {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                </button>
                                <button onClick={() => setViewSessionsUser(user)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))] transition-colors" title="سجل الجلسات الكامل">
                                  <Clock size={14} />
                                </button>
                                <button onClick={() => {
                                  // Find linked employee and open unified modal
                                  const linkedEmp = employees.find(e => `emp:${e.id}` === user.email || e.name === user.name);
                                  if (linkedEmp) setEditMember(linkedEmp);
                                }} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))] transition-colors" title="تعديل"><Edit2 size={14} /></button>
                                <button onClick={() => {
                                  let updatedUsers = appUsers.filter(u => u.id !== user.id);
                                  setAppUsers(updatedUsers);
                                  saveUsersToStorage(updatedUsers);
                                }} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-red-500 transition-colors" title="حذف"><Trash2 size={14} /></button>
                              </div>
                            </td>
                          </tr>
                          {/* Permissions panel */}
                          {isPermsExpanded && (
                            <tr className="border-t border-[hsl(var(--border))]">
                              <td colSpan={8} className="p-0">
                                <UserPermissionsPanel user={user} role={userRole} />
                              </td>
                            </tr>
                          )}
                          {/* Inline sessions preview */}
                          {isExpanded && (
                            <tr className="bg-[hsl(var(--muted))]/20 border-t border-[hsl(var(--border))]">
                              <td colSpan={8} className="px-6 py-3">
                                <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))] mb-2">آخر 5 جلسات:</p>
                                {user.sessions.length === 0 ? (
                                  <p className="text-xs text-[hsl(var(--muted-foreground))]">لا يوجد سجل جلسات بعد</p>
                                ) : (
                                  <div className="flex flex-wrap gap-2">
                                    {user.sessions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 5).map(s => (
                                      <div key={s.id} className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-xl border ${s.type === 'login' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                                        {s.type === 'login' ? <LogIn size={11} /> : <LogOut size={11} />}
                                        <DeviceIcon device={s.device} size={11} />
                                        <span>{s.device}</span>
                                        <span className="text-[hsl(var(--muted-foreground))]">·</span>
                                        <span>{s.day}</span>
                                        <span className="text-[hsl(var(--muted-foreground))]">·</span>
                                        <span>{s.date}</span>
                                        <span className="text-[hsl(var(--muted-foreground))]">·</span>
                                        <span dir="ltr">{s.time}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                    {filteredUsers.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-[hsl(var(--muted-foreground))] text-sm">لا يوجد مستخدمون مطابقون</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {editRole !== undefined && <RoleModal role={editRole} onClose={() => setEditRole(undefined)} onSave={handleSaveRole} />}
      {editMember !== undefined && <UnifiedMemberModal employee={editMember} roles={roles} onClose={() => setEditMember(undefined)} onSave={handleSaveMember} />}
      {viewSessionsUser && <SessionsPanel user={viewSessionsUser} onClose={() => setViewSessionsUser(null)} />}
    </AppLayout>
  );
}
