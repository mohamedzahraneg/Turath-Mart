import React from 'react';
import AppLayout from '@/components/AppLayout';
import OrdersHeader from './components/OrdersHeader';
import OrdersTableSection from './components/OrdersTableSection';

export default function OrdersManagementPage() {
  return (
    <AppLayout currentPath="/orders-management">
      <div className="space-y-6 fade-in">
        <OrdersHeader />
        <OrdersTableSection />
      </div>
    </AppLayout>
  );
}