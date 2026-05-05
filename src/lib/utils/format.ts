// ─────────────────────────────────────────────────────────────────────────────
// Display-formatting helpers for currency, numbers, and dates.
//
// Numbers are formatted in en-US (Latin digits) on purpose — the rest of the
// UI uses Latin digits for amounts and dates per the app's existing
// convention. Only weekday/month *names* are rendered in Arabic.
// ─────────────────────────────────────────────────────────────────────────────

export function formatCurrencyEGP(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '0';
  return value.toLocaleString('en-US');
}

export function formatArabicLongDate(date: Date | string | number = new Date()): string {
  const d = typeof date === 'object' ? date : new Date(date);
  return d.toLocaleDateString('ar-EG-u-nu-latn', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function formatTimeHHMMSS(date: Date = new Date()): string {
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  const s = date.getSeconds().toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}
