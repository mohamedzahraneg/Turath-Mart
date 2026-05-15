// ─────────────────────────────────────────────────────────────────────────────
// src/app/inventory/components/InventoryDrawer.tsx
//
// Phase Inventory-UI-Redesign-1 — right-side product details drawer.
// Phase Inventory-Categories-Safer-Archive-1 — adds lifecycle chip,
//   active ↔ inactive toggle, archive / restore.
// Phase Inventory-Additions-Log-1 — adds:
//   • A new "الإضافات" tab listing the latest stock additions for
//     this product (read from `turath_masr_inventory_additions`).
//     Falls back to an honest empty / missing-table state.
//   • "+ إضافة كمية" CTA in the summary tab (and a mirror in the
//     settings tab) that opens the AddStockModal via the parent.
//
// Tabs:
//   • الملخص — factsheet, lifecycle + stock chips, + إضافة كمية CTA
//   • الألوان — chips, or honest empty state if no colors
//   • الإضافات — last 50 stock additions for this product
//   • الطلبات المرتبطة — last 10 orders whose `products` text contains
//     the product name (lightweight ilike). Falls back to an honest
//     empty state on error.
//   • الإعدادات — read-only metadata + edit / lifecycle / + قطع
// ─────────────────────────────────────────────────────────────────────────────
'use client';

import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  CheckCircle,
  Edit2,
  Package,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  X,
  XCircle,
} from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { InventoryThumbnail, inventoryThumbnailUrl } from '@/lib/inventory/InventoryThumbnail';
import {
  formatDate,
  formatMoney,
  formatNumber,
  productLifecycle,
  productStatus,
  type InventoryAddition,
  type InventoryItem,
  type LifecycleStatus,
} from '@/lib/inventory/inventoryStats';

type Tab = 'summary' | 'colors' | 'additions' | 'orders' | 'settings';

interface Props {
  item: InventoryItem;
  withdrawn: number;
  isAdmin: boolean;
  canAddStock: boolean;
  onClose: () => void;
  onEdit: (item: InventoryItem) => void;
  onArchive: (item: InventoryItem) => void;
  onSetStatus: (item: InventoryItem, nextStatus: 'active' | 'inactive') => void;
  onRestore: (item: InventoryItem) => void;
  /** Phase Inventory-Additions-Log-1 — launches AddStockModal for this product. */
  onAddStock: (item: InventoryItem) => void;
}

export default function InventoryDrawer({
  item,
  withdrawn,
  isAdmin,
  canAddStock,
  onClose,
  onEdit,
  onArchive,
  onSetStatus,
  onRestore,
  onAddStock,
}: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('summary');
  const status = productStatus(item);
  const lifecycle = productLifecycle(item);
  const inventoryValue = (item.available || 0) * (item.price || 0);

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="تفاصيل المنتج"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-label="إغلاق"
      />
      <div
        className="relative bg-white w-full sm:max-w-2xl h-full shadow-2xl flex flex-col"
        dir="rtl"
      >
        {/* Header */}
        <div className="p-5 border-b border-[hsl(var(--border))] flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative w-12 h-12 rounded-xl overflow-hidden border border-[hsl(var(--border))] bg-[hsl(var(--muted))] shrink-0">
              <InventoryThumbnail
                src={inventoryThumbnailUrl(item.id)}
                alt={item.name}
                emoji="📦"
                fill
                sizes="48px"
                className="object-cover"
                emojiClassName="text-2xl"
              />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold truncate" title={item.name}>
                {item.name}
              </h2>
              <p className="text-[11px] text-[hsl(var(--muted-foreground))] font-mono truncate">
                {item.sku}
              </p>
              <div className="flex items-center gap-1.5 mt-1">
                <LifecycleChip lifecycle={lifecycle} />
                <StatusChip status={status} />
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-[hsl(var(--muted))]"
            aria-label="إغلاق"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="border-b border-[hsl(var(--border))] flex items-center gap-1 px-3 overflow-x-auto scrollbar-thin">
          {(
            [
              { key: 'summary', label: 'الملخص' },
              { key: 'colors', label: 'الألوان' },
              { key: 'additions', label: 'الإضافات' },
              { key: 'orders', label: 'الطلبات المرتبطة' },
              { key: 'settings', label: 'الإعدادات' },
            ] as { key: Tab; label: string }[]
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
              className={`text-xs font-semibold px-3 py-2 border-b-2 transition-colors whitespace-nowrap ${
                activeTab === t.key
                  ? 'border-[hsl(217,80%,30%)] text-[hsl(217,80%,30%)]'
                  : 'border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'
              }`}
              aria-selected={activeTab === t.key}
              role="tab"
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 scrollbar-thin">
          {activeTab === 'summary' && (
            <SummaryTab
              item={item}
              withdrawn={withdrawn}
              status={status}
              lifecycle={lifecycle}
              inventoryValue={inventoryValue}
              canAddStock={canAddStock}
              onAddStock={() => onAddStock(item)}
            />
          )}
          {activeTab === 'colors' && <ColorsTab item={item} />}
          {activeTab === 'additions' && (
            <AdditionsTab
              item={item}
              canAddStock={canAddStock}
              onAddStock={() => onAddStock(item)}
            />
          )}
          {activeTab === 'orders' && <OrdersTab item={item} />}
          {activeTab === 'settings' && (
            <SettingsTab
              item={item}
              status={status}
              lifecycle={lifecycle}
              isAdmin={isAdmin}
              canAddStock={canAddStock}
              onEdit={() => onEdit(item)}
              onArchive={() => onArchive(item)}
              onSetStatus={(next) => onSetStatus(item, next)}
              onRestore={() => onRestore(item)}
              onAddStock={() => onAddStock(item)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Summary ────────────────────────────────────────────────────────────────

function SummaryTab({
  item,
  withdrawn,
  status,
  lifecycle,
  inventoryValue,
  canAddStock,
  onAddStock,
}: {
  item: InventoryItem;
  withdrawn: number;
  status: ReturnType<typeof productStatus>;
  lifecycle: LifecycleStatus;
  inventoryValue: number;
  canAddStock: boolean;
  onAddStock: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Stat label="المتاح" value={formatNumber(item.available || 0)} tone={statusTone(status)} />
        <Stat label="المسحوب" value={formatNumber(withdrawn)} tone="neutral" />
        <Stat label="الحد الأدنى" value={formatNumber(item.minStock || 0)} tone="neutral" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Stat label="السعر" value={formatMoney(item.price || 0)} tone="neutral" />
        <Stat label="قيمة المخزون" value={formatMoney(inventoryValue)} tone="primary" />
      </div>

      <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 space-y-2">
        <Row label="الفئة" value={item.category || '—'} />
        <Row label="SKU" value={item.sku} mono />
        <Row label="تاريخ الإضافة" value={formatDate(item.created_at)} />
        <Row label="آخر تحديث" value={formatDate(item.updated_at)} />
        <Row label="دورة الحياة" value={<LifecycleChip lifecycle={lifecycle} />} />
        <Row label="حالة المخزون" value={<StatusChip status={status} />} />
      </div>

      {canAddStock && lifecycle !== 'archived' && (
        <button
          type="button"
          onClick={onAddStock}
          className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl py-2.5"
        >
          <Plus size={15} />
          إضافة كمية
        </button>
      )}

      {lifecycle === 'archived' && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800 flex items-start gap-2">
          <Archive size={13} className="mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="font-semibold mb-0.5">هذا المنتج مؤرشف</p>
            {item.archived_at && <p>تاريخ الأرشفة: {formatDate(item.archived_at)}</p>}
            {item.archive_reason && <p>السبب: {item.archive_reason}</p>}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 p-3 text-[11px] text-[hsl(var(--muted-foreground))] flex items-start gap-2">
        <Package size={13} className="mt-0.5 shrink-0" />
        <span>
          القيمة المعروضة هنا مبنية على الكمية المتاحة الفعلية. ستظهر تبويبات الحركة والإضافات بعد
          تفعيل سجل الحركات في مرحلة لاحقة.
        </span>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'neutral' | 'good' | 'warn' | 'bad' | 'primary';
}) {
  return (
    <div className={`rounded-2xl border p-3 ${STAT_TONE_BG[tone]}`}>
      <p className="text-[10px] font-semibold opacity-80 mb-1">{label}</p>
      <p className="text-lg font-bold font-mono">{value}</p>
    </div>
  );
}

const STAT_TONE_BG: Record<'neutral' | 'good' | 'warn' | 'bad' | 'primary', string> = {
  neutral: 'border-[hsl(var(--border))] bg-white text-[hsl(var(--foreground))]',
  good: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warn: 'border-amber-200 bg-amber-50 text-amber-800',
  bad: 'border-red-200 bg-red-50 text-red-800',
  primary: 'border-[hsl(217,80%,90%)] bg-[hsl(217,80%,97%)] text-[hsl(217,80%,30%)]',
};

function statusTone(s: ReturnType<typeof productStatus>): 'good' | 'warn' | 'bad' {
  if (s === 'out') return 'bad';
  if (s === 'low') return 'warn';
  return 'good';
}

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] text-[hsl(var(--muted-foreground))] font-semibold">{label}</span>
      <span className={`text-sm text-[hsl(var(--foreground))] ${mono ? 'font-mono' : ''} truncate`}>
        {value}
      </span>
    </div>
  );
}

function StatusChip({ status }: { status: ReturnType<typeof productStatus> }) {
  if (status === 'out') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-50 text-red-700 border border-red-200">
        <XCircle size={10} /> نفد
      </span>
    );
  }
  if (status === 'low') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
        <AlertTriangle size={10} /> منخفض
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
      <CheckCircle size={10} /> متاح
    </span>
  );
}

function LifecycleChip({ lifecycle }: { lifecycle: LifecycleStatus }) {
  if (lifecycle === 'archived') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-700 border border-gray-300">
        <Archive size={10} /> مؤرشف
      </span>
    );
  }
  if (lifecycle === 'inactive') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-orange-50 text-orange-700 border border-orange-200">
        <Pause size={10} /> موقوف
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
      <CheckCircle size={10} /> نشط
    </span>
  );
}

// ─── Colors ─────────────────────────────────────────────────────────────────

function ColorsTab({ item }: { item: InventoryItem }) {
  const colors = item.colors ?? [];
  if (colors.length === 0) {
    return (
      <div className="text-center py-12 text-[hsl(var(--muted-foreground))]">
        <p className="text-sm">لا توجد ألوان مسجلة لهذا المنتج.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-[hsl(var(--muted-foreground))]">
        {colors.length} لون مسجل لهذا المنتج.
      </p>
      <div className="flex flex-wrap gap-2">
        {colors.map((c) => (
          <span
            key={c}
            className="px-3 py-1.5 bg-[hsl(var(--primary))]/10 border border-[hsl(var(--primary))]/30 text-[hsl(var(--primary))] text-xs font-semibold rounded-xl"
          >
            {c}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Additions (per product) ────────────────────────────────────────────────

interface RawAdditionRow {
  id: string;
  inventory_id: string;
  quantity: number | null;
  unit_cost: number | string | null;
  total_cost: number | string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_invoice_num: string | null;
  received_at: string | null;
  created_by: string | null;
  created_by_name: string | null;
  note: string | null;
  created_at: string | null;
}

function AdditionsTab({
  item,
  canAddStock,
  onAddStock,
}: {
  item: InventoryItem;
  canAddStock: boolean;
  onAddStock: () => void;
}) {
  const [rows, setRows] = useState<InventoryAddition[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [missingTable, setMissingTable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMissingTable(false);
    (async () => {
      try {
        const supabase = createClient();
        const { data, error: err } = await supabase
          .from('turath_masr_inventory_additions')
          .select(
            'id, inventory_id, quantity, unit_cost, total_cost, supplier_id, supplier_name, supplier_invoice_num, received_at, created_by, created_by_name, note, created_at'
          )
          .eq('inventory_id', item.id)
          .order('received_at', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(50);

        if (cancelled) return;
        if (err) {
          const msg = (err.message || '').toLowerCase();
          if (msg.includes('does not exist') || msg.includes('relation')) {
            setMissingTable(true);
            setRows([]);
          } else {
            setError('تعذر تحميل سجل الإضافات.');
          }
          return;
        }
        const mapped: InventoryAddition[] = (data as RawAdditionRow[]).map((r) => ({
          id: r.id,
          inventory_id: r.inventory_id,
          quantity: Number(r.quantity ?? 0),
          unit_cost: r.unit_cost == null ? null : Number(r.unit_cost),
          total_cost: r.total_cost == null ? null : Number(r.total_cost),
          supplier_id: r.supplier_id,
          supplier_name: r.supplier_name,
          supplier_invoice_num: r.supplier_invoice_num,
          received_at: r.received_at ?? '',
          created_by: r.created_by,
          created_by_name: r.created_by_name,
          note: r.note,
          created_at: r.created_at ?? '',
        }));
        setRows(mapped);
      } catch {
        if (!cancelled) setError('تعذر تحميل سجل الإضافات.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [item.id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-[hsl(var(--muted-foreground))] gap-2 text-sm">
        <RefreshCw size={14} className="animate-spin" />
        جاري التحميل...
      </div>
    );
  }

  if (missingTable) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-800 text-sm">
        سجل الإضافات غير مفعّل بعد. يجب تطبيق تحديث قاعدة البيانات أولًا.
      </div>
    );
  }

  if (error) {
    return <div className="text-center py-10 text-red-600 text-sm">{error}</div>;
  }

  if (!rows || rows.length === 0) {
    return (
      <div className="space-y-3">
        <div className="text-center py-12 text-[hsl(var(--muted-foreground))] text-sm">
          لا توجد إضافات مسجلة لهذا المنتج بعد.
        </div>
        {canAddStock && productLifecycle(item) !== 'archived' && (
          <button
            type="button"
            onClick={onAddStock}
            className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl py-2.5"
          >
            <Plus size={15} />
            إضافة كمية جديدة
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          آخر {rows.length} إضافة لهذا المنتج.
        </p>
        {canAddStock && productLifecycle(item) !== 'archived' && (
          <button
            type="button"
            onClick={onAddStock}
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl"
          >
            <Plus size={12} /> إضافة كمية
          </button>
        )}
      </div>

      <div className="rounded-2xl border border-[hsl(var(--border))] bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[hsl(var(--muted))]/40 border-b border-[hsl(var(--border))]">
              {[
                'التاريخ',
                'الكمية',
                'تكلفة الوحدة',
                'الإجمالي',
                'المورد',
                'رقم الفاتورة',
                'أضيف بواسطة',
                'ملاحظة',
              ].map((h) => (
                <th
                  key={h}
                  className="text-right px-3 py-2 text-[11px] font-semibold text-[hsl(var(--muted-foreground))] whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[hsl(var(--border))]">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-[hsl(var(--muted))]/30 align-top">
                <td className="px-3 py-2 text-xs text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                  {formatDate(row.received_at)}
                </td>
                <td className="px-3 py-2 font-mono text-xs font-bold text-emerald-700">
                  +{formatNumber(row.quantity)}
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  {row.unit_cost == null ? '—' : formatMoney(row.unit_cost)}
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  {row.total_cost == null ? '—' : formatMoney(row.total_cost)}
                </td>
                <td className="px-3 py-2 text-xs truncate max-w-[140px]">
                  {row.supplier_name || '—'}
                </td>
                <td className="px-3 py-2 text-xs font-mono">{row.supplier_invoice_num || '—'}</td>
                <td className="px-3 py-2 text-xs">{row.created_by_name || '—'}</td>
                <td className="px-3 py-2 text-xs text-[hsl(var(--muted-foreground))] truncate max-w-[160px]">
                  {row.note || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Linked orders ──────────────────────────────────────────────────────────

interface LinkedOrder {
  id: string;
  order_num: string | null;
  customer_name: string | null;
  status: string | null;
  total: number | null;
  created_at: string | null;
  products: string | null;
}

function OrdersTab({ item }: { item: InventoryItem }) {
  const [orders, setOrders] = useState<LinkedOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const supabase = createClient();
        const safeName = item.name.replace(/[%_]/g, '').trim();
        if (!safeName) {
          if (!cancelled) {
            setOrders([]);
            setLoading(false);
          }
          return;
        }
        const { data, error: err } = await supabase
          .from('turath_masr_orders')
          .select('id, order_num, customer_name, status, total, created_at, products')
          .ilike('products', `%${safeName}%`)
          .order('created_at', { ascending: false })
          .limit(10);

        if (cancelled) return;
        if (err) {
          setError('تعذر تحميل الطلبات المرتبطة.');
          return;
        }
        setOrders((data ?? []) as LinkedOrder[]);
      } catch {
        if (!cancelled) setError('تعذر تحميل الطلبات المرتبطة.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [item.id, item.name]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-[hsl(var(--muted-foreground))] gap-2 text-sm">
        <RefreshCw size={14} className="animate-spin" />
        جاري التحميل...
      </div>
    );
  }
  if (error) {
    return <div className="text-center py-10 text-red-600 text-sm">{error}</div>;
  }
  if (!orders || orders.length === 0) {
    return (
      <div className="text-center py-12 text-[hsl(var(--muted-foreground))] text-sm">
        لا توجد طلبات مرتبطة بهذا المنتج خلال آخر عمليات البحث.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-[hsl(var(--muted-foreground))]">
        آخر {orders.length} طلب يحتوي على اسم هذا المنتج.
      </p>
      <div className="rounded-2xl border border-[hsl(var(--border))] bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[hsl(var(--muted))]/40 border-b border-[hsl(var(--border))]">
              {['رقم الطلب', 'العميل', 'الحالة', 'الإجمالي', 'التاريخ'].map((h) => (
                <th
                  key={h}
                  className="text-right px-3 py-2 text-[11px] font-semibold text-[hsl(var(--muted-foreground))] whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[hsl(var(--border))]">
            {orders.map((o) => (
              <tr key={o.id} className="hover:bg-[hsl(var(--muted))]/30">
                <td className="px-3 py-2 font-mono text-xs">{o.order_num || '—'}</td>
                <td className="px-3 py-2 text-xs truncate max-w-[140px]">
                  {o.customer_name || '—'}
                </td>
                <td className="px-3 py-2 text-xs">{o.status || '—'}</td>
                <td className="px-3 py-2 font-mono text-xs">{formatMoney(Number(o.total ?? 0))}</td>
                <td className="px-3 py-2 text-xs text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                  {formatDate(o.created_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Settings ───────────────────────────────────────────────────────────────

function SettingsTab({
  item,
  status,
  lifecycle,
  isAdmin,
  canAddStock,
  onEdit,
  onArchive,
  onSetStatus,
  onRestore,
  onAddStock,
}: {
  item: InventoryItem;
  status: ReturnType<typeof productStatus>;
  lifecycle: LifecycleStatus;
  isAdmin: boolean;
  canAddStock: boolean;
  onEdit: () => void;
  onArchive: () => void;
  onSetStatus: (next: 'active' | 'inactive') => void;
  onRestore: () => void;
  onAddStock: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 space-y-2">
        <Row label="الاسم" value={item.name} />
        <Row label="SKU" value={item.sku} mono />
        <Row label="الفئة" value={item.category || '—'} />
        <Row label="السعر" value={formatMoney(item.price || 0)} />
        <Row label="المتاح" value={formatNumber(item.available || 0)} />
        <Row label="الحد الأدنى" value={formatNumber(item.minStock || 0)} />
        <Row label="عدد الألوان" value={String((item.colors ?? []).length)} />
        <Row label="عدد الصور" value={String((item.images ?? []).length)} />
        <Row label="تاريخ الإضافة" value={formatDate(item.created_at)} />
        <Row label="آخر تحديث" value={formatDate(item.updated_at)} />
        <Row label="دورة الحياة" value={<LifecycleChip lifecycle={lifecycle} />} />
        <Row label="حالة المخزون" value={<StatusChip status={status} />} />
      </div>

      <div className="flex flex-col gap-2">
        {canAddStock && lifecycle !== 'archived' && (
          <button
            type="button"
            onClick={onAddStock}
            className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl py-2.5"
          >
            <Plus size={15} />
            إضافة كمية
          </button>
        )}

        <button
          type="button"
          onClick={onEdit}
          className="w-full flex items-center justify-center gap-2 bg-[hsl(217,80%,30%)] hover:bg-[hsl(217,80%,25%)] text-white text-sm font-semibold rounded-xl py-2.5"
        >
          <Edit2 size={15} />
          تعديل المنتج
        </button>

        {lifecycle === 'active' && (
          <button
            type="button"
            onClick={() => onSetStatus('inactive')}
            className="w-full flex items-center justify-center gap-2 border border-orange-200 text-orange-700 hover:bg-orange-50 text-sm font-semibold rounded-xl py-2.5"
          >
            <Pause size={15} />
            إيقاف المنتج
          </button>
        )}

        {lifecycle === 'inactive' && (
          <button
            type="button"
            onClick={() => onSetStatus('active')}
            className="w-full flex items-center justify-center gap-2 border border-emerald-200 text-emerald-700 hover:bg-emerald-50 text-sm font-semibold rounded-xl py-2.5"
          >
            <Play size={15} />
            تفعيل المنتج
          </button>
        )}

        {lifecycle !== 'archived' && (
          <button
            type="button"
            onClick={onArchive}
            className="w-full flex items-center justify-center gap-2 border border-amber-300 text-amber-800 hover:bg-amber-50 text-sm font-semibold rounded-xl py-2.5"
          >
            <Archive size={15} />
            أرشفة المنتج
          </button>
        )}

        {lifecycle === 'archived' && isAdmin && (
          <button
            type="button"
            onClick={onRestore}
            className="w-full flex items-center justify-center gap-2 border border-emerald-300 text-emerald-700 hover:bg-emerald-50 text-sm font-semibold rounded-xl py-2.5"
          >
            <RotateCcw size={15} />
            استعادة من الأرشيف
          </button>
        )}

        <p className="text-[11px] text-[hsl(var(--muted-foreground))] text-center">
          المنتج المؤرشف يظل في سجل المخزون لكنه يختفي من خيارات إنشاء الطلبات الجديدة.
        </p>
      </div>
    </div>
  );
}
