'use client';
import React, { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle, Package, RefreshCw, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

interface InventoryItem {
  id: string;
  name: string;
  available: number;
  withdrawn: number;
  min_stock: number;
  price: number;
  total: number;
}

export default function InventoryStatus() {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [dbError, setDbError] = useState(false);

  const fetchInventory = async () => {
    setIsRefreshing(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('turath_masr_inventory')
        .select('*')
        .order('available', { ascending: true });

      if (error) throw error;

      if (data) {
        setInventory(
          data.map((item) => ({
            ...item,
            total: (item.available || 0) + (item.withdrawn || 0),
          }))
        );
        setDbError(false);
      }
    } catch (err: any) {
      console.error('Error fetching inventory:', err);
      if (err.message?.includes('relation') || err.code === '42P01') {
        setDbError(true);
      }
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchInventory();
    const interval = setInterval(fetchInventory, 600000); // refresh every 10 mins
    return () => clearInterval(interval);
  }, []);

  const alerts = inventory.filter((i) => i.available <= i.min_stock);
  const totalValue = inventory.reduce((s, i) => s + i.available * (i.price || 0), 0);

  return (
    <div className="card-section overflow-hidden h-full flex flex-col">
      <div className="p-6 border-b border-[hsl(var(--border))] bg-gradient-to-br from-white to-[hsl(var(--muted))]/30">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-bold text-[hsl(var(--foreground))]">
              المخزون الاستراتيجي
            </h3>
            <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-0.5 tracking-wider font-bold">
              إجمالي القيمة:{' '}
              <span className="text-[hsl(var(--primary))] font-mono">
                {totalValue.toLocaleString('en-US')} ج.م
              </span>
            </p>
          </div>
          <button
            onClick={fetchInventory}
            disabled={isRefreshing}
            className={`p-2.5 hover:bg-white rounded-xl transition-all shadow-sm border border-transparent hover:border-[hsl(var(--border))] ${isRefreshing ? 'opacity-50' : ''}`}
          >
            <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
          </button>
        </div>

        {alerts.length > 0 && (
          <div className="bg-red-50 border border-red-100 rounded-xl p-3 flex items-center gap-3 animate-pulse">
            <AlertTriangle size={16} className="text-red-500" />
            <span className="text-xs text-red-700 font-bold">
              هناك {alerts.length} منتجات تحت حد الأمان!
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 p-4 space-y-4 overflow-y-auto max-h-[500px] scrollbar-thin">
        {dbError ? (
          <div className="py-12 px-6 text-center space-y-4 bg-amber-50 rounded-2xl border border-amber-100">
            <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
            <p className="text-xs text-amber-800 font-bold leading-relaxed">
              جداول المخزون غير موجودة. يرجى تهيئة المستودع من ملفات SQL.
            </p>
          </div>
        ) : loading ? (
          <div className="py-24 text-center space-y-4">
            <Loader2 className="w-10 h-10 text-[hsl(var(--primary))] animate-spin mx-auto" />
            <p className="text-xs text-[hsl(var(--muted-foreground))] font-bold uppercase tracking-widest">
              تحديث بيانات المخزون الحية...
            </p>
          </div>
        ) : inventory.length === 0 ? (
          <div className="py-24 text-center text-[hsl(var(--muted-foreground))] text-sm italic">
            لم يتم العثور على بيانات في المستودع
          </div>
        ) : (
          inventory.map((item) => {
            const isLow = item.available <= item.min_stock;
            const pct = item.total > 0 ? Math.round((item.available / item.total) * 100) : 0;
            return (
              <div
                key={item.id}
                className={`p-4 rounded-2xl border transition-all duration-300 group ${isLow ? 'border-red-200 bg-red-50/20 shadow-sm' : 'border-[hsl(var(--border))] hover:border-[hsl(var(--primary))]/30 hover:shadow-md'}`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center ${isLow ? 'bg-red-100 text-red-600' : 'bg-green-50 text-green-600'}`}
                    >
                      <Package size={16} />
                    </div>
                    <div>
                      <span className="text-sm font-bold text-[hsl(var(--foreground))] line-clamp-1">
                        {item.name}
                      </span>
                      <p className="text-[10px] text-[hsl(var(--muted-foreground))] font-mono uppercase">
                        {item.available} / {item.total} متوفر
                      </p>
                    </div>
                  </div>
                  {isLow && (
                    <span className="text-[9px] font-bold px-2 py-1 rounded-lg bg-red-100 text-red-700 border border-red-200">
                      نقص مخزون
                    </span>
                  )}
                </div>

                <div className="w-full bg-[hsl(var(--muted))] rounded-full h-2 overflow-hidden mb-3">
                  <div
                    className={`h-full rounded-full transition-all duration-1000 ${isLow ? 'bg-red-500' : pct > 40 ? 'bg-green-500' : 'bg-amber-500'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>

                <div className="flex justify-between items-center text-[10px] font-bold text-[hsl(var(--muted-foreground))]">
                  <div className="flex items-center gap-2">
                    <span className="bg-gray-100 px-1.5 py-0.5 rounded">
                      الحد: {item.min_stock}
                    </span>
                    <span className="bg-gray-100 px-1.5 py-0.5 rounded">
                      السعر: {item.price} ج.م
                    </span>
                  </div>
                  <span className={isLow ? 'text-red-600 font-black' : 'text-green-600'}>
                    {pct}%
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
