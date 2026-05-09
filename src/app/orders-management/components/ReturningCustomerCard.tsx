'use client';
// ─────────────────────────────────────────────────────────────────────────────
// Phase 22O — returning customer smart card.
//
// Renders below the phone input on AddOrderModal when a typed phone
// matches a known customer / past orders. The card surfaces:
//   • customer summary (name, masked phone, total orders, total spent,
//     last order date)
//   • last delivery address shortcut
//   • previous addresses (deduplicated, newest first, capped at 5)
//     with a radio-style picker plus a "إضافة عنوان جديد" option
//   • three actions:
//       1. استخدام بيانات العميل  — fill every form field with the
//          selected (or latest) address.
//       2. تحديث بيانات العميل   — same fields filled but the card
//          stays open so the agent can edit before submitting.
//       3. إضافة كعميل جديد       — dismiss the card; keep typed phone.
//
// The component is read-only — it never writes to the DB. The order
// writer in AddOrderModal still owns the upsert path; this card only
// feeds form state back via callbacks.
//
// Customer-data lookup happens in AddOrderModal. The card receives the
// resolved data shape via props so this file stays pure presentational +
// keyboard / mouse / radio plumbing only.
// ─────────────────────────────────────────────────────────────────────────────

import { CheckCircle2, Loader2, Plus, RefreshCcw, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

/** A unique past-delivery address derived from `turath_masr_orders`. */
export interface PastAddress {
  region: string;
  district: string | null;
  /** Phase 22N-Fix3 — may be null on legacy orders. */
  neighborhood: string | null;
  address: string;
  phone2: string | null;
  /** ISO date string of the most recent order using this address. */
  lastDate: string;
}

export interface CustomerSummary {
  fullName: string | null;
  phone: string;
  phone2: string | null;
  totalOrders: number;
  /** Aggregate of `total` across the matched orders. See parent for math. */
  totalSpent: number;
  /** Most recent order's `date` field (free-text "DD/MM/YYYY") or
   *  `created_at` ISO when `date` is missing. */
  lastOrderDate: string | null;
}

export interface ReturningCustomerLookup {
  /**
   * Tracks which view to render. Phase 22O-Fix1 added `multi-match`
   * for when the agent's broad search (name OR phone prefix) hits
   * more than one customer; the card renders a picker list that
   * collapses to the existing `match` view once one candidate is
   * picked.
   */
  status: 'idle' | 'loading' | 'no-match' | 'match' | 'multi-match' | 'error';
  customer: CustomerSummary | null;
  /** Up to N unique past addresses, newest first. */
  addresses: PastAddress[];
  /** Total addresses found before the cap (so the card can show "X+ "). */
  addressesTotalBeforeCap: number;
  /** Last-error message — non-blocking; the modal still works. */
  errorMessage: string | null;
  /**
   * Phase 22O-Fix1 — populated when `status === 'multi-match'`. Each
   * row is a customer summary the broad search found; click one to
   * transition into the single-match view (the parent re-runs the
   * lookup against that exact phone). Capped to a sensible UI size.
   */
  candidates: CustomerSummary[];
  /** Total candidates found before the cap. */
  candidatesTotalBeforeCap: number;
}

export interface ReturningCustomerCardProps {
  lookup: ReturningCustomerLookup;
  /**
   * Called when the agent picks an address and clicks
   * "استخدام بيانات العميل". `address === null` means
   * "إضافة عنوان جديد" — only the customer name + phone(s) are
   * filled, address-related fields are CLEARED.
   */
  onUseCustomer: (input: { customer: CustomerSummary; address: PastAddress | null }) => void;
  /**
   * Like `onUseCustomer` but the card stays visible so the agent can
   * tweak before submitting.
   */
  onUpdateCustomer: (input: { customer: CustomerSummary; address: PastAddress | null }) => void;
  /** Dismiss the card; keep the typed phone but clear name/address. */
  onTreatAsNew: () => void;
  /**
   * Phase 22O-Fix1 — fired when the agent clicks a row in the
   * `multi-match` candidates list. The parent re-runs the lookup
   * against that exact phone so the card can render the full
   * single-match view (with the deduplicated addresses).
   */
  onPickCandidate: (candidate: CustomerSummary) => void;
}

/**
 * Phone masking — keeps the first 3-4 digits and the last 3, masks the
 * middle with `****`. Handles short / non-digit inputs gracefully so we
 * never throw inside JSX.
 */
function maskPhone(raw: string): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length === 0) return '';
  if (digits.length < 7) return digits;
  if (digits.length >= 11) return `${digits.slice(0, 4)}****${digits.slice(-3)}`;
  return `${digits.slice(0, 3)}****${digits.slice(-3)}`;
}

/** "DD/MM/YYYY" → ISO; ISO stays. Anything weird returns the input. */
function formatLastOrderDate(value: string | null): string {
  if (!value) return '—';
  // Order rows already store DD/MM/YYYY in `date`; if we're passing
  // an ISO date string, format the date portion only.
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return value.slice(0, 10);
  return value;
}

function formatEgp(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return '0 ج.م';
  return `${Math.round(amount).toLocaleString('en-US')} ج.م`;
}

/** Build a stable key for a past-address row — used for radio name + dedup. */
function addressKey(a: PastAddress): string {
  return [a.region, a.district ?? '', a.neighborhood ?? '', a.address].join('|');
}

export default function ReturningCustomerCard({
  lookup,
  onUseCustomer,
  onUpdateCustomer,
  onTreatAsNew,
  onPickCandidate,
}: ReturningCustomerCardProps) {
  const {
    status,
    customer,
    addresses,
    addressesTotalBeforeCap,
    errorMessage,
    candidates,
    candidatesTotalBeforeCap,
  } = lookup;

  // Local: which radio row the agent picked. `null` = newest / default
  // (latest address). `'__new__'` = "إضافة عنوان جديد".
  const [selectedKey, setSelectedKey] = useState<string | '__new__' | null>(null);

  // Reset selection whenever the lookup changes (new phone typed → new
  // candidate set → selection no longer applies).
  useEffect(() => {
    setSelectedKey(null);
  }, [customer?.phone, addresses.length]);

  const selectedAddress: PastAddress | null = useMemo(() => {
    if (selectedKey === '__new__') return null;
    if (selectedKey === null) return addresses[0] ?? null;
    return addresses.find((a) => addressKey(a) === selectedKey) ?? null;
  }, [selectedKey, addresses]);

  const handleUse = () => {
    if (!customer) return;
    onUseCustomer({
      customer,
      address: selectedKey === '__new__' ? null : selectedAddress,
    });
  };

  const handleUpdate = () => {
    if (!customer) return;
    onUpdateCustomer({
      customer,
      address: selectedKey === '__new__' ? null : selectedAddress,
    });
  };

  // ─── Loading state ───────────────────────────────────────────────────────
  if (status === 'loading') {
    return (
      <div className="mt-2 p-3 bg-blue-50/40 border border-blue-100 rounded-xl flex items-center gap-2 text-xs text-blue-700">
        <Loader2 className="animate-spin" size={14} />
        <span>جاري البحث عن بيانات العميل السابقة…</span>
      </div>
    );
  }

  // ─── Error state — non-blocking ──────────────────────────────────────────
  if (status === 'error') {
    return (
      <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
        تعذر جلب بيانات العميل السابق{errorMessage ? ` — ${errorMessage}` : ''}.
      </div>
    );
  }

  // ─── No match — small hint, doesn't crowd the form ───────────────────────
  if (status === 'no-match') {
    return (
      <div className="mt-2 px-3 py-2 bg-gray-50 border border-gray-100 rounded-xl text-[11px] text-gray-500 flex items-center gap-1.5">
        <UserPlus size={12} className="text-gray-400" />
        <span>عميل جديد — سيتم إنشاء ملف تلقائيًا بعد حفظ الطلب.</span>
      </div>
    );
  }

  // ─── Multi-match: candidate picker ───────────────────────────────────────
  // Phase 22O-Fix1 — when the broad search hits more than one
  // customer, render a compact picker. Picking a candidate fires the
  // single-match lookup so the parent can fetch deduped addresses
  // and show the full card.
  if (status === 'multi-match' && candidates.length > 0) {
    return (
      <div className="mt-2 rounded-2xl border-2 border-blue-200 bg-blue-50/40 shadow-sm overflow-hidden animate-in slide-in-from-top-2 duration-300">
        <div className="px-4 py-2.5 bg-blue-100/60 border-b border-blue-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={14} className="text-blue-600 flex-shrink-0" />
            <span className="text-xs font-black text-blue-800">
              تم العثور على {candidatesTotalBeforeCap}{' '}
              {candidatesTotalBeforeCap === 1 ? 'عميل' : 'عميل'} مطابق
            </span>
          </div>
          {candidatesTotalBeforeCap > candidates.length && (
            <span className="text-[10px] text-blue-700/70">
              يعرض {candidates.length} — قم بتحديد البحث للوصول إلى الباقي
            </span>
          )}
        </div>
        <ul className="max-h-72 overflow-y-auto divide-y divide-blue-100">
          {candidates.map((c) => (
            <li key={`candidate-${c.phone}`}>
              <button
                type="button"
                onClick={() => onPickCandidate(c)}
                className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-right hover:bg-white transition-all group"
              >
                <span className="flex flex-col min-w-0">
                  <span className="text-xs font-bold text-gray-800 truncate">
                    {c.fullName ?? '—'}
                  </span>
                  <span className="text-[10px] text-gray-500 mt-0.5 flex items-center gap-2">
                    <span className="font-mono">{maskPhone(c.phone)}</span>
                    <span>•</span>
                    <span>
                      {c.totalOrders} {c.totalOrders === 1 ? 'طلب' : 'طلبات'}
                    </span>
                    {c.lastOrderDate && (
                      <>
                        <span>•</span>
                        <span>{formatLastOrderDate(c.lastOrderDate)}</span>
                      </>
                    )}
                  </span>
                </span>
                <span className="text-[10px] text-blue-600 font-bold opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  اختيار ←
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="px-4 py-2 border-t border-blue-100 flex justify-end">
          <button
            type="button"
            onClick={onTreatAsNew}
            className="text-[11px] text-gray-500 hover:text-gray-700 underline-offset-2 hover:underline"
          >
            إضافة كعميل جديد
          </button>
        </div>
      </div>
    );
  }

  if (status !== 'match' || !customer) {
    return null;
  }

  // ─── Match: full card ────────────────────────────────────────────────────
  return (
    <div className="mt-2 rounded-2xl border-2 border-emerald-200 bg-emerald-50/40 shadow-sm overflow-hidden animate-in slide-in-from-top-2 duration-300">
      {/* Header */}
      <div className="px-4 py-2.5 bg-emerald-100/60 border-b border-emerald-200 flex items-center gap-2">
        <CheckCircle2 size={14} className="text-emerald-600 flex-shrink-0" />
        <span className="text-xs font-black text-emerald-800">عميل سابق</span>
      </div>

      {/* Summary grid */}
      <div className="px-4 py-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
        <SummaryRow label="الاسم" value={customer.fullName ?? '—'} />
        <SummaryRow label="الهاتف" value={maskPhone(customer.phone)} mono />
        <SummaryRow label="آخر طلب" value={formatLastOrderDate(customer.lastOrderDate)} />
        <SummaryRow label="عدد الطلبات" value={String(customer.totalOrders)} />
        <SummaryRow
          label="إجمالي التعامل"
          value={formatEgp(customer.totalSpent)}
          mono
          className="col-span-2"
        />
        {addresses.length > 0 && (
          <div className="col-span-2 mt-0.5">
            <p className="text-[10px] text-emerald-700/70 mb-0.5">آخر عنوان</p>
            <p className="text-[11px] font-semibold text-gray-700 line-clamp-2">
              {formatAddressLine(addresses[0])}
            </p>
          </div>
        )}
      </div>

      {/* Previous addresses */}
      {addresses.length > 0 && (
        <div className="px-4 pt-1 pb-2">
          <p className="text-[10px] font-bold text-emerald-700/80 mb-1">
            العناوين السابقة{' '}
            {addressesTotalBeforeCap > addresses.length && (
              <span className="text-gray-400 font-normal">
                ({addresses.length} من {addressesTotalBeforeCap})
              </span>
            )}
          </p>
          <ul className="max-h-44 overflow-y-auto space-y-1 pr-1">
            {addresses.map((a, i) => {
              const key = addressKey(a);
              // First row is the "default" — selected when nothing else picked.
              const isSelected = selectedKey === key || (selectedKey === null && i === 0);
              return (
                <li key={`addr-${key}`}>
                  <label
                    className={`flex items-start gap-2 px-2.5 py-1.5 rounded-lg border cursor-pointer transition-all ${
                      isSelected
                        ? 'border-emerald-400 bg-white shadow-sm'
                        : 'border-emerald-100/80 bg-white/60 hover:bg-white'
                    }`}
                  >
                    <input
                      type="radio"
                      name="returning-customer-address"
                      checked={isSelected}
                      onChange={() => setSelectedKey(key)}
                      className="mt-0.5 accent-emerald-600 cursor-pointer flex-shrink-0"
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[11px] text-gray-700 leading-relaxed line-clamp-2">
                        {formatAddressLine(a)}
                      </span>
                      <span className="block text-[9px] text-gray-400 mt-0.5">
                        {formatLastOrderDate(a.lastDate)}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
            <li>
              <label
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border cursor-pointer transition-all ${
                  selectedKey === '__new__'
                    ? 'border-blue-400 bg-blue-50/60 shadow-sm'
                    : 'border-dashed border-gray-300 bg-white/40 hover:bg-white'
                }`}
              >
                <input
                  type="radio"
                  name="returning-customer-address"
                  checked={selectedKey === '__new__'}
                  onChange={() => setSelectedKey('__new__')}
                  className="accent-blue-600 cursor-pointer flex-shrink-0"
                />
                <Plus size={12} className="text-blue-500" />
                <span className="text-[11px] font-semibold text-blue-700">إضافة عنوان جديد</span>
              </label>
            </li>
          </ul>
        </div>
      )}

      {/* Actions */}
      <div className="px-4 pb-3 pt-2 flex flex-wrap items-center gap-2 border-t border-emerald-100">
        <button
          type="button"
          onClick={handleUse}
          className="flex-1 min-w-[120px] flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-[11px] font-bold hover:bg-emerald-700 transition-all shadow-sm shadow-emerald-200 active:scale-95"
        >
          <CheckCircle2 size={12} />
          استخدام بيانات العميل
        </button>
        <button
          type="button"
          onClick={handleUpdate}
          className="flex-1 min-w-[120px] flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-emerald-300 text-emerald-700 text-[11px] font-bold hover:bg-emerald-50 transition-all active:scale-95"
        >
          <RefreshCcw size={12} />
          تحديث بيانات العميل
        </button>
        <button
          type="button"
          onClick={onTreatAsNew}
          className="flex-1 min-w-[120px] flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-600 text-[11px] font-bold hover:bg-gray-50 transition-all active:scale-95"
        >
          <UserPlus size={12} />
          إضافة كعميل جديد
        </button>
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  mono,
  className = '',
}: {
  label: string;
  value: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex items-baseline gap-1.5 ${className}`}>
      <span className="text-[10px] text-emerald-700/70 font-semibold flex-shrink-0">{label}:</span>
      <span
        className={`text-[11px] font-semibold text-gray-800 truncate ${mono ? 'font-mono' : ''}`}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Build a single human-readable line for an address. Falls back
 * gracefully when components are missing (legacy rows without
 * neighborhood, partial CAPMAS imports etc.).
 */
function formatAddressLine(a: PastAddress): string {
  const parts: string[] = [a.region, a.district ?? '', a.neighborhood ?? '', a.address].filter(
    (p): p is string => !!p && p.trim() !== ''
  );
  return parts.join(' — ');
}

/**
 * Phase 22O — pure helpers re-exported for AddOrderModal so the
 * lookup logic + tests can live alongside the component without
 * duplication. `normalizePhone` is the single source of truth for
 * phone-shape coercion across this card and any caller.
 */

/**
 * Strip everything that isn't a digit, drop leading "+2" / "00" /
 * Egyptian country code, return the local 11-digit form. Whitespace
 * and zero-width characters are also removed.
 *
 * Examples:
 *   "+20 100 123 4567" → "01001234567"  (we add the leading 0 back)
 *   "201001234567"     → "01001234567"
 *   "01001234567"      → "01001234567"
 */
export function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return '';
  let digits = String(raw).replace(/\D/g, '');
  // Strip leading "00" (international prefix) or "20" (Egypt country
  // code) so the comparator only sees the local 11-digit form.
  if (digits.startsWith('0020')) digits = digits.slice(4);
  else if (digits.startsWith('20') && digits.length > 11) digits = digits.slice(2);
  // If we end up with 10 digits starting with `1` (e.g. "1001234567"),
  // re-prefix the leading `0` so the form matches stored rows.
  if (digits.length === 10 && digits.startsWith('1')) digits = '0' + digits;
  return digits;
}

/** Re-export so tests can also use the same masker. */
export { maskPhone };

/**
 * Build a unique-address list from a flat list of orders. Sorted by
 * `created_at` descending; the first row in the input that mentions
 * a given (region, district, neighborhood, address) tuple wins.
 */
export interface OrderRowForLookup {
  region: string | null;
  district: string | null;
  neighborhood: string | null;
  address: string | null;
  /** Phase 22O-Fix1 — primary phone from the row; needed when the
   *  broad search returns rows for multiple distinct customers and
   *  the parent has to bucket orders by phone. */
  phone: string | null;
  phone2: string | null;
  /** Order grand total — used by the customer summary aggregator. */
  total: number | null;
  /** Free-text customer name from the row; used when canonical
   *  `turath_masr_customers.full_name` is missing. */
  customer: string | null;
  /** ISO timestamp; pre-sorted desc by the caller for determinism. */
  created_at: string | null;
  /** Free-text 'DD/MM/YYYY' or empty. Used as a display fallback. */
  date: string | null;
}

export function buildUniqueAddresses(
  orders: OrderRowForLookup[],
  cap: number
): { addresses: PastAddress[]; totalBeforeCap: number } {
  const seen = new Set<string>();
  const out: PastAddress[] = [];
  for (const o of orders) {
    if (!o.region || !o.address) continue;
    const a: PastAddress = {
      region: o.region,
      district: o.district,
      neighborhood: o.neighborhood,
      address: o.address,
      phone2: o.phone2,
      lastDate: o.date ?? o.created_at ?? '',
    };
    const k = addressKey(a);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  const total = out.length;
  return { addresses: out.slice(0, cap), totalBeforeCap: total };
}
