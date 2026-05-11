'use client';
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import {
  Search,
  ChevronDown,
  ChevronUp,
  Eye,
  Trash2,
  FileText,
  ChevronRight,
  ChevronLeft,
  CheckSquare,
  TrendingUp,
  DollarSign,
  Truck,
  ArrowDownCircle,
  History,
  Zap,
} from 'lucide-react';
import { toast, Toaster } from 'sonner';
import StatusUpdateModal from './StatusUpdateModal';
// Phase 20B QW-A: OrderDetailModal (~1,286 lines) and AuditLogModal (~303
// lines) only render after the user clicks a row / opens audit history.
// next/dynamic puts each in its own lazy chunk so the initial
// /orders-management JS no longer pays for them on first load.
// StatusUpdateModal stays statically imported — it's smaller, frequently
// reached, and StatusUpdateModal pulls audit helpers from AuditLogModal
// via static named-export imports (re-exporting helpers would be a
// refactor outside this PR's scope).
const OrderDetailModal = dynamic(() => import('./OrderDetailModal'), { ssr: false });
const AuditLogModal = dynamic(() => import('./AuditLogModal'), { ssr: false });
import { createClient } from '@/lib/supabase/client';
import { useAuth, getPermissionsForRoleId } from '@/contexts/AuthContext';
import { canBulkManageOrders } from '@/lib/constants/roles';
// Phase 25A — surface a small badge next to the order status when one
// or more return / exchange adjustments are open against the order.
import {
  ADJUSTMENT_KIND_SHORT_AR,
  ADJUSTMENT_KIND_TONE,
  ADJUSTMENT_STATE_LABEL_AR,
  ADJUSTMENT_STATE_TONE,
  type AdjustmentKind,
  type AdjustmentState,
} from '@/lib/orders/orderAdjustments';

/**
 * Per-order summary derived from `turath_masr_order_adjustments`. We
 * lift only the active (non-terminal) adjustments into the row badge
 * — terminal `rejected` and `cancelled` rows live in the OrderDetail
 * modal but don't deserve a noisy table-level badge.
 */
interface AdjustmentRowSummary {
  total: number;
  highlight?: { kind: AdjustmentKind; state: AdjustmentState };
}

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
  // Phase 22N-Fix3 — optional neighborhood / village / shiakha.
  // NULL for orders created before the column existed.
  neighborhood?: string | null;
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
  { value: 'حامل مصحف', label: 'حامل مصحف' },
  { value: 'كشاف', label: 'كشاف' },
  { value: 'كرسي', label: 'كرسي' },
  { value: 'مصحف', label: 'مصحف' },
  { value: 'كعبة', label: 'كعبة' },
];

const MOCK_DEPOSITS: Record<
  string,
  { deposited: number; deposits: { amount: number; date: string; note: string }[] }
> = {};

type SortField = 'orderNum' | 'customer' | 'region' | 'total' | 'status' | 'date';
type SortDir = 'asc' | 'desc';

function parseDateStr(dateStr: string): Date {
  const parts = dateStr.split('/').map(Number);
  return new Date(parts[2], parts[1] - 1, parts[0]);
}

function exportToCSV(orders: Order[]) {
  const headers = [
    'رقم الأوردر',
    'العميل',
    'الموبايل',
    'المنطقة',
    'المنطقة الفرعية',
    'المنتجات',
    'الكمية',
    'المنتجات (ج.م)',
    'الشحن (ج.م)',
    'الإجمالي (ج.م)',
    'الحالة',
    'التاريخ',
    'الوقت',
    'المسجل',
    'المندوب',
  ];
  const rows = orders.map((o) => [
    o.orderNum,
    o.customer,
    o.phone,
    o.region,
    o.district || '',
    o.products,
    o.quantity,
    o.subtotal,
    o.shippingFee,
    o.total,
    STATUS_MAP[o.status]?.label || o.status,
    o.date,
    o.time,
    o.createdBy,
    o.delegateName || '',
  ]);
  const csvContent =
    '\uFEFF' + [headers, ...rows].map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `turath_masr-orders-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportToPDF(orders: Order[]) {
  const win = window.open('', '_blank', 'width=1000,height=700');
  if (!win) {
    alert('يرجى السماح بالنوافذ المنبثقة في إعدادات المتصفح');
    return;
  }
  const rows = orders
    .map(
      (o) => `
    <tr>
      <td>${o.orderNum}</td>
      <td>${o.customer}</td>
      <td>${o.phone}</td>
      <td>${o.region}${o.district ? ' - ' + o.district : ''}${o.neighborhood ? ' - ' + o.neighborhood : ''}</td>
      <td>${o.products}</td>
      <td>${o.quantity}</td>
      <td>${o.total.toLocaleString('en-US')} ج.م</td>
      <td>${STATUS_MAP[o.status]?.label || o.status}</td>
      <td>${o.date} ${o.time}</td>
    </tr>
  `
    )
    .join('');
  win.document.write(`
    <!DOCTYPE html><html dir="rtl" lang="ar">
    <head><meta charset="UTF-8"><title>تقرير الأوردرات - Turath Masr</title>
    <style>
      body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;direction:rtl;padding:20px;font-size:12px;}
      h1{font-size:20px;margin-bottom:4px;color:#1e3a5f;}
      p.sub{color:#6b7280;margin-bottom:16px;font-size:12px;}
      table{width:100%;border-collapse:collapse;}
      th{background:#1e3a5f;color:white;padding:8px 10px;text-align:right;font-size:11px;}
      td{padding:7px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;}
      tr:nth-child(even){background:#f9fafb;}
    </style></head>
    <body>
      <h1>Turath Masr - تقرير الأوردرات</h1>
      <p class="sub">تاريخ التصدير: ${new Date().toLocaleDateString('en-US')} - إجمالي: ${orders.length} أوردر</p>
      <table>
        <thead><tr><th>رقم الأوردر</th><th>العميل</th><th>الموبايل</th><th>المنطقة</th><th>المنتجات</th><th>الكمية</th><th>الإجمالي</th><th>الحالة</th><th>التاريخ والوقت</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </body></html>
  `);
  win.document.close();
}

export default function OrdersTableSection() {
  const [search, setSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState('الكل');
  const [statusFilter, setStatusFilter] = useState('الكل');
  const [productFilter, setProductFilter] = useState('الكل');
  // Phase 25B — filter by adjustment type (all / parent / return-child /
  // exchange-child). Operates purely on the order_num pattern so we
  // don't need to JOIN the adjustments table.
  const [adjustmentFilter, setAdjustmentFilter] = useState<
    'all' | 'parents' | 'returns' | 'exchanges'
  >('all');
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
  const [bulkStatusModal, setBulkStatusModal] = useState(false);
  const [bulkNewStatus, setBulkNewStatus] = useState('preparing');
  const [showDelegateStats, setShowDelegateStats] = useState(false);
  const [selectedDelegate, setSelectedDelegate] = useState('');
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [liveUpdateCount, setLiveUpdateCount] = useState(0);
  const [lastUpdateTime, setLastUpdateTime] = useState<string | null>(null);
  // Phase 25A — order_id → summary of active adjustments
  const [adjustmentMap, setAdjustmentMap] = useState<Record<string, AdjustmentRowSummary>>({});

  // --- صلاحيات المستخدم (من AuthContext - المصدر الموثوق) ---
  const { user, currentRoleId, customPermissions: authPermissions } = useAuth();
  const canManageOrders = (() => {
    if (canBulkManageOrders(currentRoleId)) return true;
    const perms = Array.isArray(authPermissions)
      ? authPermissions
      : getPermissionsForRoleId(currentRoleId || '');
    return (
      perms.includes('orders_manage') ||
      perms.includes('edit_orders') ||
      perms.includes('delete_orders')
    );
  })();
  const canViewDelegates = (() => {
    if (canBulkManageOrders(currentRoleId)) return true;
    const perms = Array.isArray(authPermissions)
      ? authPermissions
      : getPermissionsForRoleId(currentRoleId || '');
    return (
      perms.includes('view_delegates') ||
      perms.includes('manage_shipping') ||
      perms.includes('assign_courier')
    );
  })();

  const loadOrders = useCallback(async () => {
    try {
      const supabase = createClient();
      // Phase 20C-1: replaced select('*') with an explicit list of columns
      // the row mapper actually consumes. Skipped fields with no
      // wire/render value (notably the `lines` jsonb — kilobytes per row).
      //
      // Phase 20C-1 hotfix: removed `ip` from the list. The column does
      // NOT exist in turath_masr_orders (the real column is
      // `created_by_ip`); under select('*') the mapper's `row.ip` was
      // silently `undefined` and the `|| ''` fallback masked it. With an
      // explicit list, Postgres rejects the entire query with
      // `42703: column "ip" does not exist` (400), the `if (error)` arm
      // below returns early, and allOrders never populates — so the table
      // appeared "stuck for minutes" until a hard refresh. The mapper at
      // line below still does `ip: row.ip || ''` and continues to produce
      // `''` (the field is genuinely never populated for any row), so
      // behaviour is identical to pre-PR-#14.
      const { data, error } = await supabase
        .from('turath_masr_orders')
        .select(
          // Phase 22N-Fix3 — added `neighborhood` to the explicit select
          // list so the new column flows through the OrdersTable +
          // OrderDetailModal renders. Legacy rows missing the column
          // simply come back as `null`.
          'id, order_num, created_by, created_by_device, customer, phone, phone2, region, district, neighborhood, address, products, quantity, subtotal, shipping_fee, extra_shipping_fee, express_shipping, total, status, date, time, day, notes, delegate_name, created_at'
        )
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Supabase fetch error:', error);
        return;
      }

      if (data) {
        const supabaseOrders = (data as Record<string, any>[]).map((row) => ({
          id: row.id,
          orderNum: row.order_num,
          createdBy: row.created_by || '',
          createdByDevice: row.created_by_device || '',
          customer: row.customer,
          phone: row.phone,
          phone2: row.phone2 || undefined,
          region: row.region,
          district: row.district || undefined,
          neighborhood: row.neighborhood ?? null,
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
        setAllOrders(supabaseOrders);
      }
    } catch (err) {
      console.error('Error loading orders:', err);
    }
  }, []);

  // Phase 25A — pull active adjustment summaries so the table can
  // render the small مرتجع / استبدال chip next to the status badge.
  // Falls back silently if the table doesn't exist yet (migration
  // staged but not applied in this environment).
  const loadAdjustmentSummaries = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('turath_masr_order_adjustments')
        .select('order_id, kind, state')
        .in('state', ['pending', 'approved', 'completed']);
      if (error || !data) {
        return;
      }
      const acc: Record<string, AdjustmentRowSummary> = {};
      // Priority: completed > approved > pending — we surface the
      // "freshest" terminal-ish state that still warrants a badge.
      // Within the loop the *last* qualifying entry wins; we order
      // the priority via a numeric weight.
      const weight: Record<string, number> = {
        completed: 3,
        approved: 2,
        pending: 1,
      };
      for (const row of data as {
        order_id: string;
        kind: AdjustmentKind;
        state: AdjustmentState;
      }[]) {
        const existing = acc[row.order_id];
        if (!existing) {
          acc[row.order_id] = { total: 1, highlight: { kind: row.kind, state: row.state } };
          continue;
        }
        existing.total += 1;
        const newWeight = weight[row.state] ?? 0;
        const oldWeight = existing.highlight ? (weight[existing.highlight.state] ?? 0) : 0;
        if (newWeight > oldWeight) {
          existing.highlight = { kind: row.kind, state: row.state };
        }
      }
      setAdjustmentMap(acc);
    } catch (err) {
      console.info('[OrdersTableSection] adjustments summary skipped:', err);
    }
  }, []);

  useEffect(() => {
    loadOrders();
    loadAdjustmentSummaries();
    const handleUpdate = () => {
      loadOrders();
      loadAdjustmentSummaries();
      setLiveUpdateCount((prev) => prev + 1);
      setLastUpdateTime(
        new Date().toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      );
    };
    const handleAdjustments = () => {
      loadAdjustmentSummaries();
    };
    window.addEventListener('turath_masr_orders_updated', handleUpdate);
    window.addEventListener('turath_masr_order_adjustments_updated', handleAdjustments);
    // Supabase Realtime subscription — fires handleUpdate on every
    // INSERT/UPDATE/DELETE, which already triggers a full refresh of the
    // orders table.
    //
    // Phase 20C-1: removed the 120-second `setInterval(loadOrders, 120000)`
    // fallback. With realtime + the window event listener (used by other
    // components after their own writes), polling was a third redundant
    // refresh path that re-shipped the entire orders payload every 2
    // minutes regardless of whether anything changed. supabase-js
    // auto-reconnects realtime on transient drops; the manual refresh
    // button at OrdersHeader.tsx:84 is the user-facing escape hatch.
    const supabase = createClient();
    const channel = supabase
      .channel('orders-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'turath_masr_orders',
        },
        () => {
          handleUpdate();
        }
      )
      .subscribe();
    return () => {
      window.removeEventListener('turath_masr_orders_updated', handleUpdate);
      window.removeEventListener('turath_masr_order_adjustments_updated', handleAdjustments);
      supabase.removeChannel(channel);
    };
  }, [loadOrders, loadAdjustmentSummaries]);

  const handleBulkDelete = async () => {
    if (selectedRows.size === 0) return;
    const confirmed = window.confirm(`هل أنت متأكد من حذف ${selectedRows.size} أوردر؟`);
    if (!confirmed) return;
    try {
      const supabase = createClient();
      const idsToDelete = Array.from(selectedRows);
      const { error } = await supabase.from('turath_masr_orders').delete().in('id', idsToDelete);
      if (error) throw error;
      toast.success(`تم حذف ${selectedRows.size} أوردر بنجاح`);
      setSelectedRows(new Set());
      loadOrders();
      window.dispatchEvent(new CustomEvent('turath_masr_orders_updated'));
    } catch (err) {
      console.error('Bulk delete error:', err);
      toast.error('حدث خطأ أثناء حذف الأوردرات');
    }
  };

  const handleBulkStatusUpdate = async (newStatus: string) => {
    if (selectedRows.size === 0) return;
    try {
      const supabase = createClient();
      const idsToUpdate = Array.from(selectedRows);
      // Add updated_by traceability for the orders_editor_update RLS policy.
      const updatePayload: Record<string, unknown> = { status: newStatus };
      if (user?.id) {
        updatePayload.updated_by = user.id;
      }
      const { error } = await supabase
        .from('turath_masr_orders')
        .update(updatePayload)
        .in('id', idsToUpdate);
      if (error) throw error;
      const statusLabel = STATUS_MAP[newStatus]?.label || newStatus;
      toast.success(`تم تحديث ${selectedRows.size} أوردر إلى: ${statusLabel}`);
      setSelectedRows(new Set());
      setBulkStatusModal(false);
      loadOrders();
      window.dispatchEvent(new CustomEvent('turath_masr_orders_updated'));
    } catch (err) {
      console.error('Bulk status update error:', err);
      toast.error('حدث خطأ أثناء تحديث حالة الأوردرات');
    }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const filtered = useMemo(() => {
    return allOrders
      .filter((o) => {
        const matchSearch =
          !search ||
          o.customer.includes(search) ||
          o.orderNum.includes(search) ||
          o.phone.includes(search);
        const matchRegion = regionFilter === 'الكل' || o.region === regionFilter;
        const matchStatus = statusFilter === 'الكل' || o.status === statusFilter;
        const matchProduct = productFilter === 'الكل' || o.products.includes(productFilter);
        // Phase 25B — adjustment filter (parents vs return-child vs exchange-child)
        const childMatch = o.orderNum.match(/-([RE])\d+$/);
        const isReturnChild = childMatch?.[1] === 'R';
        const isExchangeChild = childMatch?.[1] === 'E';
        const matchAdjustment =
          adjustmentFilter === 'all' ||
          (adjustmentFilter === 'parents' && !childMatch) ||
          (adjustmentFilter === 'returns' && isReturnChild) ||
          (adjustmentFilter === 'exchanges' && isExchangeChild);
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
        return (
          matchSearch && matchRegion && matchStatus && matchProduct && matchDate && matchAdjustment
        );
      })
      .sort((a, b) => {
        let cmp = 0;
        if (sortField === 'orderNum') cmp = a.orderNum.localeCompare(b.orderNum);
        else if (sortField === 'customer') cmp = a.customer.localeCompare(b.customer);
        else if (sortField === 'region') cmp = a.region.localeCompare(b.region);
        else if (sortField === 'total') cmp = a.total - b.total;
        else if (sortField === 'status') cmp = a.status.localeCompare(b.status);
        else if (sortField === 'date')
          cmp = parseDateStr(a.date).getTime() - parseDateStr(b.date).getTime();
        return sortDir === 'asc' ? cmp : -cmp;
      });
  }, [
    allOrders,
    search,
    regionFilter,
    statusFilter,
    dateFrom,
    dateTo,
    sortField,
    sortDir,
    productFilter,
    adjustmentFilter,
  ]);

  const totalPages = Math.ceil(filtered.length / perPage);
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  const toggleRow = (id: string) => {
    const s = new Set(selectedRows);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setSelectedRows(s);
  };

  const toggleAll = () => {
    if (selectedRows.size === paginated.length) setSelectedRows(new Set());
    else setSelectedRows(new Set(paginated.map((o) => o.id)));
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ChevronDown size={12} className="opacity-30" />;
    return sortDir === 'asc' ? (
      <ChevronUp size={12} className="text-[hsl(var(--primary))]" />
    ) : (
      <ChevronDown size={12} className="text-[hsl(var(--primary))]" />
    );
  };

  const statusOptions = ['الكل', ...Object.keys(STATUS_MAP)];
  const delegates = [...new Set(allOrders.map((o) => o.delegateName).filter(Boolean))] as string[];

  const currentDelegate = selectedDelegate || delegates[0] || '';
  const delegateOrders = allOrders.filter(
    (o) => o.delegateName === currentDelegate && ['shipping', 'delivered'].includes(o.status)
  );
  const delegateTotalOrders = delegateOrders.length;
  const delegateTotalValue = delegateOrders.reduce((s, o) => s + o.total, 0);
  const delegateShippingIncome = delegateOrders.reduce((s, o) => s + o.shippingFee, 0);
  const delegateExtraFees = delegateOrders.reduce((s, o) => s + (o.extraShippingFee || 0), 0);
  const delegateNetIncome = delegateShippingIncome - delegateExtraFees;
  const depositInfo = MOCK_DEPOSITS[currentDelegate] || { deposited: 0, deposits: [] };
  const delegateAmountDue = delegateTotalValue - depositInfo.deposited;

  return (
    <>
      <Toaster position="top-center" richColors />
      <div className="card-section overflow-hidden">
        {/* Live updates indicator - للمخولين فقط */}
        {canManageOrders && liveUpdateCount > 0 && (
          <div className="flex items-center gap-2 px-4 py-2 bg-green-50 border-b border-green-200 fade-in">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <Zap size={13} className="text-green-600" />
            <span className="text-xs text-green-700 font-semibold">تحديث لحظي نشط</span>
            {lastUpdateTime && (
              <span className="text-xs text-green-600 mr-auto">آخر تحديث: {lastUpdateTime}</span>
            )}
          </div>
        )}

        {/* Delegate Stats Panel - للمخولين فقط */}
        {canViewDelegates && (
          <div className="border-b border-[hsl(var(--border))]">
            <button
              onClick={() => setShowDelegateStats(!showDelegateStats)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-[hsl(var(--muted))]/30 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Truck size={16} className="text-[hsl(var(--primary))]" />
                <span className="text-sm font-bold text-[hsl(var(--foreground))]">
                  إحصائيات المندوبين والتوريدات
                </span>
              </div>
              <ChevronDown
                size={16}
                className={`text-[hsl(var(--muted-foreground))] transition-transform ${showDelegateStats ? 'rotate-180' : ''}`}
              />
            </button>

            {showDelegateStats && (
              <div className="px-4 pb-4 space-y-4 fade-in">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-xs font-semibold text-[hsl(var(--muted-foreground))]">
                    المندوب:
                  </span>
                  <div className="flex gap-2 flex-wrap">
                    {delegates.map((d) => (
                      <button
                        key={d}
                        onClick={() => setSelectedDelegate(d)}
                        className={`text-xs px-3 py-1.5 rounded-xl font-semibold transition-all border ${currentDelegate === d ? 'bg-[hsl(var(--primary))] text-white border-[hsl(var(--primary))]' : 'border-[hsl(var(--border))] hover:border-[hsl(var(--primary))]/50'}`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Truck size={13} className="text-blue-600" />
                      <p className="text-[11px] font-semibold text-blue-700">اوردرات مشحونة</p>
                    </div>
                    <p className="text-xl font-bold font-mono text-blue-800">
                      {delegateTotalOrders}
                    </p>
                  </div>
                  <div className="bg-green-50 border border-green-100 rounded-xl p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <DollarSign size={13} className="text-green-600" />
                      <p className="text-[11px] font-semibold text-green-700">إجمالي القيمة</p>
                    </div>
                    <p className="text-xl font-bold font-mono text-green-800">
                      {delegateTotalValue.toLocaleString('en-US')}{' '}
                      <span className="text-xs">ج.م</span>
                    </p>
                  </div>
                  <div className="bg-purple-50 border border-purple-100 rounded-xl p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <TrendingUp size={13} className="text-purple-600" />
                      <p className="text-[11px] font-semibold text-purple-700">صافي دخل الشحن</p>
                    </div>
                    <p className="text-xl font-bold font-mono text-purple-800">
                      {delegateNetIncome.toLocaleString('en-US')}{' '}
                      <span className="text-xs">ج.م</span>
                    </p>
                    {delegateExtraFees > 0 && (
                      <p className="text-[10px] text-orange-600 mt-0.5">
                        بعد خصم {delegateExtraFees} ج.م مصاريف إضافية
                      </p>
                    )}
                  </div>
                  <div className="bg-red-50 border border-red-100 rounded-xl p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <ArrowDownCircle size={13} className="text-red-600" />
                      <p className="text-[11px] font-semibold text-red-700">المطلوب توريده</p>
                    </div>
                    <p className="text-xl font-bold font-mono text-red-800">
                      {delegateAmountDue.toLocaleString('en-US')}{' '}
                      <span className="text-xs">ج.م</span>
                    </p>
                  </div>
                </div>
                <div className="border border-[hsl(var(--border))] rounded-xl p-3">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <ArrowDownCircle size={14} className="text-[hsl(var(--primary))]" />
                      <span className="text-sm font-bold">
                        التوريدات النقدية - {currentDelegate}
                      </span>
                    </div>
                    <div className="flex gap-3 text-xs">
                      <span className="bg-green-50 text-green-700 px-2 py-1 rounded-lg font-semibold">
                        تم توريده: {depositInfo.deposited.toLocaleString('en-US')} ج.م
                      </span>
                      <span className="bg-red-50 text-red-700 px-2 py-1 rounded-lg font-semibold">
                        المتبقي: {delegateAmountDue.toLocaleString('en-US')} ج.م
                      </span>
                    </div>
                  </div>
                  {depositInfo.deposits.length === 0 ? (
                    <p className="text-xs text-[hsl(var(--muted-foreground))] text-center py-2">
                      لا توجد توريدات مسجلة
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {depositInfo.deposits.map((dep, i) => (
                        <div
                          key={`dep-${i}`}
                          className="flex items-center justify-between text-xs bg-[hsl(var(--muted))]/30 rounded-lg px-3 py-2"
                        >
                          <span className="font-semibold">{dep.note}</span>
                          <span className="text-[hsl(var(--muted-foreground))]">{dep.date}</span>
                          <span className="font-mono font-bold text-green-700">
                            + {dep.amount.toLocaleString('en-US')} ج.م
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Filters */}
        <div className="p-4 border-b border-[hsl(var(--border))] space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search
                size={16}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]"
              />
              <input
                type="text"
                className="input-field pr-9"
                placeholder="بحث بالاسم، رقم الأوردر، أو الموبايل..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              <select
                className="input-field w-auto text-sm"
                value={regionFilter}
                onChange={(e) => {
                  setRegionFilter(e.target.value);
                  setPage(1);
                }}
              >
                {REGIONS.map((r) => (
                  <option key={`region-filter-${r}`} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <select
                className="input-field w-auto text-sm"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
              >
                {statusOptions.map((s) => (
                  <option key={`status-filter-${s}`} value={s}>
                    {s === 'الكل' ? 'كل الحالات' : STATUS_MAP[s]?.label || s}
                  </option>
                ))}
              </select>
              <select
                className="input-field w-auto text-sm"
                value={productFilter}
                onChange={(e) => {
                  setProductFilter(e.target.value);
                  setPage(1);
                }}
              >
                {PRODUCT_FILTER_OPTIONS.map((p) => (
                  <option key={`product-filter-${p.value}`} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
              {/* Phase 25B — adjustment filter */}
              <select
                className="input-field w-auto text-sm"
                value={adjustmentFilter}
                onChange={(e) => {
                  setAdjustmentFilter(
                    e.target.value as 'all' | 'parents' | 'returns' | 'exchanges'
                  );
                  setPage(1);
                }}
              >
                <option value="all">كل الطلبات</option>
                <option value="parents">الطلبات الأصلية فقط</option>
                <option value="returns">طلبات المرتجع</option>
                <option value="exchanges">طلبات الاستبدال</option>
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
                      onClick={() => {
                        exportToCSV(filtered);
                        setShowExportMenu(false);
                      }}
                    >
                      تصدير Excel (CSV)
                    </button>
                    <button
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-[hsl(var(--muted))] transition-colors text-right border-t border-[hsl(var(--border))]"
                      onClick={() => {
                        exportToPDF(filtered);
                        setShowExportMenu(false);
                      }}
                    >
                      تصدير PDF
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-[hsl(var(--muted-foreground))] font-semibold">
              فلتر التاريخ:
            </span>
            <div className="flex items-center gap-2">
              <label className="text-xs text-[hsl(var(--muted-foreground))]">من</label>
              <input
                type="date"
                className="input-field w-auto text-sm py-1.5"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setPage(1);
                }}
                dir="ltr"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-[hsl(var(--muted-foreground))]">إلى</label>
              <input
                type="date"
                className="input-field w-auto text-sm py-1.5"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  setPage(1);
                }}
                dir="ltr"
              />
            </div>
            {(dateFrom || dateTo) && (
              <button
                className="text-xs text-red-500 hover:underline"
                onClick={() => {
                  setDateFrom('');
                  setDateTo('');
                  setPage(1);
                }}
              >
                مسح
              </button>
            )}
            <span className="text-xs text-[hsl(var(--muted-foreground))] mr-auto">
              {filtered.length} نتيجة
            </span>
          </div>
        </div>

        {/* Bulk action bar - للمخولين فقط */}
        {canManageOrders && selectedRows.size > 0 && (
          <div className="bg-[hsl(var(--primary))] text-white px-4 py-3 flex items-center justify-between slide-up">
            <span className="text-sm font-semibold">تم تحديد {selectedRows.size} أوردر</span>
            <div className="flex gap-2">
              <button
                className="bg-white/20 hover:bg-white/30 text-white text-xs px-3 py-1.5 rounded-lg transition-colors font-medium"
                onClick={() => setBulkStatusModal(true)}
              >
                تحديث الحالة
              </button>
              <button
                className="bg-white/20 hover:bg-white/30 text-white text-xs px-3 py-1.5 rounded-lg transition-colors font-medium"
                onClick={() => exportToCSV(allOrders.filter((o) => selectedRows.has(o.id)))}
              >
                تصدير المحدد
              </button>
              <button
                className="bg-red-500/80 hover:bg-red-600 text-white text-xs px-3 py-1.5 rounded-lg transition-colors font-medium"
                onClick={handleBulkDelete}
              >
                حذف المحدد
              </button>
              <button
                className="bg-white/20 hover:bg-white/30 text-white text-xs px-3 py-1.5 rounded-lg transition-colors font-medium"
                onClick={() => setSelectedRows(new Set())}
              >
                إلغاء التحديد
              </button>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[1000px]">
            <thead>
              <tr className="border-b border-[hsl(var(--border))]">
                <th className="table-header w-10">
                  <input
                    type="checkbox"
                    checked={selectedRows.size === paginated.length && paginated.length > 0}
                    onChange={toggleAll}
                    className="w-4 h-4 rounded"
                    aria-label="تحديد الكل"
                  />
                </th>
                <th
                  className="table-header cursor-pointer hover:bg-[hsl(var(--border))] transition-colors"
                  onClick={() => handleSort('orderNum')}
                >
                  <div className="flex items-center gap-1">
                    رقم الأوردر <SortIcon field="orderNum" />
                  </div>
                </th>
                <th className="table-header">المسجل</th>
                <th
                  className="table-header cursor-pointer hover:bg-[hsl(var(--border))] transition-colors"
                  onClick={() => handleSort('customer')}
                >
                  <div className="flex items-center gap-1">
                    العميل <SortIcon field="customer" />
                  </div>
                </th>
                <th className="table-header">الموبايل</th>
                <th
                  className="table-header cursor-pointer hover:bg-[hsl(var(--border))] transition-colors"
                  onClick={() => handleSort('region')}
                >
                  <div className="flex items-center gap-1">
                    المنطقة <SortIcon field="region" />
                  </div>
                </th>
                <th className="table-header">المنتجات</th>
                <th
                  className="table-header cursor-pointer hover:bg-[hsl(var(--border))] transition-colors"
                  onClick={() => handleSort('total')}
                >
                  <div className="flex items-center gap-1">
                    الإجمالي <SortIcon field="total" />
                  </div>
                </th>
                <th
                  className="table-header cursor-pointer hover:bg-[hsl(var(--border))] transition-colors"
                  onClick={() => handleSort('status')}
                >
                  <div className="flex items-center gap-1">
                    الحالة <SortIcon field="status" />
                  </div>
                </th>
                <th
                  className="table-header cursor-pointer hover:bg-[hsl(var(--border))] transition-colors"
                  onClick={() => handleSort('date')}
                >
                  <div className="flex items-center gap-1">
                    التاريخ <SortIcon field="date" />
                  </div>
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
                      <p className="text-base font-semibold text-[hsl(var(--foreground))]">
                        لا توجد أوردرات
                      </p>
                      <p className="text-sm text-[hsl(var(--muted-foreground))]">
                        لم يتم العثور على أوردرات بهذه المعايير.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                paginated.map((order) => {
                  const st = STATUS_MAP[order.status] || STATUS_MAP['new'];
                  const isSelected = selectedRows.has(order.id);
                  return (
                    <tr
                      key={order.id}
                      className={`transition-colors duration-150 group ${isSelected ? 'bg-blue-50' : 'hover:bg-[hsl(var(--muted))]/50'}`}
                    >
                      <td className="table-cell w-10">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRow(order.id)}
                          className="w-4 h-4 rounded"
                          aria-label={`تحديد أوردر ${order.orderNum}`}
                        />
                      </td>
                      <td className="table-cell">
                        <span className="font-mono text-xs font-bold text-[hsl(var(--primary))]">
                          {order.orderNum}
                        </span>
                        {/* Phase 25B — child order chip + parent link */}
                        {(() => {
                          const childMatch = order.orderNum.match(/^(.+)-([RE])(\d+)$/);
                          if (!childMatch) return null;
                          const [, parent, prefix] = childMatch;
                          const isExchange = prefix === 'E';
                          return (
                            <div className="mt-1 flex items-center gap-1 flex-wrap">
                              <span
                                className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${
                                  isExchange
                                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                                    : 'bg-rose-50 text-rose-700 border-rose-200'
                                }`}
                              >
                                {isExchange ? 'طلب استبدال' : 'طلب مرتجع'}
                              </span>
                              <span
                                className="text-[10px] text-[hsl(var(--muted-foreground))]"
                                title={`الطلب الأصلي ${parent}`}
                              >
                                مرتبط بـ #{parent}
                              </span>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="table-cell">
                        <p className="text-xs font-medium">{order.createdBy}</p>
                      </td>
                      <td className="table-cell">
                        <div>
                          <p className="font-semibold text-sm">{order.customer}</p>
                          {order.notes && (
                            <p
                              className="text-[10px] text-amber-600 truncate max-w-[140px]"
                              title={order.notes}
                            >
                              ملاحظة: {order.notes}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="table-cell">
                        <div>
                          <p className="text-sm font-mono">{order.phone}</p>
                          {order.phone2 && (
                            <p className="text-xs text-[hsl(var(--muted-foreground))] font-mono">
                              {order.phone2}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="table-cell">
                        <div>
                          <span className="text-sm bg-[hsl(var(--muted))] px-2 py-0.5 rounded-lg text-[hsl(var(--foreground))] font-medium">
                            {order.region}
                          </span>
                          {order.district && (
                            <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-0.5">
                              {order.district}
                              {order.neighborhood ? ` — ${order.neighborhood}` : ''}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="table-cell max-w-[160px]">
                        <p className="text-sm truncate" title={order.products}>
                          {order.products}
                        </p>
                        <p className="text-xs text-[hsl(var(--muted-foreground))]">
                          {order.quantity} قطعة
                        </p>
                      </td>
                      <td className="table-cell">
                        <div>
                          <p className="font-bold font-mono text-sm">
                            {order.total.toLocaleString('en-US')} ج.م
                          </p>
                          <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
                            {order.expressShipping ? 'شحن سريع' : 'شحن'}: {order.shippingFee} ج.م
                          </p>
                        </div>
                      </td>
                      <td className="table-cell">
                        <button
                          className={`badge ${st.cls} cursor-pointer hover:opacity-80 transition-opacity`}
                          onClick={() => (canManageOrders ? setStatusModal({ order }) : undefined)}
                          title={
                            canManageOrders ? 'انقر لتغيير الحالة' : 'ليس لديك صلاحية تغيير الحالة'
                          }
                        >
                          {st.label}
                        </button>
                        {/* Phase 25A — adjustment chip. Shown only
                            when this order has at least one open
                            (pending / approved / completed) return or
                            exchange. Click does nothing here; the
                            full details live inside OrderDetailModal. */}
                        {adjustmentMap[order.id]?.highlight && (
                          <div className="mt-1 flex items-center gap-1 flex-wrap">
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${
                                ADJUSTMENT_KIND_TONE[adjustmentMap[order.id].highlight!.kind]
                              }`}
                              title={`${ADJUSTMENT_KIND_SHORT_AR[adjustmentMap[order.id].highlight!.kind]} — ${ADJUSTMENT_STATE_LABEL_AR[adjustmentMap[order.id].highlight!.state]}`}
                            >
                              {ADJUSTMENT_KIND_SHORT_AR[adjustmentMap[order.id].highlight!.kind]}
                            </span>
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${
                                ADJUSTMENT_STATE_TONE[adjustmentMap[order.id].highlight!.state]
                              }`}
                            >
                              {ADJUSTMENT_STATE_LABEL_AR[adjustmentMap[order.id].highlight!.state]}
                            </span>
                            {adjustmentMap[order.id].total > 1 && (
                              <span className="text-[9px] text-[hsl(var(--muted-foreground))] font-mono">
                                +{adjustmentMap[order.id].total - 1}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="table-cell">
                        <div>
                          <p className="text-xs font-medium">{order.date}</p>
                          <p className="text-[10px] text-[hsl(var(--muted-foreground))] font-mono">
                            {order.time}
                          </p>
                        </div>
                      </td>
                      <td className="table-cell">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                          <button
                            onClick={() => setDetailModal({ order })}
                            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-blue-50 text-blue-600 transition-colors"
                            title="عرض التفاصيل"
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            onClick={() => setAuditModal({ order })}
                            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-amber-50 text-amber-600 transition-colors"
                            title="سجل التعديلات"
                          >
                            <History size={14} />
                          </button>
                          <button
                            onClick={() => setDetailModal({ order })}
                            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-green-50 text-green-600 transition-colors"
                            title="عرض الفاتورة PDF"
                          >
                            <FileText size={14} />
                          </button>
                          {canManageOrders && (
                            <button
                              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-red-500 transition-colors"
                              title="حذف الأوردر"
                            >
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
            <select
              className="input-field w-auto text-sm py-1"
              value={perPage}
              onChange={(e) => {
                setPerPage(Number(e.target.value));
                setPage(1);
              }}
            >
              {[5, 8, 10, 20, 50].map((n) => (
                <option key={`perpage-${n}`} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span>من {filtered.length} أوردر</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              onClick={() => setPage(1)}
              disabled={page === 1}
              aria-label="الصفحة الأولى"
            >
              <ChevronRight size={14} />
            </button>
            <button
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              onClick={() => setPage(page - 1)}
              disabled={page === 1}
              aria-label="الصفحة السابقة"
            >
              <ChevronRight size={14} />
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              const pageNum = i + 1;
              return (
                <button
                  key={`page-btn-${pageNum}`}
                  className={`w-8 h-8 flex items-center justify-center rounded-lg border text-sm font-semibold transition-colors ${page === pageNum ? 'bg-[hsl(var(--primary))] text-white border-[hsl(var(--primary))]' : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]'}`}
                  onClick={() => setPage(pageNum)}
                >
                  {pageNum}
                </button>
              );
            })}
            <button
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              onClick={() => setPage(page + 1)}
              disabled={page === totalPages || totalPages === 0}
              aria-label="الصفحة التالية"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              onClick={() => setPage(totalPages)}
              disabled={page === totalPages || totalPages === 0}
              aria-label="الصفحة الأخيرة"
            >
              <ChevronLeft size={14} />
            </button>
          </div>
        </div>
      </div>

      {statusModal && (
        <StatusUpdateModal
          order={statusModal.order}
          onClose={() => setStatusModal(null)}
          onUpdate={() => loadOrders()}
        />
      )}
      {detailModal && (
        <OrderDetailModal order={detailModal.order} onClose={() => setDetailModal(null)} />
      )}
      {bulkStatusModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir="rtl">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setBulkStatusModal(false)}
          />
          <div className="relative bg-white rounded-3xl shadow-modal w-full max-w-md p-6 fade-in">
            <h3 className="text-base font-bold text-[hsl(var(--foreground))] mb-4">
              تحديث حالة {selectedRows.size} أوردر
            </h3>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {Object.entries(STATUS_MAP).map(([key, val]) => (
                <button
                  key={key}
                  className={`flex items-center gap-2 p-3 rounded-xl border cursor-pointer transition-all ${bulkNewStatus === key ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5' : 'border-[hsl(var(--border))] hover:border-gray-400'}`}
                  onClick={() => setBulkNewStatus(key)}
                >
                  <span className={`badge ${val.cls} text-[11px]`}>{val.label}</span>
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                className="flex-1 bg-[hsl(var(--primary))] text-white py-2.5 rounded-xl font-bold text-sm hover:opacity-90 transition-opacity"
                onClick={() => handleBulkStatusUpdate(bulkNewStatus)}
              >
                تحديث {selectedRows.size} أوردر
              </button>
              <button
                className="px-4 py-2.5 rounded-xl border border-[hsl(var(--border))] text-sm font-semibold hover:bg-[hsl(var(--muted))] transition-colors"
                onClick={() => setBulkStatusModal(false)}
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
      {auditModal && (
        <AuditLogModal
          orderId={auditModal.order.id}
          orderNum={auditModal.order.orderNum}
          onClose={() => setAuditModal(null)}
        />
      )}
    </>
  );
}
