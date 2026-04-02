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
      <div className="space-y-10 fade-in pb-12 pt-2">
        {/* Step 1: Contextual Header */}
        <DashboardHeader />

        {/* Step 2: Main Key Performance Indicators */}
        <div className="space-y-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-bold text-[hsl(var(--foreground))]">
              نظرة عامة على الأداء
            </h2>
            <div className="text-[10px] bg-green-50 text-green-700 px-3 py-1 rounded-full font-bold border border-green-100 flex items-center gap-1 shadow-sm">
              <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
              مزامنة لحظية
            </div>
          </div>
          <DashboardKPIs />
        </div>

        {/* Step 3: Analytical Trends */}
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-[hsl(var(--foreground))]">
            تحليلات النمو والتحصيل
          </h2>
          <DashboardCharts />
        </div>

        {/* Step 4: Operations & Logistics */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          <div className="xl:col-span-2 space-y-4">
            <h2 className="text-lg font-bold text-[hsl(var(--foreground))]">
              أحدث الطلبات والعمليات
            </h2>
            <RecentOrdersTable />
          </div>
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-[hsl(var(--foreground))]">
              حالة المخزون الاستراتيجية
            </h2>
            <InventoryStatus />
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
