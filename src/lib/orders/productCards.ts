// ─────────────────────────────────────────────────────────────────────────────
// src/lib/orders/productCards.ts
//
// Phase Orders-Edit-2 — single source of truth for the product-card
// grid + the draft-line shape used by both AddOrderModal (create
// flow) and EditOrderModal (edit flow). Previously these primitives
// lived inline in AddOrderModal; lifting them lets both modals share
// the same UX without copy-paste drift.
//
// What lives here
// ---------------
//   • `InventoryItem` — narrow projection of `turath_masr_inventory`
//     used by the order modals (id / name / sku / available / price /
//     category / colors). Images are NEVER fetched here; the modal
//     reads thumbnails lazily via `inventoryThumbnailUrl(id)`.
//   • `ProductCard` — display-shape for the clickable product grid.
//     Built from a mix of the static `PRODUCT_TYPES` catalog and the
//     live inventory rows. Carries `isInventory` so stock checks can
//     fire only on inventory-backed cards.
//   • `DraftOrderLine` — the line shape used in modal state. Mirrors
//     `OrderLine` in AddOrderModal but lives here so both modals
//     import the same type. Add/remove/update operations are pure
//     mutators on this shape.
//   • `createDraftLine(productType, basePrice)` — factory with a
//     stable random id.
//   • `loadProductCards(supabase)` — fetches inventory + builds the
//     unified ProductCard list. Same shape AddOrderModal builds
//     today; lifted here verbatim.
//   • `resolveLineColors(card)` — returns the color palette for a
//     given product card. Inventory rows supply their own colors;
//     the static `holder` product falls back to the canonical
//     `HOLDER_COLORS`.
//
// What is NOT here
// ----------------
//   • No React. Pure TS module so it stays trivial to test + reuse
//     from API routes if a future server-side flow needs it.
//   • No total recompute. Each modal owns its own totals + envelope
//     building — this module only describes the line and its
//     surrounding catalog.
//   • No checkout envelope logic. That stays in `checkoutDetails.ts`.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js';
import { inventoryThumbnailUrl } from '@/lib/inventory/InventoryThumbnail';

// ─── Canonical static catalog ────────────────────────────────────────────
//
// Mirrors `PRODUCT_TYPES` in AddOrderModal. Re-exported here so future
// callers can import from a single place; AddOrderModal continues to
// re-export its own copy for backward compatibility with existing
// imports.
export const STATIC_PRODUCT_TYPES = [
  { value: 'holder', label: 'حامل مصحف', basePrice: 300, emoji: '📿', hasColor: true },
  { value: 'flashlight', label: 'كشاف', basePrice: 150, emoji: '🔦', hasColor: false },
  { value: 'chair', label: 'كرسي', basePrice: 600, emoji: '🪑', hasColor: false },
  { value: 'quran', label: 'مصحف', basePrice: 140, emoji: '📖', hasColor: false },
  { value: 'kaaba', label: 'كعبة', basePrice: 450, emoji: '🕋', hasColor: false },
] as const;

// Canonical holder colour palette. Inventory rows that carry their
// own `colors` array override this; the fallback is used for the
// static `holder` product type.
export const HOLDER_COLOR_PALETTE = [
  { value: 'brown', label: 'بني', hex: '#8B4513' },
  { value: 'black', label: 'أسود', hex: '#1a1a1a' },
  { value: 'white', label: 'أبيض', hex: '#f5f5f5' },
  { value: 'gold', label: 'ذهبي', hex: '#FFD700' },
  { value: 'pearl', label: 'صدف', hex: '#EAE0C8' },
] as const;

export type ColorOption = { value: string; label: string; hex: string };

// ─── Types ───────────────────────────────────────────────────────────────

export interface InventoryItem {
  id: string;
  name: string;
  sku: string;
  available: number;
  price: number;
  category: string;
  colors: string[];
}

export interface ProductCard {
  value: string;
  label: string;
  basePrice: number;
  emoji: string;
  hasColor: boolean;
  image?: string;
  isInventory?: boolean;
  colors?: string[];
  category?: string;
  /** Phase Inventory-Order-Identity-1 — explicit inventory id for
   *  inventory-backed cards (mirrors `turath_masr_inventory.id`).
   *  `null` / `undefined` for static catalog cards. Future stock
   *  RPCs always read identity from here, never from `value`. */
  id?: string | null;
  /** Phase Inventory-Order-Identity-1 — SKU snapshot at card-load
   *  time. Stays frozen on the saved order line so historical
   *  display doesn't change if inventory.sku is renamed later. */
  sku?: string | null;
}

export interface DraftOrderLine {
  /** Stable client-side id used as React key. Persisted under the
   *  `lineDraftId` field if the modal opts to round-trip it. */
  id: string;
  productType: string;
  color: string;
  quantity: number;
  unitPrice: number;
  includeFlashlight: boolean;
  flashlightPrice: number;
  /** Display label (frozen at the time the line was added).
   *  Optional — modals can derive it from a product card lookup
   *  when missing. */
  label?: string;
  /** Phase Egress-Fix1 — carried forward from the original DB row
   *  on edit flows so a color-only edit doesn't drop the image
   *  metadata. Never base64; either `image_source = 'inventory'` +
   *  a derived thumbnail URL, or `image_source = 'storage'` + a
   *  signed bucket path. */
  image?: string | null;
  image_source?: 'inventory' | 'storage' | 'none';
  image_path?: string | null;
  emoji?: string;
  /** Phase Inventory-Order-Identity-1 — canonical inventory id when
   *  this line came from an inventory-backed card (or was inferred
   *  from a legacy `productType` UUID). `null` for static products.
   *  Stock-affecting phases (reservation, fulfillment, returns)
   *  read identity from here. */
  inventory_id?: string | null;
  /** Phase Inventory-Order-Identity-1 — SKU snapshot captured at
   *  add-time. Frozen — never re-fetched from live inventory. */
  sku?: string | null;
  /** Optional carry-through note (the EditOrderModal preserves it
   *  on same-product edits). Declared here so the type covers the
   *  full draft round-trip. */
  note?: string | null;
}

// ─── Factory ─────────────────────────────────────────────────────────────

let _lineCounter = 0;

/** Stable unique line id. Prefers crypto.randomUUID when available
 *  (browser + edge runtimes) and falls back to a monotonic counter +
 *  timestamp so server-side renders never collide. */
function generateLineId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `line-${crypto.randomUUID()}`;
  }
  _lineCounter += 1;
  return `line-${Date.now()}-${_lineCounter}`;
}

/** Build a fresh draft line. The price is captured from the card at
 *  add-time so a subsequent inventory edit doesn't change historical
 *  lines in the current modal session. */
export function createDraftLine(card: ProductCard): DraftOrderLine {
  const defaultColor =
    card.colors && card.colors.length > 0
      ? card.colors[0]
      : card.value === 'holder'
        ? HOLDER_COLOR_PALETTE[0].value
        : '';
  // Phase Inventory-Order-Identity-1 — capture identity from the
  // card so saves can persist `inventory_id` + `sku` without
  // re-running the resolution at serialize-time.
  const inventoryId =
    card.id && card.id.trim() ? card.id.trim() : card.isInventory ? card.value : null;
  const sku = card.sku && String(card.sku).trim() ? String(card.sku).trim() : null;
  return {
    id: generateLineId(),
    productType: card.value,
    color: defaultColor,
    quantity: 1,
    unitPrice: Number.isFinite(card.basePrice) ? card.basePrice : 0,
    includeFlashlight: false,
    flashlightPrice: 150,
    label: card.label,
    image: card.image ?? undefined,
    image_source: card.isInventory ? 'inventory' : undefined,
    emoji: card.emoji,
    inventory_id: inventoryId,
    sku: inventoryId ? sku : null,
  };
}

// ─── Catalog loader ──────────────────────────────────────────────────────

interface RawInventoryRow {
  id: string;
  name: string;
  sku: string | null;
  available: number | null;
  price: number | null;
  category: string | null;
  colors: string[] | null;
  status?: string | null;
}

/** Load the merged product catalog: live inventory rows + (optionally)
 *  the static product types when the inventory list is empty. We
 *  intentionally DO NOT mix the static catalog with the inventory
 *  catalog when both exist — admin-managed inventory rows always win
 *  to avoid duplicates when an inventory entry shares a name with a
 *  static type.
 *
 *  Phase Inventory-Categories-Safer-Archive-1 — the order modals only
 *  ever pick from `status = 'active'` rows. Archived and inactive
 *  products stay in the inventory page but disappear from the order
 *  picker. The query falls back to the legacy column shape if the
 *  `status` column doesn't exist yet (e.g. between deploy and
 *  migration apply), so AddOrder / EditOrder never crash mid-rollout. */
export async function loadProductCards(
  supabase: SupabaseClient
): Promise<{ items: InventoryItem[]; cards: ProductCard[] }> {
  let rows: RawInventoryRow[] | null = null;

  const withStatus = await supabase
    .from('turath_masr_inventory')
    .select('id, name, sku, available, price, category, colors, status')
    .eq('status', 'active');
  if (!withStatus.error) {
    rows = (withStatus.data as RawInventoryRow[] | null) ?? [];
  } else {
    // 42703 = undefined column. Other errors get logged and treated as empty.
    const msg = (withStatus.error.message || '').toLowerCase();
    if (msg.includes('status') && msg.includes('does not exist')) {
      const legacy = await supabase
        .from('turath_masr_inventory')
        .select('id, name, sku, available, price, category, colors');
      if (legacy.error) {
        console.warn('[productCards] inventory load failed (legacy):', legacy.error);
        return { items: [], cards: buildStaticCards() };
      }
      rows = (legacy.data as RawInventoryRow[] | null) ?? [];
    } else {
      console.warn('[productCards] inventory load failed:', withStatus.error);
      return { items: [], cards: buildStaticCards() };
    }
  }

  const items: InventoryItem[] = (rows ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    sku: row.sku ?? '',
    available: row.available ?? 0,
    price: row.price ?? 0,
    category: row.category ?? '',
    colors: Array.isArray(row.colors) ? row.colors : [],
  }));
  if (items.length === 0) {
    return { items: [], cards: buildStaticCards() };
  }
  const cards: ProductCard[] = items.map((item) => ({
    value: item.id,
    label: item.name,
    basePrice: item.price,
    emoji: '📦',
    hasColor: item.colors.length > 0,
    image: inventoryThumbnailUrl(item.id),
    isInventory: true,
    colors: item.colors,
    category: item.category,
    // Phase Inventory-Order-Identity-1 — surface identity fields on
    // the card so downstream serializers don't have to re-derive
    // them from `value` / `isInventory`.
    id: item.id,
    sku: item.sku || null,
  }));
  return { items, cards };
}

function buildStaticCards(): ProductCard[] {
  return STATIC_PRODUCT_TYPES.map((t) => ({
    value: t.value,
    label: t.label,
    basePrice: t.basePrice,
    emoji: t.emoji,
    hasColor: t.hasColor,
    isInventory: false,
  }));
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Resolve the colour palette for a given product card. Inventory
 *  cards bring their own free-text colour list (rendered with a
 *  neutral grey swatch since we don't know the hex). The static
 *  `holder` card falls back to the canonical 5-colour palette. All
 *  other static cards have no colour picker. */
export function resolveLineColors(card: ProductCard | null | undefined): ColorOption[] {
  if (!card) return [];
  if (card.colors && card.colors.length > 0) {
    return card.colors.map((c) => ({ value: c, label: c, hex: '#888' }));
  }
  if (card.value === 'holder') return HOLDER_COLOR_PALETTE.map((c) => ({ ...c }));
  return [];
}

/** Per-line subtotal with optional flashlight add-on. */
export function lineSubtotal(line: DraftOrderLine): number {
  const flashlight = line.includeFlashlight ? Number(line.flashlightPrice) || 0 : 0;
  const perUnit = (Number(line.unitPrice) || 0) + flashlight;
  return perUnit * (Number(line.quantity) || 0);
}

/** Stock-aware max quantity available for a product card given the
 *  current set of lines. Returns Infinity for non-inventory cards so
 *  callers can use a single math expression: `Math.min(qty, max)`. */
export function maxStockForLine(
  card: ProductCard | null | undefined,
  items: InventoryItem[],
  otherLinesSameProduct: DraftOrderLine[]
): number {
  if (!card || !card.isInventory) return Infinity;
  const inv = items.find((i) => i.id === card.value);
  if (!inv) return Infinity;
  const taken = otherLinesSameProduct.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);
  return Math.max(0, inv.available - taken);
}
