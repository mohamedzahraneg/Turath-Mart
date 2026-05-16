# Phase Inventory-Historical-Reconciliation-1 — Historical Inventory Gap Report

**Status**: read-only report. **No DB writes performed. No inventory mutations proposed for automatic execution.**

This document inventories the historical mismatch between the order/return/exchange records and the inventory movement ledger introduced by Phases 1A → 1F. The phases were intentionally scoped to take effect **only on new transitions after deploy**; they explicitly did **not** backfill historical state. This report quantifies what was left behind.

## Snapshot

Snapshot taken from production (`fmjwatcjqkhzgaecbokn`) on 2026-05-16 against `main @ 3ccdd27` (Phase 1F deployed).

### Order status distribution

| status      | count |
|-------------|------:|
| new         | 2     |
| warehouse   | 1     |
| shipping    | 2     |
| delivered   | **92**|
| cancelled   | 4     |
| returned    | 5     |
| **total**   | **106** |

### Adjustments

| kind             | state     | count |
|------------------|-----------|------:|
| exchange_full    | pending   | 1     |
| exchange_partial | completed | 1     |

No `return_full` / `return_partial` adjustments exist in production.

### Movement ledger

| movement_type | count |
|---------------|------:|
| `addition`    | 1     |

(zero rows of `order_out`, `return_in`, `exchange_in`, `exchange_out` — the Phase 1D/1E/1F wirings have not yet produced any rows because no qualifying transitions have happened since deploy.)

### Reservation table

`turath_masr_inventory_reservations` is empty (zero rows).

### Current inventory baseline

| inventory_id (short) | name               | sku     | available | reserved | status |
|----------------------|--------------------|---------|----------:|---------:|--------|
| `c728e5c6…`          | حامل مصحف خشب      | HMB-001 | 200       | 0        | active |
| `5779b148…`          | حامل مصحف صدف      | HMA-002 | 100       | 0        | active |
| `faae9aa0…`          | كرسي               | KRS-006 | 100       | 0        | active |
| `0b4854e3…`          | كشاف               | KSH-005 | 10        | 0        | active |
| `9c5c956e…`          | كعبة               | KAB-008 | 15        | 0        | active |
| `884c6b25…`          | مصحف               | MSH-007 | 95        | 0        | active |

The `available` numbers above are the **operator-curated** baseline that pre-dates the order/movement integration. They reflect whatever inbound + manual adjustments + ad-hoc accounting the team has done by hand; they do **not** reflect any historical `order_out` from delivered orders, any historical `return_in` from completed returns, or any exchange flow.

---

## Gap A — Delivered orders missing `order_out`

**Total**: **92** delivered orders without a matching `order_out` movement row.

### Per-product expected stock effect

If every historical delivered line were retroactively converted to an `order_out` movement, the expected aggregate decrease would be:

| inventory_id (short) | product            | sku     | line count | total units | earliest date | latest date  | confidence |
|----------------------|--------------------|---------|-----------:|------------:|---------------|--------------|------------|
| `c728e5c6…`          | حامل مصحف خشب      | HMB-001 | 53         | **63**      | 2026-04-09    | 2026-05-13   | medium     |
| `5779b148…`          | حامل مصحف صدف      | HMA-002 | 19         | **22**      | 2026-04-07    | 2026-05-12   | medium     |
| `0b4854e3…`          | كشاف               | KSH-005 | 18         | **20**      | 2026-04-18    | 2026-05-12   | medium     |
| `884c6b25…`          | مصحف               | MSH-007 | 15         | **17**      | 2026-04-07    | 2026-05-12   | medium     |
| `9c5c956e…`          | كعبة               | KAB-008 | 10         | **14**      | 2026-04-07    | 2026-05-05   | medium     |
| `faae9aa0…`          | كرسي               | KRS-006 | 2          | **6**       | 2026-04-26    | 2026-04-26   | medium     |
| `c2afb0c9…`          | *(no current row)* | —       | 1          | 1           | 2026-04-07    | 2026-04-07   | low        |
| `e5ccb2ed…`          | *(no current row)* | —       | 1          | 1           | 2026-04-07    | 2026-04-07   | low        |
| **total**            |                    |         | **119**    | **144**     |               |              |            |

**Confidence**: all rows fall into the **medium** bucket — line identity is inferred from `productType` (which historically carried the inventory UUID), not from an explicit `inventory_id` field, because Phase Identity-1 only started writing the explicit key after its deploy. Two lines (1 unit each, both from 2026-04-07) reference inventory ids that no longer exist in `turath_masr_inventory` — likely products that were archived or hard-deleted after the order shipped.

### Interpretation

If you trust the operator-curated baseline, **no action is required**: the team has been balancing stock by hand, so the baseline already reflects the missing outflow. The 144-unit aggregate represents the *bookkeeping gap*, not a real inventory error.

If you want the movement ledger to be the source of truth from now on, the bookkeeping gap should be closed by writing 144 units of historical `order_out` rows (without touching `available`, since the curated baseline already accounts for the outflow). That's a Phase Inventory-Historical-Reconciliation-Apply-1 conversation — explicitly **out of scope here**.

---

## Gap B — Completed returns missing `return_in`

**Total**: **0** completed return adjustments without a matching `return_in` movement.

Nothing to reconcile in this category. No `return_full` / `return_partial` adjustments have ever reached the `completed` state in production.

---

## Gap C — Completed exchanges missing `exchange_in` / `exchange_out`

**Total**: **1** completed exchange adjustment without matching movements.

| adjustment_id (short) | order_num | kind             | completed_at | return_lines | replacement_lines |
|-----------------------|-----------|------------------|--------------|--------------|-------------------|
| `d937a220…`           | `26050811`| exchange_partial | 2026-05-11   | 1            | 1                 |

### Expected per-leg effect

**Returned leg** — line: `حامل مصحف صدف`, color `صدف`, qty 1, `productType='5779b148-d6df-4636-9908-b3b26cf12394'` (matches inventory `HMA-002` — medium confidence). No `inventory_id` key, no `stock_disposition` field (the adjustment predates Phases 1F/1E). Under the new wire defaults, this line would have defaulted to `return_to_stock`.

| expected_movement | inventory_id (short) | sku     | delta | confidence |
|-------------------|----------------------|---------|------:|------------|
| `exchange_in`     | `5779b148…`          | HMA-002 | **+1**| medium     |

**Replacement leg** — line: label `حامل بني`, color `عامود بني داخلي`, qty 1, `productType='عامود داخلي'` (free-form text, **not** a UUID, no `inventory_id`). This is a maintenance / manual part — under the new wire it would be ledger-silent.

| expected_movement | inventory_id | delta | confidence |
|-------------------|--------------|------:|------------|
| *(none)*          | —            | 0     | high       |

### Net effect

| inventory_id (short) | product            | sku     | net delta if reconciled | confidence |
|----------------------|--------------------|---------|------------------------:|------------|
| `5779b148…`          | حامل مصحف صدف      | HMA-002 | **+1**                  | medium     |

---

## Aggregate per-product impact (all gap categories combined)

If the catch-up were performed against all three gaps simultaneously, the **expected** mutation to `available` would be:

| inventory_id (short) | product            | sku     | from Gap A | from Gap B | from Gap C | net delta to available |
|----------------------|--------------------|---------|-----------:|-----------:|-----------:|-----------------------:|
| `c728e5c6…`          | حامل مصحف خشب      | HMB-001 | −63        | 0          | 0          | **−63**                |
| `5779b148…`          | حامل مصحف صدف      | HMA-002 | −22        | 0          | +1         | **−21**                |
| `0b4854e3…`          | كشاف               | KSH-005 | −20        | 0          | 0          | **−20**                |
| `884c6b25…`          | مصحف               | MSH-007 | −17        | 0          | 0          | **−17**                |
| `9c5c956e…`          | كعبة               | KAB-008 | −14        | 0          | 0          | **−14**                |
| `faae9aa0…`          | كرسي               | KRS-006 | −6         | 0          | 0          | **−6**                 |
| `c2afb0c9…`          | *(no current row)* | —       | −1         | 0          | 0          | **−1** (orphan)        |
| `e5ccb2ed…`          | *(no current row)* | —       | −1         | 0          | 0          | **−1** (orphan)        |

**Two important caveats** before treating these numbers as "what to subtract from `available`":

1. The current `available` values are operator-curated. They have **almost certainly** already absorbed the historical outflow informally. Subtracting again would double-debit and push several products into negative territory (e.g. `كشاف` available 10 minus 20 historical = −10).
2. A reconciliation that writes movements WITHOUT changing `available` would close the ledger gap (the global movement log + per-product timeline would show the historical activity) without touching the user-trusted stock count. That's the safer model and matches accounting common sense for "opening balance vs. running ledger" reconciliation.

---

## Risk notes

### Order-level `status='returned'` exists outside the adjustment flow

There are 5 orders with `status='returned'` at the order level (`turath_masr_orders.status`) that were never wired through the `turath_masr_order_adjustments` workflow:

| order_num | dt          | line_count |
|-----------|-------------|-----------:|
| `2605088` | 2026-05-08  | 2          |
| `2604274` | 2026-04-27  | 1          |
| `2604262` | 2026-04-26  | 1          |
| `2604191` | 2026-04-19  | 1          |
| `2604092` | 2026-04-09  | 1          |

Phase 1D/1E/1F do **not** touch these — the wirings gate on `status='delivered'` (1D) and `adjustment.kind='return_*' | 'exchange_*'` (1E/1F). An order that flipped `delivered → returned` historically therefore has neither an `order_out` (the wire hadn't shipped yet) nor a `return_in` (no adjustment exists). For the new flows to work end-to-end on such cases going forward, operators must use the **adjustment workflow** for returns/exchanges, not the bare order-status switch.

This is **out of scope for this report's per-product impact** — flagged here as an operational handoff item.

### Identity confidence

Every historical match in Gap A is **medium confidence** (no explicit `inventory_id`, only `productType`-as-UUID fallback). Two lines fall to **low** because the UUID doesn't resolve to a current inventory row. For Gap C, the returned line is medium; the replacement line is high-confidence "no effect" because the productType is plain text.

### `cancelled` orders are not included

The 4 cancelled orders are not analyzed here. They produce no `order_out` by design — cancellation is a release path (Phase 1C), not a delivery path. If any of them were `cancelled` AFTER `delivered`, that would be an interesting edge case, but no order in production has that history.

### `lines` jsonb evolves

`lines[i]` payload shape has changed twice during this stock-integration work:
- Pre-Phase-Identity-1 (mid-2026-05): `productType` carried the inventory UUID as the only identity.
- Phase Identity-1: explicit `inventory_id` + `sku` added, `productType` retained for back-compat.
- Phase 1B onwards (AddOrderModal serializer): explicit `inventory_id` always written for inventory-backed lines.

The 92 delivered-gap orders span all three eras; the queries here use the legacy UUID fallback so they cover all eras uniformly.

---

## Recommended next steps

**Default: do nothing.** The current `available` numbers are the trusted baseline. Treating the historical gap as a ledger-only reconciliation (write movements, leave `available` alone) is the only consistent path that doesn't disrupt the running business. Closing the gap automatically would mis-state stock either by double-counting or by trusting the historical jsonb beyond what the operator team has reviewed.

**If a future phase wants to close the ledger gap**, the natural shape is:

- **Phase Inventory-Historical-Reconciliation-Apply-1** (proposed, not yet sanctioned):
  - For each row in Gap A: insert a synthetic `order_out` movement with `quantity_before = quantity_after = NULL` (or both equal to current `available`), `metadata.source = 'historical_backfill'`. **Do not modify `available`.** The non-negative CHECK on `quantity_after` would need either to be relaxed for backfill rows or to use a `quantity_before = quantity_after = available_at_backfill` placeholder so the constraint passes mechanically while marking the row clearly as historical.
  - For each row in Gap C: same model, two rows per adjustment, `metadata.leg = 'returned_item' | 'replacement_item'`, `metadata.source = 'historical_backfill_exchange'`.
  - **No row in Gap B exists**, so nothing to do.
  - The actual movement schema CHECK `quantity_after = quantity_before + quantity_delta` is the blocker: it cannot be relaxed without a migration. The simplest path is `quantity_before = available_at_backfill`, `quantity_delta = 0`, `quantity_after = available_at_backfill` and rely entirely on `metadata` to convey the historical event — but that's no longer a real `order_out`, it's a synthetic audit marker.
  - A cleaner alternative: add a new movement_type like `historical_marker` via a migration, with `quantity_delta = 0` allowed. That belongs in the Apply phase, not here.

**If a future phase wants a UI for operators to review per-order**, the natural shape is:

- A read-only section under `/inventory → مصالحة تاريخية` rendering this report's three tables, with CSV export. **Out of scope here** — keeping this PR docs-only.

---

## What this report does **not** do

- ❌ Does not write any movements.
- ❌ Does not change any inventory quantities.
- ❌ Does not modify any orders or adjustments.
- ❌ Does not propose schema or RLS changes.
- ❌ Does not modify the AddOrder / EditOrder / StatusUpdate / Returns / Exchange flows.
- ❌ Does not auto-trigger any backfill.

All numbers were sourced from the live production database via read-only `SELECT` queries through the Supabase MCP. The queries used are reproduced inline in each section for repeatability.

---

## Safety confirmation

- ✅ Read-only DB observations only — no `INSERT` / `UPDATE` / `DELETE` / RPC mutation.
- ✅ No code changes in this PR (docs-only).
- ✅ No migration files.
- ✅ No PR-time deploy.
- ✅ Production state at audit time:
    - `git rev-parse HEAD` → `3ccdd27e7cbb123f276f78ec09462bd90f3ae2ae` (main, Phase 1F deployed)
    - inventory baselines: see snapshot table.
- ✅ Other apps not touched: POS, `turath-mart-join`, `turath-staging`, `financial.turathmasr.com`, `/var/www/turath-mart-new`.

---

## Appendix — Reproducible queries

```sql
-- 1. Delivered orders missing order_out.
SELECT o.id, o.order_num, o.status, o.created_at, o.updated_at, o.lines
FROM public.turath_masr_orders o
WHERE o.status = 'delivered'
  AND NOT EXISTS (
    SELECT 1 FROM public.turath_masr_inventory_movements m
    WHERE m.order_num = o.order_num AND m.movement_type = 'order_out'
  )
ORDER BY o.created_at DESC;

-- 2. Completed returns missing return_in.
SELECT a.id, a.order_id, a.order_num, a.kind, a.state, a.created_at, a.return_lines
FROM public.turath_masr_order_adjustments a
WHERE a.state = 'completed'
  AND a.kind IN ('return_full','return_partial')
  AND NOT EXISTS (
    SELECT 1 FROM public.turath_masr_inventory_movements m
    WHERE m.reference_type='adjustment' AND m.reference_id=a.id AND m.movement_type='return_in'
  )
ORDER BY a.created_at DESC;

-- 3. Completed exchanges missing exchange movements.
SELECT a.id, a.order_id, a.order_num, a.kind, a.state, a.created_at,
       a.return_lines, a.replacement_lines
FROM public.turath_masr_order_adjustments a
WHERE a.state = 'completed'
  AND a.kind IN ('exchange_full','exchange_partial')
  AND NOT EXISTS (
    SELECT 1 FROM public.turath_masr_inventory_movements m
    WHERE m.reference_type='adjustment' AND m.reference_id=a.id
      AND m.movement_type IN ('exchange_in','exchange_out')
  )
ORDER BY a.created_at DESC;

-- 4. Per-product gap-A breakdown.
WITH delivered_gaps AS (
  SELECT o.id AS order_id, o.order_num, o.created_at,
         jsonb_array_elements(COALESCE(o.lines, '[]'::jsonb)) AS line
  FROM public.turath_masr_orders o
  WHERE o.status = 'delivered'
    AND NOT EXISTS (
      SELECT 1 FROM public.turath_masr_inventory_movements m
      WHERE m.order_num = o.order_num AND m.movement_type = 'order_out'
    )
),
resolved AS (
  SELECT g.order_num, g.created_at,
         NULLIF(trim(g.line->>'inventory_id'), '') AS explicit_inventory_id,
         CASE
           WHEN g.line->>'productType' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             THEN g.line->>'productType'
           ELSE NULL
         END AS productType_uuid,
         g.line->>'label' AS label,
         g.line->>'sku'   AS sku,
         GREATEST(1, COALESCE((g.line->>'quantity')::int, 1)) AS quantity
  FROM delivered_gaps g
)
SELECT
  COALESCE(explicit_inventory_id, productType_uuid) AS inventory_id,
  CASE
    WHEN explicit_inventory_id IS NOT NULL THEN 'high'
    WHEN productType_uuid     IS NOT NULL THEN 'medium'
    ELSE 'low'
  END AS confidence,
  COUNT(*)               AS line_count,
  SUM(quantity)::int     AS total_qty,
  MIN(created_at)::date  AS earliest,
  MAX(created_at)::date  AS latest
FROM resolved
GROUP BY explicit_inventory_id, productType_uuid
ORDER BY total_qty DESC;
```
