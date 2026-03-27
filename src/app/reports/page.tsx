'use client';
import React, { useState } from 'react';
import AppLayout from '@/components/AppLayout';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { TrendingUp, TrendingDown, Package, DollarSign, RotateCcw, Download } from 'lucide-react';

const monthlyData = [
  { month: 'أكتوبر', orders: 320, delivered: 290, returned: 18, revenue: 96000 },
  { month: 'نوفمبر', orders: 410, delivered: 375, returned: 22, revenue: 123000 },
  { month: 'ديسمبر', orders: 520, delivered: 480, returned: 28, revenue: 156000 },
  { month: 'يناير', orders: 380, delivered: 345, returned: 20, revenue: 114000 },
  { month: 'فبراير', orders: 460, delivered: 420, returned: 25, revenue: 138000 },
  { month: 'مارس', orders: 490, delivered: 450, returned: 21, revenue: 147000 },
];

const statusData = [
  { name: 'تم التسليم', value: 450, color: 'hsl(142,71%,35%)' },
  { name: 'جاري الشحن', value: 87, color: 'hsl(211,67%,28%)' },
  { name: 'معلق', value: 32, color: 'hsl(38,92%,50%)' },
  { name: 'مرتجع', value: 21, color: 'hsl(0,72%,51%)' },
];

const topProducts = [
  { name: 'حامل مصحف بني', orders: 187, revenue: 56100 },
  { name: 'مصحف', orders: 154, revenue: 46200 },
  { name: 'كشاف', orders: 132, revenue: 39600 },
  { name: 'حامل مصحف أسود', orders: 98, revenue: 29400 },
  { name: 'كعبة', orders: 76, revenue: 22800 },
];

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name: string; color: string }>; label?: string }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white border border-[hsl(var(--border))] rounded-xl shadow-lg p-3 text-sm" dir="rtl">
        <p className="font-semibold text-[hsl(var(--foreground))] mb-2">{label}</p>
        {payload.map((entry, i) => (
          <div key={i} className="flex items-center gap-2 mb-1">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
            <span className="text-[hsl(var(--muted-foreground))]">{entry.name}:</span>
            <span className="font-semibold">{entry.value.toLocaleString('ar-EG')}</span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

const periods = ['هذا الشهر', 'آخر ٣ أشهر', 'آخر ٦ أشهر', 'هذا العام'];

export default function ReportsPage() {
  const [activePeriod, setActivePeriod] = useState('آخر ٦ أشهر');

  const totalOrders = monthlyData.reduce((s, d) => s + d.orders, 0);
  const totalDelivered = monthlyData.reduce((s, d) => s + d.delivered, 0);
  const totalReturned = monthlyData.reduce((s, d) => s + d.returned, 0);
  const totalRevenue = monthlyData.reduce((s, d) => s + d.revenue, 0);
  const deliveryRate = Math.round((totalDelivered / totalOrders) * 100);
  const returnRate = Math.round((totalReturned / totalOrders) * 100);

  return (
    <AppLayout currentPath="/reports">
      <div className="space-y-6 fade-in">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">التقارير والإحصائيات</h1>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">تحليل شامل لأداء الشحن والمبيعات</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex bg-[hsl(var(--muted))] rounded-xl p-1 gap-1">
              {periods.map((p) => (
                <button
                  key={p}
                  onClick={() => setActivePeriod(p)}
                  className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-all ${activePeriod === p ? 'bg-white text-[hsl(var(--primary))] shadow-sm' : 'text-[hsl(var(--muted-foreground))]'}`}
                >
                  {p}
                </button>
              ))}
            </div>
            <button className="flex items-center gap-2 px-4 py-2 bg-[hsl(var(--primary))] text-white rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity">
              <Download size={16} />
              تصدير
            </button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {[
            { label: 'إجمالي الأوردرات', value: totalOrders.toLocaleString('ar-EG'), icon: <Package size={22} />, color: 'blue', change: 8.2 },
            { label: 'إجمالي الإيرادات', value: `${(totalRevenue / 1000).toFixed(0)}K ج.م`, icon: <DollarSign size={22} />, color: 'green', change: 12.5 },
            { label: 'نسبة التسليم', value: `${deliveryRate}٪`, icon: <TrendingUp size={22} />, color: 'purple', change: 2.1 },
            { label: 'نسبة المرتجعات', value: `${returnRate}٪`, icon: <RotateCcw size={22} />, color: 'red', change: -1.3 },
          ].map((kpi, i) => (
            <div key={i} className="kpi-card">
              <div className="flex items-start justify-between mb-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  kpi.color === 'blue' ? 'bg-blue-50 text-blue-600' :
                  kpi.color === 'green' ? 'bg-green-50 text-green-600' :
                  kpi.color === 'purple'? 'bg-purple-50 text-purple-600' : 'bg-red-50 text-red-600'
                }`}>
                  {kpi.icon}
                </div>
                <span className={`text-xs font-semibold px-2 py-1 rounded-lg flex items-center gap-1 ${kpi.change > 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                  {kpi.change > 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                  {Math.abs(kpi.change)}٪
                </span>
              </div>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mb-1">{kpi.label}</p>
              <p className="text-2xl font-bold text-[hsl(var(--foreground))] font-mono">{kpi.value}</p>
            </div>
          ))}
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Revenue & Orders Trend */}
          <div className="xl:col-span-2 card-section p-5">
            <div className="mb-5">
              <h3 className="text-base font-bold text-[hsl(var(--foreground))]">اتجاه الأوردرات والإيرادات</h3>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">آخر ٦ أشهر</p>
            </div>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={monthlyData} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
                <defs>
                  <linearGradient id="gradOrders2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(211,67%,28%)" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="hsl(211,67%,28%)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradDelivered2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(142,71%,35%)" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="hsl(142,71%,35%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(214,20%,92%)" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fontFamily: 'Cairo', fill: 'hsl(215,15%,50%)' }} />
                <YAxis tick={{ fontSize: 11, fontFamily: 'Cairo', fill: 'hsl(215,15%,50%)' }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontFamily: 'Cairo', fontSize: '12px' }} />
                <Area type="monotone" dataKey="orders" name="الأوردرات" stroke="hsl(211,67%,28%)" fill="url(#gradOrders2)" strokeWidth={2.5} />
                <Area type="monotone" dataKey="delivered" name="المسلّمة" stroke="hsl(142,71%,35%)" fill="url(#gradDelivered2)" strokeWidth={2.5} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Status Pie */}
          <div className="card-section p-5">
            <div className="mb-5">
              <h3 className="text-base font-bold text-[hsl(var(--foreground))]">توزيع حالات الأوردرات</h3>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">الشهر الحالي</p>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={statusData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
                  {statusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => [value.toLocaleString('ar-EG'), '']} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2 mt-2">
              {statusData.map((s, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />
                    <span className="text-[hsl(var(--muted-foreground))]">{s.name}</span>
                  </div>
                  <span className="font-semibold">{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Monthly Bar + Top Products */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Monthly Bar */}
          <div className="card-section p-5">
            <div className="mb-5">
              <h3 className="text-base font-bold text-[hsl(var(--foreground))]">المقارنة الشهرية</h3>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">المستلمة / المسلّمة / المرتجعة</p>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthlyData} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(214,20%,92%)" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fontFamily: 'Cairo', fill: 'hsl(215,15%,50%)' }} />
                <YAxis tick={{ fontSize: 11, fontFamily: 'Cairo', fill: 'hsl(215,15%,50%)' }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontFamily: 'Cairo', fontSize: '12px' }} />
                <Bar dataKey="orders" name="مستلمة" fill="hsl(211,67%,28%)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="delivered" name="مسلّمة" fill="hsl(142,71%,35%)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="returned" name="مرتجعة" fill="hsl(0,72%,51%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Top Products */}
          <div className="card-section p-5">
            <div className="mb-5">
              <h3 className="text-base font-bold text-[hsl(var(--foreground))]">أكثر المنتجات مبيعاً</h3>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">هذا الشهر</p>
            </div>
            <div className="space-y-3">
              {topProducts.map((p, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] text-xs font-bold flex items-center justify-center flex-shrink-0">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-semibold text-[hsl(var(--foreground))] truncate">{p.name}</span>
                      <span className="text-xs text-[hsl(var(--muted-foreground))] mr-2 flex-shrink-0">{p.orders} أوردر</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5">
                      <div
                        className="h-1.5 rounded-full bg-[hsl(var(--primary))]"
                        style={{ width: `${(p.orders / topProducts[0].orders) * 100}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-xs font-bold text-green-600 flex-shrink-0">{(p.revenue / 1000).toFixed(0)}K</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
