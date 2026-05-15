// ─────────────────────────────────────────────────────────────────────────────
// src/lib/orders/adjustmentInvoice.ts
//
// Phase Returns-Exchange-1 — HTML invoice generator for return /
// exchange settlements. Mirrors the print-CSS pattern used by the
// public tracking pages (`generateInvoiceHTML` in track/[orderId]):
// we render a self-contained HTML document, open it in a fresh
// browser window, and call `window.print()` so the operator can
// either physically print or save as PDF from the browser dialog.
//
// What this module is NOT
// -----------------------
//   • No PDF library. Browser print is the contract.
//   • No Supabase calls. The caller passes a self-describing payload.
//   • No copying of images. The invoice is monetary-only — listing
//     line labels + colors + quantities + values is enough.
// ─────────────────────────────────────────────────────────────────────────────

import {
  ADJUSTMENT_KIND_LABEL_AR,
  type AdjustmentKind,
  type AdjustmentLine,
  type PriceDifferenceDirection,
} from './orderAdjustments';

export interface AdjustmentInvoicePayload {
  /** Original order number — visible in the header for context. */
  parentOrderNum: string;
  /** Customer name + phone for the address block. */
  customer: string;
  phone: string;
  /** Region / district / neighborhood as a single human label. */
  addressLabel: string;
  /** Settlement type — drives the title + reason label. */
  kind: AdjustmentKind;
  /** Mandatory reason — already validated upstream. */
  reason: string;
  /** Return items (always populated). */
  returnLines: AdjustmentLine[];
  /** Replacement items (empty for pure returns). */
  replacementLines: AdjustmentLine[];
  /** Computed totals (signed). */
  originalSelectedValue: number;
  replacementValue: number;
  priceDifferenceAbs: number;
  priceDifferenceDirection: PriceDifferenceDirection;
  /** New shipping leg for the linked child order. */
  shippingBaseAmount: number;
  shippingCustomerAmount: number;
  shippingCompanyAmount: number;
  /** Money owed / due. */
  customerCollectAmount: number;
  companyRefundAmount: number;
  /** Linked child order number (e.g. 2605131-R1). May be null when
   *  the caller previews before persistence completes. */
  childOrderNum: string | null;
  /** Staff member creating the settlement. */
  staffName: string;
  /** Free-form note for the delegate. Optional. */
  operationalNote?: string | null;
}

const fmt = (n: number): string => `${(Number.isFinite(n) ? n : 0).toLocaleString('en-US')} ج.م`;

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function settlementTitle(kind: AdjustmentKind): string {
  return kind === 'exchange_full' || kind === 'exchange_partial'
    ? 'فاتورة استبدال'
    : 'فاتورة مرتجع';
}

function reasonLabel(kind: AdjustmentKind): string {
  return kind === 'exchange_full' || kind === 'exchange_partial' ? 'سبب الاستبدال' : 'سبب المرتجع';
}

function priceDirectionLabel(direction: PriceDifferenceDirection): string {
  switch (direction) {
    case 'customer_pays':
      return 'مستحق على العميل';
    case 'company_refunds':
      return 'لصالح العميل';
    default:
      return 'لا يوجد فرق';
  }
}

function renderLinesTable(title: string, lines: AdjustmentLine[]): string {
  if (lines.length === 0) return '';
  const rows = lines
    .map((line, idx) => {
      const qty = Math.max(0, Number(line.quantity) || 0);
      const unit = Math.max(0, Number(line.unitPrice) || 0);
      const flashOn = line.includeFlashlight === true;
      const flashPrice = flashOn ? Math.max(0, Number(line.flashlightPrice) || 0) : 0;
      const subtotal = qty * unit + qty * flashPrice;
      const chargeable = line.isFree ? 0 : subtotal;
      const colorPart = line.color ? ` — ${escapeHtml(line.color)}` : '';
      const flashPart = flashOn ? ` + كشاف (${fmt(flashPrice)})` : '';
      const partLabel =
        line.itemType === 'part' ? '<span class="badge badge-part">قطعة صيانة</span>' : '';
      const freeLabel = line.isFree ? '<span class="badge badge-free">مجاني</span>' : '';
      return `
        <tr>
          <td>${idx + 1}</td>
          <td>
            <div class="line-name">${escapeHtml(line.label || line.productType || 'منتج')}${colorPart}${flashPart}</div>
            <div class="line-tags">${partLabel}${freeLabel}</div>
          </td>
          <td class="num">${qty}</td>
          <td class="num">${fmt(unit)}</td>
          <td class="num strong">${fmt(chargeable)}</td>
        </tr>
      `;
    })
    .join('');
  const total = lines.reduce((sum, l) => {
    if (l.isFree) return sum;
    const qty = Math.max(0, Number(l.quantity) || 0);
    const unit = Math.max(0, Number(l.unitPrice) || 0);
    const flash = l.includeFlashlight ? Math.max(0, Number(l.flashlightPrice) || 0) : 0;
    return sum + qty * unit + qty * flash;
  }, 0);
  return `
    <section class="lines">
      <h3>${escapeHtml(title)}</h3>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>المنتج</th>
            <th class="num">الكمية</th>
            <th class="num">السعر</th>
            <th class="num">الإجمالي</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td colspan="4" class="foot-label">إجمالي ${escapeHtml(title)} (المدفوع)</td>
            <td class="num strong">${fmt(total)}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  `;
}

function renderSummaryTable(payload: AdjustmentInvoicePayload): string {
  const rows: string[] = [];
  rows.push(
    `<tr><td>قيمة العناصر المرتجعة</td><td class="num">${fmt(payload.originalSelectedValue)}</td></tr>`
  );
  if (payload.replacementLines.length > 0) {
    rows.push(
      `<tr><td>قيمة العناصر البديلة</td><td class="num">${fmt(payload.replacementValue)}</td></tr>`
    );
  }
  if (payload.priceDifferenceAbs > 0) {
    const sign = payload.priceDifferenceDirection === 'company_refunds' ? '−' : '+';
    rows.push(
      `<tr><td>فرق السعر (${priceDirectionLabel(payload.priceDifferenceDirection)})</td><td class="num">${sign} ${fmt(payload.priceDifferenceAbs)}</td></tr>`
    );
  }
  rows.push(
    `<tr><td>مصاريف الشحن</td><td class="num">${fmt(payload.shippingBaseAmount)}</td></tr>`
  );
  rows.push(
    `<tr><td>يتحمل العميل من الشحن</td><td class="num">${fmt(payload.shippingCustomerAmount)}</td></tr>`
  );
  rows.push(
    `<tr><td>تتحمل الشركة من الشحن</td><td class="num">${fmt(payload.shippingCompanyAmount)}</td></tr>`
  );
  if (payload.customerCollectAmount > 0) {
    rows.push(
      `<tr class="row-emphasis"><td>المبلغ المطلوب من العميل</td><td class="num">${fmt(payload.customerCollectAmount)}</td></tr>`
    );
  }
  if (payload.companyRefundAmount > 0) {
    rows.push(
      `<tr class="row-refund"><td>المبلغ المسترد للعميل</td><td class="num">${fmt(payload.companyRefundAmount)}</td></tr>`
    );
  }
  return `
    <section class="summary">
      <h3>ملخص التسوية</h3>
      <table>
        <tbody>${rows.join('')}</tbody>
      </table>
    </section>
  `;
}

/**
 * Build the full self-contained HTML document for an adjustment
 * invoice. Drop into `document.write()` of a freshly-opened window.
 */
export function generateAdjustmentInvoiceHTML(payload: AdjustmentInvoicePayload): string {
  const title = settlementTitle(payload.kind);
  const kindLabel = ADJUSTMENT_KIND_LABEL_AR[payload.kind] ?? title;
  const dateStr = new Date().toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const timeStr = new Date().toLocaleTimeString('ar-EG', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const childLine = payload.childOrderNum
    ? `<div class="meta-line">رقم طلب الشحن: <strong>#${escapeHtml(payload.childOrderNum)}</strong></div>`
    : '';
  const operationalLine =
    payload.operationalNote && payload.operationalNote.trim()
      ? `<section class="notes"><h3>ملاحظات للمندوب</h3><p>${escapeHtml(payload.operationalNote.trim())}</p></section>`
      : '';

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} #${escapeHtml(payload.childOrderNum ?? payload.parentOrderNum)}</title>
  <style>
    @page { size: A4; margin: 16mm; }
    * { box-sizing: border-box; }
    body {
      font-family: 'Cairo', 'Tajawal', system-ui, -apple-system, sans-serif;
      direction: rtl;
      color: #1f2937;
      margin: 0;
      padding: 0;
      background: #fff;
    }
    .invoice {
      max-width: 760px;
      margin: 0 auto;
      padding: 24px;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding-bottom: 16px;
      border-bottom: 2px solid #1e3a5f;
      margin-bottom: 20px;
    }
    header h1 {
      font-size: 22px;
      margin: 0 0 4px;
      color: #1e3a5f;
    }
    header .meta-line {
      font-size: 12px;
      color: #4b5563;
      margin-top: 2px;
    }
    header .stamp {
      text-align: left;
      font-size: 11px;
      color: #4b5563;
    }
    .customer-block {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      padding: 12px 16px;
      margin-bottom: 20px;
      font-size: 13px;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px 16px;
    }
    .customer-block .label {
      color: #6b7280;
      font-size: 11px;
    }
    .reason-block {
      background: #fff7ed;
      border: 1px solid #fed7aa;
      border-radius: 12px;
      padding: 10px 14px;
      margin-bottom: 20px;
      font-size: 13px;
    }
    .reason-block .label {
      font-weight: 700;
      color: #9a3412;
      display: block;
      margin-bottom: 4px;
    }
    section.lines, section.summary, section.notes { margin-bottom: 18px; }
    section h3 {
      font-size: 14px;
      color: #1e3a5f;
      margin: 0 0 8px;
      padding-bottom: 4px;
      border-bottom: 1px solid #e5e7eb;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    th, td {
      padding: 8px 10px;
      text-align: right;
      border-bottom: 1px solid #f3f4f6;
    }
    thead th {
      background: #f3f4f6;
      font-weight: 700;
      font-size: 11px;
      color: #4b5563;
    }
    td.num, th.num { text-align: left; font-variant-numeric: tabular-nums; }
    td.strong { font-weight: 700; color: #111827; }
    tfoot td { font-weight: 700; background: #fafafa; }
    tfoot td.foot-label { text-align: left; color: #4b5563; }
    .line-name { font-size: 12px; color: #111827; }
    .line-tags { margin-top: 2px; }
    .badge {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 999px;
      font-size: 10px;
      margin-inline-end: 4px;
    }
    .badge-part { background: #e0e7ff; color: #3730a3; }
    .badge-free { background: #d1fae5; color: #065f46; }
    .summary table td:first-child { color: #4b5563; }
    .summary table .row-emphasis td { background: #ecfdf5; color: #065f46; font-weight: 700; }
    .summary table .row-refund td { background: #fef3c7; color: #92400e; font-weight: 700; }
    .notes p {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 8px 12px;
      font-size: 12px;
      margin: 0;
      white-space: pre-wrap;
    }
    footer {
      margin-top: 28px;
      padding-top: 12px;
      border-top: 1px dashed #d1d5db;
      font-size: 11px;
      color: #6b7280;
      display: flex;
      justify-content: space-between;
    }
    @media print {
      .no-print { display: none; }
    }
    .actions {
      text-align: center;
      margin: 18px 0 24px;
    }
    .actions button {
      padding: 8px 20px;
      border: 1px solid #1e3a5f;
      background: #1e3a5f;
      color: white;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      font-family: inherit;
    }
    .actions button.secondary {
      background: white;
      color: #1e3a5f;
      margin-inline-start: 8px;
    }
  </style>
</head>
<body>
  <div class="invoice">
    <div class="actions no-print">
      <button onclick="window.print()">طباعة</button>
      <button class="secondary" onclick="window.close()">إغلاق</button>
    </div>
    <header>
      <div>
        <h1>${escapeHtml(title)}</h1>
        <div class="meta-line">نوع التسوية: <strong>${escapeHtml(kindLabel)}</strong></div>
        <div class="meta-line">رقم الطلب الأصلي: <strong>#${escapeHtml(payload.parentOrderNum)}</strong></div>
        ${childLine}
      </div>
      <div class="stamp">
        <div>تاريخ الإصدار</div>
        <div><strong>${escapeHtml(dateStr)}</strong></div>
        <div>${escapeHtml(timeStr)}</div>
      </div>
    </header>
    <div class="customer-block">
      <div><span class="label">العميل:</span><br /><strong>${escapeHtml(payload.customer)}</strong></div>
      <div><span class="label">الهاتف:</span><br /><strong>${escapeHtml(payload.phone)}</strong></div>
      <div style="grid-column: 1 / -1;"><span class="label">العنوان:</span><br />${escapeHtml(payload.addressLabel)}</div>
    </div>
    <div class="reason-block">
      <span class="label">${escapeHtml(reasonLabel(payload.kind))}:</span>
      ${escapeHtml(payload.reason)}
    </div>
    ${renderLinesTable('العناصر المرتجعة', payload.returnLines)}
    ${renderLinesTable('العناصر البديلة', payload.replacementLines)}
    ${renderSummaryTable(payload)}
    ${operationalLine}
    <footer>
      <div>أنشأ هذه التسوية: <strong>${escapeHtml(payload.staffName)}</strong></div>
      <div>Turath Masr — تراث مصر</div>
    </footer>
  </div>
</body>
</html>`;
}

/**
 * Open a new browser window, write the invoice HTML into it, and
 * surface print controls. Returns the popup `Window` reference for
 * caller-side cleanup (e.g. focus management). Returns `null` when
 * popup blockers prevent the open — the caller can fall back to a
 * toast prompting the user to allow pop-ups.
 */
export function openAdjustmentInvoiceWindow(payload: AdjustmentInvoicePayload): Window | null {
  if (typeof window === 'undefined') return null;
  const html = generateAdjustmentInvoiceHTML(payload);
  const popup = window.open('', '_blank', 'noopener,noreferrer,width=860,height=900');
  if (!popup) return null;
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  return popup;
}
