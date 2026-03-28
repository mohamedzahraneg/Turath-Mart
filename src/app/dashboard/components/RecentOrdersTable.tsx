'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Eye, MoreHorizontal, ChevronLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

interface RecentOrder {
  id: string;
  order_num: string;
  customer: string;
  phone: string;
  region: string;
  products: string;
  total: number;
  status: string;
  time: string;
  date?: string;
}

const STATUS_MAP: Record<string, { label: string; class: string }> = {
  new: { label: 'جديد', class: 'status-new' },
  preparing: { label: 'جاري التجهيز', class: 'status-preparing' },
  warehouse: { label: 'في المستودع', class: 'status-warehouse' },
  shipping: { label: 'جاري الشحن', class: 'status-shipping' },
  delivered: { label: 'تم التسليم', class: 'status-delivered' },
  cancelled: { label: 'ملغي', class: 'status-cancelled' },
  returned: { label: 'مرتجع', class: 'status-returned' },
};

export default function RecentOrdersTable() {
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [orders, setOrders] = useState<RecentOrder[]>([]);
  const [totalToday, setTotalToday] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchOrders = useCallback(async () => {
    try {
      const supabase = createClient();
      // Use created_at for today's count — date column stores DD/MM/YYYY which won't match ISO format
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      const { data, error } = await supabase
        .from('zahranship_orders')
        .select('id, order_num, customer, phone, region, products, total, status, time, date, created_at')
        .order('created_at', { ascending: false })
        .limit(10);

      if (!error && data) {
        setOrders(data as RecentOrder[]);
        // Count today's orders using created_at
        const todayCount = data.filter((o: RecentOrder & { created_at?: string }) => {
          if (!o.created_at) return false;
          const d = new Date(o.created_at);
          return d >= todayStart && d <= todayEnd;
        }).length;
        setTotalToday(todayCount);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrders();

    // Realtime subscription
    const supabase = createClient();
    const channel = supabase
      .channel('recent-orders-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'zahranship_orders' }, () => {
        fetchOrders();
      })
      .subscribe();

    // Listen for manual events from other components
    const handler = () => fetchOrders();
    window.addEventListener('zahranship_order_updated', handler);
    window.addEventListener('zahranship_order_added', handler);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener('zahranship_order_updated', handler);
      window.removeEventListener('zahranship_order_added', handler);
    };
  }, [fetchOrders]);

  return (
    <div className="card-section overflow-hidden">
      <div className="flex items-center justify-between p-5 border-b border-[hsl(var(--border))]">
        <div>
          <h3 className="text-base font-bold text-[hsl(var(--foreground))]">آخر الأوردرات</h3>
          <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
            {totalToday} أوردر اليوم
            <span className="mr-2 inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
              <span className="text-[10px]">مباشر</span>
            </span>
          </p>
        </div>
        <Link href="/orders-management" className="btn-secondary text-xs">
          <span>عرض الكل</span>
          <ChevronLeft size={14} />
        </Link>
      </div>
      <div className="overflow-x-auto scrollbar-thin">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-[hsl(var(--muted-foreground))] text-sm">
            جاري التحميل...
          </div>
        ) : orders.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-[hsl(var(--muted-foreground))] text-sm">
            لا توجد أوردرات بعد
          </div>
        ) : (
          <table className="w-full min-w-[700px]">
            <thead>
              <tr>
                <th className="table-header text-right rounded-tr-none">رقم الأوردر</th>
                <th className="table-header text-right">العميل</th>
                <th className="table-header text-right">المنطقة</th>
                <th className="table-header text-right">المنتجات</th>
                <th className="table-header text-right">الإجمالي</th>
                <th className="table-header text-right">الحالة</th>
                <th className="table-header text-right">الوقت</th>
                <th className="table-header text-right">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[hsl(var(--border))]">
              {orders.map((order) => {
                const status = STATUS_MAP[order.status] || STATUS_MAP['new'];
                return (
                  <tr
                    key={order.id}
                    className={`transition-colors duration-150 ${hoveredRow === order.id ? 'bg-[hsl(var(--muted))]' : 'bg-white'}`}
                    onMouseEnter={() => setHoveredRow(order.id)}
                    onMouseLeave={() => setHoveredRow(null)}
                  >
                    <td className="table-cell">
                      <span className="font-mono text-xs font-semibold text-[hsl(var(--primary))]">{order.order_num}</span>
                    </td>
                    <td className="table-cell">
                      <div>
                        <p className="font-medium text-sm">{order.customer}</p>
                        <p className="text-xs text-[hsl(var(--muted-foreground))]">{order.phone}</p>
                      </div>
                    </td>
                    <td className="table-cell">
                      <span className="text-sm">{order.region}</span>
                    </td>
                    <td className="table-cell">
                      <span className="text-sm text-[hsl(var(--muted-foreground))] truncate max-w-[150px] block">{order.products}</span>
                    </td>
                    <td className="table-cell">
                      <span className="font-semibold font-mono text-sm">{Number(order.total).toLocaleString('ar-EG')} ج.م</span>
                    </td>
                    <td className="table-cell">
                      <span className={`badge ${status.class}`}>{status.label}</span>
                    </td>
                    <td className="table-cell">
                      <span className="text-sm text-[hsl(var(--muted-foreground))]">{order.time}</span>
                    </td>
                    <td className="table-cell">
                      <div className={`flex items-center gap-1 transition-opacity duration-150 ${hoveredRow === order.id ? 'opacity-100' : 'opacity-0'}`}>
                        <Link href="/orders-management" title="عرض التفاصيل">
                          <button className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-blue-50 text-blue-600 transition-colors">
                            <Eye size={14} />
                          </button>
                        </Link>
                        <button className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] transition-colors" title="المزيد">
                          <MoreHorizontal size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}