// ─────────────────────────────────────────────────────────────────────────────
// src/lib/orders/documentTemplates.ts
//
// Phase Order-Documents-1 — pure helper for the three customer-facing
// "document" surfaces:
//
//   • Professional invoice           — `buildInvoiceHtml(input)`
//   • Warranty certificate           — `buildWarrantyCertificateHtml(input)`
//   • Rich WhatsApp share message    — `buildWhatsAppMessage(input)`
//
// The helper has zero React / DOM / fetch / Supabase coupling. Every
// function is deterministic and takes a plain input object.
//
// Hard guarantees enforced here:
//   • Output is HTML-escaped — user-provided text is sanitised at the
//     boundary so a customer name with `<` or `&` can't break the
//     document.
//   • Internal notes are never accepted. The shape carries
//     `publicNote?: string | null` only — callers are expected to pass
//     `stripCheckoutDetailsBlock(notes).trim() || null` before invoking
//     the helper.
//   • Checkout / payment block markers never leak. The helper does not
//     accept the raw `notes` column; it only renders `publicNote` after
//     the caller has stripped.
//   • Warranty: if the input's `warrantyText` is empty/null, the
//     invoice's warranty section is hidden and `buildWarrantyCertificateHtml`
//     refuses to emit a certificate (returns an empty string). Callers
//     should also hide the certificate button when `warrantyText` is
//     empty.
//   • Customer audience: when `audience === 'customer'`, the helper
//     omits `phone2`, the delegate name, and any other staff-only
//     field even if the caller mistakenly populated them. Customer
//     surfaces (the /track/t/[token] page) already redact server-side;
//     this is defence-in-depth at the template layer.
//
// Design constraints:
//   • RTL-first. Documents declare `dir="rtl"` and `lang="ar"`.
//   • Print-friendly. `@media print` resets margins and hides anything
//     marked `.no-print`.
//   • Self-contained. Each builder returns a complete `<!DOCTYPE html>`
//     document so the existing `window.open(...) + document.write(...)
//     + window.print()` popup mechanics keep working unchanged.
//   • Mobile-friendly. The print layout collapses to a single column
//     under 600px so the same HTML preview renders cleanly on phones.
// ─────────────────────────────────────────────────────────────────────────────

/** Centralised brand constants — used by every document. Reuses the
 *  support email previously embedded in legacy templates; do not invent
 *  phone/whatsapp/website values here. */
export const BRAND = {
  nameAr: 'تراث',
  nameEn: 'Turath',
  groupAr: 'إحدى شركات إحياء جروب',
  groupEn: 'Part of Ehyaa Group',
  supportEmail: 'info@turath_masr.com',
} as const;

/** Document recipient. Customer-facing surfaces (the /track/t/[token]
 *  page) pass `'customer'` to drop staff-only fields. Admin-facing
 *  surfaces (the OrderDetailModal popup) pass `'admin'`. */
export type DocumentAudience = 'admin' | 'customer';

export interface InvoiceLineInput {
  label: string;
  color?: string | null;
  sku?: string | null;
  quantity: number;
  unitPrice: number;
  total: number;
  imageUrl?: string | null;
}

export interface InvoicePricing {
  subtotal: number;
  shippingFee: number;
  extraShippingFee?: number | null;
  /** Positive = discount applied (subtracted from gross). */
  discount?: number | null;
  total: number;
  paid?: number | null;
  remaining?: number | null;
  paymentMethod?: string | null;
  paymentStatus?: string | null;
}

export interface InvoiceSchedule {
  date?: string | null;
  /** Optional pre-formatted human-readable schedule string. When set
   *  the helper renders this verbatim instead of formatting `date`. */
  formatted?: string | null;
}

export interface InvoiceInput {
  orderNum: string;
  /** ISO timestamp or any string formatter wants to render. */
  createdAt?: string | null;
  /** Human-readable status label (already translated). */
  statusLabel: string;
  customer: {
    name: string;
    phone: string;
    /** Admin-only. Customer audience drops this. */
    phone2?: string | null;
  };
  address: {
    region: string;
    district?: string | null;
    neighborhood?: string | null;
    address: string;
  };
  lines: InvoiceLineInput[];
  pricing: InvoicePricing;
  schedule?: InvoiceSchedule | null;
  /** Admin-only. Customer audience drops this. */
  delegateName?: string | null;
  trackingUrl?: string | null;
  /** Already stripped + trimmed by the caller. */
  publicNote?: string | null;
  /** Empty / null → warranty section hidden. */
  warrantyText?: string | null;
  audience: DocumentAudience;
}

export interface WarrantyInput {
  orderNum: string;
  createdAt?: string | null;
  customer: { name: string; phone?: string | null };
  lines: Array<Pick<InvoiceLineInput, 'label' | 'color' | 'sku' | 'quantity'>>;
  warrantyText: string;
  audience: DocumentAudience;
}

export interface WhatsAppInput {
  orderNum: string;
  customerName: string;
  statusLabel: string;
  total: number;
  /** Positive remaining triggers the "remaining at delivery" line. */
  remaining?: number | null;
  paymentMethod?: string | null;
  lines: Array<Pick<InvoiceLineInput, 'label' | 'color' | 'quantity'>>;
  address: {
    region: string;
    district?: string | null;
    neighborhood?: string | null;
    address?: string | null;
  };
  schedule?: InvoiceSchedule | null;
  /** Already stripped + trimmed by the caller. */
  publicNote?: string | null;
  trackingUrl?: string | null;
  /** Optional legacy template override (the admin-customised value
   *  saved in `settings_whatsapp_template`). When set, the helper
   *  performs the same `.replace()`-based placeholder fill as before
   *  but adds the new optional placeholders if the template references
   *  them. When null/empty, the helper returns the rich default. */
  templateOverride?: string | null;
  delegateName?: string | null;
}

// ─── Internal helpers ───────────────────────────────────────────────────────

/** Minimal HTML escape — sufficient for inline body text. */
function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtMoney(value: number | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n.toLocaleString('en-US')} ج.م`;
}

function fmtDateAr(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return '—';
  }
}

function fmtTimeAr(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function joinAddress(parts: Array<string | null | undefined>): string {
  return parts
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter((p) => p.length > 0)
    .join(' — ');
}

function isCustomer(input: { audience: DocumentAudience }): boolean {
  return input.audience === 'customer';
}

// Shared print stylesheet — embedded inline so each document is fully
// self-contained for the popup-print mechanic.
const SHARED_PRINT_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Tajawal",
                 "Cairo", "Helvetica Neue", Arial, sans-serif;
    background: #f7f8fa;
    color: #1f2937;
    direction: rtl;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .doc-shell {
    max-width: 820px;
    margin: 24px auto;
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  }
  .doc-section { padding: 16px 20px; border-top: 1px solid #f1f5f9; }
  .doc-section:first-child { border-top: 0; }
  .doc-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .doc-card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 12px 14px; }
  .doc-card h4 { margin: 0 0 8px; font-size: 12px; font-weight: 700; color: #6b7280; letter-spacing: 0.02em; }
  .doc-row { display: flex; justify-content: space-between; gap: 8px; font-size: 12.5px; line-height: 1.65; }
  .doc-row + .doc-row { border-top: 1px dashed #eef2f7; padding-top: 6px; margin-top: 6px; }
  .doc-label { color: #6b7280; }
  .doc-value { color: #111827; font-weight: 600; }
  .doc-strong-value { color: #111827; font-weight: 800; font-size: 15px; }
  table.doc-items { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  table.doc-items th, table.doc-items td { border-bottom: 1px solid #e5e7eb; padding: 10px 8px; text-align: right; vertical-align: middle; }
  table.doc-items thead th { background: #f3f4f6; font-weight: 700; color: #374151; font-size: 11.5px; }
  table.doc-items tr:last-child td { border-bottom: 0; }
  .doc-thumb { width: 36px; height: 36px; border-radius: 8px; border: 1px solid #e5e7eb; object-fit: cover; background: #f9fafb; }
  .doc-pill { display: inline-flex; align-items: center; gap: 4px; padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; }
  .doc-pill-success { background: #dcfce7; color: #166534; }
  .doc-pill-warn { background: #fef3c7; color: #92400e; }
  .doc-pill-danger { background: #fee2e2; color: #991b1b; }
  .doc-pill-info { background: #dbeafe; color: #1e3a8a; }
  .doc-pill-neutral { background: #e5e7eb; color: #374151; }
  .doc-header { padding: 18px 24px 12px; background: linear-gradient(180deg, #ffffff, #f9fafb); border-bottom: 1px solid #e5e7eb; }
  .doc-header-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
  .doc-brand-name { margin: 0; font-size: 20px; font-weight: 900; letter-spacing: -0.01em; color: #111827; }
  .doc-brand-sub { margin: 2px 0 0; font-size: 12px; color: #6b7280; }
  .doc-brand-contact { margin: 8px 0 0; font-size: 11.5px; color: #6b7280; }
  .doc-title-badge { background: #111827; color: #fff; padding: 8px 14px; border-radius: 12px; font-weight: 800; font-size: 14px; }
  .doc-meta-strip { display: flex; flex-wrap: wrap; gap: 8px 18px; padding: 10px 20px; background: #f9fafb; border-top: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb; font-size: 12px; color: #374151; }
  .doc-footer { padding: 18px 24px; background: #f9fafb; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; text-align: center; }
  .doc-footer strong { color: #111827; }
  .doc-footer-en { direction: ltr; font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; letter-spacing: 0.01em; color: #9ca3af; margin-top: 4px; }
  .doc-section h3 { margin: 0 0 12px; font-size: 14px; font-weight: 800; color: #111827; display: flex; align-items: center; gap: 8px; }
  .doc-section h3 .doc-section-tag { background: #f3f4f6; color: #374151; font-size: 10.5px; padding: 2px 8px; border-radius: 999px; font-weight: 700; }
  .doc-note-box { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; border-radius: 12px; padding: 12px 14px; font-size: 12.5px; line-height: 1.7; white-space: pre-wrap; }
  .doc-warranty-box { background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; border-radius: 12px; padding: 12px 14px; font-size: 12.5px; line-height: 1.7; }
  .doc-tracking-box { background: #eff6ff; border: 1px solid #bfdbfe; color: #1e3a8a; border-radius: 12px; padding: 12px 14px; font-size: 12.5px; line-height: 1.7; word-break: break-all; }
  .doc-tracking-box a { color: #1d4ed8; text-decoration: none; font-weight: 700; }
  .doc-totals { background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 12px 14px; }
  .doc-totals .total-row { display: flex; justify-content: space-between; font-size: 13px; padding: 6px 0; }
  .doc-totals .total-row + .total-row { border-top: 1px dashed #eef2f7; }
  .doc-totals .grand { font-size: 16px; font-weight: 900; color: #111827; border-top: 1px solid #d1d5db; padding-top: 10px; margin-top: 4px; }
  .doc-totals .grand-paid { color: #166534; }
  .doc-totals .grand-remaining { color: #b45309; font-weight: 800; }
  .doc-actions { padding: 14px 20px; display: flex; gap: 8px; justify-content: flex-end; }
  .doc-actions button { background: #111827; color: #ffffff; border: 0; border-radius: 10px; padding: 8px 14px; font-weight: 700; cursor: pointer; }
  @media (max-width: 600px) {
    .doc-shell { margin: 8px; border-radius: 12px; }
    .doc-grid-2 { grid-template-columns: 1fr; gap: 8px; }
    .doc-thumb { width: 30px; height: 30px; }
    table.doc-items th:nth-child(1), table.doc-items td:nth-child(1) { display: none; }
  }
  @media print {
    body { background: #ffffff; }
    .doc-shell { box-shadow: none; border: 0; margin: 0; max-width: 100%; border-radius: 0; }
    .no-print, .doc-actions { display: none !important; }
    .doc-section { page-break-inside: avoid; }
    table.doc-items, table.doc-items tr { page-break-inside: avoid; }
  }
`;

function statusPillClass(label: string): string {
  const s = (label || '').trim();
  if (s.includes('تسليم') && s.includes('تم')) return 'doc-pill-success';
  if (s.includes('ملغ')) return 'doc-pill-danger';
  if (s.includes('مرتجع')) return 'doc-pill-danger';
  if (s.includes('شحن') || s.includes('تجهيز') || s.includes('مستودع')) return 'doc-pill-warn';
  if (s.includes('جديد')) return 'doc-pill-info';
  return 'doc-pill-neutral';
}

// ─── Invoice ─────────────────────────────────────────────────────────────────

export function buildInvoiceHtml(input: InvoiceInput): string {
  const customer = isCustomer(input);
  const meta = [
    `<span><strong>رقم الطلب:</strong> ${escapeHtml(input.orderNum)}</span>`,
    `<span><strong>التاريخ:</strong> ${escapeHtml(fmtDateAr(input.createdAt))}${
      fmtTimeAr(input.createdAt) ? ` — ${escapeHtml(fmtTimeAr(input.createdAt))}` : ''
    }</span>`,
    `<span><strong>الحالة:</strong> <span class="doc-pill ${statusPillClass(
      input.statusLabel
    )}">${escapeHtml(input.statusLabel)}</span></span>`,
  ];
  if (!customer && input.delegateName) {
    meta.push(`<span><strong>المندوب:</strong> ${escapeHtml(input.delegateName)}</span>`);
  }
  if (input.schedule && (input.schedule.formatted || input.schedule.date)) {
    const sched = input.schedule.formatted
      ? input.schedule.formatted
      : fmtDateAr(input.schedule.date);
    meta.push(`<span><strong>موعد التسليم:</strong> ${escapeHtml(sched)}</span>`);
  }

  const phoneLines = [
    `<div class="doc-row"><span class="doc-label">الاسم</span><span class="doc-value">${escapeHtml(
      input.customer.name
    )}</span></div>`,
    `<div class="doc-row"><span class="doc-label">الهاتف</span><span class="doc-value">${escapeHtml(
      input.customer.phone
    )}</span></div>`,
  ];
  if (!customer && input.customer.phone2) {
    phoneLines.push(
      `<div class="doc-row"><span class="doc-label">هاتف إضافي</span><span class="doc-value">${escapeHtml(
        input.customer.phone2
      )}</span></div>`
    );
  }

  const addressHuman = joinAddress([
    input.address.region,
    input.address.district,
    input.address.neighborhood,
  ]);
  const addressLines = [
    `<div class="doc-row"><span class="doc-label">المنطقة</span><span class="doc-value">${escapeHtml(
      addressHuman || '—'
    )}</span></div>`,
    `<div class="doc-row"><span class="doc-label">العنوان التفصيلي</span><span class="doc-value">${escapeHtml(
      input.address.address || '—'
    )}</span></div>`,
  ];

  const rowsHtml =
    input.lines.length > 0
      ? input.lines
          .map((l) => {
            const thumb = l.imageUrl
              ? `<img class="doc-thumb" src="${escapeHtml(l.imageUrl)}" alt="" />`
              : `<div class="doc-thumb" aria-hidden="true"></div>`;
            const labelBlock = `<div style="font-weight:700;color:#111827">${escapeHtml(l.label)}</div>${
              l.color
                ? `<div style="font-size:11px;color:#6b7280">${escapeHtml(l.color)}</div>`
                : ''
            }${
              l.sku
                ? `<div style="font-size:10.5px;color:#9ca3af;font-family:monospace">SKU: ${escapeHtml(
                    l.sku
                  )}</div>`
                : ''
            }`;
            return `<tr><td>${thumb}</td><td>${labelBlock}</td><td>${escapeHtml(
              String(l.quantity)
            )}</td><td>${escapeHtml(fmtMoney(l.unitPrice))}</td><td><strong>${escapeHtml(
              fmtMoney(l.total)
            )}</strong></td></tr>`;
          })
          .join('')
      : `<tr><td colspan="5" style="text-align:center;color:#9ca3af;padding:18px">لا توجد بنود</td></tr>`;

  const itemsTable = `
    <table class="doc-items">
      <thead>
        <tr>
          <th style="width:48px">الصورة</th>
          <th>المنتج</th>
          <th style="width:70px">الكمية</th>
          <th style="width:110px">سعر الوحدة</th>
          <th style="width:130px">الإجمالي</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;

  const totalsRows: string[] = [];
  totalsRows.push(
    `<div class="total-row"><span>المجموع الفرعي</span><span>${escapeHtml(
      fmtMoney(input.pricing.subtotal)
    )}</span></div>`
  );
  totalsRows.push(
    `<div class="total-row"><span>الشحن</span><span>${escapeHtml(
      fmtMoney(input.pricing.shippingFee)
    )}</span></div>`
  );
  if (input.pricing.extraShippingFee && input.pricing.extraShippingFee > 0) {
    totalsRows.push(
      `<div class="total-row"><span>رسوم إضافية</span><span>${escapeHtml(
        fmtMoney(input.pricing.extraShippingFee)
      )}</span></div>`
    );
  }
  if (input.pricing.discount && input.pricing.discount > 0) {
    totalsRows.push(
      `<div class="total-row" style="color:#166534"><span>الخصم</span><span>- ${escapeHtml(
        fmtMoney(input.pricing.discount)
      )}</span></div>`
    );
  }
  totalsRows.push(
    `<div class="total-row grand"><span>الإجمالي النهائي</span><span>${escapeHtml(
      fmtMoney(input.pricing.total)
    )}</span></div>`
  );
  if (typeof input.pricing.paid === 'number' && input.pricing.paid > 0) {
    totalsRows.push(
      `<div class="total-row grand grand-paid"><span>المدفوع</span><span>${escapeHtml(
        fmtMoney(input.pricing.paid)
      )}</span></div>`
    );
  }
  if (typeof input.pricing.remaining === 'number' && input.pricing.remaining > 0) {
    totalsRows.push(
      `<div class="total-row grand grand-remaining"><span>المتبقي عند الاستلام</span><span>${escapeHtml(
        fmtMoney(input.pricing.remaining)
      )}</span></div>`
    );
  }
  if (input.pricing.paymentMethod) {
    totalsRows.push(
      `<div class="total-row"><span>طريقة الدفع</span><span>${escapeHtml(
        input.pricing.paymentMethod
      )}</span></div>`
    );
  }
  if (input.pricing.paymentStatus) {
    totalsRows.push(
      `<div class="total-row"><span>حالة الدفع</span><span>${escapeHtml(
        input.pricing.paymentStatus
      )}</span></div>`
    );
  }

  const noteSection = input.publicNote
    ? `<section class="doc-section"><h3>ملاحظات <span class="doc-section-tag">عامة</span></h3><div class="doc-note-box">${escapeHtml(
        input.publicNote
      )}</div></section>`
    : '';

  const warrantySection = input.warrantyText
    ? `<section class="doc-section"><h3>الضمان</h3><div class="doc-warranty-box"><strong>مدة الضمان:</strong> ${escapeHtml(
        input.warrantyText
      )}</div></section>`
    : '';

  const trackingSection = input.trackingUrl
    ? `<section class="doc-section"><h3>تتبع الطلب</h3><div class="doc-tracking-box">يمكن متابعة حالة الطلب لحظة بلحظة عبر الرابط التالي:<br/><a href="${escapeHtml(
        input.trackingUrl
      )}">${escapeHtml(input.trackingUrl)}</a></div></section>`
    : '';

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>فاتورة — ${escapeHtml(input.orderNum)}</title>
<style>${SHARED_PRINT_CSS}</style>
</head>
<body>
<div class="doc-shell">
  <header class="doc-header">
    <div class="doc-header-row">
      <div>
        <h1 class="doc-brand-name">${escapeHtml(BRAND.nameAr)}</h1>
        <p class="doc-brand-sub">${escapeHtml(BRAND.groupAr)}</p>
        ${
          BRAND.supportEmail
            ? `<p class="doc-brand-contact">📧 ${escapeHtml(BRAND.supportEmail)}</p>`
            : ''
        }
      </div>
      <div class="doc-title-badge">فاتورة</div>
    </div>
  </header>
  <div class="doc-meta-strip">${meta.join('')}</div>
  <section class="doc-section">
    <div class="doc-grid-2">
      <div class="doc-card"><h4>بيانات العميل</h4>${phoneLines.join('')}</div>
      <div class="doc-card"><h4>العنوان</h4>${addressLines.join('')}</div>
    </div>
  </section>
  <section class="doc-section">
    <h3>بنود الفاتورة</h3>
    ${itemsTable}
  </section>
  <section class="doc-section">
    <h3>ملخص الدفع</h3>
    <div class="doc-totals">${totalsRows.join('')}</div>
  </section>
  ${noteSection}
  ${warrantySection}
  ${trackingSection}
  <footer class="doc-footer">
    <p>شكرًا لتعاملكم مع <strong>${escapeHtml(BRAND.nameAr)}</strong> — ${escapeHtml(BRAND.groupAr)}</p>
    <p class="doc-footer-en"><strong>${escapeHtml(BRAND.nameEn)}</strong> — ${escapeHtml(BRAND.groupEn)}</p>
    ${
      BRAND.supportEmail
        ? `<p>للاستفسار: <strong>${escapeHtml(BRAND.supportEmail)}</strong></p>`
        : ''
    }
  </footer>
</div>
<script>window.addEventListener('load',function(){setTimeout(function(){window.print();},150);});</script>
</body>
</html>`;
}

// ─── Warranty certificate ────────────────────────────────────────────────────

/** Static Arabic terms text — embedded inline so the certificate is
 *  fully self-contained. A future PR can replace this with a settings
 *  override without changing the helper signature. */
const DEFAULT_WARRANTY_TERMS_AR = [
  'يشمل الضمان عيوب التصنيع طوال فترة الضمان المحددة أعلاه.',
  'لا يشمل الضمان التلف الناتج عن سوء الاستخدام أو الصيانة غير المعتمدة أو الحوادث.',
  'للمطالبة بالضمان يُرجى الاحتفاظ بهذه الشهادة وفاتورة الشراء الصادرة عن تراث.',
  'يلتزم العميل بالإبلاغ عن أي خلل خلال أسبوع من اكتشافه.',
  'الضمان ساري عند تقديم الشهادة الأصلية فقط.',
  'تلتزم تراث — إحدى شركات إحياء جروب — بفحص المنتج وتقديم الحل المناسب وفق هذه الشروط.',
];

export function buildWarrantyCertificateHtml(input: WarrantyInput): string {
  // Guard rail — never emit an empty certificate.
  if (!input.warrantyText || !input.warrantyText.trim()) {
    return '';
  }
  const lines =
    input.lines.length > 0
      ? input.lines
          .map((l) => {
            return `<tr><td><div style="font-weight:700">${escapeHtml(l.label)}</div>${
              l.color
                ? `<div style="font-size:11px;color:#6b7280">${escapeHtml(l.color)}</div>`
                : ''
            }</td><td>${escapeHtml(String(l.quantity))}</td>${
              l.sku
                ? `<td style="font-family:monospace;font-size:11px;color:#6b7280">${escapeHtml(
                    l.sku
                  )}</td>`
                : `<td></td>`
            }</tr>`;
          })
          .join('')
      : `<tr><td colspan="3" style="text-align:center;color:#9ca3af;padding:14px">لا توجد بنود</td></tr>`;

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>شهادة ضمان — ${escapeHtml(input.orderNum)}</title>
<style>
  ${SHARED_PRINT_CSS}
  .cert-hero { padding: 32px 24px 16px; text-align: center; background: linear-gradient(180deg, #ecfdf5, #ffffff); border-bottom: 1px solid #a7f3d0; }
  .cert-shield { font-size: 44px; line-height: 1; margin: 0 0 8px; }
  .cert-title { margin: 0; font-size: 24px; font-weight: 900; color: #065f46; }
  .cert-sub { margin: 6px 0 0; font-size: 13px; color: #047857; }
  .cert-period {
    display: inline-block;
    margin: 16px auto 0;
    background: #047857;
    color: #ffffff;
    padding: 10px 22px;
    border-radius: 999px;
    font-size: 15px;
    font-weight: 800;
    letter-spacing: -0.01em;
  }
  .cert-terms { padding-right: 20px; margin: 0; font-size: 12.5px; line-height: 1.85; color: #374151; }
  .cert-terms li { padding-bottom: 4px; }
  .cert-seal { margin-top: 16px; display: flex; justify-content: flex-end; align-items: center; gap: 18px; font-size: 11.5px; color: #6b7280; }
  .cert-seal-stamp { width: 90px; height: 90px; border: 2px dashed #d1d5db; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #9ca3af; font-size: 11px; font-weight: 700; text-align: center; }
</style>
</head>
<body>
<div class="doc-shell">
  <header class="cert-hero">
    <p class="cert-shield">🛡️</p>
    <h1 class="cert-title">شهادة ضمان</h1>
    <p class="cert-sub">${escapeHtml(BRAND.nameAr)} — ${escapeHtml(BRAND.groupAr)}</p>
    <span class="cert-period">مدة الضمان: ${escapeHtml(input.warrantyText)}</span>
  </header>
  <section class="doc-section">
    <div class="doc-grid-2">
      <div class="doc-card">
        <h4>رقم الشهادة</h4>
        <div class="doc-row"><span class="doc-label">رقم الطلب</span><span class="doc-value">${escapeHtml(
          input.orderNum
        )}</span></div>
        <div class="doc-row"><span class="doc-label">تاريخ الإصدار</span><span class="doc-value">${escapeHtml(
          fmtDateAr(input.createdAt)
        )}</span></div>
      </div>
      <div class="doc-card">
        <h4>العميل</h4>
        <div class="doc-row"><span class="doc-label">الاسم</span><span class="doc-value">${escapeHtml(
          input.customer.name
        )}</span></div>
        ${
          input.customer.phone
            ? `<div class="doc-row"><span class="doc-label">الهاتف</span><span class="doc-value">${escapeHtml(
                input.customer.phone
              )}</span></div>`
            : ''
        }
      </div>
    </div>
  </section>
  <section class="doc-section">
    <h3>المنتجات المشمولة بالضمان</h3>
    <table class="doc-items">
      <thead>
        <tr>
          <th>المنتج</th>
          <th style="width:70px">الكمية</th>
          <th style="width:160px">SKU</th>
        </tr>
      </thead>
      <tbody>${lines}</tbody>
    </table>
  </section>
  <section class="doc-section">
    <h3>شروط التغطية</h3>
    <ol class="cert-terms">${DEFAULT_WARRANTY_TERMS_AR.map((t) => `<li>${escapeHtml(t)}</li>`).join(
      ''
    )}</ol>
    <div class="cert-seal">
      ${
        BRAND.supportEmail
          ? `<div>
        <div>للتواصل بشأن الضمان:</div>
        <div style="margin-top:4px;font-weight:700;color:#111827">📧 ${escapeHtml(
          BRAND.supportEmail
        )}</div>
      </div>`
          : '<div></div>'
      }
      <div class="cert-seal-stamp">ختم<br/>الشركة</div>
    </div>
  </section>
  <footer class="doc-footer">
    <p>تم إصدار هذه الشهادة إلكترونيًا من <strong>${escapeHtml(BRAND.nameAr)}</strong> — ${escapeHtml(BRAND.groupAr)}</p>
    <p class="doc-footer-en"><strong>${escapeHtml(BRAND.nameEn)}</strong> — ${escapeHtml(BRAND.groupEn)}</p>
  </footer>
</div>
<script>window.addEventListener('load',function(){setTimeout(function(){window.print();},150);});</script>
</body>
</html>`;
}

// ─── WhatsApp message ────────────────────────────────────────────────────────

/** Max length for the URL-encoded WhatsApp body. WhatsApp itself
 *  silently truncates around 4000+, but most clients and the wa.me
 *  redirect handle ~2000 reliably. Set conservative. */
const WA_SOFT_LIMIT = 1600;

/** Default rich-text WhatsApp template used when the admin hasn't
 *  customised one in Settings. Plain-text only; no Markdown emoji
 *  rendering across WhatsApp clients is consistent so we keep emojis
 *  as plain unicode (already supported everywhere). */
const DEFAULT_WA_TEMPLATE = [
  'مرحبًا {customerName} 👋',
  'شكرًا لطلبك من تراث — إحدى شركات إحياء جروب 🌟',
  '',
  '📋 تفاصيل الطلب',
  '• رقم الطلب: {orderNum}',
  '• الحالة: {status}',
  '• الإجمالي: {total} ج.م{remainingLine}{paymentMethodLine}',
  '',
  '📦 المنتجات',
  '{productsSummary}',
  '',
  '📍 العنوان',
  '{addressSummary}',
  '{scheduledBlock}{noteBlock}🔗 رابط التتبع',
  '{trackingLink}',
  '{supportContactLine}',
].join('\n');

function buildProductsSummary(lines: WhatsAppInput['lines']): string {
  if (!lines.length) return '• —';
  const max = 3;
  const head = lines.slice(0, max).map((l) => {
    const color = l.color ? ` — ${l.color}` : '';
    return `• ${l.label}${color} × ${l.quantity}`;
  });
  if (lines.length > max) {
    head.push(`…  و${lines.length - max} منتج آخر`);
  }
  return head.join('\n');
}

function buildAddressSummary(addr: WhatsAppInput['address']): string {
  const human = joinAddress([addr.region, addr.district, addr.neighborhood]);
  const detail = (addr.address || '').trim();
  if (!human && !detail) return '—';
  if (human && detail) return `${human}\n${detail}`;
  return human || detail;
}

function buildScheduledBlock(schedule: WhatsAppInput['schedule']): string {
  if (!schedule) return '';
  const txt = schedule.formatted || fmtDateAr(schedule.date);
  if (!txt || txt === '—') return '';
  return `\n📅 موعد التسليم: ${txt}\n`;
}

function buildNoteBlock(note: string | null | undefined): string {
  const t = (note || '').trim();
  return t ? `\n📝 ملاحظة: ${t}\n` : '';
}

function buildSupportContact(input: WhatsAppInput): string {
  // Keep neutral and reuse whatever the BRAND already carries. The
  // brand contact is intentionally just the email for now — we don't
  // invent a phone or website.
  void input;
  return BRAND.supportEmail;
}

/** Truncate the rendered body so the WhatsApp URL stays sane. If the
 *  full message exceeds WA_SOFT_LIMIT, replace the long products
 *  block with a shortened version (top 2) plus a "see full invoice"
 *  pointer to the tracking URL. */
function clampLength(rendered: string, input: WhatsAppInput): string {
  if (rendered.length <= WA_SOFT_LIMIT) return rendered;
  const shortLines = input.lines.slice(0, 2).map((l) => {
    const color = l.color ? ` — ${l.color}` : '';
    return `• ${l.label}${color} × ${l.quantity}`;
  });
  const remaining = input.lines.length - 2;
  if (remaining > 0) {
    shortLines.push(`…  و${remaining} منتج آخر — راجع الفاتورة عبر رابط التتبع`);
  }
  const shorter = rendered.replace(
    /📦 المنتجات\n[\s\S]*?\n\n/,
    `📦 المنتجات\n${shortLines.join('\n')}\n\n`
  );
  return shorter;
}

export function buildWhatsAppMessage(input: WhatsAppInput): string {
  const productsSummary = buildProductsSummary(input.lines);
  const addressSummary = buildAddressSummary(input.address);
  const scheduledBlock = buildScheduledBlock(input.schedule);
  const noteBlock = buildNoteBlock(input.publicNote);
  const supportContact = buildSupportContact(input);
  const supportContactLine = supportContact ? `\nللاستفسار: ${supportContact}` : '';

  const total = Number.isFinite(input.total) ? input.total.toLocaleString('en-US') : '—';
  const hasRemaining = typeof input.remaining === 'number' && input.remaining > 0;
  const remainingLine = hasRemaining
    ? `\n• المتبقي عند الاستلام: ${input.remaining!.toLocaleString('en-US')} ج.م`
    : '';
  const paymentMethodLine = input.paymentMethod ? `\n• طريقة الدفع: ${input.paymentMethod}` : '';
  const tracking = input.trackingUrl || '—';

  // Merge map — every key the helper can fill. The legacy keys
  // ({customerName}, {orderNum}, {total}, {trackingLink}, {delegate},
  // {status}) keep working in admin-customised templates.
  const placeholders: Record<string, string> = {
    customerName: input.customerName || '',
    orderNum: input.orderNum,
    status: input.statusLabel,
    total,
    remainingLine,
    paymentMethodLine,
    productsSummary,
    addressSummary,
    scheduledBlock,
    noteBlock,
    trackingLink: tracking,
    supportContact,
    supportContactLine,
    delegate: input.delegateName || 'المندوب',
  };

  const template = (input.templateOverride && input.templateOverride.trim()) || DEFAULT_WA_TEMPLATE;

  let body = template;
  for (const [key, value] of Object.entries(placeholders)) {
    // Replace all occurrences of `{key}`. Use split/join to avoid
    // regex escaping issues with placeholder values that may include
    // special chars (we never expose the raw notes column here).
    body = body.split(`{${key}}`).join(value);
  }

  // Unfilled placeholders left over by the admin template — keep as-is
  // (current behavior) rather than blanking, so authoring mistakes
  // are visible.
  return clampLength(body, input);
}
