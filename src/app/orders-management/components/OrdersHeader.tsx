// ─────────────────────────────────────────────────────────────────────────────
// src/app/orders-management/components/OrdersHeader.tsx
//
// Phase Orders-Page-Redesign-1 — top header for /orders-management.
//
// Layout (RTL):
//   [breadcrumb + title]                                 [date range picker]
//                                                        [refresh] [طلب جديد]
//
// The smart-filter chips live inside `OrdersDashboard` so the date
// range stays close to the KPIs it drives. The header keeps:
//   • title + breadcrumb,
//   • a custom date-range picker that pushes a `{from, to,
//     preset:'custom'}` upward (the parent then applies it both to
//     the dashboard query and the table's internal date filter),
//   • a refresh button that broadcasts `turath_masr_orders_updated`
//     so all live subscribers re-fetch,
//   • the lazy "+ طلب جديد" button that opens the existing
//     AddOrderModal unchanged.
//
// What this component is NOT
// --------------------------
//   • Not the smart-filter chips. Those live in OrdersDashboard.
//   • Not the export menu. The table section owns the bulk-action /
//     export row now; replicating a header-level export menu would
//     double the surface area.
//   • Not the AddOrderModal logic. The button still mounts the
//     existing modal verbatim.
// ─────────────────────────────────────────────────────────────────────────────
'use client';
import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { Plus, RefreshCw, ChevronLeft } from 'lucide-react';
// Phase 20B QW-A — keep the heavy AddOrderModal lazy.
const AddOrderModal = dynamic(() => import('./AddOrderModal'), { ssr: false });

interface Props {
  /** Current applied range — used to mirror the dashboard chips on
   *  the date inputs so the header stays in sync. */
  dateFrom: string;
  dateTo: string;
  /** Push a custom-range change upward. The parent sets preset to
   *  `'custom'` so the chip row clears its active state. */
  onCustomRange: (from: string, to: string) => void;
  /** Trigger a global refresh — fires the existing
   *  `turath_masr_orders_updated` event the dashboard + table
   *  already subscribe to. */
  onRefresh: () => void;
}

export default function OrdersHeader({ dateFrom, dateTo, onCustomRange, onRefresh }: Props) {
  const [showModal, setShowModal] = useState(false);
  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setShowModal(true)} className="btn-primary text-sm">
            <Plus size={16} />
            <span>طلب جديد</span>
          </button>
          <div className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-white px-2.5 py-1.5">
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
            className="btn-secondary text-sm"
            aria-label="تحديث"
          >
            <RefreshCw size={15} />
            <span>تحديث</span>
          </button>
        </div>
        <div className="text-right">
          <div className="flex items-center justify-end gap-2 text-[10px] text-[hsl(var(--muted-foreground))]">
            <span>الطلبات</span>
            <ChevronLeft size={12} />
            <span>الرئيسية</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-[hsl(var(--foreground))] flex items-center justify-end gap-2">
            إدارة الطلبات
          </h1>
        </div>
      </div>

      {showModal && <AddOrderModal onClose={() => setShowModal(false)} />}
    </>
  );
}
