'use client';
import React, { useState, useMemo } from 'react';
import AppLayout from '@/components/AppLayout';
import {
  Truck,
  Search,
  ChevronDown,
  ChevronUp,
  Eye,
  Edit2,
  MapPin,
  Phone,
  Package,
  DollarSign,
  User,
  CheckCircle,
  Clock,
  XCircle,
  RotateCcw,
  Warehouse,
  Star,
} from 'lucide-react';
import OrderDetailModal from '../orders-management/components/OrderDetailModal';
import StatusUpdateModal from '../orders-management/components/StatusUpdateModal';

interface Order {
  id: string;
  orderNum: string;
  createdBy: string;
  createdByIp?: string;
  createdByLocation?: string;
  createdByDevice?: string;
  customer: string;
  phone: string;
  phone2?: string;
  region: string;
  district?: string;
  address: string;
  products: string;
  quantity: number;
  subtotal: number;
  shippingFee: number;
  extraShippingFee?: number;
  expressShipping?: boolean;
  total: number;
  status: string;
  date: string;
  time: string;
  day: string;
  notes?: string;
  ip: string;
  delegateName?: string;
}

const STATUS_MAP: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  new: { label: 'جديد', cls: 'status-new', icon: <Clock size={12} /> },
  preparing: { label: 'جاري التجهيز', cls: 'status-preparing', icon: <Package size={12} /> },
  warehouse: { label: 'في المستودع', cls: 'status-warehouse', icon: <Warehouse size={12} /> },
  shipping: { label: 'جاري الشحن', cls: 'status-shipping', icon: <Truck size={12} /> },
  delivered: { label: 'تم التسليم', cls: 'status-delivered', icon: <CheckCircle size={12} /> },
  cancelled: { label: 'ملغي', cls: 'status-cancelled', icon: <XCircle size={12} /> },
  returned: { label: 'مرتجع', cls: 'status-returned', icon: <RotateCcw size={12} /> },
};

import { createClient } from '@/lib/supabase/client';

// dynamic delegates will be computed from db orders
type Delegate = {
  name: string;
  phone: string;
  rating: number;
  totalDelivered: number;
  activeOrders: number;
};

type SortField = 'orderNum' | 'customer' | 'region' | 'total' | 'status' | 'date';
type SortDir = 'asc' | 'desc';

export default function ShippingPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('الكل');
  const [delegateFilter, setDelegateFilter] = useState('الكل');
  const [sortField, setSortField] = useState<SortField>('orderNum');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [statusModal, setStatusModal] = useState<{ order: Order } | null>(null);
  const [detailModal, setDetailModal] = useState<{ order: Order } | null>(null);

  const [dbOrders, setDbOrders] = useState<Order[]>([]);
  const [delegates, setDelegates] = useState<Delegate[]>([]);
  const [loading, setLoading] = useState(true);

  React.useEffect(() => {
    fetchOrders();
  }, []);

  const fetchOrders = async () => {
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('turath_masr_orders')
        .select('*')
        .order('created_at', { ascending: false });

      if (!error && data) {
        const mapped: Order[] = data.map((o: any) => ({
          id: o.id,
          orderNum: o.order_num,
          createdBy: o.created_by || 'غير معروف',
          customer: o.customer,
          phone: o.phone,
          phone2: o.phone2,
          region: o.region,
          district: o.district,
          address: o.address,
          products: o.products,
          quantity: 1, // simplified
          subtotal: o.total - (o.shipping_fee || 50),
          shippingFee: o.shipping_fee || 50,
          total: o.total,
          status: o.status,
          date: o.date || o.created_at?.split('T')[0] || '',
          time: o.time || o.created_at?.split('T')[1].substring(0, 5) || '',
          day: '',
          notes: o.notes,
          ip: '',
          delegateName: o.delegate_name || '',
        }));
        setDbOrders(mapped);

        // compute delegates
        const delMap = new Map<string, Delegate>();
        mapped.forEach((o) => {
          if (!o.delegateName) return;
          if (!delMap.has(o.delegateName)) {
            delMap.set(o.delegateName, {
              name: o.delegateName,
              phone: '',
              rating: 5.0,
              totalDelivered: 0,
              activeOrders: 0,
            });
          }
          const d = delMap.get(o.delegateName)!;
          if (o.status === 'delivered') d.totalDelivered++;
          if (o.status === 'shipping' || o.status === 'preparing') d.activeOrders++;
        });
        setDelegates(Array.from(delMap.values()));
      }
    } catch (err) {
    } finally {
      setLoading(false);
    }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ChevronDown size={12} className="opacity-30" />;
    return sortDir === 'asc' ? (
      <ChevronUp size={12} className="text-[hsl(var(--primary))]" />
    ) : (
      <ChevronDown size={12} className="text-[hsl(var(--primary))]" />
    );
  };

  const filtered = useMemo(() => {
    return dbOrders
      .filter((o) => {
        const matchSearch =
          !search ||
          o.customer.includes(search) ||
          o.orderNum.includes(search) ||
          o.phone.includes(search);
        const matchStatus = statusFilter === 'الكل' || o.status === statusFilter;
        const matchDelegate = delegateFilter === 'الكل' || o.delegateName === delegateFilter;
        return matchSearch && matchStatus && matchDelegate;
      })
      .sort((a, b) => {
        let cmp = 0;
        if (sortField === 'orderNum') cmp = a.orderNum.localeCompare(b.orderNum);
        else if (sortField === 'customer') cmp = a.customer.localeCompare(b.customer);
        else if (sortField === 'region') cmp = a.region.localeCompare(b.region);
        else if (sortField === 'total') cmp = a.total - b.total;
        else if (sortField === 'status') cmp = a.status.localeCompare(b.status);
        return sortDir === 'asc' ? cmp : -cmp;
      });
  }, [search, statusFilter, delegateFilter, sortField, sortDir, dbOrders]);

  const shippingOrders = dbOrders.filter((o) => o.status === 'shipping');
  const deliveredOrders = dbOrders.filter((o) => o.status === 'delivered');
  const totalShippingFees = dbOrders.reduce((s, o) => s + o.shippingFee, 0);

  const statusOptions = ['الكل', ...Object.keys(STATUS_MAP)];
  const delegateOptions = ['الكل', ...delegates.map((d) => d.name)];

  return (
    <AppLayout currentPath="/shipping">
      <div className="space-y-6 fade-in" dir="rtl">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">إدارة الشحن</h1>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
              متابعة الأوردرات وتفاصيل الشحن والمناديب
            </p>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {[
            {
              label: 'جاري الشحن',
              value: shippingOrders.length,
              icon: <Truck size={20} />,
              color: 'blue',
            },
            {
              label: 'تم التسليم',
              value: deliveredOrders.length,
              icon: <CheckCircle size={20} />,
              color: 'green',
            },
            {
              label: 'إجمالي رسوم الشحن',
              value: `${totalShippingFees.toLocaleString('en-US')} ج.م`,
              icon: <DollarSign size={20} />,
              color: 'amber',
            },
            {
              label: 'المناديب النشطون',
              value: delegates.length,
              icon: <User size={20} />,
              color: 'purple',
            },
          ].map((card, i) => (
            <div key={i} className="kpi-card">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${
                  card.color === 'blue'
                    ? 'bg-blue-50 text-blue-600'
                    : card.color === 'green'
                      ? 'bg-green-50 text-green-600'
                      : card.color === 'amber'
                        ? 'bg-amber-50 text-amber-600'
                        : 'bg-purple-50 text-purple-600'
                }`}
              >
                {card.icon}
              </div>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mb-1">{card.label}</p>
              <p className="text-xl font-bold text-[hsl(var(--foreground))] font-mono">
                {card.value}
              </p>
            </div>
          ))}
        </div>

        {/* Delegates Section */}
        <div className="card-section p-5">
          <h2 className="text-base font-bold mb-4 flex items-center gap-2">
            <User size={18} className="text-[hsl(var(--primary))]" />
            المناديب النشطون
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {delegates.map((delegate) => {
              const delegateOrders = dbOrders.filter((o) => o.delegateName === delegate.name);
              const activeCount = delegateOrders.filter((o) => o.status === 'shipping').length;
              const deliveredCount = delegateOrders.filter((o) => o.status === 'delivered').length;
              const totalValue = delegateOrders
                .filter((o) => ['shipping', 'delivered'].includes(o.status))
                .reduce((s, o) => s + o.total, 0);
              return (
                <div
                  key={delegate.name}
                  className="border border-[hsl(var(--border))] rounded-xl p-4"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-[hsl(var(--primary))]/10 flex items-center justify-center text-[hsl(var(--primary))] font-bold">
                        {delegate.name.charAt(0)}
                      </div>
                      <div>
                        <p className="font-bold text-sm">{delegate.name}</p>
                        <p className="text-xs text-[hsl(var(--muted-foreground))]" dir="ltr">
                          {delegate.phone}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 text-amber-500">
                      <Star size={14} fill="currentColor" />
                      <span className="text-sm font-bold">{delegate.rating}</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-blue-50 rounded-lg p-2">
                      <p className="text-lg font-bold text-blue-700">{activeCount}</p>
                      <p className="text-[10px] text-blue-600">جاري الشحن</p>
                    </div>
                    <div className="bg-green-50 rounded-lg p-2">
                      <p className="text-lg font-bold text-green-700">{deliveredCount}</p>
                      <p className="text-[10px] text-green-600">تم التسليم</p>
                    </div>
                    <div className="bg-amber-50 rounded-lg p-2">
                      <p className="text-sm font-bold text-amber-700">
                        {totalValue.toLocaleString('en-US')}
                      </p>
                      <p className="text-[10px] text-amber-600">ج.م</p>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <a
                      href={`tel:${delegate.phone}`}
                      className="flex-1 flex items-center justify-center gap-1.5 text-xs py-2 rounded-xl border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] transition-colors"
                    >
                      <Phone size={13} />
                      اتصال
                    </a>
                    <a
                      href={`https://wa.me/2${delegate.phone}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 flex items-center justify-center gap-1.5 text-xs py-2 rounded-xl bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 transition-colors"
                    >
                      واتساب
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Orders Table with Shipping Details */}
        <div className="card-section overflow-hidden">
          <div className="p-4 border-b border-[hsl(var(--border))]">
            <h2 className="text-base font-bold mb-3 flex items-center gap-2">
              <Package size={18} className="text-[hsl(var(--primary))]" />
              الأوردرات وتفاصيل الشحن
            </h2>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search
                  size={16}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]"
                />
                <input
                  type="text"
                  placeholder="بحث بالاسم أو رقم الأوردر..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pr-9 pl-4 py-2.5 border border-[hsl(var(--border))] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
              >
                {statusOptions.map((s) => (
                  <option key={s} value={s}>
                    {s === 'الكل' ? 'كل الحالات' : STATUS_MAP[s]?.label || s}
                  </option>
                ))}
              </select>
              <select
                value={delegateFilter}
                onChange={(e) => setDelegateFilter(e.target.value)}
                className="border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
              >
                {delegateOptions.map((d) => (
                  <option key={d} value={d}>
                    {d === 'الكل' ? 'كل المناديب' : d}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[hsl(var(--muted))]/50 text-[hsl(var(--muted-foreground))] text-xs">
                  <th
                    className="text-right px-4 py-3 font-semibold cursor-pointer"
                    onClick={() => handleSort('orderNum')}
                  >
                    <span className="flex items-center gap-1">
                      رقم الأوردر <SortIcon field="orderNum" />
                    </span>
                  </th>
                  <th
                    className="text-right px-4 py-3 font-semibold cursor-pointer"
                    onClick={() => handleSort('customer')}
                  >
                    <span className="flex items-center gap-1">
                      العميل <SortIcon field="customer" />
                    </span>
                  </th>
                  <th className="text-right px-4 py-3 font-semibold">العنوان</th>
                  <th className="text-right px-4 py-3 font-semibold">المنتجات</th>
                  <th
                    className="text-right px-4 py-3 font-semibold cursor-pointer"
                    onClick={() => handleSort('total')}
                  >
                    <span className="flex items-center gap-1">
                      الإجمالي <SortIcon field="total" />
                    </span>
                  </th>
                  <th className="text-right px-4 py-3 font-semibold">رسوم الشحن</th>
                  <th className="text-right px-4 py-3 font-semibold">المندوب</th>
                  <th
                    className="text-right px-4 py-3 font-semibold cursor-pointer"
                    onClick={() => handleSort('status')}
                  >
                    <span className="flex items-center gap-1">
                      الحالة <SortIcon field="status" />
                    </span>
                  </th>
                  <th className="text-right px-4 py-3 font-semibold">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((order) => {
                  const statusInfo = STATUS_MAP[order.status];
                  return (
                    <tr
                      key={order.id}
                      className="border-t border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/30 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-mono text-xs font-bold text-[hsl(var(--primary))]">
                            {order.orderNum}
                          </p>
                          <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
                            {order.date}
                          </p>
                          {order.expressShipping && (
                            <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-semibold">
                              سريع
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-xs">{order.customer}</p>
                        <p
                          className="text-[10px] text-[hsl(var(--muted-foreground))] font-mono"
                          dir="ltr"
                        >
                          {order.phone}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-start gap-1">
                          <MapPin
                            size={11}
                            className="text-[hsl(var(--muted-foreground))] mt-0.5 flex-shrink-0"
                          />
                          <div>
                            <p className="text-xs font-semibold">
                              {order.region}
                              {order.district ? ` — ${order.district}` : ''}
                            </p>
                            <p className="text-[10px] text-[hsl(var(--muted-foreground))] line-clamp-1">
                              {order.address}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-xs line-clamp-2">{order.products}</p>
                        <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
                          الكمية: {order.quantity}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-mono font-bold text-sm text-[hsl(var(--primary))]">
                          {order.total.toLocaleString('en-US')} ج.م
                        </p>
                        <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
                          منتجات: {order.subtotal.toLocaleString('en-US')}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-xs">
                          <p className="font-mono font-semibold text-blue-700">
                            {order.shippingFee} ج.م
                          </p>
                          {order.extraShippingFee ? (
                            <p className="text-orange-600">+ {order.extraShippingFee} إضافي</p>
                          ) : null}
                          {order.expressShipping && (
                            <p className="text-amber-600 text-[10px]">شحن سريع</p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {order.delegateName ? (
                          <div className="flex items-center gap-1.5">
                            <div className="w-6 h-6 rounded-full bg-[hsl(var(--primary))]/10 flex items-center justify-center text-[hsl(var(--primary))] text-[10px] font-bold flex-shrink-0">
                              {order.delegateName.charAt(0)}
                            </div>
                            <span className="text-xs font-semibold">{order.delegateName}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-[hsl(var(--muted-foreground))]">
                            غير محدد
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`badge ${statusInfo?.cls || ''} flex items-center gap-1 w-fit`}
                        >
                          {statusInfo?.icon}
                          {statusInfo?.label || order.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button
                            onClick={() => setDetailModal({ order })}
                            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))] transition-colors"
                            title="عرض التفاصيل"
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            onClick={() => setStatusModal({ order })}
                            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-blue-50 text-blue-600 transition-colors"
                            title="تحديث الحالة"
                          >
                            <Edit2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-4 py-8 text-center text-[hsl(var(--muted-foreground))] text-sm"
                    >
                      لا توجد أوردرات تطابق البحث
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="p-4 border-t border-[hsl(var(--border))] flex items-center justify-between">
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              عرض {filtered.length} من {dbOrders.length} أوردر
            </p>
          </div>
        </div>
      </div>

      {statusModal && (
        <StatusUpdateModal
          order={statusModal.order}
          onClose={() => setStatusModal(null)}
          onUpdate={() => {
            fetchOrders();
            setStatusModal(null);
          }}
        />
      )}
      {detailModal && (
        <OrderDetailModal order={detailModal.order} onClose={() => setDetailModal(null)} />
      )}
    </AppLayout>
  );
}
