// ─────────────────────────────────────────────────────────────────────────────
// src/app/orders-management/components/OrdersDashboard.tsx
//
// Phase Orders-Page-Redesign-1 — the new orders dashboard surface
// that replaces the legacy `LiveOrdersDashboard`. Renders:
//
//   • Smart-filter chips: اليوم / أمس / هذا الأسبوع / هذا الشهر /
//     الشهر السابق.  Selecting a chip drives the dashboard query
//     window AND emits the same window upward so the parent can sync
//     the table.
//   • KPI cards row — orders count, expected collection (with
//     delivered share when meaningful), waiting / shipping /
//     delivered, returns + exchanges.
//   • Status distribution panel (donut + Arabic legend).
//   • Recent activity feed.
//   • "Needs action" alerts with click-through to the table filter.
//
// All data flows through the shared `/api/orders/operations-summary`
// route. No client-side aggregation, no duplicate queries.
//
// What this component is NOT
// --------------------------
//   • Not the orders table. The table lives in `OrdersTableSection`
//     and runs its own paginated query — the dashboard never
//     duplicates that read.
//   • Not the AddOrder / EditOrder / OrderDetail entry points. Those
//     stay where they are. The dashboard is read-only.
// ─────────────────────────────────────────────────────────────────────────────
'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Bell,
  Calendar as CalendarIcon,
  ChevronLeft,
  Clock,
  DollarSign,
  Loader2,
  Package,
  RefreshCw,
  RotateCcw,
  Truck,
  Wallet,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Range helpers
// ─────────────────────────────────────────────────────────────────────────────

export type DateRangePreset =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'this_month'
  | 'previous_month'
  | 'custom';

export interface DateRange {
  /** Inclusive ISO date (YYYY-MM-DD). */
  from: string;
  /** Inclusive ISO date (YYYY-MM-DD). */
  to: string;
  preset: DateRangePreset;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Compute a date range for a smart-filter preset. All dates are in
 *  the user's local timezone — the API converts to UTC `00:00Z`
 *  bounds, so an off-by-a-few-hours skew at midnight is acceptable. */
export function rangeForPreset(preset: DateRangePreset, now: Date = new Date()): DateRange {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (preset) {
    case 'today':
      return { from: toIsoDate(today), to: toIsoDate(today), preset };
    case 'yesterday': {
      const y = new Date(today);
      y.setDate(today.getDate() - 1);
      return { from: toIsoDate(y), to: toIsoDate(y), preset };
    }
    case 'this_week': {
      // Egypt convention: week starts on Saturday. Compute days back
      // to last Saturday.
      const dow = today.getDay(); // 0=Sun..6=Sat
      const daysBack = (dow + 1) % 7;
      const start = new Date(today);
      start.setDate(today.getDate() - daysBack);
      return { from: toIsoDate(start), to: toIsoDate(today), preset };
    }
    case 'this_month': {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { from: toIsoDate(start), to: toIsoDate(today), preset };
    }
    case 'previous_month': {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const end = new Date(today.getFullYear(), today.getMonth(), 0);
      return { from: toIsoDate(start), to: toIsoDate(end), preset };
    }
    case 'custom':
      return { from: toIsoDate(today), to: toIsoDate(today), preset };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// API response types
// ─────────────────────────────────────────────────────────────────────────────

interface OperationsSummary {
  range: { from: string | null; to: string | null; preset: string | null };
  kpis: {
    ordersCount: number;
    expectedTotal: number;
    deliveredTotal: number;
    waitingShipping: number;
    inShipping: number;
    delivered: number;
    adjustmentsCount: number;
    pendingAdjustments: number;
  };
  statusDistribution: Array<{
    status: string;
    label: string;
    count: number;
    percentage: number;
  }>;
  recentActivity: Array<{
    id: string;
    action: string;
    label: string;
    order_num: string | null;
    changed_by: string | null;
    created_at: string;
  }>;
  needsAction: Array<{
    key: string;
    label: string;
    count: number;
    description: string;
    filter: Record<string, string> | null;
  }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  /** Driven by the page header — the dashboard reads this and
   *  re-fetches when it changes. Parent owns the source of truth so
   *  the table can stay in sync. */
  range: DateRange;
  /** Emitted when the user clicks a smart-filter chip. */
  onPresetChange: (preset: DateRangePreset) => void;
  /** Emitted when the user clicks a "needs action" item — parent
   *  applies the corresponding filter on the table. */
  onNeedsActionApply?: (filter: Record<string, string>) => void;
}

const fmtEgp = (n: number): string =>
  `${(Number.isFinite(n) ? n : 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ج.م`;

const fmtNumber = (n: number): string => Number(n || 0).toLocaleString('en-US');

const PRESET_LABELS: Record<DateRangePreset, string> = {
  today: 'اليوم',
  yesterday: 'أمس',
  this_week: 'هذا الأسبوع',
  this_month: 'هذا الشهر',
  previous_month: 'الشهر السابق',
  custom: 'مخصص',
};

const STATUS_COLORS: Record<string, string> = {
  new: 'hsl(146, 50%, 45%)',
  preparing: 'hsl(217, 80%, 58%)',
  warehouse: 'hsl(38, 80%, 55%)',
  shipping: 'hsl(28, 85%, 55%)',
  delivered: 'hsl(146, 60%, 38%)',
  cancelled: 'hsl(0, 70%, 55%)',
  returned: 'hsl(280, 50%, 55%)',
};

export default function OrdersDashboard({ range, onPresetChange, onNeedsActionApply }: Props) {
  const [summary, setSummary] = useState<OperationsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/orders/operations-summary?from=${encodeURIComponent(
        range.from
      )}&to=${encodeURIComponent(range.to)}&preset=${encodeURIComponent(range.preset)}`;
      const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`status ${res.status}`);
      }
      const json = (await res.json()) as OperationsSummary;
      setSummary(json);
    } catch (err) {
      console.warn('[OrdersDashboard] fetch failed:', err);
      setError('تعذر تحميل بيانات الطلبات');
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, range.preset]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // Auto-refresh on the global orders-updated / adjustments-updated
  // events so the dashboard reacts to CRUD without a manual reload.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => setRefreshKey((k) => k + 1);
    window.addEventListener('turath_masr_orders_updated', handler);
    window.addEventListener('turath_masr_order_adjustments_updated', handler);
    return () => {
      window.removeEventListener('turath_masr_orders_updated', handler);
      window.removeEventListener('turath_masr_order_adjustments_updated', handler);
    };
  }, []);

  const isToday = range.preset === 'today';
  const rangeLabel = useMemo(() => {
    if (range.preset !== 'custom') return PRESET_LABELS[range.preset];
    return `${range.from} → ${range.to}`;
  }, [range]);

  return (
    <section className="space-y-4">
      {/* Smart-filter row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {(['today', 'yesterday', 'this_week', 'this_month', 'previous_month'] as const).map(
            (p) => (
              <SmartFilterChip
                key={p}
                active={range.preset === p}
                label={PRESET_LABELS[p]}
                onClick={() => onPresetChange(p)}
              />
            )
          )}
        </div>
        <button
          type="button"
          onClick={() => setRefreshKey((k) => k + 1)}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-1.5 hover:bg-[hsl(var(--muted))]/40 disabled:opacity-60"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          تحديث
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}

      {!summary && loading && (
        <div className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-6 text-center text-sm text-[hsl(var(--muted-foreground))]">
          جاري تحميل لوحة الطلبات...
        </div>
      )}

      {summary && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard
              icon={<Package size={16} />}
              label={isToday ? 'طلبات اليوم' : 'الطلبات في الفترة'}
              value={fmtNumber(summary.kpis.ordersCount)}
              tone="primary"
              hint={rangeLabel}
            />
            <KpiCard
              icon={<Clock size={16} />}
              label="في انتظار الشحن"
              value={fmtNumber(summary.kpis.waitingShipping)}
              tone="amber"
            />
            <KpiCard
              icon={<Truck size={16} />}
              label="جاري الشحن"
              value={fmtNumber(summary.kpis.inShipping)}
              tone="orange"
            />
            <KpiCard
              icon={<CheckIcon />}
              label={isToday ? 'تم التسليم اليوم' : 'تم التسليم'}
              value={fmtNumber(summary.kpis.delivered)}
              tone="emerald"
            />
            <KpiCard
              icon={<DollarSign size={16} />}
              label={summary.kpis.deliveredTotal > 0 ? 'إجمالي التحصيل (مسلَّم)' : 'تحصيل متوقع'}
              value={
                summary.kpis.deliveredTotal > 0
                  ? fmtEgp(summary.kpis.deliveredTotal)
                  : fmtEgp(summary.kpis.expectedTotal)
              }
              tone="primary"
              hint={
                summary.kpis.deliveredTotal > 0 && summary.kpis.expectedTotal > 0
                  ? `متوقع ${fmtEgp(summary.kpis.expectedTotal)}`
                  : undefined
              }
            />
            <KpiCard
              icon={<RotateCcw size={16} />}
              label={isToday ? 'مرتجعات / استبدالات اليوم' : 'مرتجعات / استبدالات'}
              value={fmtNumber(summary.kpis.adjustmentsCount)}
              tone="purple"
              hint={
                summary.kpis.pendingAdjustments > 0
                  ? `${fmtNumber(summary.kpis.pendingAdjustments)} معلقة`
                  : undefined
              }
            />
          </div>

          {/* Distribution + activity + needs-action row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <StatusDistributionCard distribution={summary.statusDistribution} />
            <RecentActivityCard activity={summary.recentActivity} />
            <NeedsActionCard items={summary.needsAction} onApply={onNeedsActionApply} />
          </div>
        </>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function SmartFilterChip(props: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
        props.active
          ? 'bg-[hsl(var(--primary))] border-[hsl(var(--primary))] text-white font-bold shadow-sm'
          : 'bg-white border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]/40'
      }`}
    >
      {props.label}
    </button>
  );
}

function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

const TONE_CLASSES: Record<string, { ring: string; icon: string }> = {
  primary: {
    ring: 'border-[hsl(var(--primary))]/30',
    icon: 'bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]',
  },
  amber: { ring: 'border-amber-200', icon: 'bg-amber-50 text-amber-700' },
  orange: { ring: 'border-orange-200', icon: 'bg-orange-50 text-orange-700' },
  emerald: { ring: 'border-emerald-200', icon: 'bg-emerald-50 text-emerald-700' },
  purple: { ring: 'border-purple-200', icon: 'bg-purple-50 text-purple-700' },
  rose: { ring: 'border-rose-200', icon: 'bg-rose-50 text-rose-700' },
};

function KpiCard(props: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: 'primary' | 'amber' | 'orange' | 'emerald' | 'purple' | 'rose';
  hint?: string;
}) {
  const tone = TONE_CLASSES[props.tone] ?? TONE_CLASSES.primary;
  return (
    <div
      className={`relative rounded-2xl border bg-white p-4 shadow-sm overflow-hidden ${tone.ring}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-bold text-[hsl(var(--muted-foreground))] leading-tight">
          {props.label}
        </span>
        <span className={`w-7 h-7 flex items-center justify-center rounded-lg ${tone.icon}`}>
          {props.icon}
        </span>
      </div>
      <p className="mt-2 text-lg font-bold font-mono text-[hsl(var(--foreground))]">
        {props.value}
      </p>
      {props.hint && (
        <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-1 truncate">
          {props.hint}
        </p>
      )}
    </div>
  );
}

// ─── Status distribution ───────────────────────────────────────────

function StatusDistributionCard(props: { distribution: OperationsSummary['statusDistribution'] }) {
  const total = props.distribution.reduce((s, d) => s + d.count, 0);
  const nonZero = props.distribution.filter((d) => d.count > 0);
  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-bold">توزيع حالات الطلبات</h4>
        <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
          إجمالي {fmtNumber(total)}
        </span>
      </div>
      {total === 0 ? (
        <p className="text-xs text-[hsl(var(--muted-foreground))] py-6 text-center">
          لا توجد طلبات في هذه الفترة
        </p>
      ) : (
        <div className="flex items-center gap-4">
          <DonutChart segments={nonZero} total={total} />
          <ul className="flex-1 space-y-1 text-xs">
            {props.distribution.map((d) => (
              <li key={d.status} className="flex items-center justify-between py-0.5 px-1">
                <span className="flex items-center gap-1.5 text-[hsl(var(--foreground))]">
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: STATUS_COLORS[d.status] ?? 'hsl(0, 0%, 50%)' }}
                  />
                  {d.label}
                </span>
                <span className="font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
                  {fmtNumber(d.count)} ({d.percentage}%)
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function DonutChart(props: { segments: OperationsSummary['statusDistribution']; total: number }) {
  const SIZE = 110;
  const STROKE = 16;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const R = (SIZE - STROKE) / 2;
  const CIRC = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="relative" style={{ width: SIZE, height: SIZE }}>
      <svg width={SIZE} height={SIZE}>
        <circle cx={CX} cy={CY} r={R} fill="none" stroke="hsl(0, 0%, 92%)" strokeWidth={STROKE} />
        {props.segments.map((seg) => {
          const length = (seg.count / props.total) * CIRC;
          const dashArray = `${length} ${CIRC - length}`;
          const dashOffset = CIRC - offset;
          offset += length;
          return (
            <circle
              key={seg.status}
              cx={CX}
              cy={CY}
              r={R}
              fill="none"
              stroke={STATUS_COLORS[seg.status] ?? 'hsl(0, 0%, 50%)'}
              strokeWidth={STROKE}
              strokeDasharray={dashArray}
              strokeDashoffset={dashOffset}
              strokeLinecap="butt"
              transform={`rotate(-90 ${CX} ${CY})`}
            />
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[10px] text-[hsl(var(--muted-foreground))]">إجمالي</span>
        <span className="text-base font-bold font-mono">{fmtNumber(props.total)}</span>
      </div>
    </div>
  );
}

// ─── Recent activity ──────────────────────────────────────────────

function timeAgo(iso: string): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return '';
  const diff = Math.max(0, Date.now() - ts);
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'الآن';
  if (m < 60) return `منذ ${m} دقيقة`;
  const h = Math.floor(m / 60);
  if (h < 24) return `منذ ${h} ساعة`;
  const d = Math.floor(h / 24);
  return `منذ ${d} يوم`;
}

function RecentActivityCard(props: { activity: OperationsSummary['recentActivity'] }) {
  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-bold flex items-center gap-1.5">
          <Bell size={14} /> أحدث النشاطات
        </h4>
      </div>
      {props.activity.length === 0 ? (
        <p className="text-xs text-[hsl(var(--muted-foreground))] py-6 text-center">
          لا توجد نشاطات في هذه الفترة
        </p>
      ) : (
        <ul className="space-y-2">
          {props.activity.map((a) => (
            <li key={a.id} className="text-xs flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--primary))] mt-1.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[hsl(var(--foreground))] truncate">
                  {a.label}
                  {a.order_num && (
                    <span className="text-[hsl(var(--primary))] font-mono"> #{a.order_num}</span>
                  )}
                </p>
                <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
                  {timeAgo(a.created_at)}
                  {a.changed_by ? ` — ${a.changed_by}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Needs action ─────────────────────────────────────────────────

function NeedsActionCard(props: {
  items: OperationsSummary['needsAction'];
  onApply?: (filter: Record<string, string>) => void;
}) {
  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-bold flex items-center gap-1.5">
          <AlertCircle size={14} /> طلبات تحتاج متابعة
        </h4>
      </div>
      <ul className="space-y-1.5">
        {props.items.map((item) => {
          const hasCount = item.count > 0;
          return (
            <li
              key={item.key}
              className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 ${
                hasCount
                  ? 'border-amber-200 bg-amber-50/40'
                  : 'border-[hsl(var(--border))] bg-white'
              }`}
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-[hsl(var(--foreground))] truncate">
                  {item.label}
                </p>
                <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-0.5 truncate">
                  {item.description}
                </p>
              </div>
              <span
                className={`text-xs font-bold font-mono w-7 h-7 flex items-center justify-center rounded-full ${
                  hasCount
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]'
                }`}
              >
                {fmtNumber(item.count)}
              </span>
              <button
                type="button"
                disabled={!hasCount || !item.filter || !props.onApply}
                onClick={() => item.filter && props.onApply?.(item.filter)}
                className="text-[10px] font-bold text-[hsl(var(--primary))] flex items-center gap-0.5 hover:underline disabled:opacity-30 disabled:cursor-not-allowed"
              >
                عرض
                <ChevronLeft size={12} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Re-export icon shorthand for parent (avoid duplicate imports).
export { CalendarIcon, Wallet };
