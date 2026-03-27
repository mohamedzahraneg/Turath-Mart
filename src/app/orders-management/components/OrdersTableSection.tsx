'use client';
import React, { useState, useMemo } from 'react';
import { Search, ChevronDown, ChevronUp, Eye, Edit2, Trash2, FileText, ChevronRight, ChevronLeft, CheckSquare } from 'lucide-react';
import StatusUpdateModal from './StatusUpdateModal';
import OrderDetailModal from './OrderDetailModal';

interface Order {
  id: string;
  orderNum: string;
  createdBy: string;
  createdByIp?: string;
  createdByLocation?: string;
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
  { id: 'order-001', orderNum: 'ZSH-2026-0047', createdBy: 'محمد حسن', ip: '197.32.45.112', createdByLocation: 'القاهرة، مصر', customer: 'أحمد محمود السيد', phone: '01012345678', phone2: '01198765432', region: 'القاهرة', district: 'مدينة نصر', address: 'شارع عباس العقاد، عمارة 5 شقة 12', products: 'حامل مصحف بني x 2', quantity: 2, subtotal: 600, shippingFee: 50, total: 650, status: 'shipping', date: '27/03/2026', time: '09:32', day: 'الجمعة', notes: 'العميل يريد التسليم في الصباح' },
  { id: 'order-002', orderNum: 'ZSH-2026-0046', createdBy: 'سارة أحمد', ip: '197.32.45.113', createdByLocation: 'الجيزة، مصر', customer: 'فاطمة علي حسن', phone: '01123456789', region: 'الجيزة', district: 'الدقي', address: 'شارع التحرير، برج المنار ط3', products: 'كعبة x 1 + مصحف x 2', quantity: 3, subtotal: 840, shippingFee: 50, total: 890, status: 'delivered', date: '27/03/2026', time: '09:15', day: 'الجمعة' },
  { id: 'order-003', orderNum: 'ZSH-2026-0045', createdBy: 'محمد حسن', ip: '197.32.45.114', createdByLocation: 'القاهرة، مصر', customer: 'محمد عبد الرحمن', phone: '01234567890', region: 'القليوبية', district: 'شبرا الخيمة', address: 'شارع النيل، مبنى رقم 14', products: 'حامل مصحف ذهبي x 1', quantity: 1, subtotal: 330, shippingFee: 50, total: 380, status: 'new', date: '27/03/2026', time: '08:55', day: 'الجمعة' },
  { id: 'order-004', orderNum: 'ZSH-2026-0044', createdBy: 'أميرة محمود', ip: '197.32.45.115', createdByLocation: 'القاهرة، مصر', customer: 'سارة إبراهيم خليل', phone: '01056789012', region: 'القاهرة', district: 'المعادي', address: 'شارع 9، فيلا 23', products: 'كشاف x 3', quantity: 3, subtotal: 450, shippingFee: 50, extraShippingFee: 30, total: 530, status: 'preparing', date: '27/03/2026', time: '08:40', day: 'الجمعة' },
  { id: 'order-005', orderNum: 'ZSH-2026-0043', createdBy: 'سارة أحمد', ip: '197.32.45.116', createdByLocation: 'الجيزة، مصر', customer: 'عمر حامد الشريف', phone: '01198765432', region: 'الجيزة', district: 'فيصل', address: 'شارع البحر الأعظم، عمارة 7', products: 'حامل مصحف أسود x 1 + كشاف x 1', quantity: 2, subtotal: 470, shippingFee: 50, total: 520, status: 'warehouse', date: '26/03/2026', time: '16:20', day: 'الخميس' },
  { id: 'order-006', orderNum: 'ZSH-2026-0042', createdBy: 'محمد حسن', ip: '197.32.45.117', createdByLocation: 'القاهرة، مصر', customer: 'نور الدين مصطفى', phone: '01067891234', region: 'القاهرة', district: 'هليوبوليس (مصر الجديدة)', address: 'شارع النزهة، شقة 45', products: 'كرسي x 2', quantity: 2, subtotal: 1150, shippingFee: 50, total: 1200, status: 'returned', date: '26/03/2026', time: '15:50', day: 'الخميس', notes: 'العميل رفض الاستلام' },
  { id: 'order-007', orderNum: 'ZSH-2026-0041', createdBy: 'أميرة محمود', ip: '197.32.45.118', createdByLocation: 'القليوبية، مصر', customer: 'هدى رمضان أحمد', phone: '01145678901', region: 'القليوبية', district: 'قليوب', address: 'شارع السكة الحديد، عمارة 2', products: 'مصحف x 5', quantity: 5, subtotal: 700, shippingFee: 50, total: 750, status: 'cancelled', date: '26/03/2026', time: '14:30', day: 'الخميس', notes: 'إلغاء بطلب العميل' },
  { id: 'order-008', orderNum: 'ZSH-2026-0040', createdBy: 'سارة أحمد', ip: '197.32.45.119', createdByLocation: 'القاهرة، مصر', customer: 'خالد عبد العزيز', phone: '01012223344', region: 'القاهرة', district: 'مصر الجديدة', address: 'شارع الثورة، عمارة 10', products: 'حامل مصحف أبيض x 2 + مصحف x 1', quantity: 3, subtotal: 760, shippingFee: 50, total: 810, status: 'delivered', date: '25/03/2026', time: '11:20', day: 'الأربعاء' },
  { id: 'order-009', orderNum: 'ZSH-2026-0039', createdBy: 'محمد حسن', ip: '197.32.45.120', createdByLocation: 'الجيزة، مصر', customer: 'ريم حسام الدين', phone: '01534567890', region: 'الجيزة', district: 'إمبابة', address: 'شارع طه حسين، رقم 33', products: 'كعبة x 1', quantity: 1, subtotal: 450, shippingFee: 50, total: 500, status: 'shipping', date: '25/03/2026', time: '10:05', day: 'الأربعاء' },
  { id: 'order-010', orderNum: 'ZSH-2026-0038', createdBy: 'أميرة محمود', ip: '197.32.45.121', createdByLocation: 'القليوبية، مصر', customer: 'طارق سعيد منصور', phone: '01267891234', region: 'القليوبية', district: 'الخانكة', address: 'شارع المحطة، مبنى 5', products: 'حامل مصحف صدف x 1 + كشاف x 1', quantity: 2, subtotal: 560, shippingFee: 50, total: 610, status: 'preparing', date: '25/03/2026', time: '09:45', day: 'الأربعاء' },
];

type SortField = 'orderNum' | 'customer' | 'region' | 'total' | 'status' | 'date';
type SortDir = 'asc' | 'desc';

// Export to CSV/Excel
function exportToCSV(orders: Order[]) {
  const headers = ['رقم الأوردر', 'العميل', 'الموبايل', 'المنطقة', 'المنطقة الفرعية', 'المنتجات', 'الكمية', 'المنتجات (ج.م)', 'الشحن (ج.م)', 'الإجمالي (ج.م)', 'الحالة', 'التاريخ', 'الوقت', 'المسجل'];
  const rows = orders.map(o => [
    o.orderNum, o.customer, o.phone, o.region, o.district || '', o.products,
    o.quantity, o.subtotal, o.shippingFee, o.total,
    STATUS_MAP[o.status]?.label || o.status, o.date, o.time, o.createdBy
  ]);
  const csvContent = '\uFEFF' + [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `zahranship-orders-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Export to PDF via print
function exportToPDF(orders: Order[]) {
  const win = window.open('', '_blank', 'width=1000,height=700');
  if (!win) return;
  const rows = orders.map(o => `
    <tr>
      <td>${o.orderNum}</td>
      <td>${o.customer}</td>
      <td>${o.phone}</td>
      <td>${o.region}${o.district ? ' - ' + o.district : ''}</td>
      <td>${o.products}</td>
      <td>${o.quantity}</td>
      <td>${o.total.toLocaleString('en-US')} ج.م</td>
      <td>${STATUS_MAP[o.status]?.label || o.status}</td>
      <td>${o.date}</td>
    </tr>
  `).join('');
  win.document.write(`
    <!DOCTYPE html><html dir="rtl" lang="ar">
    <head><meta charset="UTF-8"><title>تقرير الأوردرات - Zahranship</title>
    <style>
      body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;direction:rtl;padding:20px;font-size:12px;}
      h1{font-size:20px;margin-bottom:4px;color:#1e3a5f;}
      p.sub{color:#6b7280;margin-bottom:16px;font-size:12px;}
      table{width:100%;border-collapse:collapse;}
      th{background:#1e3a5f;color:white;padding:8px 10px;text-align:right;font-size:11px;}
      td{padding:7px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;}
      tr:nth-child(even){background:#f9fafb;}
      @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}
    </style></head>
    <body>
      <h1>Zahranship — تقرير الأوردرات</h1>
      <p class="sub">تاريخ التصدير: ${new Date().toLocaleDateString('en-US')} — إجمالي: ${orders.length} أوردر</p>
      <table>
        <thead><tr><th>رقم الأوردر</th><th>العميل</th><th>الموبايل</th><th>المنطقة</th><th>المنتجات</th><th>الكمية</th><th>الإجمالي</th><th>الحالة</th><th>التاريخ</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <script>window.onload=function(){window.print();window.close();}<\/script>
    </body></html>
  `);
  win.document.close();
}

export default function OrdersTableSection() {
  const [search, setSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState('الكل');
  const [statusFilter, setStatusFilter] = useState('الكل');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortField, setSortField] = useState<SortField>('orderNum');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(8);
  const [statusModal, setStatusModal] = useState<{ order: Order } | null>(null);
  const [detailModal, setDetailModal] = useState<{ order: Order } | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);

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
        <div className="p-4 border-b border-[hsl(var(--border))] space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
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
              <select className="input-field w-auto text-sm" value={regionFilter} onChange={(e) => { setRegionFilter(e.target.value); setPage(1); }}>
                {REGIONS.map((r) => <option key={`region-filter-${r}`} value={r}>{r}</option>)}
              </select>
              <select className="input-field w-auto text-sm" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
                {statusOptions.map((s) => (
                  <option key={`status-filter-${s}`} value={s}>{s === 'الكل' ? 'كل الحالات' : STATUS_MAP[s]?.label || s}</option>
                ))}
              </select>
            </div>
          </div>
          {/* Date range filter */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-[hsl(var(--muted-foreground))] font-semibold">فلتر التاريخ:</span>
            <div className="flex items-center gap-2">
              <label className="text-xs text-[hsl(var(--muted-foreground))]">من</label>
              <input type="date" className="input-field w-auto text-sm py-1.5" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} dir="ltr" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-[hsl(var(--muted-foreground))]">إلى</label>
              <input type="date" className="input-field w-auto text-sm py-1.5" value={dateTo} onChange={(e) => setDateTo(e.target.value)} dir="ltr" />
            </div>
            {(dateFrom || dateTo) && (
              <button className="text-xs text-red-500 hover:underline" onClick={() => { setDateFrom(''); setDateTo(''); }}>مسح</button>
            )}
            <span className="text-xs text-[hsl(var(--muted-foreground))] mr-auto">{filtered.length} نتيجة</span>
          </div>
        </div>

        {/* Bulk action bar */}
        {selectedRows.size > 0 && (
          <div className="bg-[hsl(var(--primary))] text-white px-4 py-3 flex items-center justify-between slide-up">
            <span className="text-sm font-semibold">تم تحديد {selectedRows.size} أوردر</span>
            <div className="flex gap-2">
              <button className="bg-white/20 hover:bg-white/30 text-white text-xs px-3 py-1.5 rounded-lg transition-colors font-medium">تحديث الحالة</button>
              <button
                className="bg-white/20 hover:bg-white/30 text-white text-xs px-3 py-1.5 rounded-lg transition-colors font-medium"
                onClick={() => exportToCSV(MOCK_ORDERS.filter(o => selectedRows.has(o.id)))}
              >
                تصدير المحدد
              </button>
              <button className="bg-red-500/80 hover:bg-red-600 text-white text-xs px-3 py-1.5 rounded-lg transition-colors font-medium">حذف المحدد</button>
              <button className="bg-white/20 hover:bg-white/30 text-white text-xs px-3 py-1.5 rounded-lg transition-colors font-medium" onClick={() => setSelectedRows(new Set())}>إلغاء التحديد</button>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[1000px]">
            <thead>
              <tr className="border-b border-[hsl(var(--border))]">
                <th className="table-header w-10">
                  <input type="checkbox" checked={selectedRows.size === paginated.length && paginated.length > 0} onChange={toggleAll} className="w-4 h-4 rounded" aria-label="تحديد الكل" />
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
                      <p className="text-sm text-[hsl(var(--muted-foreground))]">لم يتم العثور على أوردرات بهذه المعايير.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                paginated.map((order) => {
                  const st = STATUS_MAP[order.status] || STATUS_MAP['new'];
                  const isSelected = selectedRows.has(order.id);
                  return (
                    <tr key={order.id} className={`transition-colors duration-150 group ${isSelected ? 'bg-blue-50' : 'hover:bg-[hsl(var(--muted))]/50'}`}>
                      <td className="table-cell w-10">
                        <input type="checkbox" checked={isSelected} onChange={() => toggleRow(order.id)} className="w-4 h-4 rounded" aria-label={`تحديد أوردر ${order.orderNum}`} />
                      </td>
                      <td className="table-cell">
                        <span className="font-mono text-xs font-bold text-[hsl(var(--primary))]">{order.orderNum}</span>
                      </td>
                      <td className="table-cell">
                        <p className="text-xs font-medium">{order.createdBy}</p>
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
                        <div>
                          <span className="text-sm bg-[hsl(var(--muted))] px-2 py-0.5 rounded-lg text-[hsl(var(--foreground))] font-medium">{order.region}</span>
                          {order.district && <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-0.5">{order.district}</p>}
                        </div>
                      </td>
                      <td className="table-cell max-w-[160px]">
                        <p className="text-sm truncate" title={order.products}>{order.products}</p>
                        <p className="text-xs text-[hsl(var(--muted-foreground))]">{order.quantity} قطعة</p>
                      </td>
                      <td className="table-cell">
                        <div>
                          <p className="font-bold font-mono text-sm">{order.total.toLocaleString('en-US')} ج.م</p>
                          <p className="text-[10px] text-[hsl(var(--muted-foreground))]">شحن: {order.shippingFee} ج.م{order.extraShippingFee ? ` + ${order.extraShippingFee}` : ''}</p>
                        </div>
                      </td>
                      <td className="table-cell">
                        <button className={`badge ${st.cls} cursor-pointer hover:opacity-80 transition-opacity`} onClick={() => setStatusModal({ order })} title="انقر لتغيير الحالة">
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
                          <button onClick={() => setDetailModal({ order })} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-blue-50 text-blue-600 transition-colors" title="عرض التفاصيل">
                            <Eye size={14} />
                          </button>
                          <button className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-amber-50 text-amber-600 transition-colors" title="تعديل الأوردر">
                            <Edit2 size={14} />
                          </button>
                          <button onClick={() => setDetailModal({ order })} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-green-50 text-green-600 transition-colors" title="عرض الفاتورة PDF">
                            <FileText size={14} />
                          </button>
                          <button className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-red-500 transition-colors" title="حذف الأوردر">
                            <Trash2 size={14} />
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
            <select className="input-field w-auto text-sm py-1" value={perPage} onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }}>
              {[5, 8, 10, 20, 50].map((n) => <option key={`perpage-${n}`} value={n}>{n}</option>)}
            </select>
            <span>من {filtered.length} أوردر</span>
          </div>
          <div className="flex items-center gap-1">
            <button className="w-8 h-8 flex items-center justify-center rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-40 disabled:cursor-not-allowed transition-colors" onClick={() => setPage(1)} disabled={page === 1} aria-label="الصفحة الأولى"><ChevronRight size={14} /></button>
            <button className="w-8 h-8 flex items-center justify-center rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-40 disabled:cursor-not-allowed transition-colors" onClick={() => setPage(page - 1)} disabled={page === 1} aria-label="الصفحة السابقة"><ChevronRight size={14} /></button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              const pageNum = i + 1;
              return (
                <button key={`page-btn-${pageNum}`} className={`w-8 h-8 flex items-center justify-center rounded-lg border text-sm font-semibold transition-colors ${page === pageNum ? 'bg-[hsl(var(--primary))] text-white border-[hsl(var(--primary))]' : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]'}`} onClick={() => setPage(pageNum)}>{pageNum}</button>
              );
            })}
            <button className="w-8 h-8 flex items-center justify-center rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-40 disabled:cursor-not-allowed transition-colors" onClick={() => setPage(page + 1)} disabled={page === totalPages} aria-label="الصفحة التالية"><ChevronLeft size={14} /></button>
            <button className="w-8 h-8 flex items-center justify-center rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-40 disabled:cursor-not-allowed transition-colors" onClick={() => setPage(totalPages)} disabled={page === totalPages} aria-label="الصفحة الأخيرة"><ChevronLeft size={14} /></button>
          </div>
        </div>
      </div>

      {statusModal && <StatusUpdateModal order={statusModal.order} onClose={() => setStatusModal(null)} />}
      {detailModal && <OrderDetailModal order={detailModal.order} onClose={() => setDetailModal(null)} />}
    </>
  );
}