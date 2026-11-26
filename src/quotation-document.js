import {lineNet,format,formatIndian} from '../public/money.js';
import {renderQuotationPdf} from './quotation-pdf-layout.js';
import {SUPPLIER_TERMS_LABEL} from './quotation-supplier-terms.js';

// Customer-facing quotation documents (print view and PDF).
// Whitelist of public fields only: item code, description, HSN, quantity, the
// net unit rate actually charged, GST and amounts. List price, discount, cost
// and margin never appear (client rule, 23 Oct). Private pricing never enters
// either renderer.

const escape = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ISSUED = ['APPROVED', 'SENT', 'WON'];
const STATES = { '27': 'Maharashtra', '33': 'Tamil Nadu', '29': 'Karnataka', '24': 'Gujarat', '07': 'Delhi', '36': 'Telangana', '37': 'Andhra Pradesh', '32': 'Kerala', '19': 'West Bengal', '09': 'Uttar Pradesh', '06': 'Haryana', '08': 'Rajasthan', '23': 'Madhya Pradesh', '03': 'Punjab', '21': 'Odisha', '10': 'Bihar', '20': 'Jharkhand', '22': 'Chhattisgarh', '30': 'Goa', '34': 'Puducherry' };
const stateLabel = (code) => STATES[code] ? `${STATES[code]} (${code})` : code;

/** Net unit rate after discount, rounded half-up to paise. */
function netRate(unitPrice,discountPercent) {
  return format(lineNet({quantity:'1',unit_price:unitPrice,discount_percent:discountPercent}));
}
function group(whole) { return whole.length <= 3 ? whole : `${whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${whole.slice(-3)}`; }
/** ₹12,34,567.00 from an exact decimal string. */
export function inr(value) { return `\u20b9${formatIndian(value)}`; }

const qty = (value) => { const [w, f = ''] = String(value).split('.'); const frac = f.replace(/0+$/, ''); return `${group(w)}${frac ? `.${frac}` : ''}`; };
const pct = (value) => `${String(value).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')}%`;
const dateText = (iso) => { const d = new Date(typeof iso==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(iso)?`${iso}T00:00:00+05:30`:iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }); };

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

export function quotationLineDescription(line) {
  const d=line.requestDetails??{};
  return [line.description,...[['Customer reference',d.sourceLine],['Tag',d.tag],['Make',d.make],['Customer requested specification',d.requestedSpecification],['Availability (quoted)',d.availability],['Availability checked on',d.availability?d.availabilityAsOf:null],['Delivery lead time from PO date',d.leadTime]].filter(([,value])=>value).map(([label,value])=>`${label}: ${value}`)].filter(Boolean).join('\n');
}
function rows(q) {
  return q.lines.map((l, i) => ({ n: i + 1, code: l.partCode, description: quotationLineDescription(l), hsn: l.hsn || '—', qty: `${qty(l.quantity)} ${l.uom}`, rate: inr(netRate(l.unitPrice, l.discountPercent)), gst: pct(l.taxPercent), amount: inr(l.net) }));
}
function taxRows(q) {
  const local = q.sellerState === q.placeOfSupply;
  return [['Taxable value', q.subtotal], ...(local ? [['CGST', q.cgst], [q.localTaxLabel || 'SGST', q.sgst]] : [['IGST', q.igst]])];
}

export function quotationPrintHtml(q) {
 const e=escape,m=quotationDocumentModel(q),draft=m.notice?' draft':'';
 const header=(section)=>`<header class="letterhead"><div class="brand"><img class="company-logo" src="/brand/mehta-logo.png" alt="Mehta company logo"><div><h1>${e(m.company.name)}</h1><p>${e(m.company.address)}</p><p>${e(m.company.contact)}</p><p>GSTIN: ${e(m.company.gstin||'[Not supplied]')}</p></div></div><p>${e(m.number)}<br>Version ${e(m.version)}</p></header><p class="section-label">${section}</p>${m.notice?`<p class="status">${e(m.notice)}</p>`:''}`;
 return `<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Quotation ${e(m.number)}</title><link rel="stylesheet" href="/quotation-print.css"></head><body>
 <div class="toolbar"><button id="print" type="button">Print or save as PDF</button></div>
 <article class="sheet${draft}">${header('01 / Cover &amp; Summary')}
 <section class="title"><h2>Supply quotation</h2></section>
 <section class="parties"><div><h3>Prepared for</h3><p class="strong">${e(m.customer.name)}</p><p class="multiline">${e(m.customer.address)}</p><p>GSTIN: ${e(m.customer.gstin)}</p><p>Contact: ${e(m.customer.contact)}</p></div>
 <dl class="meta">${[['Quotation no.',m.number],['Quotation date',m.date],['Valid until',m.validUntil],['Place of supply',m.placeOfSupply]].map(([label,value])=>`<div><dt>${label}</dt><dd>${e(value)}</dd></div>`).join('')}</dl></section>
 <section class="block"><h3>Customer RFQ / reference</h3><p>${e(m.reference)}</p></section>
 <section class="cover-total"><h3>Quotation total / INR</h3><p>${e(inr(q.total))}</p></section>
 <section class="block"><h3>Included in this quotation</h3><ul>${m.items.slice(0,4).map(item=>`<li>${e(item.code)} - ${e(item.description.split('\n')[0])}</li>`).join('')}</ul><p>Full quantities, specifications and GST are shown in the pricing schedule.</p></section>
 </article>
 <article class="sheet${draft}">${header('02 / Itemized Pricing &amp; Scope')}<section class="title"><h2>Pricing schedule</h2></section><p>Prices in INR. Unit rates are net of any applicable discount.</p>
 <table><thead><tr><th>#</th><th>Item and description</th><th>HSN</th><th class="num">Qty</th><th class="num">Unit rate</th><th class="num">GST</th><th class="num">Amount</th></tr></thead><tbody>
 ${rows(q).map(r=>`<tr><td class="idx">${r.n}</td><td class="item"><strong>${e(r.code)}</strong><span class="multiline">${e(r.description)}</span></td><td data-label="HSN">${e(r.hsn)}</td><td class="num" data-label="Qty">${e(r.qty)}</td><td class="num" data-label="Unit rate">${e(r.rate)}</td><td class="num" data-label="GST">${e(r.gst)}</td><td class="num" data-label="Amount">${e(r.amount)}</td></tr>`).join('')}
 </tbody></table><section class="summary"><p class="words"><span>Amount in words</span>${e(m.words)}</p><dl class="totals">${taxRows(q).map(([label,value])=>`<div><dt>${e(label)}</dt><dd>${e(inr(value))}</dd></div>`).join('')}<div class="grand"><dt>Total</dt><dd>${e(inr(q.total))}</dd></div></dl></section>
 ${m.quantityInstructions?`<section class="block"><h3>Quantity instructions - ${q.request?.quantityConfirmed?'reviewed':'review pending'}</h3><p class="multiline">${e(m.quantityInstructions)}</p></section>`:''}</article>
 <article class="sheet${draft}">${header('03 / Terms, Conditions &amp; Sign-Off')}<section class="title"><h2>Commercial terms</h2></section>
 <section class="block"><h3>Payment, delivery, warranty and exclusions</h3><p class="multiline">${e(m.terms||'[Commercial terms not supplied. Confirm payment, delivery, warranty and exclusions before issue.]')}</p></section>
 ${m.notes?`<section class="block"><h3>Notes</h3><p class="multiline">${e(m.notes)}</p></section>`:''}
 <section class="block"><h3>Supplier reference attachment</h3><p>${e(m.supplierTermsLabel)}</p><p><a href="/api/crm/quotation-supplier-terms" target="_blank" rel="noopener">Download original KGEP supplier terms</a></p></section>
 <div class="acceptance"><div class="sign"><span>For ${e(m.company.name)}</span><span>Authorised signatory</span></div><div><h3>Client acceptance / PO reference</h3><p>Name: _______________________</p><p>Signature: ____________________</p><p>Date: ________________________</p><p>PO reference: _________________</p></div></div>
 <footer><p>This is a quotation, not a tax invoice. Prices in INR; GST as shown.</p></footer></article>
 <script type="module" src="/quotation-print.js"></script></body></html>`;
}

// Keep all printable fields allowlisted; private pricing never enters the layout.
export function quotationDocumentModel(q) {
 const l=q.letterhead||{},missing='[Not supplied]';
 return {
  number:q.quotation_number||missing,version:String(q.version||1),
  company:{name:l.name||missing,address:l.address||missing,contact:[l.phone,l.email].filter(Boolean).join(' | '),gstin:l.gstin||missing},
  customer:{name:q.customer_name||missing,address:q.customerAddress||missing,gstin:q.customerGstin||missing,contact:q.customerContact||q.contact_email||missing},
  date:q.documentDate||q.created_at?dateText(q.documentDate||q.created_at):missing,validUntil:q.validUntil?dateText(q.validUntil):missing,
  placeOfSupply:q.placeOfSupply?stateLabel(q.placeOfSupply):missing,reference:q.request?.reference||missing,
  notice:q.request?.referenceOnly?'DRAFT - NOT APPROVED FOR ISSUE | DEVELOPMENT REFERENCE ONLY - HISTORICAL PRICING - NOT FOR CUSTOMER ISSUE':ISSUED.includes(q.status)?'':'DRAFT - NOT APPROVED FOR ISSUE',
  total:formatIndian(q.total),words:amountInWords(q.total),
  items:q.lines.map(line=>({code:line.partCode||missing,description:quotationLineDescription(line),hsn:line.hsn||missing,quantity:qty(line.quantity)+'\n'+(line.uom||''),rate:formatIndian(netRate(line.unitPrice,line.discountPercent)),gst:pct(line.taxPercent),amount:formatIndian(line.net)})),
  taxRows:taxRows(q).map(([label,value])=>[label,formatIndian(value)]),
  quantityInstructions:q.request?.quantityInstructions||'',quantityConfirmed:q.request?.quantityConfirmed===true,terms:q.terms||'',notes:q.notes||'',supplierTermsLabel:SUPPLIER_TERMS_LABEL
 };
}
export function quotationPdf(q,options={}) { return renderQuotationPdf(quotationDocumentModel(q),options); }
