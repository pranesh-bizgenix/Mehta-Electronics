const scalar = value => value == null ? '' : typeof value === 'object' ? scalar(value['#text']) : String(value).trim();

/** Classify only explicit source types/flags; narration is never a document type. */
export function tallySalesDocumentKind(raw) {
  const type = scalar(raw.VOUCHERTYPENAME || raw['@_VCHTYPE']).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (/\b(enquiry|enquiries|inquiry|inquiries)\b/.test(type)) return 'enquiries';
  if (/\bquotation(?:\d+)?\b|\b(?:sales )?quote\b/.test(type)) return 'quotations';
  if (type === 'sales order' && /^(yes|true|1)$/i.test(scalar(raw.ISOPTIONAL))) return 'quotations';
  return null;
}

export function tallyVoucherMetadata(raw) {
  const get = key => scalar(raw[key]) || null;
  return {
    voucher_type: get('VOUCHERTYPENAME') || scalar(raw['@_VCHTYPE']) || null,
    voucher_number: get('VOUCHERNUMBER'), date: get('DATE'),
    party_name: get('PARTYLEDGERNAME') || get('PARTYNAME') || get('BASICBUYERNAME'),
    reference: get('REFERENCE'), narration: get('NARRATION'),
    is_optional: get('ISOPTIONAL'), is_cancelled: get('ISCANCELLED'),
    guid: get('GUID'), master_id: get('MASTERID'), alter_id: get('ALTERID'),
    voucher_status: /^yes$/i.test(get('ISCANCELLED') || '') ? 'CANCELLED' : /^yes$/i.test(get('ISDELETED') || '') ? 'DELETED' : /^yes$/i.test(get('ISOPTIONAL') || '') ? 'OPTIONAL' : 'RECORDED',
    document_total: suppliedTotal(raw)
  };
}

const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
const value = (raw, ...keys) => keys.map(key => scalar(raw?.[key])).find(Boolean) || null;
const descriptions = raw => array(raw?.['BASICUSERDESCRIPTION.LIST']).flatMap(r => array(r.BASICUSERDESCRIPTION)).map(scalar).filter(Boolean).join('\n') || value(raw, 'DESCRIPTION', 'BASICUSERDESCRIPTION');
const ledgerEntries = raw => array(raw['ALLLEDGERENTRIES.LIST'] || raw['LEDGERENTRIES.LIST']);
function suppliedTotal(raw) {
  const direct = value(raw, 'AMOUNT', 'TOTALAMOUNT');
  if (direct) return direct;
  const party = value(raw, 'PARTYLEDGERNAME', 'PARTYNAME');
  const entries = ledgerEntries(raw).filter(r => /^yes$/i.test(value(r, 'ISPARTYLEDGER') || '') || party && value(r, 'LEDGERNAME') === party);
  return entries.length === 1 ? value(entries[0], 'AMOUNT') : null;
}

/** Exact aggregation of delivered amounts. Never infer missing tax, discount or gross figures. */
export function sumDeliveredAmounts(values) {
  if (!values.length || values.some(v => v == null || !/^[+-]?\d+(?:\.\d+)?$/.test(v))) return null;
  const places = Math.max(...values.map(v => (v.split('.')[1] || '').length));
  const total = values.reduce((sum, v) => { const negative = v.startsWith('-'); const [whole, fraction = ''] = v.replace(/^[+-]/, '').split('.'); return sum + (negative ? -1n : 1n) * BigInt(whole + fraction.padEnd(places, '0')); }, 0n);
  const digits = (total < 0n ? -total : total).toString().padStart(places + 1, '0');
  return `${total < 0n ? '-' : ''}${places ? digits.slice(0, -places) + '.' + digits.slice(-places) : digits}`;
}

export function mapTallySalesDocument(raw) {
  const metadata = tallyVoucherMetadata(raw);
  const lines = array(raw['ALLINVENTORYENTRIES.LIST'] || raw['INVENTORYENTRIES.LIST']).map((r, index) => ({
    position: index + 1, stockItemName: value(r, 'STOCKITEMNAME'), stockItemId: value(r, 'STOCKITEMID', 'STOCKITEMGUID'),
    description: descriptions(r), actualQuantity: value(r, 'ACTUALQTY'), billedQuantity: value(r, 'BILLEDQTY'), unit: value(r, 'BASEUNITS', 'UNIT'),
    rate: value(r, 'RATE'), amount: value(r, 'AMOUNT'), grossAmount: value(r, 'GROSSAMOUNT'), netAmount: value(r, 'NETAMOUNT'),
    discountPercent: value(r, 'DISCOUNT', 'DISCOUNTPERCENT'), discountAmount: value(r, 'DISCOUNTAMOUNT'),
    hsn: value(r, 'HSNCODE', 'GSTHSNCODE'), gstRate: value(r, 'GSTRATE'),
    cgst: value(r, 'CGSTAMOUNT'), sgst: value(r, 'SGSTAMOUNT'), igst: value(r, 'IGSTAMOUNT'),
    accountingAllocations: array(r['ACCOUNTINGALLOCATIONS.LIST']).map(l => ({ ledgerName: value(l, 'LEDGERNAME'), amount: value(l, 'AMOUNT') })),
    taxDetails: array(r['RATEDETAILS.LIST']).map(t => ({ dutyHead: value(t, 'GSTRATEDUTYHEAD'), rate: value(t, 'GSTRATE'), valuationType: value(t, 'GSTRATEVALUATIONTYPE') }))
  }));
  const ledgers = ledgerEntries(raw).map(r => ({ ledgerName: value(r, 'LEDGERNAME'), amount: value(r, 'AMOUNT'), isPartyLedger: value(r, 'ISPARTYLEDGER'), isDeemedPositive: value(r, 'ISDEEMEDPOSITIVE'), billAllocations: array(r['BILLALLOCATIONS.LIST']).map(b => ({ name: value(b, 'NAME'), type: value(b, 'BILLTYPE'), amount: value(b, 'AMOUNT') })) }));
  return { ...metadata, kind: tallySalesDocumentKind(raw), buyerName: value(raw, 'BASICBUYERNAME'), partyLedgerId: value(raw, 'PARTYLEDGERID', 'PARTYLEDGERGUID'),
    address: array(raw['BASICBUYERADDRESS.LIST'] || raw['ADDRESS.LIST']).flatMap(r => array(r.BASICBUYERADDRESS || r.ADDRESS)).map(scalar).filter(Boolean),
    state: value(raw, 'STATENAME', 'BASICBUYERSTATE'), gstin: value(raw, 'PARTYGSTIN'), currency: value(raw, 'CURRENCYNAME'),
    totals: { subtotal: value(raw, 'SUBTOTAL'), totalDiscount: value(raw, 'TOTALDISCOUNT', 'DISCOUNTAMOUNT'), taxableAmount: value(raw, 'TAXABLEAMOUNT'), totalTax: value(raw, 'TAXAMOUNT', 'TOTALTAX'), roundOff: value(raw, 'ROUNDOFF'), grandTotal: suppliedTotal(raw), lineAmountTotal: sumDeliveredAmounts(lines.map(l => l.amount)) },
    lines, ledgers, note: 'Amounts and signs are preserved as delivered. Line amount total is an exact sum of delivered item amounts; it is not an inferred taxable subtotal. Blank figures were not supplied.' };
}
