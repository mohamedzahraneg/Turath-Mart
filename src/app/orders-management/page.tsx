"use client";
import React from 'react';
import AppLayout from '@/components/AppLayout';
import { useAuth } from "@/contexts/AuthContext";
import OrdersHeader from './components/OrdersHeader';
import OrdersTableSection from './components/OrdersTableSection';
import LiveOrdersDashboard from './components/LiveOrdersDashboard';

export default function OrdersManagementPage() {
  const { user } = useAuth();
  return (
    <AppLayout currentPath="/orders-management">
      <div className="space-y-6 fade-in">
        <OrdersHeader />
        {user?.permissions.includes("orders_manage") && <LiveOrdersDashboard />}
        <OrdersTableSection />
      </div>
    </AppLayout>
  );
}
