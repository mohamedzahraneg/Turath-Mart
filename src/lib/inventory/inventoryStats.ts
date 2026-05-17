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
// Phase Inventory-Display-Unify-1 — `computeStats` now consumes the
// per-product display map from `displayQuantities.ts` rather than the
// brittle name-keyed `withdrawnByName` (which was always 0 for
// variant-tracked products) and the base `available/reserved` columns
// (which drift for variant products). The KPI cards therefore match
// what the operator sees on each card / drawer Summary.
// ─────────────────────────────────────────────────────────────────────────────

import type { ProductDisplayQuantities } from './displayQuantities';

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
  /** Phase Inventory-Reservations-1 — count of units currently held
   *  against open orders. `sellable = max(available - reserved, 0)`.
   *  `undefined` before the Phase Inventory-Reservations-1 migration
   *  applies; treated as `0` everywhere. */
  reserved?: number;
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

/** Phase Inventory-Movement-Ledger-1 — DB-level movement type. The
 *  CHECK constraint also accepts `'exchange_in'` / `'exchange_out'`
 *  for future order-flow integration. */
export type MovementType =
  | 'addition'
  | 'manual_in'
  | 'manual_out'
  | 'damage_out'
  | 'return_in'
  | 'exchange_in'
  | 'exchange_out'
  | 'stock_count_adjustment'
  | 'price_change'
  | 'correction'
  // Phase Inventory-Delivery-Fulfillment-1 — written by
  // `inventory_fulfill_for_order` when an order transitions to
  // `delivered`. Always carries a negative delta and a non-null
  // `order_num`.
  | 'order_out';

/** Subset of movement types we expose in the manual movement modal.
 *  Order-flow movements (`addition`, `exchange_*`) are deliberately
 *  hidden so the manual surface never triggers them. */
export const MANUAL_MOVEMENT_TYPES = [
  'manual_in',
  'manual_out',
  'damage_out',
  'return_in',
  'stock_count_adjustment',
  'correction',
] as const;
export type ManualMovementType = (typeof MANUAL_MOVEMENT_TYPES)[number];

export const MOVEMENT_TYPE_LABELS_AR: Record<MovementType, string> = {
  addition: 'إضافة كمية',
  manual_in: 'إضافة يدوية',
  manual_out: 'خصم يدوي',
  damage_out: 'تالف',
  return_in: 'مرتجع من عميل',
  // Phase Inventory-Exchange-Stock-1 — clearer Arabic labels.
  // Previously the labels were the symmetric pair
  //   "استبدال — دخول" / "استبدال — خروج"
  // which read as direction-only; updated to call out which side of
  // the exchange the line represents so the global movement log and
  // CSV are self-explanatory.
  exchange_in: 'رجوع من استبدال',
  exchange_out: 'خروج بديل',
  stock_count_adjustment: 'تسوية جرد',
  price_change: 'تعديل سعر',
  correction: 'تصحيح',
  order_out: 'خروج لطلب',
};

export interface InventoryMovement {
  id: string;
  inventory_id: string;
  movement_type: MovementType;
  quantity_delta: number;
  quantity_before: number;
  quantity_after: number;
  reason: string | null;
  reference_type: string | null;
  reference_id: string | null;
  order_num: string | null;
  supplier_invoice_num: string | null;
  unit_cost: number | null;
  total_cost: number | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

export interface InventoryMovementWithProduct extends InventoryMovement {
  inventory_name: string;
  inventory_sku: string;
}

/** Phase Inventory-Stock-Count-1 — row shape for
 *  `turath_masr_inventory_stock_counts`. One row per physical count
 *  event; carries the counted_quantity, the system available at the
 *  moment of the count, the resulting delta, the operator-supplied
 *  reason, and (when delta ≠ 0) a link to the movement row that was
 *  written to reconcile. */
export interface InventoryStockCount {
  id: string;
  inventory_id: string;
  counted_quantity: number;
  system_available_before: number;
  quantity_delta: number;
  reason: string;
  note: string | null;
  movement_id: string | null;
  counted_by: string | null;
  counted_by_name: string | null;
  counted_at: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

/** Stock count joined with the parent product for table / CSV rendering. */
export interface InventoryStockCountWithProduct extends InventoryStockCount {
  inventory_name: string;
  inventory_sku: string;
}

/** Phase Inventory-Variants-1A — row shape for
 *  `turath_masr_inventory_variants`. One row per variant of a base
 *  product (today: per color). Quantities live here but are NOT yet
 *  wired to the order-flow RPCs; Phase 1B will teach
 *  reserve / fulfill / count / movement to operate on `variant_id`. */
export interface InventoryVariant {
  id: string;
  inventory_id: string;
  variant_type: string;
  variant_value: string;
  variant_label: string;
  sku: string | null;
  barcode: string | null;
  available: number;
  reserved: number;
  min_stock: number;
  status: LifecycleStatus;
  sort_order: number;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
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
  /** Phase Inventory-Reservations-1 — total units held against open
   *  orders across all non-archived rows. `0` pre-migration. */
  totalReserved: number;
  /** Phase Inventory-Reservations-1 — `available − reserved` summed,
   *  floored at 0 per row so a stale over-reservation doesn't drag
   *  the aggregate negative. */
  totalSellable: number;
}

/** Phase Inventory-Reservations-1 — per-item sellable count.
 *  Floored at 0 so a stale over-reservation (impossible by the
 *  CHECK constraint but defensive on the client) doesn't surface
 *  as a negative number in the UI. */
export function sellableQty(item: InventoryItem): number {
  const available = item.available || 0;
  const reserved = item.reserved || 0;
  return Math.max(0, available - reserved);
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

// Phase Inventory-Display-Unify-1 — KPI totals now derive each per-product
// quantity from the same display map the card / drawer Summary read,
// so that "إجمالي المسحوب" and "المحجوز" KPIs stay consistent with what
// the operator sees on each product card. Missing map entries fall back
// to the base item fields (for non-variant products and pre-fetch frames).
export function computeStats(
  items: InventoryItem[],
  displayByInventoryId: Record<string, ProductDisplayQuantities>
): InventoryStats {
  let totalAvailable = 0;
  let totalWithdrawn = 0;
  let inventoryValue = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;
  let totalReserved = 0;
  let totalSellable = 0;

  for (const item of items) {
    const display = displayByInventoryId[item.id];
    const available = display?.available ?? item.available ?? 0;
    const reserved = display?.reserved ?? item.reserved ?? 0;
    const sellable = display?.sellable ?? Math.max(0, available - reserved);
    const withdrawn = display?.withdrawn ?? 0;
    const price = item.price || 0;

    totalAvailable += available;
    totalWithdrawn += withdrawn;
    inventoryValue += available * price;
    totalReserved += reserved;
    totalSellable += sellable;

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
    totalReserved,
    totalSellable,
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
    'المحجوز',
    'المتاح للبيع',
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
    String(item.reserved ?? 0),
    String(sellableQty(item)),
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

// Phase Inventory-Movement-Ledger-1 — CSV export of the global
// movements log. Mirrors the table view; UTF-8 BOM so Excel opens
// Arabic correctly.
export function exportMovementsCsv(rows: InventoryMovementWithProduct[]): void {
  if (typeof window === 'undefined') return;

  const header = [
    'التاريخ',
    'المنتج',
    'SKU',
    'نوع الحركة',
    'التغيير',
    'قبل',
    'بعد',
    'السبب',
    'المرجع',
    'رقم الطلب',
    'رقم فاتورة المورد',
    'تكلفة الوحدة',
    'إجمالي التكلفة',
    'المستخدم',
  ];

  const rowsCsv = rows.map((r) => [
    r.created_at ?? '',
    r.inventory_name ?? '',
    r.inventory_sku ?? '',
    MOVEMENT_TYPE_LABELS_AR[r.movement_type] ?? r.movement_type,
    (r.quantity_delta >= 0 ? '+' : '') + String(r.quantity_delta),
    String(r.quantity_before),
    String(r.quantity_after),
    r.reason ?? '',
    r.reference_type ?? '',
    r.order_num ?? '',
    r.supplier_invoice_num ?? '',
    r.unit_cost == null ? '' : String(r.unit_cost),
    r.total_cost == null ? '' : String(r.total_cost),
    r.created_by_name ?? '',
  ]);

  const csv = [header, ...rowsCsv].map((line) => line.map(csvEscape).join(',')).join('\r\n');
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `inventory-movements-${new Date().toISOString().slice(0, 10)}.csv`;
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

// Phase Inventory-Stock-Count-1 — CSV export of the global stock-count
// log. Same UTF-8-BOM pattern so Excel renders Arabic correctly.
export function exportStockCountsCsv(rows: InventoryStockCountWithProduct[]): void {
  if (typeof window === 'undefined') return;

  const header = [
    'التاريخ',
    'المنتج',
    'SKU',
    'النظام قبل',
    'الكمية المعدودة',
    'الفرق',
    'السبب',
    'ملاحظة',
    'بواسطة',
  ];

  const rowsCsv = rows.map((r) => [
    r.counted_at ?? '',
    r.inventory_name ?? '',
    r.inventory_sku ?? '',
    String(r.system_available_before),
    String(r.counted_quantity),
    (r.quantity_delta >= 0 ? '+' : '') + String(r.quantity_delta),
    r.reason ?? '',
    r.note ?? '',
    r.counted_by_name ?? '',
  ]);

  const csv = [header, ...rowsCsv].map((line) => line.map(csvEscape).join(',')).join('\r\n');
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `inventory-stock-counts-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
