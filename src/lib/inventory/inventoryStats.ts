// ─────────────────────────────────────────────────────────────────────────────
// src/lib/inventory/inventoryStats.ts
//
// Phase Inventory-UI-Redesign-1 — shared types + pure helpers used across
// the redesigned `/inventory` surface. Pure JS only; no React, no DB.
//
// Phase Inventory-Categories-Safer-Archive-1 — adds:
//   • LifecycleStatus ('active' | 'inactive' | 'archived') + helper
//     `productLifecycle(item)` defaulting to 'active' for rows that
//     pre-date the migration.
//   • Extended `StatusFilter` chip set covering both lifecycle states
//     (نشط / موقوف / مؤرشف) and stock states (منخفض / نفد). Default
//     `'active'` so archived rows hide unless explicitly requested.
//   • `Category` shape + DB-backed category helpers.
//   • CSV export gains `الحالة` / `سبب الأرشفة` / `تاريخ الأرشفة`.
//
// `withdrawn` numbers on this page are still derived at runtime from
// `turath_masr_orders.products` because the `withdrawn` column on
// `turath_masr_inventory` is unused by the app (always 0). That derivation
// stays in `page.tsx` for now — Phase 4 (movement ledger) replaces it.
// ─────────────────────────────────────────────────────────────────────────────

export type LifecycleStatus = 'active' | 'inactive' | 'archived';

export interface InventoryItem {
  id: string;
  name: string;
  sku: string;
  available: number;
  withdrawn: number;
  minStock: number;
  price: number;
  category: string;
  images?: string[];
  colors?: string[];
  created_at?: string | null;
  /** Phase Inventory-Categories-Safer-Archive-1 — present after the
   *  migration applies; undefined on pre-migration rows. Treat
   *  undefined as `'active'` everywhere. */
  status?: LifecycleStatus;
  category_id?: string | null;
  archived_at?: string | null;
  archived_by?: string | null;
  archive_reason?: string | null;
  updated_at?: string | null;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
  is_active: boolean;
}

/** Phase Inventory-Additions-Log-1 — one row in the additions ledger. */
export interface InventoryAddition {
  id: string;
  inventory_id: string;
  quantity: number;
  unit_cost: number | null;
  total_cost: number | null;
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_invoice_num: string | null;
  received_at: string;
  created_by: string | null;
  created_by_name: string | null;
  note: string | null;
  created_at: string;
}

/** A row joined with the inventory product, for the global log view. */
export interface InventoryAdditionWithProduct extends InventoryAddition {
  inventory_name: string;
  inventory_sku: string;
}

/** Stock health of a single row (independent of lifecycle status). */
export type ProductStatus = 'available' | 'low' | 'out';

/** Six chips: lifecycle (active/inactive/archived) + stock (low/out) + all. */
export type StatusFilter = 'all' | 'active' | 'inactive' | 'archived' | 'low' | 'out';

export type SortOption = 'newest' | 'name' | 'price' | 'qty_asc' | 'low_first';

export type ViewMode = 'cards' | 'table';

export interface InventoryStats {
  totalProducts: number;
  totalAvailable: number;
  totalWithdrawn: number;
  inventoryValue: number;
  lowStockCount: number;
  outOfStockCount: number;
}

export function productLifecycle(item: InventoryItem): LifecycleStatus {
  return item.status ?? 'active';
}

export function productStatus(item: InventoryItem): ProductStatus {
  if (item.available <= 0) return 'out';
  if (item.available <= item.minStock) return 'low';
  return 'available';
}

export function matchesStatus(item: InventoryItem, filter: StatusFilter): boolean {
  const lifecycle = productLifecycle(item);
  switch (filter) {
    case 'all':
      return true;
    case 'active':
      return lifecycle === 'active';
    case 'inactive':
      return lifecycle === 'inactive';
    case 'archived':
      return lifecycle === 'archived';
    case 'low':
      // Stock filters only make sense for non-archived rows.
      if (lifecycle === 'archived') return false;
      return item.available > 0 && item.available <= item.minStock;
    case 'out':
      if (lifecycle === 'archived') return false;
      return item.available <= 0;
    default:
      return true;
  }
}

export function computeStats(
  items: InventoryItem[],
  realWithdrawnByName: Record<string, number>
): InventoryStats {
  let totalAvailable = 0;
  let totalWithdrawn = 0;
  let inventoryValue = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;

  for (const item of items) {
    const available = item.available || 0;
    const withdrawn = realWithdrawnByName[item.name.trim()] || 0;
    const price = item.price || 0;

    totalAvailable += available;
    totalWithdrawn += withdrawn;
    inventoryValue += available * price;

    if (available <= 0) {
      outOfStockCount += 1;
    } else if (available <= item.minStock) {
      lowStockCount += 1;
    }
  }

  return {
    totalProducts: items.length,
    totalAvailable,
    totalWithdrawn,
    inventoryValue,
    lowStockCount,
    outOfStockCount,
  };
}

export function uniqueCategories(items: InventoryItem[]): string[] {
  const set = new Set<string>();
  for (const item of items) {
    const cat = (item.category || '').trim();
    if (cat) set.add(cat);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'ar'));
}

export function uniqueColors(items: InventoryItem[]): string[] {
  const set = new Set<string>();
  for (const item of items) {
    for (const c of item.colors ?? []) {
      const trimmed = (c || '').trim();
      if (trimmed) set.add(trimmed);
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'ar'));
}

export function sortInventory(items: InventoryItem[], sort: SortOption): InventoryItem[] {
  const out = [...items];
  switch (sort) {
    case 'name':
      out.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
      break;
    case 'price':
      out.sort((a, b) => (b.price || 0) - (a.price || 0));
      break;
    case 'qty_asc':
      out.sort((a, b) => (a.available || 0) - (b.available || 0));
      break;
    case 'low_first':
      out.sort((a, b) => statusRank(a) - statusRank(b));
      break;
    case 'newest':
    default:
      out.sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return tb - ta;
      });
  }
  return out;
}

function statusRank(item: InventoryItem): number {
  const s = productStatus(item);
  if (s === 'out') return 0;
  if (s === 'low') return 1;
  return 2;
}

export const LIFECYCLE_LABELS: Record<LifecycleStatus, string> = {
  active: 'نشط',
  inactive: 'موقوف',
  archived: 'مؤرشف',
};

export function formatMoney(n: number): string {
  const safe = Number.isFinite(n) ? n : 0;
  return `${safe.toLocaleString('en-EG', { maximumFractionDigits: 2 })} ج.م`;
}

export function formatCompactMoney(n: number): string {
  const safe = Number.isFinite(n) ? n : 0;
  if (safe >= 1_000_000) return `${(safe / 1_000_000).toFixed(1)}M ج.م`;
  if (safe >= 1_000) return `${(safe / 1_000).toFixed(1)}K ج.م`;
  return formatMoney(safe);
}

export function formatNumber(n: number): string {
  const safe = Number.isFinite(n) ? n : 0;
  return safe.toLocaleString('en-EG');
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return '—';
  }
}

// Phase Inventory-UI-Redesign-1 — client-side CSV export of currently
// filtered rows. UTF-8 BOM so Excel opens Arabic correctly.
// Phase Inventory-Categories-Safer-Archive-1 — adds الحالة / سبب
// الأرشفة / تاريخ الأرشفة columns. Pre-migration rows export with
// "نشط" for status and empty archive columns.
export function exportInventoryCsv(items: InventoryItem[]): void {
  if (typeof window === 'undefined') return;

  const header = [
    'الاسم',
    'SKU',
    'الفئة',
    'السعر',
    'المتاح',
    'المسحوب',
    'الحد الأدنى',
    'الألوان',
    'تاريخ الإضافة',
    'الحالة',
    'سبب الأرشفة',
    'تاريخ الأرشفة',
  ];

  const rows = items.map((item) => [
    item.name,
    item.sku,
    item.category || '',
    String(item.price ?? 0),
    String(item.available ?? 0),
    String(item.withdrawn ?? 0),
    String(item.minStock ?? 0),
    (item.colors ?? []).join(' / '),
    item.created_at ?? '',
    LIFECYCLE_LABELS[productLifecycle(item)],
    item.archive_reason ?? '',
    item.archived_at ?? '',
  ]);

  const csv = [header, ...rows].map((line) => line.map(csvEscape).join(',')).join('\r\n');
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `inventory-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// Phase Inventory-Additions-Log-1 — CSV export of the global
// additions log. Columns mirror the table; UTF-8 BOM so Excel opens
// Arabic correctly.
export function exportAdditionsCsv(rows: InventoryAdditionWithProduct[]): void {
  if (typeof window === 'undefined') return;

  const header = [
    'التاريخ',
    'المنتج',
    'SKU',
    'الكمية',
    'تكلفة الوحدة',
    'إجمالي التكلفة',
    'المورد',
    'رقم الفاتورة',
    'أضيف بواسطة',
    'ملاحظة',
  ];

  const rowsCsv = rows.map((r) => [
    r.received_at ?? r.created_at ?? '',
    r.inventory_name ?? '',
    r.inventory_sku ?? '',
    String(r.quantity ?? 0),
    r.unit_cost == null ? '' : String(r.unit_cost),
    r.total_cost == null ? '' : String(r.total_cost),
    r.supplier_name ?? '',
    r.supplier_invoice_num ?? '',
    r.created_by_name ?? '',
    r.note ?? '',
  ]);

  const csv = [header, ...rowsCsv].map((line) => line.map(csvEscape).join(',')).join('\r\n');
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `inventory-additions-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function csvEscape(value: string): string {
  if (value == null) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
