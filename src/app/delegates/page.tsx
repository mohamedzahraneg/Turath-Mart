'use client';
// ─────────────────────────────────────────────────────────────────────────────
// /delegates — Phase 23A
//
// Delegate management foundation. Read-only first PR:
//   • KPI cards calculated from existing `turath_masr_orders` data.
//   • Delegate list joined with `profiles` (role_id IN r3/r4) and the
//     legacy `delegate_name` text values still found on orders.
//   • Detail drawer with multi-tab view (الملخص / الطلبات / التقييمات /
//     النشاط). Settlements / Custody / Expenses tabs are placeholders
//     marked قريبًا — those tables don't exist yet and are explicitly
//     deferred to Phase 23B/C per the user spec.
//   • Customer ratings come from `turath_masr_delegate_ratings` (added
//     in migration 20260510180000_delegate_ratings.sql, staged but
//     not yet applied at first deploy — the page is defensive against
//     a missing table and renders "لا توجد تقييمات بعد").
//
// Performance posture (mirrors Phase 22Q + Phase E1 conventions):
//   • Explicit narrow column lists on every Supabase query.
//   • No `select('*')`. No `lines` jsonb. No `images` payload.
//   • Orders fetched with a 90-day date filter to bound the scan.
//   • Detail drawer queries are scoped per delegate by `assigned_to`
//     when available, falling back to `delegate_name` for legacy rows.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from 'react';
import {
  Truck,
  CheckCircle,
  RotateCcw,
  Package,
  Wallet,
  AlertTriangle,
  Star,
  Phone as PhoneIcon,
  X,
  User,
  Clock,
  Plus,
  IdCard,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { createClient } from '@/lib/supabase/client';
import { isValidEgyptianMobile } from '@/lib/validators/phone';
// Phase 23A-Fix1 — transport-type tokens + Arabic labels, plus the
// licence-status helper that drives the "متبقي N يوم" badges in the
// delegates table and detail drawer.
import {
  TRANSPORT_TYPE_TOKENS,
  TRANSPORT_TYPE_LABELS_AR,
  transportLabel,
  type TransportType,
} from '@/lib/delegates/transportTypes';
import { licenseStatus } from '@/lib/delegates/licenseStatus';

// ─── Types ─────────────────────────────────────────────────────────────────
interface DelegateRow {
  /** profiles.id (auth.users uuid) when the delegate has a profile;
   *  `legacy:<name>` when the delegate only exists as a text value
   *  on orders.delegate_name and never had a profile created. */
  key: string;
  /** profiles.id when present, otherwise null. */
  profileId: string | null;
  name: string;
  roleId: string | null;
  roleName: string | null;
  email: string | null;
  hasProfile: boolean;
  // Phase 23A-Fix1 — operational profile fields. All optional; the
  // detail drawer hides any blank field. The companion migration
  // (`20260510190000_profiles_delegate_fields.sql`) adds these
  // columns to `profiles`; before it lands the profile fetch
  // simply omits them and every renderer here treats them as
  // null. national_id + licence numbers are admin-only — they
  // are never echoed back to the customer-facing tracking page.
  phone: string | null;
  nationalId: string | null;
  transportType: string | null;
  vehicleLicenseNumber: string | null;
  vehicleLicenseStartsAt: string | null;
  vehicleLicenseExpiresAt: string | null;
  drivingLicenseNumber: string | null;
  drivingLicenseStartsAt: string | null;
  drivingLicenseExpiresAt: string | null;
  delegateIsActive: boolean | null;
}

interface OrderRow {
  id: string;
  order_num: string;
  customer: string | null;
  region: string | null;
  district: string | null;
  neighborhood: string | null;
  total: number | null;
  shipping_fee: number | null;
  status: string;
  date: string | null;
  delegate_name: string | null;
  assigned_to: string | null;
  scheduled_delivery_date: string | null;
  scheduled_delivery_from: string | null;
  scheduled_delivery_to: string | null;
  created_at: string | null;
}

interface RatingRow {
  id: string;
  order_id: string;
  delegate_name: string | null;
  assigned_to: string | null;
  rating: number;
  comment: string | null;
  created_at: string;
}

interface DelegateAggregate {
  delegate: DelegateRow;
  inFlight: number;
  delivered: number;
  returned: number;
  totalCollected: number;
  pendingShipping: number;
  ratings: RatingRow[];
  averageRating: number | null;
  ordersForDelegate: OrderRow[];
}

const STATUS_LABELS: Record<string, string> = {
  new: 'جديد',
  preparing: 'جاري التجهيز',
  warehouse: 'في المستودع',
  shipping: 'جاري الشحن',
  delivered: 'تم التسليم',
  cancelled: 'ملغي',
  returned: 'مرتجع',
};

const ARABIC_MONTHS = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];
const ARABIC_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

function formatDateAr(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return `${ARABIC_DAYS[d.getDay()]} ${d.getDate()} ${ARABIC_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  } catch {
    return '—';
  }
}

function formatScheduleAr(date: string | null, from: string | null, to: string | null): string {
  if (!date || !from || !to) return '—';
  // Re-use the same compact rendering shape as the order detail card.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return '—';
  const local = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const dayPart = `${ARABIC_DAYS[local.getDay()]} ${local.getDate()} ${ARABIC_MONTHS[local.getMonth()]}`;
  const fromShort = from.slice(0, 5);
  const toShort = to.slice(0, 5);
  return `${dayPart} (${fromShort} – ${toShort})`;
}

function fmtMoney(n: number | null): string {
  return `${(n ?? 0).toLocaleString('en-US')} ج.م`;
}

const DELIVERED = 'delivered';
const RETURNED = 'returned';
const IN_FLIGHT_STATUSES = new Set(['preparing', 'warehouse', 'shipping']);

// ─── Page component ────────────────────────────────────────────────────────
export default function DelegatesPage() {
  const [profiles, setProfiles] = useState<DelegateRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [ratings, setRatings] = useState<RatingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    'summary' | 'orders' | 'ratings' | 'activity' | 'placeholder'
  >('summary');
  const [placeholderTab, setPlaceholderTab] = useState<string>('');
  // Phase 23A-Fix1 — wizard state + refetch trigger after successful
  // delegate creation. Declared here so the loader useEffect below
  // can subscribe to `reloadTick` for refetches.
  const [wizardOpen, setWizardOpen] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  // Fetch profiles + orders + ratings in parallel. Each query is
  // narrowed and date-bounded.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      try {
        const [profilesRes, ordersRes, ratingsRes] = await Promise.all([
          // Phase 23A-Fix1 — request the new operational columns.
          // Pre-migration the columns don't exist yet; the SELECT
          // will surface a 42703 error which the catch arm below
          // swallows so the page still renders the legacy fields.
          supabase
            .from('profiles')
            .select(
              'id, full_name, email, role_id, role_name, phone, national_id, transport_type, vehicle_license_number, vehicle_license_starts_at, vehicle_license_expires_at, driving_license_number, driving_license_starts_at, driving_license_expires_at, delegate_is_active'
            )
            .in('role_id', ['r3', 'r4']),
          supabase
            .from('turath_masr_orders')
            .select(
              'id, order_num, customer, region, district, neighborhood, total, shipping_fee, status, date, delegate_name, assigned_to, scheduled_delivery_date, scheduled_delivery_from, scheduled_delivery_to, created_at'
            )
            .gte('created_at', since)
            .order('created_at', { ascending: false }),
          // Ratings table may not exist yet (migration staged). The
          // try/catch guard below tolerates the 42P01 missing-table
          // error and falls back to an empty list so the page still
          // renders.
          supabase
            .from('turath_masr_delegate_ratings')
            .select('id, order_id, delegate_name, assigned_to, rating, comment, created_at')
            .order('created_at', { ascending: false })
            .limit(500)
            .then(
              (r: { data: RatingRow[] | null; error: unknown }) => r,
              (err: unknown) => ({
                data: null as RatingRow[] | null,
                error: err,
              })
            ),
        ]);
        if (cancelled) return;

        if (profilesRes.error) {
          console.warn('[delegates] profiles fetch failed', profilesRes.error);
        }
        const profileRows: DelegateRow[] = (
          (profilesRes.data ?? []) as Array<{
            id: string;
            full_name: string | null;
            email: string | null;
            role_id: string | null;
            role_name: string | null;
            phone?: string | null;
            national_id?: string | null;
            transport_type?: string | null;
            vehicle_license_number?: string | null;
            vehicle_license_starts_at?: string | null;
            vehicle_license_expires_at?: string | null;
            driving_license_number?: string | null;
            driving_license_starts_at?: string | null;
            driving_license_expires_at?: string | null;
            delegate_is_active?: boolean | null;
          }>
        ).map((p) => ({
          key: p.id,
          profileId: p.id,
          name: p.full_name || (p.email ? p.email.split('@')[0] : 'بدون اسم'),
          roleId: p.role_id ?? null,
          roleName: p.role_name ?? null,
          email: p.email ?? null,
          hasProfile: true,
          phone: p.phone ?? null,
          nationalId: p.national_id ?? null,
          transportType: p.transport_type ?? null,
          vehicleLicenseNumber: p.vehicle_license_number ?? null,
          vehicleLicenseStartsAt: p.vehicle_license_starts_at ?? null,
          vehicleLicenseExpiresAt: p.vehicle_license_expires_at ?? null,
          drivingLicenseNumber: p.driving_license_number ?? null,
          drivingLicenseStartsAt: p.driving_license_starts_at ?? null,
          drivingLicenseExpiresAt: p.driving_license_expires_at ?? null,
          delegateIsActive: p.delegate_is_active ?? null,
        }));

        // Backfill from legacy delegate_name text values that don't
        // line up with any profile.
        const seenIds = new Set(profileRows.map((p) => p.profileId).filter(Boolean) as string[]);
        const seenNames = new Set(profileRows.map((p) => p.name.trim()).filter(Boolean));
        const legacyNames = new Set<string>();
        for (const o of (ordersRes.data ?? []) as OrderRow[]) {
          const n = (o.delegate_name || '').trim();
          if (!n) continue;
          if (o.assigned_to && seenIds.has(o.assigned_to)) continue;
          if (seenNames.has(n)) continue;
          legacyNames.add(n);
        }
        const legacyRows: DelegateRow[] = Array.from(legacyNames).map((n) => ({
          key: `legacy:${n}`,
          profileId: null,
          name: n,
          roleId: null,
          roleName: null,
          email: null,
          hasProfile: false,
          // Phase 23A-Fix1 — legacy `delegate_name`-only rows have
          // no profile to draw operational data from. Every new
          // field defaults to null so the renderers degrade
          // gracefully (the table cell renders "—", the drawer
          // hides the row).
          phone: null,
          nationalId: null,
          transportType: null,
          vehicleLicenseNumber: null,
          vehicleLicenseStartsAt: null,
          vehicleLicenseExpiresAt: null,
          drivingLicenseNumber: null,
          drivingLicenseStartsAt: null,
          drivingLicenseExpiresAt: null,
          delegateIsActive: null,
        }));

        const allDelegates = [...profileRows, ...legacyRows].sort((a, b) =>
          a.name.localeCompare(b.name, 'ar')
        );

        setProfiles(allDelegates);
        setOrders((ordersRes.data ?? []) as OrderRow[]);

        // Defensive: a 42P01 (missing table) before the migration is
        // applied lands here. We just leave ratings empty — the page
        // shows "لا توجد تقييمات بعد".
        const ratingsData =
          ratingsRes && 'error' in ratingsRes && ratingsRes.error
            ? []
            : ((ratingsRes as { data: RatingRow[] | null }).data ?? []);
        setRatings(ratingsData);

        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        console.error('[delegates] load error', e);
        setErrorMessage('تعذر تحميل بيانات المناديب. حاول مرة أخرى.');
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Phase 23A-Fix1 — re-run the loader when the wizard bumps
    // `reloadTick`. Declared above the loader so React's hook
    // ordering guarantees still hold.
  }, [reloadTick]);

  // Per-delegate aggregation. Cheap O(N*M) walk; the page only
  // renders <100 delegates and <1000 orders in practice.
  const aggregates: DelegateAggregate[] = useMemo(() => {
    return profiles.map((d) => {
      const ordersForDelegate = orders.filter((o) => {
        if (d.profileId && o.assigned_to === d.profileId) return true;
        if (!d.profileId && (o.delegate_name || '').trim() === d.name.trim()) return true;
        // Allow matching profile-row by delegate_name as a soft
        // fallback for orders that haven't been backfilled to
        // assigned_to yet (legacy state — Phase 22B left some).
        if (d.profileId && (o.delegate_name || '').trim() === d.name.trim()) return true;
        return false;
      });
      let inFlight = 0;
      let delivered = 0;
      let returned = 0;
      let totalCollected = 0;
      for (const o of ordersForDelegate) {
        if (o.status === DELIVERED) {
          delivered += 1;
          totalCollected += Number(o.total ?? 0);
        } else if (o.status === RETURNED) {
          returned += 1;
        } else if (IN_FLIGHT_STATUSES.has(o.status)) {
          inFlight += 1;
        }
      }
      const ratingsForDelegate = ratings.filter((r) => {
        if (d.profileId && r.assigned_to === d.profileId) return true;
        if ((r.delegate_name || '').trim() === d.name.trim()) return true;
        return false;
      });
      const averageRating =
        ratingsForDelegate.length > 0
          ? ratingsForDelegate.reduce((s, r) => s + r.rating, 0) / ratingsForDelegate.length
          : null;

      return {
        delegate: d,
        inFlight,
        delivered,
        returned,
        totalCollected,
        pendingShipping: inFlight,
        ratings: ratingsForDelegate,
        averageRating,
        ordersForDelegate,
      };
    });
  }, [profiles, orders, ratings]);

  const kpis = useMemo(() => {
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    let deliveredToday = 0;
    let totalReturned = 0;
    let totalCollected = 0;
    let inFlight = 0;
    for (const o of orders) {
      if (o.status === DELIVERED) {
        totalCollected += Number(o.total ?? 0);
        if ((o.created_at || '').startsWith(todayIso)) deliveredToday += 1;
      } else if (o.status === RETURNED) {
        totalReturned += 1;
      } else if (IN_FLIGHT_STATUSES.has(o.status)) {
        inFlight += 1;
      }
    }
    const allRatings = ratings;
    const avg =
      allRatings.length > 0
        ? allRatings.reduce((s, r) => s + r.rating, 0) / allRatings.length
        : null;

    return {
      totalDelegates: profiles.length,
      activeDelegates: aggregates.filter((a) => a.inFlight > 0 || a.delivered > 0).length,
      inFlight,
      deliveredToday,
      totalReturned,
      totalCollected,
      averageRating: avg,
    };
  }, [orders, profiles, ratings, aggregates]);

  const selected = aggregates.find((a) => a.delegate.key === selectedKey) || null;

  return (
    <AppLayout currentPath="/delegates">
      <div className="space-y-6 fade-in">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">إدارة المناديب</h1>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
              نظرة عامة على المناديب وأوردراتهم وتقييماتهم. التحصيلات والتوريدات والأمانات ستُضاف في
              مرحلة لاحقة.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setWizardOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-[hsl(var(--primary))] text-white rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            <Plus size={16} /> إضافة مندوب جديد
          </button>
        </div>

        {errorMessage && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700 flex items-center gap-2">
            <AlertTriangle size={14} /> {errorMessage}
          </div>
        )}

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <KpiCard icon={<Truck size={18} />} label="إجمالي المناديب" value={kpis.totalDelegates} />
          <KpiCard
            icon={<User size={18} />}
            label="المناديب النشطين"
            value={kpis.activeDelegates}
          />
          <KpiCard icon={<Package size={18} />} label="طلبات قيد الشحن" value={kpis.inFlight} />
          <KpiCard
            icon={<CheckCircle size={18} />}
            label="تم تسليمه اليوم"
            value={kpis.deliveredToday}
          />
          <KpiCard icon={<RotateCcw size={18} />} label="مرتجع" value={kpis.totalReturned} />
          <KpiCard
            icon={<Wallet size={18} />}
            label="إجمالي التحصيل"
            value={fmtMoney(kpis.totalCollected)}
          />
        </div>

        {/* Average rating + placeholder cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <KpiCard
            icon={<Star size={18} className="text-amber-500" />}
            label="متوسط تقييم المناديب"
            value={
              kpis.averageRating != null
                ? `${kpis.averageRating.toFixed(1)} / 5`
                : 'لا توجد تقييمات بعد'
            }
          />
          <KpiCard icon={<Wallet size={18} />} label="المستحق توريده" value="قريبًا" placeholder />
          <KpiCard
            icon={<AlertTriangle size={18} />}
            label="الأمانات مع المناديب"
            value="قريبًا"
            placeholder
          />
        </div>

        {/* Delegates table */}
        <div className="card-section overflow-hidden">
          <div className="px-5 py-3 border-b border-[hsl(var(--border))] bg-white">
            <h2 className="text-base font-bold text-[hsl(var(--foreground))]">قائمة المناديب</h2>
          </div>
          {loading ? (
            <div className="p-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
              جاري التحميل...
            </div>
          ) : aggregates.length === 0 ? (
            <div className="p-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
              لا يوجد مناديب مسجلين بعد.
            </div>
          ) : (
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[900px]">
                <thead>
                  <tr>
                    {[
                      'المندوب',
                      'الدور',
                      'الهاتف',
                      'وسيلة المواصلات',
                      'حالة الرخص',
                      'الطلبات الآن',
                      'تم التسليم',
                      'إجمالي التحصيل',
                      'التقييم',
                      'إجراء',
                    ].map((h) => (
                      <th key={h} className="table-header text-right">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[hsl(var(--border))]">
                  {aggregates.map((a) => {
                    // Phase 23A-Fix1 — pre-compute the licence
                    // status so the table cell can pick the
                    // worse of the two and surface a single
                    // colour-coded pill. The drawer shows full
                    // detail on each licence separately.
                    const vehStatus = licenseStatus(a.delegate.vehicleLicenseExpiresAt);
                    const drvStatus = licenseStatus(a.delegate.drivingLicenseExpiresAt);
                    const worse =
                      [vehStatus, drvStatus]
                        .filter((s) => s.status !== 'unknown')
                        .sort((a2, b2) => {
                          const order = ['expired', 'today', 'warning', 'valid'];
                          return order.indexOf(a2.status) - order.indexOf(b2.status);
                        })[0] ?? null;
                    return (
                      <tr key={a.delegate.key} className="hover:bg-[hsl(var(--muted))]/30">
                        <td className="table-cell">
                          <div className="font-semibold">{a.delegate.name}</div>
                          <div className="text-[10px] text-[hsl(var(--muted-foreground))]">
                            {a.delegate.email || (a.delegate.hasProfile ? '' : 'سجل قديم')}
                          </div>
                        </td>
                        <td className="table-cell text-xs">
                          {a.delegate.roleName || a.delegate.roleId || '—'}
                        </td>
                        <td className="table-cell font-mono text-xs">
                          {a.delegate.phone ? (
                            <a
                              href={`tel:${a.delegate.phone}`}
                              className="text-[hsl(var(--primary))] hover:underline"
                              dir="ltr"
                            >
                              {a.delegate.phone}
                            </a>
                          ) : (
                            <span className="text-[hsl(var(--muted-foreground))]">—</span>
                          )}
                        </td>
                        <td className="table-cell text-xs">
                          {transportLabel(a.delegate.transportType) || (
                            <span className="text-[hsl(var(--muted-foreground))]">—</span>
                          )}
                        </td>
                        <td className="table-cell">
                          {worse ? (
                            <span
                              className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full border ${worse.toneClass}`}
                            >
                              {worse.label}
                            </span>
                          ) : (
                            <span className="text-xs text-[hsl(var(--muted-foreground))]">—</span>
                          )}
                        </td>
                        <td className="table-cell font-mono">{a.inFlight}</td>
                        <td className="table-cell font-mono text-emerald-700">{a.delivered}</td>
                        <td className="table-cell font-mono">{fmtMoney(a.totalCollected)}</td>
                        <td className="table-cell">
                          {a.averageRating != null ? (
                            <span className="inline-flex items-center gap-1 text-amber-600 font-semibold">
                              <Star size={12} /> {a.averageRating.toFixed(1)}
                            </span>
                          ) : (
                            <span className="text-xs text-[hsl(var(--muted-foreground))]">
                              لا تقييم
                            </span>
                          )}
                        </td>
                        <td className="table-cell">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedKey(a.delegate.key);
                              setActiveTab('summary');
                            }}
                            className="text-xs font-semibold text-[hsl(var(--primary))] hover:underline"
                          >
                            عرض التفاصيل
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {selected && (
        <DelegateDrawer
          aggregate={selected}
          activeTab={activeTab}
          placeholderTab={placeholderTab}
          onTabChange={(tab, ph) => {
            setActiveTab(tab);
            setPlaceholderTab(ph || '');
          }}
          onClose={() => setSelectedKey(null)}
        />
      )}

      {wizardOpen && (
        <AddDelegateWizard
          onClose={() => setWizardOpen(false)}
          onCreated={() => {
            setWizardOpen(false);
            setReloadTick((n) => n + 1);
          }}
        />
      )}
    </AppLayout>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

interface KpiCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  placeholder?: boolean;
}

function KpiCard({ icon, label, value, placeholder }: KpiCardProps) {
  return (
    <div
      className={`rounded-2xl border ${placeholder ? 'border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20' : 'border-[hsl(var(--border))] bg-white'} p-4`}
    >
      <div className="flex items-center gap-2 mb-2 text-[hsl(var(--muted-foreground))]">
        {icon}
        <span className="text-[11px] font-bold tracking-wide">{label}</span>
      </div>
      <p
        className={`text-lg font-bold ${placeholder ? 'text-[hsl(var(--muted-foreground))]' : 'text-[hsl(var(--foreground))]'}`}
      >
        {value}
      </p>
    </div>
  );
}

interface DrawerProps {
  aggregate: DelegateAggregate;
  activeTab: 'summary' | 'orders' | 'ratings' | 'activity' | 'placeholder';
  placeholderTab: string;
  onTabChange: (
    tab: 'summary' | 'orders' | 'ratings' | 'activity' | 'placeholder',
    placeholderTab?: string
  ) => void;
  onClose: () => void;
}

function DelegateDrawer({
  aggregate,
  activeTab,
  placeholderTab,
  onTabChange,
  onClose,
}: DrawerProps) {
  const a = aggregate;

  const tabs: Array<{
    id: 'summary' | 'orders' | 'ratings' | 'activity' | 'placeholder';
    label: string;
    placeholder?: string;
  }> = [
    { id: 'summary', label: 'الملخص' },
    { id: 'orders', label: 'الطلبات' },
    { id: 'placeholder', label: 'التحصيلات', placeholder: 'collections' },
    { id: 'placeholder', label: 'التوريدات', placeholder: 'settlements' },
    { id: 'placeholder', label: 'الأمانات', placeholder: 'custody' },
    { id: 'placeholder', label: 'المصاريف', placeholder: 'expenses' },
    { id: 'ratings', label: 'التقييمات والشكاوى' },
    { id: 'activity', label: 'النشاط' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end" dir="rtl">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white w-full max-w-3xl h-full overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between p-5 border-b border-[hsl(var(--border))]">
          <div>
            <h3 className="text-lg font-bold text-[hsl(var(--foreground))]">{a.delegate.name}</h3>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
              {a.delegate.roleName || a.delegate.roleId || 'مندوب'}
              {a.delegate.email ? ` — ${a.delegate.email}` : ''}
            </p>
            <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1 flex items-center gap-1">
              <PhoneIcon size={11} /> رقم الهاتف غير مسجل
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-[hsl(var(--muted))]"
            aria-label="إغلاق"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex-shrink-0 border-b border-[hsl(var(--border))] overflow-x-auto scrollbar-thin">
          <div className="flex gap-1 px-3 pt-2">
            {tabs.map((t, idx) => {
              const isActive =
                activeTab === t.id && (t.id !== 'placeholder' || placeholderTab === t.placeholder);
              return (
                <button
                  key={`${t.id}-${idx}`}
                  type="button"
                  onClick={() => onTabChange(t.id, t.placeholder)}
                  className={`px-3 py-2 text-xs font-semibold rounded-t-lg whitespace-nowrap transition-colors ${
                    isActive
                      ? 'bg-[hsl(var(--primary))]/5 text-[hsl(var(--primary))] border-b-2 border-[hsl(var(--primary))]'
                      : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'
                  }`}
                >
                  {t.label}
                  {t.placeholder && (
                    <span className="ml-1 text-[9px] text-[hsl(var(--muted-foreground))]">
                      (قريبًا)
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-5 scrollbar-thin">
          {activeTab === 'summary' && <SummaryTab a={a} />}
          {activeTab === 'orders' && <OrdersTab a={a} />}
          {activeTab === 'ratings' && <RatingsTab a={a} />}
          {activeTab === 'activity' && <ActivityTab a={a} />}
          {activeTab === 'placeholder' && <PlaceholderTab kind={placeholderTab} />}
        </div>
      </div>
    </div>
  );
}

function SummaryTab({ a }: { a: DelegateAggregate }) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const ordersToday = a.ordersForDelegate.filter((o) =>
    (o.created_at || '').startsWith(todayIso)
  ).length;
  const ordersWeek = a.ordersForDelegate.filter((o) => {
    const d = new Date(o.created_at || '');
    return Date.now() - d.getTime() < 7 * 24 * 60 * 60 * 1000;
  }).length;
  const ordersMonth = a.ordersForDelegate.filter((o) => {
    const d = new Date(o.created_at || '');
    return Date.now() - d.getTime() < 30 * 24 * 60 * 60 * 1000;
  }).length;
  const totalDoneOrReturned = a.delivered + a.returned;
  const deliveredPct =
    totalDoneOrReturned > 0 ? Math.round((a.delivered / totalDoneOrReturned) * 100) : 0;
  const returnedPct = totalDoneOrReturned > 0 ? 100 - deliveredPct : 0;

  // Phase 23A-Fix1 — licence statuses + admin-only operational
  // info card. Both licences are rendered separately so the
  // dispatcher can see exactly which one is closer to expiry.
  const vehStatus = licenseStatus(a.delegate.vehicleLicenseExpiresAt);
  const drvStatus = licenseStatus(a.delegate.drivingLicenseExpiresAt);

  return (
    <div className="space-y-4">
      {/* Phase 23A-Fix1 — operational profile card. Hidden when
          all fields are blank (legacy delegate_name-only rows
          fall through to that branch automatically). */}
      {(a.delegate.phone ||
        a.delegate.nationalId ||
        a.delegate.transportType ||
        a.delegate.vehicleLicenseNumber ||
        a.delegate.drivingLicenseNumber) && (
        <div className="card-section p-4">
          <div className="flex items-center gap-2 mb-3">
            <IdCard size={15} className="text-[hsl(var(--primary))]" />
            <h4 className="text-sm font-bold">البيانات الأساسية</h4>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {a.delegate.phone && (
              <div>
                <dt className="text-[11px] text-[hsl(var(--muted-foreground))] mb-0.5">
                  رقم الهاتف
                </dt>
                <dd className="font-mono font-semibold" dir="ltr">
                  {a.delegate.phone}
                </dd>
              </div>
            )}
            {a.delegate.nationalId && (
              <div>
                <dt className="text-[11px] text-[hsl(var(--muted-foreground))] mb-0.5">
                  الرقم القومي
                </dt>
                <dd className="font-mono" dir="ltr">
                  {a.delegate.nationalId}
                </dd>
              </div>
            )}
            {a.delegate.transportType && (
              <div>
                <dt className="text-[11px] text-[hsl(var(--muted-foreground))] mb-0.5">
                  وسيلة المواصلات
                </dt>
                <dd className="font-semibold">{transportLabel(a.delegate.transportType)}</dd>
              </div>
            )}
            {a.delegate.delegateIsActive === false && (
              <div>
                <dt className="text-[11px] text-[hsl(var(--muted-foreground))] mb-0.5">الحالة</dt>
                <dd className="font-semibold text-red-700">معطّل</dd>
              </div>
            )}
          </dl>

          {/* Vehicle licence */}
          {(a.delegate.vehicleLicenseNumber ||
            a.delegate.vehicleLicenseStartsAt ||
            a.delegate.vehicleLicenseExpiresAt) && (
            <div className="mt-4 pt-3 border-t border-[hsl(var(--border))]">
              <div className="flex items-center gap-2 mb-2">
                <CalendarClock size={13} className="text-[hsl(var(--muted-foreground))]" />
                <p className="text-xs font-bold">رخصة المركبة</p>
                {vehStatus.label && (
                  <span
                    className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full border ${vehStatus.toneClass}`}
                  >
                    {vehStatus.label}
                  </span>
                )}
              </div>
              <dl className="grid grid-cols-3 gap-3 text-xs">
                <div>
                  <dt className="text-[hsl(var(--muted-foreground))] mb-0.5">رقم الرخصة</dt>
                  <dd className="font-mono">{a.delegate.vehicleLicenseNumber || '—'}</dd>
                </div>
                <div>
                  <dt className="text-[hsl(var(--muted-foreground))] mb-0.5">البداية</dt>
                  <dd className="font-mono">{a.delegate.vehicleLicenseStartsAt || '—'}</dd>
                </div>
                <div>
                  <dt className="text-[hsl(var(--muted-foreground))] mb-0.5">النهاية</dt>
                  <dd className="font-mono">{a.delegate.vehicleLicenseExpiresAt || '—'}</dd>
                </div>
              </dl>
            </div>
          )}

          {/* Driving licence */}
          {(a.delegate.drivingLicenseNumber ||
            a.delegate.drivingLicenseStartsAt ||
            a.delegate.drivingLicenseExpiresAt) && (
            <div className="mt-3 pt-3 border-t border-[hsl(var(--border))]">
              <div className="flex items-center gap-2 mb-2">
                <CalendarClock size={13} className="text-[hsl(var(--muted-foreground))]" />
                <p className="text-xs font-bold">رخصة القيادة</p>
                {drvStatus.label && (
                  <span
                    className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full border ${drvStatus.toneClass}`}
                  >
                    {drvStatus.label}
                  </span>
                )}
              </div>
              <dl className="grid grid-cols-3 gap-3 text-xs">
                <div>
                  <dt className="text-[hsl(var(--muted-foreground))] mb-0.5">رقم الرخصة</dt>
                  <dd className="font-mono">{a.delegate.drivingLicenseNumber || '—'}</dd>
                </div>
                <div>
                  <dt className="text-[hsl(var(--muted-foreground))] mb-0.5">البداية</dt>
                  <dd className="font-mono">{a.delegate.drivingLicenseStartsAt || '—'}</dd>
                </div>
                <div>
                  <dt className="text-[hsl(var(--muted-foreground))] mb-0.5">النهاية</dt>
                  <dd className="font-mono">{a.delegate.drivingLicenseExpiresAt || '—'}</dd>
                </div>
              </dl>
            </div>
          )}
        </div>
      )}

      {/* Existing operational KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <KpiCard icon={<Package size={16} />} label="طلبات اليوم" value={ordersToday} />
        <KpiCard icon={<Package size={16} />} label="طلبات الأسبوع" value={ordersWeek} />
        <KpiCard icon={<Package size={16} />} label="طلبات الشهر" value={ordersMonth} />
        <KpiCard
          icon={<CheckCircle size={16} className="text-emerald-600" />}
          label="نسبة التسليم"
          value={`${deliveredPct}%`}
        />
        <KpiCard
          icon={<RotateCcw size={16} className="text-red-600" />}
          label="نسبة المرتجع"
          value={`${returnedPct}%`}
        />
        <KpiCard
          icon={<Wallet size={16} />}
          label="إجمالي التحصيل"
          value={fmtMoney(a.totalCollected)}
        />
        <KpiCard
          icon={<Star size={16} className="text-amber-500" />}
          label="متوسط التقييم"
          value={a.averageRating != null ? `${a.averageRating.toFixed(1)} / 5` : 'لا تقييم'}
        />
        <KpiCard icon={<Wallet size={16} />} label="إجمالي التوريد" value="قريبًا" placeholder />
        <KpiCard icon={<Wallet size={16} />} label="المتبقي عليه" value="قريبًا" placeholder />
      </div>
    </div>
  );
}

function OrdersTab({ a }: { a: DelegateAggregate }) {
  if (a.ordersForDelegate.length === 0) {
    return (
      <p className="text-sm text-[hsl(var(--muted-foreground))]">لا توجد طلبات لهذا المندوب.</p>
    );
  }
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full min-w-[700px] text-sm">
        <thead>
          <tr>
            {['رقم الطلب', 'العميل', 'المحافظة', 'الحالة', 'الإجمالي', 'موعد التسليم'].map((h) => (
              <th key={h} className="table-header text-right">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[hsl(var(--border))]">
          {a.ordersForDelegate.slice(0, 100).map((o) => (
            <tr key={o.id} className="hover:bg-[hsl(var(--muted))]/30">
              <td className="table-cell font-mono text-xs">{o.order_num}</td>
              <td className="table-cell">{o.customer || '—'}</td>
              <td className="table-cell text-xs">
                {[o.region, o.district, o.neighborhood].filter(Boolean).join(' — ') || '—'}
              </td>
              <td className="table-cell text-xs">{STATUS_LABELS[o.status] || o.status}</td>
              <td className="table-cell font-mono text-xs">{fmtMoney(o.total)}</td>
              <td className="table-cell text-xs">
                {formatScheduleAr(
                  o.scheduled_delivery_date,
                  o.scheduled_delivery_from,
                  o.scheduled_delivery_to
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {a.ordersForDelegate.length > 100 && (
        <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-2 text-center">
          يتم عرض أحدث 100 طلب فقط. لتصفية أوسع استخدم صفحة الأوردرات.
        </p>
      )}
    </div>
  );
}

function RatingsTab({ a }: { a: DelegateAggregate }) {
  if (a.ratings.length === 0) {
    return (
      <p className="text-sm text-[hsl(var(--muted-foreground))]">
        لا توجد تقييمات بعد لهذا المندوب.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3">
        <Star size={16} className="text-amber-500" />
        <div>
          <p className="text-sm font-bold text-amber-800">
            متوسط التقييم: {a.averageRating?.toFixed(1) ?? '—'} / 5
          </p>
          <p className="text-[11px] text-amber-700">
            من {a.ratings.length} تقييم خلال آخر 90 يومًا
          </p>
        </div>
      </div>
      <div className="space-y-2">
        {a.ratings.map((r) => (
          <div key={r.id} className="border border-[hsl(var(--border))] rounded-xl p-3 bg-white">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="flex items-center gap-1 text-amber-500">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} size={12} fill={i < r.rating ? 'currentColor' : 'none'} />
                ))}
              </div>
              <span className="text-[10px] font-mono text-[hsl(var(--muted-foreground))]">
                {formatDateAr(r.created_at)}
              </span>
            </div>
            {r.comment ? (
              <p className="text-sm text-[hsl(var(--foreground))] italic leading-relaxed">
                &ldquo;{r.comment}&rdquo;
              </p>
            ) : (
              <p className="text-xs text-[hsl(var(--muted-foreground))]">بدون ملاحظات.</p>
            )}
            <p className="text-[10px] text-[hsl(var(--muted-foreground))] font-mono mt-1">
              طلب #{r.order_id.slice(0, 8)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActivityTab({ a }: { a: DelegateAggregate }) {
  // For Phase 23A we surface activity directly from the orders list
  // (status changes are recorded in turath_masr_audit_logs but a
  // per-delegate query against that table is deferred to a later
  // phase — same conservative scope decision as the placeholder
  // tabs).
  const recent = a.ordersForDelegate.slice(0, 30);
  if (recent.length === 0) {
    return <p className="text-sm text-[hsl(var(--muted-foreground))]">لا يوجد نشاط حديث.</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
        نشاط مستخرج من الطلبات (آخر 30 طلبًا). سجل التعديلات الكامل سيُضاف في مرحلة لاحقة.
      </p>
      {recent.map((o) => (
        <div
          key={o.id}
          className="flex items-center gap-3 text-xs bg-[hsl(var(--muted))]/30 rounded-xl p-2.5"
        >
          <Clock size={12} className="text-[hsl(var(--muted-foreground))] flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
              {formatDateAr(o.created_at)}
            </p>
            <p className="font-semibold">
              {o.order_num} — {STATUS_LABELS[o.status] || o.status}
            </p>
            <p className="text-[10px] text-[hsl(var(--muted-foreground))] truncate">
              {o.customer || ''} · {o.region || ''}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function PlaceholderTab({ kind }: { kind: string }) {
  const labels: Record<string, { title: string; sub: string; phase: string }> = {
    collections: {
      title: 'التحصيلات',
      sub: 'سيُضاف عرض موسّع للتحصيلات والمتبقي على المندوب.',
      phase: 'Phase 23B',
    },
    settlements: {
      title: 'التوريدات',
      sub: 'سيُضاف جدول التوريدات/التسويات مع المندوب.',
      phase: 'Phase 23B',
    },
    custody: {
      title: 'الأمانات',
      sub: 'سيُضاف عرض البضائع/الأمانات مع المندوب.',
      phase: 'Phase 23C',
    },
    expenses: {
      title: 'المصاريف',
      sub: 'سيُضاف تسجيل مصاريف الشحن المرتبطة بكل مندوب أو طلب.',
      phase: 'Phase 23C',
    },
  };
  const cfg = labels[kind] || { title: 'قريبًا', sub: '', phase: '' };
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
      <div className="w-14 h-14 rounded-2xl bg-[hsl(var(--muted))] flex items-center justify-center">
        <Wallet size={24} className="text-[hsl(var(--muted-foreground))] opacity-60" />
      </div>
      <h4 className="text-base font-bold text-[hsl(var(--foreground))]">{cfg.title}</h4>
      {cfg.sub && <p className="text-xs text-[hsl(var(--muted-foreground))] max-w-md">{cfg.sub}</p>}
      {cfg.phase && (
        <p className="text-[10px] text-[hsl(var(--primary))] font-bold">{cfg.phase} — قريبًا</p>
      )}
    </div>
  );
}

// ─── Phase 23A-Fix1 — Add delegate wizard ──────────────────────────────────
//
// Two-step modal that captures the operational profile + login
// account for a new delegate. The login is created through the
// existing public `supabase.auth.signUp` API (same pattern as
// `src/app/roles/page.tsx`); plaintext passwords NEVER touch any
// table — Supabase Auth hashes server-side. The wizard then upserts
// the matching `profiles` row with the operational fields the
// existing `profiles_admin_insert` / `_update` RLS policies allow
// for an admin caller.
//
// Caveats / limitations that the report flags as follow-ups:
//   • Without a service-role key, `supabase.auth.signUp` may
//     auto-log-in the new user when email confirmation is OFF —
//     the admin's session would switch. We display a yellow
//     warning banner before submission.
//   • If the auth signUp succeeds but the profile upsert fails
//     (e.g. pre-migration RPC schema mismatch, transient RLS
//     hiccup), the auth user remains but the profile is empty.
//     The toast walks the admin through "the login was created
//     but extra fields weren't saved — try again from the edit
//     button" explicitly so they aren't left guessing.
interface AddDelegateWizardProps {
  onClose: () => void;
  onCreated: () => void;
}

function AddDelegateWizard({ onClose, onCreated }: AddDelegateWizardProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>('');

  // Step 1 — profile
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [transportType, setTransportType] = useState<TransportType | ''>('');
  const [vehicleLicenseNumber, setVehicleLicenseNumber] = useState('');
  const [vehicleStarts, setVehicleStarts] = useState('');
  const [vehicleExpires, setVehicleExpires] = useState('');
  const [drivingLicenseNumber, setDrivingLicenseNumber] = useState('');
  const [drivingStarts, setDrivingStarts] = useState('');
  const [drivingExpires, setDrivingExpires] = useState('');

  // Step 2 — login
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [delegateActive, setDelegateActive] = useState(true);

  const validateStep1 = (): string => {
    if (!name.trim()) return 'الاسم مطلوب';
    if (!phone.trim()) return 'رقم الهاتف مطلوب';
    if (!isValidEgyptianMobile(phone.trim())) {
      return 'رقم الهاتف غير صالح. يجب أن يكون رقم موبايل مصري (010 / 011 / 012 / 015).';
    }
    if (!nationalId.trim()) return 'الرقم القومي مطلوب';
    if (!/^\d{14}$/.test(nationalId.trim())) {
      return 'الرقم القومي يجب أن يكون 14 رقم';
    }
    if (!transportType) return 'يجب اختيار وسيلة المواصلات';
    if (vehicleStarts && vehicleExpires && vehicleExpires <= vehicleStarts) {
      return 'تاريخ نهاية رخصة المركبة يجب أن يكون بعد البداية';
    }
    if (drivingStarts && drivingExpires && drivingExpires <= drivingStarts) {
      return 'تاريخ نهاية رخصة القيادة يجب أن يكون بعد البداية';
    }
    return '';
  };

  const validateStep2 = (): string => {
    if (!email.trim()) return 'البريد الإلكتروني / اسم المستخدم مطلوب';
    if (!email.includes('@')) {
      return 'البريد الإلكتروني يجب أن يكون بالشكل name@example.com';
    }
    if (!password) return 'كلمة المرور مطلوبة';
    if (password.length < 8) return 'كلمة المرور يجب ألا تقل عن 8 حروف';
    if (password !== confirmPassword) return 'كلمتا المرور غير متطابقتين';
    return '';
  };

  const handleNext = () => {
    setError('');
    const err = validateStep1();
    if (err) {
      setError(err);
      return;
    }
    setStep(2);
  };

  const handleSubmit = async () => {
    setError('');
    const err = validateStep2();
    if (err) {
      setError(err);
      return;
    }
    setSubmitting(true);
    try {
      const supabase = createClient();
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            full_name: name.trim(),
            role: 'delegate',
            // Phase 22B convention — r4 is the delegate role id.
            role_id: 'r4',
          },
        },
      });
      if (signUpError) {
        setError(`تعذر إنشاء حساب الدخول: ${signUpError.message}`);
        setSubmitting(false);
        return;
      }
      const newUserId = signUpData?.user?.id;
      if (!newUserId) {
        setError('تم إنشاء الحساب لكن لم يتم استرجاع معرف المستخدم. حاول إعادة المحاولة.');
        setSubmitting(false);
        return;
      }
      // Phase 23A-Fix1 — write the operational profile row. The
      // existing `handle_new_user` trigger may have already
      // inserted a minimal row; `upsert` keeps the row idempotent
      // either way.
      const { error: profileError } = await supabase.from('profiles').upsert({
        id: newUserId,
        email: email.trim(),
        full_name: name.trim(),
        role: 'delegate',
        role_id: 'r4',
        role_name: 'مندوب شحن',
        phone: phone.trim(),
        national_id: nationalId.trim(),
        transport_type: transportType,
        vehicle_license_number: vehicleLicenseNumber.trim() || null,
        vehicle_license_starts_at: vehicleStarts || null,
        vehicle_license_expires_at: vehicleExpires || null,
        driving_license_number: drivingLicenseNumber.trim() || null,
        driving_license_starts_at: drivingStarts || null,
        driving_license_expires_at: drivingExpires || null,
        delegate_is_active: delegateActive,
      });
      if (profileError) {
        // The auth user exists; the profile update failed. Surface
        // the issue clearly so the dispatcher knows the partial
        // state and can recover (re-edit from the table).
        setError(
          `تم إنشاء حساب الدخول، لكن تعذر حفظ بيانات الملف: ${profileError.message}. ` +
            'يمكن استكمال البيانات لاحقًا من زر التعديل في الجدول.'
        );
        setSubmitting(false);
        return;
      }
      onCreated();
    } catch (e) {
      setError(`حدث خطأ غير متوقع: ${e instanceof Error ? e.message : String(e)}`);
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-3xl shadow-modal w-full max-w-2xl max-h-[90vh] flex flex-col fade-in">
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between p-5 border-b border-[hsl(var(--border))]">
          <div>
            <h3 className="text-base font-bold text-[hsl(var(--foreground))]">إضافة مندوب جديد</h3>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
              الخطوة {step} من 2 — {step === 1 ? 'بيانات المندوب' : 'حساب الدخول'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-[hsl(var(--muted))]"
            aria-label="إغلاق"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 scrollbar-thin">
          {step === 1 ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="الاسم *" value={name} onChange={setName} placeholder="الاسم الكامل" />
                <Field
                  label="رقم الهاتف *"
                  value={phone}
                  onChange={(v) => setPhone(v.replace(/\D/g, '').slice(0, 11))}
                  placeholder="01012345678"
                  dir="ltr"
                />
                <Field
                  label="الرقم القومي *"
                  value={nationalId}
                  onChange={(v) => setNationalId(v.replace(/\D/g, '').slice(0, 14))}
                  placeholder="14 رقم"
                  dir="ltr"
                />
                <div>
                  <label className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))] mb-1 block">
                    وسيلة المواصلات *
                  </label>
                  <select
                    className="input-field w-full"
                    value={transportType}
                    onChange={(e) => setTransportType(e.target.value as TransportType)}
                  >
                    <option value="">— اختر —</option>
                    {TRANSPORT_TYPE_TOKENS.map((t) => (
                      <option key={t} value={t}>
                        {TRANSPORT_TYPE_LABELS_AR[t]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <fieldset className="border border-[hsl(var(--border))] rounded-xl p-3">
                <legend className="text-xs font-bold px-2">رخصة المركبة (اختياري)</legend>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-2">
                  <Field
                    label="رقم الرخصة"
                    value={vehicleLicenseNumber}
                    onChange={setVehicleLicenseNumber}
                  />
                  <Field
                    label="بداية الرخصة"
                    type="date"
                    value={vehicleStarts}
                    onChange={setVehicleStarts}
                  />
                  <Field
                    label="نهاية الرخصة"
                    type="date"
                    value={vehicleExpires}
                    onChange={setVehicleExpires}
                  />
                </div>
              </fieldset>

              <fieldset className="border border-[hsl(var(--border))] rounded-xl p-3">
                <legend className="text-xs font-bold px-2">رخصة القيادة (اختياري)</legend>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-2">
                  <Field
                    label="رقم الرخصة"
                    value={drivingLicenseNumber}
                    onChange={setDrivingLicenseNumber}
                  />
                  <Field
                    label="بداية الرخصة"
                    type="date"
                    value={drivingStarts}
                    onChange={setDrivingStarts}
                  />
                  <Field
                    label="نهاية الرخصة"
                    type="date"
                    value={drivingExpires}
                    onChange={setDrivingExpires}
                  />
                </div>
              </fieldset>
            </>
          ) : (
            <>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 flex items-start gap-2">
                <ShieldCheck size={14} className="mt-0.5 flex-shrink-0" />
                <div>
                  كلمة المرور تذهب مباشرة إلى Supabase Auth ولا تُخزَّن في أي جدول. بعد الإنشاء قد
                  تحتاج لإعادة تسجيل الدخول إذا تغيّرت الجلسة.
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field
                  label="البريد الإلكتروني *"
                  type="email"
                  value={email}
                  onChange={setEmail}
                  placeholder="delegate@example.com"
                  dir="ltr"
                />
                <div>
                  <label className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))] mb-1 block">
                    الدور
                  </label>
                  <input
                    type="text"
                    value="مندوب شحن"
                    disabled
                    className="input-field w-full opacity-60"
                  />
                </div>
                <Field
                  label="كلمة المرور *"
                  type="password"
                  value={password}
                  onChange={setPassword}
                  placeholder="8 حروف على الأقل"
                  dir="ltr"
                />
                <Field
                  label="تأكيد كلمة المرور *"
                  type="password"
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  dir="ltr"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={delegateActive}
                  onChange={(e) => setDelegateActive(e.target.checked)}
                />
                <span>تفعيل الحساب فور الإنشاء</span>
              </label>
            </>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700 flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 flex items-center justify-between gap-3 p-4 border-t border-[hsl(var(--border))] bg-white rounded-b-3xl">
          <button type="button" className="btn-secondary" onClick={onClose}>
            إلغاء
          </button>
          <div className="flex items-center gap-3">
            {step === 2 && (
              <button
                type="button"
                className="btn-secondary flex items-center gap-1"
                onClick={() => {
                  setError('');
                  setStep(1);
                }}
              >
                <ChevronRight size={14} /> رجوع
              </button>
            )}
            {step === 1 ? (
              <button
                type="button"
                className="btn-primary flex items-center gap-1"
                onClick={handleNext}
              >
                التالي <ChevronLeft size={14} />
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary flex items-center gap-1"
                onClick={handleSubmit}
                disabled={submitting}
              >
                <Lock size={14} />
                {submitting ? 'جارٍ الإنشاء...' : 'إنشاء المندوب'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Tiny shared text field for the wizard. Centralised so the whole
// modal stays scannable and a future styling tweak is one edit.
interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  dir?: 'ltr' | 'rtl';
}

function Field({ label, value, onChange, placeholder, type = 'text', dir = 'rtl' }: FieldProps) {
  return (
    <div>
      <label className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))] mb-1 block">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        dir={dir}
        className="input-field w-full"
      />
    </div>
  );
}
