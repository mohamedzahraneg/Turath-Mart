'use client';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Eye, MoreHorizontal, ChevronLeft } from 'lucide-react';

interface RecentOrder {
  id: string;
  orderNum: string;
  customer: string;
  phone: string;
  region: string;
  products: string;
  total: number;
  status: string;
  time: string;
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

import { createClient } from '@/lib/supabase/client';

export default function RecentOrdersTable() {
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRecentOrders = async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from('zahranship_orders')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(10);

        if (!error && data) {
          const mapped = data.map((o: any) => ({
            id: o.id,
            orderNum: o.order_num,
            customer: o.customer,
            phone: o.phone,
            region: o.region,
            products: o.products,
            total: o.total,
            status: o.status,
            time: o.time || o.created_at?.split('T')[1].substring(0, 5) || '',
          }));
          setRecentOrders(mapped);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchRecentOrders();
  }, []);

  return (
    <div className="card-section overflow-hidden">
      <div className="flex items-center justify-between p-5 border-b border-[hsl(var(--border))]">
        <div>
          <h3 className="text-base font-bold text-[hsl(var(--foreground))]">آخر الأوردرات</h3>
        </div>
        <Link href="/orders-management" className="btn-secondary text-xs">
          <span>عرض الكل</span>
          <ChevronLeft size={14} />
        </Link>
      </div>
      <div className="overflow-x-auto scrollbar-thin">
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
            {recentOrders.map((order) => {
              const status = STATUS_MAP[order.status] || STATUS_MAP['new'];
              return (
                <tr
                  key={order.id}
                  className={`transition-colors duration-150 ${hoveredRow === order.id ? 'bg-[hsl(var(--muted))]' : 'bg-white'}`}
                  onMouseEnter={() => setHoveredRow(order.id)}
                  onMouseLeave={() => setHoveredRow(null)}
                >
                  <td className="table-cell">
                    <span className="font-mono text-xs font-semibold text-[hsl(var(--primary))]">
                      {order.orderNum}
                    </span>
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
                    <span className="text-sm text-[hsl(var(--muted-foreground))] truncate max-w-[150px] block">
                      {order.products}
                    </span>
                  </td>
                  <td className="table-cell">
                    <span className="font-semibold font-mono text-sm">
                      {order.total.toLocaleString('en-US')} ج.م
                    </span>
                  </td>
                  <td className="table-cell">
                    <span className={`badge ${status.class}`}>{status.label}</span>
                  </td>
                  <td className="table-cell">
                    <span className="text-sm text-[hsl(var(--muted-foreground))]">
                      {order.time}
                    </span>
                  </td>
                  <td className="table-cell">
                    <div
                      className={`flex items-center gap-1 transition-opacity duration-150 ${hoveredRow === order.id ? 'opacity-100' : 'opacity-0'}`}
                    >
                      <Link href="/orders-management" title="عرض التفاصيل">
                        <button className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-blue-50 text-blue-600 transition-colors">
                          <Eye size={14} />
                        </button>
                      </Link>
                      <button
                        className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] transition-colors"
                        title="المزيد"
                      >
                        <MoreHorizontal size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {recentOrders.length === 0 && !loading && (
              <tr>
                <td
                  colSpan={8}
                  className="text-center py-6 text-sm text-[hsl(var(--muted-foreground))] font-semibold"
                >
                  لا يوجد أوردرات حتى الآن
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
