// ─────────────────────────────────────────────────────────────────────────────
// src/app/inventory/components/InventoryEditModal.tsx
//
// Phase Inventory-UI-Redesign-1 — the add / edit product modal extracted
// from the previous 954-line `page.tsx`. Behaviour is preserved verbatim:
//
//   • `item === null` → new-product flow with auto-generated SKU.
//   • `item` is an existing row → edit flow, images re-fetched on open
//     (the parent list query no longer ships base64 `images` — Phase
//     E1-Fix3 contract).
//   • Save calls back to the parent which owns the supabase write.
//
// No schema change. No validation change. No behavioural drift from the
// pre-redesign modal — this is purely a file-organisation move.
// ─────────────────────────────────────────────────────────────────────────────
'use client';

import React, { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import {
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Plus,
  RefreshCw,
  Save,
  X,
} from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import type { InventoryItem } from '@/lib/inventory/inventoryStats';

function generateSKU(name: string, existingItems: InventoryItem[]): string {
  if (!name.trim()) return '';
  const words = name.trim().split(/\s+/);
  let prefix = words
    .map((w) => w.charAt(0).toUpperCase())
    .join('')
    .slice(0, 3)
    .toUpperCase();

  if (/[؀-ۿ]/.test(prefix)) prefix = 'ITM';

  const existing = new Set(existingItems.map((i) => i.sku));
  const seq = existingItems.length + 1;
  const first = `${prefix}-${seq.toString().padStart(3, '0')}`;
  if (!existing.has(first)) return first;

  for (let i = seq + 1; i < seq + 100; i++) {
    const alt = `${prefix}-${i.toString().padStart(3, '0')}`;
    if (!existing.has(alt)) return alt;
  }
  return `${prefix}-${Date.now().toString().slice(-4)}`;
}

interface Props {
  item: InventoryItem | null;
  allItems: InventoryItem[];
  categoryOptions: string[];
  onClose: () => void;
  onSave: (item: InventoryItem) => void | Promise<void>;
}

export default function InventoryEditModal({
  item,
  allItems,
  categoryOptions,
  onClose,
  onSave,
}: Props) {
  const isNew = !item;

  const [form, setForm] = useState<InventoryItem>(() => {
    if (item) {
      return { ...item, images: item.images || [], colors: item.colors || [] };
    }
    return {
      id: `inv-${Date.now()}`,
      name: '',
      sku: '',
      available: 0,
      withdrawn: 0,
      minStock: 10,
      price: 0,
      category: categoryOptions[0] ?? 'حوامل',
      images: [],
      colors: [],
    };
  });
  const [skuManuallyEdited, setSkuManuallyEdited] = useState(!isNew);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [newColor, setNewColor] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imagesLoading, setImagesLoading] = useState<boolean>(!!item);
  const [saving, setSaving] = useState(false);

  // Phase E1-Fix3 — on open for an existing item, refetch the full images
  // array (the parent list query no longer ships base64 images to save
  // bandwidth). This keeps the carousel and add/remove behaviour identical.
  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from('turath_masr_inventory')
          .select('images')
          .eq('id', item.id)
          .single();
        if (cancelled) return;
        if (!error && data && Array.isArray((data as { images?: unknown }).images)) {
          const fetched = (data as { images: string[] }).images;
          setForm((prev) => ({ ...prev, images: fetched }));
        }
      } catch (err) {
        if (!cancelled) console.warn('[InventoryEditModal] images fetch failed', err);
      } finally {
        if (!cancelled) setImagesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  // Auto-generate SKU for new items until the user manually edits it.
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
      setForm((prev) => ({ ...prev, images: [...(prev.images || []), ...results] }));
    });
    e.target.value = '';
  };

  const removeImage = (index: number) => {
    setForm((prev) => {
      const currentImages = prev?.images || [];
      const imgs = [...currentImages];
      if (index >= 0 && index < imgs.length) imgs.splice(index, 1);
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
    setForm((prev) => ({
      ...prev,
      colors: (prev.colors || []).filter((c) => c !== color),
    }));
  };

  const handleSubmit = async () => {
    if (saving) return;
    if (!form.name.trim() || !form.sku.trim()) return;
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  };

  const images = form?.images || [];

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-[hsl(var(--border))]">
          <h2 className="text-lg font-bold">{item ? 'تعديل صنف' : 'إضافة صنف جديد'}</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[hsl(var(--muted))] rounded-xl transition-colors"
            aria-label="إغلاق"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Image upload + carousel */}
          <div>
            <label className="block text-sm font-semibold mb-2">صور المنتج</label>
            {imagesLoading && images.length === 0 ? (
              <div className="w-full h-32 rounded-xl border-2 border-dashed border-[hsl(var(--border))] flex flex-col items-center justify-center gap-2 text-[hsl(var(--muted-foreground))] mb-3 bg-[hsl(var(--muted))]/20">
                <RefreshCw size={20} className="animate-spin opacity-60" />
                <p className="text-xs">جاري تحميل الصور...</p>
              </div>
            ) : images.length > 0 ? (
              <div className="relative mb-3">
                <div className="relative w-full h-44 rounded-xl overflow-hidden bg-gray-100 border border-[hsl(var(--border))]">
                  <Image
                    src={images[previewIndex]}
                    alt={`صورة ${previewIndex + 1}`}
                    fill
                    sizes="(max-width: 768px) 100vw, 400px"
                    className="object-contain"
                  />
                </div>
                {images.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setPreviewIndex((i) => (i - 1 + images.length) % images.length)
                      }
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 bg-white/80 rounded-full flex items-center justify-center shadow hover:bg-white"
                      aria-label="السابق"
                    >
                      <ChevronRight size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewIndex((i) => (i + 1) % images.length)}
                      className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 bg-white/80 rounded-full flex items-center justify-center shadow hover:bg-white"
                      aria-label="التالي"
                    >
                      <ChevronLeft size={14} />
                    </button>
                  </>
                )}
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

            {images.length > 0 && (
              <div className="flex gap-2 flex-wrap mb-3">
                {images.map((img, i) => (
                  <div key={`thumb-${i}`} className="relative group">
                    <button
                      type="button"
                      onClick={() => setPreviewIndex(i)}
                      className={`w-14 h-14 rounded-lg overflow-hidden border-2 transition-all ${
                        previewIndex === i
                          ? 'border-[hsl(var(--primary))]'
                          : 'border-[hsl(var(--border))]'
                      }`}
                      aria-label={`صورة ${i + 1}`}
                    >
                      <Image
                        src={img}
                        alt={`thumb-${i}`}
                        width={56}
                        height={56}
                        className="w-full h-full object-cover"
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeImage(i)}
                      className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow"
                      aria-label={`حذف صورة ${i + 1}`}
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2 border border-[hsl(var(--border))] rounded-xl text-sm font-semibold hover:bg-[hsl(var(--muted))]"
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
                    className="px-3 py-2 border border-[hsl(var(--border))] rounded-xl text-xs font-semibold hover:bg-[hsl(var(--muted))] flex items-center gap-1"
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
                {categoryOptions
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
                      className="text-[hsl(var(--primary))]/60 hover:text-red-500"
                      aria-label={`حذف لون ${color}`}
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
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addColor();
                  }
                }}
                placeholder="أضف لون (مثال: أحمر، أزرق، أخضر)"
                className="flex-1 border border-[hsl(var(--border))] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
              />
              <button
                type="button"
                onClick={addColor}
                className="px-4 py-2 bg-[hsl(var(--primary))] text-white rounded-xl text-sm font-semibold hover:opacity-90 flex items-center gap-1"
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
            onClick={handleSubmit}
            disabled={saving || !form.name.trim() || !form.sku.trim()}
            className="flex-1 flex items-center justify-center gap-2 bg-[hsl(var(--primary))] text-white rounded-xl py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save size={16} />
            {saving ? 'جاري الحفظ...' : 'حفظ'}
          </button>
          <button
            onClick={onClose}
            className="px-5 border border-[hsl(var(--border))] rounded-xl text-sm font-semibold hover:bg-[hsl(var(--muted))]"
          >
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
