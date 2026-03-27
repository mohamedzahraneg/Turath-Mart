'use client';
import React, { useState } from 'react';
import AppLayout from '@/components/AppLayout';
import { ShieldCheck, Plus, Edit2, Trash2, X, Save, Check, Users, Eye, EyeOff, Key, UserPlus } from 'lucide-react';

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
}

const allPermissions: Permission[] = [
  { id: 'view_dashboard', label: 'عرض لوحة التحكم', group: 'لوحة التحكم' },
  { id: 'view_orders', label: 'عرض الأوردرات', group: 'الأوردرات' },
  { id: 'create_orders', label: 'إنشاء أوردرات', group: 'الأوردرات' },
  { id: 'edit_orders', label: 'تعديل الأوردرات', group: 'الأوردرات' },
  { id: 'delete_orders', label: 'حذف الأوردرات', group: 'الأوردرات' },
  { id: 'update_status', label: 'تحديث حالة الأوردر', group: 'الأوردرات' },
  { id: 'view_inventory', label: 'عرض المخزون', group: 'المخزون' },
  { id: 'edit_inventory', label: 'تعديل المخزون', group: 'المخزون' },
  { id: 'view_reports', label: 'عرض التقارير', group: 'التقارير' },
  { id: 'export_reports', label: 'تصدير التقارير', group: 'التقارير' },
  { id: 'manage_users', label: 'إدارة المستخدمين', group: 'المستخدمون' },
  { id: 'manage_roles', label: 'إدارة الصلاحيات', group: 'المستخدمون' },
  { id: 'system_settings', label: 'إعدادات النظام', group: 'الإعدادات' },
];

const permGroups = ['لوحة التحكم', 'الأوردرات', 'المخزون', 'التقارير', 'المستخدمون', 'الإعدادات'];

const initialRoles: Role[] = [
  {
    id: 'r1', name: 'مدير النظام', description: 'صلاحيات كاملة على جميع أقسام النظام', color: 'purple',
    permissions: allPermissions.map(p => p.id), usersCount: 1,
  },
  {
    id: 'r2', name: 'مشرف شحن', description: 'إدارة الأوردرات والشحن وتحديث الحالات', color: 'blue',
    permissions: ['view_dashboard', 'view_orders', 'create_orders', 'edit_orders', 'update_status', 'view_inventory', 'view_reports'], usersCount: 2,
  },
  {
    id: 'r3', name: 'موظف مبيعات', description: 'إنشاء وعرض الأوردرات فقط', color: 'green',
    permissions: ['view_dashboard', 'view_orders', 'create_orders', 'update_status'], usersCount: 2,
  },
  {
    id: 'r4', name: 'موظف مخزون', description: 'إدارة المخزون والأصناف', color: 'amber',
    permissions: ['view_dashboard', 'view_inventory', 'edit_inventory', 'view_orders'], usersCount: 1,
  },
  {
    id: 'r5', name: 'محاسب', description: 'عرض التقارير المالية وتصديرها', color: 'orange',
    permissions: ['view_dashboard', 'view_reports', 'export_reports', 'view_orders'], usersCount: 0,
  },
];

const initialEmployees: Employee[] = [
  { id: 'e1', name: 'محمد الزهراني', username: 'admin', password: 'Admin@123', roleId: 'r1', status: 'active', createdAt: '01/01/2026' },
  { id: 'e2', name: 'أحمد علي', username: 'ahmed.ali', password: 'Ahmed@2026', roleId: 'r2', status: 'active', createdAt: '15/01/2026' },
  { id: 'e3', name: 'سارة محمود', username: 'sara.m', password: 'Sara@2026', roleId: 'r3', status: 'active', createdAt: '20/01/2026' },
];

const colorMap: Record<string, { bg: string; text: string; border: string }> = {
  purple: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  blue: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  green: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
  amber: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  orange: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
};

interface RoleModalProps {
  role: Role | null;
  onClose: () => void;
  onSave: (role: Role) => void;
}

function RoleModal({ role, onClose, onSave }: RoleModalProps) {
  const [form, setForm] = useState<Role>(
    role || { id: `r${Date.now()}`, name: '', description: '', color: 'blue', permissions: [], usersCount: 0 }
  );

  const togglePerm = (id: string) => {
    setForm(prev => ({
      ...prev,
      permissions: prev.permissions.includes(id)
        ? prev.permissions.filter(p => p !== id)
        : [...prev.permissions, id],
    }));
  };

  const toggleGroup = (group: string) => {
    const groupPerms = allPermissions.filter(p => p.group === group).map(p => p.id);
    const allSelected = groupPerms.every(p => form.permissions.includes(p));
    setForm(prev => ({
      ...prev,
      permissions: allSelected
        ? prev.permissions.filter(p => !groupPerms.includes(p))
        : [...new Set([...prev.permissions, ...groupPerms])],
    }));
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-[hsl(var(--border))]">
          <h2 className="text-lg font-bold">{role ? 'تعديل دور' : 'إضافة دور جديد'}</h2>
          <button onClick={onClose} className="p-2 hover:bg-[hsl(var(--muted))] rounded-xl transition-colors">
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
                    <button
                      onClick={() => toggleGroup(group)}
                      className="w-full flex items-center justify-between px-4 py-2.5 bg-[hsl(var(--muted))]/50 hover:bg-[hsl(var(--muted))] transition-colors"
                    >
                      <span className="text-sm font-semibold">{group}</span>
                      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${allSelected ? 'bg-[hsl(var(--primary))] border-[hsl(var(--primary))]' : 'border-gray-300'}`}>
                        {allSelected && <Check size={12} className="text-white" />}
                      </div>
                    </button>
                    <div className="p-3 grid grid-cols-2 gap-2">
                      {groupPerms.map(perm => (
                        <button
                          key={perm.id}
                          onClick={() => togglePerm(perm.id)}
                          className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg border transition-all text-right ${
                            form.permissions.includes(perm.id)
                              ? 'bg-[hsl(var(--primary))]/10 border-[hsl(var(--primary))]/30 text-[hsl(var(--primary))]'
                              : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'
                          }`}
                        >
                          <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${form.permissions.includes(perm.id) ? 'bg-[hsl(var(--primary))] border-[hsl(var(--primary))]' : 'border-gray-300'}`}>
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
          <button
            onClick={() => onSave(form)}
            className="flex-1 flex items-center justify-center gap-2 bg-[hsl(var(--primary))] text-white rounded-xl py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            <Save size={16} />
            حفظ
          </button>
          <button onClick={onClose} className="px-5 border border-[hsl(var(--border))] rounded-xl text-sm font-semibold hover:bg-[hsl(var(--muted))] transition-colors">
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}

interface EmployeeModalProps {
  employee: Employee | null;
  roles: Role[];
  onClose: () => void;
  onSave: (emp: Employee) => void;
}

function EmployeeModal({ employee, roles, onClose, onSave }: EmployeeModalProps) {
  const [form, setForm] = useState<Employee>(
    employee || {
      id: `e${Date.now()}`,
      name: '',
      username: '',
      password: '',
      roleId: roles[0]?.id || '',
      status: 'active',
      createdAt: new Date().toLocaleDateString('en-GB'),
    }
  );
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

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

  const handleSave = () => {
    if (validate()) onSave(form);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-2">
            <UserPlus size={20} className="text-[hsl(var(--primary))]" />
            <h2 className="text-lg font-bold">{employee ? 'تعديل موظف' : 'إضافة موظف جديد'}</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-[hsl(var(--muted))] rounded-xl transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4">
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

          <div>
            <label className="block text-sm font-semibold mb-1.5">اسم المستخدم *</label>
            <input
              type="text"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase().replace(/\s/g, '') })}
              className={`w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30 ${errors.username ? 'border-red-400' : 'border-[hsl(var(--border))]'}`}
              placeholder="مثال: ahmed.ali"
              dir="ltr"
            />
            {errors.username && <p className="text-red-500 text-xs mt-1">{errors.username}</p>}
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1.5">
              {employee ? 'كلمة المرور الجديدة (اتركها فارغة للإبقاء على القديمة)' : 'كلمة المرور *'}
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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold mb-1.5">الدور الوظيفي *</label>
              <select
                value={form.roleId}
                onChange={(e) => setForm({ ...form, roleId: e.target.value })}
                className={`w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30 ${errors.roleId ? 'border-red-400' : 'border-[hsl(var(--border))]'}`}
              >
                {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              {errors.roleId && <p className="text-red-500 text-xs mt-1">{errors.roleId}</p>}
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1.5">الحالة</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as 'active' | 'inactive' })}
                className="w-full border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
              >
                <option value="active">نشط</option>
                <option value="inactive">غير نشط</option>
              </select>
            </div>
          </div>
        </div>
        <div className="flex gap-3 p-5 border-t border-[hsl(var(--border))]">
          <button
            onClick={handleSave}
            className="flex-1 flex items-center justify-center gap-2 bg-[hsl(var(--primary))] text-white rounded-xl py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            <Save size={16} />
            حفظ
          </button>
          <button onClick={onClose} className="px-5 border border-[hsl(var(--border))] rounded-xl text-sm font-semibold hover:bg-[hsl(var(--muted))] transition-colors">
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>(initialRoles);
  const [employees, setEmployees] = useState<Employee[]>(initialEmployees);
  const [editRole, setEditRole] = useState<Role | null | undefined>(undefined);
  const [editEmployee, setEditEmployee] = useState<Employee | null | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<'roles' | 'employees'>('roles');
  const [showPasswords, setShowPasswords] = useState<Set<string>>(new Set());

  const handleSaveRole = (role: Role) => {
    setRoles(prev => {
      const exists = prev.find(r => r.id === role.id);
      if (exists) return prev.map(r => r.id === role.id ? role : r);
      return [...prev, role];
    });
    setEditRole(undefined);
  };

  const handleDeleteRole = (id: string) => {
    setRoles(prev => prev.filter(r => r.id !== id));
  };

  const handleSaveEmployee = (emp: Employee) => {
    setEmployees(prev => {
      const exists = prev.find(e => e.id === emp.id);
      if (exists) return prev.map(e => e.id === emp.id ? (emp.password ? emp : { ...emp, password: e.password }) : e);
      return [...prev, emp];
    });
    // Update role usersCount
    setRoles(prev => prev.map(r => ({
      ...r,
      usersCount: employees.filter(e => e.roleId === r.id).length + (emp.roleId === r.id && !employees.find(e => e.id === emp.id) ? 1 : 0),
    })));
    setEditEmployee(undefined);
  };

  const handleDeleteEmployee = (id: string) => {
    setEmployees(prev => prev.filter(e => e.id !== id));
  };

  const toggleShowPassword = (id: string) => {
    setShowPasswords(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const getRoleName = (roleId: string) => roles.find(r => r.id === roleId)?.name || '—';
  const getRoleColor = (roleId: string) => {
    const role = roles.find(r => r.id === roleId);
    return colorMap[role?.color] || colorMap.blue;
  };

  return (
    <AppLayout currentPath="/roles">
      <div className="space-y-6 fade-in">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">الأدوار والموظفون</h1>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">إدارة أدوار المستخدمين وإضافة الموظفين بصلاحياتهم</p>
          </div>
          <button
            onClick={() => activeTab === 'roles' ? setEditRole(null) : setEditEmployee(null)}
            className="flex items-center gap-2 px-4 py-2.5 bg-[hsl(var(--primary))] text-white rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            <Plus size={18} />
            {activeTab === 'roles' ? 'إضافة دور' : 'إضافة موظف'}
          </button>
        </div>

        {/* Tabs */}
        <div className="flex bg-[hsl(var(--muted))] rounded-xl p-1 gap-1 w-fit">
          <button
            onClick={() => setActiveTab('roles')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === 'roles' ? 'bg-white text-[hsl(var(--primary))] shadow-sm' : 'text-[hsl(var(--muted-foreground))]'}`}
          >
            <ShieldCheck size={16} />
            الأدوار ({roles.length})
          </button>
          <button
            onClick={() => setActiveTab('employees')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === 'employees' ? 'bg-white text-[hsl(var(--primary))] shadow-sm' : 'text-[hsl(var(--muted-foreground))]'}`}
          >
            <Users size={16} />
            الموظفون ({employees.length})
          </button>
        </div>

        {/* Roles Tab */}
        {activeTab === 'roles' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
            {roles.map(role => {
              const colors = colorMap[role.color] || colorMap.blue;
              const roleEmployees = employees.filter(e => e.roleId === role.id);
              return (
                <div key={role.id} className={`card-section p-5 border-2 ${colors.border} hover:shadow-md transition-shadow`}>
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-11 h-11 rounded-xl ${colors.bg} ${colors.text} flex items-center justify-center`}>
                        <ShieldCheck size={22} />
                      </div>
                      <div>
                        <p className="font-bold text-[hsl(var(--foreground))]">{role.name}</p>
                        <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">{roleEmployees.length} موظف</p>
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
                        onClick={() => handleDeleteRole(role.id)}
                        className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-red-500 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-[hsl(var(--muted-foreground))] mb-3">{role.description}</p>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {role.permissions.slice(0, 4).map(p => {
                      const perm = allPermissions.find(ap => ap.id === p);
                      return perm ? (
                        <span key={p} className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${colors.bg} ${colors.text}`}>
                          {perm.label}
                        </span>
                      ) : null;
                    })}
                    {role.permissions.length > 4 && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${colors.bg} ${colors.text}`}>
                        +{role.permissions.length - 4} أخرى
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => { setActiveTab('employees'); setEditEmployee(null); }}
                    className={`w-full flex items-center justify-center gap-1.5 text-xs py-2 rounded-xl border ${colors.border} ${colors.text} hover:${colors.bg} transition-colors`}
                  >
                    <UserPlus size={13} />
                    إضافة موظف لهذا الدور
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Employees Tab */}
        {activeTab === 'employees' && (
          <div className="card-section overflow-hidden">
            <div className="p-4 border-b border-[hsl(var(--border))]">
              <p className="text-sm font-semibold text-[hsl(var(--foreground))]">قائمة الموظفين وبيانات الدخول</p>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">يمكنك عرض وتعديل اسم المستخدم وكلمة المرور لكل موظف</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" dir="rtl">
                <thead>
                  <tr className="bg-[hsl(var(--muted))]/50 text-[hsl(var(--muted-foreground))] text-xs">
                    <th className="text-right px-4 py-3 font-semibold">الموظف</th>
                    <th className="text-right px-4 py-3 font-semibold">اسم المستخدم</th>
                    <th className="text-right px-4 py-3 font-semibold">كلمة المرور</th>
                    <th className="text-right px-4 py-3 font-semibold">الدور</th>
                    <th className="text-right px-4 py-3 font-semibold">الحالة</th>
                    <th className="text-right px-4 py-3 font-semibold">تاريخ الإنشاء</th>
                    <th className="text-right px-4 py-3 font-semibold">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map(emp => {
                    const roleColors = getRoleColor(emp.roleId);
                    const isShowingPass = showPasswords.has(emp.id);
                    return (
                      <tr key={emp.id} className="border-t border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/30 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-[hsl(var(--primary))] flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                              {emp.name.charAt(0)}
                            </div>
                            <span className="font-semibold">{emp.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <Key size={13} className="text-[hsl(var(--muted-foreground))]" />
                            <span className="font-mono text-xs bg-[hsl(var(--muted))] px-2 py-1 rounded-lg">{emp.username}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-xs bg-[hsl(var(--muted))] px-2 py-1 rounded-lg">
                              {isShowingPass ? emp.password : '••••••••'}
                            </span>
                            <button
                              onClick={() => toggleShowPassword(emp.id)}
                              className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
                            >
                              {isShowingPass ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${roleColors.bg} ${roleColors.text}`}>
                            {getRoleName(emp.roleId)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${emp.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                            {emp.status === 'active' ? 'نشط' : 'غير نشط'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-[hsl(var(--muted-foreground))]">{emp.createdAt}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            <button
                              onClick={() => setEditEmployee(emp)}
                              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))] transition-colors"
                            >
                              <Edit2 size={14} />
                            </button>
                            <button
                              onClick={() => handleDeleteEmployee(emp.id)}
                              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-red-500 transition-colors"
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
                      <td colSpan={7} className="px-4 py-8 text-center text-[hsl(var(--muted-foreground))] text-sm">
                        لا يوجد موظفون — اضغط "إضافة موظف" لإضافة أول موظف
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Role Modal */}
      {editRole !== undefined && (
        <RoleModal
          role={editRole}
          onClose={() => setEditRole(undefined)}
          onSave={handleSaveRole}
        />
      )}

      {/* Employee Modal */}
      {editEmployee !== undefined && (
        <EmployeeModal
          employee={editEmployee}
          roles={roles}
          onClose={() => setEditEmployee(undefined)}
          onSave={handleSaveEmployee}
        />
      )}
    </AppLayout>
  );
}
