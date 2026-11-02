import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';

// Customer-facing quotation documents (print view and PDF).
// Whitelist of public fields only: item code, description, HSN, quantity, the
// net unit rate actually charged, GST and amounts. List price, discount, cost
// and margin never appear (client rule, 23 Oct). Private pricing never enters
// either renderer.

const escape = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ISSUED = ['APPROVED', 'SENT', 'WON'];
const STATES = { '27': 'Maharashtra', '33': 'Tamil Nadu', '29': 'Karnataka', '24': 'Gujarat', '07': 'Delhi', '36': 'Telangana', '37': 'Andhra Pradesh', '32': 'Kerala', '19': 'West Bengal', '09': 'Uttar Pradesh', '06': 'Haryana', '08': 'Rajasthan', '23': 'Madhya Pradesh', '03': 'Punjab', '21': 'Odisha', '10': 'Bihar', '20': 'Jharkhand', '22': 'Chhattisgarh', '30': 'Goa', '34': 'Puducherry' };
const stateLabel = (code) => STATES[code] ? `${STATES[code]} (${code})` : code;

/** Exact decimal string → BigInt scaled by 10^6. */
const SCALE = 1000000n;
function scaled(value) { const [w, f = ''] = String(value ?? '0').split('.'); return BigInt(w || '0') * SCALE + BigInt((f + '000000').slice(0, 6)); }
/** Net unit rate after discount, rounded half-up to paise (no floats). */
function netRate(unitPrice, discountPercent) {
  const paise = (scaled(unitPrice) * (100n * SCALE - scaled(discountPercent)) * 100n + 50n * SCALE * SCALE) / (100n * SCALE * SCALE);
  return `${paise / 100n}.${String(paise % 100n).padStart(2, '0')}`;
}
function group(whole) { return whole.length <= 3 ? whole : `${whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${whole.slice(-3)}`; }
/** ₹12,34,567.00 from an exact decimal string. */
export function inr(value) {
  const [w, f = ''] = String(value ?? '0').replace(/^-/, '').split('.');
  return `${String(value).startsWith('-') ? '-' : ''}₹${group(w.replace(/^0+(?=\d)/, ''))}.${(f + '00').slice(0, 2)}`;
}
const qty = (value) => { const [w, f = ''] = String(value).split('.'); const frac = f.replace(/0+$/, ''); return `${group(w)}${frac ? `.${frac}` : ''}`; };
const pct = (value) => `${String(value).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')}%`;
const dateText = (iso) => { const d = new Date(`${iso}T00:00:00+05:30`); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }); };

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function upTo99(n) { return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ''}`; }
function upTo999(n) { return `${n >= 100 ? `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ' ' : ''}` : ''}${n % 100 ? upTo99(n % 100) : ''}`; }
/** Indian-system amount in words: "Rupees twelve lakh thirty-four thousand … and fifty paise only". */
export function amountInWords(value) {
  const [w, f = ''] = String(value ?? '0').split('.');
  let n = BigInt(w || '0');                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 
  const paise = Number((f + '00').slice(0, 2));
  if (n === 0n && paise === 0) return 'Rupees zero only';
  const parts = [];
  const crore = n / 10000000n; n %= 10000000n;
  if (crore > 0n) parts.push(`${crore > 999n ? group(String(crore)) : upTo999(Number(crore))} crore`);
  for (const [unit, size] of [['lakh', 100000n], ['thousand', 1000n]]) { const v = n / size; n %= size; if (v > 0n) parts.push(`${upTo99(Number(v))} ${unit}`); }
  if (n > 0n) parts.push(upTo999(Number(n)));
  const rupees = parts.length ? `Rupees ${parts.join(' ')}` : 'Rupees zero';
  return `${rupees}${paise ? ` and ${upTo99(paise)} paise` : ''} only`.replace(/\s+/g, ' ');
}

function rows(q) {
  return q.lines.map((l, i) => ({ n: i + 1, code: l.partCode, description: l.description, hsn: l.hsn || '—', qty: `${qty(l.quantity)} ${l.uom}`, rate: inr(netRate(l.unitPrice, l.discountPercent)), gst: pct(l.taxPercent), amount: inr(l.net) }));
}
function taxRows(q) {
  const local = q.sellerState === q.placeOfSupply;
  return [['Taxable value', q.subtotal], ...(local ? [['CGST', q.cgst], [q.localTaxLabel || 'SGST', q.sgst]] : [['IGST', q.igst]])];
}

export function quotationPrintHtml(q) {
  const e = escape, l = q.letterhead ?? {}, issued = ISSUED.includes(q.status);
  return `<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Quotation ${e(q.quotation_number)}</title><link rel="stylesheet" href="/quotation-print.css"></head><body>
<div class="toolbar"><button id="print" type="button">Print or save as PDF</button></div>
<article class="sheet${issued ? '' : ' draft'}">
${issued ? '' : '<p class="watermark" aria-hidden="true">NOT APPROVED FOR ISSUE</p>'}
<header class="letterhead"><div class="brand"><span class="mark">${e((l.name || 'M').trim().charAt(0))}</span><div><h1>${e(l.name)}</h1><p>${e(l.address)}</p></div></div>
<dl class="contact">${l.gstin ? `<div><dt>GSTIN</dt><dd>${e(l.gstin)}</dd></div>` : ''}${l.phone ? `<div><dt>Phone</dt><dd>${e(l.phone)}</dd></div>` : ''}${l.email ? `<div><dt>Email</dt><dd>${e(l.email)}</dd></div>` : ''}</dl></header>
<section class="title"><h2>Quotation</h2><p class="status">${issued ? '' : 'Draft — not approved for issue · '}Version ${e(q.version)}</p></section>
<section class="parties"><div><h3>Bill to</h3><p class="strong">${e(q.customer_name)}</p><p class="multiline">${e(q.customerAddress || '')}</p>${q.customerGstin ? `<p>GSTIN ${e(q.customerGstin)}</p>` : ''}</div>
<dl class="meta"><div><dt>Quotation no.</dt><dd>${e(q.quotation_number)}</dd></div><div><dt>Valid until</dt><dd>${e(dateText(q.validUntil))}</dd></div><div><dt>Place of supply</dt><dd>${e(stateLabel(q.placeOfSupply))}</dd></div></dl></section>
<table><thead><tr><th>#</th><th>Item and description</th><th>HSN</th><th class="num">Qty</th><th class="num">Unit rate</th><th class="num">GST</th><th class="num">Amount</th></tr></thead><tbody>
${rows(q).map((r) => `<tr><td class="idx">${r.n}</td><td class="item"><strong>${e(r.code)}</strong><span>${e(r.description)}</span></td><td data-label="HSN">${e(r.hsn)}</td><td class="num" data-label="Qty">${e(r.qty)}</td><td class="num" data-label="Unit rate">${e(r.rate)}</td><td class="num" data-label="GST">${e(r.gst)}</td><td class="num" data-label="Amount">${e(r.amount)}</td></tr>`).join('')}
</tbody></table>
<section class="summary"><p class="words"><span>Amount in words</span>${e(amountInWords(q.total))}</p>
<dl class="totals">${taxRows(q).map(([k, v]) => `<div><dt>${e(k)}</dt><dd>${e(inr(v))}</dd></div>`).join('')}<div class="grand"><dt>Total</dt><dd>${e(inr(q.total))}</dd></div></dl></section>
${q.terms ? `<section class="block"><h3>Terms</h3><p class="multiline">${e(q.terms)}</p></section>` : ''}
${q.notes ? `<section class="block"><h3>Notes</h3><p class="multiline">${e(q.notes)}</p></section>` : ''}
<footer><p>This is a quotation, not a tax invoice. Prices in INR; GST as shown.</p><div class="sign"><span>For ${e(l.name)}</span><span>Authorised signatory</span></div></footer>
</article><script type="module" src="/quotation-print.js"></script></body></html>`;
}

const INK = '#1c2a24', MUTED = '#5e6b64', BRAND = '#125c40', LINE = '#dfe5e1', SOFT = '#eef6f1';

export function quotationPdf(q) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 48, bottom: 56, left: 48, right: 48 }, bufferPages: true, info: { Title: `Quotation ${q.quotation_number}`, Author: q.letterhead?.name ?? '' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    doc.font(fileURLToPath(new URL('./assets/NotoSansDevanagari.ttf', import.meta.url)));
    const l = q.letterhead ?? {}, issued = ISSUED.includes(q.status);
    const left = 48, width = doc.page.width - 96, right = left + width;

    // Letterhead band
    doc.rect(0, 0, doc.page.width, 6).fill(BRAND);
    doc.roundedRect(left, 30, 34, 34, 8).fill(BRAND);
    doc.fillColor('#ffffff').fontSize(18).text((l.name || 'M').trim().charAt(0), left, 34, { width: 34, align: 'center' });
    doc.fillColor(INK).fontSize(17).text(l.name ?? '', left + 46, 30, { width: width / 2 });
    doc.fillColor(MUTED).fontSize(8.5).text(l.address ?? '', left + 46, doc.y, { width: width / 2 });
    const contact = [l.gstin && `GSTIN ${l.gstin}`, l.phone, l.email].filter(Boolean).join('\n');
    doc.fontSize(8.5).text(contact, right - 200, 34, { width: 200, align: 'right' });
    doc.moveTo(left, 86).lineTo(right, 86).lineWidth(0.8).strokeColor(LINE).stroke();

    // Title and meta
    doc.fillColor(BRAND).fontSize(20).text('Quotation', left, 98);
    doc.fillColor(issued ? MUTED : '#a8321f').fontSize(8.5).text(`${issued ? '' : 'DRAFT — NOT APPROVED FOR ISSUE · '}Version ${q.version}`, left, doc.y);
    const metaTop = 98;
    [['Quotation no.', q.quotation_number], ['Valid until', dateText(q.validUntil)], ['Place of supply', stateLabel(q.placeOfSupply)]].forEach(([k, v], i) => {
      doc.fillColor(MUTED).fontSize(7.5).text(k.toUpperCase(), right - 220, metaTop + i * 22, { width: 100 });
      doc.fillColor(INK).fontSize(9.5).text(v, right - 120, metaTop + i * 22 - 1, { width: 120, align: 'right' });
    });

    // Bill to
    let y = 172;
    doc.roundedRect(left, y, width, 64, 8).fill(SOFT);
    doc.fillColor(MUTED).fontSize(7.5).text('BILL TO', left + 14, y + 10);
    doc.fillColor(INK).fontSize(11).text(q.customer_name, left + 14, y + 22, { width: width - 28 });
    doc.fillColor(MUTED).fontSize(8.5).text([q.customerAddress, q.customerGstin && `GSTIN ${q.customerGstin}`].filter(Boolean).join(' · '), left + 14, doc.y + 1, { width: width - 28, height: 24, ellipsis: true });
    y += 82;

    // Table
    const cols = [{ k: 'n', label: '#', w: 22 }, { k: 'item', label: 'Item and description', w: 186 }, { k: 'hsn', label: 'HSN', w: 52 }, { k: 'qty', label: 'Qty', w: 58, right: true }, { k: 'rate', label: 'Unit rate', w: 72, right: true }, { k: 'gst', label: 'GST', w: 34, right: true }, { k: 'amount', label: 'Amount', w: width - 424, right: true }];
    const header = () => {
      doc.rect(left, y, width, 22).fill(BRAND);
      let x = left;
      for (const c of cols) { doc.fillColor('#ffffff').fontSize(8).text(c.label, x + 6, y + 6, { width: c.w - 12, align: c.right ? 'right' : 'left' }); x += c.w; }
      y += 22;
    };
    header();
    rows(q).forEach((r, i) => {
      const descHeight = doc.fontSize(8).heightOfString(r.description, { width: cols[1].w - 12 });
      const h = Math.max(30, 18 + descHeight);
      if (y + h > doc.page.height - 150) { doc.addPage(); y = 48; header(); }
      if (i % 2 === 1) doc.rect(left, y, width, h).fill('#f7f9f8');
      let x = left;
      const cells = { n: String(r.n), item: null, hsn: r.hsn, qty: r.qty, rate: r.rate, gst: r.gst, amount: r.amount };
      for (const c of cols) {
        if (c.k === 'item') { doc.fillColor(INK).fontSize(9).text(r.code, x + 6, y + 6, { width: c.w - 12 }); doc.fillColor(MUTED).fontSize(8).text(r.description, x + 6, doc.y, { width: c.w - 12 }); }
        else doc.fillColor(INK).fontSize(8.5).text(cells[c.k], x + 6, y + 7, { width: c.w - 12, align: c.right ? 'right' : 'left' });
        x += c.w;
      }
      y += h;
      doc.moveTo(left, y).lineTo(right, y).lineWidth(0.5).strokeColor(LINE).stroke();
    });

    // Totals and amount in words
    if (y > doc.page.height - 230) { doc.addPage(); y = 48; }
    y += 14;
    const totalsX = right - 210;
    doc.fillColor(MUTED).fontSize(7.5).text('AMOUNT IN WORDS', left, y);
    doc.fillColor(INK).fontSize(9).text(amountInWords(q.total), left, y + 12, { width: totalsX - left - 24 });
    for (const [k, v] of taxRows(q)) {
      doc.fillColor(MUTED).fontSize(9).text(k, totalsX, y, { width: 100 });
      doc.fillColor(INK).text(inr(v), totalsX + 90, y, { width: 120, align: 'right' });
      y += 16;
    }
    doc.roundedRect(totalsX - 8, y + 2, 218, 30, 6).fill(BRAND);
    doc.fillColor('#ffffff').fontSize(10).text('Total', totalsX, y + 11, { width: 80 });
    doc.fontSize(12).text(inr(q.total), totalsX + 60, y + 9, { width: 138, align: 'right' });
    y += 50;

    // Terms, notes, signature
    for (const [title, body] of [['Terms', q.terms], ['Notes', q.notes]]) {
      if (!body) continue;
      if (y > doc.page.height - 140) { doc.addPage(); y = 48; }
      doc.fillColor(BRAND).fontSize(10).text(title, left, y);
      doc.fillColor(INK).fontSize(8.5).text(body, left, doc.y + 2, { width });
      y = doc.y + 12;
    }
    if (y > doc.page.height - 120) { doc.addPage(); y = 48; }
    doc.fillColor(MUTED).fontSize(8).text('This is a quotation, not a tax invoice. Prices in INR; GST as shown.', left, y + 6, { width: width / 2 });
    doc.fillColor(INK).fontSize(9).text(`For ${l.name ?? ''}`, right - 200, y + 6, { width: 200, align: 'right' });
    doc.moveTo(right - 160, y + 52).lineTo(right, y + 52).lineWidth(0.6).strokeColor(MUTED).stroke();
    doc.fillColor(MUTED).fontSize(8).text('Authorised signatory', right - 200, y + 56, { width: 200, align: 'right' });

    // Draft watermark and page footers
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0; // footer and watermark sit outside the flow; never trigger a new page
      if (!issued) { doc.save(); doc.rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] }); doc.fillColor('#c0392b').opacity(0.07).fontSize(40).text('NOT APPROVED FOR ISSUE', -100, doc.page.height / 2 - 20, { width: doc.page.width + 200, align: 'center', lineBreak: false }); doc.restore(); doc.opacity(1); }
      doc.fillColor(MUTED).fontSize(7.5).text(`${q.quotation_number} · Page ${i + 1} of ${range.count}`, left, doc.page.height - 36, { width, align: 'right', lineBreak: false });
      doc.page.margins.bottom = bottom;
    }
    doc.end();
  });
}
