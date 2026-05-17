// ─────────────────────────────────────────────────────────────────────────────
// src/app/orders-management/components/OrdersHeader.tsx
//
// Phase Orders-Page-Redesign-1 Fix3 — header polish:
//
//   • Removed the "فلتر ذكي" pill — the dashed-purple container now
//     hosts the smart-filter chips directly. The label was visual
//     filler with no behaviour attached.
//   • Smart-filter chips render strictly right-to-left
//     (`dir="rtl"` on the chip group + reversed source order is
//     unnecessary because the parent is already RTL). Visual order:
//       اليوم | أمس | هذا الأسبوع | هذا الشهر | الشهر السابق
//   • Breadcrumb "الرئيسية" is now a real Next.js `<Link>` to
//     `/dashboard` instead of plain text.
// ─────────────────────────────────────────────────────────────────────────────
'use client';
import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Plus, RefreshCw, ChevronLeft, Calendar, Package } from 'lucide-react';
import { usePermissions } from '@/hooks/usePermissions';
import type { DateRangePreset } from './OrdersDashboard';

const AddOrderModal = dynamic(() => import('./AddOrderModal'), { ssr: false });

interface Props {
  dateFrom: string;
  dateTo: string;
  preset: DateRangePreset;
  onCustomRange: (from: string, to: string) => void;
  onPresetChange: (preset: DateRangePreset) => void;
  onRefresh: () => void;
}

// Phase Orders-Mobile-Quick-Filters-1 — chip set updated:
//   • Removed 'أمس' (yesterday) — operators reported it was rarely used.
//   • Added 'الكل' (all) at the end so a single click clears the date
//     range filter and lists every order. The 'all' preset returns
//     empty `from`/`to` from `rangeForPreset`; OrdersTableSection's
//     date helpers translate empty strings into "no date filter" so
//     the DB query drops the `created_at` `gte`/`lt` clauses entirely.
const SMART_FILTER_PRESETS: ReadonlyArray<{ key: DateRangePreset; label: string }> = [
  { key: 'today', label: 'اليوم' },
  { key: 'this_week', label: 'هذا الأسبوع' },
  { key: 'this_month', label: 'هذا الشهر' },
  { key: 'previous_month', label: 'الشهر السابق' },
  { key: 'all', label: 'الكل' },
];

export default function OrdersHeader({
  dateFrom,
  dateTo,
  preset,
  onCustomRange,
  onPresetChange,
  onRefresh,
}: Props) {
  const [showModal, setShowModal] = useState(false);
  // Phase Orders-Mobile-Quick-Filters-1 — gate "طلب جديد" to roles
  // that can actually create orders (r1/r2/r5/r6 per
  // `canCreateOrders` in src/lib/constants/roles.ts). Shipping roles
  // (r3/r4) and any custom permission set without `create_orders` no
  // longer see the button, so the AddOrderModal cannot be opened
  // from this page for them. The modal is dynamic-imported, so the
  // chunk also isn't fetched for non-eligible roles.
  const perms = usePermissions();
  return (
    <>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between" dir="rtl">
        {/* Right column: title + breadcrumb. The "الرئيسية" entry is
            a real link to the dashboard so the breadcrumb is
            navigable, not decorative. */}
        <div className="text-right order-1 xl:order-3 flex items-start gap-2 justify-end">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-[hsl(var(--foreground))] flex items-center justify-end gap-2">
              إدارة الطلبات
              <Package size={22} className="text-[hsl(var(--primary))]" />
            </h1>
            <div className="flex items-center justify-end gap-1 text-[11px] text-[hsl(var(--muted-foreground))] mt-1">
              <span className="text-[hsl(var(--foreground))] font-semibold">الطلبات</span>
              <ChevronLeft size={12} />
              <Link
                href="/dashboard"
                className="hover:underline hover:text-[hsl(var(--primary))] transition-colors"
              >
                الرئيسية
              </Link>
            </div>
          </div>
        </div>

        {/* Center: smart filter inside the dashed-purple container.
            Chips render strictly RTL: today on the right, "الكل" on
            the left. The "فلتر ذكي" pill is removed (it was
            decorative).

            Phase Orders-Mobile-Quick-Filters-1 — `flex-wrap` so
            chips wrap onto a second row on narrow viewports
            (≤ ~430 px) instead of overflowing the page. Desktop
            (xl+) keeps the single-row layout because the parent
            row uses `xl:flex-row xl:items-center xl:justify-between`
            and there's enough horizontal space at that breakpoint. */}
        <div className="order-2 xl:order-2 flex-1 flex justify-center min-w-0">
          <div
            className="flex flex-wrap items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-purple-300 bg-purple-50/40 px-3 py-1.5 max-w-full"
            dir="rtl"
          >
            {SMART_FILTER_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => onPresetChange(p.key)}
                className={`text-xs px-3 py-1.5 rounded-xl transition-colors font-semibold ${
                  preset === p.key
                    ? 'bg-[hsl(217,80%,30%)] text-white shadow-sm'
                    : 'bg-white border border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]/40'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Left column: actions.
            Phase Orders-Mobile-Quick-Filters-1 — `flex-wrap` so the
            three items (New Order button + date-range box + refresh)
            wrap onto two lines on narrow viewports instead of pushing
            the page past 360 px. RTL: `justify-end` keeps them
            anchored to the right edge on small screens; desktop
            keeps the original inline order via the parent row. */}
        <div className="order-3 xl:order-1 flex flex-wrap items-center justify-end gap-2 min-w-0">
          {/* Phase Orders-Mobile-Quick-Filters-1 — "طلب جديد" gated
              by the existing `canCreateOrders` permission. r1 (admin),
              r2 (system supervisor), r5 (CS manager), r6 (CS) keep
              the button; shipping roles r3/r4 and any custom
              permission set lacking `create_orders` no longer see
              it. The modal cannot be opened from this page for those
              roles because the trigger isn't mounted. */}
          {perms.canCreateOrders && (
            <button
              type="button"
              onClick={() => setShowModal(true)}
              className="text-sm font-bold text-white bg-[hsl(217,80%,30%)] hover:bg-[hsl(217,80%,25%)] rounded-xl px-4 py-2 flex items-center gap-1.5 shadow-sm"
            >
              <Plus size={16} />
              <span>طلب جديد</span>
            </button>
          )}
          <div className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-white px-2.5 py-1.5">
            <Calendar size={14} className="text-[hsl(var(--muted-foreground))]" />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => onCustomRange(e.target.value, dateTo)}
              className="text-xs bg-transparent border-0 focus:outline-none font-mono"
              aria-label="من تاريخ"
            />
            <span className="text-[hsl(var(--muted-foreground))]">-</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => onCustomRange(dateFrom, e.target.value)}
              className="text-xs bg-transparent border-0 focus:outline-none font-mono"
              aria-label="إلى تاريخ"
            />
          </div>
          <button
            type="button"
            onClick={onRefresh}
            className="text-sm rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-1.5 flex items-center gap-1.5 hover:bg-[hsl(var(--muted))]/40"
          >
            <RefreshCw size={14} />
            <span>تحديث</span>
          </button>
        </div>
      </div>

      {/* AddOrderModal is only ever mounted when the trigger button
          was clicked, which itself only renders for `canCreateOrders`
          roles. Defensive null-check duplicates the permission gate
          so an out-of-band setState (e.g. dev-tools or future code
          path) cannot bypass it. */}
      {showModal && perms.canCreateOrders && <AddOrderModal onClose={() => setShowModal(false)} />}
    </>
  );
}
