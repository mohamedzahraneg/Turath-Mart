# Phase Inventory-System-Plan-1 — Full Inventory Development Proposal

> **Status:** plan-only proposal. No code changes. No DB writes. No migrations applied.
> **Branch / commit audited:** `main` @ `72914ac`
> **Audit date:** 2026-05-15
> **Companion doc:** [`docs/Inventory-Design-0.md`](./Inventory-Design-0.md) — earlier visual-design pass; this document supersedes it on roadmap & data model.

---

## Part A — Current audit (concise)

> Full audit detail in [`docs/Inventory-Design-0.md` §A](./Inventory-Design-0.md#part-a--current-inventory-audit). Headline below.

**What exists today:**
- 1 page: [src/app/inventory/page.tsx](../src/app/inventory/page.tsx) — 954 lines, list + KPI + filter + edit modal + delete.
- 1 DB table: `turath_masr_inventory` — `id, name, sku, available, withdrawn, min_stock, price, category, images (text[] base64), colors (text[]), created_at`.
- 1 helper: [src/lib/inventory/InventoryThumbnail.tsx](../src/lib/inventory/InventoryThumbnail.tsx) + `inventoryThumbnailUrl(id)`.
- 1 helper: [src/lib/orders/productCards.ts](../src/lib/orders/productCards.ts) — feeds AddOrder/EditOrder modals.
- 1 API route: [`src/app/api/inventory/[id]/thumbnail/route.ts`](../src/app/api/inventory/[id]/thumbnail/route.ts) — RLS-gated, 24 h cached.
- RLS: SELECT auth / INSERT+UPDATE manager / DELETE admin.

**What is missing:**

| Capability | State |
|---|---|
| Movement ledger | ❌ no table, no writes |
| Additions log (procurement) | ❌ no table, no writes |
| Variants / per-color quantity | ❌ colors are a `text[]`, not a table |
| Suppliers | ❌ no table |
| Cost price / margin / inventory valuation | ❌ no column |
| Reservation on order create | ❌ `reserved` column does not exist |
| Decrement on delivery | ❌ `available` never auto-changes |
| Withdrawn count integrity | ❌ derived from regex parsing of `orders.products` text column (fragile) |
| Categories | ⚠️ hard-coded in React, mismatched with real catalog (`حامل مصحف`, `كشاف`, `كعبة`, …) |
| Stock count / physical inventory | ❌ no table |
| Audit log for inventory ops | ❌ no `inventory.*` action keys |
| CSV / print export | ❌ none |
| Soft-delete | ❌ delete is destructive |

**What is safe to build now (no DB risk, no order-flow risk):**
- New UI surface on top of the existing table.
- Data-driven categories table.
- Soft-delete + status column (additive migration).
- Movement & additions ledgers (additive — new tables, no triggers, no order-flow impact).
- Cost price column (additive).
- Suppliers table (additive).
- Variants table (additive — old `colors` text[] remains).

**What requires later order integration (defer):**
- Reserve / release / decrement on order create / cancel / deliver.
- Edit-order quantity-delta propagation.
- Return-to-stock on adjustment.
- Exchange in/out atomicity.

These need a careful migration of the order modals and a tested two-mode design (delivery-only vs. reservation). They are NOT first-PR material.

---

## Part B — Real business needs (10 modules)

Each module below maps to a real operational pain in running Turath Masr today. Skip-justifications are noted where relevant.

### B.1 Product catalog
Every product row should carry:
`name` · `sku` · `category` · `description` · `price` · `cost_price` · `available` · `reserved` · `sold_count` · `min_stock` · `status (active/paused/archived)` · `variants` · `images` · `default_supplier_id` · `internal_note`.

**Why now:** `cost_price` is needed to compute margin and inventory valuation; `reserved` is needed before any reservation flow can land; `status` lets us replace destructive delete with archive.

### B.2 Categories (data-driven)
Real Turath taxonomy:
`حامل مصحف` · `مصحف` · `كشاف` · `كرسي` · `كعبة` · `قطع صيانة` · `تغليف` · `هدايا` · `أخرى`.

**Why now:** hard-coded list in [page.tsx:46](../src/app/inventory/page.tsx#L46) is wrong. Operations need their real labels.

### B.3 Variants / colors
Per-color SKU and quantity:
- `حامل مصحف — بني` / `أبيض` / `أسود` / `ذهبي` / `صدف`
- each with its own `available`, `min_stock`, optional `price`, optional `image`.

**Why now:** today, the inventory says "حامل مصحف: 24 متاح" but doesn't know how many are بني vs ذهبي — operations rely on visual inspection of physical stock to answer that.

### B.4 Stock additions (procurement)
On every purchase / receiving:
`inventory_id` · `variant_id?` · `quantity` · `unit_cost` · `supplier_id` · `supplier_invoice_no` · `received_at` · `added_by` · `note`.

**Why now:** procurement is currently invisible in the system. No reconciliation with supplier invoices. No COGS reporting. No history of "متى آخر مرة اشترينا حوامل بني وبكام؟".

### B.5 Movement ledger
Every stock change → one immutable row:
`movement_type` · `inventory_id` · `variant_id?` · `quantity_before` · `quantity_after` · `quantity_delta` · `reason` · `reference_type` · `reference_id` · `user_id` · `occurred_at`.

Types: `add` · `order_out` · `order_in` · `return_in` · `damage_out` · `adjustment` · `transfer` · `price_change`.

**Why now:** today the only way to know how stock got to its current count is "Mohammed remembers". Audit requirements need this even before order integration lands.

### B.6 Stock count / adjustments (جرد)
Periodic physical count session:
- captured `system_quantity` vs `counted_quantity`
- `difference` (auto-computed)
- `reason` (loss / damage / miscount / theft)
- `counted_by` · `approved_by` · `created_at`

**Why now:** the only way to correct a drifted `available` count today is to edit the row directly with no audit trail. Operations want a "جرد شهري" workflow.

### B.7 Suppliers
Light supplier ledger:
`name` · `phone` · `address` · `note` · `is_active` · derived `total_purchases` · `last_received_at`.

**Why now:** even without invoice management, knowing "who supplies the brass flashlights and when did they last deliver" is a real ops question.

### B.8 Alerts
Surface-the-problem alerts:
- منتجات نفدت
- منتجات منخفضة المخزون
- منتجات لم تتحرك منذ N يوم (slow-movers)
- منتجات مرتجعاتها > X% (quality issues)
- منتجات عليها طلبات أكثر من المتاح (over-sold)

**Why now:** today the only alert is the small low-stock pill at the top of `/inventory`. Operations needs a real dashboard view.

### B.9 Reports
Reporting outputs:
- Inventory valuation (`SUM(available × cost_price)`)
- Movement report (filterable + CSV)
- Additions report (per supplier, per category, per period)
- Top-selling products
- Low-stock list (print-friendly, for procurement runs)
- Stock-count session report
- Supplier purchase report

**Why now:** Mohammed has asked for "كشف حساب مورد" before — same pattern as the delegate account statement that just shipped.

### B.10 Order integration (DEFERRED — not first PR)
| When | What |
|---|---|
| Order create | reserve (Mode A) OR no-op (Mode B) |
| Order cancel | release reservation OR no-op |
| Status → `delivered` | decrement `available`, write `order_out` movement |
| Status → `returned` | restore `available`, write `return_in` movement |
| Order edit (qty change, line add/remove, product swap) | delta movements |
| Adjustment / exchange | `return_in` + optional `order_out` for replacement |

**Why deferred:** the existing AddOrderModal / EditOrderModal / Adjustments page are large, deeply-tested surfaces. Touching them too early — before the movement ledger exists — risks corrupting order data with no easy rollback. Land ledgers first, integrate later.

---

## Part C — Full UI proposal

### C.1 Page sections

```
/inventory                        — main product list (default)
/inventory/movements              — movement ledger
/inventory/additions              — additions / procurement log
/inventory/stock-count            — count sessions (Phase 7)
/inventory/suppliers              — supplier list (Phase 6)
/inventory/reports                — reports (Phase 10)
```

Sidebar nav adds 5 sub-items under "المخزن", each permission-gated.

### C.2 Header — `/inventory`

```
┌──────────────────────────────────────────────────────────────────────────┐
│ إدارة المخزن                                                              │
│ الرئيسية › المخزن                                                          │
│                                                                          │
│              [+ إضافة منتج] [+ إضافة كمية] [تسجيل حركة]                 │
│              [جرد] [تصدير] [تحديث]                                       │
└──────────────────────────────────────────────────────────────────────────┘
```

### C.3 KPI cards (8)

```
[إجمالي المنتجات: 124] [القطع المتاحة: 3,812] [قيمة المخزون: 2.4M ج.م]
[منخفض: 7]              [نفد: 3]                [إضافات الشهر: +540 قطعة]
[حركات اليوم: 28]        [قيمة المشتريات (شهر): 320K ج.م]
```

Each card is a live SUM/COUNT query; cost-related cards (قيمة المخزون / قيمة المشتريات) are gated behind `view_inventory_cost`.

### C.4 Smart filters (dashed-purple container, matching `/orders-management`)

Row 1 — status chips:  `الكل ▸ متاح ▸ منخفض المخزون ▸ نفد ▸ موقوف ▸ مؤرشف`.
Row 2 — category chips: data-driven from `turath_masr_inventory_categories`.
Row 3 — search + advanced: full-width search + dropdowns for color, price range, qty range, date added, supplier.
Row 4 — view toggle: `▦ بطاقات` / `☰ جدول`.

### C.5 Main body — table view (default for ops)

Columns:
`الصورة` · `المنتج` · `SKU` · `الفئة` · `الألوان` · `السعر` · `المتاح` · `المحجوز` · `المباع (90 يوم)` · `الحد الأدنى` · `الحالة` · `آخر حركة` · `الإجراءات`.

Row click → opens drawer.
Row hover → reveals quick-actions (`+ كمية` / `- كمية` / `سجل الحركة` / `تعديل`).

### C.6 Main body — card view (visual browsing)

4-up grid on xl, 3-up on lg, 2-up on md, 1-up on sm.

Each card: hero image (carousel if multi), name, SKU mono, category pill, color chips (max 3 + `+N`), price/available side-by-side, status dot + last-updated, four action icons.

### C.7 Product drawer (slide-in from right, 720 px on xl)

Tabs (Arabic right-to-left order):
1. **الملخص** — factsheet + 2 CTAs (`+ إضافة كمية` / `- خصم/تسوية`)
2. **النسخ والألوان** — variants table
3. **سجل الحركة** — movements table (filtered to this product)
4. **إضافات المنتج** — additions table
5. **الطلبات المرتبطة** — last N orders containing this product
6. **المرتجعات والاستبدالات** — adjustments referencing this product
7. **الصور** — gallery + upload
8. **الإعدادات** — pause / archive / threshold / default cost / default supplier

Drawer reuses the proven pattern from `/delegates` page.

### C.8 Movements page (`/inventory/movements`)

Master ledger, newest-first. Columns:
`التاريخ` · `نوع الحركة` (color-chip) · `المنتج` · `النسخة` · `قبل` · `بعد` · `الفرق` (signed, colored) · `السبب` · `المرجع` (link) · `المستخدم`.

Filters: date preset + custom range, movement-kind chips, product picker, category, user.
Toolbar: `طباعة` (window.print + print-only block) + `تصدير CSV` (UTF-8 BOM).

### C.9 Additions page (`/inventory/additions`)

Procurement timeline. Columns:
`التاريخ` · `المنتج` · `SKU` · `النسخة` · `الكمية` · `تكلفة الوحدة` · `الإجمالي` · `المورد` · `رقم الفاتورة` · `أضيف بواسطة` · `ملاحظة` · `الإجراء` (link to movement).

Filters: date, product, category, supplier, user.
Toolbar: `طباعة` + `تصدير CSV`.

### C.10 Stock-count page (`/inventory/stock-count`) — Phase 7

Two views:
- **Sessions list** — `id`, `started_at`, `ended_at`, `counted_by`, `# items`, `# differences`, `status (open/closed)`.
- **Session detail** — per-line: `product`, `variant`, `system_qty`, `counted_qty`, `difference`, `reason`, `approved_by`, `apply` button (writes an `adjustment` movement).

### C.11 Suppliers page (`/inventory/suppliers`) — Phase 6

Supplier list + drawer:
- Drawer tabs: الملخص / المشتريات / الفواتير / المنتجات / الإعدادات.
- الملخص shows `total_purchases`, `last_received_at`, `top 5 products`.

### C.12 Reports page (`/inventory/reports`) — Phase 10

Cards link to:
- قيمة المخزون (inventory valuation export)
- تقرير الحركة (movements export)
- تقرير الإضافات (additions export)
- أكثر المنتجات مبيعًا
- منتجات منخفضة المخزون (print-friendly)
- تقرير الجرد
- تقرير الموردين

---

## Part D — Data model proposal (additive, no migration applied)

> All SQL below is **proposed** and **not applied**. Each block is one migration file. Migrations land per-phase, with each phase's PR carrying only the migration(s) it needs.

### D.1 Extend `turath_masr_inventory` (additive only)

```sql
-- migrations/<ts>_inventory_extend.sql  (Phase 2 + Phase 3)
ALTER TABLE turath_masr_inventory
  ADD COLUMN IF NOT EXISTS description       text,
  ADD COLUMN IF NOT EXISTS status            text         NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','paused','archived')),
  ADD COLUMN IF NOT EXISTS cost_price        numeric      DEFAULT 0
    CHECK (cost_price >= 0),
  ADD COLUMN IF NOT EXISTS reserved          integer      NOT NULL DEFAULT 0
    CHECK (reserved >= 0),
  ADD COLUMN IF NOT EXISTS sold_count        integer      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS returned_count    integer      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS supplier_id       uuid,
  ADD COLUMN IF NOT EXISTS category_id       uuid,
  ADD COLUMN IF NOT EXISTS last_movement_at  timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at       timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by       uuid,
  ADD COLUMN IF NOT EXISTS archived_reason   text,
  ADD COLUMN IF NOT EXISTS internal_note     text;

-- FKs added after the dependent tables exist:
-- ALTER TABLE turath_masr_inventory
--   ADD CONSTRAINT inventory_category_fk
--     FOREIGN KEY (category_id) REFERENCES turath_masr_inventory_categories(id);
-- ALTER TABLE turath_masr_inventory
--   ADD CONSTRAINT inventory_supplier_fk
--     FOREIGN KEY (supplier_id) REFERENCES turath_masr_inventory_suppliers(id);
-- ALTER TABLE turath_masr_inventory
--   ADD CONSTRAINT inventory_archived_by_fk
--     FOREIGN KEY (archived_by) REFERENCES profiles(id);
```

> Note: the existing `withdrawn` column is kept for back-compat with [page.tsx:534](../src/app/inventory/page.tsx#L534), but new code reads `sold_count` from the movement ledger instead. Eventually `withdrawn` can be dropped — out of scope for this plan.

### D.2 `turath_masr_inventory_categories` (Phase 2)

```sql
CREATE TABLE IF NOT EXISTS turath_masr_inventory_categories (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL UNIQUE,
  slug        text        NOT NULL UNIQUE,
  sort_order  integer     NOT NULL DEFAULT 100,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO turath_masr_inventory_categories (name, slug, sort_order) VALUES
  ('حامل مصحف',   'quran-holder',       10),
  ('مصحف',        'quran',              20),
  ('كشاف',        'flashlight',         30),
  ('كرسي',        'chair',              40),
  ('كعبة',        'kaaba-model',        50),
  ('قطع صيانة',   'maintenance-parts',  60),
  ('تغليف',       'packaging',          70),
  ('هدايا',       'gifts',              80),
  ('أخرى',        'other',              99)
ON CONFLICT DO NOTHING;
```

### D.3 `turath_masr_inventory_variants` (Phase 5)

```sql
CREATE TABLE IF NOT EXISTS turath_masr_inventory_variants (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id  uuid        NOT NULL REFERENCES turath_masr_inventory(id) ON DELETE CASCADE,
  name          text        NOT NULL,
  color         text,
  sku           text        NOT NULL UNIQUE,
  price         numeric,
  cost_price    numeric,
  available     integer     NOT NULL DEFAULT 0  CHECK (available >= 0),
  reserved      integer     NOT NULL DEFAULT 0  CHECK (reserved >= 0),
  min_stock     integer     NOT NULL DEFAULT 0,
  image_path    text,
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_variants_inventory_id_idx
  ON turath_masr_inventory_variants(inventory_id);
```

### D.4 `turath_masr_inventory_movements` (Phase 4 — immutable ledger)

```sql
CREATE TABLE IF NOT EXISTS turath_masr_inventory_movements (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id          uuid        NOT NULL REFERENCES turath_masr_inventory(id),
  variant_id            uuid        REFERENCES turath_masr_inventory_variants(id),
  movement_type         text        NOT NULL
    CHECK (movement_type IN (
      'add','order_out','order_in','return_in','damage_out',
      'adjustment','transfer','price_change'
    )),
  quantity_delta        integer     NOT NULL,   -- signed; 0 only for price_change
  quantity_before       integer     NOT NULL,
  quantity_after        integer     NOT NULL,
  reason                text,
  reference_type        text,                   -- 'order' | 'adjustment' | 'supplier_invoice' | 'stock_count' | null
  reference_id          uuid,
  order_num             text,                   -- denormalized for fast filter
  supplier_invoice_num  text,
  reverses_movement_id  uuid        REFERENCES turath_masr_inventory_movements(id),
  note                  text,
  metadata              jsonb       DEFAULT '{}'::jsonb,
  created_by            uuid        REFERENCES profiles(id),
  created_by_name       text,
  occurred_at           timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inv_mov_inv_occurred_idx
  ON turath_masr_inventory_movements(inventory_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS inv_mov_variant_occurred_idx
  ON turath_masr_inventory_movements(variant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS inv_mov_reference_idx
  ON turath_masr_inventory_movements(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS inv_mov_type_idx
  ON turath_masr_inventory_movements(movement_type);
```

Ledger is immutable: RLS denies UPDATE/DELETE for all roles; corrections happen via reversing movements.

### D.5 `turath_masr_inventory_additions` (Phase 3)

```sql
CREATE TABLE IF NOT EXISTS turath_masr_inventory_additions (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id            uuid        NOT NULL REFERENCES turath_masr_inventory(id),
  variant_id              uuid        REFERENCES turath_masr_inventory_variants(id),
  movement_id             uuid        REFERENCES turath_masr_inventory_movements(id),
  quantity                integer     NOT NULL CHECK (quantity > 0),
  unit_cost               numeric     CHECK (unit_cost >= 0),
  total_cost              numeric     GENERATED ALWAYS AS (quantity * unit_cost) STORED,
  supplier_id             uuid        REFERENCES turath_masr_inventory_suppliers(id),
  supplier_name_snapshot  text,
  supplier_invoice_num    text,
  received_at             timestamptz NOT NULL DEFAULT now(),
  created_by              uuid        REFERENCES profiles(id),
  created_by_name         text,
  note                    text,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inv_add_inv_received_idx
  ON turath_masr_inventory_additions(inventory_id, received_at DESC);
CREATE INDEX IF NOT EXISTS inv_add_supplier_idx
  ON turath_masr_inventory_additions(supplier_id);
```

Phase 3 ships **before** Phase 4 in some ordering options (see Part F). If so, `movement_id` is initially nullable and back-fills in Phase 4.

### D.6 `turath_masr_inventory_suppliers` (Phase 6)

```sql
CREATE TABLE IF NOT EXISTS turath_masr_inventory_suppliers (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  phone       text,
  address     text,
  note        text,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inv_sup_active_idx
  ON turath_masr_inventory_suppliers(is_active);
```

### D.7 `turath_masr_inventory_stock_counts` (Phase 7)

```sql
CREATE TABLE IF NOT EXISTS turath_masr_inventory_stock_counts (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       uuid,                                       -- groups lines into one count session
  inventory_id     uuid        NOT NULL REFERENCES turath_masr_inventory(id),
  variant_id       uuid        REFERENCES turath_masr_inventory_variants(id),
  system_quantity  integer     NOT NULL,
  counted_quantity integer     NOT NULL  CHECK (counted_quantity >= 0),
  difference       integer     GENERATED ALWAYS AS (counted_quantity - system_quantity) STORED,
  reason           text,                                       -- 'loss' | 'damage' | 'miscount' | 'theft' | 'other'
  movement_id      uuid        REFERENCES turath_masr_inventory_movements(id),
  applied_at       timestamptz,
  counted_by       uuid        REFERENCES profiles(id),
  counted_by_name  text,
  approved_by      uuid        REFERENCES profiles(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);
```

### D.8 `turath_masr_inventory_images` (Phase 8 — storage migration)

```sql
CREATE TABLE IF NOT EXISTS turath_masr_inventory_images (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id  uuid        NOT NULL REFERENCES turath_masr_inventory(id) ON DELETE CASCADE,
  variant_id    uuid        REFERENCES turath_masr_inventory_variants(id),
  storage_path  text        NOT NULL,            -- e.g. inventory-images/<inv_id>/<uuid>.webp
  file_name     text,
  mime_type     text,
  size_bytes    integer,
  is_primary    boolean     NOT NULL DEFAULT false,
  sort_order    integer     NOT NULL DEFAULT 100,
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  uploaded_by   uuid        REFERENCES profiles(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS inv_img_primary_uniq
  ON turath_masr_inventory_images(inventory_id) WHERE is_primary;
```

Phase 8 also adds a Supabase Storage bucket `inventory-images` and a one-off back-fill script that moves the existing base64 `turath_masr_inventory.images` array into the new table, then drops the column.

### D.9 RPCs (atomic writes)

Five SECURITY DEFINER functions are proposed. All take the caller's `auth.uid()` and validate via the standard permissions helper.

```sql
-- 1. inventory_apply_movement (Phase 4)
--    Used by every non-trivial inventory change.
--    Writes one ledger row + bumps available/reserved on the parent + variant.
CREATE OR REPLACE FUNCTION inventory_apply_movement(
  p_inventory_id        uuid,
  p_variant_id          uuid,
  p_movement_type       text,
  p_quantity_delta      integer,
  p_reason              text,
  p_reference_type      text,
  p_reference_id        uuid,
  p_order_num           text,
  p_supplier_invoice_num text,
  p_note                text,
  p_metadata            jsonb
) RETURNS uuid AS $$
  -- 1. SELECT FOR UPDATE the inventory + variant row
  -- 2. compute before/after
  -- 3. reject if after < 0 unless caller has 'override_stock'
  -- 4. INSERT movements row
  -- 5. UPDATE inventory.available + variant.available + last_movement_at
  -- 6. RETURN movement id
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. inventory_record_addition (Phase 3)
--    Composite: writes additions row + invokes inventory_apply_movement.
CREATE OR REPLACE FUNCTION inventory_record_addition(...)  RETURNS uuid AS $$ ... $$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. inventory_adjust_count (Phase 7)
--    Apply one stock-count line: writes adjustment movement + updates session row.
CREATE OR REPLACE FUNCTION inventory_adjust_count(...)    RETURNS uuid AS $$ ... $$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. inventory_reserve_stock (Phase 8 / Order integration)
--    On order create: bumps reserved + writes 'order_out' (kind subtype reserved).
CREATE OR REPLACE FUNCTION inventory_reserve_stock(...)   RETURNS uuid AS $$ ... $$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. inventory_release_reservation (Phase 8 / Order integration)
--    On order cancel / delivered: releases reserved, optionally writes order_out final.
CREATE OR REPLACE FUNCTION inventory_release_reservation(...) RETURNS uuid AS $$ ... $$ LANGUAGE plpgsql SECURITY DEFINER;
```

App code never writes directly to inventory counts — only via these RPCs. That keeps the ledger and the running totals in sync.

### D.10 RLS pattern (proposed)

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `turath_masr_inventory` | auth | manager | manager | admin (or never; use status='archived') |
| `turath_masr_inventory_categories` | auth | admin | admin | admin |
| `turath_masr_inventory_variants` | auth | manager | manager | admin |
| `turath_masr_inventory_movements` | auth | **RPC-only** (no direct INSERT) | **NONE** | **NONE** |
| `turath_masr_inventory_additions` | auth | **RPC-only** | **NONE** | **NONE** |
| `turath_masr_inventory_suppliers` | auth | manager | manager | admin |
| `turath_masr_inventory_stock_counts` | auth | warehouse+ | warehouse+ until applied; then **NONE** | **NONE** |
| `turath_masr_inventory_images` | auth | manager | manager | admin |

Cost columns (`cost_price`, `total_cost`, `unit_cost`) are masked at the API layer for users without `view_inventory_cost` — applied in the SELECT helpers, not in RLS, since column-level RLS is complex.

---

## Part E — Permission model

### E.1 Proposed permission keys

| Key | Description |
|---|---|
| `view_inventory` | see product list, available qty, status |
| `manage_inventory` | create/edit products, upload images, edit price |
| `adjust_inventory` | record movements, mark damage, run count sessions |
| `record_inventory_addition` | record stock additions (procurement) |
| `view_inventory_cost` | see cost_price, margin, valuation cards |
| `manage_suppliers` | CRUD suppliers |
| `export_inventory` | CSV / print export |
| `archive_inventory` | archive (soft-delete) a product |
| `override_stock` | allow negative deltas that push available below 0 |

### E.2 Role mapping (illustrative — actual mapping in `src/lib/permissions/permissions.ts`)

| Role | Keys |
|---|---|
| `r1 admin` | all |
| `r2 manager` | view, manage, adjust, record, view_cost, manage_suppliers, export, archive |
| `r3 supervisor` | view, manage, adjust, record, manage_suppliers, export |
| `warehouse staff` (new role or sub-permission set) | view, adjust, record, count |
| `r4 sales / orders ops` | view (no cost, no edit) |
| `r5 finance` | view, view_cost, export |

### E.3 UI gating pattern

```ts
const perms = usePermissions();
const canManage     = perms.can('manage_inventory');
const canAdjust     = perms.can('adjust_inventory');
const canViewCost   = perms.can('view_inventory_cost');
const canAddStock   = perms.can('record_inventory_addition');
const canManageSup  = perms.can('manage_suppliers');
const canExport     = perms.can('export_inventory');
const canArchive    = perms.can('archive_inventory');
```

Buttons / columns are **hidden** (not disabled) when the gate is false — matches the established delegate-page pattern.

### E.4 Staff audit log keys (new)

```
inventory.product_created
inventory.product_updated
inventory.product_archived
inventory.product_restored
inventory.movement_created
inventory.movement_reversed
inventory.addition_created
inventory.stock_count_session_started
inventory.stock_count_applied
inventory.supplier_created
inventory.supplier_updated
inventory.variant_created
inventory.variant_updated
```

All written via `writeStaffAuditLog` after the RPC succeeds.

---

## Part F — Implementation phases (10 phases, ordered)

> Each phase is one PR. Each PR follows the audit-first / verification gate already established in this repo. No phase couples to another except where noted by "depends on".

### Phase 1 — Inventory-UI-Redesign-1
**Goal:** ship the new UI surface on top of the existing table. No new tables, no new columns.

| Item | Detail |
|---|---|
| Files | `src/app/inventory/page.tsx` (rewrite), `src/lib/inventory/InventoryThumbnail.tsx` (reuse), new `src/lib/inventory/inventoryStats.ts`, new components under `src/app/inventory/components/` |
| Migrations | **none** |
| RPCs | **none** |
| Risk | low — pure UI, only writes to existing table, no behavior changes for order modals |
| Verification | `pnpm typecheck`, `pnpm lint`, `pnpm build`; manual smoke on `/inventory` (search / filter / edit / delete / add) on staging-like data |

### Phase 2 — Inventory-Categories-Safer-Archive-1
**Goal:** data-driven categories + status/archive replaces destructive delete.

| Item | Detail |
|---|---|
| Files | `src/app/inventory/page.tsx`, edit modal, new `src/lib/inventory/categories.ts` |
| Migrations | D.1 (extend table: add `status`, `description`, `category_id`, `archived_at`, `archived_by`, `archived_reason`, `internal_note`), D.2 (categories table + seed) |
| RPCs | none (direct UPDATE for category change, with audit log) |
| Risk | low — additive only, status defaults to `'active'` so existing rows behave unchanged |
| Verification | typecheck/lint/build, manual: change category dropdown / archive a row / verify it disappears from default filter / verify it reappears under "مؤرشف" filter |

### Phase 3 — Inventory-Additions-Log-1
**Goal:** record every stock receipt with cost + supplier (supplier name is free-text until Phase 6 introduces the table).

| Item | Detail |
|---|---|
| Files | new `src/app/inventory/additions/page.tsx`, new components, new `src/lib/inventory/additionsTypes.ts`, edit modal adds "+ إضافة كمية" button |
| Migrations | D.1 partial (`cost_price`), D.5 (additions table — `supplier_id` nullable until Phase 6) |
| RPCs | none initially (direct INSERT into additions + direct UPDATE of `inventory.available` — both inside a single transaction with audit log) |
| Risk | low — net-new write path that doesn't touch order flow |
| Verification | typecheck/lint/build, manual: add 10 units of an item, verify `available` bumps by 10, verify additions log row appears, verify CSV export works |

> **Cleanup task after Phase 4:** swap the direct UPDATE for an `inventory_apply_movement` RPC call so the additions are auto-mirrored to the movement ledger.

### Phase 4 — Inventory-Movement-Ledger-1
**Goal:** immutable movement ledger + reverse capability. Back-fill Phase 3 additions into the ledger.

| Item | Detail |
|---|---|
| Files | new `src/app/inventory/movements/page.tsx`, new components, new `src/lib/inventory/movementsTypes.ts`, "تراجع الحركة" admin action |
| Migrations | D.4 (movements table), RPC `inventory_apply_movement`, RPC `inventory_record_addition` (refactors Phase 3 to use it), one-shot back-fill SQL: every Phase-3 addition gets a corresponding ledger row |
| RPCs | `inventory_apply_movement`, `inventory_record_addition` |
| Risk | medium — back-fill needs to be idempotent; UPDATE/DELETE blocked on the ledger from day one |
| Verification | typecheck/lint/build, manual: run an addition, verify it lands in both ledger and additions; reverse a movement, verify available restored + reverse row written |

### Phase 5 — Inventory-Variants-1
**Goal:** per-color quantity. Old `colors` text array stays for back-compat; new UI reads variants first.

| Item | Detail |
|---|---|
| Files | edit modal adds variant editor, drawer "النسخ والألوان" tab, `src/lib/orders/productCards.ts` updated to also return variants |
| Migrations | D.3 (variants table), back-fill script that creates one default variant per product (named "افتراضي") with all of `available` |
| RPCs | extend `inventory_apply_movement` to accept `variant_id` |
| Risk | medium-high — touches `productCards.ts` which feeds AddOrderModal; need to keep the modal working with `variant_id=null` for the default variant |
| Verification | typecheck/lint/build, manual: create variants for a product, add stock to one variant, verify it shows correctly in the table + drawer; open AddOrderModal and confirm color picker still works |

### Phase 6 — Inventory-Suppliers-1
**Goal:** supplier ledger; replace free-text supplier name in additions with `supplier_id` reference.

| Item | Detail |
|---|---|
| Files | new `src/app/inventory/suppliers/page.tsx`, new drawer, "إضافة كمية" modal supplier picker, `src/app/inventory/page.tsx` add `default_supplier_id` field |
| Migrations | D.6 (suppliers table), back-fill from distinct `supplier_name_snapshot` values, add FK from additions.supplier_id |
| RPCs | none new |
| Risk | low — additive |
| Verification | typecheck/lint/build, manual: create 3 suppliers, attach to additions, view supplier drawer with last 10 purchases |

### Phase 7 — Inventory-Stock-Count-1
**Goal:** physical-count workflow that produces adjustment movements.

| Item | Detail |
|---|---|
| Files | new `src/app/inventory/stock-count/page.tsx`, new session/detail components |
| Migrations | D.7 (stock_counts table), RPC `inventory_adjust_count` |
| RPCs | `inventory_adjust_count` (wraps `inventory_apply_movement` with `movement_type='adjustment'`) |
| Risk | medium — touches the ledger; must keep idempotency |
| Verification | typecheck/lint/build, manual: open a count session, count 10 lines (5 matches, 3 over, 2 under), apply 5 differences, verify the 5 corresponding adjustment movements appear |

### Phase 8 — Inventory-Orders-Integration-1
**Goal:** decrement on delivery + restore on return. Reservation is gated behind a feature flag — default OFF; enable per-product when ready.

| Item | Detail |
|---|---|
| Files | `src/app/orders-management/components/AddOrderModal.tsx`, `EditOrderModal.tsx`, `src/lib/orders/orderStatus.ts` (or equivalent), new `src/lib/inventory/orderIntegration.ts` |
| Migrations | RPCs `inventory_reserve_stock`, `inventory_release_reservation`, add `reservation_mode` setting (`'off' \| 'on_create' \| 'on_processing'`) to `turath_masr_inventory.metadata` jsonb (or a settings table) |
| RPCs | `inventory_reserve_stock`, `inventory_release_reservation` |
| Risk | **high** — touches the order modals; needs end-to-end QA on create / cancel / deliver / return for two-mode behavior |
| Verification | typecheck/lint/build, full manual run of: create order (decrement OR reserve), cancel order (release), deliver order (finalise), return order (restore). Include a regression check on `/track/t/<token>` to confirm no inventory data leaks. |

### Phase 9 — Inventory-Returns-Exchanges-Integration-1
**Goal:** adjustments page writes return_in / damage_out + exchanges write both legs.

| Item | Detail |
|---|---|
| Files | `src/app/orders-management/components/Adjustments*` (or wherever the adjustment flow lives), exchange flow components |
| Migrations | none new |
| RPCs | reuse `inventory_apply_movement` |
| Risk | medium — adjustment flow has existing audit log; extend metadata to include inventory movement ids |
| Verification | typecheck/lint/build, manual: full return, partial return, exchange A→B, damaged return — for each, verify the ledger rows match operations |

### Phase 10 — Inventory-Reports-Export-1
**Goal:** dedicated reports page + CSV/print everywhere.

| Item | Detail |
|---|---|
| Files | new `src/app/inventory/reports/page.tsx`, shared `src/lib/inventory/exporters.ts`, print blocks on each list page |
| Migrations | none |
| RPCs | none (read-only) |
| Risk | low — read-only |
| Verification | typecheck/lint/build, manual: print each report, verify CSV has UTF-8 BOM and renders in Excel correctly |

---

## Part G — First implementation recommendation

### G.1 Recommended first PR

**Phase 1 — `Inventory-UI-Redesign-1`.**

- No migration.
- No RPC.
- No order-flow change.
- Only edits to `src/app/inventory/page.tsx` and additions under `src/app/inventory/components/`.
- 100% reversible (the entire change is a UI rewrite on the same data).
- Ships visible value: replaces a 6-column table page with the full design from Part C.

### G.2 But if you want real operational value first

If the priority is **operational value over surface polish**, run them in this order instead:

1. **Phase 1 — Inventory-UI-Redesign-1** (shipping order, 1 week)
2. **Phase 2 — Inventory-Categories-Safer-Archive-1** (shipping order, 1 week)
3. **Phase 3 — Inventory-Additions-Log-1** (shipping order, 1–2 weeks) ← real procurement value lands here
4. **Phase 4 — Inventory-Movement-Ledger-1** (shipping order, 1–2 weeks)
5. then 5–10 as scheduled.

### G.3 What NOT to start with

- **Do NOT start with Phase 8 (Orders Integration).** Decrement on order create is a one-way door that can corrupt order correctness if any assumption is wrong. Ship the ledger first so any wrong decrement is recoverable via a reverse movement.
- **Do NOT start with Phase 9 (Returns Integration).** Same reason — the ledger must exist first.
- **Do NOT start with Phase 7 (Stock Count).** Needs the ledger.

### G.4 First-PR scope (Phase 1 detail)

Files to touch:
- `src/app/inventory/page.tsx` — full rewrite (~954 → ~600 lines, broken into components)
- `src/app/inventory/components/InventoryHeader.tsx` — new
- `src/app/inventory/components/InventoryKpiCards.tsx` — new
- `src/app/inventory/components/InventoryFilters.tsx` — new
- `src/app/inventory/components/InventoryTable.tsx` — new
- `src/app/inventory/components/InventoryCardGrid.tsx` — new
- `src/app/inventory/components/InventoryDrawer.tsx` — new (with 3 active tabs: الملخص / الصور / الإعدادات; other tabs render an "available in upcoming phase" placeholder so the shell is in place)
- `src/app/inventory/components/EditInventoryModal.tsx` — extracted from current page
- `src/lib/inventory/inventoryStats.ts` — pure helpers (KPI computations)

Tables touched (writes): **none new**; existing `turath_masr_inventory` only.
Migrations: **none**.
RPCs: **none**.
RLS: **unchanged**.
Permissions: introduce `view_inventory` + `manage_inventory` keys (additive), default to existing role checks for back-compat.

### G.5 First-PR safety checklist
- ✅ No migrations
- ✅ No order-flow code touched
- ✅ No `productCards.ts` change (AddOrder/EditOrder unaffected)
- ✅ No `/api/inventory/[id]/thumbnail` change (cached route stays as-is)
- ✅ Existing 6 product rows render correctly
- ✅ Edit modal save still inserts/updates correctly
- ✅ Delete becomes a soft-archive (or keep destructive behind admin-only confirm — decide during PR)
- ✅ Typecheck + lint + build clean

---

## Part H — Image-generation prompt

```
Create a full-screen Arabic RTL web dashboard mockup for "إدارة المخزن"
(Inventory Management) for an Egyptian brand called "تراث مصر" (Turath Masr).
Target aesthetic: clean Tailwind SaaS admin UI, rounded-2xl cards, soft 1px
borders in cool grey (hsl 214 12% 92%), primary brand deep navy (#1f4f8b /
hsl 217 80% 30%), background a soft warm-white (hsl 0 0% 99%).

PAGE STRUCTURE (top to bottom):

1) HEADER
   Right side: title "إدارة المخزن" with package icon, breadcrumb
   "الرئيسية › المخزن" beneath.
   Left side: six pill buttons in a single row: "+ إضافة منتج" (navy fill),
   "+ إضافة كمية" (emerald-600 fill), "تسجيل حركة" (white with border),
   "جرد" (white with border), "تصدير" (white with border), "تحديث" (white
   with border + refresh icon).

2) KPI CARD ROW — 8 cards in one row on xl, two rows on smaller widths:
   • إجمالي المنتجات: 124 (Package icon)
   • القطع المتاحة: 3,812 (Warehouse icon)
   • قيمة المخزون: 2.4M ج.م (Banknote icon, navy text)
   • منخفض: 7 (AlertTriangle, amber)
   • نفد: 3 (XCircle, red)
   • إضافات الشهر: +540 (Plus, emerald)
   • حركات اليوم: 28 (Activity icon)
   • قيمة المشتريات (شهر): 320K ج.م (ShoppingCart icon)
   Each card: white background, rounded-2xl, small icon top-right, label muted
   small, value mono bold 28 px.

3) SMART FILTER (dashed purple-300 border container, padding 12 px):
   Row A — status chips: "الكل | متاح | منخفض المخزون | نفد | موقوف | مؤرشف"
   (الكل selected, filled with navy, white text).
   Row B — category chips: "حامل مصحف | مصحف | كشاف | كرسي | كعبة | قطع صيانة |
   تغليف | هدايا | أخرى".
   Row C — search bar (full width, magnifier icon on right, placeholder
   "ابحث بالاسم أو الكود أو الفئة أو اللون"), to its left a [▦ بطاقات] /
   [☰ جدول] toggle (جدول selected).
   Row D — five small dropdowns: اللون / السعر / الكمية / تاريخ الإضافة /
   المورد.

4) ALERT BANNER (soft red-amber fill, only when alerts > 0):
   "⚠️ 7 منتجات منخفضة المخزون و 3 منتجات نفدت — راجع".

5) MAIN TABLE — 13 columns:
   الصورة | المنتج | SKU | الفئة | الألوان | السعر | المتاح | المحجوز |
   المباع | الحد الأدنى | الحالة | آخر حركة | الإجراءات.
   Show 10 sample rows with realistic Turath products: wooden Quran holders
   in بني/أبيض/أسود, brass flashlights, small Kaaba models, prayer mats,
   maintenance parts (screws / hinges). Use thumbnail images, status pills
   (green=متاح / amber=منخفض / red=نفد). Action icons (eye / pencil /
   plus-square / minus-square / history).

6) RIGHT-SIDE DRAWER (partially visible on right, slide-in):
   Header shows product name "حامل مصحف خشب بني", SKU "HOLDER-WOOD-BROWN"
   in mono, status pill "● متاح" (green).
   Tab row: الملخص | النسخ والألوان | سجل الحركة | إضافات المنتج |
   الطلبات المرتبطة | المرتجعات والاستبدالات | الصور | الإعدادات
   (الملخص selected).
   Tab body: hero image carousel of brown wooden holder, factsheet
   (Name / SKU / Category / Status / Price / Cost / Margin / Available /
   Reserved / Sold-90d / Returned-90d / Min-stock / Inventory value),
   two CTAs at the bottom "+ إضافة كمية" (emerald) / "- خصم / تسوية" (amber).

7) BELOW THE TABLE (partially visible): two ledger cards side-by-side:
   • "سجل الحركة (أحدث 5)" — mini-list of movements with kind chips
     (إضافة / بيع / مرتجع / تالف / تسوية), product name, qty (signed,
     colored), date, user.
   • "سجل الإضافات (أحدث 5)" — mini-list with product, qty, supplier
     name, invoice #, date.

OVERALL FEEL: clean, calm, professional Arabic SaaS admin — generous whitespace,
soft shadows, mono font for SKUs / numbers, IBM Plex Sans Arabic for body,
RTL throughout. No emojis in the chrome; emojis only in empty states and
as fallback thumbnails.
```

---

## Part I — Output (this document)

`docs/Inventory-System-Plan-1.md` (this file) IS the deliverable. No production code changes. No DB writes. No migrations applied. Companion / historical doc: `docs/Inventory-Design-0.md`.

---

## Safety confirmation — Phase Inventory-System-Plan-1

- ✅ No DB writes (audit was read-only on `information_schema`)
- ✅ No migrations applied (all SQL in Part D is **proposed**, not run)
- ✅ No production code changes (only this design doc + the existing Inventory-Design-0.md)
- ✅ No deploy, no PM2 reload
- ✅ No order / add / edit / return code touched
- ✅ POS / `zahran-retail-pos` / `turath-mart-join` / `turath-staging` / `financial.turathmasr.com` / `/var/www/turath-mart-new` — all untouched
- ✅ Working tree: clean except `docs/Inventory-Design-0.md` (untracked, from prior phase) and `docs/Inventory-System-Plan-1.md` (untracked, this phase)

**Awaiting your direction on first PR. Recommendation: start with Phase 1 (Inventory-UI-Redesign-1). If you want real operational value sooner, sequence is Phase 1 → 2 → 3 → 4.**
