'use client';
import React, { useState } from 'react';
import { Plus, Download, Filter, RefreshCw } from 'lucide-react';
import AddOrderModal from './AddOrderModal';

export default function OrdersHeader() {
  const [showModal, setShowModal] = useState(false);

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">إدارة الأوردرات</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
            إجمالي ١٢,٤٨٧ أوردر — ٤٧ اليوم
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn-secondary text-sm">
            <RefreshCw size={15} />
            <span>تحديث</span>
          </button>
          <button className="btn-secondary text-sm">
            <Filter size={15} />
            <span>فلتر</span>
          </button>
          <button className="btn-secondary text-sm">
            <Download size={15} />
            <span>تصدير Excel</span>
          </button>
          <button className="btn-primary text-sm" onClick={() => setShowModal(true)}>
            <Plus size={16} />
            <span>إضافة أوردر جديد</span>
          </button>
        </div>
      </div>

      {showModal && <AddOrderModal onClose={() => setShowModal(false)} />}
    </>
  );
}