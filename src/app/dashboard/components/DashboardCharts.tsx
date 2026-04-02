'use client';
import React, { useState, useEffect } from 'react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { createClient } from '@/lib/supabase/client';
import { Loader2, AlertTriangle } from 'lucide-react';

const CustomTooltipArea = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div
        className="bg-white border border-[hsl(var(--border))] rounded-xl shadow-lg p-3 text-sm"
        dir="rtl"
      >
        <p className="font-semibold text-[hsl(var(--foreground))] mb-2">{label}</p>
        {payload.map((entry: any, i: number) => (
          <div key={`tooltip-area-${i}`} className="flex items-center gap-2 mb-1">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
            <span className="text-[hsl(var(--muted-foreground))]">{entry.name}:</span>
            <span className="font-semibold">{entry.value.toLocaleString('en-US')}</span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

const CustomTooltipBar = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div
        className="bg-white border border-[hsl(var(--border))] rounded-xl shadow-lg p-3 text-sm"
        dir="rtl"
      >
        <p className="font-semibold text-[hsl(var(--foreground))] mb-2">{label}</p>
        {payload.map((entry: any, i: number) => (
          <div key={`tooltip-bar-${i}`} className="flex items-center gap-2 mb-1">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
            <span className="text-[hsl(var(--muted-foreground))]">{entry.name}:</span>
            <span className="font-semibold">{entry.value.toLocaleString('en-US')}</span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

const DAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export default function DashboardCharts() {
  const [activeChart, setActiveChart] = useState<'weekly' | 'daily'>('weekly');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{
    daily: any[];
    regions: any[];
  }>({ daily: [], regions: [] });
  const [dbError, setDbError] = useState(false);

  useEffect(() => {
    const fetchChartData = async () => {
      try {
        const supabase = createClient();
        const now = new Date();
        const eightDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);

        const { data: rawOrders, error } = await supabase
          .from('zahranship_orders')
          .select('created_at, status, total, region')
          .gte('created_at', eightDaysAgo.toISOString())
          .order('created_at', { ascending: true });

        if (error) throw error;

        // Group by day
        const dayMap = new Map();
        for (let i = 0; i < 8; i++) {
          const d = new Date(
            eightDaysAgo.getFullYear(),
            eightDaysAgo.getMonth(),
            eightDaysAgo.getDate() + i
          );
          const dateStr = d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
          const dayName = DAYS_AR[d.getDay()];
          dayMap.set(dateStr, {
            date: dateStr,
            day: dayName,
            orders: 0,
            delivered: 0,
            returned: 0,
            revenue: 0,
          });
        }

        const regionMap = new Map();

        rawOrders?.forEach((o) => {
          const d = new Date(o.created_at);
          const dateStr = d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });

          if (dayMap.has(dateStr)) {
            const entry = dayMap.get(dateStr);
            entry.orders += 1;
            if (o.status === 'delivered') {
              entry.delivered += 1;
              entry.revenue += o.total || 0;
            }
            if (o.status === 'returned') entry.returned += 1;
          }

          const reg = o.region || 'غير محدد';
          if (!regionMap.has(reg))
            regionMap.set(reg, { region: reg, orders: 0, delivered: 0, pending: 0 });
          const rEntry = regionMap.get(reg);
          rEntry.orders += 1;
          if (o.status === 'delivered') rEntry.delivered += 1;
          else if (['new', 'preparing', 'warehouse', 'shipping'].includes(o.status))
            rEntry.pending += 1;
        });

        setData({
          daily: Array.from(dayMap.values()),
          regions: Array.from(regionMap.values())
            .sort((a, b) => b.orders - a.orders)
            .slice(0, 5),
        });
        setDbError(false);
      } catch (err: any) {
        console.error('Error fetching chart data:', err);
        if (err.message?.includes('relation') || err.code === '42P01') {
          setDbError(true);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchChartData();
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        <div className="xl:col-span-3 flex flex-col items-center justify-center bg-white border border-gray-100 rounded-3xl h-[400px] shadow-sm">
          <Loader2 className="animate-spin text-[hsl(var(--primary))] mb-4" size={32} />
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
            مزامنة البيانات الرسومية...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
      {dbError && (
        <div className="xl:col-span-3 bg-amber-50 border-2 border-amber-100 rounded-3xl p-8 flex flex-col items-center text-center gap-6 animate-in fade-in zoom-in duration-500">
          <div className="w-16 h-16 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center shadow-lg transform rotate-3">
            <AlertTriangle size={32} />
          </div>
          <div>
            <h3 className="text-xl font-black text-amber-900 mb-2">البيانات الرسومية غير متوفرة</h3>
            <p className="text-sm text-amber-600 font-bold max-w-lg mx-auto leading-relaxed">
              لم يتم العثور على جداول البيانات المطلوبة للرسوم البيانية. يرجى مراجعة إعدادات قاعدة
              البيانات والتأكد من تشغيل ملفات التهيئة (Migration Scripts).
            </p>
          </div>
        </div>
      )}

      {/* Area Chart — Orders trend */}
      <div
        className={`xl:col-span-2 card-section p-6 shadow-md hover:shadow-lg transition-shadow bg-white border border-gray-100 rounded-3xl ${dbError ? 'opacity-40 grayscale pointer-events-none' : ''}`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
          <div>
            <h3 className="text-base font-bold text-[hsl(var(--foreground))]">اتجاهات الأداء</h3>
            <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-0.5 font-bold uppercase tracking-wider">
              تحليل حركة الـ ٨ أيام الماضية
            </p>
          </div>
          <div className="flex bg-[hsl(var(--muted))] rounded-xl p-1 gap-1 shadow-inner">
            <button
              onClick={() => setActiveChart('weekly')}
              className={`text-[10px] px-4 py-1.5 rounded-lg font-bold transition-all ${activeChart === 'weekly' ? 'bg-white text-[hsl(var(--primary))] shadow-sm' : 'text-gray-400'}`}
            >
              حجم الطلبات
            </button>
            <button
              onClick={() => setActiveChart('daily')}
              className={`text-[10px] px-4 py-1.5 rounded-lg font-bold transition-all ${activeChart === 'daily' ? 'bg-white text-[hsl(var(--primary))] shadow-sm' : 'text-gray-400'}`}
            >
              صافي المبالغ
            </button>
          </div>
        </div>
        <div className="h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            {activeChart === 'weekly' ? (
              <AreaChart data={data.daily} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradOrders" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#1e3a8a" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#1e3a8a" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<CustomTooltipArea />} />
                <Area
                  type="monotone"
                  dataKey="orders"
                  name="إجمالي الأوردرات"
                  stroke="#1e3a8a"
                  fill="url(#gradOrders)"
                  strokeWidth={3}
                  dot={{ r: 4, fill: '#fff', stroke: '#1e3a8a', strokeWidth: 2 }}
                  activeDot={{ r: 6, strokeWidth: 0 }}
                />
                <Area
                  type="monotone"
                  dataKey="delivered"
                  name="تم الاستلام"
                  stroke="#10b981"
                  fill="transparent"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                />
              </AreaChart>
            ) : (
              <AreaChart data={data.daily} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<CustomTooltipArea />} />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  name="المبالغ (ج.م)"
                  stroke="#10b981"
                  fill="url(#gradRevenue)"
                  strokeWidth={3}
                  dot={{ r: 4, fill: '#fff', stroke: '#10b981', strokeWidth: 2 }}
                  activeDot={{ r: 6, strokeWidth: 0 }}
                />
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bar Chart — Regions */}
      <div className="card-section p-6 bg-white border border-gray-100 rounded-3xl shadow-md">
        <div className="mb-8">
          <h3 className="text-base font-bold text-[hsl(var(--foreground))]">
            نطاق التغطية الجغرافي
          </h3>
          <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-0.5 font-bold uppercase tracking-wider">
            توزيع المحافظات الأعلى طلباً
          </p>
        </div>
        <div className="h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data.regions}
              margin={{ top: 0, right: 10, left: -10, bottom: 0 }}
              layout="vertical"
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                dataKey="region"
                type="category"
                tick={{ fontSize: 11, fontWeight: 700, fill: '#64748b' }}
                width={80}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<CustomTooltipBar />} />
              <Bar
                dataKey="delivered"
                name="تم التسليم"
                fill="#15803d"
                radius={[0, 4, 4, 0]}
                barSize={12}
              />
              <Bar
                dataKey="pending"
                name="قيد التنفيذ"
                fill="#cbd5e1"
                radius={[0, 4, 4, 0]}
                barSize={12}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Daily Performance Detailed Stats */}
      <div className="xl:col-span-3 card-section p-6 bg-white border border-gray-100 rounded-3xl shadow-sm">
        <div className="flex items-center justify-between mb-8 gap-4 flex-wrap">
          <div>
            <h3 className="text-base font-bold text-[hsl(var(--foreground))]">
              مؤشر الفعالية والدقة
            </h3>
            <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-0.5 font-bold uppercase tracking-wider">
              مقارنة يومية تفصيلية للحالات
            </p>
          </div>
          <div className="flex gap-6 items-center">
            <div className="flex items-center gap-2 text-[10px] font-bold text-gray-500">
              <div className="w-2.5 h-2.5 rounded-full bg-[#1e3a8a]" />
              مستلم
            </div>
            <div className="flex items-center gap-2 text-[10px] font-bold text-gray-500">
              <div className="w-2.5 h-2.5 rounded-full bg-[#15803d]" />
              مسلم
            </div>
            <div className="flex items-center gap-2 text-[10px] font-bold text-gray-500">
              <div className="w-2.5 h-2.5 rounded-full bg-[#dc2626]" />
              مرتجع
            </div>
          </div>
        </div>
        <div className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.daily} margin={{ top: 0, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis
                dataKey="day"
                tick={{ fontSize: 11, fontWeight: 700, fill: '#64748b' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<CustomTooltipBar />} />
              <Bar
                dataKey="orders"
                name="مستلم"
                fill="#1e3a8a"
                radius={[4, 4, 0, 0]}
                barSize={24}
              />
              <Bar
                dataKey="delivered"
                name="مسلم"
                fill="#15803d"
                radius={[4, 4, 0, 0]}
                barSize={24}
              />
              <Bar
                dataKey="returned"
                name="مرتجع"
                fill="#dc2626"
                radius={[4, 4, 0, 0]}
                barSize={24}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
