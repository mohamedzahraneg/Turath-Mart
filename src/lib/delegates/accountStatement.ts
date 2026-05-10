// ─────────────────────────────────────────────────────────────────────────────
// src/lib/delegates/accountStatement.ts
//
// Phase 23D — pure helpers for the delegate account-statement tab:
//   • RANGE_PRESETS: today / week / month / last 90 days
//   • toIsoDate / fromIsoDate: <input type="date"> ↔ Date conversions
//     anchored at local midnight (so a "from = today" range starts at
//     00:00 local, not 00:00 UTC — important for Cairo / GMT+2/+3).
//   • buildStatementRows: takes the per-delegate slices the page
//     already aggregates and produces a single sorted timeline of
//     debit / credit movements + an informational custody trail.
//   • toCsv: serialises the rows + summary into Excel-friendly UTF-8
//     BOM CSV with proper RFC-4180 escaping.
//
// Pure module — no React, no Supabase, no DOM. The page imports
// these helpers and provides the I/O. Keeps the test surface narrow
// and lets the same helpers be re-used by a future server-side
// report endpoint.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Types ───────────────────────────────────────────────────────────────

/** Discriminated union of every row kind that can appear in the
 *  unified statement timeline. The first three drive the financial
 *  balance; the four `custody_*` kinds are informational only and
 *  never carry debit/credit amounts (the spec is explicit on this:
 *  "custody appears in a separate summary"). */
export type StatementRowType =
  | 'collection'
  | 'settlement'
  | 'expense'
  | 'custody_out'
  | 'custody_in'
  | 'custody_settled'
  | 'custody_lost';

export interface DelegateStatementRow {
  /** Stable id so React keys stay sane. Built from
   *  `<source-table>:<source-id>` to avoid collisions. */
  id: string;
  /** ISO timestamp; rows are sorted by this. */
  date: string;
  type: StatementRowType;
  /** Arabic label rendered in the "النوع" column. */
  label: string;
  /** Optional reference (order_num, settlement id prefix, etc.). */
  reference?: string;
  description: string;
  /** Money the delegate owes the company (positive grows the
   *  outstanding balance). Always >= 0. */
  debit: number;
  /** Money credited against the delegate's balance — settlements +
   *  approved expenses. Always >= 0. */
  credit: number;
  note?: string;
}

/** Compact summary header that pairs the timeline with the totals
 *  the dispatcher actually needs to act on. `activeCustodyValue` /
 *  `openCustodyCount` cover ALL open custody (no date filter — the
 *  open balance is open regardless of when it was handed over). */
export interface DelegateStatementSummary {
  fromIso: string;
  toIso: string;
  totalCollected: number;
  totalSettled: number;
  totalApprovedExpenses: number;
  financialRemaining: number;
  activeCustodyValue: number;
  openCustodyCount: number;
}

// ─── Range presets ───────────────────────────────────────────────────────

export type StatementRangePreset = 'today' | 'week' | 'month' | 'last90d' | 'custom';

export const RANGE_PRESET_LABELS: Record<StatementRangePreset, string> = {
  today: 'اليوم',
  week: 'هذا الأسبوع',
  month: 'هذا الشهر',
  last90d: 'آخر 90 يوم',
  custom: 'مخصص',
};

/** Local-midnight `Date` helper. Avoids the UTC drift you get from
 *  `new Date('2026-05-10')` (which yields a UTC midnight). */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

/** "yyyy-mm-dd" — the format `<input type="date">` round-trips. */
export function toIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parse "yyyy-mm-dd" as a local-midnight Date. Returns null on
 *  garbage input — caller's validation surfaces the error. */
export function fromIsoDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/** Resolve a preset to a concrete `[fromIso, toIso]` pair (both in
 *  the local timezone). The "today" preset returns a single-day
 *  window; "week" goes back 6 days inclusive (so 7 days total
 *  including today); "month" mirrors that with 29 days back. */
export function resolveRangePreset(
  preset: Exclude<StatementRangePreset, 'custom'>,
  now: Date = new Date()
): { fromIso: string; toIso: string } {
  const today = startOfDay(now);
  const toIso = toIsoDate(today);
  if (preset === 'today') return { fromIso: toIso, toIso };
  if (preset === 'week') {
    const from = new Date(today);
    from.setDate(from.getDate() - 6);
    return { fromIso: toIsoDate(from), toIso };
  }
  if (preset === 'month') {
    const from = new Date(today);
    from.setDate(from.getDate() - 29);
    return { fromIso: toIsoDate(from), toIso };
  }
  // last 90 days
  const from = new Date(today);
  from.setDate(from.getDate() - 89);
  return { fromIso: toIsoDate(from), toIso };
}

/** True iff fromIso and toIso parse and `from <= to`. */
export function isValidRange(fromIso: string, toIso: string): boolean {
  const f = fromIsoDate(fromIso);
  const t = fromIsoDate(toIso);
  if (!f || !t) return false;
  return f.getTime() <= t.getTime();
}

/** Days between (inclusive). Used by the page to surface a
 *  "long range" warning. Returns 0 on invalid input. */
export function rangeDays(fromIso: string, toIso: string): number {
  const f = fromIsoDate(fromIso);
  const t = fromIsoDate(toIso);
  if (!f || !t) return 0;
  return Math.max(0, Math.round((t.getTime() - f.getTime()) / 86_400_000) + 1);
}

/** Filter helper: returns true iff `iso` falls within the
 *  [fromIso, toIso] inclusive window (local midnight semantics). */
export function isInRange(iso: string | null | undefined, fromIso: string, toIso: string): boolean {
  if (!iso) return false;
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return false;
  const f = fromIsoDate(fromIso);
  const t = fromIsoDate(toIso);
  if (!f || !t) return false;
  return ts >= startOfDay(f).getTime() && ts <= endOfDay(t).getTime();
}

// ─── Row builder ──────────────────────────────────────────────────────────

/** Source-shape interfaces are intentionally minimal so this module
 *  doesn't pull React / Supabase types. Page maps its rich
 *  `OrderRow` / `SettlementRow` / `CustodyRow` / `ExpenseRow` to
 *  these slim shapes before calling. */
export interface StatementOrderInput {
  id: string;
  order_num: string;
  customer: string | null;
  total: number | null;
  status: string;
  created_at: string | null;
}
export interface StatementSettlementInput {
  id: string;
  amount: number;
  method: string;
  methodLabel: string;
  note: string | null;
  settled_at: string;
}
export interface StatementExpenseInput {
  id: string;
  amount: number;
  expense_type: string;
  expenseTypeLabel: string;
  status: string;
  order_id: string | null;
  note: string | null;
  expense_at: string;
}
export interface StatementCustodyInput {
  id: string;
  custody_type: string;
  custodyTypeLabel: string;
  description: string;
  quantity: number | null;
  estimated_value: number | null;
  status: string;
  handed_at: string;
  returned_at: string | null;
  note: string | null;
}

const DELIVERED_STATUS = 'delivered';
const APPROVED_EXPENSE_STATUS = 'approved';

/** Build a unified, sorted-descending timeline from already-aggregated
 *  per-delegate slices. The returned rows include:
 *
 *    • collection — one row per delivered order in [from, to]
 *    • settlement — one per row in [from, to]
 *    • expense — one per APPROVED expense row in [from, to]
 *    • custody_out — one per custody row whose `handed_at` falls in
 *      [from, to]
 *    • custody_in / custody_settled / custody_lost — one per custody
 *      row whose `returned_at` falls in [from, to] (status-keyed)
 *
 *  Custody rows always carry `debit = 0, credit = 0` — they're
 *  informational only and the description includes the estimated
 *  value so the dispatcher can read it without a side-glance.
 */
export function buildStatementRows(
  fromIso: string,
  toIso: string,
  inputs: {
    orders: readonly StatementOrderInput[];
    settlements: readonly StatementSettlementInput[];
    expenses: readonly StatementExpenseInput[];
    custody: readonly StatementCustodyInput[];
  }
): DelegateStatementRow[] {
  const out: DelegateStatementRow[] = [];

  // Collections (delivered orders)
  for (const o of inputs.orders) {
    if (o.status !== DELIVERED_STATUS) continue;
    if (!isInRange(o.created_at, fromIso, toIso)) continue;
    out.push({
      id: `order:${o.id}`,
      date: o.created_at!,
      type: 'collection',
      label: 'تحصيل',
      reference: o.order_num,
      description: `تحصيل طلب ${o.order_num}${o.customer ? ` — ${o.customer}` : ''}`,
      debit: Number(o.total ?? 0),
      credit: 0,
    });
  }

  // Settlements
  for (const s of inputs.settlements) {
    if (!isInRange(s.settled_at, fromIso, toIso)) continue;
    out.push({
      id: `settlement:${s.id}`,
      date: s.settled_at,
      type: 'settlement',
      label: 'توريد',
      reference: s.id.slice(0, 8),
      description: `توريد مالي (${s.methodLabel || s.method})`,
      debit: 0,
      credit: Number(s.amount ?? 0),
      note: s.note ?? undefined,
    });
  }

  // Approved expenses
  for (const e of inputs.expenses) {
    if (e.status !== APPROVED_EXPENSE_STATUS) continue;
    if (!isInRange(e.expense_at, fromIso, toIso)) continue;
    out.push({
      id: `expense:${e.id}`,
      date: e.expense_at,
      type: 'expense',
      label: 'مصروف',
      reference: e.order_id || e.id.slice(0, 8),
      description: `مصروف معتمد (${e.expenseTypeLabel || e.expense_type})`,
      debit: 0,
      credit: Number(e.amount ?? 0),
      note: e.note ?? undefined,
    });
  }

  // Custody — informational only. We emit one row for the handover
  // event AND a second row for each terminal transition that falls
  // in the window. This way a custody row that was opened in March
  // but settled in June shows up correctly in either range.
  for (const c of inputs.custody) {
    const valueText =
      Number(c.estimated_value ?? 0) > 0
        ? ` — قيمة تقديرية: ${formatMoney(Number(c.estimated_value))}`
        : '';
    if (isInRange(c.handed_at, fromIso, toIso)) {
      out.push({
        id: `custody_out:${c.id}`,
        date: c.handed_at,
        type: 'custody_out',
        label: 'أمانة',
        reference: c.id.slice(0, 8),
        description: `تسليم أمانة (${c.custodyTypeLabel || c.custody_type}) — ${c.description}${valueText}`,
        debit: 0,
        credit: 0,
        note: c.note ?? undefined,
      });
    }
    if (c.returned_at && isInRange(c.returned_at, fromIso, toIso)) {
      const terminalLabel =
        c.status === 'returned'
          ? { type: 'custody_in' as const, label: 'استلام أمانة', verb: 'استلام' }
          : c.status === 'settled'
            ? { type: 'custody_settled' as const, label: 'تسوية أمانة', verb: 'تسوية' }
            : c.status === 'lost'
              ? { type: 'custody_lost' as const, label: 'أمانة مفقودة', verb: 'فقد' }
              : null;
      if (terminalLabel) {
        out.push({
          id: `${terminalLabel.type}:${c.id}`,
          date: c.returned_at,
          type: terminalLabel.type,
          label: terminalLabel.label,
          reference: c.id.slice(0, 8),
          description: `${terminalLabel.verb} أمانة (${c.custodyTypeLabel || c.custody_type}) — ${c.description}${valueText}`,
          debit: 0,
          credit: 0,
          note: c.note ?? undefined,
        });
      }
    }
  }

  // Sort descending by date — same convention as the per-tab
  // timelines in the drawer.
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return out;
}

/** Compute the summary block from the row list + the original
 *  custody slice. Custody totals are NOT date-filtered (they
 *  represent the open balance regardless of window). */
export function summariseStatement(
  fromIso: string,
  toIso: string,
  rows: DelegateStatementRow[],
  allCustody: readonly StatementCustodyInput[]
): DelegateStatementSummary {
  let totalCollected = 0;
  let totalSettled = 0;
  let totalApprovedExpenses = 0;
  for (const r of rows) {
    if (r.type === 'collection') totalCollected += r.debit;
    else if (r.type === 'settlement') totalSettled += r.credit;
    else if (r.type === 'expense') totalApprovedExpenses += r.credit;
  }
  let activeCustodyValue = 0;
  let openCustodyCount = 0;
  for (const c of allCustody) {
    if (c.status === 'with_delegate') {
      activeCustodyValue += Number(c.estimated_value ?? 0);
      openCustodyCount += 1;
    }
  }
  return {
    fromIso,
    toIso,
    totalCollected,
    totalSettled,
    totalApprovedExpenses,
    financialRemaining: totalCollected - totalSettled - totalApprovedExpenses,
    activeCustodyValue,
    openCustodyCount,
  };
}

// ─── CSV serialisation ────────────────────────────────────────────────────

/** Local helper because `fmtMoney` lives in the page module and we
 *  don't want a circular import. Stays consistent with the page's
 *  `4,250 ج.م` rendering convention. */
function formatMoney(n: number): string {
  return `${(n ?? 0).toLocaleString('en-US')} ج.م`;
}

/** RFC-4180 quoting: wraps the field in double quotes whenever it
 *  contains a comma, double quote, newline, or carriage return.
 *  Inner double quotes are doubled. */
function csvField(raw: string | number | null | undefined): string {
  if (raw == null) return '';
  const s = typeof raw === 'string' ? raw : String(raw);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Excel-friendly date format. Keeps the raw ISO date in a separate
 *  column for spreadsheet sorting if a future export adds it. */
function csvDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Build the CSV body from a statement. Excludes any sensitive
 *  fields the spec calls out (national_id, license numbers, login
 *  info) — those never enter a `DelegateStatementRow` to begin
 *  with, so filtering here is belt-and-braces. */
export function toCsv(
  delegate: { name: string },
  summary: DelegateStatementSummary,
  rows: DelegateStatementRow[]
): string {
  const lines: string[] = [];

  // Header block — five rows of metadata before the table proper.
  // Excel renders this as a clean preamble.
  lines.push(`كشف حساب المندوب,${csvField(delegate.name)}`);
  lines.push(`الفترة من,${csvField(summary.fromIso)},إلى,${csvField(summary.toIso)}`);
  lines.push(`إجمالي التحصيلات,${csvField(summary.totalCollected)}`);
  lines.push(`إجمالي التوريدات,${csvField(summary.totalSettled)}`);
  lines.push(`إجمالي المصاريف المعتمدة,${csvField(summary.totalApprovedExpenses)}`);
  lines.push(`المتبقي المالي,${csvField(summary.financialRemaining)}`);
  lines.push(
    `قيمة الأمانات الحالية,${csvField(summary.activeCustodyValue)},عدد الأمانات,${csvField(summary.openCustodyCount)}`
  );
  lines.push(''); // blank separator line

  // Table header
  lines.push(['التاريخ', 'النوع', 'المرجع', 'الوصف', 'مدين', 'دائن', 'ملاحظة'].join(','));

  // Body
  for (const r of rows) {
    lines.push(
      [
        csvField(csvDate(r.date)),
        csvField(r.label),
        csvField(r.reference ?? ''),
        csvField(r.description),
        csvField(r.debit > 0 ? r.debit : ''),
        csvField(r.credit > 0 ? r.credit : ''),
        csvField(r.note ?? ''),
      ].join(',')
    );
  }

  return lines.join('\r\n');
}

/** Sanitise a delegate name into a filename fragment. Drops any
 *  characters that aren't unicode-letter / digit / dash / underscore
 *  so the download works on every OS without quoting. */
export function csvFilename(delegateName: string, fromIso: string, toIso: string): string {
  const slug =
    delegateName
      .trim()
      .replace(/\s+/g, '-')
      // Keep Arabic letters + Latin + digits + dash/underscore.
      .replace(/[^\p{L}\p{N}_-]/gu, '')
      .slice(0, 60) || 'delegate';
  return `delegate-statement-${slug}-${fromIso}-${toIso}.csv`;
}

/** Browser-only download helper. Prepends the UTF-8 BOM so Excel
 *  on Windows opens the Arabic columns correctly. */
export function downloadCsv(filename: string, body: string): void {
  if (typeof window === 'undefined') return;
  const BOM = '﻿';
  const blob = new Blob([BOM, body], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so the browser has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
