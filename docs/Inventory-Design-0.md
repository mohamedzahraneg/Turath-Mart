# Phase Inventory-Design-0 — Warehouse / Inventory Full Design Proposal

> **Status:** design-only proposal. No code changes. No DB writes. No migrations.
> **Branch / commit audited:** `main` @ `72914ac`
> **Audit date:** 2026-05-15

---

## Part A — Current inventory audit

### A.1 Existing pages and modules

| Path | Lines | Role |
|---|---|---|
| `src/app/inventory/page.tsx` | 954 | Full inventory page (list + KPI + filter + edit modal) |
| `src/lib/inventory/InventoryThumbnail.tsx` | 135 | Reusable thumbnail component + `inventoryThumbnailUrl(id)` helper |
| `src/lib/orders/productCards.ts` | 264 | Loads inventory into product cards for AddOrder/EditOrder |
| `src/app/api/inventory/[id]/thumbnail/route.ts` | ~190 | RLS-gated thumbnail endpoint (24h cached) |
| `src/components/Sidebar.tsx:88-93` | — | `/inventory` nav entry, gated by `hasAccess(href)` |

### A.2 DB tables and columns

Only **one** inventory-related table exists: `turath_masr_inventory` (6 rows in production today).

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` | PK |
| `name` | text | NO | — | display name |
| `sku` | text | NO | — | unique SKU |
| `available` | integer | YES | `0` | on-hand count (manual, no auto-decrement) |
| `withdrawn` | integer | YES | `0` | unused in app; counts derived from orders.products string |
| `min_stock` | integer | YES | `10` | low-stock alert threshold |
| `price` | numeric | YES | `0` | unit price (no cost price) |
| `category` | text | YES | — | free-text category |
| `images` | text[] | YES | — | **base64 array** (~108 KB per row); served via thumbnail API |
| `colors` | text[] | YES | — | free-text color labels |
| `created_at` | timestamptz | YES | `now()` | — |

**No other inventory-related tables exist.** No movement log, no additions log, no images table (binary), no variants table, no suppliers table, no purchase orders.

### A.3 RLS policies on `turath_masr_inventory`

| Cmd | Policy | Role | Notes |
|---|---|---|---|
| SELECT | `inventory_authenticated_select` | authenticated | anyone signed in can read |
| INSERT | `inventory_manager_insert` | authenticated | manager-and-above only |
| UPDATE | `inventory_manager_update` | authenticated | manager-and-above only |
| DELETE | `inventory_admin_delete` | authenticated | admin only |

Pattern differs from delegates (no `finance_reader` policy). Fine for current scope.

### A.4 Integration with orders

| Touchpoint | State | Behaviour |
|---|---|---|
| AddOrderModal reads inventory | ✅ Wired | `loadProductCards(supabase)` @ `productCards.ts:185` — narrow `select` (no images) |
| AddOrderModal stock UI check | ⚠️ UI-only | `available > 0` gates the card visually; no hard prevention at submit |
| AddOrderModal **decrements** inventory | ❌ Never | `available`/`withdrawn` columns are NEVER updated by order create |
| AddOrderModal writes movement log | ❌ Never | no log table, no entry |
| EditOrderModal reads inventory | ✅ Wired | same `loadProductCards` call |
| EditOrderModal **adjusts** inventory | ❌ Never | swapping/removing/adding products has zero inventory effect |
| Order row stores products | ⚠️ Mixed | text column `products` (summary string) + JSONB column `lines` (structured) |
| Returns / exchanges | ❌ Not integrated | adjustments page exists but no inventory write-back |
| Inventory thumbnail in tracking | ✅ Wired | customer `/track/t/<token>` never sees API thumbnail URL (Phase E1-Fix1.1) |
| Staff audit log includes inventory | ❌ Never | only `order.created` / `order.updated` action keys; no `inventory.*` |

### A.5 `withdrawn` is computed, not stored

[src/app/inventory/page.tsx:559-608](src/app/inventory/page.tsx#L559) — on every mount, the page:
1. Fetches all `turath_masr_orders.products` text values,
2. Parses each with three regex variants (`(2)`, `x 2`, trailing digits),
3. Aggregates per product name,
4. Stores result in a React `realWithdrawnAmounts` map.

The DB column `turath_masr_inventory.withdrawn` is **never written** by the app. This is fragile (depends on string parsing) and wrong on cancel/return (the regex filters out `cancelled` / `returned` orders but counts every other status equally — so `processing` and `delivered` both decrement, which is incorrect if `processing` shouldn't reserve stock).

### A.6 Categories are hard-coded and don't match user expectations

[page.tsx:46](src/app/inventory/page.tsx#L46):
```ts
const categories = ['الكل', 'حوامل', 'إكسسوارات', 'أثاث', 'كتب', 'ديكور'];
```

User-requested taxonomy (from this phase's spec):
> حامل مصحف، مصحف، كشاف، كرسي، كعبة، قطع صيانة، أخرى

Mismatch. Categories should be data-driven, not hard-coded.

### A.7 Current page UI inventory (what's actually rendered today)

- Header: title `إدارة المخزون` + low-stock pill + `+ إضافة صنف` button
- 4 KPI cards: total items / total available / total withdrawn / needs renewal
- Filters: search box (name or SKU) + category pills row
- One table: image / name / SKU / category / colors (max 3) / available (+ progress bar) / withdrawn / price / status / actions (edit, delete)
- Edit modal: images carousel + name + auto-SKU + category dropdown + available + min-stock + price + colors chips
- No drawer, no per-product details view
- No movement log, no additions log
- No print / export
- Delete is destructive with no audit trail or confirmation

### A.8 Current gaps (summary)

| Gap | Impact |
|---|---|
| No movement log table | Cannot reconstruct how stock got to its current count |
| No additions log table | Cannot audit who added what, when, from which supplier |
| No supplier table | No purchase tracking, no cost-of-goods, no reorder workflow |
| No variants table | Color stored as text array — can't track per-color quantity |
| No cost price | Cannot compute margin or inventory valuation correctly |
| No reservation on order create | Two orders can claim the same last unit |
| No decrement on order delivery | `available` drifts from reality, requires manual edit |
| `withdrawn` is parsed from text | Fragile, ignores quantity edits, double-counts on duplicates |
| Images stored as base64 in column | Bloats row size (~108 KB each); thumbnail API works around it but exports/backups suffer |
| Hard-coded categories | Doesn't match real catalog (e.g. "كشاف", "كعبة") |
| Delete is destructive | No soft-delete, no archive, no audit |
| No print / CSV export | Cannot share stock count with operations / supplier |
| No permission per-feature | View/edit/cost/adjust collapsed into "manager-or-above" |

---

## Part B — Required warehouse design (goals)

The redesigned `/inventory` should match the rest of Turath-Masr's identity:

- **RTL Arabic** layout, same Tailwind theme (`hsl(var(--primary))`, soft border-radius `rounded-2xl`, dashed-purple smart-filter container as on `/orders-management`).
- **Two view modes:** table (default for ops) + card grid (for browsing/visual ops).
- **Strong search:** name / SKU / category / color, debounced, full-width.
- **Smart filter chips:** status (all / available / low / out / paused) and category (data-driven).
- **6 KPI cards** above the fold, all driven by live data.
- **Per-product drawer** with tabs (summary / movements / additions / variants / images / linked orders / settings).
- **Two new logs:** product additions log + inventory movement log.
- **Stock alerts:** banner above the table when ≥ 1 item is at/below `min_stock`.
- **No data mocks** anywhere.
- **Surgical** initial slice — Phase Inventory-1 should reuse the existing table and the existing thumbnail route, with additive migrations only.

---

## Part C — Main layout proposal

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  HEADER ROW                                                                   │
│  ┌──────────────────────┐                ┌─────────────────────────────────┐  │
│  │ إدارة المخزن          │                │ + إضافة منتج   تسجيل حركة       │  │
│  │ الرئيسية > المخزن      │                │ استيراد   تصدير   تحديث          │  │
│  └──────────────────────┘                └─────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────────┘

┌──────────┬──────────┬──────────┬──────────┬──────────┬──────────┐
│ إجمالي   │ إجمالي   │ قيمة     │ منخفض    │ نفد      │ إضافات   │
│ المنتجات │ القطع    │ المخزون  │ المخزون  │          │ اليوم    │
│  124     │ 3,812    │ 2.4M ج.م │  7       │  3       │  +12     │
└──────────┴──────────┴──────────┴──────────┴──────────┴──────────┘

┌───────────────────────────────────────────────────────────────────────────────┐
│  SMART FILTER (dashed purple container, RTL):                                 │
│   الكل ▸ متاح ▸ منخفض المخزون ▸ نفد ▸ موقوف                                    │
│                                                                               │
│  CATEGORY CHIPS:                                                              │
│   حامل مصحف ▸ مصحف ▸ كشاف ▸ كرسي ▸ كعبة ▸ قطع صيانة ▸ أخرى                   │
│                                                                               │
│  SEARCH:       [🔍 ابحث بالاسم/SKU/الفئة/اللون…………………]                       │
│  MORE:         [▼ اللون] [▼ السعر] [▼ الكمية] [▼ تاريخ الإضافة] [▼ المورد]    │
│                                                                               │
│  VIEW TOGGLE:  [ ▦ بطاقات ] [ ☰ جدول ]                                        │
└───────────────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────────────┐
│  ALERT BANNER (only when low/out > 0):                                        │
│   ⚠️ 7 منتجات منخفضة المخزون و 3 منتجات نفدت — راجع                            │
└───────────────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────────────┐
│  MAIN BODY: table OR card grid (toggle above)                                 │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Header buttons** map to:
- `+ إضافة منتج` → opens AddProductModal (Part D)
- `تسجيل حركة مخزون` → opens MovementModal (Part E)
- `استيراد` → CSV upload (future phase; placeholder)
- `تصدير` → CSV download (current view, respects filters)
- `تحديث` → triggers `reloadTick++` re-fetch (no full page reload)

---

## Part C.4 — Product cards / grid

Each card (suggested size: 240 × 320 px, `rounded-2xl`, soft shadow):

```
┌─────────────────────────────────┐
│  ┌───────────────────────────┐  │
│  │                           │  │
│  │     [Product image]       │  │
│  │                           │  │
│  └───────────────────────────┘  │
│                                 │
│  حامل مصحف خشب                  │ ← bold name
│  HOLDER-WOOD-BROWN              │ ← mono SKU, muted
│                                 │
│  الفئة: حامل مصحف                │
│                                 │
│  [بني] [أبيض] [أسود]            │ ← color chips (max 3 + "+N")
│                                 │
│  ┌──────────┐  ┌──────────┐    │
│  │ 599 ج.م   │  │ متاح: 24 │    │ ← price + qty side-by-side
│  └──────────┘  └──────────┘    │
│                                 │
│  ● متاح        محدّث منذ 3 س     │ ← status dot + last-update
│                                 │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐│
│  │ 👁 │ │ ✏ │ │ +قطع│ │ -قطع│ │ ← action icons
│  └─────┘ └─────┘ └─────┘ └─────┘│
└─────────────────────────────────┘
```

Status dot colours:
- 🟢 متاح (available > min_stock)
- 🟡 منخفض (0 < available ≤ min_stock)
- 🔴 نفد (available == 0)
- ⚪ موقوف (status='paused')

---

## Part C.5 — Product table

Default view for ops. Columns:

| الصورة | المنتج | SKU | الفئة | الألوان | السعر | المتاح | المحجوز | المباع | المرتجع | الحد الأدنى | الحالة | آخر حركة | الإجراءات |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

- `المتاح` = `available - reserved`
- `المحجوز` = orders in `pending`/`processing` that haven't been delivered (computed in Phase 5; placeholder column initially)
- `المباع` = movement-log SUM where `kind='order_out'` (placeholder until Phase 3)
- `المرتجع` = movement-log SUM where `kind='return_in'` (placeholder until Phase 6)
- `آخر حركة` = latest movement timestamp (placeholder until Phase 3)
- `الإجراءات` = drawer-open / edit / +qty / -qty / movements

Row hover reveals action icons. Click anywhere else opens the drawer.

---

## Part C.6 — Product details drawer

Slide-in from right (mirrors delegate drawer pattern, ~720 px wide on xl).

```
╔════════════════════════════════════════╗
║  حامل مصحف خشب                          ║
║  HOLDER-WOOD-BROWN                       ║
║  ● متاح                                  ║
║                                          ║
║  [الملخص][الحركة][الإضافات]              ║
║  [الألوان][الصور][الأوامر][الإعدادات]    ║
║─────────────────────────────────────────║
║                                          ║
║   tab content                            ║
║                                          ║
╚════════════════════════════════════════╝
```

**الملخص tab:**
- Hero image (carousel if multiple)
- Two-column factsheet: name / SKU / category / status / price / cost / margin / available / reserved / sold-90d / returned-90d / min-stock / inventory value (=available × cost)
- Two CTA buttons: `+ إضافة كمية` / `- خصم / تسوية`

**الحركة tab:**
Table of `turath_masr_inventory_movements` (newest first):
- date / kind chip / qty (signed, colored) / reason / reference (order #, supplier inv, adjustment #) / user / note

**الإضافات tab:**
Table of `turath_masr_inventory_additions` for this product:
- date / qty / unit cost / total cost / supplier / invoice # / added by / note

**الألوان tab (when product has variants):**
- One row per variant: color name + swatch / variant SKU / quantity / unit price (if different) / image / +qty / edit

**الصور tab:**
- Grid of images, click to set primary, drag to reorder, X to delete (with confirm)
- "إضافة صورة" button → multi-file upload
- Optional: migrate from base64 column to `inventory_images` table (Phase 1+)

**الأوامر tab:**
- Last 20 orders containing this product (joined on `turath_masr_orders.products LIKE %name%` until Phase 3 introduces a structured `order_lines` reference table)

**الإعدادات tab:**
- Toggle: active / paused
- Min-stock threshold input
- Default cost price input
- Soft-delete (archive) button — destructive `DELETE` is now admin-only and double-confirmed

---

## Part D — Add product flow

### Modal layout

```
┌─ إضافة منتج جديد ────────────────── × ┐
│                                       │
│  [ + رفع صورة رئيسية ]                │
│  [ + صور إضافية ]                     │
│                                       │
│  اسم المنتج *      [_____________]    │
│  SKU *            [_____________] [↻] │ ← auto-generate
│  الفئة *           [▼____________]    │
│                                       │
│  الوصف             [_____________]    │
│                                       │
│  السعر * (ج.م)    [_____]             │
│  تكلفة الشراء      [_____]             │ ← admin-only field
│                                       │
│  الكمية الافتتاحية [_____]             │
│  حد التنبيه        [_____]             │
│                                       │
│  الألوان           [بني][أبيض][+]     │
│                                       │
│  المورد            [▼ اختر المورد]     │
│  ملاحظة داخلية     [_____________]    │
│  الحالة            ● نشط  ○ موقوف     │
│                                       │
│  [حفظ المنتج] [حفظ وإضافة كمية] [إلغاء]│
└───────────────────────────────────────┘
```

### Validation rules

| Field | Rule |
|---|---|
| `name` | required, trimmed, length ≥ 2 |
| `sku` | required, unique (DB constraint), uppercase recommended |
| `category` | required, must be in `inventory_categories` table |
| `price` | required, ≥ 0 |
| `cost_price` | optional, ≥ 0, ≤ price recommended (warning only) |
| `quantity` | ≥ 0 |
| `min_stock` | ≥ 0 |
| `image` | optional but recommended |
| `colors` | optional, each trimmed unique |
| `status` | `'active' \| 'paused' \| 'archived'`, default `'active'` |

### Save behaviours

| Button | Effect |
|---|---|
| `حفظ المنتج` | INSERT into `turath_masr_inventory` only; closes modal |
| `حفظ وإضافة كمية` | INSERT into `turath_masr_inventory`, then **immediately open MovementModal pre-filled with kind=`add` and product=just-created** — the second save writes the addition + movement |
| `إلغاء` | discard, confirm if dirty |

Both save paths write a `staffAuditLog` entry with action `inventory.product_created` and (when applicable) `inventory.movement_created`.

---

## Part E — Stock movement flow

### Modal layout

```
┌─ تسجيل حركة مخزون ────────────────── × ┐
│                                        │
│  المنتج *      [▼ ابحث واختر…]         │
│  اللون/النسخة  [▼ — لا يوجد —]         │
│                                        │
│  نوع الحركة *                           │
│  ┌──────────────────────────────────┐  │
│  │ ○ إضافة كمية  ○ خصم كمية         │  │
│  │ ○ تسوية جرد   ○ مرتجع من عميل   │  │
│  │ ○ تالف         ○ تحويل           │  │
│  │ ○ تعديل سعر                       │  │
│  └──────────────────────────────────┘  │
│                                        │
│  الكمية *       [_____]                │
│  السبب          [▼ اختر سبب]            │
│                                        │
│  المرجع (اختياري)                       │
│   ▢ رقم طلب     [____________]          │
│   ▢ مرتجع/استبدال [____________]        │
│   ▢ فاتورة مورد   [____________]        │
│                                        │
│  ملاحظة         [____________]          │
│  التاريخ        [📅 2026-05-15]         │
│                                        │
│  [حفظ الحركة] [إلغاء]                  │
└────────────────────────────────────────┘
```

### Movement kinds (canonical enum)

```ts
type MovementKind =
  | 'add'              // إضافة كمية from supplier / opening stock
  | 'order_out'        // -1 per unit on order create or delivery (Phase 5)
  | 'order_in'         // +1 when an order line is removed before delivery
  | 'return_in'        // +1 from customer return (Phase 6)
  | 'damage_out'       // -N for damaged / broken items
  | 'adjustment'       // ± from physical stock-take
  | 'transfer'         // ± between warehouses (future)
  | 'price_change';    // 0 qty; records old/new price
```

### Validation rules

| Rule | Detail |
|---|---|
| `qty > 0` for all non-zero kinds | `price_change` is the only kind with qty=0 |
| For negative kinds, `qty ≤ available` | Unless user has `inventory.override_stock` permission |
| Every movement writes one row to `turath_masr_inventory_movements` | atomic with the UPDATE to inventory |
| `MovementKind.add` ALSO writes one row to `turath_masr_inventory_additions` | with cost/supplier metadata |
| The `available` column is updated server-side via RPC `inventory_apply_movement` | so concurrent movements can't race |
| Staff audit log entry `inventory.movement_created` | with metadata |

---

## Part F — Product additions log (`/inventory/additions`)

Dedicated section for "every time stock was added" — useful for procurement and supplier reconciliation. Read-only timeline.

### Columns

| التاريخ | المنتج | SKU | الفئة | الكمية المضافة | السعر | تكلفة الشراء | الإجمالي | المورد | أضيف بواسطة | رقم الفاتورة | ملاحظة | الإجراء |
|---|---|---|---|---|---|---|---|---|---|---|---|---|

### Filters

- Preset date chips: اليوم / هذا الأسبوع / هذا الشهر / آخر 90 يوم / مخصص
- Product picker (typeahead)
- Category multi-select
- Supplier multi-select
- Added-by user picker
- Free-text search

### Actions

- Row → row click → opens product drawer on the **الإضافات** tab
- "عرض الحركة" → opens corresponding `movements` row
- Toolbar: `طباعة` (window.print + print-only block) and `تصدير CSV` (with UTF-8 BOM)

---

## Part G — Inventory movement log (`/inventory/movements`)

Master ledger of all stock motion. Newest-first, fully filterable, exportable.

### Columns

| التاريخ | نوع الحركة (chip) | المنتج | اللون | الكمية قبل | الكمية بعد | التغيير (signed) | السبب | المرجع | المستخدم |
|---|---|---|---|---|---|---|---|---|---|

Examples (visual):
- `+20  إضافة كمية` (green)
- `-1   بيع — طلب #2605123` (red, links to order)
- `+1   مرتجع — طلب #2605110` (green, links to adjustment)
- `-2   تالف` (red)
- `±5   تسوية جرد` (amber)
- `سعر   500 → 550` (blue)

### Filters

- Date preset chips + custom range
- Movement kind chips: all / additions / outs / returns / adjustments / damage / price changes
- Product / category / user / reference-type

### Actions

- Click row → drawer to that product, scrolled to that movement
- Toolbar: print + CSV export
- Optional "تراجع الحركة" (reverse) — admin-only, creates a compensating movement with `reverses_movement_id = <id>`

---

## Part H — Integration requirements

### H.1 AddOrderModal

| Item | Required behaviour |
|---|---|
| Product picker | filter by `status='active'` AND (`available > 0` OR user has `override_stock`) |
| Color picker | reads from `inventory_variants` when present, falls back to `colors` text array |
| Price | read-only from inventory `price`; admin can override per-line |
| Quantity input | clamped to `available - reserved` (variant-aware) |
| On submit | one of: <br>(a) **reserve** mode: write a row to `turath_masr_inventory_movements` with `kind='order_out_reserved'`, `qty=-N`, and ALSO write a `reserved` increment on the product (Phase 5). <br>(b) **delivery-only** mode: do nothing on create; only decrement on status → `delivered` (simpler, Phase 1). <br>Recommendation: ship **delivery-only** in Phase 1, add **reserve** in Phase 5. |
| Audit log | extend `order.created` metadata with `inventory_movements: [...]` array |

### H.2 EditOrderModal

| Item | Required behaviour |
|---|---|
| Swap product | write two movements: `order_in` for the old line + `order_out` for the new |
| Quantity change | write one movement with the delta |
| Remove line | `order_in` movement returning the qty |
| Add line | `order_out` movement subtracting the qty |
| All writes | atomic with the order update (single Supabase batch / RPC) |
| Status changes | when delivery-only mode: trigger movements on `status: pending → delivered` and reverse on `delivered → returned/cancelled` |

### H.3 Returns / exchanges

| Item | Required behaviour |
|---|---|
| Full return | each returned line → `return_in` movement; refund unaffected by inventory logic |
| Damaged return | choose between `return_in` (resaleable) or `damage_out` (write-off) — operator picks at adjustment time |
| Exchange | one `return_in` for the old line + one `order_out` for the new |
| Adjustment audit log | extend `adjustment.created` metadata with `inventory_movements: [...]` |

### H.4 Customer tracking

| Item | Required behaviour |
|---|---|
| `/track/t/<token>` | **must not** expose inventory data — no available counts, no SKUs, no costs |
| Thumbnail | already uses `/api/inventory/[id]/thumbnail`; keep RLS-gated, no change |

---

## Part I — Permissions

### Proposed permission strings

| Permission | Description | Default roles |
|---|---|---|
| `view_inventory` | see inventory page, product cards, available qty | r1 admin, r2 manager, r3 supervisor, r4 ops, r5 sales |
| `manage_inventory` | create / edit products, upload images, edit price | r1 admin, r2 manager |
| `adjust_inventory` | record movements, adjust qty, mark damage | r1 admin, r2 manager, warehouse staff |
| `override_stock` | submit order/movement even if `available` insufficient | r1 admin (only) |
| `upload_inventory_images` | upload product images | r1 admin, r2 manager |
| `view_inventory_cost` | see cost_price, margin, inventory valuation | r1 admin, r2 manager |
| `export_inventory` | CSV export of inventory / movements / additions | r1 admin, r2 manager |
| `delete_inventory` | hard-delete (vs archive) | r1 admin only |

Roles → defaults are illustrative; the actual mapping lives in `src/lib/constants/roles.ts` and `src/lib/permissions/permissions.ts`. We will not change the role table; we'll only add new permission keys.

### UI gating examples

```ts
const perms = usePermissions();
const canManage = perms.can('manage_inventory');
const canAdjust = perms.can('adjust_inventory');
const canViewCost = perms.can('view_inventory_cost');
```

Buttons / columns are hidden (not disabled) when the gate is false, matching the delegate page's pattern.

---

## Part J — Data model proposal (additive only)

> **All migrations deferred to a future implementation phase. This section is design only.**
> No destructive changes to existing `turath_masr_inventory` are proposed.

### J.1 Extend `turath_masr_inventory` (additive)

```sql
ALTER TABLE turath_masr_inventory
  ADD COLUMN IF NOT EXISTS status            text         DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS description       text,
  ADD COLUMN IF NOT EXISTS cost_price        numeric      DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reserved          integer      DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_movement_at  timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at       timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by       uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS archived_reason   text,
  ADD COLUMN IF NOT EXISTS category_id       uuid REFERENCES turath_masr_inventory_categories(id);
-- the `withdrawn` column is kept for back-compat but will be deprecated;
-- the value is now derived from movement_log SUM(kind='order_out').
```

`status` enum (text): `'active' | 'paused' | 'archived'`.

### J.2 `turath_masr_inventory_categories` (new)

```sql
CREATE TABLE turath_masr_inventory_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,            -- e.g. 'حامل مصحف'
  slug        text NOT NULL UNIQUE,            -- e.g. 'quran-holder'
  sort_order  integer DEFAULT 100,
  is_active   boolean DEFAULT true,
  created_at  timestamptz DEFAULT now()
);
```

Seed with: `حامل مصحف`, `مصحف`, `كشاف`, `كرسي`, `كعبة`, `قطع صيانة`, `أخرى`.

### J.3 `turath_masr_inventory_variants` (new)

```sql
CREATE TABLE turath_masr_inventory_variants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id  uuid NOT NULL REFERENCES turath_masr_inventory(id) ON DELETE CASCADE,
  variant_sku   text NOT NULL UNIQUE,
  color         text,                          -- canonical color name
  color_hex     text,                          -- optional swatch hex
  available     integer NOT NULL DEFAULT 0,
  reserved      integer NOT NULL DEFAULT 0,
  price         numeric,                       -- nullable: inherit parent
  image_path    text,                          -- variant-specific image
  status        text DEFAULT 'active',
  created_at    timestamptz DEFAULT now(),
  CHECK (available >= 0 AND reserved >= 0)
);
CREATE INDEX ON turath_masr_inventory_variants(inventory_id);
```

`turath_masr_inventory.colors` text array stays for back-compat. New code reads variants first, falls back to `colors`.

### J.4 `turath_masr_inventory_movements` (new)

```sql
CREATE TABLE turath_masr_inventory_movements (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id          uuid NOT NULL REFERENCES turath_masr_inventory(id),
  variant_id            uuid REFERENCES turath_masr_inventory_variants(id),
  kind                  text NOT NULL,
  qty                   integer NOT NULL,                    -- signed: +N or -N (0 for price_change)
  before_available      integer NOT NULL,
  after_available       integer NOT NULL,
  reason                text,
  reference_type        text,                                -- 'order' | 'adjustment' | 'supplier_invoice' | null
  reference_id          uuid,
  note                  text,
  user_id               uuid REFERENCES profiles(id),
  user_name             text,
  reverses_movement_id  uuid REFERENCES turath_masr_inventory_movements(id),
  occurred_at           timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (kind IN (
    'add','order_out','order_in','return_in','damage_out',
    'adjustment','transfer','price_change'
  ))
);
CREATE INDEX ON turath_masr_inventory_movements(inventory_id, occurred_at DESC);
CREATE INDEX ON turath_masr_inventory_movements(reference_type, reference_id);
CREATE INDEX ON turath_masr_inventory_movements(kind);
```

### J.5 `turath_masr_inventory_additions` (new)

```sql
CREATE TABLE turath_masr_inventory_additions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id        uuid NOT NULL REFERENCES turath_masr_inventory(id),
  variant_id          uuid REFERENCES turath_masr_inventory_variants(id),
  movement_id         uuid NOT NULL REFERENCES turath_masr_inventory_movements(id) ON DELETE RESTRICT,
  qty                 integer NOT NULL CHECK (qty > 0),
  unit_cost           numeric,
  total_cost          numeric GENERATED ALWAYS AS (qty * unit_cost) STORED,
  supplier_id         uuid REFERENCES turath_masr_suppliers(id),
  supplier_name_snapshot text,
  supplier_invoice_no text,
  added_at            timestamptz NOT NULL DEFAULT now(),
  added_by            uuid REFERENCES profiles(id),
  added_by_name       text,
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON turath_masr_inventory_additions(inventory_id, added_at DESC);
CREATE INDEX ON turath_masr_inventory_additions(supplier_id);
```

### J.6 `turath_masr_inventory_images` (new, optional)

For migrating off the base64 `images` text array. Stores file metadata; binary lives in Supabase Storage bucket `inventory-images`.

```sql
CREATE TABLE turath_masr_inventory_images (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id  uuid NOT NULL REFERENCES turath_masr_inventory(id) ON DELETE CASCADE,
  variant_id    uuid REFERENCES turath_masr_inventory_variants(id),
  file_path     text NOT NULL,
  file_name     text,
  mime_type     text,
  size_bytes    integer,
  is_primary    boolean DEFAULT false,
  sort_order    integer DEFAULT 100,
  uploaded_at   timestamptz DEFAULT now(),
  uploaded_by   uuid REFERENCES profiles(id)
);
CREATE UNIQUE INDEX ON turath_masr_inventory_images(inventory_id) WHERE is_primary;
CREATE INDEX ON turath_masr_inventory_images(inventory_id, sort_order);
```

### J.7 `turath_masr_suppliers` (new, optional but recommended)

```sql
CREATE TABLE turath_masr_suppliers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  phone        text,
  email        text,
  notes        text,
  is_active    boolean DEFAULT true,
  created_at   timestamptz DEFAULT now()
);
```

### J.8 RLS shape (proposed)

Same pattern as current `inventory_*`:
- SELECT → authenticated (or finance_reader-equivalent for cost columns hidden in the view)
- INSERT → `manage_inventory`
- UPDATE → `manage_inventory` / `adjust_inventory` (split by column)
- DELETE → admin only
- Movement / addition rows: SELECT for all, INSERT for `adjust_inventory`, no UPDATE, no DELETE (immutable ledger)

### J.9 RPCs (proposed)

```sql
-- atomic: write movement + bump available/reserved
CREATE OR REPLACE FUNCTION inventory_apply_movement(
  p_inventory_id uuid, p_variant_id uuid, p_kind text, p_qty integer,
  p_reason text, p_ref_type text, p_ref_id uuid, p_note text
) RETURNS uuid AS $$ ... $$ LANGUAGE plpgsql SECURITY DEFINER;

-- composite: write addition row + invoke inventory_apply_movement
CREATE OR REPLACE FUNCTION inventory_record_addition(
  p_inventory_id uuid, p_variant_id uuid, p_qty integer,
  p_unit_cost numeric, p_supplier_id uuid, p_invoice_no text, p_note text
) RETURNS uuid AS $$ ... $$ LANGUAGE plpgsql SECURITY DEFINER;
```

Both will check the caller's permissions via `auth.uid()` → profile role lookup. No `available` UPDATE by direct table writes from the app.

---

## Part K — Visual mockup (description + image-gen prompt)

### K.1 Detailed visual description

**Page background:** `hsl(0 0% 99%)` — very soft warm white.
**Card background:** pure white, `rounded-2xl`, 1px border `hsl(214 12% 92%)`, subtle shadow.
**Primary accent:** deep blue `hsl(217 80% 30%)` for buttons / active chips / selected tabs.
**Secondary accents:** emerald-600 for positive states (متاح / +qty), amber-500 for low-stock, red-600 for out / damage / delete, purple-300 dashed for the smart-filter container (matches Orders page).

**Layout grid:** 12-column max-width `1440 px`, gutters `24 px`. Above the fold:
- Header row (64 px tall) at top.
- KPI card row (six cards, equal width on xl, two-per-row on md).
- Smart filter / category container (purple dashed border, padding `12 px` vertical).
- Search row (full-width search + view toggle on the left).
- Optional alert banner.
- Main content (table OR card grid).

**KPI cards:** each 200×120 px, icon top-right, label muted small text, value mono bold 28 px.
**Card grid:** responsive 4-up on xl / 3-up on lg / 2-up on md / 1-up on sm.
**Table:** sticky header, alternating row background `hsl(0 0% 99%)`/white, hover `hsl(214 12% 96%)`.
**Drawer:** slides in from the right, 720 px wide on xl, occupies full width on md and below.

**Empty states:**
- No products yet: large package icon, headline "ابدأ بإضافة أول منتج"، CTA `+ إضافة منتج`.
- No matches for filter: small icon, "لا توجد منتجات تطابق البحث"، link "مسح الفلاتر".
- No movements: small icon, "لم تُسجَّل حركات بعد".

**Typography:** Arabic IBM Plex Sans Arabic for body; same as the rest of the app.

### K.2 Image-generation prompt

```
Create a full-screen Arabic RTL web dashboard for "إدارة المخزن" (Inventory Management)
for a brand called "تراث مصر" (Turath Masr). The aesthetic is a clean Tailwind-style SaaS admin UI
with rounded-2xl cards, soft 1px borders in cool grey (hsl 214 12% 92%), and the primary brand color is
a deep navy blue (#1f4f8b, hsl 217 80% 30%).

Top of the page: a header row with the title "إدارة المخزن" on the right and a breadcrumb
"الرئيسية > المخزن" beneath it; on the left, four pill buttons "+ إضافة منتج", "تسجيل حركة مخزون",
"استيراد", "تصدير", "تحديث".

Below the header: six KPI cards in a single row showing
"إجمالي المنتجات: 124", "إجمالي القطع المتاحة: 3,812", "قيمة المخزون: 2.4M ج.م",
"منتجات منخفضة المخزون: 7", "منتجات نفدت: 3", "إضافات اليوم: +12".
Each card has a small icon top-right (package, warehouse, banknote, alert-triangle, x-circle, plus).

Below the KPIs: a dashed purple-bordered (purple-300) rounded container holding two chip rows.
Row 1 = status chips: الكل ▸ متاح ▸ منخفض المخزون ▸ نفد ▸ موقوف with the second chip active (filled with the brand navy).
Row 2 = category chips: حامل مصحف ▸ مصحف ▸ كشاف ▸ كرسي ▸ كعبة ▸ قطع صيانة ▸ أخرى.

Below that: a full-width search bar with a magnifier icon on the right and Arabic placeholder
"ابحث بالاسم أو الكود أو الفئة"؛ and to the left a [▦ بطاقات] / [☰ جدول] view toggle.

Main body: a product table with columns الصورة | المنتج | SKU | الفئة | الألوان | السعر |
المتاح | المحجوز | المباع | الحد الأدنى | الحالة | آخر حركة | الإجراءات.
Eight sample rows showing thumbnails of wooden Quran holders, brass flashlights, small Kaaba models;
status pills colored green (متاح), amber (منخفض), red (نفد).

On the right side of the screen, a slide-in drawer is partially visible, showing tabs
[الملخص][الحركة][الإضافات][الألوان][الصور][الأوامر][الإعدادات] and a hero product image
with a name "حامل مصحف خشب بني" and a "+ إضافة كمية" CTA in green.

Below the table (visible partially): an alert banner "⚠️ 7 منتجات منخفضة المخزون و 3 منتجات نفدت — راجع"
in a soft red-amber fill.

The overall feel is a clean, calm, professional Arabic SaaS admin UI — generous whitespace,
soft shadows, mono font for SKUs and numbers, IBM Plex Sans Arabic for Arabic text, RTL throughout.
```

---

## Part L — Final report & implementation roadmap

### L.1 Final report (this document)

This file `docs/Inventory-Design-0.md` IS the deliverable. No code changes were made. No DB writes. No migrations. No deploys.

### L.2 Recommended implementation phases

> Order chosen to minimise risk: redesign the surface first (additive UI on existing tables), then add the two ledgers, then variants, then reservation/integration.

| # | Phase | What ships | Tables touched (writes) |
|---|---|---|---|
| 1 | **Inventory-UI-Redesign-1** | New header / KPI / filter / table / card-grid / drawer scaffold, reusing existing `turath_masr_inventory` table | none (only existing) |
| 2 | **Inventory-Categories-1** | New `inventory_categories` table + seed; UI switches from hard-coded list to data-driven dropdown | `+ inventory_categories` |
| 3 | **Inventory-Additions-Log-1** | New `inventory_additions` + `inventory_movements` tables; "+ إضافة كمية" CTA writes one of each; new "الإضافات" and "الحركة" tabs in drawer; standalone `/inventory/additions` and `/inventory/movements` pages | `+ inventory_movements`, `+ inventory_additions` |
| 4 | **Inventory-Movement-Manual-1** | Movement modal supports all kinds; reverses_movement_id + admin "تراجع" button | (writes only into ledgers) |
| 5 | **Inventory-Variants-1** | New `inventory_variants` table; per-color quantity, per-color image, per-color SKU; AddOrderModal switches to variant picker | `+ inventory_variants` |
| 6 | **Inventory-Reservation-1** | On order create, write `order_out_reserved` movement and bump `reserved`; on cancel, reverse. UI shows "محجوز" column | (writes into ledgers + `reserved`) |
| 7 | **Inventory-Returns-Integration-1** | Adjustment page writes `return_in` / `damage_out` movements with adjustment id as reference | (writes into ledgers) |
| 8 | **Inventory-Images-Storage-Migration-1** | Move base64 images from text[] column to Supabase Storage + `inventory_images` table; thumbnail route reads from Storage | `+ inventory_images` |
| 9 | **Inventory-Suppliers-1** | Suppliers table + add-product / movement modal supplier picker | `+ suppliers` |
| 10 | **Inventory-Reports-Export-1** | CSV export for inventory / additions / movements; printable physical-count sheet | (read-only) |

Each phase ships as its own PR with audit-first / verification gate. Phases 3–7 add data; phase 1 is purely UI.

### L.3 Safety statement — Phase Inventory-Design-0

Confirmed during this phase:

- ✅ No code changes (only this design document created)
- ✅ No DB writes (audit was read-only — `information_schema.tables`, `information_schema.columns`, `pg_policies`, one `COUNT(*)`)
- ✅ No migrations
- ✅ No schema / RLS / auth changes
- ✅ No deploy, no PM2 reload
- ✅ POS / `zahran-retail-pos` not touched
- ✅ `turath-mart-join` not touched
- ✅ `turath-staging` not touched
- ✅ `financial.turathmasr.com` not touched
- ✅ `/var/www/turath-mart-new` not touched

**Phase Inventory-Design-0 deliverable is this document. Awaiting your direction on which implementation phase to start with (recommendation: Phase Inventory-UI-Redesign-1).**
