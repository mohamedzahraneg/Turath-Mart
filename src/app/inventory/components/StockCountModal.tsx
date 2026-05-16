// ─────────────────────────────────────────────────────────────────────────────
// src/app/inventory/components/StockCountModal.tsx
//
// Phase Inventory-Stock-Count-1 — dedicated physical stock count modal.
//
// Why a separate component from InventoryMovementModal?
//   • The manual movement modal asks for a *delta* and a movement type.
//     A physical count is a different mental model: the operator just
//     counted N items on the shelf and needs to reconcile against the
//     system value. The delta is computed, not entered.
//   • A stock count is a first-class business event — it writes a
//     row into `turath_masr_inventory_stock_counts` (the count log),
//     which links to the movement row only when there's actually a
//     discrepancy.
//   • Keeping the surfaces separate lets the manual movement modal
//     stay focused on ad-hoc corrections / manual in/out / damage /
//     returns, without UX baggage for the count workflow.
//
// The modal calls the SECURITY DEFINER RPC
// `public.inventory_record_stock_count` which:
//   • validates the caller (manager_or_above) + auth,
//   • locks the inventory row,
//   • rejects archived products,
//   • computes `delta = counted - available`,
//   • writes a `stock_count_adjustment` movement + bumps `available`
//     when delta ≠ 0,
//   • always inserts the stock_count row (even when delta = 0, to
//     record that the operator confirmed the system value).
// ─────────────────────────────────────────────────────────────────────────────
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ClipboardList, Save, X } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { writeStaffAuditLog } from '@/lib/security/staffAudit';
import {
  formatNumber,
  type InventoryItem,
  type InventoryVariant,
} from '@/lib/inventory/inventoryStats';
import {
  loadInventoryVariantsForProduct,
  variantSellableQty,
} from '@/lib/inventory/inventoryVariants';

interface Props {
  /** Pre-selected product (when launched from a specific product drawer)
   *  or `null` when launched from the global header button. When null,
   *  the modal renders a product picker built from `allItems`. */
  item: InventoryItem | null;
  allItems: InventoryItem[];
  actorId: string | null;
  actorName: string | null;
  onClose: () => void;
  onSaved: () => void;
}

interface StockCountRpcResult {
  stock_count_id: string;
  movement_id: string | null;
  quantity_delta: number;
  quantity_before: number;
  new_available: number;
}

export default function StockCountModal({
  item,
  allItems,
  actorId,
  actorName,
  onClose,
  onSaved,
}: Props) {
  // Picker state — sticky to the explicitly-passed product when the
  // modal is opened from a drawer/row.
  const [selectedId, setSelectedId] = useState<string>(item?.id ?? allItems[0]?.id ?? '');
  const [countedQty, setCountedQty] = useState<number>(0);
  const [reason, setReason] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Phase Inventory-Variants-1B3 — optional variant picker. When a
  // variant is chosen the snapshot + countedQty seed flip to the
  // variant's numbers and the RPC carries `p_variant_id`.
  const [variants, setVariants] = useState<InventoryVariant[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);

  // Archived products are not allowed for counts — the RPC will refuse
  // anyway, but we hide them from the picker to set expectations.
  const selectableItems = useMemo(
    () => allItems.filter((i) => (i.status ?? 'active') !== 'archived'),
    [allItems]
  );

  const selectedItem = useMemo(() => {
    if (item) return item;
    return selectableItems.find((i) => i.id === selectedId) ?? selectableItems[0] ?? null;
  }, [item, selectableItems, selectedId]);

  useEffect(() => {
    if (item) setSelectedId(item.id);
  }, [item]);

  // Refresh variants whenever the selected product changes. Reset
  // the variant choice so we don't carry a stale id across products.
  useEffect(() => {
    if (!selectedItem) {
      setVariants([]);
      setSelectedVariantId(null);
      return;
    }
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
  }, [selectedItem]);

  const selectedVariant = useMemo(
    () => (selectedVariantId ? (variants.find((v) => v.id === selectedVariantId) ?? null) : null),
    [variants, selectedVariantId]
  );

  // When a variant is selected, the snapshot + counted-qty seed
  // come from the variant numbers, not the base product. Otherwise
  // they come from the product (legacy behaviour).
  const currentAvailable = selectedVariant
    ? selectedVariant.available
    : (selectedItem?.available ?? 0);
  const currentReserved = selectedVariant
    ? selectedVariant.reserved
    : (selectedItem?.reserved ?? 0);
  const sellable = selectedVariant
    ? variantSellableQty(selectedVariant)
    : Math.max(0, currentAvailable - currentReserved);
  const isArchived = (selectedItem?.status ?? 'active') === 'archived';

  // Seed the counted-quantity input with the current system value.
  // The operator's job is then to confirm or override — confirming
  // the system value writes a no-delta count row, which has audit
  // value on its own. We seed off the snapshot scope (variant vs
  // base) so flipping the variant picker resets the input sensibly.
  useEffect(() => {
    setCountedQty(currentAvailable);
  }, [selectedItem?.id, selectedVariantId, currentAvailable]);

  const sanitizedCounted = Math.max(0, Math.trunc(countedQty));
  const delta = sanitizedCounted - currentAvailable;
  const deltaLabel =
    delta === 0
      ? 'لا فرق — مطابق'
      : delta > 0
        ? `زيادة +${formatNumber(delta)}`
        : `نقص ${formatNumber(delta)}`;
  const deltaTone: 'neutral' | 'in' | 'out' = delta === 0 ? 'neutral' : delta > 0 ? 'in' : 'out';

  const canSave = !!selectedItem && !isArchived && !!reason.trim() && sanitizedCounted >= 0;

  const handleSubmit = async () => {
    if (saving) return;
    setError(null);
    if (!selectedItem) {
      setError('اختر منتجًا أولًا.');
      return;
    }
    if (isArchived) {
      setError('لا يمكن تسجيل جرد لمنتج مؤرشف.');
      return;
    }
    if (sanitizedCounted < 0) {
      setError('الكمية المعدودة لا يمكن أن تكون سالبة.');
      return;
    }
    if (!reason.trim()) {
      setError('السبب مطلوب لتسجيل الجرد.');
      return;
    }

    setSaving(true);
    try {
      const supabase = createClient();
      const trimmedNote = note.trim();
      const { data, error: rpcError } = await supabase.rpc('inventory_record_stock_count', {
        p_inventory_id: selectedItem.id,
        p_counted_quantity: sanitizedCounted,
        p_reason: reason.trim(),
        p_note: trimmedNote || null,
        p_counted_by_name: actorName,
        p_metadata: trimmedNote ? { note: trimmedNote } : {},
        p_variant_id: selectedVariantId,
      });

      if (rpcError) {
        const msg = (rpcError.message || '').toLowerCase();
        let friendly = rpcError.message || 'تعذر تسجيل الجرد.';
        if (
          msg.includes('function') &&
          (msg.includes('does not exist') || msg.includes('not found'))
        ) {
          friendly = 'يجب تطبيق تحديث قاعدة البيانات الخاص بسجل الجرد أولًا.';
        } else if (msg.includes('archived')) {
          friendly = 'لا يمكن تسجيل جرد لمنتج مؤرشف.';
        } else if (msg.includes('insufficient permissions')) {
          friendly = 'ليست لديك صلاحية تسجيل الجرد.';
        } else if (msg.includes('reason is required')) {
          friendly = 'السبب مطلوب لتسجيل الجرد.';
        } else if (msg.includes('counted_quantity')) {
          friendly = 'الكمية المعدودة غير صالحة.';
        }

        // Best-effort failure audit. Audit failure is non-blocking.
        try {
          await writeStaffAuditLog(supabase, {
            action: 'inventory.stock_count_failed',
            actorId,
            actorName: actorName ?? null,
            entity: { type: 'inventory', id: selectedItem.id, label: selectedItem.name },
            metadata: {
              inventory_id: selectedItem.id,
              product_name: selectedItem.name,
              sku: selectedItem.sku,
              error_message: rpcError.message || null,
            },
          });
        } catch (auditErr) {
          console.warn('[StockCountModal] stock_count_failed audit skipped:', auditErr);
        }

        setError(friendly);
        setSaving(false);
        return;
      }

      const rpcResult = (
        Array.isArray(data) ? (data[0] ?? null) : data
      ) as StockCountRpcResult | null;

      try {
        await writeStaffAuditLog(supabase, {
          action: 'inventory.stock_count_recorded',
          actorId,
          actorName: actorName ?? null,
          entity: { type: 'inventory', id: selectedItem.id, label: selectedItem.name },
          metadata: {
            inventory_id: selectedItem.id,
            product_name: selectedItem.name,
            sku: selectedItem.sku,
            system_available_before: currentAvailable,
            counted_quantity: sanitizedCounted,
            quantity_delta: rpcResult?.quantity_delta ?? delta,
            stock_count_id: rpcResult?.stock_count_id ?? null,
            movement_id: rpcResult?.movement_id ?? null,
            reason: reason.trim(),
            // Phase Inventory-Variants-1B3 — null on base-product counts.
            variant_id: selectedVariantId,
            variant_label: selectedVariant?.variant_label ?? null,
            variant_sku: selectedVariant?.sku ?? null,
          },
        });
      } catch (auditErr) {
        console.warn('[StockCountModal] stock_count_recorded audit skipped:', auditErr);
      }

      setSaving(false);
      onSaved();
      onClose();
    } catch (err) {
      console.error('[StockCountModal] save failed:', err);
      setError('تعذر تسجيل الجرد. حاول مرة أخرى.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-2">
            <ClipboardList size={18} className="text-[hsl(217,80%,30%)]" />
            <h2 className="text-lg font-bold">تسجيل جرد فعلي</h2>
          </div>
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
          {/* Product picker */}
          <div>
            <label className="block text-sm font-semibold mb-1.5">المنتج</label>
            {item ? (
              <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 px-3 py-2.5 text-sm">
                <p className="font-semibold">{item.name}</p>
                <p className="text-[11px] text-[hsl(var(--muted-foreground))] font-mono">
                  {item.sku}
                </p>
              </div>
            ) : selectableItems.length === 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-xs p-2.5">
                لا توجد منتجات نشطة لتسجيل جرد عليها.
              </div>
            ) : (
              <div className="relative">
                <select
                  value={selectedId}
                  onChange={(e) => setSelectedId(e.target.value)}
                  className="w-full appearance-none border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
                >
                  {selectableItems.map((i) => (
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
            )}
          </div>

          {/* Phase Inventory-Variants-1B3 — optional variant picker.
              When a variant is chosen the snapshot below + counted-qty
              seed reflect the variant numbers and the RPC carries the
              variant id. Hidden when the product has no active
              variants. */}
          {variants.length > 0 && (
            <div>
              <label className="block text-sm font-semibold mb-1.5">اللون / المتغير</label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedVariantId(null)}
                  className={`px-3 py-1.5 rounded-xl border text-xs font-semibold ${
                    selectedVariantId === null
                      ? 'border-[hsl(217,80%,30%)] bg-[hsl(217,80%,30%)]/10 text-[hsl(217,80%,30%)]'
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
                        ? 'border-[hsl(217,80%,30%)] bg-[hsl(217,80%,30%)]/10 text-[hsl(217,80%,30%)]'
                        : 'border-[hsl(var(--border))] bg-white text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'
                    }`}
                  >
                    {v.variant_label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1.5">
                {selectedVariant
                  ? `الأرقام أسفل لهذا المتغير فقط.`
                  : `الأرقام أسفل للمنتج الأساسي (بدون متغير).`}
              </p>
            </div>
          )}

          {/* System snapshot */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 p-2.5 text-center">
              <p className="text-[10px] text-[hsl(var(--muted-foreground))]">متاح حسب النظام</p>
              <p className="text-base font-mono font-bold">{formatNumber(currentAvailable)}</p>
            </div>
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 p-2.5 text-center">
              <p className="text-[10px] text-[hsl(var(--muted-foreground))]">محجوز</p>
              <p className="text-base font-mono font-bold">{formatNumber(currentReserved)}</p>
            </div>
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 p-2.5 text-center">
              <p className="text-[10px] text-[hsl(var(--muted-foreground))]">قابل للبيع</p>
              <p className="text-base font-mono font-bold">{formatNumber(sellable)}</p>
            </div>
          </div>

          {/* Counted quantity */}
          <div>
            <label className="block text-sm font-semibold mb-1.5">الكمية الفعلية بعد الجرد</label>
            <input
              type="number"
              min={0}
              step={1}
              value={countedQty}
              onChange={(e) => setCountedQty(Number(e.target.value) || 0)}
              className="w-full border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30 font-mono"
              disabled={!selectedItem || isArchived}
            />
            <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1">
              سيتم حساب الفرق تلقائيًا من المتاح حسب النظام. التأكيد على نفس الرقم يسجل جردًا بدون
              تأثير.
            </p>
          </div>

          {/* Delta preview */}
          <div
            className={`rounded-xl border p-3 flex items-center justify-between text-sm ${
              deltaTone === 'in'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : deltaTone === 'out'
                  ? 'border-red-200 bg-red-50 text-red-700'
                  : 'border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 text-[hsl(var(--foreground))]'
            }`}
          >
            <span>
              النظام: <strong className="font-mono">{formatNumber(currentAvailable)}</strong>
              {' → '}
              معدود: <strong className="font-mono">{formatNumber(sanitizedCounted)}</strong>
            </span>
            <span className="font-semibold">{deltaLabel}</span>
          </div>

          {/* Reason */}
          <div>
            <label className="block text-sm font-semibold mb-1.5">
              السبب
              <span className="text-red-600 mr-1">*</span>
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
              placeholder="مثال: جرد شهري، جرد بعد عاصفة، تسوية بعد تلف"
              maxLength={300}
            />
          </div>

          {/* Note */}
          <div>
            <label className="block text-sm font-semibold mb-1.5">ملاحظة</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="w-full border border-[hsl(var(--border))] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
              placeholder="اختياري — تفاصيل إضافية عن الجرد"
              maxLength={1000}
            />
          </div>

          {isArchived && (
            <div
              className="rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-xs p-2.5"
              role="alert"
            >
              هذا المنتج مؤرشف ولا يمكن تسجيل جرد له. يجب إلغاء الأرشفة أولًا.
            </div>
          )}

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
            disabled={saving || !canSave}
            className="flex-1 flex items-center justify-center gap-2 bg-[hsl(217,80%,30%)] hover:bg-[hsl(217,80%,25%)] text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save size={16} />
            {saving ? 'جاري الحفظ...' : 'حفظ الجرد'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-5 bg-[hsl(var(--muted))] hover:bg-[hsl(var(--muted))]/70 text-[hsl(var(--foreground))] rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50"
          >
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
