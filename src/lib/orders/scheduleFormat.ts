// ─────────────────────────────────────────────────────────────────────────────
// src/lib/orders/scheduleFormat.ts
//
// Phase 22Q — small Arabic-locale helpers for rendering the delivery
// schedule fields. Centralised so the StatusUpdateModal,
// OrderDetailModal, AuditLogModal, and the public tracking pages all
// produce identical strings ("الثلاثاء 14 مايو 2026" /
// "03:00 مساءً") and a future tweak to either format is a one-line
// change.
//
// Inputs are the storage shapes used by the new
// `turath_masr_orders.scheduled_delivery_*` columns:
//   • date: `YYYY-MM-DD` (Postgres `date`).
//   • time: `HH:MM` or `HH:MM:SS` (Postgres `time` strips trailing
//     zeros differently in different drivers; we accept both).
//
// Every formatter is null-safe and returns an empty string when its
// input is missing or unparseable, so render call-sites can do
// `formatTime12hAr(value) || ''` without extra guards.
// ─────────────────────────────────────────────────────────────────────────────

const ARABIC_DAYS_LONG = [
  'الأحد',
  'الاثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
  'السبت',
] as const;

const ARABIC_MONTHS_LONG = [
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
] as const;

/**
 * Build a Date object from a `YYYY-MM-DD` calendar date in the
 * local time zone. We deliberately avoid `new Date(yyyyMmDd)` because
 * that parses as UTC midnight and shifts the day when the runtime is
 * in a positive UTC offset (Cairo = UTC+2/+3 — without this fix a
 * date like `2026-05-14` would render as 13 مايو for the early hours
 * of the local day after a UTC midnight).
 */
function parseLocalDate(yyyyMmDd: string | null | undefined): Date | null {
  if (typeof yyyyMmDd !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyyMmDd.trim());
  if (!m) return null;
  const y = Number.parseInt(m[1], 10);
  const mo = Number.parseInt(m[2], 10);
  const d = Number.parseInt(m[3], 10);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  // Local-tz constructor variant.
  const local = new Date(y, mo - 1, d, 0, 0, 0, 0);
  return Number.isNaN(local.getTime()) ? null : local;
}

/**
 * Render an Arabic long-form date string for an ISO calendar date.
 * Shape: `الثلاثاء 14 مايو 2026`. Day comes first to match the way
 * Egyptian Arabic readers scan the line (day → date → month → year).
 *
 * Returns `''` when the input is missing or unparseable.
 */
export function formatScheduleDateAr(yyyyMmDd: string | null | undefined): string {
  const d = parseLocalDate(yyyyMmDd);
  if (!d) return '';
  const dayName = ARABIC_DAYS_LONG[d.getDay()];
  const monthName = ARABIC_MONTHS_LONG[d.getMonth()];
  return `${dayName} ${d.getDate()} ${monthName} ${d.getFullYear()}`;
}

/**
 * Render an Arabic short-form date string. Shape:
 * `الثلاثاء 14 مايو` (no year). Used by the customer tracking card
 * where the year is implicit (an order's delivery is always within
 * weeks of "now").
 */
export function formatScheduleDateShortAr(yyyyMmDd: string | null | undefined): string {
  const d = parseLocalDate(yyyyMmDd);
  if (!d) return '';
  const dayName = ARABIC_DAYS_LONG[d.getDay()];
  const monthName = ARABIC_MONTHS_LONG[d.getMonth()];
  return `${dayName} ${d.getDate()} ${monthName}`;
}

/**
 * Render an `HH:MM` 24-hour time string as `03:00 مساءً` /
 * `09:30 صباحًا`. Accepts the `HH:MM` and `HH:MM:SS` storage shapes
 * that Postgres `time` columns may emit through different drivers.
 *
 * Returns `''` when the input is missing or unparseable.
 */
export function formatTime12hAr(hhmm: string | null | undefined): string {
  if (typeof hhmm !== 'string') return '';
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(hhmm.trim());
  if (!m) return '';
  const h24 = Number.parseInt(m[1], 10);
  const mm = Number.parseInt(m[2], 10);
  if (!Number.isFinite(h24) || !Number.isFinite(mm) || h24 < 0 || h24 > 23 || mm < 0 || mm > 59) {
    return '';
  }
  const period = h24 >= 12 ? 'مساءً' : 'صباحًا';
  // 12-hour conversion: 0 → 12 (midnight), 13 → 1, etc.
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  const h12Str = String(h12).padStart(2, '0');
  const mmStr = String(mm).padStart(2, '0');
  return `${h12Str}:${mmStr} ${period}`;
}

/**
 * Compose the customer-facing one-line preview used inside the
 * status modal AND on the tracking page card. Shape:
 * `متوقع التوصيل يوم الثلاثاء 14 مايو\nمن الساعة 03:00 مساءً إلى الساعة 06:00 مساءً`.
 *
 * Returns `''` when ANY of the three components is missing — callers
 * use this as a single string and cannot render a partial preview.
 */
export function formatSchedulePreviewAr(
  date: string | null | undefined,
  from: string | null | undefined,
  to: string | null | undefined
): string {
  const dateStr = formatScheduleDateShortAr(date);
  const fromStr = formatTime12hAr(from);
  const toStr = formatTime12hAr(to);
  if (!dateStr || !fromStr || !toStr) return '';
  return `متوقع التوصيل يوم ${dateStr}\nمن الساعة ${fromStr} إلى الساعة ${toStr}`;
}

/**
 * Build the next-N-days array for the StatusUpdateModal weekly
 * picker. Returns an array of `{ iso, dayNameAr, dayOfMonth, monthNameAr, isToday }`
 * starting at TODAY (local). N defaults to 7. Used so the modal
 * always shows the "next week" relative to the user's clock without
 * the picker having its own date logic.
 */
export interface ScheduleDayCard {
  /** YYYY-MM-DD ISO calendar date (local tz). */
  iso: string;
  /** Arabic day name (الأحد..السبت). */
  dayNameAr: string;
  /** Numeric day-of-month (1..31). */
  dayOfMonth: number;
  /** Arabic month name (مايو..ديسمبر). */
  monthNameAr: string;
  /** True iff this card represents today's local date. */
  isToday: boolean;
}

export function nextNDaysAr(n = 7, fromBase: Date = new Date()): ScheduleDayCard[] {
  const out: ScheduleDayCard[] = [];
  const todayY = fromBase.getFullYear();
  const todayM = fromBase.getMonth();
  const todayD = fromBase.getDate();
  for (let i = 0; i < n; i++) {
    const d = new Date(todayY, todayM, todayD + i, 0, 0, 0, 0);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    out.push({
      iso: `${yyyy}-${mm}-${dd}`,
      dayNameAr: ARABIC_DAYS_LONG[d.getDay()],
      dayOfMonth: d.getDate(),
      monthNameAr: ARABIC_MONTHS_LONG[d.getMonth()],
      isToday: i === 0,
    });
  }
  return out;
}
