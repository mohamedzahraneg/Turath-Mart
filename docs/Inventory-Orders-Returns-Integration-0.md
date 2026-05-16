# Phase Inventory-Orders-Returns-Integration-0 — Audit & Safe Integration Plan

> **Status:** audit + plan only. No code changes. No DB writes. No migrations applied.
> **Branch / commit audited:** `main` @ `74f45f4`
> **Audit date:** 2026-05-16
> **Companion docs:** [`docs/Inventory-System-Plan-1.md`](./Inventory-System-Plan-1.md) (overall roadmap), [`docs/Inventory-Design-0.md`](./Inventory-Design-0.md) (UI design notes).

---

## Part A — Current order flow audit

### A.1 Where orders are created
- **File:** [`src/app/orders-management/components/AddOrderModal.tsx`](../src/app/orders-management/components/AddOrderModal.tsx)
- **Site:** lines 2138–2177 `supabase.from('turath_masr_orders').upsert(...)` with `onConflict: 'id'`
- **Persisted columns:** `id, order_num, created_by, created_by_device, created_by_user_id, customer, phone, phone2, region, district, neighborhood, address, products (text summary), quantity, subtotal, shipping_fee, express_shipping, free_shipping, total, status, date, time, day, notes, warranty, lines (jsonb), tracking_token`
- **Status on create:** `'new'`
- **Staff audit:** `'order.created'` at line 2245 with `{ order_id, order_num, customer_phone, total, line_count }`.

### A.2 Where orders are edited
- **File:** [`src/app/orders-management/components/EditOrderModal.tsx`](../src/app/orders-management/components/EditOrderModal.tsx)
- **Site:** lines 584–587 `supabase.from('turath_masr_orders').update(updatePayload).eq('id', order.id)`
- **What it rewrites:** customer/phone/address fields + the entire `lines[]` array + `products` summary + totals.
- **Diff tracking:** top-level fields only (`orderChangeDiff.ts`). **No per-line diff** is recorded today — the new array replaces the old one wholesale.
- **Staff audit:** per-field via `addAuditLog()` at line 634; plus `'order.updated'` summary at line 649 with before/after snapshots.

### A.3 Where status changes happen
- **File:** [`src/app/orders-management/components/StatusUpdateModal.tsx`](../src/app/orders-management/components/StatusUpdateModal.tsx)
- **Site:** lines 453–456 `update({ status, delegate_name, assigned_to, ... }).eq('order_num', order.orderNum)`
- **Status set:** `'new' | 'preparing' | 'warehouse' | 'shipping' | 'delivered' | 'cancelled' | 'returned'`
- **Idempotency today:** the modal **does** detect "no actual status change" (line 470) for the audit log, but **always runs the `.update()`** regardless — i.e. clicking "تم التسليم" twice fires the underlying DB trigger twice.
- **Staff audit:** `'order.status_changed'` at line 477.
- **DB side-effects:** a notification trigger fires on `AFTER UPDATE OF status` (migration `20260506_secure_tracking_rpc.sql`). No inventory-related side-effect.

### A.4 Cancellation / archive
- Cancellation = `status = 'cancelled'` (same StatusUpdateModal).
- **No "archive" status** on orders today. (Inventory has archive; orders do not.)
- Cancelled orders remain in the table with `status='cancelled'` — no destructive delete.

### A.5 Returns / exchanges (adjustments)
- **File:** [`src/app/orders-management/components/OrderAdjustmentModal.tsx`](../src/app/orders-management/components/OrderAdjustmentModal.tsx)
- **Table:** `turath_masr_order_adjustments` (kind ∈ `return_full | return_partial | exchange_full | exchange_partial`; state ∈ `pending | approved | rejected | completed | cancelled`)
- **Schema highlights ([orderAdjustments.ts:161-195](../src/lib/orders/orderAdjustments.ts#L161)):**
  - `return_lines: AdjustmentLine[]`
  - `replacement_lines: AdjustmentLine[]`
  - `refund_mode` (`full | partial | none | price_diff`), `refund_amount`, `price_difference`, `shipping_*`, `child_order_id`, `child_order_num`, `linked_complaint_id`
- **Today: zero inventory side-effect.** orderAdjustments.ts:35 even says explicitly: *"Inventory math. Phase 25A explicitly does NOT touch stock."*
- **Staff audit:** `'adjustment.created'`, `'adjustment.approved'`, `'adjustment.rejected'`, `'adjustment.completed'`, `'adjustment.cancelled'`.

### A.6 Child shipping order creation
- **File:** [`src/lib/orders/adjustmentChildOrder.ts`](../src/lib/orders/adjustmentChildOrder.ts) (`buildChildOrderRow()`)
- **Insert:** [`OrderAdjustmentModal.tsx:930-934`](../src/app/orders-management/components/OrderAdjustmentModal.tsx#L930) writes a fresh row into `turath_masr_orders` with `order_num` like `2605082-R1` (return pickup) or `2605082-E1` (exchange).
- **Back-link:** the parent adjustment row is then updated with `child_order_id` + `child_order_num` ([OrderAdjustmentModal.tsx:953-959](../src/app/orders-management/components/OrderAdjustmentModal.tsx#L953)).
- **Staff audit:** `'adjustment.child_order_created'`.

---

## Part B — Line / product identity audit (the headline finding)

### B.1 The shape that actually ships to DB
The 5 most recent production order rows have lines that look like this (real, unedited):

```json
{
  "note": null,
  "color": "أبيض",
  "emoji": "📦",
  "image": null,
  "label": "حامل مصحف خشب ",
  "total": 2399,
  "quantity": 1,
  "unitPrice": 2399,
  "productType": "c728e5c6-da87-4acc-a441-46c9f68df091",
  "flashlightPrice": 150,
  "includeFlashlight": false
}
```

### B.2 Headline: `productType` already carries the inventory UUID
**This is the most important finding in the entire audit.**

- For inventory-backed cards, `productType` is set to the inventory row's `id` UUID (productCards.ts:204: `value: item.id`).
- For static cards (the 5 hard-coded products), `productType` is a short string (`'holder' | 'flashlight' | 'chair' | 'quran' | 'kaaba'`).
- All 5 production orders sampled use UUIDs — meaning **the catalog has already flipped to inventory-backed cards** ever since the inventory page started carrying rows.

So we don't strictly need a NEW `inventory_id` field to identify lines — `productType` already is one. We *do* need to formalise it.

### B.3 Risks of the current shape
| Risk | Detail |
|---|---|
| Same field name carries 2 different value spaces | Static strings AND inventory UUIDs both live in `productType`. UI / RPC must disambiguate by regex or length. |
| Frozen label/price drift | If an inventory row is renamed or repriced, the line still carries the OLD `label` + `unitPrice`. Acceptable historically; just don't rely on the live inventory.name for past order display. |
| Archived/deleted inventory becomes a "ghost" reference | After Phase Inventory-Categories-Safer-Archive-1 we no longer hard-delete inventory, but an archived row's UUID still resolves on JOIN; sellable / reservation logic must check `status != 'archived'`. |
| Per-line audit gap on edit | EditOrderModal rewrites the entire `lines[]` array. There is no per-line history table. If we add reservations later, we'll need to diff the saved lines against the prior version inside the same transaction. |
| Static-product orders carry no inventory id | When the catalog has zero active inventory rows, AddOrderModal falls back to STATIC cards, and the saved line carries `productType='holder'` etc. — no inventory id at all. |

### B.4 Recommended line shape going forward
Keep `productType` for back-compat, **add** two optional fields to make identity explicit:

```ts
{
  productType: string,    // legacy: static string OR inventory UUID (unchanged)
  inventory_id?: string,  // NEW: canonical inventory UUID when from inventory catalog
  sku?: string,           // NEW: snapshot of inventory.sku at create time
  label: string,
  color: string | null,
  quantity: number,
  unitPrice: number,
  includeFlashlight: boolean,
  flashlightPrice: number,
  note: string | null,
  total: number,
  // existing image_* fields preserved
}
```

`inventory_id` is the durable identifier that subsequent phases (reservation, fulfillment) gate on. Lines lacking `inventory_id` are explicitly treated as **stock-impactless** during transitions — i.e. no reservation, no decrement, no movement row. This is the safe default.

### B.5 Reliability of regex / text matching (today's withdrawn count)
The inventory page currently derives "المسحوب" by regex-parsing `turath_masr_orders.products` (the free-text summary string). This is fragile because:
- `products` is a concatenation like `"حامل مصحف خشب أبيض x 1 + كشاف x 1"`.
- Same product name with different colors collapses into one match.
- The regex misses quantities written in different formats.
- Cancelled/returned orders are excluded by string-match on Arabic status names.

**Recommendation:** stop relying on `products` for any computation as soon as the movement ledger covers `order_out`. The ledger is the canonical source.

---

## Part C — Recommended stock strategy

### C.1 Three options considered

| Option | Where stock changes | Pros | Cons |
|---|---|---|---|
| 1. Decrement on order **create** | `available -= qty` at `INSERT` | Reflects sellable stock immediately. | Cancellations / edits / aborted carts must reliably reverse. High double-decrement risk. |
| 2. **Reserve on create, decrement on deliver** | `reserved += qty` on INSERT; on `status → delivered`, `reserved -= qty` AND `available -= qty` + write `order_out` movement | Operationally safe: sellable = available − reserved. Cancellation just releases the reservation. | Needs reservation table + migration. Moderate complexity. |
| 3. Decrement **only** when delivered | `available -= qty` on `status → delivered`, write `order_out` movement | Simplest. No reservation table. | Pre-delivery stock count overstates sellability → operators can oversell. |

### C.2 Recommendation: **Option 2 (reservation system)** delivered in three phases

This is the user's expected sequence and matches the company's operational reality (orders move `new → preparing → warehouse → shipping → delivered`, taking days, with non-trivial cancellation rate before delivery).

**Sequence:**
1. **Phase 1 — Identity:** add `inventory_id` + `sku` to new order lines. No stock mutation. Backfill optional (covered in Part J).
2. **Phase 2 — Reservation:** introduce `reservations` table + `reserved` aggregate column + reserve on create + release on cancel/edit. No fulfillment yet.
3. **Phase 3 — Fulfillment:** on `status → delivered`, fulfill reservation → decrement `available`, decrement `reserved`, write `order_out` movement.
4. **Phase 4 — Edit reconcile:** diff old/new lines on edit, generate per-line reservation deltas.
5. **Phase 5 — Returns:** disposition-based `return_in` / `damage_out` movements.
6. **Phase 6 — Exchanges:** reservation + movement plumbing for the child shipping order.
7. **Phase 7 — Historical reconciliation:** a non-mutating report comparing live `available` against the ledger-derived expected count.

### C.3 What strategy we explicitly DO NOT pursue
- **No automatic decrement of historical orders.** Lines created before Phase 1 lack `inventory_id` and are quarantined from inventory logic.
- **No retroactive reservation backfill.** Reservations only attach to orders created after Phase 2 ships.

This is the safe default — we are not reaching into a year of order history to "make stock correct retroactively". Inventory truth starts from the next addition / movement.

---

## Part D — Proposed schema + RPC changes (additive only, NOT applied)

### D.1 Inventory aggregate columns

```sql
ALTER TABLE public.turath_masr_inventory
  ADD COLUMN IF NOT EXISTS reserved integer NOT NULL DEFAULT 0
    CHECK (reserved >= 0);
-- `available` stays as the "physically on hand" count.
-- `sellable = GREATEST(available - reserved, 0)` is a derived value (no column).
```

### D.2 Reservations table

```sql
CREATE TABLE IF NOT EXISTS public.turath_masr_inventory_reservations (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id  uuid         NOT NULL REFERENCES public.turath_masr_inventory(id) ON DELETE RESTRICT,
  order_id      text         REFERENCES public.turath_masr_orders(id),
  order_num     text,
  line_id       text,                                   -- snapshot of the line's client id
  quantity      integer      NOT NULL CHECK (quantity > 0),
  status        text         NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','released','fulfilled','cancelled')),
  reserved_at   timestamptz  NOT NULL DEFAULT now(),
  released_at   timestamptz,
  fulfilled_at  timestamptz,
  created_by    uuid         REFERENCES auth.users(id),
  metadata      jsonb        NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_inventory_reservations_inventory_id_status
  ON public.turath_masr_inventory_reservations(inventory_id, status);
CREATE INDEX IF NOT EXISTS idx_inventory_reservations_order
  ON public.turath_masr_inventory_reservations(order_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_inventory_reservations_order_line_active
  ON public.turath_masr_inventory_reservations(order_id, line_id)
  WHERE status = 'active';
```

The partial unique index on `(order_id, line_id) WHERE status='active'` is the key idempotency guard — calling "reserve" twice for the same line is a no-op.

### D.3 Movement ledger extension (NO migration)
The existing `turath_masr_inventory_movements.movement_type` CHECK already allows `'order_out' / 'exchange_in' / 'exchange_out' / 'return_in'`. No schema change needed.

### D.4 RPCs (all SECURITY DEFINER, `search_path = public`, manager+ gated)

| RPC | Purpose | Inputs | Effects |
|---|---|---|---|
| `inventory_reserve_for_order(p_order_id, p_lines jsonb)` | Reserve all inventory lines for a freshly-created order | order id + array of `{inventory_id, line_id, quantity}` | per line: lock inventory row, insert reservation, bump `reserved`; skip if `inventory_id` is null or unknown; return per-line outcome. |
| `inventory_release_for_order(p_order_id, p_line_id?)` | Release one line or all lines (cancel / edit-down) | order id, optional line id | set reservation `status='released'`, set `released_at`, decrement `reserved`. Idempotent: already-released no-op. |
| `inventory_fulfill_for_order(p_order_id)` | On `status → delivered`: convert reservations to fulfilled + decrement `available` + write `order_out` movement | order id | per line: set reservation `status='fulfilled'`, decrement `reserved`, decrement `available`, INSERT movement (`movement_type='order_out'`, signed `-qty`, `reference_type='order'`, `reference_id=p_order_id`). Idempotent: skips lines already `fulfilled`. |
| `inventory_reconcile_order_lines(p_order_id, p_new_lines jsonb)` | Diff old reservations vs new lines on edit | order id, full new lines array | compute add/remove/quantity deltas; reserve added, release removed, adjust per-line delta. Returns per-line outcome. |
| `inventory_apply_return(p_adjustment_id, p_lines jsonb)` | When an approved return moves to "completed" | adjustment id + per-line disposition (`{inventory_id, qty, disposition: 'return_in' \| 'damage_out' \| 'skip'}`) | per line: write movement; never touches reservations (the parent order was already delivered). |
| `inventory_apply_exchange(p_adjustment_id, p_return_lines jsonb, p_replacement_lines jsonb, p_phase 'create' \| 'deliver')` | Exchange flow | adjustment + return lines + replacement lines + phase | `create`: reserve replacement lines (no return effect yet — return happens at child shipping pickup). `deliver`: fulfill the replacement reservation + apply return dispositions. |

**Hard rules baked into every RPC:**
- Lock inventory row with `FOR UPDATE` before any compute.
- Refuse if `inventory.status = 'archived'`.
- Refuse if resulting `available < 0` (unless caller carries an `override_stock` flag from a future permission key).
- Refuse if caller is not `is_manager_or_above()`.
- Refuse direct client `UPDATE` of `available` / `reserved` (RLS policy that rejects column-level writes).

### D.5 RLS expansion
Add UPDATE / INSERT policies that explicitly REJECT writes to `available` / `reserved` from the client, forcing all changes through the RPCs:

```sql
-- Example sketch — actual policy needs WITH CHECK against NEW.* equality
-- on the protected columns.
CREATE POLICY inventory_no_direct_quantity_update
  ON public.turath_masr_inventory
  FOR UPDATE TO authenticated
  USING (public.is_manager_or_above())
  WITH CHECK (
    NEW.available = OLD.available
    AND NEW.reserved = OLD.reserved
    -- Other columns (name, category, etc.) remain editable via the EditModal.
  );
```

(PostgREST + Supabase exposes per-column WITH CHECK via `OLD` references inside policies on Postgres 15+. If we hit a syntax issue, fall back to a trigger that raises EXCEPTION on direct `available`/`reserved` writes by anyone who isn't running inside one of the SECURITY DEFINER RPCs — detected via a session GUC or via the caller's role.)

---

## Part E — Proposed order integration behaviour

### E.1 New order created
1. AddOrderModal builds `lines[]` including `inventory_id` for every inventory-backed line (and `null` for static-product lines).
2. After the INSERT into `turath_masr_orders` succeeds, the client calls `inventory_reserve_for_order(order_id, lines_with_inventory_id)`.
3. The RPC returns per-line `{ inventory_id, reservation_id, reserved_after, skipped_reason? }`.
4. The client logs `'order.created'` with **additional metadata** `inventory_reservations: [{inventory_id, qty, reservation_id}]`.
5. **Stock movement row is NOT written yet.** Movements only happen at delivery / cancel / return. (Reservations are tracked in their own table.)

### E.2 Status → delivered
- On the trigger or in the client (decide in Phase 3), call `inventory_fulfill_for_order(order_id)`.
- This is the moment one movement row per line is written with `movement_type='order_out'`, signed negative, `reference_type='order'`, `reference_id=order.id`.
- Staff audit: `'order.status_changed'` with metadata extension `inventory_movements: [...]`.

### E.3 Cancelled / archived
- Before delivery: `inventory_release_for_order(order_id)` — reservations flip to `'released'`; `available` unchanged.
- After delivery: **do NOT auto-restore stock**. The user must use the Return / Exchange flow.
- Staff audit: same `'order.status_changed'` entry; metadata extension flags which reservations were released.

### E.4 Edit order — before delivery
1. EditOrderModal computes the new `lines[]`.
2. After the UPDATE succeeds, the client calls `inventory_reconcile_order_lines(order_id, new_lines)`.
3. The RPC compares to current `'active'` reservations and emits per-line outcomes.
4. Staff audit: existing `'order.updated'` metadata extends with `inventory_reservations_delta: { added: [...], removed: [...], adjusted: [...] }`.

### E.5 Edit order — after delivery
- **The reconcile RPC refuses outright** when `order.status = 'delivered'`. The UI surfaces a friendly error: "هذا الطلب تم تسليمه. لتعديل المنتجات استخدم نظام المرتجعات / الاستبدالات."

### E.6 Race conditions
- Reservation RPC uses `SELECT ... FOR UPDATE` on the inventory row + the unique partial index on `(order_id, line_id)` to prevent double-reservation.
- Fulfillment is idempotent: if a reservation is already `'fulfilled'`, the RPC is a no-op for that line.

---

## Part F — Returns integration

### F.1 Disposition model
Each `return_line` in a `turath_masr_order_adjustments` row gains a `disposition` field:

| Value | Effect on stock |
|---|---|
| `return_in` | write `return_in` movement, `available += qty` |
| `damage_out` | write `damage_out` movement, no `available` change (the unit was already off the books) |
| `skip` | no inventory effect (e.g. consumables) |

### F.2 Flow
1. Operator creates the adjustment (state `pending`) — no inventory effect.
2. Admin approves → state `approved` — no inventory effect.
3. Operator marks completed (item physically returned / written off) → client calls `inventory_apply_return(adjustment_id, lines_with_disposition)`.
4. Per-line movements written: `return_in` (positive) or `damage_out` (negative or zero depending on whether we track damage as a separate "damaged" inventory pool — for now keep it as `damage_out` with no `available` change since it was never returned to the books).
5. Adjustment row gets a metadata extension noting the movements it generated.

### F.3 Financial vs stock
The refund_mode / refund_amount logic in `turath_masr_order_adjustments` is **unchanged**. Inventory and finance are decoupled.

---

## Part G — Exchanges integration

### G.1 Two-leg model
Exchanges have two stock effects: a possible return-in and a definite replacement-out.

1. **At adjustment creation** (state `pending`): no stock effect yet.
2. **When the exchange child shipping order is created** (existing flow in `OrderAdjustmentModal.tsx:930-934`): reserve the replacement quantity via `inventory_reserve_for_order(child_order_id, replacement_lines_with_inventory_id)`.
3. **When the child order's status hits `delivered`**: `inventory_fulfill_for_order(child_order_id)` writes `order_out` (or `exchange_out` if we want to distinguish — we can use `metadata.reason='exchange'` and keep `movement_type='order_out'`).
4. **When the original item is physically returned** (operator marks the adjustment `completed`): `inventory_apply_return(adjustment_id, return_lines_with_disposition)` writes `return_in` or `damage_out`.

### G.2 Maintenance parts
- If the part is a real inventory row → use `inventory_id` and the standard flow.
- If the part is purely manual (no inventory record) → no `inventory_id`, no stock effect, no movement row. The adjustment still records the financial side.

---

## Part H — UI changes required (deferred to per-phase PRs)

### H.1 AddOrderModal
- `loadProductCards` already returns the inventory id as `card.value` — wire `inventory_id` into the line on add.
- Show a "متاح للبيع" pill: `available − reserved`. The block-on-oversell rule reads this number, not `available`.

### H.2 EditOrderModal
- Compute and show a preview of the stock impact before save:
  ```
  حركات المخزون عند الحفظ:
    حامل مصحف خشب أبيض  +2  حجز
    كشاف                  -1  فك حجز
  ```
- After the modal successfully saves and the reconcile RPC returns, show a toast with the actual per-line outcomes (in case any line was skipped due to `inventory_id=null` or insufficient stock).

### H.3 OrderAdjustmentModal
- Add a "disposition" selector per return line: صالح ويرجع للمخزون / تالف / لا يرجع.
- For replacement lines, the existing product picker (which already uses `loadProductCards`) ensures `inventory_id` is present.
- Show the stock impact preview before submit.

### H.4 Inventory page
- Add a small "محجوز" badge next to `المتاح` on each card / row.
- Drawer "الحركة" tab already exists; once `order_out` movements start flowing, they'll appear automatically.
- New optional KPI card: "محجوز للطلبات" — `SUM(reserved)` across non-archived rows.

---

## Part I — Risk analysis

| Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|
| Mutating stock on historical orders that lack `inventory_id` | Medium | High | The reconcile / fulfill / reserve RPCs explicitly skip lines with `inventory_id IS NULL`. Historical orders are quarantined. |
| Double-decrement on retry (e.g. flaky network, user clicks "deliver" twice) | High | High | Reservation status is one-way: `active → fulfilled` is an idempotent transition; second call is a no-op. The same applies to `released`. |
| Concurrent orders race for last unit | Medium | High | Reservation RPC uses `FOR UPDATE` row lock on the inventory row, and `WITH CHECK` enforces non-negative `available - reserved`. |
| Cancellation after fulfillment ("oh wait, that was wrong") | Low | Medium | Refuse to release a `'fulfilled'` reservation. The user must go through the Return flow. |
| Edit-after-delivery accidentally rewriting lines | Medium | Medium | Reconcile RPC refuses for `status='delivered'`. UI gates the form save with a clear message. |
| Archive of an inventory row that has active reservations | Low | Medium | Archive RPC (future) checks for active reservations and refuses, or moves them to `cancelled` with audit. |
| Adjustment "completed" twice → double `return_in` | Low | High | `inventory_apply_return` records adjustment_id + line ids in movement metadata and refuses to write twice for the same adjustment+line. |
| Static-product orders contribute zero stock signal | Low | Low | Acceptable. Static products are an emergency fallback; teams should add inventory rows ASAP to engage stock tracking. |
| Reconciliation report shows discrepancies | Medium | Low | This is expected — historical orders' stock effects were never recorded. Document this in the report and don't auto-fix. |

### Rollback strategy
Each phase's migration is additive and reversible:
- **Phase 1** (identity): no migration needed — adding fields to the JSONB doesn't affect old rows.
- **Phase 2** (reservation): drop the new table + column to roll back; no data is lost on `turath_masr_inventory` (only `reserved` resets to 0).
- **Phase 3** (fulfillment): roll back by reverting the trigger / removing the client-side RPC call. Movement rows that were written stay — they're a true historical record.
- **Phases 4+:** all additive; each rolls back by reverting the calling code.

### Testing strategy
- Unit-test each RPC in isolation with controlled before/after counts.
- Integration test: create / edit / cancel / deliver / return / exchange a synthetic order in staging and assert the movement ledger reads back exactly the expected sequence.
- Idempotency test: call each transition RPC twice and assert no duplicate movement rows.

---

## Part J — Implementation phase recommendation

> Each phase is one PR. All follow the same audit-first / PR-only / migration-staged pattern this codebase has established.

### Phase Inventory-Order-Identity-1
**Goal:** new order lines carry `inventory_id` + `sku`. No stock mutation.

| Item | Detail |
|---|---|
| Files | `src/lib/orders/productCards.ts` (add `inventory_id` to `DraftOrderLine`), `src/app/orders-management/components/AddOrderModal.tsx` (line 2115), `src/app/orders-management/components/EditOrderModal.tsx` (line 464), `src/lib/orders/orderAdjustments.ts` (AdjustmentLine), `src/lib/inventory/inventoryStats.ts` (`withdrawnByName` can be replaced by a future ledger query — out of scope here) |
| Migration | None |
| RPCs | None |
| Risk | Very low — purely additive JSONB fields |
| Verification | typecheck / lint / build; new orders in staging carry `inventory_id`; old orders unchanged |

### Phase Inventory-Reservations-1
**Goal:** reservation table + `reserved` column + reserve on create + release on cancel/edit. No fulfillment yet.

| Item | Detail |
|---|---|
| Files | `AddOrderModal` (call reserve RPC after upsert), `StatusUpdateModal` (call release on `cancelled`), `EditOrderModal` (call reconcile on save), new `src/lib/inventory/reservations.ts` helper |
| Migration | `reserved` column + reservations table + RPCs `inventory_reserve_for_order` / `inventory_release_for_order` / `inventory_reconcile_order_lines` |
| RPCs | Three new |
| Risk | Medium — touches order create/edit/cancel paths. Idempotency-tested. |
| Verification | Manual: create 3 orders; cancel one; edit one; observe `reserved` counts and reservation rows |

### Phase Inventory-Delivery-Fulfillment-1
**Goal:** on `status → delivered`, fulfill reservations + decrement `available` + write `order_out` movement.

| Item | Detail |
|---|---|
| Files | `StatusUpdateModal` (call fulfill on `delivered`) |
| Migration | New RPC `inventory_fulfill_for_order` |
| RPCs | One new |
| Risk | High — first PR that actually mutates `available` based on orders. End-to-end QA required. |
| Verification | Deliver 5 staged orders; verify `available` decremented exactly once each; replay status transition and confirm idempotency |

### Phase Inventory-Edit-Reconcile-1
**Goal:** edit-order diffs reservations correctly across product swaps + qty changes.

| Item | Detail |
|---|---|
| Files | `EditOrderModal` (preview + post-save reconcile), drawer UI hint |
| Migration | None (the RPC was created in Phase 2; this phase exercises it more fully) |
| RPCs | Refinement of `inventory_reconcile_order_lines` if Phase 2 simplified it |
| Risk | Medium |
| Verification | Edit covering: add line, remove line, change qty, swap product, swap color of same product |

### Phase Inventory-Returns-Stock-1
**Goal:** approved+completed returns write `return_in` or `damage_out` movements based on disposition.

| Item | Detail |
|---|---|
| Files | `OrderAdjustmentModal` (disposition selector + post-complete RPC call) |
| Migration | New RPC `inventory_apply_return` |
| RPCs | One new |
| Risk | Medium |
| Verification | Complete a full return (good condition) + a damaged return; verify movements |

### Phase Inventory-Exchange-Stock-1
**Goal:** child shipping order reservation + fulfillment + return disposition for the original item.

| Item | Detail |
|---|---|
| Files | `OrderAdjustmentModal` + `adjustmentChildOrder.ts` |
| Migration | New RPC `inventory_apply_exchange` |
| RPCs | One new |
| Risk | High (touches the most complex existing flow) |
| Verification | Full exchange (good condition return + replacement delivered); partial exchange; cancelled exchange |

### Phase Inventory-Historical-Reconciliation-1
**Goal:** non-mutating report comparing live inventory vs ledger-derived expected counts.

| Item | Detail |
|---|---|
| Files | new `/inventory/reports/reconciliation` page |
| Migration | None |
| RPCs | None (pure SELECTs) |
| Risk | Low |
| Verification | Run the report; review discrepancies manually |

---

## First recommended PR

**Phase Inventory-Order-Identity-1** is the right first step:

1. **Zero risk to existing data.** All changes are additive JSONB fields.
2. **Zero migration.** Postgres accepts new keys in JSONB without schema changes.
3. **Unblocks every subsequent phase.** Reservations / fulfillment / returns all need `inventory_id` to do anything safely.
4. **Backward compatible.** Old orders without `inventory_id` continue to work; stock RPCs treat them as no-op.
5. **Small touch.** ~5 files, all in `src/app/orders-management/` and `src/lib/orders/`.

### What Phase Inventory-Order-Identity-1 specifically ships
- Adds `inventory_id?: string` and `sku?: string` to `DraftOrderLine` ([productCards.ts:98](../src/lib/orders/productCards.ts#L98)).
- Captures `inventory_id` from `card.value` (when `card.isInventory === true`) inside `createDraftLine` ([productCards.ts:141](../src/lib/orders/productCards.ts#L141)).
- Persists `inventory_id` + `sku` into the saved line shape in `AddOrderModal` (lines 2115–2127) and `EditOrderModal` (lines 464–489).
- Mirrors the fields on `AdjustmentLine` ([orderAdjustments.ts:99](../src/lib/orders/orderAdjustments.ts#L99)).
- Tests: typecheck/lint/build + manual create-order-with-inventory smoke + verify the new line shape arrives in DB.

### Strictly NOT in Phase 1
- No reservations table.
- No `reserved` column.
- No new RPCs.
- No stock mutation anywhere.
- No UI for "sellable" / "reserved".

### Strict order of subsequent PRs
**Do NOT skip ahead to Phase 3.** Without Phase 2 (reservations), Phase 3 (fulfillment) would decrement `available` directly on delivery, leaving us in the same overselling failure mode as today.

Recommended sequence:
1. **Phase Inventory-Order-Identity-1** (this is the first PR — additive only)
2. **Phase Inventory-Reservations-1**
3. **Phase Inventory-Delivery-Fulfillment-1**
4. **Phase Inventory-Edit-Reconcile-1**
5. **Phase Inventory-Returns-Stock-1**
6. **Phase Inventory-Exchange-Stock-1**
7. **Phase Inventory-Historical-Reconciliation-1**

---

## Safety confirmation — Phase Inventory-Orders-Returns-Integration-0

- ✅ No code changes (only this doc created)
- ✅ No DB writes (audit was a single read-only `SELECT … FROM turath_masr_orders LIMIT 5`)
- ✅ No migrations applied
- ✅ No schema / RLS / auth changes
- ✅ No inventory quantity mutations
- ✅ No order / return / exchange mutations
- ✅ No deploy, no PM2 reload
- ✅ POS / `zahran-retail-pos` / `turath-mart-join` / `turath-staging` / `financial.turathmasr.com` / `/var/www/turath-mart-new` — all untouched

**Awaiting your direction.** Recommendation: start with Phase Inventory-Order-Identity-1 as the next implementation PR.
