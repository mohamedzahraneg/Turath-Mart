// =============================================================================
// /track/t/[token]/page.tsx — Phase 13C
//
// Token-keyed counterpart of /track/[orderId]/page.tsx. Functionally
// identical UI, with three differences:
//   1. Looks up the order via the new /api/track-token/<token> endpoint
//      (which proxies to public.get_tracking_info_by_token(uuid)).
//   2. Generates print-invoice tracking links pointing back at /track/t/<token>
//      so customers re-shared invoices keep the unguessable URL.
//   3. The "not found" state never echoes the raw UUID back to the user
//      (would be confusing — token is not an order number).
//
// Indexing is suppressed via the sibling layout.tsx (export const metadata).
//
// The legacy /track/[orderId] route is intentionally NOT modified — old
// links keep working unchanged for backward compatibility during the
// deprecation window.
// =============================================================================

'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
// Phase Egress-Fix1 — unified line-image URL resolution (uses the
// existing /api/track-token/<token>/line-image/<idx> proxy for
// storage-backed lines on this surface).
import { resolveLineImageUrl } from '@/lib/orders/lineImage';
// Phase 24B-Fix1 — convert Arabic-Indic / Persian digits to ASCII as
// the customer types the complaint phone, matching the rule applied
// across the admin-facing Add Order modal + customer CRM dashboard.
import { sanitizePhoneInput } from '@/lib/phone/egyptPhone';
import {
  checkoutDetailsLines,
  installationSummaryLabel,
  paymentStatusLabel,
  previewModeLabel,
  type CheckoutDetails,
} from '@/lib/orders/checkoutDetails';
import Image from 'next/image';
import {
  Package,
  MapPin,
  User,
  Phone,
  Clock,
  CheckCircle,
  Truck,
  Warehouse,
  ClipboardList,
  XCircle,
  RotateCcw,
  RefreshCw,
  MessageCircle,
  Navigation,
  Star,
  Shield,
  Send,
  ChevronDown,
  AlertCircle,
  Headphones,
  X,
  Download,
  FileText,
  Award,
  // Phase Tracking-Lines-1 — icons for the polished checkout details
  // card (preview / installation / discount / payment / totals).
  Eye,
  Wrench,
  Percent,
  Wallet,
} from 'lucide-react';
// Phase 22Q — Arabic-locale formatters for the customer-facing
// delivery schedule card.
import { formatScheduleDateShortAr, formatTime12hAr } from '@/lib/orders/scheduleFormat';

interface TrackingOrder {
  orderNum: string;
  customer: string;
  /** Phase 22H: comes pre-masked from the RPC, e.g. `0101****678`. */
  phone: string;
  region: string;
  district?: string;
  // Phase 22N-Fix3 — optional neighborhood / village / shiakha.
  // Mirror of the field on the admin-facing tracking page. The public
  // token-tracking RPC currently DOES NOT expose this field (mirrors
  // the privacy model that already redacts `district`); declared here
  // so the render stays consistent across both tracking pages and so
  // a future RPC update can surface it without a type change.
  neighborhood?: string | null;
  address: string;
  products: string;
  quantity: number;
  total: number;
  subtotal?: number;
  shippingFee?: number;
  checkoutDetails?: CheckoutDetails | null;
  // Phase 22H — additional totals exposed by the widened token RPC.
  extraShippingFee?: number;
  freeShipping?: boolean;
  status: string;
  date: string;
  time: string;
  // Phase 22H — ISO timestamp from `turath_masr_orders.created_at`.
  // Used for the "تم إنشاء الطلب يوم …" line shown next to orderNum.
  createdAt?: string;
  notes?: string;
  warranty?: string;
  delegate?: string;
  delegatePhone?: string;
  delegateRating?: number;
  eta?: string;
  deliveryNotes?: string;
  // Phase 22Q — customer-facing delivery schedule. Populated only
  // when an admin has saved a window via StatusUpdateModal AND the
  // companion migration has been applied. The reason is the
  // (optional) reschedule reason; first-time scheduling has it as
  // null.
  scheduledDelivery?: {
    date: string;
    from: string;
    to: string;
    reason: string | null;
  } | null;
  lines?: {
    productType: string;
    label: string;
    // Phase 22H: `image` and `note` are stripped server-side from the
    // public token RPC. Kept on the type for backward-compat with the
    // invoice/warranty PDF builder which still consumes the same shape
    // when populated from staff-side flows.
    image?: string | null;
    // Phase Egress-Fix1 — replaces inline `image` for cleaned rows.
    image_source?: 'inventory' | 'storage' | 'none';
    image_path?: string | null;
    emoji?: string;
    color?: string | null;
    quantity: number;
    unitPrice: number;
    includeFlashlight?: boolean;
    flashlightPrice?: number;
    // Phase Tracking-Lines-1 — `note` removed. The public RPC strips
    // per-line notes server-side; declaring it on this DTO type
    // invited dead conditional renders (and a now-removed PDF
    // builder branch) that suggested customer-facing exposure of
    // staff-only annotations. Notes remain internal admin content
    // and are reachable only from staff-side flows.
    total: number;
  }[];
}

interface StatusStep {
  key: string;
  label: string;
  icon: React.ReactNode;
  description: string;
  timestamp?: string;
  completed: boolean;
  active: boolean;
}

const STATUS_FLOW = ['new', 'preparing', 'warehouse', 'shipping', 'delivered'];

// Phase 22H: format an ISO timestamp into the Arabic creation-line shown
// next to the order number. Example output:
//   "يوم السبت، 9 مايو 2026، الساعة 03:45:22 مساءً"
// Uses the user's local timezone — same convention as the existing
// `order.date` / `order.time` strings further down the page. Returns
// an empty string for invalid/missing input so the JSX can `&&` it out.
const AR_DAY_NAMES = [
  'الأحد',
  'الاثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
  'السبت',
] as const;
const AR_MONTH_NAMES = [
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

// Phase 22H-Fix1: per-line product thumbnail on the token tracking
// page. Source bytes come from /api/track-token/[token]/line-image/
// [index], which decodes the base64 stored on the line and serves
// it with `Cache-Control: public, max-age=86400, immutable` — so the
// 30-second polling DTO stays slim while the image still appears in
// the row. `unoptimized` skips next/image's resize pipeline (the
// stored images are already small JPEGs and the route is same-origin
// so optimisation adds latency without compression wins). On any
// load error we fall back to the existing emoji placeholder.
function TrackLineImage({
  token,
  index,
  emoji,
  alt,
}: {
  token: string;
  index: number;
  emoji?: string;
  alt: string;
}) {
  const [errored, setErrored] = React.useState(false);
  if (errored) {
    return <span className="text-xl">{emoji || '📦'}</span>;
  }
  return (
    <Image
      src={`/api/track-token/${encodeURIComponent(token)}/line-image/${index}`}
      alt={alt}
      width={44}
      height={44}
      unoptimized
      onError={() => setErrored(true)}
      className="w-full h-full object-cover"
    />
  );
}

// Phase Tracking-Lines-1 — structured customer-facing card for the
// new `checkout_details` envelope. Renders directly from the parsed
// `CheckoutDetails` object the public RPC carved out of the
// marker block (`[[TURATH_CHECKOUT_DETAILS_V1]]…[[/…]]`); it never
// reads raw `notes`.
//
// Layout
// ------
// The card is split into up-to-four sub-sections; each only shows
// when it carries customer-relevant data:
//   • المعاينة والتركيب — preview-mode label + (when applicable) the
//     installation summary line.
//   • الخصم — only when `details.discount.amount > 0`. Surfaces the
//     amount, reason, and the staff member who applied it.
//   • الدفع — payment status pill + the paid / remaining amounts +
//     method + recipient. Skips method / paid / remaining lines
//     when the status is `unpaid`.
//   • الإجمالي — gross_total, discount line (if > 0), final_total.
//
// We render via small in-file helpers (no new shared component) so
// the file stays self-contained.
function CheckoutDetailsCard({ details }: { details: CheckoutDetails }) {
  const installation = installationSummaryLabel(details);
  const showDiscount = details.discount.amount > 0;
  const paymentStatus = details.payment.status;
  return (
    <div className="bg-white rounded-2xl border border-blue-200 shadow-sm p-4 space-y-3">
      <div className="flex items-center gap-2">
        <FileText size={16} className="text-[hsl(211,67%,28%)]" />
        <h2 className="font-bold text-sm text-[hsl(var(--foreground))]">تفاصيل المعاينة والدفع</h2>
      </div>

      {/* Preview + installation. Always rendered (preview mode is
          always known; "بدون معاينة" is the safe default). */}
      <section className="rounded-xl border border-blue-100 bg-blue-50 p-3 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Eye size={13} className="text-blue-700" />
          <h3 className="text-xs font-bold text-blue-900">المعاينة والتركيب</h3>
        </div>
        <CheckoutRow label="نوع المعاينة" value={previewModeLabel(details.preview_mode)} />
        {installation && (
          <CheckoutRow
            icon={<Wrench size={11} className="text-blue-700" />}
            label="تركيب الحامل"
            value={installation}
          />
        )}
      </section>

      {showDiscount && (
        <section className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Percent size={13} className="text-emerald-700" />
            <h3 className="text-xs font-bold text-emerald-900">الخصم</h3>
          </div>
          <CheckoutRow
            label="قيمة الخصم"
            value={formatMoney(details.discount.amount)}
            tone="emerald"
          />
          {details.discount.reason && (
            <CheckoutRow label="السبب" value={details.discount.reason} tone="emerald" />
          )}
          {details.discount.by && (
            <CheckoutRow label="بواسطة" value={details.discount.by} tone="emerald" />
          )}
        </section>
      )}

      <section className="rounded-xl border border-indigo-100 bg-indigo-50 p-3 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Wallet size={13} className="text-indigo-700" />
          <h3 className="text-xs font-bold text-indigo-900">الدفع</h3>
        </div>
        <CheckoutRow
          label="الحالة"
          value={paymentStatusLabel(paymentStatus)}
          tone="indigo"
          emphasis
        />
        {paymentStatus !== 'unpaid' && (
          <>
            <CheckoutRow
              label="المدفوع"
              value={formatMoney(details.payment.paid_amount)}
              tone="indigo"
            />
            <CheckoutRow
              label="المتبقي"
              value={formatMoney(details.payment.remaining_amount)}
              tone="indigo"
            />
            {details.payment.method && (
              <CheckoutRow label="وسيلة الدفع" value={details.payment.method} tone="indigo" />
            )}
            {details.payment.paid_to && (
              <CheckoutRow label="مدفوع إلى" value={details.payment.paid_to} tone="indigo" />
            )}
          </>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1.5">
        <h3 className="text-xs font-bold text-slate-900">الإجمالي</h3>
        <CheckoutRow
          label="الإجمالي قبل الخصم"
          value={formatMoney(details.totals.gross_total)}
          tone="slate"
        />
        {details.totals.discount > 0 && (
          <CheckoutRow
            label="الخصم"
            value={`- ${formatMoney(details.totals.discount)}`}
            tone="slate"
          />
        )}
        <CheckoutRow
          label="الإجمالي النهائي"
          value={formatMoney(details.totals.final_total)}
          tone="slate"
          emphasis
        />
      </section>
    </div>
  );
}

type CheckoutRowTone = 'blue' | 'emerald' | 'indigo' | 'slate';

const CHECKOUT_ROW_TONES: Record<CheckoutRowTone, { label: string; value: string }> = {
  blue: { label: 'text-blue-800', value: 'text-blue-900' },
  emerald: { label: 'text-emerald-800', value: 'text-emerald-900' },
  indigo: { label: 'text-indigo-800', value: 'text-indigo-900' },
  slate: { label: 'text-slate-700', value: 'text-slate-900' },
};

function CheckoutRow({
  label,
  value,
  tone = 'blue',
  icon,
  emphasis = false,
}: {
  label: string;
  value: string;
  tone?: CheckoutRowTone;
  icon?: React.ReactNode;
  emphasis?: boolean;
}) {
  const palette = CHECKOUT_ROW_TONES[tone];
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <div className={`flex items-center gap-1.5 ${palette.label}`}>
        {icon}
        <span>{label}</span>
      </div>
      <span
        className={`${palette.value} ${emphasis ? 'font-bold' : 'font-semibold'} ${
          emphasis ? 'text-sm' : ''
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function formatMoney(value: number): string {
  return `${Number(value || 0).toLocaleString('en-US')} ج.م`;
}

function formatCreationTimestamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = AR_DAY_NAMES[d.getDay()];
  const date = `${d.getDate()} ${AR_MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
  const h24 = d.getHours();
  const period = h24 >= 12 ? 'مساءً' : 'صباحاً';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const hh = String(h12).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `يوم ${day}، ${date}، الساعة ${hh}:${mm}:${ss} ${period}`;
}

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; bg: string; border: string; description: string }
> = {
  new: {
    label: 'تم استلام الطلب',
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    description: 'تم تسجيل طلبك بنجاح وهو قيد المراجعة',
  },
  preparing: {
    label: 'جاري التجهيز',
    color: 'text-amber-600',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    description: 'يتم الآن تجهيز طلبك وتغليفه بعناية',
  },
  warehouse: {
    label: 'في المستودع',
    color: 'text-purple-600',
    bg: 'bg-purple-50',
    border: 'border-purple-200',
    description: 'طلبك جاهز في المستودع وينتظر المندوب',
  },
  shipping: {
    label: 'في الطريق إليك',
    color: 'text-[hsl(211,67%,28%)]',
    bg: 'bg-blue-50',
    border: 'border-blue-300',
    description: 'المندوب في الطريق لتوصيل طلبك الآن',
  },
  delivered: {
    label: 'تم التسليم',
    color: 'text-green-600',
    bg: 'bg-green-50',
    border: 'border-green-200',
    description: 'تم تسليم طلبك بنجاح. شكراً لثقتك بنا!',
  },
  cancelled: {
    label: 'ملغي',
    color: 'text-red-600',
    bg: 'bg-red-50',
    border: 'border-red-200',
    description: 'تم إلغاء هذا الطلب',
  },
  returned: {
    label: 'مرتجع',
    color: 'text-orange-600',
    bg: 'bg-orange-50',
    border: 'border-orange-200',
    description: 'تم إرجاع هذا الطلب',
  },
};

const COMPLAINT_REASONS = [
  'تأخر التوصيل',
  'المنتج تالف أو مكسور',
  'المنتج لا يطابق الوصف',
  'المندوب غير محترم',
  'خطأ في الطلب (منتج خاطئ)',
  'لم يتم التسليم',
  'مشكلة في الدفع',
  'أخرى',
];

// ─── Phase 15 — customer-side chat & complaint forms ─────────────────────────
//
// Phase 14 (PR #7) added two SECURITY DEFINER RPCs and matching POST routes:
//   POST /api/customer/chat        → submit_customer_chat
//   POST /api/customer/complaints  → submit_customer_complaint
// Phase 14A then hardened them with phone normalisation, length caps,
// per-phone rate limits, global caps, and duplicate guards.
//
// The legacy widgets used the browser anon Supabase client to .insert()
// directly into turath_masr_crm_chat / turath_masr_crm_complaints and to
// subscribe to realtime updates on those tables. After Phase 3 RLS
// hardening (20260505c) those direct writes silently fail, and there is
// intentionally NO public read path (no SELECT RPC), so realtime/history
// rendering would always show empty.
//
// The new components below are write-only forms that call the Phase 14
// API routes. The customer must enter their own phone — the public
// tracking DTO never returns it (PII). On success we show a confirmation
// banner; we do not attempt to render staff replies (they reach the
// customer through the existing WhatsApp channel managed by CRM staff).
// ─────────────────────────────────────────────────────────────────────────────

const PHONE_RE = /^[0-9+ ]{5,32}$/;

const CHAT_ERR_MAP: Record<string, string> = {
  invalid_input: 'بيانات غير صحيحة. تحقق من رقم الهاتف والرسالة.',
  duplicate_submission: 'لقد أرسلت نفس الرسالة قبل قليل.',
  rate_limited: 'تم تجاوز حد الإرسال. حاول مرة أخرى بعد قليل.',
  internal_error: 'تعذر الإرسال الآن. حاول مرة أخرى.',
};

const COMPLAINT_ERR_MAP: Record<string, string> = {
  invalid_input: 'بيانات غير صحيحة. تحقق من رقم الهاتف وسبب الشكوى.',
  duplicate_submission: 'لقد أرسلت نفس الشكوى قبل قليل.',
  rate_limited: 'تم تجاوز حد الإرسال. حاول مرة أخرى بعد قليل.',
  internal_error: 'تعذر إرسال الشكوى الآن. حاول مرة أخرى.',
};

type SubmitStatus = { kind: 'idle' | 'success' | 'error'; text?: string };

// ─── Phase 23A — Delivery rating panel ─────────────────────────────────────
interface DeliveryRatingPanelProps {
  token: string;
  delegate?: string;
}

const RATING_STORAGE_PREFIX = 'turath:delivery_rating:v1:';

function DeliveryRatingPanel({ token, delegate }: DeliveryRatingPanelProps) {
  const storageKey = `${RATING_STORAGE_PREFIX}${token}`;
  const [hover, setHover] = useState<number>(0);
  const [rating, setRating] = useState<number>(0);
  const [comment, setComment] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitted, setSubmitted] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  // Re-show "thank you" when the customer reloads after a previous
  // submission. We persist a tiny marker keyed by tracking token in
  // sessionStorage so the indicator survives a soft reload but
  // disappears when the browser tab closes.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const flag = window.sessionStorage.getItem(storageKey);
      if (flag === 'submitted') setSubmitted(true);
    } catch {
      // sessionStorage may be disabled (Safari private mode) — ignored.
    }
  }, [storageKey]);

  const onSubmit = async () => {
    if (submitting) return;
    if (rating < 1 || rating > 5) {
      setError('برجاء اختيار عدد النجوم');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/customer/rating', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tracking_token: token,
          rating,
          comment: comment.trim() || null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        setSubmitted(true);
        try {
          if (typeof window !== 'undefined') {
            window.sessionStorage.setItem(storageKey, 'submitted');
          }
        } catch {
          // ignore
        }
      } else {
        const msg =
          data.error === 'not_delivered'
            ? 'يمكن التقييم بعد التسليم فقط.'
            : data.error === 'not_found'
              ? 'تعذر التحقق من الطلب.'
              : 'تعذر إرسال التقييم. حاول مرة أخرى.';
        setError(msg);
      }
    } catch {
      setError('تعذر الاتصال بالخادم. حاول مرة أخرى.');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl shadow-sm p-4">
        <div className="flex items-center gap-2 mb-1">
          <CheckCircle size={16} className="text-emerald-700" />
          <h2 className="font-bold text-sm text-emerald-800">تم استلام تقييمك</h2>
        </div>
        <p className="text-xs text-emerald-700">شكرًا لمساعدتنا في تحسين تجربة التوصيل.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-[hsl(var(--border))] shadow-sm p-4">
      <div className="flex items-center gap-2 mb-2">
        <Star size={16} className="text-amber-500" />
        <h2 className="font-bold text-sm text-[hsl(var(--foreground))]">قيّم تجربة التوصيل</h2>
      </div>
      <p className="text-xs text-[hsl(var(--muted-foreground))] mb-3">
        رأيك يساعدنا على تحسين الخدمة{delegate ? ` ومتابعة أداء المندوب ${delegate}` : ''}.
      </p>
      <div
        className="flex items-center gap-1 mb-3"
        onMouseLeave={() => setHover(0)}
        role="radiogroup"
        aria-label="تقييم تجربة التوصيل"
      >
        {[1, 2, 3, 4, 5].map((n) => {
          const filled = (hover || rating) >= n;
          return (
            <button
              key={n}
              type="button"
              onClick={() => setRating(n)}
              onMouseEnter={() => setHover(n)}
              className="p-1 transition-transform hover:scale-110"
              aria-label={`${n} نجوم`}
              aria-checked={rating === n}
              role="radio"
            >
              <Star
                size={28}
                className={filled ? 'text-amber-500' : 'text-gray-300'}
                fill={filled ? 'currentColor' : 'none'}
              />
            </button>
          );
        })}
      </div>
      <textarea
        rows={3}
        value={comment}
        onChange={(e) => setComment(e.target.value.slice(0, 1000))}
        placeholder="ملاحظتك عن تجربة التوصيل (اختياري)"
        className="w-full input-field resize-none text-sm"
      />
      {error && <p className="text-xs text-red-600 mt-2 font-semibold">{error}</p>}
      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting || rating < 1}
        className={`mt-3 w-full justify-center ${submitting || rating < 1 ? 'btn-secondary opacity-60 cursor-not-allowed' : 'btn-primary'}`}
      >
        {submitting ? 'جارٍ الإرسال...' : 'إرسال التقييم'}
      </button>
      <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-2 text-center">
        لتقديم شكوى عن التوصيل استخدم زر &quot;تقديم شكوى&quot; أسفل الصفحة.
      </p>
    </div>
  );
}

// ─── Phase 23K — order-scoped chat ─────────────────────────────────────────
//
// The legacy "write-only" panel asked the customer to retype their phone
// on every submit and never showed any history (Phase 14 explicitly had
// no public read path). Phase 23K introduces two SECURITY DEFINER RPCs
// keyed off the tracking token:
//
//   • get_order_chat_by_token(token, chat_type, limit) — reads at most
//     200 most-recent rows scoped to THIS order, never exposes the
//     customer phone or other order's messages.
//   • submit_order_chat_by_token(token, message, chat_type) — writes a
//     row, hard-pinning sender='customer' and deriving phone+order_id
//     from the token; same rate / duplicate / length guards as
//     Phase 14A's `submit_customer_chat`.
//
// Both are GRANTed to anon (the browser uses the public anon key here),
// so this panel can call them directly without a Next.js API route in
// between. Realtime via postgres_changes is intentionally NOT used: the
// chat table's existing RLS doesn't grant SELECT to anon, so a
// subscription would receive zero events. We poll instead — every 10s
// while the panel is open, cancelled on close.

interface ChatPanelProps {
  type: 'delegate' | 'support';
  /** Tracking token of the order this panel is bound to. The token is
   *  the access proof — the customer never re-enters their phone. */
  token: string;
  order: TrackingOrder;
  onClose: () => void;
}

interface ChatMessageRow {
  id: string;
  sender: string;
  message: string;
  chat_type: string;
  created_at: string;
}

function formatChatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('ar-EG', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function ChatPanel({ type, token, order, onClose }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<SubmitStatus>({ kind: 'idle' });
  const bottomRef = useRef<HTMLDivElement | null>(null);
  // We only auto-scroll on real fetches (not on the optimistic append
  // we already issued ourselves) so the user can scroll up to read
  // history without being yanked back to the bottom every 10s.
  const lastFetchAtRef = useRef<number>(0);

  const fetchMessages = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('get_order_chat_by_token', {
        p_tracking_token: token,
        p_chat_type: type,
        p_limit: 200,
      });
      if (!error && Array.isArray(data)) {
        const rows = data as ChatMessageRow[];
        // Replace state only if the row count or last id differs — saves
        // a render when nothing changed on the 10s tick.
        setMessages((prev) => {
          if (
            prev.length === rows.length &&
            prev[prev.length - 1]?.id === rows[rows.length - 1]?.id
          ) {
            return prev;
          }
          lastFetchAtRef.current = Date.now();
          return rows;
        });
      }
    } catch {
      // swallow — keep showing whatever we had
    } finally {
      setLoading(false);
    }
  }, [token, type]);

  useEffect(() => {
    fetchMessages();
    const id = window.setInterval(fetchMessages, 10000);
    return () => window.clearInterval(id);
  }, [fetchMessages]);

  // Scroll to bottom on (a) initial load, (b) a real new message.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const sendMessage = async () => {
    if (submitting) return;
    const msgT = input.trim();
    if (msgT.length === 0) {
      setStatus({ kind: 'error', text: 'يرجى كتابة رسالة.' });
      return;
    }
    if (msgT.length > 1000) {
      setStatus({ kind: 'error', text: 'الرسالة طويلة جدًا (الحد 1000 حرف).' });
      return;
    }

    setSubmitting(true);
    setStatus({ kind: 'idle' });
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc('submit_order_chat_by_token', {
        p_tracking_token: token,
        p_message: msgT,
        p_chat_type: type,
      });
      if (error) {
        // Phase 14A error contract — the new RPC raises the same set.
        const code = (error as { code?: string }).code || '';
        const msg = (error as { message?: string }).message || '';
        let kind = 'internal_error';
        if (msg === 'duplicate_submission') kind = 'duplicate_submission';
        else if (msg === 'rate_limited') kind = 'rate_limited';
        else if (
          code === '22023' ||
          /^(invalid_phone|empty_message|message_too_long|invalid_token)$/.test(msg)
        ) {
          kind = 'invalid_input';
        }
        setStatus({
          kind: 'error',
          text: CHAT_ERR_MAP[kind] || 'تعذر الإرسال. حاول مرة أخرى.',
        });
      } else {
        setInput('');
        setStatus({ kind: 'idle' });
        // Refetch immediately so the new row shows without waiting for
        // the next poll tick.
        await fetchMessages();
      }
    } catch {
      setStatus({ kind: 'error', text: 'تعذر الاتصال. تحقق من الإنترنت وحاول مجددًا.' });
    }
    setSubmitting(false);
  };

  const title = type === 'delegate' ? `محادثة مع ${order.delegate || 'المندوب'}` : 'خدمة العملاء';
  const accent = type === 'delegate' ? 'bg-[hsl(211,67%,28%)]' : 'bg-emerald-600';
  const accentHover = type === 'delegate' ? 'hover:bg-[hsl(211,67%,22%)]' : 'hover:bg-emerald-700';
  const focusRing =
    type === 'delegate' ? 'focus:ring-[hsl(211,67%,28%)]' : 'focus:ring-emerald-400';
  const avatarLetter = type === 'delegate' ? order.delegate?.charAt(0) || 'م' : 'خ';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-0 sm:p-4"
      dir="rtl"
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative bg-white w-full sm:max-w-md sm:rounded-2xl flex flex-col shadow-2xl"
        style={{ height: '90vh', maxHeight: '700px' }}
      >
        <div
          className={`flex items-center gap-3 px-4 py-3 ${accent} sm:rounded-t-2xl flex-shrink-0`}
        >
          <div className="w-10 h-10 rounded-full bg-white/20 border-2 border-white/30 flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
            {avatarLetter}
          </div>
          <div className="flex-1">
            <p className="text-white font-bold text-sm">{title}</p>
            <p className="text-white/70 text-xs">طلب {order.orderNum}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
            aria-label="إغلاق"
          >
            <X size={18} className="text-white" />
          </button>
        </div>

        {/* Messages list — scrollable, takes the remaining height */}
        <div className="flex-1 overflow-y-auto bg-gray-50 px-3 py-3 space-y-2">
          {loading ? (
            <p className="text-xs text-center text-gray-400 py-8">جارٍ التحميل…</p>
          ) : messages.length === 0 ? (
            <div className="text-center text-gray-400 py-8 px-4">
              <MessageCircle size={28} className="mx-auto mb-2 opacity-40" />
              <p className="text-xs leading-relaxed">
                لا توجد رسائل بعد. اكتب أول رسالة أدناه — سيتواصل معك فريقنا قريبًا.
              </p>
            </div>
          ) : (
            messages.map((m) => {
              const isCustomer = m.sender === 'customer';
              return (
                <div
                  key={m.id}
                  className={`max-w-[80%] rounded-2xl px-3 py-2 shadow-sm ${
                    isCustomer
                      ? `${accent} text-white ml-auto rounded-bl-md`
                      : 'bg-white border border-gray-200 text-gray-800 mr-auto rounded-br-md'
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
                    {m.message}
                  </p>
                  <p
                    className={`text-[10px] mt-1 ${isCustomer ? 'text-white/70' : 'text-gray-400'}`}
                  >
                    {formatChatTime(m.created_at)}
                  </p>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        {/* Error banner (rate / duplicate / network). Success path
            updates the message list directly, no banner needed. */}
        {status.kind === 'error' && status.text && (
          <div className="px-3 pt-2 flex-shrink-0">
            <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 flex items-start gap-2">
              <AlertCircle size={14} className="text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-700 leading-relaxed">{status.text}</p>
            </div>
          </div>
        )}

        {/* Composer */}
        <div className="border-t border-gray-200 px-3 py-3 flex-shrink-0 bg-white sm:rounded-b-2xl">
          <div className="flex items-end gap-2">
            <textarea
              className={`flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 ${focusRing} resize-none`}
              placeholder="اكتب رسالتك..."
              rows={2}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                if (status.kind === 'error') setStatus({ kind: 'idle' });
              }}
              maxLength={1000}
              disabled={submitting}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void sendMessage();
                }
              }}
            />
            <button
              type="button"
              onClick={sendMessage}
              disabled={submitting || !input.trim()}
              className={`flex items-center justify-center gap-1 ${accent} ${accentHover} text-white rounded-xl px-4 py-2.5 text-sm font-bold transition-colors disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed flex-shrink-0`}
              aria-label="إرسال"
            >
              <Send size={14} />
              {submitting ? '…' : 'إرسال'}
            </button>
          </div>
          <p className="mt-1 text-[10px] text-gray-400 text-left">{input.length}/1000</p>
        </div>
      </div>
    </div>
  );
}

// ─── Complaint Modal ──────────────────────────────────────────────────────────

interface ComplaintModalProps {
  order: TrackingOrder;
  onClose: () => void;
}

function ComplaintModal({ order, onClose }: ComplaintModalProps) {
  const [phone, setPhone] = useState('');
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<SubmitStatus>({ kind: 'idle' });

  const submitComplaint = async () => {
    if (submitting) return;
    const phoneT = phone.trim();
    if (!PHONE_RE.test(phoneT)) {
      setStatus({ kind: 'error', text: 'يرجى إدخال رقم هاتف صحيح (5-32 رقم).' });
      return;
    }
    if (!reason) {
      setStatus({ kind: 'error', text: 'يرجى اختيار سبب الشكوى.' });
      return;
    }
    const subject = `${reason} — طلب رقم ${order.orderNum}`.slice(0, 120);
    const notesT = details.trim();
    if (notesT.length > 2000) {
      setStatus({ kind: 'error', text: 'تفاصيل الشكوى طويلة جدًا (الحد 2000 حرف).' });
      return;
    }

    setSubmitting(true);
    setStatus({ kind: 'idle' });
    try {
      const res = await fetch('/api/customer/complaints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_phone: phoneT,
          subject,
          notes: notesT || null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        setStatus({
          kind: 'success',
          text: 'تم تسجيل شكواك. سيتواصل معك فريق خدمة العملاء قريبًا عبر الواتساب.',
        });
        setReason('');
        setDetails('');
      } else {
        const code = typeof data?.error === 'string' ? data.error : '';
        setStatus({
          kind: 'error',
          text: COMPLAINT_ERR_MAP[code] || 'تعذر إرسال الشكوى. حاول مرة أخرى.',
        });
      }
    } catch {
      setStatus({ kind: 'error', text: 'تعذر الاتصال. تحقق من الإنترنت وحاول مجددًا.' });
    }
    setSubmitting(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-0 sm:p-4"
      dir="rtl"
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-md sm:rounded-2xl flex flex-col shadow-2xl max-h-[90vh]">
        <div className="flex items-center gap-3 px-4 py-3 bg-red-600 sm:rounded-t-2xl flex-shrink-0">
          <div className="w-10 h-10 rounded-full bg-red-700 border-2 border-white/30 flex items-center justify-center flex-shrink-0">
            <AlertCircle size={20} className="text-white" />
          </div>
          <div className="flex-1">
            <p className="text-white font-bold text-sm">تقديم شكوى</p>
            <p className="text-white/70 text-xs">{order.orderNum}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
            aria-label="إغلاق"
          >
            <X size={18} className="text-white" />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          <p className="text-xs text-gray-600 leading-relaxed">
            اكتب رقم هاتفك الذي استلمت عليه تأكيد الطلب، اختر سبب الشكوى، وأضف تفاصيل (اختياري).
            سيتواصل معك فريق خدمة العملاء عبر الواتساب.
          </p>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">رقم الهاتف *</label>
            <input
              type="tel"
              dir="ltr"
              inputMode="tel"
              autoComplete="tel"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
              placeholder="مثال: 01012345678"
              value={phone}
              // Phase 24B-Fix1 — convert Arabic / Persian digits to
              // ASCII live so the PHONE_RE validator below + the API
              // route + the SECURITY DEFINER RPC all see the same
              // normalised digits.
              onChange={(e) => setPhone(sanitizePhoneInput(e.target.value))}
              maxLength={32}
              disabled={submitting}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">سبب الشكوى *</label>
            <div className="grid grid-cols-1 gap-2">
              {COMPLAINT_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  disabled={submitting}
                  className={`text-right px-4 py-2.5 rounded-xl border text-sm transition-all ${
                    reason === r
                      ? 'bg-red-50 border-red-400 text-red-700 font-medium'
                      : 'border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">
              تفاصيل إضافية (اختياري)
            </label>
            <textarea
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
              placeholder="اكتب تفاصيل الشكوى هنا..."
              rows={3}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              maxLength={2000}
              disabled={submitting}
            />
            <p className="mt-1 text-[10px] text-gray-400 text-left">{details.length}/2000</p>
          </div>

          {status.kind === 'success' && (
            <div className="rounded-xl bg-green-50 border border-green-200 px-3 py-2 flex items-start gap-2">
              <CheckCircle size={14} className="text-green-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-green-700 leading-relaxed">{status.text}</p>
            </div>
          )}
          {status.kind === 'error' && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 flex items-start gap-2">
              <AlertCircle size={14} className="text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-700 leading-relaxed">{status.text}</p>
            </div>
          )}

          <button
            type="button"
            onClick={submitComplaint}
            disabled={submitting || !reason || !phone.trim()}
            className="w-full py-3 rounded-xl text-sm font-bold transition-colors bg-red-600 hover:bg-red-700 text-white disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
          >
            {submitting ? 'جارٍ الإرسال...' : 'إرسال الشكوى'}
          </button>
        </div>
      </div>
    </div>
  );
}

function LiveLocationMap({ status, delegate }: { status: string; delegate?: string }) {
  const isActive = status === 'shipping';
  const [pulse, setPulse] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => setPulse((p) => !p), 1500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative w-full h-48 rounded-2xl overflow-hidden bg-gradient-to-br from-slate-100 to-slate-200 border border-[hsl(var(--border))]">
      <div className="absolute inset-0 opacity-20 pointer-events-none">
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
              <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#94a3b8" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </div>
      <svg
        className="absolute inset-0 w-full h-full opacity-30 pointer-events-none"
        viewBox="0 0 400 200"
      >
        <path d="M 0 100 Q 100 80 200 100 T 400 100" stroke="#64748b" strokeWidth="4" fill="none" />
        <path d="M 200 0 Q 210 100 200 200" stroke="#64748b" strokeWidth="3" fill="none" />
        <path d="M 0 50 Q 150 60 300 40 T 400 60" stroke="#94a3b8" strokeWidth="2" fill="none" />
        <path d="M 50 200 Q 80 120 100 0" stroke="#94a3b8" strokeWidth="2" fill="none" />
        <path d="M 300 200 Q 320 130 350 0" stroke="#94a3b8" strokeWidth="2" fill="none" />
      </svg>
      <div className="absolute bottom-8 right-1/3 flex flex-col items-center">
        <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center shadow-lg border-2 border-white">
          <MapPin size={14} className="text-white" />
        </div>
        <div className="mt-1 bg-white text-xs font-semibold text-green-700 px-2 py-0.5 rounded-full shadow border border-green-200">
          وجهتك
        </div>
      </div>
      {isActive && (
        <div className="absolute top-1/3 left-1/3 flex flex-col items-center">
          <div
            className={`w-10 h-10 bg-[hsl(211,67%,28%)] rounded-full flex items-center justify-center shadow-xl border-3 border-white transition-transform duration-500 ${pulse ? 'scale-110' : 'scale-100'}`}
          >
            <Truck size={16} className="text-white" />
          </div>
          <div
            className={`absolute w-14 h-14 rounded-full border-2 border-[hsl(211,67%,28%)] opacity-40 transition-all duration-1000 ${pulse ? 'scale-150 opacity-0' : 'scale-100 opacity-40'}`}
          />
          <div className="mt-1 bg-[hsl(211,67%,28%)] text-xs font-semibold text-white px-2 py-0.5 rounded-full shadow">
            {delegate || 'المندوب'}
          </div>
        </div>
      )}
      {isActive && (
        <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 400 200">
          <path
            d="M 133 67 Q 200 80 267 133"
            stroke="hsl(211,67%,28%)"
            strokeWidth="3"
            fill="none"
            strokeDasharray="8,4"
            opacity="0.6"
          />
        </svg>
      )}
      {!isActive && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-100/80 backdrop-blur-sm pointer-events-none">
          <div className="text-center">
            <Navigation size={32} className="text-slate-400 mx-auto mb-2" />
            <p className="text-sm text-slate-500 font-medium">
              {status === 'delivered' ? 'تم التسليم بنجاح' : 'الموقع الحي متاح عند بدء الشحن'}
            </p>
          </div>
        </div>
      )}
      {isActive && (
        <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-red-500 text-white text-xs font-bold px-2.5 py-1 rounded-full shadow-lg">
          <span
            className={`w-1.5 h-1.5 rounded-full bg-white ${pulse ? 'opacity-100' : 'opacity-40'} transition-opacity duration-500`}
          />
          مباشر
        </div>
      )}
    </div>
  );
}

function StatusTimeline({
  history,
  currentStatus,
}: {
  history: { status: string; label: string; time: string; date: string; note: string }[];
  currentStatus: string;
}) {
  const isCancelled = currentStatus === 'cancelled';
  const isReturned = currentStatus === 'returned';

  const steps: StatusStep[] = STATUS_FLOW.map((key, idx) => {
    const historyItem = history.find((h) => h.status === key);
    const currentIdx = STATUS_FLOW.indexOf(currentStatus);
    const stepIdx = idx;

    return {
      key,
      label: STATUS_CONFIG[key]?.label || key,
      icon: getStepIcon(key),
      description: historyItem?.note || STATUS_CONFIG[key]?.description || '',
      timestamp: historyItem ? `${historyItem.time} — ${historyItem.date}` : undefined,
      completed: historyItem !== undefined || stepIdx < currentIdx,
      active: key === currentStatus,
    };
  });

  if (isCancelled || isReturned) {
    const specialStep = {
      key: currentStatus,
      label: STATUS_CONFIG[currentStatus]?.label || currentStatus,
      icon: currentStatus === 'cancelled' ? <XCircle size={16} /> : <RotateCcw size={16} />,
      description: STATUS_CONFIG[currentStatus]?.description || '',
      timestamp: history[history.length - 1]
        ? `${history[history.length - 1].time} — ${history[history.length - 1].date}`
        : undefined,
      completed: true,
      active: true,
    };
    steps.push(specialStep);
  }

  return (
    <div className="relative">
      {steps.map((step, idx) => {
        const isLast = idx === steps.length - 1;
        return (
          <div key={step.key} className="flex gap-4">
            <div className="flex flex-col items-center">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all duration-300 flex-shrink-0 ${
                  step.active
                    ? 'bg-[hsl(211,67%,28%)] border-[hsl(211,67%,28%)] text-white shadow-lg scale-110'
                    : step.completed
                      ? 'bg-green-500 border-green-500 text-white'
                      : 'bg-white border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]'
                }`}
              >
                {step.icon}
              </div>
              {!isLast && (
                <div
                  className={`w-0.5 flex-1 my-1 min-h-[2rem] transition-colors duration-300 ${
                    step.completed ? 'bg-green-400' : 'bg-[hsl(var(--border))]'
                  }`}
                />
              )}
            </div>
            <div className={`pb-5 flex-1 ${isLast ? 'pb-0' : ''}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`font-semibold text-sm ${
                    step.active
                      ? 'text-[hsl(211,67%,28%)]'
                      : step.completed
                        ? 'text-[hsl(var(--foreground))]'
                        : 'text-[hsl(var(--muted-foreground))]'
                  }`}
                >
                  {step.label}
                </span>
                {step.active && (
                  <span className="text-xs bg-[hsl(211,67%,28%)] text-white px-2 py-0.5 rounded-full font-medium">
                    الحالة الحالية
                  </span>
                )}
              </div>
              {step.timestamp && (
                <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1 flex items-center gap-1">
                  <Clock size={10} />
                  {step.timestamp}
                </p>
              )}
              {step.description && (
                <p className="text-xs text-[hsl(var(--foreground))]/70 mt-1 bg-[hsl(var(--muted))]/30 px-2 py-1 rounded-lg inline-block">
                  {step.description}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function getStepIcon(status: string) {
  switch (status) {
    case 'new':
      return <ClipboardList size={16} />;
    case 'preparing':
      return <Package size={16} />;
    case 'warehouse':
      return <Warehouse size={16} />;
    case 'shipping':
      return <Truck size={16} />;
    case 'delivered':
      return <CheckCircle size={16} />;
    case 'cancelled':
      return <XCircle size={16} />;
    case 'returned':
      return <RotateCcw size={16} />;
    default:
      return <Package size={16} />;
  }
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={12}
          className={i <= Math.round(rating) ? 'text-amber-400 fill-amber-400' : 'text-slate-300'}
        />
      ))}
      <span className="text-xs text-[hsl(var(--muted-foreground))] mr-1">{rating}</span>
    </div>
  );
}

// ─── Invoice PDF Generator ────────────────────────────────────────────────────
function generateInvoiceHTML(order: TrackingOrder, token: string): string {
  // Phase 13C: print invoices use the token-keyed URL so any re-share of
  // the printout still goes through the unguessable path. The legacy
  // /track/[orderId] route writes its own (order_num) URL.
  const trackingLink = `${typeof window !== 'undefined' ? window.location.origin : 'https://turathmasr.com'}/track/t/${token}`;
  const subtotal = order.subtotal ?? order.total;
  const shippingFee = order.shippingFee ?? 0;
  const checkoutRows = order.checkoutDetails
    ? checkoutDetailsLines(order.checkoutDetails)
        .map((line) => `<tr><td colspan="4">${line}</td></tr>`)
        .join('')
    : '';

  const productRows =
    order.lines && order.lines.length > 0
      ? order.lines
          .map((line, idx) => {
            // Phase Egress-Fix1 — resolve via helper; pass the token
            // + line index so storage-backed lines hit the existing
            // /api/track-token/<token>/line-image/<idx> proxy.
            const imgUrl = resolveLineImageUrl(line, { trackingToken: token, lineIndex: idx });
            const imgHtml = imgUrl
              ? `<img src="${imgUrl}" alt="${line.label}" style="width:40px;height:40px;object-fit:cover;border-radius:6px;border:1px solid #e5e7eb;" />`
              : `<span style="font-size:24px;">${line.emoji || '📦'}</span>`;
            // Phase Tracking-Lines-1 — `line.note` was an unreachable
            // path here too (DTO strips it). Dropped to keep the PDF
            // and the on-page card in lock-step.
            const colorHtml = line.color ? ` (${line.color})` : '';
            const flashHtml = line.includeFlashlight ? ' + كشاف' : '';
            return `<tr>
          <td style="display:flex;align-items:center;gap:10px;padding:10px 12px;">
            ${imgHtml}
            <div><strong>${line.label}${colorHtml}${flashHtml}</strong></div>
          </td>
          <td>${line.quantity}</td>
          <td>${line.unitPrice.toLocaleString('en-US')} ج.م</td>
          <td>${line.total.toLocaleString('en-US')} ج.م</td>
        </tr>`;
          })
          .join('')
      : `<tr><td>${order.products}</td><td>${order.quantity}</td><td>—</td><td>${subtotal.toLocaleString('en-US')} ج.م</td></tr>`;

  const warrantyRow =
    order.warranty && order.warranty !== 'بدون ضمان'
      ? `<tr class="warranty-row"><td colspan="3">فترة الضمان</td><td>—</td><td>${order.warranty}</td></tr>`
      : '';

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8" />
  <title>فاتورة - ${order.orderNum}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; direction: rtl; background: #fff; color: #1a1a1a; }
    .invoice-wrap { max-width: 700px; margin: 0 auto; padding: 20px; }
    .inv-header { background: #1e3a5f; color: white; padding: 24px; text-align: center; border-radius: 12px 12px 0 0; }
    .inv-header h1 { font-size: 26px; font-weight: 800; }
    .inv-header p { font-size: 13px; opacity: 0.8; margin-top: 4px; }
    .inv-body { border: 2px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px; padding: 24px; }
    .inv-meta { display: flex; justify-content: space-between; border-bottom: 1px solid #e5e7eb; padding-bottom: 16px; margin-bottom: 16px; }
    .inv-meta div p:first-child { font-size: 11px; color: #6b7280; margin-bottom: 4px; }
    .inv-meta div p:last-child { font-weight: 700; font-size: 14px; }
    .section-title { font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
    .customer-info { margin-bottom: 16px; }
    .customer-info p { font-size: 14px; margin-bottom: 4px; }
    .customer-info .name { font-size: 18px; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    th { background: #f3f4f6; padding: 10px 12px; text-align: right; font-size: 12px; font-weight: 700; color: #374151; }
    td { padding: 10px 12px; border-bottom: 1px solid #f3f4f6; font-size: 13px; vertical-align: middle; }
    .total-row { background: #eff6ff; }
    .total-row td { font-weight: 700; font-size: 16px; color: #1e3a5f; }
    .warranty-row { background: #f0fdf4; }
    .warranty-row td { color: #166534; font-weight: 600; }
    .tracking-box { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 12px; margin-bottom: 16px; }
    .tracking-box p { font-size: 12px; color: #1e40af; }
    .tracking-box a { font-size: 13px; color: #1d4ed8; font-weight: 700; word-break: break-all; }
    .footer { text-align: center; font-size: 12px; color: #9ca3af; margin-top: 20px; padding-top: 16px; border-top: 1px solid #e5e7eb; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style>
</head>
<body>
  <div class="invoice-wrap">
    <div class="inv-header">
      <h1>Turath Masr</h1>
      <p>فاتورة ضريبية مبسطة</p>
    </div>
    <div class="inv-body">
      <div class="inv-meta">
        <div><p>رقم الفاتورة</p><p>${order.orderNum}</p></div>
        <div><p>تاريخ الإصدار</p><p>${order.date}</p></div>
        <div><p>الوقت</p><p>${order.time}</p></div>
      </div>
      <div class="customer-info">
        <p class="section-title">بيانات العميل</p>
        <p class="name">${order.customer}</p>
        <p>${order.phone}</p>
        <p>${order.region}${order.district ? ' - ' + order.district : ''}${order.neighborhood ? ' - ' + order.neighborhood : ''} — ${order.address}</p>
      </div>
      <div class="tracking-box">
        <p>رابط تتبع الشحنة:</p>
        <a href="${trackingLink}">${trackingLink}</a>
      </div>
      <p class="section-title">المنتجات</p>
      <table>
        <thead><tr><th>المنتج</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead>
        <tbody>
          ${productRows}
          ${shippingFee > 0 ? `<tr><td>تكلفة الشحن</td><td>—</td><td>—</td><td>${shippingFee.toLocaleString('en-US')} ج.م</td></tr>` : ''}
          ${checkoutRows}
          ${warrantyRow}
          <tr class="total-row"><td colspan="3"><strong>الإجمالي الكلي</strong></td><td><strong>${order.total.toLocaleString('en-US')} ج.م</strong></td></tr>
        </tbody>
      </table>
      ${order.notes ? `<p style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px;font-size:13px;"><strong>ملاحظات:</strong> ${order.notes}</p>` : ''}
      <div class="footer">شكرا لثقتك في Turath Masr — للاستفسار: info@turath_masr.com</div>
    </div>
  </div>
  <script>window.onload = function(){ window.print(); }<\/script>
</body>
</html>`;
}

// ─── Warranty Certificate Generator ──────────────────────────────────────────
function generateWarrantyCertHTML(order: TrackingOrder): string {
  const productNames =
    order.lines && order.lines.length > 0
      ? order.lines
          .map((l) => `${l.label}${l.color ? ` (${l.color})` : ''} × ${l.quantity}`)
          .join('، ')
      : order.products;

  const issueDate = order.date;
  const warrantyPeriod = order.warranty || '6 أشهر';

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8" />
  <title>شهادة ضمان - ${order.orderNum}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; direction: rtl; background: #f8f9fa; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .cert-wrap { max-width: 680px; width: 100%; background: white; border-radius: 20px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.15); }
    .cert-header { background: linear-gradient(135deg, #1e3a5f 0%, #2d5a8e 50%, #1e3a5f 100%); padding: 40px 32px; text-align: center; position: relative; }
    .cert-header::before { content: ''; position: absolute; inset: 0; background: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.05'%3E%3Cpath d='M30 3 L35 20 L53 20 L39 31 L44 48 L30 38 L16 48 L21 31 L7 20 L25 20z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E"); }
    .cert-badge { width: 80px; height: 80px; background: rgba(255,255,255,0.15); border: 3px solid rgba(255,255,255,0.4); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; font-size: 36px; }
    .cert-header h1 { color: white; font-size: 28px; font-weight: 800; letter-spacing: 1px; }
    .cert-header p { color: rgba(255,255,255,0.75); font-size: 14px; margin-top: 6px; }
    .cert-body { padding: 36px 32px; }
    .cert-title { text-align: center; margin-bottom: 28px; }
    .cert-title h2 { font-size: 22px; font-weight: 700; color: #1e3a5f; }
    .cert-title p { color: #6b7280; font-size: 14px; margin-top: 4px; }
    .cert-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
    .cert-field { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 16px; }
    .cert-field label { font-size: 11px; color: #94a3b8; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 4px; }
    .cert-field span { font-size: 15px; font-weight: 700; color: #1e293b; }
    .warranty-highlight { background: linear-gradient(135deg, #f0fdf4, #dcfce7); border: 2px solid #86efac; border-radius: 16px; padding: 20px; text-align: center; margin-bottom: 24px; }
    .warranty-highlight .period { font-size: 36px; font-weight: 900; color: #166534; }
    .warranty-highlight .label { font-size: 14px; color: #15803d; margin-top: 4px; }
    .products-box { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 12px; padding: 16px; margin-bottom: 24px; }
    .products-box h3 { font-size: 13px; font-weight: 700; color: #1e40af; margin-bottom: 8px; }
    .products-box p { font-size: 14px; color: #1e3a5f; line-height: 1.6; }
    .cert-footer { background: #f8fafc; border-top: 2px dashed #e2e8f0; padding: 20px 32px; text-align: center; }
    .cert-footer p { font-size: 12px; color: #94a3b8; line-height: 1.6; }
    .cert-footer strong { color: #1e3a5f; }
    .seal { display: inline-flex; align-items: center; gap: 8px; background: #1e3a5f; color: white; padding: 8px 20px; border-radius: 50px; font-size: 13px; font-weight: 700; margin-top: 12px; }
    @media print { body { background: white; padding: 0; } .cert-wrap { box-shadow: none; border-radius: 0; } }
  </style>
</head>
<body>
  <div class="cert-wrap">
    <div class="cert-header">
      <div class="cert-badge">🛡️</div>
      <h1>Turath Masr</h1>
      <p>شركة زهران للشحن والتوصيل</p>
    </div>
    <div class="cert-body">
      <div class="cert-title">
        <h2>شهادة ضمان المنتج</h2>
        <p>هذه الشهادة تُثبت حق العميل في الضمان الرسمي</p>
      </div>
      <div class="warranty-highlight">
        <div class="period">${warrantyPeriod}</div>
        <div class="label">مدة الضمان المعتمدة</div>
      </div>
      <div class="cert-grid">
        <div class="cert-field">
          <label>رقم الطلب</label>
          <span>${order.orderNum}</span>
        </div>
        <div class="cert-field">
          <label>تاريخ الإصدار</label>
          <span>${issueDate}</span>
        </div>
        <div class="cert-field">
          <label>اسم العميل</label>
          <span>${order.customer}</span>
        </div>
        <div class="cert-field">
          <label>رقم الهاتف</label>
          <span>${order.phone}</span>
        </div>
      </div>
      <div class="products-box">
        <h3>المنتجات المشمولة بالضمان</h3>
        <p>${productNames}</p>
      </div>
    </div>
    <div class="cert-footer">
      <p>يشمل الضمان عيوب الصناعة والمواد فقط. لا يشمل الكسر أو سوء الاستخدام.</p>
      <p>للتواصل بخصوص الضمان: <strong>info@turath_masr.com</strong></p>
      <div class="seal">✅ شهادة ضمان رسمية معتمدة</div>
    </div>
  </div>
  <script>window.onload = function(){ window.print(); }<\/script>
</body>
</html>`;
}

export default function TrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = React.use(params);
  const [order, setOrder] = useState<TrackingOrder | null>(null);
  const [history, setHistory] = useState<
    { status: string; label: string; time: string; date: string; note: string }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [refreshing, setRefreshing] = useState(false);
  const [activeChat, setActiveChat] = useState<'delegate' | 'support' | null>(null);
  const [showComplaint, setShowComplaint] = useState(false);
  const [liveUpdateFlash, setLiveUpdateFlash] = useState(false);

  const loadOrder = useCallback(
    (silent = false) => {
      if (!silent) setRefreshing(true);
      setTimeout(
        async () => {
          let found: TrackingOrder | null = null;
          let foundHistory: {
            status: string;
            label: string;
            time: string;
            date: string;
            note: string;
          }[] = [];
          // NOTE (Phase 8B): the legacy localStorage read was removed —
          // it surfaced stale/PII data from the staff app and would mislead
          // customers after the new RLS makes the public Supabase fetch
          // return only the redacted columns. The /api/track endpoint
          // is now the single source of truth.

          // Fetch the order DTO from the token-keyed tracking API.
          // Phase 22H: this RPC was widened — the token URL is unguessable
          // so a holder of the link is treated as the customer. The DTO
          // now carries customer name, masked phone, address, lines,
          // totals, and free_shipping. Internal fields (phone2, notes,
          // audit columns, delegate identity, tracking_token itself,
          // lines.image, lines.note) remain stripped server-side.
          {
            try {
              const res = await fetch(`/api/track-token/${encodeURIComponent(token)}`, {
                cache: 'no-store',
              });
              if (res.ok) {
                const data = await res.json();
                const dtoLines = Array.isArray(data.lines)
                  ? (data.lines as Array<Record<string, unknown>>).map((l) => ({
                      productType: String(l.productType ?? ''),
                      label: String(l.label ?? ''),
                      emoji: typeof l.emoji === 'string' ? l.emoji : undefined,
                      color: (l.color as string | null) ?? null,
                      quantity: Number(l.quantity ?? 0),
                      unitPrice: Number(l.unitPrice ?? 0),
                      includeFlashlight: Boolean(l.includeFlashlight),
                      flashlightPrice:
                        l.flashlightPrice == null ? undefined : Number(l.flashlightPrice),
                      total: Number(l.total ?? 0),
                    }))
                  : undefined;
                found = {
                  orderNum: data.orderNum,
                  customer: data.customer ?? '',
                  phone: data.phone ?? '',
                  region: data.region ?? '',
                  district: data.district ?? undefined,
                  address: data.address ?? '',
                  products: data.products ?? '',
                  quantity: data.quantity ?? 0,
                  total: Number(data.total ?? 0),
                  subtotal: data.subtotal == null ? undefined : Number(data.subtotal),
                  shippingFee: data.shippingFee == null ? undefined : Number(data.shippingFee),
                  checkoutDetails: data.checkoutDetails ?? null,
                  extraShippingFee:
                    data.extraShippingFee == null ? undefined : Number(data.extraShippingFee),
                  freeShipping:
                    typeof data.freeShipping === 'boolean' ? data.freeShipping : undefined,
                  lines: dtoLines,
                  status: data.status,
                  date: data.date ?? '',
                  time: '',
                  createdAt: data.createdAt ?? undefined,
                  notes: data.notes || undefined,
                  warranty: data.warranty || undefined,
                  // Phase 22Q — pass through the customer-facing
                  // schedule + delegate name. Both are null until the
                  // companion migration is applied; the render path
                  // below is defensive against null on every leaf.
                  scheduledDelivery: data.scheduledDelivery ?? null,
                  delegate:
                    typeof data.delegateName === 'string' && data.delegateName
                      ? data.delegateName
                      : undefined,
                  // Phase 23A-Fix1 — delegate phone joined server-side
                  // by `get_tracking_info_by_token` from
                  // `profiles.phone`. Null on legacy rows (only
                  // `delegate_name` text) and pre-migration RPCs.
                  delegatePhone:
                    typeof data.delegatePhone === 'string' && data.delegatePhone
                      ? data.delegatePhone
                      : undefined,
                } as TrackingOrder;
                if (Array.isArray(data.statusTimeline) && data.statusTimeline.length > 0) {
                  const days = [
                    'الأحد',
                    'الاثنين',
                    'الثلاثاء',
                    'الأربعاء',
                    'الخميس',
                    'الجمعة',
                    'السبت',
                  ];
                  foundHistory = data.statusTimeline.map(
                    (e: {
                      status: string;
                      changedAt: string;
                      // Phase 22P — customer-safe return reason
                      // surfaced by the
                      // `get_tracking_timeline_by_token` RPC. Null
                      // for non-returned events and for legacy
                      // timelines (the field is also harmlessly
                      // absent until the Phase 22P migration is
                      // applied).
                      returnReason?: string | null;
                    }) => {
                      const ts = new Date(e.changedAt);
                      const time = ts.toLocaleTimeString('en-US', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false,
                      });
                      const date = `${days[ts.getDay()]} ${ts.toLocaleDateString('en-GB')}`;
                      // Phase 22P — for the `returned` status prefer
                      // the actual return reason the admin entered;
                      // it's the piece of context a customer cares
                      // about ("لماذا تم إرجاع طلبي؟"). Falls back
                      // to the generic STATUS_CONFIG description
                      // when the reason is missing (legacy rows or
                      // pre-migration timelines), so the visible
                      // step never goes blank.
                      const description =
                        e.status === 'returned' && e.returnReason
                          ? e.returnReason
                          : STATUS_CONFIG[e.status]?.description || '';
                      return {
                        status: e.status,
                        label: STATUS_CONFIG[e.status]?.label || e.status,
                        time,
                        date,
                        note: description,
                      };
                    }
                  );
                }
                // The status timeline is now built from the redacted RPC
                // response above (data.statusTimeline). The legacy direct
                // read of turath_masr_audit_logs was removed because the
                // table is no longer publicly readable under the new RLS,
                // and it leaked changed_by / note internals anyway.
              }
            } catch {
              // Network or fetch failure — order is treated as not found.
            }
          }

          if (found) {
            setOrder((prev) => {
              if (prev && prev.status !== found!.status) {
                setLiveUpdateFlash(true);
                setTimeout(() => setLiveUpdateFlash(false), 3000);
              }
              return found;
            });
            setHistory(foundHistory);
            setNotFound(false);
          } else {
            setNotFound(true);
          }
          setLoading(false);
          setRefreshing(false);
          setLastUpdated(new Date());
        },
        silent ? 0 : 600
      );
    },
    [token]
  );

  useEffect(() => {
    loadOrder();
    // Auto-refresh every 10 seconds for near real-time tracking
    const interval = setInterval(() => loadOrder(true), 30000); // reduced from 10s

    // Listen for instant updates from orders management
    const handleOrdersUpdate = () => loadOrder(true);
    const handleAuditUpdate = () => loadOrder(true);
    window.addEventListener('turath_masr_orders_updated', handleOrdersUpdate);
    window.addEventListener('turath_masr_audit_updated', handleAuditUpdate);

    return () => {
      clearInterval(interval);
      window.removeEventListener('turath_masr_orders_updated', handleOrdersUpdate);
      window.removeEventListener('turath_masr_audit_updated', handleAuditUpdate);
    };
  }, [loadOrder]);

  const handleContactDelegate = () => {
    if (order?.delegatePhone) {
      window.open(`tel:${order.delegatePhone}`, '_self');
    }
  };

  const handleWhatsAppDelegate = () => {
    if (order?.delegatePhone) {
      const msg = encodeURIComponent(
        `مرحباً، أنا ${order?.customer}، أتواصل بخصوص الطلب رقم ${order?.orderNum}`
      );
      window.open(`https://wa.me/2${order.delegatePhone}?text=${msg}`, '_blank');
    }
  };

  const handleDownloadInvoice = () => {
    if (!order) return;
    const win = window.open('', '_blank', 'width=800,height=700');
    if (!win) {
      alert('يرجى السماح بالنوافذ المنبثقة');
      return;
    }
    win.document.write(generateInvoiceHTML(order, token));
    win.document.close();
  };

  const handleDownloadWarranty = () => {
    if (!order) return;
    const win = window.open('', '_blank', 'width=800,height=700');
    if (!win) {
      alert('يرجى السماح بالنوافذ المنبثقة');
      return;
    }
    win.document.write(generateWarrantyCertHTML(order));
    win.document.close();
  };

  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        dir="rtl"
        style={{
          background:
            'linear-gradient(135deg, hsl(25,55%,15%) 0%, hsl(25,50%,25%) 50%, hsl(35,60%,30%) 100%)',
        }}
      >
        <div className="absolute inset-0 opacity-10 pointer-events-none">
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern
                id="islamic-bg-load"
                x="0"
                y="0"
                width="80"
                height="80"
                patternUnits="userSpaceOnUse"
              >
                <polygon
                  points="40,5 47,28 70,28 52,43 59,66 40,52 21,66 28,43 10,28 33,28"
                  fill="none"
                  stroke="white"
                  strokeWidth="1.5"
                />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#islamic-bg-load)" />
          </svg>
        </div>
        <div className="text-center relative z-10">
          <div className="w-16 h-16 border-4 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-amber-100 font-medium">جاري تحميل بيانات الشحنة...</p>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-4 relative"
        dir="rtl"
        style={{
          background:
            'linear-gradient(135deg, hsl(25,55%,15%) 0%, hsl(25,50%,25%) 50%, hsl(35,60%,30%) 100%)',
        }}
      >
        <div className="absolute inset-0 opacity-10 pointer-events-none">
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern
                id="islamic-bg-nf"
                x="0"
                y="0"
                width="80"
                height="80"
                patternUnits="userSpaceOnUse"
              >
                <polygon
                  points="40,5 47,28 70,28 52,43 59,66 40,52 21,66 28,43 10,28 33,28"
                  fill="none"
                  stroke="white"
                  strokeWidth="1.5"
                />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#islamic-bg-nf)" />
          </svg>
        </div>
        <div className="text-center max-w-sm relative z-10">
          <div className="w-20 h-20 bg-red-900/40 rounded-full flex items-center justify-center mx-auto mb-4 border border-red-400/30">
            <Package size={36} className="text-red-300" />
          </div>
          <h1 className="text-xl font-bold text-white mb-2">الشحنة غير موجودة</h1>
          {/* Phase 13C: token is a UUID — never show it as if it were an
              order number. Show a generic copy that suits an unguessable
              link (expired / revoked / mistyped). */}
          <p className="text-amber-200 text-sm mb-4">رابط التتبع غير صالح أو منتهي الصلاحية</p>
          <p className="text-xs text-amber-200/70">
            يرجى التحقق من الرابط الذي وصلك أو التواصل مع خدمة العملاء
          </p>
        </div>
      </div>
    );
  }

  if (!order) return null;

  const statusConfig = STATUS_CONFIG[order.status] || STATUS_CONFIG['new'];
  const isShipping = order.status === 'shipping';
  const isDelivered = order.status === 'delivered';
  const hasWarranty = order.warranty && order.warranty !== 'بدون ضمان';
  // Phase Tracking-Lines-1 — `checkoutLines` (flat text form) is no
  // longer rendered on the page (the new `CheckoutDetailsCard`
  // consumes the structured envelope directly). The helper is still
  // exported for PDF + chat surfaces and the import is intentionally
  // retained — tsc would otherwise drop it on the next refactor.

  return (
    <div className="min-h-screen relative" dir="rtl">
      {/* Islamic background */}
      <div
        className="fixed inset-0 -z-10"
        style={{
          background:
            'linear-gradient(160deg, hsl(25,55%,12%) 0%, hsl(28,50%,20%) 40%, hsl(35,55%,25%) 70%, hsl(25,45%,18%) 100%)',
        }}
      >
        <div className="absolute inset-0 opacity-[0.07]">
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern
                id="islamic-main"
                x="0"
                y="0"
                width="100"
                height="100"
                patternUnits="userSpaceOnUse"
              >
                <polygon
                  points="50,6 58,34 86,34 64,52 72,80 50,63 28,80 28,52 14,34 42,34"
                  fill="none"
                  stroke="white"
                  strokeWidth="1.5"
                />
                <polygon
                  points="50,18 55,34 72,34 59,44 64,60 50,51 36,60 41,44 28,34 45,34"
                  fill="none"
                  stroke="white"
                  strokeWidth="0.8"
                  opacity="0.6"
                />
                <circle cx="50" cy="50" r="3" fill="white" opacity="0.4" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#islamic-main)" />
          </svg>
        </div>
        <div
          className="absolute inset-0 opacity-30"
          style={{
            background:
              'radial-gradient(ellipse at 30% 20%, hsl(35,70%,35%) 0%, transparent 60%), radial-gradient(ellipse at 70% 80%, hsl(25,60%,25%) 0%, transparent 60%)',
          }}
        />
      </div>

      {/* Live update flash banner */}
      {liveUpdateFlash && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-green-500 text-white text-center py-2 text-sm font-bold animate-pulse">
          🔄 تم تحديث حالة الشحنة لحظياً!
        </div>
      )}

      {/* Header */}
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.3) 100%)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
        }}
      >
        <div className="max-w-lg mx-auto px-4 py-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{
                  background: 'rgba(255,255,255,0.15)',
                  border: '1px solid rgba(255,255,255,0.2)',
                }}
              >
                <Truck size={20} className="text-amber-300" />
              </div>
              <div>
                <h1 className="font-bold text-lg leading-tight text-white">تراث مصر</h1>
                <p className="text-amber-300 text-xs">Turath Masr — تتبع شحنتك</p>
              </div>
            </div>
            <button
              onClick={() => loadOrder()}
              disabled={refreshing}
              className="flex items-center gap-1.5 text-amber-200 text-xs px-3 py-1.5 rounded-lg transition-colors"
              style={{
                background: 'rgba(255,255,255,0.15)',
                border: '1px solid rgba(255,255,255,0.2)',
              }}
            >
              <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
              تحديث
            </button>
          </div>

          <div
            className="rounded-2xl p-4"
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.15)',
            }}
          >
            <p className="text-amber-300 text-xs mb-1">رقم الطلب</p>
            <p className="font-mono font-bold text-xl tracking-wide text-white">{order.orderNum}</p>
            {order.date && order.time && (
              <p className="text-amber-200/70 text-xs mt-1">
                {order.date} — {order.time}
              </p>
            )}
            {/* Phase 22H — explicit creation timestamp with day name +
                seconds. Required by the Phase 22H follow-up so the
                customer can confirm the exact moment the order was
                placed. Renders only on the token page, never on the
                redacted /track/[orderId] page. */}
            {order.createdAt && (
              <p className="text-amber-200/80 text-xs mt-1.5 leading-relaxed">
                تم إنشاء الطلب {formatCreationTimestamp(order.createdAt)}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Current Status Banner */}
      <div className="max-w-lg mx-auto px-4 mt-4">
        <div
          className={`${statusConfig.bg} ${statusConfig.border} border rounded-2xl p-4 shadow-sm`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`w-12 h-12 rounded-xl flex items-center justify-center ${statusConfig.bg} border ${statusConfig.border}`}
            >
              {getStepIcon(order.status)}
            </div>
            <div className="flex-1">
              <p className="text-xs text-[hsl(var(--muted-foreground))] mb-0.5">الحالة الحالية</p>
              <p className={`font-bold text-lg ${statusConfig.color}`}>{statusConfig.label}</p>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                {statusConfig.description}
              </p>
            </div>
            {isShipping && (
              <div className="flex flex-col items-center">
                <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse mb-1" />
                <span className="text-xs text-green-600 font-medium">مباشر</span>
              </div>
            )}
          </div>
          {order.eta && isShipping && (
            <div className="mt-3 pt-3 border-t border-current/10 flex items-center gap-2">
              <Clock size={14} className={statusConfig.color} />
              <span className="text-xs text-[hsl(var(--muted-foreground))]">
                الوقت المتوقع للتسليم:
              </span>
              <span className={`text-sm font-bold ${statusConfig.color}`}>{order.eta}</span>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {/* Live Location Map */}
        <div className="bg-white rounded-2xl border border-[hsl(var(--border))] shadow-sm overflow-hidden">
          <div className="px-4 pt-4 pb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MapPin size={16} className="text-[hsl(211,67%,28%)]" />
              <h2 className="font-bold text-sm text-[hsl(var(--foreground))]">الموقع الحي</h2>
            </div>
            {isShipping && (
              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />
                يتحدث تلقائياً
              </span>
            )}
          </div>
          <div className="px-4 pb-4">
            <LiveLocationMap status={order.status} delegate={order.delegate} />
            {isShipping && order.deliveryNotes && (
              <div className="mt-3 flex items-start gap-2 bg-blue-50 rounded-xl p-3 border border-blue-100">
                <Navigation size={14} className="text-blue-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-blue-700">{order.deliveryNotes}</p>
              </div>
            )}
          </div>
        </div>

        {/* Assigned Delegate */}
        {order.delegate && (
          <div className="bg-white rounded-2xl border border-[hsl(var(--border))] shadow-sm p-4">
            <div className="flex items-center gap-2 mb-3">
              <User size={16} className="text-[hsl(211,67%,28%)]" />
              <h2 className="font-bold text-sm text-[hsl(var(--foreground))]">المندوب المعين</h2>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-[hsl(211,67%,28%)] to-[hsl(211,67%,40%)] rounded-full flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
                {order.delegate.charAt(0)}
              </div>
              <div className="flex-1">
                <p className="font-bold text-[hsl(var(--foreground))]">{order.delegate}</p>
                {order.delegateRating && <StarRating rating={order.delegateRating} />}
                <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                  مندوب توصيل معتمد
                </p>
              </div>
              {order.delegatePhone && !isDelivered && (
                <div className="flex flex-col gap-2">
                  <button
                    onClick={handleContactDelegate}
                    className="w-9 h-9 bg-[hsl(211,67%,28%)] text-white rounded-xl flex items-center justify-center hover:bg-[hsl(211,67%,22%)] transition-colors"
                    title="اتصال"
                  >
                    <Phone size={14} />
                  </button>
                  <button
                    onClick={handleWhatsAppDelegate}
                    className="w-9 h-9 bg-green-500 text-white rounded-xl flex items-center justify-center hover:bg-green-600 transition-colors"
                    title="واتساب"
                  >
                    <MessageCircle size={14} />
                  </button>
                </div>
              )}
            </div>

            {/* Chat with delegate button */}
            {!isDelivered && order.delegate && (
              <button
                onClick={() => setActiveChat('delegate')}
                className="mt-3 w-full flex items-center justify-center gap-2 bg-[hsl(211,67%,28%)]/10 hover:bg-[hsl(211,67%,28%)]/20 text-[hsl(211,67%,28%)] border border-[hsl(211,67%,28%)]/20 rounded-xl py-2.5 text-sm font-medium transition-colors"
              >
                <MessageCircle size={16} />
                محادثة مع المندوب
              </button>
            )}
          </div>
        )}

        {/* Order Status Timeline */}
        <div className="bg-white rounded-2xl border border-[hsl(var(--border))] shadow-sm p-4">
          <div className="flex items-center gap-2 mb-4">
            <ClipboardList size={16} className="text-[hsl(211,67%,28%)]" />
            <h2 className="font-bold text-sm text-[hsl(var(--foreground))]">مراحل الشحنة</h2>
          </div>
          <StatusTimeline history={history} currentStatus={order.status} />
        </div>

        {/* Phase 22Q — Delivery schedule card. Shown when an admin
            has set a window via StatusUpdateModal AND the companion
            tracking RPC migration has been applied. */}
        {order.scheduledDelivery && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl shadow-sm p-4">
            <div className="flex items-center gap-2 mb-2">
              <Clock size={16} className="text-emerald-700" />
              <h2 className="font-bold text-sm text-emerald-800">موعد التسليم المتوقع</h2>
            </div>
            <p className="text-base font-bold text-[hsl(var(--foreground))]">
              {formatScheduleDateShortAr(order.scheduledDelivery.date)}
            </p>
            <p className="text-sm text-[hsl(var(--foreground))] mt-0.5">
              من الساعة{' '}
              <span className="font-semibold">{formatTime12hAr(order.scheduledDelivery.from)}</span>{' '}
              إلى الساعة{' '}
              <span className="font-semibold">{formatTime12hAr(order.scheduledDelivery.to)}</span>
            </p>
            {order.scheduledDelivery.reason && (
              <div className="mt-3 bg-orange-50 border border-orange-200 rounded-xl p-2.5">
                <p className="text-xs font-bold text-orange-800 mb-0.5">تم ترحيل موعد التسليم</p>
                <p className="text-xs text-orange-700">
                  السبب: <span className="italic">{order.scheduledDelivery.reason}</span>
                </p>
              </div>
            )}
          </div>
        )}

        {/* Phase 22Q — Delegate card. Name only — phone is not
            available from the current `profiles` schema (no `phone`
            column). When delegate is missing the section is hidden,
            no placeholder card is rendered. */}
        {order.delegate && (
          <div className="bg-white rounded-2xl border border-[hsl(var(--border))] shadow-sm p-4">
            <div className="flex items-center gap-2 mb-2">
              <Truck size={16} className="text-[hsl(211,67%,28%)]" />
              <h2 className="font-bold text-sm text-[hsl(var(--foreground))]">مندوب الشحن</h2>
            </div>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              الاسم:{' '}
              <span className="font-semibold text-[hsl(var(--foreground))]">{order.delegate}</span>
            </p>
            {/* Phase 23A-Fix1 — delegate phone exposed by the
                widened `get_tracking_info_by_token` RPC (joined
                from profiles.phone via orders.assigned_to). When
                absent — legacy text-only delegate rows or pre-
                migration RPCs — fall back to the previous
                "رقم الهاتف غير مسجل" line. National ID, licence
                numbers, and any other admin-only profile field
                stay redacted server-side and never reach this DTO. */}
            {order.delegatePhone ? (
              <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
                الهاتف:{' '}
                <a
                  href={`tel:${order.delegatePhone}`}
                  className="font-mono font-semibold text-[hsl(var(--primary))] hover:underline"
                  dir="ltr"
                >
                  {order.delegatePhone}
                </a>
              </p>
            ) : (
              <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1 flex items-center gap-1">
                <Phone size={11} /> رقم الهاتف غير مسجل
              </p>
            )}
          </div>
        )}

        {/* Phase 23A — Customer delivery rating panel. Only renders
            after the order has reached `delivered` status. The token
            is used as a stable submission key so a refresh keeps the
            "thank you" state when the customer comes back. */}
        {isDelivered && <DeliveryRatingPanel token={token} delegate={order.delegate} />}

        {/* Order Details */}
        <div className="bg-white rounded-2xl border border-[hsl(var(--border))] shadow-sm p-4">
          <div className="flex items-center gap-2 mb-3">
            <Package size={16} className="text-[hsl(211,67%,28%)]" />
            <h2 className="font-bold text-sm text-[hsl(var(--foreground))]">تفاصيل الطلب</h2>
          </div>
          <div className="space-y-2.5">
            {/* Phase 22H — token URL is unguessable, so identity + address
                are surfaced for the holder. Phone arrives pre-masked from
                the RPC (e.g. `0101****678`); the un-masked value never
                leaves the database. The redacted /track/[orderId] page
                continues to receive empty strings here. */}
            {order.customer && (
              <div className="flex items-start gap-2">
                <User
                  size={13}
                  className="text-[hsl(var(--muted-foreground))] mt-0.5 flex-shrink-0"
                />
                <div>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">العميل</p>
                  <p className="text-sm font-semibold text-[hsl(var(--foreground))]">
                    {order.customer}
                  </p>
                </div>
              </div>
            )}
            {order.phone && (
              <div className="flex items-start gap-2">
                <Phone
                  size={13}
                  className="text-[hsl(var(--muted-foreground))] mt-0.5 flex-shrink-0"
                />
                <div>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">رقم الهاتف</p>
                  <p
                    className="text-sm font-semibold text-[hsl(var(--foreground))] font-mono"
                    dir="ltr"
                  >
                    {order.phone}
                  </p>
                </div>
              </div>
            )}
            {order.region && (
              <div className="flex items-start gap-2">
                <MapPin
                  size={13}
                  className="text-[hsl(var(--muted-foreground))] mt-0.5 flex-shrink-0"
                />
                <div>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">منطقة الشحن</p>
                  <p className="text-sm font-semibold text-[hsl(var(--foreground))]">
                    {order.region}
                    {order.district ? ` — ${order.district}` : ''}
                    {order.neighborhood ? ` — ${order.neighborhood}` : ''}
                  </p>
                  {order.address && (
                    <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5 leading-relaxed">
                      {order.address}
                    </p>
                  )}
                </div>
              </div>
            )}
            <div className="flex items-start gap-2">
              <Package
                size={13}
                className="text-[hsl(var(--muted-foreground))] mt-0.5 flex-shrink-0"
              />
              <div className="flex-1">
                <p className="text-xs text-[hsl(var(--muted-foreground))] mb-1.5">المنتجات</p>
                {order.lines && order.lines.length > 0 ? (
                  <div className="space-y-2">
                    {order.lines.map((line, idx) => {
                      // Phase 22H-Fix1: image bytes are served by the
                      // dedicated /line-image/ endpoint, not embedded
                      // in the polling DTO. We always attempt the URL
                      // and fall back to the emoji on error.
                      return (
                        <div
                          key={`track-line-${idx}`}
                          className="flex items-center gap-3 bg-[hsl(var(--muted))]/30 rounded-xl p-2.5 border border-[hsl(var(--border))]"
                        >
                          <div className="w-11 h-11 rounded-xl overflow-hidden flex-shrink-0 bg-white border border-[hsl(var(--border))] flex items-center justify-center">
                            <TrackLineImage
                              token={token}
                              index={idx}
                              emoji={line.emoji}
                              alt={line.label}
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-[hsl(var(--foreground))] leading-tight">
                              {line.label}
                              {line.color ? ` — ${line.color}` : ''}
                              {line.includeFlashlight ? ' + كشاف' : ''}
                            </p>
                            {/* Phase Tracking-Lines-1 — `line.note` is
                                stripped server-side by the RPC and is
                                never present in the DTO. The previous
                                conditional render was unreachable and
                                is intentionally removed; per-line
                                notes remain internal staff content. */}
                            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                              {line.quantity} × {line.unitPrice.toLocaleString('en-US')} ج.م
                            </p>
                          </div>
                          <div className="text-left flex-shrink-0">
                            <p className="text-sm font-bold font-mono text-[hsl(211,67%,28%)]">
                              {line.total.toLocaleString('en-US')} ج.م
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm font-semibold text-[hsl(var(--foreground))]">
                    {order.products}
                  </p>
                )}
              </div>
            </div>
            {/* Phase 22H — itemised totals. Subtotal / shipping fee /
                extra shipping fee / final total are all rendered when
                the corresponding field arrives populated from the RPC.
                When the order is flagged free_shipping=true, the
                shipping line shows "الشحن مجاني" instead of an amount,
                regardless of whether shipping_fee was 0 or a stored
                positive number. */}
            <div className="pt-2 border-t border-[hsl(var(--border))] space-y-1.5">
              {order.subtotal != null && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[hsl(var(--muted-foreground))]">
                    إجمالي المنتجات
                  </span>
                  <span className="text-sm font-mono text-[hsl(var(--foreground))]">
                    {order.subtotal.toLocaleString('en-US')} ج.م
                  </span>
                </div>
              )}
              {order.freeShipping ? (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[hsl(var(--muted-foreground))]">مصاريف الشحن</span>
                  <span className="text-sm font-bold text-green-600">الشحن مجاني</span>
                </div>
              ) : (
                order.shippingFee != null &&
                order.shippingFee > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[hsl(var(--muted-foreground))]">
                      مصاريف الشحن
                    </span>
                    <span className="text-sm font-mono text-[hsl(var(--foreground))]">
                      {order.shippingFee.toLocaleString('en-US')} ج.م
                    </span>
                  </div>
                )
              )}
              {!order.freeShipping &&
                order.extraShippingFee != null &&
                order.extraShippingFee > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[hsl(var(--muted-foreground))]">شحن إضافي</span>
                    <span className="text-sm font-mono text-[hsl(var(--foreground))]">
                      {order.extraShippingFee.toLocaleString('en-US')} ج.م
                    </span>
                  </div>
                )}
              <div className="flex items-center justify-between pt-1.5 border-t border-[hsl(var(--border))]/60">
                <span className="text-sm text-[hsl(var(--muted-foreground))]">
                  الإجمالي النهائي
                </span>
                <span className="font-bold text-[hsl(211,67%,28%)] text-base font-mono">
                  {order.total.toLocaleString('en-US')} ج.م
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Phase Tracking-Lines-1 — checkout details card.
            Replaces the previous flat-text bullet list (which used
            `checkoutDetailsLines()`) with structured sections so the
            customer can scan معاينة / تركيب / خصم / دفع / إجمالي at
            a glance with icons, RTL labels, and right-aligned
            amounts. The data still comes exclusively from the
            `checkout_details` JSONB envelope the RPC carved out of
            the marker block — raw staff notes are never read.
            `checkoutDetailsLines()` is preserved for the PDF / chat
            surfaces that still want a flat text form. */}
        {order.checkoutDetails && <CheckoutDetailsCard details={order.checkoutDetails} />}

        {/* Download Actions — Invoice & Warranty */}
        <div className="bg-white rounded-2xl border border-[hsl(var(--border))] shadow-sm p-4">
          <div className="flex items-center gap-2 mb-3">
            <Download size={16} className="text-[hsl(211,67%,28%)]" />
            <h2 className="font-bold text-sm text-[hsl(var(--foreground))]">تحميل المستندات</h2>
          </div>
          <div className="space-y-2.5">
            {/* Invoice Download - always available */}
            <button
              onClick={handleDownloadInvoice}
              className="w-full flex items-center gap-3 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl px-4 py-3 transition-colors"
            >
              <div className="w-10 h-10 bg-[hsl(211,67%,28%)] rounded-xl flex items-center justify-center flex-shrink-0">
                <FileText size={18} className="text-white" />
              </div>
              <div className="text-right flex-1">
                <p className="text-sm font-bold text-[hsl(211,67%,28%)]">تحميل الفاتورة PDF</p>
                <p className="text-xs text-blue-600">فاتورة ضريبية مبسطة بتفاصيل الطلب</p>
              </div>
              <Download size={16} className="text-blue-500 flex-shrink-0" />
            </button>

            {/* Warranty Certificate - only on delivery */}
            {isDelivered && hasWarranty ? (
              <button
                onClick={handleDownloadWarranty}
                className="w-full flex items-center gap-3 bg-green-50 hover:bg-green-100 border border-green-200 rounded-xl px-4 py-3 transition-colors"
              >
                <div className="w-10 h-10 bg-green-600 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Award size={18} className="text-white" />
                </div>
                <div className="text-right flex-1">
                  <p className="text-sm font-bold text-green-800">تحميل شهادة الضمان</p>
                  <p className="text-xs text-green-600">ضمان {order.warranty} — متاح بعد التسليم</p>
                </div>
                <Download size={16} className="text-green-500 flex-shrink-0" />
              </button>
            ) : hasWarranty && !isDelivered ? (
              <div className="w-full flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 opacity-60 cursor-not-allowed">
                <div className="w-10 h-10 bg-gray-400 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Shield size={18} className="text-white" />
                </div>
                <div className="text-right flex-1">
                  <p className="text-sm font-bold text-gray-600">شهادة الضمان</p>
                  <p className="text-xs text-gray-500">
                    ستتوفر بعد تسليم الطلب — ضمان {order.warranty}
                  </p>
                </div>
                <Clock size={16} className="text-gray-400 flex-shrink-0" />
              </div>
            ) : null}
          </div>
        </div>

        {/* Delivery Notes */}
        {order.notes && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <ClipboardList size={14} className="text-amber-600" />
              <h2 className="font-bold text-sm text-amber-800">ملاحظات التوصيل</h2>
            </div>
            <p className="text-sm text-amber-700">{order.notes}</p>
          </div>
        )}

        {/* Warranty info badge */}
        {hasWarranty && (
          <div
            className={`border rounded-2xl p-4 flex items-center gap-3 ${isDelivered ? 'bg-green-50 border-green-200' : 'bg-green-50/60 border-green-200/60'}`}
          >
            <Shield size={20} className="text-green-600 flex-shrink-0" />
            <div>
              <p className="text-sm font-bold text-green-800">ضمان المنتج</p>
              <p className="text-xs text-green-600">
                {order.warranty}
                {isDelivered ? ' — يمكنك تحميل الشهادة أعلاه' : ' — يبدأ من تاريخ التسليم'}
              </p>
            </div>
          </div>
        )}

        {/* Support & Complaint Actions */}
        {/* Phase 15 — these buttons open in-page forms wired to the Phase
            14 API routes (POST /api/customer/chat and
            POST /api/customer/complaints). The RPCs behind those routes
            are SECURITY DEFINER and bypass RLS, with rate-limit + duplicate
            guards in 20260507c. Customer enters their own phone — the
            public tracking DTO never returns it. WhatsApp remains a
            fallback for cases where the customer can't reach the form. */}
        <div className="bg-white rounded-2xl border border-[hsl(var(--border))] shadow-sm p-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Headphones size={16} className="text-emerald-600" />
            <h2 className="font-bold text-sm text-[hsl(var(--foreground))]">الدعم والمساعدة</h2>
          </div>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 px-4 py-3 text-sm text-emerald-800">
            <p className="font-bold mb-1">للتواصل معنا</p>
            <p className="text-xs leading-relaxed text-emerald-700">
              تواصل مع فريق الدعم أو سجّل شكوى من هنا، أو استخدم الواتساب الذي وصلك عند تأكيد الطلب.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setActiveChat('support')}
            className="w-full flex items-center gap-3 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl px-4 py-3 transition-colors"
          >
            <div className="w-9 h-9 bg-emerald-600 rounded-xl flex items-center justify-center flex-shrink-0">
              <Headphones size={16} className="text-white" />
            </div>
            <div className="text-right flex-1">
              <p className="text-sm font-bold text-emerald-800">تحدث مع خدمة العملاء</p>
              <p className="text-xs text-emerald-700">سيتواصل معك فريق الدعم عبر الواتساب</p>
            </div>
            <ChevronDown size={16} className="text-emerald-500 -rotate-90" />
          </button>
          <button
            type="button"
            onClick={() => setShowComplaint(true)}
            className="w-full flex items-center gap-3 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl px-4 py-3 transition-colors"
          >
            <div className="w-9 h-9 bg-red-600 rounded-xl flex items-center justify-center flex-shrink-0">
              <AlertCircle size={16} className="text-white" />
            </div>
            <div className="text-right flex-1">
              <p className="text-sm font-bold text-red-800">تقديم شكوى</p>
              <p className="text-xs text-red-700">سيتواصل معك فريق خدمة العملاء</p>
            </div>
            <ChevronDown size={16} className="text-red-500 -rotate-90" />
          </button>
        </div>

        {/* Last updated */}
        <div className="text-center pb-6">
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
            <p className="text-xs text-amber-200/70">
              آخر تحديث:{' '}
              {lastUpdated.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: true,
              })}
            </p>
          </div>
          <p className="text-xs text-amber-200/50">يتحدث تلقائياً كل 10 ثوانٍ</p>
        </div>
      </div>

      {/* Chat Panels */}
      {activeChat && order && (
        <ChatPanel
          type={activeChat}
          token={token}
          order={order}
          onClose={() => setActiveChat(null)}
        />
      )}
      {showComplaint && order && (
        <ComplaintModal order={order} onClose={() => setShowComplaint(false)} />
      )}
    </div>
  );
}
