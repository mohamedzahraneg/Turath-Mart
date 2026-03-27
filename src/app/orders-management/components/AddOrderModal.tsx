'use client';
import React, { useState, useEffect } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { toast } from 'sonner';
import { Toaster } from 'sonner';
import {
  X, Plus, Trash2, Package, User, MapPin, Phone,
  FileText, Zap, Calculator, ChevronDown
} from 'lucide-react';

interface ProductItem {
  productType: string;
  color?: string;
  withFlashlight: boolean;
  quantity: number;
  unitPrice: number;
  note: string;
}

interface OrderFormData {
  customerName: string;
  phone: string;
  phone2: string;
  region: string;
  address: string;
  products: ProductItem[];
  expressShipping: boolean;
  notes: string;
}

const PRODUCT_TYPES = [
  { value: 'holder', label: 'حامل مصحف', basePrice: 300 },
  { value: 'flashlight', label: 'كشاف', basePrice: 150 },
  { value: 'chair', label: 'كرسي', basePrice: 600 },
  { value: 'quran', label: 'مصحف', basePrice: 140 },
  { value: 'kaaba', label: 'كعبة', basePrice: 450 },
];

const HOLDER_COLORS = [
  { value: 'brown', label: 'بني', hex: '#8B4513' },
  { value: 'black', label: 'أسود', hex: '#1a1a1a' },
  { value: 'white', label: 'أبيض', hex: '#f5f5f5' },
  { value: 'gold', label: 'ذهبي', hex: '#FFD700' },
  { value: 'pearl', label: 'صدف', hex: '#EAE0C8' },
];

const REGIONS = ['القاهرة', 'الجيزة', 'القليوبية'];

// Shipping fee — set by admin only, not visible to data entry staff
const SHIPPING_FEE = 50; // TODO: fetch from admin settings API GET /api/settings/shipping-fee
const EXPRESS_FEE = 100; // TODO: fetch from admin settings API GET /api/settings/express-fee

function generateOrderNumber() {
  const now = new Date();
  const year = now.getFullYear();
  const seq = Math.floor(Math.random() * 9000) + 1000;
  return `ZSH-${year}-${seq.toString().padStart(4, '0')}`;
}

interface Props {
  onClose: () => void;
}

export default function AddOrderModal({ onClose }: Props) {
  const [orderNum] = useState(generateOrderNumber);
  const [currentUser] = useState({ name: 'محمد حسن', location: 'القاهرة، مصر', ip: '197.32.45.115' });
  const [currentDateTime, setCurrentDateTime] = useState({ date: '', time: '', day: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [subtotal, setSubtotal] = useState(0);
  const [step, setStep] = useState(1);

  useEffect(() => {
    const now = new Date();
    setCurrentDateTime({
      date: now.toLocaleDateString('ar-EG'),
      time: now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
      day: now.toLocaleDateString('ar-EG', { weekday: 'long' }),
    });
  }, []);

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<OrderFormData>({
    defaultValues: {
      region: 'القاهرة',
      products: [{ productType: 'holder', color: 'brown', withFlashlight: false, quantity: 1, unitPrice: 300, note: '' }],
      expressShipping: false,
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'products' });
  const watchProducts = watch('products');
  const watchExpress = watch('expressShipping');

  useEffect(() => {
    const total = watchProducts?.reduce((sum, p) => sum + (p.unitPrice * p.quantity || 0), 0) || 0;
    setSubtotal(total);
  }, [watchProducts]);

  const totalShipping = SHIPPING_FEE + (watchExpress ? EXPRESS_FEE : 0);
  const grandTotal = subtotal + totalShipping;

  const onSubmit = async (data: OrderFormData) => {
    setIsSubmitting(true);
    // TODO: POST /api/orders with order data + auto-generate PDF + send WhatsApp notification
    await new Promise((r) => setTimeout(r, 1500));
    toast.success(`تم تسجيل الأوردر ${orderNum} بنجاح!`);
    setIsSubmitting(false);
    onClose();
  };

  const addProduct = () => {
    append({ productType: 'holder', color: 'brown', withFlashlight: false, quantity: 1, unitPrice: 300, note: '' });
  };

  const handleProductTypeChange = (index: number, type: string) => {
    const product = PRODUCT_TYPES.find((p) => p.value === type);
    if (product) {
      setValue(`products.${index}.unitPrice`, product.basePrice);
      if (type !== 'holder') setValue(`products.${index}.color`, undefined);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir="rtl">
      <Toaster position="top-center" richColors />
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-3xl shadow-modal w-full max-w-3xl max-h-[92vh] flex flex-col fade-in">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[hsl(var(--primary))]/10 rounded-xl flex items-center justify-center">
              <Package size={20} className="text-[hsl(var(--primary))]" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[hsl(var(--foreground))]">إضافة أوردر جديد</h2>
              <p className="text-xs text-[hsl(var(--muted-foreground))] font-mono">{orderNum}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-[hsl(var(--muted))] transition-colors" aria-label="إغلاق">
            <X size={18} />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-0 px-6 py-3 bg-[hsl(var(--muted))]/40 border-b border-[hsl(var(--border))]">
          {[
            { num: 1, label: 'بيانات العميل' },
            { num: 2, label: 'المنتجات' },
            { num: 3, label: 'المراجعة' },
          ].map((s, i) => (
            <React.Fragment key={`step-${s.num}`}>
              <button
                onClick={() => setStep(s.num)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-semibold transition-all ${step === s.num ? 'bg-[hsl(var(--primary))] text-white' : step > s.num ? 'text-green-600' : 'text-[hsl(var(--muted-foreground))]'}`}
              >
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${step === s.num ? 'bg-white/20' : step > s.num ? 'bg-green-100' : 'bg-[hsl(var(--border))]'}`}>
                  {s.num}
                </span>
                {s.label}
              </button>
              {i < 2 && <div className="flex-1 h-0.5 bg-[hsl(var(--border))] mx-1" />}
            </React.Fragment>
          ))}
        </div>

        {/* Auto-filled info */}
        <div className="px-6 pt-4 pb-0">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-blue-50 border border-blue-100 rounded-xl p-3">
            <div>
              <p className="text-[10px] font-semibold text-blue-600 mb-0.5">رقم الأوردر</p>
              <p className="text-xs font-mono font-bold text-[hsl(var(--foreground))]">{orderNum}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-blue-600 mb-0.5">المسجِّل</p>
              <p className="text-xs font-semibold">{currentUser.name}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-blue-600 mb-0.5">التاريخ والوقت</p>
              <p className="text-xs">{currentDateTime.day} {currentDateTime.date} — {currentDateTime.time}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-blue-600 mb-0.5">IP الجهاز</p>
              <p className="text-xs font-mono text-[hsl(var(--muted-foreground))]">{currentUser.ip}</p>
            </div>
          </div>
        </div>

        {/* Form body */}
        <form onSubmit={handleSubmit(onSubmit)} className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="px-6 py-4">
            {/* Step 1: Customer info */}
            {step === 1 && (
              <div className="space-y-4 fade-in">
                <div className="flex items-center gap-2 mb-4">
                  <User size={16} className="text-[hsl(var(--primary))]" />
                  <h3 className="text-sm font-bold text-[hsl(var(--foreground))]">بيانات العميل</h3>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label className="label-text" htmlFor="customerName">اسم العميل *</label>
                    <input
                      id="customerName"
                      className={`input-field ${errors.customerName ? 'border-red-400' : ''}`}
                      placeholder="الاسم الكامل للعميل"
                      {...register('customerName', { required: 'اسم العميل مطلوب' })}
                    />
                    {errors.customerName && <p className="text-red-500 text-xs mt-1">{errors.customerName.message}</p>}
                  </div>

                  <div>
                    <label className="label-text" htmlFor="phone">رقم الموبايل الأساسي *</label>
                    <div className="relative">
                      <Phone size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
                      <input
                        id="phone"
                        type="tel"
                        className={`input-field pr-8 ${errors.phone ? 'border-red-400' : ''}`}
                        placeholder="01XXXXXXXXX"
                        {...register('phone', {
                          required: 'رقم الموبايل مطلوب',
                          pattern: { value: /^01[0-9]{9}$/, message: 'رقم موبايل مصري غير صحيح' }
                        })}
                      />
                    </div>
                    {errors.phone && <p className="text-red-500 text-xs mt-1">{errors.phone.message}</p>}
                  </div>

                  <div>
                    <label className="label-text" htmlFor="phone2">رقم موبايل إضافي</label>
                    <div className="relative">
                      <Phone size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
                      <input
                        id="phone2"
                        type="tel"
                        className="input-field pr-8"
                        placeholder="01XXXXXXXXX (اختياري)"
                        {...register('phone2', {
                          pattern: { value: /^(01[0-9]{9})?$/, message: 'رقم موبايل مصري غير صحيح' }
                        })}
                      />
                    </div>
                    {errors.phone2 && <p className="text-red-500 text-xs mt-1">{errors.phone2.message}</p>}
                  </div>

                  <div>
                    <label className="label-text" htmlFor="region">المنطقة *</label>
                    <p className="text-xs text-[hsl(var(--muted-foreground))] mb-1.5">حدد المنطقة لحساب تكلفة الشحن</p>
                    <div className="relative">
                      <select
                        id="region"
                        className="input-field appearance-none pl-8"
                        {...register('region', { required: 'المنطقة مطلوبة' })}
                      >
                        {REGIONS.map((r) => <option key={`modal-region-${r}`} value={r}>{r}</option>)}
                      </select>
                      <ChevronDown size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] pointer-events-none" />
                    </div>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="label-text" htmlFor="address">
                      <MapPin size={13} className="inline ml-1" />
                      العنوان بالتفصيل *
                    </label>
                    <textarea
                      id="address"
                      rows={3}
                      className={`input-field resize-none ${errors.address ? 'border-red-400' : ''}`}
                      placeholder="المحافظة، الحي، الشارع، رقم المبنى، رقم الشقة..."
                      {...register('address', { required: 'العنوان مطلوب', minLength: { value: 15, message: 'العنوان قصير جداً، يرجى التفصيل' } })}
                    />
                    {errors.address && <p className="text-red-500 text-xs mt-1">{errors.address.message}</p>}
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button type="button" className="btn-primary" onClick={() => setStep(2)}>
                    التالي: المنتجات
                  </button>
                </div>
              </div>
            )}

            {/* Step 2: Products */}
            {step === 2 && (
              <div className="space-y-4 fade-in">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Package size={16} className="text-[hsl(var(--primary))]" />
                    <h3 className="text-sm font-bold text-[hsl(var(--foreground))]">المنتجات والأسعار</h3>
                  </div>
                  <button type="button" className="btn-secondary text-xs" onClick={addProduct}>
                    <Plus size={14} />
                    إضافة منتج
                  </button>
                </div>

                <div className="space-y-4">
                  {fields.map((field, index) => {
                    const productType = watch(`products.${index}.productType`);
                    const isHolder = productType === 'holder';
                    return (
                      <div key={field.id} className="border border-[hsl(var(--border))] rounded-2xl p-4 relative bg-[hsl(var(--muted))]/20">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-xs font-bold text-[hsl(var(--primary))] bg-[hsl(var(--primary))]/10 px-2 py-1 rounded-lg">
                            منتج #{index + 1}
                          </span>
                          {fields.length > 1 && (
                            <button
                              type="button"
                              onClick={() => remove(index)}
                              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-red-500 transition-colors"
                              title="حذف هذا المنتج"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="label-text">نوع المنتج *</label>
                            <div className="relative">
                              <select
                                className="input-field appearance-none pl-8"
                                {...register(`products.${index}.productType`, { required: true })}
                                onChange={(e) => {
                                  register(`products.${index}.productType`).onChange(e);
                                  handleProductTypeChange(index, e.target.value);
                                }}
                              >
                                {PRODUCT_TYPES.map((p) => (
                                  <option key={`product-type-${p.value}`} value={p.value}>{p.label}</option>
                                ))}
                              </select>
                              <ChevronDown size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] pointer-events-none" />
                            </div>
                          </div>

                          {isHolder && (
                            <div>
                              <label className="label-text">اللون *</label>
                              <div className="flex gap-2 flex-wrap">
                                {HOLDER_COLORS.map((color) => {
                                  const currentColor = watch(`products.${index}.color`);
                                  return (
                                    <button
                                      key={`color-${index}-${color.value}`}
                                      type="button"
                                      onClick={() => setValue(`products.${index}.color`, color.value)}
                                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-all ${currentColor === color.value ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]' : 'border-[hsl(var(--border))] hover:border-gray-400'}`}
                                      title={color.label}
                                    >
                                      <span
                                        className="w-3 h-3 rounded-full border border-gray-300 flex-shrink-0"
                                        style={{ backgroundColor: color.hex }}
                                      />
                                      {color.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {isHolder && (
                            <div className="sm:col-span-2">
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  className="w-4 h-4 rounded"
                                  {...register(`products.${index}.withFlashlight`)}
                                />
                                <span className="text-sm font-semibold text-[hsl(var(--foreground))]">
                                  إضافة كشاف مع الحامل
                                </span>
                                <span className="text-xs text-[hsl(var(--muted-foreground))]">(+ ١٥٠ ج.م)</span>
                              </label>
                            </div>
                          )}

                          <div>
                            <label className="label-text">الكمية *</label>
                            <input
                              type="number"
                              min={1}
                              className={`input-field ${errors.products?.[index]?.quantity ? 'border-red-400' : ''}`}
                              {...register(`products.${index}.quantity`, {
                                required: 'الكمية مطلوبة',
                                min: { value: 1, message: 'الحد الأدنى قطعة واحدة' },
                                valueAsNumber: true,
                              })}
                            />
                            {errors.products?.[index]?.quantity && (
                              <p className="text-red-500 text-xs mt-1">{errors.products[index]?.quantity?.message}</p>
                            )}
                          </div>

                          <div>
                            <label className="label-text">سعر الوحدة (ج.م) *</label>
                            <input
                              type="number"
                              min={0}
                              className={`input-field ${errors.products?.[index]?.unitPrice ? 'border-red-400' : ''}`}
                              {...register(`products.${index}.unitPrice`, {
                                required: 'السعر مطلوب',
                                min: { value: 1, message: 'السعر يجب أن يكون أكبر من صفر' },
                                valueAsNumber: true,
                              })}
                            />
                            {errors.products?.[index]?.unitPrice && (
                              <p className="text-red-500 text-xs mt-1">{errors.products[index]?.unitPrice?.message}</p>
                            )}
                          </div>

                          <div className="sm:col-span-2">
                            <label className="label-text">ملاحظة على هذا المنتج</label>
                            <input
                              type="text"
                              className="input-field"
                              placeholder="ملاحظة خاصة بهذا المنتج (اختياري)"
                              {...register(`products.${index}.note`)}
                            />
                          </div>
                        </div>

                        {/* Item subtotal */}
                        <div className="mt-3 pt-3 border-t border-[hsl(var(--border))] flex items-center justify-between">
                          <span className="text-xs text-[hsl(var(--muted-foreground))]">إجمالي هذا المنتج:</span>
                          <span className="text-sm font-bold font-mono text-[hsl(var(--primary))]">
                            {((watch(`products.${index}.unitPrice`) || 0) * (watch(`products.${index}.quantity`) || 0) + (watch(`products.${index}.withFlashlight`) ? 150 * (watch(`products.${index}.quantity`) || 0) : 0)).toLocaleString('ar-EG')} ج.م
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Express shipping */}
                <div className="border border-amber-200 bg-amber-50 rounded-2xl p-4">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      className="w-4 h-4 rounded mt-0.5"
                      {...register('expressShipping')}
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <Zap size={16} className="text-amber-600" />
                        <span className="text-sm font-bold text-[hsl(var(--foreground))]">شحن سريع</span>
                        <span className="badge bg-amber-100 text-amber-700 border border-amber-200">+ {EXPRESS_FEE} ج.م</span>
                      </div>
                      <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">تسليم خلال ٢٤ ساعة — سعره يحدد من الإدارة</p>
                    </div>
                  </label>
                </div>

                {/* General notes */}
                <div>
                  <label className="label-text" htmlFor="notes">
                    <FileText size={13} className="inline ml-1" />
                    ملاحظات عامة على الأوردر
                  </label>
                  <textarea
                    id="notes"
                    rows={2}
                    className="input-field resize-none"
                    placeholder="أي ملاحظات إضافية للمندوب أو المستودع..."
                    {...register('notes')}
                  />
                </div>

                {/* Price summary */}
                <div className="bg-[hsl(var(--primary))]/5 border border-[hsl(var(--primary))]/20 rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Calculator size={16} className="text-[hsl(var(--primary))]" />
                    <span className="text-sm font-bold text-[hsl(var(--foreground))]">ملخص الأسعار</span>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-[hsl(var(--muted-foreground))]">إجمالي المنتجات:</span>
                      <span className="font-mono font-semibold">{subtotal.toLocaleString('ar-EG')} ج.م</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[hsl(var(--muted-foreground))]">تكلفة الشحن:</span>
                      <span className="font-mono font-semibold">{SHIPPING_FEE} ج.م</span>
                    </div>
                    {watchExpress && (
                      <div className="flex justify-between text-amber-700">
                        <span>شحن سريع:</span>
                        <span className="font-mono font-semibold">+ {EXPRESS_FEE} ج.م</span>
                      </div>
                    )}
                    <div className="border-t border-[hsl(var(--primary))]/20 pt-2 flex justify-between">
                      <span className="font-bold text-[hsl(var(--foreground))]">الإجمالي الكلي:</span>
                      <span className="font-mono font-bold text-lg text-[hsl(var(--primary))]">
                        {grandTotal.toLocaleString('ar-EG')} ج.م
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex justify-between pt-2">
                  <button type="button" className="btn-secondary" onClick={() => setStep(1)}>
                    السابق
                  </button>
                  <button type="button" className="btn-primary" onClick={() => setStep(3)}>
                    التالي: المراجعة
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Review */}
            {step === 3 && (
              <div className="space-y-4 fade-in">
                <div className="flex items-center gap-2 mb-4">
                  <FileText size={16} className="text-[hsl(var(--primary))]" />
                  <h3 className="text-sm font-bold text-[hsl(var(--foreground))]">مراجعة الأوردر قبل الحفظ</h3>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="bg-[hsl(var(--muted))]/40 rounded-xl p-4">
                    <p className="text-xs font-bold text-[hsl(var(--muted-foreground))] uppercase tracking-wide mb-2">بيانات العميل</p>
                    <div className="space-y-1.5 text-sm">
                      <div className="flex gap-2"><span className="text-[hsl(var(--muted-foreground))]">الاسم:</span><span className="font-semibold">{watch('customerName') || '—'}</span></div>
                      <div className="flex gap-2"><span className="text-[hsl(var(--muted-foreground))]">الموبايل:</span><span className="font-mono">{watch('phone') || '—'}</span></div>
                      {watch('phone2') && <div className="flex gap-2"><span className="text-[hsl(var(--muted-foreground))]">موبايل ٢:</span><span className="font-mono">{watch('phone2')}</span></div>}
                      <div className="flex gap-2"><span className="text-[hsl(var(--muted-foreground))]">المنطقة:</span><span className="font-semibold">{watch('region')}</span></div>
                      <div className="flex gap-2"><span className="text-[hsl(var(--muted-foreground))]">العنوان:</span><span className="text-xs leading-relaxed">{watch('address') || '—'}</span></div>
                    </div>
                  </div>

                  <div className="bg-[hsl(var(--muted))]/40 rounded-xl p-4">
                    <p className="text-xs font-bold text-[hsl(var(--muted-foreground))] uppercase tracking-wide mb-2">الملخص المالي</p>
                    <div className="space-y-1.5 text-sm">
                      <div className="flex justify-between"><span className="text-[hsl(var(--muted-foreground))]">المنتجات:</span><span className="font-mono">{subtotal.toLocaleString('ar-EG')} ج.م</span></div>
                      <div className="flex justify-between"><span className="text-[hsl(var(--muted-foreground))]">الشحن:</span><span className="font-mono">{SHIPPING_FEE} ج.م</span></div>
                      {watchExpress && <div className="flex justify-between text-amber-700"><span>شحن سريع:</span><span className="font-mono">+ {EXPRESS_FEE} ج.م</span></div>}
                      <div className="border-t border-[hsl(var(--border))] pt-1.5 flex justify-between font-bold">
                        <span>الإجمالي:</span>
                        <span className="font-mono text-[hsl(var(--primary))] text-base">{grandTotal.toLocaleString('ar-EG')} ج.م</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-[hsl(var(--muted))]/40 rounded-xl p-4">
                  <p className="text-xs font-bold text-[hsl(var(--muted-foreground))] uppercase tracking-wide mb-3">المنتجات ({fields.length})</p>
                  <div className="space-y-2">
                    {watchProducts?.map((p, i) => {
                      const productDef = PRODUCT_TYPES.find((pt) => pt.value === p.productType);
                      const colorDef = HOLDER_COLORS.find((c) => c.value === p.color);
                      return (
                        <div key={`review-product-${i + 1}`} className="flex items-center justify-between text-sm bg-white rounded-xl px-3 py-2 border border-[hsl(var(--border))]">
                          <div className="flex items-center gap-2">
                            {colorDef && (
                              <span className="w-3 h-3 rounded-full border border-gray-300 flex-shrink-0" style={{ backgroundColor: colorDef.hex }} />
                            )}
                            <span className="font-medium">
                              {productDef?.label} {colorDef ? `(${colorDef.label})` : ''} {p.withFlashlight ? '+ كشاف' : ''}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-[hsl(var(--muted-foreground))]">
                            <span>× {p.quantity}</span>
                            <span className="font-mono font-semibold text-[hsl(var(--foreground))]">
                              {((p.unitPrice * p.quantity) + (p.withFlashlight ? 150 * p.quantity : 0)).toLocaleString('ar-EG')} ج.م
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {watch('notes') && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm">
                    <span className="font-semibold text-amber-700">ملاحظات: </span>
                    <span className="text-[hsl(var(--foreground))]">{watch('notes')}</span>
                  </div>
                )}

                <div className="flex justify-between pt-2">
                  <button type="button" className="btn-secondary" onClick={() => setStep(2)}>
                    السابق
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="btn-primary min-w-[160px] justify-center"
                  >
                    {isSubmitting ? (
                      <>
                        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        <span>جاري الحفظ...</span>
                      </>
                    ) : (
                      <>
                        <FileText size={16} />
                        <span>حفظ وإنشاء الفاتورة</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}