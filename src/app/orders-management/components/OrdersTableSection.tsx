'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import {
  Search,
  ChevronDown,
  ChevronUp,
  Eye,
  Trash2,
  ChevronRight,
  ChevronLeft,
  CheckSquare,
  TrendingUp,
  DollarSign,
  Truck,
  ArrowDownCircle,
  History,
  RefreshCw,
  Zap,
  Download,
  Wallet,
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
import { usePermissions } from '@/hooks/usePermissions';
import { canBulkManageOrders } from '@/lib/constants/roles';
// Phase Inventory-Reservations-1C — release reservations when an
// order is cancelled / archived from the table. Pulled from the
// shared client helper so the gating (skip if delivered) matches
// EditOrderModal and StatusUpdateModal exactly.
import { writeStaffAuditLog } from '@/lib/security/staffAudit';
import { isDeliveredStatus } from '@/lib/inventory/orderReservationClient';
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
// Phase Orders-Page-Redesign-1 — compact products column shared with
// the dashboard's recent-orders feed.
import { buildOrderProductsSummary } from '@/lib/orders/orderProductsSummary';

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
  /** Phase Orders-Page-Redesign-1 — line-level JSONB used to build
   *  the compact products column. Falls back to `products` text on
   *  legacy rows that pre-date the `lines` column.
   *
   *  Shape mirrors `OrderLine` in `OrderDetailModal` so the rich
   *  modal can consume the same value structurally. Field names
   *  preserve the persisted JSONB keys produced by AddOrderModal /
   *  EditOrderModal. */
  lines?: Array<{
    productType: string;
    label: string;
    image?: string | null;
    image_source?: 'inventory' | 'storage' | 'none';
    image_path?: string | null;
    emoji?: string;
    color?: string | null;
    quantity: number;
    unitPrice: number;
    includeFlashlight?: boolean;
    flashlightPrice?: number;
    note?: string | null;
    total: number;
  }>;
}

interface OrderDbRow {
  id: string;
  order_num: string;
  created_by: string | null;
  created_by_device: string | null;
  customer: string;
  phone: string;
  phone2: string | null;
  region: string;
  district: string | null;
  neighborhood: string | null;
  address: string;
  products: string;
  quantity: number;
  subtotal: number;
  shipping_fee: number;
  extra_shipping_fee: number | null;
  express_shipping: boolean | null;
  total: number;
  status: string;
  date: string;
  time: string;
  day: string | null;
  notes: string | null;
  ip?: string | null;
  delegate_name: string | null;
  created_at: string;
  lines: unknown;
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

const ORDER_SELECT_COLUMNS =
  'id, order_num, created_by, created_by_device, customer, phone, phone2, region, district, neighborhood, address, products, quantity, subtotal, shipping_fee, extra_shipping_fee, express_shipping, total, status, date, time, day, notes, delegate_name, created_at, lines';

const SORT_COLUMN_BY_FIELD: Record<SortField, string> = {
  orderNum: 'order_num',
  customer: 'customer',
  region: 'region',
  total: 'total',
  status: 'status',
  date: 'created_at',
};

function parseDateStr(dateStr: string): Date {
  const parts = dateStr.split('/').map(Number);
  return new Date(parts[2], parts[1] - 1, parts[0]);
}

// Phase Orders-Page-Redesign-1 Fix3 — display helpers for the
// "تاريخ الطلب" cell. The stored values are a DD/MM/YYYY date
// string + a 24-hour HH:MM:SS time string. The cell shows the
// Arabic day-of-week + 12-hour time with صباحًا / مساءً so
// 23:45:06 becomes 11:45 مساءً on the same row.
const ARABIC_DAYS = [
  'الأحد',
  'الاثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
  'السبت',
] as const;

function formatOrderDayLine(dateStr: string): string {
  const parts = dateStr.split('/').map((p) => Number(p));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return dateStr;
  const [dd, mm, yyyy] = parts;
  const d = new Date(yyyy, mm - 1, dd);
  if (Number.isNaN(d.getTime())) return dateStr;
  return `${ARABIC_DAYS[d.getDay()]} ${dateStr}`;
}

function formatOrderTime12h(timeStr: string): string {
  const m = (timeStr ?? '').match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return timeStr;
  const hour24 = Math.max(0, Math.min(23, Number(m[1])));
  const minute = m[2];
  const isPm = hour24 >= 12;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${minute} ${isPm ? 'مساءً' : 'صباحًا'}`;
}

function mapOrderRow(row: OrderDbRow): Order {
  return {
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
    lines: Array.isArray(row.lines) ? (row.lines as Order['lines']) : undefined,
  };
}

function sanitizeSearchTerm(value: string): string {
  return value
    .trim()
    .replace(/[%,()]/g, ' ')
    .replace(/\s+/g, ' ');
}

function dateInputToIsoStart(value: string): string | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function dateInputToIsoExclusiveEnd(value: string): string | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + 1);
  return date.toISOString();
}

function orderMatchesClientFilters(
  order: Order,
  filters: {
    search: string;
    regionFilter: string;
    statusFilter: string;
    productFilter: string;
    adjustmentFilter: 'all' | 'parents' | 'returns' | 'exchanges';
    dateFrom: string;
    dateTo: string;
  }
): boolean {
  const searchTerm = sanitizeSearchTerm(filters.search).toLowerCase();
  const matchSearch =
    !searchTerm ||
    order.customer.toLowerCase().includes(searchTerm) ||
    order.orderNum.toLowerCase().includes(searchTerm) ||
    order.phone.toLowerCase().includes(searchTerm);
  const matchRegion = filters.regionFilter === 'الكل' || order.region === filters.regionFilter;
  const matchStatus = filters.statusFilter === 'الكل' || order.status === filters.statusFilter;
  const matchProduct =
    filters.productFilter === 'الكل' || order.products.includes(filters.productFilter);
  const childMatch = order.orderNum.match(/-([RE])\d+$/);
  const matchAdjustment =
    filters.adjustmentFilter === 'all' ||
    (filters.adjustmentFilter === 'parents' && !childMatch) ||
    (filters.adjustmentFilter === 'returns' && childMatch?.[1] === 'R') ||
    (filters.adjustmentFilter === 'exchanges' && childMatch?.[1] === 'E');
  let matchDate = true;
  if (filters.dateFrom || filters.dateTo) {
    const orderDate = parseDateStr(order.date);
    if (filters.dateFrom) {
      const from = new Date(filters.dateFrom);
      if (orderDate < from) matchDate = false;
    }
    if (filters.dateTo && matchDate) {
      const to = new Date(filters.dateTo);
      to.setHours(23, 59, 59);
      if (orderDate > to) matchDate = false;
    }
  }
  return matchSearch && matchRegion && matchStatus && matchProduct && matchDate && matchAdjustment;
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

/** Phase Orders-Page-Redesign-1 — props lifted from the page-level
 *  dashboard. Fix2 adds the banner controls so the table can show
 *  the user which dashboard click is currently active and offer a
 *  one-click clear.
 */
interface OrdersTableSectionProps {
  appliedRange?: { from: string; to: string } | null;
  appliedFilter?: Record<string, string> | null;
  /** Human label rendered in the active-filter banner above the
   *  table. `null` hides the banner. */
  activeFilterLabel?: string | null;
  /** Clears the banner + resets the table filters back to neutral. */
  onClearAppliedFilter?: () => void;
}

export default function OrdersTableSection(props: OrdersTableSectionProps = {}) {
  const [search, setSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState('الكل');
  const [statusFilter, setStatusFilter] = useState('الكل');
  const [productFilter, setProductFilter] = useState('الكل');
  // Phase Orders-Page-Redesign-1 Visual Match Fix — new filter
  // dropdowns visible in the table toolbar (delegate + payment
  // method). The delegate filter narrows the rows to a single
  // courier (or "غير معين"); the payment filter narrows by the
  // checkout-V2 envelope's `payment.method` value persisted inside
  // `notes`.
  const [delegateFilter, setDelegateFilter] = useState('الكل');
  const [paymentMethodFilter, setPaymentMethodFilter] = useState('الكل');
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
  const visibleOrderIdsRef = useRef<string[]>([]);
  const [totalOrders, setTotalOrders] = useState(0);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [liveUpdateCount, setLiveUpdateCount] = useState(0);
  const [lastUpdateTime, setLastUpdateTime] = useState<string | null>(null);
  // Phase 25A — order_id → summary of active adjustments
  const [adjustmentMap, setAdjustmentMap] = useState<Record<string, AdjustmentRowSummary>>({});

  useEffect(() => {
    visibleOrderIdsRef.current = allOrders.map((o) => o.id);
  }, [allOrders]);

  // --- صلاحيات المستخدم (من AuthContext - المصدر الموثوق) ---
  const { user, currentRoleId, profileFullName, customPermissions: authPermissions } = useAuth();
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
  // Phase Permissions-Audit-Phase-1 — delegate stats collapsible
  // (إحصائيات المندوبين والتوريدات) now routes through the canonical
  // `'view_delegates'` permission so per-user `customPermissions`
  // overrides are respected. Admin retains visibility via the
  // `perms.isAdmin` short-circuit; existing role defaults grant
  // `view_delegates` to r1 (ALL_PERMISSIONS) and r3 (SHIPPING_SUPERVISOR)
  // per DEFAULT_ROLES — no new key, no role-default changes.
  const perms = usePermissions();
  const canViewDelegates = perms.isAdmin || perms.can('view_delegates');

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedSearch(sanitizeSearchTerm(search));
    }, 350);
    return () => window.clearTimeout(t);
  }, [search]);

  // Phase Orders-Page-Redesign-1 — sync the table's internal date
  // range with the dashboard smart filter. The page-level state is
  // the source of truth: every preset click pushes a new
  // `appliedRange` and the table follows.
  useEffect(() => {
    if (!props.appliedRange) return;
    setDateFrom(props.appliedRange.from);
    setDateTo(props.appliedRange.to);
    setPage(1);
  }, [props.appliedRange?.from, props.appliedRange?.to]); // eslint-disable-line react-hooks/exhaustive-deps

  // Phase Orders-Page-Redesign-1 — apply needs-action filters from
  // the dashboard. Each "عرض" click translates into one or more of
  // these patches: status, delegate (unassigned), adjustment (only
  // child orders), payment (partial, parsed loosely via search).
  useEffect(() => {
    const f = props.appliedFilter;
    if (!f) return;
    // Phase Orders-Page-Redesign-1 Fix2 — `__clear` is the sentinel
    // the page emits when the user clicks "مسح الفلتر" on the
    // banner. Reset every filter the dashboard might have set.
    if (f.__clear === '1') {
      setStatusFilter('الكل');
      setDelegateFilter('الكل');
      setAdjustmentFilter('all');
      setPaymentMethodFilter('الكل');
      setSearch('');
      setPage(1);
      return;
    }
    if (f.status) setStatusFilter(f.status);
    if (f.delegate === 'unassigned') {
      setDelegateFilter('__unassigned__');
    }
    if (f.adjustment === 'pending') {
      // Show only child orders (returns/exchanges) which is the
      // closest existing filter for "pending adjustments".
      setAdjustmentFilter('returns');
    }
    if (f.payment === 'partial') {
      setStatusFilter('الكل');
      // The existing search column doesn't index payment status,
      // so we lean on `notes` ILIKE via the search box.
      setSearch('partial');
    }
    setPage(1);
  }, [props.appliedFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadAdjustmentSummaries = useCallback(async (orderIds: string[]) => {
    try {
      const supabase = createClient();
      if (orderIds.length === 0) {
        setAdjustmentMap({});
        return;
      }
      const { data, error } = await supabase
        .from('turath_masr_order_adjustments')
        .select('order_id, kind, state')
        .in('order_id', orderIds)
        .in('state', ['pending', 'approved', 'completed']);
      if (error || !data) {
        setAdjustmentMap({});
        return;
      }
      const acc: Record<string, AdjustmentRowSummary> = {};
      // Priority: completed > approved > pending — we surface the
      // "freshest" terminal-ish state that still warrants a badge.
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

  const loadOrders = useCallback(async () => {
    setLoadingOrders(true);
    try {
      const supabase = createClient();
      const from = (page - 1) * perPage;
      const to = from + perPage - 1;
      let query = supabase
        .from('turath_masr_orders')
        .select(ORDER_SELECT_COLUMNS, { count: 'exact' });

      if (debouncedSearch) {
        const pattern = `*${debouncedSearch}*`;
        query = query.or(
          `customer.ilike.${pattern},order_num.ilike.${pattern},phone.ilike.${pattern}`
        );
      }
      if (regionFilter !== 'الكل') {
        query = query.eq('region', regionFilter);
      }
      if (statusFilter !== 'الكل') {
        query = query.eq('status', statusFilter);
      }
      if (productFilter !== 'الكل') {
        query = query.ilike('products', `%${productFilter}%`);
      }
      if (adjustmentFilter === 'parents') {
        query = query.not('order_num', 'ilike', '%-R%').not('order_num', 'ilike', '%-E%');
      } else if (adjustmentFilter === 'returns') {
        query = query.ilike('order_num', '%-R%');
      } else if (adjustmentFilter === 'exchanges') {
        query = query.ilike('order_num', '%-E%');
      }
      // Phase Orders-Page-Redesign-1 Visual Match Fix — delegate
      // filter. `__unassigned__` is the sentinel for "no delegate"
      // (Supabase doesn't have a single op for `IS NULL OR = ''`
      // so we OR the two predicates).
      if (delegateFilter === '__unassigned__') {
        query = query.or('delegate_name.is.null,delegate_name.eq.');
      } else if (delegateFilter !== 'الكل') {
        query = query.eq('delegate_name', delegateFilter);
      }
      // Phase Orders-Page-Redesign-1 Visual Match Fix — payment
      // method filter via the checkout-V2 envelope's `"method":"…"`
      // marker inside `notes`. Fragile but cheap — no migration
      // needed.
      if (paymentMethodFilter !== 'الكل') {
        const safe = paymentMethodFilter.replace(/"/g, '');
        query = query.ilike('notes', `%"method":"${safe}"%`);
      }
      const dateFromIso = dateInputToIsoStart(dateFrom);
      const dateToIso = dateInputToIsoExclusiveEnd(dateTo);
      if (dateFromIso) {
        query = query.gte('created_at', dateFromIso);
      }
      if (dateToIso) {
        query = query.lt('created_at', dateToIso);
      }

      const { data, error, count } = await query
        .order(SORT_COLUMN_BY_FIELD[sortField], { ascending: sortDir === 'asc' })
        .range(from, to);

      if (error) throw error;

      const supabaseOrders = ((data ?? []) as OrderDbRow[]).map(mapOrderRow);
      setAllOrders(supabaseOrders);
      setTotalOrders(count ?? 0);
      setSelectedRows((prev) => {
        const visible = new Set(supabaseOrders.map((o) => o.id));
        return new Set(Array.from(prev).filter((id) => visible.has(id)));
      });
      await loadAdjustmentSummaries(supabaseOrders.map((o) => o.id));
    } catch (err) {
      console.error('Error loading orders:', err);
      toast.error('تعذر تحميل الأوردرات. حاول التحديث.');
    } finally {
      setLoadingOrders(false);
    }
  }, [
    adjustmentFilter,
    dateFrom,
    dateTo,
    debouncedSearch,
    delegateFilter,
    loadAdjustmentSummaries,
    page,
    perPage,
    paymentMethodFilter,
    productFilter,
    regionFilter,
    sortDir,
    sortField,
    statusFilter,
  ]);

  useEffect(() => {
    loadOrders();
    const handleUpdate = () => {
      loadOrders();
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
      loadAdjustmentSummaries(visibleOrderIdsRef.current);
    };
    window.addEventListener('turath_masr_orders_updated', handleUpdate);
    window.addEventListener('turath_masr_order_adjustments_updated', handleAdjustments);
    const supabase = createClient();
    const currentFilters = {
      search: debouncedSearch,
      regionFilter,
      statusFilter,
      productFilter,
      adjustmentFilter,
      dateFrom,
      dateTo,
    };
    const channel = supabase
      .channel('orders-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'turath_masr_orders',
        },
        (payload: {
          eventType: 'INSERT' | 'UPDATE' | 'DELETE';
          new: Record<string, unknown>;
          old: { id?: string } | null;
        }) => {
          setLiveUpdateCount((prev) => prev + 1);
          setLastUpdateTime(
            new Date().toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })
          );

          if (payload.eventType === 'UPDATE') {
            const updated = mapOrderRow(payload.new as unknown as OrderDbRow);
            setAllOrders((prev) => {
              const existingIndex = prev.findIndex((o) => o.id === updated.id);
              if (existingIndex === -1) return prev;
              if (!orderMatchesClientFilters(updated, currentFilters)) {
                return prev.filter((o) => o.id !== updated.id);
              }
              const next = [...prev];
              next[existingIndex] = updated;
              return next;
            });
            return;
          }

          if (payload.eventType === 'DELETE') {
            // A delete changes counts and can pull the next row into the
            // current page, so this is one of the bounded refresh cases.
            void loadOrders();
            return;
          }

          // Inserts can change page boundaries and counts, so only then
          // do we re-read the bounded current page.
          void loadOrders();
        }
      )
      .subscribe();
    return () => {
      window.removeEventListener('turath_masr_orders_updated', handleUpdate);
      window.removeEventListener('turath_masr_order_adjustments_updated', handleAdjustments);
      supabase.removeChannel(channel);
    };
  }, [
    adjustmentFilter,
    dateFrom,
    dateTo,
    debouncedSearch,
    loadAdjustmentSummaries,
    loadOrders,
    productFilter,
    regionFilter,
    statusFilter,
  ]);

  // Phase Orders-Page-Redesign-1 Fix3b — cancel / archive instead of
  // hard delete. Both the bulk-action button and the per-row trash
  // icon now flip the order's status to `cancelled` and stamp
  // `updated_by` for the audit trail. The row stays in the
  // database so its history (audit logs, adjustments, child orders)
  // remains intact.
  //
  // We intentionally KEEP the handler names (`handleBulkDelete` /
  // `handleSingleDelete`) so we don't rename every call site; the
  // body + tooltips + toasts now describe the cancel/archive
  // behaviour clearly.
  // Phase Inventory-Reservations-1C — fire `inventory_release_for_order`
  // for one cancelled order. Best-effort: never blocks the cancel
  // flow, only surfaces an audit row + console warning on failure.
  // Caller is expected to have already gated on `!isDeliveredStatus`
  // so we can keep this helper free of repeated status checks.
  const releaseReservationForCancelledOrder = async (
    supabase: ReturnType<typeof createClient>,
    orderId: string,
    orderNum: string
  ) => {
    if (!supabase) return;
    const actorName = (profileFullName ?? '').trim() || user?.email || null;
    try {
      const releaseRes = await supabase.rpc('inventory_release_for_order', {
        p_order_id: orderId,
        p_reason: 'order_cancelled',
        p_released_by_name: actorName,
      });
      if (releaseRes.error) {
        const errMessage = releaseRes.error.message || 'release failed';
        console.warn(`[OrdersTableSection] release for #${orderNum} failed:`, releaseRes.error);
        try {
          await writeStaffAuditLog(supabase, {
            action: 'inventory.reservation_failed',
            actorId: user?.id ?? null,
            actorName,
            actorRoleId: currentRoleId ?? null,
            entity: { type: 'order', id: orderId, label: `#${orderNum}` },
            metadata: {
              order_id: orderId,
              order_num: orderNum,
              context: 'release_on_cancel_table',
              error_message: errMessage,
            },
          });
        } catch (auditErr) {
          console.warn('[OrdersTableSection] reservation_failed audit skipped', auditErr);
        }
        return;
      }
      const releaseResult = (releaseRes.data ?? null) as {
        released_count?: number;
        total_quantity?: number;
      } | null;
      try {
        await writeStaffAuditLog(supabase, {
          action: 'inventory.reservation_released',
          actorId: user?.id ?? null,
          actorName,
          actorRoleId: currentRoleId ?? null,
          entity: { type: 'order', id: orderId, label: `#${orderNum}` },
          metadata: {
            order_id: orderId,
            order_num: orderNum,
            context: 'cancel_from_table',
            released_count: releaseResult?.released_count ?? null,
            released_quantity: releaseResult?.total_quantity ?? null,
          },
        });
      } catch (auditErr) {
        console.warn('[OrdersTableSection] reservation_released audit skipped', auditErr);
      }
    } catch (releaseErr) {
      console.error(`[OrdersTableSection] release for #${orderNum} threw:`, releaseErr);
    }
  };

  // Phase Inventory-Delivery-Fulfillment-1 — fire
  // `inventory_fulfill_for_order` for one order that has just
  // transitioned to delivered. Best-effort: never blocks the bulk
  // status update, only surfaces a warning toast + audit row + log on
  // failure. Caller is expected to have already gated on
  // `!isDeliveredStatus(previousStatus)` so a re-delivery click does
  // not double-decrement.
  const fulfillReservationForDeliveredOrder = async (
    supabase: ReturnType<typeof createClient>,
    orderId: string,
    orderNum: string
  ) => {
    if (!supabase) return;
    const actorName = (profileFullName ?? '').trim() || user?.email || null;
    try {
      const fulfillRes = await supabase.rpc('inventory_fulfill_for_order', {
        p_order_id: orderId,
        p_order_num: orderNum,
        p_fulfilled_by_name: actorName,
        p_metadata: { context: 'bulk_status_update_table' },
      });
      if (fulfillRes.error) {
        const errMessage = fulfillRes.error.message || 'fulfill failed';
        console.warn(`[OrdersTableSection] fulfill for #${orderNum} failed:`, fulfillRes.error);
        try {
          await writeStaffAuditLog(supabase, {
            action: 'inventory.fulfillment_failed',
            actorId: user?.id ?? null,
            actorName,
            actorRoleId: currentRoleId ?? null,
            entity: { type: 'order', id: orderId, label: `#${orderNum}` },
            metadata: {
              order_id: orderId,
              order_num: orderNum,
              context: 'fulfill_on_bulk_delivery',
              error_message: errMessage,
            },
          });
        } catch (auditErr) {
          console.warn('[OrdersTableSection] fulfillment_failed audit skipped', auditErr);
        }
        return;
      }
      const fulfillResult = (fulfillRes.data ?? null) as {
        fulfilled_count?: number;
        total_fulfilled_quantity?: number;
        movement_count?: number;
      } | null;
      try {
        await writeStaffAuditLog(supabase, {
          action: 'inventory.fulfillment_completed',
          actorId: user?.id ?? null,
          actorName,
          actorRoleId: currentRoleId ?? null,
          entity: { type: 'order', id: orderId, label: `#${orderNum}` },
          metadata: {
            order_id: orderId,
            order_num: orderNum,
            context: 'bulk_delivery_from_table',
            fulfilled_count: fulfillResult?.fulfilled_count ?? null,
            total_fulfilled_quantity: fulfillResult?.total_fulfilled_quantity ?? null,
            movement_count: fulfillResult?.movement_count ?? null,
          },
        });
      } catch (auditErr) {
        console.warn('[OrdersTableSection] fulfillment_completed audit skipped', auditErr);
      }
    } catch (fulfillErr) {
      console.error(`[OrdersTableSection] fulfill for #${orderNum} threw:`, fulfillErr);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedRows.size === 0) return;
    const confirmed = window.confirm(
      `هل تريد إلغاء / أرشفة ${selectedRows.size} طلب؟\nسيتم نقل الطلبات إلى حالة ملغي ولن يتم حذف بياناتها أو سجلاتها.`
    );
    if (!confirmed) return;
    try {
      const supabase = createClient();
      const idsToUpdate = Array.from(selectedRows);
      // Phase Inventory-Reservations-1C — snapshot per-row status
      // BEFORE the bulk update so we can skip release for any row
      // that was already 'delivered'. We trust the local
      // `allOrders` cache; rows missing from it (unlikely on the
      // current page) fall through to "release anyway" — release is
      // idempotent and a no-op when there are no active rows.
      const statusLookup = new Map(allOrders.map((o) => [o.id, o.status]));
      const updatePayload: Record<string, unknown> = {
        status: 'cancelled',
        updated_at: new Date().toISOString(),
      };
      if (user?.id) {
        updatePayload.updated_by = user.id;
      }
      const { error } = await supabase
        .from('turath_masr_orders')
        .update(updatePayload)
        .in('id', idsToUpdate);
      if (error) throw error;
      toast.success(`تم إلغاء / أرشفة ${selectedRows.size} طلب`);
      setSelectedRows(new Set());
      loadOrders();
      window.dispatchEvent(new CustomEvent('turath_masr_orders_updated'));

      // Phase Inventory-Reservations-1C — release reservations for
      // every cancelled order that wasn't already delivered. Run as
      // Promise.allSettled so a single failure (RLS, missing row,
      // network) does not abort the rest. The order DB write has
      // already succeeded; reservation release is best-effort and
      // never blocks the user's confirmation toast.
      const releaseTargets = idsToUpdate
        .map((id) => {
          const order = allOrders.find((o) => o.id === id);
          const status = statusLookup.get(id) ?? null;
          return { id, orderNum: order?.orderNum ?? id, status };
        })
        .filter((row) => !isDeliveredStatus(row.status));
      if (releaseTargets.length > 0) {
        await Promise.allSettled(
          releaseTargets.map((row) =>
            releaseReservationForCancelledOrder(supabase, row.id, row.orderNum)
          )
        );
      }
    } catch (err) {
      console.error('[OrdersTableSection] bulk cancel/archive failed:', err);
      const msg =
        err instanceof Error && err.message.includes('42501')
          ? 'لا تملك صلاحية إلغاء هذه الطلبات. تواصل مع المدير.'
          : 'حدث خطأ أثناء إلغاء / أرشفة الطلبات';
      toast.error(msg);
    }
  };

  const handleSingleDelete = async (order: Order) => {
    if (!canManageOrders) {
      toast.error('ليس لديك صلاحية إلغاء الطلب');
      return;
    }
    const confirmed = window.confirm(
      `هل تريد إلغاء / أرشفة الطلب #${order.orderNum}؟\nسيتم نقل الطلب إلى حالة ملغي ولن يتم حذف بياناته أو سجلاته.`
    );
    if (!confirmed) return;
    try {
      const supabase = createClient();
      const updatePayload: Record<string, unknown> = {
        status: 'cancelled',
        updated_at: new Date().toISOString(),
      };
      if (user?.id) {
        updatePayload.updated_by = user.id;
      }
      const { error } = await supabase
        .from('turath_masr_orders')
        .update(updatePayload)
        .eq('id', order.id);
      if (error) throw error;
      toast.success(`تم إلغاء / أرشفة الطلب #${order.orderNum}`);
      setSelectedRows((prev) => {
        const next = new Set(prev);
        next.delete(order.id);
        return next;
      });
      loadOrders();
      window.dispatchEvent(new CustomEvent('turath_masr_orders_updated'));

      // Phase Inventory-Reservations-1C — release reservations on
      // the cancelled order. Skip when the order was already
      // delivered; the Delivery-Fulfillment phase owns that path.
      if (!isDeliveredStatus(order.status)) {
        await releaseReservationForCancelledOrder(supabase, order.id, order.orderNum);
      }
    } catch (err) {
      console.error('[OrdersTableSection] single cancel/archive failed:', err);
      const msg =
        err instanceof Error && err.message.includes('42501')
          ? 'لا تملك صلاحية إلغاء هذا الطلب. تواصل مع المدير.'
          : 'حدث خطأ أثناء إلغاء / أرشفة الطلب';
      toast.error(msg);
    }
  };

  const handleBulkStatusUpdate = async (newStatus: string) => {
    if (selectedRows.size === 0) return;
    try {
      const supabase = createClient();
      const idsToUpdate = Array.from(selectedRows);
      // Phase Inventory-Reservations-1C — snapshot statuses before
      // the bulk update so we can release reservations for rows
      // transitioning to 'cancelled' from a non-delivered state.
      const statusLookup = new Map(allOrders.map((o) => [o.id, o.status]));
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

      // Phase Inventory-Reservations-1C — when the bulk transition
      // is to 'cancelled', release reservations for every row that
      // wasn't already delivered. Other statuses (preparing,
      // shipping, etc.) keep reservations active; they only release
      // on cancel or fulfill on delivery (Delivery-Fulfillment).
      if (newStatus === 'cancelled') {
        const releaseTargets = idsToUpdate
          .map((id) => {
            const order = allOrders.find((o) => o.id === id);
            const status = statusLookup.get(id) ?? null;
            return { id, orderNum: order?.orderNum ?? id, status };
          })
          .filter((row) => !isDeliveredStatus(row.status));
        if (releaseTargets.length > 0) {
          await Promise.allSettled(
            releaseTargets.map((row) =>
              releaseReservationForCancelledOrder(supabase, row.id, row.orderNum)
            )
          );
        }
      }

      // Phase Inventory-Delivery-Fulfillment-1 — when the bulk
      // transition is to 'delivered', fulfill reservations for every
      // row that wasn't already delivered (the RPC is idempotent on
      // active reservations, but skipping pre-delivered rows keeps
      // the audit signal clean). Promise.allSettled means a single
      // failure (negative available, missing inventory) does not
      // abort the other deliveries — the user already saw the bulk
      // success toast and audit rows capture any RPC failures.
      if (newStatus === 'delivered') {
        const fulfillTargets = idsToUpdate
          .map((id) => {
            const order = allOrders.find((o) => o.id === id);
            const status = statusLookup.get(id) ?? null;
            return { id, orderNum: order?.orderNum ?? id, status };
          })
          .filter((row) => !isDeliveredStatus(row.status));
        if (fulfillTargets.length > 0) {
          await Promise.allSettled(
            fulfillTargets.map((row) =>
              fulfillReservationForDeliveredOrder(supabase, row.id, row.orderNum)
            )
          );
        }
      }

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

  const filtered = allOrders;
  const totalPages = Math.ceil(totalOrders / perPage);
  const paginated = allOrders;
  const firstPageButton = Math.max(1, Math.min(page - 2, Math.max(1, totalPages - 4)));
  const pageNumbers = Array.from(
    { length: Math.min(totalPages, 5) },
    (_, i) => firstPageButton + i
  );

  useEffect(() => {
    if (totalPages > 0 && page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

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

        {/* Phase Orders-Page-Redesign-1 Visual Match Fix — section
            title + toolbar matching the reference. Title on the
            right (RTL), filters in the middle, actions on the left.
            Date inputs are now part of OrdersHeader's smart filter
            row, not duplicated here. */}
        <div className="px-4 pt-4 pb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                className="flex items-center gap-1.5 px-3 py-2 bg-[hsl(217,80%,30%)] text-white rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity"
                onClick={() => setShowExportMenu(!showExportMenu)}
              >
                <Download size={14} />
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
          <h3 className="text-base font-bold text-[hsl(var(--foreground))]">جميع الطلبات</h3>
        </div>

        {/* Phase Orders-Page-Redesign-1 Fix2 — banner shown while a
            dashboard-driven filter is active. Clicking "مسح الفلتر"
            wipes every dashboard-managed filter via the page-level
            handler so the user can return to the smart-filter view. */}
        {props.activeFilterLabel && (
          <div className="mx-4 mb-3 flex items-center justify-between gap-3 rounded-xl border border-purple-200 bg-purple-50/60 px-3 py-2">
            <div className="flex items-center gap-2 text-xs text-purple-800">
              <span className="font-bold">فلتر نشط من لوحة العمليات:</span>
              <span className="font-semibold">{props.activeFilterLabel}</span>
            </div>
            <button
              type="button"
              onClick={() => props.onClearAppliedFilter?.()}
              className="text-[11px] font-bold text-purple-700 hover:underline"
            >
              مسح الفلتر
            </button>
          </div>
        )}

        <div className="px-4 pb-3 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-[420px]">
            <Search
              size={14}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]"
            />
            <input
              type="text"
              className="input-field pr-9 text-sm"
              placeholder="بحث برقم الطلب أو اسم العميل أو الهاتف..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <select
            className="input-field w-auto text-xs"
            value={delegateFilter}
            onChange={(e) => {
              setDelegateFilter(e.target.value);
              setPage(1);
            }}
            aria-label="المندوب"
          >
            <option value="الكل">المندوب</option>
            <option value="__unassigned__">غير معين</option>
            {delegates.map((d) => (
              <option key={`delegate-filter-${d}`} value={d}>
                {d}
              </option>
            ))}
          </select>
          <select
            className="input-field w-auto text-xs"
            value={regionFilter}
            onChange={(e) => {
              setRegionFilter(e.target.value);
              setPage(1);
            }}
            aria-label="منطقة الشحن"
          >
            {REGIONS.map((r) => (
              <option key={`region-filter-${r}`} value={r}>
                {r === 'الكل' ? 'منطقة الشحن' : r}
              </option>
            ))}
          </select>
          <select
            className="input-field w-auto text-xs"
            value={paymentMethodFilter}
            onChange={(e) => {
              setPaymentMethodFilter(e.target.value);
              setPage(1);
            }}
            aria-label="طريقة الدفع"
          >
            <option value="الكل">طريقة الدفع</option>
            <option value="كاش">كاش</option>
            <option value="فودافون كاش">فودافون كاش</option>
            <option value="إنستاباي">إنستاباي</option>
            <option value="تحويل بنكي">تحويل بنكي</option>
            <option value="بطاقة">بطاقة</option>
            <option value="أخرى">أخرى</option>
          </select>
          <select
            className="input-field w-auto text-xs"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            aria-label="حالة الطلب"
          >
            {statusOptions.map((s) => (
              <option key={`status-filter-${s}`} value={s}>
                {s === 'الكل' ? 'حالة الطلب' : STATUS_MAP[s]?.label || s}
              </option>
            ))}
          </select>
          <select
            className="input-field w-auto text-xs"
            value={adjustmentFilter}
            onChange={(e) => {
              setAdjustmentFilter(e.target.value as 'all' | 'parents' | 'returns' | 'exchanges');
              setPage(1);
            }}
            aria-label="نوع الطلب"
          >
            <option value="all">كل الطلبات</option>
            <option value="parents">الطلبات الأصلية فقط</option>
            <option value="returns">طلبات المرتجع</option>
            <option value="exchanges">طلبات الاستبدال</option>
          </select>
          {(productFilter !== 'الكل' || dateFrom || dateTo) && (
            <span className="text-[10px] text-[hsl(var(--muted-foreground))] mr-auto">
              {loadingOrders ? 'جارٍ التحميل...' : `${totalOrders.toLocaleString('en-US')} نتيجة`}
            </span>
          )}
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
                title="إلغاء / أرشفة الطلبات المحددة"
              >
                إلغاء / أرشفة المحدد
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
              {/* Phase Orders-Page-Redesign-1 Visual Match Fix —
                  column order matches the reference image (RTL):
                  رقم الطلب / العميل / المنتجات / الحالة / الدفع /
                  منطقة الشحن / المندوب / تاريخ الطلب / الإجراءات. */}
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
                    رقم الطلب <SortIcon field="orderNum" />
                  </div>
                </th>
                <th
                  className="table-header cursor-pointer hover:bg-[hsl(var(--border))] transition-colors"
                  onClick={() => handleSort('customer')}
                >
                  <div className="flex items-center gap-1">
                    العميل <SortIcon field="customer" />
                  </div>
                </th>
                <th className="table-header">المنتجات</th>
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
                  onClick={() => handleSort('total')}
                >
                  <div className="flex items-center gap-1">
                    الدفع <SortIcon field="total" />
                  </div>
                </th>
                <th
                  className="table-header cursor-pointer hover:bg-[hsl(var(--border))] transition-colors"
                  onClick={() => handleSort('region')}
                >
                  <div className="flex items-center gap-1">
                    منطقة الشحن <SortIcon field="region" />
                  </div>
                </th>
                <th className="table-header">المندوب</th>
                <th
                  className="table-header cursor-pointer hover:bg-[hsl(var(--border))] transition-colors"
                  onClick={() => handleSort('date')}
                >
                  <div className="flex items-center gap-1">
                    تاريخ الطلب <SortIcon field="date" />
                  </div>
                </th>
                <th className="table-header">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[hsl(var(--border))]">
              {loadingOrders && paginated.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-14 h-14 bg-[hsl(var(--muted))] rounded-2xl flex items-center justify-center">
                        <RefreshCw
                          size={26}
                          className="text-[hsl(var(--muted-foreground))] animate-spin"
                        />
                      </div>
                      <p className="text-base font-semibold text-[hsl(var(--foreground))]">
                        جارٍ تحميل الأوردرات...
                      </p>
                    </div>
                  </td>
                </tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-16">
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
                      {/* رقم الطلب */}
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
                      {/* العميل — name + phone underneath (the old
                          standalone "الموبايل" column is folded in
                          to match the reference layout). */}
                      <td className="table-cell">
                        <div>
                          <p className="font-semibold text-sm">{order.customer}</p>
                          <p className="text-[11px] text-[hsl(var(--muted-foreground))] font-mono">
                            {order.phone}
                          </p>
                          {order.notes && (
                            <p
                              className="text-[10px] text-amber-600 truncate max-w-[160px]"
                              title={order.notes}
                            >
                              ملاحظة: {order.notes}
                            </p>
                          )}
                        </div>
                      </td>
                      {/* المنتجات */}
                      <td className="table-cell max-w-[220px]">
                        {(() => {
                          const summary = buildOrderProductsSummary(order.lines, order.products, {
                            maxItems: 3,
                          });
                          return (
                            <>
                              <p className="text-sm truncate" title={summary}>
                                {summary}
                              </p>
                              <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                                {order.quantity} قطعة
                              </p>
                            </>
                          );
                        })()}
                      </td>
                      {/* الحالة */}
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
                      {/* الدفع — total amount + small wallet icon.
                          Payment-method parsing from notes is left to
                          OrderDetailModal so the cell stays light. */}
                      <td className="table-cell">
                        <div className="flex items-center gap-1.5">
                          <Wallet
                            size={13}
                            className="text-[hsl(var(--muted-foreground))] flex-shrink-0"
                          />
                          <div>
                            <p className="font-bold font-mono text-sm">
                              {order.total.toLocaleString('en-US')} ج.م
                            </p>
                            <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
                              {order.expressShipping ? 'شحن سريع' : 'شحن'}: {order.shippingFee} ج.م
                            </p>
                          </div>
                        </div>
                      </td>
                      {/* منطقة الشحن */}
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
                      {/* المندوب — highlight "غير معين" in red as
                          the reference shows when the field is empty. */}
                      <td className="table-cell">
                        {order.delegateName ? (
                          <p className="text-xs font-bold text-[hsl(var(--foreground))]">
                            {order.delegateName}
                          </p>
                        ) : (
                          <p className="text-xs font-bold text-red-600">غير معين</p>
                        )}
                      </td>
                      {/* تاريخ الطلب — Fix3: Arabic day name + DD/MM/YYYY
                          on the first line, 12-hour time with صباحًا /
                          مساءً on the second line. */}
                      <td className="table-cell">
                        <div>
                          <p className="text-xs font-medium">{formatOrderDayLine(order.date)}</p>
                          <p className="text-[10px] text-[hsl(var(--muted-foreground))] font-mono">
                            {formatOrderTime12h(order.time)}
                          </p>
                        </div>
                      </td>
                      <td className="table-cell">
                        {/* Phase Orders-Page-Redesign-1 Fix3 — drop
                            the duplicate "Invoice PDF" button (it
                            opened the same OrderDetailModal as the
                            eye icon) and wire the Trash icon to the
                            single-row delete handler. The delete
                            button is hidden when the user lacks
                            `canManageOrders` so the row never shows
                            a non-functional shell. */}
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
                          {canManageOrders && (
                            <button
                              onClick={() => handleSingleDelete(order)}
                              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-red-500 transition-colors"
                              title="إلغاء / أرشفة الطلب"
                              aria-label="إلغاء / أرشفة الطلب"
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
            <span>من {totalOrders.toLocaleString('en-US')} أوردر</span>
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
            {pageNumbers.map((pageNum) => {
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
            <div className="grid grid-cols-2 gap-2 mb-2">
              {/* Phase Inventory-Returns-Stock-1 — `returned` is intentionally
                  filtered out here. Marking an order as returned must go
                  through the OrderAdjustmentModal / customers/returns-exchanges
                  flow so applyReturnStockEffects fires `inventory_apply_movement`
                  with `return_in` and restores stock on the matching variant.
                  STATUS_MAP still carries `returned` so existing returned-status
                  rows render correctly in the table and the filter dropdown. */}
              {Object.entries(STATUS_MAP)
                .filter(([key]) => key !== 'returned')
                .map(([key, val]) => (
                  <button
                    key={key}
                    className={`flex items-center gap-2 p-3 rounded-xl border cursor-pointer transition-all ${bulkNewStatus === key ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5' : 'border-[hsl(var(--border))] hover:border-gray-400'}`}
                    onClick={() => setBulkNewStatus(key)}
                  >
                    <span className={`badge ${val.cls} text-[11px]`}>{val.label}</span>
                  </button>
                ))}
            </div>
            <p className="text-[10px] text-[hsl(var(--muted-foreground))] mb-4">
              المرتجعات والاستبدالات تتم من مسار المرتجعات/الاستبدالات لضمان رجوع المخزون بشكل صحيح.
            </p>
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
