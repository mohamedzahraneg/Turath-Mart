'use client';
import React, { useState } from 'react';
import AppLayout from '@/components/AppLayout';
import {
  Users, Plus, Search, Edit2, Trash2, X, Save,
  CheckCircle, XCircle, Shield, User, Monitor, Smartphone, Tablet
} from 'lucide-react';

interface AppUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: 'active' | 'inactive';
  lastLogin: string;
  lastLoginTime?: string;
  lastDevice?: string;
  avatar: string;
}

const initialUsers: AppUser[] = [
  { id: 'u1', name: 'محمد الزهراني', email: 'manager@zahranship.com', role: 'مدير النظام', status: 'active', lastLogin: '27 مارس 2026', lastLoginTime: '09:32:14', lastDevice: 'كمبيوتر', avatar: 'م' },
  { id: 'u2', name: 'أحمد علي', email: 'ahmed@zahranship.com', role: 'مشرف شحن', status: 'active', lastLogin: '26 مارس 2026', lastLoginTime: '11:15:42', lastDevice: 'موبايل', avatar: 'أ' },
  { id: 'u3', name: 'سارة محمود', email: 'sara@zahranship.com', role: 'موظف مبيعات', status: 'active', lastLogin: '25 مارس 2026', lastLoginTime: '08:40:51', lastDevice: 'كمبيوتر', avatar: 'س' },
  { id: 'u4', name: 'خالد عمر', email: 'khaled@zahranship.com', role: 'موظف مخزون', status: 'inactive', lastLogin: '20 مارس 2026', lastLoginTime: '14:22:05', lastDevice: 'تابلت', avatar: 'خ' },
  { id: 'u5', name: 'فاطمة حسن', email: 'fatma@zahranship.com', role: 'موظف مبيعات', status: 'active', lastLogin: '27 مارس 2026', lastLoginTime: '13:40:07', lastDevice: 'موبايل', avatar: 'ف' },
  { id: 'u6', name: 'عمر يوسف', email: 'omar@zahranship.com', role: 'مشرف شحن', status: 'inactive', lastLogin: '15 مارس 2026', lastLoginTime: '10:05:33', lastDevice: 'كمبيوتر', avatar: 'ع' },
];

const roles = ['مدير النظام', 'مشرف شحن', 'موظف مبيعات', 'موظف مخزون', 'محاسب'];

const roleColors: Record<string, string> = {
  'مدير النظام': 'bg-purple-100 text-purple-700',
  'مشرف شحن': 'bg-blue-100 text-blue-700',
  'موظف مبيعات': 'bg-green-100 text-green-700',
  'موظف مخزون': 'bg-amber-100 text-amber-700',
  'محاسب': 'bg-orange-100 text-orange-700',
};

// Roles that can see device info
const PRIVILEGED_ROLES = ['مدير النظام', 'مشرف شحن'];
const CURRENT_USER_ROLE = 'مدير النظام'; // simulated
const CAN_SEE_DEVICE = PRIVILEGED_ROLES.includes(CURRENT_USER_ROLE);

function DeviceIcon({ device }: { device?: string }) {
  if (!device) return <Monitor size={12} />;
  if (device === 'موبايل') return <Smartphone size={12} />;
  if (device === 'تابلت') return <Tablet size={12} />;
  return <Monitor size={12} />;
}

interface UserModalProps {
  user: AppUser | null;
  onClose: () => void;
  onSave: (user: AppUser) => void;
}

function UserModal({ user, onClose, onSave }: UserModalProps) {
  const [form, setForm] = useState<AppUser>(
    user || { id: `u${Date.now()}`, name: '', email: '', role: 'موظف مبيعات', status: 'active', lastLogin: 'جديد', avatar: '' }
  );

  const getAvatar = (name: string) => name.trim().charAt(0) || '؟';

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-[hsl(var(--border))]">
          <h2 className="text-lg font-bold">{user ? 'تعديل مستخدم' : 'إضافة مستخدم جديد'}</h2>
          <button onClick={onClose} className="p-2 hover:bg-[hsl(var(--muted))] rounded-xl transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-semibold mb-1.5">الاسم الكامل</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value, avatar: getAvatar(e.target.value) })}
              className="w-full border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
              placeholder="الاسم الكامل"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1.5">البريد الإلكتروني</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
              placeholder="example@zahranship.com"
              dir="ltr"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold mb-1.5">الدور الوظيفي</label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="w-full border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
              >
                {roles.map(r => <option key={r}>{r}</option>)}
              </select>
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
          {!user && (
            <div>
              <label className="block text-sm font-semibold mb-1.5">كلمة المرور</label>
              <input
                type="password"
                className="w-full border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
                placeholder="••••••••"
                dir="ltr"
              />
            </div>
          )}
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

export default function UsersPage() {
  const [users, setUsers] = useState<AppUser[]>(initialUsers);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [editUser, setEditUser] = useState<AppUser | null | undefined>(undefined);

  const filtered = users.filter(u => {
    const matchSearch = u.name.includes(search) || u.email.includes(search) || u.role.includes(search);
    const matchStatus = filterStatus === 'all' || u.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const handleSave = (user: AppUser) => {
    setUsers(prev => {
      const exists = prev.find(u => u.id === user.id);
      if (exists) return prev.map(u => u.id === user.id ? user : u);
      return [...prev, user];
    });
    setEditUser(undefined);
  };

  const handleDelete = (id: string) => {
    setUsers(prev => prev.filter(u => u.id !== id));
  };

  const activeCount = users.filter(u => u.status === 'active').length;

  return (
    <AppLayout currentPath="/users">
      <div className="space-y-6 fade-in">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">إدارة المستخدمين</h1>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">{users.length} مستخدم — {activeCount} نشط</p>
          </div>
          <button
            onClick={() => setEditUser(null)}
            className="flex items-center gap-2 px-4 py-2.5 bg-[hsl(var(--primary))] text-white rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            <Plus size={18} />
            إضافة مستخدم
          </button>
        </div>

        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {[
            { label: 'إجمالي المستخدمين', value: users.length, icon: <Users size={20} />, color: 'blue' },
            { label: 'نشطون', value: activeCount, icon: <CheckCircle size={20} />, color: 'green' },
            { label: 'غير نشطين', value: users.length - activeCount, icon: <XCircle size={20} />, color: 'red' },
            { label: 'الأدوار', value: roles.length, icon: <Shield size={20} />, color: 'purple' },
          ].map((card, i) => (
            <div key={i} className="kpi-card">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${
                card.color === 'blue' ? 'bg-blue-50 text-blue-600' :
                card.color === 'green' ? 'bg-green-50 text-green-600' :
                card.color === 'red'? 'bg-red-50 text-red-600' : 'bg-purple-50 text-purple-600'
              }`}>
                {card.icon}
              </div>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mb-1">{card.label}</p>
              <p className="text-2xl font-bold text-[hsl(var(--foreground))] font-mono">{card.value}</p>
            </div>
          ))}
        </div>

        <div className="card-section p-4 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
            <input
              type="text"
              placeholder="بحث بالاسم أو البريد أو الدور..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pr-9 pl-4 py-2.5 border border-[hsl(var(--border))] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
            />
          </div>
          <div className="flex bg-[hsl(var(--muted))] rounded-xl p-1 gap-1">
            {[{ key: 'all', label: 'الكل' }, { key: 'active', label: 'نشط' }, { key: 'inactive', label: 'غير نشط' }].map(opt => (
              <button
                key={opt.key}
                onClick={() => setFilterStatus(opt.key as 'all' | 'active' | 'inactive')}
                className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-all ${filterStatus === opt.key ? 'bg-white text-[hsl(var(--primary))] shadow-sm' : 'text-[hsl(var(--muted-foreground))]'}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(user => (
            <div key={user.id} className="card-section p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-full bg-[hsl(var(--primary))] flex items-center justify-center text-white text-lg font-bold flex-shrink-0">
                    {user.avatar}
                  </div>
                  <div>
                    <p className="font-bold text-[hsl(var(--foreground))]">{user.name}</p>
                    <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5" dir="ltr">{user.email}</p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => setEditUser(user)} className="p-1.5 hover:bg-blue-50 text-blue-600 rounded-lg transition-colors">
                    <Edit2 size={14} />
                  </button>
                  <button onClick={() => handleDelete(user.id)} className="p-1.5 hover:bg-red-50 text-red-500 rounded-lg transition-colors">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg ${roleColors[user.role] || 'bg-gray-100 text-gray-700'}`}>
                  {user.role}
                </span>
                <span className={`flex items-center gap-1 text-xs font-semibold ${user.status === 'active' ? 'text-green-600' : 'text-gray-400'}`}>
                  <span className={`w-2 h-2 rounded-full ${user.status === 'active' ? 'bg-green-500' : 'bg-gray-300'}`} />
                  {user.status === 'active' ? 'نشط' : 'غير نشط'}
                </span>
              </div>
              <div className="mt-3 pt-3 border-t border-[hsl(var(--border))] space-y-1">
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  آخر دخول: {user.lastLogin}
                  {user.lastLoginTime && <span className="font-mono mr-1">{user.lastLoginTime}</span>}
                </p>
                {/* Device info — only for admin/supervisor/manager */}
                {CAN_SEE_DEVICE && user.lastDevice && (
                  <p className="text-xs text-[hsl(var(--muted-foreground))] flex items-center gap-1">
                    <DeviceIcon device={user.lastDevice} />
                    <span>الجهاز: <span className="font-semibold text-[hsl(var(--foreground))]">{user.lastDevice}</span></span>
                  </p>
                )}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="col-span-3 text-center py-12 text-[hsl(var(--muted-foreground))]">
              <User size={40} className="mx-auto mb-3 opacity-30" />
              <p>لا توجد نتائج مطابقة</p>
            </div>
          )}
        </div>
      </div>

      {editUser !== undefined && (
        <UserModal user={editUser} onClose={() => setEditUser(undefined)} onSave={handleSave} />
      )}
    </AppLayout>
  );
}
