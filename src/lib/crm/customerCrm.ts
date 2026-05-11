// ─────────────────────────────────────────────────────────────────────────────
// src/lib/crm/customerCrm.ts
//
// Phase 24A — pure helpers for the customer-service CRM redesign:
//   • phone normalisation + customer-key encoding
//   • shared types for orders/complaints/chat/notes/tasks/attachments
//   • per-customer metric folding (receipt / returns / cancel / open
//     complaints / current orders / last contact)
//   • CSV serialisation for the dashboard export
//   • Arabic label maps for status / segment / VIP / customer type
//
// Pure module — no React, no Supabase, no DOM. The dashboard + profile
// pages own the I/O and just hand slim slices to the folder helpers.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Phone normalisation + customer key ──────────────────────────────────

/** Normalise an Egyptian-mobile-shaped phone into a stable comparable
 *  string: strip whitespace, drop a leading + or country prefix
 *  (002 / 0020 / 20), and keep only digits. Returns null on input
 *  that can't represent a phone (less than 5 digits after stripping). */
export function normalisePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let digits = input.replace(/\D+/g, '');
  if (digits.length === 0) return null;
  if (digits.startsWith('0020')) digits = digits.slice(4);
  else if (digits.startsWith('002')) digits = digits.slice(3);
  else if (digits.startsWith('20') && digits.length >= 12) digits = digits.slice(2);
  if (digits.length < 5) return null;
  // Re-prefix with a leading 0 for the canonical EG mobile pattern
  // (01XXXXXXXXX) if the local 9- or 10-digit form was passed.
  if (digits.length === 10 && digits.startsWith('1')) digits = '0' + digits;
  return digits;
}

/** URL-safe encoding of a phone into a route key. We never use the
 *  raw phone in the path so a future move to a real customer-id is
 *  drop-in. Forward-compat: the profile page also accepts the raw
 *  phone OR an existing customer id; the helper here is just the
 *  preferred shape. */
export function customerKeyFromPhone(phone: string | null | undefined): string | null {
  const n = normalisePhone(phone);
  if (!n) return null;
  return encodeURIComponent(n);
}

/** Inverse — accepts a URL segment and returns the digit-only phone.
 *  Defensive against legacy keys that may include a `+` sign. */
export function phoneFromCustomerKey(key: string | null | undefined): string | null {
  if (!key) return null;
  return normalisePhone(decodeURIComponent(key));
}

/** Phone shown to the user — non-destructive (keeps original format
 *  if it can; otherwise falls back to the normalised digits). */
export function formatPhoneDisplay(input: string | null | undefined): string {
  if (!input) return '—';
  const t = input.trim();
  return t.length > 0 ? t : '—';
}

/** WhatsApp `wa.me` URL builder. Uses normalised digits with EG
 *  country code prepended if the local form has 10–11 digits. */
export function buildWhatsAppHref(phone: string | null | undefined): string | null {
  const n = normalisePhone(phone);
  if (!n) return null;
  // Strip leading 0 + prepend country code 20 (Egypt).
  const local = n.startsWith('0') ? n.slice(1) : n;
  return `https://wa.me/20${local}`;
}

export function buildTelHref(phone: string | null | undefined): string | null {
  const n = normalisePhone(phone);
  if (!n) return null;
  return `tel:${n}`;
}

export function buildMailtoHref(email: string | null | undefined): string | null {
  if (!email) return null;
  const t = email.trim();
  if (!t.includes('@')) return null;
  return `mailto:${t}`;
}

// ─── Slim shared types ───────────────────────────────────────────────────

export interface CustomerRow {
  phone: string;
  full_name: string | null;
  email: string | null;
  address: string | null;
  segment: string | null;
  city: string | null;
  customer_type: string | null;
  customer_status: string | null;
  account_manager_id: string | null;
  account_manager_name: string | null;
  vip_level: string | null;
  notes: string | null;
  total_spent: number | null;
  total_orders: number | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface OrderRow {
  id: string;
  order_num: string;
  customer: string | null;
  phone: string | null;
  phone2: string | null;
  total: number | null;
  status: string;
  date: string | null;
  delegate_name: string | null;
  scheduled_delivery_date: string | null;
  scheduled_delivery_from: string | null;
  scheduled_delivery_to: string | null;
  tracking_token: string | null;
  notes: string | null;
  created_at: string | null;
}

export interface ComplaintRow {
  id: string;
  customer_phone: string;
  subject: string;
  status: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string | null;
}

export interface ChatRow {
  id: string;
  customer_phone: string;
  sender: string;
  message: string;
  chat_type: string | null;
  order_id: string | null;
  created_at: string | null;
}

export interface RatingRow {
  id: string;
  order_id: string;
  delegate_name: string | null;
  rating: number;
  comment: string | null;
  customer_phone: string | null;
  created_at: string | null;
}

export interface NoteRow {
  id: string;
  customer_phone: string;
  customer_name: string | null;
  order_id: string | null;
  note: string;
  note_type: string;
  visibility: string;
  status: string;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface TaskRow {
  id: string;
  customer_phone: string;
  customer_name: string | null;
  order_id: string | null;
  title: string;
  description: string | null;
  priority: 'low' | 'medium' | 'high' | string;
  status: 'open' | 'in_progress' | 'done' | 'cancelled' | string;
  due_at: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface AttachmentRow {
  id: string;
  customer_phone: string;
  customer_name: string | null;
  order_id: string | null;
  file_path: string;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  uploaded_at: string;
  note: string | null;
  status: string;
}

export interface AuditRow {
  id: string;
  order_id: string;
  order_num: string | null;
  action: string;
  field_changed: string | null;
  old_value: string | null;
  new_value: string | null;
  changed_by: string | null;
  changed_by_role: string | null;
  note: string | null;
  created_at: string | null;
}

// ─── Per-customer metric folding ─────────────────────────────────────────

const FINAL_STATUSES = new Set(['delivered', 'returned', 'cancelled']);
const IN_FLIGHT_STATUSES = new Set(['new', 'preparing', 'warehouse', 'shipping']);
const DELIVERED = 'delivered';
const RETURNED = 'returned';
const CANCELLED = 'cancelled';

export interface CustomerMetrics {
  totalOrders: number;
  totalSpent: number;
  deliveredCount: number;
  deliveredAmount: number;
  returnedCount: number;
  returnedAmount: number;
  cancelledCount: number;
  cancelledAmount: number;
  inFlightCount: number;
  /** Ratio of delivered orders to ALL orders that have reached a
   *  terminal state (delivered + returned + cancelled). Returns null
   *  when no terminal orders exist. */
  receiptRate: number | null;
  /** Ratio of returned to terminal orders. */
  returnRate: number | null;
  /** Ratio of cancelled to terminal orders. */
  cancelRate: number | null;
  openComplaints: number;
  totalComplaints: number;
  averageRating: number | null;
  ratingCount: number;
  /** Most recent activity timestamp across orders / complaints / chat
   *  / notes / ratings. Null when none. */
  lastContactAt: string | null;
  /** Description of the last contact for the dashboard row, e.g.
   *  "آخر طلب 2026-05-08". Empty string if none. */
  lastContactLabel: string;
}

/** Folds the slim slices into a per-customer metric block.
 *  Inputs are already filtered to the customer's phone — caller does
 *  the matching upstream. */
export function computeCustomerMetrics(input: {
  orders: ReadonlyArray<OrderRow>;
  complaints: ReadonlyArray<ComplaintRow>;
  chat: ReadonlyArray<ChatRow>;
  ratings: ReadonlyArray<RatingRow>;
  notes?: ReadonlyArray<NoteRow>;
}): CustomerMetrics {
  let totalSpent = 0;
  let deliveredCount = 0;
  let deliveredAmount = 0;
  let returnedCount = 0;
  let returnedAmount = 0;
  let cancelledCount = 0;
  let cancelledAmount = 0;
  let inFlightCount = 0;

  let lastTs = -Infinity;
  let lastLabel = '';

  for (const o of input.orders) {
    const total = Number(o.total ?? 0);
    if (o.status === DELIVERED) {
      deliveredCount += 1;
      deliveredAmount += total;
      totalSpent += total;
    } else if (o.status === RETURNED) {
      returnedCount += 1;
      returnedAmount += total;
    } else if (o.status === CANCELLED) {
      cancelledCount += 1;
      cancelledAmount += total;
    } else if (IN_FLIGHT_STATUSES.has(o.status)) {
      inFlightCount += 1;
    }
    if (o.created_at) {
      const t = Date.parse(o.created_at);
      if (!Number.isNaN(t) && t > lastTs) {
        lastTs = t;
        lastLabel = `آخر طلب ${o.created_at.slice(0, 10)}`;
      }
    }
  }

  for (const c of input.complaints) {
    if (c.created_at) {
      const t = Date.parse(c.created_at);
      if (!Number.isNaN(t) && t > lastTs) {
        lastTs = t;
        lastLabel = `شكوى ${c.created_at.slice(0, 10)}`;
      }
    }
  }
  for (const m of input.chat) {
    if (m.created_at) {
      const t = Date.parse(m.created_at);
      if (!Number.isNaN(t) && t > lastTs) {
        lastTs = t;
        lastLabel = `محادثة ${m.created_at.slice(0, 10)}`;
      }
    }
  }
  for (const r of input.ratings) {
    if (r.created_at) {
      const t = Date.parse(r.created_at);
      if (!Number.isNaN(t) && t > lastTs) {
        lastTs = t;
        lastLabel = `تقييم ${r.created_at.slice(0, 10)}`;
      }
    }
  }
  if (input.notes) {
    for (const n of input.notes) {
      if (n.created_at) {
        const t = Date.parse(n.created_at);
        if (!Number.isNaN(t) && t > lastTs) {
          lastTs = t;
          lastLabel = `ملاحظة ${n.created_at.slice(0, 10)}`;
        }
      }
    }
  }

  const terminalCount = deliveredCount + returnedCount + cancelledCount;
  const ratingSum = input.ratings.reduce((s, r) => s + Number(r.rating || 0), 0);
  const ratingCount = input.ratings.length;
  const openComplaints = input.complaints.filter(
    (c) => (c.status || 'open').toLowerCase() === 'open'
  ).length;

  return {
    totalOrders: input.orders.length,
    totalSpent,
    deliveredCount,
    deliveredAmount,
    returnedCount,
    returnedAmount,
    cancelledCount,
    cancelledAmount,
    inFlightCount,
    receiptRate: terminalCount > 0 ? deliveredCount / terminalCount : null,
    returnRate: terminalCount > 0 ? returnedCount / terminalCount : null,
    cancelRate: terminalCount > 0 ? cancelledCount / terminalCount : null,
    openComplaints,
    totalComplaints: input.complaints.length,
    averageRating: ratingCount > 0 ? ratingSum / ratingCount : null,
    ratingCount,
    lastContactAt: lastTs === -Infinity ? null : new Date(lastTs).toISOString(),
    lastContactLabel: lastLabel,
  };
}

/** Folds metrics for many customers at once. Returns a map keyed by
 *  normalised phone. */
export function computeMetricsByPhone(
  orders: ReadonlyArray<OrderRow>,
  complaints: ReadonlyArray<ComplaintRow>,
  chat: ReadonlyArray<ChatRow>,
  ratings: ReadonlyArray<RatingRow>
): Map<string, CustomerMetrics> {
  const byPhone = new Map<
    string,
    { orders: OrderRow[]; complaints: ComplaintRow[]; chat: ChatRow[]; ratings: RatingRow[] }
  >();

  function pick(p: string | null | undefined) {
    const n = normalisePhone(p);
    if (!n) return null;
    let entry = byPhone.get(n);
    if (!entry) {
      entry = { orders: [], complaints: [], chat: [], ratings: [] };
      byPhone.set(n, entry);
    }
    return entry;
  }

  for (const o of orders) {
    const e = pick(o.phone) || pick(o.phone2);
    if (e) e.orders.push(o);
  }
  for (const c of complaints) {
    const e = pick(c.customer_phone);
    if (e) e.complaints.push(c);
  }
  for (const m of chat) {
    const e = pick(m.customer_phone);
    if (e) e.chat.push(m);
  }
  for (const r of ratings) {
    const e = pick(r.customer_phone);
    if (e) e.ratings.push(r);
  }

  const out = new Map<string, CustomerMetrics>();
  for (const [phone, slice] of byPhone) {
    out.set(phone, computeCustomerMetrics(slice));
  }
  return out;
}

// ─── Customer table row (dashboard) ──────────────────────────────────────

export interface DashboardCustomerRow {
  key: string; // normalised phone
  customerCode: string;
  name: string;
  phone: string;
  email: string | null;
  type: string | null;
  status: string | null;
  vipLevel: string | null;
  accountManagerName: string | null;
  totalSpent: number;
  receiptRate: number | null;
  returnedAmount: number;
  cancelledAmount: number;
  lastNote: string | null;
  metrics: CustomerMetrics;
}

/** Build the dashboard row list from `customers` + the per-phone
 *  metrics map. A customer without any orders still appears with
 *  zero metrics — the dashboard wants to see every customer record. */
export function buildDashboardRows(
  customers: ReadonlyArray<CustomerRow>,
  metricsByPhone: Map<string, CustomerMetrics>,
  notesByPhone: Map<string, NoteRow | null>
): DashboardCustomerRow[] {
  const empty: CustomerMetrics = {
    totalOrders: 0,
    totalSpent: 0,
    deliveredCount: 0,
    deliveredAmount: 0,
    returnedCount: 0,
    returnedAmount: 0,
    cancelledCount: 0,
    cancelledAmount: 0,
    inFlightCount: 0,
    receiptRate: null,
    returnRate: null,
    cancelRate: null,
    openComplaints: 0,
    totalComplaints: 0,
    averageRating: null,
    ratingCount: 0,
    lastContactAt: null,
    lastContactLabel: '',
  };

  return customers
    .map((c, i) => {
      const phone = normalisePhone(c.phone) || c.phone;
      const m = metricsByPhone.get(phone) || empty;
      // Phase 24A-Fix1 — numeric code only (was "C-1001"). The
      // dashboard search still tolerates a "C-" prefix in the query
      // by stripping it client-side before comparing.
      const code = String(1001 + i);
      const note = notesByPhone.get(phone);
      // Phase 24A-Fix1 — derived classification + account status.
      // The dashboard surfaces these instead of the raw stored
      // columns so a fresh customer never shows up as "regular" or
      // perpetually "active" without grounded data.
      const derivedType = deriveCustomerClassification(c, m);
      const derivedStatus = deriveAccountStatus(c, m);
      return {
        key: phone,
        customerCode: code,
        name: c.full_name || phone || 'بدون اسم',
        phone,
        email: c.email,
        type: derivedType,
        status: derivedStatus,
        vipLevel: c.vip_level || null,
        accountManagerName: c.account_manager_name,
        totalSpent: Number(c.total_spent ?? m.totalSpent ?? 0),
        receiptRate: m.receiptRate,
        returnedAmount: m.returnedAmount,
        cancelledAmount: m.cancelledAmount,
        lastNote: note?.note ?? null,
        metrics: m,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}

// ─── Fleet (dashboard) KPI summary ───────────────────────────────────────

export interface DashboardKpis {
  totalCustomers: number;
  activeCustomers: number;
  inFlightOrders: number;
  openComplaints: number;
  receiptRate: number | null;
  returnedAmount: number;
  cancelledAmount: number;
  /** Count of audit-log rows whose `note` field is non-null in the
   *  selected window. Drives the "ملاحظات المناديب" card. */
  delegateNotesCount: number;
}

export function computeDashboardKpis(input: {
  customers: ReadonlyArray<CustomerRow>;
  orders: ReadonlyArray<OrderRow>;
  complaints: ReadonlyArray<ComplaintRow>;
  delegateNotesCount: number;
}): DashboardKpis {
  let inFlight = 0;
  let delivered = 0;
  let returned = 0;
  let cancelled = 0;
  let returnedAmount = 0;
  let cancelledAmount = 0;
  const recentPhones = new Set<string>();
  const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;

  for (const o of input.orders) {
    if (IN_FLIGHT_STATUSES.has(o.status)) inFlight += 1;
    if (o.status === DELIVERED) delivered += 1;
    if (o.status === RETURNED) {
      returned += 1;
      returnedAmount += Number(o.total ?? 0);
    }
    if (o.status === CANCELLED) {
      cancelled += 1;
      cancelledAmount += Number(o.total ?? 0);
    }
    if (o.created_at) {
      const t = Date.parse(o.created_at);
      if (!Number.isNaN(t) && t >= ninetyDaysAgo) {
        const np = normalisePhone(o.phone) || normalisePhone(o.phone2);
        if (np) recentPhones.add(np);
      }
    }
  }
  const terminal = delivered + returned + cancelled;
  const openComplaints = input.complaints.filter(
    (c) => (c.status || 'open').toLowerCase() === 'open'
  ).length;
  return {
    totalCustomers: input.customers.length,
    activeCustomers: recentPhones.size,
    inFlightOrders: inFlight,
    openComplaints,
    receiptRate: terminal > 0 ? delivered / terminal : null,
    returnedAmount,
    cancelledAmount,
    delegateNotesCount: input.delegateNotesCount,
  };
}

// ─── Labels ──────────────────────────────────────────────────────────────

export const ORDER_STATUS_LABEL_AR: Record<string, string> = {
  new: 'جديد',
  preparing: 'جاري التجهيز',
  warehouse: 'في المستودع',
  shipping: 'جاري الشحن',
  delivered: 'تم التسليم',
  returned: 'مرتجع',
  cancelled: 'ملغي',
};

export const ORDER_STATUS_TONE: Record<string, string> = {
  new: 'bg-slate-50 text-slate-700 border-slate-200',
  preparing: 'bg-blue-50 text-blue-700 border-blue-200',
  warehouse: 'bg-amber-50 text-amber-700 border-amber-200',
  shipping: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  delivered: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  returned: 'bg-red-50 text-red-700 border-red-200',
  cancelled: 'bg-gray-100 text-gray-700 border-gray-200',
};

export const COMPLAINT_STATUS_LABEL_AR: Record<string, string> = {
  open: 'مفتوحة',
  in_progress: 'قيد المعالجة',
  pending: 'بانتظار العميل',
  resolved: 'تم الحل',
  closed: 'مغلقة',
};

export const COMPLAINT_STATUS_TONE: Record<string, string> = {
  open: 'bg-red-50 text-red-700 border-red-200',
  in_progress: 'bg-amber-50 text-amber-700 border-amber-200',
  pending: 'bg-blue-50 text-blue-700 border-blue-200',
  resolved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  closed: 'bg-gray-100 text-gray-700 border-gray-200',
};

export const TASK_STATUS_LABEL_AR: Record<string, string> = {
  open: 'لم تبدأ',
  in_progress: 'قيد التنفيذ',
  done: 'مكتملة',
  cancelled: 'ملغاة',
};

export const TASK_STATUS_TONE: Record<string, string> = {
  open: 'bg-slate-100 text-slate-700 border-slate-200',
  in_progress: 'bg-blue-50 text-blue-700 border-blue-200',
  done: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  cancelled: 'bg-gray-100 text-gray-700 border-gray-200',
};

export const TASK_PRIORITY_LABEL_AR: Record<string, string> = {
  low: 'منخفضة',
  medium: 'متوسطة',
  high: 'عالية',
};

export const TASK_PRIORITY_TONE: Record<string, string> = {
  low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  high: 'bg-red-50 text-red-700 border-red-200',
};

// Phase 24A-Fix1 — derived classification + account status replace
// the all-`regular` fallback we shipped in Phase 24A. Both helpers
// are pure functions of (customer row, metrics) and never write back
// to the DB. The dashboard + profile surfaces derive on render so a
// new order automatically flips `inactive` → `active` without a job.

/** Derived classification token, in priority order. */
export type DerivedCustomerType = 'warning' | 'vip' | 'new' | 'active' | 'inactive' | 'regular';

export const CUSTOMER_TYPE_LABEL_AR: Record<string, string> = {
  warning: 'تحذير',
  vip: 'مميز',
  new: 'جديد',
  active: 'نشط',
  inactive: 'غير نشط',
  regular: 'عادي',
  // Legacy stored tokens (Phase 24A new-customer modal). These still
  // render with an Arabic label if a profile carries them as a static
  // override, but the dashboard always picks the derived token above.
  retail: 'تاجر تجزئة',
  wholesale: 'تاجر جملة',
  individual: 'فرد',
  business: 'عميل تجاري',
};

export const CUSTOMER_TYPE_TONE: Record<string, string> = {
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  vip: 'bg-violet-50 text-violet-700 border-violet-200',
  new: 'bg-blue-50 text-blue-700 border-blue-200',
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  inactive: 'bg-gray-100 text-gray-700 border-gray-200',
  regular: 'bg-slate-50 text-slate-700 border-slate-200',
  retail: 'bg-blue-50 text-blue-700 border-blue-200',
  wholesale: 'bg-violet-50 text-violet-700 border-violet-200',
  individual: 'bg-slate-50 text-slate-700 border-slate-200',
  business: 'bg-blue-50 text-blue-700 border-blue-200',
};

export type DerivedCustomerStatus = 'active' | 'inactive';

export const CUSTOMER_STATUS_LABEL_AR: Record<string, string> = {
  active: 'نشط',
  inactive: 'غير نشط',
  // Legacy stored tokens that might land in customer_status from the
  // Phase 24A "new-customer" modal. We render them with Arabic but
  // the derived `active`/`inactive` always wins on display.
  vip: 'مميز',
  warning: 'تحذير',
  blocked: 'محظور',
};

export const CUSTOMER_STATUS_TONE: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  inactive: 'bg-gray-100 text-gray-700 border-gray-200',
  vip: 'bg-violet-50 text-violet-700 border-violet-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  blocked: 'bg-red-50 text-red-700 border-red-200',
};

/** Activity window (in days) that flips a customer from "نشط" to
 *  "غير نشط". Spec calls for 3 months ≈ 90 days. */
export const ACTIVITY_WINDOW_DAYS = 90;
/** Window for "جديد" — first order within the last 30 days AND
 *  total orders is small (≤ 2). */
export const NEW_CUSTOMER_WINDOW_DAYS = 30;
/** VIP thresholds (any one is enough). */
const VIP_TOTAL_SPENT = 10_000;
const VIP_DELIVERED_ORDERS = 10;
/** Warning thresholds — applied first in the priority chain. */
const WARNING_RETURN_RATE = 0.3;
const WARNING_CANCEL_RATE = 0.3;

function isWithinDays(iso: string | null | undefined, days: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return t >= Date.now() - days * 24 * 60 * 60 * 1000;
}

/** Return the most recent activity timestamp across orders / chat /
 *  complaints / notes — used by the account-status helper. The
 *  metric bundle already captures this via `lastContactAt`. */
function newestOrderAt(metrics: CustomerMetrics, ordersHint?: string | null): string | null {
  if (metrics.lastContactAt) return metrics.lastContactAt;
  return ordersHint ?? null;
}

/**
 * Derive the dashboard classification token. Priority:
 *   1. تحذير  → return/cancel rate ≥ 30% OR open complaint
 *   2. مميز  → VIP thresholds
 *   3. جديد   → first order in last 30d AND ≤ 2 orders
 *   4. نشط    → last order in last 90d
 *   5. غير نشط → orders exist but none in last 90d
 *   6. عادي  → fallback (no orders at all)
 */
export function deriveCustomerClassification(
  customer: {
    customer_type?: string | null;
    vip_level?: string | null;
    created_at?: string | null;
  },
  metrics: CustomerMetrics
): DerivedCustomerType {
  if (
    (metrics.returnRate != null && metrics.returnRate >= WARNING_RETURN_RATE) ||
    (metrics.cancelRate != null && metrics.cancelRate >= WARNING_CANCEL_RATE) ||
    metrics.openComplaints > 0
  ) {
    return 'warning';
  }
  if (
    customer.vip_level != null && customer.vip_level !== ''
      ? true
      : metrics.totalSpent >= VIP_TOTAL_SPENT || metrics.deliveredCount >= VIP_DELIVERED_ORDERS
  ) {
    return 'vip';
  }
  const lastActivity = newestOrderAt(metrics);
  if (
    metrics.totalOrders > 0 &&
    metrics.totalOrders <= 2 &&
    isWithinDays(lastActivity, NEW_CUSTOMER_WINDOW_DAYS)
  ) {
    return 'new';
  }
  if (isWithinDays(lastActivity, ACTIVITY_WINDOW_DAYS)) {
    return 'active';
  }
  if (metrics.totalOrders === 0) {
    return 'regular';
  }
  return 'inactive';
}

/**
 * Derive the account-status flag from the latest activity timestamp.
 * No DB writes — purely a render-time projection. Falls back to
 * 'inactive' when the customer has no recorded activity.
 */
export function deriveAccountStatus(
  customer: { customer_status?: string | null },
  metrics: CustomerMetrics
): DerivedCustomerStatus {
  // Explicit admin override wins (e.g. blocked) — but we only honour
  // values that map cleanly to our two-state derived label.
  void customer;
  const lastActivity = newestOrderAt(metrics);
  return isWithinDays(lastActivity, ACTIVITY_WINDOW_DAYS) ? 'active' : 'inactive';
}

export function customerTypeLabel(token: string | null | undefined): string {
  if (!token) return '—';
  return CUSTOMER_TYPE_LABEL_AR[token] || token;
}

export function customerTypeTone(token: string | null | undefined): string {
  if (!token)
    return 'bg-[hsl(var(--muted))]/40 text-[hsl(var(--muted-foreground))] border-[hsl(var(--border))]';
  return (
    CUSTOMER_TYPE_TONE[token] ||
    'bg-[hsl(var(--muted))]/40 text-[hsl(var(--muted-foreground))] border-[hsl(var(--border))]'
  );
}

export function customerStatusLabel(token: string | null | undefined): string {
  if (!token) return '—';
  return CUSTOMER_STATUS_LABEL_AR[token] || token;
}
export function customerStatusTone(token: string | null | undefined): string {
  if (!token)
    return 'bg-[hsl(var(--muted))]/40 text-[hsl(var(--muted-foreground))] border-[hsl(var(--border))]';
  return (
    CUSTOMER_STATUS_TONE[token] ||
    'bg-[hsl(var(--muted))]/40 text-[hsl(var(--muted-foreground))] border-[hsl(var(--border))]'
  );
}

// ─── Money / rate formatters ─────────────────────────────────────────────

// Phase 24A-Fix1 — Egyptian Pound, not Saudi Riyal. The Phase 24A
// helper shipped with `ر.س` by mistake; every customer-CRM surface
// goes through these two formatters so flipping the suffix here
// updates the dashboard, profile cards, table cells, and CSV in one
// edit.
const EGP_SUFFIX = 'ج.م';

export function fmtMoney(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  return `${n.toLocaleString('en-US')} ${EGP_SUFFIX}`;
}

/** Compact money for KPI cards, e.g. 4,250 ج.م. */
export function fmtMoneyShort(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  return `${Math.round(n).toLocaleString('en-US')} ${EGP_SUFFIX}`;
}

export function fmtRate(value: number | null | undefined, fallback = '—'): string {
  if (value == null || Number.isNaN(value)) return fallback;
  const pct = value * 100;
  return `${pct.toFixed(1)}%`;
}

export function fmtDateYmd(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fmtDateTimeAr(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  return new Date(t).toLocaleString('ar-EG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

// ─── CSV serialisation (dashboard export) ────────────────────────────────

function csvField(raw: string | number | null | undefined): string {
  if (raw == null) return '';
  const s = typeof raw === 'string' ? raw : String(raw);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Build the CSV body for the dashboard customers list.
 *  Sensitive internal fields (notes, account-manager id, ratings
 *  comments) are intentionally excluded — only the dashboard's
 *  visible columns plus a small set of derived metrics. */
export function customersToCsv(rows: ReadonlyArray<DashboardCustomerRow>): string {
  const out: string[] = [];
  out.push(
    [
      'كود العميل',
      'اسم العميل',
      'الهاتف',
      'البريد الإلكتروني',
      'نوع العميل',
      'حالة الحساب',
      'مسؤول الحساب',
      'إجمالي المشتريات',
      'نسبة الاستلام',
      'المرتجعات (ج.م)',
      'الإلغاء (ج.م)',
      'الطلبات الجارية',
      'الشكاوى المفتوحة',
    ].join(',')
  );
  for (const r of rows) {
    out.push(
      [
        csvField(r.customerCode),
        csvField(r.name),
        csvField(r.phone),
        csvField(r.email ?? ''),
        csvField(r.type ?? ''),
        csvField(r.status ?? ''),
        csvField(r.accountManagerName ?? ''),
        csvField(Math.round(r.totalSpent)),
        csvField(r.receiptRate == null ? '' : (r.receiptRate * 100).toFixed(1) + '%'),
        csvField(Math.round(r.returnedAmount)),
        csvField(Math.round(r.cancelledAmount)),
        csvField(r.metrics.inFlightCount),
        csvField(r.metrics.openComplaints),
      ].join(',')
    );
  }
  return out.join('\r\n');
}

export function customersCsvFilename(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `customers-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.csv`;
}

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
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─── Timeline (profile page) ─────────────────────────────────────────────

export type TimelineKind =
  | 'order'
  | 'order_status'
  | 'complaint'
  | 'chat'
  | 'note'
  | 'task'
  | 'rating'
  | 'attachment';

export interface TimelineEntry {
  id: string;
  kind: TimelineKind;
  date: string;
  label: string;
  description: string;
  reference?: string;
  /** Optional small tone hint (emerald / amber / red / blue). */
  tone?: 'emerald' | 'amber' | 'red' | 'blue' | 'slate';
}

export function buildTimeline(input: {
  orders: ReadonlyArray<OrderRow>;
  complaints: ReadonlyArray<ComplaintRow>;
  chat: ReadonlyArray<ChatRow>;
  notes: ReadonlyArray<NoteRow>;
  tasks: ReadonlyArray<TaskRow>;
  ratings: ReadonlyArray<RatingRow>;
  attachments: ReadonlyArray<AttachmentRow>;
  audits: ReadonlyArray<AuditRow>;
}): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  for (const o of input.orders) {
    if (o.created_at) {
      out.push({
        id: `order:${o.id}`,
        kind: 'order',
        date: o.created_at,
        label: 'طلب جديد',
        reference: o.order_num,
        description: `تم إنشاء طلب ${o.order_num} بقيمة ${fmtMoneyShort(o.total)}`,
        tone: 'blue',
      });
    }
  }
  for (const a of input.audits) {
    if (a.created_at && a.action) {
      out.push({
        id: `audit:${a.id}`,
        kind: 'order_status',
        date: a.created_at,
        label: 'تحديث طلب',
        reference: a.order_num ?? undefined,
        description:
          a.note ||
          (a.field_changed
            ? `${a.field_changed}: ${a.old_value || '—'} → ${a.new_value || '—'}`
            : a.action),
        tone: 'slate',
      });
    }
  }
  for (const c of input.complaints) {
    if (c.created_at) {
      out.push({
        id: `complaint:${c.id}`,
        kind: 'complaint',
        date: c.created_at,
        label: 'شكوى',
        description: c.subject || 'شكوى عميل',
        tone: 'red',
      });
    }
  }
  for (const m of input.chat) {
    if (m.created_at) {
      out.push({
        id: `chat:${m.id}`,
        kind: 'chat',
        date: m.created_at,
        label: 'رسالة',
        reference: m.order_id ?? undefined,
        description:
          (m.sender === 'customer' ? 'العميل: ' : 'الدعم: ') + (m.message?.slice(0, 80) || ''),
        tone: 'blue',
      });
    }
  }
  for (const n of input.notes) {
    out.push({
      id: `note:${n.id}`,
      kind: 'note',
      date: n.created_at,
      label: 'ملاحظة',
      description: n.note,
      tone: 'amber',
    });
  }
  for (const t of input.tasks) {
    out.push({
      id: `task:${t.id}`,
      kind: 'task',
      date: t.created_at,
      label: 'مهمة',
      description: t.title,
      tone: t.priority === 'high' ? 'red' : 'amber',
    });
  }
  for (const r of input.ratings) {
    if (r.created_at) {
      out.push({
        id: `rating:${r.id}`,
        kind: 'rating',
        date: r.created_at,
        label: 'تقييم',
        description: `${r.rating} نجوم${r.comment ? ` — ${r.comment.slice(0, 60)}` : ''}`,
        tone: 'emerald',
      });
    }
  }
  for (const at of input.attachments) {
    out.push({
      id: `att:${at.id}`,
      kind: 'attachment',
      date: at.uploaded_at,
      label: 'مرفق',
      description: at.file_name || at.file_path,
      tone: 'slate',
    });
  }
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return out;
}
