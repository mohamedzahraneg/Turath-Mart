// ─────────────────────────────────────────────────────────────────────────────
// src/app/inventory/components/InventoryTable.tsx
//
// Phase Inventory-UI-Redesign-1 — table view, evolved from the previous
// inventory page table. Adds two columns (تاريخ الإضافة, الحالة as a
// proper chip) and a "view" action that opens the new product drawer.
// ─────────────────────────────────────────────────────────────────────────────
'use client';

import React from 'react';
import { AlertTriangle, CheckCircle, Edit2, Eye, Trash2, XCircle } from 'lucide-react';

import { InventoryThumbnail, inventoryThumbnailUrl } from '@/lib/inventory/InventoryThumbnail';
import {
  formatDate,
  formatMoney,
  formatNumber,
  productStatus,
  type InventoryItem,
} from '@/lib/inventory/inventoryStats';

interface Props {
  items: InventoryItem[];
  withdrawnByName: Record<string, number>;
  onView: (item: InventoryItem) => void;
  onEdit: (item: InventoryItem) => void;
  onDelete: (item: InventoryItem) => void;
}

const HEADERS = [
  'الصورة',
  'اسم المنتج',
  'SKU',
  'الفئة',
  'الألوان',
  'السعر',
  'المتاح',
  'المسحوب',
  'الحد الأدنى',
  'الحالة',
  'تاريخ الإضافة',
  'الإجراءات',
];

export default function InventoryTable({
  items,
  withdrawnByName,
  onView,
  onEdit,
  onDelete,
}: Props) {
  return (
    <div
      className="rounded-2xl border border-[hsl(var(--border))] bg-white overflow-hidden"
      dir="rtl"
    >
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[hsl(var(--muted))]/40 border-b border-[hsl(var(--border))]">
              {HEADERS.map((h) => (
                <th
                  key={h}
                  className="text-right px-4 py-3 font-semibold text-[hsl(var(--muted-foreground))] text-xs whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[hsl(var(--border))]">
            {items.map((item) => {
              const withdrawn = withdrawnByName[item.name.trim()] || 0;
              const status = productStatus(item);
              return (
                <tr
                  key={item.id}
                  className={`hover:bg-[hsl(var(--muted))]/30 transition-colors ${
                    status === 'out' ? 'bg-red-50/30' : status === 'low' ? 'bg-amber-50/30' : ''
                  }`}
                >
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => onView(item)}
                      className="relative w-10 h-10 rounded-lg overflow-hidden border border-[hsl(var(--border))] bg-[hsl(var(--muted))] block"
                      aria-label={`عرض ${item.name}`}
                    >
                      <InventoryThumbnail
                        src={inventoryThumbnailUrl(item.id)}
                        alt={item.name}
                        emoji="📦"
                        fill
                        sizes="40px"
                        className="object-cover"
                        emojiClassName="text-xl"
                      />
                    </button>
                  </td>
                  <td className="px-4 py-3 font-semibold whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => onView(item)}
                      className="hover:underline hover:text-[hsl(var(--primary))]"
                    >
                      {item.name}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-[hsl(var(--muted-foreground))] font-mono text-xs whitespace-nowrap">
                    {item.sku}
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-[hsl(var(--muted))] rounded-lg text-[11px] font-medium whitespace-nowrap">
                      {item.category || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {(item.colors ?? []).length > 0 ? (
                      <div className="flex flex-wrap gap-1">
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
                    ) : (
                      <span className="text-[10px] text-[hsl(var(--muted-foreground))]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-semibold whitespace-nowrap">
                    {formatMoney(item.price || 0)}
                  </td>
                  <td className="px-4 py-3 font-mono font-bold whitespace-nowrap">
                    <span
                      className={
                        status === 'out'
                          ? 'text-red-600'
                          : status === 'low'
                            ? 'text-amber-600'
                            : 'text-emerald-700'
                      }
                    >
                      {formatNumber(item.available || 0)}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                    {formatNumber(withdrawn)}
                  </td>
                  <td className="px-4 py-3 font-mono text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                    {formatNumber(item.minStock || 0)}
                  </td>
                  <td className="px-4 py-3">
                    {status === 'out' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-50 text-red-700 border border-red-200">
                        <XCircle size={10} /> نفد
                      </span>
                    ) : status === 'low' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                        <AlertTriangle size={10} /> منخفض
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <CheckCircle size={10} /> متاح
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                    {formatDate(item.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onView(item)}
                        className="p-1.5 hover:bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] rounded-lg"
                        title="عرض"
                      >
                        <Eye size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onEdit(item)}
                        className="p-1.5 hover:bg-blue-50 text-blue-600 rounded-lg"
                        title="تعديل"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(item)}
                        className="p-1.5 hover:bg-red-50 text-red-600 rounded-lg"
                        title="حذف"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
