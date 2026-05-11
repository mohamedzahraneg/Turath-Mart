'use client';
// ─────────────────────────────────────────────────────────────────────────────
// /customers/returns-exchanges — Phase 25B
//
// Customer-service overview of every return / exchange adjustment in
// the system. Read-only listing — actions (approve / reject / complete
// / cancel) still live inside OrderDetailModal so the operational
// state machine has one source of truth.
//
// Audience: admins, system supervisors, CRM manager / agent. Shipping
// roles (r3 / r4) and anon are blocked at render time and by the RLS
// policies on `turath_masr_order_adjustments`.
//
// What this page surfaces:
//   • Filter strip — state / kind / date range / free-text search
//   • Table with the operational columns the spec asked for
//   • Quick-action buttons: open original order, open child order,
//     open customer profile, open the linked complaint
//
// No DB writes happen on this page.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { RotateCcw, Search, ExternalLink, AlertCircle, Eye, Filter } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { ROLE_IDS } from '@/lib/constants/roles';
import {
  ADJUSTMENT_KIND_LABEL_AR,
  ADJUSTMENT_KIND_SHORT_AR,
  ADJUSTMENT_KIND_TONE,
  ADJUSTMENT_STATE_LABEL_AR,
  ADJUSTMENT_STATE_TONE,
  PRICE_DIFFERENCE_DIRECTION_LABEL_AR,
  SHIPPING_PAYER_LABEL_AR,
  type AdjustmentKind,
  type AdjustmentState,
  type OrderAdjustment,
} from '@/lib/orders/orderAdjustments';

const ALLOWED_ROLES: string[] = [
  ROLE_IDS.ADMIN,
  ROLE_IDS.SYSTEM_SUPERVISOR,
  ROLE_IDS.CUSTOMER_SERVICE_MANAGER,
  ROLE_IDS.CUSTOMER_SERVICE,
];

const fmtMoney = (n: number | null | undefined) => `${Number(n ?? 0).toLocaleString('en-US')} ج.م`;

interface Row extends OrderAdjustment {
  /** Joined from `turath_masr_orders` so we can show the customer name. */
  customer?: string | null;
  phone?: string | null;
}

export default function ReturnsExchangesPage() {
  const { currentRoleId } = useAuth();
  const allowed = !!currentRoleId && ALLOWED_ROLES.includes(currentRoleId);

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<'all' | AdjustmentState>('all');
  const [kindFilter, setKindFilter] = useState<'all' | AdjustmentKind>('all');

  useEffect(() => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const supabase = createClient();
        const { data, error: fetchErr } = await supabase
          .from('turath_masr_order_adjustments')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(500);
        if (fetchErr) throw fetchErr;
        const adjustments = (data as OrderAdjustment[]) ?? [];

        // Lift customer + phone from the original orders so the table
        // can show them. A single batched query keeps the egress low.
        const orderIds = Array.from(new Set(adjustments.map((a) => a.order_id))).filter(Boolean);
        let customers: Record<string, { customer: string; phone: string }> = {};
        if (orderIds.length > 0) {
          const { data: ordersData } = await supabase
            .from('turath_masr_orders')
            .select('id, customer, phone')
            .in('id', orderIds);
          customers = Object.fromEntries(
            ((ordersData as { id: string; customer: string; phone: string }[]) ?? []).map((o) => [
              o.id,
              { customer: o.customer, phone: o.phone },
            ])
          );
        }

        if (cancelled) return;
        setRows(
          adjustments.map((a) => ({
            ...a,
            customer: customers[a.order_id]?.customer ?? null,
            phone: customers[a.order_id]?.phone ?? null,
          }))
        );
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'تعذر تحميل البيانات.';
        setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const onUpdate = () => load();
    if (typeof window !== 'undefined') {
      window.addEventListener('turath_masr_order_adjustments_updated', onUpdate);
    }
    return () => {
      cancelled = true;
      if (typeof window !== 'undefined') {
        window.removeEventListener('turath_masr_order_adjustments_updated', onUpdate);
      }
    };
  }, [allowed]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (stateFilter !== 'all' && r.state !== stateFilter) return false;
      if (kindFilter !== 'all' && r.kind !== kindFilter) return false;
      if (!q) return true;
      const hay = [
        r.order_num,
        r.child_order_num,
        r.customer,
        r.phone,
        r.reason,
        r.notes,
        r.operational_note,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search, stateFilter, kindFilter]);

  if (!allowed) {
    return (
      <AppLayout>
        <div className="p-8">
          <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 flex items-start gap-3">
            <AlertCircle className="text-rose-600 mt-0.5" size={18} />
            <div>
              <h3 className="text-base font-bold text-rose-800">ليس لديك صلاحية الوصول</h3>
              <p className="text-sm text-rose-700 mt-1">
                صفحة المرتجعات والاستبدالات متاحة فقط لفريق خدمة العملاء والإدارة.
              </p>
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-5 md:p-7 space-y-5" dir="rtl">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 bg-amber-100 rounded-2xl flex items-center justify-center">
              <RotateCcw size={20} className="text-amber-700" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-[hsl(var(--foreground))]">
                المرتجعات والاستبدالات
              </h1>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                كل طلبات التسوية مع إجمالي المطلوب تحصيله والشكاوى المرتبطة
              </p>
            </div>
          </div>
          <div className="text-sm text-[hsl(var(--muted-foreground))]">
            <span className="font-bold text-[hsl(var(--foreground))]">{filtered.length}</span> من{' '}
            {rows.length}
          </div>
        </header>

        {/* Filters */}
        <section className="bg-white rounded-2xl border border-[hsl(var(--border))] p-4 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search
              size={14}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث برقم الطلب، الفرعي، العميل، الهاتف، السبب…"
              className="input-field w-full text-sm pr-8"
            />
          </div>
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value as 'all' | AdjustmentState)}
            className="input-field text-sm w-auto"
          >
            <option value="all">كل الحالات</option>
            <option value="pending">{ADJUSTMENT_STATE_LABEL_AR.pending}</option>
            <option value="approved">{ADJUSTMENT_STATE_LABEL_AR.approved}</option>
            <option value="completed">{ADJUSTMENT_STATE_LABEL_AR.completed}</option>
            <option value="rejected">{ADJUSTMENT_STATE_LABEL_AR.rejected}</option>
            <option value="cancelled">{ADJUSTMENT_STATE_LABEL_AR.cancelled}</option>
          </select>
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as 'all' | AdjustmentKind)}
            className="input-field text-sm w-auto"
          >
            <option value="all">كل الأنواع</option>
            <option value="return_full">{ADJUSTMENT_KIND_LABEL_AR.return_full}</option>
            <option value="return_partial">{ADJUSTMENT_KIND_LABEL_AR.return_partial}</option>
            <option value="exchange_full">{ADJUSTMENT_KIND_LABEL_AR.exchange_full}</option>
            <option value="exchange_partial">{ADJUSTMENT_KIND_LABEL_AR.exchange_partial}</option>
          </select>
          <Filter size={14} className="text-[hsl(var(--muted-foreground))]" />
        </section>

        {/* Body */}
        {loading ? (
          <div className="p-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
            جارٍ التحميل…
          </div>
        ) : error ? (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-sm text-rose-700">
            {error}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-[hsl(var(--muted-foreground))] bg-white rounded-2xl border border-[hsl(var(--border))]">
            لا توجد تسويات بهذه المعايير.
          </div>
        ) : (
          <section className="bg-white rounded-2xl border border-[hsl(var(--border))] overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[hsl(var(--muted))]/30 text-[hsl(var(--muted-foreground))]">
                <tr>
                  <th className="px-3 py-2 text-right font-semibold">الطلب الأصلي</th>
                  <th className="px-3 py-2 text-right font-semibold">الطلب الفرعي</th>
                  <th className="px-3 py-2 text-right font-semibold">العميل</th>
                  <th className="px-3 py-2 text-center font-semibold">النوع</th>
                  <th className="px-3 py-2 text-center font-semibold">الحالة</th>
                  <th className="px-3 py-2 text-right font-semibold">السبب</th>
                  <th className="px-3 py-2 text-center font-semibold">شحن العميل</th>
                  <th className="px-3 py-2 text-center font-semibold">شحن الشركة</th>
                  <th className="px-3 py-2 text-center font-semibold">فرق السعر</th>
                  <th className="px-3 py-2 text-center font-semibold">المطلوب تحصيله</th>
                  <th className="px-3 py-2 text-center font-semibold">شكوى</th>
                  <th className="px-3 py-2 text-right font-semibold">التاريخ</th>
                  <th className="px-3 py-2 text-center font-semibold">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/15"
                  >
                    <td className="px-3 py-2 font-mono">#{r.order_num}</td>
                    <td className="px-3 py-2 font-mono">
                      {r.child_order_num ? `#${r.child_order_num}` : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <div className="leading-tight">
                        <p className="font-semibold">{r.customer || '—'}</p>
                        {r.phone && (
                          <p className="text-[10px] text-[hsl(var(--muted-foreground))] font-mono">
                            {r.phone}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${ADJUSTMENT_KIND_TONE[r.kind]}`}
                      >
                        {ADJUSTMENT_KIND_SHORT_AR[r.kind]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${ADJUSTMENT_STATE_TONE[r.state]}`}
                      >
                        {ADJUSTMENT_STATE_LABEL_AR[r.state]}
                      </span>
                    </td>
                    <td className="px-3 py-2 max-w-[200px]">
                      <p className="truncate" title={r.reason}>
                        {r.reason}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-center font-mono">
                      {fmtMoney(r.shipping_customer_amount)}
                    </td>
                    <td className="px-3 py-2 text-center font-mono">
                      {fmtMoney(r.shipping_company_amount)}
                    </td>
                    <td className="px-3 py-2 text-center font-mono">
                      <div className="flex flex-col items-center">
                        <span>{fmtMoney(Math.abs(Number(r.price_difference) || 0))}</span>
                        {r.price_difference_direction &&
                          r.price_difference_direction !== 'none' && (
                            <span className="text-[9px] text-[hsl(var(--muted-foreground))]">
                              {PRICE_DIFFERENCE_DIRECTION_LABEL_AR[r.price_difference_direction]}
                            </span>
                          )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-center font-mono font-bold">
                      {fmtMoney(r.customer_collect_amount)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {r.linked_complaint_id ? (
                        <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-bold">
                          مفتوحة
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-[10px] text-[hsl(var(--muted-foreground))]">
                      {new Date(r.created_at).toLocaleDateString('en-GB')}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <div className="flex flex-wrap justify-center gap-1">
                        <Link
                          href={`/orders-management?order=${encodeURIComponent(r.order_num)}`}
                          title="فتح الطلب الأصلي"
                          className="text-[10px] inline-flex items-center gap-0.5 text-[hsl(var(--primary))] hover:underline"
                        >
                          <Eye size={11} /> الأصلي
                        </Link>
                        {r.child_order_num && (
                          <Link
                            href={`/orders-management?order=${encodeURIComponent(r.child_order_num)}`}
                            title="فتح الطلب الفرعي"
                            className="text-[10px] inline-flex items-center gap-0.5 text-amber-700 hover:underline"
                          >
                            <ExternalLink size={11} /> الفرعي
                          </Link>
                        )}
                        {r.phone && (
                          <Link
                            href={`/customers/${encodeURIComponent(r.phone)}`}
                            title="فتح ملف العميل"
                            className="text-[10px] inline-flex items-center gap-0.5 text-emerald-700 hover:underline"
                          >
                            ملف العميل
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Field reference */}
            <div className="px-4 py-3 border-t border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20 text-[10px] text-[hsl(var(--muted-foreground))] flex flex-wrap gap-3">
              <span>
                <span className="font-bold">المطلوب تحصيله</span> = شحن العميل + فرق السعر (لو على
                العميل)
              </span>
              <span>طريقة الشحن: {Object.values(SHIPPING_PAYER_LABEL_AR).join(' / ')}</span>
            </div>
          </section>
        )}
      </div>
    </AppLayout>
  );
}
