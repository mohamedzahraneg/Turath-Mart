// ─────────────────────────────────────────────────────────────────────────────
// src/app/orders-management/components/OrdersHeader.tsx
//
// Phase Orders-Page-Redesign-1 Visual Match Fix — top header that
// matches the approved design pixel-by-pixel (RTL):
//
//   [+ طلب جديد] [date range] [تحديث]   [فلتر ذكي: chips...]   [إدارة الطلبات]
//                                                                [breadcrumb]
//
//   • Right column: title + breadcrumb (الرئيسية → الطلبات).
//   • Center: dashed purple container with the smart-filter chips
//     (اليوم / أمس / هذا الأسبوع / هذا الشهر / الشهر السابق) +
//     a "فلتر ذكي" pill on the right edge.
//   • Left column: + طلب جديد (filled primary), custom date range,
//     refresh button.
//
// Behaviour preserved from the previous header:
//   • + طلب جديد mounts the existing AddOrderModal verbatim (lazy).
//   • Date range pushes `{from, to}` upward with preset:'custom'.
//   • Refresh fires `turath_masr_orders_updated` so the dashboard +
//     table re-fetch via their existing subscriptions.
// ─────────────────────────────────────────────────────────────────────────────
'use client';
import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { Plus, RefreshCw, ChevronLeft, Calendar, Package } from 'lucide-react';
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

const SMART_FILTER_PRESETS: ReadonlyArray<{ key: DateRangePreset; label: string }> = [
  { key: 'today', label: 'اليوم' },
  { key: 'yesterday', label: 'أمس' },
  { key: 'this_week', label: 'هذا الأسبوع' },
  { key: 'this_month', label: 'هذا الشهر' },
  { key: 'previous_month', label: 'الشهر السابق' },
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
  return (
    <>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between" dir="rtl">
        {/* Right column: title + breadcrumb. In RTL grid this lands
            on the far right of the row. */}
        <div className="text-right order-1 xl:order-3 flex items-start gap-2 justify-end">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-[hsl(var(--foreground))] flex items-center justify-end gap-2">
              إدارة الطلبات
              <Package size={22} className="text-[hsl(var(--primary))]" />
            </h1>
            <div className="flex items-center justify-end gap-1 text-[11px] text-[hsl(var(--muted-foreground))] mt-1">
              <span>الطلبات</span>
              <ChevronLeft size={12} />
              <span>الرئيسية</span>
            </div>
          </div>
        </div>

        {/* Center: smart filter inside a dashed purple container. */}
        <div className="order-2 xl:order-2 flex-1 flex justify-center">
          <div className="inline-flex items-center gap-2 rounded-2xl border-2 border-dashed border-purple-300 bg-purple-50/40 px-3 py-1.5">
            <div className="flex items-center gap-1.5">
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
            <span className="flex items-center gap-1 rounded-xl bg-white border border-purple-200 text-purple-700 text-xs font-bold px-2.5 py-1.5">
              <span className="text-purple-500">▾</span>
              فلتر ذكي
            </span>
          </div>
        </div>

        {/* Left column: actions. */}
        <div className="order-3 xl:order-1 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="text-sm font-bold text-white bg-[hsl(217,80%,30%)] hover:bg-[hsl(217,80%,25%)] rounded-xl px-4 py-2 flex items-center gap-1.5 shadow-sm"
          >
            <Plus size={16} />
            <span>طلب جديد</span>
          </button>
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

      {showModal && <AddOrderModal onClose={() => setShowModal(false)} />}
    </>
  );
}
