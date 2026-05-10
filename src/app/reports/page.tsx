'use client';
import React, { useState, useMemo, useEffect } from 'react';
import dynamic from 'next/dynamic';
// Phase E1-Fix3 — `next/image` import removed. The single render
// site that used it now goes through the shared
// `InventoryThumbnail` (which itself wraps `next/image` internally
// with the correct `unoptimized` posture for our RLS-gated route).
import AppLayout from '@/components/AppLayout';
import {
  TrendingUp,
  TrendingDown,
  Package,
  DollarSign,
  RotateCcw,
  Download,
  FileSpreadsheet,
  FileText,
  X,
  Loader2,
  Truck,
  XCircle,
  Wallet,
  CheckCircle,
  Clock,
  Hash,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { normalizeStatus } from '@/lib/reporting/orderMetrics';
// Phase E1-Fix3 — render the inventory thumbnail on the products
// table via the cached `/api/inventory/[id]/thumbnail` route so the
// reports query no longer ships ~648 KB of base64 `images` per page
// mount. Same shared component used by /inventory and AddOrderModal.
import { InventoryThumbnail, inventoryThumbnailUrl } from '@/lib/inventory/InventoryThumbnail';

// Phase 20E: lazy-load recharts via a dedicated client module so the
// /reports route's initial JS chunk drops the recharts payload (~150 kB
// minified). Charts render after the data fetch completes anyway, so a
// tiny just-in-time chunk fetch is cheaper than carrying recharts on
// every page visit. ssr:false is required because recharts uses browser
// APIs (ResizeObserver) that aren't available during SSG.
const MonthlyAreaChart = dynamic(() => import('./ReportsCharts').then((m) => m.MonthlyAreaChart), {
  ssr: false,
});
const StatusPieChart = dynamic(() => import('./ReportsCharts').then((m) => m.StatusPieChart), {
  ssr: false,
});
const MonthlyBarChart = dynamic(() => import('./ReportsCharts').then((m) => m.MonthlyBarChart), {
  ssr: false,
});

// ─── Types ───────────────────────────────────────────────────────────────────

interface Order {
  id: string;
  created_at: string;
  status: string;
  total: number;
  shipping_fee: number;
  products: string;
  region: string;
}

interface MonthlyStat {
  month: string;
  orders: number;
  delivered: number;
  returned: number;
  revenue: number;
  m: number; // Month index 1-12
  year: number;
}

const MONTH_NAMES = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];

// CustomTooltip moved to ./ReportsCharts.tsx in Phase 20E (it's only
// consumed by the recharts components, so it rides in the same lazy
// chunk).

const PERIOD_OPTIONS = [
  { key: 'month', label: 'هذا الشهر', months: 1 },
  { key: '3months', label: 'آخر 3 أشهر', months: 3 },
  { key: '6months', label: 'آخر 6 أشهر', months: 6 },
  { key: 'year', label: 'هذا العام', months: 12 },
];

export default function ReportsPage() {
  const [activePeriod, setActivePeriod] = useState('6months');
  const [regionFilter, setRegionFilter] = useState('الكل');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [dbOrders, setDbOrders] = useState<Order[]>([]);
  const [dbInventory, setDbInventory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const supabase = createClient();
        // Phase 20E: explicit inventory column list — locks the
        // contract so future schema additions don't silently leak.
        //
        // Phase E1-Fix3: dropped `images` from the inventory select.
        // The base64-encoded `images` text[] was ~108 KB per row
        // (~648 KB total across the 6 production rows) and was
        // shipped on every /reports page mount just to populate the
        // 32×32 product photo in the "all products" table. The
        // photo now lazy-loads through the cached
        // `/api/inventory/[id]/thumbnail` route via the shared
        // InventoryThumbnail helper. `id` is added to the select so
        // the render path can build the URL.
        const [oRes, iRes] = await Promise.all([
          supabase
            .from('turath_masr_orders')
            .select('id, created_at, status, total, shipping_fee, products, region')
            .order('created_at', { ascending: true }),
          supabase.from('turath_masr_inventory').select('id, name, sku, available'),
        ]);

        if (oRes.data) setDbOrders(oRes.data);
        if (iRes.data) setDbInventory(iRes.data);
      } catch (err) {
        console.error('Error fetching data for reports:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const aggregatedData = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    // Date range objects for filtering
    const fromDate = dateFrom ? new Date(dateFrom) : null;
    const toDate = dateTo ? new Date(dateTo) : null;
    if (toDate) toDate.setHours(23, 59, 59, 999);

    const monthsData: MonthlyStat[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(currentYear, currentMonth - i, 1);
      monthsData.push({
        month: MONTH_NAMES[d.getMonth()],
        m: d.getMonth() + 1,
        year: d.getFullYear(),
        orders: 0,
        delivered: 0,
        returned: 0,
        revenue: 0,
      });
    }

    const stats = {
      delivered: 0,
      shipping: 0,
      pending: 0,
      returned: 0,
      cancelled: 0,
      shippingFees: 0,
      deliveredRevenue: 0,
    };
    const prodMap: Record<string, { orders: number; revenue: number }> = {};

    dbOrders.forEach((o) => {
      const orderCreatedAt = new Date(o.created_at);

      // 1. Filter by Region
      if (regionFilter !== 'الكل' && o.region !== regionFilter) return;

      // 2. Filter by Date Range (for the KPI cards)
      let isInRange = true;
      if (fromDate && orderCreatedAt < fromDate) isInRange = false;
      if (toDate && orderCreatedAt > toDate) isInRange = false;

      const date = orderCreatedAt;
      const m = date.getMonth() + 1;
      const y = date.getFullYear();

      // Phase 22E: route every status check through the shared
      // normalizer so /reports and /dashboard never disagree on what
      // counts as delivered / returned / cancelled.
      const norm = normalizeStatus(o.status);
      const isDelivered = norm === 'delivered';
      const isShipping = norm === 'shipping';
      const isReturned = norm === 'returned';
      const isCancelled = norm === 'cancelled';

      const targetMonth = monthsData.find((x) => x.m === m && x.year === y);
      if (targetMonth) {
        targetMonth.orders += 1;
        if (isDelivered) {
          targetMonth.delivered += 1;
          targetMonth.revenue += o.total;
        } else if (isReturned) {
          targetMonth.returned += 1;
        }
      }

      // --- Update KPI Stats (Only if in selected range) ---
      if (isInRange) {
        if (isDelivered) stats.delivered++;
        else if (isShipping) stats.shipping++;
        else if (isReturned) stats.returned++;
        else if (isCancelled) stats.cancelled++;
        // new / preparing / warehouse / unknown all bucket into pending.
        else stats.pending++;

        // Phase 22E: shippingFees is delivered-only. The previous
        // code summed shipping_fee across every order in the period
        // — including cancelled and returned ones — and then
        // subtracted that from deliveredRevenue to get "remaining",
        // which over-deducted shipping for orders we never earned
        // revenue from. Tying shipping cost to delivered-only revenue
        // keeps "remaining" honest as productRevenue.
        if (isDelivered) {
          stats.shippingFees += Number(o.shipping_fee) || 0;
          stats.deliveredRevenue += Number(o.total) || 0;
        }

        if (o.products && !isCancelled && !isReturned) {
          // Split by comma or plus (matching inventory parser)
          const parts = o.products.split(/[,+]/).map((s) => s.trim());
          parts.forEach((p) => {
            let name = p;
            let count = 1;

            // 1. Try parenthesis format: Product Name (2)
            const parenMatch = p.match(/(.*?)\s*\(\s*(\d+)\s*\)/);
            // 2. Try x format: Product Name x 2
            const xMatch = p.match(/(.*?)\s*([x×\*]\s*(\d+)|(\d+)\s*[x×\*])$/i);

            if (parenMatch) {
              name = parenMatch[1].trim();
              count = parseInt(parenMatch[2], 10) || 1;
            } else if (xMatch) {
              name = xMatch[1].trim();
              count = parseInt(xMatch[3] || xMatch[4], 10) || 1;
            } else {
              // Try simpler fallback if no known symbol found: maybe just a number at the end?
              const simpleMatch = p.match(/(.*?)\s*(\d+)$/);
              if (simpleMatch) {
                name = simpleMatch[1].trim();
                count = parseInt(simpleMatch[2], 10) || 1;
              }
            }

            const normalizedName = name.trim();
            if (normalizedName) {
              if (!prodMap[normalizedName]) prodMap[normalizedName] = { orders: 0, revenue: 0 };
              prodMap[normalizedName].orders += count;
              if (isDelivered) {
                prodMap[normalizedName].revenue += Math.floor(Number(o.total) / parts.length);
              }
            }
          });
        }
      }
    });

    const allPData = dbInventory
      .map((item) => {
        const stats = prodMap[item.name] || { orders: 0, revenue: 0 };
        return {
          ...item,
          withdrawn: stats.orders,
          revenue: stats.revenue,
        };
      })
      .sort((a, b) => b.withdrawn - a.withdrawn);

    const topP = allPData.slice(0, 5);

    const totalStats =
      stats.delivered + stats.shipping + stats.returned + stats.cancelled + stats.pending;

    return {
      monthly: monthsData,
      status: [
        {
          name: 'تم التسليم',
          value: stats.delivered,
          color: '#15803d',
          icon: <CheckCircle size={14} />,
          pct: totalStats > 0 ? Math.round((stats.delivered / totalStats) * 100) : 0,
        },
        {
          name: 'جاري الشحن',
          value: stats.shipping,
          color: '#1e3a8a',
          icon: <Truck size={14} />,
          pct: totalStats > 0 ? Math.round((stats.shipping / totalStats) * 100) : 0,
        },
        {
          name: 'مرتجع',
          value: stats.returned,
          color: '#dc2626',
          icon: <RotateCcw size={14} />,
          pct: totalStats > 0 ? Math.round((stats.returned / totalStats) * 100) : 0,
        },
        {
          name: 'ملغي',
          value: stats.cancelled,
          color: '#94a3b8',
          icon: <XCircle size={14} />,
          pct: totalStats > 0 ? Math.round((stats.cancelled / totalStats) * 100) : 0,
        },
        {
          name: 'معلق',
          value: stats.pending,
          color: '#f59e0b',
          icon: <Clock size={14} />,
          pct: totalStats > 0 ? Math.round((stats.pending / totalStats) * 100) : 0,
        },
      ],
      products: topP,
      financials: {
        totalShipping: stats.shippingFees,
        remaining: Math.max(0, stats.deliveredRevenue - stats.shippingFees),
      },
      allProducts: allPData,
    };
  }, [dbOrders, dbInventory, regionFilter, dateFrom, dateTo]);

  const filteredMonthly = useMemo(() => {
    if (dateFrom || dateTo) {
      return aggregatedData.monthly.filter((d) => {
        const monthDate = new Date(d.year, d.m - 1, 1);
        let match = true;
        if (dateFrom) {
          const from = new Date(dateFrom);
          from.setDate(1);
          if (monthDate < from) match = false;
        }
        if (dateTo && match) {
          const to = new Date(dateTo);
          if (monthDate > to) match = false;
        }
        return match;
      });
    }

    const p = PERIOD_OPTIONS.find((p) => p.key === activePeriod);
    const months = p?.months || 6;
    return aggregatedData.monthly.slice(-months);
  }, [activePeriod, dateFrom, dateTo, aggregatedData]);

  const totals = useMemo(() => {
    const orders = filteredMonthly.reduce((s, d) => s + d.orders, 0);
    const delivered = filteredMonthly.reduce((s, d) => s + d.delivered, 0);
    const returned = filteredMonthly.reduce((s, d) => s + d.returned, 0);
    const revenue = filteredMonthly.reduce((s, d) => s + d.revenue, 0);

    return {
      orders,
      delivered,
      returned,
      revenue,
      deliveryRate: orders > 0 ? Math.round((delivered / orders) * 100) : 0,
      returnRate: orders > 0 ? Math.round((returned / orders) * 100) : 0,
    };
  }, [filteredMonthly]);

  const exportCSV = () => {
    const headers = ['الشهر', 'السنة', 'الأوردرات', 'المسلمة', 'المرتجعة', 'الإيرادات'];
    const rows = filteredMonthly.map((d) => [
      d.month,
      d.year,
      d.orders,
      d.delivered,
      d.returned,
      d.revenue,
    ]);
    const csvContent = '\uFEFF' + [headers, ...rows].map((e) => e.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute(
      'download',
      `report-${activePeriod}-${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading) {
    return (
      <AppLayout currentPath="/reports">
        <div className="flex flex-col items-center justify-center py-40 space-y-4">
          <Loader2 className="w-10 h-10 text-[hsl(var(--primary))] animate-spin" />
          <p className="text-sm text-[hsl(var(--muted-foreground))] font-bold uppercase tracking-widest animate-pulse">
            جاري تحضير التقارير الإحصائية...
          </p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout currentPath="/reports">
      <div className="space-y-8 fade-in pb-20 pt-2">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div>
            <h1 className="text-3xl font-black text-gray-900 tracking-tight">
              التقارير التحليلية <span className="text-[hsl(var(--primary))]">المركزية</span>
            </h1>
            <p className="text-sm text-gray-500 mt-1 uppercase tracking-wider font-bold">
              بناءً على {dbOrders.length} أوردر مسجل في قاعدة البيانات
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex bg-gray-100 rounded-2xl p-1 gap-1 shadow-inner">
              {PERIOD_OPTIONS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => {
                    setActivePeriod(p.key);
                    setDateFrom('');
                    setDateTo('');
                  }}
                  className={`text-[11px] px-4 py-2 rounded-xl font-bold transition-all ${activePeriod === p.key && !dateFrom && !dateTo ? 'bg-white text-[hsl(var(--primary))] shadow-sm' : 'text-gray-400'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <button
              onClick={exportCSV}
              className="flex items-center gap-2 px-6 py-3 bg-[hsl(var(--primary))] text-white rounded-2xl text-xs font-bold hover:shadow-lg transition-all active:scale-95"
            >
              <Download size={16} />
              تحميل التقرير
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white border-2 border-gray-50 rounded-[2rem] p-6 flex flex-wrap items-center gap-8 shadow-sm">
          <div className="flex items-center gap-4">
            <span className="text-xs font-black text-gray-400 uppercase tracking-widest whitespace-nowrap">
              تصفية التاريخ:
            </span>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="px-4 py-2 border-2 border-gray-50 rounded-xl text-xs outline-none focus:border-[hsl(var(--primary))]/50 bg-gray-50 font-bold"
                dir="ltr"
              />
              <div className="h-px w-3 bg-gray-200" />
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="px-4 py-2 border-2 border-gray-50 rounded-xl text-xs outline-none focus:border-[hsl(var(--primary))]/50 bg-gray-50 font-bold"
                dir="ltr"
              />
            </div>
            {(dateFrom || dateTo) && (
              <button
                onClick={() => {
                  setDateFrom('');
                  setDateTo('');
                }}
                className="p-2 hover:bg-red-50 text-red-500 rounded-xl transition-all"
              >
                <X size={16} />
              </button>
            )}
          </div>
          <div className="h-8 w-px bg-gray-100 hidden md:block" />
          <div className="flex items-center gap-4">
            <span className="text-xs font-black text-gray-400 uppercase tracking-widest whitespace-nowrap">
              المحافظة:
            </span>
            <select
              className="px-6 py-2 border-2 border-gray-50 rounded-xl text-xs font-bold focus:outline-none focus:border-[hsl(var(--primary))]/50 bg-gray-50 text-gray-600"
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value)}
            >
              <option value="الكل">كل المحافظات</option>
              <option>القاهرة</option>
              <option>الجيزة</option>
              <option>القليوبية</option>
            </select>
          </div>
        </div>

        {/* Detailed KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
          {[
            {
              label: 'إجمالي الطلبات',
              value: dbOrders.length.toLocaleString('en-US'),
              sub: 'تحليل شامل',
              icon: <Package size={22} />,
              color: 'blue',
            },
            {
              label: 'إجمالي التحصيل',
              value: dbOrders
                .filter((o) => normalizeStatus(o.status) === 'delivered')
                .reduce((s, o) => s + (o.total || 0), 0)
                .toLocaleString('en-US'),
              sub: 'قيمة نقدية (صافي)',
              icon: <DollarSign size={22} />,
              color: 'emerald',
            },
            {
              // Phase 22E: this number is delivered-only — see the
              // aggregation loop above. Sub clarifies the scope so
              // users don't read it as a period-wide expense roll-up.
              label: 'مصروفات الشحن',
              value: aggregatedData.financials.totalShipping.toLocaleString('en-US'),
              sub: 'للطلبات المسلمة',
              icon: <Truck size={22} />,
              color: 'orange',
            },
            {
              label: 'المتبقي (الصافي)',
              value: aggregatedData.financials.remaining.toLocaleString('en-US'),
              sub: 'بعد خصم الشحن',
              icon: <Wallet size={22} />,
              color: 'purple',
            },
          ].map((kpi, i) => (
            <div
              key={i}
              className="bg-white border-2 border-gray-50 rounded-[2.5rem] p-6 relative overflow-hidden group hover:shadow-2xl transition-all hover:border-[hsl(var(--primary))]/10"
            >
              <div
                className={`absolute top-0 right-0 w-2 h-full ${
                  kpi.color === 'blue'
                    ? 'bg-blue-500'
                    : kpi.color === 'emerald'
                      ? 'bg-emerald-500'
                      : kpi.color === 'orange'
                        ? 'bg-orange-500'
                        : 'bg-purple-500'
                }`}
              />
              <div className="flex items-start justify-between mb-4">
                <div
                  className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110 ${
                    kpi.color === 'blue'
                      ? 'bg-blue-50 text-blue-600 shadow-blue-100'
                      : kpi.color === 'emerald'
                        ? 'bg-emerald-50 text-emerald-600 shadow-emerald-100'
                        : kpi.color === 'orange'
                          ? 'bg-orange-50 text-orange-600 shadow-orange-100'
                          : 'bg-purple-50 text-purple-600 shadow-purple-100'
                  } shadow-lg shadow-current/10`}
                >
                  {kpi.icon}
                </div>
              </div>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">
                {kpi.label}
              </p>
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-black text-gray-900 font-mono tracking-tighter">
                  {kpi.value}
                </span>
                <span className="text-[10px] text-gray-400 font-bold uppercase">{kpi.sub}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Charts and Breakdown */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          <div className="xl:col-span-2 bg-white border-2 border-gray-50 rounded-[2.5rem] p-8 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-10 gap-4">
              <div>
                <h3 className="text-lg font-black text-gray-900 tracking-tight">
                  نظرة تاريخية على نمو الأداء
                </h3>
                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">
                  المقارنة الشهرية بين الطلبات الواردة والطلبات الناجحة
                </p>
              </div>
              <div className="flex gap-6 items-center">
                <div className="flex items-center gap-2 text-[10px] font-black text-gray-500">
                  <div className="w-3 h-3 rounded bg-[#1e3a8a]" />
                  <span>الوارد</span>
                </div>
                <div className="flex items-center gap-2 text-[10px] font-black text-gray-500">
                  <div className="w-3 h-3 rounded bg-[#15803d]" />
                  <span>الناجح</span>
                </div>
              </div>
            </div>
            <div className="h-[320px] w-full">
              <MonthlyAreaChart data={filteredMonthly} />
            </div>
          </div>

          <div className="bg-white border-2 border-gray-50 rounded-[2.5rem] p-8 shadow-sm">
            <h3 className="text-lg font-black text-gray-900 tracking-tight mb-1">
              تحليل الحالات والنسب
            </h3>
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-10">
              توزيع الطلبات حسب الحالة التشغيلية
            </p>
            <div className="h-[220px] w-full relative">
              <StatusPieChart data={aggregatedData.status} />
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-3xl font-black text-gray-900 font-mono tracking-tighter">
                  {dbOrders.length}
                </span>
                <span className="text-[8px] text-gray-400 font-black uppercase tracking-[0.2em] mt-1 text-center">
                  إجمالي
                  <br />
                  العمليات
                </span>
              </div>
            </div>
            <div className="space-y-4 mt-10">
              {aggregatedData.status.map((s, i) => (
                <div key={i} className="flex flex-col gap-2 group">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-3 h-3 rounded-md shadow-sm"
                        style={{ backgroundColor: s.color }}
                      />
                      <span className="text-xs font-black text-gray-700 uppercase tracking-tight">
                        {s.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-black text-gray-900">
                        {s.value.toLocaleString('en-US')}
                      </span>
                      <span className="text-[10px] font-black text-gray-400">({s.pct}%)</span>
                    </div>
                  </div>
                  <div className="w-full bg-gray-50 h-1.5 rounded-full overflow-hidden border border-gray-100/50">
                    <div
                      className="h-full rounded-full transition-all duration-1000 shadow-sm"
                      style={{ backgroundColor: s.color, width: `${s.pct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom Comparison */}
        <div className="bg-white border-2 border-gray-50 rounded-[2.5rem] p-10 shadow-sm">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-16">
            <div className="space-y-6">
              <div className="flex items-center gap-3 border-b-2 border-gray-50 pb-4">
                <TrendingUp size={20} className="text-emerald-500" />
                <p className="text-sm font-black text-gray-900 uppercase tracking-widest">
                  أكثر المنتجات طلباً هذا الموسم
                </p>
              </div>
              <div className="space-y-5">
                {aggregatedData.products.map((p, i) => (
                  <div key={i} className="space-y-2">
                    <div className="flex items-center justify-between text-xs font-black">
                      <span className="text-gray-600 truncate max-w-[200px]">{p.name}</span>
                      <span className="text-[hsl(var(--primary))] font-mono">
                        {p.orders} <span className="text-[10px] text-gray-400">أوردر</span>
                      </span>
                    </div>
                    <div className="w-full bg-gray-50 h-2.5 rounded-full overflow-hidden border border-gray-100/50 shadow-inner">
                      <div
                        className="h-full bg-gradient-to-l from-[hsl(var(--primary))] to-[hsl(var(--primary))]/60 rounded-full transition-all duration-1000"
                        style={{
                          width: `${(p.orders / (aggregatedData.products[0]?.orders || 1)) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-6">
              <div className="flex items-center gap-3 border-b-2 border-gray-50 pb-4">
                <Hash size={20} className="text-blue-500" />
                <p className="text-sm font-black text-gray-900 uppercase tracking-widest">
                  مقارنة زمنية مفصلة
                </p>
              </div>
              <div className="h-[240px] w-full">
                <MonthlyBarChart data={filteredMonthly} />
              </div>
            </div>
          </div>
        </div>

        {/* Product Performance Table */}
        <div className="bg-white border-2 border-gray-50 rounded-[2.5rem] p-10 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-lg font-black text-gray-900 tracking-tight">
                تحليل أداء المنتجات (المسحوب)
              </h3>
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">
                كشف كامل بالكميات المسحوبة والإيرادات لكل صنف
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="border-b border-gray-50">
                  <th className="px-4 py-4 text-gray-400 font-black uppercase tracking-widest">
                    المنتج
                  </th>
                  <th className="px-4 py-4 text-gray-400 font-black uppercase tracking-widest">
                    الكود (SKU)
                  </th>
                  <th className="px-4 py-4 text-gray-400 font-black uppercase tracking-widest">
                    المسحوب (مباع)
                  </th>
                  <th className="px-4 py-4 text-gray-400 font-black uppercase tracking-widest">
                    المتاح حالياً
                  </th>
                  <th className="px-4 py-4 text-gray-400 font-black uppercase tracking-widest text-emerald-600">
                    الإيرادات (ج.م)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {aggregatedData.allProducts.map((p, i) => (
                  <tr key={i} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        {/* Phase E1-Fix3 — thumbnail loads from the
                            cached `/api/inventory/[id]/thumbnail`
                            route. The inventory query no longer
                            ships base64 `images`; we build the URL
                            from `p.id` instead. The shared
                            InventoryThumbnail helper renders an
                            actual <img> when the route returns 200
                            and falls back to the 📦 emoji on 404 /
                            load error (rare — current 6 rows all
                            carry stored thumbnails). */}
                        {p.id ? (
                          <InventoryThumbnail
                            src={inventoryThumbnailUrl(p.id)}
                            alt={p.name || 'منتج'}
                            emoji="📦"
                            width={32}
                            height={32}
                            className="w-8 h-8 rounded-lg object-cover"
                            emojiClassName="text-xl w-8 h-8"
                          />
                        ) : null}
                        <span className="font-bold text-gray-800">{p.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4 font-mono text-gray-400">{p.sku}</td>
                    <td className="px-4 py-4">
                      <span
                        className={`px-3 py-1 rounded-full font-black ${p.withdrawn > 0 ? 'bg-orange-50 text-orange-600' : 'bg-gray-50 text-gray-400'}`}
                      >
                        {p.withdrawn} وحدة
                      </span>
                    </td>
                    <td className="px-4 py-4 font-bold text-gray-600">{p.available}</td>
                    <td className="px-4 py-4 font-black text-emerald-600 tracking-tighter text-sm">
                      {p.revenue.toLocaleString('en-US')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
