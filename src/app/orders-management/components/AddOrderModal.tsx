'use client';
import React, { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { toast } from 'sonner';
import { Toaster } from 'sonner';
import {
  X,
  Trash2,
  Package,
  User,
  MapPin,
  Phone,
  FileText,
  Zap,
  Calculator,
  ChevronDown,
  DollarSign,
  Plus,
  Minus,
  CheckCircle,
  Eye,
  Search,
  AlertTriangle,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { canUseAdminOnlyFinancialFields } from '@/lib/constants/roles';
import { isValidEgyptianMobile } from '@/lib/validators/phone';
import { normalizeArabic } from '@/lib/utils/arabic';
// Phase 22N — true hierarchy. The hierarchy transformer converts the
// raw `settings_regions` array (mixed legacy strings + Phase 22M
// objects) into nested top-level areas with `children`, applies the
// curated manual-rule overlay, and exposes lookup helpers. The fee
// resolver implements the three-level inheritance
// (neighborhood → area → governorate). Customer-facing wording in
// this modal NEVER uses "غير مفعلة"; disabled entries surface as
// "خارج نطاق التغطية حاليًا" so customers see one consistent message.
import {
  normalizeCoverageHierarchy,
  findArea,
  findNeighborhood,
  findNeighborhoodOccurrences,
  findCoverageOccurrences,
  searchCoverageByName,
  isParent,
  type CoverageSearchEntry,
} from '@/lib/shipping/coverageHierarchy';
import { resolveShippingFeeFromCoverage } from '@/lib/shipping/resolveShippingFee';
import type { ShippingDistrict, ShippingGovernorate } from '@/lib/shipping/types';
import { getDisplayName, getRoleLabel } from '@/lib/utils/userDisplay';
// Phase 22O — returning-customer smart card + lookup helpers. The
// card is presentational; the lookup function lives in this file
// (it owns the Supabase client + state).
import ReturningCustomerCard, {
  buildUniqueAddresses,
  normalizePhone,
  type ReturningCustomerLookup,
  type CustomerSummary,
  type PastAddress,
  type OrderRowForLookup,
} from './ReturningCustomerCard';

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
  القاهرة: [
    'مدينة نصر',
    'المعادي',
    'هليوبوليس (مصر الجديدة)',
    'الزيتون',
    'شبرا',
    'المطرية',
    'عين شمس',
    'النزهة',
    'المرج',
    'الأميرية',
    'السيدة زينب',
    'الخليفة',
    'مصر القديمة',
    'حلوان',
    'المقطم',
    'التجمع الأول',
    'التجمع الخامس',
    'القاهرة الجديدة',
    'الرحاب',
    'مدينتي',
    'بدر',
    'العبور',
    'الشروق',
    'الزمالك',
    'جاردن سيتي',
    'الدقي (القاهرة)',
    'بولاق',
    'الوايلي',
    'عابدين',
    'الأزبكية',
    'الموسكي',
    'الجمالية',
    'الدرب الأحمر',
    'منشأة ناصر',
    'دار السلام',
    'طره',
    'المعصرة',
    'بشتيل',
  ],
  الجيزة: [
    'الدقي',
    'العجوزة',
    'المهندسين',
    'إمبابة',
    'بولاق الدكرور',
    'فيصل',
    'الهرم',
    'العمرانية',
    'أوسيم',
    'كرداسة',
    'أبو النمرس',
    'الحوامدية',
    'البدرشين',
    'الصف',
    'أطفيح',
    'المنيب',
    'الشيخ زايد',
    '6 أكتوبر',
    'الحي الأول',
    'الحي الثاني',
    'الحي الثالث',
    'الحي الرابع',
    'الحي الخامس',
    'الحي السادس',
    'الحي السابع',
    'الحي الثامن',
    'الحي التاسع',
    'الحي العاشر',
    'الحي الحادي عشر',
    'الحي الثاني عشر',
    'الحي الثالث عشر',
    'الواحات البحرية',
    'سقارة',
    'أبو رواش',
  ],
  القليوبية: [
    'شبرا الخيمة',
    'قليوب',
    'بنها',
    'طوخ',
    'قها',
    'الخانكة',
    'الخصوص',
    'كفر شكر',
    'تلا',
    'منوف',
    'شبين الكوم',
    'أبو زعبل',
    'الجيزة (القليوبية)',
    'مسطرد',
    'العبور',
    'الإبراهيمية',
    'الزاوية الحمراء',
    'شبرا مصر',
  ],
};

export const ADMIN_SETTINGS = {
  SHIPPING_FEE: 0,
  EXPRESS_FEE: 100,
  DISABLED_DISTRICTS: [] as string[],
};

export const REGIONAL_FEES: Record<string, number> = {
  القاهرة: 50,
  الجيزة: 50,
  القليوبية: 60,
};

// NOTE: admin-only feature gating now derives from the authenticated user's
// role_id (via useAuth() inside the component), not a hardcoded constant.
// The previous `CURRENT_USER_ROLE = 'customer_service'` made IS_ADMIN
// permanently false, which silently disabled the extraShippingFee feature.

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
      .from('turath_masr_orders')
      .select('*', { count: 'exact', head: true })
      .like('order_num', `${prefix}%`);
    const seq = (count || 0) + 1;
    return `${prefix}${seq}`;
  } catch {
    // Fallback: use localStorage count + random
    try {
      const existing = JSON.parse(localStorage.getItem('turath_masr_orders') || '[]');
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

/**
 * Phase 22N-Fix1 — single suggestion-row renderer reused by both
 * "in this gov" and "other gov" sections of the area dropdown.
 * Customer-facing wording — never "غير مفعلة"; disabled entries
 * surface as "خارج التغطية" instead.
 */
function CoverageSuggestionRow({
  entry,
  governorate,
  onPick,
}: {
  entry: CoverageSearchEntry;
  governorate: string;
  onPick: () => void;
}) {
  const enabled = entry.enabled !== false && entry.governorateEnabled !== false;
  const sameGov = normalizeArabic(entry.governorateName) === normalizeArabic(governorate);
  const subtitle = (() => {
    if (entry.level === 0) return null;
    if (entry.level === 1) {
      return sameGov ? null : `محافظة ${entry.governorateName}`;
    }
    // level 2 — neighborhood
    return sameGov
      ? `تابع إلى ${entry.parentAreaName}`
      : `تابع إلى ${entry.parentAreaName} — محافظة ${entry.governorateName}`;
  })();
  return (
    <li
      onMouseDown={(e) => {
        e.preventDefault();
        onPick();
      }}
      className={`flex items-center justify-between gap-2 px-3 py-2 ${
        enabled ? 'cursor-pointer hover:bg-[hsl(var(--muted))]/40' : 'opacity-60 cursor-not-allowed'
      }`}
      role="option"
      aria-disabled={!enabled}
      aria-selected={false}
    >
      <span className="flex flex-col min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="font-medium">
            {entry.level === 0 ? `محافظة ${entry.name}` : entry.name}
          </span>
          {entry.level === 1 &&
            entry.type &&
            (entry.type === 'markaz' || entry.type === 'kism' || entry.type === 'city') && (
              <span className="text-[9px] text-slate-400">
                {entry.type === 'markaz' ? 'مركز' : entry.type === 'kism' ? 'قسم' : 'مدينة'}
              </span>
            )}
          {entry.level === 2 && <span className="text-[9px] text-slate-400">حي</span>}
        </span>
        {subtitle && (
          <span className="text-[10px] text-[hsl(var(--muted-foreground))]">{subtitle}</span>
        )}
      </span>
      <span className="flex items-center gap-1 text-[10px] flex-shrink-0">
        {!enabled && (
          <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-100">
            خارج التغطية
          </span>
        )}
      </span>
    </li>
  );
}

function lineTotal(line: OrderLine): number {
  const base = line.unitPrice * line.quantity;
  const flash = line.includeFlashlight ? line.flashlightPrice * line.quantity : 0;
  return base + flash;
}

export default function AddOrderModal({ onClose }: Props) {
  const { user, currentRoleId, currentRole, profileFullName } = useAuth();
  const IS_ADMIN = canUseAdminOnlyFinancialFields(currentRoleId);

  // Phase 22L — derive the display name + role for the order's
  // `created_by` audit field. Replaces the previous hardcoded
  // 'موظف خدمة عملاء' so a real admin or CS rep is recorded against
  // the order they create. Resolves through the shared helper so the
  // role label (currentRole / role-id fallback) is canonical.
  const createdByRoleLabel =
    currentRole && currentRole.trim() ? currentRole : getRoleLabel(currentRoleId ?? '');
  const createdByDisplayName = getDisplayName(
    [profileFullName, user?.user_metadata?.full_name, user?.email],
    createdByRoleLabel
  );

  const [orderNum, setOrderNum] = useState('جاري التحميل...');
  const [currentDateTime, setCurrentDateTime] = useState({ date: '', time: '', day: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [step, setStep] = useState(1);
  const [orderSuccess, setOrderSuccess] = useState(false);
  const [successOrderNum, setSuccessOrderNum] = useState('');
  // Phase 13C: server-generated tracking_token returned by the upsert. Used
  // to build the new /track/t/<token> link in the WhatsApp message; falls
  // back to /track/<order_num> when missing (defensive — never observed in
  // practice after Phase 13A backfilled every existing order).
  const [successTrackingToken, setSuccessTrackingToken] = useState<string | null>(null);
  const [waTemplate, setWaTemplate] = useState('');
  const [successPhone, setSuccessPhone] = useState('');
  const [successCustomer, setSuccessCustomer] = useState('');
  const [successTotal, setSuccessTotal] = useState(0);
  const [successLines, setSuccessLines] = useState<OrderLine[]>([]);

  // Form fields
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [phone2, setPhone2] = useState('');
  const [governorate, setGovernorate] = useState('القاهرة');
  const [district, setDistrict] = useState('');
  // Phase 22M-Fix1 — optional neighborhood / shiakha / village input.
  // When present and matches an entry under the selected area, validation
  // also requires it to be `enabled`. Persisted as part of the address
  // text only — see payload note in the PR description (no schema
  // change).
  const [neighborhood, setNeighborhood] = useState('');
  const [address, setAddress] = useState('');
  const [expressShipping, setExpressShipping] = useState(false);
  const [freeShipping, setFreeShipping] = useState(false);
  const [extraShippingFee, setExtraShippingFee] = useState(0);
  const [notes, setNotes] = useState('');
  const [warranty, setWarranty] = useState('بدون ضمان');
  const [defaultWarrantyLoaded, setDefaultWarrantyLoaded] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Phase 22O — returning-customer smart card. Replaces the old
  // single-order `historyMatch` block with a richer lookup against
  // both `turath_masr_customers` (canonical profile) and
  // `turath_masr_orders` (deduped past addresses). The card is
  // rendered by `ReturningCustomerCard` and stays decoupled from this
  // file's order-creation logic — the card only emits callbacks; the
  // form fields live here.
  const [customerLookup, setCustomerLookup] = useState<ReturningCustomerLookup>({
    status: 'idle',
    customer: null,
    addresses: [],
    addressesTotalBeforeCap: 0,
    errorMessage: null,
  });
  // When the agent clicks "إضافة كعميل جديد", we hide the card for the
  // rest of this modal session even if the typed phone still matches.
  // Resets on successful submit (next order) via resetForm.
  const [suppressCustomerLookup, setSuppressCustomerLookup] = useState(false);

  // Order lines
  const [lines, setLines] = useState<OrderLine[]>([]);

  // Inventory ref for stock limit checks
  const inventoryRef = useRef<InventoryItem[]>([]);

  // All product cards (default + inventory items)
  const [productCards, setProductCards] = useState<ProductCard[]>([]);

  // Dynamic regions from Supabase settings
  const [dbRegions, setDbRegions] = useState<any[]>([]);
  const [dbWarrantyOptions, setDbWarrantyOptions] = useState<string[]>([]);

  // Generate order number on mount
  useEffect(() => {
    generateOrderNumber().then((num) => setOrderNum(num));
  }, []);

  // Load WhatsApp template
  useEffect(() => {
    const loadWA = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('turath_masr_settings')
        .select('value')
        .eq('key', 'settings_whatsapp_template')
        .single();
      if (data?.value) setWaTemplate(data.value as string);
      else
        setWaTemplate(
          'السلام عليكم {customerName} 🌟\n\nتم تأكيد طلبك رقم #{orderNum} وجاري التجهيز\n\n📦 المنتجات:\n{products}\n\n📍 العنوان: {address} - {district} - {governorate}\n🚚 الشحن: {shippingCost} ج.م\n💰 الإجمالي: {total} ج.م\n\n🔗 تتبع طلبك: {trackingLink}\n\nشكراً لتعاملك مع تراث مصر ✨'
        );
    };
    loadWA();
  }, []);

  // Load products from settings + inventory on mount
  useEffect(() => {
    const fetchAllSettings = async () => {
      const supabase = createClient();

      // 1. Fetch all settings from DB
      const { data: sData } = await supabase.from('turath_masr_settings').select('*');
      const settingsMap = new Map(
        ((sData || []) as Array<{ key: string; value: unknown }>).map((s) => [s.key, s.value])
      );

      // 2. Extract Products
      const dbProducts =
        (settingsMap.get('settings_products') as any[]) ||
        PRODUCT_TYPES.map((p) => ({ ...p, enabled: true }));

      // 3. Extract Shipping
      const dbShipping = (settingsMap.get('settings_shipping') as any) || {};

      // 4. Extract Disabled Districts
      const dbDistricts = (settingsMap.get('settings_disabled_districts') as string[]) || [];

      // 5. Load ONLY inventory products (no default products)
      const { data: invData } = await supabase.from('turath_masr_inventory').select('*');
      const inventoryItems: InventoryItem[] = (invData || []).map((item: any) => ({
        id: item.id,
        name: item.name,
        sku: item.sku || '',
        available: item.available || 0,
        price: item.price || 0,
        category: item.category || '',
        images: item.images || [],
        colors: item.colors || [],
      }));
      const inventoryCards: ProductCard[] = inventoryItems.map((item) => ({
        value: item.id,
        label: item.name,
        basePrice: item.price,
        emoji: '📦',
        hasColor: (item.colors?.length || 0) > 0,
        image: item.images?.[0],
        isInventory: true,
        colors: item.colors,
        available: item.available,
      }));

      inventoryRef.current = inventoryItems;
      setProductCards(inventoryCards);

      // 3. Fetch Global Shipping Settings (for Express)
      const { data: shipData } = await supabase
        .from('turath_masr_settings')
        .select('value')
        .eq('key', 'settings_shipping')
        .single();

      if (shipData?.value) {
        const dbShipping = shipData.value as any;
        if (dbShipping.expressShippingCost) {
          ADMIN_SETTINGS.EXPRESS_FEE = Number(dbShipping.expressShippingCost);
        }
      }

      // 4. Fetch regional fees and districts from settings
      const { data: regionsData } = await supabase
        .from('turath_masr_settings')
        .select('value')
        .eq('key', 'settings_regions')
        .single();
      if (regionsData?.value && Array.isArray(regionsData.value)) {
        const regs = regionsData.value as any[];
        setDbRegions(regs);
        regs.forEach((r: any) => {
          if (r.name && r.fee && r.enabled !== false) {
            REGIONAL_FEES[r.name] = Number(r.fee);
          }
        });
      }

      // 5. Fetch warranty options from settings
      const { data: warrantyData } = await supabase
        .from('turath_masr_settings')
        .select('value')
        .eq('key', 'settings_warranty')
        .single();
      if (warrantyData?.value && Array.isArray(warrantyData.value)) {
        setDbWarrantyOptions(warrantyData.value as string[]);
      }

      // 6. Fetch default warranty from settings
      const { data: defaultWarrantyData } = await supabase
        .from('turath_masr_settings')
        .select('value')
        .eq('key', 'settings_warranty_default')
        .single();
      if (defaultWarrantyData?.value && typeof defaultWarrantyData.value === 'string') {
        setWarranty(defaultWarrantyData.value);
        setDefaultWarrantyLoaded(true);
      }
    };

    fetchAllSettings();
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

  // Phase 22N-Fix1 — when the user clicks a cross-governorate result
  // in the area dropdown, we set governorate + district + neighborhood
  // together. The two reset effects below would otherwise clear the
  // district + neighborhood as a side-effect of the gov / district
  // change. This ref lets the click-handler suppress ONE round of the
  // clears so the new values land cleanly. Reset to false after each
  // effect run so user-driven gov / area changes still clear properly.
  const skipNextCrossGovReset = useRef(false);

  // Reset district + neighborhood when governorate changes
  useEffect(() => {
    if (skipNextCrossGovReset.current) {
      // Suppress this clear and the follow-up district-change clear
      // — both fire as a result of the cross-gov pick.
      return;
    }
    setDistrict('');
    setNeighborhood('');
  }, [governorate]);

  // Reset neighborhood when district changes — the typed neighborhood
  // is contextual to the selected area, so changing the area clears it.
  useEffect(() => {
    if (skipNextCrossGovReset.current) {
      // Cross-gov pick already set the neighborhood explicitly; the
      // pick is the last in the same react event so we land here once
      // and clear the flag.
      skipNextCrossGovReset.current = false;
      return;
    }
    setNeighborhood('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [district]);

  // Phase 22O — returning-customer lookup. Debounced against the typed
  // phone (≥7 digits triggers, 300 ms quiet window). Runs two narrow
  // queries in parallel:
  //   • turath_masr_customers — canonical profile (full_name, totals)
  //   • turath_masr_orders     — past addresses (deduped, capped, sorted)
  //
  // The query is read-only. The card never writes; the only DB write
  // remains the order-creation upsert in handleSubmit.
  //
  // Cap kept at 5 unique addresses for this phase. When more exist,
  // the card surfaces the count in its header
  // ("العناوين السابقة (5 من 12)").
  const PAST_ADDRESS_CAP = 5;
  const PHONE_MIN_DIGITS_FOR_LOOKUP = 7;
  useEffect(() => {
    if (suppressCustomerLookup) return; // user clicked "إضافة كعميل جديد"
    const normalized = normalizePhone(phone);
    if (normalized.length < PHONE_MIN_DIGITS_FOR_LOOKUP) {
      setCustomerLookup({
        status: 'idle',
        customer: null,
        addresses: [],
        addressesTotalBeforeCap: 0,
        errorMessage: null,
      });
      return;
    }

    let cancelled = false;
    setCustomerLookup((prev) => ({ ...prev, status: 'loading' }));

    const t = window.setTimeout(async () => {
      try {
        const supabase = createClient();
        // Run both queries in parallel — neither blocks the other.
        const [{ data: customerRows, error: customerErr }, { data: orderRows, error: orderErr }] =
          await Promise.all([
            supabase
              .from('turath_masr_customers')
              .select('phone, full_name, total_spent, total_orders, updated_at')
              .eq('phone', normalized)
              .limit(1),
            supabase
              .from('turath_masr_orders')
              // Narrow select — no select('*') (Phase 20C-1 perf rule).
              // `phone2` lets the card surface the secondary number;
              // `date` + `created_at` drive ordering / "آخر طلب".
              .select(
                'order_num, customer, phone, phone2, region, district, neighborhood, address, total, status, date, created_at'
              )
              .eq('phone', normalized)
              .order('created_at', { ascending: false })
              .limit(50),
          ]);

        if (cancelled) return;
        if (customerErr || orderErr) {
          // Non-blocking — the modal still works without the card.
          // eslint-disable-next-line no-console
          console.warn(
            '[returning-customer-lookup]',
            customerErr?.message ?? orderErr?.message ?? 'unknown error'
          );
          setCustomerLookup({
            status: 'error',
            customer: null,
            addresses: [],
            addressesTotalBeforeCap: 0,
            errorMessage: customerErr?.message ?? orderErr?.message ?? null,
          });
          return;
        }

        const orders = (orderRows ?? []) as OrderRowForLookup[];
        if (orders.length === 0 && (!customerRows || customerRows.length === 0)) {
          setCustomerLookup({
            status: 'no-match',
            customer: null,
            addresses: [],
            addressesTotalBeforeCap: 0,
            errorMessage: null,
          });
          return;
        }

        // Build a CustomerSummary. Prefer the canonical
        // `turath_masr_customers` row when present; fall back to
        // aggregating the order rows (covers customers added via the
        // best-effort upsert that hasn't run yet).
        const canonical = customerRows?.[0] ?? null;
        const aggregated = orders.reduce(
          (acc, o) => {
            const t = Number(o.total) || 0;
            // Phase 22E reports use delivered-only revenue. The card
            // shows the LIFETIME revenue (delivered or not) so the
            // agent sees what the customer has agreed to spend, not
            // just what arrived. Documented in code so the deviation
            // is intentional, not a bug.
            acc.totalSpent += t;
            acc.totalOrders += 1;
            return acc;
          },
          { totalSpent: 0, totalOrders: 0 }
        );
        const lastOrderDate =
          orders[0]?.date ?? (orders[0]?.created_at ? orders[0].created_at.slice(0, 10) : null);
        const lastOrderPhone2 =
          (orders.find((o) => o.phone2 && o.phone2.trim()) as { phone2?: string } | undefined)
            ?.phone2 ?? null;

        const summary: CustomerSummary = {
          fullName: canonical?.full_name ?? orders[0]?.customer ?? null,
          phone: normalized,
          phone2: lastOrderPhone2,
          totalOrders:
            typeof canonical?.total_orders === 'number' && canonical.total_orders > 0
              ? canonical.total_orders
              : aggregated.totalOrders,
          totalSpent:
            typeof canonical?.total_spent === 'number' && canonical.total_spent > 0
              ? Number(canonical.total_spent)
              : aggregated.totalSpent,
          lastOrderDate,
        };

        const { addresses, totalBeforeCap } = buildUniqueAddresses(orders, PAST_ADDRESS_CAP);

        setCustomerLookup({
          status: 'match',
          customer: summary,
          addresses,
          addressesTotalBeforeCap: totalBeforeCap,
          errorMessage: null,
        });
      } catch (err) {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.warn('[returning-customer-lookup] threw', err);
        setCustomerLookup({
          status: 'error',
          customer: null,
          addresses: [],
          addressesTotalBeforeCap: 0,
          errorMessage: err instanceof Error ? err.message : null,
        });
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [phone, suppressCustomerLookup]);

  // Phase 22O — apply a returning-customer payload to the form. Used
  // by both "استخدام بيانات العميل" (close the card afterwards) and
  // "تحديث بيانات العميل" (keep card visible so the agent can edit).
  // The address argument can be `null` when the agent picks
  // "إضافة عنوان جديد" — that branch fills name + phone(s) but
  // CLEARS the region / district / neighborhood / address.
  const applyCustomerLookup = ({
    customer,
    address,
    closeCard,
  }: {
    customer: CustomerSummary;
    address: PastAddress | null;
    closeCard: boolean;
  }) => {
    if (customer.fullName) setCustomerName(customer.fullName);
    // Always rewrite phone fields so the form reflects the canonical
    // identity (e.g. typing `+201001234567` then clicking "use" keeps
    // the canonical `01001234567`).
    setPhone(customer.phone);
    if (customer.phone2) setPhone2(customer.phone2);

    if (address) {
      // Set region first; the existing useEffect on `governorate`
      // will normally clear district / neighborhood, but the
      // `skipNextCrossGovReset` ref (introduced in Phase 22N-Fix1)
      // suppresses that one round so our explicit values survive.
      skipNextCrossGovReset.current = true;
      setGovernorate(address.region);
      setDistrict(address.district ?? '');
      // Phase 22N-Fix3 — fill neighborhood when present. Legacy
      // orders may have null; the agent will be required to pick a
      // neighborhood at submit time if the resolved area has
      // children configured.
      setNeighborhood(address.neighborhood ?? '');
      setAddress(address.address);
    } else {
      // "إضافة عنوان جديد" — keep name + phone, clear address fields.
      // Don't fight the gov-change reset effect here; let it run.
      setGovernorate('القاهرة');
      setDistrict('');
      setNeighborhood('');
      setAddress('');
    }

    if (closeCard) {
      setCustomerLookup({
        status: 'idle',
        customer: null,
        addresses: [],
        addressesTotalBeforeCap: 0,
        errorMessage: null,
      });
      setSuppressCustomerLookup(true);
      toast.success('تم تحميل بيانات العميل السابقة بنجاح');
    } else {
      // "تحديث بيانات العميل" — keep the card so the agent can
      // continue picking other addresses or edit fields. Show a
      // brief confirmation.
      toast.success('تم تحميل البيانات — يمكنك تعديل أي حقل قبل الحفظ');
    }
  };

  const handleUseCustomer = (input: { customer: CustomerSummary; address: PastAddress | null }) => {
    applyCustomerLookup({ ...input, closeCard: true });
  };

  const handleUpdateCustomer = (input: {
    customer: CustomerSummary;
    address: PastAddress | null;
  }) => {
    applyCustomerLookup({ ...input, closeCard: false });
  };

  const handleTreatAsNew = () => {
    setSuppressCustomerLookup(true);
    setCustomerLookup({
      status: 'idle',
      customer: null,
      addresses: [],
      addressesTotalBeforeCap: 0,
      errorMessage: null,
    });
    // Clear name + address so the agent starts a fresh entry. Keep
    // the typed phone (the whole point of this branch).
    setCustomerName('');
    setAddress('');
    setNeighborhood('');
    // Don't touch governorate/district — the default is fine.
  };

  // Get available districts from DB regions (with enable/disable support)
  const availableDistricts: string[] = (() => {
    const region = dbRegions.find((r: any) => r.name === governorate && r.enabled !== false);
    if (region && region.districts) {
      return region.districts
        .filter((d: any) => (typeof d === 'object' ? d.enabled !== false : true))
        .map((d: any) => (typeof d === 'object' ? d.name : d))
        .filter((name: string) => name && name.trim());
    }
    // Fallback to hardcoded if DB not loaded yet
    return (GOVERNORATES_DISTRICTS[governorate] || []).filter(
      (d) => !ADMIN_SETTINGS.DISABLED_DISTRICTS.includes(d)
    );
  })();

  // Phase 22M — full coverage scan with metadata.
  //
  // The 22K scan only carried `{ name, gov }` for ENABLED districts in
  // ENABLED governorates, so we couldn't differentiate "exists but
  // disabled" from "doesn't exist at all". The 22M scan keeps the
  // governorate-disabled filter for the canonical-match path but
  // ALSO emits an `allDistrictsScan` that includes disabled
  // entries + parent metadata. This drives:
  //
  //   • the "موجودة ولكنها غير مفعلة ضمن التغطية حاليًا" message
  //     (district exists in the live row with enabled=false),
  //   • the "هذا الحي تابع إلى المنطقة X — محافظة Y" message
  //     (the typed value matches an entry whose `parent` is set —
  //     i.e. a neighborhood — so we surface its city + governorate),
  //   • the "خارج نطاق التغطية حاليًا" fallback when nothing
  //     matches at all.
  //
  // Local types kept inline to avoid widening dbRegions:any across
  // the file. The wider clean-up is out of scope for 22M.
  type DistrictEntry =
    | { name?: string; enabled?: boolean; parent?: string; type?: string }
    | string;
  type RegionEntry = {
    name?: string;
    enabled?: boolean;
    districts?: DistrictEntry[];
  };

  type CoverageScanRow = {
    name: string;
    gov: string;
    govEnabled: boolean;
    enabled: boolean;
    parent?: string;
    type?: string;
  };

  const allDistrictsScan: CoverageScanRow[] = (() => {
    if (dbRegions.length === 0) {
      return Object.entries(GOVERNORATES_DISTRICTS).flatMap(([gov, districts]) =>
        (districts as string[]).map((name) => ({
          name,
          gov,
          govEnabled: true,
          enabled: !ADMIN_SETTINGS.DISABLED_DISTRICTS.includes(name),
        }))
      );
    }
    return (dbRegions as RegionEntry[]).flatMap((r) =>
      (r.districts || [])
        .map((d) => {
          if (typeof d === 'string') {
            return {
              name: d.trim(),
              gov: (r.name ?? '').trim(),
              govEnabled: r.enabled !== false,
              enabled: true,
              parent: undefined as string | undefined,
              type: undefined as string | undefined,
            };
          }
          return {
            name: String(d?.name ?? '').trim(),
            gov: (r.name ?? '').trim(),
            govEnabled: r.enabled !== false,
            enabled: d?.enabled !== false,
            parent: d?.parent ? String(d.parent).trim() : undefined,
            type: d?.type ? String(d.type) : undefined,
          };
        })
        .filter((d) => d.name && d.gov)
    );
  })();

  // 22K-shaped slim scan kept for callers that only care about the
  // enabled/enabled subset. Derived from `allDistrictsScan` so the
  // two never disagree.
  const allCoveredDistricts: Array<{ name: string; gov: string }> = allDistrictsScan
    .filter((d) => d.govEnabled && d.enabled)
    .map((d) => ({ name: d.name, gov: d.gov }));

  // Search state for the district input. Suggestions are shown while
  // the user is focused or actively typing. Click on a suggestion sets
  // the canonical district name and closes the dropdown.
  const [showDistrictSuggestions, setShowDistrictSuggestions] = useState(false);
  // Phase 22N-Fix3 — neighborhood input gets its own focus-driven
  // popover (same UX as the district dropdown). The previous
  // implementation rendered an inline `<ul>` underneath the input
  // which read like a duplicate field.
  const [showNeighborhoodSuggestions, setShowNeighborhoodSuggestions] = useState(false);
  const districtNorm = normalizeArabic(district);

  // (Phase 22M — `districtSuggestions` superseded by `areaSuggestionRows`
  // below in Phase 22M-Fix1, which carries the enabled flag, type,
  // and source so the dropdown can render badges. The old slim
  // string[] is retired with the dropdown rewrite.)

  // ─── Phase 22N — true coverage hierarchy ───────────────────────────────────
  // Replaces the Phase 22M-Fix1 search-index helpers with a hierarchy
  // transformer. The transformer reads the live `settings_regions`
  // array (mixed legacy + Phase 22M shape) and produces nested top-
  // level areas with `children` populated. Manual rules add the
  // commercial parent → child links the live data is missing
  // (e.g. التجمع الخامس → القاهرة الجديدة) WITHOUT writing to the DB.
  //
  // The new helper exposes everything the modal needs: lookups
  // (`findArea` / `findNeighborhood`), grouped flat search index, and
  // the ambiguous "this neighborhood lives under multiple parents"
  // result via `findNeighborhoodOccurrences`.
  // Phase 22N-Fix2 — `includeGeneratedPlaceholders: false` keeps the
  // hierarchy view aligned with `settings_regions` exactly. Names from
  // `MANUAL_HIERARCHY_RULES` that don't exist in the live row no
  // longer appear in this modal — settings is the single source of
  // truth for what a customer can pick. If a name is in the rules
  // file but NOT in `settings_regions`, typing it surfaces
  // "خارج نطاق التغطية حاليًا" via the existing match logic; admins
  // can audit the full proposal via the dry-run / quality-report
  // scripts which still use the placeholder-included view.
  const hierarchicalRegions: ShippingGovernorate[] = (() => {
    if (dbRegions.length === 0) return [];
    return normalizeCoverageHierarchy(dbRegions, {
      includeGeneratedPlaceholders: false,
    });
  })();
  // (`flattenCoverageHierarchy(hierarchicalRegions)` was used by an
  // earlier draft of this layer for governorate-level autosuggest;
  // the modal currently uses domain lookups (`findArea`,
  // `findNeighborhoodOccurrences`) directly. The flat index helper
  // remains exported for the settings page + future search UX.)

  // Currently-selected area as a domain entity (carries `children`,
  // `fee`, etc.). `null` when the user hasn't typed a valid area yet.
  const selectedAreaEntry: ShippingDistrict | null = (() => {
    if (!district.trim()) return null;
    return findArea(governorate, district, hierarchicalRegions);
  })();
  // Selected governorate domain entity (for the gov-level fee).
  const selectedGovEntry: ShippingGovernorate | null = (() => {
    const gov = hierarchicalRegions.find(
      (g) => normalizeArabic(g.name) === normalizeArabic(governorate)
    );
    return gov ?? null;
  })();
  // Children of the currently-selected area (could be empty when the
  // area is a leaf — most CAPMAS markaz/kism have no curated children).
  const availableNeighborhoods: ShippingDistrict[] = (selectedAreaEntry?.children ?? []).slice();
  const areaHasChildren = isParent(selectedAreaEntry ?? ({ name: '' } as ShippingDistrict));
  // Currently-typed / selected neighborhood resolved against the area.
  const selectedNeighborhoodEntry: ShippingDistrict | null = (() => {
    if (!neighborhood.trim() || !selectedAreaEntry) return null;
    return findNeighborhood(governorate, selectedAreaEntry.name, neighborhood, hierarchicalRegions);
  })();
  const neighborhoodNorm = normalizeArabic(neighborhood);
  const neighborhoodSuggestions = (() => {
    if (!neighborhoodNorm) return availableNeighborhoods;
    return availableNeighborhoods.filter((n) => normalizeArabic(n.name).includes(neighborhoodNorm));
  })();

  // ─── Phase 22N-Fix1 — cross-governorate area dropdown ────────────────────
  // The dropdown now searches ALL governorates so duplicate names like
  // `الهرم` (الجيزة top-level enabled) vs `الهرم` (تابع إلى مركز
  // الواسطى — محافظة بنى سويف, disabled) both appear. Results are
  // partitioned into two sections by `governorateName`:
  //   • داخل {selected-gov}
  //   • نتائج في محافظات أخرى
  // When the typed query is empty, we fall back to listing the
  // selected governorate's top-level areas (so the dropdown stays
  // populated for first-focus before the user types).
  const SUGGESTION_LIMIT_PER_SECTION = 50;
  const areaSuggestionsAll: CoverageSearchEntry[] = (() => {
    if (!districtNorm) {
      // Empty query: list top-level areas in the selected gov.
      const gov = selectedGovEntry;
      if (!gov) return [];
      const out: CoverageSearchEntry[] = [];
      for (const a of gov.districts ?? []) {
        out.push({
          governorateName: gov.name,
          governorateEnabled: gov.enabled !== false,
          level: 1,
          name: a.name,
          displayName: `${a.name} — محافظة ${gov.name}`,
          enabled: a.enabled !== false,
          source: a.source,
          needsReview: a.needsReview,
          type: a.type,
          aliases: a.aliases,
          fee: a.fee ?? null,
          shippingFee: a.shippingFee ?? null,
          canonicalDistrictName: a.name,
          searchableText: normalizeArabic(a.name),
        });
      }
      return out;
    }
    // Substring search across every governorate / area / neighborhood.
    return searchCoverageByName(district, hierarchicalRegions, {
      matchMode: 'substring',
    });
  })();
  const areaSuggestionsInGov = areaSuggestionsAll.filter(
    (e) => normalizeArabic(e.governorateName) === normalizeArabic(governorate)
  );
  const areaSuggestionsOtherGov = areaSuggestionsAll.filter(
    (e) => normalizeArabic(e.governorateName) !== normalizeArabic(governorate)
  );

  // Phase 22M — disabled-but-known matches in the CURRENT governorate.
  // These are entries the admin has explicitly turned OFF in
  // /settings; they should NOT appear as selectable canonicals, but
  // when the user types one we tell them "موجودة ولكنها غير مفعلة"
  // instead of mis-routing them through the generic out-of-coverage
  // message.
  const disabledMatchInCurrentGov: CoverageScanRow | null = (() => {
    if (!districtNorm) return null;
    return (
      allDistrictsScan.find(
        (d) => d.gov === governorate && !d.enabled && normalizeArabic(d.name) === districtNorm
      ) ?? null
    );
  })();

  // Phase 22M — neighborhood-level match anywhere. Surfaces a hint
  // when the user types a child entry (one with `parent` set), so
  // they know which city/markaz the neighborhood belongs to. Live
  // production rows currently carry no parents, so this never
  // triggers today; once the Phase 22M seed is imported it will.
  const neighborhoodMatch: CoverageScanRow | null = (() => {
    if (!districtNorm) return null;
    return (
      allDistrictsScan.find((d) => d.parent && normalizeArabic(d.name) === districtNorm) ?? null
    );
  })();

  // Phase 22K-Fix1 — strict exact match for validation + inline hint.
  //
  // The dropdown above keeps SUBSTRING matching (autocomplete utility
  // — types "هرم" → suggestion "الهرم" appears so the user can click
  // it). Validation and the inline hint, however, use EXACT normalised
  // equality so the saved order is always tied to a configured
  // district. This matches the Phase 22K-Fix1 spec:
  //
  //   • If the typed value canonically equals a district inside the
  //     CURRENT governorate → valid; the order persists the canonical
  //     name, not the raw input.
  //   • If it canonically equals a district under ANOTHER governorate
  //     → block submit and instruct the user to switch governorate.
  //   • Otherwise → "out of coverage", block submit.
  //
  // canonicalDistrictMatch is the canonical name from settings when
  // the user's input matches it exactly under the current governorate.
  // It is the ONLY value the order payload uses below.
  const canonicalDistrictMatch: string | null = (() => {
    if (!districtNorm) return null;
    return availableDistricts.find((d) => normalizeArabic(d) === districtNorm) ?? null;
  })();

  // Other governorates whose canonical districts EXACTLY match the
  // typed query. Drives the "تابعة إلى محافظة X" message. Distinct on
  // (gov, canonical-name) so the same gov can't be listed twice when
  // multiple canonicals collide on normalisation.
  const crossGovExactMatches: Array<{ name: string; gov: string }> = (() => {
    if (!districtNorm) return [];
    const seen = new Set<string>();
    const out: Array<{ name: string; gov: string }> = [];
    for (const d of allCoveredDistricts) {
      if (d.gov === governorate) continue;
      if (normalizeArabic(d.name) !== districtNorm) continue;
      const key = `${d.gov}|${d.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(d);
    }
    return out;
  })();

  // Distinct list of OTHER governorates that cover the typed area
  // exactly. Drives the wording in both the inline hint and the
  // submit error.
  const crossGovExactNames: string[] = (() => {
    const set = new Set<string>();
    for (const m of crossGovExactMatches) set.add(m.gov);
    return Array.from(set);
  })();

  // (See declaration earlier in this component for the rest of the
  // Phase 22M-Fix1 layer — coverageIndex, areaSuggestionRows,
  // selectedAreaEntry, neighborhoodDecision, neighborhoodSuggestions.)
  // Phase 22N — area-level decision (customer-facing wording). Replaces
  // the Phase 22M-Fix1 admin-flavoured messages: "غير مفعلة" never
  // surfaces to a customer; disabled entries say "خارج نطاق التغطية"
  // instead. Priority ladder, byte-for-byte shared with `validateStep1`
  // to guarantee inline hint and submit error stay aligned:
  //
  //   1. empty                         → null (handled by "المنطقة مطلوبة")
  //   2. valid (enabled gov + enabled area)
  //                                    → null (valid)
  //   3. governorate disabled          → "هذه المحافظة خارج نطاق التغطية حاليًا"
  //   4. exact match in this gov, but disabled area
  //                                    → "هذه المنطقة خارج نطاق التغطية حاليًا"
  //   5. neighborhood under one parent in this gov
  //                                    → "هذا الحي تابع إلى ${parent}"
  //   6. exact match in another gov
  //                                    → "هذه المنطقة تابعة إلى محافظة …"
  //   7. unknown                       → "خارج نطاق التغطية حاليًا"
  const districtStrictError: string | null = (() => {
    if (!district.trim()) return null;
    if (canonicalDistrictMatch) {
      // Validate also the gov + area enabled state.
      const govEnabled = selectedGovEntry?.enabled !== false;
      const areaEnabled = selectedAreaEntry?.enabled !== false;
      if (!govEnabled) return 'هذه المحافظة خارج نطاق التغطية حاليًا.';
      if (!areaEnabled) return 'هذه المنطقة خارج نطاق التغطية حاليًا.';
      return null;
    }
    // Look across the hierarchical regions for the typed value.
    const occurrences = findNeighborhoodOccurrences(district, hierarchicalRegions);
    const sameGovHit = occurrences.find(
      (o) => normalizeArabic(o.governorate.name) === normalizeArabic(governorate)
    );
    if (sameGovHit) {
      return `هذا الحي تابع إلى ${sameGovHit.area.name} - محافظة ${sameGovHit.governorate.name}.`;
    }
    if (occurrences.length > 0) {
      const first = occurrences[0];
      return `هذا الحي تابع إلى ${first.area.name} - محافظة ${first.governorate.name}.`;
    }
    if (neighborhoodMatch && neighborhoodMatch.parent) {
      // Fallback to the legacy index hint (kept for Phase 22M data
      // that still relies on the flat scan).
      return `هذا الحي تابع إلى ${neighborhoodMatch.parent} - محافظة ${neighborhoodMatch.gov}.`;
    }
    if (disabledMatchInCurrentGov) {
      return 'هذه المنطقة خارج نطاق التغطية حاليًا.';
    }
    if (crossGovExactNames.length === 1) {
      return `هذه المنطقة تابعة إلى محافظة ${crossGovExactNames[0]}. برجاء تغيير المحافظة لاختيارها.`;
    }
    if (crossGovExactNames.length > 1) {
      return `هذه المنطقة تابعة إلى محافظات: ${crossGovExactNames.join('، ')}. برجاء تغيير المحافظة لاختيارها.`;
    }
    return 'هذه المنطقة خارج نطاق التغطية حاليًا.';
  })();

  // Phase 22N — neighborhood inline hint + validation message. Same
  // structure as the area hint: priority-ordered, customer-facing.
  type NeighborhoodHintKind = 'valid' | 'disabled' | 'other-area' | 'cross-gov' | 'unknown';
  const neighborhoodHint: { kind: NeighborhoodHintKind; message: string } | null = (() => {
    if (!neighborhood.trim()) return null;
    // No area chosen: try to point user at the right parent.
    if (!selectedAreaEntry) {
      const occurrences = findNeighborhoodOccurrences(neighborhood, hierarchicalRegions);
      if (occurrences.length === 0) {
        return { kind: 'unknown', message: 'هذا الحي خارج نطاق التغطية حاليًا.' };
      }
      const sameGov = occurrences.find(
        (o) => normalizeArabic(o.governorate.name) === normalizeArabic(governorate)
      );
      const pick = sameGov ?? occurrences[0];
      return {
        kind: sameGov ? 'other-area' : 'cross-gov',
        message: `هذا الحي تابع إلى ${pick.area.name} - محافظة ${pick.governorate.name}.`,
      };
    }
    // Area selected — try direct match.
    if (selectedNeighborhoodEntry) {
      if (selectedNeighborhoodEntry.enabled === false) {
        return { kind: 'disabled', message: 'هذا الحي خارج نطاق التغطية حاليًا.' };
      }
      return { kind: 'valid', message: '' };
    }
    // Look elsewhere for the neighborhood — under different parents.
    const occurrences = findNeighborhoodOccurrences(neighborhood, hierarchicalRegions);
    const sameGov = occurrences.find(
      (o) => normalizeArabic(o.governorate.name) === normalizeArabic(governorate)
    );
    if (sameGov) {
      return {
        kind: 'other-area',
        message: `هذا الحي تابع إلى ${sameGov.area.name} - محافظة ${sameGov.governorate.name}.`,
      };
    }
    if (occurrences.length > 0) {
      const first = occurrences[0];
      return {
        kind: 'cross-gov',
        message: `هذا الحي تابع إلى ${first.area.name} - محافظة ${first.governorate.name}.`,
      };
    }
    return { kind: 'unknown', message: 'هذا الحي خارج نطاق التغطية حاليًا.' };
  })();

  // Phase 22N — three-level shipping fee resolution. Inherits from
  // governorate → area → neighborhood. Empty / null fees inherit;
  // explicit `0` is respected as "free shipping at this level".
  const feeResolution = resolveShippingFeeFromCoverage({
    governorate: selectedGovEntry,
    area: selectedAreaEntry,
    neighborhood: selectedNeighborhoodEntry,
  });
  // Backward-compat: keep `regionFee` so existing math + WhatsApp
  // template bindings continue to work. The new resolution is the
  // authoritative source when a hierarchical match exists.
  const regionFee = feeResolution.fee;
  const shippingCost = freeShipping ? 0 : expressShipping ? ADMIN_SETTINGS.EXPRESS_FEE : regionFee;
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
    setLines((prev) => [...prev, line]);
  };

  const removeLine = (id: string) => {
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  const updateLine = (id: string, patch: Partial<OrderLine>) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const validateStep1 = () => {
    const errs: Record<string, string> = {};
    if (!customerName.trim()) errs.customerName = 'اسم العميل مطلوب';
    if (!isValidEgyptianMobile(phone)) errs.phone = 'رقم موبايل مصري غير صحيح';
    if (phone2 && !isValidEgyptianMobile(phone2)) errs.phone2 = 'رقم موبايل مصري غير صحيح';
    // Phase 22K-Fix1 — strict district validation. Empty stays the
    // legacy "المنطقة مطلوبة"; otherwise we require an EXACT
    // normalised match against a configured district in the currently
    // selected governorate. The error wording for "covered under
    // another governorate" and "out of coverage" is built once in
    // `districtStrictError` above and reused here so the inline hint
    // and the submit error can never drift.
    if (!governorate.trim()) {
      errs.governorate = 'المحافظة مطلوبة';
    } else if (selectedGovEntry && selectedGovEntry.enabled === false) {
      errs.governorate = 'هذه المحافظة خارج نطاق التغطية حاليًا.';
    }
    if (!district.trim()) {
      errs.district = 'المنطقة مطلوبة';
    } else if (!canonicalDistrictMatch) {
      // Phase 22N-Fix1 — when the typed value matches an area in
      // ANOTHER governorate (or matches a neighborhood elsewhere
      // entirely), tell the user to pick a result rather than
      // surfacing the generic out-of-coverage message. The user
      // can then either click a result row (auto-switch the gov)
      // or type a fully canonical name to clear the ambiguity.
      const exactHits = findCoverageOccurrences(district, hierarchicalRegions);
      if (exactHits.length > 1) {
        errs.district = 'برجاء اختيار المنطقة من النتائج لتحديد المحافظة الصحيحة.';
      } else {
        errs.district = districtStrictError ?? 'هذه المنطقة خارج نطاق التغطية حاليًا.';
      }
    } else if (selectedAreaEntry && selectedAreaEntry.enabled === false) {
      errs.district = 'هذه المنطقة خارج نطاق التغطية حاليًا.';
    }
    // Phase 22N — neighborhood is REQUIRED when the selected area has
    // children (curated commercial parent like القاهرة الجديدة or 6
    // أكتوبر). For leaf areas it stays optional. Customer-facing
    // wording — never "غير مفعلة".
    if (selectedAreaEntry && areaHasChildren && !neighborhood.trim()) {
      errs.neighborhood = 'الحي / القرية / الشياخة مطلوب لهذه المنطقة.';
    } else if (neighborhood.trim()) {
      if (!neighborhoodHint || neighborhoodHint.kind !== 'valid') {
        errs.neighborhood = neighborhoodHint?.message ?? 'هذا الحي خارج نطاق التغطية حاليًا.';
      }
    }
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
    // Block submission when there is no authenticated user — RLS would
    // reject the insert anyway and the order would not be traceable.
    if (!user?.id) {
      toast.error('يجب تسجيل الدخول قبل إنشاء طلب جديد');
      return;
    }

    setIsSubmitting(true);
    const deviceType = getDeviceType();

    // Build order object and save to localStorage
    const productsSummary = lines
      .map((l) => {
        const card = productCards.find((p) => p.value === l.productType);
        const label = card?.label || l.productType;
        const colorPart = l.color ? ` ${l.color}` : '';
        const flashPart = l.includeFlashlight ? ' + كشاف' : '';
        return `${label}${colorPart}${flashPart} x ${l.quantity}`;
      })
      .join(' + ');

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
      // Phase 22L — real display name from the signed-in profile
      // instead of a hardcoded label. The new value flows into
      // turath_masr_orders.created_by (text) and is read by every
      // surface that renders "بواسطة" via UserStamp.
      createdBy: createdByDisplayName,
      createdByDevice: deviceType,
      customer: customerName,
      phone,
      phone2: phone2 || undefined,
      region: governorate,
      // Phase 22K-Fix1 — persist the CANONICAL district name from
      // shipping settings, not the raw input. validateStep1 above has
      // already enforced canonicalDistrictMatch is set; the `??
      // district` is defensive in case a future caller invokes
      // handleSubmit without going through the validator.
      district: canonicalDistrictMatch ?? district,
      // Phase 22N-Fix3 — typed canonical neighborhood / village /
      // shiakha. Validated in step 1; trimmed; null when the
      // selected area has no children (the neighborhood input is
      // hidden in that case). Persisted via the new
      // `turath_masr_orders.neighborhood` column.
      neighborhood: neighborhood.trim() || null,
      address,
      products: productsSummary || 'لا يوجد منتجات',
      quantity: lines.reduce((s, l) => s + l.quantity, 0),
      subtotal,
      shippingFee: shippingCost,
      extraShippingFee: IS_ADMIN ? extraShippingFee : 0,
      expressShipping,
      freeShipping,
      total: grandTotal,
      status: 'new',
      date: `${d}/${m}/${y}`,
      time: `${h}:${min}:${sec}`,
      day: days[now.getDay()],
      notes: notes || undefined,
      warranty,
      ip: '—',
      lines: lines.map((l) => {
        const card = productCards.find((p) => p.value === l.productType);
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

    // Save to Supabase
    try {
      const supabase = createClient();
      // Phase 13C: chain `.select('tracking_token').single()` after the
      // upsert so we get back the server-generated tracking_token (DB
      // DEFAULT gen_random_uuid()) in the same round-trip. This is the
      // value we want for the new /track/t/<token> share link.
      const { data: upserted, error } = await supabase
        .from('turath_masr_orders')
        .upsert(
          {
            id: newOrder.id,
            order_num: newOrder.orderNum,
            created_by: newOrder.createdBy,
            created_by_device: newOrder.createdByDevice,
            // Authenticated user UUID — required by the orders_authenticated_insert
            // RLS policy: WITH CHECK (created_by_user_id IS NULL OR
            //                         created_by_user_id = auth.uid())
            created_by_user_id: user.id,
            customer: newOrder.customer,
            phone: newOrder.phone,
            phone2: newOrder.phone2 || null,
            region: newOrder.region,
            district: newOrder.district || null,
            // Phase 22N-Fix3 — new `neighborhood` column on
            // turath_masr_orders. NULL when no children configured.
            neighborhood: newOrder.neighborhood,
            address: newOrder.address,
            products: newOrder.products,
            quantity: newOrder.quantity,
            subtotal: newOrder.subtotal,
            shipping_fee: newOrder.shippingFee,
            // extra_shipping_fee already coerced to 0 at line where newOrder is built
            // when IS_ADMIN is false; client-side guard. RLS provides defence-in-depth.
            extra_shipping_fee: newOrder.extraShippingFee || 0,
            express_shipping: newOrder.expressShipping || false,
            free_shipping: newOrder.freeShipping || false,
            total: newOrder.total,
            status: newOrder.status,
            date: newOrder.date,
            time: newOrder.time,
            day: newOrder.day || null,
            notes: newOrder.notes || null,
            warranty: newOrder.warranty || null,
            lines: newOrder.lines || null,
          },
          { onConflict: 'id' }
        )
        .select('tracking_token')
        .single();

      if (error) {
        throw error;
      }

      // The "new_order" system notification is now produced by the
      // AFTER INSERT trigger trg_notify_on_new_order on turath_masr_orders
      // (see migration 20260506_secure_tracking_rpc.sql). The trigger runs
      // as SECURITY DEFINER so r6 (customer service) does not need write
      // access to turath_masr_notifications under the new RLS.

      // Phase 22A: best-effort customer upsert (identity only). Runs
      // *after* the order has already succeeded, and any error is
      // logged-and-ignored so it cannot roll back the order. CRM
      // derives totalOrders / totalSpent live from orders, so this
      // path writes only phone + full_name + updated_at — never the
      // stored counters. RLS allows r1/r2/r5/r6 to write customers;
      // other roles will trip the policy and we accept that silently
      // since the customer row is non-essential for delivery flow.
      const { error: customerErr } = await supabase.from('turath_masr_customers').upsert(
        {
          phone: newOrder.phone,
          full_name: newOrder.customer,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'phone' }
      );
      if (customerErr) {
        console.error('Customer upsert (non-blocking):', customerErr);
      }

      // Notify other components that orders have been updated
      window.dispatchEvent(new CustomEvent('turath_masr_orders_updated'));

      await new Promise((r) => setTimeout(r, 800));
      setIsSubmitting(false);
      setSuccessOrderNum(orderNum);
      // Phase 13C: capture the tracking_token returned by the upsert.
      // It is null only if the column is missing (shouldn't happen post
      // Phase 13A) or if a non-default RLS hides it from the row that came
      // back. Either way we fall through to the order_num link.
      setSuccessTrackingToken(
        (upserted as { tracking_token?: string | null } | null)?.tracking_token ?? null
      );
      setSuccessPhone(phone);
      setSuccessCustomer(customerName);
      setSuccessTotal(grandTotal);
      setSuccessLines([...lines]);
      setOrderSuccess(true);
    } catch (err) {
      console.error('Supabase save error:', err);
      toast.error('حدث خطأ أثناء حفظ الأوردر في قاعدة البيانات');
      setIsSubmitting(false);
    }
  };

  const warrantyOptions =
    dbWarrantyOptions.length > 0
      ? dbWarrantyOptions
      : ['بدون ضمان', '3 أشهر', '6 أشهر', 'سنة', 'سنتان'];

  const resetForm = () => {
    setCustomerName('');
    setPhone('');
    setPhone2('');
    setGovernorate('القاهرة');
    setDistrict('');
    setNeighborhood('');
    setAddress('');
    setExpressShipping(false);
    setFreeShipping(false);
    setExtraShippingFee(0);
    setNotes('');
    setWarranty('بدون ضمان');
    setErrors({});
    setLines([]);
    setStep(1);
    setOrderSuccess(false);
    setSuccessOrderNum('');
    setSuccessTrackingToken(null);
    // Phase 22O — release the "إضافة كعميل جديد" suppression so the
    // next order's phone lookup runs again. The lookup state itself
    // resets as soon as `phone` changes via the debounce effect.
    setSuppressCustomerLookup(false);
    setCustomerLookup({
      status: 'idle',
      customer: null,
      addresses: [],
      addressesTotalBeforeCap: 0,
      errorMessage: null,
    });
    // Generate a new order number for the next order
    generateOrderNumber().then((num) => setOrderNum(num));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir="rtl">
      <Toaster position="top-center" richColors />
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {orderSuccess ? (
        <div className="relative bg-white rounded-3xl shadow-modal w-full max-w-md p-10 flex flex-col items-center gap-6 fade-in text-center">
          <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
            <svg
              className="w-10 h-10 text-green-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">تم تسجيل الأوردر بنجاح! 🎉</h2>
            <p className="text-gray-500 text-base mb-1">تم حفظ الطلب وإضافته إلى قائمة الأوردرات</p>
            <div className="mt-3 bg-green-50 border border-green-200 rounded-xl px-6 py-3 inline-block">
              <span className="text-green-700 font-semibold text-lg">
                رقم الأوردر: {successOrderNum}
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-3 w-full">
            <button
              type="button"
              className="w-full py-3 px-6 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-lg active:scale-95 bg-green-500 hover:bg-green-600 text-white"
              onClick={() => {
                // Phase 13C: prefer the unguessable tracking_token URL.
                // Fall back to the legacy /track/<order_num> URL only when
                // we somehow didn't get a token back from the upsert.
                const trackingLink = successTrackingToken
                  ? `turathmasr.com/track/t/${successTrackingToken}`
                  : `turathmasr.com/track/${successOrderNum}`;
                // Build products list with proper names from productCards
                const productsList = successLines
                  .map((l) => {
                    const card = productCards.find((p) => p.value === l.productType);
                    const name = card?.label || l.productType;
                    const colorPart = l.color ? ` (${l.color})` : '';
                    const flashPart = l.includeFlashlight ? ' + كشاف' : '';
                    return `- ${name}${colorPart}${flashPart} x ${l.quantity} = ${lineTotal(l)} ج.م`;
                  })
                  .join('\n');
                // Determine shipping type text
                let shippingText = '';
                if (freeShipping) {
                  shippingText = 'الشحن: مجاني';
                } else if (expressShipping) {
                  shippingText = `الشحن السريع: ${shippingCost} ج.م`;
                } else {
                  shippingText = `الشحن: ${shippingCost} ج.م`;
                }
                let msg =
                  waTemplate ||
                  `السلام عليكم {customerName}

تم تأكيد طلبك رقم #{orderNum} وجاري التجهيز

المنتجات:
{products}

العنوان: {address} - {district} - {governorate}
{shippingType}
الإجمالي: {total} ج.م

تتبع طلبك: {trackingLink}

شكرا لتعاملك مع تراث مصر`;
                msg = msg.replace('{customerName}', successCustomer);
                msg = msg.replace('{orderNum}', successOrderNum);
                msg = msg.replace('{total}', successTotal.toLocaleString('en-US'));
                msg = msg.replace('{trackingLink}', trackingLink);
                msg = msg.replace('{products}', productsList);
                msg = msg.replace('{governorate}', governorate);
                msg = msg.replace('{district}', district);
                // Phase 22N-Fix3 — surface the typed neighborhood in
                // the WhatsApp confirmation. Templates that don't
                // reference {neighborhood} are unaffected (the
                // replacement is a no-op when the placeholder is
                // absent). When the placeholder IS present and the
                // value is empty, the literal `{neighborhood}` is
                // collapsed away cleanly below the regular
                // address replacement.
                msg = msg.replace('{neighborhood}', neighborhood || '');
                msg = msg.replace('{address}', address);
                msg = msg.replace('{shippingCost}', shippingCost.toString());
                msg = msg.replace('{shippingType}', shippingText);
                // Remove any emoji that might break in URL encoding
                msg = msg.replace(
                  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}]/gu,
                  ''
                );
                const cleanPhone = successPhone.replace(/[^0-9]/g, '');
                const intlPhone = cleanPhone.startsWith('0') ? '2' + cleanPhone : cleanPhone;
                window.open(`https://wa.me/${intlPhone}?text=${encodeURIComponent(msg)}`, '_blank');
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
              إرسال تأكيد واتساب للعميل
            </button>
            <button type="button" className="btn-primary w-full justify-center" onClick={resetForm}>
              ➕ تسجيل أوردر جديد
            </button>
            <button type="button" className="btn-secondary w-full justify-center" onClick={onClose}>
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
                <h2 className="text-lg font-bold text-[hsl(var(--foreground))]">
                  إضافة أوردر جديد
                </h2>
                <p className="text-xs text-[hsl(var(--muted-foreground))] font-mono">{orderNum}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-[hsl(var(--muted))] transition-colors"
              aria-label="إغلاق"
            >
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
                  <span
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${step === s.num ? 'bg-white/20' : step > s.num ? 'bg-green-100' : 'bg-[hsl(var(--border))]'}`}
                  >
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
                <p className="text-xs font-mono text-[hsl(var(--foreground))] font-bold">
                  {orderNum}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold text-blue-600 mb-0.5">التاريخ والوقت</p>
                <p className="text-xs font-mono">
                  {currentDateTime.day} {currentDateTime.date} — {currentDateTime.time}
                </p>
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
                    <h3 className="text-sm font-bold text-[hsl(var(--foreground))]">
                      بيانات العميل
                    </h3>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2">
                      <label className="label-text">اسم العميل *</label>
                      <input
                        className={`input-field ${errors.customerName ? 'border-red-400' : ''}`}
                        placeholder="الاسم الكامل للعميل"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                      />
                      {errors.customerName && (
                        <p className="text-red-500 text-xs mt-1">{errors.customerName}</p>
                      )}
                    </div>

                    <div>
                      <label className="label-text">رقم الموبايل الأساسي *</label>
                      <div className="relative">
                        <Phone
                          size={14}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]"
                        />
                        <input
                          type="tel"
                          className={`input-field pr-8 ${errors.phone ? 'border-red-400' : ''}`}
                          placeholder="01XXXXXXXXX"
                          dir="ltr"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                        />
                      </div>
                      {errors.phone && <p className="text-red-500 text-xs mt-1">{errors.phone}</p>}
                      {/* Phase 22O — returning-customer smart card.
                          Renders below the phone input. The card owns
                          its own loading / no-match / error / match
                          states so the modal stays clean. The order
                          form itself is unchanged when the card is
                          dismissed. */}
                      <ReturningCustomerCard
                        lookup={customerLookup}
                        onUseCustomer={handleUseCustomer}
                        onUpdateCustomer={handleUpdateCustomer}
                        onTreatAsNew={handleTreatAsNew}
                      />
                    </div>

                    <div>
                      <label className="label-text">رقم موبايل إضافي</label>
                      <div className="relative">
                        <Phone
                          size={14}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]"
                        />
                        <input
                          type="tel"
                          className={`input-field pr-8 ${errors.phone2 ? 'border-red-400' : ''}`}
                          placeholder="01XXXXXXXXX (اختياري)"
                          dir="ltr"
                          value={phone2}
                          onChange={(e) => setPhone2(e.target.value)}
                        />
                      </div>
                      {errors.phone2 && (
                        <p className="text-red-500 text-xs mt-1">{errors.phone2}</p>
                      )}
                    </div>

                    <div>
                      <label className="label-text">المحافظة *</label>
                      <div className="relative">
                        <select
                          className="input-field appearance-none pl-8"
                          value={governorate}
                          onChange={(e) => setGovernorate(e.target.value)}
                        >
                          {(dbRegions.length > 0
                            ? dbRegions
                                .filter((r: any) => r.enabled !== false)
                                .map((r: any) => r.name)
                            : dbRegions.length > 0
                              ? dbRegions
                                  .filter((r: any) => r.enabled !== false)
                                  .map((r: any) => r.name)
                              : Object.keys(GOVERNORATES_DISTRICTS)
                          ).map((g: string) => (
                            <option key={`gov-${g}`} value={g}>
                              {g}
                            </option>
                          ))}
                        </select>
                        <ChevronDown
                          size={14}
                          className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]"
                        />
                      </div>
                    </div>

                    {/* Phase 22K — smart district search.
                        Replaces the previous <select> with a typeable
                        input + suggestion dropdown that:
                          • shows matching districts inside the current
                            governorate as click-to-select suggestions,
                          • surfaces a hint when the query matches a
                            district under a DIFFERENT governorate,
                          • surfaces an out-of-coverage hint otherwise.
                        Matching is normalised for Arabic alef/yaa/taa-
                        marbuta variants and extra whitespace via
                        `normalizeArabic` (src/lib/utils/arabic.ts). */}
                    <div>
                      <label className="label-text">المنطقة / الحي *</label>
                      <div className="relative">
                        <input
                          type="text"
                          autoComplete="off"
                          className={`input-field pr-9 ${errors.district ? 'border-red-400' : ''}`}
                          placeholder="اكتب اسم المنطقة..."
                          value={district}
                          onChange={(e) => {
                            setDistrict(e.target.value);
                            setShowDistrictSuggestions(true);
                          }}
                          onFocus={() => setShowDistrictSuggestions(true)}
                          onBlur={() =>
                            // Defer hide so an in-progress click on a
                            // suggestion can register before the
                            // dropdown unmounts.
                            setTimeout(() => setShowDistrictSuggestions(false), 150)
                          }
                        />
                        <Search
                          size={14}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] pointer-events-none"
                        />
                        {showDistrictSuggestions && areaSuggestionsAll.length > 0 && (
                          <div className="absolute z-30 mt-1 w-full rounded-lg border border-[hsl(var(--border))] bg-white shadow-lg text-sm">
                            <div className="max-h-72 overflow-y-auto">
                              {/* Phase 22N-Fix1 — Section A: matches in
                                  the currently-selected governorate. */}
                              {areaSuggestionsInGov.length > 0 && (
                                <>
                                  <p className="px-3 py-1.5 text-[11px] text-[hsl(var(--muted-foreground))] border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 sticky top-0">
                                    داخل محافظة {governorate} — {areaSuggestionsInGov.length} نتيجة
                                  </p>
                                  <ul
                                    className="divide-y divide-[hsl(var(--border))]"
                                    role="listbox"
                                  >
                                    {areaSuggestionsInGov
                                      .slice(0, SUGGESTION_LIMIT_PER_SECTION)
                                      .map((entry) => (
                                        <CoverageSuggestionRow
                                          key={`in-${entry.level}-${entry.governorateName}-${entry.parentAreaName ?? ''}-${entry.name}`}
                                          entry={entry}
                                          governorate={governorate}
                                          onPick={() => {
                                            // Same gov — set the area /
                                            // neighborhood. Disabled
                                            // entries are display-only.
                                            if (!entry.enabled || !entry.governorateEnabled) return;
                                            if (entry.level === 0) {
                                              // user clicked governorate
                                              // row: just close the
                                              // dropdown (gov is already
                                              // selected).
                                              setShowDistrictSuggestions(false);
                                              return;
                                            }
                                            if (entry.level === 1) {
                                              setDistrict(entry.name);
                                              setNeighborhood('');
                                            } else if (entry.level === 2) {
                                              setDistrict(entry.parentAreaName ?? '');
                                              setNeighborhood(entry.name);
                                            }
                                            setShowDistrictSuggestions(false);
                                          }}
                                        />
                                      ))}
                                  </ul>
                                </>
                              )}
                              {/* Section B: matches in OTHER
                                  governorates. Click → switch the
                                  governorate AND the area + neighborhood
                                  in one step. */}
                              {areaSuggestionsOtherGov.length > 0 && (
                                <>
                                  <p className="px-3 py-1.5 text-[11px] text-amber-700 border-y border-[hsl(var(--border))] bg-amber-50/60 sticky top-0">
                                    نتائج في محافظات أخرى — {areaSuggestionsOtherGov.length}
                                  </p>
                                  <ul
                                    className="divide-y divide-[hsl(var(--border))]"
                                    role="listbox"
                                  >
                                    {areaSuggestionsOtherGov
                                      .slice(0, SUGGESTION_LIMIT_PER_SECTION)
                                      .map((entry) => (
                                        <CoverageSuggestionRow
                                          key={`out-${entry.level}-${entry.governorateName}-${entry.parentAreaName ?? ''}-${entry.name}`}
                                          entry={entry}
                                          governorate={governorate}
                                          onPick={() => {
                                            if (!entry.enabled || !entry.governorateEnabled) return;
                                            // Phase 22N-Fix1 — set the
                                            // skip flag so the
                                            // governorate / district
                                            // useEffects below don't
                                            // clobber these values, then
                                            // batch the state updates
                                            // (gov first so the gov-
                                            // change effect sees the
                                            // skip flag is true).
                                            skipNextCrossGovReset.current = true;
                                            setGovernorate(entry.governorateName);
                                            if (entry.level === 0) {
                                              setDistrict('');
                                              setNeighborhood('');
                                            } else if (entry.level === 1) {
                                              setDistrict(entry.name);
                                              setNeighborhood('');
                                            } else if (entry.level === 2) {
                                              setDistrict(entry.parentAreaName ?? '');
                                              setNeighborhood(entry.name);
                                            }
                                            setShowDistrictSuggestions(false);
                                          }}
                                        />
                                      ))}
                                  </ul>
                                </>
                              )}
                              {areaSuggestionsAll.length > SUGGESTION_LIMIT_PER_SECTION * 2 && (
                                <p className="px-3 py-1.5 text-[10px] text-[hsl(var(--muted-foreground))] border-t border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20">
                                  + {areaSuggestionsAll.length - SUGGESTION_LIMIT_PER_SECTION * 2}{' '}
                                  نتيجة أخرى — اكتب اسماً أكثر تحديداً لتضييق النتائج.
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Phase 22K-Fix1 — strict inline hint.
                          Wording is built in `districtStrictError`
                          (above) so it is byte-identical to the
                          submit error produced by validateStep1. The
                          hint colour signals severity: amber when the
                          area IS covered under another governorate
                          (the user can fix by switching), red when
                          the area is genuinely out of coverage.
                          Suppressed entirely when validateStep1 has
                          already attached a higher-priority error
                          ("المنطقة مطلوبة") to avoid double-rendering. */}
                      {!!districtStrictError && !errors.district && (
                        <p
                          className={`text-xs mt-1 flex items-start gap-1 ${
                            // Phase 22M — amber for "actionable / find-
                            // able" hints (neighborhood under known
                            // parent, area exists but disabled, area
                            // exists in another governorate); red only
                            // when the area is genuinely unknown.
                            !!neighborhoodMatch ||
                            !!disabledMatchInCurrentGov ||
                            crossGovExactNames.length > 0
                              ? 'text-amber-600'
                              : 'text-red-500'
                          }`}
                        >
                          <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                          <span>{districtStrictError}</span>
                        </p>
                      )}

                      {errors.district && (
                        <p className="text-red-500 text-xs mt-1">{errors.district}</p>
                      )}
                    </div>

                    {/* Phase 22N-Fix3 — neighborhood / village / shiakha
                        picker.
                        • Hidden entirely when the selected area has
                          NO children (avoids the "(اختياري)" wording
                          the user complained about).
                        • Single input + focus-driven popover dropdown
                          (matches the area input — no duplicate field
                          underneath).
                        • Required when the area has children.
                        • Customer-facing wording — disabled rows show
                          "خارج التغطية", never "غير مفعلة". */}
                    {selectedAreaEntry && areaHasChildren && (
                      <div>
                        <label className="label-text">الحي / القرية / الشياخة *</label>
                        <div className="relative">
                          <input
                            type="text"
                            autoComplete="off"
                            className={`input-field pr-9 ${errors.neighborhood ? 'border-red-400' : ''}`}
                            placeholder={`ابحث داخل ${selectedAreaEntry.name}...`}
                            value={neighborhood}
                            onChange={(e) => {
                              setNeighborhood(e.target.value);
                              setShowNeighborhoodSuggestions(true);
                            }}
                            onFocus={() => setShowNeighborhoodSuggestions(true)}
                            onBlur={() =>
                              // Defer hide so an in-progress click on a
                              // suggestion can register before the
                              // dropdown unmounts.
                              setTimeout(() => setShowNeighborhoodSuggestions(false), 150)
                            }
                          />
                          <Search
                            size={14}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] pointer-events-none"
                          />
                          {showNeighborhoodSuggestions && neighborhoodSuggestions.length > 0 && (
                            <div className="absolute z-30 mt-1 w-full rounded-lg border border-[hsl(var(--border))] bg-white shadow-lg text-sm">
                              <p className="px-3 py-1.5 text-[11px] text-[hsl(var(--muted-foreground))] border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30">
                                تم العثور على {neighborhoodSuggestions.length} حي داخل{' '}
                                {selectedAreaEntry.name}
                              </p>
                              <ul
                                className="max-h-56 overflow-y-auto divide-y divide-[hsl(var(--border))]"
                                role="listbox"
                              >
                                {neighborhoodSuggestions.map((n) => {
                                  const enabled = n.enabled !== false;
                                  return (
                                    <li
                                      key={`nh-suggestion-${governorate}|${selectedAreaEntry.name}|${n.name}`}
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        if (!enabled) return;
                                        setNeighborhood(n.name);
                                        setShowNeighborhoodSuggestions(false);
                                      }}
                                      className={`flex items-center justify-between gap-2 px-3 py-2 ${
                                        enabled
                                          ? 'cursor-pointer hover:bg-[hsl(var(--muted))]/40'
                                          : 'opacity-60 cursor-not-allowed'
                                      }`}
                                      role="option"
                                      aria-selected={neighborhood === n.name}
                                      aria-disabled={!enabled}
                                    >
                                      <span>{n.name}</span>
                                      <span className="flex items-center gap-1 text-[10px]">
                                        {!enabled && (
                                          <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-100">
                                            خارج التغطية
                                          </span>
                                        )}
                                      </span>
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          )}
                        </div>

                        {/* Inline coverage hint for the typed neighborhood.
                            Customer-facing wording — amber for
                            "actionable" cases (under another parent /
                            cross-gov), red for unknown / disabled. */}
                        {!!neighborhoodHint && !errors.neighborhood && (
                          <p
                            className={`text-xs mt-1 flex items-start gap-1 ${
                              neighborhoodHint.kind === 'unknown' ||
                              neighborhoodHint.kind === 'disabled'
                                ? 'text-red-500'
                                : 'text-amber-600'
                            }`}
                          >
                            <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                            <span>{neighborhoodHint.message}</span>
                          </p>
                        )}
                        {errors.neighborhood && (
                          <p className="text-red-500 text-xs mt-1">{errors.neighborhood}</p>
                        )}
                      </div>
                    )}

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
                        onChange={(e) => setAddress(e.target.value)}
                      />
                      {errors.address && (
                        <p className="text-red-500 text-xs mt-1">{errors.address}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => {
                        if (validateStep1()) setStep(2);
                      }}
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
                    <h3 className="text-sm font-bold text-[hsl(var(--foreground))]">
                      اختر المنتجات
                    </h3>
                    <span className="text-xs text-[hsl(var(--muted-foreground))]">
                      — يمكنك إضافة نفس المنتج أكثر من مرة بلون مختلف
                    </span>
                  </div>

                  {/* Product image cards — click to add a new line */}
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                    {productCards.map((product) => {
                      const hasRealImage =
                        product.image &&
                        (product.image.startsWith('data:') ||
                          product.image.startsWith('http') ||
                          product.image.startsWith('/'));
                      const count = lines.filter((l) => l.productType === product.value).length;
                      return (
                        <div key={`product-card-${product.value}`} className="relative group">
                          <button
                            type="button"
                            onClick={() => {
                              if (product.isInventory) {
                                const invItem = inventoryRef.current.find(
                                  (i) => i.id === product.value
                                );
                                const maxQty = invItem?.available || 0;
                                const totalUsed = lines
                                  .filter((l) => l.productType === product.value)
                                  .reduce((s, l) => s + l.quantity, 0);
                                if (totalUsed >= maxQty) {
                                  toast.error(`نفذ المخزون من ${product.label}`);
                                  return;
                                }
                              }
                              addLine(product);
                            }}
                            className={`w-full aspect-square rounded-2xl border-2 flex flex-col items-center justify-center gap-1 transition-all relative overflow-hidden ${product.isInventory && (inventoryRef.current.find((i) => i.id === product.value)?.available || 0) <= 0 ? 'border-red-200 bg-red-50 opacity-50 cursor-not-allowed' : count > 0 ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5 shadow-md' : 'border-[hsl(var(--border))] hover:border-[hsl(var(--primary))]/50 hover:shadow-sm bg-white'}`}
                          >
                            {hasRealImage ? (
                              <Image
                                src={product.image as string}
                                alt={product.label}
                                fill
                                sizes="(max-width: 768px) 33vw, 150px"
                                className="object-cover"
                              />
                            ) : (
                              <span className="text-3xl">{product.emoji}</span>
                            )}
                            {count > 0 && (
                              <div className="absolute top-1 left-1 w-5 h-5 bg-[hsl(var(--primary))] rounded-full flex items-center justify-center z-10">
                                <span className="text-white text-[10px] font-bold">{count}</span>
                              </div>
                            )}
                            {product.isInventory && (
                              <div
                                className={`absolute top-1 right-1 px-1.5 py-0.5 rounded-full text-[8px] font-bold z-10 ${(inventoryRef.current.find((i) => i.id === product.value)?.available || 0) > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}
                              >
                                {inventoryRef.current.find((i) => i.id === product.value)
                                  ?.available || 0}{' '}
                                متاح
                              </div>
                            )}
                            <span
                              className={`text-[10px] font-bold mt-1 relative z-10 ${hasRealImage ? 'text-white bg-black/50 px-1 rounded absolute bottom-1' : 'text-[hsl(var(--foreground))]'}`}
                            >
                              {product.label}
                            </span>
                            {!hasRealImage && (
                              <span className="text-[9px] text-[hsl(var(--muted-foreground))] relative z-10">
                                + إضافة
                              </span>
                            )}
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
                      اضغط على صورة المنتج أعلاه لإضافته — يمكنك إضافة نفس المنتج مرات متعددة بألوان
                      مختلفة
                    </div>
                  )}

                  {/* Lines detail */}
                  <div className="space-y-3">
                    {lines.map((line, index) => {
                      const productCard = productCards.find((p) => p.value === line.productType);
                      const hasRealImage =
                        productCard?.image &&
                        (productCard.image.startsWith('data:') ||
                          productCard.image.startsWith('http') ||
                          productCard.image.startsWith('/'));
                      const isHolder = line.productType === 'holder';
                      const isFlashlight = line.productType === 'flashlight';
                      const HOLDER_COLORS = [
                        { value: 'brown', label: 'بني', hex: '#8B4513' },
                        { value: 'black', label: 'أسود', hex: '#1a1a1a' },
                        { value: 'white', label: 'أبيض', hex: '#f5f5f5' },
                        { value: 'gold', label: 'ذهبي', hex: '#FFD700' },
                        { value: 'pearl', label: 'صدف', hex: '#EAE0C8' },
                      ];

                      // Colors: use inventory colors if available, else use HOLDER_COLORS for holder
                      const availableColors =
                        productCard?.colors && productCard.colors.length > 0
                          ? productCard.colors.map((c: string) => ({
                              value: c,
                              label: c,
                              hex: '#888',
                            }))
                          : isHolder
                            ? HOLDER_COLORS
                            : [];
                      const hasColors = availableColors.length > 0;

                      return (
                        <div
                          key={line.id}
                          className="border border-[hsl(var(--border))] rounded-2xl p-4 relative bg-[hsl(var(--muted))]/20"
                        >
                          {/* Line header */}
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              {hasRealImage ? (
                                <Image
                                  src={productCard!.image as string}
                                  alt={productCard?.label || ''}
                                  width={32}
                                  height={32}
                                  className="w-8 h-8 rounded-lg object-cover"
                                />
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
                                  {availableColors.map((color: any) => (
                                    <button
                                      key={`color-${line.id}-${color.value}`}
                                      type="button"
                                      onClick={() => updateLine(line.id, { color: color.value })}
                                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-all ${line.color === color.value ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]' : 'border-[hsl(var(--border))] hover:border-gray-400'}`}
                                    >
                                      <span
                                        className="w-3 h-3 rounded-full border border-gray-300 flex-shrink-0"
                                        style={{ backgroundColor: color.hex }}
                                      />
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
                                  onClick={() =>
                                    updateLine(line.id, {
                                      quantity: Math.max(1, line.quantity - 1),
                                    })
                                  }
                                  className="w-8 h-8 flex items-center justify-center rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] transition-colors"
                                >
                                  <Minus size={13} />
                                </button>
                                <input
                                  type="number"
                                  min={1}
                                  className="input-field w-16 text-center font-mono"
                                  value={line.quantity}
                                  onChange={(e) => {
                                    let qty = Math.max(1, Number(e.target.value));
                                    const card = productCards.find(
                                      (p) => p.value === line.productType
                                    );
                                    if (card?.isInventory) {
                                      const invItem = inventoryRef.current.find(
                                        (i: any) => i.id === line.productType
                                      );
                                      const maxQty = invItem?.available || 999;
                                      const totalUsed = lines
                                        .filter(
                                          (l) =>
                                            l.productType === line.productType && l.id !== line.id
                                        )
                                        .reduce((s, l) => s + l.quantity, 0);
                                      if (qty + totalUsed > maxQty) {
                                        qty = Math.max(1, maxQty - totalUsed);
                                        toast.error(`الكمية المتاحة في المخزون: ${maxQty} فقط`);
                                      }
                                    }
                                    updateLine(line.id, { quantity: qty });
                                  }}
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    const card = productCards.find(
                                      (p) => p.value === line.productType
                                    );
                                    if (card?.isInventory) {
                                      const invItem = inventoryRef.current.find(
                                        (i: any) => i.id === line.productType
                                      );
                                      const maxQty = invItem?.available || 999;
                                      const totalUsed = lines
                                        .filter(
                                          (l) =>
                                            l.productType === line.productType && l.id !== line.id
                                        )
                                        .reduce((s, l) => s + l.quantity, 0);
                                      if (line.quantity + 1 + totalUsed > maxQty) {
                                        toast.error(`الكمية المتاحة في المخزون: ${maxQty} فقط`);
                                        return;
                                      }
                                    }
                                    updateLine(line.id, { quantity: line.quantity + 1 });
                                  }}
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
                                onChange={(e) =>
                                  updateLine(line.id, { unitPrice: Number(e.target.value) })
                                }
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
                                      onChange={(e) =>
                                        updateLine(line.id, { includeFlashlight: e.target.checked })
                                      }
                                    />
                                    <span className="text-sm font-semibold">
                                      🔦 إضافة كشاف مع الحامل
                                    </span>
                                  </label>
                                  {line.includeFlashlight && (
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-[hsl(var(--muted-foreground))]">
                                        سعر الكشاف:
                                      </span>
                                      <input
                                        type="number"
                                        min={0}
                                        className="input-field w-20 text-center font-mono py-1 text-xs"
                                        value={line.flashlightPrice}
                                        onChange={(e) =>
                                          updateLine(line.id, {
                                            flashlightPrice: Number(e.target.value),
                                          })
                                        }
                                      />
                                      <span className="text-xs text-[hsl(var(--muted-foreground))]">
                                        ج.م
                                      </span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}

                            {isFlashlight && (
                              <div className="sm:col-span-2 bg-amber-50 border border-amber-200 rounded-xl p-3">
                                <p className="text-xs text-amber-700 font-semibold">
                                  💡 سعر الكشاف قابل للتعديل أعلاه
                                </p>
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
                                onChange={(e) => updateLine(line.id, { note: e.target.value })}
                              />
                            </div>
                          </div>

                          {/* Line subtotal */}
                          <div className="mt-3 pt-3 border-t border-[hsl(var(--border))] flex items-center justify-between">
                            <span className="text-xs text-[hsl(var(--muted-foreground))]">
                              إجمالي هذا المنتج ({line.quantity} × {line.unitPrice} ج.م
                              {line.includeFlashlight ? ` + ${line.flashlightPrice} ج.م كشاف` : ''}
                              ):
                            </span>
                            <span className="text-sm font-bold font-mono text-[hsl(var(--primary))]">
                              {lineTotal(line).toLocaleString('en-US')} ج.م
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Free shipping toggle */}
                  <div className="border border-green-200 bg-green-50 rounded-2xl p-4">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        className="w-4 h-4 rounded mt-0.5"
                        checked={freeShipping}
                        onChange={(e) => {
                          setFreeShipping(e.target.checked);
                          if (e.target.checked) setExpressShipping(false);
                        }}
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-lg">🎁</span>
                          <span className="text-sm font-bold text-[hsl(var(--foreground))]">
                            شحن مجاني
                          </span>
                          <span className="badge bg-green-100 text-green-700 border border-green-200">
                            0 ج.م
                          </span>
                        </div>
                        <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                          <span className="text-green-700 font-semibold">
                            تكلفة الشحن ستكون صفر — يتم خصمها من إجمالي الأوردر
                          </span>
                        </p>
                      </div>
                    </label>
                  </div>

                  {/* Express shipping */}
                  <div className="border border-amber-200 bg-amber-50 rounded-2xl p-4">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        className="w-4 h-4 rounded mt-0.5"
                        checked={expressShipping}
                        disabled={freeShipping}
                        onChange={(e) => setExpressShipping(e.target.checked)}
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <Zap size={16} className="text-amber-600" />
                          <span className="text-sm font-bold text-[hsl(var(--foreground))]">
                            شحن سريع
                          </span>
                          <span className="badge bg-amber-100 text-amber-700 border border-amber-200">
                            {ADMIN_SETTINGS.EXPRESS_FEE} ج.م
                          </span>
                        </div>
                        <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                          تسليم خلال 24 ساعة —{' '}
                          <span className="text-amber-700 font-semibold">
                            يستبدل تكلفة الشحن العادية
                          </span>
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
                        <span className="text-[10px] bg-orange-100 text-orange-700 border border-orange-200 px-2 py-0.5 rounded-full font-semibold">
                          للأدمن فقط
                        </span>
                      </div>
                      <p className="text-xs text-[hsl(var(--muted-foreground))] mb-3">
                        تُضاف على الفاتورة وتُخصم من عهدة المندوب
                      </p>
                      <div className="flex items-center gap-3">
                        <input
                          type="number"
                          min={0}
                          dir="ltr"
                          className="input-field w-32 text-center font-mono"
                          placeholder="0"
                          value={extraShippingFee}
                          onChange={(e) => setExtraShippingFee(Number(e.target.value))}
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
                      onChange={(e) => setWarranty(e.target.value)}
                    >
                      {warrantyOptions.map((opt: string) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
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
                      onChange={(e) => setNotes(e.target.value)}
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
                        <span className="text-[hsl(var(--muted-foreground))]">
                          إجمالي المنتجات ({lines.length} صنف):
                        </span>
                        <span className="font-mono font-semibold">
                          {subtotal.toLocaleString('en-US')} ج.م
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[hsl(var(--muted-foreground))]">
                          {freeShipping
                            ? '🎁 شحن مجاني:'
                            : expressShipping
                              ? '⚡ شحن سريع:'
                              : 'الشحن:'}
                        </span>
                        <span
                          className={`font-mono ${freeShipping ? 'text-green-600 line-through' : expressShipping ? 'text-amber-700' : ''}`}
                        >
                          {freeShipping ? `${regionFee} ج.م` : `${shippingCost} ج.م`}
                        </span>
                      </div>
                      {freeShipping && (
                        <div className="flex justify-between text-green-600">
                          <span>خصم الشحن المجاني:</span>
                          <span className="font-mono font-semibold">- {regionFee} ج.م</span>
                        </div>
                      )}
                      {IS_ADMIN && extraShippingFee > 0 && (
                        <div className="flex justify-between text-orange-700">
                          <span>مصاريف إضافية:</span>
                          <span className="font-mono">
                            + {extraShippingFee.toLocaleString('en-US')} ج.م
                          </span>
                        </div>
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
                    <button type="button" className="btn-secondary" onClick={() => setStep(1)}>
                      السابق
                    </button>
                    <button
                      type="button"
                      className="btn-primary flex items-center gap-2"
                      onClick={() => {
                        if (validateStep2()) setStep(3);
                      }}
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
                    <h3 className="text-sm font-bold text-[hsl(var(--foreground))]">
                      مراجعة الأوردر قبل التأكيد
                    </h3>
                    <span className="text-xs text-[hsl(var(--muted-foreground))]">
                      — تأكد من صحة جميع البيانات
                    </span>
                  </div>

                  {/* Order number highlight */}
                  <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-center">
                    <p className="text-xs text-blue-600 font-semibold mb-1">رقم الأوردر</p>
                    <p className="text-2xl font-bold font-mono text-blue-800">{orderNum}</p>
                    <p className="text-xs text-blue-500 mt-1">
                      {currentDateTime.day} {currentDateTime.date} — {currentDateTime.time}
                    </p>
                  </div>

                  {/* Customer info review */}
                  <div className="border border-[hsl(var(--border))] rounded-2xl overflow-hidden">
                    <div className="bg-[hsl(var(--muted))]/50 px-4 py-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <User size={14} className="text-[hsl(var(--primary))]" />
                        <span className="text-xs font-bold text-[hsl(var(--foreground))]">
                          بيانات العميل
                        </span>
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
                        <p className="text-[10px] text-[hsl(var(--muted-foreground))] font-semibold mb-0.5">
                          الاسم
                        </p>
                        <p className="font-semibold">{customerName}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-[hsl(var(--muted-foreground))] font-semibold mb-0.5">
                          الموبايل
                        </p>
                        <p className="font-mono font-semibold">
                          {phone}
                          {phone2 ? ` / ${phone2}` : ''}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-[hsl(var(--muted-foreground))] font-semibold mb-0.5">
                          {neighborhood ? 'المحافظة / المنطقة / الحي' : 'المحافظة / المنطقة'}
                        </p>
                        <p className="font-semibold">
                          {governorate} — {district}
                          {neighborhood ? ` — ${neighborhood}` : ''}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-[hsl(var(--muted-foreground))] font-semibold mb-0.5">
                          الضمان
                        </p>
                        <p className="font-semibold">{warranty}</p>
                      </div>
                      <div className="col-span-2">
                        <p className="text-[10px] text-[hsl(var(--muted-foreground))] font-semibold mb-0.5">
                          العنوان
                        </p>
                        <p className="font-semibold text-xs leading-relaxed">{address}</p>
                      </div>
                      {notes && (
                        <div className="col-span-2">
                          <p className="text-[10px] text-[hsl(var(--muted-foreground))] font-semibold mb-0.5">
                            ملاحظات
                          </p>
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
                        <span className="text-xs font-bold text-[hsl(var(--foreground))]">
                          المنتجات ({lines.length} صنف)
                        </span>
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
                        const card = productCards.find((p) => p.value === line.productType);
                        return (
                          <div
                            key={`review-line-${line.id}`}
                            className="px-4 py-3 flex items-center justify-between text-sm"
                          >
                            <div className="flex items-center gap-3">
                              {card?.image ? (
                                <Image
                                  src={card.image}
                                  alt={card?.label || ''}
                                  width={48}
                                  height={48}
                                  className="w-12 h-12 rounded-xl object-cover border border-[hsl(var(--border))] shadow-sm"
                                />
                              ) : (
                                <span className="text-2xl w-12 h-12 flex items-center justify-center bg-[hsl(var(--muted))]/50 rounded-xl">
                                  {card?.emoji || '📦'}
                                </span>
                              )}
                              <div>
                                <p className="font-semibold text-xs">
                                  {card?.label || line.productType}
                                  {line.color ? ` — ${line.color}` : ''}
                                  {line.includeFlashlight ? ' + كشاف' : ''}
                                </p>
                                {line.note && (
                                  <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
                                    {line.note}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="text-left">
                              <p className="font-mono font-bold text-[hsl(var(--primary))] text-xs">
                                {lineTotal(line).toLocaleString('en-US')} ج.م
                              </p>
                              <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
                                {line.quantity} × {line.unitPrice} ج.م
                              </p>
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
                        <span className="text-[hsl(var(--muted-foreground))]">
                          إجمالي المنتجات:
                        </span>
                        <span className="font-mono font-semibold">
                          {subtotal.toLocaleString('en-US')} ج.م
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[hsl(var(--muted-foreground))]">
                          {freeShipping
                            ? '🎁 شحن مجاني:'
                            : expressShipping
                              ? '⚡ شحن سريع:'
                              : 'الشحن:'}
                        </span>
                        <span
                          className={`font-mono ${freeShipping ? 'text-green-600 line-through' : expressShipping ? 'text-amber-700' : ''}`}
                        >
                          {freeShipping ? `${regionFee} ج.م` : `${shippingCost} ج.م`}
                        </span>
                      </div>
                      {freeShipping && (
                        <div className="flex justify-between text-green-600">
                          <span>خصم الشحن المجاني:</span>
                          <span className="font-mono font-semibold">- {regionFee} ج.م</span>
                        </div>
                      )}
                      {IS_ADMIN && extraShippingFee > 0 && (
                        <div className="flex justify-between text-orange-700">
                          <span>مصاريف إضافية:</span>
                          <span className="font-mono">
                            + {extraShippingFee.toLocaleString('en-US')} ج.م
                          </span>
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
                    <button type="button" className="btn-secondary" onClick={() => setStep(2)}>
                      السابق
                    </button>
                    <button
                      type="button"
                      className="btn-primary flex-1 justify-center flex items-center gap-2"
                      disabled={isSubmitting}
                      onClick={handleSubmit}
                    >
                      {isSubmitting ? (
                        <span className="flex items-center gap-2 justify-center">
                          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="4"
                            />
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8v8z"
                            />
                          </svg>
                          جاري التسجيل...
                        </span>
                      ) : (
                        <>
                          <CheckCircle size={16} />✅ تأكيد وتسجيل الأوردر
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
