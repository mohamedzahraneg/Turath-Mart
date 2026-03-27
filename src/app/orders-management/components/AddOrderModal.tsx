'use client';
import React, { useState, useEffect, useRef } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { toast } from 'sonner';
import { Toaster } from 'sonner';
import { X, Trash2, Package, User, MapPin, Phone, FileText, Zap, Calculator, ChevronDown, DollarSign, Image as ImageIcon, Check } from 'lucide-react';

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
  governorate: string;
  district: string;
  address: string;
  products: ProductItem[];
  expressShipping: boolean;
  extraShippingFee: number;
  notes: string;
}

export const PRODUCT_TYPES = [
  { value: 'holder', label: 'حامل مصحف', basePrice: 300, image: '/assets/images/no_image.png', emoji: '📿', hasColor: true },
  { value: 'flashlight', label: 'كشاف', basePrice: 150, image: '/assets/images/no_image.png', emoji: '🔦', hasColor: false },
  { value: 'chair', label: 'كرسي', basePrice: 600, image: '/assets/images/no_image.png', emoji: '🪑', hasColor: false },
  { value: 'quran', label: 'مصحف', basePrice: 140, image: '/assets/images/no_image.png', emoji: '📖', hasColor: false },
  { value: 'kaaba', label: 'كعبة', basePrice: 450, image: '/assets/images/no_image.png', emoji: '🕋', hasColor: false },
];

export const HOLDER_COLORS = [
  { value: 'brown', label: 'بني', hex: '#8B4513' },
  { value: 'black', label: 'أسود', hex: '#1a1a1a' },
  { value: 'white', label: 'أبيض', hex: '#f5f5f5' },
  { value: 'gold', label: 'ذهبي', hex: '#FFD700' },
  { value: 'pearl', label: 'صدف', hex: '#EAE0C8' },
];

export const GOVERNORATES_DISTRICTS: Record<string, string[]> = {
  'القاهرة': [
    'مدينة نصر', 'المعادي', 'هليوبوليس (مصر الجديدة)', 'الزيتون', 'شبرا', 'المطرية',
    'عين شمس', 'النزهة', 'المرج', 'الأميرية', 'السيدة زينب', 'الخليفة',
    'مصر القديمة', 'حلوان', 'المقطم', 'التجمع الأول', 'التجمع الخامس',
    'القاهرة الجديدة', 'الرحاب', 'مدينتي', 'بدر', 'العبور', 'الشروق',
    'الزمالك', 'جاردن سيتي', 'الدقي (القاهرة)', 'بولاق', 'الوايلي',
    'عابدين', 'الأزبكية', 'الموسكي', 'الجمالية', 'الدرب الأحمر',
    'منشأة ناصر', 'دار السلام', 'طره', 'المعصرة', 'بشتيل',
  ],
  'الجيزة': [
    'الدقي', 'العجوزة', 'المهندسين', 'إمبابة', 'بولاق الدكرور',
    'فيصل', 'الهرم', 'العمرانية', 'أوسيم', 'كرداسة', 'أبو النمرس',
    'الحوامدية', 'البدرشين', 'الصف', 'أطفيح', 'المنيب',
    'الشيخ زايد', '6 أكتوبر', 'الحي الأول', 'الحي الثاني',
    'الحي الثالث', 'الحي الرابع', 'الحي الخامس', 'الحي السادس',
    'الحي السابع', 'الحي الثامن', 'الحي التاسع', 'الحي العاشر',
    'الحي الحادي عشر', 'الحي الثاني عشر', 'الحي الثالث عشر',
    'الواحات البحرية', 'سقارة', 'أبو رواش',
  ],
  'القليوبية': [
    'شبرا الخيمة', 'قليوب', 'بنها', 'طوخ', 'قها', 'الخانكة',
    'الخصوص', 'كفر شكر', 'تلا', 'منوف', 'شبين الكوم',
    'أبو زعبل', 'الجيزة (القليوبية)', 'مسطرد', 'العبور',
    'الإبراهيمية', 'الزاوية الحمراء', 'شبرا مصر',
  ],
};

// Admin-configurable settings (in real app, fetched from API)
export const ADMIN_SETTINGS = {
  SHIPPING_FEE: 50,
  EXPRESS_FEE: 100,
  DISABLED_DISTRICTS: [] as string[], // Admin can disable specific districts
};

// Simulated current user role — in real app from auth context
const CURRENT_USER_ROLE: 'admin' | 'supervisor' | 'customer_service' | 'delegate' = 'customer_service';
const IS_ADMIN = CURRENT_USER_ROLE === 'admin';

function getDeviceType(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/tablet|ipad|playbook|silk/i.test(ua)) return 'تابلت';
  if (/mobile|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)) return 'موبايل';
  return 'كمبيوتر';
}

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
  const [currentDateTime, setCurrentDateTime] = useState({ date: '', time: '', day: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [subtotal, setSubtotal] = useState(0);
  const [step, setStep] = useState(1);
  // Product image upload state (admin only)
  const [productImages, setProductImages] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    PRODUCT_TYPES.forEach(p => { init[p.value] = p.emoji; });
    return init;
  });
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const days = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
      const d = now.getDate().toString().padStart(2, '0');
      const m = (now.getMonth() + 1).toString().padStart(2, '0');
      const y = now.getFullYear();
      const h = now.getHours().toString().padStart(2, '0');
      const min = now.getMinutes().toString().padStart(2, '0');
      const sec = now.getSeconds().toString().padStart(2, '0');
      setCurrentDateTime({
        date: `${d}/${m}/${y}`,
        time: `${h}:${min}:${sec}`,
        day: days[now.getDay()],
      });
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
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
      governorate: 'القاهرة',
      district: '',
      products: [{ productType: 'holder', color: 'brown', withFlashlight: false, quantity: 1, unitPrice: 300, note: '' }],
      expressShipping: false,
      extraShippingFee: 0,
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'products' });
  const watchProducts = watch('products');
  const watchExpress = watch('expressShipping');
  const watchGovernorate = watch('governorate');
  const watchExtraFee = watch('extraShippingFee') || 0;

  useEffect(() => {
    const total = watchProducts?.reduce((sum, p) => {
      const base = (p.unitPrice * p.quantity) || 0;
      const flash = p.withFlashlight ? (150 * p.quantity) : 0;
      return sum + base + flash;
    }, 0) || 0;
    setSubtotal(total);
  }, [watchProducts]);

  // Reset district when governorate changes
  useEffect(() => {
    setValue('district', '');
  }, [watchGovernorate, setValue]);

  const availableDistricts = (GOVERNORATES_DISTRICTS[watchGovernorate] || [])
    .filter(d => !ADMIN_SETTINGS.DISABLED_DISTRICTS.includes(d));

  // Express shipping REPLACES default shipping fee (not added on top)
  const shippingCost = watchExpress ? ADMIN_SETTINGS.EXPRESS_FEE : ADMIN_SETTINGS.SHIPPING_FEE;
  const extraFeeAmount = IS_ADMIN ? Number(watchExtraFee || 0) : 0;
  const grandTotal = subtotal + shippingCost + extraFeeAmount;

  const onSubmit = async (data: OrderFormData) => {
    setIsSubmitting(true);
    const deviceType = getDeviceType();
    await new Promise((r) => setTimeout(r, 1500));
    toast.success(`تم تسجيل الأوردر ${orderNum} بنجاح! (${deviceType})`);
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
      if (!product.hasColor) setValue(`products.${index}.color`, undefined);
      else setValue(`products.${index}.color`, 'brown');
    }
  };

  const handleImageUpload = (productValue: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (ev.target?.result) {
        setProductImages(prev => ({ ...prev, [productValue]: ev.target!.result as string }));
        toast.success('تم رفع الصورة بنجاح');
      }
    };
    reader.readAsDataURL(file);
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

        {/* Order info bar */}
        <div className="px-6 pt-4 pb-0">
          <div className="flex items-center gap-4 bg-blue-50 border border-blue-100 rounded-xl p-3">
            <div>
              <p className="text-[10px] font-semibold text-blue-600 mb-0.5">رقم الأوردر</p>
              <p className="text-xs font-mono font-bold text-[hsl(var(--foreground))]">{orderNum}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-blue-600 mb-0.5">التاريخ والوقت</p>
              <p className="text-xs font-mono">{currentDateTime.day} {currentDateTime.date} — {currentDateTime.time}</p>
            </div>
            <div className="mr-auto">
              <p className="text-[10px] font-semibold text-blue-600 mb-0.5">الجهاز</p>
              <p className="text-xs">{getDeviceType()}</p>
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
                        dir="ltr"
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
                        dir="ltr"
                        {...register('phone2', {
                          pattern: { value: /^(01[0-9]{9})?$/, message: 'رقم موبايل مصري غير صحيح' }
                        })}
                      />
                    </div>
                    {errors.phone2 && <p className="text-red-500 text-xs mt-1">{errors.phone2.message}</p>}
                  </div>

                  {/* Governorate */}
                  <div>
                    <label className="label-text" htmlFor="governorate">المحافظة *</label>
                    <div className="relative">
                      <select
                        id="governorate"
                        className="input-field appearance-none pl-8"
                        {...register('governorate', { required: 'المحافظة مطلوبة' })}
                      >
                        {Object.keys(GOVERNORATES_DISTRICTS).map((g) => (
                          <option key={`gov-${g}`} value={g}>{g}</option>
                        ))}
                      </select>
                      <ChevronDown size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] pointer-events-none" />
                    </div>
                  </div>

                  {/* District */}
                  <div>
                    <label className="label-text" htmlFor="district">المنطقة / الحي *</label>
                    <div className="relative">
                      <select
                        id="district"
                        className={`input-field appearance-none pl-8 ${errors.district ? 'border-red-400' : ''}`}
                        {...register('district', { required: 'المنطقة مطلوبة' })}
                      >
                        <option value="">-- اختر المنطقة --</option>
                        {availableDistricts.map((d) => (
                          <option key={`dist-${d}`} value={d}>{d}</option>
                        ))}
                      </select>
                      <ChevronDown size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] pointer-events-none" />
                    </div>
                    {errors.district && <p className="text-red-500 text-xs mt-1">{errors.district.message}</p>}
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
                      placeholder="الشارع، رقم المبنى، رقم الشقة، علامة مميزة..."
                      {...register('address', { required: 'العنوان مطلوب', minLength: { value: 10, message: 'العنوان قصير جداً' } })}
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
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Package size={16} className="text-[hsl(var(--primary))]" />
                    <h3 className="text-sm font-bold text-[hsl(var(--foreground))]">اختر المنتجات</h3>
                  </div>
                  {IS_ADMIN && (
                    <span className="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-semibold">أدمن: يمكنك رفع صور المنتجات</span>
                  )}
                </div>

                {/* Product image cards grid — customer service selects from here */}
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 mb-4">
                  {PRODUCT_TYPES.map((product) => {
                    const isSelected = watchProducts?.some(p => p.productType === product.value);
                    const imgSrc = productImages[product.value];
                    const isEmoji = !imgSrc?.startsWith('data:') && !imgSrc?.startsWith('/assets/images/no_image');
                    return (
                      <div key={`product-card-${product.value}`} className="relative group">
                        <button
                          type="button"
                          onClick={() => {
                            if (!isSelected) {
                              append({ productType: product.value, color: product.hasColor ? 'brown' : undefined, withFlashlight: false, quantity: 1, unitPrice: product.basePrice, note: '' });
                            }
                          }}
                          className={`w-full aspect-square rounded-2xl border-2 flex flex-col items-center justify-center gap-1 transition-all relative overflow-hidden ${isSelected ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5 shadow-md' : 'border-[hsl(var(--border))] hover:border-[hsl(var(--primary))]/50 hover:shadow-sm bg-white'}`}
                        >
                          {isEmoji ? (
                            <span className="text-3xl">{imgSrc}</span>
                          ) : (
                            <img src={imgSrc} alt={product.label} className="w-full h-full object-cover absolute inset-0" />
                          )}
                          {isSelected && (
                            <div className="absolute top-1 left-1 w-5 h-5 bg-[hsl(var(--primary))] rounded-full flex items-center justify-center">
                              <Check size={11} className="text-white" />
                            </div>
                          )}
                          <span className={`text-[10px] font-bold mt-1 relative z-10 ${isEmoji ? 'text-[hsl(var(--foreground))]' : 'text-white bg-black/50 px-1 rounded absolute bottom-1'}`}>{product.label}</span>
                        </button>
                        {/* Admin image upload button */}
                        {IS_ADMIN && (
                          <button
                            type="button"
                            onClick={() => fileInputRefs.current[product.value]?.click()}
                            className="absolute -top-1 -right-1 w-6 h-6 bg-purple-600 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md z-20"
                            title="رفع صورة"
                          >
                            <ImageIcon size={10} />
                          </button>
                        )}
                        <input
                          ref={el => { fileInputRefs.current[product.value] = el; }}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => handleImageUpload(product.value, e)}
                        />
                      </div>
                    );
                  })}
                </div>

                {fields.length === 0 && (
                  <div className="text-center py-6 text-[hsl(var(--muted-foreground))] text-sm border-2 border-dashed border-[hsl(var(--border))] rounded-2xl">
                    اضغط على صورة المنتج أعلاه لإضافته
                  </div>
                )}

                {/* Selected products detail */}
                <div className="space-y-4">
                  {fields.map((field, index) => {
                    const productType = watch(`products.${index}.productType`);
                    const productDef = PRODUCT_TYPES.find(p => p.value === productType);
                    const isHolder = productType === 'holder';
                    const imgSrc = productImages[productType];
                    const isEmoji = !imgSrc?.startsWith('data:') && !imgSrc?.startsWith('/assets/images/no_image');
                    return (
                      <div key={field.id} className="border border-[hsl(var(--border))] rounded-2xl p-4 relative bg-[hsl(var(--muted))]/20">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            {isEmoji ? (
                              <span className="text-xl">{imgSrc}</span>
                            ) : (
                              <img src={imgSrc} alt={productDef?.label || ''} className="w-8 h-8 rounded-lg object-cover" />
                            )}
                            <span className="text-xs font-bold text-[hsl(var(--primary))] bg-[hsl(var(--primary))]/10 px-2 py-1 rounded-lg">
                              {productDef?.label} #{index + 1}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => remove(index)}
                            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-red-500 transition-colors"
                            title="حذف هذا المنتج"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {/* Product type selector (hidden, managed by cards above) */}
                          <input type="hidden" {...register(`products.${index}.productType`)} />

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
                                    >
                                      <span className="w-3 h-3 rounded-full border border-gray-300 flex-shrink-0" style={{ backgroundColor: color.hex }} />
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
                                <span className="text-xs text-[hsl(var(--muted-foreground))]">(+ 150 ج.م)</span>
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
                            {((watch(`products.${index}.unitPrice`) || 0) * (watch(`products.${index}.quantity`) || 0) + (watch(`products.${index}.withFlashlight`) ? 150 * (watch(`products.${index}.quantity`) || 0) : 0)).toLocaleString('en-US')} ج.م
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Express shipping — REPLACES default shipping */}
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
                        <span className="badge bg-amber-100 text-amber-700 border border-amber-200">{ADMIN_SETTINGS.EXPRESS_FEE} ج.م</span>
                      </div>
                      <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                        تسليم خلال 24 ساعة — <span className="text-amber-700 font-semibold">يستبدل تكلفة الشحن الافتراضية ({ADMIN_SETTINGS.SHIPPING_FEE} ج.م)</span>
                      </p>
                    </div>
                  </label>
                </div>

                {/* Extra shipping fee — ADMIN ONLY, hidden from customer service */}
                {IS_ADMIN && (
                  <div className="border border-orange-200 bg-orange-50 rounded-2xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <DollarSign size={16} className="text-orange-600" />
                      <span className="text-sm font-bold text-[hsl(var(--foreground))]">مصاريف شحن إضافية</span>
                      <span className="text-[10px] bg-orange-100 text-orange-700 border border-orange-200 px-2 py-0.5 rounded-full font-semibold">للأدمن فقط</span>
                    </div>
                    <p className="text-xs text-[hsl(var(--muted-foreground))] mb-3">تُضاف على الفاتورة وتُخصم من عهدة المندوب</p>
                    <div className="flex items-center gap-3">
                      <input
                        type="number"
                        min={0}
                        dir="ltr"
                        className="input-field w-32 text-center font-mono"
                        placeholder="0"
                        {...register('extraShippingFee', { min: 0, valueAsNumber: true })}
                      />
                      <span className="text-sm text-[hsl(var(--muted-foreground))]">ج.م</span>
                    </div>
                  </div>
                )}

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
                      <span className="font-mono font-semibold">{subtotal.toLocaleString('en-US')} ج.م</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[hsl(var(--muted-foreground))]">
                        {watchExpress ? 'شحن سريع:' : 'تكلفة الشحن:'}
                      </span>
                      <span className={`font-mono font-semibold ${watchExpress ? 'text-amber-700' : ''}`}>
                        {shippingCost} ج.م
                        {watchExpress && <span className="text-[10px] mr-1 text-amber-600">(بدلاً من {ADMIN_SETTINGS.SHIPPING_FEE} ج.م)</span>}
                      </span>
                    </div>
                    {IS_ADMIN && Number(watchExtraFee) > 0 && (
                      <div className="flex justify-between text-orange-700">
                        <span>مصاريف شحن إضافية (أدمن):</span>
                        <span className="font-mono font-semibold">+ {Number(watchExtraFee).toLocaleString('en-US')} ج.م</span>
                      </div>
                    )}
                    <div className="border-t border-[hsl(var(--primary))]/20 pt-2 flex justify-between">
                      <span className="font-bold text-[hsl(var(--foreground))]">الإجمالي الكلي:</span>
                      <span className="font-mono font-bold text-lg text-[hsl(var(--primary))]">
                        {grandTotal.toLocaleString('en-US')} ج.م
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex justify-between pt-2">
                  <button type="button" className="btn-secondary" onClick={() => setStep(1)}>السابق</button>
                  <button type="button" className="btn-primary" onClick={() => setStep(3)}>التالي: المراجعة</button>
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
                      {watch('phone2') && <div className="flex gap-2"><span className="text-[hsl(var(--muted-foreground))]">موبايل 2:</span><span className="font-mono">{watch('phone2')}</span></div>}
                      <div className="flex gap-2"><span className="text-[hsl(var(--muted-foreground))]">المحافظة:</span><span className="font-semibold">{watch('governorate')}</span></div>
                      <div className="flex gap-2"><span className="text-[hsl(var(--muted-foreground))]">المنطقة:</span><span className="font-semibold">{watch('district') || '—'}</span></div>
                      <div className="flex gap-2"><span className="text-[hsl(var(--muted-foreground))]">العنوان:</span><span className="text-xs leading-relaxed">{watch('address') || '—'}</span></div>
                    </div>
                  </div>

                  <div className="bg-[hsl(var(--muted))]/40 rounded-xl p-4">
                    <p className="text-xs font-bold text-[hsl(var(--muted-foreground))] uppercase tracking-wide mb-2">الملخص المالي</p>
                    <div className="space-y-1.5 text-sm">
                      <div className="flex justify-between"><span className="text-[hsl(var(--muted-foreground))]">المنتجات:</span><span className="font-mono">{subtotal.toLocaleString('en-US')} ج.م</span></div>
                      <div className="flex justify-between">
                        <span className="text-[hsl(var(--muted-foreground))]">{watchExpress ? 'شحن سريع:' : 'الشحن:'}</span>
                        <span className={`font-mono ${watchExpress ? 'text-amber-700' : ''}`}>{shippingCost} ج.م</span>
                      </div>
                      {IS_ADMIN && Number(watchExtraFee) > 0 && <div className="flex justify-between text-orange-700"><span>مصاريف إضافية:</span><span className="font-mono">+ {Number(watchExtraFee).toLocaleString('en-US')} ج.م</span></div>}
                      <div className="border-t border-[hsl(var(--border))] pt-1.5 flex justify-between font-bold">
                        <span>الإجمالي:</span>
                        <span className="font-mono text-[hsl(var(--primary))] text-base">{grandTotal.toLocaleString('en-US')} ج.م</span>
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
                      const imgSrc = productImages[p.productType];
                      const isEmoji = !imgSrc?.startsWith('data:') && !imgSrc?.startsWith('/assets/images/no_image');
                      return (
                        <div key={`review-product-${i + 1}`} className="flex items-center justify-between text-sm bg-white rounded-xl px-3 py-2 border border-[hsl(var(--border))]">
                          <div className="flex items-center gap-2">
                            {isEmoji ? <span>{imgSrc}</span> : <img src={imgSrc} alt={productDef?.label || ''} className="w-6 h-6 rounded object-cover" />}
                            {colorDef && <span className="w-3 h-3 rounded-full border border-gray-300 flex-shrink-0" style={{ backgroundColor: colorDef.hex }} />}
                            <span className="font-medium">
                              {productDef?.label} {colorDef ? `(${colorDef.label})` : ''} {p.withFlashlight ? '+ كشاف' : ''}
                            </span>
                            {p.note && <span className="text-[10px] text-amber-600 italic">— {p.note}</span>}
                          </div>
                          <div className="flex items-center gap-3 text-[hsl(var(--muted-foreground))]">
                            <span>x {p.quantity}</span>
                            <span className="font-mono font-semibold text-[hsl(var(--foreground))]">
                              {((p.unitPrice * p.quantity) + (p.withFlashlight ? 150 * p.quantity : 0)).toLocaleString('en-US')} ج.م
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
                  <button type="button" className="btn-secondary" onClick={() => setStep(2)}>السابق</button>
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