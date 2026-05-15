// ─────────────────────────────────────────────────────────────────────────────
// src/app/orders-management/page.tsx
//
// Phase Orders-Page-Redesign-1 — page-level orchestration.
//
// State held here so the header / dashboard / table all stay in sync:
//   • `range` — the active date range. Driven by the smart-filter
//     chips in `OrdersHeader` (which now hosts the dashed-purple
//     container per the approved design) and the custom-range date
//     inputs also in the header.
//   • `appliedFilter` — one-shot patch emitted when the user clicks
//     "عرض" on a needs-action item inside `OrdersDashboard`.
//
// The page deliberately does not open or render any of the heavy
// modals (AddOrder, OrderDetail, EditOrder, OrderAdjustment,
// StatusUpdate, AuditLog). Those entry points stay owned by their
// existing components.
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
    setAppliedFilter({ ...filter, __nonce: String(Date.now()) });
  }, []);

  return (
    <AppLayout currentPath="/orders-management">
      <div className="space-y-5 fade-in">
        <OrdersHeader
          dateFrom={range.from}
          dateTo={range.to}
          preset={range.preset}
          onCustomRange={handleCustomRange}
          onPresetChange={handlePresetChange}
          onRefresh={handleRefresh}
        />
        <OrdersDashboard range={range} onNeedsActionApply={handleNeedsActionApply} />
        <OrdersTableSection
          appliedRange={{ from: range.from, to: range.to }}
          appliedFilter={appliedFilter}
        />
      </div>
    </AppLayout>
  );
}
