'use client';

// Phase 20E — chart-only module, lazy-loaded by reports/page.tsx via
// next/dynamic({ ssr: false }). Pulls the entire `recharts` package
// out of the /reports route's initial JS chunk so the page shell +
// KPI cards can render before the chart bundle finishes downloading.
//
// Each chart is a thin presentational wrapper around a recharts
// primitive — no data fetching, no Supabase imports. Aggregations
// live in page.tsx's useMemos and arrive as props.

import React from 'react';
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
} from 'recharts';

interface MonthlyDatum {
  month: string;
  orders: number;
  delivered: number;
  returned: number;
  revenue: number;
}

interface StatusDatum {
  name: string;
  value: number;
  color: string;
  pct: number;
}

// Tooltip content used by the area + bar charts. Moved here from the
// page so the dynamic chunk owns its only consumer too.
const CustomTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) => {
  if (active && payload && payload.length) {
    return (
      <div
        className="bg-white border border-[hsl(var(--border))] rounded-xl shadow-lg p-3 text-sm"
        dir="rtl"
      >
        <p className="font-semibold text-[hsl(var(--foreground))] mb-2">{label}</p>
        <div className="space-y-1.5">
          {payload.map((entry, i) => (
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

export function MonthlyAreaChart({ data }: { data: MonthlyDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
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
  );
}

export function StatusPieChart({ data }: { data: StatusDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={65}
          outerRadius={90}
          paddingAngle={6}
          dataKey="value"
          stroke="none"
        >
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function MonthlyBarChart({ data }: { data: MonthlyDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
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
        <Bar dataKey="orders" name="مستلم" fill="#1e3a8a" radius={[4, 4, 0, 0]} barSize={18} />
        <Bar dataKey="delivered" name="مسلم" fill="#15803d" radius={[4, 4, 0, 0]} barSize={18} />
        <Bar dataKey="returned" name="مرتجع" fill="#dc2626" radius={[4, 4, 0, 0]} barSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}
