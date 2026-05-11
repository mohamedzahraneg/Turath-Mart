'use client';
// ─────────────────────────────────────────────────────────────────────────────
// /customers/[customerKey] — Phase 24A
//
// Customer profile page. Reads all per-customer slices from existing
// tables (customers, orders, complaints, chat, ratings, audit_logs)
// PLUS the new Phase 24A scaffolding (customer_notes, customer_tasks,
// customer_attachments). All metric folding goes through the pure
// `customerCrm.ts` helper.
//
// Tabs (in order):
//   نظرة عامة  → overview cards: cancelled / orders / returned /
//                open complaints / upcoming tasks / latest activity /
//                delegate notes
//   البيانات   → editable customer profile (CRM-write)
//   الطلبات    → orders table
//   الشكاوى    → complaints list
//   الاقتراحات → empty-state placeholder (no dedicated table yet —
//                tracked as a follow-up)
//   الشات       → order-grouped chat history (Phase 23K respect)
//   الملاحظات   → notes feed + add note
//   السجل      → unified timeline
//   المرفقات    → uploads via private bucket + signed URLs
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ChevronLeft,
  Phone as PhoneIcon,
  MessageCircle,
  Mail,
  Plus,
  Camera,
  Star,
  ShoppingBag,
  RotateCcw,
  XCircle,
  AlertCircle,
  TrendingUp,
  Clock,
  Briefcase,
  ListChecks,
  ClipboardCheck,
  Activity,
  StickyNote,
  Paperclip,
  Search,
  Eye,
  Upload,
  Download,
  X,
  FileText,
  Calendar,
  Send,
  AlertTriangle,
  Save,
  CheckCircle2,
} from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { createClient } from '@/lib/supabase/client';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/contexts/AuthContext';
// Phase 24A-Fix1 — reuse the canonical order-detail modal so the
// profile-side "عرض" button opens the full order details in-place
// instead of routing out to /orders-management.
import OrderDetailModal from '@/app/orders-management/components/OrderDetailModal';
// Phase 24C — reuse the canonical AddOrderModal so creating an order
// from inside the customer profile shares every validator + payload
// shape with the existing /orders-management header. We load it
// dynamically (the modal is ~2,000 lines and only renders after a
// button click). `defaultCustomer` was added in this phase so the
// modal lands with the customer's prefilled fields.
import dynamic from 'next/dynamic';
import type { AddOrderDefaultCustomer } from '@/app/orders-management/components/AddOrderModal';
const AddOrderModal = dynamic(() => import('@/app/orders-management/components/AddOrderModal'), {
  ssr: false,
});
// Phase 24C — order-create permission gate; matches the role set
// already allowed by /orders-management.
import { canCreateOrders } from '@/lib/constants/roles';
import { toast } from 'sonner';
import {
  type AttachmentRow,
  type AuditRow,
  type ChatRow,
  type ComplaintRow,
  type CustomerRow,
  type NoteRow,
  type OrderRow,
  type RatingRow,
  type TaskRow,
  COMPLAINT_STATUS_LABEL_AR,
  COMPLAINT_STATUS_TONE,
  ORDER_STATUS_LABEL_AR,
  ORDER_STATUS_TONE,
  TASK_PRIORITY_LABEL_AR,
  TASK_PRIORITY_TONE,
  TASK_STATUS_LABEL_AR,
  TASK_STATUS_TONE,
  // Phase 24D — tasks helpers.
  deriveTaskFlags,
  rankTasks,
  buildMailtoHref,
  buildTelHref,
  buildTimeline,
  buildWhatsAppHref,
  computeCustomerMetrics,
  customerStatusLabel,
  customerStatusTone,
  customerTypeLabel,
  customerTypeTone,
  deriveAccountStatus,
  deriveCustomerClassification,
  fmtDateTimeAr,
  fmtDateYmd,
  fmtMoney,
  fmtMoneyShort,
  fmtRate,
  normalisePhone,
  phoneFromCustomerKey,
  customerKeyFromPhone,
} from '@/lib/crm/customerCrm';

type TabId =
  | 'overview'
  | 'data'
  | 'orders'
  | 'tasks'
  | 'complaints'
  | 'suggestions'
  | 'chat'
  | 'notes'
  | 'timeline'
  | 'attachments';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'overview', label: 'نظرة عامة', icon: <TrendingUp size={14} /> },
  { id: 'data', label: 'البيانات', icon: <ListChecks size={14} /> },
  { id: 'orders', label: 'الطلبات', icon: <ShoppingBag size={14} /> },
  // Phase 24D — promote tasks from an overview-only card to a
  // first-class tab so the dispatcher can add / start / complete /
  // cancel without having to leave the profile.
  { id: 'tasks', label: 'مهام العميل', icon: <ClipboardCheck size={14} /> },
  { id: 'complaints', label: 'الشكاوى', icon: <AlertCircle size={14} /> },
  { id: 'suggestions', label: 'الاقتراحات', icon: <Star size={14} /> },
  { id: 'chat', label: 'الشات والمحادثات', icon: <MessageCircle size={14} /> },
  { id: 'notes', label: 'الملاحظات', icon: <StickyNote size={14} /> },
  { id: 'timeline', label: 'السجل الزمني', icon: <Activity size={14} /> },
  { id: 'attachments', label: 'المرفقات', icon: <Paperclip size={14} /> },
];

export default function CustomerProfilePage() {
  const params = useParams<{ customerKey: string }>();
  const router = useRouter();
  const customerKey = params?.customerKey ?? '';
  const phone = phoneFromCustomerKey(customerKey);
  const perms = usePermissions();
  const { profileFullName, user, currentRoleId } = useAuth();
  const canEdit = perms.isAdmin;
  // Phase 24C — order-creation gate. Mirrors /orders-management; r3
  // (shipping supervisor) sees the customer profile read-only and
  // therefore no "إنشاء طلب جديد" button. Delegate r4 and anon never
  // reach this page.
  const canCreateOrder = canCreateOrders(currentRoleId ?? null);

  const [customer, setCustomer] = useState<CustomerRow | null>(null);
  // Phase 24B — additional customer rows that share the same
  // normalised phone. Drives the "يوجد أكثر من سجل لهذا الرقم"
  // banner near the header. Empty array when no duplicates exist.
  const [duplicateSiblings, setDuplicateSiblings] = useState<CustomerRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [complaints, setComplaints] = useState<ComplaintRow[]>([]);
  const [chat, setChat] = useState<ChatRow[]>([]);
  const [ratings, setRatings] = useState<RatingRow[]>([]);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [audits, setAudits] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [search, setSearch] = useState('');
  // Phase 24A-Fix1 — order-detail modal state. `openOrderId` is the
  // turath_masr_orders.id the user clicked. `modalOrder` is the
  // mapped full row we hand to <OrderDetailModal />. `modalLoading`
  // is briefly true between click and fetch completion.
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [modalOrder, setModalOrder] = useState<OrderModalShape | null>(null);
  // Phase 24C — controls the AddOrderModal mount for the customer-
  // profile entry point. The launcher button below the header opens
  // it; `onSuccess` closes it, fires a toast, and refetches the
  // customer's orders via the existing `reloadTick` hook.
  const [addOrderOpen, setAddOrderOpen] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  useEffect(() => {
    if (!phone) return;
    let cancelled = false;
    setLoading(true);
    setErrorBanner(null);
    (async () => {
      const supabase = createClient();
      const since = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();

      const [
        custRes,
        ordersRes,
        complaintsRes,
        chatRes,
        ratingsRes,
        notesRes,
        tasksRes,
        attRes,
        auditRes,
      ] = await Promise.all([
        // Phase 24B — fetch ALL customer rows whose phone hashes to
        // the same normalised number (common stored variants:
        // 01XXXXXXXXX / +201XXXXXXXXX / 201XXXXXXXXX / 1XXXXXXXXX).
        // The first matching row is the primary profile; any extras
        // surface in the "duplicate sibling" banner. `.in(phone, [...])`
        // catches the common stored shapes without needing a full
        // 2,000-row pull.
        supabase
          .from('turath_masr_customers')
          .select(
            'phone, full_name, email, address, segment, city, customer_type, customer_status, account_manager_id, account_manager_name, vip_level, notes, total_spent, total_orders, created_at, updated_at'
          )
          .in('phone', buildPhoneVariants(phone))
          .order('updated_at', { ascending: false, nullsFirst: false })
          .limit(50)
          .then(
            (r: { data: CustomerRow[] | null; error: unknown }) => r,
            (err: unknown) => ({ data: null as CustomerRow[] | null, error: err })
          ),
        supabase
          .from('turath_masr_orders')
          .select(
            // Phase 24C — also pull region/district/neighborhood/address
            // so the new "إنشاء طلب جديد" launcher can prefill the
            // Add Order modal from the customer's latest shipping
            // destination without a second round-trip.
            'id, order_num, customer, phone, phone2, total, status, date, delegate_name, scheduled_delivery_date, scheduled_delivery_from, scheduled_delivery_to, tracking_token, notes, region, district, neighborhood, address, created_at'
          )
          .or(`phone.eq.${phone},phone2.eq.${phone}`)
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(500),
        supabase
          .from('turath_masr_crm_complaints')
          .select('id, customer_phone, subject, status, notes, created_by, created_at')
          .eq('customer_phone', phone)
          .order('created_at', { ascending: false })
          .limit(200),
        supabase
          .from('turath_masr_crm_chat')
          .select('id, customer_phone, sender, message, chat_type, order_id, created_at')
          .eq('customer_phone', phone)
          .order('created_at', { ascending: false })
          .limit(500),
        supabase
          .from('turath_masr_delegate_ratings')
          .select('id, order_id, delegate_name, rating, comment, customer_phone, created_at')
          .eq('customer_phone', phone)
          .order('created_at', { ascending: false })
          .limit(100),
        supabase
          .from('turath_masr_customer_notes')
          .select(
            'id, customer_phone, customer_name, order_id, note, note_type, visibility, status, created_by, created_by_name, created_at, updated_at'
          )
          .eq('customer_phone', phone)
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(200)
          .then(
            (r: { data: NoteRow[] | null; error: unknown }) => r,
            (err: unknown) => ({ data: null as NoteRow[] | null, error: err })
          ),
        supabase
          .from('turath_masr_customer_tasks')
          .select(
            'id, customer_phone, customer_name, order_id, title, description, priority, status, due_at, assigned_to, assigned_to_name, created_by, created_by_name, created_at, updated_at'
          )
          .eq('customer_phone', phone)
          .order('created_at', { ascending: false })
          .limit(200)
          .then(
            (r: { data: TaskRow[] | null; error: unknown }) => r,
            (err: unknown) => ({ data: null as TaskRow[] | null, error: err })
          ),
        supabase
          .from('turath_masr_customer_attachments')
          .select(
            'id, customer_phone, customer_name, order_id, file_path, file_name, mime_type, size_bytes, uploaded_by, uploaded_by_name, uploaded_at, note, status'
          )
          .eq('customer_phone', phone)
          .eq('status', 'active')
          .order('uploaded_at', { ascending: false })
          .limit(200)
          .then(
            (r: { data: AttachmentRow[] | null; error: unknown }) => r,
            (err: unknown) => ({ data: null as AttachmentRow[] | null, error: err })
          ),
        supabase
          .from('turath_masr_audit_logs')
          .select(
            'id, order_id, order_num, action, field_changed, old_value, new_value, changed_by, changed_by_role, note, created_at'
          )
          .order('created_at', { ascending: false })
          .limit(500)
          .then(
            (r: { data: AuditRow[] | null; error: unknown }) => r,
            (err: unknown) => ({ data: null as AuditRow[] | null, error: err })
          ),
      ]);

      if (cancelled) return;

      if (custRes.error) {
        setErrorBanner('تعذر تحميل بيانات العميل.');
      }
      const orderRows = (ordersRes.data ?? []) as OrderRow[];
      setOrders(orderRows);
      // Phase 24B — the fetch now returns an array (potentially with
      // duplicate sibling rows). Pick the freshest as primary and
      // surface the rest in the duplicate-notice card.
      const allMatching = ((custRes.data as CustomerRow[] | null) || []).filter(
        (c) => normalisePhone(c.phone) === phone
      );
      setCustomer(
        allMatching[0] ??
          (orderRows[0]
            ? {
                phone,
                full_name: orderRows[0].customer,
                email: null,
                address: null,
                segment: null,
                city: null,
                customer_type: null,
                customer_status: null,
                account_manager_id: null,
                account_manager_name: null,
                vip_level: null,
                notes: null,
                total_spent: null,
                total_orders: null,
                created_at: null,
                updated_at: null,
              }
            : null)
      );
      setDuplicateSiblings(allMatching.length > 1 ? allMatching.slice(1) : []);

      setComplaints((complaintsRes.data ?? []) as ComplaintRow[]);
      // Chat rows: only show ones with order_id (Phase 23K — order-scoped)
      // and any legacy rows where order_id is null (backward compat).
      setChat((chatRes.data ?? []) as ChatRow[]);
      setRatings((ratingsRes.data ?? []) as RatingRow[]);
      setNotes((notesRes.data ?? []) as NoteRow[]);
      setTasks((tasksRes.data ?? []) as TaskRow[]);
      setAttachments((attRes.data ?? []) as AttachmentRow[]);

      // Narrow audit logs to the orders we just loaded.
      const orderIds = new Set(orderRows.map((o) => o.id));
      setAudits(((auditRes.data ?? []) as AuditRow[]).filter((a) => orderIds.has(a.order_id)));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [phone, reloadTick]);

  const metrics = useMemo(
    () =>
      computeCustomerMetrics({
        orders,
        complaints,
        chat,
        ratings,
        notes,
      }),
    [orders, complaints, chat, ratings, notes]
  );

  // Phase 24A-Fix1 — open-order fetch. Triggered when the orders-tab
  // "عرض" button sets `openOrderId`. We pull the full row (narrow
  // column list, `lines` jsonb included so the modal can render the
  // line items — but we strip the `image` field per slot before
  // handing the rows to the modal so heavy base64 / external images
  // are never rendered from this surface).
  useEffect(() => {
    if (!openOrderId) {
      setModalOrder(null);
      setModalError(null);
      return;
    }
    let cancelled = false;
    setModalLoading(true);
    setModalError(null);
    (async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('turath_masr_orders')
        .select(
          'id, order_num, tracking_token, created_by, created_by_device, created_by_ip, created_by_location, customer, phone, phone2, region, district, neighborhood, address, products, quantity, subtotal, shipping_fee, extra_shipping_fee, express_shipping, free_shipping, total, status, date, time, day, notes, warranty, delegate_name, lines, scheduled_delivery_date, scheduled_delivery_from, scheduled_delivery_to, scheduled_delivery_reason, scheduled_delivery_updated_at, scheduled_delivery_updated_by, created_at'
        )
        .eq('id', openOrderId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setModalError('تعذر تحميل تفاصيل الطلب.');
        setModalLoading(false);
        return;
      }
      setModalOrder(mapToOrderModalShape(data));
      setModalLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [openOrderId]);

  const initials = useMemo(() => {
    const name = customer?.full_name || phone || '?';
    return (name.trim().split(/\s+/)[0]?.charAt(0) || '?').toUpperCase();
  }, [customer?.full_name, phone]);

  const wa = buildWhatsAppHref(phone);
  const tel = buildTelHref(phone);
  const mailto = buildMailtoHref(customer?.email);

  // Customer code derived from the phone tail. Phase 24A-Fix1 — numeric
  // only (was "C-XXXX"). The numeric form lines up with the dashboard
  // table, and dashboard search still tolerates a "C-" prefix.
  const customerCode = useMemo(() => {
    if (!phone) return '—';
    return phone.slice(-4);
  }, [phone]);

  // Phase 24A-Fix1 — derive classification + account status on render
  // so a new order automatically flips the badge without a job.
  const derivedType = useMemo(
    () => deriveCustomerClassification(customer ?? {}, metrics),
    [customer, metrics]
  );
  const derivedStatus = useMemo(
    () => deriveAccountStatus(customer ?? {}, metrics),
    [customer, metrics]
  );

  const refresh = useCallback(() => setReloadTick((n) => n + 1), []);

  if (!phone) {
    return (
      <AppLayout currentPath="/customers">
        <div dir="rtl" className="p-6 text-center">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">رقم العميل غير صحيح.</p>
          <button
            type="button"
            onClick={() => router.push('/customers')}
            className="mt-3 text-sm text-[hsl(var(--primary))] hover:underline"
          >
            العودة لقائمة العملاء
          </button>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout currentPath="/customers">
      <div className="space-y-4 fade-in" dir="rtl">
        {/* Breadcrumb + search */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs">
            <Link
              href="/customers"
              className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
            >
              العملاء
            </Link>
            <ChevronLeft size={12} className="text-[hsl(var(--muted-foreground))]" />
            <span className="text-[hsl(var(--foreground))] font-semibold">ملف العميل</span>
          </div>
          <div className="flex-1 max-w-md">
            <div className="relative">
              <Search
                size={14}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]"
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث في ملف العميل…"
                className="input-field pr-9 w-full text-xs"
              />
            </div>
          </div>
        </div>

        {/* Header card */}
        <div className="bg-white rounded-2xl border border-[hsl(var(--border))] p-5">
          <div className="flex flex-col lg:flex-row gap-5 items-stretch lg:items-center">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="w-24 h-24 rounded-full bg-[hsl(var(--primary))]/10 flex items-center justify-center text-[hsl(var(--primary))] font-bold text-3xl">
                  {initials}
                </div>
                <button
                  type="button"
                  className="absolute -bottom-1 -left-1 w-7 h-7 rounded-full bg-white border border-[hsl(var(--border))] flex items-center justify-center text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))]"
                  title="تغيير الصورة (قريبًا)"
                  disabled
                >
                  <Camera size={12} />
                </button>
              </div>
              <div>
                <p className="text-[10px] font-mono text-[hsl(var(--muted-foreground))]">
                  #{customerCode}
                </p>
                <h1 className="text-xl font-bold text-[hsl(var(--foreground))] mt-0.5">
                  {customer?.full_name || phone || 'بدون اسم'}
                </h1>
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  {/* Phase 24A-Fix1 — derived account status (نشط /
                      غير نشط) + derived classification (مميز / جديد /
                      نشط / تحذير / غير نشط / عادي). Both flip
                      automatically when a new order lands. */}
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border text-[10px] font-semibold px-2 py-0.5 ${customerStatusTone(derivedStatus)}`}
                  >
                    <CheckCircle2 size={10} />
                    {customerStatusLabel(derivedStatus)}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border text-[10px] font-semibold px-2 py-0.5 ${customerTypeTone(derivedType)}`}
                  >
                    {customerTypeLabel(derivedType)}
                  </span>
                  {customer?.vip_level && (
                    <span className="inline-flex rounded-full border bg-violet-50 text-violet-700 border-violet-200 text-[10px] font-semibold px-2 py-0.5">
                      VIP {customer.vip_level}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-1 flex-wrap gap-x-6 gap-y-2 text-xs">
              <ProfileFact
                icon={<UserBadgeIcon />}
                label="مسؤول الحساب"
                value={customer?.account_manager_name || '—'}
              />
              <ProfileFact
                icon={<PhoneIcon size={12} className="text-[hsl(var(--muted-foreground))]" />}
                label="الهاتف"
                value={phone}
                dir="ltr"
              />
              <ProfileFact
                icon={<Mail size={12} className="text-[hsl(var(--muted-foreground))]" />}
                label="البريد الإلكتروني"
                value={customer?.email || '—'}
                dir="ltr"
              />
              <ProfileFact
                icon={<Calendar size={12} className="text-[hsl(var(--muted-foreground))]" />}
                label="المدينة"
                value={customer?.city || '—'}
              />
              <ProfileFact
                icon={<Star size={12} className="text-amber-500" />}
                label="متوسط التقييم"
                value={
                  metrics.averageRating == null ? '—' : `${metrics.averageRating.toFixed(1)} / 5`
                }
              />
            </div>

            <div className="flex flex-wrap gap-2 justify-end self-start lg:self-center">
              {tel && (
                <a
                  href={tel}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold"
                >
                  <PhoneIcon size={13} /> اتصال
                </a>
              )}
              {wa && (
                <a
                  href={wa}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-semibold"
                >
                  <MessageCircle size={13} /> واتساب
                </a>
              )}
              {mailto && (
                <a
                  href={mailto}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-50 hover:bg-violet-100 text-violet-700 text-xs font-semibold"
                >
                  <Mail size={13} /> إرسال إيميل
                </a>
              )}
              {/* Phase 24C — "إنشاء طلب جديد" launcher. Hidden for roles
                  that can't create orders (e.g. r3 shipping supervisor,
                  delegates never reach this page). Opens the existing
                  /orders-management AddOrderModal with prefilled
                  customer fields and refetches the orders tab on
                  success. */}
              {canCreateOrder && (
                <button
                  type="button"
                  onClick={() => setAddOrderOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
                >
                  <ShoppingBag size={13} /> إنشاء طلب جديد
                </button>
              )}
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => setActiveTab('notes')}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[hsl(var(--primary))] hover:opacity-90 text-white text-xs font-semibold disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
              >
                <Plus size={13} /> إضافة
              </button>
            </div>
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
          <KpiTile label="نسبة الاستلام" value={fmtRate(metrics.receiptRate)} tone="emerald" />
          <KpiTile label="نسبة المرتجعات" value={fmtRate(metrics.returnRate)} tone="amber" />
          <KpiTile label="نسبة الإلغاء" value={fmtRate(metrics.cancelRate)} tone="red" />
          <KpiTile label="إجمالي الطلبات" value={String(metrics.totalOrders)} tone="blue" />
          <KpiTile
            label="إجمالي المشتريات"
            value={fmtMoneyShort(metrics.totalSpent)}
            tone="violet"
          />
          <KpiTile label="الشكاوى المفتوحة" value={String(metrics.openComplaints)} tone="red" />
          <KpiTile
            label="متوسط التقييم"
            value={metrics.averageRating == null ? '—' : metrics.averageRating.toFixed(1)}
            tone="amber"
          />
          <KpiTile
            label="أحدث تواصل"
            value={metrics.lastContactAt ? fmtDateYmd(metrics.lastContactAt) : '—'}
            tone="slate"
          />
        </div>

        {errorBanner && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800 flex items-center gap-2">
            <AlertCircle size={14} /> {errorBanner}
          </div>
        )}

        {/* Phase 24B — duplicate-sibling banner. Surfaced only when
            additional customer rows share this normalised phone. We
            never auto-merge — the dispatcher decides. */}
        {duplicateSiblings.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold text-amber-800">
              <AlertCircle size={16} />
              يوجد {duplicateSiblings.length + 1} سجل لهذا الرقم
            </div>
            <p className="text-xs text-amber-700 leading-relaxed">
              نفس الرقم يظهر في أكثر من بطاقة عميل. راجع السجلات أدناه — لم يتم الدمج تلقائيًا.
            </p>
            <ul className="space-y-2">
              {duplicateSiblings.map((sib) => {
                const sibKey = customerKeyFromPhone(sib.phone) || sib.phone;
                return (
                  <li
                    key={sib.phone + (sib.created_at || '')}
                    className="flex flex-wrap items-center justify-between gap-2 bg-white rounded-xl border border-amber-200 px-3 py-2 text-xs"
                  >
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-semibold text-[hsl(var(--foreground))]">
                        {sib.full_name || 'بدون اسم'}
                      </span>
                      <span className="font-mono text-[hsl(var(--muted-foreground))]" dir="ltr">
                        {sib.phone}
                      </span>
                      {sib.created_at && (
                        <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
                          أنشئ {fmtDateYmd(sib.created_at)}
                        </span>
                      )}
                    </div>
                    <Link
                      href={`/customers/${sibKey}`}
                      className="px-2 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 font-bold"
                    >
                      فتح الملف
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Tabs */}
        <div className="bg-white rounded-2xl border border-[hsl(var(--border))] overflow-hidden">
          <div className="flex flex-wrap gap-1 px-3 pt-3 border-b border-[hsl(var(--border))] overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === t.id
                    ? 'border-[hsl(var(--primary))] text-[hsl(var(--primary))]'
                    : 'border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          <div className="p-4">
            {loading ? (
              <div className="text-center text-sm text-[hsl(var(--muted-foreground))] py-10">
                جارٍ التحميل…
              </div>
            ) : (
              <>
                {activeTab === 'overview' && (
                  <OverviewTab
                    customerKey={customerKey}
                    orders={orders}
                    complaints={complaints}
                    tasks={tasks}
                    notes={notes}
                    audits={audits}
                    ratings={ratings}
                  />
                )}
                {activeTab === 'data' && (
                  <DataTab
                    customer={customer}
                    phone={phone}
                    canEdit={canEdit}
                    metrics={metrics}
                    onSaved={refresh}
                  />
                )}
                {activeTab === 'orders' && (
                  <OrdersTab orders={orders} search={search} onOpenOrder={setOpenOrderId} />
                )}
                {activeTab === 'tasks' && (
                  <TasksTab
                    tasks={tasks}
                    orders={orders}
                    customerPhone={phone}
                    customerName={customer?.full_name || null}
                    canEdit={canEdit}
                    userId={user?.id ?? null}
                    userName={profileFullName ?? user?.email ?? null}
                    onChanged={refresh}
                  />
                )}
                {activeTab === 'complaints' && (
                  <ComplaintsTab complaints={complaints} search={search} />
                )}
                {activeTab === 'suggestions' && <SuggestionsTab />}
                {activeTab === 'chat' && <ChatTab chat={chat} orders={orders} />}
                {activeTab === 'notes' && (
                  <NotesTab
                    notes={notes}
                    customerPhone={phone}
                    customerName={customer?.full_name || null}
                    canEdit={canEdit}
                    userId={user?.id ?? null}
                    userName={profileFullName ?? user?.email ?? null}
                    onChanged={refresh}
                  />
                )}
                {activeTab === 'timeline' && (
                  <TimelineTab
                    orders={orders}
                    complaints={complaints}
                    chat={chat}
                    notes={notes}
                    tasks={tasks}
                    ratings={ratings}
                    attachments={attachments}
                    audits={audits}
                    search={search}
                  />
                )}
                {activeTab === 'attachments' && (
                  <AttachmentsTab
                    attachments={attachments}
                    customerPhone={phone}
                    customerName={customer?.full_name || null}
                    canEdit={canEdit}
                    userId={user?.id ?? null}
                    userName={profileFullName ?? user?.email ?? null}
                    onChanged={refresh}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Phase 24A-Fix1 — order detail modal triggered from the
          orders tab. Keeps the user in the customer-profile context
          instead of routing out to /orders-management. */}
      {openOrderId && (
        <>
          {modalLoading && !modalOrder && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
              dir="rtl"
            >
              <div className="bg-white rounded-2xl px-6 py-4 text-sm text-[hsl(var(--muted-foreground))]">
                جارٍ تحميل تفاصيل الطلب…
              </div>
            </div>
          )}
          {modalError && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
              dir="rtl"
              onClick={() => setOpenOrderId(null)}
            >
              <div className="bg-white rounded-2xl px-6 py-4 text-sm text-red-700 max-w-md">
                <p className="font-semibold mb-2">تعذر تحميل تفاصيل الطلب</p>
                <p className="text-xs">{modalError}</p>
              </div>
            </div>
          )}
          {modalOrder && (
            <OrderDetailModal
              order={modalOrder}
              onClose={() => {
                setOpenOrderId(null);
                setModalOrder(null);
                setModalError(null);
              }}
            />
          )}
        </>
      )}

      {/* Phase 24C — Add Order modal opened from the customer profile.
          Prefilled with the customer row + the latest order's address
          fields so the dispatcher doesn't retype the destination on
          every repeat order. On success we fire a toast and bump
          `reloadTick` so the orders tab + metrics refresh in place. */}
      {addOrderOpen && canCreateOrder && (
        <AddOrderModal
          defaultCustomer={buildAddOrderDefault(customer, orders, phone)}
          onClose={() => setAddOrderOpen(false)}
          onSuccess={({ orderNum }) => {
            setAddOrderOpen(false);
            toast.success(`تم إنشاء الطلب ${orderNum} وربطه بالعميل بنجاح.`);
            refresh();
          }}
        />
      )}
    </AppLayout>
  );
}

// Phase 24C — Build the AddOrderModal prefill from the freshest data
// the profile already has in memory:
//   • customer name comes from the customers row (or the latest order
//     when the customer row is missing — same fallback the profile
//     header uses).
//   • phone comes from the route's normalised phone (always ASCII).
//   • phone2 + region + district + neighborhood + address come from
//     the most recent order that has them populated (orders are
//     already sorted DESC by created_at on the profile fetch).
function buildAddOrderDefault(
  customer: CustomerRow | null,
  orders: OrderRow[],
  routePhone: string
): AddOrderDefaultCustomer {
  // Find the freshest order with any address fragment so we don't
  // pick an old order with `address=null` over a recent one.
  const recent = orders.find(
    (o) =>
      o.phone2 ||
      o.notes ||
      (o as { region?: string | null }).region ||
      (o as { address?: string | null }).address
  );
  // The slim OrderRow type doesn't carry region / district /
  // neighborhood / address — read them off the row via a defensive
  // cast. They land on `turath_masr_orders` and are selected by the
  // page-level fetch (see /track helpers).
  const r = (recent ?? null) as
    | (OrderRow & {
        region?: string | null;
        district?: string | null;
        neighborhood?: string | null;
        address?: string | null;
      })
    | null;
  return {
    name: customer?.full_name?.trim() || recent?.customer?.trim() || '',
    phone: routePhone,
    phone2: r?.phone2 ?? null,
    region: r?.region ?? null,
    district: r?.district ?? null,
    neighborhood: r?.neighborhood ?? null,
    address: r?.address ?? customer?.address ?? null,
  };
}

// ─── Phase 24A-Fix1 — Order → OrderDetailModal shape mapper ──────────────
//
// The canonical modal under `/orders-management/components` expects a
// rich camelCase `Order` shape. We pass the slim profile-page row +
// the full fetched row through this mapper so the modal renders
// without crashing on missing fields. Line images are stripped before
// the modal renders — even if a legacy line has a base64 blob in
// jsonb, the customer profile never paints it.

interface OrderModalLineShape {
  productType: string;
  label: string;
  emoji?: string;
  color?: string | null;
  quantity: number;
  unitPrice: number;
  includeFlashlight?: boolean;
  flashlightPrice?: number;
  note?: string | null;
  total: number;
  // `image` intentionally omitted — Fix1 contract.
}

export interface OrderModalShape {
  id: string;
  orderNum: string;
  trackingToken?: string | null;
  createdBy: string;
  createdByIp?: string;
  createdByLocation?: string;
  createdByDevice?: string;
  customer: string;
  phone: string;
  phone2?: string;
  region: string;
  district?: string;
  neighborhood?: string | null;
  address: string;
  products: string;
  quantity: number;
  subtotal: number;
  shippingFee: number;
  extraShippingFee?: number;
  expressShipping?: boolean;
  total: number;
  status: string;
  date: string;
  time: string;
  day: string;
  notes?: string;
  ip: string;
  warranty?: string;
  delegate?: string;
  scheduledDeliveryDate?: string | null;
  scheduledDeliveryFrom?: string | null;
  scheduledDeliveryTo?: string | null;
  scheduledDeliveryReason?: string | null;
  scheduledDeliveryUpdatedAt?: string | null;
  scheduledDeliveryUpdatedBy?: string | null;
  lines?: OrderModalLineShape[];
}

interface RawOrderRowFromDb {
  id: string;
  order_num: string;
  tracking_token?: string | null;
  created_by?: string | null;
  created_by_device?: string | null;
  created_by_ip?: string | null;
  created_by_location?: string | null;
  customer?: string | null;
  phone?: string | null;
  phone2?: string | null;
  region?: string | null;
  district?: string | null;
  neighborhood?: string | null;
  address?: string | null;
  products?: string | null;
  quantity?: number | null;
  subtotal?: number | null;
  shipping_fee?: number | null;
  extra_shipping_fee?: number | null;
  express_shipping?: boolean | null;
  free_shipping?: boolean | null;
  total?: number | null;
  status?: string | null;
  date?: string | null;
  time?: string | null;
  day?: string | null;
  notes?: string | null;
  warranty?: string | null;
  delegate_name?: string | null;
  lines?: unknown;
  scheduled_delivery_date?: string | null;
  scheduled_delivery_from?: string | null;
  scheduled_delivery_to?: string | null;
  scheduled_delivery_reason?: string | null;
  scheduled_delivery_updated_at?: string | null;
  scheduled_delivery_updated_by?: string | null;
  created_at?: string | null;
}

// Phase 24B — common stored phone shapes for a single normalised
// number. The Supabase fetch uses `.in('phone', […])` over this list,
// which catches `01XXXXXXXXX`, `+201XXXXXXXXX`, `201XXXXXXXXX`, and
// the leading-zero-stripped form. A client-side `normalisePhone`
// equality check then narrows the result to true siblings only.
function buildPhoneVariants(normalised: string): string[] {
  const variants = new Set<string>();
  variants.add(normalised);
  if (normalised.startsWith('0')) {
    const noZero = normalised.slice(1);
    variants.add(noZero);
    variants.add('+20' + noZero);
    variants.add('20' + noZero);
    variants.add('0020' + noZero);
  }
  return Array.from(variants);
}

function mapToOrderModalShape(row: RawOrderRowFromDb): OrderModalShape {
  const created = row.created_at || '';
  const datePart = row.date || created.split('T')[0] || '';
  const timePart = row.time || created.split('T')[1]?.substring(0, 5) || '';

  // Strip `image` from every line slot. The DB jsonb may carry an
  // `image` URL or (worse) a base64 blob — we never render it from
  // the customer profile per the Fix1 contract.
  const rawLines = Array.isArray(row.lines) ? row.lines : null;
  const lines = rawLines
    ? rawLines.map((l: Record<string, unknown>) => {
        const out: OrderModalLineShape = {
          productType: typeof l.productType === 'string' ? l.productType : '',
          label: typeof l.label === 'string' ? l.label : '',
          emoji: typeof l.emoji === 'string' ? l.emoji : undefined,
          color: typeof l.color === 'string' ? l.color : null,
          quantity: typeof l.quantity === 'number' ? l.quantity : Number(l.quantity || 1),
          unitPrice: typeof l.unitPrice === 'number' ? l.unitPrice : Number(l.unitPrice || 0),
          includeFlashlight: Boolean(l.includeFlashlight),
          flashlightPrice:
            typeof l.flashlightPrice === 'number'
              ? l.flashlightPrice
              : Number(l.flashlightPrice || 0),
          note: typeof l.note === 'string' ? l.note : null,
          total: typeof l.total === 'number' ? l.total : Number(l.total || 0),
        };
        return out;
      })
    : undefined;

  return {
    id: row.id,
    orderNum: row.order_num,
    trackingToken: row.tracking_token ?? null,
    createdBy: row.created_by || 'غير معروف',
    createdByIp: row.created_by_ip ?? undefined,
    createdByLocation: row.created_by_location ?? undefined,
    createdByDevice: row.created_by_device ?? undefined,
    customer: row.customer || '',
    phone: row.phone || '',
    phone2: row.phone2 ?? undefined,
    region: row.region || '',
    district: row.district ?? undefined,
    neighborhood: row.neighborhood ?? null,
    address: row.address || '',
    products: row.products || '',
    quantity: Number(row.quantity ?? 1),
    subtotal: Number(row.subtotal ?? (row.total ?? 0) - (row.shipping_fee ?? 0)),
    shippingFee: Number(row.shipping_fee ?? 0),
    extraShippingFee: row.extra_shipping_fee == null ? undefined : Number(row.extra_shipping_fee),
    expressShipping: row.express_shipping ?? undefined,
    total: Number(row.total ?? 0),
    status: row.status || 'new',
    date: datePart,
    time: timePart,
    day: row.day || '',
    notes: row.notes ?? undefined,
    ip: '',
    warranty: row.warranty ?? undefined,
    delegate: row.delegate_name ?? undefined,
    scheduledDeliveryDate: row.scheduled_delivery_date ?? null,
    scheduledDeliveryFrom: row.scheduled_delivery_from ?? null,
    scheduledDeliveryTo: row.scheduled_delivery_to ?? null,
    scheduledDeliveryReason: row.scheduled_delivery_reason ?? null,
    scheduledDeliveryUpdatedAt: row.scheduled_delivery_updated_at ?? null,
    scheduledDeliveryUpdatedBy: row.scheduled_delivery_updated_by ?? null,
    lines,
  };
}

// ─── Small reusable components ───────────────────────────────────────────

function ProfileFact({
  icon,
  label,
  value,
  dir,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  dir?: 'ltr' | 'rtl';
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))] mb-0.5 flex items-center gap-1">
        {icon} {label}
      </p>
      <p className="text-sm font-semibold text-[hsl(var(--foreground))]" dir={dir}>
        {value}
      </p>
    </div>
  );
}

function UserBadgeIcon() {
  return (
    <span className="w-3 h-3 rounded-full bg-[hsl(var(--primary))]/20 inline-block" aria-hidden />
  );
}

function KpiTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'emerald' | 'amber' | 'red' | 'blue' | 'violet' | 'slate';
}) {
  const toneClass = {
    emerald: 'border-emerald-200 bg-emerald-50/40 text-emerald-700',
    amber: 'border-amber-200 bg-amber-50/40 text-amber-700',
    red: 'border-red-200 bg-red-50/40 text-red-700',
    blue: 'border-blue-200 bg-blue-50/40 text-blue-700',
    violet: 'border-violet-200 bg-violet-50/40 text-violet-700',
    slate: 'border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 text-[hsl(var(--foreground))]',
  }[tone];
  return (
    <div className={`rounded-2xl border p-3 ${toneClass}`}>
      <p className="text-[10px] font-semibold opacity-80 mb-1">{label}</p>
      <p className="text-base font-bold text-[hsl(var(--foreground))]">{value}</p>
    </div>
  );
}

// ─── Tabs ────────────────────────────────────────────────────────────────

function OverviewTab({
  customerKey,
  orders,
  complaints,
  tasks,
  notes,
  audits,
  ratings,
}: {
  customerKey: string;
  orders: OrderRow[];
  complaints: ComplaintRow[];
  tasks: TaskRow[];
  notes: NoteRow[];
  audits: AuditRow[];
  ratings: RatingRow[];
}) {
  void customerKey;
  const lastOrders = orders.slice(0, 4);
  const cancelled = orders.filter((o) => o.status === 'cancelled').slice(0, 4);
  const returned = orders.filter((o) => o.status === 'returned').slice(0, 4);
  const openComplaints = complaints.filter((c) => (c.status || 'open') === 'open').slice(0, 4);
  const upcomingTasks = tasks
    .filter((t) => t.status === 'open' || t.status === 'in_progress')
    .slice(0, 4);
  const lastNotes = notes.slice(0, 4);
  const lastActivity = useMemo(
    () =>
      buildTimeline({
        orders,
        complaints,
        chat: [],
        notes,
        tasks,
        ratings,
        attachments: [],
        audits,
      }).slice(0, 6),
    [orders, complaints, notes, tasks, ratings, audits]
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <Card title="آخر الطلبات">
        {lastOrders.length === 0 ? (
          <EmptyCardRow />
        ) : (
          <MiniTable
            headers={['رقم الطلب', 'التاريخ', 'الحالة', 'المبلغ']}
            rows={lastOrders.map((o) => [
              o.order_num,
              fmtDateYmd(o.created_at),
              <StatusBadge key={o.id} status={o.status} />,
              fmtMoney(o.total),
            ])}
          />
        )}
      </Card>
      <Card title="الشكاوى المفتوحة">
        {openComplaints.length === 0 ? (
          <EmptyCardRow />
        ) : (
          <MiniTable
            headers={['الموضوع', 'الحالة', 'التاريخ']}
            rows={openComplaints.map((c) => [
              c.subject || '—',
              <ComplaintBadge key={c.id} status={c.status || 'open'} />,
              fmtDateYmd(c.created_at),
            ])}
          />
        )}
      </Card>
      <Card title="آخر المرتجعات">
        {returned.length === 0 ? (
          <EmptyCardRow />
        ) : (
          <MiniTable
            headers={['رقم الطلب', 'التاريخ', 'المبلغ']}
            rows={returned.map((o) => [o.order_num, fmtDateYmd(o.created_at), fmtMoney(o.total)])}
          />
        )}
      </Card>
      <Card title="آخر الطلبات الملغاة">
        {cancelled.length === 0 ? (
          <EmptyCardRow />
        ) : (
          <MiniTable
            headers={['رقم الطلب', 'التاريخ', 'المبلغ']}
            rows={cancelled.map((o) => [o.order_num, fmtDateYmd(o.created_at), fmtMoney(o.total)])}
          />
        )}
      </Card>
      <Card title="المهام القادمة">
        {upcomingTasks.length === 0 ? (
          <EmptyCardRow />
        ) : (
          <MiniTable
            headers={['المهمة', 'الأولوية', 'التاريخ', 'الحالة']}
            rows={upcomingTasks.map((t) => [
              t.title,
              <span
                key={t.id}
                className={`inline-flex rounded-full border text-[10px] px-2 py-0.5 ${TASK_PRIORITY_TONE[t.priority] || ''}`}
              >
                {TASK_PRIORITY_LABEL_AR[t.priority] || t.priority}
              </span>,
              fmtDateYmd(t.due_at || t.created_at),
              <span
                key={`${t.id}-s`}
                className={`inline-flex rounded-full border text-[10px] px-2 py-0.5 ${TASK_STATUS_TONE[t.status] || ''}`}
              >
                {TASK_STATUS_LABEL_AR[t.status] || t.status}
              </span>,
            ])}
          />
        )}
      </Card>
      <Card title="آخر الأنشطة">
        {lastActivity.length === 0 ? (
          <EmptyCardRow />
        ) : (
          <ul className="space-y-2">
            {lastActivity.map((a) => (
              <li
                key={a.id}
                className="flex items-start gap-2 text-xs border-b last:border-0 border-[hsl(var(--border))]/60 pb-2 last:pb-0"
              >
                <span
                  className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    a.tone === 'emerald'
                      ? 'bg-emerald-500'
                      : a.tone === 'amber'
                        ? 'bg-amber-500'
                        : a.tone === 'red'
                          ? 'bg-red-500'
                          : a.tone === 'blue'
                            ? 'bg-blue-500'
                            : 'bg-slate-500'
                  }`}
                />
                <div className="flex-1">
                  <p className="font-semibold">{a.label}</p>
                  <p className="text-[hsl(var(--muted-foreground))] truncate">{a.description}</p>
                </div>
                <span className="text-[10px] text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                  {fmtDateYmd(a.date)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="تعليقات / ملاحظات المناديب" className="lg:col-span-2">
        {lastNotes.length === 0 ? (
          <EmptyCardRow />
        ) : (
          <ul className="space-y-2">
            {lastNotes.map((n) => (
              <li
                key={n.id}
                className="flex items-start gap-3 text-xs border-b last:border-0 border-[hsl(var(--border))]/60 pb-2 last:pb-0"
              >
                <div className="w-8 h-8 rounded-full bg-[hsl(var(--muted))]/50 flex items-center justify-center font-bold text-[hsl(var(--muted-foreground))] flex-shrink-0">
                  {(n.created_by_name || '?').charAt(0)}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-semibold">{n.created_by_name || 'مستخدم'}</span>
                    <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
                      {fmtDateTimeAr(n.created_at)}
                    </span>
                  </div>
                  <p className="text-[hsl(var(--muted-foreground))] leading-relaxed">{n.note}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function DataTab({
  customer,
  phone,
  canEdit,
  metrics,
  onSaved,
}: {
  customer: CustomerRow | null;
  phone: string;
  canEdit: boolean;
  metrics: ReturnType<typeof computeCustomerMetrics>;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    full_name: customer?.full_name || '',
    email: customer?.email || '',
    address: customer?.address || '',
    city: customer?.city || '',
    customer_type: customer?.customer_type || '',
    customer_status: customer?.customer_status || '',
    account_manager_name: customer?.account_manager_name || '',
    vip_level: customer?.vip_level || '',
    notes: customer?.notes || '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    setForm({
      full_name: customer?.full_name || '',
      email: customer?.email || '',
      address: customer?.address || '',
      city: customer?.city || '',
      customer_type: customer?.customer_type || '',
      customer_status: customer?.customer_status || '',
      account_manager_name: customer?.account_manager_name || '',
      vip_level: customer?.vip_level || '',
      notes: customer?.notes || '',
    });
  }, [customer]);

  const handleSave = async () => {
    if (!canEdit || submitting) return;
    setSubmitting(true);
    setBanner(null);
    try {
      const supabase = createClient();
      const payload = {
        full_name: form.full_name.trim() || null,
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        customer_type: form.customer_type.trim() || null,
        customer_status: form.customer_status.trim() || null,
        account_manager_name: form.account_manager_name.trim() || null,
        vip_level: form.vip_level.trim() || null,
        notes: form.notes.trim() || null,
        updated_at: new Date().toISOString(),
      };
      // Upsert so a customer that exists only in `turath_masr_orders`
      // (no customers row yet) still gets persisted on first edit.
      const { error } = await supabase.from('turath_masr_customers').upsert({ phone, ...payload });
      if (error) {
        const code = (error as { code?: string }).code || '';
        if (code === '42501')
          setBanner({ kind: 'error', text: 'لا تملك صلاحية تعديل بيانات العميل.' });
        else setBanner({ kind: 'error', text: 'تعذر حفظ التعديلات.' });
        setSubmitting(false);
        return;
      }
      setBanner({ kind: 'success', text: 'تم حفظ التعديلات.' });
      setSubmitting(false);
      onSaved();
    } catch {
      setBanner({ kind: 'error', text: 'تعذر الاتصال بالخادم.' });
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {banner && (
        <div
          className={`rounded-xl border px-3 py-2 text-xs ${
            banner.kind === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-red-50 text-red-700 border-red-200'
          }`}
        >
          {banner.text}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <DataField label="الاسم">
          <input
            value={form.full_name}
            onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
            className="input-field"
            disabled={!canEdit || submitting}
          />
        </DataField>
        <DataField label="الهاتف">
          <input
            value={phone}
            dir="ltr"
            disabled
            className="input-field bg-[hsl(var(--muted))]/40"
          />
        </DataField>
        <DataField label="البريد الإلكتروني">
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            dir="ltr"
            className="input-field"
            disabled={!canEdit || submitting}
          />
        </DataField>
        <DataField label="المدينة">
          <input
            value={form.city}
            onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
            className="input-field"
            disabled={!canEdit || submitting}
          />
        </DataField>
        <DataField label="نوع العميل">
          <select
            value={form.customer_type}
            onChange={(e) => setForm((f) => ({ ...f, customer_type: e.target.value }))}
            className="input-field"
            disabled={!canEdit || submitting}
          >
            <option value="">— غير محدد —</option>
            <option value="retail">تاجر تجزئة</option>
            <option value="wholesale">تاجر جملة</option>
            <option value="business">عميل تجاري</option>
            <option value="individual">فرد</option>
          </select>
        </DataField>
        <DataField label="حالة الحساب">
          <select
            value={form.customer_status}
            onChange={(e) => setForm((f) => ({ ...f, customer_status: e.target.value }))}
            className="input-field"
            disabled={!canEdit || submitting}
          >
            <option value="">— غير محدد —</option>
            <option value="active">نشط</option>
            <option value="inactive">غير نشط</option>
            <option value="vip">مميز</option>
            <option value="warning">تحذير</option>
            <option value="blocked">محظور</option>
          </select>
        </DataField>
        <DataField label="مسؤول الحساب">
          <input
            value={form.account_manager_name}
            onChange={(e) => setForm((f) => ({ ...f, account_manager_name: e.target.value }))}
            className="input-field"
            disabled={!canEdit || submitting}
          />
        </DataField>
        <DataField label="مستوى VIP">
          <input
            value={form.vip_level}
            onChange={(e) => setForm((f) => ({ ...f, vip_level: e.target.value }))}
            className="input-field"
            disabled={!canEdit || submitting}
          />
        </DataField>
        <DataField label="العنوان" className="sm:col-span-2">
          <textarea
            value={form.address}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            rows={2}
            className="input-field resize-none"
            disabled={!canEdit || submitting}
          />
        </DataField>
        <DataField label="ملاحظات عامة" className="sm:col-span-2">
          <textarea
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            rows={3}
            className="input-field resize-none"
            disabled={!canEdit || submitting}
          />
        </DataField>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiTile
          label="أول طلب"
          value={customer?.created_at ? fmtDateYmd(customer.created_at) : '—'}
          tone="slate"
        />
        <KpiTile
          label="آخر تحديث"
          value={customer?.updated_at ? fmtDateYmd(customer.updated_at) : '—'}
          tone="slate"
        />
        <KpiTile label="إجمالي الطلبات" value={String(metrics.totalOrders)} tone="blue" />
        <KpiTile
          label="إجمالي المشتريات"
          value={fmtMoneyShort(metrics.totalSpent)}
          tone="emerald"
        />
      </div>

      {canEdit && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSave}
            disabled={submitting}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[hsl(var(--primary))] text-white text-xs font-bold disabled:opacity-50"
          >
            <Save size={13} /> {submitting ? 'جارٍ الحفظ…' : 'حفظ التعديلات'}
          </button>
        </div>
      )}
      {!canEdit && (
        <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
          عرض للقراءة فقط — لا تملك صلاحية تعديل البيانات.
        </p>
      )}
    </div>
  );
}

function DataField({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))] block mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

function OrdersTab({
  orders,
  search,
  onOpenOrder,
}: {
  orders: OrderRow[];
  search: string;
  onOpenOrder: (orderId: string) => void;
}) {
  const q = search.trim().toLowerCase();
  const filtered = q
    ? orders.filter(
        (o) =>
          o.order_num.toLowerCase().includes(q) ||
          (o.delegate_name || '').toLowerCase().includes(q) ||
          (o.notes || '').toLowerCase().includes(q)
      )
    : orders;
  if (filtered.length === 0) return <EmptyState text="لا توجد طلبات." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-[hsl(var(--muted))]/30 text-[hsl(var(--muted-foreground))]">
          <tr>
            <th className="px-3 py-2 text-right font-semibold">رقم الطلب</th>
            <th className="px-3 py-2 text-right font-semibold">التاريخ</th>
            <th className="px-3 py-2 text-center font-semibold">الحالة</th>
            <th className="px-3 py-2 text-center font-semibold">المبلغ</th>
            <th className="px-3 py-2 text-right font-semibold">المندوب</th>
            <th className="px-3 py-2 text-right font-semibold">موعد التسليم</th>
            <th className="px-3 py-2 text-center font-semibold">إجراءات</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((o) => (
            <tr
              key={o.id}
              className="border-t border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/15"
            >
              <td className="px-3 py-2 font-mono">{o.order_num}</td>
              <td className="px-3 py-2 whitespace-nowrap">{fmtDateYmd(o.created_at)}</td>
              <td className="px-3 py-2 text-center">
                <StatusBadge status={o.status} />
              </td>
              <td className="px-3 py-2 text-center num">{fmtMoney(o.total)}</td>
              <td className="px-3 py-2 whitespace-nowrap">{o.delegate_name || '—'}</td>
              <td className="px-3 py-2 whitespace-nowrap text-[hsl(var(--muted-foreground))]">
                {o.scheduled_delivery_date ? fmtDateYmd(o.scheduled_delivery_date) : '—'}
              </td>
              <td className="px-3 py-2 text-center">
                {/* Phase 24A-Fix1 — open the order in a modal instead
                    of navigating to /orders-management (which would
                    drop the user out of the profile context). */}
                <button
                  type="button"
                  onClick={() => onOpenOrder(o.id)}
                  className="inline-flex items-center gap-1 text-[10px] font-semibold text-[hsl(var(--primary))] hover:underline"
                >
                  <Eye size={11} /> عرض
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ComplaintsTab({ complaints, search }: { complaints: ComplaintRow[]; search: string }) {
  const q = search.trim().toLowerCase();
  const filtered = q
    ? complaints.filter(
        (c) =>
          (c.subject || '').toLowerCase().includes(q) || (c.notes || '').toLowerCase().includes(q)
      )
    : complaints;
  if (filtered.length === 0) return <EmptyState text="لا توجد شكاوى." />;
  return (
    <div className="space-y-2">
      {filtered.map((c) => (
        <div key={c.id} className="rounded-2xl border border-[hsl(var(--border))] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-sm text-[hsl(var(--foreground))]">
              {c.subject || '—'}
            </p>
            <ComplaintBadge status={c.status || 'open'} />
          </div>
          {c.notes && <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">{c.notes}</p>}
          <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-1">
            {fmtDateTimeAr(c.created_at)}
            {c.created_by ? ` — ${c.created_by}` : ''}
          </p>
        </div>
      ))}
    </div>
  );
}

function SuggestionsTab() {
  return (
    <EmptyState
      text="لا توجد اقتراحات."
      hint="ميزة سجل اقتراحات العملاء قيد التخطيط. سيتم إضافة جدول مخصص في مرحلة لاحقة."
    />
  );
}

function ChatTab({ chat, orders }: { chat: ChatRow[]; orders: OrderRow[] }) {
  // Group by order_id (Phase 23K). Legacy rows without order_id show
  // under "بدون طلب محدد" so we don't bleed across orders.
  const orderNumMap = new Map<string, OrderRow>();
  for (const o of orders) orderNumMap.set(o.order_num, o);

  const groups = useMemo(() => {
    const m = new Map<string, ChatRow[]>();
    for (const c of chat) {
      const key = c.order_id || '__nokey__';
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(c);
    }
    const out = Array.from(m.entries()).map(([key, msgs]) => ({
      key,
      label: key === '__nokey__' ? 'بدون طلب محدد' : `طلب ${key}${orderNumMap.has(key) ? '' : ''}`,
      order: orderNumMap.get(key) || null,
      messages: msgs.sort((a, b) => ((a.created_at || '') < (b.created_at || '') ? -1 : 1)),
    }));
    out.sort((a, b) => {
      const ax = a.messages[a.messages.length - 1]?.created_at || '';
      const bx = b.messages[b.messages.length - 1]?.created_at || '';
      return ax < bx ? 1 : -1;
    });
    return out;
  }, [chat, orderNumMap]);

  if (groups.length === 0) return <EmptyState text="لا توجد محادثات." />;
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.key} className="rounded-2xl border border-[hsl(var(--border))] overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-3 py-2 bg-[hsl(var(--muted))]/20 border-b border-[hsl(var(--border))]">
            <div className="flex items-center gap-2 text-xs">
              <MessageCircle size={12} className="text-[hsl(var(--primary))]" />
              <span className="font-semibold">{g.label}</span>
              {g.order && <StatusBadge status={g.order.status} />}
            </div>
            <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
              {g.messages.length} رسالة
            </span>
          </div>
          <div className="p-3 space-y-2 max-h-72 overflow-y-auto bg-[hsl(var(--muted))]/10">
            {g.messages.slice(-50).map((m) => {
              const isCustomer = m.sender === 'customer';
              return (
                <div
                  key={m.id}
                  className={`max-w-[80%] rounded-2xl px-3 py-2 text-xs shadow-sm ${
                    isCustomer
                      ? 'bg-[hsl(var(--primary))] text-white ml-auto'
                      : 'bg-white border border-[hsl(var(--border))] mr-auto'
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words leading-relaxed">{m.message}</p>
                  <p
                    className={`text-[9px] mt-1 ${
                      isCustomer ? 'text-white/70' : 'text-[hsl(var(--muted-foreground))]'
                    }`}
                  >
                    {fmtDateTimeAr(m.created_at)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function NotesTab({
  notes,
  customerPhone,
  customerName,
  canEdit,
  userId,
  userName,
  onChanged,
}: {
  notes: NoteRow[];
  customerPhone: string;
  customerName: string | null;
  canEdit: boolean;
  userId: string | null;
  userName: string | null;
  onChanged: () => void;
}) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAdd = async () => {
    const t = text.trim();
    if (!t || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: insertErr } = await supabase.from('turath_masr_customer_notes').insert({
        customer_phone: customerPhone,
        customer_name: customerName,
        note: t,
        note_type: 'general',
        visibility: 'internal',
        created_by: userId,
        created_by_name: userName,
      });
      if (insertErr) {
        const code = (insertErr as { code?: string }).code || '';
        if (code === '42P01') setError('ميزة الملاحظات غير مفعّلة بعد. الترحيل قيد الإعتماد.');
        else if (code === '42501') setError('لا تملك صلاحية إضافة ملاحظة.');
        else setError('تعذر حفظ الملاحظة.');
        setSubmitting(false);
        return;
      }
      setText('');
      setSubmitting(false);
      onChanged();
    } catch {
      setError('تعذر الاتصال بالخادم.');
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="rounded-2xl border border-[hsl(var(--border))] p-3 bg-[hsl(var(--muted))]/10">
          <div className="flex items-start gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 1000))}
              rows={2}
              maxLength={1000}
              placeholder="اكتب ملاحظة داخلية عن العميل…"
              disabled={submitting}
              className="input-field flex-1 resize-none text-xs"
            />
            <button
              type="button"
              onClick={handleAdd}
              disabled={!text.trim() || submitting}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[hsl(var(--primary))] text-white text-xs font-bold disabled:opacity-50"
            >
              <Send size={12} /> إرسال
            </button>
          </div>
          {error && (
            <p className="mt-2 text-[11px] text-red-700 flex items-center gap-1">
              <AlertTriangle size={11} /> {error}
            </p>
          )}
        </div>
      )}
      {notes.length === 0 ? (
        <EmptyState text="لا توجد ملاحظات." />
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-2xl border border-[hsl(var(--border))] p-3">
              <div className="flex items-center justify-between gap-2 text-[11px] text-[hsl(var(--muted-foreground))]">
                <span className="font-semibold">{n.created_by_name || 'مستخدم'}</span>
                <span>{fmtDateTimeAr(n.created_at)}</span>
              </div>
              <p className="text-xs leading-relaxed mt-1 whitespace-pre-wrap">{n.note}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TimelineTab({
  orders,
  complaints,
  chat,
  notes,
  tasks,
  ratings,
  attachments,
  audits,
  search,
}: {
  orders: OrderRow[];
  complaints: ComplaintRow[];
  chat: ChatRow[];
  notes: NoteRow[];
  tasks: TaskRow[];
  ratings: RatingRow[];
  attachments: AttachmentRow[];
  audits: AuditRow[];
  search: string;
}) {
  const entries = useMemo(
    () => buildTimeline({ orders, complaints, chat, notes, tasks, ratings, attachments, audits }),
    [orders, complaints, chat, notes, tasks, ratings, attachments, audits]
  );
  const q = search.trim().toLowerCase();
  const filtered = q
    ? entries.filter(
        (e) =>
          e.label.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          (e.reference || '').toLowerCase().includes(q)
      )
    : entries;
  if (filtered.length === 0) return <EmptyState text="لا توجد أنشطة." />;
  return (
    <ol className="space-y-2">
      {filtered.map((e) => (
        <li
          key={e.id}
          className="rounded-2xl border border-[hsl(var(--border))] px-3 py-2 flex items-start gap-3"
        >
          <span
            className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${
              e.tone === 'emerald'
                ? 'bg-emerald-500'
                : e.tone === 'amber'
                  ? 'bg-amber-500'
                  : e.tone === 'red'
                    ? 'bg-red-500'
                    : e.tone === 'blue'
                      ? 'bg-blue-500'
                      : 'bg-slate-500'
            }`}
          />
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold">{e.label}</span>
              {e.reference && (
                <span className="text-[10px] font-mono text-[hsl(var(--muted-foreground))]">
                  #{e.reference}
                </span>
              )}
              <span className="text-[10px] text-[hsl(var(--muted-foreground))] mr-auto">
                {fmtDateTimeAr(e.date)}
              </span>
            </div>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">{e.description}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function AttachmentsTab({
  attachments,
  customerPhone,
  customerName,
  canEdit,
  userId,
  userName,
  onChanged,
}: {
  attachments: AttachmentRow[];
  customerPhone: string;
  customerName: string | null;
  canEdit: boolean;
  userId: string | null;
  userName: string | null;
  onChanged: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File | null) => {
    if (!file || !canEdit) return;
    if (file.size > 10 * 1024 * 1024) {
      setError('الملف أكبر من 10 ميجابايت.');
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const supabase = createClient();
      const ts = Date.now();
      const safeName = file.name.replace(/[^\p{L}\p{N}._-]/gu, '_').slice(0, 80) || 'file';
      const path = `customers/${customerPhone}/${ts}-${safeName}`;
      const { error: upErr } = await supabase.storage
        .from('customer-attachments')
        .upload(path, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type || undefined,
        });
      if (upErr) {
        setError('تعذر رفع الملف.');
        setUploading(false);
        return;
      }
      const { error: metaErr } = await supabase.from('turath_masr_customer_attachments').insert({
        customer_phone: customerPhone,
        customer_name: customerName,
        file_path: path,
        file_name: file.name,
        mime_type: file.type || null,
        size_bytes: file.size,
        uploaded_by: userId,
        uploaded_by_name: userName,
      });
      if (metaErr) {
        const code = (metaErr as { code?: string }).code || '';
        if (code === '42P01') setError('ميزة المرفقات غير مفعّلة بعد.');
        else setError('تم رفع الملف لكن تعذر حفظ بياناته.');
        setUploading(false);
        return;
      }
      setUploading(false);
      onChanged();
    } catch {
      setError('تعذر الاتصال بالخادم.');
      setUploading(false);
    }
  };

  const openSigned = async (path: string) => {
    try {
      const supabase = createClient();
      const { data } = await supabase.storage
        .from('customer-attachments')
        .createSignedUrl(path, 60);
      if (data?.signedUrl) {
        window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
      }
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] p-4 bg-[hsl(var(--muted))]/10 flex items-center gap-3">
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              handleFile(f);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[hsl(var(--primary))] text-white text-xs font-bold disabled:opacity-50"
          >
            <Upload size={12} /> {uploading ? 'جارٍ الرفع…' : 'رفع مرفق'}
          </button>
          <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
            الحد الأقصى: 10 ميجابايت. تُرفع الملفات إلى تخزين خاص ولا تظهر إلا برابط مؤقت.
          </p>
        </div>
      )}
      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}
      {attachments.length === 0 ? (
        <EmptyState text="لا توجد مرفقات." />
      ) : (
        <ul className="space-y-2">
          {attachments.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[hsl(var(--border))] px-3 py-2.5"
            >
              <div className="flex items-center gap-2 text-xs">
                <FileText size={14} className="text-[hsl(var(--muted-foreground))]" />
                <span className="font-semibold">{a.file_name || a.file_path}</span>
                {a.size_bytes != null && (
                  <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
                    {(a.size_bytes / 1024).toFixed(1)} KB
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-[10px] text-[hsl(var(--muted-foreground))]">
                <span>{fmtDateTimeAr(a.uploaded_at)}</span>
                <button
                  type="button"
                  onClick={() => openSigned(a.file_path)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[hsl(var(--muted))]/40 hover:bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]"
                >
                  <Download size={11} /> فتح
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Tiny shared bits ────────────────────────────────────────────────────

function Card({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-[hsl(var(--border))] bg-white p-4 ${className || ''}`}
    >
      <h3 className="text-sm font-bold text-[hsl(var(--foreground))] mb-3">{title}</h3>
      {children}
    </div>
  );
}

function MiniTable({ headers, rows }: { headers: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-[hsl(var(--muted-foreground))]">
          <tr>
            {headers.map((h, i) => (
              <th key={i} className="px-2 py-1.5 text-right font-semibold whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-[hsl(var(--border))]/60">
              {r.map((cell, j) => (
                <td key={j} className="px-2 py-1.5 whitespace-nowrap">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyCardRow() {
  return (
    <div className="text-center text-xs text-[hsl(var(--muted-foreground))] py-6">
      لا توجد بيانات
    </div>
  );
}

function EmptyState({ text, hint }: { text: string; hint?: string }) {
  return (
    <div className="text-center py-12 text-[hsl(var(--muted-foreground))]">
      <Briefcase size={28} className="mx-auto mb-2 opacity-40" />
      <p className="text-sm font-semibold">{text}</p>
      {hint && <p className="text-[11px] mt-1 max-w-md mx-auto">{hint}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = ORDER_STATUS_TONE[status] || 'bg-gray-100 text-gray-700 border-gray-200';
  return (
    <span
      className={`inline-flex rounded-full border text-[10px] font-semibold px-2 py-0.5 ${tone}`}
    >
      {ORDER_STATUS_LABEL_AR[status] || status}
    </span>
  );
}

function ComplaintBadge({ status }: { status: string }) {
  const key = status.toLowerCase();
  const tone = COMPLAINT_STATUS_TONE[key] || 'bg-gray-100 text-gray-700 border-gray-200';
  return (
    <span
      className={`inline-flex rounded-full border text-[10px] font-semibold px-2 py-0.5 ${tone}`}
    >
      {COMPLAINT_STATUS_LABEL_AR[key] || status}
    </span>
  );
}

// ─── Phase 24D — Customer Tasks tab ──────────────────────────────────────
//
// Lists every task scoped to the current customer phone, supports
// inline status transitions (start / done / cancel), and opens an
// add / edit modal off the toolbar.
//
// Permissions
//   • View — every CRM-allowed reader of the profile (r1/r2/r5/r6).
//   • Add / Edit / Status change — admin-only client gate (`canEdit`).
//     The RLS layer also enforces r1/r2/r5/r6 INSERT/UPDATE.

function TasksTab({
  tasks,
  orders,
  customerPhone,
  customerName,
  canEdit,
  userId,
  userName,
  onChanged,
}: {
  tasks: TaskRow[];
  orders: OrderRow[];
  customerPhone: string;
  customerName: string | null;
  canEdit: boolean;
  userId: string | null;
  userName: string | null;
  onChanged: () => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [editTask, setEditTask] = useState<TaskRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ranked = useMemo(() => rankTasks(tasks), [tasks]);
  const closed = useMemo(
    () => tasks.filter((t) => t.status === 'done' || t.status === 'cancelled'),
    [tasks]
  );

  const setStatus = async (task: TaskRow, next: 'in_progress' | 'done' | 'cancelled') => {
    if (!canEdit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: updateErr } = await supabase
        .from('turath_masr_customer_tasks')
        .update({ status: next, updated_at: new Date().toISOString() })
        .eq('id', task.id);
      if (updateErr) {
        const code = (updateErr as { code?: string }).code || '';
        if (code === '42501') setError('لا تملك صلاحية تعديل المهمة.');
        else setError('تعذر تحديث حالة المهمة.');
        setSubmitting(false);
        return;
      }
      setSubmitting(false);
      onChanged();
    } catch {
      setError('تعذر الاتصال بالخادم.');
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-[hsl(var(--muted-foreground))]">
          {ranked.length} مهمة نشطة · {closed.length} مهمة سابقة
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[hsl(var(--primary))] text-white text-xs font-bold hover:opacity-90"
          >
            <Plus size={12} /> إضافة مهمة
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 px-3 py-2">
          {error}
        </div>
      )}

      {ranked.length === 0 && closed.length === 0 ? (
        <EmptyState text="لا توجد مهام للعميل." />
      ) : (
        <>
          {ranked.length > 0 && (
            <section>
              <h4 className="text-xs font-semibold text-[hsl(var(--muted-foreground))] mb-2">
                المهام النشطة
              </h4>
              <ul className="space-y-2">
                {ranked.map((t) => (
                  <TaskRowCard
                    key={t.id}
                    task={t}
                    canEdit={canEdit}
                    submitting={submitting}
                    onStart={() => setStatus(t, 'in_progress')}
                    onDone={() => setStatus(t, 'done')}
                    onCancel={() => setStatus(t, 'cancelled')}
                    onEdit={() => setEditTask(t)}
                  />
                ))}
              </ul>
            </section>
          )}

          {closed.length > 0 && (
            <section>
              <h4 className="text-xs font-semibold text-[hsl(var(--muted-foreground))] mb-2 mt-4">
                المهام السابقة
              </h4>
              <ul className="space-y-2">
                {closed.map((t) => (
                  <TaskRowCard
                    key={t.id}
                    task={t}
                    canEdit={canEdit}
                    submitting={submitting}
                    onStart={() => setStatus(t, 'in_progress')}
                    onDone={() => setStatus(t, 'done')}
                    onCancel={() => setStatus(t, 'cancelled')}
                    onEdit={() => setEditTask(t)}
                  />
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {addOpen && canEdit && (
        <TaskEditModal
          mode="create"
          task={null}
          orders={orders}
          customerPhone={customerPhone}
          customerName={customerName}
          userId={userId}
          userName={userName}
          onClose={() => setAddOpen(false)}
          onSaved={() => {
            setAddOpen(false);
            onChanged();
          }}
        />
      )}
      {editTask && canEdit && (
        <TaskEditModal
          mode="edit"
          task={editTask}
          orders={orders}
          customerPhone={customerPhone}
          customerName={customerName}
          userId={userId}
          userName={userName}
          onClose={() => setEditTask(null)}
          onSaved={() => {
            setEditTask(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function TaskRowCard({
  task,
  canEdit,
  submitting,
  onStart,
  onDone,
  onCancel,
  onEdit,
}: {
  task: TaskRow;
  canEdit: boolean;
  submitting: boolean;
  onStart: () => void;
  onDone: () => void;
  onCancel: () => void;
  onEdit: () => void;
}) {
  const d = deriveTaskFlags(task);
  const priorityTone = TASK_PRIORITY_TONE[task.priority] || '';
  const statusTone = TASK_STATUS_TONE[task.status] || '';
  return (
    <li className="rounded-2xl border border-[hsl(var(--border))] bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <span className="text-sm font-bold text-[hsl(var(--foreground))]">{task.title}</span>
            <span
              className={`inline-flex rounded-full border text-[10px] font-semibold px-2 py-0.5 ${priorityTone}`}
            >
              {TASK_PRIORITY_LABEL_AR[task.priority] || task.priority}
            </span>
            <span
              className={`inline-flex rounded-full border text-[10px] font-semibold px-2 py-0.5 ${statusTone}`}
            >
              {TASK_STATUS_LABEL_AR[task.status] || task.status}
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
          {task.description && (
            <p className="text-xs text-[hsl(var(--muted-foreground))] mb-1 whitespace-pre-wrap">
              {task.description}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[hsl(var(--muted-foreground))]">
            {task.due_at && <span>الاستحقاق: {fmtDateYmd(task.due_at)}</span>}
            {task.assigned_to_name && <span>المسؤول: {task.assigned_to_name}</span>}
            {task.order_id && <span>الطلب: {task.order_id}</span>}
            {task.created_by_name && <span>أنشأها: {task.created_by_name}</span>}
            <span>{fmtDateTimeAr(task.created_at)}</span>
          </div>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-1 flex-shrink-0">
            {task.status === 'open' && (
              <button
                type="button"
                onClick={onStart}
                disabled={submitting}
                className="px-2 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-[10px] font-bold disabled:opacity-50"
              >
                بدء التنفيذ
              </button>
            )}
            {(task.status === 'open' || task.status === 'in_progress') && (
              <button
                type="button"
                onClick={onDone}
                disabled={submitting}
                className="px-2 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[10px] font-bold disabled:opacity-50"
              >
                إنهاء
              </button>
            )}
            {(task.status === 'open' || task.status === 'in_progress') && (
              <button
                type="button"
                onClick={onCancel}
                disabled={submitting}
                className="px-2 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 text-[10px] font-bold disabled:opacity-50"
              >
                إلغاء
              </button>
            )}
            <button
              type="button"
              onClick={onEdit}
              className="px-2 py-1 rounded-lg bg-[hsl(var(--muted))]/40 hover:bg-[hsl(var(--muted))] text-[hsl(var(--foreground))] text-[10px] font-bold"
            >
              تعديل
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

function TaskEditModal({
  mode,
  task,
  orders,
  customerPhone,
  customerName,
  userId,
  userName,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  task: TaskRow | null;
  orders: OrderRow[];
  customerPhone: string;
  customerName: string | null;
  userId: string | null;
  userName: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [priority, setPriority] = useState<string>(task?.priority ?? 'medium');
  const [status, setStatus] = useState<string>(task?.status ?? 'open');
  const [dueAt, setDueAt] = useState<string>(task?.due_at ? task.due_at.slice(0, 16) : '');
  const [orderId, setOrderId] = useState<string>(task?.order_id ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (submitting) return;
    if (!title.trim()) {
      setError('عنوان المهمة مطلوب.');
      return;
    }
    if (!['low', 'medium', 'high', 'urgent'].includes(priority)) {
      setError('الأولوية غير صحيحة.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const supabase = createClient();
      const payload: Record<string, unknown> = {
        title: title.trim(),
        description: description.trim() || null,
        priority,
        order_id: orderId.trim() || null,
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
        updated_at: new Date().toISOString(),
      };
      let queryError: unknown = null;
      if (mode === 'create') {
        payload.customer_phone = customerPhone;
        payload.customer_name = customerName;
        payload.status = 'open';
        payload.created_by = userId;
        payload.created_by_name = userName;
        const { error: insertErr } = await supabase
          .from('turath_masr_customer_tasks')
          .insert(payload);
        queryError = insertErr;
      } else if (task) {
        payload.status = status;
        const { error: updateErr } = await supabase
          .from('turath_masr_customer_tasks')
          .update(payload)
          .eq('id', task.id);
        queryError = updateErr;
      }
      if (queryError) {
        const code = (queryError as { code?: string }).code || '';
        if (code === '23514') setError('قيمة أولوية أو حالة غير مسموح بها.');
        else if (code === '42501') setError('لا تملك صلاحية حفظ المهمة.');
        else if (code === '42P01') setError('ميزة المهام غير مفعّلة بعد.');
        else setError('تعذر حفظ المهمة. حاول مرة أخرى.');
        setSubmitting(false);
        return;
      }
      setSubmitting(false);
      onSaved();
    } catch {
      setError('تعذر الاتصال بالخادم.');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[55] flex items-stretch justify-center p-0 sm:p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div className="relative bg-white w-full sm:max-w-lg sm:rounded-2xl flex flex-col shadow-2xl max-h-[95vh] overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 bg-[hsl(var(--primary))] sm:rounded-t-2xl flex-shrink-0">
          <ClipboardCheck size={18} className="text-white" />
          <h2 className="flex-1 text-white font-bold text-base">
            {mode === 'create' ? 'إضافة مهمة' : 'تعديل المهمة'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/20 rounded-lg"
            aria-label="إغلاق"
          >
            <X size={16} className="text-white" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 px-3 py-2">
              {error}
            </div>
          )}
          <div>
            <label className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))] block mb-1">
              عنوان المهمة *
            </label>
            <input
              type="text"
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              className="input-field"
              disabled={submitting}
            />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))] block mb-1">
              الوصف
            </label>
            <textarea
              value={description}
              maxLength={2000}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="input-field resize-none"
              disabled={submitting}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))] block mb-1">
                الأولوية *
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="input-field"
                disabled={submitting}
              >
                {(['low', 'medium', 'high', 'urgent'] as const).map((p) => (
                  <option key={p} value={p}>
                    {TASK_PRIORITY_LABEL_AR[p]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))] block mb-1">
                تاريخ الاستحقاق
              </label>
              <input
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                className="input-field"
                disabled={submitting}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))] block mb-1">
                ربط بطلب (اختياري)
              </label>
              <select
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
                className="input-field"
                disabled={submitting}
              >
                <option value="">— غير محدد —</option>
                {orders.slice(0, 50).map((o) => (
                  <option key={o.id} value={o.order_num}>
                    {o.order_num}
                  </option>
                ))}
              </select>
            </div>
            {mode === 'edit' && (
              <div>
                <label className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))] block mb-1">
                  الحالة
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="input-field"
                  disabled={submitting}
                >
                  {(['open', 'in_progress', 'done', 'cancelled'] as const).map((s) => (
                    <option key={s} value={s}>
                      {TASK_STATUS_LABEL_AR[s]}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-xs font-semibold bg-white border border-[hsl(var(--border))] rounded-xl"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-[hsl(var(--primary))] text-white rounded-xl disabled:opacity-50"
          >
            {mode === 'create' ? <Plus size={12} /> : <Save size={12} />}
            {submitting ? 'جارٍ الحفظ…' : mode === 'create' ? 'إضافة' : 'حفظ'}
          </button>
        </div>
      </div>
    </div>
  );
}
