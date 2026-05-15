// ─────────────────────────────────────────────────────────────────────────────
// src/app/inventory/page.tsx
//
// Phase Inventory-UI-Redesign-1 — redesigned inventory dashboard.
//
// What ships here:
//   • Header with breadcrumb to /dashboard and three real-action buttons
//     (add product / CSV export / refresh).
//   • Six KPI cards driven by `computeStats` (products / available /
//     withdrawn / inventory value / low / out).
//   • Smart-filter container (status chips + category chips + search +
//     color + sort) plus a cards/table view toggle.
//   • Card grid view + table view of the filtered+sorted result.
//   • Right-side product drawer (الملخص / الألوان / الطلبات المرتبطة /
//     الإعدادات) with NO placeholder movement/additions tabs.
//   • Existing add/edit modal extracted into `InventoryEditModal` —
//     behaviour preserved verbatim (auto-SKU, multi-image carousel,
//     colors chips).
//   • Low-stock alert banner when low+out > 0.
//   • Loading / error / empty / filtered-empty states.
//
// What does NOT ship here (deferred per the system plan):
//   • Movements ledger, additions log, variants, suppliers, cost price.
//   • Order-flow integration (decrement on create / restore on return).
//   • Soft-delete / archive — hard delete is preserved but now gated
//     behind a confirm step.
//
// The `withdrawn` numbers are still derived from
// `turath_masr_orders.products` ilike-parsing (preserved from the old
// page) because the `withdrawn` column on `turath_masr_inventory` is
// unused by the rest of the app today. This derivation moves to the
// movement ledger in Phase Inventory-Movement-Ledger-1.
// ─────────────────────────────────────────────────────────────────────────────
'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Package, RefreshCw } from 'lucide-react';

import AppLayout from '@/components/AppLayout';
import { createClient } from '@/lib/supabase/client';
import {
  computeStats,
  exportInventoryCsv,
  matchesStatus,
  sortInventory,
  uniqueCategories,
  uniqueColors,
  type InventoryItem,
  type SortOption,
  type StatusFilter,
  type ViewMode,
} from '@/lib/inventory/inventoryStats';

import InventoryHeader from './components/InventoryHeader';
import InventoryKpiCards from './components/InventoryKpiCards';
import InventoryFilters, {
  ALL_CATEGORIES_KEY,
  ALL_COLORS_KEY,
} from './components/InventoryFilters';
import InventoryCardGrid from './components/InventoryCardGrid';
import InventoryTable from './components/InventoryTable';
import InventoryDrawer from './components/InventoryDrawer';
import InventoryEditModal from './components/InventoryEditModal';

interface InventoryRowDb {
  id: string;
  name: string | null;
  sku: string | null;
  available: number | null;
  withdrawn: number | null;
  min_stock: number | null;
  price: number | null;
  category: string | null;
  colors: string[] | null;
  created_at: string | null;
}

interface OrderProductsRow {
  products: string | null;
  status: string | null;
}

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [withdrawnByName, setWithdrawnByName] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [category, setCategory] = useState<string>(ALL_CATEGORIES_KEY);
  const [colorFilter, setColorFilter] = useState<string>(ALL_COLORS_KEY);
  const [sort, setSort] = useState<SortOption>('newest');
  const [view, setView] = useState<ViewMode>('cards');

  // Modal / drawer state
  const [editItem, setEditItem] = useState<InventoryItem | null | undefined>(undefined);
  const [drawerItem, setDrawerItem] = useState<InventoryItem | null>(null);

  const loadAll = useCallback(async (silent: boolean) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setLoadError(null);
    try {
      const supabase = createClient();
      const [invRes, ordRes] = await Promise.all([
        supabase
          .from('turath_masr_inventory')
          .select(
            'id, name, sku, available, withdrawn, min_stock, price, category, colors, created_at'
          )
          .order('created_at', { ascending: false }),
        supabase.from('turath_masr_orders').select('products, status'),
      ]);

      if (invRes.error) {
        setLoadError('تعذر تحميل بيانات المخزن');
        setItems([]);
      } else {
        const rows = (invRes.data ?? []) as InventoryRowDb[];
        const mapped: InventoryItem[] = rows.map((r) => ({
          id: r.id,
          name: r.name ?? '',
          sku: r.sku ?? '',
          available: r.available ?? 0,
          withdrawn: r.withdrawn ?? 0,
          minStock: r.min_stock ?? 0,
          price: Number(r.price ?? 0),
          category: r.category ?? '',
          colors: r.colors ?? [],
          images: [],
          created_at: r.created_at,
        }));
        setItems(mapped);
      }

      if (!ordRes.error && ordRes.data) {
        const orderRows = ordRes.data as OrderProductsRow[];
        const map: Record<string, number> = {};
        for (const o of orderRows) {
          const status = (o.status || '').toLowerCase();
          if (
            status === 'cancelled' ||
            status === 'returned' ||
            status === 'ملغي' ||
            status === 'مرتجع'
          ) {
            continue;
          }
          if (!o.products) continue;
          const parts = o.products.split(/[,+]/).map((s) => s.trim());
          for (const part of parts) {
            if (!part) continue;
            let name = part;
            let qty = 1;
            const paren = part.match(/(.*?)\s*\(\s*(\d+)\s*\)/);
            const xForm = part.match(/(.*?)\s*([x×*]\s*(\d+)|(\d+)\s*[x×*])$/i);
            if (paren) {
              name = paren[1].trim();
              qty = parseInt(paren[2], 10) || 1;
            } else if (xForm) {
              name = xForm[1].trim();
              qty = parseInt(xForm[3] || xForm[4], 10) || 1;
            } else {
              const trail = part.match(/(.*?)\s*(\d+)$/);
              if (trail) {
                name = trail[1].trim();
                qty = parseInt(trail[2], 10) || 1;
              }
            }
            const key = name.trim();
            if (!key) continue;
            map[key] = (map[key] || 0) + qty;
          }
        }
        setWithdrawnByName(map);
      }
    } catch {
      setLoadError('تعذر تحميل بيانات المخزن');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadAll(false);
  }, [loadAll]);

  const handleRefresh = useCallback(() => {
    void loadAll(true);
  }, [loadAll]);

  const handleSave = useCallback(
    async (item: InventoryItem) => {
      try {
        const supabase = createClient();
        const isNew = item.id.startsWith('inv-');
        const dbItem = {
          id: isNew ? undefined : item.id,
          name: item.name,
          sku: item.sku,
          available: item.available,
          withdrawn: item.withdrawn || 0,
          min_stock: item.minStock,
          price: item.price,
          category: item.category,
          images: item.images || [],
          colors: item.colors || [],
        };
        if (isNew) {
          await supabase.from('turath_masr_inventory').insert([dbItem]);
        } else {
          await supabase.from('turath_masr_inventory').update(dbItem).eq('id', item.id);
        }
        setEditItem(undefined);
        await loadAll(true);
        // Keep the drawer in sync if we just edited the open product.
        if (drawerItem && !isNew && drawerItem.id === item.id) {
          setDrawerItem({ ...drawerItem, ...item });
        }
      } catch (err) {
        console.error('[inventory] save failed', err);
      }
    },
    [loadAll, drawerItem]
  );

  const handleDelete = useCallback(
    async (item: InventoryItem) => {
      if (typeof window === 'undefined') return;
      const confirmMessage = `هل تريد بالتأكيد حذف "${item.name}"؟ هذا الإجراء نهائي ولا يمكن التراجع عنه.`;
      if (!window.confirm(confirmMessage)) return;
      try {
        const supabase = createClient();
        await supabase.from('turath_masr_inventory').delete().eq('id', item.id);
        if (drawerItem && drawerItem.id === item.id) setDrawerItem(null);
        await loadAll(true);
      } catch (err) {
        console.error('[inventory] delete failed', err);
      }
    },
    [loadAll, drawerItem]
  );

  // ── Derived view state ────────────────────────────────────────────────
  const categories = useMemo(() => uniqueCategories(items), [items]);
  const colors = useMemo(() => uniqueColors(items), [items]);
  const stats = useMemo(() => computeStats(items, withdrawnByName), [items, withdrawnByName]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filteredItems = items.filter((item) => {
      if (!matchesStatus(item, statusFilter)) return false;
      if (category !== ALL_CATEGORIES_KEY && (item.category || '') !== category) return false;
      if (colorFilter !== ALL_COLORS_KEY && !(item.colors ?? []).some((c) => c === colorFilter)) {
        return false;
      }
      if (term) {
        const hay = `${item.name} ${item.sku} ${item.category || ''}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
    return sortInventory(filteredItems, sort);
  }, [items, search, statusFilter, category, colorFilter, sort]);

  const hasFilters =
    search.trim().length > 0 ||
    statusFilter !== 'all' ||
    category !== ALL_CATEGORIES_KEY ||
    colorFilter !== ALL_COLORS_KEY;

  const lowOrOut = stats.lowStockCount + stats.outOfStockCount;

  const handleExport = useCallback(() => {
    exportInventoryCsv(filtered);
  }, [filtered]);

  const handleAdd = useCallback(() => setEditItem(null), []);
  const handleEdit = useCallback((item: InventoryItem) => setEditItem(item), []);
  const handleView = useCallback((item: InventoryItem) => setDrawerItem(item), []);

  return (
    <AppLayout currentPath="/inventory">
      <div className="space-y-5 fade-in">
        <InventoryHeader
          onAdd={handleAdd}
          onRefresh={handleRefresh}
          onExport={items.length > 0 ? handleExport : null}
          refreshing={refreshing}
        />

        <InventoryKpiCards stats={stats} />

        {lowOrOut > 0 && !loading && !loadError && (
          <div
            className="rounded-2xl border border-amber-200 bg-amber-50 text-amber-800 px-4 py-3 flex items-center gap-2 text-sm"
            role="alert"
          >
            <AlertTriangle size={16} />
            <span className="font-semibold">
              تنبيه: توجد منتجات منخفضة أو نفدت من المخزون ({stats.lowStockCount} منخفض،{' '}
              {stats.outOfStockCount} نفد).
            </span>
          </div>
        )}

        <InventoryFilters
          search={search}
          onSearch={setSearch}
          statusFilter={statusFilter}
          onStatusFilter={setStatusFilter}
          category={category}
          categories={categories}
          onCategory={setCategory}
          colorFilter={colorFilter}
          colors={colors}
          onColorFilter={setColorFilter}
          sort={sort}
          onSort={setSort}
          view={view}
          onView={setView}
        />

        {loading ? (
          <LoadingState />
        ) : loadError ? (
          <ErrorState message={loadError} onRetry={handleRefresh} />
        ) : items.length === 0 ? (
          <EmptyState
            title="لا توجد منتجات في المخزن"
            description="ابدأ بإضافة أول منتج من زر + إضافة منتج بالأعلى."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="لا توجد منتجات مطابقة للفلاتر الحالية"
            description={
              hasFilters
                ? 'جرّب تعديل البحث أو تصفية مختلفة.'
                : 'حاول إعادة التحميل لو كانت هناك إضافات حديثة.'
            }
          />
        ) : view === 'cards' ? (
          <InventoryCardGrid
            items={filtered}
            withdrawnByName={withdrawnByName}
            onView={handleView}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        ) : (
          <InventoryTable
            items={filtered}
            withdrawnByName={withdrawnByName}
            onView={handleView}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        )}
      </div>

      {editItem !== undefined && (
        <InventoryEditModal
          item={editItem}
          allItems={items}
          categoryOptions={
            categories.length > 0 ? categories : ['حوامل', 'إكسسوارات', 'أثاث', 'كتب', 'ديكور']
          }
          onClose={() => setEditItem(undefined)}
          onSave={handleSave}
        />
      )}

      {drawerItem && (
        <InventoryDrawer
          item={drawerItem}
          withdrawn={withdrawnByName[drawerItem.name.trim()] || 0}
          onClose={() => setDrawerItem(null)}
          onEdit={(item) => {
            setDrawerItem(null);
            setEditItem(item);
          }}
          onDelete={(item) => {
            void handleDelete(item);
          }}
        />
      )}
    </AppLayout>
  );
}

function LoadingState() {
  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-white py-16 flex flex-col items-center justify-center gap-3 text-[hsl(var(--muted-foreground))]">
      <RefreshCw size={22} className="animate-spin" />
      <p className="text-sm font-semibold">جاري تحميل المخزن...</p>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 py-12 flex flex-col items-center justify-center gap-3 text-red-700">
      <AlertTriangle size={22} />
      <p className="text-sm font-semibold">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="px-4 py-1.5 bg-white border border-red-200 text-red-700 rounded-xl text-xs font-semibold hover:bg-red-100"
      >
        إعادة المحاولة
      </button>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-white py-16 flex flex-col items-center justify-center gap-3 text-[hsl(var(--muted-foreground))] text-center">
      <Package size={32} className="opacity-40" />
      <p className="text-sm font-semibold text-[hsl(var(--foreground))]">{title}</p>
      <p className="text-xs max-w-md">{description}</p>
    </div>
  );
}
