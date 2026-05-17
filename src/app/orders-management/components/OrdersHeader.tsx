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
//   • Added 'الكل' (all) so a single click clears the date filter
//     and lists every order. The 'all' preset returns empty
//     `from`/`to` from `rangeForPreset`; OrdersTableSection's date
//     helpers translate empty strings into "no date filter" so the
//     DB query drops the `created_at` `gte`/`lt` clauses entirely.
//
// Phase Orders-CustomDate-Chip-1 — added 'مخصص' (custom) to the
// chip list. Clicking it triggers `onPresetChange('custom')`, which
// seeds today/today via `rangeForPreset('custom')`; the operator
// then refines via inline "من" / "إلى" date inputs that render
// *inside* the dashed filter bar only while `preset === 'custom'`.
// Editing either input flips through `onCustomRange` (which sets
// preset='custom' page-side), so the chip stays highlighted. Any
// other preset click swaps the range and hides the date inputs.
const SMART_FILTER_PRESETS: ReadonlyArray<{ key: DateRangePreset; label: string }> = [
  { key: 'today', label: 'اليوم' },
  { key: 'this_week', label: 'هذا الأسبوع' },
  { key: 'this_month', label: 'هذا الشهر' },
  { key: 'previous_month', label: 'الشهر السابق' },
  { key: 'all', label: 'الكل' },
  { key: 'custom', label: 'مخصص' },
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
  // Phase Orders-CreatePerm-Fix-1 — gate "طلب جديد" through the
  // canonical permission catalog, not the divergent
  // `perms.canCreateOrders` boolean (which only consults the role
  // helper in `roles.ts` and ignores `customPermissions`). The
  // pattern below — `isAdmin OR has the specific permission key` —
  // is the project-wide convention for action gates (see
  // OrderDetailModal canEditOrder, EditOrderModal canEdit,
  // UsersTab canManageStaff). It correctly honours per-user
  // `customPermissions` overrides set by an admin from `/roles`,
  // and falls back to `DEFAULT_ROLES` defaults when no custom set
  // is assigned. No new permission key is introduced; `create_orders`
  // is already registered in PERMISSION_CATALOG and surfaced in the
  // /roles admin UI.
  const perms = usePermissions();
  const canCreateOrder = perms.isAdmin || perms.can('create_orders');
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
            {/* Phase Orders-CustomDate-Chip-1 — custom date inputs
                are visually attached to the "مخصص" chip: they only
                mount while `preset === 'custom'`, so other presets
                see a clean chip row. `w-full` makes the inputs flow
                onto a new row inside the same dashed container,
                giving a clear "this is what مخصص expands to" affordance
                without introducing a separate UI block elsewhere on
                the page. Edits flow through the existing
                `onCustomRange` callback (no new state in this
                component, no new callbacks). */}
            {preset === 'custom' && (
              <div className="w-full flex flex-wrap items-center justify-center gap-2 pt-1.5">
                <label className="flex items-center gap-1.5 text-xs font-semibold text-[hsl(var(--foreground))]">
                  <Calendar size={12} className="text-[hsl(var(--muted-foreground))]" />
                  <span>من</span>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => onCustomRange(e.target.value, dateTo)}
                    className="text-xs bg-white border border-[hsl(var(--border))] rounded-lg px-2 py-1 font-mono focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
                    aria-label="من تاريخ"
                  />
                </label>
                <label className="flex items-center gap-1.5 text-xs font-semibold text-[hsl(var(--foreground))]">
                  <span>إلى</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => onCustomRange(dateFrom, e.target.value)}
                    className="text-xs bg-white border border-[hsl(var(--border))] rounded-lg px-2 py-1 font-mono focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
                    aria-label="إلى تاريخ"
                  />
                </label>
              </div>
            )}
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
          {/* Phase Orders-CreatePerm-Fix-1 — "طلب جديد" gated by the
              canonical `create_orders` permission via the existing
              catalog (`hasPermission` → respects `customPermissions`
              overrides). Same pattern used by OrderDetailModal +
              EditOrderModal for their edit gates. */}
          {canCreateOrder && (
            <button
              type="button"
              onClick={() => setShowModal(true)}
              className="text-sm font-bold text-white bg-[hsl(217,80%,30%)] hover:bg-[hsl(217,80%,25%)] rounded-xl px-4 py-2 flex items-center gap-1.5 shadow-sm"
            >
              <Plus size={16} />
              <span>طلب جديد</span>
            </button>
          )}
          {/* Phase Orders-CustomDate-Chip-1 — the always-visible
              date-range box that used to live here has moved into
              the dashed filter bar above and only renders while
              `preset === 'custom'`. The actions row now carries
              just the create-order trigger (when permitted) and the
              refresh button. */}
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
          was clicked, which itself only renders for callers that
          satisfy `canCreateOrder`. Defensive double-guard with the
          same `canCreateOrder` value so an out-of-band setState
          (e.g. dev-tools or future code path) cannot bypass the
          permission gate. */}
      {showModal && canCreateOrder && <AddOrderModal onClose={() => setShowModal(false)} />}
    </>
  );
}
