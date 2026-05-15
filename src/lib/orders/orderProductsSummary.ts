// ─────────────────────────────────────────────────────────────────────────────
// src/lib/orders/orderProductsSummary.ts
//
// Phase Orders-Page-Redesign-1 — compact Arabic "products column" helper.
// Both the dashboard's recent-orders panel and the main orders-table
// rely on it so a 2,000-row page renders consistently:
//
//     حامل مصحف بني × 1 + مصحف × 2
//     حامل مصحف بني × 1 + حامل مصحف أبيض × 1
//     حامل مصحف بني × 2
//
// The helper is intentionally pure (no Supabase, no React). It accepts
// the parsed `lines` JSONB from `turath_masr_orders.lines` plus an
// optional `products` text fallback for legacy rows that pre-date the
// `lines` jsonb column.
//
// What it is NOT
// --------------
//   • No image / note exposure. Display labels only.
//   • No HTML — plain Arabic text. Callers handle truncation styling.
//   • No localisation framework — hardcoded Arabic to match the rest
//     of the orders surfaces.
// ─────────────────────────────────────────────────────────────────────────────

/** Subset of a line row we care about. Extra fields are ignored. */
export interface OrderLineLike {
  label?: string | null;
  productType?: string | null;
  color?: string | null;
  quantity?: number | null;
}

export interface BuildProductsSummaryOptions {
  /** Cap how many distinct entries appear before the "+ N منتجات
   *  أخرى" tail. Defaults to no cap. */
  maxItems?: number;
}

/** Map known static product types to their Arabic display labels. */
const TYPE_LABEL_AR: Record<string, string> = {
  holder: 'حامل مصحف',
  quran: 'مصحف',
  flashlight: 'كشاف',
  chair: 'كرسي',
  kaaba: 'كعبة',
};

function safeStr(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function safeQty(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/** Display label for a single line. Honours `label` first (the most
 *  human-readable field) and falls back to the productType mapping. */
function lineLabel(line: OrderLineLike): string {
  const explicit = safeStr(line.label);
  if (explicit) return explicit;
  const type = safeStr(line.productType);
  if (!type) return 'منتج';
  // Static catalog values map cleanly; inventory-backed UUIDs (which
  // the modal also stores in `productType`) fall through to a "منتج"
  // placeholder so the column never shows raw IDs.
  if (TYPE_LABEL_AR[type]) return TYPE_LABEL_AR[type];
  return 'منتج';
}

/**
 * Compose the compact products column for one order. When `lines` is
 * empty / missing the function returns the `fallback` (typically the
 * legacy `products` text column) so older rows still render.
 */
export function buildOrderProductsSummary(
  lines: OrderLineLike[] | null | undefined,
  fallback?: string | null,
  options?: BuildProductsSummaryOptions
): string {
  const cap = options?.maxItems;
  const linesArr = Array.isArray(lines) ? lines : [];
  if (linesArr.length === 0) {
    const fb = safeStr(fallback ?? '');
    return fb || 'لا توجد منتجات';
  }

  // Group same label + same colour. Keep insertion order so the
  // dashboard reads in the same order the operator entered them.
  const groups: Array<{ key: string; label: string; color: string; qty: number }> = [];
  const index = new Map<string, number>();
  for (const line of linesArr) {
    const qty = safeQty(line.quantity);
    if (qty <= 0) continue;
    const label = lineLabel(line);
    const color = safeStr(line.color);
    const key = `${label}__${color}`;
    const existing = index.get(key);
    if (existing !== undefined) {
      groups[existing].qty += qty;
    } else {
      index.set(key, groups.length);
      groups.push({ key, label, color, qty });
    }
  }
  if (groups.length === 0) {
    const fb = safeStr(fallback ?? '');
    return fb || 'لا توجد منتجات';
  }

  const renderGroup = (g: { label: string; color: string; qty: number }): string => {
    const head = g.color ? `${g.label} ${g.color}` : g.label;
    return `${head} × ${g.qty}`;
  };

  if (typeof cap === 'number' && cap > 0 && groups.length > cap) {
    const shown = groups.slice(0, cap).map(renderGroup).join(' + ');
    const extra = groups.length - cap;
    return `${shown} + ${extra} منتجات أخرى`;
  }
  return groups.map(renderGroup).join(' + ');
}
