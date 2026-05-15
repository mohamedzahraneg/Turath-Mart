// ─────────────────────────────────────────────────────────────────────────────
// GET /api/orders/operations-summary?from=<iso>&to=<iso>&preset=<token>
//
// Phase Orders-Page-Redesign-1 — single aggregate endpoint that feeds
// the new orders-management dashboard:
//
//   • KPI cards with a real comparison delta vs the previous
//     equivalent period (today→yesterday, week→previous week, etc.).
//   • Status distribution rows (count + percentage per status).
//   • Recent activity feed (latest audit-log entries within range)
//     with humanized Arabic labels — no raw `status_change` keys.
//   • "Needs action" counts + a small preview list of the top 5
//     matching orders per item so the dashboard can show details
//     inline without round-tripping back to the table.
//
// Fix2 additions
//   – `compareRange` field in the response so the UI can render
//     "X% عن أمس / عن الفترة السابقة".
//   – `kpis.*DeltaPercent` numeric fields. When the previous period
//     was zero we return `null` (UI shows "جديد" or "بدون تغيير"
//     instead of inventing ∞%).
//   – `recentActivity[i].label` is now a fully humanized Arabic
//     phrase (e.g. "تم تغيير حالة الطلب إلى جاري الشحن").
//   – `needsAction[i].previewOrders` carries up to 5 sample rows.
//
// Privacy / authorisation
//   – SSR Supabase client built from request cookies. No service-
//     role bypass. RLS gates every read.
//
// What this route is NOT
//   – Not a replacement for the main paginated orders table query.
//   – No image / base64 / token in the response.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildOrderProductsSummary } from '@/lib/orders/orderProductsSummary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function buildSupabaseClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value, options } of cookiesToSet) {
            try {
              cookieStore.set(name, value, options);
            } catch {
              /* route handlers can't always mutate cookies — ignore */
            }
          }
        },
      },
    }
  ) as unknown as SupabaseClient;
}

// ─── Status taxonomy ────────────────────────────────────────────────
const STATUS_LABELS: Record<string, string> = {
  new: 'جديد',
  preparing: 'في المعالجة',
  warehouse: 'في انتظار الشحن',
  shipping: 'جاري الشحن',
  delivered: 'تم التسليم',
  cancelled: 'ملغي',
  returned: 'مرتجع',
};

const KNOWN_STATUSES = Object.keys(STATUS_LABELS);

// ─── Range helpers ─────────────────────────────────────────────────

interface RangeSpec {
  from: string | null;
  to: string | null;
  preset: string | null;
}

function readRange(url: URL): RangeSpec {
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const preset = url.searchParams.get('preset');
  return {
    from: from && /^\d{4}-\d{2}-\d{2}/.test(from) ? from : null,
    to: to && /^\d{4}-\d{2}-\d{2}/.test(to) ? to : null,
    preset: preset ? preset.slice(0, 32) : null,
  };
}

function applyDateRange<
  T extends { gte: (col: string, v: string) => T; lt: (col: string, v: string) => T },
>(q: T, range: RangeSpec, column: string = 'created_at'): T {
  let out: T = q;
  if (range.from) out = out.gte(column, `${range.from}T00:00:00Z`);
  if (range.to) {
    const next = nextDay(range.to);
    out = out.lt(column, `${next}T00:00:00Z`);
  }
  return out;
}

function nextDay(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split('-').map((x) => Number(x));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return formatYmd(dt);
}

function shiftDays(yyyyMmDd: string, days: number): string {
  const [y, m, d] = yyyyMmDd.split('-').map((x) => Number(x));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return formatYmd(dt);
}

function formatYmd(dt: Date): string {
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function daysBetween(fromYmd: string, toYmd: string): number {
  const a = new Date(`${fromYmd}T00:00:00Z`).getTime();
  const b = new Date(`${toYmd}T00:00:00Z`).getTime();
  return Math.round((b - a) / (24 * 60 * 60 * 1000)) + 1;
}

/**
 * Compute the comparison range for the dashboard delta.
 * Strategy: same-length window immediately preceding the current
 * range. Works uniformly for today / yesterday / this_week /
 * custom. For `this_month` / `previous_month` it still picks the
 * same number of days back — close enough for "vs الشهر السابق"
 * intent without over-engineering calendar-month diffs.
 */
function computeCompareRange(range: RangeSpec): RangeSpec | null {
  if (!range.from || !range.to) return null;
  const days = daysBetween(range.from, range.to);
  if (!Number.isFinite(days) || days <= 0) return null;
  const prevTo = shiftDays(range.from, -1);
  const prevFrom = shiftDays(prevTo, -(days - 1));
  return { from: prevFrom, to: prevTo, preset: 'previous' };
}

// ─── KPI queries ────────────────────────────────────────────────────

async function countStatuses(
  supabase: SupabaseClient,
  range: RangeSpec
): Promise<Record<string, number>> {
  const baseQuery = supabase
    .from('turath_masr_orders')
    .select('status', { count: 'exact' })
    .limit(5000);
  const { data, error } = await applyDateRange(baseQuery, range);
  if (error) {
    console.warn('[operations-summary] status fetch failed:', error);
    return {};
  }
  const out: Record<string, number> = {};
  for (const row of (data as Array<{ status: string }> | null) ?? []) {
    const key = (row.status ?? '').trim() || 'unknown';
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

async function sumTotalCollection(
  supabase: SupabaseClient,
  range: RangeSpec
): Promise<{ expectedTotal: number; deliveredTotal: number }> {
  const expectedReq = applyDateRange(
    supabase.from('turath_masr_orders').select('total').limit(5000),
    range
  );
  const deliveredReq = applyDateRange(
    supabase.from('turath_masr_orders').select('total').eq('status', 'delivered').limit(5000),
    range
  );
  const [{ data: expectedRows, error: expectedErr }, { data: deliveredRows, error: deliveredErr }] =
    await Promise.all([expectedReq, deliveredReq]);
  if (expectedErr) console.warn('[operations-summary] expected sum failed:', expectedErr);
  if (deliveredErr) console.warn('[operations-summary] delivered sum failed:', deliveredErr);
  const sum = (rows: Array<{ total: number | null }> | null | undefined): number => {
    if (!Array.isArray(rows)) return 0;
    let s = 0;
    for (const r of rows) s += Number(r.total) || 0;
    return s;
  };
  return {
    expectedTotal: sum(expectedRows as Array<{ total: number | null }> | null),
    deliveredTotal: sum(deliveredRows as Array<{ total: number | null }> | null),
  };
}

async function countAdjustments(
  supabase: SupabaseClient,
  range: RangeSpec
): Promise<{ total: number; pending: number }> {
  const totalReq = applyDateRange(
    supabase.from('turath_masr_order_adjustments').select('id', { count: 'exact', head: true }),
    range
  );
  const pendingReq = applyDateRange(
    supabase
      .from('turath_masr_order_adjustments')
      .select('id', { count: 'exact', head: true })
      .eq('state', 'pending'),
    range
  );
  const [{ count: total, error: totalErr }, { count: pending, error: pendingErr }] =
    await Promise.all([totalReq, pendingReq]);
  if (totalErr) console.warn('[operations-summary] adjustments total failed:', totalErr);
  if (pendingErr) console.warn('[operations-summary] adjustments pending failed:', pendingErr);
  return { total: total ?? 0, pending: pending ?? 0 };
}

interface KpiBundle {
  ordersCount: number;
  expectedTotal: number;
  deliveredTotal: number;
  waitingShipping: number;
  inShipping: number;
  delivered: number;
  adjustmentsCount: number;
  pendingAdjustments: number;
}

async function loadKpiBundle(supabase: SupabaseClient, range: RangeSpec): Promise<KpiBundle> {
  const [statusCounts, sums, adjCounts] = await Promise.all([
    countStatuses(supabase, range),
    sumTotalCollection(supabase, range),
    countAdjustments(supabase, range),
  ]);
  const ordersCount = Object.values(statusCounts).reduce((s, n) => s + n, 0);
  return {
    ordersCount,
    expectedTotal: sums.expectedTotal,
    deliveredTotal: sums.deliveredTotal,
    waitingShipping: statusCounts['warehouse'] ?? 0,
    inShipping: statusCounts['shipping'] ?? 0,
    delivered: statusCounts['delivered'] ?? 0,
    adjustmentsCount: adjCounts.total,
    pendingAdjustments: adjCounts.pending,
  };
}

/**
 * Convert a (current, previous) pair into a delta percent. Returns
 * `null` when previous is 0 so the UI can render "جديد"/"بدون تغيير"
 * instead of an ∞ — see Spec §B.
 */
function deltaPercent(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return null;
  const pct = ((current - previous) / previous) * 100;
  if (!Number.isFinite(pct)) return null;
  return +pct.toFixed(1);
}

// ─── Recent activity ───────────────────────────────────────────────

const ACTION_LABELS_AR: Record<string, string> = {
  status_change: 'تم تغيير حالة الطلب',
  order_created: 'تم إنشاء طلب جديد',
  order_edited: 'تم تعديل الطلب',
  'order.updated': 'تم تعديل الطلب',
  payment_updated: 'تم تحديث الدفع',
  delegate_assigned: 'تم تعيين مندوب',
  adjustment_created: 'تم إنشاء تسوية',
  'adjustment.created': 'تم إنشاء تسوية',
  adjustment_approved: 'تمت الموافقة على التسوية',
  'adjustment.approved': 'تمت الموافقة على التسوية',
  adjustment_rejected: 'تم رفض التسوية',
  'adjustment.rejected': 'تم رفض التسوية',
  adjustment_completed: 'تم تنفيذ التسوية',
  'adjustment.completed': 'تم تنفيذ التسوية',
  adjustment_cancelled: 'تم إلغاء التسوية',
  'adjustment.cancelled': 'تم إلغاء التسوية',
  'adjustment.child_order_created': 'تم إنشاء طلب شحن مرتبط',
};

function humanizeActivity(
  action: string,
  fieldChanged: string | null,
  newValue: string | null
): string {
  const base = ACTION_LABELS_AR[action];
  if (!base) return 'نشاط على الطلب';
  if (action === 'status_change' || fieldChanged === 'status') {
    const newLabel = newValue ? (STATUS_LABELS[newValue] ?? newValue) : null;
    return newLabel ? `${base} إلى ${newLabel}` : base;
  }
  if (action === 'order_edited' || action === 'order.updated') {
    return fieldChanged ? `${base} — ${fieldChanged}` : base;
  }
  return base;
}

async function fetchRecentActivity(
  supabase: SupabaseClient,
  range: RangeSpec
): Promise<
  Array<{
    id: string;
    action: string;
    label: string;
    order_num: string | null;
    customer_name: string | null;
    changed_by: string | null;
    created_at: string;
  }>
> {
  const req = applyDateRange(
    supabase
      .from('turath_masr_audit_logs')
      .select('id, action, field_changed, new_value, order_num, changed_by, created_at')
      .order('created_at', { ascending: false })
      .limit(8),
    range
  );
  const { data, error } = await req;
  if (error) {
    console.warn('[operations-summary] recent activity failed:', error);
    return [];
  }
  type Row = {
    id: string;
    action: string;
    field_changed: string | null;
    new_value: string | null;
    order_num: string | null;
    changed_by: string | null;
    created_at: string;
  };
  const rows = (data as Row[] | null) ?? [];

  // Best-effort customer lookup for the order numbers we just
  // fetched, in one round-trip. Lets the dashboard render
  // "تم إنشاء طلب جديد #2605123 من أحمد محمد" without an N+1.
  const orderNums = Array.from(
    new Set(rows.map((r) => r.order_num).filter((n): n is string => Boolean(n)))
  );
  let customerByOrderNum = new Map<string, string>();
  if (orderNums.length > 0) {
    try {
      const { data: customers } = await supabase
        .from('turath_masr_orders')
        .select('order_num, customer')
        .in('order_num', orderNums)
        .limit(orderNums.length);
      customerByOrderNum = new Map(
        ((customers as Array<{ order_num: string; customer: string | null }> | null) ?? []).map(
          (c) => [c.order_num, c.customer ?? '']
        )
      );
    } catch (err) {
      console.warn('[operations-summary] customer lookup skipped:', err);
    }
  }

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    label: humanizeActivity(row.action, row.field_changed, row.new_value),
    order_num: row.order_num,
    customer_name: row.order_num ? (customerByOrderNum.get(row.order_num) ?? null) : null,
    changed_by: row.changed_by,
    created_at: row.created_at,
  }));
}

// ─── Needs action with preview rows ────────────────────────────────

interface PreviewOrder {
  order_num: string;
  customer_name: string;
  products_summary: string;
  status: string;
  status_label: string;
  total: number;
  created_at: string;
}

interface NeedsActionItem {
  key: string;
  label: string;
  count: number;
  description: string;
  filter: Record<string, string> | null;
  previewOrders: PreviewOrder[];
}

type RawPreviewRow = {
  order_num: string;
  customer: string | null;
  status: string;
  total: number | null;
  created_at: string;
  lines: unknown;
  products: string | null;
};

function toPreviewOrder(row: RawPreviewRow): PreviewOrder {
  const lines = Array.isArray(row.lines)
    ? (row.lines as Array<{
        label?: string | null;
        productType?: string | null;
        color?: string | null;
        quantity?: number | null;
      }>)
    : [];
  return {
    order_num: row.order_num,
    customer_name: row.customer ?? '',
    products_summary: buildOrderProductsSummary(lines, row.products ?? null, { maxItems: 2 }),
    status: row.status,
    status_label: STATUS_LABELS[row.status] ?? row.status,
    total: Number(row.total) || 0,
    created_at: row.created_at,
  };
}

async function fetchNeedsAction(
  supabase: SupabaseClient,
  range: RangeSpec
): Promise<NeedsActionItem[]> {
  const NOW = new Date();
  const fiveDaysAgo = new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const PREVIEW_COLS = 'order_num, customer, status, total, created_at, lines, products';

  // Each request returns the count AND up to 5 newest matching rows
  // in a single round-trip via `{ count: 'exact' }` + `.limit(5)`.
  const withoutDelegateReq = applyDateRange(
    supabase
      .from('turath_masr_orders')
      .select(PREVIEW_COLS, { count: 'exact' })
      .or('delegate_name.is.null,delegate_name.eq.')
      .in('status', ['new', 'preparing', 'warehouse'])
      .order('created_at', { ascending: false })
      .limit(5),
    range
  );
  const awaitingScheduleReq = applyDateRange(
    supabase
      .from('turath_masr_orders')
      .select(PREVIEW_COLS, { count: 'exact' })
      .is('scheduled_delivery_date', null)
      .eq('status', 'warehouse')
      .order('created_at', { ascending: false })
      .limit(5),
    range
  );
  // Pending adjustments are rows in `turath_masr_order_adjustments`;
  // we surface their parent order numbers via the `order_num` column
  // on the adjustment row itself.
  const pendingAdjReq = applyDateRange(
    supabase
      .from('turath_masr_order_adjustments')
      .select('id, order_num, kind, state, created_at', { count: 'exact' })
      .eq('state', 'pending')
      .order('created_at', { ascending: false })
      .limit(5),
    range
  );
  const partialPayReq = applyDateRange(
    supabase
      .from('turath_masr_orders')
      .select(PREVIEW_COLS, { count: 'exact' })
      .ilike('notes', '%"status":"partial"%')
      .order('created_at', { ascending: false })
      .limit(5),
    range
  );
  const delayedReq = supabase
    .from('turath_masr_orders')
    .select(PREVIEW_COLS, { count: 'exact' })
    .eq('status', 'shipping')
    .lt('created_at', `${fiveDaysAgo}T00:00:00Z`)
    .order('created_at', { ascending: false })
    .limit(5);

  const [withoutDelegate, awaitingSchedule, pendingAdj, partialPay, delayed] = await Promise.all([
    withoutDelegateReq,
    awaitingScheduleReq,
    pendingAdjReq,
    partialPayReq,
    delayedReq,
  ]);

  // Adjustments item needs a second lookup to hydrate the parent
  // order details. Best-effort: if the parent rows can't be read,
  // we just surface order_num + placeholder label.
  const adjRows =
    (pendingAdj.data as Array<{ order_num: string; kind: string; created_at: string }> | null) ??
    [];
  let adjustmentPreview: PreviewOrder[] = [];
  if (adjRows.length > 0) {
    const parentOrderNums = adjRows.map((r) => r.order_num);
    try {
      const { data: parents } = await supabase
        .from('turath_masr_orders')
        .select(PREVIEW_COLS)
        .in('order_num', parentOrderNums);
      const byNum = new Map<string, RawPreviewRow>(
        ((parents as RawPreviewRow[] | null) ?? []).map((p) => [p.order_num, p])
      );
      adjustmentPreview = adjRows
        .map((r) => byNum.get(r.order_num))
        .filter((p): p is RawPreviewRow => Boolean(p))
        .map(toPreviewOrder);
    } catch (err) {
      console.warn('[operations-summary] adjustment preview parents skipped:', err);
    }
  }

  const items: NeedsActionItem[] = [
    {
      key: 'no_delegate',
      label: 'طلبات بدون مندوب',
      count: withoutDelegate.count ?? 0,
      description: 'لم يتم تعيين مندوب بعد',
      filter: { delegate: 'unassigned' },
      previewOrders: ((withoutDelegate.data as RawPreviewRow[] | null) ?? []).map(toPreviewOrder),
    },
    {
      key: 'awaiting_schedule',
      label: 'في انتظار جدولة الشحن',
      count: awaitingSchedule.count ?? 0,
      description: 'لم يتم تحديد موعد الشحن',
      filter: { status: 'warehouse' },
      previewOrders: ((awaitingSchedule.data as RawPreviewRow[] | null) ?? []).map(toPreviewOrder),
    },
    {
      key: 'pending_adjustments',
      label: 'مرتجعات / استبدالات معلقة',
      count: pendingAdj.count ?? 0,
      description: 'تحتاج إلى معالجة',
      filter: { adjustment: 'pending' },
      previewOrders: adjustmentPreview,
    },
    {
      key: 'partial_payments',
      label: 'دفعات جزئية',
      count: partialPay.count ?? 0,
      description: 'لم يتم سداد المبلغ بالكامل',
      filter: { payment: 'partial' },
      previewOrders: ((partialPay.data as RawPreviewRow[] | null) ?? []).map(toPreviewOrder),
    },
    {
      key: 'delivery_delay',
      label: 'تأخير في التسليم',
      count: delayed.count ?? 0,
      description: 'تجاوزت تاريخ التسليم المتوقع',
      filter: { status: 'shipping', delay: 'over_5d' },
      previewOrders: ((delayed.data as RawPreviewRow[] | null) ?? []).map(toPreviewOrder),
    },
  ];
  return items;
}

// ─── Route handler ─────────────────────────────────────────────────

export async function GET(request: Request) {
  const url = new URL(request.url);
  const range = readRange(url);
  const compareRange = computeCompareRange(range);
  const supabase = await buildSupabaseClient();

  try {
    const [statusCounts, currentKpis, previousKpis, recentActivity, needsAction] =
      await Promise.all([
        countStatuses(supabase, range),
        loadKpiBundle(supabase, range),
        compareRange
          ? loadKpiBundle(supabase, compareRange)
          : Promise.resolve<KpiBundle>({
              ordersCount: 0,
              expectedTotal: 0,
              deliveredTotal: 0,
              waitingShipping: 0,
              inShipping: 0,
              delivered: 0,
              adjustmentsCount: 0,
              pendingAdjustments: 0,
            }),
        fetchRecentActivity(supabase, range),
        fetchNeedsAction(supabase, range),
      ]);

    const ordersCount = currentKpis.ordersCount;

    const statusDistribution = KNOWN_STATUSES.map((status) => {
      const count = statusCounts[status] ?? 0;
      return {
        status,
        label: STATUS_LABELS[status] ?? status,
        count,
        percentage: ordersCount > 0 ? +((count / ordersCount) * 100).toFixed(1) : 0,
      };
    });
    for (const [key, count] of Object.entries(statusCounts)) {
      if (!KNOWN_STATUSES.includes(key)) {
        statusDistribution.push({
          status: key,
          label: key,
          count,
          percentage: ordersCount > 0 ? +((count / ordersCount) * 100).toFixed(1) : 0,
        });
      }
    }

    const collectionTotal =
      currentKpis.deliveredTotal > 0 ? currentKpis.deliveredTotal : currentKpis.expectedTotal;
    const previousCollectionTotal =
      previousKpis.deliveredTotal > 0 ? previousKpis.deliveredTotal : previousKpis.expectedTotal;

    return NextResponse.json(
      {
        range,
        compareRange,
        kpis: {
          ordersCount: currentKpis.ordersCount,
          ordersDeltaPercent: deltaPercent(currentKpis.ordersCount, previousKpis.ordersCount),
          waitingShipping: currentKpis.waitingShipping,
          waitingDeltaPercent: deltaPercent(
            currentKpis.waitingShipping,
            previousKpis.waitingShipping
          ),
          inShipping: currentKpis.inShipping,
          inShippingDeltaPercent: deltaPercent(currentKpis.inShipping, previousKpis.inShipping),
          delivered: currentKpis.delivered,
          deliveredDeltaPercent: deltaPercent(currentKpis.delivered, previousKpis.delivered),
          expectedTotal: currentKpis.expectedTotal,
          deliveredTotal: currentKpis.deliveredTotal,
          collectionTotal,
          collectionDeltaPercent: deltaPercent(collectionTotal, previousCollectionTotal),
          adjustmentsCount: currentKpis.adjustmentsCount,
          adjustmentsDeltaPercent: deltaPercent(
            currentKpis.adjustmentsCount,
            previousKpis.adjustmentsCount
          ),
          pendingAdjustments: currentKpis.pendingAdjustments,
        },
        statusDistribution,
        recentActivity,
        needsAction,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'private, max-age=30, stale-while-revalidate=60',
        },
      }
    );
  } catch (err) {
    console.error('[operations-summary] failure:', err);
    return NextResponse.json({ error: 'fetch_failed' }, { status: 500 });
  }
}
