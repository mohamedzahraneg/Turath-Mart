'use client';
import React, { useState } from 'react';
import {
  Plus,
  Download,
  RefreshCw,
  FileSpreadsheet,
  FileText,
  CheckCircle,
  Package,
} from 'lucide-react';
import AddOrderModal from './AddOrderModal';
import { createClient } from '@/lib/supabase/client';

export default function OrdersHeader() {
  const [showModal, setShowModal] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [counts, setCounts] = React.useState({ total: 0, today: 0 });
  const [loading, setLoading] = React.useState(true);

  const fetchCounts = async () => {
    try {
      const supabase = createClient();
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

      const [totalRes, todayRes] = await Promise.all([
        supabase.from('turath_masr_orders').select('*', { count: 'exact', head: true }),
        supabase
          .from('turath_masr_orders')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', todayStr),
      ]);

      setCounts({
        total: totalRes.count || 0,
        today: todayRes.count || 0,
      });
    } catch (err) {
      console.error('Error fetching order counts:', err);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    fetchCounts();
    // Refresh counts when orders are updated
    window.addEventListener('turath_masr_orders_updated', fetchCounts);
    return () => window.removeEventListener('turath_masr_orders_updated', fetchCounts);
  }, []);

  const handleExportCSV = () => {
    const event = new CustomEvent('export-orders-csv');
    window.dispatchEvent(event);
    setShowExportMenu(false);
  };

  const handleExportPDF = () => {
    const event = new CustomEvent('export-orders-pdf');
    window.dispatchEvent(event);
    setShowExportMenu(false);
  };

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">إدارة الأوردرات</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
            {loading ? (
              <span className="animate-pulse">جاري تحميل الإحصائيات...</span>
            ) : (
              `إجمالي ${counts.total.toLocaleString('en-US')} أوردر — ${counts.today.toLocaleString('en-US')} اليوم`
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn-secondary text-sm" onClick={() => fetchCounts()}>
            <RefreshCw size={15} />
            <span>تحديث</span>
          </button>
          {/* Export dropdown */}
          <div className="relative">
            <button
              className="btn-secondary text-sm"
              onClick={() => setShowExportMenu(!showExportMenu)}
            >
              <Download size={15} />
              <span>تصدير</span>
            </button>
            {showExportMenu && (
              <div className="absolute left-0 top-full mt-1 bg-white border border-[hsl(var(--border))] rounded-xl shadow-lg z-20 min-w-[160px] overflow-hidden">
                <button
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-[hsl(var(--muted))] transition-colors text-right"
                  onClick={handleExportCSV}
                >
                  <FileSpreadsheet size={15} className="text-green-600" />
                  تصدير Excel (CSV)
                </button>
                <button
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-[hsl(var(--muted))] transition-colors text-right border-t border-[hsl(var(--border))]"
                  onClick={handleExportPDF}
                >
                  <FileText size={15} className="text-red-500" />
                  تصدير PDF
                </button>
              </div>
            )}
          </div>
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
