// ─────────────────────────────────────────────────────────────────────────────
// src/app/inventory/components/InventoryKpiCards.tsx
//
// Phase Inventory-UI-Redesign-1 — six KPI cards built from real values
// computed in `computeStats`. No mocks, no fake trends.
//
// Phase Inventory-Additions-Log-1 — adds an optional seventh card
// "إضافات الشهر" driven by the additions ledger. Pass `null` to hide
// the card (e.g. when the additions table is missing pre-migration);
// pass a number to show it.
// ─────────────────────────────────────────────────────────────────────────────
'use client';

import React from 'react';
import {
  AlertTriangle,
  Banknote,
  Package,
  PackagePlus,
  TrendingDown,
  Warehouse,
  XCircle,
} from 'lucide-react';

import {
  formatCompactMoney,
  formatNumber,
  type InventoryStats,
} from '@/lib/inventory/inventoryStats';

interface Props {
  stats: InventoryStats;
  /** Units added across the additions ledger for the current month.
   *  `null` hides the card (e.g. before the migration applies). */
  additionsThisMonth?: number | null;
}

interface Card {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone: 'blue' | 'green' | 'orange' | 'navy' | 'amber' | 'red' | 'emerald';
}

export default function InventoryKpiCards({ stats, additionsThisMonth }: Props) {
  const cards: Card[] = [
    {
      label: 'إجمالي المنتجات',
      value: formatNumber(stats.totalProducts),
      icon: <Package size={20} />,
      tone: 'blue',
    },
    {
      label: 'القطع المتاحة',
      value: formatNumber(stats.totalAvailable),
      icon: <Warehouse size={20} />,
      tone: 'green',
    },
    {
      label: 'المسحوب',
      value: formatNumber(stats.totalWithdrawn),
      icon: <TrendingDown size={20} />,
      tone: 'orange',
    },
    {
      label: 'قيمة المخزون',
      value: formatCompactMoney(stats.inventoryValue),
      icon: <Banknote size={20} />,
      tone: 'navy',
    },
    {
      label: 'منخفض المخزون',
      value: formatNumber(stats.lowStockCount),
      icon: <AlertTriangle size={20} />,
      tone: 'amber',
    },
    {
      label: 'نفد المخزون',
      value: formatNumber(stats.outOfStockCount),
      icon: <XCircle size={20} />,
      tone: 'red',
    },
  ];

  if (typeof additionsThisMonth === 'number') {
    cards.push({
      label: 'إضافات الشهر',
      value: `+${formatNumber(additionsThisMonth)}`,
      icon: <PackagePlus size={20} />,
      tone: 'emerald',
    });
  }

  // Switch the xl grid to 7 columns when the additions card is included.
  const xlCols = cards.length >= 7 ? 'xl:grid-cols-7' : 'xl:grid-cols-6';

  return (
    <div className={`grid grid-cols-2 md:grid-cols-3 ${xlCols} gap-3`} dir="rtl">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 flex flex-col gap-2"
        >
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center ${TONE_BG[card.tone]}`}
          >
            {card.icon}
          </div>
          <p className="text-[11px] text-[hsl(var(--muted-foreground))] font-semibold">
            {card.label}
          </p>
          <p className="text-lg font-bold text-[hsl(var(--foreground))] font-mono">{card.value}</p>
        </div>
      ))}
    </div>
  );
}

const TONE_BG: Record<Card['tone'], string> = {
  blue: 'bg-blue-50 text-blue-600',
  green: 'bg-emerald-50 text-emerald-600',
  orange: 'bg-orange-50 text-orange-600',
  navy: 'bg-[hsl(217,80%,95%)] text-[hsl(217,80%,30%)]',
  amber: 'bg-amber-50 text-amber-700',
  red: 'bg-red-50 text-red-600',
  emerald: 'bg-emerald-100 text-emerald-700',
};
