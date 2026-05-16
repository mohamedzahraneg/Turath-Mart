// ─────────────────────────────────────────────────────────────────────────────
// src/app/orders-management/components/OrderLinesEditor.tsx
//
// Phase Orders-Edit-2 — shared product-grid + per-line editor used
// by both AddOrderModal (initial line entry) and EditOrderModal
// (post-creation edits). The component is a controlled view:
//
//   • parent owns the `lines` state and the `productCards` snapshot
//   • we emit `onLinesChange(next)` for every mutation
//   • stock checks fire via the `inventoryItems` array when present;
//     non-inventory cards (static catalog) skip the check
//
// Why a single shared editor?
// ---------------------------
// The legacy inline block inside AddOrderModal is ~300 lines and the
// EditOrderModal had a read-only stub. Extracting it keeps both
// modals on the exact same UX (color picker, qty stepper, stock
// guard, delete button) so any future bug fix lands once.
//
// What this component does NOT do
// -------------------------------
//   • Doesn't load the product catalog. The parent calls
//     `loadProductCards(supabase)` once and passes the result.
//   • Doesn't compute totals or build the checkout envelope. Lines
//     are pure state; the parent recomputes subtotal / final_total.
//   • Doesn't write to Supabase. All persistence lives in the parent.
// ─────────────────────────────────────────────────────────────────────────────
'use client';

import React from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { InventoryThumbnail } from '@/lib/inventory/InventoryThumbnail';
import {
  createDraftLine,
  lineSubtotal,
  maxStockForLine,
  pickVariantForLine,
  resolveLineColors,
  type DraftOrderLine,
  type InventoryItem,
  type ProductCard,
} from '@/lib/orders/productCards';

export interface OrderLinesEditorProps {
  lines: DraftOrderLine[];
  productCards: ProductCard[];
  inventoryItems: InventoryItem[];
  onLinesChange: (next: DraftOrderLine[]) => void;
  /** Optional flag — if `true`, the editor refuses to delete the
   *  last line and surfaces a toast explaining why. Useful for the
   *  edit flow where saving an empty order makes no business sense. */
  requireAtLeastOne?: boolean;
  /** Phase Orders-Edit-2 — header label hint. AddOrderModal renders
   *  its own section header outside this component (it has step
   *  navigation context); EditOrderModal lets the editor draw the
   *  header itself. */
  renderHeader?: boolean;
}

export default function OrderLinesEditor({
  lines,
  productCards,
  inventoryItems,
  onLinesChange,
  requireAtLeastOne = true,
  renderHeader = true,
}: OrderLinesEditorProps) {
  // Mutators close over the latest `lines` snapshot so consecutive
  // additions never race on stale state.
  const addLine = (card: ProductCard) => {
    if (!Number.isFinite(card.basePrice) || card.basePrice < 0) {
      toast.error('سعر المنتج غير متوفر من المخزن. راجع إعدادات المنتج أولًا.');
      return;
    }
    if (card.isInventory) {
      const otherSame = lines.filter((l) => l.productType === card.value);
      const remaining = maxStockForLine(card, inventoryItems, otherSame);
      if (remaining <= 0) {
        toast.error(`نفذ المخزون من ${card.label}`);
        return;
      }
    }
    onLinesChange([...lines, createDraftLine(card)]);
  };

  const removeLine = (id: string) => {
    if (requireAtLeastOne && lines.length <= 1) {
      toast.error('لا يمكن حذف آخر منتج. لإلغاء الطلب استخدم تغيير الحالة.');
      return;
    }
    onLinesChange(lines.filter((l) => l.id !== id));
  };

  const updateLine = (id: string, patch: Partial<DraftOrderLine>) => {
    onLinesChange(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  // Phase Inventory-Variants-1B2 — when the operator picks a new
  // colour, resolve the corresponding variant on the parent product
  // card and overwrite the line's variant identity together with the
  // colour itself. The baseline safety valve inside `pickVariantForLine`
  // returns `null` for any variant that hasn't been baselined yet
  // (available + reserved = 0), so the line stays at the base-product
  // level until the operator sets per-variant stock via stock count.
  const updateLineColor = (id: string, color: string) => {
    onLinesChange(
      lines.map((l) => {
        if (l.id !== id) return l;
        const card = productCards.find((p) => p.value === l.productType) ?? null;
        const variant = pickVariantForLine(card, color);
        return {
          ...l,
          color,
          variant_id: variant?.id ?? null,
          variant_label: variant?.variant_label ?? null,
          variant_sku: variant?.sku ?? null,
        };
      })
    );
  };

  // Replace a line's product with a different card. Used by the
  // per-line "تغيير المنتج" select. Stock-checked the same way
  // `addLine` is. Preserves the line id so the React key + audit
  // diff continue to track this position rather than treating it as
  // a remove+add.
  const swapLineProduct = (id: string, card: ProductCard) => {
    const current = lines.find((l) => l.id === id);
    if (!current) return;
    if (card.value === current.productType) return;
    if (card.isInventory) {
      const otherSame = lines.filter((l) => l.productType === card.value && l.id !== id);
      const remaining = maxStockForLine(card, inventoryItems, otherSame);
      if (remaining < current.quantity) {
        // If the swap target has less stock than current qty, cap
        // the quantity rather than refusing the swap entirely.
        toast.error(
          remaining <= 0
            ? `نفذ المخزون من ${card.label}`
            : `الكمية المتاحة من ${card.label}: ${remaining} فقط — تم خفض الكمية`
        );
        if (remaining <= 0) return;
      }
    }
    const defaultColor =
      card.colors && card.colors.length > 0
        ? card.colors[0]
        : card.value === 'holder'
          ? 'brown'
          : '';
    const remainingCap = card.isInventory
      ? maxStockForLine(
          card,
          inventoryItems,
          lines.filter((l) => l.productType === card.value && l.id !== id)
        )
      : Infinity;
    const newQty = Math.min(Math.max(1, current.quantity), Math.max(1, remainingCap));
    // Phase Inventory-Variants-1B2 — a product swap also retargets
    // the variant identity. Resolve against the new card's default
    // colour; if no baselined variant matches, drop the variant
    // fields entirely so the line falls back to the base product.
    const swappedVariant = pickVariantForLine(card, defaultColor);
    const swappedInventoryId =
      card.id && card.id.trim() ? card.id.trim() : card.isInventory ? card.value : null;
    const swappedSku = swappedInventoryId && card.sku ? String(card.sku) : null;
    onLinesChange(
      lines.map((l) =>
        l.id === id
          ? {
              ...l,
              productType: card.value,
              label: card.label,
              color: defaultColor,
              unitPrice: card.basePrice,
              emoji: card.emoji,
              // Phase Orders-Edit-2 — drop the old line's image
              // metadata on a product swap. The new line will
              // resolve its image from the inventory thumbnail
              // route via the productCard, not the carry-over.
              image: undefined,
              image_source: card.isInventory ? 'inventory' : undefined,
              image_path: null,
              quantity: newQty,
              // Phase Inventory-Order-Identity-1 — retarget identity
              // so the line carries the new product's inventory id /
              // sku instead of the previous one's. Without this the
              // saved line would stamp the old product's id even
              // though the serializer overrides it (defence in depth).
              inventory_id: swappedInventoryId,
              sku: swappedInventoryId ? swappedSku : null,
              // Phase Inventory-Variants-1B2 — variant identity for
              // the new product/colour pair.
              variant_id: swappedVariant?.id ?? null,
              variant_label: swappedVariant?.variant_label ?? null,
              variant_sku: swappedVariant?.sku ?? null,
            }
          : l
      )
    );
  };

  return (
    <div className="space-y-4">
      {renderHeader && (
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-[hsl(var(--foreground))]">المنتجات</h3>
          <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
            اضغط بطاقة المنتج لإضافته — يمكنك تكرار نفس المنتج بألوان مختلفة
          </span>
        </div>
      )}

      {/* Product card grid */}
      {productCards.length === 0 ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))] text-center py-6 border-2 border-dashed border-[hsl(var(--border))] rounded-2xl">
          جارٍ تحميل المنتجات...
        </p>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
          {productCards.map((product) => {
            const count = lines.filter((l) => l.productType === product.value).length;
            const inv = product.isInventory
              ? inventoryItems.find((i) => i.id === product.value)
              : null;
            const remaining = product.isInventory
              ? maxStockForLine(
                  product,
                  inventoryItems,
                  lines.filter((l) => l.productType === product.value)
                )
              : null;
            const outOfStock = remaining === 0;
            const hasRealImage =
              product.image &&
              (product.image.startsWith('data:') ||
                product.image.startsWith('http') ||
                product.image.startsWith('/'));
            return (
              <button
                key={`product-card-${product.value}`}
                type="button"
                onClick={() => addLine(product)}
                disabled={outOfStock}
                className={`relative w-full aspect-square rounded-2xl border-2 flex flex-col items-center justify-center gap-1 transition-all overflow-hidden ${
                  outOfStock
                    ? 'border-red-200 bg-red-50 opacity-50 cursor-not-allowed'
                    : count > 0
                      ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5 shadow-md'
                      : 'border-[hsl(var(--border))] hover:border-[hsl(var(--primary))]/50 hover:shadow-sm bg-white'
                }`}
              >
                <InventoryThumbnail
                  src={product.image}
                  alt={product.label}
                  emoji={product.emoji}
                  fill
                  sizes="(max-width: 768px) 33vw, 150px"
                  className="object-cover"
                  emojiClassName="text-3xl"
                />
                {count > 0 && (
                  <div className="absolute top-1 left-1 w-5 h-5 bg-[hsl(var(--primary))] rounded-full flex items-center justify-center z-10">
                    <span className="text-white text-[10px] font-bold">{count}</span>
                  </div>
                )}
                {product.isInventory && inv && (
                  <div
                    className={`absolute top-1 right-1 px-1.5 py-0.5 rounded-full text-[8px] font-bold z-10 ${
                      (inv.available || 0) > 0
                        ? 'bg-green-100 text-green-700'
                        : 'bg-red-100 text-red-600'
                    }`}
                  >
                    {inv.available || 0} متاح
                  </div>
                )}
                <span
                  className={`text-[10px] font-bold mt-1 relative z-10 ${
                    hasRealImage
                      ? 'text-white bg-black/50 px-1 rounded absolute bottom-1'
                      : 'text-[hsl(var(--foreground))]'
                  }`}
                >
                  {product.label}
                </span>
                {!hasRealImage && (
                  <span className="text-[9px] text-[hsl(var(--muted-foreground))] relative z-10">
                    + إضافة
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {lines.length === 0 ? (
        <p className="text-center py-6 text-[hsl(var(--muted-foreground))] text-sm border-2 border-dashed border-[hsl(var(--border))] rounded-2xl">
          اضغط على صورة المنتج أعلاه لإضافته
        </p>
      ) : (
        <div className="space-y-3">
          {lines.map((line, index) => {
            const card = productCards.find((p) => p.value === line.productType) ?? null;
            const colors = resolveLineColors(card);
            const isFlashlight = line.productType === 'flashlight';
            const otherSame = lines.filter(
              (l) => l.productType === line.productType && l.id !== line.id
            );
            const maxQty = card ? maxStockForLine(card, inventoryItems, otherSame) : Infinity;
            return (
              <div
                key={line.id}
                className="border border-[hsl(var(--border))] rounded-2xl p-4 bg-[hsl(var(--muted))]/20"
              >
                {/* Header row: thumb + label + swap select + delete */}
                <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <InventoryThumbnail
                      src={card?.image}
                      alt={card?.label || line.label || ''}
                      emoji={card?.emoji || line.emoji || '📦'}
                      width={32}
                      height={32}
                      className="w-8 h-8 rounded-lg object-cover flex-shrink-0"
                      emojiClassName="text-xl w-8 h-8"
                    />
                    <span className="text-xs font-bold text-[hsl(var(--primary))] bg-[hsl(var(--primary))]/10 px-2 py-1 rounded-lg truncate">
                      {card?.label || line.label || line.productType} #{index + 1}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Phase Orders-Edit-2 — per-line product swap.
                        Lets the operator change the line's product
                        without delete+add. Stock-checked + price-
                        refreshed inside `swapLineProduct`. */}
                    <select
                      value={line.productType}
                      onChange={(e) => {
                        const next = productCards.find((p) => p.value === e.target.value);
                        if (next) swapLineProduct(line.id, next);
                      }}
                      className="text-[11px] px-2 py-1 rounded-lg border border-[hsl(var(--border))] bg-white max-w-[160px]"
                    >
                      {productCards.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.label}
                          {p.basePrice
                            ? ` — ${Number(p.basePrice).toLocaleString('en-US')} ج.م`
                            : ''}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => removeLine(line.id)}
                      className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-red-500"
                      title="حذف هذا المنتج"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Color picker */}
                  {colors.length > 0 && (
                    <div className="sm:col-span-2">
                      <label className="label-text">اللون *</label>
                      <div className="flex gap-2 flex-wrap">
                        {colors.map((color) => (
                          <button
                            key={`color-${line.id}-${color.value}`}
                            type="button"
                            onClick={() => updateLineColor(line.id, color.value)}
                            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-all ${
                              line.color === color.value
                                ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]'
                                : 'border-[hsl(var(--border))] hover:border-gray-400'
                            }`}
                          >
                            <span
                              className="w-3 h-3 rounded-full border border-gray-300 flex-shrink-0"
                              style={{ backgroundColor: color.hex }}
                            />
                            {color.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Quantity */}
                  <div>
                    <label className="label-text">الكمية *</label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          updateLine(line.id, { quantity: Math.max(1, line.quantity - 1) })
                        }
                        className="w-8 h-8 flex items-center justify-center rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
                      >
                        <Minus size={13} />
                      </button>
                      <input
                        type="number"
                        min={1}
                        className="input-field w-16 text-center font-mono"
                        value={line.quantity}
                        onChange={(e) => {
                          let qty = Math.max(1, Number(e.target.value));
                          if (card?.isInventory && Number.isFinite(maxQty)) {
                            if (qty > maxQty) {
                              qty = Math.max(1, maxQty);
                              toast.error(`الكمية المتاحة في المخزون: ${maxQty} فقط`);
                            }
                          }
                          updateLine(line.id, { quantity: qty });
                        }}
                        dir="ltr"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (
                            card?.isInventory &&
                            Number.isFinite(maxQty) &&
                            line.quantity + 1 > maxQty
                          ) {
                            toast.error(`الكمية المتاحة في المخزون: ${maxQty} فقط`);
                            return;
                          }
                          updateLine(line.id, { quantity: line.quantity + 1 });
                        }}
                        className="w-8 h-8 flex items-center justify-center rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
                      >
                        <Plus size={13} />
                      </button>
                    </div>
                  </div>

                  {/* Price (read-only from inventory / settings) */}
                  <div>
                    <label className="label-text">السعر (من المخزن)</label>
                    <input
                      type="text"
                      readOnly
                      dir="ltr"
                      className="input-field bg-slate-50 text-center font-mono cursor-not-allowed"
                      value={`${Number(line.unitPrice).toLocaleString('en-US')} ج.م`}
                    />
                  </div>

                  {/* Flashlight add-on (holder only) */}
                  {line.productType === 'holder' && (
                    <div className="sm:col-span-2 flex items-center gap-3">
                      <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                        <input
                          type="checkbox"
                          checked={line.includeFlashlight}
                          onChange={(e) =>
                            updateLine(line.id, { includeFlashlight: e.target.checked })
                          }
                        />
                        إضافة كشاف ({line.flashlightPrice} ج.م)
                      </label>
                    </div>
                  )}

                  {isFlashlight && (
                    <p className="sm:col-span-2 text-[11px] text-[hsl(var(--muted-foreground))]">
                      كشاف مستقل — يمكنك تكرار المنتج لإضافة أكثر من قطعة.
                    </p>
                  )}
                </div>

                {/* Per-line subtotal */}
                <div className="mt-3 pt-3 border-t border-[hsl(var(--border))] flex items-center justify-between text-xs">
                  <span className="text-[hsl(var(--muted-foreground))]">إجمالي السطر</span>
                  <span className="font-bold font-mono text-[hsl(211,67%,28%)]">
                    {lineSubtotal(line).toLocaleString('en-US')} ج.م
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
