// ─────────────────────────────────────────────────────────────────────────────
// src/app/inventory/components/InventoryKpiCards.tsx
//
// Phase Inventory-UI-Redesign-1 — six KPI cards built from real values
// computed in `computeStats`. No mocks, no fake trends.
// ─────────────────────────────────────────────────────────────────────────────
'use client';

import React from 'react';
import { AlertTriangle, Banknote, Package, TrendingDown, Warehouse, XCircle } from 'lucide-react';

import {
  formatCompactMoney,
  formatNumber,
  type InventoryStats,
} from '@/lib/inventory/inventoryStats';

interface Props {
  stats: InventoryStats;
}

interface Card {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone: 'blue' | 'green' | 'orange' | 'navy' | 'amber' | 'red';
}

export default function InventoryKpiCards({ stats }: Props) {
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

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3" dir="rtl">
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
};
