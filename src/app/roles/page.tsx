'use client';
import React, { useState } from 'react';
import AppLayout from '@/components/AppLayout';
import { ShieldCheck, Plus, Edit2, Trash2, X, Save, Check } from 'lucide-react';

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

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>(initialRoles);
  const [editRole, setEditRole] = useState<Role | null | undefined>(undefined);

  const handleSave = (role: Role) => {
    setRoles(prev => {
      const exists = prev.find(r => r.id === role.id);
      if (exists) return prev.map(r => r.id === role.id ? role : r);
      return [...prev, role];
    });
    setEditRole(undefined);
  };

  const handleDelete = (id: string) => {
    setRoles(prev => prev.filter(r => r.id !== id));
  };

  return (
    <AppLayout currentPath="/roles">
      <div className="space-y-6 fade-in">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">الأدوار والصلاحيات</h1>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">إدارة أدوار المستخدمين وتحديد صلاحياتهم</p>
          </div>
          <button
            onClick={() => setEditRole(null)}
            className="flex items-center gap-2 px-4 py-2.5 bg-[hsl(var(--primary))] text-white rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            <Plus size={18} />
            إضافة دور
          </button>
        </div>

        {/* Roles Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
          {roles.map(role => {
            const colors = colorMap[role.color] || colorMap.blue;
            return (
              <div key={role.id} className={`card-section p-5 border-2 ${colors.border} hover:shadow-md transition-shadow`}>
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-11 h-11 rounded-xl ${colors.bg} ${colors.text} flex items-center justify-center`}>
                      <ShieldCheck size={22} />
                    </div>
                    <div>
                      <p className="font-bold text-[hsl(var(--foreground))]">{role.name}</p>
                      <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">{role.usersCount} مستخدم</p>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => setEditRole(role)} className="p-1.5 hover:bg-blue-50 text-blue-600 rounded-lg transition-colors">
                      <Edit2 size={14} />
                    </button>
                    <button onClick={() => handleDelete(role.id)} className="p-1.5 hover:bg-red-50 text-red-500 rounded-lg transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">{role.description}</p>
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg ${colors.bg} ${colors.text}`}>
                    {role.permissions.length} صلاحية
                  </span>
                  <div className="flex flex-wrap gap-1 justify-end">
                    {permGroups.filter(g => allPermissions.filter(p => p.group === g).some(p => role.permissions.includes(p.id))).slice(0, 3).map(g => (
                      <span key={g} className="text-[10px] px-2 py-0.5 bg-[hsl(var(--muted))] rounded-full text-[hsl(var(--muted-foreground))]">{g}</span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Permissions Matrix */}
        <div className="card-section overflow-hidden">
          <div className="p-5 border-b border-[hsl(var(--border))]">
            <h3 className="text-base font-bold">مصفوفة الصلاحيات</h3>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">نظرة عامة على صلاحيات كل دور</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/50">
                  <th className="text-right px-4 py-3 font-semibold text-[hsl(var(--muted-foreground))] min-w-[160px]">الصلاحية</th>
                  {roles.map(r => (
                    <th key={r.id} className="text-center px-3 py-3 font-semibold text-[hsl(var(--muted-foreground))] min-w-[100px]">{r.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[hsl(var(--border))]">
                {allPermissions.map(perm => (
                  <tr key={perm.id} className="hover:bg-[hsl(var(--muted))]/20 transition-colors">
                    <td className="px-4 py-2.5 text-sm">{perm.label}</td>
                    {roles.map(r => (
                      <td key={r.id} className="px-3 py-2.5 text-center">
                        {r.permissions.includes(perm.id) ? (
                          <Check size={16} className="mx-auto text-green-500" />
                        ) : (
                          <X size={16} className="mx-auto text-gray-300" />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {editRole !== undefined && (
        <RoleModal role={editRole} onClose={() => setEditRole(undefined)} onSave={handleSave} />
      )}
    </AppLayout>
  );
}
