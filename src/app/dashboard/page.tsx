import React from 'react';
import AppLayout from '@/components/AppLayout';
import DashboardKPIs from './components/DashboardKPIs';
import DashboardCharts from './components/DashboardCharts';
import RecentOrdersTable from './components/RecentOrdersTable';
import InventoryStatus from './components/InventoryStatus';
import DashboardHeader from './components/DashboardHeader';

export default function DashboardPage() {
  return (
    <AppLayout currentPath="/dashboard">
      <div className="space-y-6 fade-in">
        <DashboardHeader />
        <DashboardKPIs />
        <DashboardCharts />
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2">
            <RecentOrdersTable />
          </div>
          <div>
            <InventoryStatus />
          </div>
        </div>
      </div>
    </AppLayout>
  );
}