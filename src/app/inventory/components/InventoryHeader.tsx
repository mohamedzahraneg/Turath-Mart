// ─────────────────────────────────────────────────────────────────────────────
// src/app/inventory/components/InventoryHeader.tsx
//
// Phase Inventory-UI-Redesign-1 — page title + breadcrumb + action buttons.
// Mirrors the OrdersHeader pattern (RTL, real breadcrumb link, real action
// pills). No buttons are rendered for unwired actions — CSV export is the
// only optional one, controlled by `canExport`.
// ─────────────────────────────────────────────────────────────────────────────
'use client';

import React from 'react';
import Link from 'next/link';
import {
  Activity,
  ChevronLeft,
  ClipboardList,
  Download,
  Plus,
  RefreshCw,
  Warehouse,
} from 'lucide-react';

interface Props {
  onAdd: () => void;
  onRefresh: () => void;
  onExport: (() => void) | null;
  onRecordMovement: (() => void) | null;
  // Phase Inventory-Stock-Count-1 — opens StockCountModal in global
  // mode. Null when the viewer lacks manager-or-above perms.
  onRecordStockCount: (() => void) | null;
  refreshing?: boolean;
}

export default function InventoryHeader({
  onAdd,
  onRefresh,
  onExport,
  onRecordMovement,
  onRecordStockCount,
  refreshing,
}: Props) {
  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between" dir="rtl">
      <div className="text-right order-1 xl:order-2 flex items-start justify-end">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-[hsl(var(--foreground))] flex items-center justify-end gap-2">
            إدارة المخزن
            <Warehouse size={22} className="text-[hsl(var(--primary))]" />
          </h1>
          <div className="flex items-center justify-end gap-1 text-[11px] text-[hsl(var(--muted-foreground))] mt-1">
            <span className="text-[hsl(var(--foreground))] font-semibold">المخزن</span>
            <ChevronLeft size={12} />
            <Link
              href="/dashboard"
              className="hover:underline hover:text-[hsl(var(--primary))] transition-colors"
            >
              الرئيسية
            </Link>
          </div>
        </div>
      </div>

      <div className="order-2 xl:order-1 flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={onAdd}
          className="text-sm font-bold text-white bg-[hsl(217,80%,30%)] hover:bg-[hsl(217,80%,25%)] rounded-xl px-4 py-2 flex items-center gap-1.5 shadow-sm"
        >
          <Plus size={16} />
          <span>إضافة منتج</span>
        </button>
        {onRecordMovement && (
          <button
            type="button"
            onClick={onRecordMovement}
            className="text-sm rounded-xl border border-[hsl(217,80%,30%)] text-[hsl(217,80%,30%)] bg-white px-3 py-1.5 flex items-center gap-1.5 hover:bg-[hsl(217,80%,30%)]/10 font-semibold"
          >
            <Activity size={14} />
            <span>تسجيل حركة</span>
          </button>
        )}
        {onRecordStockCount && (
          <button
            type="button"
            onClick={onRecordStockCount}
            className="text-sm rounded-xl border border-[hsl(217,80%,30%)] text-[hsl(217,80%,30%)] bg-white px-3 py-1.5 flex items-center gap-1.5 hover:bg-[hsl(217,80%,30%)]/10 font-semibold"
          >
            <ClipboardList size={14} />
            <span>تسجيل جرد</span>
          </button>
        )}
        {onExport && (
          <button
            type="button"
            onClick={onExport}
            className="text-sm rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-1.5 flex items-center gap-1.5 hover:bg-[hsl(var(--muted))]/40"
          >
            <Download size={14} />
            <span>تصدير CSV</span>
          </button>
        )}
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="text-sm rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-1.5 flex items-center gap-1.5 hover:bg-[hsl(var(--muted))]/40 disabled:opacity-60 disabled:cursor-wait"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          <span>تحديث</span>
        </button>
      </div>
    </div>
  );
}
