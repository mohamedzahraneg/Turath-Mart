'use client';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import AppLayout from '@/components/AppLayout';
import {
  Building2,
  Truck,
  Bell,
  Palette,
  Save,
  Globe,
  Phone,
  Mail,
  MapPin,
  Lock,
  MessageCircle,
  Clock,
  Loader2,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  X,
  Check,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type TabKey =
  | 'company'
  | 'shipping'
  | 'districts'
  | 'notifications'
  | 'appearance'
  | 'security'
  | 'warranty'
  | 'whatsapp';

interface Tab {
  id: TabKey;
  label: string;
  icon: React.ReactNode;
}

const tabs: Tab[] = [
  { id: 'company', label: 'بيانات الشركة', icon: <Building2 size={18} /> },
  { id: 'shipping', label: 'إعدادات الشحن', icon: <Truck size={18} /> },
  { id: 'districts', label: 'المناطق والشحن', icon: <MapPin size={18} /> },
  { id: 'notifications', label: 'الإشعارات', icon: <Bell size={18} /> },
  { id: 'warranty', label: 'فترات الضمان', icon: <Clock size={18} /> },
  { id: 'whatsapp', label: 'رسالة الواتساب', icon: <MessageCircle size={18} /> },
  { id: 'appearance', label: 'المظهر', icon: <Palette size={18} /> },
  { id: 'security', label: 'الأمان', icon: <Lock size={18} /> },
];

const DEFAULT_WA_TEMPLATE = `السلام عليكم {customerName} 🌟

تم تأكيد طلبك رقم #{orderNum} وجاري التجهيز

📦 المنتجات:
{products}

📍 العنوان: {address} - {district} - {governorate}
🚚 الشحن: {shippingCost} ج.م
💰 الإجمالي: {total} ج.م

🔗 تتبع طلبك: {trackingLink}

شكراً لتعاملك مع تراث مصر ✨`;

// ─── Shared Storage Hook ──────────────────────────────────────────────────────

function useSettingsSync<T>(key: string, initial: T) {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  const supabase = createClient();

  const load = useCallback(async () => {
    const { data: row, error } = await supabase
      .from('turath_masr_settings')
      .select('value')
      .eq('key', key)
      .single();
    if (!error && row?.value) {
      setData(row.value as T);
    }
    setLoading(false);
  }, [key]);

  const save = async (newData?: T) => {
    setSaving(true);
    const toSave = newData !== undefined ? newData : data;
    const { error } = await supabase
      .from('turath_masr_settings')
      .upsert({ key, value: toSave, updated_at: new Date().toISOString() });
    if (!error) {
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
      if (newData !== undefined) setData(newData);
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

// ─── Districts Tab ────────────────────────────────────────────────────────────
interface Region {
  id: string;
  name: string;
  fee: number;
  enabled: boolean;
  districts: { name: string; enabled: boolean }[];
}

import { useAuth } from '@/contexts/AuthContext';

function DistrictsTab() {
  const { currentRoleId } = useAuth();
  const isAdmin = currentRoleId === 'r1';

  const {
    data: regions,
    setData: setRegions,
    loading,
    saving,
    success,
    save,
  } = useSettingsSync<Region[]>('settings_regions', [
    { id: '1', name: 'القاهرة', fee: 50, enabled: true, districts: [
      { name: 'مدينة نصر', enabled: true },
      { name: 'المعادي', enabled: true },
      { name: 'هليوبوليس (مصر الجديدة)', enabled: true },
      { name: 'الزيتون', enabled: true },
      { name: 'شبرا', enabled: true },
      { name: 'المطرية', enabled: true },
      { name: 'عين شمس', enabled: true },
      { name: 'النزهة', enabled: true },
      { name: 'المرج', enabled: true },
      { name: 'الأميرية', enabled: true },
      { name: 'السيدة زينب', enabled: true },
      { name: 'الخليفة', enabled: true },
      { name: 'مصر القديمة', enabled: true },
      { name: 'حلوان', enabled: true },
      { name: 'المقطم', enabled: true },
      { name: 'التجمع الأول', enabled: true },
      { name: 'التجمع الخامس', enabled: true },
      { name: 'القاهرة الجديدة', enabled: true },
      { name: 'الرحاب', enabled: true },
      { name: 'مدينتي', enabled: true },
      { name: 'بدر', enabled: true },
      { name: 'العبور', enabled: true },
      { name: 'الشروق', enabled: true },
      { name: 'الزمالك', enabled: true },
      { name: 'جاردن سيتي', enabled: true },
      { name: 'بولاق', enabled: true },
      { name: 'الوايلي', enabled: true },
      { name: 'عابدين', enabled: true },
      { name: 'الأزبكية', enabled: true },
      { name: 'الموسكي', enabled: true },
      { name: 'الجمالية', enabled: true },
      { name: 'الدرب الأحمر', enabled: true },
      { name: 'منشأة ناصر', enabled: true },
      { name: 'دار السلام', enabled: true },
      { name: 'طره', enabled: true },
      { name: 'المعصرة', enabled: true },
      { name: 'التبين', enabled: true },
      { name: '15 مايو', enabled: true },
      { name: 'البساتين', enabled: true },
      { name: 'حدائق القبة', enabled: true },
      { name: 'الساحل', enabled: true },
      { name: 'الشرابية', enabled: true },
      { name: 'روض الفرج', enabled: true },
      { name: 'الزاوية الحمراء', enabled: true },
      { name: 'وسط البلد', enabled: true },
      { name: 'غرب القاهرة', enabled: true },
      { name: 'باب الشعرية', enabled: true },
    ] },
    { id: '2', name: 'الجيزة', fee: 50, enabled: true, districts: [
      { name: 'الدقي', enabled: true },
      { name: 'العجوزة', enabled: true },
      { name: 'المهندسين', enabled: true },
      { name: 'إمبابة', enabled: true },
      { name: 'بولاق الدكرور', enabled: true },
      { name: 'فيصل', enabled: true },
      { name: 'الهرم', enabled: true },
      { name: 'العمرانية', enabled: true },
      { name: 'أوسيم', enabled: true },
      { name: 'كرداسة', enabled: true },
      { name: 'أبو النمرس', enabled: true },
      { name: 'الحوامدية', enabled: true },
      { name: 'البدرشين', enabled: true },
      { name: 'الصف', enabled: true },
      { name: 'أطفيح', enabled: true },
      { name: 'المنيب', enabled: true },
      { name: 'الشيخ زايد', enabled: true },
      { name: '6 أكتوبر', enabled: true },
      { name: 'الحي الأول', enabled: true },
      { name: 'الحي الثاني', enabled: true },
      { name: 'الحي الثالث', enabled: true },
      { name: 'الحي الرابع', enabled: true },
      { name: 'الحي الخامس', enabled: true },
      { name: 'الحي السادس', enabled: true },
      { name: 'الحي السابع', enabled: true },
      { name: 'الحي الثامن', enabled: true },
      { name: 'الحي التاسع', enabled: true },
      { name: 'الحي العاشر', enabled: true },
      { name: 'الحي الحادي عشر', enabled: true },
      { name: 'الحي الثاني عشر', enabled: true },
      { name: 'الواحات البحرية', enabled: true },
      { name: 'سقارة', enabled: true },
      { name: 'أبو رواش', enabled: true },
      { name: 'الوراق', enabled: true },
      { name: 'منشأة القناطر', enabled: true },
    ] },
    { id: '3', name: 'القليوبية', fee: 60, enabled: true, districts: [
      { name: 'شبرا الخيمة', enabled: true },
      { name: 'قليوب', enabled: true },
      { name: 'بنها', enabled: true },
      { name: 'طوخ', enabled: true },
      { name: 'قها', enabled: true },
      { name: 'الخانكة', enabled: true },
      { name: 'الخصوص', enabled: true },
      { name: 'كفر شكر', enabled: true },
      { name: 'أبو زعبل', enabled: true },
      { name: 'مسطرد', enabled: true },
      { name: 'العبور', enabled: true },
      { name: 'القناطر الخيرية', enabled: true },
      { name: 'شبين القناطر', enabled: true },
      { name: 'الإبراهيمية', enabled: true },
    ] },
  ]);

  const [expanded, setExpanded] = useState<string | null>(null);

  if (loading)
    return (
      <div className="p-10 flex justify-center">
        <Loader2 className="animate-spin text-gray-300" />
      </div>
    );

  const addRegion = () => {
    if (!isAdmin) return;
    const newRegion: Region = {
      id: Date.now().toString(),
      name: 'محافظة جديدة',
      fee: 50,
      enabled: true,
      districts: [],
    };
    setRegions([...regions, newRegion]);
    setExpanded(newRegion.id);
  };

  const removeRegion = (id: string) => {
    if (!isAdmin) return;
    setRegions(regions.filter((r) => r.id !== id));
  };

  const updateRegion = (id: string, patch: Partial<Region>) => {
    setRegions(regions.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  return (
    <div className="space-y-8 fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-black text-gray-900">المناطق وتكاليف الشحن</h3>
          <p className="text-xs text-gray-500 font-bold uppercase tracking-widest mt-1">
            تخصيص أسعار شحن مختلفة لكل محافظة ومنطقة
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={addRegion}
            className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-xl text-xs font-black hover:bg-gray-800 transition-all active:scale-95"
          >
            <Plus size={14} />
            إضافة محافظة
          </button>
        )}
      </div>

      <div className="space-y-4">
        {regions.map((region) => (
          <div
            key={region.id}
            className={`border-2 rounded-[2rem] transition-all overflow-hidden ${expanded === region.id ? 'border-primary bg-white shadow-xl' : 'border-gray-50 bg-gray-50/30 hover:border-gray-100 hover:bg-gray-50/50'}`}
          >
            <div
              onClick={() => setExpanded(expanded === region.id ? null : region.id)}
              className="px-8 py-6 flex items-center justify-between cursor-pointer"
            >
              <div className="flex items-center gap-6">
                {isAdmin && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      updateRegion(region.id, { enabled: !region.enabled });
                    }}
                    className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black transition-all ${region.enabled !== false ? (expanded === region.id ? 'bg-primary text-white' : 'bg-green-500 text-white') : 'bg-red-100 text-red-400 border border-red-200'}`}
                    title={region.enabled !== false ? 'محافظة مفعّلة - اضغط للإلغاء' : 'محافظة ملغية - اضغط للتفعيل'}
                  >
                    {region.enabled !== false ? <MapPin size={20} /> : <X size={20} />}
                  </button>
                )}
                {!isAdmin && (
                  <div
                    className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black ${expanded === region.id ? 'bg-primary text-white' : 'bg-white text-gray-400 border border-gray-100'}`}
                  >
                    <MapPin size={20} />
                  </div>
                )}
                <div>
                  <h4 className="font-black text-gray-900">{region.name}</h4>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">
                    {region.districts.filter(d => typeof d === 'object' ? d.enabled : true).length}/{region.districts.length} منطقة مفعّلة — {region.fee} ج.م شحن
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                {isAdmin ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeRegion(region.id);
                    }}
                    className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={18} />
                  </button>
                ) : (
                  <div className="p-2 text-gray-200" title="مدير النظام فقط يملك صلاحية الحذف">
                    <Lock size={16} />
                  </div>
                )}
                {expanded === region.id ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
              </div>
            </div>

            {expanded === region.id && (
              <div className="px-8 pb-8 space-y-6 fade-in">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase px-1">
                      اسم المحافظة
                    </label>
                    <input
                      type="text"
                      disabled={!isAdmin}
                      value={region.name}
                      onChange={(e) => updateRegion(region.id, { name: e.target.value })}
                      className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-50 rounded-2xl text-sm font-bold focus:outline-none focus:border-primary/50 transition-all disabled:opacity-50"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase px-1">
                      تكلفة الشحن لهذه المحافظة
                    </label>
                    <input
                      type="number"
                      disabled={!isAdmin}
                      value={region.fee}
                      onChange={(e) => updateRegion(region.id, { fee: Number(e.target.value) })}
                      className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-50 rounded-2xl text-sm font-bold focus:outline-none focus:border-primary/50 transition-all font-mono disabled:opacity-50"
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-black text-gray-400 uppercase px-1">
                      المناطق والأحياء
                    </label>
                    {isAdmin && (
                      <button
                        onClick={() =>
                          updateRegion(region.id, { districts: [...region.districts, { name: '', enabled: true }] })
                        }
                        className="text-[10px] font-black text-primary hover:text-primary-dark transition-colors"
                      >
                        + إضافة منطقة
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {region.districts.map((district, idx) => {
                      const dName = typeof district === 'object' ? district.name : district;
                      const dEnabled = typeof district === 'object' ? district.enabled : true;
                      return (
                        <div key={idx} className={`relative group flex items-center gap-2 border-2 rounded-xl px-3 py-2 transition-all ${dEnabled ? 'border-gray-100 bg-white' : 'border-red-100 bg-red-50/30 opacity-60'}`}>
                          {isAdmin && (
                            <button
                              onClick={() => {
                                const newDistricts = [...region.districts];
                                if (typeof newDistricts[idx] === 'object') {
                                  (newDistricts[idx] as any).enabled = !dEnabled;
                                } else {
                                  newDistricts[idx] = { name: dName, enabled: !dEnabled } as any;
                                }
                                updateRegion(region.id, { districts: newDistricts });
                              }}
                              className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all ${dEnabled ? 'bg-green-500 border-green-500 text-white' : 'bg-white border-gray-300'}`}
                              title={dEnabled ? 'مفعّل - اضغط للإلغاء' : 'ملغي - اضغط للتفعيل'}
                            >
                              {dEnabled && <Check size={10} />}
                            </button>
                          )}
                          <input
                            type="text"
                            disabled={!isAdmin}
                            value={dName}
                            onChange={(e) => {
                              const newDistricts = [...region.districts];
                              if (typeof newDistricts[idx] === 'object') {
                                (newDistricts[idx] as any).name = e.target.value;
                              } else {
                                newDistricts[idx] = { name: e.target.value, enabled: true } as any;
                              }
                              updateRegion(region.id, { districts: newDistricts });
                            }}
                            className="flex-1 min-w-0 py-1 bg-transparent text-xs font-medium focus:outline-none disabled:opacity-50"
                            placeholder="اسم المنطقة..."
                          />
                          {isAdmin && (
                            <button
                              onClick={() => {
                                const newDistricts = region.districts.filter((_, i) => i !== idx);
                                updateRegion(region.id, { districts: newDistricts });
                              }}
                              className="text-gray-300 hover:text-red-500 transition-colors flex-shrink-0"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {isAdmin && (
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
          {success ? 'تم حفظ المناطق بنجاح' : 'حفظ إعدادات المناطق'}
        </button>
      )}
    </div>
  );
}


// ─── Warranty Tab ────────────────────────────────────────────────────────────
function WarrantyTab() {
  const { currentRoleId } = useAuth();
  const isAdmin = currentRoleId === 'r1';

  const {
    data: options,
    setData: setOptions,
    loading: loadingOpts,
    saving: savingOpts,
    success: successOpts,
    save: saveOpts,
  } = useSettingsSync<string[]>('settings_warranty', [
    'بدون ضمان',
    '3 أشهر',
    '6 أشهر',
    'سنة',
    'سنتان',
  ]);

  const {
    data: defaultWarranty,
    setData: setDefaultWarranty,
    loading: loadingDefault,
    saving: savingDefault,
    success: successDefault,
    save: saveDefault,
  } = useSettingsSync<string>('settings_warranty_default', 'بدون ضمان');

  if (loadingOpts || loadingDefault)
    return (
      <div className="p-10 flex justify-center">
        <Loader2 className="animate-spin text-gray-300" />
      </div>
    );

  return (
    <div className="space-y-8 fade-in">
      <div>
        <h3 className="text-xl font-black text-gray-900">فترات الضمان</h3>
        <p className="text-xs text-gray-500 font-bold uppercase tracking-widest mt-1">
          تحكم في خيارات الضمان المتاحة عند إنشاء أوردر جديد
        </p>
      </div>

      {/* Default warranty selection */}
      <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-6 space-y-3">
        <div className="flex items-center gap-2">
          <Clock size={18} className="text-amber-600" />
          <h4 className="text-sm font-black text-amber-800">مدة الضمان الافتراضية</h4>
        </div>
        <p className="text-xs text-amber-600 font-bold">
          هذه المدة ستُطبق تلقائياً على كل الطلبات الجديدة
        </p>
        <select
          disabled={!isAdmin}
          value={defaultWarranty}
          onChange={(e) => setDefaultWarranty(e.target.value)}
          className="w-full px-4 py-3 bg-white border-2 border-amber-200 rounded-xl text-sm font-bold focus:outline-none focus:border-amber-400 transition-all disabled:opacity-50"
        >
          {options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
        {isAdmin && (
          <button
            disabled={savingDefault}
            onClick={() => saveDefault()}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl text-xs font-black transition-all active:scale-95 ${successDefault ? 'bg-green-500 text-white' : 'bg-amber-600 text-white hover:bg-amber-700'}`}
          >
            {savingDefault ? <Loader2 className="animate-spin" size={14} /> : successDefault ? <Check size={14} /> : <Save size={14} />}
            {successDefault ? 'تم الحفظ' : 'حفظ الافتراضي'}
          </button>
        )}
      </div>

      {/* Warranty options list */}
      <div className="space-y-3">
        {options.map((opt, idx) => (
          <div key={idx} className={`flex items-center gap-3 border-2 rounded-2xl px-4 py-3 transition-all ${opt === defaultWarranty ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-50'}`}>
            <span className="text-sm font-bold text-gray-400 w-6">{idx + 1}.</span>
            {opt === defaultWarranty && <span className="text-[10px] font-black text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">افتراضي</span>}
            <input
              type="text"
              disabled={!isAdmin}
              value={opt}
              onChange={(e) => {
                const newOpts = [...options];
                newOpts[idx] = e.target.value;
                setOptions(newOpts);
              }}
              className="flex-1 bg-transparent text-sm font-bold focus:outline-none disabled:opacity-50"
              placeholder="فترة الضمان..."
            />
            {isAdmin && (
              <button
                onClick={() => setOptions(options.filter((_, i) => i !== idx))}
                className="text-gray-300 hover:text-red-500 transition-colors"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
      </div>

      {isAdmin && (
        <button
          onClick={() => setOptions([...options, ''])}
          className="flex items-center gap-2 text-sm font-black text-primary hover:text-primary-dark transition-colors"
        >
          <Plus size={14} />
          إضافة فترة ضمان جديدة
        </button>
      )}

      {isAdmin && (
        <button
          disabled={savingOpts}
          onClick={() => saveOpts()}
          className={`flex items-center gap-3 px-8 py-4 rounded-2xl text-sm font-black transition-all shadow-lg active:scale-95 ${successOpts ? 'bg-green-500 text-white shadow-green-100' : 'bg-gray-900 text-white shadow-gray-200 hover:bg-gray-800'}`}
        >
          {savingOpts ? (
            <Loader2 className="animate-spin" size={18} />
          ) : successOpts ? (
            <Check size={18} />
          ) : (
            <Save size={18} />
          )}
          {successOpts ? 'تم حفظ فترات الضمان بنجاح' : 'حفظ فترات الضمان'}
        </button>
      )}
    </div>
  );
}

// ─── WhatsApp Tab ─────────────────────────────────────────────────────────────
function WhatsAppTab() {
  const {
    data: template,
    setData: setTemplate,
    loading,
    saving,
    success,
    save,
  } = useSettingsSync('settings_whatsapp_template', DEFAULT_WA_TEMPLATE);

  if (loading)
    return (
      <div className="p-10 flex justify-center">
        <Loader2 className="animate-spin text-gray-300" />
      </div>
    );

  const placeholders = [
    { key: '{customerName}', label: 'اسم العميل' },
    { key: '{orderNum}', label: 'رقم الأوردر' },
    { key: '{total}', label: 'إجمالي المبلغ' },
    { key: '{trackingLink}', label: 'رابط التتبع' },
    { key: '{shippingCost}', label: 'تكلفة الشحن' },
    { key: '{address}', label: 'العنوان' },
    { key: '{district}', label: 'المنطقة' },
    { key: '{governorate}', label: 'المحافظة' },
    { key: '{products}', label: 'المنتجات' },
  ];

  return (
    <div className="space-y-8 fade-in">
      <div>
        <h3 className="text-xl font-black text-gray-900">قالب رسالة الواتساب</h3>
        <p className="text-xs text-gray-500 font-bold uppercase tracking-widest mt-1">
          هذه الرسالة تظهر للموظف عند الضغط على أيقونة الواتساب للأوردرات
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        <div className="flex-1 space-y-4">
          <div className="relative group">
            <textarea
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              className="w-full h-80 px-6 py-6 bg-gray-50 border-2 border-gray-50 rounded-[2rem] text-sm font-medium focus:outline-none focus:border-green-500/50 focus:bg-white transition-all leading-relaxed resize-none"
              dir="rtl"
            />
            <div className="absolute top-6 left-6 text-green-500">
              <MessageCircle size={24} />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {placeholders.map((p) => (
              <button
                key={p.key}
                onClick={() => setTemplate(template + p.key)}
                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-[10px] font-black text-gray-600 transition-all"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="lg:w-80 flex-shrink-0">
          <div className="bg-[#E4F2E4] rounded-[2.5rem] p-6 relative overflow-hidden h-full">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <MessageCircle size={100} className="text-green-900" />
            </div>
            <div className="relative z-10 space-y-4">
              <p className="text-[10px] font-black text-green-800/50 uppercase tracking-widest">
                استعراض الرسالة (تجريبي)
              </p>
              <div className="bg-white rounded-2xl p-4 shadow-sm text-xs leading-relaxed text-gray-700 whitespace-pre-wrap border-r-4 border-green-500">
                {template
                  .replace('{customerName}', 'محمد الزهراني')
                  .replace('{products}', '• حامل مصحف × 2 = 500 ج.م\n• كشاف × 1 = 200 ج.م')
                  .replace('{governorate}', 'القاهرة')
                  .replace('{district}', 'مدينة نصر')
                  .replace('{address}', '123 شارع النصر')
                  .replace('{shippingCost}', '50')
                  .replace('{orderNum}', '2603271')
                  .replace('{total}', '1450')
                  .replace('{trackingLink}', 'turathmasr.com/track/2603271')}
              </div>
              <div className="pt-4 flex items-center gap-2 text-[10px] font-bold text-green-800/40">
                <Clock size={12} />
                <span>يتم التحديث فورياً أثناء الكتابة</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <button
        disabled={saving}
        onClick={() => save()}
        className={`flex items-center gap-3 px-8 py-4 rounded-2xl text-sm font-black transition-all shadow-lg active:scale-95 ${success ? 'bg-green-500 text-white shadow-green-100' : 'bg-green-600 text-white shadow-green-100 hover:bg-green-700'}`}
      >
        {saving ? (
          <Loader2 className="animate-spin" size={18} />
        ) : success ? (
          <Check size={18} />
        ) : (
          <Save size={18} />
        )}
        {success ? 'تم حفظ القالب بنجاح' : 'حفظ قالب الرسالة'}
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
    districts: <DistrictsTab />,
    warranty: <WarrantyTab />,
    whatsapp: <WhatsAppTab />,
    notifications: (
      <div className="p-8 bg-gray-50 rounded-3xl text-center text-gray-400 italic font-bold text-sm">
        قريباً: واجهة متقدمة لإدارة قنوات الإشعارات (إيميل، SMS، نظام داخلي).
      </div>
    ),
    appearance: (
      <div className="p-8 bg-gray-50 rounded-3xl text-center text-gray-400 italic font-bold text-sm">
        قريباً: تخصيص ألوان الواجهة، اختيار الخطوط، وتحميل اللوجو المتقدم.
      </div>
    ),
    security: (
      <div className="p-8 bg-gray-50 rounded-3xl text-center text-gray-400 italic font-bold text-sm">
        قريباً: إدارة جلسات المستخدمين، سجلات تسجيل الدخول، وتغيير كلمات السر.
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
              إدارة هوية الشركة، أسعار الشحن الإقليمية، وقوالب التواصل الموحدة
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

