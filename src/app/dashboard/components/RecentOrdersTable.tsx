'use client';
import React, { useState } from 'react';
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

const recentOrders: RecentOrder[] = [
  { id: 'order-001', orderNum: 'ZSH-2026-0047', customer: 'أحمد محمود السيد', phone: '01012345678', region: 'القاهرة', products: 'حامل مصحف بني × ٢', total: 650, status: 'shipping', time: '٠٩:٣٢' },
  { id: 'order-002', orderNum: 'ZSH-2026-0046', customer: 'فاطمة علي حسن', phone: '01123456789', region: 'الجيزة', products: 'كعبة + مصحف', total: 890, status: 'delivered', time: '٠٩:١٥' },
  { id: 'order-003', orderNum: 'ZSH-2026-0045', customer: 'محمد عبد الرحمن', phone: '01234567890', region: 'القليوبية', products: 'حامل مصحف ذهبي × ١', total: 380, status: 'new', time: '٠٨:٥٥' },
  { id: 'order-004', orderNum: 'ZSH-2026-0044', customer: 'سارة إبراهيم خليل', phone: '01056789012', region: 'القاهرة', products: 'كشاف × ٣', total: 450, status: 'preparing', time: '٠٨:٤٠' },
  { id: 'order-005', orderNum: 'ZSH-2026-0043', customer: 'عمر حامد الشريف', phone: '01198765432', region: 'الجيزة', products: 'حامل مصحف أسود × ١ + كشاف', total: 520, status: 'warehouse', time: '٠٨:٢٠' },
  { id: 'order-006', orderNum: 'ZSH-2026-0042', customer: 'نور الدين مصطفى', phone: '01067891234', region: 'القاهرة', products: 'كرسي × ٢', total: 1200, status: 'returned', time: '٠٧:٥٠' },
  { id: 'order-007', orderNum: 'ZSH-2026-0041', customer: 'هدى رمضان أحمد', phone: '01145678901', region: 'القليوبية', products: 'مصحف × ٥', total: 750, status: 'cancelled', time: '٠٧:٣٠' },
];

export default function RecentOrdersTable() {
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);

  return (
    <div className="card-section overflow-hidden">
      <div className="flex items-center justify-between p-5 border-b border-[hsl(var(--border))]">
        <div>
          <h3 className="text-base font-bold text-[hsl(var(--foreground))]">آخر الأوردرات</h3>
          <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">٤٧ أوردر اليوم</p>
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
                    <span className="font-mono text-xs font-semibold text-[hsl(var(--primary))]">{order.orderNum}</span>
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
                    <span className="font-semibold font-mono text-sm">{order.total.toLocaleString('ar-EG')} ج.م</span>
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
      </div>
    </div>
  );
}