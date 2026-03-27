'use client';
import React, { useState } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend
} from 'recharts';

const weeklyData = [
  { day: 'السبت', orders: 38, delivered: 31, returned: 2 },
  { day: 'الأحد', orders: 52, delivered: 44, returned: 3 },
  { day: 'الاثنين', orders: 61, delivered: 55, returned: 1 },
  { day: 'الثلاثاء', orders: 45, delivered: 38, returned: 4 },
  { day: 'الأربعاء', orders: 67, delivered: 60, returned: 2 },
  { day: 'الخميس', orders: 58, delivered: 50, returned: 3 },
  { day: 'الجمعة', orders: 47, delivered: 40, returned: 3 },
];

const areaData = [
  { date: '20 مارس', total: 38, shipping: 4500 },
  { date: '21 مارس', total: 52, shipping: 6200 },
  { date: '22 مارس', total: 61, shipping: 7300 },
  { date: '23 مارس', total: 45, shipping: 5400 },
  { date: '24 مارس', total: 67, shipping: 8100 },
  { date: '25 مارس', total: 58, shipping: 7000 },
  { date: '26 مارس', total: 47, shipping: 5600 },
  { date: '27 مارس', total: 54, shipping: 6500 },
];

const regionData = [
  { region: 'القاهرة', orders: 187, delivered: 162, pending: 18 },
  { region: 'الجيزة', orders: 124, delivered: 108, pending: 12 },
  { region: 'القليوبية', orders: 89, delivered: 74, pending: 11 },
];

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
          <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">هذا الأسبوع</p>
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