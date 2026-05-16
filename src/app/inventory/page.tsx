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
  exportAdditionsCsv,
  exportInventoryCsv,
  exportMovementsCsv,
  formatDate,
  formatMoney,
  formatNumber,
  matchesStatus,
  MOVEMENT_TYPE_LABELS_AR,
  productLifecycle,
  sortInventory,
  uniqueCategories,
  uniqueColors,
  type Category,
  type InventoryAdditionWithProduct,
  type InventoryItem,
  type InventoryMovementWithProduct,
  type LifecycleStatus,
  type MovementType,
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
import AddStockModal from './components/AddStockModal';
import InventoryMovementModal from './components/InventoryMovementModal';
import { Activity, Download, History, Plus, Search } from 'lucide-react';

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
  // Phase Inventory-Reservations-1 — undefined pre-migration. Treated as 0.
  reserved?: number | null;
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

interface AdditionWithProductRow {
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
  turath_masr_inventory: { name: string | null; sku: string | null } | null;
}

interface MovementWithProductRow {
  id: string;
  inventory_id: string;
  movement_type: string;
  quantity_delta: number | null;
  quantity_before: number | null;
  quantity_after: number | null;
  reason: string | null;
  reference_type: string | null;
  reference_id: string | null;
  order_num: string | null;
  supplier_invoice_num: string | null;
  unit_cost: number | string | null;
  total_cost: number | string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string | null;
  metadata: Record<string, unknown> | null;
  turath_masr_inventory: { name: string | null; sku: string | null } | null;
}

// Phase Inventory-Reservations-1 — `reserved` is the newest optional
// column. We try it first; if it's missing (between deploy and migration)
// we fall back to the Phase-2 column set (status/category_id/archived_*),
// then to the original LEGACY shape. Each tier is sufficient on its own
// for the page to render; missing optional columns surface as undefined
// and the UI treats them as zero / safe defaults.
const NEW_COLUMNS =
  'id, name, sku, available, withdrawn, min_stock, price, category, colors, created_at, status, category_id, archived_at, archived_by, archive_reason, updated_at, reserved';
const PRE_RESERVATIONS_COLUMNS =
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
    reserved: r.reserved ?? 0,
  };
}

export default function InventoryPage() {
  const { user, profileFullName } = useAuth();
  const perms = usePermissions();
  const isAdmin = perms.isAdmin;
  // Phase Inventory-Additions-Log-1 — stock additions require
  // manager-or-above per the RPC's auth check. We mirror that on the
  // client so the buttons hide for read-only viewers.
  const canAddStock = perms.isManagerOrAbove;
  const actorName: string | null = profileFullName ?? null;

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [categoryRows, setCategoryRows] = useState<Category[]>([]);
  const [withdrawnByName, setWithdrawnByName] = useState<Record<string, number>>({});
  const [globalAdditions, setGlobalAdditions] = useState<InventoryAdditionWithProduct[] | null>(
    null
  );
  const [additionsThisMonth, setAdditionsThisMonth] = useState<number | null>(null);
  const [globalMovements, setGlobalMovements] = useState<InventoryMovementWithProduct[] | null>(
    null
  );
  const [movementsToday, setMovementsToday] = useState<number | null>(null);
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
  const [addStockTarget, setAddStockTarget] = useState<InventoryItem | null>(null);
  // Phase Inventory-Movement-Ledger-1 — `null` means modal closed,
  // `'__GLOBAL__'` means the modal launched from the header with a
  // product picker, any item means launched from a specific product.
  const [movementTarget, setMovementTarget] = useState<InventoryItem | '__GLOBAL__' | null>(null);

  // Phase Inventory-Additions-Log-1 — local search for the global
  // additions log section. Date filters / supplier filters are out of
  // scope here; the list is capped at the latest 50 rows for now.
  const [additionsSearch, setAdditionsSearch] = useState('');
  // Phase Inventory-Movement-Ledger-1 — same pattern for the global
  // movements log section.
  const [movementsSearch, setMovementsSearch] = useState('');
  const [movementsTypeFilter, setMovementsTypeFilter] = useState<'all' | MovementType>('all');

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
        // Phase Inventory-Reservations-1 — `reserved` may be missing
        // pre-migration. Try the prior Phase 2 column shape, then the
        // original LEGACY shape.
        const invPreReservations = await supabase
          .from('turath_masr_inventory')
          .select(PRE_RESERVATIONS_COLUMNS)
          .order('created_at', { ascending: false });
        if (!invPreReservations.error) {
          invRows = (invPreReservations.data ?? []) as InventoryRowDb[];
        } else if (isMissingColumnError(invPreReservations.error)) {
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
          invError = invPreReservations.error;
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

      // 2b. Global additions log + this-month KPI — best-effort. If
      //     the table doesn't exist yet (pre-migration window) both
      //     the section and the KPI hide gracefully.
      const addRes = await supabase
        .from('turath_masr_inventory_additions')
        .select(
          'id, inventory_id, quantity, unit_cost, total_cost, supplier_id, supplier_name, supplier_invoice_num, received_at, created_by, created_by_name, note, created_at, turath_masr_inventory(name, sku)'
        )
        .order('received_at', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(50);
      if (addRes.error) {
        // Missing table → hide section + KPI silently.
        setGlobalAdditions(null);
        setAdditionsThisMonth(null);
      } else {
        const rows = (addRes.data ?? []) as unknown as AdditionWithProductRow[];
        const mapped: InventoryAdditionWithProduct[] = rows.map((r) => ({
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
          inventory_name: r.turath_masr_inventory?.name ?? '',
          inventory_sku: r.turath_masr_inventory?.sku ?? '',
        }));
        setGlobalAdditions(mapped);

        // Count units added in the current month using a separate
        // narrow query. Safe to fail silently — KPI just hides.
        try {
          const now = new Date();
          const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
          const monthRes = await supabase
            .from('turath_masr_inventory_additions')
            .select('quantity')
            .gte('received_at', monthStart);
          if (!monthRes.error && monthRes.data) {
            const total = (monthRes.data as { quantity: number | null }[]).reduce(
              (acc, r) => acc + Number(r.quantity ?? 0),
              0
            );
            setAdditionsThisMonth(total);
          } else {
            setAdditionsThisMonth(0);
          }
        } catch {
          setAdditionsThisMonth(0);
        }
      }

      // 2c. Global movements log + today KPI — best-effort. If the
      //     movements table doesn't exist yet (pre-migration window),
      //     both the section and the KPI hide gracefully.
      const movRes = await supabase
        .from('turath_masr_inventory_movements')
        .select(
          'id, inventory_id, movement_type, quantity_delta, quantity_before, quantity_after, reason, reference_type, reference_id, order_num, supplier_invoice_num, unit_cost, total_cost, created_by, created_by_name, created_at, metadata, turath_masr_inventory(name, sku)'
        )
        .order('created_at', { ascending: false })
        .limit(100);
      if (movRes.error) {
        setGlobalMovements(null);
        setMovementsToday(null);
      } else {
        const rows = (movRes.data ?? []) as unknown as MovementWithProductRow[];
        const mapped: InventoryMovementWithProduct[] = rows.map((r) => ({
          id: r.id,
          inventory_id: r.inventory_id,
          movement_type: r.movement_type as MovementType,
          quantity_delta: Number(r.quantity_delta ?? 0),
          quantity_before: Number(r.quantity_before ?? 0),
          quantity_after: Number(r.quantity_after ?? 0),
          reason: r.reason,
          reference_type: r.reference_type,
          reference_id: r.reference_id,
          order_num: r.order_num,
          supplier_invoice_num: r.supplier_invoice_num,
          unit_cost: r.unit_cost == null ? null : Number(r.unit_cost),
          total_cost: r.total_cost == null ? null : Number(r.total_cost),
          created_by: r.created_by,
          created_by_name: r.created_by_name,
          created_at: r.created_at ?? '',
          metadata: r.metadata,
          inventory_name: r.turath_masr_inventory?.name ?? '',
          inventory_sku: r.turath_masr_inventory?.sku ?? '',
        }));
        setGlobalMovements(mapped);

        try {
          const now = new Date();
          const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
          const todayRes = await supabase
            .from('turath_masr_inventory_movements')
            .select('id', { count: 'exact', head: true })
            .gte('created_at', dayStart);
          if (!todayRes.error) {
            setMovementsToday(todayRes.count ?? 0);
          } else {
            setMovementsToday(0);
          }
        } catch {
          setMovementsToday(0);
        }
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

  // Phase Inventory-Reservations-1 — show the "محجوز للطلبات" KPI +
  // sellable columns only when the `reserved` column is actually
  // present on the loaded rows (i.e. post-migration). Pre-migration
  // rows return `reserved: 0` from `mapInventoryRow` (defensive
  // default), but we don't want to show a uniformly-zero column to
  // users before the feature is live. We surface it whenever ANY
  // row in the live dataset reports `reserved > 0`. The first
  // successful reservation flips the entire UI on automatically.
  const reservationsAvailable = useMemo(() => items.some((i) => (i.reserved ?? 0) > 0), [items]);

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
  const handleAddStock = useCallback((item: InventoryItem) => setAddStockTarget(item), []);

  const handleAddStockDone = useCallback(async () => {
    await loadAll(true);
  }, [loadAll]);

  const handleRecordMovement = useCallback((item: InventoryItem) => setMovementTarget(item), []);
  const handleRecordGlobalMovement = useCallback(() => setMovementTarget('__GLOBAL__'), []);
  const handleMovementDone = useCallback(async () => {
    await loadAll(true);
  }, [loadAll]);

  // Filter additions for the global section by free-text on
  // product/SKU/supplier/invoice. Date filtering is out of scope here;
  // the underlying query already caps at the latest 50 rows.
  const filteredAdditions = useMemo(() => {
    if (!globalAdditions) return [];
    const term = additionsSearch.trim().toLowerCase();
    if (!term) return globalAdditions;
    return globalAdditions.filter((row) => {
      const hay =
        `${row.inventory_name} ${row.inventory_sku} ${row.supplier_name ?? ''} ${row.supplier_invoice_num ?? ''}`.toLowerCase();
      return hay.includes(term);
    });
  }, [globalAdditions, additionsSearch]);

  const handleAdditionsExport = useCallback(() => {
    exportAdditionsCsv(filteredAdditions);
  }, [filteredAdditions]);

  const filteredMovements = useMemo(() => {
    if (!globalMovements) return [];
    const term = movementsSearch.trim().toLowerCase();
    return globalMovements.filter((row) => {
      if (movementsTypeFilter !== 'all' && row.movement_type !== movementsTypeFilter) return false;
      if (!term) return true;
      const hay =
        `${row.inventory_name} ${row.inventory_sku} ${row.reason ?? ''} ${row.order_num ?? ''} ${row.supplier_invoice_num ?? ''}`.toLowerCase();
      return hay.includes(term);
    });
  }, [globalMovements, movementsSearch, movementsTypeFilter]);

  const handleMovementsExport = useCallback(() => {
    exportMovementsCsv(filteredMovements);
  }, [filteredMovements]);

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
          onRecordMovement={canAddStock && items.length > 0 ? handleRecordGlobalMovement : null}
          refreshing={refreshing}
        />

        <InventoryKpiCards
          stats={stats}
          additionsThisMonth={additionsThisMonth}
          movementsToday={movementsToday}
          showReservations={reservationsAvailable}
        />

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
            canAddStock={canAddStock}
            onView={handleView}
            onEdit={handleEdit}
            onArchive={handleArchive}
            onAddStock={handleAddStock}
            onRecordMovement={handleRecordMovement}
          />
        ) : (
          <InventoryTable
            items={filtered}
            withdrawnByName={withdrawnByName}
            canAddStock={canAddStock}
            onView={handleView}
            onEdit={handleEdit}
            onArchive={handleArchive}
            onAddStock={handleAddStock}
            onRecordMovement={handleRecordMovement}
          />
        )}

        {/* Phase Inventory-Movement-Ledger-1 — global movements log
            renders first (most recent activity); hidden pre-migration. */}
        {globalMovements !== null && !loading && !loadError && (
          <GlobalMovementsSection
            movements={filteredMovements}
            search={movementsSearch}
            onSearchChange={setMovementsSearch}
            typeFilter={movementsTypeFilter}
            onTypeFilterChange={setMovementsTypeFilter}
            onExport={handleMovementsExport}
            canExport={filteredMovements.length > 0}
          />
        )}

        {/* Phase Inventory-Additions-Log-1 — global additions log.
            Hidden when the additions table is missing (pre-migration).
            Renders an honest empty state when the table is present
            but empty. */}
        {globalAdditions !== null && !loading && !loadError && (
          <GlobalAdditionsSection
            additions={filteredAdditions}
            search={additionsSearch}
            onSearchChange={setAdditionsSearch}
            onExport={handleAdditionsExport}
            canExport={filteredAdditions.length > 0}
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
          canAddStock={canAddStock}
          onClose={() => setDrawerItem(null)}
          onEdit={(item) => {
            setDrawerItem(null);
            setEditItem(item);
          }}
          onArchive={handleArchive}
          onSetStatus={handleSetStatus}
          onRestore={handleRestore}
          onAddStock={handleAddStock}
          onRecordMovement={handleRecordMovement}
        />
      )}

      {addStockTarget && (
        <AddStockModal
          item={addStockTarget}
          allItems={items}
          actorId={user?.id ?? null}
          actorName={actorName}
          onClose={() => setAddStockTarget(null)}
          onSaved={handleAddStockDone}
        />
      )}

      {movementTarget && (
        <InventoryMovementModal
          item={movementTarget === '__GLOBAL__' ? null : movementTarget}
          allItems={items}
          actorId={user?.id ?? null}
          actorName={actorName}
          onClose={() => setMovementTarget(null)}
          onSaved={handleMovementDone}
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

function GlobalMovementsSection({
  movements,
  search,
  onSearchChange,
  typeFilter,
  onTypeFilterChange,
  onExport,
  canExport,
}: {
  movements: InventoryMovementWithProduct[];
  search: string;
  onSearchChange: (v: string) => void;
  typeFilter: 'all' | MovementType;
  onTypeFilterChange: (t: 'all' | MovementType) => void;
  onExport: () => void;
  canExport: boolean;
}) {
  const typeOptions: { key: 'all' | MovementType; label: string }[] = [
    { key: 'all', label: 'الكل' },
    { key: 'addition', label: MOVEMENT_TYPE_LABELS_AR.addition },
    { key: 'manual_in', label: MOVEMENT_TYPE_LABELS_AR.manual_in },
    { key: 'manual_out', label: MOVEMENT_TYPE_LABELS_AR.manual_out },
    { key: 'damage_out', label: MOVEMENT_TYPE_LABELS_AR.damage_out },
    { key: 'return_in', label: MOVEMENT_TYPE_LABELS_AR.return_in },
    { key: 'stock_count_adjustment', label: MOVEMENT_TYPE_LABELS_AR.stock_count_adjustment },
    { key: 'correction', label: MOVEMENT_TYPE_LABELS_AR.correction },
  ];

  return (
    <section className="space-y-3" dir="rtl">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-bold text-[hsl(var(--foreground))] flex items-center gap-2">
          <Activity size={18} className="text-[hsl(var(--primary))]" />
          سجل حركة المخزون
        </h2>
        <button
          type="button"
          onClick={onExport}
          disabled={!canExport}
          className="text-xs rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-1.5 flex items-center gap-1.5 hover:bg-[hsl(var(--muted))]/40 disabled:opacity-50"
        >
          <Download size={13} />
          تصدير CSV
        </button>
      </div>

      <div className="rounded-2xl border border-[hsl(var(--border))] bg-white overflow-hidden">
        <div className="p-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 space-y-2">
          <div className="relative">
            <Search
              size={14}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="بحث بالمنتج أو SKU أو السبب أو رقم الطلب..."
              className="w-full pr-9 pl-3 py-2 text-xs border border-[hsl(var(--border))] bg-white rounded-xl focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
            />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {typeOptions.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => onTypeFilterChange(opt.key)}
                className={`text-[11px] px-2.5 py-1 rounded-xl font-semibold transition-colors ${
                  typeFilter === opt.key
                    ? 'bg-[hsl(217,80%,30%)] text-white'
                    : 'bg-white border border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]/40'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {movements.length === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center gap-2 text-[hsl(var(--muted-foreground))] text-sm">
            <Activity size={28} className="opacity-30" />
            <p>لا توجد حركات مسجلة بعد.</p>
          </div>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[hsl(var(--muted))]/40 border-b border-[hsl(var(--border))]">
                  {[
                    'التاريخ',
                    'المنتج',
                    'SKU',
                    'نوع الحركة',
                    'التغيير',
                    'قبل',
                    'بعد',
                    'السبب',
                    'المرجع',
                    'المستخدم',
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
                {movements.slice(0, 100).map((row) => (
                  <tr key={row.id} className="hover:bg-[hsl(var(--muted))]/30 align-top">
                    <td className="px-3 py-2 text-xs text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                      {formatDate(row.created_at)}
                    </td>
                    <td className="px-3 py-2 text-xs font-semibold truncate max-w-[160px]">
                      {row.inventory_name || '—'}
                    </td>
                    <td className="px-3 py-2 text-xs font-mono text-[hsl(var(--muted-foreground))]">
                      {row.inventory_sku || '—'}
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">
                      {MOVEMENT_TYPE_LABELS_AR[row.movement_type] ?? row.movement_type}
                    </td>
                    <td
                      className={`px-3 py-2 font-mono text-xs font-bold ${
                        row.quantity_delta > 0
                          ? 'text-emerald-700'
                          : row.quantity_delta < 0
                            ? 'text-red-600'
                            : 'text-[hsl(var(--muted-foreground))]'
                      }`}
                    >
                      {row.quantity_delta > 0 ? '+' : ''}
                      {formatNumber(row.quantity_delta)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {formatNumber(row.quantity_before)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs font-bold">
                      {formatNumber(row.quantity_after)}
                    </td>
                    <td className="px-3 py-2 text-xs truncate max-w-[140px]">
                      {row.reason || '—'}
                    </td>
                    <td className="px-3 py-2 text-xs font-mono">
                      {row.order_num || row.supplier_invoice_num || '—'}
                    </td>
                    <td className="px-3 py-2 text-xs">{row.created_by_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function GlobalAdditionsSection({
  additions,
  search,
  onSearchChange,
  onExport,
  canExport,
}: {
  additions: InventoryAdditionWithProduct[];
  search: string;
  onSearchChange: (v: string) => void;
  onExport: () => void;
  canExport: boolean;
}) {
  return (
    <section className="space-y-3" dir="rtl">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-bold text-[hsl(var(--foreground))] flex items-center gap-2">
          <History size={18} className="text-[hsl(var(--primary))]" />
          سجل إضافات المنتجات
        </h2>
        <button
          type="button"
          onClick={onExport}
          disabled={!canExport}
          className="text-xs rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-1.5 flex items-center gap-1.5 hover:bg-[hsl(var(--muted))]/40 disabled:opacity-50"
        >
          <Download size={13} />
          تصدير CSV
        </button>
      </div>

      <div className="rounded-2xl border border-[hsl(var(--border))] bg-white overflow-hidden">
        <div className="p-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30">
          <div className="relative">
            <Search
              size={14}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="بحث بالمنتج أو SKU أو المورد أو رقم الفاتورة..."
              className="w-full pr-9 pl-3 py-2 text-xs border border-[hsl(var(--border))] bg-white rounded-xl focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
            />
          </div>
        </div>

        {additions.length === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center gap-2 text-[hsl(var(--muted-foreground))] text-sm">
            <Plus size={28} className="opacity-30" />
            <p>لا توجد إضافات مسجلة بعد.</p>
          </div>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[hsl(var(--muted))]/40 border-b border-[hsl(var(--border))]">
                  {[
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
                {additions.slice(0, 50).map((row) => (
                  <tr key={row.id} className="hover:bg-[hsl(var(--muted))]/30 align-top">
                    <td className="px-3 py-2 text-xs text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                      {formatDate(row.received_at)}
                    </td>
                    <td className="px-3 py-2 text-xs font-semibold truncate max-w-[160px]">
                      {row.inventory_name || '—'}
                    </td>
                    <td className="px-3 py-2 text-xs font-mono text-[hsl(var(--muted-foreground))]">
                      {row.inventory_sku || '—'}
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
                    <td className="px-3 py-2 text-xs font-mono">
                      {row.supplier_invoice_num || '—'}
                    </td>
                    <td className="px-3 py-2 text-xs">{row.created_by_name || '—'}</td>
                    <td className="px-3 py-2 text-xs text-[hsl(var(--muted-foreground))] truncate max-w-[180px]">
                      {row.note || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
