// ─────────────────────────────────────────────────────────────────────────────
// GET /api/orders/operations-summary?from=<iso>&to=<iso>&preset=<token>
//
// Phase Orders-Page-Redesign-1 — single aggregate endpoint that feeds
// the new orders-management dashboard:
//
//   • KPI cards (orders count, waiting/in-shipping/delivered, returns
//     count, expected collection total).
//   • Status distribution rows (count + percentage per status).
//   • Recent activity feed (latest audit-log entries within range).
//   • "Needs action" counts (orders without delegate, awaiting
//     scheduling, pending adjustments, partial payments, delivery
//     delays).
//
// Why a single route instead of N client-side queries:
//   – Six independent counts × every smart-filter click would burn
//     egress and round-trips. One route runs them in parallel and
//     returns ~1 KB of JSON.
//   – Server-side fan-out also lets us share a single supabase
//     client (auth cookies + RLS) so each query enforces the same
//     row-visibility rules as the rest of the app.
//
// Privacy / authorisation
//   – SSR Supabase client built from the request's cookies. No
//     service-role bypass. RLS does the gating, exactly as a direct
//     client-side query would.
//   – Anonymous requests get the same RLS-empty rows the direct
//     queries would return; we never 401 to keep the error surface
//     small.
//
// What this route is NOT
//   – Not a replacement for the main paginated orders table query.
//     The table continues to fetch its own page-of-25 (or whatever
//     `perPage` is set to) from `turath_masr_orders` so we don't
//     duplicate the heavier read here.
//   – No image / base64 / token in the response.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

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
// Mirrors the status labels used by `OrdersTableSection`'s STATUS_MAP
// so the dashboard reads the same Arabic labels the table renders.
// Keep this in sync if the table's set ever grows.
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

/** Apply optional from/to filters on `created_at`. The caller can
 *  also pass a column override (e.g. `decided_at` for adjustment
 *  rows). */
function applyDateRange<
  T extends { gte: (col: string, v: string) => T; lt: (col: string, v: string) => T },
>(q: T, range: RangeSpec, column: string = 'created_at'): T {
  let out: T = q;
  if (range.from) out = out.gte(column, `${range.from}T00:00:00Z`);
  if (range.to) {
    // `to` is inclusive — push to the next day at 00:00 UTC so the
    // bound is exclusive on the SQL side.
    const next = nextDay(range.to);
    out = out.lt(column, `${next}T00:00:00Z`);
  }
  return out;
}

function nextDay(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split('-').map((x) => Number(x));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// ─── KPI / status queries ───────────────────────────────────────────

async function countStatuses(
  supabase: SupabaseClient,
  range: RangeSpec
): Promise<Record<string, number>> {
  // Single round-trip: project just `status`, range-filtered, capped
  // to 5,000 rows so a runaway range query can't OOM the route. Each
  // row is a few bytes; this is still cheaper than five `count: exact`
  // calls in parallel because Supabase aggregates them client-side
  // here.
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
  // Use two scoped reads: one for the expected sum across the range,
  // one restricted to `status = 'delivered'` so the dashboard can
  // surface "collected so far" alongside "expected".
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

async function fetchRecentActivity(
  supabase: SupabaseClient,
  range: RangeSpec
): Promise<
  Array<{
    id: string;
    action: string;
    label: string;
    order_num: string | null;
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
  return (
    (data as Array<{
      id: string;
      action: string;
      field_changed: string | null;
      new_value: string | null;
      order_num: string | null;
      changed_by: string | null;
      created_at: string;
    }> | null) ?? []
  ).map((row) => ({
    id: row.id,
    action: row.action,
    label:
      row.action === 'adjustment_created'
        ? 'تم إنشاء تسوية'
        : row.action === 'order_edited'
          ? `تم تعديل الطلب — ${row.field_changed ?? ''}`.trim()
          : row.action.startsWith('adjustment_')
            ? row.action.replace('adjustment_', 'تسوية — ')
            : row.field_changed
              ? `${row.field_changed}: ${row.new_value ?? ''}`.trim()
              : row.action,
    order_num: row.order_num,
    changed_by: row.changed_by,
    created_at: row.created_at,
  }));
}

interface NeedsActionItem {
  key: string;
  label: string;
  count: number;
  description: string;
  filter: Record<string, string> | null;
}

async function fetchNeedsAction(
  supabase: SupabaseClient,
  range: RangeSpec
): Promise<NeedsActionItem[]> {
  const NOW = new Date();
  const fiveDaysAgo = new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // All five queries fire in parallel.
  const withoutDelegateReq = applyDateRange(
    supabase
      .from('turath_masr_orders')
      .select('id', { count: 'exact', head: true })
      .or('delegate_name.is.null,delegate_name.eq.')
      .in('status', ['new', 'preparing', 'warehouse']),
    range
  );
  const awaitingScheduleReq = applyDateRange(
    supabase
      .from('turath_masr_orders')
      .select('id', { count: 'exact', head: true })
      .is('scheduled_delivery_date', null)
      .eq('status', 'warehouse'),
    range
  );
  const pendingAdjReq = applyDateRange(
    supabase
      .from('turath_masr_order_adjustments')
      .select('id', { count: 'exact', head: true })
      .eq('state', 'pending'),
    range
  );
  // Partial payments: the V2 envelope stores `"status":"partial"` in
  // the notes JSON marker. ILIKE is a fast tsearch path that doesn't
  // need a function index.
  const partialPayReq = applyDateRange(
    supabase
      .from('turath_masr_orders')
      .select('id', { count: 'exact', head: true })
      .ilike('notes', '%"status":"partial"%'),
    range
  );
  // Shipping orders older than 5 days are very likely delayed.
  const delayedReq = supabase
    .from('turath_masr_orders')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'shipping')
    .lt('created_at', `${fiveDaysAgo}T00:00:00Z`);

  const [withoutDelegate, awaitingSchedule, pendingAdj, partialPay, delayed] = await Promise.all([
    withoutDelegateReq,
    awaitingScheduleReq,
    pendingAdjReq,
    partialPayReq,
    delayedReq,
  ]);

  const out: NeedsActionItem[] = [
    {
      key: 'no_delegate',
      label: 'طلبات بدون مندوب',
      count: withoutDelegate.count ?? 0,
      description: 'لم يتم تعيين مندوب بعد',
      filter: { delegate: 'unassigned' },
    },
    {
      key: 'awaiting_schedule',
      label: 'في انتظار جدولة الشحن',
      count: awaitingSchedule.count ?? 0,
      description: 'لم يتم تحديد موعد الشحن',
      filter: { status: 'warehouse' },
    },
    {
      key: 'pending_adjustments',
      label: 'مرتجعات / استبدالات معلقة',
      count: pendingAdj.count ?? 0,
      description: 'تحتاج إلى معالجة',
      filter: { adjustment: 'pending' },
    },
    {
      key: 'partial_payments',
      label: 'دفعات جزئية',
      count: partialPay.count ?? 0,
      description: 'لم يتم سداد المبلغ بالكامل',
      filter: { payment: 'partial' },
    },
    {
      key: 'delivery_delay',
      label: 'تأخير في التسليم',
      count: delayed.count ?? 0,
      description: 'تجاوزت تاريخ التسليم المتوقع',
      filter: { status: 'shipping', delay: 'over_5d' },
    },
  ];
  return out;
}

// ─── Route handler ─────────────────────────────────────────────────

export async function GET(request: Request) {
  const url = new URL(request.url);
  const range = readRange(url);
  const supabase = await buildSupabaseClient();

  try {
    const [statusCounts, sums, adjCounts, recentActivity, needsAction] = await Promise.all([
      countStatuses(supabase, range),
      sumTotalCollection(supabase, range),
      countAdjustments(supabase, range),
      fetchRecentActivity(supabase, range),
      fetchNeedsAction(supabase, range),
    ]);

    const ordersCount = Object.values(statusCounts).reduce((s, n) => s + n, 0);
    const waitingShipping = statusCounts['warehouse'] ?? 0;
    const inShipping = statusCounts['shipping'] ?? 0;
    const delivered = statusCounts['delivered'] ?? 0;

    const statusDistribution = KNOWN_STATUSES.map((status) => {
      const count = statusCounts[status] ?? 0;
      return {
        status,
        label: STATUS_LABELS[status] ?? status,
        count,
        percentage: ordersCount > 0 ? +((count / ordersCount) * 100).toFixed(1) : 0,
      };
    });

    // Surface unknown statuses (anything outside the canonical set) so
    // the donut doesn't lose rows when a new status sneaks in.
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

    return NextResponse.json(
      {
        range,
        kpis: {
          ordersCount,
          expectedTotal: sums.expectedTotal,
          deliveredTotal: sums.deliveredTotal,
          waitingShipping,
          inShipping,
          delivered,
          adjustmentsCount: adjCounts.total,
          pendingAdjustments: adjCounts.pending,
        },
        statusDistribution,
        recentActivity,
        needsAction,
      },
      {
        status: 200,
        headers: {
          // Per-user (RLS-gated); no shared caching. Short cache so
          // repeated dashboard renders within the same minute reuse
          // the response, but a fresh smart-filter click always
          // re-fetches via cache-busting URL params.
          'Cache-Control': 'private, max-age=30, stale-while-revalidate=60',
        },
      }
    );
  } catch (err) {
    console.error('[operations-summary] failure:', err);
    return NextResponse.json({ error: 'fetch_failed' }, { status: 500 });
  }
}
