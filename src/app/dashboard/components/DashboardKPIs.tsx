'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Download, Filter, Package, Truck, DollarSign, Banknote, CreditCard, CheckCircle, Clock, AlertCircle, RotateCcw } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

const PERIOD_LABELS: Record<string, string> = {
  today: 'اليوم', yesterday: 'أمس', week: 'هذا الأسبوع', month: 'هذا الشهر',
};

const colorMap: Record<string, { bg: string; icon: string }> = {
  blue: { bg: 'bg-blue-50', icon: 'text-blue-600' },
  green: { bg: 'bg-green-50', icon: 'text-green-600' },
  amber: { bg: 'bg-amber-50', icon: 'text-amber-600' },
  red: { bg: 'bg-red-50', icon: 'text-red-600' },
  purple: { bg: 'bg-purple-50', icon: 'text-purple-600' },
  orange: { bg: 'bg-orange-50', icon: 'text-orange-600' },
  teal: { bg: 'bg-teal-50', icon: 'text-teal-600' },
  indigo: { bg: 'bg-indigo-50', icon: 'text-indigo-600' },
};

function fmt(n: number) { return n.toLocaleString('en-US'); }

interface PeriodData {
  totalOrders: number;
  shippingOrders: number;
  totalCollection: number;
  cashCollection: number;
  creditCollection: number;
  dailyDeposited: number;
  dailyRemaining: number;
  pendingOrders: number;
  returnedOrders: number;
  cancelledOrders: number;
  deliveredOrders: number;
}

const EMPTY_DATA: PeriodData = {
  totalOrders: 0, shippingOrders: 0, totalCollection: 0,
  cashCollection: 0, creditCollection: 0, dailyDeposited: 0,
  dailyRemaining: 0, pendingOrders: 0, returnedOrders: 0,
  cancelledOrders: 0, deliveredOrders: 0,
};

function getDateRange(period: string): { from: string; to: string } {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const fmtDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  if (period === 'today') {
    const t = fmtDate(now);
    return { from: t, to: t };
  }
  if (period === 'yesterday') {
    const y = new Date(now); y.setDate(y.getDate() - 1);
    const ys = fmtDate(y);
    return { from: ys, to: ys };
  }
  if (period === 'week') {
    const start = new Date(now); start.setDate(now.getDate() - 6);
    return { from: fmtDate(start), to: fmtDate(now) };
  }
  // month
  const start = new Date(now); start.setDate(now.getDate() - 29);
  return { from: fmtDate(start), to: fmtDate(now) };
}

export default function DashboardKPIs() {
  const [period, setPeriod] = useState<'today' | 'yesterday' | 'week' | 'month'>('today');
  const [lastRefresh, setLastRefresh] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [data, setData] = useState<PeriodData>(EMPTY_DATA);

  const fetchData = useCallback(async (p: string) => {
    setIsRefreshing(true);
    try {
      const supabase = createClient();
      const { from, to } = getDateRange(p);

      const { data: orders, error } = await supabase
        .from('zahranship_orders')
        .select('id, status, total, subtotal, shipping_fee, date')
        .gte('date', from)
        .lte('date', to);

      if (!error && orders) {
        const totalOrders = orders.length;
        const shippingOrders = orders.filter(o => o.status === 'shipping').length;
        const pendingOrders = orders.filter(o => ['new', 'preparing', 'warehouse'].includes(o.status)).length;
        const returnedOrders = orders.filter(o => o.status === 'returned').length;
        const cancelledOrders = orders.filter(o => o.status === 'cancelled').length;
        const deliveredOrders = orders.filter(o => o.status === 'delivered').length;

        // Total collection = sum of totals for delivered orders
        const deliveredList = orders.filter(o => o.status === 'delivered');
        const totalCollection = deliveredList.reduce((sum, o) => sum + Number(o.total || 0), 0);

        // Cash = subtotal of delivered, Credit = shipping fees of delivered (approximation based on real fields)
        // Better: total collection is the real number; split is subtotal vs shipping_fee
        const cashCollection = deliveredList.reduce((sum, o) => sum + Number(o.subtotal || 0), 0);
        const creditCollection = deliveredList.reduce((sum, o) => sum + Number(o.shipping_fee || 0), 0);

        // Deposited: sum of all delivered orders' totals (they are collected)
        // Remaining: orders in shipping (not yet collected)
        const dailyDeposited = totalCollection;
        const shippingTotal = orders.filter(o => o.status === 'shipping').reduce((sum, o) => sum + Number(o.total || 0), 0);
        const dailyRemaining = shippingTotal;

        setData({
          totalOrders, shippingOrders, totalCollection,
          cashCollection, creditCollection,
          dailyDeposited, dailyRemaining,
          pendingOrders, returnedOrders, cancelledOrders, deliveredOrders,
        });
      }
    } catch { /* silently fail */ }

    const now = new Date();
    const h = now.getHours().toString().padStart(2, '0');
    const m = now.getMinutes().toString().padStart(2, '0');
    const s = now.getSeconds().toString().padStart(2, '0');
    setLastRefresh(`${h}:${m}:${s}`);
    setIsRefreshing(false);
  }, []);

  useEffect(() => {
    fetchData(period);

    // Realtime subscription
    const supabase = createClient();
    const channel = supabase
      .channel(`dashboard-kpis-${period}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'zahranship_orders' }, () => {
        fetchData(period);
      })
      .subscribe();

    // Also listen for manual events from other components
    const handler = () => fetchData(period);
    window.addEventListener('zahranship_order_updated', handler);
    window.addEventListener('zahranship_order_added', handler);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener('zahranship_order_updated', handler);
      window.removeEventListener('zahranship_order_added', handler);
    };
  }, [period, fetchData]);

  const kpis = [
    {
      id: 'total', title: 'إجمالي الأوردرات', value: fmt(data.totalOrders),
      sub: PERIOD_LABELS[period], color: 'blue', span: true,
      Icon: Package, change: null,
    },
    {
      id: 'shipping', title: 'جاري الشحن', value: fmt(data.shippingOrders),
      sub: 'أوردر في الطريق', color: 'orange', span: false,
      Icon: Truck, change: null,
    },
    {
      id: 'delivered', title: 'تم التسليم', value: fmt(data.deliveredOrders),
      sub: 'أوردر مسلّم', color: 'green', span: false,
      Icon: CheckCircle, change: null,
    },
    {
      id: 'collection', title: 'إجمالي التحصيل', value: fmt(data.totalCollection),
      sub: 'ج.م — من الأوردرات المسلّمة', color: 'green', span: false,
      Icon: DollarSign, change: null,
    },
    {
      id: 'cash', title: 'قيمة المنتجات', value: fmt(data.cashCollection),
      sub: 'ج.م — إجمالي المنتجات', color: 'teal', span: false,
      Icon: Banknote, change: null,
    },
    {
      id: 'credit', title: 'رسوم الشحن', value: fmt(data.creditCollection),
      sub: 'ج.م — رسوم الشحن', color: 'indigo', span: false,
      Icon: CreditCard, change: null,
    },
    {
      id: 'deposited', title: 'تم التحصيل', value: fmt(data.dailyDeposited),
      sub: 'ج.م — أوردرات مسلّمة', color: 'purple', span: false,
      Icon: CheckCircle, change: null,
    },
    {
      id: 'remaining', title: 'قيد الشحن (لم يُحصَّل)', value: fmt(data.dailyRemaining),
      sub: 'ج.م — في الطريق', color: 'amber', span: false,
      Icon: Clock, change: null, alert: data.dailyRemaining > 0,
    },
    {
      id: 'pending', title: 'أوردرات معلقة', value: fmt(data.pendingOrders),
      sub: 'تحتاج مراجعة', color: 'red', span: false,
      Icon: AlertCircle, change: null, alert: data.pendingOrders > 0,
    },
    {
      id: 'returned', title: 'مرتجعات', value: fmt(data.returnedOrders),
      sub: 'بانتظار معالجة', color: 'amber', span: false,
      Icon: RotateCcw, change: null,
    },
  ];

  const handleExport = () => {
    const rows = [
      ['المؤشر', 'القيمة', 'الفترة'],
      ['إجمالي الأوردرات', data.totalOrders, PERIOD_LABELS[period]],
      ['جاري الشحن', data.shippingOrders, PERIOD_LABELS[period]],
      ['تم التسليم', data.deliveredOrders, PERIOD_LABELS[period]],
      ['إجمالي التحصيل (ج.م)', data.totalCollection, PERIOD_LABELS[period]],
      ['قيمة المنتجات (ج.م)', data.cashCollection, PERIOD_LABELS[period]],
      ['رسوم الشحن (ج.م)', data.creditCollection, PERIOD_LABELS[period]],
      ['تم التحصيل (ج.م)', data.dailyDeposited, PERIOD_LABELS[period]],
      ['قيد الشحن (ج.م)', data.dailyRemaining, PERIOD_LABELS[period]],
      ['أوردرات معلقة', data.pendingOrders, PERIOD_LABELS[period]],
      ['مرتجعات', data.returnedOrders, PERIOD_LABELS[period]],
    ];
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dashboard-${period}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 bg-[hsl(var(--muted))] rounded-xl p-1">
          {(Object.keys(PERIOD_LABELS) as Array<keyof typeof PERIOD_LABELS>).map(p => (
            <button
              key={p}
              onClick={() => { setPeriod(p as typeof period); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${period === p ? 'bg-white shadow text-[hsl(var(--primary))]' : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'}`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowFilter(!showFilter)}
          className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border font-semibold transition-all ${showFilter ? 'bg-[hsl(var(--primary))] text-white border-[hsl(var(--primary))]' : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]'}`}
        >
          <Filter size={13} />
          فلتر
        </button>
        <button
          onClick={handleExport}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border border-[hsl(var(--border))] font-semibold hover:bg-[hsl(var(--muted))] transition-all"
        >
          <Download size={13} />
          تصدير CSV
        </button>
        <button
          onClick={() => fetchData(period)}
          className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-[hsl(var(--primary))] text-white font-semibold hover:opacity-90 transition-all ${isRefreshing ? 'opacity-70' : ''}`}
        >
          <RefreshCw size={13} className={isRefreshing ? 'animate-spin' : ''} />
          تحديث
        </button>
        {lastRefresh && (
          <span className="text-[11px] text-[hsl(var(--muted-foreground))] flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
            آخر تحديث: {lastRefresh}
          </span>
        )}
      </div>

      {/* Filter panel */}
      {showFilter && (
        <div className="bg-[hsl(var(--muted))]/40 border border-[hsl(var(--border))] rounded-xl p-4 flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs font-semibold mb-1.5 text-[hsl(var(--muted-foreground))]">من تاريخ</label>
            <input type="date" className="px-3 py-2 border border-[hsl(var(--border))] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30" dir="ltr" />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5 text-[hsl(var(--muted-foreground))]">إلى تاريخ</label>
            <input type="date" className="px-3 py-2 border border-[hsl(var(--border))] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30" dir="ltr" />
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {kpis.map(kpi => {
          const colors = colorMap[kpi.color] || colorMap['blue'];
          return (
            <div
              key={kpi.id}
              className={`kpi-card relative ${(kpi as { alert?: boolean }).alert ? 'ring-2 ring-red-200' : ''}`}
            >
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-2.5 ${colors.bg} ${colors.icon}`}>
                <kpi.Icon size={18} />
              </div>
              <p className="text-[11px] text-[hsl(var(--muted-foreground))] mb-1 leading-tight">{kpi.title}</p>
              <p className="text-xl font-bold text-[hsl(var(--foreground))] font-mono leading-none">{kpi.value}</p>
              <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-1">{kpi.sub}</p>
              {isRefreshing && (
                <div className="absolute inset-0 bg-white/50 rounded-2xl flex items-center justify-center">
                  <RefreshCw size={14} className="animate-spin text-[hsl(var(--primary))]" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}