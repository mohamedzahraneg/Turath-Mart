// ─────────────────────────────────────────────────────────────────────────────
// src/lib/delegates/aggregateReports.ts
//
// Phase 23L — pure helpers for the "تقارير المناديب" aggregate report
// rendered as a modal off the /delegates page. Sister module to
// `accountStatement.ts` (Phase 23D — per-delegate statement). This one
// works at the FLEET level: it ingests the same row slices the page
// already aggregates per-delegate, narrows them to a date range, and
// emits:
//
//   • a per-delegate `AggregateRow` (one row per profile that has any
//     activity OR is `delegate_is_active = true`)
//   • a summary block of fleet-wide totals
//   • five "أعلى مندوب …" rankings ready for the ranking cards
//   • a CSV serialisation in the exact Arabic-header shape the spec
//     calls out
//
// Performance posture
// -------------------
//   • Pure module — no React, no Supabase, no DOM. Imports two helpers
//     from accountStatement.ts (`isInRange`, `RANGE_PRESETS`-related)
//     so the date semantics stay aligned with the per-delegate flow.
//   • All loops are O(rows) — single pass per source slice. No
//     repeated `.filter()` chains; we walk each slice once and bucket
//     into a per-delegate accumulator keyed by `assigned_to` (preferred)
//     or `delegate_name` (legacy fallback).
//   • Custody totals are NOT date-filtered — open custody is a current-
//     state metric regardless of the report window. The summary block
//     and CSV both label it as "حاليًا" so the reader knows.
//
// Sensitive-field posture
// -----------------------
// No `national_id`, license numbers, document paths, signed URLs, or
// auth data ever enter `AggregateRow`. The CSV serialisation re-checks
// this by only emitting whitelisted fields. The caller is responsible
// for handing in the slim shapes — passing a row with extra fields
// won't accidentally leak them because we only read the typed columns
// declared on the input interfaces below.
// ─────────────────────────────────────────────────────────────────────────────

import { isInRange } from './accountStatement';

// ─── Source-shape interfaces ─────────────────────────────────────────────
//
// Slim, hand-rolled shapes that mirror just the columns the report
// reads from. Same posture as accountStatement.ts: we don't pull
// the page's rich row types so a future move of this module to a
// server-side reporter doesn't drag React/Supabase types along.

export interface ReportDelegateInput {
  /** Stable identifier used for grouping. Prefer the profile UUID;
   *  legacy `delegate_name`-only rows use the synthetic key
   *  `legacy:<name>` the page already mints. */
  key: string;
  /** Display name. Always non-empty. */
  name: string;
  /** Profile id if the delegate exists in `profiles`; null for
   *  legacy-name rows. Used to match orders/settlements/expenses
   *  by `assigned_to` / `delegate_profile_id`. */
  profileId: string | null;
  /** `delegate_is_active` from profiles. null = legacy row. */
  isActive: boolean | null;
}

export interface ReportOrderInput {
  id: string;
  order_num: string | null;
  total: number | null;
  status: string;
  /** `assigned_to` is the new preferred match; null on legacy rows. */
  assigned_to: string | null;
  /** Legacy free-text delegate name from before the FK existed. */
  delegate_name: string | null;
  created_at: string | null;
}

export interface ReportSettlementInput {
  id: string;
  delegate_profile_id: string | null;
  delegate_name: string | null;
  amount: number | null;
  status: string | null;
  settled_at: string | null;
}

export interface ReportExpenseInput {
  id: string;
  delegate_profile_id: string | null;
  delegate_name: string | null;
  amount: number | null;
  /** Only `approved` rows count toward the financial total. Pending /
   *  rejected / voided are excluded from the credit side (consistent
   *  with the per-delegate statement). */
  status: string | null;
  expense_at: string | null;
}

export interface ReportCustodyInput {
  id: string;
  delegate_profile_id: string | null;
  delegate_name: string | null;
  status: string | null;
  estimated_value: number | null;
  handed_at: string | null;
}

export interface ReportRatingInput {
  id: string;
  assigned_to: string | null;
  delegate_name: string | null;
  rating: number | null;
  created_at: string | null;
}

// ─── Per-delegate aggregate row ─────────────────────────────────────────

export interface AggregateRow {
  key: string;
  name: string;
  profileId: string | null;
  isActive: boolean | null;

  /** Orders with status='delivered' assigned to this delegate, within
   *  the date range (matched on `created_at`). */
  delivered: number;
  /** Orders with status='returned' assigned to this delegate, within
   *  the date range. */
  returned: number;
  /** Sum of `total` over delivered orders in range. */
  collected: number;
  /** Sum of `amount` over active settlements (status='active' OR null;
   *  voided excluded) where `settled_at` is in range. */
  settled: number;
  /** Sum of `amount` over approved expenses (status='approved')
   *  where `expense_at` is in range. */
  expenses: number;
  /** collected − settled − expenses. Can be negative when a delegate
   *  has been over-settled in the window (uncommon but possible). */
  remaining: number;
  /** Current-state metric, NOT date-filtered. Sum of
   *  `estimated_value` over custody rows with `status='with_delegate'`. */
  openCustodyValue: number;
  /** Count of `with_delegate` custody rows, NOT date-filtered. */
  openCustodyCount: number;
  /** Mean of `rating` across ratings in range. null when no ratings. */
  averageRating: number | null;
  /** Count of ratings in range. */
  ratingCount: number;
}

// ─── Fleet-wide summary ──────────────────────────────────────────────────

export interface ReportSummary {
  fromIso: string;
  toIso: string;
  totalCollected: number;
  totalSettled: number;
  totalExpenses: number;
  totalRemaining: number;
  /** Sum of OPEN custody value across the whole fleet (not date-
   *  filtered — same posture as the per-delegate row). */
  totalOpenCustody: number;
  /** Count of OPEN custody rows. */
  totalOpenCustodyCount: number;
  /** Fleet-wide average of `AggregateRow.averageRating`, weighted by
   *  rating count. null when no rated delegates. */
  fleetAverageRating: number | null;
  /** Sum of delivered orders. */
  totalDelivered: number;
  /** Sum of returned orders. */
  totalReturned: number;
  /** Count of delegates that show ANY activity in the window
   *  (delivered + returned + collected + settled + expenses + ratings
   *  + open custody all combined > 0). Useful for the "لا توجد بيانات"
   *  fallback decision. */
  delegatesWithActivity: number;
}

// ─── Rankings ────────────────────────────────────────────────────────────

export interface RankingEntry {
  delegateKey: string;
  delegateName: string;
  value: number;
  /** Optional context string the card renders under the metric, e.g.
   *  for the top-collector card we surface the delivery count there. */
  context?: string;
}

export interface ReportRankings {
  topCollector: RankingEntry | null;
  topExpenses: RankingEntry | null;
  topRemaining: RankingEntry | null;
  bestRated: RankingEntry | null;
  worstRated: RankingEntry | null;
  topReturned: RankingEntry | null;
}

export interface DelegatesReport {
  summary: ReportSummary;
  rows: AggregateRow[];
  rankings: ReportRankings;
}

// ─── Matching helpers ────────────────────────────────────────────────────
//
// Order / settlement / expense / custody / rating rows match a
// delegate by `assigned_to` (or `delegate_profile_id`) when present,
// falling back to a name match against the legacy-name key the page
// derives for rows that pre-date the FK column. Trimmed-lowercase
// comparison so leading whitespace doesn't split buckets.

function matchKeyByProfileOrName(
  delegateByProfileId: Map<string, ReportDelegateInput>,
  delegateByName: Map<string, ReportDelegateInput>,
  profileId: string | null | undefined,
  legacyName: string | null | undefined
): string | null {
  if (profileId) {
    const hit = delegateByProfileId.get(profileId);
    if (hit) return hit.key;
  }
  if (legacyName) {
    const trimmed = legacyName.trim();
    if (trimmed) {
      const hit = delegateByName.get(trimmed);
      if (hit) return hit.key;
    }
  }
  return null;
}

function isSettlementActive(s: ReportSettlementInput): boolean {
  // Pre-Phase-23E rows have null status — treated as active. Anything
  // that's NOT exactly 'voided' contributes.
  return s.status !== 'voided';
}

function isExpenseApproved(e: ReportExpenseInput): boolean {
  return e.status === 'approved';
}

function isCustodyOpen(c: ReportCustodyInput): boolean {
  return c.status === 'with_delegate';
}

// ─── The aggregator ──────────────────────────────────────────────────────

/**
 * Compute a fleet-wide aggregate report.
 *
 * - `delegates`     — every delegate the page knows about (profile
 *                     rows + legacy-name rows). Drives the row list:
 *                     every delegate that the page renders gets a row,
 *                     even if all metrics are zero in the window.
 * - `orders`        — `turath_masr_orders` slim slice.
 * - `settlements`   — `turath_masr_delegate_settlements` slim slice.
 * - `expenses`      — `turath_masr_delegate_expenses` slim slice.
 * - `custody`       — `turath_masr_delegate_custody` slim slice.
 * - `ratings`       — `turath_masr_delegate_ratings` slim slice.
 * - `fromIso/toIso` — local-midnight inclusive window (see
 *                     accountStatement.ts for the semantics).
 *
 * Returns the full report (summary + rows + rankings) deterministically
 * — same input ⇒ same output, no Date.now() / random.
 */
export function computeDelegatesReport(input: {
  delegates: ReadonlyArray<ReportDelegateInput>;
  orders: ReadonlyArray<ReportOrderInput>;
  settlements: ReadonlyArray<ReportSettlementInput>;
  expenses: ReadonlyArray<ReportExpenseInput>;
  custody: ReadonlyArray<ReportCustodyInput>;
  ratings: ReadonlyArray<ReportRatingInput>;
  fromIso: string;
  toIso: string;
}): DelegatesReport {
  const { delegates, orders, settlements, expenses, custody, ratings, fromIso, toIso } = input;

  // ── Lookup maps (O(N) build, O(1) lookup) ────────────────────────────
  const byProfileId = new Map<string, ReportDelegateInput>();
  const byName = new Map<string, ReportDelegateInput>();
  for (const d of delegates) {
    if (d.profileId) byProfileId.set(d.profileId, d);
    const n = d.name.trim();
    if (n) byName.set(n, d);
  }

  // ── Per-delegate accumulator ─────────────────────────────────────────
  // Initialise a row for every delegate (even zero-activity), keyed by
  // the page's stable `key` field so legacy and profile rows both fit.
  const acc = new Map<string, AggregateRow>();
  const ratingSumByKey = new Map<string, { sum: number; count: number }>();
  for (const d of delegates) {
    acc.set(d.key, {
      key: d.key,
      name: d.name,
      profileId: d.profileId,
      isActive: d.isActive,
      delivered: 0,
      returned: 0,
      collected: 0,
      settled: 0,
      expenses: 0,
      remaining: 0,
      openCustodyValue: 0,
      openCustodyCount: 0,
      averageRating: null,
      ratingCount: 0,
    });
    ratingSumByKey.set(d.key, { sum: 0, count: 0 });
  }

  // ── Orders: delivered + returned + collected (date-filtered) ──────────
  for (const o of orders) {
    if (!isInRange(o.created_at, fromIso, toIso)) continue;
    const key = matchKeyByProfileOrName(byProfileId, byName, o.assigned_to, o.delegate_name);
    if (!key) continue;
    const row = acc.get(key);
    if (!row) continue;
    if (o.status === 'delivered') {
      row.delivered += 1;
      row.collected += Number(o.total ?? 0);
    } else if (o.status === 'returned') {
      row.returned += 1;
    }
  }

  // ── Settlements: active rows in range ─────────────────────────────────
  for (const s of settlements) {
    if (!isSettlementActive(s)) continue;
    if (!isInRange(s.settled_at, fromIso, toIso)) continue;
    const key = matchKeyByProfileOrName(
      byProfileId,
      byName,
      s.delegate_profile_id,
      s.delegate_name
    );
    if (!key) continue;
    const row = acc.get(key);
    if (!row) continue;
    row.settled += Number(s.amount ?? 0);
  }

  // ── Expenses: approved rows in range ──────────────────────────────────
  for (const e of expenses) {
    if (!isExpenseApproved(e)) continue;
    if (!isInRange(e.expense_at, fromIso, toIso)) continue;
    const key = matchKeyByProfileOrName(
      byProfileId,
      byName,
      e.delegate_profile_id,
      e.delegate_name
    );
    if (!key) continue;
    const row = acc.get(key);
    if (!row) continue;
    row.expenses += Number(e.amount ?? 0);
  }

  // ── Custody: open rows, NOT date-filtered ─────────────────────────────
  // Spec is explicit on this: "Custody is current/open state, not
  // necessarily date-range financial movement." We label it as
  // "حاليًا" in the UI.
  for (const c of custody) {
    if (!isCustodyOpen(c)) continue;
    const key = matchKeyByProfileOrName(
      byProfileId,
      byName,
      c.delegate_profile_id,
      c.delegate_name
    );
    if (!key) continue;
    const row = acc.get(key);
    if (!row) continue;
    row.openCustodyValue += Number(c.estimated_value ?? 0);
    row.openCustodyCount += 1;
  }

  // ── Ratings: in-range only (created_at) ───────────────────────────────
  for (const r of ratings) {
    if (!isInRange(r.created_at, fromIso, toIso)) continue;
    const key = matchKeyByProfileOrName(byProfileId, byName, r.assigned_to, r.delegate_name);
    if (!key) continue;
    const row = acc.get(key);
    if (!row) continue;
    const v = Number(r.rating);
    if (!Number.isFinite(v)) continue;
    const bucket = ratingSumByKey.get(key);
    if (!bucket) continue;
    bucket.sum += v;
    bucket.count += 1;
    row.ratingCount = bucket.count;
  }

  // ── Compute remaining + averageRating for each row ────────────────────
  for (const row of acc.values()) {
    row.remaining = row.collected - row.settled - row.expenses;
    const bucket = ratingSumByKey.get(row.key);
    if (bucket && bucket.count > 0) {
      row.averageRating = bucket.sum / bucket.count;
    }
  }

  const rows = Array.from(acc.values()).sort((a, b) => a.name.localeCompare(b.name, 'ar'));

  // ── Fleet summary ─────────────────────────────────────────────────────
  let totalCollected = 0;
  let totalSettled = 0;
  let totalExpenses = 0;
  let totalRemaining = 0;
  let totalOpenCustody = 0;
  let totalOpenCustodyCount = 0;
  let totalDelivered = 0;
  let totalReturned = 0;
  let ratingWeightedSum = 0;
  let ratingTotalCount = 0;
  let delegatesWithActivity = 0;
  for (const row of rows) {
    totalCollected += row.collected;
    totalSettled += row.settled;
    totalExpenses += row.expenses;
    totalRemaining += row.remaining;
    totalOpenCustody += row.openCustodyValue;
    totalOpenCustodyCount += row.openCustodyCount;
    totalDelivered += row.delivered;
    totalReturned += row.returned;
    if (row.averageRating != null && row.ratingCount > 0) {
      ratingWeightedSum += row.averageRating * row.ratingCount;
      ratingTotalCount += row.ratingCount;
    }
    const hasActivity =
      row.delivered > 0 ||
      row.returned > 0 ||
      row.collected !== 0 ||
      row.settled !== 0 ||
      row.expenses !== 0 ||
      row.openCustodyValue !== 0 ||
      row.openCustodyCount > 0 ||
      row.ratingCount > 0;
    if (hasActivity) delegatesWithActivity += 1;
  }

  const summary: ReportSummary = {
    fromIso,
    toIso,
    totalCollected,
    totalSettled,
    totalExpenses,
    totalRemaining,
    totalOpenCustody,
    totalOpenCustodyCount,
    fleetAverageRating: ratingTotalCount > 0 ? ratingWeightedSum / ratingTotalCount : null,
    totalDelivered,
    totalReturned,
    delegatesWithActivity,
  };

  // ── Rankings ──────────────────────────────────────────────────────────
  // Each ranking picks the single row that maximises the metric.
  // null when no row has a positive metric value (so the card can
  // render "لا توجد بيانات" rather than the lowest-zero row).

  function topBy(
    selector: (r: AggregateRow) => number,
    context: (r: AggregateRow) => string | undefined,
    requirePositive = true
  ): RankingEntry | null {
    let best: AggregateRow | null = null;
    let bestValue = -Infinity;
    for (const row of rows) {
      const v = selector(row);
      if (requirePositive && v <= 0) continue;
      if (v > bestValue) {
        bestValue = v;
        best = row;
      }
    }
    if (!best) return null;
    return {
      delegateKey: best.key,
      delegateName: best.name,
      value: bestValue,
      context: context(best),
    };
  }

  function bestRating(): RankingEntry | null {
    let best: AggregateRow | null = null;
    for (const row of rows) {
      if (row.averageRating == null || row.ratingCount === 0) continue;
      if (
        best == null ||
        (row.averageRating ?? 0) > (best.averageRating ?? 0) ||
        // Tie-break on rating count (more raters = more trusted)
        ((row.averageRating ?? 0) === (best.averageRating ?? 0) &&
          row.ratingCount > best.ratingCount)
      ) {
        best = row;
      }
    }
    if (!best) return null;
    return {
      delegateKey: best.key,
      delegateName: best.name,
      value: best.averageRating ?? 0,
      context: `${best.ratingCount} تقييم`,
    };
  }

  function worstRating(): RankingEntry | null {
    let worst: AggregateRow | null = null;
    for (const row of rows) {
      if (row.averageRating == null || row.ratingCount === 0) continue;
      if (
        worst == null ||
        (row.averageRating ?? 0) < (worst.averageRating ?? 0) ||
        ((row.averageRating ?? 0) === (worst.averageRating ?? 0) &&
          row.ratingCount > worst.ratingCount)
      ) {
        worst = row;
      }
    }
    if (!worst) return null;
    return {
      delegateKey: worst.key,
      delegateName: worst.name,
      value: worst.averageRating ?? 0,
      context: `${worst.ratingCount} تقييم`,
    };
  }

  const rankings: ReportRankings = {
    topCollector: topBy(
      (r) => r.collected,
      (r) => `${r.delivered} طلب مسلم`
    ),
    topExpenses: topBy(
      (r) => r.expenses,
      (r) => `${r.delivered} طلب مسلم`
    ),
    topRemaining: topBy(
      (r) => r.remaining,
      (r) => `${r.delivered} طلب مسلم`
    ),
    bestRated: bestRating(),
    worstRated: worstRating(),
    topReturned: topBy(
      (r) => r.returned,
      (r) => `${r.delivered} مسلم`
    ),
  };

  return { summary, rows, rankings };
}

// ─── Sorting helpers for the comparison table ────────────────────────────

export type AggregateSortField =
  | 'name'
  | 'delivered'
  | 'returned'
  | 'collected'
  | 'settled'
  | 'expenses'
  | 'remaining'
  | 'openCustodyValue'
  | 'averageRating';

export type SortDirection = 'asc' | 'desc';

/** Stable sort: equal keys preserve the original alphabetical order
 *  the report returns rows in. Numeric fields treat null/NaN as 0.
 *  averageRating uses null as "no data" — pushed to the bottom of
 *  whichever direction the user picked so empty rows don't dominate
 *  the top of a "best rating" sort. */
export function sortAggregateRows(
  rows: ReadonlyArray<AggregateRow>,
  field: AggregateSortField,
  direction: SortDirection
): AggregateRow[] {
  const copy = rows.slice();
  copy.sort((a, b) => {
    if (field === 'name') {
      const cmp = a.name.localeCompare(b.name, 'ar');
      return direction === 'asc' ? cmp : -cmp;
    }
    if (field === 'averageRating') {
      const av = a.averageRating;
      const bv = b.averageRating;
      // Push nulls to the end regardless of direction.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return direction === 'asc' ? av - bv : bv - av;
    }
    const av = (a[field] as number) ?? 0;
    const bv = (b[field] as number) ?? 0;
    return direction === 'asc' ? av - bv : bv - av;
  });
  return copy;
}

// ─── CSV serialisation ───────────────────────────────────────────────────

function csvField(raw: string | number | null | undefined): string {
  if (raw == null) return '';
  const s = typeof raw === 'string' ? raw : String(raw);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function fmtNumberCsv(n: number): string {
  // Integers (counts) come out without decimals; money rows are
  // already rounded to cents at the source so two decimals are safe.
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}

function fmtRating(r: number | null): string {
  if (r == null) return '';
  return r.toFixed(2);
}

function activeLabel(isActive: boolean | null): string {
  if (isActive === true) return 'نشط';
  if (isActive === false) return 'غير نشط';
  return '—';
}

/** Builds the report CSV body. The shape mirrors the spec exactly:
 *
 *  Preamble (4 metadata rows + 1 blank separator), then the table:
 *    المندوب, الحالة, الطلبات المسلمة, المرتجعات, التحصيل, التوريد,
 *    المصاريف, المتبقي, الأمانات المفتوحة, عدد الأمانات,
 *    متوسط التقييم, عدد التقييمات
 *
 *  Sensitive fields (national_id, license numbers, document paths,
 *  storage URLs, auth) are never emitted because the source typed
 *  inputs above don't carry them — the typing is the gate.
 */
export function aggregateReportToCsv(report: DelegatesReport): string {
  const { summary, rows } = report;
  const lines: string[] = [];

  lines.push(`تقرير المناديب المجمع`);
  lines.push(`الفترة من,${csvField(summary.fromIso)},إلى,${csvField(summary.toIso)}`);
  lines.push(
    `إجمالي التحصيلات,${csvField(fmtNumberCsv(summary.totalCollected))},` +
      `إجمالي التوريدات,${csvField(fmtNumberCsv(summary.totalSettled))},` +
      `إجمالي المصاريف,${csvField(fmtNumberCsv(summary.totalExpenses))},` +
      `إجمالي المتبقي,${csvField(fmtNumberCsv(summary.totalRemaining))}`
  );
  lines.push(
    `إجمالي الأمانات المفتوحة,${csvField(fmtNumberCsv(summary.totalOpenCustody))},` +
      `عدد الأمانات المفتوحة,${csvField(fmtNumberCsv(summary.totalOpenCustodyCount))},` +
      `متوسط تقييم المناديب,${csvField(fmtRating(summary.fleetAverageRating))}`
  );
  lines.push(''); // blank separator

  lines.push(
    [
      'المندوب',
      'الحالة',
      'الطلبات المسلمة',
      'المرتجعات',
      'التحصيل',
      'التوريد',
      'المصاريف',
      'المتبقي',
      'الأمانات المفتوحة',
      'عدد الأمانات',
      'متوسط التقييم',
      'عدد التقييمات',
    ].join(',')
  );

  for (const r of rows) {
    lines.push(
      [
        csvField(r.name),
        csvField(activeLabel(r.isActive)),
        csvField(fmtNumberCsv(r.delivered)),
        csvField(fmtNumberCsv(r.returned)),
        csvField(fmtNumberCsv(r.collected)),
        csvField(fmtNumberCsv(r.settled)),
        csvField(fmtNumberCsv(r.expenses)),
        csvField(fmtNumberCsv(r.remaining)),
        csvField(fmtNumberCsv(r.openCustodyValue)),
        csvField(fmtNumberCsv(r.openCustodyCount)),
        csvField(fmtRating(r.averageRating)),
        csvField(fmtNumberCsv(r.ratingCount)),
      ].join(',')
    );
  }

  return lines.join('\r\n');
}

/** Filename pattern: `delegates-report-<from>-<to>.csv` (spec). */
export function aggregateCsvFilename(fromIso: string, toIso: string): string {
  return `delegates-report-${fromIso}-${toIso}.csv`;
}
