'use client';
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Search, ChevronDown, ChevronUp, Eye, Trash2, FileText, ChevronRight, ChevronLeft, CheckSquare, TrendingUp, DollarSign, Truck, ArrowDownCircle, History, Zap, Plus, X, AlertTriangle } from 'lucide-react';
import StatusUpdateModal from './StatusUpdateModal';
import OrderDetailModal from './OrderDetailModal';
import AuditLogModal from './AuditLogModal';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface Order {
  id: string;
  orderNum: string;
  createdBy: string;
  createdByIp?: string;
  createdByLocation?: string;
  createdByDevice?: string;
  customer: string;
  phone: string;
  phone2?: string;
  region: string;
  district?: string;
  address: string;
  products: string;
  quantity: number;
  subtotal: number;
  shippingFee: number;
  extraShippingFee?: number;
  expressShipping?: boolean;
  total: number;
  status: string;
  date: string;
  time: string;
  day: string;
  notes?: string;
  ip: string;
  delegateName?: string;
}

interface DepositEntry {
  amount: number;
  date: string;
  note: string;
}

interface DepositsStore {
  [delegate: string]: {
    deposited: number;
    deposits: DepositEntry[];
  };
}

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  new: { label: 'جديد', cls: 'status-new' },
  preparing: { label: 'جاري التجهيز', cls: 'status-preparing' },
  warehouse: { label: 'في المستودع', cls: 'status-warehouse' },
  shipping: { label: 'جاري الشحن', cls: 'status-shipping' },
  delivered: { label: 'تم التسليم', cls: 'status-delivered' },
  cancelled: { label: 'ملغي', cls: 'status-cancelled' },
  returned: { label: 'مرتجع', cls: 'status-returned' },
};

const REGIONS = ['الكل', 'القاهرة', 'الجيزة', 'القليوبية'];

const PRODUCT_FILTER_OPTIONS = [
  { value: 'الكل', label: 'كل المنتجات' },
  { value: 'حامل مصحف', label: '📿 حامل مصحف' },
  { value: 'كشاف', label: '🔦 كشاف' },
  { value: 'كرسي', label: '🪑 كرسي' },
  { value: 'مصحف', label: '📖 مصحف' },
  { value: 'كعبة', label: '🕋 كعبة' },
];

const DEPOSITS_STORAGE_KEY = 'zahranship_deposits';

function loadDepositsFromStorage(): DepositsStore {
  try {
    return JSON.parse(localStorage.getItem(DEPOSITS_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveDepositsToStorage(data: DepositsStore) {
  localStorage.setItem(DEPOSITS_STORAGE_KEY, JSON.stringify(data));
}

type SortField = 'orderNum' | 'customer' | 'region' | 'total' | 'status' | 'date';
type SortDir = 'asc' | 'desc';

function parseDateStr(dateStr: string): Date {
  const [d, m, y] = dateStr.split('/').map(Number);
  return new Date(y, m - 1, d);
}

function exportToCSV(orders: Order[]) {
  const headers = ['رقم الأوردر', 'العميل', 'الموبايل', 'المنطقة', 'المنطقة الفرعية', 'المنتجات', 'الكمية', 'المنتجات (ج.م)', 'الشحن (ج.م)', 'الإجمالي (ج.م)', 'الحالة', 'التاريخ', 'الوقت', 'المسجل', 'المندوب'];
  const rows = orders.map(o => [
    o.orderNum, o.customer, o.phone, o.region, o.district || '', o.products,
    o.quantity, o.subtotal, o.shippingFee, o.total,
    STATUS_MAP[o.status]?.label || o.status, o.date, o.time, o.createdBy, o.delegateName || ''
  ]);
  const csvContent = '\uFEFF' + [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `zahranship-orders-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportToPDF(orders: Order[]) {
  const win = window.open('', '_blank', 'width=1000,height=700');
  if (!win) {
    alert('يرجى السماح بالنوافذ المنبثقة في إعدادات المتصفح');
    return;
  }
  const rows = orders.map(o => `
    <tr>
      <td>${o.orderNum}</td>
      <td>${o.customer}</td>
      <td>${o.phone}</td>
      <td>${o.region}${o.district ? ' - ' + o.district : ''}</td>
      <td>${o.products}</td>
      <td>${o.quantity}</td>
      <td>${o.total.toLocaleString('en-US')} ج.م</td>
      <td>${STATUS_MAP[o.status]?.label || o.status}</td>
      <td>${o.date} ${o.time}</td>
    </tr>
  `).join('');
  win.document.write(`
    <!DOCTYPE html><html dir="rtl" lang="ar">
    <head><meta charset="UTF-8"><title>تقرير الأوردرات - Turath Mart</title>
    <style>
      body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;direction:rtl;padding:20px;font-size:12px;}
      h1{font-size:20px;margin-bottom:4px;color:#1e3a5f;}
      p.sub{color:#6b7280;margin-bottom:16px;font-size:12px;}
      table{width:100%;border-collapse:collapse;}
      th{background:#1e3a5f;color:white;padding:8px 10px;text-align:right;font-size:11px;}
      td{padding:7px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;}
      tr:nth-child(even){background:#f9fafb;}
      @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}
    </style></head>
    <body>
      <h1>Turath Mart — تقرير الأوردرات</h1>
      <p class="sub">تاريخ التصدير: ${new Date().toLocaleDateString('en-US')} — إجمالي: ${orders.length} أوردر</p>
      <table>
        <thead><tr><th>رقم الأوردر</th><th>العميل</th><th>الموبايل</th><th>المنطقة</th><th>المنتجات</th><th>الكمية</th><th>الإجمالي</th><th>الحالة</th><th>التاريخ والوقت</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <script>window.onload=function(){window.print();}<\/script>
    </body></html>
  `);
  win.document.close();
}

// ─── Supply Modal ─────────────────────────────────────────────────────────────
interface SupplyModalProps {
  delegate: string;
  maxAmount: number;
  onClose: () => void;
  onConfirm: (amount: number, note: string) => void;
}

function SupplyModal({ delegate, maxAmount, onClose, onConfirm }: SupplyModalProps) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('توريد نقدي');
  const [error, setError] = useState('');

  const handleSubmit = () => {
    const num = parseFloat(amount);
    if (!amount || isNaN(num) || num <= 0) {
      setError('يرجى إدخال مبلغ صحيح أكبر من صفر');
      return;
    }
    if (num > maxAmount) {
      setError(`المبلغ المدخل (${num.toLocaleString('en-US')} ج.م) أكبر من المتبقي للتوريد (${maxAmount.toLocaleString('en-US')} ج.م)`);
      return;
    }
    onConfirm(num, note || 'توريد نقدي');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-purple-100 rounded-xl flex items-center justify-center">
              <ArrowDownCircle size={18} className="text-purple-600" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[hsl(var(--foreground))]">تسجيل توريد</h3>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">المندوب: {delegate}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-[hsl(var(--muted))] transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4">
          <p className="text-xs font-semibold text-amber-700">المتبقي للتوريد</p>
          <p className="text-2xl font-bold font-mono text-amber-800">{maxAmount.toLocaleString('en-US')} <span className="text-sm font-normal">ج.م</span></p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold mb-1.5 text-[hsl(var(--foreground))]">المبلغ المُوَرَّد (ج.م) <span className="text-red-500">*</span></label>
            <input
              type="number"
              min="1"
              max={maxAmount}
              className="input-field w-full text-lg font-mono"
              placeholder="أدخل المبلغ..."
              value={amount}
              onChange={e => { setAmount(e.target.value); setError(''); }}
              dir="ltr"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1.5 text-[hsl(var(--foreground))]">ملاحظة</label>
            <input
              type="text"
              className="input-field w-full"
              placeholder="توريد نقدي..."
              value={note}
              onChange={e => setNote(e.target.value)}
            />
          </div>
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2">
              <p className="text-xs text-red-600 font-semibold">{error}</p>
            </div>
          )}
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={handleSubmit}
            className="flex-1 bg-purple-600 hover:bg-purple-700 text-white font-bold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            <ArrowDownCircle size={16} />
            تأكيد التوريد
          </button>
          <button
            onClick={onClose}
            className="px-5 py-2.5 border border-[hsl(var(--border))] rounded-xl font-semibold hover:bg-[hsl(var(--muted))] transition-colors text-sm"
          >
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Delete Confirm Modal ─────────────────────────────────────────────────────
interface DeleteConfirmModalProps {
  order: Order;
  onClose: () => void;
  onConfirm: () => void;
  isDeleting: boolean;
}

function DeleteConfirmModal({ order, onClose, onConfirm, isDeleting }: DeleteConfirmModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <AlertTriangle size={20} className="text-red-600" />
          </div>
          <div>
            <h3 className="text-base font-bold text-[hsl(var(--foreground))]">حذف الأوردر</h3>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">هذا الإجراء لا يمكن التراجع عنه</p>
          </div>
        </div>
        <div className="bg-red-50 border border-red-100 rounded-xl p-3 mb-5">
          <p className="text-sm text-red-700">
            هل أنت متأكد من حذف الأوردر <span className="font-bold font-mono">{order.orderNum}</span> للعميل <span className="font-bold">{order.customer}</span>؟
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onConfirm}
            disabled={isDeleting}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-bold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            <Trash2 size={15} />
            {isDeleting ? 'جاري الحذف...' : 'تأكيد الحذف'}
          </button>
          <button
            onClick={onClose}
            disabled={isDeleting}
            className="px-5 py-2.5 border border-[hsl(var(--border))] rounded-xl font-semibold hover:bg-[hsl(var(--muted))] transition-colors text-sm"
          >
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function OrdersTableSection() {
  const [search, setSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState('الكل');
  const [statusFilter, setStatusFilter] = useState('الكل');
  const [productFilter, setProductFilter] = useState('الكل');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortField, setSortField] = useState<SortField>('orderNum');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(8);
  const [statusModal, setStatusModal] = useState<{ order: Order } | null>(null);
  const [detailModal, setDetailModal] = useState<{ order: Order } | null>(null);
  const [auditModal, setAuditModal] = useState<{ order: Order } | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showDelegateStats, setShowDelegateStats] = useState(false);
  const [selectedDelegate, setSelectedDelegate] = useState('');
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [liveUpdateCount, setLiveUpdateCount] = useState(0);
  const [lastUpdateTime, setLastUpdateTime] = useState<string | null>(null);
  const [depositsStore, setDepositsStore] = useState<DepositsStore>({});
  const [showSupplyModal, setShowSupplyModal] = useState(false);
  const [supplySuccess, setSupplySuccess] = useState('');
  const [deleteModal, setDeleteModal] = useState<{ order: Order } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const { currentRole } = useAuth();
  const isAdmin = currentRole === 'manager';

  // Load deposits from localStorage on mount
  useEffect(() => {
    setDepositsStore(loadDepositsFromStorage());
  }, []);

  const loadOrders = useCallback(async () => {
    try {
      // 1. Load from localStorage
      const saved = JSON.parse(localStorage.getItem('zahranship_orders') || '[]') as Order[];

      // 2. Load from Supabase
      let supabaseOrders: Order[] = [];
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from('zahranship_orders')
          .select('*')
          .order('created_at', { ascending: false });

        if (data && data.length > 0) {
          supabaseOrders = data.map((row) => ({
            id: row.id,
            orderNum: row.order_num,
            createdBy: row.created_by || '',
            createdByDevice: row.created_by_device || '',
            customer: row.customer,
            phone: row.phone,
            phone2: row.phone2 || undefined,
            region: row.region,
            district: row.district || undefined,
            address: row.address,
            products: row.products,
            quantity: row.quantity,
            subtotal: row.subtotal,
            shippingFee: row.shipping_fee,
            extraShippingFee: row.extra_shipping_fee || undefined,
            expressShipping: row.express_shipping || undefined,
            total: row.total,
            status: row.status,
            date: row.date,
            time: row.time,
            day: row.day || '',
            notes: row.notes || undefined,
            ip: row.ip || '',
            delegateName: row.delegate_name || undefined,
          }));
        }
      } catch {
        // Supabase fetch failed, continue with localStorage only
      }

      // 3. Merge: Supabase + localStorage (no mock data)
      const mergedMap = new Map<string, Order>();
      supabaseOrders.forEach((o) => mergedMap.set(o.id, o));
      saved.forEach((o) => mergedMap.set(o.id, o));

      const realOrders = Array.from(mergedMap.values());
      setAllOrders(realOrders);

      // Set default selected delegate if not set
      if (realOrders.length > 0) {
        const delegates = [...new Set(realOrders.map(o => o.delegateName).filter(Boolean))] as string[];
        if (delegates.length > 0) {
          setSelectedDelegate(prev => prev || delegates[0]);
        }
      }
    } catch {
      setAllOrders([]);
    }
  }, []);

  useEffect(() => {
    loadOrders();
    const handleUpdate = () => {
      loadOrders();
      setLiveUpdateCount(prev => prev + 1);
      setLastUpdateTime(new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };
    window.addEventListener('zahranship_orders_updated', handleUpdate);
    window.addEventListener('storage', handleUpdate);

    const interval = setInterval(() => {
      loadOrders();
    }, 15000);

    return () => {
      window.removeEventListener('zahranship_orders_updated', handleUpdate);
      window.removeEventListener('storage', handleUpdate);
      clearInterval(interval);
    };
  }, [loadOrders]);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const filtered = useMemo(() => {
    return allOrders.filter((o) => {
      const matchSearch = !search || o.customer.includes(search) || o.orderNum.includes(search) || o.phone.includes(search);
      const matchRegion = regionFilter === 'الكل' || o.region === regionFilter;
      const matchStatus = statusFilter === 'الكل' || o.status === statusFilter;
      const matchProduct = productFilter === 'الكل' || o.products.includes(productFilter);
      let matchDate = true;
      if (dateFrom || dateTo) {
        const orderDate = parseDateStr(o.date);
        if (dateFrom) {
          const from = new Date(dateFrom);
          if (orderDate < from) matchDate = false;
        }
        if (dateTo && matchDate) {
          const to = new Date(dateTo);
          to.setHours(23, 59, 59);
          if (orderDate > to) matchDate = false;
        }
      }
      return matchSearch && matchRegion && matchStatus && matchProduct && matchDate;
    }).sort((a, b) => {
      let cmp = 0;
      if (sortField === 'orderNum') cmp = a.orderNum.localeCompare(b.orderNum);
      else if (sortField === 'customer') cmp = a.customer.localeCompare(b.customer);
      else if (sortField === 'region') cmp = a.region.localeCompare(b.region);
      else if (sortField === 'total') cmp = a.total - b.total;
      else if (sortField === 'status') cmp = a.status.localeCompare(b.status);
      else if (sortField === 'date') cmp = parseDateStr(a.date).getTime() - parseDateStr(b.date).getTime();
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [allOrders, search, regionFilter, statusFilter, dateFrom, dateTo, sortField, sortDir]);

  const totalPages = Math.ceil(filtered.length / perPage);
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  const toggleRow = (id: string) => {
    const s = new Set(selectedRows);
    if (s.has(id)) s.delete(id); else s.add(id);
    setSelectedRows(s);
  };

  const toggleAll = () => {
    if (selectedRows.size === paginated.length) setSelectedRows(new Set());
    else setSelectedRows(new Set(paginated.map((o) => o.id)));
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ChevronDown size={12} className="opacity-30" />;
    return sortDir === 'asc' ? <ChevronUp size={12} className="text-[hsl(var(--primary))]" /> : <ChevronDown size={12} className="text-[hsl(var(--primary))]" />;
  };

  const statusOptions = ['الكل', ...Object.keys(STATUS_MAP)];

  // Delegate stats calculation
  const delegates = [...new Set(allOrders.map(o => o.delegateName).filter(Boolean))] as string[];
  const delegateOrders = allOrders.filter(o => o.delegateName === selectedDelegate && ['shipping', 'delivered'].includes(o.status));
  const delegateTotalOrders = delegateOrders.length;
  const delegateTotalValue = delegateOrders.reduce((s, o) => s + o.total, 0);
  const delegateShippingIncome = delegateOrders.reduce((s, o) => s + o.shippingFee, 0);
  const delegateExtraFees = delegateOrders.reduce((s, o) => s + (o.extraShippingFee || 0), 0);
  const delegateNetIncome = delegateShippingIncome - delegateExtraFees;
  const depositInfo = depositsStore[selectedDelegate] || { deposited: 0, deposits: [] };
  const delegateAmountDue = Math.max(0, delegateTotalValue - depositInfo.deposited);

  const handleSupplyConfirm = (amount: number, note: string) => {
    const now = new Date();
    const dateStr = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}`;
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    const updated = { ...depositsStore };
    if (!updated[selectedDelegate]) {
      updated[selectedDelegate] = { deposited: 0, deposits: [] };
    }
    updated[selectedDelegate].deposited += amount;
    updated[selectedDelegate].deposits.unshift({ amount, date: `${dateStr} ${timeStr}`, note });

    saveDepositsToStorage(updated);
    setDepositsStore(updated);
    setShowSupplyModal(false);
    setSupplySuccess(`تم تسجيل توريد ${amount.toLocaleString('en-US')} ج.م بنجاح`);
    setTimeout(() => setSupplySuccess(''), 4000);
  };

  const handleDeleteOrder = async (order: Order) => {
    setIsDeleting(true);
    try {
      // Delete from Supabase
      const supabase = createClient();
      await supabase.from('zahranship_orders').delete().eq('id', order.id);

      // Delete from localStorage
      try {
        const saved = JSON.parse(localStorage.getItem('zahranship_orders') || '[]') as Order[];
        const updated = saved.filter(o => o.id !== order.id);
        localStorage.setItem('zahranship_orders', JSON.stringify(updated));
      } catch { /* ignore */ }

      // Update local state
      setAllOrders(prev => prev.filter(o => o.id !== order.id));
      setSelectedRows(prev => { const s = new Set(prev); s.delete(order.id); return s; });
      setDeleteModal(null);

      // Notify other components
      window.dispatchEvent(new CustomEvent('zahranship_orders_updated'));
    } catch {
      // silently fail
    }
    setIsDeleting(false);
  };

  return (
    <>
      <div className="card-section overflow-hidden">
        {/* Live updates indicator */}
        {liveUpdateCount > 0 && (
          <div className="flex items-center gap-2 px-4 py-2 bg-green-50 border-b border-green-200 fade-in">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <Zap size={13} className="text-green-600" />
            <span className="text-xs text-green-700 font-semibold">تحديث لحظي نشط</span>
            {lastUpdateTime && (
              <span className="text-xs text-green-600 mr-auto">آخر تحديث: {lastUpdateTime}</span>
            )}
          </div>
        )}

        {/* Supply success toast */}
        {supplySuccess && (
          <div className="flex items-center gap-2 px-4 py-2.5 bg-purple-50 border-b border-purple-200 fade-in">
            <div className="w-2 h-2 bg-purple-500 rounded-full" />
            <span className="text-xs text-purple-700 font-semibold">✅ {supplySuccess}</span>
          </div>
        )}

        {/* Delegate Stats Panel */}
        <div className="border-b border-[hsl(var(--border))]">
          <button
            onClick={() => setShowDelegateStats(!showDelegateStats)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-[hsl(var(--muted))]/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Truck size={16} className="text-[hsl(var(--primary))]" />
              <span className="text-sm font-bold text-[hsl(var(--foreground))]">إحصائيات المندوبين والتوريدات</span>
            </div>
            <ChevronDown size={16} className={`text-[hsl(var(--muted-foreground))] transition-transform ${showDelegateStats ? 'rotate-180' : ''}`} />
          </button>

          {showDelegateStats && (
            <div className="px-4 pb-4 space-y-4 fade-in">
              {/* Delegate selector */}
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs font-semibold text-[hsl(var(--muted-foreground))]">المندوب:</span>
                <div className="flex gap-2 flex-wrap">
                  {delegates.length === 0 ? (
                    <span className="text-xs text-[hsl(var(--muted-foreground))]">لا يوجد مندوبون بعد</span>
                  ) : (
                    delegates.map(d => (
                      <button
                        key={d}
                        onClick={() => setSelectedDelegate(d)}
                        className={`text-xs px-3 py-1.5 rounded-xl font-semibold transition-all border ${selectedDelegate === d ? 'bg-[hsl(var(--primary))] text-white border-[hsl(var(--primary))]' : 'border-[hsl(var(--border))] hover:border-[hsl(var(--primary))]/50'}`}
                      >
                        {d}
                      </button>
                    ))
                  )}
                </div>
              </div>

              {selectedDelegate && (
                <>
                  {/* Stats cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Truck size={13} className="text-blue-600" />
                        <p className="text-[11px] font-semibold text-blue-700">اوردرات مشحونة</p>
                      </div>
                      <p className="text-xl font-bold font-mono text-blue-800">{delegateTotalOrders}</p>
                    </div>
                    <div className="bg-green-50 border border-green-100 rounded-xl p-3">
                      <div className="flex items-center gap-1.5 mb-1">
                        <DollarSign size={13} className="text-green-600" />
                        <p className="text-[11px] font-semibold text-green-700">إجمالي القيمة</p>
                      </div>
                      <p className="text-xl font-bold font-mono text-green-800">{delegateTotalValue.toLocaleString('en-US')} <span className="text-xs">ج.م</span></p>
                    </div>
                    <div className="bg-purple-50 border border-purple-100 rounded-xl p-3">
                      <div className="flex items-center gap-1.5 mb-1">
                        <TrendingUp size={13} className="text-purple-600" />
                        <p className="text-[11px] font-semibold text-purple-700">صافي دخل الشحن</p>
                      </div>
                      <p className="text-xl font-bold font-mono text-purple-800">{delegateNetIncome.toLocaleString('en-US')} <span className="text-xs">ج.م</span></p>
                      {delegateExtraFees > 0 && <p className="text-[10px] text-orange-600 mt-0.5">بعد خصم {delegateExtraFees} ج.م مصاريف إضافية</p>}
                    </div>
                    <div className="bg-red-50 border border-red-100 rounded-xl p-3">
                      <div className="flex items-center gap-1.5 mb-1">
                        <ArrowDownCircle size={13} className="text-red-600" />
                        <p className="text-[11px] font-semibold text-red-700">المطلوب توريده</p>
                      </div>
                      <p className="text-xl font-bold font-mono text-red-800">{delegateAmountDue.toLocaleString('en-US')} <span className="text-xs">ج.م</span></p>
                    </div>
                  </div>

                  {/* Cash deposits section */}
                  <div className="border border-[hsl(var(--border))] rounded-xl p-3">
                    <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <ArrowDownCircle size={14} className="text-[hsl(var(--primary))]" />
                        <span className="text-sm font-bold">التوريدات النقدية — {selectedDelegate}</span>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="bg-green-50 text-green-700 px-2 py-1 rounded-lg font-semibold text-xs">تم توريده: {depositInfo.deposited.toLocaleString('en-US')} ج.م</span>
                        <span className="bg-red-50 text-red-700 px-2 py-1 rounded-lg font-semibold text-xs">المتبقي: {delegateAmountDue.toLocaleString('en-US')} ج.م</span>
                        {/* ─── Supply Button ─── */}
                        <button
                          onClick={() => setShowSupplyModal(true)}
                          disabled={delegateAmountDue <= 0}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          title={delegateAmountDue <= 0 ? 'لا يوجد مبلغ متبقي للتوريد' : 'تسجيل توريد جديد'}
                        >
                          <Plus size={13} />
                          توريد
                        </button>
                      </div>
                    </div>
                    {depositInfo.deposits.length === 0 ? (
                      <p className="text-xs text-[hsl(var(--muted-foreground))] text-center py-2">لا توجد توريدات مسجلة</p>
                    ) : (
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {depositInfo.deposits.map((dep, i) => (
                          <div key={`dep-${i}`} className="flex items-center justify-between text-xs bg-[hsl(var(--muted))]/30 rounded-lg px-3 py-2">
                            <span className="font-semibold">{dep.note}</span>
                            <span className="text-[hsl(var(--muted-foreground))]">{dep.date}</span>
                            <span className="font-mono font-bold text-green-700">+ {dep.amount.toLocaleString('en-US')} ج.م</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="p-4 border-b border-[hsl(var(--border))] space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
              <input
                type="text"
                className="input-field pr-9"
                placeholder="بحث بالاسم، رقم الأوردر، أو الموبايل..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              <select className="input-field w-auto text-sm" value={regionFilter} onChange={(e) => { setRegionFilter(e.target.value); setPage(1); }}>
                {REGIONS.map((r) => <option key={`region-filter-${r}`} value={r}>{r}</option>)}
              </select>
              <select className="input-field w-auto text-sm" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
                {statusOptions.map((s) => (
                  <option key={`status-filter-${s}`} value={s}>{s === 'الكل' ? 'كل الحالات' : STATUS_MAP[s]?.label || s}</option>
                ))}
              </select>
              <select
                className="input-field w-auto text-sm"
                value={productFilter}
                onChange={(e) => { setProductFilter(e.target.value); setPage(1); }}
              >
                {PRODUCT_FILTER_OPTIONS.map((p) => (
                  <option key={`product-filter-${p.value}`} value={p.value}>{p.label}</option>
                ))}
              </select>
              <div className="relative">
                <button
                  className="flex items-center gap-1.5 px-3 py-2 bg-[hsl(var(--primary))] text-white rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity"
                  onClick={() => setShowExportMenu(!showExportMenu)}
                >
                  <FileText size={14} />
                  تصدير
                </button>
                {showExportMenu && (
                  <div className="absolute left-0 top-full mt-1 bg-white border border-[hsl(var(--border))] rounded-xl shadow-lg z-20 min-w-[160px] overflow-hidden">
                    <button
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-[hsl(var(--muted))] transition-colors text-right"
                      onClick={() => { exportToCSV(filtered); setShowExportMenu(false); }}
                    >
                      📊 تصدير Excel (CSV)
                    </button>
                    <button
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-[hsl(var(--muted))] transition-colors text-right border-t border-[hsl(var(--border))]"
                      onClick={() => { exportToPDF(filtered); setShowExportMenu(false); }}
                    >
                      📄 تصدير PDF
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
          {/* Date range filter */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-[hsl(var(--muted-foreground))] font-semibold">فلتر التاريخ:</span>
            <div className="flex items-center gap-2">
              <label className="text-xs text-[hsl(var(--muted-foreground))]">من</label>
              <input
                type="date"
                className="input-field w-auto text-sm py-1.5"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                dir="ltr"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-[hsl(var(--muted-foreground))]">إلى</label>
              <input
                type="date"
                className="input-field w-auto text-sm py-1.5"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                dir="ltr"
              />
            </div>
            {(dateFrom || dateTo) && (
              <button className="text-xs text-red-500 hover:underline" onClick={() => { setDateFrom(''); setDateTo(''); setPage(1); }}>مسح</button>
            )}
            <span className="text-xs text-[hsl(var(--muted-foreground))] mr-auto">{filtered.length} نتيجة</span>
          </div>
        </div>

        {/* Bulk action bar */}
        {selectedRows.size > 0 && (
          <div className="bg-[hsl(var(--primary))] text-white px-4 py-3 flex items-center justify-between slide-up">
            <span className="text-sm font-semibold">تم تحديد {selectedRows.size} أوردر</span>
            <div className="flex gap-2">
              <button className="bg-white/20 hover:bg-white/30 text-white text-xs px-3 py-1.5 rounded-lg transition-colors font-medium">تحديث الحالة</button>
              <button
                className="bg-white/20 hover:bg-white/30 text-white text-xs px-3 py-1.5 rounded-lg transition-colors font-medium"
                onClick={() => exportToCSV(allOrders.filter(o => selectedRows.has(o.id)))}
              >
                تصدير المحدد
              </button>
              <button className="bg-red-500/80 hover:bg-red-600 text-white text-xs px-3 py-1.5 rounded-lg transition-colors font-medium">حذف المحدد</button>
              <button className="bg-white/20 hover:bg-white/30 text-white text-xs px-3 py-1.5 rounded-lg transition-colors font-medium" onClick={() => setSelectedRows(new Set())}>إلغاء التحديد</button>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[1000px]">
            <thead>
              <tr className="border-b border-[hsl(var(--border))]">
                <th className="table-header w-10">
                  <input type="checkbox" checked={selectedRows.size === paginated.length && paginated.length > 0} onChange={toggleAll} className="w-4 h-4 rounded" aria-label="تحديد الكل" />
                </th>
                <th className="table-header cursor-pointer hover:bg-[hsl(var(--border))] transition-colors" onClick={() => handleSort('orderNum')}>
                  <div className="flex items-center gap-1">رقم الأوردر <SortIcon field="orderNum" /></div>
                </th>
                <th className="table-header">المسجِّل</th>
                <th className="table-header cursor-pointer hover:bg-[hsl(var(--border))] transition-colors" onClick={() => handleSort('customer')}>
                  <div className="flex items-center gap-1">العميل <SortIcon field="customer" /></div>
                </th>
                <th className="table-header">الموبايل</th>
                <th className="table-header cursor-pointer hover:bg-[hsl(var(--border))] transition-colors" onClick={() => handleSort('region')}>
                  <div className="flex items-center gap-1">المنطقة <SortIcon field="region" /></div>
                </th>
                <th className="table-header">المنتجات</th>
                <th className="table-header cursor-pointer hover:bg-[hsl(var(--border))] transition-colors" onClick={() => handleSort('total')}>
                  <div className="flex items-center gap-1">الإجمالي <SortIcon field="total" /></div>
                </th>
                <th className="table-header cursor-pointer hover:bg-[hsl(var(--border))] transition-colors" onClick={() => handleSort('status')}>
                  <div className="flex items-center gap-1">الحالة <SortIcon field="status" /></div>
                </th>
                <th className="table-header cursor-pointer hover:bg-[hsl(var(--border))] transition-colors" onClick={() => handleSort('date')}>
                  <div className="flex items-center gap-1">التاريخ <SortIcon field="date" /></div>
                </th>
                <th className="table-header">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[hsl(var(--border))]">
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={11} className="text-center py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-14 h-14 bg-[hsl(var(--muted))] rounded-2xl flex items-center justify-center">
                        <CheckSquare size={28} className="text-[hsl(var(--muted-foreground))]" />
                      </div>
                      <p className="text-base font-semibold text-[hsl(var(--foreground))]">لا توجد أوردرات</p>
                      <p className="text-sm text-[hsl(var(--muted-foreground))]">لم يتم العثور على أوردرات بهذه المعايير.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                paginated.map((order) => {
                  const st = STATUS_MAP[order.status] || STATUS_MAP['new'];
                  const isSelected = selectedRows.has(order.id);
                  return (
                    <tr key={order.id} className={`transition-colors duration-150 group ${isSelected ? 'bg-blue-50' : 'hover:bg-[hsl(var(--muted))]/50'}`}>
                      <td className="table-cell w-10">
                        <input type="checkbox" checked={isSelected} onChange={() => toggleRow(order.id)} className="w-4 h-4 rounded" aria-label={`تحديد أوردر ${order.orderNum}`} />
                      </td>
                      <td className="table-cell">
                        <span className="font-mono text-xs font-bold text-[hsl(var(--primary))]">{order.orderNum}</span>
                      </td>
                      <td className="table-cell">
                        <p className="text-xs font-medium">{order.createdBy}</p>
                      </td>
                      <td className="table-cell">
                        <div>
                          <p className="font-semibold text-sm">{order.customer}</p>
                          {order.notes && (
                            <p className="text-[10px] text-amber-600 truncate max-w-[140px]" title={order.notes}>
                              ملاحظة: {order.notes}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="table-cell">
                        <div>
                          <p className="text-sm font-mono">{order.phone}</p>
                          {order.phone2 && <p className="text-xs text-[hsl(var(--muted-foreground))] font-mono">{order.phone2}</p>}
                        </div>
                      </td>
                      <td className="table-cell">
                        <div>
                          <span className="text-sm bg-[hsl(var(--muted))] px-2 py-0.5 rounded-lg text-[hsl(var(--foreground))] font-medium">{order.region}</span>
                          {order.district && <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-0.5">{order.district}</p>}
                        </div>
                      </td>
                      <td className="table-cell max-w-[160px]">
                        <p className="text-sm truncate" title={order.products}>{order.products}</p>
                        <p className="text-xs text-[hsl(var(--muted-foreground))]">{order.quantity} قطعة</p>
                      </td>
                      <td className="table-cell">
                        <div>
                          <p className="font-bold font-mono text-sm">{order.total.toLocaleString('en-US')} ج.م</p>
                          <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
                            {order.expressShipping ? 'شحن سريع' : 'شحن'}: {order.shippingFee} ج.م
                          </p>
                        </div>
                      </td>
                      <td className="table-cell">
                        <button className={`badge ${st.cls} cursor-pointer hover:opacity-80 transition-opacity`} onClick={() => setStatusModal({ order })} title="انقر لتغيير الحالة">
                          {st.label}
                        </button>
                      </td>
                      <td className="table-cell">
                        <div>
                          <p className="text-xs font-medium">{order.date}</p>
                          <p className="text-[10px] text-[hsl(var(--muted-foreground))] font-mono">{order.time}</p>
                        </div>
                      </td>
                      <td className="table-cell">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                          <button onClick={() => setDetailModal({ order })} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-blue-50 text-blue-600 transition-colors" title="عرض التفاصيل">
                            <Eye size={14} />
                          </button>
                          <button onClick={() => setAuditModal({ order })} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-amber-50 text-amber-600 transition-colors" title="سجل التعديلات">
                            <History size={14} />
                          </button>
                          <button onClick={() => setDetailModal({ order })} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-green-50 text-green-600 transition-colors" title="عرض الفاتورة PDF">
                            <FileText size={14} />
                          </button>
                          {isAdmin && (
                            <button onClick={() => setDeleteModal({ order })} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-red-500 transition-colors" title="حذف الأوردر">
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-4 py-3 border-t border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30">
          <div className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
            <span>عرض</span>
            <select className="input-field w-auto text-sm py-1" value={perPage} onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }}>
              {[5, 8, 10, 20, 50].map((n) => <option key={`perpage-${n}`} value={n}>{n}</option>)}
            </select>
            <span>من {filtered.length} أوردر</span>
          </div>
          <div className="flex items-center gap-1">
            <button className="w-8 h-8 flex items-center justify-center rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-40 disabled:cursor-not-allowed transition-colors" onClick={() => setPage(1)} disabled={page === 1} aria-label="الصفحة الأولى"><ChevronRight size={14} /></button>
            <button className="w-8 h-8 flex items-center justify-center rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-40 disabled:cursor-not-allowed transition-colors" onClick={() => setPage(page - 1)} disabled={page === 1} aria-label="الصفحة السابقة"><ChevronRight size={14} /></button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              const pageNum = i + 1;
              return (
                <button key={`page-btn-${pageNum}`} className={`w-8 h-8 flex items-center justify-center rounded-lg border text-sm font-semibold transition-colors ${page === pageNum ? 'bg-[hsl(var(--primary))] text-white border-[hsl(var(--primary))]' : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]'}`} onClick={() => setPage(pageNum)}>{pageNum}</button>
              );
            })}
            <button className="w-8 h-8 flex items-center justify-center rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-40 disabled:cursor-not-allowed transition-colors" onClick={() => setPage(page + 1)} disabled={page === totalPages || totalPages === 0} aria-label="الصفحة التالية"><ChevronLeft size={14} /></button>
            <button className="w-8 h-8 flex items-center justify-center rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-40 disabled:cursor-not-allowed transition-colors" onClick={() => setPage(totalPages)} disabled={page === totalPages || totalPages === 0} aria-label="الصفحة الأخيرة"><ChevronLeft size={14} /></button>
          </div>
        </div>
      </div>

      {statusModal && <StatusUpdateModal order={statusModal.order} onClose={() => setStatusModal(null)} />}
      {detailModal && <OrderDetailModal order={detailModal.order} onClose={() => setDetailModal(null)} />}
      {auditModal && <AuditLogModal orderId={auditModal.order.id} orderNum={auditModal.order.orderNum} onClose={() => setAuditModal(null)} />}
      {showSupplyModal && selectedDelegate && (
        <SupplyModal
          delegate={selectedDelegate}
          maxAmount={delegateAmountDue}
          onClose={() => setShowSupplyModal(false)}
          onConfirm={handleSupplyConfirm}
        />
      )}
      {deleteModal && (
        <DeleteConfirmModal
          order={deleteModal.order}
          onClose={() => !isDeleting && setDeleteModal(null)}
          onConfirm={() => handleDeleteOrder(deleteModal.order)}
          isDeleting={isDeleting}
        />
      )}
    </>
  );
}