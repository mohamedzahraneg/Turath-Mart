// ─────────────────────────────────────────────────────────────────────────────
// src/lib/orders/orderLineIdentity.ts
//
// Phase Inventory-Order-Identity-1 — small, dependency-free helper for
// resolving an inventory identity out of an order/adjustment line.
//
// Background: historically each saved order line carried a single
// `productType` string. For static catalog cards (`holder`, `flashlight`,
// `chair`, `quran`, `kaaba`) this was a short opaque key; for inventory-
// backed cards `loadProductCards` set `productType = inventory.id` —
// so the UUID has been silently flowing through as `productType` for
// a long time.
//
// Going forward we persist an explicit `inventory_id` (and a `sku`
// snapshot) on every new / edited line. This module exposes the
// canonical "where does the inventory id live on this line?" logic so
// future reservation / fulfillment phases can read identity from a
// single source of truth without re-implementing the fallback rules.
//
// Pure JS — no React, no DB, no side effects.
// ─────────────────────────────────────────────────────────────────────────────

/** Shape of a card supplied by `loadProductCards`. We don't import the
 *  real `ProductCard` type to avoid creating a cycle; the fields used
 *  here are stable. */
export interface CardIdentitySource {
  value: string;
  /** Phase Inventory-Order-Identity-1 — only set for inventory-backed
   *  cards. Mirrors the `turath_masr_inventory.id` UUID. */
  id?: string | null;
  /** Phase Inventory-Order-Identity-1 — `turath_masr_inventory.sku`
   *  snapshot. Null for static products. */
  sku?: string | null;
  isInventory?: boolean;
}

/** Subset of order-line fields we look at when inferring identity. */
export interface LineIdentitySource {
  inventory_id?: string | null;
  sku?: string | null;
  productType?: string | null;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Loose UUID check. We use the standard v1-v8 layout — Supabase
 *  produces v4s but we don't pin the version digit because any
 *  legitimately-stored UUID is fine. */
export function isUuidLike(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return UUID_REGEX.test(value.trim());
}

/** Pull the canonical inventory id out of a saved or draft line.
 *
 *  Order of precedence:
 *    1. `line.inventory_id` (the explicit, new field — always wins
 *       once Phase Inventory-Order-Identity-1 has shipped).
 *    2. `line.productType` IF it looks like a UUID (the legacy
 *       fallback covering rows persisted before this phase, where
 *       `loadProductCards` had been setting `productType = item.id`
 *       for inventory-backed cards).
 *    3. `null` — the line came from a static catalog card and has
 *       no inventory linkage.
 *
 *  Stock RPCs / reservation logic should treat a `null` return as
 *  "no inventory effect for this line".
 */
export function inferInventoryIdFromLine(line: LineIdentitySource): string | null {
  if (line.inventory_id && line.inventory_id.trim()) return line.inventory_id.trim();
  const productType = (line.productType ?? '').trim();
  if (isUuidLike(productType)) return productType;
  return null;
}

/** Pull a SKU snapshot out of a saved or draft line. Returns the
 *  stored `sku` when present, otherwise `null`. Callers should never
 *  fall back to a live inventory lookup here — the snapshot is
 *  historical and may differ from current inventory.sku. */
export function inferSkuFromLine(line: LineIdentitySource): string | null {
  const sku = (line.sku ?? '').trim();
  return sku ? sku : null;
}

/** Decorate a line payload with the two identity fields derived from a
 *  product card. Returns a NEW object — never mutates the input.
 *  When the card has no inventory linkage (static product) both
 *  fields are set to `null` so the payload schema is stable. */
export function withInventoryIdentity<T extends Record<string, unknown>>(
  payload: T,
  card: CardIdentitySource | null | undefined
): T & { inventory_id: string | null; sku: string | null } {
  const inventoryId = resolveInventoryIdFromCard(card);
  const sku = card?.sku && String(card.sku).trim() ? String(card.sku).trim() : null;
  return {
    ...payload,
    inventory_id: inventoryId,
    sku: inventoryId ? sku : null,
  };
}

/** Same precedence as `inferInventoryIdFromLine` but for a `ProductCard`. */
export function resolveInventoryIdFromCard(
  card: CardIdentitySource | null | undefined
): string | null {
  if (!card) return null;
  if (card.id && card.id.trim()) return card.id.trim();
  if (card.isInventory && isUuidLike(card.value)) return card.value;
  return null;
}
