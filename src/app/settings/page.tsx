'use client';
import React, { useState } from 'react';
import AppLayout from '@/components/AppLayout';
import { Building2, Truck, Bell, Palette, Save, ChevronLeft, Globe, Phone, Mail, MapPin, Lock, Eye, EyeOff, Package, ToggleLeft, ToggleRight } from 'lucide-react';
import { GOVERNORATES_DISTRICTS, PRODUCT_TYPES, ADMIN_SETTINGS } from '@/app/orders-management/components/AddOrderModal';

type TabKey = 'company' | 'shipping' | 'notifications' | 'appearance' | 'security' | 'products' | 'districts';

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
  { id: 'appearance', label: 'المظهر', icon: <Palette size={18} /> },
  { id: 'security', label: 'الأمان', icon: <Lock size={18} /> },
];

function CompanyTab() {
  const [form, setForm] = useState({
    name: 'Zahranship', nameAr: 'شركة الزهراني للشحن',
    phone: '01012345678', email: 'info@zahranship.com',
    website: 'www.zahranship.com', address: 'القاهرة، مصر', taxId: '123456789',
  });
  const [saved, setSaved] = useState(false);
  const handleSave = () => { setSaved(true); setTimeout(() => setSaved(false), 2000); };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {[
          { label: 'اسم الشركة (إنجليزي)', key: 'name', icon: <Globe size={16} />, dir: 'ltr' },
          { label: 'اسم الشركة (عربي)', key: 'nameAr', icon: <Building2 size={16} />, dir: 'rtl' },
          { label: 'رقم الهاتف', key: 'phone', icon: <Phone size={16} />, dir: 'ltr' },
          { label: 'البريد الإلكتروني', key: 'email', icon: <Mail size={16} />, dir: 'ltr' },
          { label: 'الموقع الإلكتروني', key: 'website', icon: <Globe size={16} />, dir: 'ltr' },
          { label: 'العنوان', key: 'address', icon: <MapPin size={16} />, dir: 'rtl' },
          { label: 'الرقم الضريبي', key: 'taxId', icon: <Building2 size={16} />, dir: 'ltr' },
        ].map(field => (
          <div key={field.key}>
            <label className="block text-sm font-semibold mb-1.5">{field.label}</label>
            <div className="relative">
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]">{field.icon}</span>
              <input type="text" value={form[field.key as keyof typeof form]} onChange={(e) => setForm({ ...form, [field.key]: e.target.value })} dir={field.dir as 'ltr' | 'rtl'} className="w-full pr-9 pl-4 py-2.5 border border-[hsl(var(--border))] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30" />
            </div>
          </div>
        ))}
      </div>
      <button onClick={handleSave} className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all ${saved ? 'bg-green-500 text-white' : 'bg-[hsl(var(--primary))] text-white hover:opacity-90'}`}>
        <Save size={16} />{saved ? 'تم الحفظ ✓' : 'حفظ التغييرات'}
      </button>
    </div>
  );
}

function ShippingTab() {
  const [settings, setSettings] = useState({
    defaultShippingCost: '50', expressShippingCost: '100',
    freeShippingThreshold: '500', maxWeight: '20',
    defaultDeliveryDays: '3', enableCOD: true,
    enableTracking: true, autoAssign: false, requireSignature: true,
  });
  const [saved, setSaved] = useState(false);
  const handleSave = () => { setSaved(true); setTimeout(() => setSaved(false), 2000); };

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
        <p className="font-semibold mb-1">تكاليف الشحن الأساسية</p>
        <p className="text-xs text-blue-600">هذه الأسعار تُطبق تلقائيا على جميع الأوردرات الجديدة. يمكن إضافة مصاريف شحن إضافية لكل أوردر على حدة.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {[
          { label: 'تكلفة الشحن الافتراضية (ج.م)', key: 'defaultShippingCost' },
          { label: 'تكلفة الشحن السريع (ج.م)', key: 'expressShippingCost' },
          { label: 'حد الشحن المجاني (ج.م)', key: 'freeShippingThreshold' },
          { label: 'الحد الأقصى للوزن (كجم)', key: 'maxWeight' },
          { label: 'أيام التسليم الافتراضية', key: 'defaultDeliveryDays' },
        ].map(field => (
          <div key={field.key}>
            <label className="block text-sm font-semibold mb-1.5">{field.label}</label>
            <input type="number" value={settings[field.key as keyof typeof settings] as string} onChange={(e) => setSettings({ ...settings, [field.key]: e.target.value })} className="w-full px-4 py-2.5 border border-[hsl(var(--border))] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30" dir="ltr" />
          </div>
        ))}
      </div>
      <div className="space-y-3">
        <p className="text-sm font-bold text-[hsl(var(--foreground))]">خيارات الشحن</p>
        {[
          { key: 'enableCOD', label: 'تفعيل الدفع عند الاستلام (COD)' },
          { key: 'enableTracking', label: 'تفعيل تتبع الشحنات' },
          { key: 'autoAssign', label: 'التعيين التلقائي للمندوبين' },
          { key: 'requireSignature', label: 'اشتراط التوقيع عند التسليم' },
        ].map(opt => (
          <div key={opt.key} className="flex items-center justify-between p-4 border border-[hsl(var(--border))] rounded-xl">
            <span className="text-sm font-medium">{opt.label}</span>
            <button onClick={() => setSettings({ ...settings, [opt.key]: !settings[opt.key as keyof typeof settings] })} className={`relative w-11 h-6 rounded-full transition-colors ${settings[opt.key as keyof typeof settings] ? 'bg-[hsl(var(--primary))]' : 'bg-gray-300'}`}>
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${settings[opt.key as keyof typeof settings] ? 'right-0.5' : 'left-0.5'}`} />
            </button>
          </div>
        ))}
      </div>
      <button onClick={handleSave} className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all ${saved ? 'bg-green-500 text-white' : 'bg-[hsl(var(--primary))] text-white hover:opacity-90'}`}>
        <Save size={16} />{saved ? 'تم الحفظ ✓' : 'حفظ التغييرات'}
      </button>
    </div>
  );
}

function ProductsTab() {
  const [products, setProducts] = useState(
    PRODUCT_TYPES.map(p => ({ ...p, enabled: true }))
  );
  const [saved, setSaved] = useState(false);
  const handleSave = () => { setSaved(true); setTimeout(() => setSaved(false), 2000); };

  return (
    <div className="space-y-5">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
        <p className="font-semibold mb-1">إدارة المنتجات والأسعار</p>
        <p className="text-xs text-amber-600">يمكنك تعديل السعر الافتراضي لكل منتج. السعر قابل للتعديل أيضا عند إضافة كل أوردر.</p>
      </div>
      <div className="space-y-3">
        {products.map((product, i) => (
          <div key={product.value} className="flex items-center gap-4 p-4 border border-[hsl(var(--border))] rounded-xl bg-white">
            <span className="text-2xl">{product.image}</span>
            <div className="flex-1">
              <p className="text-sm font-semibold">{product.label}</p>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">{product.hasColor ? 'متوفر بألوان متعددة' : 'لون واحد'}</p>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-[hsl(var(--muted-foreground))]">السعر (ج.م)</label>
              <input
                type="number"
                min={0}
                dir="ltr"
                value={product.basePrice}
                onChange={(e) => {
                  const updated = [...products];
                  updated[i] = { ...updated[i], basePrice: Number(e.target.value) };
                  setProducts(updated);
                }}
                className="w-24 px-3 py-1.5 border border-[hsl(var(--border))] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30 text-center font-mono"
              />
            </div>
            <button
              onClick={() => {
                const updated = [...products];
                updated[i] = { ...updated[i], enabled: !updated[i].enabled };
                setProducts(updated);
              }}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors ${product.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
            >
              {product.enabled ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
              {product.enabled ? 'مفعل' : 'معطل'}
            </button>
          </div>
        ))}
      </div>
      <button onClick={handleSave} className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all ${saved ? 'bg-green-500 text-white' : 'bg-[hsl(var(--primary))] text-white hover:opacity-90'}`}>
        <Save size={16} />{saved ? 'تم الحفظ ✓' : 'حفظ التغييرات'}
      </button>
    </div>
  );
}

function DistrictsTab() {
  const [disabledDistricts, setDisabledDistricts] = useState<string[]>(ADMIN_SETTINGS.DISABLED_DISTRICTS);
  const [activeGov, setActiveGov] = useState('القاهرة');
  const [saved, setSaved] = useState(false);
  const handleSave = () => { setSaved(true); setTimeout(() => setSaved(false), 2000); };

  const toggleDistrict = (district: string) => {
    if (disabledDistricts.includes(district)) {
      setDisabledDistricts(disabledDistricts.filter(d => d !== district));
    } else {
      setDisabledDistricts([...disabledDistricts, district]);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
        <p className="font-semibold mb-1">إدارة مناطق التوصيل</p>
        <p className="text-xs text-blue-600">يمكنك تعطيل أي منطقة لمنع اختيارها عند إضافة الأوردرات. المناطق المعطلة لن تظهر في نموذج الإضافة.</p>
        <p className="text-xs text-blue-600 mt-1">المعطل حاليا: {disabledDistricts.length} منطقة</p>
      </div>

      {/* Governorate tabs */}
      <div className="flex gap-2">
        {Object.keys(GOVERNORATES_DISTRICTS).map(gov => (
          <button
            key={gov}
            onClick={() => setActiveGov(gov)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${activeGov === gov ? 'bg-[hsl(var(--primary))] text-white' : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--border))]'}`}
          >
            {gov}
          </button>
        ))}
      </div>

      {/* Districts grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {(GOVERNORATES_DISTRICTS[activeGov] || []).map(district => {
          const isDisabled = disabledDistricts.includes(district);
          return (
            <button
              key={district}
              onClick={() => toggleDistrict(district)}
              className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all text-right ${
                isDisabled
                  ? 'bg-red-50 border-red-200 text-red-600 line-through opacity-70' :'bg-green-50 border-green-200 text-green-700 hover:bg-green-100'
              }`}
            >
              <span className="truncate">{district}</span>
              <span className={`text-xs flex-shrink-0 ${isDisabled ? 'text-red-500' : 'text-green-600'}`}>
                {isDisabled ? '✗' : '✓'}
              </span>
            </button>
          );
        })}
      </div>

      <button onClick={handleSave} className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all ${saved ? 'bg-green-500 text-white' : 'bg-[hsl(var(--primary))] text-white hover:opacity-90'}`}>
        <Save size={16} />{saved ? 'تم الحفظ ✓' : 'حفظ التغييرات'}
      </button>
    </div>
  );
}

function NotificationsTab() {
  const [notifs, setNotifs] = useState({
    newOrder: true, orderDelivered: true, orderReturned: true,
    lowStock: true, dailyReport: false, weeklyReport: true,
    smsEnabled: false, emailEnabled: true, whatsappEnabled: true,
  });
  const [saved, setSaved] = useState(false);
  const handleSave = () => { setSaved(true); setTimeout(() => setSaved(false), 2000); };

  const groups = [
    { title: 'إشعارات الأوردرات', items: [{ key: 'newOrder', label: 'أوردر جديد' }, { key: 'orderDelivered', label: 'تم التسليم' }, { key: 'orderReturned', label: 'مرتجع جديد' }] },
    { title: 'إشعارات المخزون والتقارير', items: [{ key: 'lowStock', label: 'تنبيه مخزون منخفض' }, { key: 'dailyReport', label: 'تقرير يومي' }, { key: 'weeklyReport', label: 'تقرير أسبوعي' }] },
    { title: 'قنوات الإشعار', items: [{ key: 'smsEnabled', label: 'رسائل SMS' }, { key: 'emailEnabled', label: 'البريد الإلكتروني' }, { key: 'whatsappEnabled', label: 'واتساب' }] },
  ];

  return (
    <div className="space-y-5">
      {groups.map(group => (
        <div key={group.title} className="card-section p-5">
          <p className="text-sm font-bold mb-4">{group.title}</p>
          <div className="space-y-3">
            {group.items.map(item => (
              <div key={item.key} className="flex items-center justify-between">
                <span className="text-sm">{item.label}</span>
                <button onClick={() => setNotifs({ ...notifs, [item.key]: !notifs[item.key as keyof typeof notifs] })} className={`relative w-11 h-6 rounded-full transition-colors ${notifs[item.key as keyof typeof notifs] ? 'bg-[hsl(var(--primary))]' : 'bg-gray-300'}`}>
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${notifs[item.key as keyof typeof notifs] ? 'right-0.5' : 'left-0.5'}`} />
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
      <button onClick={handleSave} className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all ${saved ? 'bg-green-500 text-white' : 'bg-[hsl(var(--primary))] text-white hover:opacity-90'}`}>
        <Save size={16} />{saved ? 'تم الحفظ ✓' : 'حفظ التغييرات'}
      </button>
    </div>
  );
}

function AppearanceTab() {
  const [theme, setTheme] = useState('light');
  const [lang, setLang] = useState('ar');
  const [density, setDensity] = useState('comfortable');
  const [saved, setSaved] = useState(false);
  const handleSave = () => { setSaved(true); setTimeout(() => setSaved(false), 2000); };

  return (
    <div className="space-y-6">
      <div className="card-section p-5">
        <p className="text-sm font-bold mb-4">المظهر</p>
        <div className="grid grid-cols-3 gap-3">
          {[{ key: 'light', label: 'فاتح', preview: 'bg-white border-2' }, { key: 'dark', label: 'داكن', preview: 'bg-gray-800 border-2' }, { key: 'auto', label: 'تلقائي', preview: 'bg-gradient-to-l from-gray-800 to-white border-2' }].map(opt => (
            <button key={opt.key} onClick={() => setTheme(opt.key)} className={`p-4 rounded-xl border-2 transition-all ${theme === opt.key ? 'border-[hsl(var(--primary))]' : 'border-[hsl(var(--border))]'}`}>
              <div className={`h-12 rounded-lg mb-2 ${opt.preview}`} />
              <p className="text-xs font-semibold text-center">{opt.label}</p>
            </button>
          ))}
        </div>
      </div>
      <div className="card-section p-5">
        <p className="text-sm font-bold mb-4">اللغة والمنطقة</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold mb-1.5">اللغة</label>
            <select value={lang} onChange={(e) => setLang(e.target.value)} className="w-full border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30">
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1.5">كثافة العرض</label>
            <select value={density} onChange={(e) => setDensity(e.target.value)} className="w-full border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30">
              <option value="compact">مضغوط</option>
              <option value="comfortable">مريح</option>
              <option value="spacious">واسع</option>
            </select>
          </div>
        </div>
      </div>
      <button onClick={handleSave} className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all ${saved ? 'bg-green-500 text-white' : 'bg-[hsl(var(--primary))] text-white hover:opacity-90'}`}>
        <Save size={16} />{saved ? 'تم الحفظ ✓' : 'حفظ التغييرات'}
      </button>
    </div>
  );
}

function SecurityTab() {
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [saved, setSaved] = useState(false);
  const [twoFactor, setTwoFactor] = useState(false);
  const [sessionTimeout, setSessionTimeout] = useState('60');
  const handleSave = () => { setSaved(true); setTimeout(() => setSaved(false), 2000); };

  return (
    <div className="space-y-6">
      <div className="card-section p-5">
        <p className="text-sm font-bold mb-4">تغيير كلمة المرور</p>
        <div className="space-y-4 max-w-sm">
          {[{ label: 'كلمة المرور الحالية', show: showOld, toggle: () => setShowOld(!showOld) }, { label: 'كلمة المرور الجديدة', show: showNew, toggle: () => setShowNew(!showNew) }].map((field, i) => (
            <div key={i}>
              <label className="block text-sm font-semibold mb-1.5">{field.label}</label>
              <div className="relative">
                <input type={field.show ? 'text' : 'password'} className="w-full pr-4 pl-10 py-2.5 border border-[hsl(var(--border))] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30" placeholder="••••••••" dir="ltr" />
                <button onClick={field.toggle} className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]">
                  {field.show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="card-section p-5">
        <p className="text-sm font-bold mb-4">إعدادات الأمان</p>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">المصادقة الثنائية (2FA)</p>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">طبقة حماية إضافية عند تسجيل الدخول</p>
            </div>
            <button onClick={() => setTwoFactor(!twoFactor)} className={`relative w-11 h-6 rounded-full transition-colors ${twoFactor ? 'bg-[hsl(var(--primary))]' : 'bg-gray-300'}`}>
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${twoFactor ? 'right-0.5' : 'left-0.5'}`} />
            </button>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1.5">مهلة انتهاء الجلسة (دقيقة)</label>
            <select value={sessionTimeout} onChange={(e) => setSessionTimeout(e.target.value)} className="w-full max-w-xs border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30">
              <option value="30">30 دقيقة</option>
              <option value="60">ساعة واحدة</option>
              <option value="120">ساعتان</option>
              <option value="480">8 ساعات</option>
            </select>
          </div>
        </div>
      </div>
      <button onClick={handleSave} className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all ${saved ? 'bg-green-500 text-white' : 'bg-[hsl(var(--primary))] text-white hover:opacity-90'}`}>
        <Save size={16} />{saved ? 'تم الحفظ ✓' : 'حفظ التغييرات'}
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('company');

  const tabContent: Record<TabKey, React.ReactNode> = {
    company: <CompanyTab />,
    shipping: <ShippingTab />,
    products: <ProductsTab />,
    districts: <DistrictsTab />,
    notifications: <NotificationsTab />,
    appearance: <AppearanceTab />,
    security: <SecurityTab />,
  };

  return (
    <AppLayout currentPath="/settings">
      <div className="space-y-6 fade-in">
        <div>
          <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">الإعدادات</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">إدارة إعدادات النظام والتفضيلات</p>
        </div>

        <div className="flex flex-col lg:flex-row gap-6">
          <div className="lg:w-56 flex-shrink-0">
            <div className="card-section p-2">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all mb-1 last:mb-0 ${activeTab === tab.id ? 'bg-[hsl(var(--primary))] text-white' : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'}`}
                >
                  {tab.icon}
                  <span className="flex-1 text-right">{tab.label}</span>
                  {activeTab !== tab.id && <ChevronLeft size={14} />}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 min-w-0">
            {tabContent[activeTab]}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
