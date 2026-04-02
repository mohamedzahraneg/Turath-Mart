'use client';
import React, { useState, useRef, useEffect } from 'react';
import AppLayout from '@/components/AppLayout';
import {
  Warehouse,
  AlertTriangle,
  CheckCircle,
  Plus,
  Search,
  Edit2,
  Trash2,
  TrendingDown,
  Package,
  X,
  Save,
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';

import { createClient } from '@/lib/supabase/client';

interface InventoryItem {
  id: string;
  name: string;
  sku: string;
  available: number;
  withdrawn: number;
  minStock: number;
  price: number;
  category: string;
  images?: string[];
  colors?: string[];
}

// Ensure the db row format typing if needed (optional)

const categories = ['الكل', 'حوامل', 'إكسسوارات', 'أثاث', 'كتب', 'ديكور'];

// Auto-generate SKU from name
function generateSKU(name: string, existingItems: InventoryItem[]): string {
  if (!name.trim()) return '';
  // Take first 3 chars of each word, uppercase
  const words = name.trim().split(/\s+/);
  let prefix = words
    .map((w) => {
      // Convert Arabic to transliteration prefix
      const firstChar = w.charAt(0);
      return firstChar.toUpperCase();
    })
    .join('')
    .slice(0, 3)
    .toUpperCase();

  // If prefix is Arabic chars, use a numeric approach
  const isArabic = /[\u0600-\u06FF]/.test(prefix);
  if (isArabic) {
    // Use category-based prefix
    prefix = 'ITM';
  }

  // Find next sequence number
  const seq = existingItems.length + 1;
  const candidate = `${prefix}-${seq.toString().padStart(3, '0')}`;

  // Ensure uniqueness
  const existing = new Set(existingItems.map((i) => i.sku));
  if (!existing.has(candidate)) return candidate;

  // Try incrementing
  for (let i = seq + 1; i < seq + 100; i++) {
    const alt = `${prefix}-${i.toString().padStart(3, '0')}`;
    if (!existing.has(alt)) return alt;
  }
  return `${prefix}-${Date.now().toString().slice(-4)}`;
}

interface EditModalProps {
  item: InventoryItem | null;
  onClose: () => void;
  onSave: (item: InventoryItem) => void;
  allItems: InventoryItem[];
}

function EditModal({ item, onClose, onSave, allItems }: EditModalProps) {
  const isNew = !item;
  const [form, setForm] = useState<InventoryItem>(
    item
      ? { ...item, images: item.images || [], colors: item.colors || [] }
      : {
          id: `inv-${Date.now()}`,
          name: '',
          sku: '',
          available: 0,
          withdrawn: 0,
          minStock: 10,
          price: 0,
          category: 'حوامل',
          images: [],
          colors: [],
        }
  );
  const [skuManuallyEdited, setSkuManuallyEdited] = useState(!isNew);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [newColor, setNewColor] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-generate SKU when name changes (only for new items and not manually edited)
  useEffect(() => {
    if (isNew && !skuManuallyEdited && form.name) {
      const autoSku = generateSKU(
        form.name,
        allItems.filter((i) => i.id !== form.id)
      );
      setForm((prev) => ({ ...prev, sku: autoSku }));
    }
  }, [form.name, isNew, skuManuallyEdited, allItems, form.id]);

  const handleImagesUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const readers = files.map(
      (file) =>
        new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = (ev) => resolve(ev.target?.result as string);
          reader.readAsDataURL(file);
        })
    );
    Promise.all(readers).then((results) => {
      setForm((prev) => ({
        ...prev,
        images: [...(prev.images || []), ...results],
      }));
    });
    e.target.value = '';
  };

  const removeImage = (index: number) => {
    setForm((prev) => {
      const imgs = [...(prev.images || [])];
      imgs.splice(index, 1);
      if (previewIndex >= imgs.length) setPreviewIndex(Math.max(0, imgs.length - 1));
      return { ...prev, images: imgs };
    });
  };

  const addColor = () => {
    const trimmed = newColor.trim();
    if (trimmed && !(form.colors || []).includes(trimmed)) {
      setForm((prev) => ({ ...prev, colors: [...(prev.colors || []), trimmed] }));
      setNewColor('');
    }
  };

  const removeColor = (color: string) => {
    setForm((prev) => ({ ...prev, colors: (prev.colors || []).filter((c) => c !== color) }));
  };

  const images = form.images || [];

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-[hsl(var(--border))]">
          <h2 className="text-lg font-bold">{item ? 'تعديل صنف' : 'إضافة صنف جديد'}</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[hsl(var(--muted))] rounded-xl transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Multiple image upload */}
          <div>
            <label className="block text-sm font-semibold mb-2">صور المنتج</label>
            {/* Image preview carousel */}
            {images.length > 0 ? (
              <div className="relative mb-3">
                <div className="w-full h-44 rounded-xl overflow-hidden bg-gray-100 border border-[hsl(var(--border))]">
                  <img
                    src={images[previewIndex]}
                    alt={`صورة ${previewIndex + 1}`}
                    className="w-full h-full object-contain"
                  />
                </div>
                {/* Navigation arrows */}
                {images.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setPreviewIndex((i) => (i - 1 + images.length) % images.length)
                      }
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 bg-white/80 rounded-full flex items-center justify-center shadow hover:bg-white transition-colors"
                    >
                      <ChevronRight size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewIndex((i) => (i + 1) % images.length)}
                      className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 bg-white/80 rounded-full flex items-center justify-center shadow hover:bg-white transition-colors"
                    >
                      <ChevronLeft size={14} />
                    </button>
                  </>
                )}
                {/* Counter */}
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/50 text-white text-[10px] px-2 py-0.5 rounded-full font-mono">
                  {previewIndex + 1} / {images.length}
                </div>
              </div>
            ) : (
              <div className="w-full h-32 rounded-xl border-2 border-dashed border-[hsl(var(--border))] flex flex-col items-center justify-center gap-2 text-[hsl(var(--muted-foreground))] mb-3 bg-[hsl(var(--muted))]/20">
                <ImageIcon size={28} className="opacity-40" />
                <p className="text-xs">لا توجد صور — اضغط لإضافة صور</p>
              </div>
            )}

            {/* Thumbnails row */}
            {images.length > 0 && (
              <div className="flex gap-2 flex-wrap mb-3">
                {images.map((img, i) => (
                  <div key={`thumb-${i}`} className="relative group">
                    <button
                      type="button"
                      onClick={() => setPreviewIndex(i)}
                      className={`w-14 h-14 rounded-lg overflow-hidden border-2 transition-all ${previewIndex === i ? 'border-[hsl(var(--primary))]' : 'border-[hsl(var(--border))]'}`}
                    >
                      <img src={img} alt={`thumb-${i}`} className="w-full h-full object-cover" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeImage(i)}
                      className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Upload button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2 border border-[hsl(var(--border))] rounded-xl text-sm font-semibold hover:bg-[hsl(var(--muted))] transition-colors"
            >
              <ImageIcon size={15} className="text-[hsl(var(--primary))]" />
              {images.length === 0 ? 'إضافة صور' : 'إضافة المزيد من الصور'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleImagesUpload}
            />
            <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1">
              يمكنك اختيار أكثر من صورة في نفس الوقت
            </p>
          </div>

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
            <div className="col-span-2">
              <label className="block text-sm font-semibold mb-1.5">
                كود الصنف (SKU)
                {isNew && !skuManuallyEdited && (
                  <span className="mr-2 text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-normal">
                    تلقائي
                  </span>
                )}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={form.sku}
                  onChange={(e) => {
                    setSkuManuallyEdited(true);
                    setForm({ ...form, sku: e.target.value });
                  }}
                  className="flex-1 border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30 font-mono"
                  placeholder="مثال: HMB-001"
                />
                {isNew && skuManuallyEdited && (
                  <button
                    type="button"
                    onClick={() => {
                      setSkuManuallyEdited(false);
                      const autoSku = generateSKU(
                        form.name,
                        allItems.filter((i) => i.id !== form.id)
                      );
                      setForm((prev) => ({ ...prev, sku: autoSku }));
                    }}
                    className="px-3 py-2 border border-[hsl(var(--border))] rounded-xl text-xs font-semibold hover:bg-[hsl(var(--muted))] transition-colors flex items-center gap-1"
                    title="إعادة توليد الكود تلقائياً"
                  >
                    <RefreshCw size={13} />
                    تلقائي
                  </button>
                )}
              </div>
              <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1">
                يتولد تلقائياً من اسم الصنف — يمكنك تعديله يدوياً
              </p>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1.5">الفئة</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
              >
                {categories
                  .filter((c) => c !== 'الكل')
                  .map((c) => (
                    <option key={c}>{c}</option>
                  ))}
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

          {/* Colors section */}
          <div>
            <label className="block text-sm font-semibold mb-2">
              الألوان المتاحة
              <span className="mr-2 text-[10px] text-[hsl(var(--muted-foreground))] font-normal">
                يمكن إضافة أكثر من لون
              </span>
            </label>
            {(form.colors || []).length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {(form.colors || []).map((color) => (
                  <div
                    key={color}
                    className="flex items-center gap-1.5 bg-[hsl(var(--primary))]/10 border border-[hsl(var(--primary))]/30 text-[hsl(var(--primary))] text-xs px-3 py-1.5 rounded-xl font-semibold"
                  >
                    <span>{color}</span>
                    <button
                      type="button"
                      onClick={() => removeColor(color)}
                      className="text-[hsl(var(--primary))]/60 hover:text-red-500 transition-colors"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addColor())}
                placeholder="أضف لون (مثال: أحمر، أزرق، أخضر)"
                className="flex-1 border border-[hsl(var(--border))] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
              />
              <button
                type="button"
                onClick={addColor}
                className="px-4 py-2 bg-[hsl(var(--primary))] text-white rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity flex items-center gap-1"
              >
                <Plus size={14} />
                إضافة
              </button>
            </div>
            <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1">
              الألوان ستظهر كخيارات عند إضافة الأوردر
            </p>
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
          <button
            onClick={onClose}
            className="px-5 border border-[hsl(var(--border))] rounded-xl text-sm font-semibold hover:bg-[hsl(var(--muted))] transition-colors"
          >
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}

export default function InventoryPage() {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [realWithdrawnAmounts, setRealWithdrawnAmounts] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('الكل');
  const [editItem, setEditItem] = useState<InventoryItem | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  const fetchInventoryAndOrders = async () => {
    try {
      const supabase = createClient();

      const [invRes, ordRes] = await Promise.all([
        supabase.from('zahranship_inventory').select('*').order('created_at', { ascending: false }),
        supabase.from('zahranship_orders').select('products, status'),
      ]);

      if (!invRes.error && invRes.data) {
        setInventory(
          invRes.data.map((item: any) => ({
            ...item,
            minStock: item.min_stock,
          }))
        );
      }

      if (!ordRes.error && ordRes.data) {
        const withdrawnMap: Record<string, number> = {};
        ordRes.data.forEach((o: any) => {
          if (o.status === 'cancelled' || o.status === 'returned') return;
          if (!o.products) return;
          const pNames = o.products.split('+').map((s: string) => s.trim());
          pNames.forEach((p: string) => {
            // Check for format: name x 2
            const match = p.match(/(.*?)\s*[x×]\s*(\d+)$/i);
            let name = p;
            let qty = 1;
            if (match) {
              name = match[1].trim();
              qty = parseInt(match[2], 10) || 1;
            } else {
              name = p.trim();
              qty = 1;
            }
            if (!withdrawnMap[name]) withdrawnMap[name] = 0;
            withdrawnMap[name] += qty;
          });
        });
        setRealWithdrawnAmounts(withdrawnMap);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInventoryAndOrders();
  }, []);

  const lowStockCount = inventory.filter((i) => i.available <= i.minStock).length;

  const filtered = inventory.filter((item) => {
    const matchSearch = item.name.includes(search) || item.sku.includes(search);
    const matchCat = activeCategory === 'الكل' || item.category === activeCategory;
    return matchSearch && matchCat;
  });

  const handleSave = async (item: InventoryItem) => {
    try {
      const supabase = createClient();
      const dbItem = {
        id: item.id.startsWith('inv-') ? undefined : item.id,
        name: item.name,
        sku: item.sku,
        available: item.available,
        withdrawn: item.withdrawn || 0,
        min_stock: item.minStock,
        price: item.price,
        category: item.category,
        images: item.images || [],
        colors: item.colors || [],
      };

      if (item.id.startsWith('inv-')) {
        await supabase.from('zahranship_inventory').insert([dbItem]);
      } else {
        await supabase.from('zahranship_inventory').update(dbItem).eq('id', item.id);
      }
      fetchInventoryAndOrders();
      setEditItem(undefined);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (id: string) => {
    const supabase = createClient();
    await supabase.from('zahranship_inventory').delete().eq('id', id);
    fetchInventoryAndOrders();
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
                <span className="text-green-600 flex items-center gap-1">
                  <CheckCircle size={13} /> المخزون كافٍ
                </span>
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
            {
              label: 'إجمالي الأصناف',
              value: inventory.length,
              icon: <Package size={20} />,
              color: 'blue',
            },
            {
              label: 'إجمالي المتاح',
              value: inventory.reduce((s, i) => s + i.available, 0),
              icon: <Warehouse size={20} />,
              color: 'green',
            },
            {
              label: 'إجمالي المسحوب',
              value: inventory.reduce((s, i) => s + (realWithdrawnAmounts[i.name] || 0), 0),
              icon: <TrendingDown size={20} />,
              color: 'orange',
            },
            {
              label: 'تحتاج تجديد',
              value: lowStockCount,
              icon: <AlertTriangle size={20} />,
              color: 'red',
            },
          ].map((card, i) => (
            <div key={i} className="kpi-card">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${
                  card.color === 'blue'
                    ? 'bg-blue-50 text-blue-600'
                    : card.color === 'green'
                      ? 'bg-green-50 text-green-600'
                      : card.color === 'orange'
                        ? 'bg-orange-50 text-orange-600'
                        : 'bg-red-50 text-red-600'
                }`}
              >
                {card.icon}
              </div>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mb-1">{card.label}</p>
              <p className="text-2xl font-bold text-[hsl(var(--foreground))] font-mono">
                {card.value}
              </p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="card-section p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search
                size={16}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]"
              />
              <input
                type="text"
                placeholder="بحث بالاسم أو الكود..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pr-9 pl-4 py-2.5 border border-[hsl(var(--border))] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
              />
            </div>
            <div className="flex bg-[hsl(var(--muted))] rounded-xl p-1 gap-1 flex-wrap">
              {categories.map((cat) => (
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
                  <th className="text-right px-4 py-3 font-semibold text-[hsl(var(--muted-foreground))]">
                    الصورة
                  </th>
                  <th className="text-right px-4 py-3 font-semibold text-[hsl(var(--muted-foreground))]">
                    الصنف
                  </th>
                  <th className="text-right px-4 py-3 font-semibold text-[hsl(var(--muted-foreground))]">
                    الكود
                  </th>
                  <th className="text-right px-4 py-3 font-semibold text-[hsl(var(--muted-foreground))]">
                    الفئة
                  </th>
                  <th className="text-right px-4 py-3 font-semibold text-[hsl(var(--muted-foreground))]">
                    الألوان
                  </th>
                  <th className="text-right px-4 py-3 font-semibold text-[hsl(var(--muted-foreground))]">
                    المتاح
                  </th>
                  <th className="text-right px-4 py-3 font-semibold text-[hsl(var(--muted-foreground))]">
                    المسحوب
                  </th>
                  <th className="text-right px-4 py-3 font-semibold text-[hsl(var(--muted-foreground))]">
                    السعر
                  </th>
                  <th className="text-right px-4 py-3 font-semibold text-[hsl(var(--muted-foreground))]">
                    الحالة
                  </th>
                  <th className="text-right px-4 py-3 font-semibold text-[hsl(var(--muted-foreground))]">
                    إجراءات
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[hsl(var(--border))]">
                {filtered.map((item) => {
                  const realWithdrawn = realWithdrawnAmounts[item.name] || 0;
                  const isLow = item.available <= item.minStock;
                  const pct =
                    item.available + realWithdrawn > 0
                      ? Math.round((item.available / (item.available + realWithdrawn)) * 100)
                      : 0;
                  const firstImage = item.images?.[0];
                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-[hsl(var(--muted))]/30 transition-colors ${isLow ? 'bg-red-50/30' : ''}`}
                    >
                      <td className="px-4 py-3">
                        {firstImage ? (
                          <div className="relative">
                            <img
                              src={firstImage}
                              alt={item.name}
                              className="w-10 h-10 rounded-lg object-cover border border-[hsl(var(--border))]"
                            />
                            {(item.images?.length || 0) > 1 && (
                              <span className="absolute -bottom-1 -right-1 bg-[hsl(var(--primary))] text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                                {item.images!.length}
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="w-10 h-10 rounded-lg bg-[hsl(var(--muted))] flex items-center justify-center border border-[hsl(var(--border))]">
                            <ImageIcon
                              size={16}
                              className="text-[hsl(var(--muted-foreground))] opacity-50"
                            />
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-semibold">{item.name}</td>
                      <td className="px-4 py-3 text-[hsl(var(--muted-foreground))] font-mono text-xs">
                        {item.sku}
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-1 bg-[hsl(var(--muted))] rounded-lg text-xs font-medium">
                          {item.category}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {(item.colors || []).length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {(item.colors || []).slice(0, 3).map((c) => (
                              <span
                                key={c}
                                className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded-md font-medium"
                              >
                                {c}
                              </span>
                            ))}
                            {(item.colors || []).length > 3 && (
                              <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
                                +{(item.colors || []).length - 3}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[10px] text-[hsl(var(--muted-foreground))]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-bold ${isLow ? 'text-red-600' : 'text-green-600'}`}
                          >
                            {item.available}
                          </span>
                          <div className="w-16 bg-gray-200 rounded-full h-1.5 hidden sm:block">
                            <div
                              className={`h-1.5 rounded-full ${isLow ? 'bg-red-500' : 'bg-green-500'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[hsl(var(--muted-foreground))]">
                        {realWithdrawn}
                      </td>
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
        <EditModal
          item={editItem}
          onClose={() => setEditItem(undefined)}
          onSave={handleSave}
          allItems={inventory}
        />
      )}
    </AppLayout>
  );
}
