'use client';
import React, { useState, useMemo } from 'react';
import AppLayout from '@/components/AppLayout';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { TrendingUp, TrendingDown, Package, DollarSign, RotateCcw, Download, FileSpreadsheet, FileText, X } from 'lucide-react';

const ALL_DATA = [
  { month: 'أكتوبر', orders: 320, delivered: 290, returned: 18, revenue: 96000, period: 'q4' },
  { month: 'نوفمبر', orders: 410, delivered: 375, returned: 22, revenue: 123000, period: 'q4' },
  { month: 'ديسمبر', orders: 520, delivered: 480, returned: 28, revenue: 156000, period: 'q4' },
  { month: 'يناير', orders: 380, delivered: 345, returned: 20, revenue: 114000, period: 'q1' },
  { month: 'فبراير', orders: 460, delivered: 420, returned: 25, revenue: 138000, period: 'q1' },
  { month: 'مارس', orders: 490, delivered: 450, returned: 21, revenue: 147000, period: 'q1' },
];

const statusData = [
  { name: 'تم التسليم', value: 450, color: 'hsl(142,71%,35%)' },
  { name: 'جاري الشحن', value: 18, color: 'hsl(211,67%,28%)' },
  { name: 'معلق', value: 15, color: 'hsl(38,92%,50%)' },
  { name: 'مرتجع', value: 7, color: 'hsl(0,72%,51%)' },
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
            <span className="font-semibold">{entry.value.toLocaleString('en-US')}</span>
          </div>
        ))}
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

function exportReportCSV(data: typeof ALL_DATA) {
  const headers = ['الشهر', 'الأوردرات', 'المسلمة', 'المرتجعة', 'الإيرادات (ج.م)'];
  const rows = data.map(d => [d.month, d.orders, d.delivered, d.returned, d.revenue]);
  const csv = '\uFEFF' + [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `zahranship-report-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportReportPDF(data: typeof ALL_DATA, period: string) {
  const win = window.open('', '_blank', 'width=900,height=600');
  if (!win) return;
  const rows = data.map(d => `
    <tr>
      <td>${d.month}</td>
      <td>${d.orders.toLocaleString('en-US')}</td>
      <td>${d.delivered.toLocaleString('en-US')}</td>
      <td>${d.returned.toLocaleString('en-US')}</td>
      <td>${d.revenue.toLocaleString('en-US')} ج.م</td>
    </tr>
  `).join('');
  win.document.write(`
    <!DOCTYPE html><html dir="rtl" lang="ar">
    <head><meta charset="UTF-8"><title>تقرير Turath Mart</title>
    <style>
      body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;direction:rtl;padding:24px;font-size:13px;}
      h1{font-size:22px;color:#1e3a5f;margin-bottom:4px;}
      .sub{color:#6b7280;margin-bottom:20px;}
      table{width:100%;border-collapse:collapse;}
      th{background:#1e3a5f;color:white;padding:10px 12px;text-align:right;}
      td{padding:9px 12px;border-bottom:1px solid #e5e7eb;}
      tr:nth-child(even){background:#f9fafb;}
      .footer{margin-top:20px;text-align:center;color:#9ca3af;font-size:11px;}
      @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}
    </style></head>
    <body>
      <h1>Turath Mart — تقرير الأداء</h1>
      <p class="sub">الفترة: ${period} — تاريخ التصدير: ${new Date().toLocaleDateString('en-US')}</p>
      <table>
        <thead><tr><th>الشهر</th><th>الأوردرات</th><th>المسلمة</th><th>المرتجعة</th><th>الإيرادات</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="footer">Turath Mart — نظام إدارة الشحن</div>
      <script>window.onload=function(){window.print();window.close();}<\/script>
    </body></html>
  `);
  win.document.close();
}

export default function ReportsPage() {
  const [activePeriod, setActivePeriod] = useState('6months');
  const [regionFilter, setRegionFilter] = useState('الكل');
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const monthlyData = useMemo(() => {
    // If date range is set, filter by date range
    if (dateFrom || dateTo) {
      return ALL_DATA.filter(d => {
        // Map month names to approximate dates for filtering
        const monthMap: Record<string, number> = {
          'أكتوبر': 9, 'نوفمبر': 10, 'ديسمبر': 11,
          'يناير': 0, 'فبراير': 1, 'مارس': 2,
        };
        const monthIdx = monthMap[d.month];
        const year = monthIdx >= 9 ? 2025 : 2026;
        const monthDate = new Date(year, monthIdx, 1);
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
    const p = PERIOD_OPTIONS.find(p => p.key === activePeriod);
    const months = p?.months || 6;
    return ALL_DATA.slice(-months);
  }, [activePeriod, dateFrom, dateTo]);

  const totalOrders = monthlyData.reduce((s, d) => s + d.orders, 0);
  const totalDelivered = monthlyData.reduce((s, d) => s + d.delivered, 0);
  const totalReturned = monthlyData.reduce((s, d) => s + d.returned, 0);
  const totalRevenue = monthlyData.reduce((s, d) => s + d.revenue, 0);
  const deliveryRate = Math.round((totalDelivered / totalOrders) * 100);
  const returnRate = Math.round((totalReturned / totalOrders) * 100);
  const currentPeriodLabel = PERIOD_OPTIONS.find(p => p.key === activePeriod)?.label || '';

  return (
    <AppLayout currentPath="/reports">
      <div className="space-y-6 fade-in">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">التقارير والإحصائيات</h1>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">تحليل شامل لأداء الشحن والمبيعات</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {/* Period filter */}
            <div className="flex bg-[hsl(var(--muted))] rounded-xl p-1 gap-1">
              {PERIOD_OPTIONS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setActivePeriod(p.key)}
                  className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-all ${activePeriod === p.key ? 'bg-white text-[hsl(var(--primary))] shadow-sm' : 'text-[hsl(var(--muted-foreground))]'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {/* Region filter */}
            <select
              className="input-field w-auto text-sm"
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value)}
            >
              {['الكل', 'القاهرة', 'الجيزة', 'القليوبية'].map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            {/* Export */}
            <div className="relative">
              <button
                className="flex items-center gap-2 px-4 py-2 bg-[hsl(var(--primary))] text-white rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity"
                onClick={() => setShowExportMenu(!showExportMenu)}
              >
                <Download size={16} />
                تصدير
              </button>
              {showExportMenu && (
                <div className="absolute left-0 top-full mt-1 bg-white border border-[hsl(var(--border))] rounded-xl shadow-lg z-20 min-w-[170px] overflow-hidden">
                  <button
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-[hsl(var(--muted))] transition-colors text-right"
                    onClick={() => { exportReportCSV(monthlyData); setShowExportMenu(false); }}
                  >
                    <FileSpreadsheet size={15} className="text-green-600" />
                    تصدير Excel (CSV)
                  </button>
                  <button
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-[hsl(var(--muted))] transition-colors text-right border-t border-[hsl(var(--border))]"
                    onClick={() => { exportReportPDF(monthlyData, currentPeriodLabel); setShowExportMenu(false); }}
                  >
                    <FileText size={15} className="text-red-500" />
                    تصدير PDF
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Date range filter */}
        <div className="card-section p-4">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs font-semibold text-[hsl(var(--muted-foreground))]">فلتر التاريخ:</span>
            <div className="flex items-center gap-2">
              <label className="text-xs text-[hsl(var(--muted-foreground))]">من</label>
              <input
                type="date"
                className="input-field w-auto text-sm py-1.5"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                dir="ltr"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-[hsl(var(--muted-foreground))]">إلى</label>
              <input
                type="date"
                className="input-field w-auto text-sm py-1.5"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                dir="ltr"
              />
            </div>
            {(dateFrom || dateTo) && (
              <button
                className="text-xs text-red-500 hover:underline"
                onClick={() => { setDateFrom(''); setDateTo(''); }}
              >
                مسح الفلتر
              </button>
            )}
            {(dateFrom || dateTo) && (
              <span className="text-xs bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] px-2 py-1 rounded-lg font-semibold">
                {monthlyData.length} شهر في النتائج
              </span>
            )}
          </div>
        </div>

        {/* Active filters indicator */}
        {regionFilter !== 'الكل' && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[hsl(var(--muted-foreground))]">فلاتر نشطة:</span>
            <span className="flex items-center gap-1 bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] text-xs px-2 py-1 rounded-lg font-semibold">
              {regionFilter}
              <button onClick={() => setRegionFilter('الكل')}><X size={12} /></button>
            </span>
          </div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {[
            { label: 'إجمالي الأوردرات', value: totalOrders.toLocaleString('en-US'), icon: <Package size={22} />, color: 'blue', change: 8.2 },
            { label: 'إجمالي الإيرادات', value: `${(totalRevenue / 1000).toFixed(0)}K ج.م`, icon: <DollarSign size={22} />, color: 'green', change: 12.5 },
            { label: 'نسبة التسليم', value: `${deliveryRate}%`, icon: <TrendingUp size={22} />, color: 'purple', change: 2.1 },
            { label: 'نسبة المرتجعات', value: `${returnRate}%`, icon: <RotateCcw size={22} />, color: 'red', change: -1.3 },
          ].map((kpi, i) => (
            <div key={i} className="kpi-card">
              <div className="flex items-start justify-between mb-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  kpi.color === 'blue' ? 'bg-blue-50 text-blue-600' :
                  kpi.color === 'green' ? 'bg-green-50 text-green-600' :
                  kpi.color === 'purple' ? 'bg-purple-50 text-purple-600' : 'bg-red-50 text-red-600'
                }`}>
                  {kpi.icon}
                </div>
                <span className={`text-xs font-semibold px-2 py-1 rounded-lg flex items-center gap-1 ${kpi.change > 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                  {kpi.change > 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                  {Math.abs(kpi.change)}%
                </span>
              </div>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mb-1">{kpi.label}</p>
              <p className="text-2xl font-bold text-[hsl(var(--foreground))] font-mono">{kpi.value}</p>
            </div>
          ))}
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 card-section p-5">
            <div className="mb-5">
              <h3 className="text-base font-bold text-[hsl(var(--foreground))]">اتجاه الأوردرات والإيرادات</h3>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">{currentPeriodLabel}</p>
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
                <Area type="monotone" dataKey="delivered" name="المسلمة" stroke="hsl(142,71%,35%)" fill="url(#gradDelivered2)" strokeWidth={2.5} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

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
                <Tooltip formatter={(value: number) => [value.toLocaleString('en-US'), '']} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2 mt-2">
              {statusData.map((s, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />
                    <span className="text-[hsl(var(--muted-foreground))]">{s.name}</span>
                  </div>
                  <span className="font-semibold">{s.value.toLocaleString('en-US')}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Monthly Bar + Top Products */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="card-section p-5">
            <div className="mb-5">
              <h3 className="text-base font-bold text-[hsl(var(--foreground))]">المقارنة الشهرية</h3>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">المستلمة / المسلمة / المرتجعة</p>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthlyData} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(214,20%,92%)" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fontFamily: 'Cairo', fill: 'hsl(215,15%,50%)' }} />
                <YAxis tick={{ fontSize: 11, fontFamily: 'Cairo', fill: 'hsl(215,15%,50%)' }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontFamily: 'Cairo', fontSize: '12px' }} />
                <Bar dataKey="orders" name="مستلمة" fill="hsl(211,67%,28%)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="delivered" name="مسلمة" fill="hsl(142,71%,35%)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="returned" name="مرتجعة" fill="hsl(0,72%,51%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="card-section p-5">
            <div className="mb-5">
              <h3 className="text-base font-bold text-[hsl(var(--foreground))]">أكثر المنتجات مبيعا</h3>
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
                      <span className="text-xs text-[hsl(var(--muted-foreground))] mr-2 flex-shrink-0">{p.orders.toLocaleString('en-US')} أوردر</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5">
                      <div className="h-1.5 rounded-full bg-[hsl(var(--primary))]" style={{ width: `${(p.orders / topProducts[0].orders) * 100}%` }} />
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
