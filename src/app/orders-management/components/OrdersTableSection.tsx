'use client';
import React, { useState, useEffect } from 'react';
import { 
  Zap, TrendingUp, ChevronRight
} from 'lucide-react';
import { Toaster } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';

export default function OrdersTableSection() {
  const { user } = useAuth();
  const [allOrders, setAllOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [showDelegateStats, setShowDelegateStats] = useState(false);

  useEffect(() => {
    const fetchOrders = async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from('turath_masr_orders')
          .select('*')
          .order('created_at', { ascending: false });
        if (error) throw error;
        setAllOrders(data || []);
      } catch (err) {
        console.error('Error fetching orders:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchOrders();
  }, []);

  const canManage = user?.permissions?.includes('orders_manage');

  return (
    <>
      <Toaster position="top-center" richColors />
      <div className="card-section overflow-hidden">
        {canManage && (
          <div className="flex items-center gap-2 px-4 py-2 bg-green-50 border-b border-green-200">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <Zap size={13} className="text-green-600" />
            <span className="text-xs text-green-700 font-semibold">تحديث لحظي نشط</span>
          </div>
        )}

        <div className="border-b border-[hsl(var(--border))]">
          <button 
            onClick={() => setShowDelegateStats(!showDelegateStats)}
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-[hsl(var(--muted))]/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              <TrendingUp size={16} className="text-[hsl(var(--primary))]" />
              <span className="text-sm font-bold">إحصائيات المناديب والتوريدات</span>
            </div>
            <ChevronRight size={16} className={`transition-transform ${showDelegateStats ? "rotate-90" : ""}`} />
          </button>

          {showDelegateStats && (
            <div className="p-4 bg-[hsl(var(--muted))]/10 space-y-4">
              {canManage ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-white border border-[hsl(var(--border))] rounded-xl p-3 shadow-sm">
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">إجمالي التحصيل</p>
                    <p className="text-xl font-bold mt-1">0 ج.م</p>
                  </div>
                  <div className="bg-white border border-[hsl(var(--border))] rounded-xl p-3 shadow-sm">
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">توريدات المناديب</p>
                    <p className="text-xl font-bold mt-1">0 ج.م</p>
                  </div>
                  <div className="bg-white border border-[hsl(var(--border))] rounded-xl p-3 shadow-sm">
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">المتبقي في السوق</p>
                    <p className="text-xl font-bold mt-1">0 ج.م</p>
                  </div>
                </div>
              ) : (
                <div className="text-center py-4 text-sm text-[hsl(var(--muted-foreground))]">
                  ليس لديك صلاحية لعرض الإحصائيات المالية
                </div>
              )}
            </div>
          )}
        </div>

        {selectedRows.size > 0 && canManage && (
          <div className="bg-[hsl(var(--primary))] text-white px-4 py-3 flex items-center justify-between">
            <span className="text-sm font-semibold">تم تحديد {selectedRows.size} أوردر</span>
            <div className="flex gap-2">
              <button className="bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg text-xs">تحديث الحالة</button>
              <button className="bg-red-500/80 hover:bg-red-600 px-3 py-1.5 rounded-lg text-xs">حذف المحدد</button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px]">
            <thead>
              <tr className="border-b border-[hsl(var(--border))]">
                <th className="p-4 text-right text-xs font-bold text-[hsl(var(--muted-foreground))]">رقم الأوردر</th>
                <th className="p-4 text-right text-xs font-bold text-[hsl(var(--muted-foreground))]">العميل</th>
                <th className="p-4 text-right text-xs font-bold text-[hsl(var(--muted-foreground))]">الحالة</th>
                <th className="p-4 text-right text-xs font-bold text-[hsl(var(--muted-foreground))]">المندوب</th>
                <th className="p-4 text-right text-xs font-bold text-[hsl(var(--muted-foreground))]">الإجمالي</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="5" className="p-8 text-center">جاري التحميل...</td></tr>
              ) : allOrders.length === 0 ? (
                <tr><td colSpan="5" className="p-8 text-center">لا توجد أوردرات</td></tr>
              ) : (
                allOrders.map(order => (
                  <tr key={order.id} className="border-b border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/20">
                    <td className="p-4 text-sm font-mono">{order.order_num || order.id.slice(0,8)}</td>
                    <td className="p-4 text-sm">{order.customer_name}</td>
                    <td className="p-4">
                      <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700">
                        {order.status}
                      </span>
                    </td>
                    <td className="p-4 text-sm">{order.delegate_name || "—"}</td>
                    <td className="p-4 text-sm font-bold">{order.total_amount} ج.م</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
