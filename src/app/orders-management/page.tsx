// ─────────────────────────────────────────────────────────────────────────────
// src/app/orders-management/page.tsx
//
// Phase Orders-Page-Redesign-1 Fix2 — page-level orchestration with
// shared filter state + scroll-to-table integration.
//
// State held here so the header / dashboard / table stay in sync:
//   • `range` — the active date range. Driven by the smart-filter
//     chips in `OrdersHeader` and the custom-range date inputs.
//   • `appliedFilter` — one-shot patch emitted when the dashboard
//     wants the table to focus a subset (needs-action item, status
//     row in the donut card).
//   • `activeFilterLabel` — human label for the banner shown above
//     the table while an external filter is active.
// ─────────────────────────────────────────────────────────────────────────────
'use client';

import React, { useCallback, useRef, useState } from 'react';
import AppLayout from '@/components/AppLayout';
import { usePermissions } from '@/hooks/usePermissions';
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
  const [activeFilterLabel, setActiveFilterLabel] = useState<string | null>(null);
  const tableRef = useRef<HTMLDivElement | null>(null);

  // Phase Orders-Dashboard-Admin-Gate-1 — KPI cards, status
  // distribution, recent activity, and needs-action panels are
  // admin-only for now. Conditional render means non-admin users
  // never mount `<OrdersDashboard>` and the `/api/orders/operations-
  // summary` fetch is skipped entirely (the fetch lives inside the
  // component, see OrdersDashboard.tsx). The orders table and its
  // filters/actions stay governed by their existing permissions.
  // Currently admin-only; can be expanded later to a dedicated
  // analytics permission.
  const perms = usePermissions();
  const canViewOrdersDashboard = perms.isAdmin;

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

  // Phase Orders-Page-Redesign-1 Fix2 — clicks on needs-action items
  // OR status-distribution rows funnel through here. We set the
  // table filter, mark the banner label, and scroll the table into
  // view. A fresh `__nonce` makes sure the table's effect fires even
  // when the same key/value repeats from one click to the next.
  const handleApplyTableFilter = useCallback((filter: Record<string, string>, label: string) => {
    setAppliedFilter({ ...filter, __nonce: String(Date.now()) });
    setActiveFilterLabel(label);
    if (typeof window !== 'undefined') {
      // Defer to next tick so React renders the banner before we
      // scroll — keeps the new banner in the viewport.
      window.requestAnimationFrame(() => {
        tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }, []);

  const handleClearAppliedFilter = useCallback(() => {
    setAppliedFilter({ __clear: '1', __nonce: String(Date.now()) });
    setActiveFilterLabel(null);
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
        {canViewOrdersDashboard && (
          <OrdersDashboard range={range} onApplyTableFilter={handleApplyTableFilter} />
        )}
        <div ref={tableRef}>
          <OrdersTableSection
            appliedRange={{ from: range.from, to: range.to }}
            appliedFilter={appliedFilter}
            activeFilterLabel={activeFilterLabel}
            onClearAppliedFilter={handleClearAppliedFilter}
          />
        </div>
      </div>
    </AppLayout>
  );
}
