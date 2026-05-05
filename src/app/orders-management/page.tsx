'use client';
import React from 'react';
import AppLayout from '@/components/AppLayout';
import { usePermissions } from '@/hooks/usePermissions';
import OrdersHeader from './components/OrdersHeader';
import OrdersTableSection from './components/OrdersTableSection';
import LiveOrdersDashboard from './components/LiveOrdersDashboard';
export default function OrdersManagementPage() {
  const perms = usePermissions();
  // Live dashboard is admin-only by role, OR available to anyone with the
  // explicit 'orders_manage' custom permission.
  const canViewLiveDashboard = perms.isAdmin || perms.can('orders_manage');
  return (
    <AppLayout currentPath="/orders-management">
      <div className="space-y-6 fade-in">
        <OrdersHeader />
        {canViewLiveDashboard && <LiveOrdersDashboard />}
        <OrdersTableSection />
      </div>
    </AppLayout>
  );
}
