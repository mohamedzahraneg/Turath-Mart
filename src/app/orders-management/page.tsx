"use client";
import React from 'react';
import AppLayout from '@/components/AppLayout';
import { useAuth } from "@/contexts/AuthContext";
import OrdersHeader from './components/OrdersHeader';
import OrdersTableSection from './components/OrdersTableSection';
import LiveOrdersDashboard from './components/LiveOrdersDashboard';
export default function OrdersManagementPage() {
  const { currentRoleId, customPermissions } = useAuth();
  // Safe permission check - no crash if permissions is null
  const canViewLiveDashboard = (() => {
    if (currentRoleId === 'r1') return true;
    if (Array.isArray(customPermissions) && customPermissions.includes('orders_manage')) return true;
    return false;
  })();
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
