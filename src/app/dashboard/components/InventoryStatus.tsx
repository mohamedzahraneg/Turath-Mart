'use client';
import React from 'react';
import { AlertTriangle, CheckCircle, Package } from 'lucide-react';

interface InventoryItem {
  id: string;
  name: string;
  available: number;
  withdrawn: number;
  total: number;
  alert: boolean;
}

const inventory: InventoryItem[] = [
  { id: 'inv-holder-brown', name: 'حامل مصحف بني', available: 45, withdrawn: 120, total: 165, alert: false },
  { id: 'inv-holder-black', name: 'حامل مصحف أسود', available: 8, withdrawn: 92, total: 100, alert: true },
  { id: 'inv-holder-white', name: 'حامل مصحف أبيض', available: 32, withdrawn: 68, total: 100, alert: false },
  { id: 'inv-holder-gold', name: 'حامل مصحف ذهبي', available: 5, withdrawn: 75, total: 80, alert: true },
  { id: 'inv-flashlight', name: 'كشاف', available: 67, withdrawn: 133, total: 200, alert: false },
  { id: 'inv-chair', name: 'كرسي', available: 18, withdrawn: 42, total: 60, alert: false },
  { id: 'inv-quran', name: 'مصحف', available: 95, withdrawn: 205, total: 300, alert: false },
  { id: 'inv-kaaba', name: 'كعبة', available: 3, withdrawn: 47, total: 50, alert: true },
];

export default function InventoryStatus() {
  const alertCount = inventory.filter((i) => i.alert).length;

  return (
    <div className="card-section overflow-hidden h-full">
      <div className="flex items-center justify-between p-5 border-b border-[hsl(var(--border))]">
        <div>
          <h3 className="text-base font-bold text-[hsl(var(--foreground))]">حالة المخزون</h3>
          <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
            {alertCount > 0 ? (
              <span className="text-red-600 font-semibold flex items-center gap-1">
                <AlertTriangle size={11} />
                {alertCount} أصناف تحتاج تجديد
              </span>
            ) : (
              <span className="text-green-600 flex items-center gap-1">
                <CheckCircle size={11} />
                المخزون كافٍ
              </span>
            )}
          </p>
        </div>
        <Package size={20} className="text-[hsl(var(--muted-foreground))]" />
      </div>

      <div className="p-4 space-y-3 overflow-y-auto max-h-[480px] scrollbar-thin">
        {inventory.map((item) => {
          const pct = Math.round((item.available / item.total) * 100);
          return (
            <div key={item.id} className={`p-3 rounded-xl border ${item.alert ? 'border-red-200 bg-red-50/40' : 'border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30'}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {item.alert ? (
                    <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />
                  ) : (
                    <CheckCircle size={14} className="text-green-500 flex-shrink-0" />
                  )}
                  <span className="text-sm font-semibold text-[hsl(var(--foreground))]">{item.name}</span>
                </div>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${item.alert ? 'bg-red-100 text-red-700' : 'bg-green-50 text-green-700'}`}>
                  {item.available} متاح
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                <div
                  className={`h-1.5 rounded-full transition-all duration-500 ${item.alert ? 'bg-red-500' : pct > 60 ? 'bg-green-500' : 'bg-amber-500'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="flex justify-between mt-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">
                <span>مسحوب: {item.withdrawn}</span>
                <span>{pct}٪ متاح</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}