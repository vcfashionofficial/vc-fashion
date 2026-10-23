// VC Fashion customer invoice.
//
// Builds a print-friendly invoice from the order and order_items snapshots the
// admin order-details view has already loaded. It makes no network calls,
// reads no secrets and never writes to Supabase: payment verification, checkout
// calculations, order-status logic and the database schema are untouched, and
// nothing here books, schedules or labels a courier shipment.
//
// In the browser this file exposes window.VCInvoice; Node loads it through
// module.exports so tests/invoice.test.cjs exercises the real builder.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && typeof root === 'object') root.VCInvoice = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  // Seller details are limited to what the storefront already publishes in its
  // public footer. The project has no verified business configuration for a
  // street address, GSTIN, PAN or tax rate, so the invoice neither shows nor
  // invents them and is never labelled a GST tax invoice.
  const SELLER_NAME = 'VC Fashion';
  const SELLER_CONTACT = '20vaibhavd2@gmail.com';
  const SELLER_PHONE = '+91 96916 44513';

  // Signature block. The signed asset is only shown from assets/signature.png
  // when that file is actually deployed; without it a blank line is printed for
  // a wet-ink signature. The caption names the signatory the customer copy is
  // issued under — no other seller detail is added or invented.
  const SIGNATURE_IMAGE = 'assets/signature.png';
  const SIGNATURE_LABEL = 'Authorized Signature for Vaibhav Dubey';

  // The site's own favicon mark inlined as a data URI so the printed invoice
  // carries the VC Fashion logo without loading any external asset.
  const LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><title>VC Fashion</title><rect width="64" height="64" fill="#f8f7f4"/><g fill="none" stroke="#191a18" stroke-width="7.94"><path d="M7.04 16.64 19.84 48.13"/><path d="M32.64 16.64 19.84 48.13"/><path d="M49.86 41.96A12.16 12.16 0 1 1 49.86 22.04"/></g><circle cx="58.24" cy="11.84" r="1.92" fill="none" stroke="#a4a37a" stroke-width="1.4"/></svg>';
  const LOGO_DATA_URI = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(LOGO_SVG);

  // 'paid' is only ever set by the verified Razorpay server flow, so the label
  // mirrors the wording the admin panel already uses.
  const PAYMENT_LABELS = {
    paid: 'Paid · verified by Razorpay',
    pending: 'Pending',
    failed: 'Failed',
    refunded: 'Refunded'
  };
  const DASH = '—';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function toAmount(value) {
    if (value === null || value === undefined || value === '') return null;
    const amount = Number(value);
    return Number.isFinite(amount) ? amount : null;
  }

  // Same en-IN rupee formatting the admin panel already uses for order money.
  function money(paise) {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(paise || 0) / 100);
  }

  function moneyOrDash(value) {
    const paise = toAmount(value);
    return paise === null ? DASH : money(paise);
  }

  function formatDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? DASH : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(date);
  }

  function formatDateTime(value) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? DASH : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  // orders has no invoice-number column. A stored value would be shown only if
  // one ever exists; a missing number is stated plainly, never invented.
  function invoiceNumber(order) {
    const stored = order && order.invoice_number != null ? String(order.invoice_number).trim() : '';
    return stored || 'Not assigned';
  }

  function paymentStatusLabel(value) {
    const key = String(value ?? '').trim().toLowerCase();
    if (!key) return 'Not available';
    if (PAYMENT_LABELS[key]) return PAYMENT_LABELS[key];
    return key.charAt(0).toUpperCase() + key.slice(1);
  }

  function orderStatusLabel(value) {
    const key = String(value ?? '').trim().toLowerCase();
    if (!key) return 'Not available';
    return key.charAt(0).toUpperCase() + key.slice(1);
  }

  // Totals come straight from the stored order row. A total is derived only
  // when subtotal, shipping and discount are all present. This schema has no
  // tax columns, so no tax row is ever produced.
  function totalsModel(order) {
    const source = order || {};
    const subtotal = toAmount(source.subtotal_paise);
    const shipping = toAmount(source.shipping_paise);
    const discount = toAmount(source.discount_paise);
    let total = toAmount(source.total_paise);
    if (total === null && subtotal !== null && shipping !== null && discount !== null) {
      total = subtotal + shipping - discount;
    }
    return { subtotal, shipping, discount, total };
  }

  function totalRow(label, paise, options) {
    const settings = options || {};
    const amount = paise === null ? DASH : (settings.negative ? '−' + money(paise) : money(paise));
    const attribute = paise === null ? '' : ` data-paise="${String(paise)}"`;
    const classes = settings.grand ? 'invoice-total-row invoice-total-grand' : 'invoice-total-row';
    return `<div class="${classes}"${attribute}><span>${escapeHtml(label)}</span><strong>${amount}</strong></div>`;
  }

  function itemRow(item, index) {
    const source = item || {};
    const qty = toAmount(source.quantity);
    const unit = toAmount(source.unit_price_paise);
    let lineTotal = toAmount(source.total_price_paise);
    // The stored line total wins; it is derived from rate x qty only when the
    // stored value is absent, and stays a dash when even those are missing.
    if (lineTotal === null && unit !== null && qty !== null) lineTotal = unit * qty;
    const meta = [
      source.sku ? `SKU ${escapeHtml(source.sku)}` : '',
      source.size ? `Size ${escapeHtml(source.size)}` : '',
      source.color_name ? escapeHtml(source.color_name) : ''
    ].filter(Boolean).join(' · ');
    const qtyText = qty === null ? DASH : String(qty);
    const unitAttribute = unit === null ? '' : ` data-paise="${String(unit)}"`;
    const unitText = unit === null ? DASH : money(unit);
    const lineAttribute = lineTotal === null ? '' : ` data-paise="${String(lineTotal)}"`;
    const lineText = lineTotal === null ? DASH : money(lineTotal);
    return `<tr><td class="invoice-item-index">${index + 1}</td><td class="invoice-item-name"><strong>${escapeHtml(source.product_name || 'Product')}</strong>${meta ? `<small>${meta}</small>` : ''}</td><td class="invoice-item-qty">${qtyText}</td><td class="invoice-item-rate"${unitAttribute}>${unitText}</td><td class="invoice-item-amount"${lineAttribute}>${lineText}</td></tr>`;
  }

  function itemsSection(items) {
    if (!Array.isArray(items) || !items.length) {
      return '<p class="invoice-empty">No items are recorded for this order.</p>';
    }
    const rows = items.map((item, index) => itemRow(item, index)).join('');
    return `<table class="invoice-items"><thead><tr><th>#</th><th>Item</th><th class="invoice-num">Qty</th><th class="invoice-num">Rate</th><th class="invoice-num">Amount</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function customerSection(order) {
    const source = order || {};
    const hasDetails = Boolean(source.customer_name || source.customer_email || source.customer_phone);
    if (!hasDetails) return '<h2>Customer</h2><p class="invoice-empty">Customer details not provided.</p>';
    const rows = [`<p class="invoice-party-name">${escapeHtml(source.customer_name || 'Guest customer')}</p>`];
    if (source.customer_email) rows.push(`<p>${escapeHtml(source.customer_email)}</p>`);
    if (source.customer_phone) rows.push(`<p>${escapeHtml(source.customer_phone)}</p>`);
    return `<h2>Customer</h2>${rows.join('')}`;
  }

  function shippingSection(order) {
    const source = order || {};
    const address = String(source.shipping_address || '').trim();
    const locality = [source.shipping_city, source.shipping_state, source.shipping_pincode]
      .map(value => String(value || '').trim())
      .filter(Boolean)
      .join(', ');
    if (!address && !locality) return '<h2>Shipping address</h2><p class="invoice-empty">Shipping address not provided.</p>';
    const rows = [];
    if (address) rows.push(`<p class="invoice-party-address">${escapeHtml(address)}</p>`);
    if (locality) rows.push(`<p>${escapeHtml(locality)}</p>`);
    return `<h2>Shipping address</h2>${rows.join('')}`;
  }

  // Node can ask the disk whether the signature asset exists, so tests and
  // programmatic builds see a deterministic document. The browser cannot check
  // synchronously without a network request, so it always offers the image and
  // the onerror handler swaps in the blank signature line if it fails to load.
  // Returns true/false in Node, null when it can only be known at render time.
  function signatureImageAvailable() {
    try {
      if (typeof require === 'function' && typeof __dirname === 'string') {
        return require('node:fs').existsSync(require('node:path').resolve(__dirname, 'assets', 'signature.png'));
      }
    } catch (error) {
      return false;
    }
    return null;
  }

  // The invoice document is written into an about:blank popup, where a plain
  // relative src cannot be resolved against the shop's folder. In the browser
  // the signature path is therefore resolved against the admin page's own base
  // URI into an absolute URL before it is embedded; Node keeps the relative
  // path because it only checks the file on disk. The onerror fallback inside
  // signatureSection() still covers a deployed-but-broken image.
  function signatureAssetUrl() {
    try {
      if (typeof URL === 'function' && typeof document !== 'undefined' && document && document.baseURI) {
        return new URL(SIGNATURE_IMAGE, document.baseURI).href;
      }
    } catch (error) {
      // Fall through to the plain relative path.
    }
    return SIGNATURE_IMAGE;
  }

  // Bottom-right signature area: the deployed signature image when it exists,
  // otherwise a blank line to sign, always followed by the signatory caption.
  function signatureSection() {
    const mark = signatureImageAvailable() === false
      ? '<div class="invoice-signature-mark"><span class="invoice-signature-line"></span></div>'
      : `<div class="invoice-signature-mark"><img class="invoice-signature-image" src="${escapeHtml(signatureAssetUrl())}" alt="Signature" onerror="this.hidden=true;this.nextElementSibling.hidden=false;"><span class="invoice-signature-line" hidden></span></div>`;
    return `<section class="invoice-section invoice-signature-block" aria-label="Authorized signature"><div class="invoice-signature">${mark}<p class="invoice-signature-label">${escapeHtml(SIGNATURE_LABEL)}</p></div></section>`;
  }

  function metaSection(order, invoiceDate) {
    const source = order || {};
    const rows = [
      ['Invoice no.', invoiceNumber(source)],
      ['Invoice date', invoiceDate],
      ['Order ID', String(source.id || '').trim() || DASH],
      ['Order placed', formatDateTime(source.created_at)],
      ['Payment status', paymentStatusLabel(source.payment_status)],
      ['Order status', orderStatusLabel(source.order_status)]
    ];
    // A Razorpay payment reference is shown only when the order actually has one.
    if (source.razorpay_payment_id) rows.push(['Payment reference', String(source.razorpay_payment_id)]);
    return `<section class="invoice-section invoice-meta"><dl>${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl></section>`;
  }

  const NOTES = [
    'This is a customer invoice for the order shown above. It is not a GST tax invoice and it does not list tax amounts.',
    'This document is not a courier shipping label. It does not book, schedule or confirm a shipment.',
    'All amounts are in Indian Rupees (INR) and come from the stored order record.'
  ];

  const STYLESHEET = `
:root{--ink:#252622;--muted:#828279;--line:#e8e6df;--paper:#fff;--accent:#77785f}
*{box-sizing:border-box}
body{margin:0;background:#f1f0eb;color:var(--ink);font:400 14px/1.6 "DM Sans",Arial,Helvetica,sans-serif}
.invoice-sheet{width:calc(100% - 32px);max-width:760px;margin:28px auto;background:var(--paper);padding:46px 50px;border:1px solid var(--line)}
.invoice-header{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;padding-bottom:20px;border-bottom:2px solid var(--ink)}
.invoice-brand{display:flex;align-items:center;gap:14px}
.invoice-logo{width:46px;height:46px;display:block}
.invoice-wordmark{display:block;font:800 24px/1 "Manrope",Arial,sans-serif;letter-spacing:-1.4px}
.invoice-tagline,.invoice-contact{margin:5px 0 0;font-size:11px;color:var(--muted)}
.invoice-heading{text-align:right}
.invoice-heading h1{margin:0;font:800 30px/1 "Manrope",Arial,sans-serif;letter-spacing:3px}
.invoice-heading-note{margin:7px 0 0;font-size:10px;color:var(--muted)}
.invoice-section{margin-top:26px}
.invoice-section h2{margin:0 0 10px;font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:var(--accent);font-weight:700}
.invoice-meta dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px 26px;margin:0}
.invoice-meta dl>div{display:flex;justify-content:space-between;gap:12px;border-bottom:1px dotted var(--line);padding-bottom:6px}
.invoice-meta dt{font-size:11px;color:var(--muted)}
.invoice-meta dd{margin:0;font-size:12px;font-weight:600;text-align:right;overflow-wrap:anywhere}
.invoice-parties{display:grid;grid-template-columns:1fr 1fr;gap:26px}
.invoice-party-name{margin:0 0 4px;font-size:14px;font-weight:700}
.invoice-parties p{margin:0 0 3px;font-size:12px}
.invoice-party-address{white-space:pre-line}
.invoice-empty{font-size:12px;color:var(--muted);font-style:italic}
.invoice-items{width:100%;border-collapse:collapse}
.invoice-items th{padding:8px 6px;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--muted);text-align:left;border-bottom:1px solid var(--line)}
.invoice-items td{padding:11px 6px;font-size:13px;border-bottom:1px solid #f0efe9;vertical-align:top}
.invoice-items th:first-child,.invoice-items td:first-child{width:30px;color:var(--muted)}
.invoice-num{text-align:right}
.invoice-item-name strong{display:block;font-size:13px}
.invoice-item-name small{display:block;margin-top:3px;font-size:11px;color:var(--muted)}
.invoice-totals{display:grid;gap:5px;width:min(100%,340px);margin-left:auto}
.invoice-total-row{display:flex;justify-content:space-between;gap:18px;font-size:13px;padding:3px 0}
.invoice-total-row strong{font-weight:600}
.invoice-total-grand{border-top:2px solid var(--ink);margin-top:7px;padding-top:9px;font-size:15px;font-weight:700}
.invoice-notes{margin-top:28px;padding-top:14px;border-top:1px solid var(--line);display:grid;gap:6px}
.invoice-notes p{margin:0;font-size:11px;color:var(--muted)}
.invoice-footer{margin-top:20px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
.invoice-footer p{margin:0;font-size:11px;color:var(--muted)}
.invoice-signature-block{display:flex;justify-content:flex-end}
.invoice-signature{width:min(100%,250px);text-align:center}
.invoice-signature-mark{display:flex;align-items:flex-end;justify-content:center;min-height:64px}
.invoice-signature-image{display:block;max-width:100%;max-height:64px}
.invoice-signature-line{display:block;width:100%;height:64px;border-bottom:1px solid var(--ink)}
.invoice-signature-image[hidden],.invoice-signature-line[hidden]{display:none}
.invoice-signature-label{margin:8px 0 0;font-size:11px;color:var(--muted)}
.invoice-print-button{border:0;background:var(--ink);color:#fff;padding:11px 18px;font-size:12px;letter-spacing:.3px;cursor:pointer}
@media (max-width:640px){.invoice-sheet{padding:28px 22px}.invoice-header{flex-direction:column}.invoice-heading{text-align:left}.invoice-meta dl,.invoice-parties{grid-template-columns:1fr}}
@media print{
  body{background:#fff}
  .invoice-sheet{width:auto;max-width:none;margin:0;padding:0;border:0}
  .invoice-no-print{display:none!important}
  .invoice-notes,.invoice-signature-block,.invoice-footer,.invoice-total-grand{break-inside:avoid}
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
@page{size:A4;margin:14mm}
`;


  // Renders the complete standalone invoice document. Every dynamic value is
  // HTML-escaped; missing fields become an explicit dash or a plain statement
  // instead of invented data.
  function buildInvoiceHtml(order, items, options) {
    const settings = options || {};
    const source = order || {};
    const lines = Array.isArray(items) ? items : [];
    const now = settings.now ? new Date(settings.now) : new Date();
    const invoiceDate = formatDate(now);
    const totals = totalsModel(source);
    const orderId = String(source.id || '').trim() || DASH;

    return [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<title>Invoice — VC Fashion</title>',
      '<style>',
      STYLESHEET,
      '</style>',
      '</head>',
      '<body>',
      '<main class="invoice-sheet">',
      '<header class="invoice-header">',
      '<div class="invoice-brand">',
      `<img class="invoice-logo" src="${LOGO_DATA_URI}" width="46" height="46" alt="${escapeHtml(SELLER_NAME)} logo">`,
      '<div>',
      `<span class="invoice-wordmark">${escapeHtml(SELLER_NAME)}<sup>®</sup></span>`,
      '<p class="invoice-tagline">Everyday pieces, considered.</p>',
      `<p class="invoice-contact">${escapeHtml(SELLER_CONTACT)} · ${escapeHtml(SELLER_PHONE)}</p>`,
      '</div>',
      '</div>',
      '<div class="invoice-heading">',
      '<h1>INVOICE</h1>',
      '<p class="invoice-heading-note">Customer copy · not a GST tax invoice</p>',
      '</div>',
      '</header>',
      metaSection(source, invoiceDate),
      `<section class="invoice-section invoice-parties"><div>${customerSection(source)}</div><div>${shippingSection(source)}</div></section>`,
      `<section class="invoice-section invoice-items-block"><h2>Order items</h2>${itemsSection(lines)}</section>`,
      `<section class="invoice-section invoice-totals-block"><h2>Order totals</h2><div class="invoice-totals">${totalRow('Subtotal', totals.subtotal)}${totalRow('Shipping', totals.shipping)}${totalRow('Discount', totals.discount, { negative: true })}${totalRow('Total', totals.total, { grand: true })}</div></section>`,
      `<section class="invoice-section invoice-notes">${NOTES.map(note => `<p>${escapeHtml(note)}</p>`).join('')}</section>`,
      signatureSection(),
      '<footer class="invoice-footer">',
      `<p>Generated on ${escapeHtml(formatDateTime(now))} · © 2026 VC FASHION. ALL RIGHTS RESERVED.</p>`,
      '<button type="button" class="invoice-print-button invoice-no-print" onclick="window.print()">Print / Save as PDF</button>',
      '</footer>',
      '</main>',
      '</body>',
      '</html>'
    ].join('\n');
  }

  // Opens the invoice in a fresh window and triggers the browser print dialog
  // (the user chooses "Save as PDF" there). options.openWindow exists so tests
  // can drive a fake window; blockers are reported instead of thrown.
  function printInvoice(order, items, options) {
    const settings = options || {};
    const html = buildInvoiceHtml(order, items, settings);
    const open = typeof settings.openWindow === 'function'
      ? settings.openWindow
      : (typeof window !== 'undefined' && typeof window.open === 'function' ? (url, target) => window.open(url, target) : null);
    if (!open) return { ok: false, reason: 'unavailable' };
    let win;
    try {
      win = open('', '_blank');
    } catch (error) {
      return { ok: false, reason: 'blocked' };
    }
    if (!win || !win.document) return { ok: false, reason: 'blocked' };
    try {
      win.document.open();
      win.document.write(html);
      win.document.close();
    } catch (error) {
      return { ok: false, reason: 'write-failed' };
    }
    let printed = false;
    const trigger = () => {
      if (printed) return;
      printed = true;
      try { if (typeof win.focus === 'function') win.focus(); } catch (error) { /* ignore */ }
      try { if (typeof win.print === 'function') win.print(); } catch (error) { /* ignore */ }
    };
    const state = win.document.readyState;
    if (!state || state === 'complete') trigger();
    else if (typeof win.addEventListener === 'function') win.addEventListener('load', trigger, { once: true });
    else trigger();
    return { ok: true };
  }

  return {
    escapeHtml,
    money,
    moneyOrDash,
    formatDate,
    formatDateTime,
    invoiceNumber,
    paymentStatusLabel,
    orderStatusLabel,
    totalsModel,
    buildInvoiceHtml,
    printInvoice
  };
});

