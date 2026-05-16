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

/** Phase Inventory-Variants-1B2 — display-shape for one variant row.
 *  Mirrors a row in `turath_masr_inventory_variants`. Attached to
 *  the parent ProductCard so the order modals can resolve a
 *  variant_id from a picked color without re-querying. */
export interface ProductVariantCard {
  id: string;
  inventory_id: string;
  variant_type: string;
  variant_value: string;
  variant_label: string;
  sku?: string | null;
  available: number;
  reserved: number;
  status: 'active' | 'inactive' | 'archived' | string;
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
  /** Phase Inventory-Order-Identity-1 — base product `available`
   *  for sellable math. Optional because static-product cards have
   *  no inventory row. */
  available?: number;
  /** Phase Inventory-Reservations-1A — base product `reserved`. */
  reserved?: number;
  /** Phase Inventory-Variants-1B2 — active variants attached at
   *  load time. Empty / missing when the product has no variants
   *  or the variants table is missing (pre-migration). */
  variants?: ProductVariantCard[];
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
  /** Phase Inventory-Variants-1B2 — resolved variant id for this
   *  line. Populated when the picked color matches an active,
   *  baselined variant on the parent product card. Persisted in
   *  the saved order line jsonb; the reserve / reconcile / fulfill
   *  RPCs route stock effects to the variant when this is set. */
  variant_id?: string | null;
  /** Phase Inventory-Variants-1B2 — Arabic label snapshot for the
   *  variant. Stays frozen on the line so a later variant rename
   *  doesn't rewrite historical orders. */
  variant_label?: string | null;
  /** Phase Inventory-Variants-1B2 — variant SKU snapshot, same
   *  freeze-at-add semantics as `sku`. */
  variant_sku?: string | null;
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
  // Phase Inventory-Variants-1B2 — resolve a variant for the default
  // color. Only baselined variants (available + reserved > 0)
  // become first-class on the draft; unbaselined variants stay
  // anonymous and the line continues to operate at the base-product
  // level until the operator sets a baseline via stock count. This
  // safety valve keeps existing order flow unchanged on day 0 after
  // 1B1's seed (which populates variants with available = 0).
  const variant = pickVariantForLine(card, defaultColor);
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
    variant_id: variant?.id ?? null,
    variant_label: variant?.variant_label ?? null,
    variant_sku: variant?.sku ?? null,
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
  // Phase Inventory-Reservations-1 — newest optional column. The
  // loader tries it first; the fallback queries drop it.
  reserved?: number | null;
}

/** Phase Inventory-Variants-1B2 — raw row shape returned by the
 *  variants query. Kept loose because the table is shared with the
 *  inventory drawer (which has its own typed loader). */
interface RawVariantRow {
  id: string;
  inventory_id: string;
  variant_type: string | null;
  variant_value: string | null;
  variant_label: string | null;
  sku: string | null;
  available: number | null;
  reserved: number | null;
  status: string | null;
  sort_order: number | null;
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
 *  migration apply), so AddOrder / EditOrder never crash mid-rollout.
 *
 *  Phase Inventory-Variants-1B2 — after the base inventory load, we
 *  fetch active variants for the loaded product ids and attach them
 *  to each ProductCard. The query is best-effort: if the variants
 *  table is missing (pre-Phase-1A) or the read fails, cards ship
 *  without `variants` and the order flow naturally falls back to the
 *  base-product behaviour. We DO NOT seed quantities into variants
 *  here — the column attached to the card mirrors live row state. */
export async function loadProductCards(
  supabase: SupabaseClient
): Promise<{ items: InventoryItem[]; cards: ProductCard[] }> {
  let rows: RawInventoryRow[] | null = null;

  const withReservedStatus = await supabase
    .from('turath_masr_inventory')
    .select('id, name, sku, available, price, category, colors, status, reserved')
    .eq('status', 'active');
  if (!withReservedStatus.error) {
    rows = (withReservedStatus.data as RawInventoryRow[] | null) ?? [];
  } else {
    const msg = (withReservedStatus.error.message || '').toLowerCase();
    const isMissingCol = msg.includes('does not exist') || msg.includes('column');
    if (isMissingCol) {
      // Fallback A: status exists but reserved doesn't.
      const withStatus = await supabase
        .from('turath_masr_inventory')
        .select('id, name, sku, available, price, category, colors, status')
        .eq('status', 'active');
      if (!withStatus.error) {
        rows = (withStatus.data as RawInventoryRow[] | null) ?? [];
      } else {
        // Fallback B: neither status nor reserved (legacy).
        const legacy = await supabase
          .from('turath_masr_inventory')
          .select('id, name, sku, available, price, category, colors');
        if (legacy.error) {
          console.warn('[productCards] inventory load failed (legacy):', legacy.error);
          return { items: [], cards: buildStaticCards() };
        }
        rows = (legacy.data as RawInventoryRow[] | null) ?? [];
      }
    } else {
      console.warn('[productCards] inventory load failed:', withReservedStatus.error);
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

  // Phase Inventory-Variants-1B2 — attach active variants to each
  // card. The query is best-effort: a missing-table error (pre-1A)
  // or any other failure leaves the cards without variants and the
  // order flow keeps working at the base-product level.
  const inventoryIds = items.map((i) => i.id);
  const variantsByInventory = new Map<string, ProductVariantCard[]>();
  try {
    const variantRes = await supabase
      .from('turath_masr_inventory_variants')
      .select(
        'id, inventory_id, variant_type, variant_value, variant_label, sku, available, reserved, status, sort_order'
      )
      .in('inventory_id', inventoryIds)
      .eq('status', 'active')
      .order('sort_order', { ascending: true })
      .order('variant_label', { ascending: true });
    if (variantRes.error) {
      const vmsg = (variantRes.error.message || '').toLowerCase();
      if (!(vmsg.includes('does not exist') || vmsg.includes('relation'))) {
        console.warn('[productCards] variants load failed:', variantRes.error);
      }
    } else {
      for (const v of (variantRes.data ?? []) as RawVariantRow[]) {
        const entry: ProductVariantCard = {
          id: v.id,
          inventory_id: v.inventory_id,
          variant_type: v.variant_type ?? 'color',
          variant_value: v.variant_value ?? '',
          variant_label: v.variant_label ?? v.variant_value ?? '',
          sku: v.sku ?? null,
          available: Number(v.available ?? 0),
          reserved: Number(v.reserved ?? 0),
          status: (v.status ?? 'active') as ProductVariantCard['status'],
        };
        const bucket = variantsByInventory.get(entry.inventory_id);
        if (bucket) bucket.push(entry);
        else variantsByInventory.set(entry.inventory_id, [entry]);
      }
    }
  } catch (variantErr) {
    console.warn('[productCards] variants load threw:', variantErr);
  }

  const cards: ProductCard[] = items.map((item) => {
    const row = (rows ?? []).find((r) => r.id === item.id) ?? null;
    return {
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
      // Phase Inventory-Variants-1B2 — base quantities + variants.
      available: item.available,
      reserved: Number(row?.reserved ?? 0),
      variants: variantsByInventory.get(item.id),
    };
  });
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

// ─── Variant helpers (Phase Inventory-Variants-1B2) ──────────────────────

/** Sellable quantity for a single variant — `available - reserved`,
 *  clamped to zero so the math never goes negative. */
export function variantSellable(variant: ProductVariantCard): number {
  return Math.max(0, (variant.available ?? 0) - (variant.reserved ?? 0));
}

/** A variant is "baselined" once an operator has touched its
 *  quantities. Until that point the seed row (`available=0`,
 *  `reserved=0`) is functionally indistinguishable from "no variant
 *  yet" and the order flow MUST continue to operate at the base
 *  product level — otherwise the day-1 1A seed would block every
 *  inventory-backed colored order. Operators baseline via the
 *  stock-count workflow once 1B3 surfaces the variant picker there. */
export function isVariantBaselined(variant: ProductVariantCard | null | undefined): boolean {
  if (!variant) return false;
  return (variant.available ?? 0) + (variant.reserved ?? 0) > 0;
}

function normalizeColor(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

/** Find the matching variant for a picked color. Match by either
 *  `variant_value` or `variant_label`, case-insensitive after trim.
 *  Returns `null` when the card has no variants, the color is empty,
 *  or no active variant matches. Inactive / archived variants are
 *  ignored (the loader already filters by `status='active'`, but a
 *  defensive guard keeps the helper safe to use against any source
 *  of variants). */
export function resolveVariantForColor(
  card: ProductCard | null | undefined,
  color: string | null | undefined
): ProductVariantCard | null {
  if (!card || !card.variants || card.variants.length === 0) return null;
  const target = normalizeColor(color);
  if (!target) return null;
  for (const v of card.variants) {
    if (v.status !== 'active') continue;
    if (normalizeColor(v.variant_value) === target) return v;
    if (normalizeColor(v.variant_label) === target) return v;
  }
  return null;
}

/** Pick the right variant for a draft line, applying the
 *  baseline safety valve. Returns `null` either when no variant
 *  matches the color OR when the matched variant hasn't been
 *  baselined yet — in both cases the line should continue to
 *  operate at the base product level. */
export function pickVariantForLine(
  card: ProductCard | null | undefined,
  color: string | null | undefined
): ProductVariantCard | null {
  const variant = resolveVariantForColor(card, color);
  if (!variant) return null;
  if (!isVariantBaselined(variant)) return null;
  return variant;
}

/** Stock-aware max quantity available for a specific variant given
 *  the current set of lines pointing at that variant. Returns
 *  Infinity when no variant is selected (the line operates at the
 *  base product level — caller falls back to `maxStockForLine`). */
export function maxStockForVariant(
  variant: ProductVariantCard | null | undefined,
  otherLinesSameVariant: DraftOrderLine[]
): number {
  if (!variant) return Infinity;
  const taken = otherLinesSameVariant.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);
  return Math.max(0, variantSellable(variant) - taken);
}
