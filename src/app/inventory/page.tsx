'use client';
import React, { useState } from 'react';
import AppLayout from '@/components/AppLayout';
import {
  Warehouse, AlertTriangle, CheckCircle, Plus, Search,
  Edit2, Trash2, TrendingDown, Package, X, Save
} from 'lucide-react';

interface InventoryItem {
  id: string;
  name: string;
  sku: string;
  available: number;
  withdrawn: number;
  minStock: number;
  price: number;
  category: string;
}

const initialInventory: InventoryItem[] = [
  { id: 'inv-1', name: 'حامل مصحف بني', sku: 'HMB-001', available: 45, withdrawn: 120, minStock: 20, price: 300, category: 'حوامل' },
  { id: 'inv-2', name: 'حامل مصحف أسود', sku: 'HMA-002', available: 8, withdrawn: 92, minStock: 20, price: 300, category: 'حوامل' },
  { id: 'inv-3', name: 'حامل مصحف أبيض', sku: 'HMW-003', available: 32, withdrawn: 68, minStock: 20, price: 300, category: 'حوامل' },
  { id: 'inv-4', name: 'حامل مصحف ذهبي', sku: 'HMG-004', available: 5, withdrawn: 75, minStock: 20, price: 350, category: 'حوامل' },
  { id: 'inv-5', name: 'كشاف', sku: 'KSH-005', available: 67, withdrawn: 133, minStock: 30, price: 150, category: 'إكسسوارات' },
  { id: 'inv-6', name: 'كرسي', sku: 'KRS-006', available: 18, withdrawn: 42, minStock: 10, price: 500, category: 'أثاث' },
  { id: 'inv-7', name: 'مصحف', sku: 'MSH-007', available: 95, withdrawn: 205, minStock: 50, price: 200, category: 'كتب' },
  { id: 'inv-8', name: 'كعبة', sku: 'KAB-008', available: 3, withdrawn: 47, minStock: 10, price: 450, category: 'ديكور' },
];

const categories = ['الكل', 'حوامل', 'إكسسوارات', 'أثاث', 'كتب', 'ديكور'];

interface EditModalProps {
  item: InventoryItem | null;
  onClose: () => void;
  onSave: (item: InventoryItem) => void;
}

function EditModal({ item, onClose, onSave }: EditModalProps) {
  const [form, setForm] = useState<InventoryItem>(
    item || { id: `inv-${Date.now()}`, name: '', sku: '', available: 0, withdrawn: 0, minStock: 10, price: 0, category: 'حوامل' }
  );

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-[hsl(var(--border))]">
          <h2 className="text-lg font-bold">{item ? 'تعديل صنف' : 'إضافة صنف جديد'}</h2>
          <button onClick={onClose} className="p-2 hover:bg-[hsl(var(--muted))] rounded-xl transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-semibold mb-1.5">اسم الصنف</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
                placeholder="اسم المنتج"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1.5">كود الصنف (SKU)</label>
              <input
                type="text"
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
                className="w-full border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1.5">الفئة</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
              >
                {categories.filter(c => c !== 'الكل').map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1.5">الكمية المتاحة</label>
              <input
                type="number"
                value={form.available}
                onChange={(e) => setForm({ ...form, available: Number(e.target.value) })}
                className="w-full border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1.5">الحد الأدنى للتنبيه</label>
              <input
                type="number"
                value={form.minStock}
                onChange={(e) => setForm({ ...form, minStock: Number(e.target.value) })}
                className="w-full border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1.5">السعر (ج.م)</label>
              <input
                type="number"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: Number(e.target.value) })}
                className="w-full border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
              />
            </div>
          </div>
        </div>
        <div className="flex gap-3 p-5 border-t border-[hsl(var(--border))]">
          <button
            onClick={() => onSave(form)}
            className="flex-1 flex items-center justify-center gap-2 bg-[hsl(var(--primary))] text-white rounded-xl py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            <Save size={16} />
            حفظ
          </button>
          <button onClick={onClose} className="px-5 border border-[hsl(var(--border))] rounded-xl text-sm font-semibold hover:bg-[hsl(var(--muted))] transition-colors">
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}

export default function InventoryPage() {
  const [inventory, setInventory] = useState<InventoryItem[]>(initialInventory);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('الكل');
  const [editItem, setEditItem] = useState<InventoryItem | null | undefined>(undefined);

  const lowStockCount = inventory.filter(i => i.available <= i.minStock).length;

  const filtered = inventory.filter(item => {
    const matchSearch = item.name.includes(search) || item.sku.includes(search);
    const matchCat = activeCategory === 'الكل' || item.category === activeCategory;
    return matchSearch && matchCat;
  });

  const handleSave = (item: InventoryItem) => {
    setInventory(prev => {
      const exists = prev.find(i => i.id === item.id);
      if (exists) return prev.map(i => i.id === item.id ? item : i);
      return [...prev, item];
    });
    setEditItem(undefined);
  };

  const handleDelete = (id: string) => {
    setInventory(prev => prev.filter(i => i.id !== id));
  };

  return (
    <AppLayout currentPath="/inventory">
      <div className="space-y-6 fade-in">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">إدارة المخزون</h1>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
              {lowStockCount > 0 ? (
                <span className="text-red-600 font-semibold flex items-center gap-1">
                  <AlertTriangle size={13} /> {lowStockCount} أصناف تحتاج تجديد
                </span>
              ) : (
                <span className="text-green-600 flex items-center gap-1"><CheckCircle size={13} /> المخزون كافٍ</span>
              )}
            </p>
          </div>
          <button
            onClick={() => setEditItem(null)}
            className="flex items-center gap-2 px-4 py-2.5 bg-[hsl(var(--primary))] text-white rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            <Plus size={18} />
            إضافة صنف
          </button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {[
            { label: 'إجمالي الأصناف', value: inventory.length, icon: <Package size={20} />, color: 'blue' },
            { label: 'إجمالي المتاح', value: inventory.reduce((s, i) => s + i.available, 0), icon: <Warehouse size={20} />, color: 'green' },
            { label: 'إجمالي المسحوب', value: inventory.reduce((s, i) => s + i.withdrawn, 0), icon: <TrendingDown size={20} />, color: 'orange' },
            { label: 'تحتاج تجديد', value: lowStockCount, icon: <AlertTriangle size={20} />, color: 'red' },
          ].map((card, i) => (
            <div key={i} className="kpi-card">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${
                card.color === 'blue' ? 'bg-blue-50 text-blue-600' :
                card.color === 'green' ? 'bg-green-50 text-green-600' :
                card.color === 'orange'? 'bg-orange-50 text-orange-600' : 'bg-red-50 text-red-600'
              }`}>
                {card.icon}
              </div>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mb-1">{card.label}</p>
              <p className="text-2xl font-bold text-[hsl(var(--foreground))] font-mono">{card.value}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="card-section p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
              <input
                type="text"
                placeholder="بحث بالاسم أو الكود..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pr-9 pl-4 py-2.5 border border-[hsl(var(--border))] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
              />
            </div>
            <div className="flex bg-[hsl(var(--muted))] rounded-xl p-1 gap-1 flex-wrap">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-all ${activeCategory === cat ? 'bg-white text-[hsl(var(--primary))] shadow-sm' : 'text-[hsl(var(--muted-foreground))]'}`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="card-section overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/50">
                  <th className="text-right px-4 py-3 font-semibold text-[hsl(var(--muted-foreground))]">الصنف</th>
                  <th className="text-right px-4 py-3 font-semibold text-[hsl(var(--muted-foreground))]">الكود</th>
                  <th className="text-right px-4 py-3 font-semibold text-[hsl(var(--muted-foreground))]">الفئة</th>
                  <th className="text-right px-4 py-3 font-semibold text-[hsl(var(--muted-foreground))]">المتاح</th>
                  <th className="text-right px-4 py-3 font-semibold text-[hsl(var(--muted-foreground))]">المسحوب</th>
                  <th className="text-right px-4 py-3 font-semibold text-[hsl(var(--muted-foreground))]">السعر</th>
                  <th className="text-right px-4 py-3 font-semibold text-[hsl(var(--muted-foreground))]">الحالة</th>
                  <th className="text-right px-4 py-3 font-semibold text-[hsl(var(--muted-foreground))]">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[hsl(var(--border))]">
                {filtered.map((item) => {
                  const isLow = item.available <= item.minStock;
                  const pct = Math.round((item.available / (item.available + item.withdrawn)) * 100);
                  return (
                    <tr key={item.id} className={`hover:bg-[hsl(var(--muted))]/30 transition-colors ${isLow ? 'bg-red-50/30' : ''}`}>
                      <td className="px-4 py-3 font-semibold">{item.name}</td>
                      <td className="px-4 py-3 text-[hsl(var(--muted-foreground))] font-mono text-xs">{item.sku}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-1 bg-[hsl(var(--muted))] rounded-lg text-xs font-medium">{item.category}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`font-bold ${isLow ? 'text-red-600' : 'text-green-600'}`}>{item.available}</span>
                          <div className="w-16 bg-gray-200 rounded-full h-1.5 hidden sm:block">
                            <div className={`h-1.5 rounded-full ${isLow ? 'bg-red-500' : 'bg-green-500'}`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[hsl(var(--muted-foreground))]">{item.withdrawn}</td>
                      <td className="px-4 py-3 font-semibold">{item.price} ج.م</td>
                      <td className="px-4 py-3">
                        {isLow ? (
                          <span className="flex items-center gap-1 text-xs font-semibold text-red-600 bg-red-50 px-2 py-1 rounded-lg">
                            <AlertTriangle size={11} /> مخزون منخفض
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs font-semibold text-green-600 bg-green-50 px-2 py-1 rounded-lg">
                            <CheckCircle size={11} /> كافٍ
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setEditItem(item)}
                            className="p-1.5 hover:bg-blue-50 text-blue-600 rounded-lg transition-colors"
                            title="تعديل"
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            onClick={() => handleDelete(item.id)}
                            className="p-1.5 hover:bg-red-50 text-red-500 rounded-lg transition-colors"
                            title="حذف"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="text-center py-12 text-[hsl(var(--muted-foreground))]">
                <Package size={40} className="mx-auto mb-3 opacity-30" />
                <p>لا توجد أصناف مطابقة</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {editItem !== undefined && (
        <EditModal item={editItem} onClose={() => setEditItem(undefined)} onSave={handleSave} />
      )}
    </AppLayout>
  );
}
