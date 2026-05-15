// ─────────────────────────────────────────────────────────────────────────────
// src/app/inventory/components/InventoryFilters.tsx
//
// Phase Inventory-UI-Redesign-1 — search + status chips + category chips +
// color filter + sort dropdown + view-mode toggle. Matches the dashed-
// purple smart-filter container style used on the orders page.
// ─────────────────────────────────────────────────────────────────────────────
'use client';

import React from 'react';
import { LayoutGrid, List, Search } from 'lucide-react';

import type { SortOption, StatusFilter, ViewMode } from '@/lib/inventory/inventoryStats';

interface Props {
  search: string;
  onSearch: (s: string) => void;

  statusFilter: StatusFilter;
  onStatusFilter: (s: StatusFilter) => void;

  category: string;
  categories: string[]; // does NOT include the "الكل" sentinel; we prepend it
  onCategory: (c: string) => void;

  colorFilter: string;
  colors: string[]; // does NOT include the "كل الألوان" sentinel
  onColorFilter: (c: string) => void;

  sort: SortOption;
  onSort: (s: SortOption) => void;

  view: ViewMode;
  onView: (v: ViewMode) => void;
}

// Phase Inventory-Categories-Safer-Archive-1 — six chips combining
// lifecycle (نشط / موقوف / مؤرشف) and stock (منخفض / نفد) with a
// catch-all "الكل" first. Default selection lives in the parent and
// is "active" so archived rows hide by default.
const STATUS_LABELS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'الكل' },
  { key: 'active', label: 'نشط' },
  { key: 'inactive', label: 'موقوف' },
  { key: 'archived', label: 'مؤرشف' },
  { key: 'low', label: 'منخفض' },
  { key: 'out', label: 'نفد' },
];

const SORT_OPTIONS: { key: SortOption; label: string }[] = [
  { key: 'newest', label: 'الأحدث' },
  { key: 'name', label: 'الاسم' },
  { key: 'price', label: 'السعر' },
  { key: 'qty_asc', label: 'الكمية المتاحة' },
  { key: 'low_first', label: 'منخفض المخزون أولًا' },
];

const ALL_CATEGORIES_KEY = '__all__';
const ALL_COLORS_KEY = '__all__';

export default function InventoryFilters({
  search,
  onSearch,
  statusFilter,
  onStatusFilter,
  category,
  categories,
  onCategory,
  colorFilter,
  colors,
  onColorFilter,
  sort,
  onSort,
  view,
  onView,
}: Props) {
  return (
    <div
      className="rounded-2xl border-2 border-dashed border-purple-300 bg-purple-50/40 p-3 space-y-3"
      dir="rtl"
    >
      {/* Status chips + view toggle */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          {STATUS_LABELS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => onStatusFilter(s.key)}
              className={`text-xs px-3 py-1.5 rounded-xl font-semibold transition-colors ${
                statusFilter === s.key
                  ? 'bg-[hsl(217,80%,30%)] text-white shadow-sm'
                  : 'bg-white border border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]/40'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 bg-white border border-[hsl(var(--border))] rounded-xl p-1">
          <button
            type="button"
            onClick={() => onView('cards')}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors ${
              view === 'cards'
                ? 'bg-[hsl(217,80%,30%)] text-white'
                : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]/40'
            }`}
            aria-pressed={view === 'cards'}
          >
            <LayoutGrid size={13} />
            كروت
          </button>
          <button
            type="button"
            onClick={() => onView('table')}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors ${
              view === 'table'
                ? 'bg-[hsl(217,80%,30%)] text-white'
                : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]/40'
            }`}
            aria-pressed={view === 'table'}
          >
            <List size={13} />
            جدول
          </button>
        </div>
      </div>

      {/* Category chips */}
      {categories.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => onCategory(ALL_CATEGORIES_KEY)}
            className={`text-xs px-3 py-1 rounded-xl font-semibold transition-colors ${
              category === ALL_CATEGORIES_KEY
                ? 'bg-[hsl(217,80%,30%)] text-white'
                : 'bg-white border border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]/40'
            }`}
          >
            الكل
          </button>
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onCategory(c)}
              className={`text-xs px-3 py-1 rounded-xl font-semibold transition-colors ${
                category === c
                  ? 'bg-[hsl(217,80%,30%)] text-white'
                  : 'bg-white border border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]/40'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {/* Search + color + sort row */}
      <div className="flex flex-col md:flex-row md:items-center gap-2">
        <div className="relative flex-1">
          <Search
            size={15}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="بحث بالاسم أو الكود أو الفئة..."
            className="w-full pr-9 pl-3 py-2 text-sm border border-[hsl(var(--border))] bg-white rounded-xl focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
          />
        </div>

        {colors.length > 0 && (
          <select
            value={colorFilter}
            onChange={(e) => onColorFilter(e.target.value)}
            className="text-xs border border-[hsl(var(--border))] bg-white rounded-xl px-2.5 py-2 font-semibold focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
            aria-label="فلتر اللون"
          >
            <option value={ALL_COLORS_KEY}>كل الألوان</option>
            {colors.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}

        <select
          value={sort}
          onChange={(e) => onSort(e.target.value as SortOption)}
          className="text-xs border border-[hsl(var(--border))] bg-white rounded-xl px-2.5 py-2 font-semibold focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
          aria-label="ترتيب"
        >
          {SORT_OPTIONS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export { ALL_CATEGORIES_KEY, ALL_COLORS_KEY };
