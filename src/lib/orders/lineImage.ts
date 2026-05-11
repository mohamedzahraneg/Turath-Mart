// ─────────────────────────────────────────────────────────────────────────────
// src/lib/orders/lineImage.ts
//
// Phase Egress-Fix1 — single source of truth for "where is the image
// for this order line?". Phase Egress-Fix1's cleanup script replaces
// the inline `data:image/...` base64 blob inside
// `turath_masr_orders.lines[n].image` with one of two slim
// alternatives:
//
//   • `image_source: 'inventory'` — the line's `productType` matches a
//     `turath_masr_inventory.id`, so the UI loads the existing
//     thumbnail endpoint by id. No copy was made.
//
//   • `image_source: 'storage'` + `image_path: 'order-line-images/...'`
//     — the productType is orphaned (inventory row deleted), so the
//     bytes were lifted to the private `order-line-images` bucket and
//     served via a signed-URL proxy.
//
// Legacy rows that haven't been cleaned up yet still carry a full
// `data:image/...;base64,...` URL in `image`. This helper handles all
// three shapes transparently — render sites just call
// `resolveLineImageUrl(line)` and use whatever it returns.
//
// What this module is NOT
// -----------------------
//   • Not a fetcher. It only returns URL strings (or `null`).
//   • Not a sanitiser. The cleanup script enforces the schema; this
//     module only reads it.
//   • Not React. Pure TS — can be used in API routes too.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Phase Egress-Fix1 — discriminator for where a line's image lives.
 */
export type LineImageSource = 'inventory' | 'storage' | 'none';

/**
 * Minimal shape of an order line — only the fields the resolver needs.
 * Any extra fields in the actual row are ignored.
 */
export interface LineImageInput {
  /** Legacy column — either a `data:image/...` URL, `http(s)://…`, or a relative path. */
  image?: string | null;
  /** Phase Egress-Fix1 — explicit source flag set by the cleanup script. */
  image_source?: LineImageSource;
  /** Phase Egress-Fix1 — `order-line-images/{order_id}/{index}.{ext}`. */
  image_path?: string | null;
  /** Inventory id used to construct `/api/inventory/<id>/thumbnail`. */
  productType?: string | null;
}

/**
 * Optional context the resolver needs to construct customer-facing
 * URLs. Admin surfaces leave both blank; tracking pages pass the
 * order's `tracking_token` and the line index so the resolver can fall
 * back to the existing customer-safe proxy route.
 */
export interface LineImageContext {
  /** Customer-facing surface only. The unguessable per-order UUID. */
  trackingToken?: string | null;
  /** Customer-facing surface only. Zero-based line index. */
  lineIndex?: number;
}

/**
 * Resolve the URL to render for this line, or `null` when no image
 * is available (consumer should fall back to emoji / placeholder).
 *
 * Resolution order:
 *   1. Direct `image` string — `data:` URL, `http(s)://…`, or a
 *      relative path (`/api/…`). Used both for legacy rows and for
 *      explicit override URLs.
 *   2. `image_source === 'inventory'` + `productType` →
 *      `/api/inventory/<productType>/thumbnail`. The thumbnail
 *      endpoint already exists (Phase 20) and returns raw bytes with
 *      aggressive caching.
 *   3. `image_source === 'storage'` + `image_path` → on customer
 *      surfaces, `/api/track-token/<token>/line-image/<idx>`. The
 *      route consults RLS through the SECURITY DEFINER RPC and 302s
 *      to a signed URL. On admin surfaces (no `trackingToken`),
 *      `/api/order-line-image?path=<path>` (admin route, see
 *      `src/app/api/order-line-image/route.ts`).
 *   4. Nothing else → `null`.
 */
export function resolveLineImageUrl(
  line: LineImageInput | null | undefined,
  context: LineImageContext = {}
): string | null {
  if (!line || typeof line !== 'object') return null;

  // 1. Direct image string wins. Phase Egress-Fix1 stops emitting
  //    base64 here, but historical rows might still carry one until
  //    the cleanup script runs.
  if (typeof line.image === 'string' && line.image.length > 0) {
    if (
      line.image.startsWith('data:') ||
      line.image.startsWith('http://') ||
      line.image.startsWith('https://') ||
      line.image.startsWith('/')
    ) {
      return line.image;
    }
  }

  // 2. Inventory-backed line. The cleanup script sets this for every
  //    line whose productType still maps to a live inventory row.
  if (line.image_source === 'inventory' && line.productType) {
    return `/api/inventory/${encodeURIComponent(String(line.productType))}/thumbnail`;
  }

  // 3. Storage-backed line. Different proxy depending on surface.
  if (line.image_source === 'storage' && line.image_path) {
    const path = String(line.image_path);
    if (context.trackingToken && typeof context.lineIndex === 'number') {
      return `/api/track-token/${encodeURIComponent(context.trackingToken)}/line-image/${context.lineIndex}`;
    }
    return `/api/order-line-image?path=${encodeURIComponent(path)}`;
  }

  return null;
}

/**
 * Convenience predicate used by render sites that want to keep the
 * existing `hasImg ? … : <emoji/>` branch idiomatic.
 */
export function hasLineImage(
  line: LineImageInput | null | undefined,
  context: LineImageContext = {}
): boolean {
  return resolveLineImageUrl(line, context) !== null;
}
