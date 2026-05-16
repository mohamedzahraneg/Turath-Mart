// ─────────────────────────────────────────────────────────────────────────────
// src/lib/inventory/returnStockClient.ts
//
// Phase Inventory-Returns-Stock-1 — apply the inventory side-effects
// of a completed return adjustment.
//
// When an order adjustment of kind `return_full` / `return_partial`
// transitions to `state = 'completed'`, every line marked
// `stock_disposition === 'return_to_stock'` should add its quantity
// back to `turath_masr_inventory.available` and produce one
// `return_in` row in the movement ledger.
//
// This module is the single client-side entry point for that flow.
// It is consumed by `OrderDetailModal.handleAdjustmentDecision`
// after the adjustment row's state has been updated to `completed`
// and the per-adjustment staff audit has been written. The helper:
//
//   1. Builds the per-line work list from `adjustment.return_lines`,
//      enforcing the safety rules (must have `inventory_id`,
//      `quantity > 0`, disposition === 'return_to_stock').
//   2. For each candidate line, queries
//      `turath_masr_inventory_movements` to detect an existing
//      `return_in` row keyed to (reference_type='adjustment',
//      reference_id=adjustment.id, metadata.line_id=line.id). If
//      found, the line is skipped — completing the adjustment twice
//      must not double-credit stock.
//   3. Calls the existing `inventory_apply_movement` RPC (already
//      gated by `is_manager_or_above()` and serialized with
//      `FOR UPDATE` locks). One RPC call per line.
//   4. Returns a per-line outcome summary so the caller can write a
//      single `inventory.return_stock_applied` audit row.
//
// What this module deliberately does NOT do:
//   - No mutation of `turath_masr_order_adjustments`.
//   - No movement writes for `'damaged'` or `'no_stock_effect'`
//     dispositions; those are ledger-silent by design.
//   - No exchange replacement stock effects (Phase Inventory-
//     Exchange-Stock-1 owns that path).
//   - No refund / payment changes.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdjustmentLine, OrderAdjustment } from '@/lib/orders/orderAdjustments';

/** Per-line outcome describing what the apply helper did with one
 *  return line. The caller folds these into a single staff audit
 *  metadata bundle. */
export type ReturnStockLineOutcome =
  | {
      status: 'applied';
      lineId: string | null;
      inventoryId: string;
      quantity: number;
      movementId: string | null;
    }
  | {
      status: 'skipped_already_applied';
      lineId: string | null;
      inventoryId: string;
      quantity: number;
    }
  | { status: 'skipped_no_identity'; lineId: string | null; quantity: number }
  | { status: 'skipped_disposition'; lineId: string | null; disposition: string }
  | { status: 'skipped_zero_quantity'; lineId: string | null }
  | {
      status: 'failed';
      lineId: string | null;
      inventoryId: string;
      quantity: number;
      error: string;
    };

export interface ReturnStockApplyResult {
  appliedCount: number;
  totalAppliedQuantity: number;
  skippedCount: number;
  failedCount: number;
  outcomes: ReturnStockLineOutcome[];
}

const EMPTY_RESULT: ReturnStockApplyResult = {
  appliedCount: 0,
  totalAppliedQuantity: 0,
  skippedCount: 0,
  failedCount: 0,
  outcomes: [],
};

interface ApplyReturnStockArgs {
  supabase: SupabaseClient;
  adjustment: Pick<OrderAdjustment, 'id' | 'order_id' | 'order_num' | 'return_lines'>;
  actorName: string | null;
}

/** Lift a line's id field into a stable string identifier suitable
 *  for the idempotency check + audit metadata. Returns `null` when
 *  the line carries no id at all — those lines can still be applied
 *  but their idempotency check will only match on
 *  (reference_id, inventory_id) and may incorrectly skip a legitimate
 *  re-run on multi-line orders that share an inventory id. Callers
 *  should aim to always populate `id`. */
function pickLineId(line: AdjustmentLine): string | null {
  const candidate = typeof line.id === 'string' ? line.id.trim() : '';
  return candidate.length > 0 ? candidate : null;
}

/** Did this line resolve to a real inventory id we can act on? */
function pickInventoryId(line: AdjustmentLine): string | null {
  const direct = typeof line.inventory_id === 'string' ? line.inventory_id.trim() : '';
  if (direct.length > 0) return direct;
  // Back-compat: pre-Phase-Identity-1 lines occasionally stored the
  // inventory uuid in `productType`. The serializer in
  // OrderAdjustmentModal already collapses that into `inventory_id`
  // before saving, but defensive resolution here protects rows that
  // were created before the serializer was deployed.
  const productType = typeof line.productType === 'string' ? line.productType.trim() : '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productType)
    ? productType
    : null;
}

/**
 * For one return line, check if a matching `return_in` movement
 * already exists for (adjustment, line). Used as the idempotency
 * guard before calling `inventory_apply_movement`.
 *
 * Match strategy:
 *   - `reference_type = 'adjustment'`
 *   - `reference_id   = adjustment.id`     (uuid → uuid)
 *   - `movement_type  = 'return_in'`
 *   - `metadata->>line_id = line.id`       (only when both are non-null)
 *
 * When the line carries no `id`, we fall back to matching on
 * `(reference_id, inventory_id)`. That can yield a false positive
 * on multi-line adjustments where two returned lines share the same
 * `inventory_id` — in that case the second line is skipped. We
 * accept that edge in exchange for not adding a migration; the
 * operator can re-run the adjustment after manually adding an id.
 */
async function hasExistingReturnMovement(
  supabase: SupabaseClient,
  adjustmentId: string,
  inventoryId: string,
  lineId: string | null
): Promise<boolean> {
  let query = supabase
    .from('turath_masr_inventory_movements')
    .select('id', { count: 'exact', head: true })
    .eq('reference_type', 'adjustment')
    .eq('reference_id', adjustmentId)
    .eq('movement_type', 'return_in')
    .eq('inventory_id', inventoryId);
  if (lineId) {
    query = query.eq('metadata->>line_id', lineId);
  }
  const { count, error } = await query;
  if (error) {
    // If the idempotency lookup fails, be conservative and DO NOT
    // apply. The operator can retry once the lookup recovers.
    console.warn('[returnStockClient] idempotency lookup failed:', error);
    return true;
  }
  return (count ?? 0) > 0;
}

/**
 * Apply inventory effects for every `return_to_stock` line in the
 * supplied adjustment. Safe to call multiple times — see the
 * idempotency guard in `hasExistingReturnMovement`.
 *
 * On a successful per-line call the helper:
 *   - Writes one `return_in` movement via `inventory_apply_movement`
 *     (positive `quantity_delta` = `line.quantity`).
 *   - Stores adjustment + line context in the movement metadata so
 *     audit drilldowns can trace stock back to the originating
 *     return.
 *
 * Errors from any single line are recorded in the outcome list but
 * do not abort processing for the remaining lines. The caller is
 * expected to surface a warning toast + write a single staff audit
 * row summarising the bundle.
 */
export async function applyReturnStockEffects({
  supabase,
  adjustment,
  actorName,
}: ApplyReturnStockArgs): Promise<ReturnStockApplyResult> {
  const lines = Array.isArray(adjustment.return_lines) ? adjustment.return_lines : [];
  if (lines.length === 0) return EMPTY_RESULT;

  const outcomes: ReturnStockLineOutcome[] = [];
  let appliedCount = 0;
  let totalAppliedQuantity = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const line of lines) {
    const lineId = pickLineId(line);
    const inventoryId = pickInventoryId(line);
    const quantity = Math.floor(Number(line.quantity) || 0);
    const disposition = line.stock_disposition ?? 'no_stock_effect';

    if (disposition !== 'return_to_stock') {
      outcomes.push({ status: 'skipped_disposition', lineId, disposition });
      skippedCount += 1;
      continue;
    }
    if (!inventoryId) {
      outcomes.push({ status: 'skipped_no_identity', lineId, quantity });
      skippedCount += 1;
      continue;
    }
    if (quantity <= 0) {
      outcomes.push({ status: 'skipped_zero_quantity', lineId });
      skippedCount += 1;
      continue;
    }

    const alreadyApplied = await hasExistingReturnMovement(
      supabase,
      adjustment.id,
      inventoryId,
      lineId
    );
    if (alreadyApplied) {
      outcomes.push({ status: 'skipped_already_applied', lineId, inventoryId, quantity });
      skippedCount += 1;
      continue;
    }

    const movementMetadata = {
      source: 'return_adjustment',
      adjustment_id: adjustment.id,
      adjustment_order_id: adjustment.order_id,
      ...(lineId ? { line_id: lineId } : {}),
      ...(line.sku ? { sku: line.sku } : {}),
      ...(line.label ? { label: line.label } : {}),
      ...(line.color ? { color: line.color } : {}),
      stock_disposition: 'return_to_stock',
    };

    try {
      const rpcResult = await supabase.rpc('inventory_apply_movement', {
        p_inventory_id: inventoryId,
        p_movement_type: 'return_in',
        p_quantity_delta: quantity,
        p_reason: `مرتجع من طلب ${adjustment.order_num}`,
        p_reference_type: 'adjustment',
        p_reference_id: adjustment.id,
        p_order_num: adjustment.order_num,
        p_created_by_name: actorName,
        p_metadata: movementMetadata,
      });
      if (rpcResult.error) {
        const errMessage = rpcResult.error.message || 'apply_movement failed';
        console.warn('[returnStockClient] inventory_apply_movement failed:', rpcResult.error);
        outcomes.push({ status: 'failed', lineId, inventoryId, quantity, error: errMessage });
        failedCount += 1;
        continue;
      }
      const rpcData = (rpcResult.data ?? null) as
        | Array<{ movement_id?: string | null; new_available?: number | null }>
        | { movement_id?: string | null; new_available?: number | null }
        | null;
      const firstRow = Array.isArray(rpcData) ? (rpcData[0] ?? null) : rpcData;
      const movementId = firstRow?.movement_id ?? null;
      outcomes.push({ status: 'applied', lineId, inventoryId, quantity, movementId });
      appliedCount += 1;
      totalAppliedQuantity += quantity;
    } catch (callErr) {
      const errMessage =
        callErr instanceof Error ? callErr.message : String(callErr ?? 'unknown error');
      console.error('[returnStockClient] inventory_apply_movement threw:', callErr);
      outcomes.push({ status: 'failed', lineId, inventoryId, quantity, error: errMessage });
      failedCount += 1;
    }
  }

  return {
    appliedCount,
    totalAppliedQuantity,
    skippedCount,
    failedCount,
    outcomes,
  };
}
