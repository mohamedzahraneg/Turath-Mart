'use client';
// ─────────────────────────────────────────────────────────────────────────────
// /customers — Phase 24A
//
// Customer-service CRM dashboard. Replaces the old `/crm` page with a
// design-locked layout that matches the screenshot the spec ships:
//   • RTL dark sidebar (existing `Sidebar.tsx`)
//   • Header search "ابحث عن عميل، طلب، أو ملاحظة..."
//   • 4 + 4 KPI cards (totals, status counts, financial rates)
//   • Filter / Export / New customer actions
//   • Customer table with row actions (open profile / WhatsApp / call)
//   • Pagination with selectable page size
//
// Data sources (all narrow `.select(...)`; never `*`):
//   turath_masr_customers
//   turath_masr_orders            (last 365 days for the dashboard)
//   turath_masr_crm_complaints
//   turath_masr_audit_logs        (delegate-notes counter, last 90 days)
//   turath_masr_customer_notes    (last note per customer, when table exists)
//
// All metric folding goes through `customerCrm.ts` (pure helper).
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Users,
  Search,
  Filter,
  Download,
  Plus,
  Phone as PhoneIcon,
  MessageCircle,
  User as UserIcon,
  AlertCircle,
  Truck,
  RotateCcw,
  XCircle,
  CheckCircle,
  Megaphone,
  Eye,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  X,
  // Phase 24B — duplicate KPI / badge iconography.
  Copy as CopyIcon,
  AlertTriangle,
  // Phase 24D — tasks KPI / panel iconography.
  ClipboardCheck,
  Clock,
  Flame,
} from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { createClient } from '@/lib/supabase/client';
import { usePermissions } from '@/hooks/usePermissions';
import {
  type CustomerRow,
  type OrderRow,
  type ComplaintRow,
  type NoteRow,
  type DashboardCustomerRow,
  type TaskRow,
  buildDashboardRows,
  computeDashboardKpis,
  computeMetricsByPhone,
  customerKeyFromPhone,
  customerStatusLabel,
  customerStatusTone,
  customerTypeLabel,
  customerTypeTone,
  // Phase 24B — duplicate-detection helpers + Egypt-mobile validator.
  countDuplicatePhones,
  detectDuplicateGroups,
  isLikelyEgyptMobile,
  type DuplicateGroup,
  customersCsvFilename,
  customersToCsv,
  downloadCsv,
  fmtMoney,
  fmtRate,
  fmtDateYmd,
  buildWhatsAppHref,
  buildTelHref,
  normalisePhone,
  // Phase 24D — task helpers.
  bucketTasks,
  deriveTaskFlags,
  rankTasks,
  TASK_PRIORITY_LABEL_AR,
  TASK_PRIORITY_TONE,
} from '@/lib/crm/customerCrm';

interface DashboardKpiCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  tone: 'blue' | 'emerald' | 'amber' | 'red' | 'violet' | 'slate';
}

function DashboardKpiCard({ icon, label, value, tone }: DashboardKpiCardProps) {
  const toneClass: Record<DashboardKpiCardProps['tone'], string> = {
    blue: 'bg-blue-50 text-blue-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
    violet: 'bg-violet-50 text-violet-600',
    slate: 'bg-slate-100 text-slate-700',
  };
  return (
    <div className="bg-white rounded-2xl border border-[hsl(var(--border))] p-4 flex items-center justify-between gap-3">
      <div>
        <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))] mb-1">{label}</p>
        <p className="text-2xl font-extrabold text-[hsl(var(--foreground))]">{value}</p>
      </div>
      <div className={`w-12 h-12 rounded-xl ${toneClass[tone]} flex items-center justify-center`}>
        {icon}
      </div>
    </div>
  );
}

type PageSize = 10 | 20 | 50 | 100;

export default function CustomersPage() {
  const perms = usePermissions();
  const canExport = perms.isAdmin;
  const canCreate = perms.isAdmin;

  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [complaints, setComplaints] = useState<ComplaintRow[]>([]);
  const [latestNotes, setLatestNotes] = useState<Map<string, NoteRow | null>>(new Map());
  const [delegateNotesCount, setDelegateNotesCount] = useState(0);
  // Phase 24D — dashboard tasks slice. Drives the new KPI cards and
  // the urgent/overdue panel below the customer list.
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrorBanner(null);
    (async () => {
      const supabase = createClient();
      const since365 = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
      const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

      const [custRes, ordersRes, complaintsRes, auditRes, notesRes, tasksRes] = await Promise.all([
        supabase
          .from('turath_masr_customers')
          .select(
            'phone, full_name, email, address, segment, city, customer_type, customer_status, account_manager_id, account_manager_name, vip_level, notes, total_spent, total_orders, created_at, updated_at'
          )
          .order('updated_at', { ascending: false, nullsFirst: false })
          .limit(2000)
          .then(
            (r: { data: CustomerRow[] | null; error: unknown }) => r,
            (err: unknown) => ({ data: null as CustomerRow[] | null, error: err })
          ),
        supabase
          .from('turath_masr_orders')
          .select(
            'id, order_num, customer, phone, phone2, total, status, date, delegate_name, scheduled_delivery_date, scheduled_delivery_from, scheduled_delivery_to, tracking_token, notes, created_at'
          )
          .gte('created_at', since365)
          .order('created_at', { ascending: false })
          .limit(5000)
          .then(
            (r: { data: OrderRow[] | null; error: unknown }) => r,
            (err: unknown) => ({ data: null as OrderRow[] | null, error: err })
          ),
        supabase
          .from('turath_masr_crm_complaints')
          .select('id, customer_phone, subject, status, notes, created_by, created_at')
          .order('created_at', { ascending: false })
          .limit(2000)
          .then(
            (r: { data: ComplaintRow[] | null; error: unknown }) => r,
            (err: unknown) => ({ data: null as ComplaintRow[] | null, error: err })
          ),
        supabase
          .from('turath_masr_audit_logs')
          .select('id, note, created_at')
          .gte('created_at', since90)
          .not('note', 'is', null)
          .limit(2000)
          .then(
            (r: {
              data: { id: string; note: string | null; created_at: string }[] | null;
              error: unknown;
            }) => r,
            (err: unknown) => ({ data: null, error: err })
          ),
        // Latest note per customer — fetched once and pivoted in-memory
        // so the dashboard table's "آخر ملاحظة مندوب" column has the
        // freshest CRM-side note when one exists. Pre-migration the
        // table doesn't exist and this falls through to an empty map.
        supabase
          .from('turath_masr_customer_notes')
          .select('id, customer_phone, note, note_type, visibility, status, created_at')
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(2000)
          .then(
            (r: { data: NoteRow[] | null; error: unknown }) => r,
            (err: unknown) => ({ data: null as NoteRow[] | null, error: err })
          ),
        // Phase 24D — active tasks for the dashboard KPI cards + the
        // urgent/overdue panel. Capped at 2,000 so a noisy CRM team
        // doesn't blow up the page; the panel itself only renders the
        // top 10 ranked rows. `done` and `cancelled` rows are
        // intentionally pulled too so the urgent-active count remains
        // accurate even when the dispatcher just closed something.
        supabase
          .from('turath_masr_customer_tasks')
          .select(
            'id, customer_phone, customer_name, order_id, title, description, priority, status, due_at, assigned_to, assigned_to_name, created_by, created_by_name, created_at, updated_at'
          )
          .order('due_at', { ascending: true, nullsFirst: false })
          .limit(2000)
          .then(
            (r: { data: TaskRow[] | null; error: unknown }) => r,
            (err: unknown) => ({ data: null as TaskRow[] | null, error: err })
          ),
      ]);
      if (cancelled) return;

      if (custRes.error) {
        setErrorBanner('تعذر تحميل قائمة العملاء.');
      }
      setCustomers((custRes.data ?? []) as CustomerRow[]);
      setOrders((ordersRes.data ?? []) as OrderRow[]);
      setComplaints((complaintsRes.data ?? []) as ComplaintRow[]);
      setDelegateNotesCount((auditRes.data ?? []).length);
      setTasks((tasksRes.data ?? []) as TaskRow[]);

      const noteMap = new Map<string, NoteRow | null>();
      for (const n of (notesRes.data ?? []) as NoteRow[]) {
        const ph = normalisePhone(n.customer_phone);
        if (!ph) continue;
        if (!noteMap.has(ph)) noteMap.set(ph, n);
      }
      setLatestNotes(noteMap);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  const metricsByPhone = useMemo(
    () => computeMetricsByPhone(orders, complaints, [], []),
    [orders, complaints]
  );

  const rows = useMemo<DashboardCustomerRow[]>(
    () => buildDashboardRows(customers, metricsByPhone, latestNotes),
    [customers, metricsByPhone, latestNotes]
  );

  const kpis = useMemo(
    () =>
      computeDashboardKpis({
        customers,
        orders,
        complaints,
        delegateNotesCount,
      }),
    [customers, orders, complaints, delegateNotesCount]
  );

  // Phase 24B — duplicate-phone map (only phones shared by 2+ rows)
  // and the KPI count. Computed client-side over the loaded slice;
  // a future server-side RPC is flagged as a follow-up if the
  // customer base outgrows the 2,000-row cap.
  const duplicateGroups = useMemo(
    () => detectDuplicateGroups(customers, orders),
    [customers, orders]
  );
  const duplicatePhoneCount = useMemo(() => countDuplicatePhones(customers), [customers]);

  // Phase 24D — task buckets + top-10 ranked list. `rankTasks` only
  // surfaces active (open/in_progress) tasks; closed ones are
  // intentionally hidden from the urgent/overdue panel.
  const taskBuckets = useMemo(() => bucketTasks(tasks), [tasks]);
  const topTasks = useMemo(() => rankTasks(tasks).slice(0, 10), [tasks]);
  const [duplicatesOnly, setDuplicatesOnly] = useState(false);

  // Phase 24A-Fix1 — filter options now derive from `rows` (which
  // already carry the Fix1 derived classification + status) instead
  // of the raw customers table; that way the dropdown options match
  // the badges the user sees.
  const typeOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      if (r.type) s.add(r.type);
    }
    return Array.from(s).sort();
  }, [rows]);

  const statusOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      if (r.status) s.add(r.status);
    }
    return Array.from(s).sort();
  }, [rows]);

  const filteredRows = useMemo(() => {
    // Phase 24A-Fix1 — accept both "1001" and "C-1001" in the search
    // box. The stored code is numeric-only after Fix1 but legacy
    // muscle memory might still type the prefix.
    // Phase 24B — also accept any reasonable phone shape (Arabic
    // digits, +20…, 002…, 100… without leading 0). We compare the
    // row's phone twice: as-typed and via the normaliser.
    const rawQ = search.trim().toLowerCase();
    const q = rawQ.replace(/^c-/, '');
    const qDigits = q ? normalisePhone(q) : null;
    return rows.filter((r) => {
      if (typeFilter !== 'all' && (r.type || '') !== typeFilter) return false;
      if (statusFilter !== 'all' && (r.status || '') !== statusFilter) return false;
      if (duplicatesOnly && !duplicateGroups.has(r.phone)) return false;
      if (!q) return true;
      const rowPhoneNorm = normalisePhone(r.phone) || '';
      return (
        r.name.toLowerCase().includes(q) ||
        r.phone.toLowerCase().includes(q) ||
        rowPhoneNorm.includes(q) ||
        (qDigits != null && rowPhoneNorm.includes(qDigits)) ||
        (r.email || '').toLowerCase().includes(q) ||
        r.customerCode.toLowerCase().includes(q)
      );
    });
  }, [rows, search, typeFilter, statusFilter, duplicatesOnly, duplicateGroups]);

  const total = filteredRows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const paged = useMemo(
    () => filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filteredRows, safePage, pageSize]
  );

  useEffect(() => {
    // Reset to first page whenever filters / size change so the user
    // doesn't land on an empty page.
    setPage(1);
  }, [search, typeFilter, statusFilter, pageSize]);

  const handleExport = () => {
    if (!canExport) return;
    downloadCsv(customersCsvFilename(), customersToCsv(filteredRows));
  };

  return (
    <AppLayout currentPath="/customers">
      <div className="space-y-6 fade-in" dir="rtl">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">منصة العملاء</h1>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
              لوحة التحكم الرئيسية لقسم خدمة العملاء وعلاقات العملاء.
            </p>
          </div>
          <div className="flex-1 max-w-md">
            <div className="relative">
              <Search
                size={16}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]"
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ابحث عن عميل، طلب، أو ملاحظة..."
                className="input-field pr-9 w-full"
              />
            </div>
          </div>
        </div>

        {errorBanner && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800 flex items-center gap-2">
            <AlertCircle size={14} /> {errorBanner}
          </div>
        )}

        {/* KPI grid — primary row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <DashboardKpiCard
            icon={<Users size={22} />}
            label="إجمالي العملاء"
            value={kpis.totalCustomers.toLocaleString('en-US')}
            tone="violet"
          />
          <DashboardKpiCard
            icon={<UserIcon size={22} />}
            label="العملاء النشطون"
            value={kpis.activeCustomers.toLocaleString('en-US')}
            tone="blue"
          />
          <DashboardKpiCard
            icon={<Truck size={22} />}
            label="الطلبات الجارية"
            value={kpis.inFlightOrders.toLocaleString('en-US')}
            tone="emerald"
          />
          <DashboardKpiCard
            icon={<AlertCircle size={22} />}
            label="الشكاوى المفتوحة"
            value={kpis.openComplaints.toLocaleString('en-US')}
            tone="amber"
          />
        </div>
        {/* KPI grid — secondary row (rates + delegate-notes + Phase 24B
            duplicate counter) */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <DashboardKpiCard
            icon={<CheckCircle size={22} />}
            label="نسبة استلام العميل"
            value={fmtRate(kpis.receiptRate)}
            tone="emerald"
          />
          <DashboardKpiCard
            icon={<RotateCcw size={22} />}
            label="المرتجعات"
            value={fmtMoney(kpis.returnedAmount)}
            tone="amber"
          />
          <DashboardKpiCard
            icon={<XCircle size={22} />}
            label="الإلغاء"
            value={fmtMoney(kpis.cancelledAmount)}
            tone="red"
          />
          <DashboardKpiCard
            icon={<Megaphone size={22} />}
            label="ملاحظات المناديب"
            value={kpis.delegateNotesCount.toLocaleString('en-US')}
            tone="slate"
          />
          {/* Phase 24B — duplicates KPI. Same shape as the others; the
              count is the number of NORMALISED phones that appear on
              more than one customer row. */}
          <DashboardKpiCard
            icon={<CopyIcon size={22} />}
            label="عملاء مكررين"
            value={duplicatePhoneCount.toLocaleString('en-US')}
            tone="amber"
          />
        </div>

        {/* Phase 24D — tasks KPI row. Three cards (today / overdue /
            open) sit alongside the duplicates KPI in the secondary
            section. We render them as their own row so the primary
            customer KPIs stay visually prominent above the fold. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <DashboardKpiCard
            icon={<Clock size={22} />}
            label="مهام اليوم"
            value={taskBuckets.todayCount.toLocaleString('en-US')}
            tone="amber"
          />
          <DashboardKpiCard
            icon={<AlertTriangle size={22} />}
            label="مهام متأخرة"
            value={taskBuckets.overdueCount.toLocaleString('en-US')}
            tone="red"
          />
          <DashboardKpiCard
            icon={<ClipboardCheck size={22} />}
            label="مهام مفتوحة"
            value={taskBuckets.openCount.toLocaleString('en-US')}
            tone="blue"
          />
          <DashboardKpiCard
            icon={<Flame size={22} />}
            label="مهام عاجلة"
            value={taskBuckets.urgentActiveCount.toLocaleString('en-US')}
            tone="red"
          />
        </div>

        {/* Phase 24D — urgent / overdue tasks panel. Renders only when
            there's at least one row to surface so the dashboard
            doesn't show an empty card on a quiet day. Each row links
            straight to the customer profile's tasks tab. */}
        {topTasks.length > 0 && <UrgentTasksPanel tasks={topTasks} />}

        {/* Phase 24B — warning banner. Surfaced only when at least
            one duplicate group exists. Clicking "عرض المكررين" sets
            the "duplicates only" filter so the table narrows in one
            click. */}
        {duplicatePhoneCount > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex flex-wrap items-center gap-3 justify-between">
            <p className="text-sm text-amber-800 flex items-center gap-2">
              <AlertTriangle size={16} />
              يوجد {duplicatePhoneCount.toLocaleString('en-US')} رقم هاتف مكرر يحتاج مراجعة.
            </p>
            <button
              type="button"
              onClick={() => setDuplicatesOnly((v) => !v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                duplicatesOnly
                  ? 'bg-amber-700 text-white hover:bg-amber-800'
                  : 'bg-white text-amber-800 border border-amber-300 hover:bg-amber-100'
              }`}
            >
              {duplicatesOnly ? 'عرض الكل' : 'عرض المكررين فقط'}
            </button>
          </div>
        )}

        {/* Customer list section */}
        <div className="bg-white rounded-2xl border border-[hsl(var(--border))] overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-[hsl(var(--border))]">
            <div>
              <h2 className="text-base font-bold text-[hsl(var(--foreground))]">قائمة العملاء</h2>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                إجمالي {total.toLocaleString('en-US')} عميل
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {canCreate && (
                <button
                  type="button"
                  onClick={() => setAddOpen(true)}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[hsl(var(--primary))] text-white text-xs font-semibold hover:opacity-90"
                >
                  <Plus size={14} /> عميل جديد
                </button>
              )}
              {canExport && (
                <button
                  type="button"
                  onClick={handleExport}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[hsl(var(--muted))]/40 hover:bg-[hsl(var(--muted))] text-[hsl(var(--foreground))] border border-[hsl(var(--border))] text-xs font-semibold"
                >
                  <Download size={14} /> تصدير
                </button>
              )}
              <button
                type="button"
                onClick={() => setFiltersOpen((o) => !o)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold transition-colors ${
                  filtersOpen
                    ? 'bg-[hsl(var(--primary))]/10 border-[hsl(var(--primary))]/30 text-[hsl(var(--primary))]'
                    : 'bg-[hsl(var(--muted))]/40 border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]'
                }`}
              >
                <Filter size={14} /> تصفية
              </button>
            </div>
          </div>

          {filtersOpen && (
            <div className="flex flex-wrap items-end gap-3 px-5 py-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/10">
              <div>
                <label className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))] block mb-1">
                  نوع العميل
                </label>
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="input-field"
                >
                  <option value="all">الكل</option>
                  {typeOptions.map((t) => (
                    <option key={t} value={t}>
                      {customerTypeLabel(t)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))] block mb-1">
                  حالة الحساب
                </label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="input-field"
                >
                  <option value="all">الكل</option>
                  {statusOptions.map((s) => (
                    <option key={s} value={s}>
                      {customerStatusLabel(s)}
                    </option>
                  ))}
                </select>
              </div>
              {/* Phase 24B — duplicates filter pill. Keeps the panel
                  symmetric with the existing select pickers and stays
                  in sync with the banner button above. */}
              <div>
                <label className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))] block mb-1">
                  أرقام مكررة
                </label>
                <button
                  type="button"
                  onClick={() => setDuplicatesOnly((v) => !v)}
                  className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
                    duplicatesOnly
                      ? 'bg-amber-50 border-amber-300 text-amber-800'
                      : 'bg-white border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]/40'
                  }`}
                  aria-pressed={duplicatesOnly}
                >
                  <CopyIcon size={12} />
                  {duplicatesOnly ? 'إظهار المكررين فقط' : 'فلترة'}
                </button>
              </div>
              {(typeFilter !== 'all' || statusFilter !== 'all' || duplicatesOnly) && (
                <button
                  type="button"
                  onClick={() => {
                    setTypeFilter('all');
                    setStatusFilter('all');
                    setDuplicatesOnly(false);
                  }}
                  className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                >
                  مسح التصفية
                </button>
              )}
            </div>
          )}

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[hsl(var(--muted))]/30 text-[hsl(var(--muted-foreground))]">
                <tr>
                  <th className="px-3 py-3 text-right font-semibold whitespace-nowrap">
                    اسم العميل
                  </th>
                  <th className="px-3 py-3 text-right font-semibold whitespace-nowrap">
                    رقم العميل
                  </th>
                  <th className="px-3 py-3 text-right font-semibold whitespace-nowrap">الهاتف</th>
                  <th className="px-3 py-3 text-center font-semibold whitespace-nowrap">
                    نوع العميل
                  </th>
                  <th className="px-3 py-3 text-center font-semibold whitespace-nowrap">
                    إجمالي المشتريات
                  </th>
                  <th className="px-3 py-3 text-center font-semibold whitespace-nowrap">
                    نسبة الاستلام
                  </th>
                  <th className="px-3 py-3 text-center font-semibold whitespace-nowrap">
                    المرتجعات
                  </th>
                  <th className="px-3 py-3 text-center font-semibold whitespace-nowrap">الإلغاء</th>
                  <th className="px-3 py-3 text-center font-semibold whitespace-nowrap">
                    حالة الحساب
                  </th>
                  <th className="px-3 py-3 text-right font-semibold whitespace-nowrap">
                    مسؤول الحساب
                  </th>
                  <th className="px-3 py-3 text-right font-semibold whitespace-nowrap">
                    آخر ملاحظة مندوب
                  </th>
                  <th className="px-3 py-3 text-center font-semibold whitespace-nowrap">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td
                      colSpan={12}
                      className="text-center text-[hsl(var(--muted-foreground))] py-10"
                    >
                      جارٍ التحميل…
                    </td>
                  </tr>
                ) : paged.length === 0 ? (
                  <tr>
                    <td
                      colSpan={12}
                      className="text-center text-[hsl(var(--muted-foreground))] py-12"
                    >
                      لا يوجد عملاء مطابقين.
                    </td>
                  </tr>
                ) : (
                  paged.map((row) => (
                    <CustomerListRow
                      key={row.key}
                      row={row}
                      duplicateGroup={duplicateGroups.get(row.phone) || null}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t border-[hsl(var(--border))]">
            <div className="text-[11px] text-[hsl(var(--muted-foreground))]">
              عرض {paged.length} من أصل {total.toLocaleString('en-US')} عميل
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-[hsl(var(--muted-foreground))]">عرض</span>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value) as PageSize)}
                  className="input-field text-xs"
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage(1)}
                  disabled={safePage <= 1}
                  className="p-1.5 rounded-lg hover:bg-[hsl(var(--muted))]/40 disabled:opacity-40"
                  aria-label="أول صفحة"
                >
                  <ChevronsRight size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  className="p-1.5 rounded-lg hover:bg-[hsl(var(--muted))]/40 disabled:opacity-40"
                  aria-label="الصفحة السابقة"
                >
                  <ChevronRight size={14} />
                </button>
                <span className="text-[11px] px-2 font-semibold">
                  {safePage} / {pageCount}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  disabled={safePage >= pageCount}
                  className="p-1.5 rounded-lg hover:bg-[hsl(var(--muted))]/40 disabled:opacity-40"
                  aria-label="الصفحة التالية"
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => setPage(pageCount)}
                  disabled={safePage >= pageCount}
                  className="p-1.5 rounded-lg hover:bg-[hsl(var(--muted))]/40 disabled:opacity-40"
                  aria-label="آخر صفحة"
                >
                  <ChevronsLeft size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {addOpen && (
        <NewCustomerModal
          existingPhones={
            // Phase 24B — build the set ON OPEN so the modal blocks
            // duplicates before the network round-trip. Map values are
            // the customer-route keys so the "فتح ملف العميل" button
            // can navigate straight to the existing profile.
            new Map(
              customers
                .map((c) => {
                  const n = normalisePhone(c.phone);
                  return n ? ([n, customerKeyFromPhone(n) || n] as [string, string]) : null;
                })
                .filter((x): x is [string, string] => x !== null)
            )
          }
          onClose={() => setAddOpen(false)}
          onCreated={() => {
            setAddOpen(false);
            setReloadTick((n) => n + 1);
          }}
        />
      )}
    </AppLayout>
  );
}

// ─── Row component ───────────────────────────────────────────────────────

function CustomerListRow({
  row,
  duplicateGroup,
}: {
  row: DashboardCustomerRow;
  duplicateGroup: DuplicateGroup | null;
}) {
  const key = customerKeyFromPhone(row.phone) || row.phone;
  const wa = buildWhatsAppHref(row.phone);
  const tel = buildTelHref(row.phone);
  // Phase 24B — duplicate context for the tooltip. "مرتبط بـ N سجلات"
  // counts both other customer rows that share the phone AND order
  // rows that point at the same normalised number.
  const linkedRecords = duplicateGroup
    ? duplicateGroup.customers.length + duplicateGroup.orderCount
    : 0;
  return (
    <tr className="border-t border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/15">
      <td className="px-3 py-3 font-semibold text-[hsl(var(--foreground))] whitespace-nowrap">
        <Link
          href={`/customers/${key}`}
          className="hover:text-[hsl(var(--primary))] hover:underline"
        >
          {row.name}
        </Link>
      </td>
      <td className="px-3 py-3 font-mono text-[hsl(var(--muted-foreground))] whitespace-nowrap">
        {row.customerCode}
      </td>
      <td className="px-3 py-3 font-mono whitespace-nowrap" dir="ltr">
        <span className="inline-flex items-center gap-1.5">
          <span>{row.phone || '—'}</span>
          {duplicateGroup && (
            <span
              className="inline-flex items-center gap-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200 text-[9px] font-semibold px-1.5 py-0.5"
              title={`مرتبط بـ ${linkedRecords} سجلات`}
              dir="rtl"
            >
              <CopyIcon size={9} /> مكرر
            </span>
          )}
        </span>
      </td>
      <td className="px-3 py-3 text-center whitespace-nowrap">
        {row.type ? (
          <span
            className={`inline-flex rounded-full border text-[10px] font-semibold px-2 py-0.5 ${customerTypeTone(row.type)}`}
          >
            {customerTypeLabel(row.type)}
          </span>
        ) : (
          '—'
        )}
      </td>
      <td className="px-3 py-3 text-center num whitespace-nowrap">{fmtMoney(row.totalSpent)}</td>
      <td className="px-3 py-3 text-center whitespace-nowrap">
        <span
          className={`inline-flex rounded-full border text-[10px] font-semibold px-2 py-0.5 ${
            row.receiptRate == null
              ? 'bg-[hsl(var(--muted))]/40 text-[hsl(var(--muted-foreground))] border-[hsl(var(--border))]'
              : row.receiptRate >= 0.9
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : row.receiptRate >= 0.7
                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                  : 'bg-red-50 text-red-700 border-red-200'
          }`}
        >
          {fmtRate(row.receiptRate, '—')}
        </span>
      </td>
      <td className="px-3 py-3 text-center num whitespace-nowrap text-amber-700">
        {fmtMoney(row.returnedAmount)}
      </td>
      <td className="px-3 py-3 text-center num whitespace-nowrap text-red-700">
        {fmtMoney(row.cancelledAmount)}
      </td>
      <td className="px-3 py-3 text-center whitespace-nowrap">
        <span
          className={`inline-flex rounded-full border text-[10px] font-semibold px-2 py-0.5 ${customerStatusTone(row.status)}`}
        >
          {customerStatusLabel(row.status)}
        </span>
      </td>
      <td className="px-3 py-3 whitespace-nowrap text-[hsl(var(--muted-foreground))]">
        {row.accountManagerName || '—'}
      </td>
      <td
        className="px-3 py-3 max-w-[220px] truncate text-[hsl(var(--muted-foreground))]"
        title={row.lastNote ?? ''}
      >
        {row.lastNote || '—'}
      </td>
      <td className="px-3 py-3 text-center whitespace-nowrap">
        <div className="flex items-center justify-center gap-1">
          <Link
            href={`/customers/${key}`}
            className="p-1.5 rounded-lg bg-[hsl(var(--muted))]/40 hover:bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]"
            title="عرض الملف"
          >
            <Eye size={13} />
          </Link>
          {wa && (
            <a
              href={wa}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700"
              title="واتساب"
            >
              <MessageCircle size={13} />
            </a>
          )}
          {tel && (
            <a
              href={tel}
              className="p-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700"
              title="اتصال"
            >
              <PhoneIcon size={13} />
            </a>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── New customer modal ──────────────────────────────────────────────────

function NewCustomerModal({
  onClose,
  onCreated,
  existingPhones,
}: {
  onClose: () => void;
  onCreated: () => void;
  /** Phase 24B — normalised phone → customer-route key map of all
   *  loaded customers. Drives the in-modal duplicate guard so the
   *  user gets a clear Arabic message + a one-click jump to the
   *  existing profile, BEFORE the network insert. */
  existingPhones: Map<string, string>;
}) {
  const [form, setForm] = useState({
    full_name: '',
    phone: '',
    email: '',
    city: '',
    customer_type: '',
    customer_status: 'active',
    account_manager_name: '',
    notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Phase 24B — when the typed phone matches an existing customer we
  // surface a "فتح ملف العميل" button that routes straight to the
  // existing profile (instead of just blocking the submit).
  const [duplicateKey, setDuplicateKey] = useState<string | null>(null);

  // Live duplicate detection while typing — runs on every change so
  // the user sees the warning before they hit Submit.
  useEffect(() => {
    const np = normalisePhone(form.phone);
    if (!np) {
      setDuplicateKey(null);
      return;
    }
    setDuplicateKey(existingPhones.get(np) ?? null);
  }, [form.phone, existingPhones]);

  const update = (k: keyof typeof form, v: string) => {
    setForm((p) => ({ ...p, [k]: v }));
    if (error) setError(null);
  };

  const handleSubmit = async () => {
    if (submitting) return;
    const phone = normalisePhone(form.phone);
    if (!phone) {
      setError('رقم الهاتف غير صحيح.');
      return;
    }
    // Phase 24B — Egypt mobile validator. Strict 11-digit pattern
    // (`01[0125]XXXXXXXX`). Catches landlines, foreign numbers, and
    // typos that survive normalisation.
    if (!isLikelyEgyptMobile(phone)) {
      setError('الرقم لا يطابق صيغة الموبايل المصري (11 رقم تبدأ بـ 010 / 011 / 012 / 015).');
      return;
    }
    // Phase 24B — client-side duplicate guard. The dashboard set is
    // built off the loaded customers slice; this catches the common
    // case where the same number is re-entered for a different name.
    if (existingPhones.has(phone)) {
      setError('هذا الرقم مسجل بالفعل لعميل آخر.');
      setDuplicateKey(existingPhones.get(phone) ?? null);
      return;
    }
    if (!form.full_name.trim()) {
      setError('اسم العميل مطلوب.');
      return;
    }
    setSubmitting(true);
    try {
      const supabase = createClient();
      const { error: insertErr } = await supabase.from('turath_masr_customers').insert({
        phone,
        full_name: form.full_name.trim(),
        email: form.email.trim() || null,
        city: form.city.trim() || null,
        customer_type: form.customer_type.trim() || null,
        customer_status: form.customer_status.trim() || null,
        account_manager_name: form.account_manager_name.trim() || null,
        notes: form.notes.trim() || null,
      });
      if (insertErr) {
        const code = (insertErr as { code?: string }).code || '';
        if (code === '23505') setError('يوجد عميل آخر بنفس رقم الهاتف.');
        else if (code === '42501') setError('لا تملك صلاحية إضافة عميل.');
        else setError('تعذر إضافة العميل. حاول لاحقًا.');
        setSubmitting(false);
        return;
      }
      onCreated();
    } catch {
      setError('تعذر الاتصال بالخادم.');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center p-0 sm:p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div className="relative bg-white w-full sm:max-w-lg sm:rounded-2xl flex flex-col shadow-2xl max-h-[95vh] overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 bg-[hsl(var(--primary))] sm:rounded-t-2xl">
          <Plus size={18} className="text-white" />
          <h2 className="flex-1 text-white font-bold">عميل جديد</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-white/20 rounded-lg"
            aria-label="إغلاق"
          >
            <X size={16} className="text-white" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}
          {/* Phase 24B — duplicate-phone notice surfaces as the user
              types. Renders even without a hard error so the user can
              jump to the existing profile in one click. */}
          {duplicateKey && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <AlertTriangle size={14} /> هذا الرقم مسجل بالفعل لعميل آخر.
              </span>
              <Link
                href={`/customers/${duplicateKey}`}
                className="px-2 py-1 rounded-lg bg-white border border-amber-300 hover:bg-amber-100 font-bold"
              >
                فتح ملف العميل
              </Link>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="اسم العميل *">
              <input
                value={form.full_name}
                onChange={(e) => update('full_name', e.target.value)}
                className="input-field"
                disabled={submitting}
              />
            </Field>
            <Field label="رقم الهاتف *">
              <input
                value={form.phone}
                onChange={(e) => update('phone', e.target.value)}
                dir="ltr"
                placeholder="01XXXXXXXXX"
                className="input-field"
                disabled={submitting}
              />
            </Field>
            <Field label="البريد الإلكتروني">
              <input
                type="email"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                dir="ltr"
                className="input-field"
                disabled={submitting}
              />
            </Field>
            <Field label="المدينة">
              <input
                value={form.city}
                onChange={(e) => update('city', e.target.value)}
                className="input-field"
                disabled={submitting}
              />
            </Field>
            <Field label="نوع العميل">
              <select
                value={form.customer_type}
                onChange={(e) => update('customer_type', e.target.value)}
                className="input-field"
                disabled={submitting}
              >
                <option value="">— غير محدد —</option>
                <option value="retail">تاجر تجزئة</option>
                <option value="wholesale">تاجر جملة</option>
                <option value="business">عميل تجاري</option>
                <option value="individual">فرد</option>
              </select>
            </Field>
            <Field label="حالة الحساب">
              <select
                value={form.customer_status}
                onChange={(e) => update('customer_status', e.target.value)}
                className="input-field"
                disabled={submitting}
              >
                <option value="active">نشط</option>
                <option value="inactive">غير نشط</option>
                <option value="vip">مميز</option>
                <option value="warning">تحذير</option>
              </select>
            </Field>
            <Field label="مسؤول الحساب">
              <input
                value={form.account_manager_name}
                onChange={(e) => update('account_manager_name', e.target.value)}
                className="input-field"
                disabled={submitting}
              />
            </Field>
          </div>
          <Field label="ملاحظات">
            <textarea
              value={form.notes}
              onChange={(e) => update('notes', e.target.value)}
              rows={2}
              className="input-field resize-none"
              disabled={submitting}
            />
          </Field>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold bg-white border border-[hsl(var(--border))] rounded-xl"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-[hsl(var(--primary))] text-white rounded-xl disabled:opacity-50"
          >
            <Plus size={12} /> {submitting ? 'جارٍ الحفظ…' : 'إضافة'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))] block mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

// ─── Phase 24D — Urgent / overdue tasks dashboard panel ──────────────────
//
// Renders the top 10 ranked active tasks (urgent + overdue first, then
// due-today, then by priority + earliest due_at). Clicking a row jumps
// to the customer profile's tasks tab.

function UrgentTasksPanel({ tasks }: { tasks: TaskRow[] }) {
  return (
    <div className="bg-white rounded-2xl border border-[hsl(var(--border))] overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-[hsl(var(--border))]">
        <div className="flex items-center gap-2">
          <Flame size={16} className="text-red-600" />
          <h2 className="text-sm font-bold text-[hsl(var(--foreground))]">
            المهام العاجلة والمتأخرة
          </h2>
        </div>
        <span className="text-[11px] text-[hsl(var(--muted-foreground))]">{tasks.length} مهمة</span>
      </div>
      <ul className="divide-y divide-[hsl(var(--border))]">
        {tasks.map((t) => {
          const d = deriveTaskFlags(t);
          const tone = TASK_PRIORITY_TONE[t.priority] || '';
          const key = customerKeyFromPhone(t.customer_phone) || t.customer_phone;
          return (
            <li
              key={t.id}
              className="px-5 py-3 flex flex-wrap items-center justify-between gap-3 hover:bg-[hsl(var(--muted))]/15"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="text-sm font-bold text-[hsl(var(--foreground))]">{t.title}</span>
                  <span
                    className={`inline-flex rounded-full border text-[10px] font-semibold px-2 py-0.5 ${tone}`}
                  >
                    {TASK_PRIORITY_LABEL_AR[t.priority] || t.priority}
                  </span>
                  {d.isOverdue && (
                    <span className="inline-flex rounded-full border bg-red-50 text-red-700 border-red-200 text-[10px] font-bold px-2 py-0.5">
                      متأخرة
                    </span>
                  )}
                  {d.isDueToday && !d.isOverdue && (
                    <span className="inline-flex rounded-full border bg-amber-50 text-amber-700 border-amber-200 text-[10px] font-bold px-2 py-0.5">
                      اليوم
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-[hsl(var(--muted-foreground))]">
                  <span>العميل: {t.customer_name || t.customer_phone}</span>
                  {t.due_at && <span>الاستحقاق: {fmtDateYmd(t.due_at)}</span>}
                  {t.assigned_to_name && <span>المسؤول: {t.assigned_to_name}</span>}
                </div>
              </div>
              <Link
                href={`/customers/${key}`}
                className="px-2 py-1 rounded-lg bg-[hsl(var(--primary))]/10 hover:bg-[hsl(var(--primary))]/20 text-[hsl(var(--primary))] text-[10px] font-bold"
              >
                فتح الملف
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
