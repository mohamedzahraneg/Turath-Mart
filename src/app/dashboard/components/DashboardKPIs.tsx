'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Download, TrendingUp, TrendingDown, Minus, Filter, X } from 'lucide-react';

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

type KPIData = {
  totalOrders: number; shippingOrders: number; totalCollection: number;
  netDeposit: number; pendingOrders: number; returnedOrders: number;
  cashCollection: number; creditCollection: number; dailyDeposited: number;
  dailyRemaining: number;
};

const EMPTY_KPI: KPIData = {
  totalOrders: 0, shippingOrders: 0, totalCollection: 0,
  netDeposit: 0, pendingOrders: 0, returnedOrders: 0,
  cashCollection: 0, creditCollection: 0, dailyDeposited: 0,
  dailyRemaining: 0,
};

export default function DashboardKPIs() {
  const [period, setPeriod] = useState<'today' | 'yesterday' | 'week' | 'month'>('today');
  const [lastRefresh, setLastRefresh] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [kpiData, setKpiData] = useState<KPIData>(EMPTY_KPI);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    
    try {
      const supabase = createClient();
      
      const now = new Date();
      let startDateStr = new Date().toISOString();
      let endDateStr = new Date().toISOString();
      
      if (period === 'today') {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        startDateStr = start.toISOString();
        endDateStr = new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString();
      } else if (period === 'yesterday') {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        startDateStr = start.toISOString();
        endDateStr = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      } else if (period === 'week') {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
        startDateStr = start.toISOString();
        endDateStr = now.toISOString();
      } else if (period === 'month') {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        startDateStr = start.toISOString();
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        endDateStr = end.toISOString();
      }

      // Fetch aggregated data manually since there are no direct RPC aggregations yet
      const { data, error } = await supabase
        .from('zahranship_orders')
        .select('status, total, created_at')
        .gte('created_at', startDateStr)
        .lt('created_at', endDateStr);

      if (!error && data) {
        let totalOrders = 0;
        let shippingOrders = 0;
        let pendingOrders = 0;
        let returnedOrders = 0;
        let totalCollection = 0;
        
        data.forEach(order => {
          totalOrders++;
          if (order.status === 'shipping') shippingOrders++;
          else if (order.status === 'new') pendingOrders++;
          else if (order.status === 'returned') returnedOrders++;
          
          if (order.status !== 'cancelled' && order.status !== 'returned') {
            totalCollection += Number(order.total || 0);
          }
        });

        // Some stats are simulated for now as they're not in DB schema yet (like cash vs credit, deposit)
        const dailyDeposited = Math.floor(totalCollection * 0.6); // mock 60%
        
        setKpiData({
          totalOrders,
          shippingOrders,
          totalCollection,
          netDeposit: totalCollection * 0.9,
          pendingOrders,
          returnedOrders,
          cashCollection: Math.floor(totalCollection * 0.8),
          creditCollection: totalCollection - Math.floor(totalCollection * 0.8),
          dailyDeposited,
          dailyRemaining: totalCollection - dailyDeposited,
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsRefreshing(false);
      const now = new Date();
      const h = now.getHours().toString().padStart(2, '0');
      const m = now.getMinutes().toString().padStart(2, '0');
      const s = now.getSeconds().toString().padStart(2, '0');
      setLastRefresh(`${h}:${m}:${s}`);
    }
  }, [period]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30000); // auto-refresh every 30s
    return () => clearInterval(interval);
  }, [refresh]);

  const kpis = [
    {
      id: 'total', title: 'إجمالي الأوردرات', value: fmt(kpiData.totalOrders),
      sub: PERIOD_LABELS[period], color: 'blue', span: true,
      icon: '📦', change: period === 'today' ? 12.5 : 8.2,
    },
    {
      id: 'shipping', title: 'جاري الشحن', value: fmt(kpiData.shippingOrders),
      sub: 'أوردر في الطريق', color: 'orange', span: false,
      icon: '🚚', change: 5.2,
    },
    {
      id: 'collection', title: 'إجمالي التحصيل', value: fmt(kpiData.totalCollection),
      sub: 'ج.م', color: 'green', span: false,
      icon: '💰', change: 8.7,
    },
    {
      id: 'cash', title: 'تحصيل كاش', value: fmt(kpiData.cashCollection),
      sub: 'ج.م نقداً', color: 'teal', span: false,
      icon: '💵', change: 6.3,
    },
    {
      id: 'credit', title: 'تحصيل آجل', value: fmt(kpiData.creditCollection),
      sub: 'ج.م آجل', color: 'indigo', span: false,
      icon: '🏦', change: -1.2,
    },
    {
      id: 'deposited', title: 'تم التوريد', value: fmt(kpiData.dailyDeposited),
      sub: 'ج.م — تم توريده', color: 'purple', span: false,
      icon: '✅', change: 4.1,
    },
    {
      id: 'remaining', title: 'المتبقي للتوريد', value: fmt(kpiData.dailyRemaining),
      sub: 'ج.م — لم يُوَرَّد', color: 'amber', span: false,
      icon: '⏳', change: -3.5, alert: kpiData.dailyRemaining > 8000,
    },
    {
      id: 'pending', title: 'أوردرات معلقة', value: fmt(kpiData.pendingOrders),
      sub: 'تحتاج مراجعة', color: 'red', span: false,
      icon: '⚠️', change: 40, alert: true,
    },
    {
      id: 'returned', title: 'مرتجعات', value: fmt(kpiData.returnedOrders),
      sub: 'بانتظار معالجة', color: 'amber', span: false,
      icon: '↩️', change: 0,
    },
  ];

  const handleExport = () => {
    const rows = [
      ['المؤشر', 'القيمة', 'الفترة'],
      ['إجمالي الأوردرات', kpiData.totalOrders, PERIOD_LABELS[period]],
      ['جاري الشحن', kpiData.shippingOrders, PERIOD_LABELS[period]],
      ['إجمالي التحصيل (ج.م)', kpiData.totalCollection, PERIOD_LABELS[period]],
      ['تحصيل كاش (ج.م)', kpiData.cashCollection, PERIOD_LABELS[period]],
      ['تحصيل آجل (ج.م)', kpiData.creditCollection, PERIOD_LABELS[period]],
      ['تم التوريد (ج.م)', kpiData.dailyDeposited, PERIOD_LABELS[period]],
      ['المتبقي للتوريد (ج.م)', kpiData.dailyRemaining, PERIOD_LABELS[period]],
      ['أوردرات معلقة', kpiData.pendingOrders, PERIOD_LABELS[period]],
      ['مرتجعات', kpiData.returnedOrders, PERIOD_LABELS[period]],
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
              onClick={() => { setPeriod(p as typeof period); refresh(); }}
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
          onClick={refresh}
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
          <div>
            <label className="block text-xs font-semibold mb-1.5 text-[hsl(var(--muted-foreground))]">المحافظة</label>
            <select className="px-3 py-2 border border-[hsl(var(--border))] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30">
              <option value="">الكل</option>
              <option>القاهرة</option>
              <option>الجيزة</option>
              <option>القليوبية</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5 text-[hsl(var(--muted-foreground))]">الحالة</label>
            <select className="px-3 py-2 border border-[hsl(var(--border))] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30">
              <option value="">الكل</option>
              <option>جديد</option>
              <option>جاري الشحن</option>
              <option>تم التسليم</option>
              <option>مرتجع</option>
            </select>
          </div>
          <button onClick={() => setShowFilter(false)} className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl bg-[hsl(var(--primary))] text-white font-semibold hover:opacity-90">
            تطبيق الفلتر
          </button>
          <button onClick={() => setShowFilter(false)} className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl border border-[hsl(var(--border))] font-semibold hover:bg-[hsl(var(--muted))]">
            <X size={12} /> إغلاق
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {kpis.map((kpi) => {
          const colors = colorMap[kpi.color];
          const isPositive = kpi.change > 0;
          const isNegative = kpi.change < 0;
          const isNeutral = kpi.change === 0;
          return (
            <div
              key={kpi.id}
              className={`kpi-card relative overflow-hidden ${kpi.span ? 'sm:col-span-2' : ''} ${kpi.alert ? 'border-red-200 bg-red-50/30' : ''}`}
            >
              {kpi.alert && <div className="absolute top-0 right-0 w-1 h-full bg-red-500 rounded-r-2xl" />}
              <div className="flex items-start justify-between mb-4">
                <div className={`w-11 h-11 rounded-xl ${colors.bg} ${colors.icon} flex items-center justify-center flex-shrink-0 text-xl`}>
                  {kpi.icon}
                </div>
                {kpi.change !== undefined && (
                  <div className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg ${
                    isPositive && !kpi.alert ? 'bg-green-50 text-green-700' : isNegative ?'bg-red-50 text-red-600' : kpi.alert && isPositive ?'bg-red-50 text-red-600' :'bg-gray-100 text-gray-600'
                  }`}>
                    {isNeutral ? <Minus size={12} /> : isPositive && !kpi.alert ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                    <span>{Math.abs(kpi.change)}%</span>
                  </div>
                )}
              </div>
              <div>
                <p className="text-[13px] font-medium text-[hsl(var(--muted-foreground))] mb-1 tracking-wide">{kpi.title}</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-[hsl(var(--foreground))] font-mono tabular-nums" style={{ fontVariantNumeric: 'tabular-nums' }}>{kpi.value}</span>
                  {kpi.sub && <span className="text-sm text-[hsl(var(--muted-foreground))]">{kpi.sub}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Daily collections summary bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-gradient-to-l from-green-50 to-teal-50 border border-green-200 rounded-xl p-4">
          <p className="text-xs font-bold text-green-700 mb-1">إجمالي التحصيل اليومي</p>
          <p className="text-2xl font-bold font-mono text-green-800">{fmt(kpiData.totalCollection)} <span className="text-sm font-normal">ج.م</span></p>
          <div className="flex gap-3 mt-2 text-xs">
            <span className="text-teal-700">💵 كاش: <strong>{fmt(kpiData.cashCollection)}</strong></span>
            <span className="text-indigo-700">🏦 آجل: <strong>{fmt(kpiData.creditCollection)}</strong></span>
          </div>
        </div>
        <div className="bg-gradient-to-l from-purple-50 to-blue-50 border border-purple-200 rounded-xl p-4">
          <p className="text-xs font-bold text-purple-700 mb-1">تم التوريد</p>
          <p className="text-2xl font-bold font-mono text-purple-800">{fmt(kpiData.dailyDeposited)} <span className="text-sm font-normal">ج.م</span></p>
          <div className="mt-2">
            <div className="w-full bg-purple-100 rounded-full h-1.5">
              <div
                className="bg-purple-500 h-1.5 rounded-full transition-all"
                style={{ width: `${Math.min(100, kpiData.totalCollection ? (kpiData.dailyDeposited / kpiData.totalCollection) * 100 : 0).toFixed(0)}%` }}
              />
            </div>
            <p className="text-[10px] text-purple-600 mt-1">{kpiData.totalCollection ? ((kpiData.dailyDeposited / kpiData.totalCollection) * 100).toFixed(0) : 0}% من الإجمالي</p>
          </div>
        </div>
        <div className="bg-gradient-to-l from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-4">
          <p className="text-xs font-bold text-amber-700 mb-1">المتبقي للتوريد</p>
          <p className="text-2xl font-bold font-mono text-amber-800">{fmt(kpiData.dailyRemaining)} <span className="text-sm font-normal">ج.م</span></p>
          <p className="text-[10px] text-amber-600 mt-2">⏳ لم يُوَرَّد بعد — {PERIOD_LABELS[period]}</p>
        </div>
      </div>
    </div>
  );
}