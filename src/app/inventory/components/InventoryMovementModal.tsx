// ─────────────────────────────────────────────────────────────────────────────
// src/app/inventory/components/InventoryMovementModal.tsx
//
// Phase Inventory-Movement-Ledger-1 — manual stock movement modal.
// Calls the atomic RPC `public.inventory_apply_movement` which:
//   • validates the caller (manager_or_above),
//   • locks the inventory row + rejects archived products,
//   • enforces sign rules per movement_type,
//   • blocks negative available,
//   • writes one immutable movement-ledger row,
//   • updates `available` (or `cost_price` for price_change).
//
// Six manual movement types exposed to the UI:
//   • manual_in        إضافة يدوية
//   • manual_out       خصم يدوي
//   • damage_out       تالف
//   • return_in        مرتجع من عميل
//   • stock_count_adjustment   تسوية جرد
//   • correction       تصحيح
//
// `addition` / `exchange_*` are NOT exposed here — those are reserved
// for the AddStockModal (additions) and a future order-integration
// phase (exchanges).
// ─────────────────────────────────────────────────────────────────────────────
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, Save, X } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { writeStaffAuditLog } from '@/lib/security/staffAudit';
import {
  formatNumber,
  MOVEMENT_TYPE_LABELS_AR,
  type InventoryItem,
  type ManualMovementType,
} from '@/lib/inventory/inventoryStats';

interface Props {
  /** Pre-selected product (when launched from a specific product) or
   *  `null` when launched from the global header button. When null,
   *  the modal renders a product picker built from `allItems`. */
  item: InventoryItem | null;
  allItems: InventoryItem[];
  actorId: string | null;
  actorName: string | null;
  onClose: () => void;
  onSaved: () => void;
}

interface MovementRpcResult {
  movement_id: string;
  new_available: number;
}

const TYPE_OPTIONS: { key: ManualMovementType; label: string; tone: 'in' | 'out' | 'neutral' }[] = [
  { key: 'manual_in', label: MOVEMENT_TYPE_LABELS_AR.manual_in, tone: 'in' },
  { key: 'return_in', label: MOVEMENT_TYPE_LABELS_AR.return_in, tone: 'in' },
  { key: 'manual_out', label: MOVEMENT_TYPE_LABELS_AR.manual_out, tone: 'out' },
  { key: 'damage_out', label: MOVEMENT_TYPE_LABELS_AR.damage_out, tone: 'out' },
  {
    key: 'stock_count_adjustment',
    label: MOVEMENT_TYPE_LABELS_AR.stock_count_adjustment,
    tone: 'neutral',
  },
  { key: 'correction', label: MOVEMENT_TYPE_LABELS_AR.correction, tone: 'neutral' },
];

function isOutbound(type: ManualMovementType): boolean {
  return type === 'manual_out' || type === 'damage_out';
}

function reasonRequired(type: ManualMovementType): boolean {
  return (
    type === 'manual_out' ||
    type === 'damage_out' ||
    type === 'stock_count_adjustment' ||
    type === 'correction'
  );
}

export default function InventoryMovementModal({
  item,
  allItems,
  actorId,
  actorName,
  onClose,
  onSaved,
}: Props) {
  const [selectedId, setSelectedId] = useState<string>(item?.id ?? allItems[0]?.id ?? '');
  const [movementType, setMovementType] = useState<ManualMovementType>('manual_in');
  // For non-adjustment movements: positive number entered by user;
  // we flip the sign internally for outbound types.
  const [quantity, setQuantity] = useState<number>(1);
  // For stock_count_adjustment: the actual counted quantity. Delta is
  // computed as `counted - current available`.
  const [countedQty, setCountedQty] = useState<number>(0);
  const [reason, setReason] = useState<string>('');
  const [orderNum, setOrderNum] = useState<string>('');
  const [invoiceNum, setInvoiceNum] = useState<string>('');
  const [unitCost, setUnitCost] = useState<number | ''>('');
  const [note, setNote] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectableItems = useMemo(
    () => allItems.filter((i) => (i.status ?? 'active') !== 'archived'),
    [allItems]
  );

  const selectedItem = useMemo(() => {
    if (item) return item;
    return selectableItems.find((i) => i.id === selectedId) ?? selectableItems[0] ?? null;
  }, [item, selectableItems, selectedId]);

  // Sync the picker if the parent passes a different `item`.
  useEffect(() => {
    if (item) setSelectedId(item.id);
  }, [item]);

  useEffect(() => {
    setCountedQty(selectedItem?.available ?? 0);
  }, [selectedItem?.id, selectedItem?.available]);

  const currentAvailable = selectedItem?.available ?? 0;
  const isArchived = (selectedItem?.status ?? 'active') === 'archived';

  // Compute signed delta for preview + submit.
  const signedDelta: number = useMemo(() => {
    if (movementType === 'stock_count_adjustment') {
      return Math.trunc((countedQty || 0) - currentAvailable);
    }
    const qty = Math.trunc(quantity || 0);
    if (qty === 0) return 0;
    if (isOutbound(movementType)) return -Math.abs(qty);
    if (movementType === 'correction') {
      // Correction can be ± — keep sign as entered.
      return qty;
    }
    return Math.abs(qty);
  }, [movementType, quantity, countedQty, currentAvailable]);

  const previewAfter = currentAvailable + signedDelta;
  const wouldBeNegative = previewAfter < 0;

  const handleSubmit = async () => {
    if (saving) return;
    setError(null);

    if (!selectedItem) {
      setError('اختر منتجًا أولًا.');
      return;
    }
    if (isArchived) {
      setError('لا يمكن تسجيل حركة لمنتج مؤرشف.');
      return;
    }
    if (signedDelta === 0) {
      setError('الفرق المطلوب يساوي صفر — لا توجد حركة لتسجيلها.');
      return;
    }
    if (wouldBeNegative) {
      setError('الكمية المتاحة بعد الحركة ستكون سالبة. عدّل الكمية أو راجع الأرقام.');
      return;
    }
    if (reasonRequired(movementType) && !reason.trim()) {
      setError('السبب مطلوب لهذا النوع من الحركة.');
      return;
    }

    setSaving(true);
    try {
      const supabase = createClient();
      const referenceType = orderNum.trim()
        ? 'order'
        : invoiceNum.trim()
          ? 'supplier_invoice'
          : null;

      const { data, error: rpcError } = await supabase.rpc('inventory_apply_movement', {
        p_inventory_id: selectedItem.id,
        p_movement_type: movementType,
        p_quantity_delta: signedDelta,
        p_reason: reason.trim() || null,
        p_reference_type: referenceType,
        p_reference_id: null,
        p_order_num: orderNum.trim() || null,
        p_supplier_invoice_num: invoiceNum.trim() || null,
        p_unit_cost: unitCost === '' ? null : Number(unitCost),
        p_created_by_name: actorName,
        p_metadata: note.trim() ? { note: note.trim() } : {},
      });

      if (rpcError) {
        const msg = (rpcError.message || '').toLowerCase();
        if (
          msg.includes('function') &&
          (msg.includes('does not exist') || msg.includes('not found'))
        ) {
          setError('يجب تطبيق تحديث قاعدة البيانات الخاص بسجل الحركة أولًا.');
        } else if (msg.includes('archived')) {
          setError('لا يمكن تسجيل حركة لمنتج مؤرشف.');
        } else if (msg.includes('insufficient permissions')) {
          setError('ليست لديك صلاحية تسجيل حركة مخزون.');
        } else if (msg.includes('negative')) {
          setError('الكمية المتاحة بعد الحركة ستكون سالبة.');
        } else {
          setError(rpcError.message || 'تعذر تسجيل الحركة.');
        }
        setSaving(false);
        return;
      }

      const rpcResult = Array.isArray(data)
        ? ((data[0] as MovementRpcResult | undefined) ?? null)
        : ((data as MovementRpcResult | null) ?? null);

      try {
        await writeStaffAuditLog(supabase, {
          action: 'inventory.movement_created',
          actorId,
          actorName: actorName ?? null,
          entity: { type: 'inventory', id: selectedItem.id, label: selectedItem.name },
          metadata: {
            inventory_id: selectedItem.id,
            product_name: selectedItem.name,
            sku: selectedItem.sku,
            movement_type: movementType,
            quantity_delta: signedDelta,
            quantity_before: currentAvailable,
            quantity_after: rpcResult?.new_available ?? previewAfter,
            reason: reason.trim() || null,
            order_num: orderNum.trim() || null,
            reference_type: referenceType,
            movement_id: rpcResult?.movement_id ?? null,
          },
        });
      } catch (auditErr) {
        console.warn('[InventoryMovementModal] audit log skipped', auditErr);
      }

      setSaving(false);
      onSaved();
      onClose();
    } catch (err) {
      console.error('[InventoryMovementModal] save failed', err);
      setError('تعذر تسجيل الحركة. حاول مرة أخرى.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-[hsl(var(--border))]">
          <h2 className="text-lg font-bold">تسجيل حركة مخزون</h2>
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
                لا توجد منتجات نشطة لتسجيل حركة عليها.
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
            <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1">
              المتاح حاليًا: {formatNumber(currentAvailable)}
            </p>
          </div>

          {/* Movement type */}
          <div>
            <label className="block text-sm font-semibold mb-1.5">نوع الحركة</label>
            <div className="grid grid-cols-2 gap-2">
              {TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setMovementType(opt.key)}
                  className={`text-xs font-semibold px-3 py-2 rounded-xl border transition-colors flex items-center justify-center gap-1 ${
                    movementType === opt.key
                      ? opt.tone === 'in'
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : opt.tone === 'out'
                          ? 'bg-red-600 text-white border-red-600'
                          : 'bg-[hsl(217,80%,30%)] text-white border-[hsl(217,80%,30%)]'
                      : 'bg-white text-[hsl(var(--foreground))] border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/40'
                  }`}
                >
                  {opt.tone === 'in' ? (
                    <ArrowUp size={12} />
                  ) : opt.tone === 'out' ? (
                    <ArrowDown size={12} />
                  ) : null}
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Quantity OR counted quantity */}
          {movementType === 'stock_count_adjustment' ? (
            <div>
              <label className="block text-sm font-semibold mb-1.5">الكمية الفعلية بعد الجرد</label>
              <input
                type="number"
                min={0}
                step={1}
                value={countedQty}
                onChange={(e) => setCountedQty(Number(e.target.value) || 0)}
                className="w-full border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30 font-mono"
              />
              <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1">
                سيتم حساب الفرق تلقائيًا من الكمية المتاحة حاليًا.
              </p>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-semibold mb-1.5">
                {movementType === 'correction' ? 'الفرق (موجب أو سالب)' : 'الكمية'}
              </label>
              <input
                type="number"
                step={1}
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value) || 0)}
                className="w-full border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30 font-mono"
              />
              {isOutbound(movementType) && (
                <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1">
                  أدخل قيمة موجبة. سيتم خصمها تلقائيًا من المتاح.
                </p>
              )}
            </div>
          )}

          {/* Preview */}
          <div
            className={`rounded-xl border p-3 flex items-center justify-between text-sm ${
              wouldBeNegative
                ? 'border-red-200 bg-red-50 text-red-700'
                : 'border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 text-[hsl(var(--foreground))]'
            }`}
          >
            <span>
              المتاح الآن: <strong className="font-mono">{formatNumber(currentAvailable)}</strong>
            </span>
            <span>
              بعد الحركة:{' '}
              <strong className="font-mono">
                {formatNumber(previewAfter)}{' '}
                <span
                  className={`text-[10px] ${
                    signedDelta > 0
                      ? 'text-emerald-600'
                      : signedDelta < 0
                        ? 'text-red-600'
                        : 'text-[hsl(var(--muted-foreground))]'
                  }`}
                >
                  ({signedDelta >= 0 ? '+' : ''}
                  {signedDelta})
                </span>
              </strong>
            </span>
          </div>

          {/* Reason */}
          <div>
            <label className="block text-sm font-semibold mb-1.5">
              السبب
              {reasonRequired(movementType) && <span className="text-red-600 mr-1">*</span>}
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
              placeholder={reasonRequired(movementType) ? 'مطلوب' : 'اختياري'}
            />
          </div>

          {/* Reference fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold mb-1.5">رقم الطلب / المرجع</label>
              <input
                type="text"
                value={orderNum}
                onChange={(e) => setOrderNum(e.target.value)}
                className="w-full border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30 font-mono"
                placeholder="اختياري"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1.5">رقم فاتورة المورد</label>
              <input
                type="text"
                value={invoiceNum}
                onChange={(e) => setInvoiceNum(e.target.value)}
                className="w-full border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30 font-mono"
                placeholder="اختياري"
              />
            </div>
          </div>

          {/* Unit cost — only meaningful for inbound flows */}
          {(movementType === 'manual_in' || movementType === 'return_in') && (
            <div>
              <label className="block text-sm font-semibold mb-1.5">تكلفة الوحدة (اختياري)</label>
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
              />
            </div>
          )}

          {/* Note */}
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
            disabled={
              saving ||
              !selectedItem ||
              isArchived ||
              signedDelta === 0 ||
              wouldBeNegative ||
              (reasonRequired(movementType) && !reason.trim())
            }
            className="flex-1 flex items-center justify-center gap-2 bg-[hsl(217,80%,30%)] hover:bg-[hsl(217,80%,25%)] text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save size={16} />
            {saving ? 'جاري الحفظ...' : 'حفظ الحركة'}
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
