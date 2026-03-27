'use client';
import React from 'react';
import {
  Package,
  Truck,
  DollarSign,
  AlertTriangle,
  RotateCcw,
  TrendingUp,
  TrendingDown,
  Minus,
} from 'lucide-react';

interface KPICard {
  id: string;
  title: string;
  value: string;
  sub?: string;
  change?: number;
  changeLabel?: string;
  icon: React.ReactNode;
  color: 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'orange';
  alert?: boolean;
  span?: 'single' | 'double';
}

const kpis: KPICard[] = [
  {
    id: 'kpi-total-today',
    title: 'إجمالي أوردرات اليوم',
    value: '٤٧',
    sub: 'من إجمالي ١٢,٤٨٧ أوردر',
    change: 12.5,
    changeLabel: 'مقارنة بالأمس',
    icon: <Package size={24} />,
    color: 'blue',
    span: 'double',
  },
  {
    id: 'kpi-shipping',
    title: 'جاري الشحن الآن',
    value: '١٨',
    sub: 'أوردر في الطريق',
    change: 5.2,
    changeLabel: 'أعلى من المعدل',
    icon: <Truck size={24} />,
    color: 'orange',
    alert: false,
  },
  {
    id: 'kpi-collection',
    title: 'إجمالي التحصيل اليوم',
    value: '٢٤,٣٥٠',
    sub: 'ج.م',
    change: 8.7,
    changeLabel: 'نمو عن الأمس',
    icon: <DollarSign size={24} />,
    color: 'green',
  },
  {
    id: 'kpi-net',
    title: 'صافي التوريد',
    value: '١٩,٨٠٠',
    sub: 'ج.م — بعد خصم الشحن',
    change: -2.1,
    changeLabel: 'انخفاض طفيف',
    icon: <TrendingUp size={24} />,
    color: 'purple',
  },
  {
    id: 'kpi-pending',
    title: 'أوردرات معلقة',
    value: '٧',
    sub: 'تحتاج مراجعة فورية',
    change: 40,
    changeLabel: 'زيادة عن أمس',
    icon: <AlertTriangle size={24} />,
    color: 'red',
    alert: true,
  },
  {
    id: 'kpi-returned',
    title: 'مرتجعات اليوم',
    value: '٣',
    sub: 'بانتظار معالجة',
    change: 0,
    changeLabel: 'لا تغيير',
    icon: <RotateCcw size={24} />,
    color: 'amber',
  },
];

const colorMap: Record<string, { bg: string; icon: string; badge: string }> = {
  blue: { bg: 'bg-blue-50', icon: 'text-blue-600', badge: 'bg-blue-100 text-blue-700' },
  green: { bg: 'bg-green-50', icon: 'text-green-600', badge: 'bg-green-100 text-green-700' },
  amber: { bg: 'bg-amber-50', icon: 'text-amber-600', badge: 'bg-amber-100 text-amber-700' },
  red: { bg: 'bg-red-50', icon: 'text-red-600', badge: 'bg-red-100 text-red-700' },
  purple: { bg: 'bg-purple-50', icon: 'text-purple-600', badge: 'bg-purple-100 text-purple-700' },
  orange: { bg: 'bg-orange-50', icon: 'text-orange-600', badge: 'bg-orange-100 text-orange-700' },
};

export default function DashboardKPIs() {
  return (
    // Grid plan: 6 cards → grid-cols-4
    // Row 1: hero (kpi-total-today) spans 2 cols + 2 regular
    // Row 2: 4 regular cards
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-4 gap-4">
      {kpis.map((kpi) => {
        const colors = colorMap[kpi.color];
        const isPositive = kpi.change !== undefined && kpi.change > 0;
        const isNegative = kpi.change !== undefined && kpi.change < 0;
        const isNeutral = kpi.change === 0;

        return (
          <div
            key={kpi.id}
            className={`kpi-card relative overflow-hidden ${kpi.span === 'double' ? 'sm:col-span-2' : ''} ${kpi.alert ? 'border-red-200 bg-red-50/30' : ''}`}
          >
            {kpi.alert && (
              <div className="absolute top-0 right-0 w-1 h-full bg-red-500 rounded-r-2xl" />
            )}

            <div className="flex items-start justify-between mb-4">
              <div className={`w-11 h-11 rounded-xl ${colors.bg} ${colors.icon} flex items-center justify-center flex-shrink-0`}>
                {kpi.icon}
              </div>
              {kpi.change !== undefined && (
                <div className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg ${
                  isPositive && !kpi.alert ? 'bg-green-50 text-green-700' : isNegative ?'bg-red-50 text-red-600': kpi.alert && isPositive ?'bg-red-50 text-red-600': 'bg-gray-100 text-gray-600'
                }`}>
                  {isNeutral ? <Minus size={12} /> : isPositive && !kpi.alert ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                  <span>{Math.abs(kpi.change)}٪</span>
                </div>
              )}
            </div>

            <div>
              <p className="text-[13px] font-medium text-[hsl(var(--muted-foreground))] mb-1 tracking-wide">{kpi.title}</p>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-[hsl(var(--foreground))] font-mono tabular-nums">{kpi.value}</span>
                {kpi.sub && <span className="text-sm text-[hsl(var(--muted-foreground))]">{kpi.sub}</span>}
              </div>
              {kpi.changeLabel && (
                <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1.5">{kpi.changeLabel}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}