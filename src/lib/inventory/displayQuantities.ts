// ─────────────────────────────────────────────────────────────────────────────
// src/lib/inventory/displayQuantities.ts
//
// Phase Inventory-Display-Unify-1 — single source of truth for the four
// inventory-quantity numbers shown on the product card, the inventory
// list, and the InventoryDrawer Summary tab (المتاح / محجوز / للبيع /
// المسحوب).
//
// Problem (recap from the unification root-cause report):
//   • The card and Summary tab read `turath_masr_inventory.available /
//     reserved` directly. For products with active colour variants those
//     base columns drift away from the truth because the variant-aware
//     `inventory_reserve_for_order` writes to
//     `turath_masr_inventory_variants.reserved` instead.
//   • `المسحوب` was being computed by parsing `turath_masr_orders.products`
//     text on the client. For variant-tracked products the parsed map
//     keys end up as "<product> <colour>" while the card looks up by
//     `item.name.trim()` — they never matched, so المسحوب collapsed to 0.
//
// Rule (approved):
//   • Product has ≥1 active variant row → aggregate from variants.
//   • Product has none → use base inventory columns.
//   • المسحوب is ALWAYS the sum of `|quantity_delta|` from
//     `turath_masr_inventory_movements` rows of `movement_type='order_out'`
//     for that inventory_id. This is the same ledger the Movements tab
//     already shows; it is written by `inventory_fulfill_for_order` on
//     delivery.
//
// This helper is intentionally a pure, side-effect-free function so it
// can be unit-tested and reused on the inventory list, the inventory
// table, and the drawer Summary tab without forking the logic.
// ─────────────────────────────────────────────────────────────────────────────

export interface ProductDisplayQuantities {
  available: number;
  reserved: number;
  sellable: number;
  withdrawn: number;
  /** Diagnostic only — which branch produced the numbers above. */
  source: 'variant_aggregated' | 'base';
}

/** Minimal shape needed from `turath_masr_inventory` for this helper. */
export interface BaseQuantitiesInput {
  available: number | null | undefined;
  reserved?: number | null | undefined;
}

/** Minimal shape needed from `turath_masr_inventory_variants` for this
 *  helper. Status filtering excludes `'archived'` rows; `'inactive'`
 *  rows are kept (they still tie up stock until archived). */
export interface VariantQuantitiesInput {
  available: number | null | undefined;
  reserved?: number | null | undefined;
  status?: string | null | undefined;
}

function toFiniteNonNegative(value: number | null | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/**
 * Compute the four display quantities for one product.
 *
 * - `base`: the row from `turath_masr_inventory` (only `available` and
 *   `reserved` are read).
 * - `variants`: all variant rows for this product. Archived variants
 *   are dropped here; everything else contributes to the totals.
 * - `withdrawn`: the per-product withdrawn count derived elsewhere
 *   (movements aggregation). Passed through verbatim so the caller is
 *   free to source it however it wants (today: sum of `|delta|` on
 *   `order_out` movements). The helper does not invent it.
 */
export function calculateProductDisplayQuantities(
  base: BaseQuantitiesInput,
  variants: VariantQuantitiesInput[] | null | undefined,
  withdrawn: number | null | undefined
): ProductDisplayQuantities {
  const safeWithdrawn = toFiniteNonNegative(withdrawn);
  const activeVariants = (variants ?? []).filter((v) => v?.status !== 'archived');

  if (activeVariants.length > 0) {
    let available = 0;
    let reserved = 0;
    let sellable = 0;
    for (const v of activeVariants) {
      const a = toFiniteNonNegative(v.available);
      const r = toFiniteNonNegative(v.reserved);
      available += a;
      reserved += r;
      // Per-variant clamp: one over-reserved colour cannot drag the
      // product total negative for healthy colours.
      sellable += Math.max(0, a - r);
    }
    return {
      available,
      reserved,
      sellable,
      withdrawn: safeWithdrawn,
      source: 'variant_aggregated',
    };
  }

  const a = toFiniteNonNegative(base.available);
  const r = toFiniteNonNegative(base.reserved);
  return {
    available: a,
    reserved: r,
    sellable: Math.max(0, a - r),
    withdrawn: safeWithdrawn,
    source: 'base',
  };
}
