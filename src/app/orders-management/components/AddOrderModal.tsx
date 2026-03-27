'use client';
import React, { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { Toaster } from 'sonner';
import { X, Trash2, Package, User, MapPin, Phone, FileText, Zap, Calculator, ChevronDown, DollarSign, Plus, Minus, CheckCircle, Eye } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

interface ProductItem {
  productType: string;
  color?: string;
  quantity: number;
  unitPrice: number;
  note: string;
  chairPrice?: number;
  quranPrice?: number;
  flashlightPrice?: number;
  includeFlashlight?: boolean;
}

interface OrderFormData {
  customerName: string;
  phone: string;
  phone2: string;
  governorate: string;
  district: string;
  address: string;
  expressShipping: boolean;
  extraShippingFee: number;
  notes: string;
  warranty: string;
}

export const PRODUCT_TYPES = [
  { value: 'holder', label: 'حامل مصحف', basePrice: 300, emoji: '📿', hasColor: true },
  { value: 'flashlight', label: 'كشاف', basePrice: 150, emoji: '🔦', hasColor: false },
  { value: 'chair', label: 'كرسي', basePrice: 600, emoji: '🪑', hasColor: false },
  { value: 'quran', label: 'مصحف', basePrice: 140, emoji: '📖', hasColor: false },
  { value: 'kaaba', label: 'كعبة', basePrice: 450, emoji: '🕋', hasColor: false },
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

export const ADMIN_SETTINGS = {
  SHIPPING_FEE: 50,
  EXPRESS_FEE: 100,
  DISABLED_DISTRICTS: [] as string[],
};

const CURRENT_USER_ROLE: 'admin' | 'supervisor' | 'customer_service' | 'delegate' = 'customer_service';
const IS_ADMIN = CURRENT_USER_ROLE === 'admin';

function getDeviceType(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/tablet|ipad|playbook|silk/i.test(ua)) return 'تابلت';
  if (/mobile|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)) return 'موبايل';
  return 'كمبيوتر';
}

/**
 * Generate order number in format: YYMMDDNNN
 * YY = last 2 digits of year, MM = month, DD = day, NNN = sequential number for today
 * Example: 2603271 = year 26, month 03, day 27, order #1 today
 */
async function generateOrderNumber(): Promise<string> {
  const now = new Date();
  const yy = now.getFullYear().toString().slice(-2);
  const mm = (now.getMonth() + 1).toString().padStart(2, '0');
  const dd = now.getDate().toString().padStart(2, '0');
  const prefix = `${yy}${mm}${dd}`;

  // Try to get today's order count from Supabase for sequential number
  try {
    const supabase = createClient();
    const { count } = await supabase
      .from('zahranship_orders')
      .select('*', { count: 'exact', head: true })
      .like('order_num', `${prefix}%`);
    const seq = (count || 0) + 1;
    return `${prefix}${seq}`;
  } catch {
    // Fallback: use localStorage count + random
    try {
      const existing = JSON.parse(localStorage.getItem('zahranship_orders') || '[]');
      const todayOrders = existing.filter((o: { order_num?: string; orderNum?: string }) => {
        const num = o.order_num || o.orderNum || '';
        return num.startsWith(prefix);
      });
      const seq = todayOrders.length + 1;
      return `${prefix}${seq}`;
    } catch {
      const seq = Math.floor(Math.random() * 900) + 1;
      return `${prefix}${seq}`;
    }
  }
}

// Load settings from localStorage
function loadLS<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

interface InventoryItem {
  id: string;
  name: string;
  sku: string;
  available: number;
  price: number;
  category: string;
  images?: string[];
  colors?: string[];
}

interface ProductCard {
  value: string;
  label: string;
  basePrice: number;
  emoji: string;
  hasColor: boolean;
  image?: string;
  isInventory?: boolean;
  colors?: string[];
}

interface Props {
  onClose: () => void;
}

// A single product line in the order
interface OrderLine {
  id: string;
  productType: string;
  color: string;
  quantity: number;
  unitPrice: number;
  includeFlashlight: boolean;
  flashlightPrice: number;
  note: string;
}

function createLine(productType: string, basePrice: number): OrderLine {
  return {
    id: `line-${Date.now()}-${Math.random()}`,
    productType,
    color: '',
    quantity: 1,
    unitPrice: basePrice,
    includeFlashlight: false,
    flashlightPrice: 150,
    note: '',
  };
}

function lineTotal(line: OrderLine): number {
  const base = line.unitPrice * line.quantity;
  const flash = line.includeFlashlight ? line.flashlightPrice * line.quantity : 0;
  return base + flash;
}

export default function AddOrderModal({ onClose }: Props) {
  const [orderNum, setOrderNum] = useState('جاري التحميل...');
  const [currentDateTime, setCurrentDateTime] = useState({ date: '', time: '', day: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [step, setStep] = useState(1);
  const [orderSuccess, setOrderSuccess] = useState(false);
  const [successOrderNum, setSuccessOrderNum] = useState('');

  // Form fields
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [phone2, setPhone2] = useState('');
  const [governorate, setGovernorate] = useState('القاهرة');
  const [district, setDistrict] = useState('');
  const [address, setAddress] = useState('');
  const [expressShipping, setExpressShipping] = useState(false);
  const [extraShippingFee, setExtraShippingFee] = useState(0);
  const [notes, setNotes] = useState('');
  const [warranty, setWarranty] = useState('بدون ضمان');
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Order lines
  const [lines, setLines] = useState<OrderLine[]>([]);

  // All product cards (default + inventory items)
  const [productCards, setProductCards] = useState<ProductCard[]>([]);

  // Generate order number on mount
  useEffect(() => {
    generateOrderNumber().then(num => setOrderNum(num));
  }, []);

  // Load products from settings + inventory on mount
  useEffect(() => {
    // Load product images/prices from settings
    const settingsProducts = loadLS<Array<{ value: string; label: string; basePrice: number; emoji: string; hasColor: boolean; image?: string; enabled?: boolean }>>('settings_products', PRODUCT_TYPES.map(p => ({ ...p, enabled: true })));

    // Load inventory items
    const inventoryItems = loadLS<InventoryItem[]>('zahranship_inventory', []);

    // Build product cards from settings products (enabled ones)
    const defaultCards: ProductCard[] = settingsProducts
      .filter(p => p.enabled !== false)
      .map(p => ({
        value: p.value,
        label: p.label,
        basePrice: p.basePrice,
        emoji: p.emoji,
        hasColor: p.hasColor,
        image: p.image,
      }));

    // Build product cards from inventory items (not already in default)
    const defaultValues = new Set(defaultCards.map(c => c.value));
    const inventoryCards: ProductCard[] = inventoryItems
      .filter(item => item.available > 0 && !defaultValues.has(item.id))
      .map(item => ({
        value: item.id,
        label: item.name,
        basePrice: item.price,
        emoji: '📦',
        hasColor: (item.colors?.length || 0) > 0,
        image: item.images?.[0],
        isInventory: true,
        colors: item.colors,
      }));

    setProductCards([...defaultCards, ...inventoryCards]);

    // Load disabled districts
    const disabledDistricts = loadLS<string[]>('settings_disabled_districts', []);
    ADMIN_SETTINGS.DISABLED_DISTRICTS.length = 0;
    disabledDistricts.forEach(d => ADMIN_SETTINGS.DISABLED_DISTRICTS.push(d));

    // Load shipping settings
    const shippingSettings = loadLS<{ defaultShippingCost?: string; expressShippingCost?: string }>('settings_shipping', {});
    if (shippingSettings.defaultShippingCost) {
      ADMIN_SETTINGS.SHIPPING_FEE = Number(shippingSettings.defaultShippingCost);
    }
    if (shippingSettings.expressShippingCost) {
      ADMIN_SETTINGS.EXPRESS_FEE = Number(shippingSettings.expressShippingCost);
    }
  }, []);

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
      setCurrentDateTime({ date: `${d}/${m}/${y}`, time: `${h}:${min}:${sec}`, day: days[now.getDay()] });
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Reset district when governorate changes
  useEffect(() => { setDistrict(''); }, [governorate]);

  const availableDistricts = (GOVERNORATES_DISTRICTS[governorate] || [])
    .filter(d => !ADMIN_SETTINGS.DISABLED_DISTRICTS.includes(d));

  const shippingCost = expressShipping ? ADMIN_SETTINGS.EXPRESS_FEE : ADMIN_SETTINGS.SHIPPING_FEE;
  const extraFeeAmount = IS_ADMIN ? extraShippingFee : 0;
  const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0);
  const grandTotal = subtotal + shippingCost + extraFeeAmount;

  const addLine = (productCard: ProductCard) => {
    const line = createLine(productCard.value, productCard.basePrice);
    // Set default color if product has colors
    if (productCard.hasColor && productCard.colors && productCard.colors.length > 0) {
      line.color = productCard.colors[0];
    } else if (productCard.value === 'holder') {
      line.color = 'brown';
    }
    setLines(prev => [...prev, line]);
  };

  const removeLine = (id: string) => {
    setLines(prev => prev.filter(l => l.id !== id));
  };

  const updateLine = (id: string, patch: Partial<OrderLine>) => {
    setLines(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l));
  };

  const validateStep1 = () => {
    const errs: Record<string, string> = {};
    if (!customerName.trim()) errs.customerName = 'اسم العميل مطلوب';
    if (!/^01[0-9]{9}$/.test(phone)) errs.phone = 'رقم موبايل مصري غير صحيح';
    if (phone2 && !/^01[0-9]{9}$/.test(phone2)) errs.phone2 = 'رقم موبايل مصري غير صحيح';
    if (!district) errs.district = 'المنطقة مطلوبة';
    if (!address.trim() || address.trim().length < 10) errs.address = 'العنوان قصير جداً';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const validateStep2 = () => {
    if (lines.length === 0) {
      toast.error('يجب إضافة منتج واحد على الأقل');
      return false;
    }
    return true;
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    const deviceType = getDeviceType();

    // Build order object and save to localStorage
    const productsSummary = lines.map(l => {
      const card = productCards.find(p => p.value === l.productType);
      const label = card?.label || l.productType;
      const colorPart = l.color ? ` ${l.color}` : '';
      const flashPart = l.includeFlashlight ? ' + كشاف' : '';
      return `${label}${colorPart}${flashPart} x ${l.quantity}`;
    }).join(' + ');

    const now = new Date();
    const days = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    const d = now.getDate().toString().padStart(2, '0');
    const m = (now.getMonth() + 1).toString().padStart(2, '0');
    const y = now.getFullYear();
    const h = now.getHours().toString().padStart(2, '0');
    const min = now.getMinutes().toString().padStart(2, '0');
    const sec = now.getSeconds().toString().padStart(2, '0');

    const newOrder = {
      id: `order-${Date.now()}`,
      orderNum,
      createdBy: 'موظف خدمة عملاء',
      createdByDevice: deviceType,
      customer: customerName,
      phone,
      phone2: phone2 || undefined,
      region: governorate,
      district,
      address,
      products: productsSummary || 'لا يوجد منتجات',
      quantity: lines.reduce((s, l) => s + l.quantity, 0),
      subtotal,
      shippingFee: shippingCost,
      extraShippingFee: IS_ADMIN ? extraShippingFee : 0,
      expressShipping,
      total: grandTotal,
      status: 'new',
      date: `${d}/${m}/${y}`,
      time: `${h}:${min}:${sec}`,
      day: days[now.getDay()],
      notes: notes || undefined,
      warranty,
      ip: '—',
      lines: lines.map(l => {
        const card = productCards.find(p => p.value === l.productType);
        return {
          productType: l.productType,
          label: card?.label || l.productType,
          image: card?.image || null,
          emoji: card?.emoji || '📦',
          color: l.color || null,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          includeFlashlight: l.includeFlashlight,
          flashlightPrice: l.flashlightPrice,
          note: l.note || null,
          total: lineTotal(l),
        };
      }),
    };

    // Save to localStorage
    try {
      const existing = JSON.parse(localStorage.getItem('zahranship_orders') || '[]');
      existing.unshift(newOrder);
      localStorage.setItem('zahranship_orders', JSON.stringify(existing));
      // Notify other components that orders have been updated
      window.dispatchEvent(new CustomEvent('zahranship_orders_updated'));
    } catch {
      // ignore storage errors
    }

    // Save to Supabase for cross-origin tracking
    try {
      const supabase = createClient();
      await supabase.from('zahranship_orders').upsert({
        id: newOrder.id,
        order_num: newOrder.orderNum,
        created_by: newOrder.createdBy,
        created_by_device: newOrder.createdByDevice,
        customer: newOrder.customer,
        phone: newOrder.phone,
        phone2: newOrder.phone2 || null,
        region: newOrder.region,
        district: newOrder.district || null,
        address: newOrder.address,
        products: newOrder.products,
        quantity: newOrder.quantity,
        subtotal: newOrder.subtotal,
        shipping_fee: newOrder.shippingFee,
        extra_shipping_fee: newOrder.extraShippingFee || 0,
        express_shipping: newOrder.expressShipping || false,
        total: newOrder.total,
        status: newOrder.status,
        date: newOrder.date,
        time: newOrder.time,
        day: newOrder.day || null,
        notes: newOrder.notes || null,
        warranty: newOrder.warranty || null,
        lines: newOrder.lines || null,
      }, { onConflict: 'id' });
    } catch {
      // Supabase save failed, order still saved in localStorage
    }

    await new Promise((r) => setTimeout(r, 800));
    setIsSubmitting(false);
    setSuccessOrderNum(orderNum);
    setOrderSuccess(true);
  };

  const warrantyOptions = loadLS<string[]>('settings_warranty', ['بدون ضمان', '3 أشهر', '6 أشهر', 'سنة', 'سنتان']);

  const resetForm = () => {
    setCustomerName('');
    setPhone('');
    setPhone2('');
    setGovernorate('القاهرة');
    setDistrict('');
    setAddress('');
    setExpressShipping(false);
    setExtraShippingFee(0);
    setNotes('');
    setWarranty('بدون ضمان');
    setErrors({});
    setLines([]);
    setStep(1);
    setOrderSuccess(false);
    setSuccessOrderNum('');
    // Generate a new order number for the next order
    generateOrderNumber().then(num => setOrderNum(num));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir="rtl">
      <Toaster position="top-center" richColors />
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {orderSuccess ? (
        <div className="relative bg-white rounded-3xl shadow-modal w-full max-w-md p-10 flex flex-col items-center gap-6 fade-in text-center">
          <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
            <svg className="w-10 h-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">تم تسجيل الأوردر بنجاح! 🎉</h2>
            <p className="text-gray-500 text-base mb-1">تم حفظ الطلب وإضافته إلى قائمة الأوردرات</p>
            <div className="mt-3 bg-green-50 border border-green-200 rounded-xl px-6 py-3 inline-block">
              <span className="text-green-700 font-semibold text-lg">رقم الأوردر: {successOrderNum}</span>
            </div>
          </div>
          <div className="flex flex-col gap-3 w-full">
            <button
              type="button"
              className="btn-primary w-full justify-center"
              onClick={resetForm}
            >
              ➕ تسجيل أوردر جديد
            </button>
            <button
              type="button"
              className="btn-secondary w-full justify-center"
              onClick={onClose}
            >
              إغلاق
            </button>
          </div>
        </div>
      ) : (
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
            { num: 3, label: 'المراجعة والتأكيد' },
          ].map((s, i) => (
            <React.Fragment key={`step-${s.num}`}>
              <button
                onClick={() => {
                  if (s.num < step) setStep(s.num);
                }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-semibold transition-all ${step === s.num ? 'bg-[hsl(var(--primary))] text-white' : step > s.num ? 'text-green-600 cursor-pointer' : 'text-[hsl(var(--muted-foreground))] cursor-default'}`}
              >
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${step === s.num ? 'bg-white/20' : step > s.num ? 'bg-green-100' : 'bg-[hsl(var(--border))]'}`}>
                  {step > s.num ? '✓' : s.num}
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
              <p className="text-xs font-mono text-[hsl(var(--foreground))] font-bold">{orderNum}</p>
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
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="px-6 py-4">

            {/* ── Step 1: Customer info ── */}
            {step === 1 && (
              <div className="space-y-4 fade-in">
                <div className="flex items-center gap-2 mb-4">
                  <User size={16} className="text-[hsl(var(--primary))]" />
                  <h3 className="text-sm font-bold text-[hsl(var(--foreground))]">بيانات العميل</h3>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label className="label-text">اسم العميل *</label>
                    <input
                      className={`input-field ${errors.customerName ? 'border-red-400' : ''}`}
                      placeholder="الاسم الكامل للعميل"
                      value={customerName}
                      onChange={e => setCustomerName(e.target.value)}
                    />
                    {errors.customerName && <p className="text-red-500 text-xs mt-1">{errors.customerName}</p>}
                  </div>

                  <div>
                    <label className="label-text">رقم الموبايل الأساسي *</label>
                    <div className="relative">
                      <Phone size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
                      <input
                        type="tel"
                        className={`input-field pr-8 ${errors.phone ? 'border-red-400' : ''}`}
                        placeholder="01XXXXXXXXX"
                        dir="ltr"
                        value={phone}
                        onChange={e => setPhone(e.target.value)}
                      />
                    </div>
                    {errors.phone && <p className="text-red-500 text-xs mt-1">{errors.phone}</p>}
                  </div>

                  <div>
                    <label className="label-text">رقم موبايل إضافي</label>
                    <div className="relative">
                      <Phone size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
                      <input
                        type="tel"
                        className={`input-field pr-8 ${errors.phone2 ? 'border-red-400' : ''}`}
                        placeholder="01XXXXXXXXX (اختياري)"
                        dir="ltr"
                        value={phone2}
                        onChange={e => setPhone2(e.target.value)}
                      />
                    </div>
                    {errors.phone2 && <p className="text-red-500 text-xs mt-1">{errors.phone2}</p>}
                  </div>

                  <div>
                    <label className="label-text">المحافظة *</label>
                    <div className="relative">
                      <select
                        className="input-field appearance-none pl-8"
                        value={governorate}
                        onChange={e => setGovernorate(e.target.value)}
                      >
                        {Object.keys(GOVERNORATES_DISTRICTS).map((g) => (
                          <option key={`gov-${g}`} value={g}>{g}</option>
                        ))}
                      </select>
                      <ChevronDown size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
                    </div>
                  </div>

                  <div>
                    <label className="label-text">المنطقة / الحي *</label>
                    <div className="relative">
                      <select
                        className={`input-field appearance-none pl-8 ${errors.district ? 'border-red-400' : ''}`}
                        value={district}
                        onChange={e => setDistrict(e.target.value)}
                      >
                        <option value="">-- اختر المنطقة --</option>
                        {availableDistricts.map((d) => (
                          <option key={`dist-${d}`} value={d}>{d}</option>
                        ))}
                      </select>
                      <ChevronDown size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
                    </div>
                    {errors.district && <p className="text-red-500 text-xs mt-1">{errors.district}</p>}
                  </div>

                  <div className="sm:col-span-2">
                    <label className="label-text">
                      <MapPin size={13} className="inline ml-1" />
                      العنوان بالتفصيل *
                    </label>
                    <textarea
                      rows={3}
                      className={`input-field resize-none ${errors.address ? 'border-red-400' : ''}`}
                      placeholder="الشارع، رقم المبنى، رقم الشقة، علامة مميزة..."
                      value={address}
                      onChange={e => setAddress(e.target.value)}
                    />
                    {errors.address && <p className="text-red-500 text-xs mt-1">{errors.address}</p>}
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => { if (validateStep1()) setStep(2); }}
                  >
                    التالي: المنتجات
                  </button>
                </div>
              </div>
            )}

            {/* ── Step 2: Products ── */}
            {step === 2 && (
              <div className="space-y-5 fade-in">
                <div className="flex items-center gap-2 mb-2">
                  <Package size={16} className="text-[hsl(var(--primary))]" />
                  <h3 className="text-sm font-bold text-[hsl(var(--foreground))]">اختر المنتجات</h3>
                  <span className="text-xs text-[hsl(var(--muted-foreground))]">— يمكنك إضافة نفس المنتج أكثر من مرة بلون مختلف</span>
                </div>

                {/* Product image cards — click to add a new line */}
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                  {productCards.map((product) => {
                    const hasRealImage = product.image && (product.image.startsWith('data:') || product.image.startsWith('http') || product.image.startsWith('/'));
                    const count = lines.filter(l => l.productType === product.value).length;
                    return (
                      <div key={`product-card-${product.value}`} className="relative group">
                        <button
                          type="button"
                          onClick={() => addLine(product)}
                          className={`w-full aspect-square rounded-2xl border-2 flex flex-col items-center justify-center gap-1 transition-all relative overflow-hidden ${count > 0 ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5 shadow-md' : 'border-[hsl(var(--border))] hover:border-[hsl(var(--primary))]/50 hover:shadow-sm bg-white'}`}
                        >
                          {hasRealImage ? (
                            <img src={product.image} alt={product.label} className="w-full h-full object-cover absolute inset-0" />
                          ) : (
                            <span className="text-3xl">{product.emoji}</span>
                          )}
                          {count > 0 && (
                            <div className="absolute top-1 left-1 w-5 h-5 bg-[hsl(var(--primary))] rounded-full flex items-center justify-center z-10">
                              <span className="text-white text-[10px] font-bold">{count}</span>
                            </div>
                          )}
                          <span className={`text-[10px] font-bold mt-1 relative z-10 ${hasRealImage ? 'text-white bg-black/50 px-1 rounded absolute bottom-1' : 'text-[hsl(var(--foreground))]'}`}>
                            {product.label}
                          </span>
                          {!hasRealImage && <span className="text-[9px] text-[hsl(var(--muted-foreground))] relative z-10">+ إضافة</span>}
                        </button>
                      </div>
                    );
                  })}
                </div>

                {productCards.length === 0 && (
                  <div className="text-center py-4 text-[hsl(var(--muted-foreground))] text-sm">
                    جاري تحميل المنتجات...
                  </div>
                )}

                {lines.length === 0 && (
                  <div className="text-center py-6 text-[hsl(var(--muted-foreground))] text-sm border-2 border-dashed border-[hsl(var(--border))] rounded-2xl">
                    اضغط على صورة المنتج أعلاه لإضافته — يمكنك إضافة نفس المنتج مرات متعددة بألوان مختلفة
                  </div>
                )}

                {/* Lines detail */}
                <div className="space-y-3">
                  {lines.map((line, index) => {
                    const productCard = productCards.find(p => p.value === line.productType);
                    const hasRealImage = productCard?.image && (productCard.image.startsWith('data:') || productCard.image.startsWith('http') || productCard.image.startsWith('/'));
                    const isHolder = line.productType === 'holder';
                    const isFlashlight = line.productType === 'flashlight';
                    // Colors: use inventory colors if available, else use HOLDER_COLORS for holder
                    const availableColors = productCard?.colors && productCard.colors.length > 0
                      ? productCard.colors.map(c => ({ value: c, label: c, hex: '#888' }))
                      : isHolder ? HOLDER_COLORS : [];
                    const hasColors = availableColors.length > 0;

                    return (
                      <div key={line.id} className="border border-[hsl(var(--border))] rounded-2xl p-4 relative bg-[hsl(var(--muted))]/20">
                        {/* Line header */}
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            {hasRealImage ? (
                              <img src={productCard!.image} alt={productCard?.label || ''} className="w-8 h-8 rounded-lg object-cover" />
                            ) : (
                              <span className="text-xl">{productCard?.emoji || '📦'}</span>
                            )}
                            <span className="text-xs font-bold text-[hsl(var(--primary))] bg-[hsl(var(--primary))]/10 px-2 py-1 rounded-lg">
                              {productCard?.label} #{index + 1}
                            </span>
                            <button
                              type="button"
                              onClick={() => productCard && addLine(productCard)}
                              className="text-[10px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))] flex items-center gap-0.5 transition-colors"
                              title="إضافة نفس المنتج مرة أخرى"
                            >
                              <Plus size={11} /> تكرار
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeLine(line.id)}
                            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-red-500 transition-colors"
                            title="حذف هذا المنتج"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {/* Color picker */}
                          {hasColors && (
                            <div className="sm:col-span-2">
                              <label className="label-text">اللون *</label>
                              <div className="flex gap-2 flex-wrap">
                                {availableColors.map((color) => (
                                  <button
                                    key={`color-${line.id}-${color.value}`}
                                    type="button"
                                    onClick={() => updateLine(line.id, { color: color.value })}
                                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-all ${line.color === color.value ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]' : 'border-[hsl(var(--border))] hover:border-gray-400'}`}
                                  >
                                    <span className="w-3 h-3 rounded-full border border-gray-300 flex-shrink-0" style={{ backgroundColor: color.hex }} />
                                    {color.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Quantity */}
                          <div>
                            <label className="label-text">الكمية *</label>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => updateLine(line.id, { quantity: Math.max(1, line.quantity - 1) })}
                                className="w-8 h-8 flex items-center justify-center rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] transition-colors"
                              >
                                <Minus size={13} />
                              </button>
                              <input
                                type="number"
                                min={1}
                                className="input-field w-16 text-center font-mono"
                                value={line.quantity}
                                onChange={e => updateLine(line.id, { quantity: Math.max(1, Number(e.target.value)) })}
                              />
                              <button
                                type="button"
                                onClick={() => updateLine(line.id, { quantity: line.quantity + 1 })}
                                className="w-8 h-8 flex items-center justify-center rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] transition-colors"
                              >
                                <Plus size={13} />
                              </button>
                            </div>
                          </div>

                          {/* Unit price */}
                          <div>
                            <label className="label-text">سعر الوحدة (ج.م) *</label>
                            <input
                              type="number"
                              min={0}
                              className="input-field font-mono"
                              value={line.unitPrice}
                              onChange={e => updateLine(line.id, { unitPrice: Number(e.target.value) })}
                            />
                          </div>

                          {/* Flashlight option for holder */}
                          {isHolder && (
                            <div className="sm:col-span-2 border border-amber-200 bg-amber-50 rounded-xl p-3">
                              <div className="flex items-center justify-between">
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    className="w-4 h-4 rounded"
                                    checked={line.includeFlashlight}
                                    onChange={e => updateLine(line.id, { includeFlashlight: e.target.checked })}
                                  />
                                  <span className="text-sm font-semibold">🔦 إضافة كشاف مع الحامل</span>
                                </label>
                                {line.includeFlashlight && (
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs text-[hsl(var(--muted-foreground))]">سعر الكشاف:</span>
                                    <input
                                      type="number"
                                      min={0}
                                      className="input-field w-20 text-center font-mono py-1 text-xs"
                                      value={line.flashlightPrice}
                                      onChange={e => updateLine(line.id, { flashlightPrice: Number(e.target.value) })}
                                    />
                                    <span className="text-xs text-[hsl(var(--muted-foreground))]">ج.م</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {isFlashlight && (
                            <div className="sm:col-span-2 bg-amber-50 border border-amber-200 rounded-xl p-3">
                              <p className="text-xs text-amber-700 font-semibold">💡 سعر الكشاف قابل للتعديل أعلاه</p>
                            </div>
                          )}

                          {/* Note per product */}
                          <div className="sm:col-span-2">
                            <label className="label-text">ملاحظة على هذا المنتج</label>
                            <input
                              type="text"
                              className="input-field"
                              placeholder="ملاحظة خاصة بهذا المنتج (اختياري)"
                              value={line.note}
                              onChange={e => updateLine(line.id, { note: e.target.value })}
                            />
                          </div>
                        </div>

                        {/* Line subtotal */}
                        <div className="mt-3 pt-3 border-t border-[hsl(var(--border))] flex items-center justify-between">
                          <span className="text-xs text-[hsl(var(--muted-foreground))]">
                            إجمالي هذا المنتج ({line.quantity} × {line.unitPrice} ج.م{line.includeFlashlight ? ` + ${line.flashlightPrice} ج.م كشاف` : ''}):
                          </span>
                          <span className="text-sm font-bold font-mono text-[hsl(var(--primary))]">
                            {lineTotal(line).toLocaleString('en-US')} ج.م
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
                      checked={expressShipping}
                      onChange={e => setExpressShipping(e.target.checked)}
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

                {/* Extra shipping fee — ADMIN ONLY */}
                {IS_ADMIN && (
                  <div className="border border-orange-200 bg-orange-50 rounded-2xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <DollarSign size={16} className="text-orange-600" />
                      <span className="text-sm font-bold">مصاريف شحن إضافية</span>
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
                        value={extraShippingFee}
                        onChange={e => setExtraShippingFee(Number(e.target.value))}
                      />
                      <span className="text-sm text-[hsl(var(--muted-foreground))]">ج.م</span>
                    </div>
                  </div>
                )}

                {/* Warranty */}
                <div>
                  <label className="label-text">فترة الضمان</label>
                  <select
                    className="input-field"
                    value={warranty}
                    onChange={e => setWarranty(e.target.value)}
                  >
                    {warrantyOptions.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </div>

                {/* General notes */}
                <div>
                  <label className="label-text">
                    <FileText size={13} className="inline ml-1" />
                    ملاحظات عامة على الأوردر
                  </label>
                  <textarea
                    rows={2}
                    className="input-field resize-none"
                    placeholder="أي ملاحظات إضافية للمندوب أو المستودع..."
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                  />
                </div>

                {/* Price summary */}
                <div className="bg-[hsl(var(--primary))]/5 border border-[hsl(var(--primary))]/20 rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Calculator size={16} className="text-[hsl(var(--primary))]" />
                    <span className="text-sm font-bold">ملخص الأسعار</span>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-[hsl(var(--muted-foreground))]">إجمالي المنتجات ({lines.length} صنف):</span>
                      <span className="font-mono font-semibold">{subtotal.toLocaleString('en-US')} ج.م</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[hsl(var(--muted-foreground))]">{expressShipping ? '⚡ شحن سريع:' : 'الشحن:'}</span>
                      <span className={`font-mono ${expressShipping ? 'text-amber-700' : ''}`}>{shippingCost} ج.م</span>
                    </div>
                    {IS_ADMIN && extraShippingFee > 0 && (
                      <div className="flex justify-between text-orange-700"><span>مصاريف إضافية:</span><span className="font-mono">+ {extraShippingFee.toLocaleString('en-US')} ج.م</span></div>
                    )}
                    <div className="border-t border-[hsl(var(--primary))]/20 pt-2 flex justify-between">
                      <span className="font-bold">الإجمالي الكلي:</span>
                      <span className="font-mono font-bold text-lg text-[hsl(var(--primary))]">
                        {grandTotal.toLocaleString('en-US')} ج.م
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex justify-between pt-2 gap-3">
                  <button type="button" className="btn-secondary" onClick={() => setStep(1)}>السابق</button>
                  <button
                    type="button"
                    className="btn-primary flex items-center gap-2"
                    onClick={() => { if (validateStep2()) setStep(3); }}
                  >
                    <Eye size={16} />
                    مراجعة الأوردر
                  </button>
                </div>
              </div>
            )}

            {/* ── Step 3: Review & Confirm ── */}
            {step === 3 && (
              <div className="space-y-5 fade-in">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle size={16} className="text-green-600" />
                  <h3 className="text-sm font-bold text-[hsl(var(--foreground))]">مراجعة الأوردر قبل التأكيد</h3>
                  <span className="text-xs text-[hsl(var(--muted-foreground))]">— تأكد من صحة جميع البيانات</span>
                </div>

                {/* Order number highlight */}
                <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-center">
                  <p className="text-xs text-blue-600 font-semibold mb-1">رقم الأوردر</p>
                  <p className="text-2xl font-bold font-mono text-blue-800">{orderNum}</p>
                  <p className="text-xs text-blue-500 mt-1">{currentDateTime.day} {currentDateTime.date} — {currentDateTime.time}</p>
                </div>

                {/* Customer info review */}
                <div className="border border-[hsl(var(--border))] rounded-2xl overflow-hidden">
                  <div className="bg-[hsl(var(--muted))]/50 px-4 py-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <User size={14} className="text-[hsl(var(--primary))]" />
                      <span className="text-xs font-bold text-[hsl(var(--foreground))]">بيانات العميل</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      className="text-xs text-[hsl(var(--primary))] hover:underline font-semibold"
                    >
                      تعديل
                    </button>
                  </div>
                  <div className="p-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-[10px] text-[hsl(var(--muted-foreground))] font-semibold mb-0.5">الاسم</p>
                      <p className="font-semibold">{customerName}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-[hsl(var(--muted-foreground))] font-semibold mb-0.5">الموبايل</p>
                      <p className="font-mono font-semibold">{phone}{phone2 ? ` / ${phone2}` : ''}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-[hsl(var(--muted-foreground))] font-semibold mb-0.5">المحافظة / المنطقة</p>
                      <p className="font-semibold">{governorate} — {district}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-[hsl(var(--muted-foreground))] font-semibold mb-0.5">الضمان</p>
                      <p className="font-semibold">{warranty}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-[10px] text-[hsl(var(--muted-foreground))] font-semibold mb-0.5">العنوان</p>
                      <p className="font-semibold text-xs leading-relaxed">{address}</p>
                    </div>
                    {notes && (
                      <div className="col-span-2">
                        <p className="text-[10px] text-[hsl(var(--muted-foreground))] font-semibold mb-0.5">ملاحظات</p>
                        <p className="text-xs text-[hsl(var(--muted-foreground))]">{notes}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Products review */}
                <div className="border border-[hsl(var(--border))] rounded-2xl overflow-hidden">
                  <div className="bg-[hsl(var(--muted))]/50 px-4 py-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Package size={14} className="text-[hsl(var(--primary))]" />
                      <span className="text-xs font-bold text-[hsl(var(--foreground))]">المنتجات ({lines.length} صنف)</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setStep(2)}
                      className="text-xs text-[hsl(var(--primary))] hover:underline font-semibold"
                    >
                      تعديل
                    </button>
                  </div>
                  <div className="divide-y divide-[hsl(var(--border))]">
                    {lines.map((line, index) => {
                      const card = productCards.find(p => p.value === line.productType);
                      return (
                        <div key={`review-line-${line.id}`} className="px-4 py-3 flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <span className="text-base">{card?.emoji || '📦'}</span>
                            <div>
                              <p className="font-semibold text-xs">
                                {card?.label || line.productType}
                                {line.color ? ` — ${line.color}` : ''}
                                {line.includeFlashlight ? ' + كشاف' : ''}
                              </p>
                              {line.note && <p className="text-[10px] text-[hsl(var(--muted-foreground))]">{line.note}</p>}
                            </div>
                          </div>
                          <div className="text-left">
                            <p className="font-mono font-bold text-[hsl(var(--primary))] text-xs">{lineTotal(line).toLocaleString('en-US')} ج.م</p>
                            <p className="text-[10px] text-[hsl(var(--muted-foreground))]">{line.quantity} × {line.unitPrice} ج.م</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Price summary review */}
                <div className="bg-[hsl(var(--primary))]/5 border border-[hsl(var(--primary))]/20 rounded-2xl p-4">
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-[hsl(var(--muted-foreground))]">إجمالي المنتجات:</span>
                      <span className="font-mono font-semibold">{subtotal.toLocaleString('en-US')} ج.م</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[hsl(var(--muted-foreground))]">
                        {expressShipping ? '⚡ شحن سريع:' : 'الشحن:'}
                      </span>
                      <span className={`font-mono ${expressShipping ? 'text-amber-700' : ''}`}>{shippingCost} ج.م</span>
                    </div>
                    {IS_ADMIN && extraShippingFee > 0 && (
                      <div className="flex justify-between text-orange-700">
                        <span>مصاريف إضافية:</span>
                        <span className="font-mono">+ {extraShippingFee.toLocaleString('en-US')} ج.م</span>
                      </div>
                    )}
                    <div className="border-t border-[hsl(var(--primary))]/20 pt-2 flex justify-between">
                      <span className="font-bold text-base">الإجمالي الكلي:</span>
                      <span className="font-mono font-bold text-xl text-[hsl(var(--primary))]">
                        {grandTotal.toLocaleString('en-US')} ج.م
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex justify-between pt-2 gap-3">
                  <button type="button" className="btn-secondary" onClick={() => setStep(2)}>السابق</button>
                  <button
                    type="button"
                    className="btn-primary flex-1 justify-center flex items-center gap-2"
                    disabled={isSubmitting}
                    onClick={handleSubmit}
                  >
                    {isSubmitting ? (
                      <span className="flex items-center gap-2 justify-center">
                        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                        جاري التسجيل...
                      </span>
                    ) : (
                      <>
                        <CheckCircle size={16} />
                        ✅ تأكيد وتسجيل الأوردر
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}