'use client';
import React, { useState, useMemo, useEffect } from 'react';
import AppLayout from '@/components/AppLayout';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
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

// ─── Components ──────────────────────────────────────────────────────────────

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div
        className="bg-white border border-[hsl(var(--border))] rounded-xl shadow-lg p-3 text-sm"
        dir="rtl"
      >
        <p className="font-semibold text-[hsl(var(--foreground))] mb-2">{label}</p>
        <div className="space-y-1.5">
          {payload.map((entry: any, i: number) => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
              <span className="text-[hsl(var(--muted-foreground))] text-xs">{entry.name}:</span>
              <span className="font-bold text-xs">{entry.value.toLocaleString('en-US')}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
};

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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchOrders = async () => {
      setLoading(true);
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from('zahranship_orders')
          .select('id, created_at, status, total, shipping_fee, products, region')
          .order('created_at', { ascending: true });

        if (error) throw error;
        if (data) setDbOrders(data);
      } catch (err) {
        console.error('Error fetching orders for reports:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchOrders();
  }, []);

  const aggregatedData = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

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
    };
    const prodMap: Record<string, { orders: number; revenue: number }> = {};

    dbOrders.forEach((o) => {
      if (regionFilter !== 'الكل' && o.region !== regionFilter) return;

      const date = new Date(o.created_at);
      const m = date.getMonth() + 1;
      const y = date.getFullYear();

      const targetMonth = monthsData.find((x) => x.m === m && x.year === y);
      if (targetMonth) {
        targetMonth.orders += 1;
        if (o.status === 'delivered') {
          targetMonth.delivered += 1;
          targetMonth.revenue += o.total;
        } else if (o.status === 'returned') {
          targetMonth.returned += 1;
        }
      }

      if (o.status === 'delivered') stats.delivered++;
      else if (o.status === 'shipping') stats.shipping++;
      else if (o.status === 'returned') stats.returned++;
      else if (o.status === 'cancelled') stats.cancelled++;
      else stats.pending++;

      stats.shippingFees += o.shipping_fee || 0;

      if (o.products) {
        const pNames = o.products.split('+').map((s) => s.trim());
        pNames.forEach((p) => {
          const match = p.match(/(.*?)\s*[x×]\s*(\d+)/i);
          const name = match ? match[1].trim() : p.trim();
          const count = match ? parseInt(match[2], 10) : 1;

          if (!prodMap[name]) prodMap[name] = { orders: 0, revenue: 0 };
          prodMap[name].orders += count;
          if (o.status === 'delivered') {
            prodMap[name].revenue += Math.floor(o.total / pNames.length);
          }
        });
      }
    });

    const topP = Object.entries(prodMap)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.orders - a.orders)
      .slice(0, 5);

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
        remaining: Math.max(
          0,
          dbOrders.filter((o) => o.status === 'delivered').reduce((s, o) => s + (o.total || 0), 0) -
            stats.shippingFees
        ),
      },
    };
  }, [dbOrders, regionFilter]);

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
                .filter((o) => o.status === 'delivered')
                .reduce((s, o) => s + (o.total || 0), 0)
                .toLocaleString('en-US'),
              sub: 'قيمة نقدية (صافي)',
              icon: <DollarSign size={22} />,
              color: 'emerald',
            },
            {
              label: 'مصروفات الشحن',
              value: aggregatedData.financials.totalShipping.toLocaleString('en-US'),
              sub: 'مرصودة (صافي)',
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
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={filteredMonthly}
                  margin={{ top: 0, right: 0, left: -20, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="colorOrdersRec" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#1e3a8a" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#1e3a8a" stopOpacity={0.01} />
                    </linearGradient>
                    <linearGradient id="colorDeliveredRec" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#15803d" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#15803d" stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="orders"
                    name="الأوردرات"
                    stroke="#1e3a8a"
                    strokeWidth={3}
                    fillOpacity={1}
                    fill="url(#colorOrdersRec)"
                  />
                  <Area
                    type="monotone"
                    dataKey="delivered"
                    name="المسلمة"
                    stroke="#15803d"
                    strokeWidth={3}
                    fillOpacity={1}
                    fill="url(#colorDeliveredRec)"
                  />
                </AreaChart>
              </ResponsiveContainer>
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
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={aggregatedData.status}
                    cx="50%"
                    cy="50%"
                    innerRadius={65}
                    outerRadius={90}
                    paddingAngle={6}
                    dataKey="value"
                    stroke="none"
                  >
                    {aggregatedData.status.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
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
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={filteredMonthly}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar
                      dataKey="orders"
                      name="مستلم"
                      fill="#1e3a8a"
                      radius={[4, 4, 0, 0]}
                      barSize={18}
                    />
                    <Bar
                      dataKey="delivered"
                      name="مسلم"
                      fill="#15803d"
                      radius={[4, 4, 0, 0]}
                      barSize={18}
                    />
                    <Bar
                      dataKey="returned"
                      name="مرتجع"
                      fill="#dc2626"
                      radius={[4, 4, 0, 0]}
                      barSize={18}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
