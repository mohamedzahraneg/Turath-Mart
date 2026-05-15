// ─────────────────────────────────────────────────────────────────────────────
// src/app/orders-management/components/OrdersDashboard.tsx
//
// Phase Orders-Page-Redesign-1 Visual Match Fix — dashboard section
// laid out to match the approved design exactly:
//
//   [ KPI 1 ][ KPI 2 ][ KPI 3 ][ KPI 4 ][ KPI 5 ][ KPI 6 ]   (RTL row)
//
//   [ توزيع الحالات   ] [ أحدث النشاطات   ] [ طلبات تحتاج متابعة ]
//
// The smart-filter chips moved out of this component into
// `OrdersHeader` so the dashed-purple container in the header row
// matches the visual reference. This component now ONLY renders the
// KPI row + the three middle cards. All data comes from
// `/api/orders/operations-summary` — no client-side aggregation.
//
// What this component is NOT
// --------------------------
//   • Not the orders table. `OrdersTableSection` owns the paginated
//     read.
//   • Not the AddOrder / EditOrder / OrderDetail entry points.
//   • Not the date-range header. The header owns the range; this
//     component is a pure consumer.
// ─────────────────────────────────────────────────────────────────────────────
'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Bell,
  ChevronLeft,
  Clock,
  DollarSign,
  Loader2,
  Package,
  RotateCcw,
  Truck,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Range helpers (re-exported so the page + header can compute presets)
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

/** Compute a date range for a smart-filter preset. */
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
      const dow = today.getDay();
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
  compareRange: { from: string | null; to: string | null; preset: string | null } | null;
  kpis: {
    ordersCount: number;
    ordersDeltaPercent: number | null;
    waitingShipping: number;
    waitingDeltaPercent: number | null;
    inShipping: number;
    inShippingDeltaPercent: number | null;
    delivered: number;
    deliveredDeltaPercent: number | null;
    expectedTotal: number;
    deliveredTotal: number;
    collectionTotal: number;
    collectionDeltaPercent: number | null;
    adjustmentsCount: number;
    adjustmentsDeltaPercent: number | null;
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
    customer_name: string | null;
    changed_by: string | null;
    created_at: string;
  }>;
  needsAction: Array<{
    key: string;
    label: string;
    count: number;
    description: string;
    filter: Record<string, string> | null;
    previewOrders: Array<{
      order_num: string;
      customer_name: string;
      products_summary: string;
      status: string;
      status_label: string;
      total: number;
      created_at: string;
    }>;
  }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  range: DateRange;
  /** Emitted when the user clicks "عرض" on a needs-action item or
   *  clicks a status row in the distribution legend. The page applies
   *  the filter to the table, scrolls to the table, and shows an
   *  active-filter banner with the supplied human label. */
  onApplyTableFilter?: (filter: Record<string, string>, label: string) => void;
}

const fmtEgp = (n: number): string =>
  `${(Number.isFinite(n) ? n : 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ج.م`;

const fmtNumber = (n: number): string => Number(n || 0).toLocaleString('en-US');

const STATUS_COLORS: Record<string, string> = {
  new: 'hsl(146, 50%, 45%)',
  preparing: 'hsl(217, 80%, 58%)',
  warehouse: 'hsl(38, 80%, 55%)',
  shipping: 'hsl(28, 85%, 55%)',
  delivered: 'hsl(146, 60%, 38%)',
  cancelled: 'hsl(0, 70%, 55%)',
  returned: 'hsl(280, 50%, 55%)',
};

const KPI_TONES: Record<string, { card: string; icon: string; iconBg: string; line: string }> = {
  blue: {
    card: 'bg-blue-50/50 border-blue-100',
    icon: 'text-blue-600',
    iconBg: 'bg-blue-100',
    line: 'stroke-blue-500',
  },
  amber: {
    card: 'bg-amber-50/40 border-amber-100',
    icon: 'text-amber-600',
    iconBg: 'bg-amber-100',
    line: 'stroke-amber-500',
  },
  orange: {
    card: 'bg-orange-50/40 border-orange-100',
    icon: 'text-orange-600',
    iconBg: 'bg-orange-100',
    line: 'stroke-orange-500',
  },
  emerald: {
    card: 'bg-emerald-50/40 border-emerald-100',
    icon: 'text-emerald-600',
    iconBg: 'bg-emerald-100',
    line: 'stroke-emerald-500',
  },
  purple: {
    card: 'bg-purple-50/40 border-purple-100',
    icon: 'text-purple-600',
    iconBg: 'bg-purple-100',
    line: 'stroke-purple-500',
  },
  teal: {
    card: 'bg-teal-50/40 border-teal-100',
    icon: 'text-teal-600',
    iconBg: 'bg-teal-100',
    line: 'stroke-teal-500',
  },
};

/**
 * Translate a delta percent value into the small Arabic helper line
 * the KPI cards print under the number. The page-spec `compareRange`
 * label distinguishes "عن أمس" (today's special case) from "عن
 * الفترة السابقة" for wider windows.
 */
function deltaLine(
  current: number,
  delta: number | null,
  preset: DateRangePreset
): { text: string; tone: 'positive' | 'negative' | 'flat' | 'new' } {
  const compareLabel = preset === 'today' ? 'عن أمس' : 'عن الفترة السابقة';
  if (delta === null) {
    return current > 0 ? { text: 'جديد', tone: 'new' } : { text: 'بدون تغيير', tone: 'flat' };
  }
  if (Math.abs(delta) < 0.05) {
    return { text: `بدون تغيير ${compareLabel}`, tone: 'flat' };
  }
  const sign = delta > 0 ? '+' : '';
  return {
    text: `${sign}${delta}% ${compareLabel}`,
    tone: delta > 0 ? 'positive' : 'negative',
  };
}

export default function OrdersDashboard({ range, onApplyTableFilter }: Props) {
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

  return (
    <section className="space-y-4" dir="rtl">
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}

      {!summary && loading && (
        <div className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-10 text-center text-sm text-[hsl(var(--muted-foreground))] flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" />
          جاري تحميل لوحة الطلبات...
        </div>
      )}

      {summary && (
        <>
          {/* KPI row — order matches the reference (RTL): orders →
              waiting → shipping → delivered → collection → returns.
              Each card carries a real delta vs the previous period. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard
              tone="blue"
              icon={<CalendarBadge />}
              label="طلبات اليوم"
              value={fmtNumber(summary.kpis.ordersCount)}
              delta={deltaLine(
                summary.kpis.ordersCount,
                summary.kpis.ordersDeltaPercent,
                range.preset
              )}
            />
            <KpiCard
              tone="amber"
              icon={<Clock size={16} />}
              label="في انتظار الشحن"
              value={fmtNumber(summary.kpis.waitingShipping)}
              delta={deltaLine(
                summary.kpis.waitingShipping,
                summary.kpis.waitingDeltaPercent,
                range.preset
              )}
            />
            <KpiCard
              tone="orange"
              icon={<Truck size={16} />}
              label="جاري الشحن"
              value={fmtNumber(summary.kpis.inShipping)}
              delta={deltaLine(
                summary.kpis.inShipping,
                summary.kpis.inShippingDeltaPercent,
                range.preset
              )}
            />
            <KpiCard
              tone="emerald"
              icon={<CheckIcon />}
              label="تم التسليم اليوم"
              value={fmtNumber(summary.kpis.delivered)}
              delta={deltaLine(
                summary.kpis.delivered,
                summary.kpis.deliveredDeltaPercent,
                range.preset
              )}
            />
            <KpiCard
              tone="purple"
              icon={<DollarSign size={16} />}
              label={summary.kpis.deliveredTotal > 0 ? 'إجمالي التحصيل' : 'تحصيل متوقع'}
              value={fmtEgp(summary.kpis.collectionTotal)}
              delta={deltaLine(
                summary.kpis.collectionTotal,
                summary.kpis.collectionDeltaPercent,
                range.preset
              )}
            />
            <KpiCard
              tone="teal"
              icon={<RotateCcw size={16} />}
              label="مرتجعات / استبدالات اليوم"
              value={fmtNumber(summary.kpis.adjustmentsCount)}
              delta={deltaLine(
                summary.kpis.adjustmentsCount,
                summary.kpis.adjustmentsDeltaPercent,
                range.preset
              )}
            />
          </div>

          {/* Three middle cards. In RTL grid order: distribution (right)
              → activity (center) → needs-action (left). */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <StatusDistributionCard
              distribution={summary.statusDistribution}
              onStatusClick={(status, label) =>
                onApplyTableFilter?.({ status }, `حالة الطلب: ${label}`)
              }
            />
            <RecentActivityCard activity={summary.recentActivity} />
            <NeedsActionCard
              items={summary.needsAction}
              onApply={(filter, label) => onApplyTableFilter?.(filter, label)}
            />
          </div>
        </>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI card
// ─────────────────────────────────────────────────────────────────────────────

function CalendarBadge() {
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
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
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

const DELTA_TONE_CLASS: Record<'positive' | 'negative' | 'flat' | 'new', string> = {
  positive: 'text-emerald-600',
  negative: 'text-rose-600',
  flat: 'text-[hsl(var(--muted-foreground))]',
  new: 'text-blue-600',
};

function KpiCard(props: {
  tone: 'blue' | 'amber' | 'orange' | 'emerald' | 'purple' | 'teal';
  icon: React.ReactNode;
  label: string;
  value: string;
  delta?: { text: string; tone: 'positive' | 'negative' | 'flat' | 'new' };
}) {
  const tone = KPI_TONES[props.tone];
  const deltaArrow =
    props.delta?.tone === 'positive'
      ? '▲'
      : props.delta?.tone === 'negative'
        ? '▼'
        : props.delta?.tone === 'new'
          ? '★'
          : '·';
  return (
    <div className={`relative rounded-2xl border ${tone.card} p-3 overflow-hidden shadow-sm`}>
      <div className="flex items-start justify-between gap-2">
        <span
          className={`w-8 h-8 flex items-center justify-center rounded-xl ${tone.iconBg} ${tone.icon}`}
        >
          {props.icon}
        </span>
        <p className="text-[11px] font-bold text-[hsl(var(--muted-foreground))] text-left leading-tight">
          {props.label}
        </p>
      </div>
      <p className="mt-2 text-xl font-bold font-mono text-[hsl(var(--foreground))] text-center">
        {props.value}
      </p>
      {props.delta && (
        <p
          className={`text-[10px] mt-1 text-center font-semibold ${DELTA_TONE_CLASS[props.delta.tone]}`}
        >
          <span className="inline-block ml-1">{deltaArrow}</span>
          {props.delta.text}
        </p>
      )}
      {/* Decorative non-data wave — visual filler to match the
          reference's mini-line style without inventing time-series
          data. The text-delta line above carries the actual signal. */}
      <svg
        viewBox="0 0 100 24"
        preserveAspectRatio="none"
        className="block w-full h-3 mt-1"
        aria-hidden
      >
        <polyline
          points="0,18 10,14 20,16 30,10 40,12 50,8 60,12 70,6 80,10 90,4 100,8"
          fill="none"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`${tone.line} opacity-50`}
        />
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Status distribution
// ─────────────────────────────────────────────────────────────────────────────

function StatusDistributionCard(props: {
  distribution: OperationsSummary['statusDistribution'];
  onStatusClick?: (status: string, label: string) => void;
}) {
  const total = props.distribution.reduce((s, d) => s + d.count, 0);
  const nonZero = props.distribution.filter((d) => d.count > 0);
  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-bold flex items-center gap-1.5">توزيع حالات الطلبات</h4>
      </div>
      {total === 0 ? (
        <p className="text-xs text-[hsl(var(--muted-foreground))] py-10 text-center">
          لا توجد بيانات في هذه الفترة
        </p>
      ) : (
        <>
          <div className="flex items-center gap-4">
            <ul className="flex-1 space-y-1.5 text-xs">
              {props.distribution.map((d) => (
                <li key={d.status}>
                  <button
                    type="button"
                    onClick={() => props.onStatusClick?.(d.status, d.label)}
                    disabled={d.count === 0 || !props.onStatusClick}
                    className="w-full flex items-center justify-between rounded-md px-1 py-0.5 hover:bg-[hsl(var(--muted))]/40 disabled:cursor-default disabled:hover:bg-transparent"
                    title={d.count > 0 ? `عرض طلبات ${d.label}` : ''}
                  >
                    <span className="flex items-center gap-1.5 text-[hsl(var(--foreground))]">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: STATUS_COLORS[d.status] ?? 'hsl(0, 0%, 50%)' }}
                      />
                      {d.label}
                    </span>
                    <span className="font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
                      {fmtNumber(d.count)} {d.percentage > 0 ? `(${d.percentage}%)` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <DonutChart segments={nonZero} total={total} />
          </div>
          <div className="mt-3 pt-3 border-t border-[hsl(var(--border))] text-center">
            <span className="text-[11px] font-bold text-[hsl(var(--primary))]">إجمالي الطلبات</span>
            <span className="text-[11px] text-[hsl(var(--muted-foreground))] mx-1">—</span>
            <span className="text-[11px] font-mono font-bold">{fmtNumber(total)}</span>
          </div>
        </>
      )}
    </div>
  );
}

function DonutChart(props: { segments: OperationsSummary['statusDistribution']; total: number }) {
  const SIZE = 130;
  const STROKE = 18;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const R = (SIZE - STROKE) / 2;
  const CIRC = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="relative flex-shrink-0" style={{ width: SIZE, height: SIZE }}>
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
        <span className="text-[10px] text-[hsl(var(--muted-foreground))]">إجمالي الطلبات</span>
        <span className="text-lg font-bold font-mono">{fmtNumber(props.total)}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Recent activity
// ─────────────────────────────────────────────────────────────────────────────

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

const ACTIVITY_DOT_COLOR: Record<string, string> = {
  adjustment_created: 'bg-amber-500',
  adjustment_approved: 'bg-emerald-500',
  adjustment_completed: 'bg-emerald-500',
  adjustment_rejected: 'bg-rose-500',
  adjustment_cancelled: 'bg-rose-500',
  order_edited: 'bg-blue-500',
  order_created: 'bg-green-500',
};

function activityDotColor(action: string): string {
  return ACTIVITY_DOT_COLOR[action] ?? 'bg-purple-500';
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
        <p className="text-xs text-[hsl(var(--muted-foreground))] py-10 text-center">
          لا توجد نشاطات في هذه الفترة
        </p>
      ) : (
        <ul className="space-y-3">
          {props.activity.slice(0, 5).map((a) => {
            // Fix2 — humanized label + optional "من <عميل>" suffix
            // when the audit row resolves a customer name. The
            // dashboard never shows raw action keys now.
            const suffix =
              a.action === 'order_created' && a.customer_name ? ` من ${a.customer_name}` : '';
            return (
              <li key={a.id} className="text-xs flex items-start gap-2">
                <span
                  className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${activityDotColor(a.action)}`}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-[hsl(var(--foreground))] leading-snug">
                    {a.label}
                    {a.order_num && (
                      <span className="text-[hsl(var(--primary))] font-mono"> #{a.order_num}</span>
                    )}
                    {suffix}
                  </p>
                  <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-0.5">
                    {timeAgo(a.created_at)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {props.activity.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[hsl(var(--border))] text-center">
          <span className="text-[11px] text-[hsl(var(--muted-foreground))]">عرض جميع النشاطات</span>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Needs action
// ─────────────────────────────────────────────────────────────────────────────

const NEEDS_TONES: Record<string, { pill: string; icon: string }> = {
  no_delegate: { pill: 'bg-rose-100 text-rose-700', icon: 'text-rose-500' },
  awaiting_schedule: { pill: 'bg-amber-100 text-amber-700', icon: 'text-amber-500' },
  pending_adjustments: { pill: 'bg-purple-100 text-purple-700', icon: 'text-purple-500' },
  partial_payments: { pill: 'bg-blue-100 text-blue-700', icon: 'text-blue-500' },
  delivery_delay: { pill: 'bg-orange-100 text-orange-700', icon: 'text-orange-500' },
};

function NeedsActionCard(props: {
  items: OperationsSummary['needsAction'];
  onApply?: (filter: Record<string, string>, label: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-bold flex items-center gap-1.5">
          <AlertCircle size={14} /> طلبات تحتاج متابعة
        </h4>
      </div>
      <ul className="space-y-2">
        {props.items.map((item) => {
          const tone = NEEDS_TONES[item.key] ?? {
            pill: 'bg-slate-100 text-slate-700',
            icon: 'text-slate-500',
          };
          const isOpen = expanded === item.key;
          const canDrill = item.count > 0 && (item.previewOrders?.length ?? 0) > 0;
          return (
            <li key={item.key} className="rounded-lg">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  disabled={!canDrill}
                  onClick={() => setExpanded(isOpen ? null : item.key)}
                  className="flex items-center gap-2 flex-1 min-w-0 text-right disabled:cursor-default"
                  title={canDrill ? 'انقر لعرض نماذج من الطلبات' : ''}
                >
                  <Package size={14} className={`flex-shrink-0 ${tone.icon}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-[hsl(var(--foreground))] truncate">
                      {item.label}
                    </p>
                    <p className="text-[10px] text-[hsl(var(--muted-foreground))] truncate">
                      {item.description}
                    </p>
                  </div>
                </button>
                <span
                  className={`text-xs font-bold font-mono px-2.5 py-1 rounded-lg min-w-[36px] text-center ${tone.pill}`}
                >
                  {fmtNumber(item.count)}
                </span>
                <button
                  type="button"
                  disabled={item.count <= 0 || !item.filter || !props.onApply}
                  onClick={() => item.filter && props.onApply?.(item.filter, `${item.label}`)}
                  className="text-[10px] font-bold text-[hsl(var(--primary))] flex items-center gap-0.5 hover:underline disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  عرض
                  <ChevronLeft size={12} />
                </button>
              </div>
              {isOpen && item.previewOrders.length > 0 && (
                <div className="mt-2 rounded-lg bg-[hsl(var(--muted))]/30 p-2 space-y-1">
                  {item.previewOrders.map((o) => (
                    <div
                      key={`${item.key}-${o.order_num}`}
                      className="flex items-center justify-between text-[10px] gap-2"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-mono text-[hsl(var(--primary))]">#{o.order_num}</p>
                        <p className="truncate text-[hsl(var(--muted-foreground))]">
                          {o.customer_name || '—'} — {o.products_summary}
                        </p>
                      </div>
                      <span className="text-[9px] text-[hsl(var(--muted-foreground))] flex-shrink-0">
                        {o.status_label}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-3 pt-3 border-t border-[hsl(var(--border))] text-center">
        <span className="text-[11px] text-[hsl(var(--muted-foreground))]">عرض جميع</span>
      </div>
    </div>
  );
}
