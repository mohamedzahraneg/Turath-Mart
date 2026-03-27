'use client';
import React, { useState, useEffect, useMemo } from 'react';
import AppLayout from '@/components/AppLayout';
import {
  Users, Search, Star, TrendingUp, ShoppingBag, AlertCircle, Eye,
  Plus, X, Phone, Hash, ChevronDown, ChevronUp, MessageSquare,
  Crown, Award, User, Filter, Download
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Order {
  id: string;
  orderNum: string;
  customer: string;
  phone: string;
  total: number;
  status: string;
  date: string;
  products: string;
}

interface Complaint {
  id: string;
  date: string;
  subject: string;
  status: 'open' | 'resolved' | 'pending';
  notes: string;
}

interface Customer {
  code: string;
  name: string;
  phone: string;
  region: string;
  totalOrders: number;
  totalSpent: number;
  lastOrderDate: string;
  tier: 'vip' | 'gold' | 'silver' | 'regular';
  orders: Order[];
  complaints: Complaint[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  new: { label: 'جديد', cls: 'bg-blue-100 text-blue-700' },
  preparing: { label: 'جاري التجهيز', cls: 'bg-yellow-100 text-yellow-700' },
  warehouse: { label: 'في المستودع', cls: 'bg-purple-100 text-purple-700' },
  shipping: { label: 'جاري الشحن', cls: 'bg-orange-100 text-orange-700' },
  delivered: { label: 'تم التسليم', cls: 'bg-green-100 text-green-700' },
  cancelled: { label: 'ملغي', cls: 'bg-red-100 text-red-700' },
  returned: { label: 'مرتجع', cls: 'bg-gray-100 text-gray-700' },
};

const COMPLAINT_STATUS_MAP: Record<string, { label: string; cls: string }> = {
  open: { label: 'مفتوحة', cls: 'bg-red-100 text-red-700' },
  pending: { label: 'قيد المعالجة', cls: 'bg-yellow-100 text-yellow-700' },
  resolved: { label: 'محلولة', cls: 'bg-green-100 text-green-700' },
};

const TIER_CONFIG: Record<string, { label: string; cls: string; icon: React.ReactNode; minOrders: number; minSpent: number }> = {
  vip: { label: 'VIP', cls: 'bg-purple-100 text-purple-700 border border-purple-200', icon: <Crown size={12} />, minOrders: 10, minSpent: 5000 },
  gold: { label: 'ذهبي', cls: 'bg-yellow-100 text-yellow-700 border border-yellow-200', icon: <Star size={12} />, minOrders: 5, minSpent: 2000 },
  silver: { label: 'فضي', cls: 'bg-slate-100 text-slate-600 border border-slate-200', icon: <Award size={12} />, minOrders: 2, minSpent: 500 },
  regular: { label: 'عادي', cls: 'bg-gray-100 text-gray-600 border border-gray-200', icon: <User size={12} />, minOrders: 0, minSpent: 0 },
};

function calcTier(totalOrders: number, totalSpent: number): Customer['tier'] {
  if (totalOrders >= 10 || totalSpent >= 5000) return 'vip';
  if (totalOrders >= 5 || totalSpent >= 2000) return 'gold';
  if (totalOrders >= 2 || totalSpent >= 500) return 'silver';
  return 'regular';
}

function generateCustomerCode(name: string, phone: string): string {
  const prefix = 'CRM';
  const nameCode = name.trim().split(' ')[0].slice(0, 2).toUpperCase().replace(/[^A-Z]/g, 'X');
  const phoneCode = phone.slice(-4);
  return `${prefix}-${nameCode || 'XX'}-${phoneCode}`;
}

// ─── Build customers from orders in localStorage ──────────────────────────────

const MOCK_ORDERS_FALLBACK: Order[] = [
  { id: 'order-001', orderNum: 'ZSH-2026-0047', customer: 'أحمد محمود السيد', phone: '01012345678', total: 650, status: 'shipping', date: '27/03/2026', products: 'حامل مصحف بني x 2' },
  { id: 'order-002', orderNum: 'ZSH-2026-0046', customer: 'فاطمة علي حسن', phone: '01123456789', total: 890, status: 'delivered', date: '27/03/2026', products: 'كعبة x 1 + مصحف x 2' },
  { id: 'order-003', orderNum: 'ZSH-2026-0045', customer: 'محمد عبد الرحمن', phone: '01234567890', total: 380, status: 'new', date: '27/03/2026', products: 'حامل مصحف ذهبي x 1' },
  { id: 'order-004', orderNum: 'ZSH-2026-0044', customer: 'سارة إبراهيم خليل', phone: '01056789012', total: 530, status: 'preparing', date: '27/03/2026', products: 'كشاف x 3' },
  { id: 'order-005', orderNum: 'ZSH-2026-0043', customer: 'عمر حامد الشريف', phone: '01198765432', total: 570, status: 'warehouse', date: '26/03/2026', products: 'حامل مصحف أسود x 1 + كشاف x 1' },
  { id: 'order-006', orderNum: 'ZSH-2026-0042', customer: 'نور الدين مصطفى', phone: '01067891234', total: 1200, status: 'returned', date: '26/03/2026', products: 'كرسي x 2' },
  { id: 'order-007', orderNum: 'ZSH-2026-0041', customer: 'هدى رمضان أحمد', phone: '01145678901', total: 750, status: 'cancelled', date: '26/03/2026', products: 'مصحف x 5' },
  { id: 'order-008', orderNum: 'ZSH-2026-0040', customer: 'خالد عبد العزيز', phone: '01012223344', total: 810, status: 'delivered', date: '25/03/2026', products: 'حامل مصحف أبيض x 2 + مصحف x 1' },
  { id: 'order-009', orderNum: 'ZSH-2026-0039', customer: 'ريم حسام الدين', phone: '01534567890', total: 500, status: 'shipping', date: '25/03/2026', products: 'كعبة x 1' },
  { id: 'order-010', orderNum: 'ZSH-2026-0038', customer: 'طارق سعيد منصور', phone: '01267891234', total: 610, status: 'preparing', date: '25/03/2026', products: 'حامل مصحف صدف x 1 + كشاف x 1' },
  { id: 'order-011', orderNum: 'ZSH-2026-0037', customer: 'أحمد محمود السيد', phone: '01012345678', total: 450, status: 'delivered', date: '20/03/2026', products: 'كعبة x 1' },
  { id: 'order-012', orderNum: 'ZSH-2026-0036', customer: 'أحمد محمود السيد', phone: '01012345678', total: 300, status: 'delivered', date: '15/03/2026', products: 'حامل مصحف بني x 1' },
  { id: 'order-013', orderNum: 'ZSH-2026-0035', customer: 'فاطمة علي حسن', phone: '01123456789', total: 600, status: 'delivered', date: '18/03/2026', products: 'كرسي x 1' },
  { id: 'order-014', orderNum: 'ZSH-2026-0034', customer: 'خالد عبد العزيز', phone: '01012223344', total: 700, status: 'delivered', date: '22/03/2026', products: 'مصحف x 5' },
  { id: 'order-015', orderNum: 'ZSH-2026-0033', customer: 'خالد عبد العزيز', phone: '01012223344', total: 330, status: 'delivered', date: '10/03/2026', products: 'حامل مصحف ذهبي x 1' },
];

function buildCustomers(orders: Order[]): Customer[] {
  const map = new Map<string, Customer>();

  orders.forEach((order) => {
    const key = order.phone;
    if (!map.has(key)) {
      map.set(key, {
        code: generateCustomerCode(order.customer, order.phone),
        name: order.customer,
        phone: order.phone,
        region: '',
        totalOrders: 0,
        totalSpent: 0,
        lastOrderDate: order.date,
        tier: 'regular',
        orders: [],
        complaints: [],
      });
    }
    const c = map.get(key)!;
    c.orders.push(order);
    c.totalOrders += 1;
    c.totalSpent += order.total;
    // Keep latest date
    const [d1, m1, y1] = order.date.split('/').map(Number);
    const [d2, m2, y2] = c.lastOrderDate.split('/').map(Number);
    if (new Date(y1, m1 - 1, d1) > new Date(y2, m2 - 1, d2)) {
      c.lastOrderDate = order.date;
    }
  });

  // Load saved complaints
  let savedComplaints: Record<string, Complaint[]> = {};
  try {
    savedComplaints = JSON.parse(localStorage.getItem('zahranship_crm_complaints') || '{}');
  } catch {}

  map.forEach((c) => {
    c.tier = calcTier(c.totalOrders, c.totalSpent);
    c.complaints = savedComplaints[c.phone] || [];
  });

  return Array.from(map.values()).sort((a, b) => b.totalSpent - a.totalSpent);
}

// ─── Complaint Modal ──────────────────────────────────────────────────────────

interface ComplaintModalProps {
  customer: Customer;
  onClose: () => void;
  onSave: (phone: string, complaints: Complaint[]) => void;
}

function ComplaintModal({ customer, onClose, onSave }: ComplaintModalProps) {
  const [complaints, setComplaints] = useState<Complaint[]>(customer.complaints);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ subject: '', notes: '', status: 'open' as Complaint['status'] });

  const addComplaint = () => {
    if (!form.subject.trim()) return;
    const newC: Complaint = {
      id: `comp-${Date.now()}`,
      date: new Date().toLocaleDateString('en-GB'),
      subject: form.subject,
      status: form.status,
      notes: form.notes,
    };
    const updated = [newC, ...complaints];
    setComplaints(updated);
    onSave(customer.phone, updated);
    setForm({ subject: '', notes: '', status: 'open' });
    setShowForm(false);
  };

  const updateStatus = (id: string, status: Complaint['status']) => {
    const updated = complaints.map(c => c.id === id ? { ...c, status } : c);
    setComplaints(updated);
    onSave(customer.phone, updated);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-900">شكاوى العميل</h2>
            <p className="text-sm text-gray-500">{customer.name} — {customer.code}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 text-sm font-medium text-[hsl(var(--primary))] hover:underline"
          >
            <Plus size={16} /> إضافة شكوى جديدة
          </button>

          {showForm && (
            <div className="bg-gray-50 rounded-xl p-4 space-y-3 border border-gray-200">
              <input
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
                placeholder="موضوع الشكوى *"
                value={form.subject}
                onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
              />
              <textarea
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))] resize-none"
                placeholder="تفاصيل الشكوى"
                rows={3}
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              />
              <div className="flex items-center gap-3">
                <select
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
                  value={form.status}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value as Complaint['status'] }))}
                >
                  <option value="open">مفتوحة</option>
                  <option value="pending">قيد المعالجة</option>
                  <option value="resolved">محلولة</option>
                </select>
                <button
                  onClick={addComplaint}
                  className="bg-[hsl(var(--primary))] text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  حفظ
                </button>
                <button onClick={() => setShowForm(false)} className="text-sm text-gray-500 hover:text-gray-700">إلغاء</button>
              </div>
            </div>
          )}

          {complaints.length === 0 ? (
            <div className="text-center py-10 text-gray-400">
              <MessageSquare size={40} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">لا توجد شكاوى مسجلة</p>
            </div>
          ) : (
            <div className="space-y-3">
              {complaints.map(c => (
                <div key={c.id} className="border border-gray-100 rounded-xl p-4 bg-white">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <p className="font-medium text-gray-800 text-sm">{c.subject}</p>
                      {c.notes && <p className="text-xs text-gray-500 mt-1">{c.notes}</p>}
                      <p className="text-xs text-gray-400 mt-1">{c.date}</p>
                    </div>
                    <select
                      className={`text-xs px-2 py-1 rounded-lg border-0 font-medium cursor-pointer ${COMPLAINT_STATUS_MAP[c.status]?.cls}`}
                      value={c.status}
                      onChange={e => updateStatus(c.id, e.target.value as Complaint['status'])}
                    >
                      <option value="open">مفتوحة</option>
                      <option value="pending">قيد المعالجة</option>
                      <option value="resolved">محلولة</option>
                    </select>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Customer Detail Modal ────────────────────────────────────────────────────

interface CustomerDetailProps {
  customer: Customer;
  onClose: () => void;
}

function CustomerDetailModal({ customer, onClose }: CustomerDetailProps) {
  const [tab, setTab] = useState<'orders' | 'complaints'>('orders');
  const tier = TIER_CONFIG[customer.tier];

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-gray-100">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-[hsl(var(--primary))]/10 flex items-center justify-center text-[hsl(var(--primary))] text-xl font-bold">
              {customer.name.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-gray-900">{customer.name}</h2>
                <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${tier.cls}`}>
                  {tier.icon} {tier.label}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-xs text-gray-500 flex items-center gap-1"><Hash size={11} />{customer.code}</span>
                <span className="text-xs text-gray-500 flex items-center gap-1"><Phone size={11} />{customer.phone}</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 p-5 border-b border-gray-100">
          <div className="text-center">
            <p className="text-2xl font-bold text-[hsl(var(--primary))]">{customer.totalOrders}</p>
            <p className="text-xs text-gray-500 mt-0.5">إجمالي الطلبات</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-green-600">{customer.totalSpent.toLocaleString('en-US')}</p>
            <p className="text-xs text-gray-500 mt-0.5">إجمالي المشتريات (ج.م)</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-orange-500">{customer.complaints.length}</p>
            <p className="text-xs text-gray-500 mt-0.5">الشكاوى</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 px-5">
          {(['orders', 'complaints'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${tab === t ? 'border-[hsl(var(--primary))] text-[hsl(var(--primary))]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              {t === 'orders' ? `الطلبات (${customer.orders.length})` : `الشكاوى (${customer.complaints.length})`}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'orders' && (
            <div className="space-y-3">
              {customer.orders.length === 0 ? (
                <p className="text-center text-gray-400 py-8 text-sm">لا توجد طلبات</p>
              ) : (
                customer.orders.map(o => (
                  <div key={o.id} className="flex items-center justify-between p-3 border border-gray-100 rounded-xl hover:bg-gray-50 transition-colors">
                    <div>
                      <p className="text-sm font-semibold text-gray-800">{o.orderNum}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{o.products}</p>
                      <p className="text-xs text-gray-400">{o.date}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-gray-800">{o.total.toLocaleString('en-US')} ج.م</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium mt-1 inline-block ${STATUS_MAP[o.status]?.cls || 'bg-gray-100 text-gray-600'}`}>
                        {STATUS_MAP[o.status]?.label || o.status}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'complaints' && (
            <div className="space-y-3">
              {customer.complaints.length === 0 ? (
                <p className="text-center text-gray-400 py-8 text-sm">لا توجد شكاوى مسجلة</p>
              ) : (
                customer.complaints.map(c => (
                  <div key={c.id} className="p-3 border border-gray-100 rounded-xl">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-semibold text-gray-800">{c.subject}</p>
                        {c.notes && <p className="text-xs text-gray-500 mt-1">{c.notes}</p>}
                        <p className="text-xs text-gray-400 mt-1">{c.date}</p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${COMPLAINT_STATUS_MAP[c.status]?.cls}`}>
                        {COMPLAINT_STATUS_MAP[c.status]?.label}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main CRM Page ────────────────────────────────────────────────────────────

export default function CRMPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState<string>('الكل');
  const [sortBy, setSortBy] = useState<'totalSpent' | 'totalOrders' | 'lastOrderDate'>('totalSpent');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null);
  const [complaintCustomer, setComplaintCustomer] = useState<Customer | null>(null);

  useEffect(() => {
    const load = () => {
      try {
        const saved = JSON.parse(localStorage.getItem('zahranship_orders') || '[]') as Order[];
        const allOrders = saved.length > 0 ? saved : MOCK_ORDERS_FALLBACK;
        setCustomers(buildCustomers(allOrders));
      } catch {
        setCustomers(buildCustomers(MOCK_ORDERS_FALLBACK));
      }
    };
    load();
    window.addEventListener('zahranship_orders_updated', load);
    window.addEventListener('storage', load);
    return () => {
      window.removeEventListener('zahranship_orders_updated', load);
      window.removeEventListener('storage', load);
    };
  }, []);

  const saveComplaints = (phone: string, complaints: Complaint[]) => {
    try {
      const all = JSON.parse(localStorage.getItem('zahranship_crm_complaints') || '{}');
      all[phone] = complaints;
      localStorage.setItem('zahranship_crm_complaints', JSON.stringify(all));
      // Refresh customers
      const saved = JSON.parse(localStorage.getItem('zahranship_orders') || '[]') as Order[];
      const allOrders = saved.length > 0 ? saved : MOCK_ORDERS_FALLBACK;
      setCustomers(buildCustomers(allOrders));
    } catch {}
  };

  const filtered = useMemo(() => {
    return customers
      .filter(c => {
        const matchSearch = !search || c.name.includes(search) || c.phone.includes(search) || c.code.includes(search);
        const matchTier = tierFilter === 'الكل' || c.tier === tierFilter;
        return matchSearch && matchTier;
      })
      .sort((a, b) => {
        let cmp = 0;
        if (sortBy === 'totalSpent') cmp = a.totalSpent - b.totalSpent;
        else if (sortBy === 'totalOrders') cmp = a.totalOrders - b.totalOrders;
        else if (sortBy === 'lastOrderDate') {
          const [d1, m1, y1] = a.lastOrderDate.split('/').map(Number);
          const [d2, m2, y2] = b.lastOrderDate.split('/').map(Number);
          cmp = new Date(y1, m1 - 1, d1).getTime() - new Date(y2, m2 - 1, d2).getTime();
        }
        return sortDir === 'desc' ? -cmp : cmp;
      });
  }, [customers, search, tierFilter, sortBy, sortDir]);

  // KPIs
  const totalCustomers = customers.length;
  const vipCount = customers.filter(c => c.tier === 'vip').length;
  const goldCount = customers.filter(c => c.tier === 'gold').length;
  const totalRevenue = customers.reduce((s, c) => s + c.totalSpent, 0);
  const totalComplaints = customers.reduce((s, c) => s + c.complaints.length, 0);

  const toggleSort = (field: typeof sortBy) => {
    if (sortBy === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(field); setSortDir('desc'); }
  };

  const exportCSV = () => {
    const headers = ['كود العميل', 'الاسم', 'الهاتف', 'عدد الطلبات', 'إجمالي المشتريات (ج.م)', 'آخر طلب', 'التصنيف', 'عدد الشكاوى'];
    const rows = filtered.map(c => [c.code, c.name, c.phone, c.totalOrders, c.totalSpent, c.lastOrderDate, TIER_CONFIG[c.tier]?.label, c.complaints.length]);
    const csv = '\uFEFF' + [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crm-customers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppLayout currentPath="/crm">
      <div className="space-y-6 fade-in">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">إدارة العملاء (CRM)</h1>
            <p className="text-sm text-gray-500 mt-0.5">متابعة العملاء وسجل طلباتهم وشكاويهم وتصنيفاتهم</p>
          </div>
          <button
            onClick={exportCSV}
            className="flex items-center gap-2 bg-[hsl(var(--primary))] text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Download size={16} /> تصدير CSV
          </button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                <Users size={20} className="text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{totalCustomers}</p>
                <p className="text-xs text-gray-500">إجمالي العملاء</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center">
                <Crown size={20} className="text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{vipCount}</p>
                <p className="text-xs text-gray-500">عملاء VIP</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-yellow-50 flex items-center justify-center">
                <Star size={20} className="text-yellow-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{goldCount}</p>
                <p className="text-xs text-gray-500">عملاء ذهبيون</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center">
                <TrendingUp size={20} className="text-green-600" />
              </div>
              <div>
                <p className="text-xl font-bold text-gray-900">{totalRevenue.toLocaleString('en-US')}</p>
                <p className="text-xs text-gray-500">إجمالي الإيرادات (ج.م)</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
                <AlertCircle size={20} className="text-red-500" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{totalComplaints}</p>
                <p className="text-xs text-gray-500">إجمالي الشكاوى</p>
              </div>
            </div>
          </div>
        </div>

        {/* Tier Legend */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
          <p className="text-xs font-semibold text-gray-500 mb-3">معايير التصنيف</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(TIER_CONFIG).map(([key, t]) => (
              <div key={key} className={`flex items-center gap-2 px-3 py-2 rounded-xl ${t.cls}`}>
                {t.icon}
                <div>
                  <p className="text-xs font-bold">{t.label}</p>
                  <p className="text-[10px] opacity-70">
                    {key === 'regular' ? 'أقل من طلبين' : `${t.minOrders}+ طلبات أو ${t.minSpent.toLocaleString('en-US')}+ ج.م`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="w-full border border-gray-200 rounded-xl pr-9 pl-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
                placeholder="بحث بالاسم أو الهاتف أو الكود..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter size={16} className="text-gray-400" />
              <select
                className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
                value={tierFilter}
                onChange={e => setTierFilter(e.target.value)}
              >
                <option value="الكل">كل التصنيفات</option>
                <option value="vip">VIP</option>
                <option value="gold">ذهبي</option>
                <option value="silver">فضي</option>
                <option value="regular">عادي</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">ترتيب حسب:</span>
              <select
                className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
                value={sortBy}
                onChange={e => setSortBy(e.target.value as typeof sortBy)}
              >
                <option value="totalSpent">قيمة المشتريات</option>
                <option value="totalOrders">عدد الطلبات</option>
                <option value="lastOrderDate">آخر طلب</option>
              </select>
              <button
                onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
                className="p-2 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
              >
                {sortDir === 'desc' ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
              </button>
            </div>
          </div>
        </div>

        {/* Customers Table */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-right px-4 py-3 font-semibold text-gray-600 text-xs">كود العميل</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600 text-xs">الاسم</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600 text-xs">الهاتف</th>
                  <th
                    className="text-right px-4 py-3 font-semibold text-gray-600 text-xs cursor-pointer hover:text-gray-900 select-none"
                    onClick={() => toggleSort('totalOrders')}
                  >
                    <span className="flex items-center gap-1">
                      عدد الطلبات
                      {sortBy === 'totalOrders' && (sortDir === 'desc' ? <ChevronDown size={12} /> : <ChevronUp size={12} />)}
                    </span>
                  </th>
                  <th
                    className="text-right px-4 py-3 font-semibold text-gray-600 text-xs cursor-pointer hover:text-gray-900 select-none"
                    onClick={() => toggleSort('totalSpent')}
                  >
                    <span className="flex items-center gap-1">
                      إجمالي المشتريات
                      {sortBy === 'totalSpent' && (sortDir === 'desc' ? <ChevronDown size={12} /> : <ChevronUp size={12} />)}
                    </span>
                  </th>
                  <th
                    className="text-right px-4 py-3 font-semibold text-gray-600 text-xs cursor-pointer hover:text-gray-900 select-none"
                    onClick={() => toggleSort('lastOrderDate')}
                  >
                    <span className="flex items-center gap-1">
                      آخر طلب
                      {sortBy === 'lastOrderDate' && (sortDir === 'desc' ? <ChevronDown size={12} /> : <ChevronUp size={12} />)}
                    </span>
                  </th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600 text-xs">التصنيف</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600 text-xs">الشكاوى</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600 text-xs">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-12 text-gray-400">
                      <Users size={40} className="mx-auto mb-2 opacity-30" />
                      <p>لا توجد نتائج</p>
                    </td>
                  </tr>
                ) : (
                  filtered.map((c) => {
                    const tier = TIER_CONFIG[c.tier];
                    const openComplaints = c.complaints.filter(x => x.status === 'open').length;
                    return (
                      <tr key={c.code} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-lg">{c.code}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-[hsl(var(--primary))]/10 flex items-center justify-center text-[hsl(var(--primary))] text-sm font-bold flex-shrink-0">
                              {c.name.charAt(0)}
                            </div>
                            <span className="font-medium text-gray-800">{c.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-600 font-mono text-xs">{c.phone}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <ShoppingBag size={14} className="text-[hsl(var(--primary))]" />
                            <span className="font-bold text-gray-800">{c.totalOrders}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-bold text-green-700">{c.totalSpent.toLocaleString('en-US')} ج.م</span>
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{c.lastOrderDate}</td>
                        <td className="px-4 py-3">
                          <span className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full font-medium w-fit ${tier.cls}`}>
                            {tier.icon} {tier.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {c.complaints.length > 0 ? (
                            <span className={`text-xs px-2 py-1 rounded-full font-medium ${openComplaints > 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                              {c.complaints.length} {openComplaints > 0 ? `(${openComplaints} مفتوحة)` : '(محلولة)'}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setDetailCustomer(c)}
                              className="p-1.5 hover:bg-blue-50 text-blue-600 rounded-lg transition-colors"
                              title="عرض التفاصيل"
                            >
                              <Eye size={15} />
                            </button>
                            <button
                              onClick={() => setComplaintCustomer(c)}
                              className="p-1.5 hover:bg-orange-50 text-orange-500 rounded-lg transition-colors"
                              title="إدارة الشكاوى"
                            >
                              <MessageSquare size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-gray-100 text-xs text-gray-500">
            إجمالي: {filtered.length} عميل
          </div>
        </div>
      </div>

      {/* Modals */}
      {detailCustomer && (
        <CustomerDetailModal customer={detailCustomer} onClose={() => setDetailCustomer(null)} />
      )}
      {complaintCustomer && (
        <ComplaintModal
          customer={complaintCustomer}
          onClose={() => setComplaintCustomer(null)}
          onSave={saveComplaints}
        />
      )}
    </AppLayout>
  );
}
