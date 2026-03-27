'use client';
import React, { useState, useEffect } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { createClient } from '@/lib/supabase/client';

interface DayData { date: string; total: number; shipping: number }
interface WeekDay { day: string; orders: number; delivered: number; returned: number }
interface RegionData { region: string; orders: number; delivered: number; pending: number }

const DAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

const CustomTooltipArea = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name: string; color: string }>; label?: string }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white border border-[hsl(var(--border))] rounded-xl shadow-lg p-3 text-sm" dir="rtl">
        <p className="font-semibold text-[hsl(var(--foreground))] mb-2">{label}</p>
        {payload.map((entry, i) => (
          <div key={`tooltip-area-${i + 1}`} className="flex items-center gap-2 mb-1">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
            <span className="text-[hsl(var(--muted-foreground))]">{entry.name}:</span>
            <span className="font-semibold">{entry.value}</span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

const CustomTooltipBar = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name: string; color: string }>; label?: string }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white border border-[hsl(var(--border))] rounded-xl shadow-lg p-3 text-sm" dir="rtl">
        <p className="font-semibold text-[hsl(var(--foreground))] mb-2">{label}</p>
        {payload.map((entry, i) => (
          <div key={`tooltip-bar-${i + 1}`} className="flex items-center gap-2 mb-1">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
            <span className="text-[hsl(var(--muted-foreground))]">{entry.name}:</span>
            <span className="font-semibold">{entry.value}</span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

export default function DashboardCharts() {
  const [activeChart, setActiveChart] = useState<'weekly' | 'daily'>('weekly');
  const [areaData, setAreaData] = useState<DayData[]>([]);
  const [weeklyData, setWeeklyData] = useState<WeekDay[]>([]);
  const [regionData, setRegionData] = useState<RegionData[]>([]);

  useEffect(() => {
    const fetchChartData = async () => {
      try {
        const supabase = createClient();
        const now = new Date();
        const pad = (n: number) => n.toString().padStart(2, '0');
        const fmtDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

        // Last 8 days
        const start8 = new Date(now); start8.setDate(now.getDate() - 7);
        const { data: orders } = await supabase
          .from('zahranship_orders')
          .select('date, status, total, region')
          .gte('date', fmtDate(start8))
          .lte('date', fmtDate(now));

        if (!orders) return;

        // Build area data (last 8 days)
        const areaMap: Record<string, { total: number; shipping: number }> = {};
        for (let i = 7; i >= 0; i--) {
          const d = new Date(now); d.setDate(now.getDate() - i);
          const key = fmtDate(d);
          const label = `${pad(d.getDate())} ${['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'][d.getMonth()]}`;
          areaMap[key] = { total: 0, shipping: 0 };
          (areaMap as Record<string, { total: number; shipping: number; label?: string }>)[key].label = label;
        }
        orders.forEach(o => {
          if (areaMap[o.date]) {
            areaMap[o.date].total += 1;
            areaMap[o.date].shipping += Number(o.total || 0);
          }
        });
        const areaArr = Object.entries(areaMap).map(([, v]) => ({
          date: (v as { total: number; shipping: number; label?: string }).label || '',
          total: v.total,
          shipping: v.shipping,
        }));
        setAreaData(areaArr);

        // Build weekly data (last 7 days by day name)
        const weekMap: Record<string, { orders: number; delivered: number; returned: number }> = {};
        for (let i = 6; i >= 0; i--) {
          const d = new Date(now); d.setDate(now.getDate() - i);
          const key = fmtDate(d);
          weekMap[key] = { orders: 0, delivered: 0, returned: 0 };
        }
        orders.forEach(o => {
          if (weekMap[o.date]) {
            weekMap[o.date].orders += 1;
            if (o.status === 'delivered') weekMap[o.date].delivered += 1;
            if (o.status === 'returned') weekMap[o.date].returned += 1;
          }
        });
        const weekArr = Object.entries(weekMap).map(([dateStr, v]) => {
          const d = new Date(dateStr);
          return { day: DAY_NAMES[d.getDay()], ...v };
        });
        setWeeklyData(weekArr);

        // Build region data
        const regionMap: Record<string, { orders: number; delivered: number; pending: number }> = {};
        orders.forEach(o => {
          const r = o.region || 'غير محدد';
          if (!regionMap[r]) regionMap[r] = { orders: 0, delivered: 0, pending: 0 };
          regionMap[r].orders += 1;
          if (o.status === 'delivered') regionMap[r].delivered += 1;
          if (['new', 'preparing', 'warehouse'].includes(o.status)) regionMap[r].pending += 1;
        });
        const regionArr = Object.entries(regionMap)
          .map(([region, v]) => ({ region, ...v }))
          .sort((a, b) => b.orders - a.orders)
          .slice(0, 6);
        setRegionData(regionArr);
      } catch { /* silently fail */ }
    };

    fetchChartData();
  }, []);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
      {/* Area Chart — Orders trend */}
      <div className="xl:col-span-2 card-section p-5">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-base font-bold text-[hsl(var(--foreground))]">حركة الأوردرات</h3>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">آخر ٨ أيام</p>
          </div>
          <div className="flex bg-[hsl(var(--muted))] rounded-xl p-1 gap-1">
            <button
              onClick={() => setActiveChart('weekly')}
              className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-all ${activeChart === 'weekly' ? 'bg-white text-[hsl(var(--primary))] shadow-sm' : 'text-[hsl(var(--muted-foreground))]'}`}
            >
              أوردرات
            </button>
            <button
              onClick={() => setActiveChart('daily')}
              className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-all ${activeChart === 'daily' ? 'bg-white text-[hsl(var(--primary))] shadow-sm' : 'text-[hsl(var(--muted-foreground))]'}`}
            >
              مبالغ
            </button>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          {activeChart === 'weekly' ? (
            <AreaChart data={areaData} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
              <defs>
                <linearGradient id="gradOrders" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(211,67%,28%)" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="hsl(211,67%,28%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(214,20%,92%)" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fontFamily: 'Cairo', fill: 'hsl(215,15%,50%)' }} />
              <YAxis tick={{ fontSize: 11, fontFamily: 'Cairo', fill: 'hsl(215,15%,50%)' }} />
              <Tooltip content={<CustomTooltipArea />} />
              <Area type="monotone" dataKey="total" name="عدد الأوردرات" stroke="hsl(211,67%,28%)" fill="url(#gradOrders)" strokeWidth={2.5} dot={{ r: 3, fill: 'hsl(211,67%,28%)' }} />
            </AreaChart>
          ) : (
            <AreaChart data={areaData} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
              <defs>
                <linearGradient id="gradShipping" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(28,80%,52%)" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="hsl(28,80%,52%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(214,20%,92%)" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fontFamily: 'Cairo', fill: 'hsl(215,15%,50%)' }} />
              <YAxis tick={{ fontSize: 11, fontFamily: 'Cairo', fill: 'hsl(215,15%,50%)' }} />
              <Tooltip content={<CustomTooltipArea />} />
              <Area type="monotone" dataKey="shipping" name="المبالغ (ج.م)" stroke="hsl(28,80%,52%)" fill="url(#gradShipping)" strokeWidth={2.5} dot={{ r: 3, fill: 'hsl(28,80%,52%)' }} />
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* Bar Chart — Regions */}
      <div className="card-section p-5">
        <div className="mb-5">
          <h3 className="text-base font-bold text-[hsl(var(--foreground))]">توزيع المناطق</h3>
          <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">آخر ٨ أيام</p>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={regionData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(214,20%,92%)" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11, fontFamily: 'Cairo', fill: 'hsl(215,15%,50%)' }} />
            <YAxis dataKey="region" type="category" tick={{ fontSize: 12, fontFamily: 'Cairo', fill: 'hsl(215,15%,50%)' }} width={70} />
            <Tooltip content={<CustomTooltipBar />} />
            <Legend wrapperStyle={{ fontFamily: 'Cairo', fontSize: '12px' }} />
            <Bar dataKey="delivered" name="تم التسليم" fill="hsl(142,71%,35%)" radius={[0, 4, 4, 0]} />
            <Bar dataKey="pending" name="معلق" fill="hsl(38,92%,50%)" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Weekly bar */}
      <div className="xl:col-span-3 card-section p-5">
        <div className="mb-5">
          <h3 className="text-base font-bold text-[hsl(var(--foreground))]">أداء الأسبوع الجاري — يومياً</h3>
          <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">الأوردرات المستلمة / المسلّمة / المرتجعة</p>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={weeklyData} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(214,20%,92%)" />
            <XAxis dataKey="day" tick={{ fontSize: 12, fontFamily: 'Cairo', fill: 'hsl(215,15%,50%)' }} />
            <YAxis tick={{ fontSize: 11, fontFamily: 'Cairo', fill: 'hsl(215,15%,50%)' }} />
            <Tooltip content={<CustomTooltipBar />} />
            <Legend wrapperStyle={{ fontFamily: 'Cairo', fontSize: '12px' }} />
            <Bar dataKey="orders" name="مستلمة" fill="hsl(211,67%,28%)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="delivered" name="مسلّمة" fill="hsl(142,71%,35%)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="returned" name="مرتجعة" fill="hsl(0,72%,51%)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}