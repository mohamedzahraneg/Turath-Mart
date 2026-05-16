// ─────────────────────────────────────────────────────────────────────────────
// src/app/inventory/components/AddStockModal.tsx
//
// Phase Inventory-Additions-Log-1 — modal for recording a stock
// addition (procurement / receipt). Calls the atomic RPC
// `public.inventory_record_addition` which:
//   • validates the caller (manager_or_above),
//   • locks the inventory row + rejects archived products,
//   • upserts the supplier when only a free-text name is provided,
//   • inserts an immutable additions-ledger row,
//   • bumps `available`, refreshes `cost_price`, `last_added_at`,
//     `last_added_by`,
//   • returns the new addition id + the updated `available`.
//
// The client side NEVER touches the `available` column directly —
// everything goes through the RPC so the ledger and the running
// total stay in sync. If the RPC is missing (migration not applied
// yet), we surface a friendly hint and bail.
// ─────────────────────────────────────────────────────────────────────────────
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, ChevronDown, Plus, Save, X } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { writeStaffAuditLog } from '@/lib/security/staffAudit';
import {
  formatMoney,
  formatNumber,
  type InventoryItem,
  type InventoryVariant,
} from '@/lib/inventory/inventoryStats';
import {
  loadInventoryVariantsForProduct,
  variantSellableQty,
} from '@/lib/inventory/inventoryVariants';

interface Props {
  item: InventoryItem;
  /** Other inventory items, so users can re-pick a different product
   *  without closing the modal (when opened from the global "تسجيل
   *  حركة" header button, for instance). The parent decides whether
   *  the picker is enabled by passing this list. */
  allItems?: InventoryItem[];
  actorId: string | null;
  actorName: string | null;
  onClose: () => void;
  /** Called after a successful save so the parent can refresh state
   *  (re-fetch inventory + additions). */
  onSaved: () => void;
}

interface AdditionRpcResult {
  addition_id: string;
  new_available: number;
}

export default function AddStockModal({
  item,
  allItems,
  actorId,
  actorName,
  onClose,
  onSaved,
}: Props) {
  const [selectedId, setSelectedId] = useState<string>(item.id);
  const [quantity, setQuantity] = useState<number>(1);
  const [unitCost, setUnitCost] = useState<number | ''>('');
  const [supplierName, setSupplierName] = useState<string>('');
  const [supplierInvoiceNum, setSupplierInvoiceNum] = useState<string>('');
  const [receivedAt, setReceivedAt] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Phase Inventory-Variants-1B3 — optional variant picker.
  const [variants, setVariants] = useState<InventoryVariant[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);

  const selectedItem = useMemo(() => {
    if (!allItems || allItems.length === 0) return item;
    return allItems.find((i) => i.id === selectedId) ?? item;
  }, [allItems, selectedId, item]);

  useEffect(() => {
    setSelectedId(item.id);
  }, [item.id]);

  // Refresh variants whenever the selected product changes. Reset
  // the variant choice so we don't carry a stale id across products.
  useEffect(() => {
    let cancelled = false;
    setSelectedVariantId(null);
    setVariants([]);
    (async () => {
      const supabase = createClient();
      const rows = await loadInventoryVariantsForProduct(supabase, selectedItem.id);
      if (!cancelled) setVariants(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedItem.id]);

  const selectedVariant = useMemo(
    () => (selectedVariantId ? (variants.find((v) => v.id === selectedVariantId) ?? null) : null),
    [variants, selectedVariantId]
  );

  const totalCost = useMemo(() => {
    if (unitCost === '' || !Number.isFinite(Number(unitCost))) return null;
    return Number(unitCost) * (quantity || 0);
  }, [unitCost, quantity]);

  const isArchived = (selectedItem.status ?? 'active') === 'archived';

  const handleSubmit = async () => {
    if (saving) return;
    setError(null);

    if (isArchived) {
      setError('لا يمكن إضافة كمية لمنتج مؤرشف. استعد المنتج أولًا.');
      return;
    }
    if (!quantity || quantity <= 0) {
      setError('الكمية يجب أن تكون أكبر من صفر.');
      return;
    }

    setSaving(true);
    try {
      const supabase = createClient();
      const receivedAtIso = receivedAt ? new Date(`${receivedAt}T12:00:00`).toISOString() : null;

      const { data, error: rpcError } = await supabase.rpc('inventory_record_addition', {
        p_inventory_id: selectedItem.id,
        p_quantity: Math.trunc(quantity),
        p_unit_cost: unitCost === '' ? null : Number(unitCost),
        p_supplier_id: null,
        p_supplier_name: supplierName.trim() || null,
        p_supplier_invoice_num: supplierInvoiceNum.trim() || null,
        p_received_at: receivedAtIso,
        p_note: note.trim() || null,
        p_created_by_name: actorName,
        p_variant_id: selectedVariantId,
      });

      if (rpcError) {
        // Migration / function missing.
        const msg = (rpcError.message || '').toLowerCase();
        if (
          msg.includes('function') &&
          (msg.includes('does not exist') || msg.includes('not found'))
        ) {
          setError('يجب تطبيق تحديث قاعدة البيانات الخاص بسجل الإضافات أولًا.');
        } else if (msg.includes('archived')) {
          setError('لا يمكن إضافة كمية لمنتج مؤرشف.');
        } else if (msg.includes('insufficient permissions')) {
          setError('ليست لديك صلاحية إضافة كمية للمخزن.');
        } else {
          setError(rpcError.message || 'تعذر تسجيل الإضافة.');
        }
        setSaving(false);
        return;
      }

      // Best-effort staff audit log.
      const rpcResult = Array.isArray(data)
        ? ((data[0] as AdditionRpcResult | undefined) ?? null)
        : ((data as AdditionRpcResult | null) ?? null);
      try {
        await writeStaffAuditLog(supabase, {
          action: 'inventory.addition_created',
          actorId,
          actorName: actorName ?? null,
          entity: { type: 'inventory', id: selectedItem.id, label: selectedItem.name },
          metadata: {
            inventory_id: selectedItem.id,
            product_name: selectedItem.name,
            sku: selectedItem.sku,
            quantity: Math.trunc(quantity),
            unit_cost: unitCost === '' ? null : Number(unitCost),
            total_cost: totalCost,
            supplier_name: supplierName.trim() || null,
            supplier_invoice_num: supplierInvoiceNum.trim() || null,
            received_at: receivedAtIso,
            addition_id: rpcResult?.addition_id ?? null,
            new_available: rpcResult?.new_available ?? null,
            // Phase Inventory-Variants-1B3 — null on base-product additions.
            variant_id: selectedVariantId,
            variant_label: selectedVariant?.variant_label ?? null,
            variant_sku: selectedVariant?.sku ?? null,
          },
        });
      } catch (auditErr) {
        // Audit failures are non-blocking — log and continue.
        console.warn('[AddStockModal] audit log skipped', auditErr);
      }

      setSaving(false);
      onSaved();
      onClose();
    } catch (err) {
      console.error('[AddStockModal] save failed', err);
      setError('تعذر تسجيل الإضافة. حاول مرة أخرى.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-[hsl(var(--border))]">
          <h2 className="text-lg font-bold">إضافة كمية للمخزون</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-[hsl(var(--muted))] rounded-xl"
            aria-label="إغلاق"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Product */}
          <div>
            <label className="block text-sm font-semibold mb-1.5">المنتج</label>
            {allItems && allItems.length > 1 ? (
              <div className="relative">
                <select
                  value={selectedId}
                  onChange={(e) => setSelectedId(e.target.value)}
                  className="w-full appearance-none border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
                >
                  {allItems
                    .filter((i) => (i.status ?? 'active') !== 'archived')
                    .map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name} {i.sku ? `— ${i.sku}` : ''}
                      </option>
                    ))}
                </select>
                <ChevronDown
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] pointer-events-none"
                />
              </div>
            ) : (
              <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 px-3 py-2.5 text-sm">
                <p className="font-semibold">{selectedItem.name}</p>
                <p className="text-[11px] text-[hsl(var(--muted-foreground))] font-mono">
                  {selectedItem.sku}
                </p>
              </div>
            )}
            <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1">
              الكمية المتاحة حاليًا: {selectedItem.available ?? 0}
            </p>
          </div>

          {/* Phase Inventory-Variants-1B3 — optional variant picker.
              Hidden when the product has no active variants. Default
              is "بدون متغير" so the legacy base-product flow is
              preserved byte-for-byte. */}
          {variants.length > 0 && (
            <div>
              <label className="block text-sm font-semibold mb-1.5">اللون / المتغير</label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedVariantId(null)}
                  className={`px-3 py-1.5 rounded-xl border text-xs font-semibold ${
                    selectedVariantId === null
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                      : 'border-[hsl(var(--border))] bg-white text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'
                  }`}
                >
                  بدون متغير — المنتج الأساسي
                </button>
                {variants.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setSelectedVariantId(v.id)}
                    className={`px-3 py-1.5 rounded-xl border text-xs font-semibold ${
                      selectedVariantId === v.id
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                        : 'border-[hsl(var(--border))] bg-white text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'
                    }`}
                  >
                    {v.variant_label}
                  </button>
                ))}
              </div>
              {selectedVariant && (
                <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1.5">
                  المتاح للمتغير: {formatNumber(selectedVariant.available)} · المحجوز:{' '}
                  {formatNumber(selectedVariant.reserved)} · قابل للبيع:{' '}
                  {formatNumber(variantSellableQty(selectedVariant))}
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold mb-1.5">الكمية المضافة *</label>
              <input
                type="number"
                min={1}
                step={1}
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value) || 0)}
                className="w-full border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30 font-mono"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1.5">تكلفة شراء القطعة</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={unitCost}
                onChange={(e) => {
                  const v = e.target.value;
                  setUnitCost(v === '' ? '' : Number(v));
                }}
                className="w-full border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30 font-mono"
                placeholder="اختياري"
              />
            </div>
          </div>

          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-3 py-2 flex items-center justify-between text-sm">
            <span className="text-[hsl(var(--muted-foreground))]">إجمالي التكلفة</span>
            <span className="font-bold font-mono">
              {totalCost == null ? '—' : formatMoney(totalCost)}
            </span>
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1.5">المورد</label>
            <input
              type="text"
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
              className="w-full border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
              placeholder="اسم المورد (اختياري)"
            />
            <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1">
              سيتم إنشاء المورد تلقائيًا لو لم يكن موجودًا.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold mb-1.5">رقم فاتورة المورد</label>
              <input
                type="text"
                value={supplierInvoiceNum}
                onChange={(e) => setSupplierInvoiceNum(e.target.value)}
                className="w-full border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30 font-mono"
                placeholder="اختياري"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1.5">تاريخ الاستلام</label>
              <div className="relative">
                <input
                  type="date"
                  value={receivedAt}
                  onChange={(e) => setReceivedAt(e.target.value)}
                  className="w-full border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30 font-mono"
                />
                <Calendar
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] pointer-events-none"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1.5">ملاحظة</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="w-full border border-[hsl(var(--border))] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
              placeholder="اختياري"
            />
          </div>

          {error && (
            <div
              className="rounded-xl border border-red-200 bg-red-50 text-red-700 text-xs p-2.5"
              role="alert"
            >
              {error}
            </div>
          )}
        </div>

        <div className="flex gap-3 p-5 border-t border-[hsl(var(--border))]">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving || isArchived || !quantity || quantity <= 0}
            className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <Save size={16} />
                جاري الحفظ...
              </>
            ) : (
              <>
                <Plus size={16} />
                حفظ الإضافة
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-5 border border-[hsl(var(--border))] rounded-xl text-sm font-semibold hover:bg-[hsl(var(--muted))] disabled:opacity-50"
          >
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
