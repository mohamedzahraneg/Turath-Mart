// ─────────────────────────────────────────────────────────────────────────────
// src/lib/inventory/inventoryStats.ts
//
// Phase Inventory-UI-Redesign-1 — shared types + pure helpers used across
// the redesigned `/inventory` surface. Pure JS only; no React, no DB.
//
// `withdrawn` numbers on this page are still derived at runtime from
// `turath_masr_orders.products` because the `withdrawn` column on
// `turath_masr_inventory` is unused by the app (always 0). That derivation
// stays in `page.tsx` for now — Phase 4 (movement ledger) replaces it. The
// helpers here only need a `realWithdrawnByName` map and don't care where
// it came from.
// ─────────────────────────────────────────────────────────────────────────────

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
}

export type ProductStatus = 'available' | 'low' | 'out';

export type StatusFilter = 'all' | 'available' | 'low' | 'out';

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

export function productStatus(item: InventoryItem): ProductStatus {
  if (item.available <= 0) return 'out';
  if (item.available <= item.minStock) return 'low';
  return 'available';
}

export function matchesStatus(item: InventoryItem, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  return productStatus(item) === filter;
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
  // Order: out (0) → low (1) → available (2)
  if (s === 'out') return 0;
  if (s === 'low') return 1;
  return 2;
}

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

function csvEscape(value: string): string {
  if (value == null) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
