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
  Pencil,
  Power,
  Banknote,
  Briefcase,
  Receipt,
  FileText,
  Download,
  Printer,
} from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { createClient } from '@/lib/supabase/client';
import { isValidEgyptianMobile } from '@/lib/validators/phone';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/contexts/AuthContext';
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
// Phase 23B — settlement method tokens + Arabic labels for the new
// "تسجيل توريد" modal and the per-delegate settlements table.
import {
  SETTLEMENT_METHOD_TOKENS,
  SETTLEMENT_METHOD_LABELS_AR,
  settlementMethodLabel,
  type SettlementMethod,
} from '@/lib/delegates/settlementMethods';
// Phase 23C — custody (الأمانات) and expenses (المصاريف) helpers.
import {
  CUSTODY_TYPE_TOKENS,
  CUSTODY_TYPE_LABELS_AR,
  custodyTypeLabel,
  type CustodyType,
  CUSTODY_STATUS_TOKENS,
  CUSTODY_STATUS_LABELS_AR,
  CUSTODY_STATUS_TONE,
  custodyStatusLabel,
  type CustodyStatus,
} from '@/lib/delegates/custodyTypes';
import {
  EXPENSE_TYPE_TOKENS,
  EXPENSE_TYPE_LABELS_AR,
  expenseTypeLabel,
  type ExpenseType,
  EXPENSE_STATUS_TONE,
  expenseStatusLabel,
} from '@/lib/delegates/expenseTypes';
// Phase 23D — pure helpers for the account-statement tab + CSV.
import {
  RANGE_PRESET_LABELS,
  resolveRangePreset,
  isValidRange,
  rangeDays,
  buildStatementRows,
  summariseStatement,
  toCsv,
  downloadCsv,
  csvFilename,
  toIsoDate,
  fromIsoDate,
  type StatementRangePreset,
  type DelegateStatementRow,
  type DelegateStatementSummary,
  type StatementOrderInput,
  type StatementSettlementInput,
  type StatementExpenseInput,
  type StatementCustodyInput,
} from '@/lib/delegates/accountStatement';

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

// Phase 23B — settlement (توريد) row. Mirrors the columns staged in
// `20260510210000_delegate_settlements.sql` 1:1. Pre-migration the
// table doesn't exist; the page swallows the 42P01 and falls back
// to an empty array so KPIs render zeros.
interface SettlementRow {
  id: string;
  delegate_profile_id: string | null;
  delegate_name: string | null;
  amount: number;
  method: string;
  received_by: string | null;
  received_by_name: string | null;
  note: string | null;
  settled_at: string;
  created_at: string;
}

// Phase 23C — custody (الأمانات / العهد) row. Mirrors the columns
// staged in `20260510220000_delegate_custody_and_expenses.sql`.
interface CustodyRow {
  id: string;
  delegate_profile_id: string | null;
  delegate_name: string | null;
  custody_type: string;
  description: string;
  quantity: number | null;
  estimated_value: number | null;
  status: string;
  handed_by: string | null;
  handed_by_name: string | null;
  received_by: string | null;
  received_by_name: string | null;
  handed_at: string;
  returned_at: string | null;
  note: string | null;
  created_at: string;
}

// Phase 23C — expense (مصروف) row. Same migration; `expense_at`
// is the real-world date (back-datable), `created_at` is the
// immutable record-creation timestamp.
interface ExpenseRow {
  id: string;
  delegate_profile_id: string | null;
  delegate_name: string | null;
  order_id: string | null;
  expense_type: string;
  amount: number;
  status: string;
  approved_by: string | null;
  approved_by_name: string | null;
  note: string | null;
  expense_at: string;
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
  // Phase 23B — settlement aggregates. `settlements` is the per-
  // delegate timeline (newest first). The three numbers feed the
  // table cells and drawer summary directly.
  settlements: SettlementRow[];
  totalSettled: number;
  remainingDue: number;
  lastSettledAt: string | null;
  // Phase 23C — custody + expenses aggregates.
  //   activeCustodyValue   = sum(estimated_value) where status='with_delegate'
  //   activeCustodyCount   = count where status='with_delegate'
  //   activeCashCustody    = sum(estimated_value) where status='with_delegate'
  //                          AND custody_type='cash'  (shown separately)
  //   approvedExpensesTotal= sum(amount) where status='approved'
  //   adjustedRemaining    = totalCollected - totalSettled - approvedExpensesTotal
  //                          (custody value NEVER subtracted automatically)
  custody: CustodyRow[];
  activeCustodyValue: number;
  activeCustodyCount: number;
  activeCashCustody: number;
  expenses: ExpenseRow[];
  approvedExpensesTotal: number;
  adjustedRemaining: number;
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
  const perms = usePermissions();
  const { user, profileFullName } = useAuth();
  // Phase 23A-Fix2 — only admins (r1) can edit profile fields or
  // toggle `delegate_is_active`. The underlying RLS policy on
  // `public.profiles` (`profiles_admin_update`) is gated on
  // `is_admin()`, so any non-admin caller would get a 42501 from
  // PostgREST. Hiding the buttons keeps the UI honest.
  const canEditDelegate = perms.isAdmin;
  // Phase 23B — settlement writes are admin-only by RLS
  // (`settlements_admin_insert`). Reads are also admin-only on the
  // RLS side; we still gate the UI button to keep it consistent.
  const canRegisterSettlement = perms.isAdmin;
  // Phase 23C — custody + expenses writes are admin-only by RLS
  // (`custody_admin_*` / `expenses_admin_*`). Same UI gate.
  const canManageCustody = perms.isAdmin;
  const canManageExpenses = perms.isAdmin;
  // Phase 23D — CSV export of the per-delegate account statement is
  // admin-only because the export carries financial movements. Non-
  // admin viewers can read the on-screen statement (gated by the
  // same RLS that fed the page) but cannot persist it to disk.
  const canExportStatement = perms.isAdmin;

  const [profiles, setProfiles] = useState<DelegateRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [ratings, setRatings] = useState<RatingRow[]>([]);
  // Phase 23B — settlements feed both the per-delegate aggregate
  // and the global "إجمالي التوريدات" KPI card.
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  // Phase 23C — custody + expenses feed the new tabs and KPIs. Same
  // defensive shape: pre-migration the relations don't exist and
  // both fall back to empty arrays.
  const [custody, setCustody] = useState<CustodyRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // Phase 23B — promoted `collections` + `settlements` from placeholder
  // tabs to first-class tab ids so the drawer can render real content.
  // Phase 23C — same for `custody` + `expenses`. Phase 23D — adds
  // the `statement` tab (كشف الحساب). The placeholder set is now
  // empty; the union still includes `placeholder` for type
  // compatibility with old serialised state, but no tab routes there.
  const [activeTab, setActiveTab] = useState<
    | 'summary'
    | 'orders'
    | 'collections'
    | 'settlements'
    | 'custody'
    | 'expenses'
    | 'statement'
    | 'ratings'
    | 'activity'
    | 'placeholder'
  >('summary');
  const [placeholderTab, setPlaceholderTab] = useState<string>('');
  // Phase 23A-Fix1 — wizard state + refetch trigger after successful
  // delegate creation. Declared here so the loader useEffect below
  // can subscribe to `reloadTick` for refetches.
  const [wizardOpen, setWizardOpen] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  // Phase 23A-Fix2 — edit-delegate modal state. `editKey` is the
  // delegate.key whose row is currently being edited; `null` when
  // the modal is closed.
  const [editKey, setEditKey] = useState<string | null>(null);
  // Toggle-active confirmation dialog. Stores the key of the row
  // we're about to toggle plus the next desired state.
  const [toggleTarget, setToggleTarget] = useState<{
    key: string;
    nextActive: boolean;
  } | null>(null);
  const [toggleSubmitting, setToggleSubmitting] = useState(false);
  const [toast, setToast] = useState<{
    kind: 'success' | 'error';
    message: string;
  } | null>(null);
  // Phase 23A-Fix2 — quick filter by active state. Default 'all'
  // matches the previous behaviour. Legacy `delegate_name`-only
  // rows have a null active flag; we treat them as active for
  // filter purposes (they were never explicitly deactivated).
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  // Phase 23B — register-settlement modal target (`null` when closed).
  const [settlementTargetKey, setSettlementTargetKey] = useState<string | null>(null);
  // Phase 23C — add-custody and add-expense modal targets. The
  // status-change confirmation dialog stores the custody row id +
  // the next desired status; null when closed.
  const [custodyTargetKey, setCustodyTargetKey] = useState<string | null>(null);
  const [expenseTargetKey, setExpenseTargetKey] = useState<string | null>(null);
  const [custodyStatusTarget, setCustodyStatusTarget] = useState<{
    row: CustodyRow;
    nextStatus: 'returned' | 'settled' | 'lost';
  } | null>(null);
  const [custodyStatusSubmitting, setCustodyStatusSubmitting] = useState(false);

  // Fetch profiles + orders + ratings + settlements + custody +
  // expenses in parallel. Each query is narrowed and (where it
  // makes sense) date-bounded.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      try {
        const [profilesRes, ordersRes, ratingsRes, settlementsRes, custodyRes, expensesRes] =
          await Promise.all([
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
            // Phase 23B — settlements. Same defensive shape as the
            // ratings fetch: pre-migration the relation does not exist
            // and we fall through to an empty array. Post-migration
            // an admin (RLS gates SELECT on `is_admin()`) gets the
            // full timeline; non-admins get an empty array silently.
            // Cap at 1000 rows to bound the page; aggregate matching
            // is per-delegate and fits well inside that ceiling at
            // current scale.
            supabase
              .from('turath_masr_delegate_settlements')
              .select(
                'id, delegate_profile_id, delegate_name, amount, method, received_by, received_by_name, note, settled_at, created_at'
              )
              .order('settled_at', { ascending: false })
              .limit(1000)
              .then(
                (r: { data: SettlementRow[] | null; error: unknown }) => r,
                (err: unknown) => ({
                  data: null as SettlementRow[] | null,
                  error: err,
                })
              ),
            // Phase 23C — custody. NOT date-limited because we want
            // the "active custody value" KPI to include rows handed
            // over months ago that are still `with_delegate`. Cap at
            // 1000 rows for safety; far above any realistic scale.
            supabase
              .from('turath_masr_delegate_custody')
              .select(
                'id, delegate_profile_id, delegate_name, custody_type, description, quantity, estimated_value, status, handed_by, handed_by_name, received_by, received_by_name, handed_at, returned_at, note, created_at'
              )
              .order('handed_at', { ascending: false })
              .limit(1000)
              .then(
                (r: { data: CustodyRow[] | null; error: unknown }) => r,
                (err: unknown) => ({
                  data: null as CustodyRow[] | null,
                  error: err,
                })
              ),
            // Phase 23C — expenses. Date-bounded to the same 90-day
            // window as orders/ratings/settlements so the page
            // numbers stay consistent. Older rows still exist in the
            // DB; a future "تقرير حساب المندوب" view can fetch them.
            supabase
              .from('turath_masr_delegate_expenses')
              .select(
                'id, delegate_profile_id, delegate_name, order_id, expense_type, amount, status, approved_by, approved_by_name, note, expense_at, created_at'
              )
              .gte('expense_at', since)
              .order('expense_at', { ascending: false })
              .limit(1000)
              .then(
                (r: { data: ExpenseRow[] | null; error: unknown }) => r,
                (err: unknown) => ({
                  data: null as ExpenseRow[] | null,
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

        // Phase 23B — same defensive pattern for settlements. Pre-
        // migration the relation is missing (42P01); a non-admin
        // hits a 42501 RLS deny. Either way, render with an empty
        // list so the page degrades gracefully and KPI cards show
        // 0 ج.م rather than a hard error.
        const settlementsData =
          settlementsRes && 'error' in settlementsRes && settlementsRes.error
            ? []
            : ((settlementsRes as { data: SettlementRow[] | null }).data ?? []);
        if (settlementsRes && 'error' in settlementsRes && settlementsRes.error) {
          // Don't surface the user — many viewers legitimately
          // can't read settlements (RLS by design). Just log.
          console.warn('[delegates] settlements fetch unavailable', settlementsRes.error);
        }
        setSettlements(settlementsData);

        // Phase 23C — same defensive pattern for custody + expenses.
        const custodyData =
          custodyRes && 'error' in custodyRes && custodyRes.error
            ? []
            : ((custodyRes as { data: CustodyRow[] | null }).data ?? []);
        if (custodyRes && 'error' in custodyRes && custodyRes.error) {
          console.warn('[delegates] custody fetch unavailable', custodyRes.error);
        }
        setCustody(custodyData);

        const expensesData =
          expensesRes && 'error' in expensesRes && expensesRes.error
            ? []
            : ((expensesRes as { data: ExpenseRow[] | null }).data ?? []);
        if (expensesRes && 'error' in expensesRes && expensesRes.error) {
          console.warn('[delegates] expenses fetch unavailable', expensesRes.error);
        }
        setExpenses(expensesData);

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
    // `reloadTick`. Phase 23A-Fix2 — also re-runs after edit /
    // toggle saves. Declared above the loader so React's hook
    // ordering guarantees still hold.
  }, [reloadTick]);

  // Phase 23A-Fix2 — auto-clear the toast after a few seconds so
  // dispatchers don't have to dismiss it manually after every action.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

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

      // Phase 23B — per-delegate settlement aggregation. Same
      // matching rules as orders/ratings: profile-id first, with a
      // delegate_name fallback so legacy rows still bucket
      // correctly. Settlements are pre-sorted by `settled_at`
      // descending from the fetch.
      const settlementsForDelegate = settlements.filter((s) => {
        if (d.profileId && s.delegate_profile_id === d.profileId) return true;
        if ((s.delegate_name || '').trim() === d.name.trim()) return true;
        return false;
      });
      const totalSettled = settlementsForDelegate.reduce(
        (sum, s) => sum + Number(s.amount ?? 0),
        0
      );
      const remainingDue = totalCollected - totalSettled;
      const lastSettledAt = settlementsForDelegate[0]?.settled_at ?? null;

      // Phase 23C — per-delegate custody + expenses aggregation.
      // Same name-fallback rule as the other slices.
      const custodyForDelegate = custody.filter((c) => {
        if (d.profileId && c.delegate_profile_id === d.profileId) return true;
        if ((c.delegate_name || '').trim() === d.name.trim()) return true;
        return false;
      });
      let activeCustodyValue = 0;
      let activeCustodyCount = 0;
      let activeCashCustody = 0;
      for (const c of custodyForDelegate) {
        if (c.status === 'with_delegate') {
          activeCustodyValue += Number(c.estimated_value ?? 0);
          activeCustodyCount += 1;
          if (c.custody_type === 'cash') {
            activeCashCustody += Number(c.estimated_value ?? 0);
          }
        }
      }

      const expensesForDelegate = expenses.filter((e) => {
        if (d.profileId && e.delegate_profile_id === d.profileId) return true;
        if ((e.delegate_name || '').trim() === d.name.trim()) return true;
        return false;
      });
      const approvedExpensesTotal = expensesForDelegate
        .filter((e) => e.status === 'approved')
        .reduce((sum, e) => sum + Number(e.amount ?? 0), 0);

      // Adjusted remaining: collected − settled − approved expenses.
      // Custody value is NOT subtracted (matches Phase 23C spec —
      // physical custody is shown separately, cash custody is
      // surfaced but never auto-deducted).
      const adjustedRemaining = totalCollected - totalSettled - approvedExpensesTotal;

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
        settlements: settlementsForDelegate,
        totalSettled,
        remainingDue,
        lastSettledAt,
        custody: custodyForDelegate,
        activeCustodyValue,
        activeCustodyCount,
        activeCashCustody,
        expenses: expensesForDelegate,
        approvedExpensesTotal,
        adjustedRemaining,
      };
    });
  }, [profiles, orders, ratings, settlements, custody, expenses]);

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

    // Phase 23B — global settlement KPIs. We sum across the
    // settlements list directly rather than the per-delegate
    // `aggregates` so legacy / orphan rows whose delegate doesn't
    // resolve cleanly still count into "إجمالي التوريدات".
    let totalSettled = 0;
    let lastSettledAt: string | null = null;
    for (const s of settlements) {
      totalSettled += Number(s.amount ?? 0);
      if (!lastSettledAt || (s.settled_at && s.settled_at > lastSettledAt)) {
        lastSettledAt = s.settled_at;
      }
    }
    const remainingTotal = totalCollected - totalSettled;

    // Phase 23C — custody + expenses global KPIs.
    let totalActiveCustodyValue = 0;
    let totalActiveCustodyCount = 0;
    for (const c of custody) {
      if (c.status === 'with_delegate') {
        totalActiveCustodyValue += Number(c.estimated_value ?? 0);
        totalActiveCustodyCount += 1;
      }
    }
    let totalApprovedExpenses = 0;
    for (const e of expenses) {
      if (e.status === 'approved') {
        totalApprovedExpenses += Number(e.amount ?? 0);
      }
    }
    // Adjusted remaining matches the per-delegate formula.
    const adjustedRemainingTotal = totalCollected - totalSettled - totalApprovedExpenses;

    return {
      totalDelegates: profiles.length,
      activeDelegates: aggregates.filter((a) => a.inFlight > 0 || a.delivered > 0).length,
      inFlight,
      deliveredToday,
      totalReturned,
      totalCollected,
      averageRating: avg,
      totalSettled,
      remainingTotal,
      lastSettledAt,
      // Phase 23C
      totalActiveCustodyValue,
      totalActiveCustodyCount,
      totalApprovedExpenses,
      adjustedRemainingTotal,
    };
  }, [orders, profiles, ratings, aggregates, settlements, custody, expenses]);

  const selected = aggregates.find((a) => a.delegate.key === selectedKey) || null;

  // Phase 23A-Fix2 — apply the active/inactive filter at render
  // time. Legacy delegate_name-only rows have `delegateIsActive`
  // null and are bucketed as "active" (never explicitly disabled).
  const visibleAggregates = useMemo(() => {
    if (statusFilter === 'all') return aggregates;
    return aggregates.filter((a) => {
      const isInactive = a.delegate.delegateIsActive === false;
      return statusFilter === 'inactive' ? isInactive : !isInactive;
    });
  }, [aggregates, statusFilter]);

  // Phase 23A-Fix2 — resolve the edit/toggle target rows from their
  // keys so child components can prefill cleanly without prop-drilling.
  const editing = aggregates.find((a) => a.delegate.key === editKey) || null;
  const toggling = toggleTarget
    ? aggregates.find((a) => a.delegate.key === toggleTarget.key) || null
    : null;
  // Phase 23B — settlement modal target row.
  const settlementTarget = settlementTargetKey
    ? aggregates.find((a) => a.delegate.key === settlementTargetKey) || null
    : null;
  // Phase 23C — custody / expense modal targets.
  const custodyTarget = custodyTargetKey
    ? aggregates.find((a) => a.delegate.key === custodyTargetKey) || null
    : null;
  const expenseTarget = expenseTargetKey
    ? aggregates.find((a) => a.delegate.key === expenseTargetKey) || null
    : null;

  return (
    <AppLayout currentPath="/delegates">
      <div className="space-y-6 fade-in">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">إدارة المناديب</h1>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
              نظرة عامة على المناديب، طلباتهم، تقييماتهم، توريداتهم، الأمانات والمصاريف.
            </p>
            {/* Phase 23B — explicit window label so the dispatcher
                knows the totals are scoped to the last 90 days; full-
                history reports come later. Phase 23C — custody is NOT
                date-bounded (active custody includes older items). */}
            <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1">
              التحصيلات والتوريدات والمصاريف من آخر 90 يوم. الأمانات تشمل كل العهد المفتوحة بدون حد
              زمني.
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

        {/* Phase 23B — settlement KPIs. Distinct row so the eye groups
            financial flow separately from delegate operational metrics.
            "آخر توريد" shows the relative date of the most recent
            settlement across all delegates. */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard
            icon={<Banknote size={18} className="text-emerald-600" />}
            label="إجمالي التوريدات"
            value={fmtMoney(kpis.totalSettled)}
          />
          <KpiCard
            icon={<Wallet size={18} className="text-amber-600" />}
            label="المتبقي على المناديب"
            value={fmtMoney(kpis.remainingTotal)}
          />
          <KpiCard
            icon={<Clock size={18} className="text-[hsl(var(--muted-foreground))]" />}
            label="آخر توريد"
            value={kpis.lastSettledAt ? formatDateAr(kpis.lastSettledAt) : 'لا يوجد بعد'}
          />
          <KpiCard
            icon={<Star size={18} className="text-amber-500" />}
            label="متوسط تقييم المناديب"
            value={
              kpis.averageRating != null
                ? `${kpis.averageRating.toFixed(1)} / 5`
                : 'لا توجد تقييمات بعد'
            }
          />
        </div>

        {/* Phase 23C — custody + expenses KPI row. "المتبقي بعد المصاريف"
            uses the adjusted formula (collected - settled - approved
            expenses). Custody value is shown separately and is NOT
            subtracted from the monetary remaining. */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <KpiCard
            icon={<Briefcase size={18} className="text-blue-600" />}
            label="إجمالي الأمانات الحالية"
            value={`${fmtMoney(kpis.totalActiveCustodyValue)} (${kpis.totalActiveCustodyCount})`}
          />
          <KpiCard
            icon={<Receipt size={18} className="text-orange-600" />}
            label="إجمالي المصاريف المعتمدة"
            value={fmtMoney(kpis.totalApprovedExpenses)}
          />
          <KpiCard
            icon={<Wallet size={18} className="text-amber-700" />}
            label="المتبقي بعد المصاريف"
            value={fmtMoney(kpis.adjustedRemainingTotal)}
          />
        </div>

        {/* Delegates table */}
        <div className="card-section overflow-hidden">
          <div className="px-5 py-3 border-b border-[hsl(var(--border))] bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <h2 className="text-base font-bold text-[hsl(var(--foreground))]">قائمة المناديب</h2>
            {/* Phase 23A-Fix2 — quick filter for active / inactive
                delegates. Counts are computed off `aggregates` so the
                tab labels reflect the dataset before filtering. */}
            <div className="flex items-center gap-1 bg-[hsl(var(--muted))]/40 rounded-xl p-1 self-end sm:self-auto">
              {(
                [
                  { key: 'all', label: 'الكل', count: aggregates.length },
                  {
                    key: 'active',
                    label: 'نشط',
                    count: aggregates.filter((a) => a.delegate.delegateIsActive !== false).length,
                  },
                  {
                    key: 'inactive',
                    label: 'غير نشط',
                    count: aggregates.filter((a) => a.delegate.delegateIsActive === false).length,
                  },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setStatusFilter(opt.key)}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors ${
                    statusFilter === opt.key
                      ? 'bg-white text-[hsl(var(--foreground))] shadow-sm'
                      : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'
                  }`}
                >
                  {opt.label}
                  <span className="ml-1 text-[10px] text-[hsl(var(--muted-foreground))]">
                    ({opt.count})
                  </span>
                </button>
              ))}
            </div>
          </div>
          {loading ? (
            <div className="p-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
              جاري التحميل...
            </div>
          ) : aggregates.length === 0 ? (
            <div className="p-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
              لا يوجد مناديب مسجلين بعد.
            </div>
          ) : visibleAggregates.length === 0 ? (
            <div className="p-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
              لا يوجد مناديب يطابقون الفلتر الحالي.
            </div>
          ) : (
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[1450px]">
                <thead>
                  <tr>
                    {[
                      'المندوب',
                      'الدور',
                      'الهاتف',
                      'وسيلة المواصلات',
                      'حالة الرخص',
                      'الحالة',
                      'الطلبات الآن',
                      'تم التسليم',
                      // Phase 23B — collected (delivered total) +
                      // settled (handover total) + remaining due +
                      // last settlement date so a dispatcher can see
                      // the financial state at a glance without
                      // opening the drawer.
                      'إجمالي التحصيل',
                      'إجمالي المورد',
                      'المتبقي عليه',
                      // Phase 23C — keep two extra compact columns so
                      // the table doesn't become unusably wide. Detail
                      // breakdowns live in the drawer.
                      'المصاريف',
                      'الأمانات',
                      'المتبقي بعد المصاريف',
                      'آخر توريد',
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
                  {visibleAggregates.map((a) => {
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
                    // Phase 23A-Fix2 — soft-deactivated delegates
                    // stay clickable but visually muted. Legacy
                    // delegate_name-only rows have a null active
                    // flag and read as active.
                    const isInactive = a.delegate.delegateIsActive === false;
                    return (
                      <tr
                        key={a.delegate.key}
                        className={`hover:bg-[hsl(var(--muted))]/30 ${
                          isInactive ? 'bg-[hsl(var(--muted))]/30 opacity-70' : ''
                        }`}
                      >
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
                        <td className="table-cell">
                          <span
                            className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                              isInactive
                                ? 'bg-red-50 text-red-700 border-red-200'
                                : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            }`}
                          >
                            {isInactive ? 'غير نشط' : 'نشط'}
                          </span>
                        </td>
                        <td className="table-cell font-mono">{a.inFlight}</td>
                        <td className="table-cell font-mono text-emerald-700">{a.delivered}</td>
                        <td className="table-cell font-mono">{fmtMoney(a.totalCollected)}</td>
                        {/* Phase 23B — settled / remaining / last
                            settlement. Remaining is rendered amber
                            when positive (delegate still owes), green
                            when negative (overpaid — surplus credit). */}
                        <td className="table-cell font-mono">{fmtMoney(a.totalSettled)}</td>
                        <td
                          className={`table-cell font-mono ${
                            a.remainingDue > 0
                              ? 'text-amber-700'
                              : a.remainingDue < 0
                                ? 'text-emerald-700'
                                : ''
                          }`}
                        >
                          {a.remainingDue < 0
                            ? `${fmtMoney(Math.abs(a.remainingDue))} (زائد)`
                            : fmtMoney(a.remainingDue)}
                        </td>
                        {/* Phase 23C — expenses + custody summary cells.
                            Custody renders both EGP value and item count
                            so a dispatcher can spot e.g. "0 ج / 3 عهد"
                            for non-monetary custody. Adjusted remaining
                            uses red when the delegate still owes money,
                            green for surplus credit. */}
                        <td className="table-cell font-mono text-xs">
                          {fmtMoney(a.approvedExpensesTotal)}
                        </td>
                        <td className="table-cell font-mono text-xs">
                          {a.activeCustodyCount > 0 ? (
                            <span>
                              {fmtMoney(a.activeCustodyValue)}
                              <span className="text-[10px] text-[hsl(var(--muted-foreground))] ml-1">
                                ({a.activeCustodyCount} عهدة)
                              </span>
                            </span>
                          ) : (
                            <span className="text-[hsl(var(--muted-foreground))]">—</span>
                          )}
                        </td>
                        <td
                          className={`table-cell font-mono ${
                            a.adjustedRemaining > 0
                              ? 'text-red-700'
                              : a.adjustedRemaining < 0
                                ? 'text-emerald-700'
                                : ''
                          }`}
                        >
                          {a.adjustedRemaining < 0
                            ? `${fmtMoney(Math.abs(a.adjustedRemaining))} (زائد)`
                            : fmtMoney(a.adjustedRemaining)}
                        </td>
                        <td className="table-cell text-xs">
                          {a.lastSettledAt ? (
                            formatDateAr(a.lastSettledAt)
                          ) : (
                            <span className="text-[hsl(var(--muted-foreground))]">—</span>
                          )}
                        </td>
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
                          <div className="flex flex-wrap items-center gap-2">
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
                            {/* Phase 23B — quick "تسجيل توريد" row
                                action. Hidden for legacy delegate_name-
                                only rows (no profile id to anchor the
                                FK to) and for non-admin viewers. */}
                            {canRegisterSettlement && a.delegate.hasProfile && (
                              <button
                                type="button"
                                onClick={() => setSettlementTargetKey(a.delegate.key)}
                                className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline"
                                title="تسجيل توريد"
                              >
                                <Banknote size={11} /> توريد
                              </button>
                            )}
                            {/* Phase 23C — quick "أمانة" + "مصروف"
                                row actions. Same gating as توريد —
                                admin-only, profile-backed only. */}
                            {canManageCustody && a.delegate.hasProfile && (
                              <button
                                type="button"
                                onClick={() => setCustodyTargetKey(a.delegate.key)}
                                className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"
                                title="إضافة أمانة"
                              >
                                <Briefcase size={11} /> أمانة
                              </button>
                            )}
                            {canManageExpenses && a.delegate.hasProfile && (
                              <button
                                type="button"
                                onClick={() => setExpenseTargetKey(a.delegate.key)}
                                className="inline-flex items-center gap-1 text-xs font-semibold text-orange-700 hover:underline"
                                title="إضافة مصروف"
                              >
                                <Receipt size={11} /> مصروف
                              </button>
                            )}
                            {/* Phase 23A-Fix2 — admin-only edit and
                                activate/deactivate row actions.
                                Hidden for legacy `delegate_name`-only
                                rows because they have no profile to
                                update. */}
                            {canEditDelegate && a.delegate.hasProfile && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setEditKey(a.delegate.key)}
                                  className="inline-flex items-center gap-1 text-xs font-semibold text-[hsl(var(--primary))] hover:underline"
                                  title="تعديل البيانات"
                                >
                                  <Pencil size={11} /> تعديل
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setToggleTarget({
                                      key: a.delegate.key,
                                      nextActive: isInactive,
                                    })
                                  }
                                  className={`inline-flex items-center gap-1 text-xs font-semibold hover:underline ${
                                    isInactive ? 'text-emerald-700' : 'text-red-700'
                                  }`}
                                  title={isInactive ? 'تفعيل' : 'تعطيل'}
                                >
                                  <Power size={11} /> {isInactive ? 'تفعيل' : 'تعطيل'}
                                </button>
                              </>
                            )}
                          </div>
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
          /* Phase 23B — admin-only "تسجيل توريد" trigger from inside
             the drawer's settlements tab. Hides for non-admin viewers
             and for legacy delegate_name-only rows (no profile id). */
          canRegisterSettlement={canRegisterSettlement && selected.delegate.hasProfile}
          onRegisterSettlement={() => setSettlementTargetKey(selected.delegate.key)}
          /* Phase 23C — drawer-level CTAs for custody + expenses.
             Same admin-only + profile-backed gating. The status-
             change action on individual custody rows is driven
             through `onChangeCustodyStatus` so the parent owns the
             confirm dialog state. */
          canManageCustody={canManageCustody && selected.delegate.hasProfile}
          canManageExpenses={canManageExpenses && selected.delegate.hasProfile}
          onAddCustody={() => setCustodyTargetKey(selected.delegate.key)}
          onAddExpense={() => setExpenseTargetKey(selected.delegate.key)}
          onChangeCustodyStatus={(row, nextStatus) => setCustodyStatusTarget({ row, nextStatus })}
          /* Phase 23D — CSV export gated on admin only. The drawer
             passes this through to the AccountStatementTab to hide
             the export button for non-admin viewers. */
          canExportStatement={canExportStatement}
        />
      )}

      {wizardOpen && (
        <AddDelegateWizard
          onClose={() => setWizardOpen(false)}
          onCreated={() => {
            setWizardOpen(false);
            setReloadTick((n) => n + 1);
            setToast({ kind: 'success', message: 'تم إنشاء المندوب بنجاح.' });
          }}
        />
      )}

      {/* Phase 23A-Fix2 — edit modal. Only opens for rows with a
          real profile (`hasProfile === true`); legacy delegate_name-
          only rows have no edit affordance. The modal updates only
          the explicit field set under `narrowedFields` below — we
          never write to `email` or any auth-managed column from
          this modal. */}
      {editing && editing.delegate.hasProfile && editing.delegate.profileId && (
        <EditDelegateModal
          delegate={editing.delegate}
          onClose={() => setEditKey(null)}
          onSaved={(message) => {
            setEditKey(null);
            setReloadTick((n) => n + 1);
            setToast({ kind: 'success', message });
          }}
          onError={(message) => setToast({ kind: 'error', message })}
        />
      )}

      {/* Phase 23A-Fix2 — toggle confirm dialog. Surfaces a warning
          when the deactivation target still has in-flight orders so
          the dispatcher knows their pipeline isn't auto-rebalanced
          (Phase 23A-Fix2 explicitly does NOT auto-unassign). */}
      {toggling && toggleTarget && (
        <ToggleActiveDialog
          delegate={toggling.delegate}
          inFlight={toggling.inFlight}
          nextActive={toggleTarget.nextActive}
          submitting={toggleSubmitting}
          onCancel={() => setToggleTarget(null)}
          onConfirm={async () => {
            if (!toggling.delegate.profileId) return;
            setToggleSubmitting(true);
            const supabase = createClient();
            const { error } = await supabase
              .from('profiles')
              .update({ delegate_is_active: toggleTarget.nextActive })
              .eq('id', toggling.delegate.profileId);
            setToggleSubmitting(false);
            if (error) {
              console.error('[delegates] toggle active failed', error);
              setToast({
                kind: 'error',
                message: `تعذر تحديث حالة المندوب: ${error.message}`,
              });
              return;
            }
            setToggleTarget(null);
            setReloadTick((n) => n + 1);
            setToast({
              kind: 'success',
              message: toggleTarget.nextActive ? 'تم تفعيل المندوب.' : 'تم تعطيل المندوب.',
            });
          }}
        />
      )}

      {/* Phase 23B — register settlement modal. Admin-only at the
          UI gate; the underlying RLS also rejects non-admin INSERTs.
          Hidden for legacy delegate_name-only rows because the
          settlements FK requires a real `profiles.id`. */}
      {settlementTarget && settlementTarget.delegate.profileId && (
        <RegisterSettlementModal
          delegate={settlementTarget.delegate}
          remainingDue={settlementTarget.remainingDue}
          receivedBy={{ id: user?.id ?? null, name: profileFullName ?? null }}
          onClose={() => setSettlementTargetKey(null)}
          onSaved={(message) => {
            setSettlementTargetKey(null);
            setReloadTick((n) => n + 1);
            setToast({ kind: 'success', message });
          }}
          onError={(message) => setToast({ kind: 'error', message })}
        />
      )}

      {/* Phase 23C — add custody / add expense modals + status
          confirm dialog. Same RLS-mirrors-UI gating pattern as the
          settlement modal above. */}
      {custodyTarget && custodyTarget.delegate.profileId && (
        <AddCustodyModal
          delegate={custodyTarget.delegate}
          handedBy={{ id: user?.id ?? null, name: profileFullName ?? null }}
          onClose={() => setCustodyTargetKey(null)}
          onSaved={(message) => {
            setCustodyTargetKey(null);
            setReloadTick((n) => n + 1);
            setToast({ kind: 'success', message });
          }}
          onError={(message) => setToast({ kind: 'error', message })}
        />
      )}

      {expenseTarget && expenseTarget.delegate.profileId && (
        <AddExpenseModal
          delegate={expenseTarget.delegate}
          approvedBy={{ id: user?.id ?? null, name: profileFullName ?? null }}
          onClose={() => setExpenseTargetKey(null)}
          onSaved={(message) => {
            setExpenseTargetKey(null);
            setReloadTick((n) => n + 1);
            setToast({ kind: 'success', message });
          }}
          onError={(message) => setToast({ kind: 'error', message })}
        />
      )}

      {custodyStatusTarget && (
        <CustodyStatusDialog
          row={custodyStatusTarget.row}
          nextStatus={custodyStatusTarget.nextStatus}
          submitting={custodyStatusSubmitting}
          onCancel={() => setCustodyStatusTarget(null)}
          onConfirm={async () => {
            setCustodyStatusSubmitting(true);
            const supabase = createClient();
            // Phase 23C — promotes the custody row out of
            // `with_delegate`. We capture the dispatcher's id +
            // name as the receiver and stamp `returned_at = now()`
            // for all three terminal states so the timeline is
            // queryable by date regardless of how it ended.
            const { error } = await supabase
              .from('turath_masr_delegate_custody')
              .update({
                status: custodyStatusTarget.nextStatus,
                received_by: user?.id ?? null,
                received_by_name: profileFullName ?? null,
                returned_at: new Date().toISOString(),
              })
              .eq('id', custodyStatusTarget.row.id);
            setCustodyStatusSubmitting(false);
            if (error) {
              console.error('[delegates] custody status update failed', error);
              const msg =
                error.code === '42501'
                  ? 'لا تملك صلاحية تعديل حالة الأمانة. تواصل مع المدير.'
                  : `تعذر تحديث حالة الأمانة: ${error.message}`;
              setToast({ kind: 'error', message: msg });
              return;
            }
            setCustodyStatusTarget(null);
            setReloadTick((n) => n + 1);
            const successByStatus: Record<'returned' | 'settled' | 'lost', string> = {
              returned: 'تم استلام الأمانة.',
              settled: 'تمت تسوية الأمانة.',
              lost: 'تم تسجيل الأمانة كمفقودة.',
            };
            setToast({
              kind: 'success',
              message: successByStatus[custodyStatusTarget.nextStatus],
            });
          }}
        />
      )}

      {/* Phase 23A-Fix2 — toast. Auto-dismisses after 4s; manual
          close button kept for keyboard accessibility. */}
      {toast && (
        <div
          className="fixed bottom-6 right-6 z-[80] max-w-sm fade-in"
          role="status"
          aria-live="polite"
          dir="rtl"
        >
          <div
            className={`flex items-start gap-2 px-4 py-3 rounded-xl shadow-modal border ${
              toast.kind === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-red-50 border-red-200 text-red-800'
            }`}
          >
            {toast.kind === 'success' ? (
              <CheckCircle size={16} className="mt-0.5 flex-shrink-0" />
            ) : (
              <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
            )}
            <p className="text-sm flex-1">{toast.message}</p>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="text-current opacity-60 hover:opacity-100"
              aria-label="إغلاق"
            >
              <X size={14} />
            </button>
          </div>
        </div>
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

type DrawerTab =
  | 'summary'
  | 'orders'
  | 'collections'
  | 'settlements'
  | 'custody'
  | 'expenses'
  | 'statement'
  | 'ratings'
  | 'activity'
  | 'placeholder';

interface DrawerProps {
  aggregate: DelegateAggregate;
  activeTab: DrawerTab;
  placeholderTab: string;
  onTabChange: (tab: DrawerTab, placeholderTab?: string) => void;
  onClose: () => void;
  // Phase 23B — drawer can launch the register-settlement modal
  // directly from the settlements tab.
  canRegisterSettlement?: boolean;
  onRegisterSettlement?: () => void;
  // Phase 23C — custody + expenses CTAs and the per-row custody
  // status-change handler. The parent component owns the confirm
  // dialog state so the drawer can stay stateless.
  canManageCustody?: boolean;
  canManageExpenses?: boolean;
  onAddCustody?: () => void;
  onAddExpense?: () => void;
  onChangeCustodyStatus?: (row: CustodyRow, next: 'returned' | 'settled' | 'lost') => void;
  // Phase 23D — CSV export gate (admin-only, financial data).
  canExportStatement?: boolean;
}

function DelegateDrawer({
  aggregate,
  activeTab,
  placeholderTab,
  onTabChange,
  onClose,
  canRegisterSettlement = false,
  onRegisterSettlement,
  canManageCustody = false,
  canManageExpenses = false,
  onAddCustody,
  onAddExpense,
  onChangeCustodyStatus,
  canExportStatement = false,
}: DrawerProps) {
  const a = aggregate;

  const tabs: Array<{
    id: DrawerTab;
    label: string;
    placeholder?: string;
  }> = [
    { id: 'summary', label: 'الملخص' },
    { id: 'orders', label: 'الطلبات' },
    // Phase 23B — these two are now first-class tab ids and
    // render real content (delivered orders + settlement timeline)
    // rather than the قريبًا placeholder.
    { id: 'collections', label: 'التحصيلات' },
    { id: 'settlements', label: 'التوريدات' },
    // Phase 23C — same for الأمانات + المصاريف.
    { id: 'custody', label: 'الأمانات' },
    { id: 'expenses', label: 'المصاريف' },
    // Phase 23D — unified account-statement view with date range
    // + CSV export. Sits between the per-section tabs (custody /
    // expenses) and the auxiliary tabs (ratings / activity).
    { id: 'statement', label: 'كشف الحساب' },
    { id: 'ratings', label: 'التقييمات والشكاوى' },
    { id: 'activity', label: 'النشاط' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end" dir="rtl">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white w-full max-w-3xl h-full overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between p-5 border-b border-[hsl(var(--border))]">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-lg font-bold text-[hsl(var(--foreground))]">{a.delegate.name}</h3>
              {/* Phase 23A-Fix2 — active/inactive badge in the
                  drawer header. Hidden for legacy rows since they
                  have no profile to enable/disable. */}
              {a.delegate.hasProfile && (
                <span
                  className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                    a.delegate.delegateIsActive === false
                      ? 'bg-red-50 text-red-700 border-red-200'
                      : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  }`}
                >
                  {a.delegate.delegateIsActive === false ? 'غير نشط' : 'نشط'}
                </span>
              )}
            </div>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
              {a.delegate.roleName || a.delegate.roleId || 'مندوب'}
              {a.delegate.email ? ` — ${a.delegate.email}` : ''}
            </p>
            {/* Phase 23A-Fix2 — render the actual phone if present
                rather than the placeholder text so dispatchers can
                tap-to-call directly from the drawer header. */}
            <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1 flex items-center gap-1">
              <PhoneIcon size={11} />
              {a.delegate.phone ? (
                <a
                  href={`tel:${a.delegate.phone}`}
                  className="text-[hsl(var(--primary))] hover:underline"
                  dir="ltr"
                >
                  {a.delegate.phone}
                </a>
              ) : (
                <span>رقم الهاتف غير مسجل</span>
              )}
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
          {activeTab === 'collections' && <CollectionsTab a={a} />}
          {activeTab === 'settlements' && (
            <SettlementsTab
              a={a}
              canRegister={canRegisterSettlement}
              onRegister={onRegisterSettlement}
            />
          )}
          {activeTab === 'custody' && (
            <CustodyTab
              a={a}
              canManage={canManageCustody}
              onAdd={onAddCustody}
              onChangeStatus={onChangeCustodyStatus}
            />
          )}
          {activeTab === 'expenses' && (
            <ExpensesTab a={a} canManage={canManageExpenses} onAdd={onAddExpense} />
          )}
          {activeTab === 'statement' && (
            <AccountStatementTab a={a} canExport={canExportStatement} />
          )}
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
  // Phase 23C — all four formerly-placeholder tabs (collections,
  // settlements, custody, expenses) are now functional. The map is
  // intentionally empty so any stale `placeholderTab` state from
  // older sessions falls back to the generic "قريبًا" card. Future
  // phases that introduce new placeholders should re-populate it.
  const labels: Record<string, { title: string; sub: string; phase: string }> = {};
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

// ─── Phase 23A-Fix2 — Edit delegate modal ─────────────────────────────────
//
// Drawer-style modal that pre-fills every operational profile field
// from the row the dispatcher clicked, validates with the same rules
// as the add wizard, and persists via a NARROW `update` against the
// `profiles` row (no `select('*')`, never touches `email`/auth).
//
// The IMPORTANT contract (Phase 23A-Fix2 ground rules):
//   • Email and password are NEVER updated from this modal — those
//     are auth concerns and live behind a future Supabase-Auth-only
//     flow. The role badge stays read-only.
//   • The narrow update list mirrors the user spec — any column
//     outside of it is left untouched.
//   • Validation reuses the exact rules from `AddDelegateWizard`:
//     EG-mobile phone, 14-digit national ID, license-end > start.
//   • Optional licence numbers/dates can be cleared by leaving the
//     field empty; the update sends `null` in that case.
//   • RLS reality (`profiles_admin_update` is `is_admin()`-only)
//     means a non-admin caller will hit a 42501. The page already
//     gates the trigger button on `isAdmin`, but we surface any
//     unexpected RLS error here clearly.
interface EditDelegateModalProps {
  delegate: DelegateRow;
  onClose: () => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}

function EditDelegateModal({ delegate, onClose, onSaved, onError }: EditDelegateModalProps) {
  // Prefill every field from the source row. State is local — we
  // only push to the DB on Save.
  const [name, setName] = useState(delegate.name);
  const [phone, setPhone] = useState(delegate.phone ?? '');
  const [nationalId, setNationalId] = useState(delegate.nationalId ?? '');
  const [transportType, setTransportType] = useState<TransportType | ''>(
    (delegate.transportType as TransportType | null) ?? ''
  );
  const [vehicleLicenseNumber, setVehicleLicenseNumber] = useState(
    delegate.vehicleLicenseNumber ?? ''
  );
  const [vehicleStarts, setVehicleStarts] = useState(delegate.vehicleLicenseStartsAt ?? '');
  const [vehicleExpires, setVehicleExpires] = useState(delegate.vehicleLicenseExpiresAt ?? '');
  const [drivingLicenseNumber, setDrivingLicenseNumber] = useState(
    delegate.drivingLicenseNumber ?? ''
  );
  const [drivingStarts, setDrivingStarts] = useState(delegate.drivingLicenseStartsAt ?? '');
  const [drivingExpires, setDrivingExpires] = useState(delegate.drivingLicenseExpiresAt ?? '');
  const [delegateActive, setDelegateActive] = useState<boolean>(
    // null is treated as active — matches the drawer's badge logic
    delegate.delegateIsActive !== false
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>('');

  const validate = (): string => {
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

  const handleSave = async () => {
    setError('');
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    if (!delegate.profileId) {
      setError('سجل قديم بدون ملف. لا يمكن التعديل من هنا.');
      return;
    }
    setSubmitting(true);
    try {
      const supabase = createClient();
      // Phase 23A-Fix2 — narrow update. Any column outside this set
      // is intentionally left untouched. Never write to `email`,
      // `role_id`, or any auth-managed field from this modal.
      const narrowedFields = {
        full_name: name.trim(),
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
      };
      const { error: updateError } = await supabase
        .from('profiles')
        .update(narrowedFields)
        .eq('id', delegate.profileId);
      if (updateError) {
        console.error('[delegates] edit save failed', updateError);
        // RLS rejections surface as 42501 / "permission denied".
        // Translate to Arabic for the dispatcher.
        const msg =
          updateError.code === '42501'
            ? 'لا تملك صلاحية تعديل بيانات المناديب. تواصل مع المدير.'
            : `تعذر حفظ التعديلات: ${updateError.message}`;
        setError(msg);
        onError(msg);
        setSubmitting(false);
        return;
      }
      onSaved('تم حفظ تعديلات المندوب.');
    } catch (e) {
      const msg = `حدث خطأ غير متوقع: ${e instanceof Error ? e.message : String(e)}`;
      console.error('[delegates] edit unexpected error', e);
      setError(msg);
      onError(msg);
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
            <h3 className="text-base font-bold text-[hsl(var(--foreground))]">
              تعديل بيانات المندوب
            </h3>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
              {delegate.email || delegate.name}
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
          {/* Phase 23A-Fix2 — explicit "no auth changes here" hint
              so the dispatcher knows where to go for password resets. */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800 flex items-start gap-2">
            <ShieldCheck size={14} className="mt-0.5 flex-shrink-0" />
            <div>
              يتم تعديل البيانات التشغيلية فقط. البريد الإلكتروني وكلمة المرور لا يتم تعديلهم من
              هنا.
            </div>
          </div>

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
            <div>
              <label className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))] mb-1 block">
                الدور
              </label>
              <input
                type="text"
                value={delegate.roleName || delegate.roleId || 'مندوب شحن'}
                disabled
                className="input-field w-full opacity-60"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))] mb-1 block">
                حالة المندوب
              </label>
              <select
                className="input-field w-full"
                value={delegateActive ? 'active' : 'inactive'}
                onChange={(e) => setDelegateActive(e.target.value === 'active')}
              >
                <option value="active">نشط</option>
                <option value="inactive">غير نشط</option>
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
          <button
            type="button"
            className="btn-primary flex items-center gap-1"
            onClick={handleSave}
            disabled={submitting}
          >
            <CheckCircle size={14} />
            {submitting ? 'جارٍ الحفظ...' : 'حفظ التعديلات'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Phase 23A-Fix2 — Activate / deactivate confirm dialog ───────────────
//
// Lightweight confirm step that sits between the row button and the
// `profiles.delegate_is_active` flip. Surfaces the in-flight orders
// count so the dispatcher knows whether deactivating now will leave
// orders mid-route. We deliberately do NOT auto-reassign — that's a
// separate phase. The action is reversible (just re-activate).
interface ToggleActiveDialogProps {
  delegate: DelegateRow;
  inFlight: number;
  nextActive: boolean;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function ToggleActiveDialog({
  delegate,
  inFlight,
  nextActive,
  submitting,
  onCancel,
  onConfirm,
}: ToggleActiveDialogProps) {
  const isDeactivating = !nextActive;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-white rounded-3xl shadow-modal w-full max-w-md flex flex-col fade-in">
        <div className="p-5 border-b border-[hsl(var(--border))]">
          <h3 className="text-base font-bold text-[hsl(var(--foreground))]">
            {isDeactivating ? 'تعطيل المندوب' : 'تفعيل المندوب'}
          </h3>
          <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">{delegate.name}</p>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-sm text-[hsl(var(--foreground))]">
            {isDeactivating
              ? 'سيتم تعطيل المندوب. يمكن إعادة تفعيله في أي وقت من نفس الزر.'
              : 'سيتم تفعيل المندوب وإظهاره في القوائم النشطة.'}
          </p>
          {/* Phase 23A-Fix2 — only show the in-flight warning on
              deactivation, and only if there are actually orders
              currently in-flight. This phase never auto-unassigns
              orders so the dispatcher sees the impact upfront. */}
          {isDeactivating && inFlight > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <div>
                هذا المندوب لديه <span className="font-bold">{inFlight}</span> طلب قيد التنفيذ. هل
                تريد تعطيله؟ لن يتم إلغاء تعيين هذه الطلبات تلقائيًا.
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 p-4 border-t border-[hsl(var(--border))]">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={submitting}>
            إلغاء
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting}
            className={`px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-2 text-white ${
              isDeactivating ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
          >
            <Power size={14} />
            {submitting ? 'جارٍ التحديث...' : isDeactivating ? 'تعطيل المندوب' : 'تفعيل المندوب'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Phase 23B — Collections tab ──────────────────────────────────────────
//
// Read-only timeline of the orders that drive the delegate's
// "إجمالي التحصيل" number. Defaults to "delivered" only and the
// last 90 days (matches the page-level fetch window). Adds a small
// quick-filter for اليوم / هذا الأسبوع / هذا الشهر / آخر 90 يوم so
// dispatchers can audit a specific window without leaving the tab.
//
// Strictly read-only: no DB writes, no narrowed update, just a
// projection over the orders already loaded by the page.
interface CollectionsTabProps {
  a: DelegateAggregate;
}

type CollectionsRange = 'today' | 'week' | 'month' | '90d';

function CollectionsTab({ a }: CollectionsTabProps) {
  const [range, setRange] = useState<CollectionsRange>('90d');

  const todayIso = new Date().toISOString().slice(0, 10);
  const now = Date.now();
  const filtered = a.ordersForDelegate.filter((o) => {
    if (o.status !== DELIVERED) return false;
    const ts = o.created_at ? new Date(o.created_at).getTime() : NaN;
    if (Number.isNaN(ts)) return range === '90d';
    if (range === 'today') return (o.created_at || '').startsWith(todayIso);
    if (range === 'week') return now - ts < 7 * 24 * 60 * 60 * 1000;
    if (range === 'month') return now - ts < 30 * 24 * 60 * 60 * 1000;
    return now - ts < 90 * 24 * 60 * 60 * 1000;
  });

  const collected = filtered.reduce((sum, o) => sum + Number(o.total ?? 0), 0);

  return (
    <div className="space-y-3">
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-start gap-2">
        <CheckCircle size={16} className="text-emerald-600 mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-sm font-bold text-emerald-800">
            محسوبة من الطلبات المسلمة فقط ({fmtMoney(collected)})
          </p>
          <p className="text-[11px] text-emerald-700 mt-0.5">
            عدد الطلبات: {filtered.length}.{' '}
            {a.totalCollected !== collected && (
              <>
                إجمالي آخر 90 يوم على هذا المندوب: {fmtMoney(a.totalCollected)} — التصفية الحالية
                تعرض جزءًا منه.
              </>
            )}
          </p>
        </div>
      </div>

      {/* Phase 23B — quick range pills. Default is "آخر 90 يوم"
          which matches the fetch window so the tab number agrees
          with the table cell for the same delegate. */}
      <div className="flex items-center gap-1 bg-[hsl(var(--muted))]/40 rounded-xl p-1 w-fit">
        {(
          [
            { key: 'today', label: 'اليوم' },
            { key: 'week', label: 'هذا الأسبوع' },
            { key: 'month', label: 'هذا الشهر' },
            { key: '90d', label: 'آخر 90 يوم' },
          ] as const
        ).map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => setRange(opt.key)}
            className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors ${
              range === opt.key
                ? 'bg-white text-[hsl(var(--foreground))] shadow-sm'
                : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          لا توجد طلبات مسلمة في هذه الفترة.
        </p>
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr>
                {['رقم الطلب', 'العميل', 'التاريخ', 'الإجمالي', 'الحالة'].map((h) => (
                  <th key={h} className="table-header text-right">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[hsl(var(--border))]">
              {filtered.slice(0, 200).map((o) => (
                <tr key={o.id} className="hover:bg-[hsl(var(--muted))]/30">
                  <td className="table-cell font-mono text-xs">{o.order_num}</td>
                  <td className="table-cell text-xs">{o.customer || '—'}</td>
                  <td className="table-cell text-xs">{formatDateAr(o.created_at)}</td>
                  <td className="table-cell font-mono text-xs">{fmtMoney(o.total)}</td>
                  <td className="table-cell text-xs text-emerald-700">
                    {STATUS_LABELS[o.status] || o.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > 200 && (
            <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-2 text-center">
              يتم عرض أحدث 200 طلب فقط في هذه التصفية.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Phase 23B — Settlements tab ──────────────────────────────────────────
//
// Per-delegate handover (توريد) timeline plus a header summary
// (collected / settled / remaining) and an admin-only "تسجيل توريد"
// CTA. Reads from the page's already-fetched `settlements` slice
// via the aggregate; the modal that writes new settlements is a
// separate component (`RegisterSettlementModal`).
interface SettlementsTabProps {
  a: DelegateAggregate;
  canRegister?: boolean;
  onRegister?: () => void;
}

function SettlementsTab({ a, canRegister = false, onRegister }: SettlementsTabProps) {
  const remaining = a.remainingDue;
  const remainingLabel =
    remaining < 0 ? `${fmtMoney(Math.abs(remaining))} (رصيد زائد للمندوب)` : fmtMoney(remaining);
  const remainingTone =
    remaining > 0
      ? 'bg-amber-50 border-amber-200 text-amber-800'
      : remaining < 0
        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
        : 'bg-[hsl(var(--muted))]/40 border-[hsl(var(--border))] text-[hsl(var(--foreground))]';

  return (
    <div className="space-y-4">
      {/* Summary triplet */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4">
          <p className="text-[11px] font-bold text-[hsl(var(--muted-foreground))] mb-1">
            إجمالي التحصيل من الطلبات المسلمة
          </p>
          <p className="text-lg font-bold">{fmtMoney(a.totalCollected)}</p>
        </div>
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4">
          <p className="text-[11px] font-bold text-[hsl(var(--muted-foreground))] mb-1">
            إجمالي ما تم توريده
          </p>
          <p className="text-lg font-bold text-emerald-700">{fmtMoney(a.totalSettled)}</p>
        </div>
        <div className={`rounded-2xl border p-4 ${remainingTone}`}>
          <p className="text-[11px] font-bold mb-1 opacity-80">المتبقي على المندوب</p>
          <p className="text-lg font-bold">{remainingLabel}</p>
        </div>
      </div>

      {/* Admin CTA */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          {a.settlements.length === 0
            ? 'لا توجد توريدات مسجلة بعد.'
            : `${a.settlements.length} توريد مسجل (آخر 90 يوم).`}
        </p>
        {canRegister && onRegister && (
          <button
            type="button"
            onClick={onRegister}
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl"
          >
            <Plus size={12} /> تسجيل توريد
          </button>
        )}
      </div>

      {/* Timeline */}
      {a.settlements.length === 0 ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          لم يتم تسجيل أي توريد لهذا المندوب بعد.
        </p>
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr>
                {['التاريخ', 'المبلغ', 'الطريقة', 'استلم بواسطة', 'ملاحظة'].map((h) => (
                  <th key={h} className="table-header text-right">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[hsl(var(--border))]">
              {a.settlements.map((s) => (
                <tr key={s.id} className="hover:bg-[hsl(var(--muted))]/30">
                  <td className="table-cell text-xs">{formatDateAr(s.settled_at)}</td>
                  <td className="table-cell font-mono text-xs font-bold text-emerald-700">
                    {fmtMoney(Number(s.amount))}
                  </td>
                  <td className="table-cell text-xs">{settlementMethodLabel(s.method)}</td>
                  <td className="table-cell text-xs">{s.received_by_name || '—'}</td>
                  <td className="table-cell text-xs text-[hsl(var(--muted-foreground))]">
                    {s.note || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Phase 23B — Register settlement modal ────────────────────────────────
//
// Admin-only form that inserts ONE row into
// `turath_masr_delegate_settlements`. Validates client-side:
//   • amount > 0
//   • amount ≤ 1,000,000 ج.م without an explicit confirmation
//     toggle (sanity guard against accidental two-extra-zeros entry)
//   • settled_at not in the future
//   • method ∈ SETTLEMENT_METHOD_TOKENS
//
// Captures the dispatcher's profile id + display name as
// `received_by` / `received_by_name` so the timeline shows who
// acknowledged the handover.
//
// The mutation is a single `INSERT` — no upserts, no rollbacks of
// other state. Failure surfaces a clear Arabic toast (RLS rejects
// surface as 42501; the constraint check on the `method` column
// surfaces as 23514).
interface RegisterSettlementModalProps {
  delegate: DelegateRow;
  remainingDue: number;
  receivedBy: { id: string | null; name: string | null };
  onClose: () => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}

function RegisterSettlementModal({
  delegate,
  remainingDue,
  receivedBy,
  onClose,
  onSaved,
  onError,
}: RegisterSettlementModalProps) {
  // Default settled_at to the current local timestamp formatted for
  // <input type="datetime-local">. Keep seconds out — the input
  // type's standard widget rounds to the minute.
  const nowLocal = (() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })();

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<SettlementMethod>('cash');
  const [settledAt, setSettledAt] = useState(nowLocal);
  const [note, setNote] = useState('');
  // Sanity-confirm toggle for unusually large amounts.
  const [largeAmountAcknowledged, setLargeAmountAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const parsedAmount = Number(amount);
  const isLarge = Number.isFinite(parsedAmount) && parsedAmount > 1_000_000;

  const validate = (): string => {
    if (!amount.trim()) return 'المبلغ مطلوب';
    if (!Number.isFinite(parsedAmount)) return 'المبلغ غير صالح';
    if (parsedAmount <= 0) return 'المبلغ يجب أن يكون أكبر من صفر';
    if (isLarge && !largeAmountAcknowledged) {
      return 'المبلغ كبير. يرجى تأكيد الرغبة في تسجيله.';
    }
    if (!method) return 'يجب اختيار طريقة التوريد';
    if (settledAt) {
      const ts = new Date(settledAt).getTime();
      if (Number.isNaN(ts)) return 'تاريخ التوريد غير صالح';
      // Allow a small grace (60s) for clock drift on the client.
      if (ts - Date.now() > 60_000) return 'لا يمكن تسجيل توريد في تاريخ مستقبلي';
    }
    return '';
  };

  const handleSubmit = async () => {
    setError('');
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    if (!delegate.profileId) {
      setError('سجل قديم بدون ملف. لا يمكن تسجيل توريد من هنا.');
      return;
    }
    setSubmitting(true);
    try {
      const supabase = createClient();
      const { error: insertError } = await supabase
        .from('turath_masr_delegate_settlements')
        .insert({
          delegate_profile_id: delegate.profileId,
          delegate_name: delegate.name,
          amount: parsedAmount,
          method,
          received_by: receivedBy.id,
          received_by_name: receivedBy.name,
          note: note.trim() || null,
          // Convert the datetime-local string (no TZ) to a proper
          // ISO string so PostgREST stores it correctly. The
          // browser's local TZ wins — same convention as scheduled
          // delivery in Phase 22Q.
          settled_at: new Date(settledAt).toISOString(),
        });
      if (insertError) {
        console.error('[delegates] register settlement failed', insertError);
        let msg = `تعذر تسجيل التوريد: ${insertError.message}`;
        if (insertError.code === '42501') {
          msg = 'لا تملك صلاحية تسجيل توريد. تواصل مع المدير.';
        } else if (insertError.code === '42P01') {
          msg = 'جدول التوريدات غير متاح بعد. لم يتم تطبيق ترحيل القاعدة.';
        } else if (insertError.code === '23514') {
          msg = 'البيانات المُدخَلة لا تطابق القيود (المبلغ موجب، طريقة معروفة).';
        }
        setError(msg);
        onError(msg);
        setSubmitting(false);
        return;
      }
      onSaved('تم تسجيل التوريد بنجاح.');
    } catch (e) {
      const msg = `حدث خطأ غير متوقع: ${e instanceof Error ? e.message : String(e)}`;
      console.error('[delegates] register settlement unexpected error', e);
      setError(msg);
      onError(msg);
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-3xl shadow-modal w-full max-w-lg max-h-[90vh] flex flex-col fade-in">
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between p-5 border-b border-[hsl(var(--border))]">
          <div>
            <h3 className="text-base font-bold text-[hsl(var(--foreground))]">تسجيل توريد</h3>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">{delegate.name}</p>
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
          {/* Outstanding-balance hint so the dispatcher knows how much
              the delegate currently owes before they pick an amount. */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800">
            المتبقي حاليًا على المندوب:{' '}
            <span className="font-bold">
              {remainingDue < 0
                ? `${fmtMoney(Math.abs(remainingDue))} (زائد)`
                : fmtMoney(remainingDue)}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field
              label="المبلغ * (ج.م)"
              value={amount}
              onChange={(v) => {
                // Allow digits + a single decimal point. Strip
                // anything else as the dispatcher types.
                const cleaned = v.replace(/[^\d.]/g, '');
                const parts = cleaned.split('.');
                const normalized =
                  parts.length > 1 ? `${parts[0]}.${parts.slice(1).join('').slice(0, 2)}` : cleaned;
                setAmount(normalized);
              }}
              placeholder="0"
              dir="ltr"
            />
            <div>
              <label className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))] mb-1 block">
                طريقة التوريد *
              </label>
              <select
                className="input-field w-full"
                value={method}
                onChange={(e) => setMethod(e.target.value as SettlementMethod)}
              >
                {SETTLEMENT_METHOD_TOKENS.map((t) => (
                  <option key={t} value={t}>
                    {SETTLEMENT_METHOD_LABELS_AR[t]}
                  </option>
                ))}
              </select>
            </div>
            <Field
              label="تاريخ التوريد"
              type="datetime-local"
              value={settledAt}
              onChange={setSettledAt}
              dir="ltr"
            />
            <div>
              <label className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))] mb-1 block">
                استلم بواسطة
              </label>
              <input
                type="text"
                value={receivedBy.name || '—'}
                disabled
                className="input-field w-full opacity-60"
              />
            </div>
          </div>

          <div>
            <label className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))] mb-1 block">
              ملاحظة (اختياري)
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 500))}
              placeholder="مثال: توريد كاش يوم الجمعة من المخزن"
              rows={3}
              className="input-field w-full resize-none"
            />
            <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-1">
              {note.length} / 500 حرف
            </p>
          </div>

          {/* Sanity confirmation for unusually large amounts. */}
          {isLarge && (
            <label className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
              <input
                type="checkbox"
                checked={largeAmountAcknowledged}
                onChange={(e) => setLargeAmountAcknowledged(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                المبلغ {fmtMoney(parsedAmount)} كبير. أؤكد أن المبلغ صحيح وأرغب في تسجيله.
              </span>
            </label>
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
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
            إلغاء
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-2 text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
          >
            <Banknote size={14} />
            {submitting ? 'جارٍ التسجيل...' : 'تسجيل التوريد'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Phase 23C — Custody tab ──────────────────────────────────────────────
//
// Per-delegate custody (الأمانات / العهد) timeline. Header summary
// counts the four lifecycle states (with_delegate / returned /
// settled / lost) and surfaces the EGP value of items still
// "with_delegate". Admin-only action buttons:
//   • per-row: استلام / تسوية / مفقود (each fires the parent's
//     status-change confirm dialog)
//   • header: إضافة أمانة (opens the AddCustodyModal)
//
// Strictly read-side aggregation; the parent owns mutations.
interface CustodyTabProps {
  a: DelegateAggregate;
  canManage?: boolean;
  onAdd?: () => void;
  onChangeStatus?: (row: CustodyRow, next: 'returned' | 'settled' | 'lost') => void;
}

function CustodyTab({ a, canManage = false, onAdd, onChangeStatus }: CustodyTabProps) {
  // Pre-bucket the lifecycle counts for the header summary so the
  // render loop below can stay dumb.
  const buckets = { with_delegate: 0, returned: 0, settled: 0, lost: 0 };
  for (const c of a.custody) {
    if (c.status in buckets) {
      buckets[c.status as keyof typeof buckets] += 1;
    }
  }

  return (
    <div className="space-y-4">
      {/* Summary block */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-[11px] font-bold text-amber-800 mb-1">قيمة الأمانات الحالية</p>
          <p className="text-lg font-bold text-amber-900">{fmtMoney(a.activeCustodyValue)}</p>
          <p className="text-[10px] text-amber-700 mt-1">
            عدد العهد المفتوحة: {a.activeCustodyCount}
          </p>
          {a.activeCashCustody > 0 && (
            <p className="text-[10px] text-amber-700 mt-0.5">
              منها أمانات مالية: {fmtMoney(a.activeCashCustody)}
            </p>
          )}
        </div>
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4">
          <p className="text-[11px] font-bold text-[hsl(var(--muted-foreground))] mb-1">
            تم الاستلام
          </p>
          <p className="text-lg font-bold text-emerald-700">{buckets.returned}</p>
        </div>
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4">
          <p className="text-[11px] font-bold text-[hsl(var(--muted-foreground))] mb-1">
            تمت التسوية
          </p>
          <p className="text-lg font-bold text-blue-700">{buckets.settled}</p>
        </div>
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4">
          <p className="text-[11px] font-bold text-[hsl(var(--muted-foreground))] mb-1">مفقود</p>
          <p className="text-lg font-bold text-red-700">{buckets.lost}</p>
        </div>
      </div>

      {/* Admin CTA */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          {a.custody.length === 0
            ? 'لا توجد أمانات مسجلة بعد.'
            : `${a.custody.length} أمانة مسجلة.`}
        </p>
        {canManage && onAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl"
          >
            <Plus size={12} /> إضافة أمانة
          </button>
        )}
      </div>

      {/* Timeline */}
      {a.custody.length === 0 ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          لم يتم تسجيل أي أمانة لهذا المندوب بعد.
        </p>
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr>
                {[
                  'التاريخ',
                  'النوع',
                  'الوصف',
                  'الكمية',
                  'القيمة',
                  'الحالة',
                  'ملاحظة',
                  ...(canManage ? ['إجراء'] : []),
                ].map((h) => (
                  <th key={h} className="table-header text-right">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[hsl(var(--border))]">
              {a.custody.map((c) => {
                const isActive = c.status === 'with_delegate';
                const tone =
                  CUSTODY_STATUS_TONE[c.status as CustodyStatus] ||
                  'bg-[hsl(var(--muted))]/40 text-[hsl(var(--muted-foreground))] border-[hsl(var(--border))]';
                return (
                  <tr key={c.id} className="hover:bg-[hsl(var(--muted))]/30">
                    <td className="table-cell text-xs">{formatDateAr(c.handed_at)}</td>
                    <td className="table-cell text-xs">{custodyTypeLabel(c.custody_type)}</td>
                    <td className="table-cell text-xs">{c.description || '—'}</td>
                    <td className="table-cell font-mono text-xs">
                      {c.quantity != null ? Number(c.quantity).toLocaleString('en-US') : '—'}
                    </td>
                    <td className="table-cell font-mono text-xs">
                      {Number(c.estimated_value ?? 0) > 0
                        ? fmtMoney(Number(c.estimated_value))
                        : '—'}
                    </td>
                    <td className="table-cell">
                      <span
                        className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full border ${tone}`}
                      >
                        {custodyStatusLabel(c.status)}
                      </span>
                    </td>
                    <td className="table-cell text-xs text-[hsl(var(--muted-foreground))]">
                      {c.note || '—'}
                    </td>
                    {canManage && (
                      <td className="table-cell">
                        {/* Active row → three terminal-state actions.
                            Closed rows render a dash so the column
                            stays aligned. */}
                        {isActive && onChangeStatus ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => onChangeStatus(c, 'returned')}
                              className="text-[11px] font-semibold text-emerald-700 hover:underline"
                            >
                              استلام
                            </button>
                            <button
                              type="button"
                              onClick={() => onChangeStatus(c, 'settled')}
                              className="text-[11px] font-semibold text-blue-700 hover:underline"
                            >
                              تسوية
                            </button>
                            <button
                              type="button"
                              onClick={() => onChangeStatus(c, 'lost')}
                              className="text-[11px] font-semibold text-red-700 hover:underline"
                            >
                              مفقود
                            </button>
                          </div>
                        ) : (
                          <span className="text-[hsl(var(--muted-foreground))] text-xs">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Phase 23C — Expenses tab ────────────────────────────────────────────
//
// Per-delegate expenses (المصاريف) timeline. Header summary surfaces
// the approved-only total + count (matches the page-level KPI), and
// admin-only "إضافة مصروف" CTA opens the modal.
interface ExpensesTabProps {
  a: DelegateAggregate;
  canManage?: boolean;
  onAdd?: () => void;
}

function ExpensesTab({ a, canManage = false, onAdd }: ExpensesTabProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4">
          <p className="text-[11px] font-bold text-[hsl(var(--muted-foreground))] mb-1">
            إجمالي المصاريف المعتمدة
          </p>
          <p className="text-lg font-bold text-orange-700">{fmtMoney(a.approvedExpensesTotal)}</p>
        </div>
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4">
          <p className="text-[11px] font-bold text-[hsl(var(--muted-foreground))] mb-1">
            عدد المصاريف
          </p>
          <p className="text-lg font-bold">{a.expenses.length}</p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          {a.expenses.length === 0
            ? 'لا توجد مصاريف مسجلة بعد (آخر 90 يوم).'
            : `${a.expenses.length} مصروف مسجل (آخر 90 يوم).`}
        </p>
        {canManage && onAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold rounded-xl"
          >
            <Plus size={12} /> إضافة مصروف
          </button>
        )}
      </div>

      {a.expenses.length === 0 ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          لم يتم تسجيل أي مصروف لهذا المندوب في آخر 90 يوم.
        </p>
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr>
                {['التاريخ', 'النوع', 'الطلب', 'المبلغ', 'الحالة', 'ملاحظة'].map((h) => (
                  <th key={h} className="table-header text-right">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[hsl(var(--border))]">
              {a.expenses.map((e) => {
                const tone =
                  EXPENSE_STATUS_TONE[e.status as keyof typeof EXPENSE_STATUS_TONE] ||
                  'bg-[hsl(var(--muted))]/40 text-[hsl(var(--muted-foreground))] border-[hsl(var(--border))]';
                return (
                  <tr key={e.id} className="hover:bg-[hsl(var(--muted))]/30">
                    <td className="table-cell text-xs">{formatDateAr(e.expense_at)}</td>
                    <td className="table-cell text-xs">{expenseTypeLabel(e.expense_type)}</td>
                    <td className="table-cell font-mono text-xs">
                      {e.order_id ? (
                        e.order_id
                      ) : (
                        <span className="text-[hsl(var(--muted-foreground))]">—</span>
                      )}
                    </td>
                    <td className="table-cell font-mono text-xs font-bold text-orange-700">
                      {fmtMoney(Number(e.amount))}
                    </td>
                    <td className="table-cell">
                      <span
                        className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full border ${tone}`}
                      >
                        {expenseStatusLabel(e.status)}
                      </span>
                    </td>
                    <td className="table-cell text-xs text-[hsl(var(--muted-foreground))]">
                      {e.note || '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Phase 23C — Add custody modal ────────────────────────────────────────
//
// Admin-only form that inserts ONE row into
// `turath_masr_delegate_custody`. Validates client-side:
//   • description required
//   • quantity > 0
//   • estimated_value >= 0
//   • handed_at not in the future (60s grace for clock drift)
//   • type ∈ CUSTODY_TYPE_TOKENS (enforced by the <select> options)
// Captures dispatcher id + name as `handed_by` / `handed_by_name`.
interface AddCustodyModalProps {
  delegate: DelegateRow;
  handedBy: { id: string | null; name: string | null };
  onClose: () => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}

function AddCustodyModal({ delegate, handedBy, onClose, onSaved, onError }: AddCustodyModalProps) {
  const nowLocal = (() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })();

  const [custodyType, setCustodyType] = useState<CustodyType>('other');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [estimatedValue, setEstimatedValue] = useState('0');
  const [handedAt, setHandedAt] = useState(nowLocal);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const parsedQty = Number(quantity);
  const parsedValue = Number(estimatedValue);

  const validate = (): string => {
    if (!description.trim()) return 'الوصف مطلوب';
    if (!Number.isFinite(parsedQty) || parsedQty <= 0) return 'الكمية يجب أن تكون أكبر من صفر';
    if (!Number.isFinite(parsedValue) || parsedValue < 0)
      return 'القيمة التقديرية لا يمكن أن تكون سالبة';
    if (handedAt) {
      const ts = new Date(handedAt).getTime();
      if (Number.isNaN(ts)) return 'تاريخ التسليم غير صالح';
      if (ts - Date.now() > 60_000) return 'لا يمكن تسجيل أمانة في تاريخ مستقبلي';
    }
    return '';
  };

  const handleSubmit = async () => {
    setError('');
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    if (!delegate.profileId) {
      setError('سجل قديم بدون ملف. لا يمكن تسجيل أمانة من هنا.');
      return;
    }
    setSubmitting(true);
    try {
      const supabase = createClient();
      const { error: insertError } = await supabase.from('turath_masr_delegate_custody').insert({
        delegate_profile_id: delegate.profileId,
        delegate_name: delegate.name,
        custody_type: custodyType,
        description: description.trim(),
        quantity: parsedQty,
        estimated_value: parsedValue,
        status: 'with_delegate',
        handed_by: handedBy.id,
        handed_by_name: handedBy.name,
        handed_at: new Date(handedAt).toISOString(),
        note: note.trim() || null,
      });
      if (insertError) {
        console.error('[delegates] add custody failed', insertError);
        let msg = `تعذر تسجيل الأمانة: ${insertError.message}`;
        if (insertError.code === '42501') {
          msg = 'لا تملك صلاحية تسجيل أمانات. تواصل مع المدير.';
        } else if (insertError.code === '42P01') {
          msg = 'جدول الأمانات غير متاح بعد. لم يتم تطبيق ترحيل القاعدة.';
        } else if (insertError.code === '23514') {
          msg = 'البيانات المُدخَلة لا تطابق القيود (نوع/حالة/قيم).';
        }
        setError(msg);
        onError(msg);
        setSubmitting(false);
        return;
      }
      onSaved('تم تسجيل الأمانة بنجاح.');
    } catch (e) {
      const msg = `حدث خطأ غير متوقع: ${e instanceof Error ? e.message : String(e)}`;
      console.error('[delegates] add custody unexpected error', e);
      setError(msg);
      onError(msg);
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-3xl shadow-modal w-full max-w-lg max-h-[90vh] flex flex-col fade-in">
        <div className="flex-shrink-0 flex items-center justify-between p-5 border-b border-[hsl(var(--border))]">
          <div>
            <h3 className="text-base font-bold text-[hsl(var(--foreground))]">إضافة أمانة</h3>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">{delegate.name}</p>
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

        <div className="flex-1 overflow-y-auto p-5 space-y-4 scrollbar-thin">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))] mb-1 block">
                نوع الأمانة *
              </label>
              <select
                className="input-field w-full"
                value={custodyType}
                onChange={(e) => setCustodyType(e.target.value as CustodyType)}
              >
                {CUSTODY_TYPE_TOKENS.map((t) => (
                  <option key={t} value={t}>
                    {CUSTODY_TYPE_LABELS_AR[t]}
                  </option>
                ))}
              </select>
            </div>
            <Field
              label="الوصف *"
              value={description}
              onChange={setDescription}
              placeholder="مثال: iPhone 11 Pro / كاش 5 آلاف"
            />
            <Field
              label="الكمية"
              value={quantity}
              onChange={(v) => setQuantity(v.replace(/[^\d.]/g, '').slice(0, 10))}
              dir="ltr"
            />
            <Field
              label="القيمة التقديرية (ج.م)"
              value={estimatedValue}
              onChange={(v) => {
                const cleaned = v.replace(/[^\d.]/g, '');
                const parts = cleaned.split('.');
                const normalized =
                  parts.length > 1 ? `${parts[0]}.${parts.slice(1).join('').slice(0, 2)}` : cleaned;
                setEstimatedValue(normalized);
              }}
              dir="ltr"
            />
            <Field
              label="تاريخ التسليم"
              type="datetime-local"
              value={handedAt}
              onChange={setHandedAt}
              dir="ltr"
            />
            <div>
              <label className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))] mb-1 block">
                سُلِّمت بواسطة
              </label>
              <input
                type="text"
                value={handedBy.name || '—'}
                disabled
                className="input-field w-full opacity-60"
              />
            </div>
          </div>

          <div>
            <label className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))] mb-1 block">
              ملاحظة (اختياري)
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 500))}
              placeholder="مثال: الجهاز للعميل في طلب 12345"
              rows={3}
              className="input-field w-full resize-none"
            />
            <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-1">
              {note.length} / 500 حرف
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700 flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="flex-shrink-0 flex items-center justify-between gap-3 p-4 border-t border-[hsl(var(--border))] bg-white rounded-b-3xl">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
            إلغاء
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-2 text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
          >
            <Briefcase size={14} />
            {submitting ? 'جارٍ التسجيل...' : 'تسجيل الأمانة'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Phase 23C — Add expense modal ────────────────────────────────────────
//
// Admin-only form that inserts ONE row into
// `turath_masr_delegate_expenses` with status='approved'. Validates:
//   • amount > 0
//   • amount ≤ 100,000 ج.م without an explicit confirmation
//     (sanity guard — most expense rows are < 1k ج)
//   • expense_at not in the future
//   • order_id optional (free-text — orders.id is text)
interface AddExpenseModalProps {
  delegate: DelegateRow;
  approvedBy: { id: string | null; name: string | null };
  onClose: () => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}

function AddExpenseModal({
  delegate,
  approvedBy,
  onClose,
  onSaved,
  onError,
}: AddExpenseModalProps) {
  const nowLocal = (() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })();

  const [expenseType, setExpenseType] = useState<ExpenseType>('fuel');
  const [amount, setAmount] = useState('');
  const [orderId, setOrderId] = useState('');
  const [expenseAt, setExpenseAt] = useState(nowLocal);
  const [note, setNote] = useState('');
  const [largeAcknowledged, setLargeAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const parsedAmount = Number(amount);
  const isLarge = Number.isFinite(parsedAmount) && parsedAmount > 100_000;

  const validate = (): string => {
    if (!amount.trim()) return 'المبلغ مطلوب';
    if (!Number.isFinite(parsedAmount)) return 'المبلغ غير صالح';
    if (parsedAmount <= 0) return 'المبلغ يجب أن يكون أكبر من صفر';
    if (isLarge && !largeAcknowledged) {
      return 'المبلغ كبير. يرجى تأكيد الرغبة في تسجيله.';
    }
    if (expenseAt) {
      const ts = new Date(expenseAt).getTime();
      if (Number.isNaN(ts)) return 'تاريخ المصروف غير صالح';
      if (ts - Date.now() > 60_000) return 'لا يمكن تسجيل مصروف في تاريخ مستقبلي';
    }
    return '';
  };

  const handleSubmit = async () => {
    setError('');
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    if (!delegate.profileId) {
      setError('سجل قديم بدون ملف. لا يمكن تسجيل مصروف من هنا.');
      return;
    }
    setSubmitting(true);
    try {
      const supabase = createClient();
      const { error: insertError } = await supabase.from('turath_masr_delegate_expenses').insert({
        delegate_profile_id: delegate.profileId,
        delegate_name: delegate.name,
        order_id: orderId.trim() || null,
        expense_type: expenseType,
        amount: parsedAmount,
        status: 'approved',
        approved_by: approvedBy.id,
        approved_by_name: approvedBy.name,
        note: note.trim() || null,
        expense_at: new Date(expenseAt).toISOString(),
      });
      if (insertError) {
        console.error('[delegates] add expense failed', insertError);
        let msg = `تعذر تسجيل المصروف: ${insertError.message}`;
        if (insertError.code === '42501') {
          msg = 'لا تملك صلاحية تسجيل مصاريف. تواصل مع المدير.';
        } else if (insertError.code === '42P01') {
          msg = 'جدول المصاريف غير متاح بعد. لم يتم تطبيق ترحيل القاعدة.';
        } else if (insertError.code === '23514') {
          msg = 'البيانات المُدخَلة لا تطابق القيود.';
        }
        setError(msg);
        onError(msg);
        setSubmitting(false);
        return;
      }
      onSaved('تم تسجيل المصروف بنجاح.');
    } catch (e) {
      const msg = `حدث خطأ غير متوقع: ${e instanceof Error ? e.message : String(e)}`;
      console.error('[delegates] add expense unexpected error', e);
      setError(msg);
      onError(msg);
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-3xl shadow-modal w-full max-w-lg max-h-[90vh] flex flex-col fade-in">
        <div className="flex-shrink-0 flex items-center justify-between p-5 border-b border-[hsl(var(--border))]">
          <div>
            <h3 className="text-base font-bold text-[hsl(var(--foreground))]">إضافة مصروف</h3>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">{delegate.name}</p>
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

        <div className="flex-1 overflow-y-auto p-5 space-y-4 scrollbar-thin">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))] mb-1 block">
                نوع المصروف *
              </label>
              <select
                className="input-field w-full"
                value={expenseType}
                onChange={(e) => setExpenseType(e.target.value as ExpenseType)}
              >
                {EXPENSE_TYPE_TOKENS.map((t) => (
                  <option key={t} value={t}>
                    {EXPENSE_TYPE_LABELS_AR[t]}
                  </option>
                ))}
              </select>
            </div>
            <Field
              label="المبلغ * (ج.م)"
              value={amount}
              onChange={(v) => {
                const cleaned = v.replace(/[^\d.]/g, '');
                const parts = cleaned.split('.');
                const normalized =
                  parts.length > 1 ? `${parts[0]}.${parts.slice(1).join('').slice(0, 2)}` : cleaned;
                setAmount(normalized);
              }}
              placeholder="0"
              dir="ltr"
            />
            <Field
              label="رقم الطلب (اختياري)"
              value={orderId}
              onChange={(v) => setOrderId(v.slice(0, 64))}
              placeholder="مثال: ORD-12345"
              dir="ltr"
            />
            <Field
              label="تاريخ المصروف"
              type="datetime-local"
              value={expenseAt}
              onChange={setExpenseAt}
              dir="ltr"
            />
            <div>
              <label className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))] mb-1 block">
                اعتمد بواسطة
              </label>
              <input
                type="text"
                value={approvedBy.name || '—'}
                disabled
                className="input-field w-full opacity-60"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))] mb-1 block">
                الحالة
              </label>
              <input type="text" value="معتمد" disabled className="input-field w-full opacity-60" />
            </div>
          </div>

          <div>
            <label className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))] mb-1 block">
              ملاحظة (اختياري)
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 500))}
              placeholder="مثال: بنزين توصيل طلب القاهرة"
              rows={3}
              className="input-field w-full resize-none"
            />
            <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-1">
              {note.length} / 500 حرف
            </p>
          </div>

          {/* Sanity confirmation for unusually large expense rows. */}
          {isLarge && (
            <label className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
              <input
                type="checkbox"
                checked={largeAcknowledged}
                onChange={(e) => setLargeAcknowledged(e.target.checked)}
                className="mt-0.5"
              />
              <span>المبلغ {fmtMoney(parsedAmount)} كبير لمصروف. أؤكد أن المبلغ صحيح.</span>
            </label>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700 flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="flex-shrink-0 flex items-center justify-between gap-3 p-4 border-t border-[hsl(var(--border))] bg-white rounded-b-3xl">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
            إلغاء
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-2 text-white bg-orange-600 hover:bg-orange-700 disabled:opacity-50"
          >
            <Receipt size={14} />
            {submitting ? 'جارٍ التسجيل...' : 'تسجيل المصروف'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Phase 23C — Custody status confirm dialog ────────────────────────────
//
// Lightweight confirm step between an admin clicking
// استلام / تسوية / مفقود on a custody row and the actual UPDATE.
// The parent owns the supabase call so the dialog stays stateless.
interface CustodyStatusDialogProps {
  row: CustodyRow;
  nextStatus: 'returned' | 'settled' | 'lost';
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function CustodyStatusDialog({
  row,
  nextStatus,
  submitting,
  onCancel,
  onConfirm,
}: CustodyStatusDialogProps) {
  const headlineByStatus: Record<typeof nextStatus, string> = {
    returned: 'استلام الأمانة',
    settled: 'تسوية الأمانة',
    lost: 'تسجيل الأمانة كمفقودة',
  };
  const bodyByStatus: Record<typeof nextStatus, string> = {
    returned: 'سيتم وضع علامة "تم الاستلام" على هذه الأمانة وتثبيت تاريخ الاستلام.',
    settled: 'سيتم تسوية الأمانة وتثبيت تاريخ التسوية.',
    lost: 'سيتم تسجيل الأمانة كمفقودة. هذا الإجراء يحتاج موافقة مسؤول.',
  };
  const buttonToneByStatus: Record<typeof nextStatus, string> = {
    returned: 'bg-emerald-600 hover:bg-emerald-700',
    settled: 'bg-blue-600 hover:bg-blue-700',
    lost: 'bg-red-600 hover:bg-red-700',
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-white rounded-3xl shadow-modal w-full max-w-md flex flex-col fade-in">
        <div className="p-5 border-b border-[hsl(var(--border))]">
          <h3 className="text-base font-bold text-[hsl(var(--foreground))]">
            {headlineByStatus[nextStatus]}
          </h3>
          <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
            {custodyTypeLabel(row.custody_type)} — {row.description}
          </p>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-sm text-[hsl(var(--foreground))]">{bodyByStatus[nextStatus]}</p>
          <div className="bg-[hsl(var(--muted))]/40 border border-[hsl(var(--border))] rounded-xl p-3 text-xs space-y-1">
            <p>
              المندوب: <span className="font-semibold">{row.delegate_name || '—'}</span>
            </p>
            <p>
              الكمية:{' '}
              <span className="font-mono">
                {row.quantity != null ? Number(row.quantity).toLocaleString('en-US') : '—'}
              </span>
            </p>
            <p>
              القيمة التقديرية:{' '}
              <span className="font-mono">{fmtMoney(Number(row.estimated_value ?? 0))}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 p-4 border-t border-[hsl(var(--border))]">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={submitting}>
            إلغاء
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting}
            className={`px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-2 text-white ${buttonToneByStatus[nextStatus]} disabled:opacity-50`}
          >
            <CheckCircle size={14} />
            {submitting ? 'جارٍ التحديث...' : headlineByStatus[nextStatus]}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Phase 23D — Account Statement tab ────────────────────────────────────
//
// Unified per-delegate ledger for collections + settlements +
// approved expenses + custody movements within a configurable date
// window. Defaults to "آخر 90 يوم" so the cached page data covers
// the view without an extra round-trip.
//
// Custom ranges that go outside the cached 90-day window trigger a
// per-delegate re-fetch. The re-fetch is narrow:
//   • orders        — by `assigned_to = delegate.profileId`
//   • settlements   — by `delegate_profile_id`
//   • expenses      — by `delegate_profile_id`
//   • custody       — by `delegate_profile_id` (no date filter — we
//                      need every open custody for the summary)
// Falls back to the cached aggregate slices on any fetch failure
// (RLS deny, network) so the dispatcher always sees something
// rather than a hard error.
//
// Performance: every query is column-narrowed (no `select('*')`,
// no `lines`, no images). The fetch is gated on
// `delegate.profileId` so legacy `delegate_name`-only delegates
// can't trigger a full-table scan — they just render the cached
// rows the page already has.
interface AccountStatementTabProps {
  a: DelegateAggregate;
  canExport?: boolean;
}

interface StatementFetchedSlices {
  orders: OrderRow[];
  settlements: SettlementRow[];
  expenses: ExpenseRow[];
  custody: CustodyRow[];
}

function AccountStatementTab({ a, canExport = false }: AccountStatementTabProps) {
  // Default range — last 90 days, computed once at mount. Matches
  // the page's primary fetch window so we use cached data without
  // any extra round-trips.
  const defaultRange = useMemo(() => resolveRangePreset('last90d'), []);

  const [preset, setPreset] = useState<StatementRangePreset>('last90d');
  const [fromIso, setFromIso] = useState<string>(defaultRange.fromIso);
  const [toIso, setToIso] = useState<string>(defaultRange.toIso);
  const [validationError, setValidationError] = useState<string>('');

  // Fetched slices for ranges that exceed the cached 90-day window.
  // `null` = "use the page-level aggregate slices" (cache hit).
  const [extendedSlices, setExtendedSlices] = useState<StatementFetchedSlices | null>(null);
  const [extendedLoading, setExtendedLoading] = useState(false);
  const [extendedError, setExtendedError] = useState<string>('');

  // Whether the requested `from` is older than ~90 days ago. The
  // cached page data only goes back 90 days, so anything older
  // demands a per-delegate re-fetch. Use a small buffer (3 days) so
  // a borderline "from = 90 days ago" doesn't double-fetch.
  const needsExtendedFetch = useMemo(() => {
    const f = fromIsoDate(fromIso);
    if (!f) return false;
    const threshold = Date.now() - 87 * 86_400_000;
    return f.getTime() < threshold;
  }, [fromIso]);

  // Re-fetch when the range extends past the cached window. Skips
  // legacy `delegate_name`-only rows because they have no
  // `profileId` to anchor the FK queries to — those rows fall back
  // to the cached page data which already matches by name.
  useEffect(() => {
    if (!needsExtendedFetch) {
      setExtendedSlices(null);
      setExtendedError('');
      return;
    }
    if (!a.delegate.profileId) {
      // Legacy delegate, no profile-id-keyed query possible.
      setExtendedSlices(null);
      setExtendedError('هذا المندوب سجل قديم بدون ملف. لا يمكن جلب بيانات أقدم من 90 يوم له.');
      return;
    }
    let cancelled = false;
    setExtendedLoading(true);
    setExtendedError('');
    (async () => {
      const supabase = createClient();
      // The to-date is end-of-day local; widen by one day so the
      // server filter is inclusive (Supabase's `lte` is < value
      // when value carries time = 00:00 UTC). Adding 1 day covers
      // the timezone gap without needing a custom RPC.
      const fromTs = new Date(`${fromIso}T00:00:00`).toISOString();
      const toExclusiveDate = (() => {
        const t = fromIsoDate(toIso);
        if (!t) return new Date().toISOString();
        const next = new Date(t);
        next.setDate(next.getDate() + 1);
        return next.toISOString();
      })();
      try {
        const [ordersRes, settlementsRes, expensesRes, custodyRes] = await Promise.all([
          supabase
            .from('turath_masr_orders')
            .select(
              'id, order_num, customer, region, district, neighborhood, total, shipping_fee, status, date, delegate_name, assigned_to, scheduled_delivery_date, scheduled_delivery_from, scheduled_delivery_to, created_at'
            )
            .eq('assigned_to', a.delegate.profileId!)
            .gte('created_at', fromTs)
            .lt('created_at', toExclusiveDate)
            .order('created_at', { ascending: false })
            .limit(2000),
          supabase
            .from('turath_masr_delegate_settlements')
            .select(
              'id, delegate_profile_id, delegate_name, amount, method, received_by, received_by_name, note, settled_at, created_at'
            )
            .eq('delegate_profile_id', a.delegate.profileId!)
            .gte('settled_at', fromTs)
            .lt('settled_at', toExclusiveDate)
            .order('settled_at', { ascending: false })
            .limit(2000),
          supabase
            .from('turath_masr_delegate_expenses')
            .select(
              'id, delegate_profile_id, delegate_name, order_id, expense_type, amount, status, approved_by, approved_by_name, note, expense_at, created_at'
            )
            .eq('delegate_profile_id', a.delegate.profileId!)
            .gte('expense_at', fromTs)
            .lt('expense_at', toExclusiveDate)
            .order('expense_at', { ascending: false })
            .limit(2000),
          // Custody is NOT date-filtered — we need every row to
          // compute the open balance correctly.
          supabase
            .from('turath_masr_delegate_custody')
            .select(
              'id, delegate_profile_id, delegate_name, custody_type, description, quantity, estimated_value, status, handed_by, handed_by_name, received_by, received_by_name, handed_at, returned_at, note, created_at'
            )
            .eq('delegate_profile_id', a.delegate.profileId!)
            .order('handed_at', { ascending: false })
            .limit(2000),
        ]);
        if (cancelled) return;
        const anyError =
          ordersRes.error || settlementsRes.error || expensesRes.error || custodyRes.error;
        if (anyError) {
          console.warn('[delegates] statement extended fetch partial failure', anyError);
          // Don't block render — surface a soft warning and fall
          // back to the cached aggregate slices. RLS denials and
          // 42P01s land here.
          setExtendedError(
            'تعذّر جلب بعض البيانات لهذه الفترة. سيتم العرض من البيانات المتوفرة فقط.'
          );
        }
        setExtendedSlices({
          orders: (ordersRes.data ?? []) as OrderRow[],
          settlements: (settlementsRes.data ?? []) as SettlementRow[],
          expenses: (expensesRes.data ?? []) as ExpenseRow[],
          custody: (custodyRes.data ?? []) as CustodyRow[],
        });
      } catch (e) {
        if (cancelled) return;
        console.error('[delegates] statement extended fetch failed', e);
        setExtendedError('حدث خطأ أثناء جلب البيانات. سيتم العرض من البيانات المتوفرة.');
        setExtendedSlices(null);
      } finally {
        if (!cancelled) setExtendedLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [needsExtendedFetch, fromIso, toIso, a.delegate.profileId]);

  // Validation: from <= to, valid ISO dates.
  useEffect(() => {
    if (!isValidRange(fromIso, toIso)) {
      setValidationError('تاريخ "من" يجب أن يكون قبل أو يساوي تاريخ "إلى".');
    } else {
      setValidationError('');
    }
  }, [fromIso, toIso]);

  // Pick the source slices to project from.
  const sourceSlices = extendedSlices ?? {
    orders: a.ordersForDelegate,
    settlements: a.settlements,
    expenses: a.expenses,
    custody: a.custody,
  };

  // Project to the slim shapes the helper module accepts.
  const orderInputs: StatementOrderInput[] = useMemo(
    () =>
      sourceSlices.orders.map((o) => ({
        id: o.id,
        order_num: o.order_num,
        customer: o.customer,
        total: o.total,
        status: o.status,
        created_at: o.created_at,
      })),
    [sourceSlices.orders]
  );
  const settlementInputs: StatementSettlementInput[] = useMemo(
    () =>
      sourceSlices.settlements.map((s) => ({
        id: s.id,
        amount: Number(s.amount ?? 0),
        method: s.method,
        methodLabel: settlementMethodLabel(s.method),
        note: s.note,
        settled_at: s.settled_at,
      })),
    [sourceSlices.settlements]
  );
  const expenseInputs: StatementExpenseInput[] = useMemo(
    () =>
      sourceSlices.expenses.map((e) => ({
        id: e.id,
        amount: Number(e.amount ?? 0),
        expense_type: e.expense_type,
        expenseTypeLabel: expenseTypeLabel(e.expense_type),
        status: e.status,
        order_id: e.order_id,
        note: e.note,
        expense_at: e.expense_at,
      })),
    [sourceSlices.expenses]
  );
  const custodyInputs: StatementCustodyInput[] = useMemo(
    () =>
      sourceSlices.custody.map((c) => ({
        id: c.id,
        custody_type: c.custody_type,
        custodyTypeLabel: custodyTypeLabel(c.custody_type),
        description: c.description,
        quantity: c.quantity,
        estimated_value: c.estimated_value,
        status: c.status,
        handed_at: c.handed_at,
        returned_at: c.returned_at,
        note: c.note,
      })),
    [sourceSlices.custody]
  );

  // Build the unified row list + summary. Memoised so a noisy
  // parent re-render doesn't recompute on every keystroke.
  const rows: DelegateStatementRow[] = useMemo(
    () =>
      isValidRange(fromIso, toIso)
        ? buildStatementRows(fromIso, toIso, {
            orders: orderInputs,
            settlements: settlementInputs,
            expenses: expenseInputs,
            custody: custodyInputs,
          })
        : [],
    [fromIso, toIso, orderInputs, settlementInputs, expenseInputs, custodyInputs]
  );

  const summary: DelegateStatementSummary = useMemo(
    () => summariseStatement(fromIso, toIso, rows, custodyInputs),
    [fromIso, toIso, rows, custodyInputs]
  );

  const days = rangeDays(fromIso, toIso);
  const longRange = days > 365;

  const applyPreset = (next: StatementRangePreset) => {
    setPreset(next);
    if (next === 'custom') return;
    const r = resolveRangePreset(next);
    setFromIso(r.fromIso);
    setToIso(r.toIso);
  };

  const handleExport = () => {
    if (!canExport) return;
    if (!isValidRange(fromIso, toIso)) return;
    const csv = toCsv({ name: a.delegate.name }, summary, rows);
    downloadCsv(csvFilename(a.delegate.name, fromIso, toIso), csv);
  };

  const handlePrint = () => {
    if (typeof window !== 'undefined') {
      window.print();
    }
  };

  const debitTotal = rows.reduce((s, r) => s + r.debit, 0);
  const creditTotal = rows.reduce((s, r) => s + r.credit, 0);

  return (
    <div className="space-y-4">
      {/* Range controls */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-1 bg-[hsl(var(--muted))]/40 rounded-xl p-1 w-fit">
          {(
            ['today', 'week', 'month', 'last90d', 'custom'] as ReadonlyArray<StatementRangePreset>
          ).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => applyPreset(p)}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors ${
                preset === p
                  ? 'bg-white text-[hsl(var(--foreground))] shadow-sm'
                  : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'
              }`}
            >
              {RANGE_PRESET_LABELS[p]}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))] mb-1 block">
              من تاريخ
            </label>
            <input
              type="date"
              value={fromIso}
              onChange={(e) => {
                setFromIso(e.target.value);
                setPreset('custom');
              }}
              className="input-field"
              dir="ltr"
            />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))] mb-1 block">
              إلى تاريخ
            </label>
            <input
              type="date"
              value={toIso}
              onChange={(e) => {
                setToIso(e.target.value);
                setPreset('custom');
              }}
              className="input-field"
              dir="ltr"
            />
          </div>
          <div className="flex flex-wrap gap-2 ml-auto print:hidden">
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1 px-3 py-2 bg-[hsl(var(--muted))] hover:bg-[hsl(var(--muted))]/70 text-[hsl(var(--foreground))] text-xs font-semibold rounded-xl"
            >
              <Printer size={12} /> طباعة
            </button>
            {canExport && (
              <button
                type="button"
                onClick={handleExport}
                className="inline-flex items-center gap-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl"
                disabled={!!validationError || rows.length === 0}
              >
                <Download size={12} /> تصدير CSV
              </button>
            )}
          </div>
        </div>

        {/* Validation + range warnings */}
        {validationError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700 flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
            <span>{validationError}</span>
          </div>
        )}
        {!validationError && longRange && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
            <span>قد يستغرق الكشف لفترة طويلة وقتًا أطول. الفترة الحالية {days} يوم.</span>
          </div>
        )}
        {!validationError && extendedError && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
            <span>{extendedError}</span>
          </div>
        )}
        {extendedLoading && (
          <p className="text-xs text-[hsl(var(--muted-foreground))]">جاري تحميل البيانات...</p>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4">
          <p className="text-[11px] font-bold text-[hsl(var(--muted-foreground))] mb-1">
            إجمالي التحصيلات
          </p>
          <p className="text-lg font-bold">{fmtMoney(summary.totalCollected)}</p>
        </div>
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4">
          <p className="text-[11px] font-bold text-[hsl(var(--muted-foreground))] mb-1">
            إجمالي التوريدات
          </p>
          <p className="text-lg font-bold text-emerald-700">{fmtMoney(summary.totalSettled)}</p>
        </div>
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4">
          <p className="text-[11px] font-bold text-[hsl(var(--muted-foreground))] mb-1">
            إجمالي المصاريف المعتمدة
          </p>
          <p className="text-lg font-bold text-orange-700">
            {fmtMoney(summary.totalApprovedExpenses)}
          </p>
        </div>
        <div
          className={`rounded-2xl border p-4 ${
            summary.financialRemaining > 0
              ? 'bg-amber-50 border-amber-200'
              : summary.financialRemaining < 0
                ? 'bg-emerald-50 border-emerald-200'
                : 'bg-white border-[hsl(var(--border))]'
          }`}
        >
          <p className="text-[11px] font-bold mb-1 opacity-80">المتبقي المالي</p>
          <p className="text-lg font-bold">
            {summary.financialRemaining < 0
              ? `${fmtMoney(Math.abs(summary.financialRemaining))} (زائد)`
              : fmtMoney(summary.financialRemaining)}
          </p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-[11px] font-bold text-amber-800 mb-1">قيمة الأمانات الحالية</p>
          <p className="text-lg font-bold text-amber-900">{fmtMoney(summary.activeCustodyValue)}</p>
          <p className="text-[10px] text-amber-700 mt-1">(مستقلة عن الفترة)</p>
        </div>
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4">
          <p className="text-[11px] font-bold text-[hsl(var(--muted-foreground))] mb-1">
            عدد الأمانات المفتوحة
          </p>
          <p className="text-lg font-bold">{summary.openCustodyCount}</p>
        </div>
      </div>

      {/* Movements table */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-bold">حركات الفترة</h4>
          <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
            مدين: {fmtMoney(debitTotal)} — دائن: {fmtMoney(creditTotal)}
          </p>
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            لا توجد حركات في الفترة المحددة.
          </p>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr>
                  {['التاريخ', 'النوع', 'المرجع', 'الوصف', 'مدين', 'دائن', 'ملاحظة'].map((h) => (
                    <th key={h} className="table-header text-right">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[hsl(var(--border))]">
                {rows.map((r) => {
                  // Tone the row by type so the dispatcher can scan
                  // money flow at a glance.
                  const tone =
                    r.type === 'collection'
                      ? 'text-blue-700'
                      : r.type === 'settlement'
                        ? 'text-emerald-700'
                        : r.type === 'expense'
                          ? 'text-orange-700'
                          : 'text-[hsl(var(--muted-foreground))]';
                  return (
                    <tr key={r.id} className="hover:bg-[hsl(var(--muted))]/30">
                      <td className="table-cell text-xs">{formatDateAr(r.date)}</td>
                      <td className={`table-cell text-xs font-semibold ${tone}`}>{r.label}</td>
                      <td className="table-cell font-mono text-xs">{r.reference || '—'}</td>
                      <td className="table-cell text-xs">{r.description}</td>
                      <td className="table-cell font-mono text-xs">
                        {r.debit > 0 ? (
                          <span className="text-blue-700 font-bold">{fmtMoney(r.debit)}</span>
                        ) : (
                          <span className="text-[hsl(var(--muted-foreground))]">—</span>
                        )}
                      </td>
                      <td className="table-cell font-mono text-xs">
                        {r.credit > 0 ? (
                          <span className="text-emerald-700 font-bold">{fmtMoney(r.credit)}</span>
                        ) : (
                          <span className="text-[hsl(var(--muted-foreground))]">—</span>
                        )}
                      </td>
                      <td className="table-cell text-xs text-[hsl(var(--muted-foreground))]">
                        {r.note || '—'}
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
  );
}
