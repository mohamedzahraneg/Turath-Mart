// ─────────────────────────────────────────────────────────────────────────────
// src/app/inventory/page.tsx
//
// Phase Inventory-UI-Redesign-1 — redesigned inventory dashboard.
// Phase Inventory-Categories-Safer-Archive-1 — adds:
//
//   • Lifecycle status (active / inactive / archived) with extended
//     filter chips and a default of "نشط" so archived rows don't
//     clutter the default view.
//   • Hard delete REPLACED with archive — `update({status:'archived',
//     archived_at, archived_by, archive_reason})`. No more
//     `.delete()` on `turath_masr_inventory`.
//   • Active ↔ inactive toggle (via drawer settings) and a "استعادة
//     من الأرشيف" restore button for admins.
//   • Categories pulled from the new `turath_masr_inventory_categories`
//     table (with graceful fallback to the legacy unique-from-rows
//     list if the table is missing — i.e. the brief window between
//     deploy and migration apply).
//   • KPI cards now exclude archived rows from totals (lifecycle
//     active+inactive only).
//   • CSV export gains 3 columns (الحالة / سبب الأرشفة / تاريخ
//     الأرشفة).
//   • The inventory fetch uses a graceful try/fallback: it first
//     selects the new columns (`status`, `category_id`, `archived_*`,
//     `updated_at`) and falls back to the legacy column list if the
//     migration hasn't been applied yet, so the page never crashes
//     mid-rollout.
//
// What still does NOT ship here (deferred):
//   • Movements ledger, additions log, variants, suppliers, cost
//     price, order-flow integration, supplier purchases.
// ─────────────────────────────────────────────────────────────────────────────
'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Package, RefreshCw } from 'lucide-react';

import AppLayout from '@/components/AppLayout';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { createClient } from '@/lib/supabase/client';
import {
  computeStats,
  exportInventoryCsv,
  matchesStatus,
  productLifecycle,
  sortInventory,
  uniqueCategories,
  uniqueColors,
  type Category,
  type InventoryItem,
  type LifecycleStatus,
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
  // Optional columns — present after the migration applies, undefined
  // otherwise. Treated as `status='active'` when missing.
  status?: string | null;
  category_id?: string | null;
  archived_at?: string | null;
  archived_by?: string | null;
  archive_reason?: string | null;
  updated_at?: string | null;
}

interface OrderProductsRow {
  products: string | null;
  status: string | null;
}

interface CategoryRowDb {
  id: string;
  name: string;
  slug: string;
  sort_order: number | null;
  is_active: boolean | null;
}

const NEW_COLUMNS =
  'id, name, sku, available, withdrawn, min_stock, price, category, colors, created_at, status, category_id, archived_at, archived_by, archive_reason, updated_at';
const LEGACY_COLUMNS =
  'id, name, sku, available, withdrawn, min_stock, price, category, colors, created_at';

function isMissingColumnError(err: { message?: string | null } | null | undefined): boolean {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  return msg.includes('does not exist') || msg.includes('column');
}

function mapInventoryRow(r: InventoryRowDb): InventoryItem {
  const rawStatus = (r.status ?? 'active') as string;
  const status: LifecycleStatus =
    rawStatus === 'inactive' || rawStatus === 'archived' ? rawStatus : 'active';
  return {
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
    status,
    category_id: r.category_id ?? null,
    archived_at: r.archived_at ?? null,
    archived_by: r.archived_by ?? null,
    archive_reason: r.archive_reason ?? null,
    updated_at: r.updated_at ?? null,
  };
}

export default function InventoryPage() {
  const { user } = useAuth();
  const perms = usePermissions();
  const isAdmin = perms.isAdmin;

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [categoryRows, setCategoryRows] = useState<Category[]>([]);
  const [withdrawnByName, setWithdrawnByName] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filters — default = 'active' so archived hide unless explicitly chosen.
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
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

      // 1. Inventory — try new columns first, fall back to legacy on
      //    missing-column errors (covers the deploy-before-migration
      //    window).
      let invRows: InventoryRowDb[] = [];
      let invError: { message?: string | null } | null = null;

      const invNew = await supabase
        .from('turath_masr_inventory')
        .select(NEW_COLUMNS)
        .order('created_at', { ascending: false });
      if (!invNew.error) {
        invRows = (invNew.data ?? []) as InventoryRowDb[];
      } else if (isMissingColumnError(invNew.error)) {
        const invLegacy = await supabase
          .from('turath_masr_inventory')
          .select(LEGACY_COLUMNS)
          .order('created_at', { ascending: false });
        if (!invLegacy.error) {
          invRows = (invLegacy.data ?? []) as InventoryRowDb[];
        } else {
          invError = invLegacy.error;
        }
      } else {
        invError = invNew.error;
      }

      if (invError) {
        setLoadError('تعذر تحميل بيانات المخزن');
        setItems([]);
      } else {
        setItems(invRows.map(mapInventoryRow));
      }

      // 2. Categories — best-effort. Missing-table is silent (the
      //    page falls back to deriving categories from the
      //    `category` text values on the inventory rows).
      const catRes = await supabase
        .from('turath_masr_inventory_categories')
        .select('id, name, slug, sort_order, is_active')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      if (!catRes.error && catRes.data) {
        const rows = catRes.data as CategoryRowDb[];
        setCategoryRows(
          rows.map((c) => ({
            id: c.id,
            name: c.name,
            slug: c.slug,
            sort_order: c.sort_order ?? 100,
            is_active: c.is_active ?? true,
          }))
        );
      }

      // 3. Orders → withdrawn map (preserved from prior phase).
      const ordRes = await supabase.from('turath_masr_orders').select('products, status');
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

  // Lookup a category by its display name (used when saving so we can
  // populate `category_id` alongside the legacy text `category`).
  const findCategoryByName = useCallback(
    (name: string): Category | null => {
      const trimmed = (name || '').trim();
      if (!trimmed) return null;
      return categoryRows.find((c) => c.name === trimmed) ?? null;
    },
    [categoryRows]
  );

  const handleSave = useCallback(
    async (item: InventoryItem) => {
      try {
        const supabase = createClient();
        const isNew = item.id.startsWith('inv-');
        const matchedCategory = findCategoryByName(item.category);
        const baseItem = {
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
          // Try the new shape first (includes status + category_id).
          // Fall back to the legacy shape if those columns are missing.
          const newShape = {
            ...baseItem,
            status: 'active' as const,
            ...(matchedCategory ? { category_id: matchedCategory.id } : {}),
          };
          const ins = await supabase.from('turath_masr_inventory').insert([newShape]);
          if (ins.error && isMissingColumnError(ins.error)) {
            await supabase.from('turath_masr_inventory').insert([baseItem]);
          }
        } else {
          const updateShape = {
            ...baseItem,
            ...(matchedCategory ? { category_id: matchedCategory.id } : {}),
          };
          const upd = await supabase
            .from('turath_masr_inventory')
            .update(updateShape)
            .eq('id', item.id);
          if (upd.error && isMissingColumnError(upd.error)) {
            await supabase.from('turath_masr_inventory').update(baseItem).eq('id', item.id);
          }
        }

        setEditItem(undefined);
        await loadAll(true);
        if (drawerItem && !isNew && drawerItem.id === item.id) {
          setDrawerItem({ ...drawerItem, ...item });
        }
      } catch (err) {
        console.error('[inventory] save failed', err);
      }
    },
    [loadAll, drawerItem, findCategoryByName]
  );

  const handleArchive = useCallback(
    async (item: InventoryItem) => {
      if (typeof window === 'undefined') return;
      if (productLifecycle(item) === 'archived') return;
      const confirmMessage = `هل تريد أرشفة "${item.name}"؟\nلن يظهر المنتج في الطلبات الجديدة أو الاختيارات النشطة، لكن بياناته وسجله ستبقى محفوظة.`;
      if (!window.confirm(confirmMessage)) return;
      try {
        const supabase = createClient();
        const payload = {
          status: 'archived' as const,
          archived_at: new Date().toISOString(),
          archived_by: user?.id ?? null,
          archive_reason: 'أرشفة من صفحة المخزن',
        };
        const res = await supabase.from('turath_masr_inventory').update(payload).eq('id', item.id);
        if (res.error) {
          if (isMissingColumnError(res.error)) {
            window.alert(
              'الأرشفة تتطلب تطبيق الترحيل (Migration) الجديد على قاعدة البيانات أولًا.'
            );
          } else {
            console.error('[inventory] archive failed', res.error);
          }
          return;
        }
        if (drawerItem && drawerItem.id === item.id) setDrawerItem(null);
        await loadAll(true);
      } catch (err) {
        console.error('[inventory] archive failed', err);
      }
    },
    [loadAll, drawerItem, user?.id]
  );

  const handleSetStatus = useCallback(
    async (item: InventoryItem, nextStatus: 'active' | 'inactive') => {
      try {
        const supabase = createClient();
        const res = await supabase
          .from('turath_masr_inventory')
          .update({ status: nextStatus })
          .eq('id', item.id);
        if (res.error) {
          if (isMissingColumnError(res.error)) {
            window.alert(
              'تغيير الحالة يتطلب تطبيق الترحيل (Migration) الجديد على قاعدة البيانات أولًا.'
            );
          } else {
            console.error('[inventory] set status failed', res.error);
          }
          return;
        }
        await loadAll(true);
        if (drawerItem && drawerItem.id === item.id) {
          setDrawerItem({ ...drawerItem, status: nextStatus });
        }
      } catch (err) {
        console.error('[inventory] set status failed', err);
      }
    },
    [loadAll, drawerItem]
  );

  const handleRestore = useCallback(
    async (item: InventoryItem) => {
      if (!isAdmin) return;
      try {
        const supabase = createClient();
        const res = await supabase
          .from('turath_masr_inventory')
          .update({
            status: 'active',
            archived_at: null,
            archived_by: null,
            archive_reason: null,
          })
          .eq('id', item.id);
        if (res.error) {
          if (isMissingColumnError(res.error)) {
            window.alert('الاستعادة من الأرشيف تتطلب تطبيق الترحيل (Migration) الجديد أولًا.');
          } else {
            console.error('[inventory] restore failed', res.error);
          }
          return;
        }
        await loadAll(true);
        if (drawerItem && drawerItem.id === item.id) {
          setDrawerItem({
            ...drawerItem,
            status: 'active',
            archived_at: null,
            archived_by: null,
            archive_reason: null,
          });
        }
      } catch (err) {
        console.error('[inventory] restore failed', err);
      }
    },
    [loadAll, drawerItem, isAdmin]
  );

  // ── Derived view state ────────────────────────────────────────────────
  // Categories: prefer DB rows; fall back to derived-from-inventory.
  const categoryNames = useMemo(() => {
    if (categoryRows.length > 0) return categoryRows.map((c) => c.name);
    return uniqueCategories(items);
  }, [categoryRows, items]);

  const colors = useMemo(() => uniqueColors(items), [items]);

  // KPI cards exclude archived rows so "قيمة المخزون" reflects only
  // sellable inventory.
  const nonArchivedItems = useMemo(
    () => items.filter((i) => productLifecycle(i) !== 'archived'),
    [items]
  );
  const stats = useMemo(
    () => computeStats(nonArchivedItems, withdrawnByName),
    [nonArchivedItems, withdrawnByName]
  );

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
    statusFilter !== 'active' ||
    category !== ALL_CATEGORIES_KEY ||
    colorFilter !== ALL_COLORS_KEY;

  const lowOrOut = stats.lowStockCount + stats.outOfStockCount;

  const handleExport = useCallback(() => {
    exportInventoryCsv(filtered);
  }, [filtered]);

  const handleAdd = useCallback(() => setEditItem(null), []);
  const handleEdit = useCallback((item: InventoryItem) => setEditItem(item), []);
  const handleView = useCallback((item: InventoryItem) => setDrawerItem(item), []);

  // Fallback category list for the edit modal — DB list when present,
  // derived names otherwise, plus a safety fallback for first-run
  // empty databases.
  const editModalCategoryOptions =
    categoryNames.length > 0
      ? categoryNames
      : ['حامل مصحف', 'مصحف', 'كشاف', 'كرسي', 'كعبة', 'قطع صيانة', 'تغليف', 'هدايا', 'أخرى'];

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
          categories={categoryNames}
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
            onArchive={handleArchive}
          />
        ) : (
          <InventoryTable
            items={filtered}
            withdrawnByName={withdrawnByName}
            onView={handleView}
            onEdit={handleEdit}
            onArchive={handleArchive}
          />
        )}
      </div>

      {editItem !== undefined && (
        <InventoryEditModal
          item={editItem}
          allItems={items}
          categoryOptions={editModalCategoryOptions}
          onClose={() => setEditItem(undefined)}
          onSave={handleSave}
        />
      )}

      {drawerItem && (
        <InventoryDrawer
          item={drawerItem}
          withdrawn={withdrawnByName[drawerItem.name.trim()] || 0}
          isAdmin={isAdmin}
          onClose={() => setDrawerItem(null)}
          onEdit={(item) => {
            setDrawerItem(null);
            setEditItem(item);
          }}
          onArchive={handleArchive}
          onSetStatus={handleSetStatus}
          onRestore={handleRestore}
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
