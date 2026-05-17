// ─────────────────────────────────────────────────────────────────────────────
// src/app/inventory/components/InventoryCardGrid.tsx
//
// Phase Inventory-UI-Redesign-1 — visual card grid.
// Phase Inventory-Categories-Safer-Archive-1 — "حذف" becomes "أرشفة"
// (parent owns the soft-delete UPDATE), and each card now shows a
// lifecycle pill (نشط / موقوف / مؤرشف) next to the stock pill.
// Archived cards render dimmed so they're visually distinct when the
// "مؤرشف" filter is active.
// ─────────────────────────────────────────────────────────────────────────────
'use client';

import React from 'react';
import {
  Activity,
  AlertTriangle,
  Archive,
  CheckCircle,
  Edit2,
  Eye,
  Pause,
  Plus,
  XCircle,
} from 'lucide-react';

import { InventoryThumbnail, inventoryThumbnailUrl } from '@/lib/inventory/InventoryThumbnail';
import type { ProductDisplayQuantities } from '@/lib/inventory/displayQuantities';
import {
  formatMoney,
  formatNumber,
  productLifecycle,
  productStatus,
  type InventoryItem,
  type LifecycleStatus,
} from '@/lib/inventory/inventoryStats';

interface Props {
  items: InventoryItem[];
  // Phase Inventory-Display-Unify-1 — per-product display map keyed by
  // inventory id. Aggregates variants when present, otherwise base
  // fields; withdrawn comes from the `order_out` movement ledger.
  displayByInventoryId: Record<string, ProductDisplayQuantities>;
  canAddStock: boolean;
  onView: (item: InventoryItem) => void;
  onEdit: (item: InventoryItem) => void;
  onArchive: (item: InventoryItem) => void;
  onAddStock: (item: InventoryItem) => void;
  onRecordMovement: (item: InventoryItem) => void;
}

export default function InventoryCardGrid({
  items,
  displayByInventoryId,
  canAddStock,
  onView,
  onEdit,
  onArchive,
  onAddStock,
  onRecordMovement,
}: Props) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4" dir="rtl">
      {items.map((item) => {
        const display = displayByInventoryId[item.id];
        const available = display?.available ?? item.available ?? 0;
        const reserved = display?.reserved ?? item.reserved ?? 0;
        const sellable = display?.sellable ?? Math.max(0, available - reserved);
        const withdrawn = display?.withdrawn ?? 0;
        const status = productStatus(item);
        const lifecycle = productLifecycle(item);
        const isArchived = lifecycle === 'archived';
        const totalEverHandled = available + withdrawn;
        const progressPct =
          totalEverHandled > 0
            ? Math.max(0, Math.min(100, Math.round((available / totalEverHandled) * 100)))
            : available > 0
              ? 100
              : 0;

        return (
          <div
            key={item.id}
            className={`rounded-2xl border border-[hsl(var(--border))] bg-white p-4 flex flex-col gap-3 hover:shadow-md transition-shadow ${
              isArchived ? 'opacity-70' : ''
            }`}
          >
            {/* Thumbnail */}
            <button
              type="button"
              onClick={() => onView(item)}
              className="relative w-full h-40 rounded-xl overflow-hidden border border-[hsl(var(--border))] bg-[hsl(var(--muted))] group"
              aria-label={`عرض ${item.name}`}
            >
              <InventoryThumbnail
                src={inventoryThumbnailUrl(item.id)}
                alt={item.name}
                emoji="📦"
                fill
                sizes="(max-width: 768px) 100vw, 280px"
                className="object-cover group-hover:scale-105 transition-transform duration-300"
                emojiClassName="text-5xl"
              />
              <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
                <LifecycleBadge lifecycle={lifecycle} />
                <StatusBadge status={status} />
              </div>
            </button>

            {/* Name + SKU */}
            <div>
              <h3
                className="text-sm font-bold text-[hsl(var(--foreground))] truncate"
                title={item.name}
              >
                {item.name}
              </h3>
              <p className="text-[11px] text-[hsl(var(--muted-foreground))] font-mono truncate">
                {item.sku}
              </p>
            </div>

            {/* Category + colors */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="px-2 py-0.5 bg-[hsl(var(--muted))] rounded-lg text-[10px] font-medium">
                {item.category || '—'}
              </span>
              {(item.colors ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1 justify-end">
                  {(item.colors ?? []).slice(0, 3).map((c) => (
                    <span
                      key={c}
                      className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded-md font-medium"
                    >
                      {c}
                    </span>
                  ))}
                  {(item.colors ?? []).length > 3 && (
                    <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
                      +{(item.colors ?? []).length - 3}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Price + qty */}
            <div className="flex items-center justify-between gap-2">
              <div className="text-right">
                <p className="text-[10px] text-[hsl(var(--muted-foreground))]">السعر</p>
                <p className="text-sm font-bold text-[hsl(var(--foreground))]">
                  {formatMoney(item.price || 0)}
                </p>
              </div>
              <div className="text-left">
                <p className="text-[10px] text-[hsl(var(--muted-foreground))]">المتاح</p>
                <p
                  className={`text-sm font-bold font-mono ${
                    status === 'out'
                      ? 'text-red-600'
                      : status === 'low'
                        ? 'text-amber-600'
                        : 'text-emerald-700'
                  }`}
                >
                  {formatNumber(available)}
                </p>
              </div>
            </div>

            {/* Progress bar */}
            <div>
              <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                <div
                  className={`h-1.5 rounded-full ${
                    status === 'out'
                      ? 'bg-red-500'
                      : status === 'low'
                        ? 'bg-amber-500'
                        : 'bg-emerald-500'
                  }`}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="flex items-center justify-between mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">
                <span>الحد الأدنى: {formatNumber(item.minStock || 0)}</span>
                <span>المسحوب: {formatNumber(withdrawn)}</span>
              </div>
              {/* Phase Inventory-Reservations-1 — show محجوز / للبيع
                  only on rows that actually have a non-zero reserved
                  count. Hides cleanly pre-migration.
                  Phase Inventory-Display-Unify-1 — reads aggregated
                  reserved/sellable from displayByInventoryId so colour
                  reservations are visible product-level too. */}
              {reserved > 0 && (
                <div className="flex items-center justify-between mt-0.5 text-[10px]">
                  <span className="text-purple-700 font-semibold">
                    محجوز: {formatNumber(reserved)}
                  </span>
                  <span className="text-[hsl(var(--primary))] font-semibold">
                    للبيع: {formatNumber(sellable)}
                  </span>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between gap-1 pt-1 border-t border-[hsl(var(--border))] flex-wrap">
              <button
                type="button"
                onClick={() => onView(item)}
                className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/10"
              >
                <Eye size={13} /> عرض
              </button>
              <button
                type="button"
                onClick={() => onEdit(item)}
                className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-semibold text-blue-600 hover:bg-blue-50"
              >
                <Edit2 size={13} /> تعديل
              </button>
              {canAddStock && (
                <button
                  type="button"
                  onClick={() => onAddStock(item)}
                  disabled={isArchived}
                  className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  title={isArchived ? 'مؤرشف — لا يمكن إضافة كمية' : 'إضافة كمية'}
                >
                  <Plus size={13} /> كمية
                </button>
              )}
              {canAddStock && (
                <button
                  type="button"
                  onClick={() => onRecordMovement(item)}
                  disabled={isArchived}
                  className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-semibold text-[hsl(217,80%,30%)] hover:bg-[hsl(217,80%,30%)]/10 disabled:opacity-40 disabled:cursor-not-allowed"
                  title={isArchived ? 'مؤرشف — لا يمكن تسجيل حركة' : 'تسجيل حركة'}
                >
                  <Activity size={13} /> حركة
                </button>
              )}
              <button
                type="button"
                onClick={() => onArchive(item)}
                disabled={isArchived}
                className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-40 disabled:cursor-not-allowed"
                title={isArchived ? 'مؤرشف بالفعل' : 'أرشفة المنتج'}
              >
                <Archive size={13} /> {isArchived ? 'مؤرشف' : 'أرشفة'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StatusBadge({
  status,
  className,
}: {
  status: ReturnType<typeof productStatus>;
  className?: string;
}) {
  if (status === 'out') {
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-50 text-red-700 border border-red-200 ${className ?? ''}`}
      >
        <XCircle size={10} /> نفد
      </span>
    );
  }
  if (status === 'low') {
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 ${className ?? ''}`}
      >
        <AlertTriangle size={10} /> منخفض
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 ${className ?? ''}`}
    >
      <CheckCircle size={10} /> متاح
    </span>
  );
}

function LifecycleBadge({
  lifecycle,
  className,
}: {
  lifecycle: LifecycleStatus;
  className?: string;
}) {
  if (lifecycle === 'archived') {
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-700 border border-gray-300 ${className ?? ''}`}
      >
        <Archive size={10} /> مؤرشف
      </span>
    );
  }
  if (lifecycle === 'inactive') {
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-orange-50 text-orange-700 border border-orange-200 ${className ?? ''}`}
      >
        <Pause size={10} /> موقوف
      </span>
    );
  }
  return null; // active = no chrome needed (stock badge says it all)
}
