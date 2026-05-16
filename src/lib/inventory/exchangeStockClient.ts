// ─────────────────────────────────────────────────────────────────────────────
// src/lib/inventory/exchangeStockClient.ts
//
// Phase Inventory-Exchange-Stock-1 — apply the inventory side-effects
// of a completed exchange adjustment.
//
// When an adjustment of kind `exchange_full` / `exchange_partial`
// transitions to `state = 'completed'`, two legs of inventory effects
// fire against the existing `inventory_apply_movement` RPC:
//
//   Leg 1 — RETURNED item (`return_lines`):
//     For each line with `stock_disposition === 'return_to_stock'`
//     and an `inventory_id`, write one `exchange_in` movement with
//     `quantity_delta = +line.quantity`. Lines marked `damaged` /
//     `no_stock_effect` are ledger-silent (same convention as the
//     return-stock helper).
//
//   Leg 2 — REPLACEMENT item (`replacement_lines`):
//     For each line with an `inventory_id` and `quantity > 0`,
//     write one `exchange_out` movement with `quantity_delta =
//     -line.quantity`. Maintenance parts (no `inventory_id`) are
//     ledger-silent. Free items (`isFree: true`) still write the
//     `exchange_out` row — pricing is a refund concern; stock
//     accounting tracks physical flow.
//
// Both legs are independent. A failure on the replacement leg does
// not roll back the returned leg (the underlying RPC commits each
// movement as its own transaction), so the helper collects per-line
// outcomes and lets the caller surface a single staff audit row that
// captures everything that happened.
//
// Idempotency
//   Before each movement, the helper queries
//   `turath_masr_inventory_movements` for an existing row keyed to:
//
//     reference_type = 'adjustment'
//     reference_id   = adjustment.id
//     movement_type  = 'exchange_in' | 'exchange_out'
//     inventory_id   = line.inventory_id
//     metadata->>line_id = line.id          (only when set)
//     metadata->>leg     = 'returned_item' | 'replacement_item'
//
//   When found, the line is skipped (`status: 'skipped_already_applied'`).
//   Re-completing the adjustment never double-applies.
//
// What this module deliberately does NOT do:
//   - No mutation of `turath_masr_order_adjustments`.
//   - No effect on returns (those go through `returnStockClient`).
//   - No `damage_out` movement for damaged returned items — the
//     ledger stays silent, audit metadata captures the disposition.
//   - No refund / payment / shipping changes.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdjustmentLine, OrderAdjustment } from '@/lib/orders/orderAdjustments';

type ExchangeLeg = 'returned_item' | 'replacement_item';

/** Per-line outcome describing what the helper did with one line.
 *  Each outcome carries its leg so the audit row can render a
 *  human-readable breakdown of in vs. out flow. */
export type ExchangeStockLineOutcome =
  | {
      status: 'applied';
      leg: ExchangeLeg;
      lineId: string | null;
      inventoryId: string;
      quantity: number;
      movementId: string | null;
    }
  | {
      status: 'skipped_already_applied';
      leg: ExchangeLeg;
      lineId: string | null;
      inventoryId: string;
      quantity: number;
    }
  | {
      status: 'skipped_idempotency_unknown';
      leg: ExchangeLeg;
      lineId: string | null;
      inventoryId: string;
      quantity: number;
    }
  | { status: 'skipped_no_identity'; leg: ExchangeLeg; lineId: string | null; quantity: number }
  | { status: 'skipped_disposition'; leg: ExchangeLeg; lineId: string | null; disposition: string }
  | { status: 'skipped_zero_quantity'; leg: ExchangeLeg; lineId: string | null }
  | {
      status: 'failed';
      leg: ExchangeLeg;
      lineId: string | null;
      inventoryId: string;
      quantity: number;
      error: string;
    };

export interface ExchangeStockApplyResult {
  exchangeInCount: number;
  exchangeOutCount: number;
  totalInQuantity: number;
  totalOutQuantity: number;
  skippedCount: number;
  failedCount: number;
  outcomes: ExchangeStockLineOutcome[];
}

const EMPTY_RESULT: ExchangeStockApplyResult = {
  exchangeInCount: 0,
  exchangeOutCount: 0,
  totalInQuantity: 0,
  totalOutQuantity: 0,
  skippedCount: 0,
  failedCount: 0,
  outcomes: [],
};

interface ApplyExchangeStockArgs {
  supabase: SupabaseClient;
  adjustment: Pick<
    OrderAdjustment,
    'id' | 'order_id' | 'order_num' | 'return_lines' | 'replacement_lines'
  >;
  actorName: string | null;
}

function pickLineId(line: AdjustmentLine): string | null {
  const candidate = typeof line.id === 'string' ? line.id.trim() : '';
  return candidate.length > 0 ? candidate : null;
}

function pickInventoryId(line: AdjustmentLine): string | null {
  const direct = typeof line.inventory_id === 'string' ? line.inventory_id.trim() : '';
  if (direct.length > 0) return direct;
  // Back-compat for pre-Phase-Identity-1 lines that occasionally
  // carried the inventory uuid in `productType`. The current
  // serializer in OrderAdjustmentModal collapses that into
  // `inventory_id` before saving, but defensive resolution here
  // protects older rows.
  const productType = typeof line.productType === 'string' ? line.productType.trim() : '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productType)
    ? productType
    : null;
}

/** Phase Inventory-Variants-1B3 — pick the variant id (or null) the
 *  exchange leg should route through. Returned-leg lines copy this
 *  from the source order line; replacement-leg lines copy it from
 *  the picked card + color (set by the OrderAdjustmentModal
 *  replacement editor). */
function pickVariantId(line: AdjustmentLine): string | null {
  const direct = typeof line.variant_id === 'string' ? line.variant_id.trim() : '';
  return direct.length > 0 ? direct : null;
}

/** Idempotency check filtered by movement_type AND `leg` so the
 *  returned leg never collides with a prior returns-stock entry on
 *  the same adjustment. */
async function hasExistingExchangeMovement(
  supabase: SupabaseClient,
  adjustmentId: string,
  inventoryId: string,
  movementType: 'exchange_in' | 'exchange_out',
  leg: ExchangeLeg,
  lineId: string | null
): Promise<'exists' | 'absent' | 'unknown'> {
  let query = supabase
    .from('turath_masr_inventory_movements')
    .select('id', { count: 'exact', head: true })
    .eq('reference_type', 'adjustment')
    .eq('reference_id', adjustmentId)
    .eq('movement_type', movementType)
    .eq('inventory_id', inventoryId)
    .eq('metadata->>leg', leg);
  if (lineId) {
    query = query.eq('metadata->>line_id', lineId);
  }
  const { count, error } = await query;
  if (error) {
    // Conservative: tell the caller we couldn't decide. They will
    // skip the line rather than risk a double movement.
    console.warn('[exchangeStockClient] idempotency lookup failed:', error);
    return 'unknown';
  }
  return (count ?? 0) > 0 ? 'exists' : 'absent';
}

/**
 * Run both legs of exchange stock side-effects. Each leg is
 * independent; errors / skips on one leg do not stop the other.
 * Caller is expected to fold `outcomes` into a single staff audit
 * row and surface a warning toast when `failedCount > 0`.
 */
export async function applyExchangeStockEffects({
  supabase,
  adjustment,
  actorName,
}: ApplyExchangeStockArgs): Promise<ExchangeStockApplyResult> {
  const returnedLines = Array.isArray(adjustment.return_lines) ? adjustment.return_lines : [];
  const replacementLines = Array.isArray(adjustment.replacement_lines)
    ? adjustment.replacement_lines
    : [];
  if (returnedLines.length === 0 && replacementLines.length === 0) return EMPTY_RESULT;

  const outcomes: ExchangeStockLineOutcome[] = [];
  let exchangeInCount = 0;
  let exchangeOutCount = 0;
  let totalInQuantity = 0;
  let totalOutQuantity = 0;
  let skippedCount = 0;
  let failedCount = 0;

  // ─── Leg 1 — returned item ──────────────────────────────────────────
  for (const line of returnedLines) {
    const lineId = pickLineId(line);
    const inventoryId = pickInventoryId(line);
    const quantity = Math.floor(Number(line.quantity) || 0);
    const disposition = line.stock_disposition ?? 'no_stock_effect';

    if (disposition !== 'return_to_stock') {
      outcomes.push({ status: 'skipped_disposition', leg: 'returned_item', lineId, disposition });
      skippedCount += 1;
      continue;
    }
    if (!inventoryId) {
      outcomes.push({ status: 'skipped_no_identity', leg: 'returned_item', lineId, quantity });
      skippedCount += 1;
      continue;
    }
    if (quantity <= 0) {
      outcomes.push({ status: 'skipped_zero_quantity', leg: 'returned_item', lineId });
      skippedCount += 1;
      continue;
    }

    const existence = await hasExistingExchangeMovement(
      supabase,
      adjustment.id,
      inventoryId,
      'exchange_in',
      'returned_item',
      lineId
    );
    if (existence === 'exists') {
      outcomes.push({
        status: 'skipped_already_applied',
        leg: 'returned_item',
        lineId,
        inventoryId,
        quantity,
      });
      skippedCount += 1;
      continue;
    }
    if (existence === 'unknown') {
      outcomes.push({
        status: 'skipped_idempotency_unknown',
        leg: 'returned_item',
        lineId,
        inventoryId,
        quantity,
      });
      skippedCount += 1;
      continue;
    }

    const variantId = pickVariantId(line);
    const metadata = {
      source: 'exchange_adjustment',
      leg: 'returned_item',
      adjustment_id: adjustment.id,
      adjustment_order_id: adjustment.order_id,
      ...(lineId ? { line_id: lineId } : {}),
      ...(line.sku ? { sku: line.sku } : {}),
      ...(line.label ? { label: line.label } : {}),
      ...(line.color ? { color: line.color } : {}),
      // Phase Inventory-Variants-1B3 — variant audit context.
      ...(variantId ? { variant_id: variantId } : {}),
      ...(line.variant_label ? { variant_label: line.variant_label } : {}),
      ...(line.variant_sku ? { variant_sku: line.variant_sku } : {}),
      stock_disposition: 'return_to_stock',
    };

    try {
      const rpcResult = await supabase.rpc('inventory_apply_movement', {
        p_inventory_id: inventoryId,
        p_movement_type: 'exchange_in',
        p_quantity_delta: quantity,
        p_reason: `استبدال - رجوع منتج من طلب ${adjustment.order_num}`,
        p_reference_type: 'adjustment',
        p_reference_id: adjustment.id,
        p_order_num: adjustment.order_num,
        p_created_by_name: actorName,
        p_metadata: metadata,
        p_variant_id: variantId,
      });
      if (rpcResult.error) {
        const errMessage = rpcResult.error.message || 'apply_movement failed';
        console.warn('[exchangeStockClient] exchange_in apply failed:', rpcResult.error);
        outcomes.push({
          status: 'failed',
          leg: 'returned_item',
          lineId,
          inventoryId,
          quantity,
          error: errMessage,
        });
        failedCount += 1;
        continue;
      }
      const rpcData = (rpcResult.data ?? null) as
        | Array<{ movement_id?: string | null }>
        | { movement_id?: string | null }
        | null;
      const firstRow = Array.isArray(rpcData) ? (rpcData[0] ?? null) : rpcData;
      const movementId = firstRow?.movement_id ?? null;
      outcomes.push({
        status: 'applied',
        leg: 'returned_item',
        lineId,
        inventoryId,
        quantity,
        movementId,
      });
      exchangeInCount += 1;
      totalInQuantity += quantity;
    } catch (callErr) {
      const errMessage =
        callErr instanceof Error ? callErr.message : String(callErr ?? 'unknown error');
      console.error('[exchangeStockClient] exchange_in threw:', callErr);
      outcomes.push({
        status: 'failed',
        leg: 'returned_item',
        lineId,
        inventoryId,
        quantity,
        error: errMessage,
      });
      failedCount += 1;
    }
  }

  // ─── Leg 2 — replacement item ───────────────────────────────────────
  for (const line of replacementLines) {
    const lineId = pickLineId(line);
    const inventoryId = pickInventoryId(line);
    const quantity = Math.floor(Number(line.quantity) || 0);

    if (!inventoryId) {
      outcomes.push({ status: 'skipped_no_identity', leg: 'replacement_item', lineId, quantity });
      skippedCount += 1;
      continue;
    }
    if (quantity <= 0) {
      outcomes.push({ status: 'skipped_zero_quantity', leg: 'replacement_item', lineId });
      skippedCount += 1;
      continue;
    }

    const existence = await hasExistingExchangeMovement(
      supabase,
      adjustment.id,
      inventoryId,
      'exchange_out',
      'replacement_item',
      lineId
    );
    if (existence === 'exists') {
      outcomes.push({
        status: 'skipped_already_applied',
        leg: 'replacement_item',
        lineId,
        inventoryId,
        quantity,
      });
      skippedCount += 1;
      continue;
    }
    if (existence === 'unknown') {
      outcomes.push({
        status: 'skipped_idempotency_unknown',
        leg: 'replacement_item',
        lineId,
        inventoryId,
        quantity,
      });
      skippedCount += 1;
      continue;
    }

    const variantId = pickVariantId(line);
    const metadata = {
      source: 'exchange_adjustment',
      leg: 'replacement_item',
      adjustment_id: adjustment.id,
      adjustment_order_id: adjustment.order_id,
      ...(lineId ? { line_id: lineId } : {}),
      ...(line.sku ? { sku: line.sku } : {}),
      ...(line.label ? { label: line.label } : {}),
      ...(line.color ? { color: line.color } : {}),
      // Phase Inventory-Variants-1B3 — variant audit context.
      ...(variantId ? { variant_id: variantId } : {}),
      ...(line.variant_label ? { variant_label: line.variant_label } : {}),
      ...(line.variant_sku ? { variant_sku: line.variant_sku } : {}),
      is_free: line.isFree === true,
    };

    try {
      const rpcResult = await supabase.rpc('inventory_apply_movement', {
        p_inventory_id: inventoryId,
        p_movement_type: 'exchange_out',
        p_quantity_delta: -quantity,
        p_reason: `استبدال - خروج بديل لطلب ${adjustment.order_num}`,
        p_reference_type: 'adjustment',
        p_reference_id: adjustment.id,
        p_order_num: adjustment.order_num,
        p_created_by_name: actorName,
        p_metadata: metadata,
        p_variant_id: variantId,
      });
      if (rpcResult.error) {
        const errMessage = rpcResult.error.message || 'apply_movement failed';
        console.warn('[exchangeStockClient] exchange_out apply failed:', rpcResult.error);
        outcomes.push({
          status: 'failed',
          leg: 'replacement_item',
          lineId,
          inventoryId,
          quantity,
          error: errMessage,
        });
        failedCount += 1;
        continue;
      }
      const rpcData = (rpcResult.data ?? null) as
        | Array<{ movement_id?: string | null }>
        | { movement_id?: string | null }
        | null;
      const firstRow = Array.isArray(rpcData) ? (rpcData[0] ?? null) : rpcData;
      const movementId = firstRow?.movement_id ?? null;
      outcomes.push({
        status: 'applied',
        leg: 'replacement_item',
        lineId,
        inventoryId,
        quantity,
        movementId,
      });
      exchangeOutCount += 1;
      totalOutQuantity += quantity;
    } catch (callErr) {
      const errMessage =
        callErr instanceof Error ? callErr.message : String(callErr ?? 'unknown error');
      console.error('[exchangeStockClient] exchange_out threw:', callErr);
      outcomes.push({
        status: 'failed',
        leg: 'replacement_item',
        lineId,
        inventoryId,
        quantity,
        error: errMessage,
      });
      failedCount += 1;
    }
  }

  return {
    exchangeInCount,
    exchangeOutCount,
    totalInQuantity,
    totalOutQuantity,
    skippedCount,
    failedCount,
    outcomes,
  };
}
