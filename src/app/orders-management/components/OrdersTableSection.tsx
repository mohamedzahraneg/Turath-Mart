'use client';
import React, { useState, useMemo } from 'react';
import {
  Search, ChevronDown, ChevronUp, Eye, Edit2, Trash2,
  FileText, ChevronRight, ChevronLeft, MoreHorizontal,
  CheckSquare
} from 'lucide-react';
import StatusUpdateModal from './StatusUpdateModal';
import OrderDetailModal from './OrderDetailModal';

interface Order {
  id: string;
  orderNum: string;
  createdBy: string;
  customer: string;
  phone: string;
  phone2?: string;
  region: string;
  address: string;
  products: string;
  quantity: number;
  subtotal: number;
  shippingFee: number;
  total: number;
  status: string;
  date: string;
  time: string;
  day: string;
  notes?: string;
  ip: string;
}

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  new: { label: 'جديد', cls: 'status-new' },
  preparing: { label: 'جاري التجهيز', cls: 'status-preparing' },
  warehouse: { label: 'في المستودع', cls: 'status-warehouse' },
  shipping: { label: 'جاري الشحن', cls: 'status-shipping' },
  delivered: { label: 'تم التسليم', cls: 'status-delivered' },
  cancelled: { label: 'ملغي', cls: 'status-cancelled' },
  returned: { label: 'مرتجع', cls: 'status-returned' },
};

const REGIONS = ['الكل', 'القاهرة', 'الجيزة', 'القليوبية'];

const MOCK_ORDERS: Order[] = [
  { id: 'order-001', orderNum: 'ZSH-2026-0047', createdBy: 'محمد حسن', customer: 'أحمد محمود السيد', phone: '01012345678', phone2: '01198765432', region: 'القاهرة', address: 'مدينة نصر، شارع عباس العقاد، عمارة ٥ شقة ١٢', products: 'حامل مصحف بني × ٢', quantity: 2, subtotal: 600, shippingFee: 50, total: 650, status: 'shipping', date: '٢٧/٠٣/٢٠٢٦', time: '٠٩:٣٢', day: 'الجمعة', notes: 'العميل يريد التسليم في الصباح', ip: '197.32.45.112' },
  { id: 'order-002', orderNum: 'ZSH-2026-0046', createdBy: 'سارة أحمد', customer: 'فاطمة علي حسن', phone: '01123456789', region: 'الجيزة', address: 'الدقي، شارع التحرير، برج المنار ط٣', products: 'كعبة × ١ + مصحف × ٢', quantity: 3, subtotal: 840, shippingFee: 50, total: 890, status: 'delivered', date: '٢٧/٠٣/٢٠٢٦', time: '٠٩:١٥', day: 'الجمعة', ip: '197.32.45.113' },
  { id: 'order-003', orderNum: 'ZSH-2026-0045', createdBy: 'محمد حسن', customer: 'محمد عبد الرحمن', phone: '01234567890', region: 'القليوبية', address: 'شبرا الخيمة، شارع النيل، مبنى رقم ١٤', products: 'حامل مصحف ذهبي × ١', quantity: 1, subtotal: 330, shippingFee: 50, total: 380, status: 'new', date: '٢٧/٠٣/٢٠٢٦', time: '٠٨:٥٥', day: 'الجمعة', ip: '197.32.45.114' },
  { id: 'order-004', orderNum: 'ZSH-2026-0044', createdBy: 'أميرة محمود', customer: 'سارة إبراهيم خليل', phone: '01056789012', region: 'القاهرة', address: 'المعادي، شارع ٩، فيلا ٢٣', products: 'كشاف × ٣', quantity: 3, subtotal: 400, shippingFee: 50, total: 450, status: 'preparing', date: '٢٧/٠٣/٢٠٢٦', time: '٠٨:٤٠', day: 'الجمعة', ip: '197.32.45.115' },
  { id: 'order-005', orderNum: 'ZSH-2026-0043', createdBy: 'سارة أحمد', customer: 'عمر حامد الشريف', phone: '01198765432', region: 'الجيزة', address: 'فيصل، شارع البحر الأعظم، عمارة ٧', products: 'حامل مصحف أسود × ١ + كشاف × ١', quantity: 2, subtotal: 470, shippingFee: 50, total: 520, status: 'warehouse', date: '٢٦/٠٣/٢٠٢٦', time: '١٦:٢٠', day: 'الخميس', ip: '197.32.45.116' },
  { id: 'order-006', orderNum: 'ZSH-2026-0042', createdBy: 'محمد حسن', customer: 'نور الدين مصطفى', phone: '01067891234', region: 'القاهرة', address: 'هليوبوليس، شارع النزهة، شقة ٤٥', products: 'كرسي × ٢', quantity: 2, subtotal: 1150, shippingFee: 50, total: 1200, status: 'returned', date: '٢٦/٠٣/٢٠٢٦', time: '١٥:٥٠', day: 'الخميس', notes: 'العميل رفض الاستلام — المنتج مختلف عن الوصف', ip: '197.32.45.117' },
  { id: 'order-007', orderNum: 'ZSH-2026-0041', createdBy: 'أميرة محمود', customer: 'هدى رمضان أحمد', phone: '01145678901', region: 'القليوبية', address: 'قليوب، شارع السكة الحديد، عمارة ٢', products: 'مصحف × ٥', quantity: 5, subtotal: 700, shippingFee: 50, total: 750, status: 'cancelled', date: '٢٦/٠٣/٢٠٢٦', time: '١٤:٣٠', day: 'الخميس', notes: 'إلغاء بطلب العميل', ip: '197.32.45.118' },
  { id: 'order-008', orderNum: 'ZSH-2026-0040', createdBy: 'سارة أحمد', customer: 'خالد عبد العزيز', phone: '01012223344', region: 'القاهرة', address: 'مصر الجديدة، شارع الثورة، عمارة ١٠', products: 'حامل مصحف أبيض × ٢ + مصحف × ١', quantity: 3, subtotal: 760, shippingFee: 50, total: 810, status: 'delivered', date: '٢٥/٠٣/٢٠٢٦', time: '١١:٢٠', day: 'الأربعاء', ip: '197.32.45.119' },
  { id: 'order-009', orderNum: 'ZSH-2026-0039', createdBy: 'محمد حسن', customer: 'ريم حسام الدين', phone: '01534567890', region: 'الجيزة', address: 'إمبابة، شارع طه حسين، رقم ٣٣', products: 'كعبة × ١', quantity: 1, subtotal: 450, shippingFee: 50, total: 500, status: 'shipping', date: '٢٥/٠٣/٢٠٢٦', time: '١٠:٠٥', day: 'الأربعاء', ip: '197.32.45.120' },
  { id: 'order-010', orderNum: 'ZSH-2026-0038', createdBy: 'أميرة محمود', customer: 'طارق سعيد منصور', phone: '01267891234', region: 'القليوبية', address: 'خانكة، شارع المحطة، مبنى ٥', products: 'حامل مصحف صدف × ١ + كشاف × ١', quantity: 2, subtotal: 560, shippingFee: 50, total: 610, status: 'preparing', date: '٢٥/٠٣/٢٠٢٦', time: '٠٩:٤٥', day: 'الأربعاء', ip: '197.32.45.121' },
];

type SortField = 'orderNum' | 'customer' | 'region' | 'total' | 'status' | 'date';
type SortDir = 'asc' | 'desc';

export default function OrdersTableSection() {
  const [search, setSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState('الكل');
  const [statusFilter, setStatusFilter] = useState('الكل');
  const [sortField, setSortField] = useState<SortField>('orderNum');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(8);
  const [statusModal, setStatusModal] = useState<{ order: Order } | null>(null);
  const [detailModal, setDetailModal] = useState<{ order: Order } | null>(null);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const filtered = useMemo(() => {
    return MOCK_ORDERS.filter((o) => {
      const matchSearch = !search || o.customer.includes(search) || o.orderNum.includes(search) || o.phone.includes(search);
      const matchRegion = regionFilter === 'الكل' || o.region === regionFilter;
      const matchStatus = statusFilter === 'الكل' || o.status === statusFilter;
      return matchSearch && matchRegion && matchStatus;
    }).sort((a, b) => {
      let cmp = 0;
      if (sortField === 'orderNum') cmp = a.orderNum.localeCompare(b.orderNum);
      else if (sortField === 'customer') cmp = a.customer.localeCompare(b.customer);
      else if (sortField === 'region') cmp = a.region.localeCompare(b.region);
      else if (sortField === 'total') cmp = a.total - b.total;
      else if (sortField === 'status') cmp = a.status.localeCompare(b.status);
      else if (sortField === 'date') cmp = a.date.localeCompare(b.date);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [search, regionFilter, statusFilter, sortField, sortDir]);

  const totalPages = Math.ceil(filtered.length / perPage);
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  const toggleRow = (id: string) => {
    const s = new Set(selectedRows);
    if (s.has(id)) s.delete(id); else s.add(id);
    setSelectedRows(s);
  };

  const toggleAll = () => {
    if (selectedRows.size === paginated.length) setSelectedRows(new Set());
    else setSelectedRows(new Set(paginated.map((o) => o.id)));
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ChevronDown size={12} className="opacity-30" />;
    return sortDir === 'asc' ? <ChevronUp size={12} className="text-[hsl(var(--primary))]" /> : <ChevronDown size={12} className="text-[hsl(var(--primary))]" />;
  };

  const statusOptions = ['الكل', ...Object.keys(STATUS_MAP)];

  return (
    <>
      <div className="card-section overflow-hidden">
        {/* Filters */}
        <div className="p-4 border-b border-[hsl(var(--border))] flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
            <input
              type="text"
              className="input-field pr-9"
              placeholder="بحث بالاسم، رقم الأوردر، أو الموبايل..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <select
              className="input-field w-auto text-sm"
              value={regionFilter}
              onChange={(e) => { setRegionFilter(e.target.value); setPage(1); }}
            >
              {REGIONS.map((r) => <option key={`region-filter-${r}`} value={r}>{r}</option>)}
            </select>
            <select
              className="input-field w-auto text-sm"
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            >
              {statusOptions.map((s) => (
                <option key={`status-filter-${s}`} value={s}>
                  {s === 'الكل' ? 'كل الحالات' : STATUS_MAP[s]?.label || s}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Bulk action bar */}
        {selectedRows.size > 0 && (
          <div className="bg-[hsl(var(--primary))] text-white px-4 py-3 flex items-center justify-between slide-up">
            <span className="text-sm font-semibold">تم تحديد {selectedRows.size} أوردر</span>
            <div className="flex gap-2">
              <button className="bg-white/20 hover:bg-white/30 text-white text-xs px-3 py-1.5 rounded-lg transition-colors font-medium">
                تحديث الحالة
              </button>
              <button className="bg-red-500/80 hover:bg-red-600 text-white text-xs px-3 py-1.5 rounded-lg transition-colors font-medium">
                حذف المحدد
              </button>
              <button
                className="bg-white/20 hover:bg-white/30 text-white text-xs px-3 py-1.5 rounded-lg transition-colors font-medium"
                onClick={() => setSelectedRows(new Set())}
              >
                إلغاء التحديد
              </button>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[1000px]">
            <thead>
              <tr className="border-b border-[hsl(var(--border))]">
                <th className="table-header w-10">
                  <input
                    type="checkbox"
                    checked={selectedRows.size === paginated.length && paginated.length > 0}
                    onChange={toggleAll}
                    className="w-4 h-4 rounded"
                    aria-label="تحديد الكل"
                  />
                </th>
                <th className="table-header cursor-pointer hover:bg-[hsl(var(--border))] transition-colors" onClick={() => handleSort('orderNum')}>
                  <div className="flex items-center gap-1">رقم الأوردر <SortIcon field="orderNum" /></div>
                </th>
                <th className="table-header">المسجِّل</th>
                <th className="table-header cursor-pointer hover:bg-[hsl(var(--border))] transition-colors" onClick={() => handleSort('customer')}>
                  <div className="flex items-center gap-1">العميل <SortIcon field="customer" /></div>
                </th>
                <th className="table-header">الموبايل</th>
                <th className="table-header cursor-pointer hover:bg-[hsl(var(--border))] transition-colors" onClick={() => handleSort('region')}>
                  <div className="flex items-center gap-1">المنطقة <SortIcon field="region" /></div>
                </th>
                <th className="table-header">المنتجات</th>
                <th className="table-header cursor-pointer hover:bg-[hsl(var(--border))] transition-colors" onClick={() => handleSort('total')}>
                  <div className="flex items-center gap-1">الإجمالي <SortIcon field="total" /></div>
                </th>
                <th className="table-header cursor-pointer hover:bg-[hsl(var(--border))] transition-colors" onClick={() => handleSort('status')}>
                  <div className="flex items-center gap-1">الحالة <SortIcon field="status" /></div>
                </th>
                <th className="table-header cursor-pointer hover:bg-[hsl(var(--border))] transition-colors" onClick={() => handleSort('date')}>
                  <div className="flex items-center gap-1">التاريخ <SortIcon field="date" /></div>
                </th>
                <th className="table-header">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[hsl(var(--border))]">
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={11} className="text-center py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-14 h-14 bg-[hsl(var(--muted))] rounded-2xl flex items-center justify-center">
                        <CheckSquare size={28} className="text-[hsl(var(--muted-foreground))]" />
                      </div>
                      <p className="text-base font-semibold text-[hsl(var(--foreground))]">لا توجد أوردرات</p>
                      <p className="text-sm text-[hsl(var(--muted-foreground))]">لم يتم العثور على أوردرات بهذه المعايير. جرّب تعديل الفلاتر.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                paginated.map((order) => {
                  const st = STATUS_MAP[order.status] || STATUS_MAP['new'];
                  const isSelected = selectedRows.has(order.id);
                  return (
                    <tr
                      key={order.id}
                      className={`transition-colors duration-150 group ${isSelected ? 'bg-blue-50' : 'hover:bg-[hsl(var(--muted))]/50'}`}
                    >
                      <td className="table-cell w-10">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRow(order.id)}
                          className="w-4 h-4 rounded"
                          aria-label={`تحديد أوردر ${order.orderNum}`}
                        />
                      </td>
                      <td className="table-cell">
                        <span className="font-mono text-xs font-bold text-[hsl(var(--primary))]">{order.orderNum}</span>
                      </td>
                      <td className="table-cell">
                        <div>
                          <p className="text-xs font-medium">{order.createdBy}</p>
                          <p className="text-[10px] text-[hsl(var(--muted-foreground))] font-mono">{order.ip}</p>
                        </div>
                      </td>
                      <td className="table-cell">
                        <div>
                          <p className="font-semibold text-sm">{order.customer}</p>
                          {order.notes && (
                            <p className="text-[10px] text-amber-600 truncate max-w-[140px]" title={order.notes}>
                              ملاحظة: {order.notes}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="table-cell">
                        <div>
                          <p className="text-sm font-mono">{order.phone}</p>
                          {order.phone2 && <p className="text-xs text-[hsl(var(--muted-foreground))] font-mono">{order.phone2}</p>}
                        </div>
                      </td>
                      <td className="table-cell">
                        <span className="text-sm bg-[hsl(var(--muted))] px-2 py-0.5 rounded-lg text-[hsl(var(--foreground))] font-medium">
                          {order.region}
                        </span>
                      </td>
                      <td className="table-cell max-w-[160px]">
                        <p className="text-sm truncate" title={order.products}>{order.products}</p>
                        <p className="text-xs text-[hsl(var(--muted-foreground))]">{order.quantity} قطعة</p>
                      </td>
                      <td className="table-cell">
                        <div>
                          <p className="font-bold font-mono text-sm">{order.total.toLocaleString('ar-EG')} ج.م</p>
                          <p className="text-[10px] text-[hsl(var(--muted-foreground))]">شحن: {order.shippingFee} ج.م</p>
                        </div>
                      </td>
                      <td className="table-cell">
                        <button
                          className={`badge ${st.cls} cursor-pointer hover:opacity-80 transition-opacity`}
                          onClick={() => setStatusModal({ order })}
                          title="انقر لتغيير الحالة"
                        >
                          {st.label}
                        </button>
                      </td>
                      <td className="table-cell">
                        <div>
                          <p className="text-xs font-medium">{order.date}</p>
                          <p className="text-[10px] text-[hsl(var(--muted-foreground))]">{order.day} — {order.time}</p>
                        </div>
                      </td>
                      <td className="table-cell">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                          <button
                            onClick={() => setDetailModal({ order })}
                            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-blue-50 text-blue-600 transition-colors"
                            title="عرض التفاصيل"
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-amber-50 text-amber-600 transition-colors"
                            title="تعديل الأوردر"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-green-50 text-green-600 transition-colors"
                            title="عرض الفاتورة PDF"
                          >
                            <FileText size={14} />
                          </button>
                          <button
                            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-red-500 transition-colors"
                            title="حذف الأوردر — لا يمكن التراجع"
                          >
                            <Trash2 size={14} />
                          </button>
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
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-4 py-3 border-t border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30">
          <div className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
            <span>عرض</span>
            <select
              className="input-field w-auto text-sm py-1"
              value={perPage}
              onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }}
            >
              {[5, 8, 10, 20, 50].map((n) => (
                <option key={`perpage-${n}`} value={n}>{n}</option>
              ))}
            </select>
            <span>من {filtered.length} أوردر</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              onClick={() => setPage(1)}
              disabled={page === 1}
              aria-label="الصفحة الأولى"
            >
              <ChevronRight size={14} />
            </button>
            <button
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              onClick={() => setPage(page - 1)}
              disabled={page === 1}
              aria-label="الصفحة السابقة"
            >
              <ChevronRight size={14} />
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              const pageNum = i + 1;
              return (
                <button
                  key={`page-btn-${pageNum}`}
                  className={`w-8 h-8 flex items-center justify-center rounded-lg border text-sm font-semibold transition-colors ${page === pageNum ? 'bg-[hsl(var(--primary))] text-white border-[hsl(var(--primary))]' : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]'}`}
                  onClick={() => setPage(pageNum)}
                >
                  {pageNum}
                </button>
              );
            })}
            <button
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              onClick={() => setPage(page + 1)}
              disabled={page === totalPages}
              aria-label="الصفحة التالية"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              onClick={() => setPage(totalPages)}
              disabled={page === totalPages}
              aria-label="الصفحة الأخيرة"
            >
              <ChevronLeft size={14} />
            </button>
          </div>
        </div>
      </div>

      {statusModal && (
        <StatusUpdateModal
          order={statusModal.order}
          onClose={() => setStatusModal(null)}
        />
      )}
      {detailModal && (
        <OrderDetailModal
          order={detailModal.order}
          onClose={() => setDetailModal(null)}
        />
      )}
    </>
  );
}