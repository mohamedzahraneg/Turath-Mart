'use client';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import AppLayout from '@/components/AppLayout';
import {
  Building2,
  Truck,
  Bell,
  Palette,
  Save,
  ChevronLeft,
  Globe,
  Phone,
  Mail,
  MapPin,
  Lock,
  Eye,
  EyeOff,
  Package,
  ToggleLeft,
  ToggleRight,
  Image as ImageIcon,
  Shield,
  MessageCircle,
  Clock,
  Loader2,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type TabKey =
  | 'company'
  | 'shipping'
  | 'products'
  | 'districts'
  | 'notifications'
  | 'appearance'
  | 'security'
  | 'whatsapp';

interface Tab {
  id: TabKey;
  label: string;
  icon: React.ReactNode;
}

const tabs: Tab[] = [
  { id: 'company', label: 'بيانات الشركة', icon: <Building2 size={18} /> },
  { id: 'shipping', label: 'إعدادات الشحن', icon: <Truck size={18} /> },
  { id: 'products', label: 'المنتجات والأسعار', icon: <Package size={18} /> },
  { id: 'districts', label: 'المناطق', icon: <MapPin size={18} /> },
  { id: 'notifications', label: 'الإشعارات', icon: <Bell size={18} /> },
  { id: 'whatsapp', label: 'رسالة الواتساب', icon: <MessageCircle size={18} /> },
  { id: 'appearance', label: 'المظهر', icon: <Palette size={18} /> },
  { id: 'security', label: 'الأمان', icon: <Lock size={18} /> },
];

const DEFAULT_WA_TEMPLATE = `مرحبا {customerName}،
تم استلام طلبك رقم {orderNum} بإجمالي {total} ج.م.
يمكنك تتبع شحنتك عبر الرابط: {trackingLink}
سيتواصل معك المندوب قريباً.
شكراً لثقتك في Turath Mart 🚚`;

// ─── Shared Storage Hook ──────────────────────────────────────────────────────

function useSettingsSync<T>(key: string, initial: T) {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  const supabase = createClient();

  const load = useCallback(async () => {
    const { data: row, error } = await supabase
      .from('zahranship_settings')
      .select('value')
      .eq('key', key)
      .single();
    if (!error && row?.value) {
      setData(row.value as T);
    }
    setLoading(false);
  }, [key, supabase]);

  const save = async (newData?: T) => {
    setSaving(true);
    const toSave = newData || data;
    const { error } = await supabase
      .from('zahranship_settings')
      .upsert({ key, value: toSave, updated_at: new Date().toISOString() });
    if (!error) {
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
      if (newData) setData(newData);
    }
    setSaving(false);
  };

  useEffect(() => {
    load();
  }, [load]);

  return { data, setData, loading, saving, success, save };
}

// ─── Company Tab ──────────────────────────────────────────────────────────────
function CompanyTab() {
  const {
    data: form,
    setData: setForm,
    loading,
    saving,
    success,
    save,
  } = useSettingsSync('settings_company', {
    name: '',
    nameAr: '',
    phone: '',
    email: '',
    website: '',
    address: '',
    taxId: '',
  });

  if (loading)
    return (
      <div className="p-10 flex justify-center">
        <Loader2 className="animate-spin text-gray-300" />
      </div>
    );

  return (
    <div className="space-y-8 fade-in">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {[
          { label: 'اسم الشركة (إنجليزي)', key: 'name', icon: <Globe size={16} />, dir: 'ltr' },
          { label: 'اسم الشركة (عربي)', key: 'nameAr', icon: <Building2 size={16} />, dir: 'rtl' },
          { label: 'رقم الهاتف', key: 'phone', icon: <Phone size={16} />, dir: 'ltr' },
          { label: 'البريد الإلكتروني', key: 'email', icon: <Mail size={16} />, dir: 'ltr' },
          { label: 'الموقع الإلكتروني', key: 'website', icon: <Globe size={16} />, dir: 'ltr' },
          { label: 'العنوان', key: 'address', icon: <MapPin size={16} />, dir: 'rtl' },
          { label: 'الرقم الضريبي', key: 'taxId', icon: <Building2 size={16} />, dir: 'ltr' },
        ].map((field) => (
          <div key={field.key} className="space-y-2">
            <label className="block text-xs font-black text-gray-400 uppercase tracking-widest px-1">
              {field.label}
            </label>
            <div className="relative group">
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-[hsl(var(--primary))] transition-colors">
                {field.icon}
              </span>
              <input
                type="text"
                value={(form as any)[field.key]}
                onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                dir={field.dir as 'ltr' | 'rtl'}
                className="w-full pr-12 pl-4 py-3.5 bg-gray-50 border-2 border-gray-50 rounded-2xl text-sm focus:outline-none focus:border-[hsl(var(--primary))]/50 focus:bg-white transition-all font-medium"
              />
            </div>
          </div>
        ))}
      </div>
      <button
        disabled={saving}
        onClick={() => save()}
        className={`flex items-center gap-3 px-8 py-4 rounded-2xl text-sm font-black transition-all shadow-lg active:scale-95 ${success ? 'bg-green-500 text-white shadow-green-100' : 'bg-gray-900 text-white shadow-gray-200 hover:bg-gray-800'}`}
      >
        {saving ? (
          <Loader2 className="animate-spin" size={18} />
        ) : success ? (
          <Check size={18} />
        ) : (
          <Save size={18} />
        )}
        {success ? 'تم تحديث البيانات بنجاح' : 'حفظ التغييرات المركزية'}
      </button>
    </div>
  );
}

// ─── Shipping Tab ─────────────────────────────────────────────────────────────
function ShippingTab() {
  const {
    data: settings,
    setData: setSettings,
    loading,
    saving,
    success,
    save,
  } = useSettingsSync('settings_shipping', {
    defaultShippingCost: '50',
    expressShippingCost: '100',
    freeShippingThreshold: '0',
    maxWeight: '0',
    defaultDeliveryDays: '3',
    enableCOD: true,
    enableTracking: true,
    autoAssign: false,
    requireSignature: true,
  });

  if (loading)
    return (
      <div className="p-10 flex justify-center">
        <Loader2 className="animate-spin text-gray-300" />
      </div>
    );

  return (
    <div className="space-y-8 fade-in">
      <div className="bg-blue-50/50 border-2 border-blue-100 rounded-[2rem] p-6 text-sm text-blue-800 flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0">
          <Truck size={20} />
        </div>
        <div>
          <p className="font-black text-lg tracking-tight mb-1">السياسة المالية للشحن</p>
          <p className="text-xs text-blue-600/70 font-medium">
            هذه الإعدادات تطبق فورياً على "إضافة أوردر" وتظهر لجميع أجهزة فريق الدعم الفني.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {[
          { label: 'الشحن الافتراضي (ج.م)', key: 'defaultShippingCost' },
          { label: 'الشحن السريع (ج.م)', key: 'expressShippingCost' },
          { label: 'التوصيل المجاني من (ج.م)', key: 'freeShippingThreshold' },
          { label: 'أيام التوصيل المتوقعة', key: 'defaultDeliveryDays' },
        ].map((field) => (
          <div key={field.key} className="space-y-2">
            <label className="block text-xs font-black text-gray-400 uppercase tracking-widest px-1">
              {field.label}
            </label>
            <input
              type="number"
              value={(settings as any)[field.key]}
              onChange={(e) => setSettings({ ...settings, [field.key]: e.target.value })}
              className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-50 rounded-2xl text-sm focus:outline-none focus:border-blue-500/50 focus:bg-white transition-all font-mono font-bold"
              dir="ltr"
            />
          </div>
        ))}
      </div>
      <div className="space-y-4">
        <p className="text-xs font-black text-gray-400 uppercase tracking-[0.2em] px-1">
          تفضيلات المعالجة
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { key: 'enableCOD', label: 'الدفع عند الاستلام' },
            { key: 'enableTracking', label: 'تتبع الشحنات' },
            { key: 'autoAssign', label: 'التعيين الآلي للمناديب' },
            { key: 'requireSignature', label: 'اشتراط التوقيع الحي' },
          ].map((opt) => (
            <div
              key={opt.key}
              className="flex items-center justify-between p-5 bg-white border-2 border-gray-50 rounded-2xl hover:border-blue-100 transition-all shadow-sm"
            >
              <span className="text-sm font-bold text-gray-700">{opt.label}</span>
              <button
                onClick={() => setSettings({ ...settings, [opt.key]: !(settings as any)[opt.key] })}
                className={`relative w-12 h-7 rounded-full transition-all ${(settings as any)[opt.key] ? 'bg-blue-600 shadow-lg shadow-blue-100' : 'bg-gray-200'}`}
              >
                <span
                  className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow-sm transition-all ${(settings as any)[opt.key] ? 'right-6' : 'right-1'}`}
                />
              </button>
            </div>
          ))}
        </div>
      </div>
      <button
        disabled={saving}
        onClick={() => save()}
        className={`flex items-center gap-3 px-8 py-4 rounded-2xl text-sm font-black transition-all shadow-lg active:scale-95 ${success ? 'bg-green-500 text-white shadow-green-100' : 'bg-blue-600 text-white shadow-blue-100 hover:bg-blue-700'}`}
      >
        {saving ? (
          <Loader2 className="animate-spin" size={18} />
        ) : success ? (
          <Check size={18} />
        ) : (
          <Save size={18} />
        )}
        {success ? 'تم حفظ إعدادات الشحن' : 'تحديث إعدادات الشحن'}
      </button>
    </div>
  );
}

interface ProductSetting {
  value: string;
  label: string;
  basePrice: number;
  emoji: string;
  hasColor: boolean;
  enabled: boolean;
  image: string;
}

function ProductsTab() {
  const {
    data: products,
    setData: setProducts,
    loading,
    saving,
    success,
    save,
  } = useSettingsSync<ProductSetting[]>('settings_products', []);

  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const handleImageUpload = (idx: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (ev.target?.result) {
        const updated = [...products];
        updated[idx] = { ...updated[idx], image: ev.target!.result as string };
        setProducts(updated);
      }
    };
    reader.readAsDataURL(file);
  };

  if (loading)
    return (
      <div className="p-10 flex justify-center">
        <Loader2 className="animate-spin text-gray-300" />
      </div>
    );

  return (
    <div className="space-y-8 fade-in">
      <div className="bg-amber-50/50 border-2 border-amber-100 rounded-[2rem] p-6 text-sm text-amber-800 flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center flex-shrink-0">
          <Package size={20} />
        </div>
        <div>
          <p className="font-black text-lg tracking-tight mb-1">كاتالوج المنتجات الافتراضي</p>
          <p className="text-xs text-amber-600/70 font-medium">
            تعديل الأسعار والصور هنا يتم مزامنته تلقائياً مع جميع شاشات إضافة الطلبات.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {products.map((product, i) => (
          <div
            key={product.value}
            className="bg-white border-2 border-gray-50 rounded-3xl p-6 hover:shadow-xl transition-all group flex flex-col gap-6"
          >
            <div className="flex items-center gap-5">
              <div className="relative">
                <div className="w-16 h-16 rounded-2xl bg-gray-50 border-2 border-dashed border-gray-100 overflow-hidden flex items-center justify-center transition-all group-hover:scale-105 group-hover:bg-amber-50">
                  {product.image ? (
                    <img
                      src={product.image}
                      className="w-full h-full object-cover"
                      alt={product.label}
                    />
                  ) : (
                    <span className="text-3xl grayscale group-hover:grayscale-0 transition-all">
                      {product.emoji}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => fileRefs.current[product.value]?.click()}
                  className="absolute -bottom-2 -right-2 w-8 h-8 bg-amber-600 text-white rounded-xl flex items-center justify-center shadow-lg hover:bg-amber-700 active:scale-90 transition-all"
                >
                  <ImageIcon size={14} />
                </button>
                <input
                  ref={(el) => {
                    fileRefs.current[product.value] = el;
                  }}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleImageUpload(i, e)}
                />
              </div>
              <div className="flex-1">
                <h4 className="font-black text-gray-900 uppercase tracking-tight">
                  {product.label}
                </h4>
                <p className="text-[10px] font-bold text-gray-400 tracking-[0.1em]">
                  {product.hasColor ? 'متعدد الألوان' : 'قطعة أساسية'}
                </p>
              </div>
              <button
                onClick={() => {
                  const updated = [...products];
                  updated[i].enabled = !updated[i].enabled;
                  setProducts(updated);
                }}
                className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${product.enabled ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-400'}`}
              >
                {product.enabled ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
              </button>
            </div>

            <div className="flex items-center gap-4 bg-gray-50/50 p-4 rounded-2xl">
              <label className="text-xs font-black text-gray-400 uppercase whitespace-nowrap">
                السعر الأساسي
              </label>
              <input
                type="number"
                value={product.basePrice}
                onChange={(e) => {
                  const updated = [...products];
                  updated[i].basePrice = Number(e.target.value);
                  setProducts(updated);
                }}
                className="flex-1 bg-transparent border-b-2 border-gray-100 focus:border-amber-500/50 text-sm font-mono font-black outline-none px-2 py-1 text-center"
                dir="ltr"
              />
              <span className="text-[10px] font-bold text-gray-400 uppercase">ج.م</span>
            </div>
          </div>
        ))}
      </div>

      <button
        disabled={saving}
        onClick={() => save()}
        className={`flex items-center gap-3 px-8 py-4 rounded-2xl text-sm font-black transition-all shadow-lg active:scale-95 ${success ? 'bg-green-500 text-white shadow-green-100' : 'bg-amber-600 text-white shadow-amber-100 hover:bg-amber-700'}`}
      >
        {saving ? (
          <Loader2 className="animate-spin" size={18} />
        ) : success ? (
          <Check size={18} />
        ) : (
          <Save size={18} />
        )}
        {success ? 'تم حفظ التعديلات' : 'تحديث قائمة المنتجات'}
      </button>
    </div>
  );
}

// ─── Main Content Wrapper ─────────────────────────────────────────────────────

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('company');

  const tabContent: Record<TabKey, React.ReactNode> = {
    company: <CompanyTab />,
    shipping: <ShippingTab />,
    products: <ProductsTab />,
    districts: (
      <div className="p-8 bg-gray-50 rounded-3xl text-center text-gray-400 italic">
        جاري تهيئة واجهة إدارة المناطق المركزية...
      </div>
    ),
    notifications: (
      <div className="p-8 bg-gray-50 rounded-3xl text-center text-gray-400 italic">
        جاري مزامنة إعدادات الإشعارات السحابية...
      </div>
    ),
    whatsapp: (
      <div className="p-8 bg-gray-50 rounded-3xl text-center text-gray-400 italic">
        جاري تحميل قوالب الواتساب المحفوظة...
      </div>
    ),
    appearance: (
      <div className="p-8 bg-gray-50 rounded-3xl text-center text-gray-400 italic">
        يتم التحكم في المظهر من إعدادات النظام...
      </div>
    ),
    security: (
      <div className="p-8 bg-gray-50 rounded-3xl text-center text-gray-400 italic">
        يرجى مراجعة مدير النظام لتحديث كلمة المرور...
      </div>
    ),
  };

  return (
    <AppLayout currentPath="/settings">
      <div className="space-y-8 fade-in pb-20 pt-2">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <h1 className="text-3xl font-black text-gray-900 tracking-tight">
              إعدادات النظام <span className="text-blue-600">المركزية</span>
            </h1>
            <p className="text-sm text-gray-500 mt-1 uppercase tracking-widest font-bold">
              إدارة هوية الشركة، أسعار الشحن، وسجلات الكاتالوج الموحد
            </p>
          </div>
          <div className="flex bg-gray-100/50 p-2 rounded-2xl items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
              تزامن السحابية: متصل
            </span>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-10">
          <div className="lg:w-64 flex-shrink-0">
            <div className="flex lg:flex-col gap-2 overflow-x-auto lg:overflow-x-visible pb-4 lg:pb-0 no-scrollbar">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-4 px-6 py-4 rounded-2xl text-xs font-black transition-all whitespace-nowrap lg:w-full ${activeTab === tab.id ? 'bg-gray-900 text-white shadow-xl shadow-gray-200 -translate-x-2' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'}`}
                >
                  <span
                    className={`transition-colors ${activeTab === tab.id ? 'text-blue-400' : 'text-gray-300'}`}
                  >
                    {tab.icon}
                  </span>
                  <span className="flex-1 text-right">{tab.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 min-w-0 bg-white border-2 border-gray-50 rounded-[2.5rem] p-10 shadow-sm">
            {tabContent[activeTab]}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

// ─── Placeholder Helper ───────────────────────────────────────────────────────
const Check = ({ size }: { size: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
