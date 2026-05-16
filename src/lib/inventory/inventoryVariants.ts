// ─────────────────────────────────────────────────────────────────────────────
// src/lib/inventory/inventoryVariants.ts
//
// Phase Inventory-Variants-1B3 — shared loader for the inventory-ops
// modals (AddStock, StockCount, InventoryMovement). The order-flow
// surfaces have their own loader in `src/lib/orders/productCards.ts`
// (which attaches variants to product cards). For the operator-facing
// inventory ops surfaces we just need "give me the variants for this
// inventory id" — keep that thin and best-effort: if the table is
// missing (pre-migration) we return an empty array so the picker
// silently hides itself.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js';
import type { InventoryVariant, LifecycleStatus } from './inventoryStats';

interface RawVariantRow {
  id: string;
  inventory_id: string;
  variant_type: string | null;
  variant_value: string | null;
  variant_label: string | null;
  sku: string | null;
  barcode: string | null;
  available: number | null;
  reserved: number | null;
  min_stock: number | null;
  status: string | null;
  sort_order: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
}

function mapVariant(r: RawVariantRow): InventoryVariant {
  const rawStatus = (r.status ?? 'active') as string;
  const lifecycle: LifecycleStatus =
    rawStatus === 'inactive' || rawStatus === 'archived'
      ? (rawStatus as LifecycleStatus)
      : 'active';
  return {
    id: r.id,
    inventory_id: r.inventory_id,
    variant_type: r.variant_type ?? 'color',
    variant_value: r.variant_value ?? '',
    variant_label: r.variant_label ?? r.variant_value ?? '',
    sku: r.sku,
    barcode: r.barcode,
    available: Number(r.available ?? 0),
    reserved: Number(r.reserved ?? 0),
    min_stock: Number(r.min_stock ?? 0),
    status: lifecycle,
    sort_order: Number(r.sort_order ?? 0),
    metadata: r.metadata,
    created_at: r.created_at ?? '',
    updated_at: r.updated_at ?? '',
  };
}

/** Fetch the active variants for one inventory row, ordered by
 *  `sort_order` then label. Returns `[]` (not an error) when the
 *  table is missing or when no variants are seeded — callers should
 *  treat an empty array as "no picker needed, fall through to base
 *  product behaviour". */
export async function loadInventoryVariantsForProduct(
  supabase: SupabaseClient,
  inventoryId: string
): Promise<InventoryVariant[]> {
  if (!inventoryId) return [];
  const { data, error } = await supabase
    .from('turath_masr_inventory_variants')
    .select(
      'id, inventory_id, variant_type, variant_value, variant_label, sku, barcode, available, reserved, min_stock, status, sort_order, metadata, created_at, updated_at'
    )
    .eq('inventory_id', inventoryId)
    .eq('status', 'active')
    .order('sort_order', { ascending: true })
    .order('variant_label', { ascending: true });
  if (error) {
    // Pre-migration: table doesn't exist. Anything else is a
    // transient error — either way, returning [] hides the picker
    // and preserves base-product behaviour rather than blocking the
    // operator's submit.
    return [];
  }
  return (data as RawVariantRow[]).map(mapVariant);
}

/** Sellable count for a variant, mirroring the base-product helper
 *  in `inventoryStats.ts`. Floored at 0 so a stale over-reservation
 *  doesn't surface as a negative. */
export function variantSellableQty(v: Pick<InventoryVariant, 'available' | 'reserved'>): number {
  return Math.max(0, (v.available || 0) - (v.reserved || 0));
}
