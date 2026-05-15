// ─────────────────────────────────────────────────────────────────────────────
// src/app/orders-management/page.tsx
//
// Phase Orders-Page-Redesign-1 — page-level orchestration for the
// redesigned orders surface.
//
// State held here (lifted up so the dashboard + table stay in sync):
//   • `range` — the active date range. Driven by the smart-filter
//     chips inside `OrdersDashboard` and the custom-range date inputs
//     inside `OrdersHeader`. Pushed into the table as `appliedRange`.
//   • `appliedFilter` — a one-shot patch emitted when the user clicks
//     "عرض" on a needs-action item. The table consumes it and
//     resets to page 1.
//
// What this page deliberately does NOT do:
//   • Open or render any of the heavy modals (AddOrder, OrderDetail,
//     EditOrder, OrderAdjustment, StatusUpdate, AuditLog). Those
//     stay owned by their existing entry points (the header button
//     for AddOrder, the table rows for the rest) so the modal-level
//     behaviour is unchanged.
//   • Fetch data. The dashboard owns the aggregate read; the table
//     owns its paginated query.
// ─────────────────────────────────────────────────────────────────────────────
'use client';

import React, { useCallback, useState } from 'react';
import AppLayout from '@/components/AppLayout';
import OrdersHeader from './components/OrdersHeader';
import OrdersTableSection from './components/OrdersTableSection';
import OrdersDashboard, {
  rangeForPreset,
  type DateRange,
  type DateRangePreset,
} from './components/OrdersDashboard';

export default function OrdersManagementPage() {
  const [range, setRange] = useState<DateRange>(() => rangeForPreset('today'));
  const [appliedFilter, setAppliedFilter] = useState<Record<string, string> | null>(null);

  const handlePresetChange = useCallback((preset: DateRangePreset) => {
    setRange(rangeForPreset(preset));
  }, []);

  const handleCustomRange = useCallback((from: string, to: string) => {
    if (!from || !to) return;
    setRange({ from, to, preset: 'custom' });
  }, []);

  const handleRefresh = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new Event('turath_masr_orders_updated'));
    window.dispatchEvent(new Event('turath_masr_order_adjustments_updated'));
  }, []);

  const handleNeedsActionApply = useCallback((filter: Record<string, string>) => {
    // Use a fresh object reference each time so the table's effect
    // (`useEffect([appliedFilter])`) fires even when the same key /
    // value repeats from one click to the next.
    setAppliedFilter({ ...filter, __nonce: String(Date.now()) });
  }, []);

  return (
    <AppLayout currentPath="/orders-management">
      <div className="space-y-5 fade-in">
        <OrdersHeader
          dateFrom={range.from}
          dateTo={range.to}
          onCustomRange={handleCustomRange}
          onRefresh={handleRefresh}
        />
        <OrdersDashboard
          range={range}
          onPresetChange={handlePresetChange}
          onNeedsActionApply={handleNeedsActionApply}
        />
        <OrdersTableSection
          appliedRange={{ from: range.from, to: range.to }}
          appliedFilter={appliedFilter}
        />
      </div>
    </AppLayout>
  );
}
