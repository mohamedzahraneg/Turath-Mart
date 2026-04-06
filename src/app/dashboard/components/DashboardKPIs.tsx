'use client';
import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Package,
  Truck,
  CheckCircle,
  AlertCircle,
  DollarSign,
  MapPin,
  Loader2,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

// ─── Types ───────────────────────────────────────────────────────────────────

interface KPIData {
  totalOrders: number;
  deliveredOrders: number;
  shippingOrders: number;
  pendingOrders: number;
  returnedOrders: number;
  totalRevenue: number;
  successRate: number;
  topRegion: { name: string; count: number };
  previousData?: {
    totalOrders: number;
    deliveredOrders: number;
    totalRevenue: number;
  };
}

const TARGET_DAILY_ORDERS = 20;

const PERIOD_LABELS: Record<string, string> = {
  today: 'اليوم',
  yesterday: 'أمس',
  week: 'آخر 7 أيام',
  month: 'هذا الشهر',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function DashboardKPIs() {
  const [period, setPeriod] = useState<'today' | 'yesterday' | 'week' | 'month'>('today');
  const { currentRoleId } = useAuth();
  const isAdmin = currentRoleId === 'r1';
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [data, setData] = useState<KPIData>({
    totalOrders: 0,
    deliveredOrders: 0,
    shippingOrders: 0,
    pendingOrders: 0,
    returnedOrders: 0,
    totalRevenue: 0,
    successRate: 0,
    topRegion: { name: '—', count: 0 },
  });
  const [dbError, setDbError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const supabase = createClient();
      const now = new Date();
      let start = new Date();
      let prevStart = new Date();
      let prevEnd = new Date();

      if (period === 'today') {
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        prevStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        prevEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      } else if (period === 'yesterday') {
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        prevStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2);
        prevEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      } else if (period === 'week') {
        start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        prevStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
        prevEnd = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      } else if (period === 'month') {
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        prevEnd = new Date(now.getFullYear(), now.getMonth(), 1);
      }

      // 1. Current Stats
      const { data: orders, error } = await supabase
        .from('turath_masr_orders')
        .select('status, total, region, created_at')
        .gte('created_at', start.toISOString());

      // 2. Previous Stats for Growth
      const { data: prevOrders } = await supabase
        .from('turath_masr_orders')
        .select('status, total')
        .gte('created_at', prevStart.toISOString())
        .lt('created_at', prevEnd.toISOString());

      if (error) throw error;

      if (orders) {
        const stats = {
          total: orders.length,
          delivered: orders.filter((o) => o.status === 'delivered').length,
          shipping: orders.filter((o) => o.status === 'shipping').length,
          returned: orders.filter((o) => ['returned', 'cancelled'].includes(o.status)).length,
          revenue: orders
            .filter((o) => o.status === 'delivered')
            .reduce((s, o) => s + (o.total || 0), 0),
        };

        const prevStats = {
          totalOrders: prevOrders?.length || 0,
          deliveredOrders: prevOrders?.filter((o) => o.status === 'delivered').length || 0,
          totalRevenue:
            prevOrders
              ?.filter((o) => o.status === 'delivered')
              .reduce((s, o) => s + (o.total || 0), 0) || 0,
        };

        const regions: Record<string, number> = {};
        orders.forEach((o) => {
          if (o.region) regions[o.region] = (regions[o.region] || 0) + 1;
        });
        const topR = Object.entries(regions).sort((a, b) => b[1] - a[1])[0] || ['—', 0];

        setData({
          totalOrders: stats.total,
          deliveredOrders: stats.delivered,
          shippingOrders: stats.shipping,
          pendingOrders: Math.max(
            0,
            stats.total - stats.delivered - stats.returned - stats.shipping
          ),
          returnedOrders: stats.returned,
          totalRevenue: stats.revenue,
          successRate: stats.total > 0 ? Math.round((stats.delivered / stats.total) * 100) : 0,
          topRegion: { name: topR[0], count: topR[1] as number },
          previousData: prevStats,
        });
      }
      setLastUpdated(
        new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
      );
    } catch (err: any) {
      console.error('KPI Fetch Error:', err);
      if (err.message?.includes('relation') || err.code === '42P01') {
        setDbError('Missing Tables: Please run crm-schema.sql in Supabase SQL Editor.');
      }
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [period]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const calcGrowth = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 100);
  };

  const cards = [
    {
      label: 'إجمالي الطلبات',
      value: data.totalOrders,
      icon: <Package size={20} />,
      color: 'blue',
      sub: 'طلب',
      growth: calcGrowth(data.totalOrders, data.previousData?.totalOrders || 0),
    },
    {
      label: 'تم التسليم',
      value: data.deliveredOrders,
      icon: <CheckCircle size={20} />,
      color: 'green',
      sub: 'ناجح',
      growth: calcGrowth(data.deliveredOrders, data.previousData?.deliveredOrders || 0),
    },
    {
      label: 'جاري الشحن',
      value: data.shippingOrders,
      icon: <Truck size={20} />,
      color: 'orange',
      sub: 'في الطريق',
    },
    {
      label: 'إجمالي التحصيل',
      value: data.totalRevenue.toLocaleString('en-US'),
      icon: <DollarSign size={20} />,
      color: 'emerald',
      sub: 'ج.م',
      growth: calcGrowth(data.totalRevenue, data.previousData?.totalRevenue || 0),
    },
  ];

  return (
    <div className="space-y-6">
      {dbError && (
        <div className="bg-red-50 border-2 border-red-100 rounded-2xl p-6 flex flex-col items-center text-center gap-4 animate-in fade-in slide-in-from-top-4 duration-500">
          <div className="w-16 h-16 rounded-full bg-red-100 text-red-600 flex items-center justify-center shadow-inner">
            <AlertCircle size={32} />
          </div>
          <div>
            <h3 className="text-lg font-black text-red-900 mb-1">تنبيه: جداول البيانات مفقودة</h3>
            <p className="text-sm text-red-600 font-bold max-w-md mx-auto leading-relaxed">
              يرجى التوجه إلى Supabase SQL Editor وتشغيل ملفات{' '}
              <code className="bg-red-100 px-2 py-0.5 rounded">crm-schema.sql</code> و{' '}
              <code className="bg-red-100 px-2 py-0.5 rounded">create-notifications.sql</code>{' '}
              لتفعيل مميزات النظام الاحترافية.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex bg-gray-100 p-1 rounded-xl gap-1 shadow-inner">
            {Object.keys(PERIOD_LABELS).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p as any)}
                className={`text-[11px] px-4 py-1.5 rounded-lg font-bold transition-all ${period === p ? 'bg-white text-[hsl(var(--primary))] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
          <div className="h-4 w-px bg-gray-200 hidden sm:block" />
          <p className="text-[10px] text-gray-400 font-medium hidden sm:block">
            آخر تحديث: {lastUpdated}
          </p>
        </div>
        <button
          onClick={fetchData}
          disabled={isRefreshing}
          className="flex items-center gap-2 text-[11px] font-bold text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/5 px-3 py-1.5 rounded-lg transition-colors"
        >
          <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
          تحديث المعلومات
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {cards.filter(card => isAdmin || card.label !== 'إجمالي التحصيل').map((card, i) => (
          <div
            key={i}
            className="bg-white border border-gray-100 rounded-3xl p-6 hover:shadow-xl hover:-translate-y-1 transition-all group overflow-hidden relative"
          >
            <div
              className={`absolute top-0 right-0 w-1.5 h-full ${
                card.color === 'blue'
                  ? 'bg-blue-500'
                  : card.color === 'green'
                    ? 'bg-green-500'
                    : card.color === 'orange'
                      ? 'bg-orange-500'
                      : 'bg-emerald-500'
              }`}
            />
            <div className="flex items-start justify-between mb-4">
              <div
                className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110 ${
                  card.color === 'blue'
                    ? 'bg-blue-50 text-blue-600'
                    : card.color === 'green'
                      ? 'bg-green-50 text-green-600'
                      : card.color === 'orange'
                        ? 'bg-orange-50 text-orange-600'
                        : 'bg-emerald-50 text-emerald-600'
                } shadow-lg shadow-current/5`}
              >
                {card.icon}
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">
                  {card.label}
                </p>
                <div className="flex items-baseline gap-1 justify-end">
                  <span className="text-2xl font-bold text-gray-900 font-mono tracking-tighter">
                    {loading ? (
                      <Loader2 className="animate-spin text-gray-300" size={16} />
                    ) : (
                      card.value
                    )}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-end justify-between mt-2">
              <span className="text-[10px] font-bold text-gray-400">{card.sub}</span>
              {card.growth !== undefined && !loading && (
                <div
                  className={`flex items-center gap-0.5 px-2 py-0.5 rounded-lg text-[10px] font-bold ${
                    card.growth >= 0
                      ? 'bg-green-50 text-green-600 border border-green-100'
                      : 'bg-red-50 text-red-600 border border-red-100'
                  }`}
                >
                  {card.growth >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                  {Math.abs(card.growth)}٪
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Daily Goal Progress Bar Card */}
        <div className="bg-white border border-gray-100 rounded-3xl p-6 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center shadow-lg shadow-purple-100">
                <TrendingUp size={20} />
              </div>
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                  هدف اليوم
                </p>
                <p className="text-lg font-bold text-gray-900">
                  {loading ? '—' : data.totalOrders} / {TARGET_DAILY_ORDERS}
                </p>
              </div>
            </div>
            <div className="text-left">
              <p className="text-[10px] font-bold text-gray-400 uppercase">النسبة</p>
              <p className="text-sm font-bold text-purple-600">
                {loading
                  ? '0%'
                  : Math.min(100, Math.round((data.totalOrders / TARGET_DAILY_ORDERS) * 100))}
                %
              </p>
            </div>
          </div>
          <div>
            <div className="w-full bg-gray-100 h-2.5 rounded-full overflow-hidden mb-2">
              <div
                className="h-full bg-gradient-to-l from-purple-600 to-purple-400 rounded-full transition-all duration-1000 shadow-[0_0_12px_rgba(168,85,247,0.3)]"
                style={{
                  width: `${loading ? 0 : Math.min(100, (data.totalOrders / TARGET_DAILY_ORDERS) * 100)}%`,
                }}
              />
            </div>
            <p className="text-[9px] text-gray-400 font-medium">
              متبقي{' '}
              <span className="font-bold text-purple-600">
                {Math.max(0, TARGET_DAILY_ORDERS - data.totalOrders)}
              </span>{' '}
              طلب لتحقيق الهدف اليومي
            </p>
          </div>
        </div>

        {/* Returns Summary */}
        <div className="bg-white border border-gray-100 rounded-3xl p-6 shadow-sm flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center shadow-lg shadow-red-100">
              <AlertCircle size={22} />
            </div>
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                المرتجعات والتوالي
              </p>
              <p className="text-xl font-bold text-gray-900">
                {loading ? '—' : data.returnedOrders}{' '}
                <span className="text-[10px] text-gray-400">طلب</span>
              </p>
              <div className="flex items-center gap-1.5 mt-1">
                <p className="text-[10px] font-bold text-red-600">
                  {data.totalOrders > 0
                    ? ((data.returnedOrders / data.totalOrders) * 100).toFixed(1)
                    : 0}
                  %
                </p>
                <p className="text-[10px] text-gray-400 font-medium">معدل الارتجاع الكلي</p>
              </div>
            </div>
          </div>
        </div>

        {/* Top Region Card */}
        <div className="bg-white border border-gray-100 rounded-3xl p-6 shadow-sm flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-orange-50 text-orange-600 flex items-center justify-center shadow-lg shadow-orange-100">
              <MapPin size={22} />
            </div>
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                سوق المحافظات النشطة
              </p>
              <p className="text-xl font-bold text-gray-900">
                {loading ? '—' : data.topRegion.name}
              </p>
              <div className="flex items-center gap-1.5 mt-1">
                <p className="text-[10px] font-bold text-orange-600">{data.topRegion.count} طلب</p>
                <p className="text-[10px] text-gray-400 font-medium">منطقة الاستلام الأولى</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
