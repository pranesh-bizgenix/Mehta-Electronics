import {calculateQuotation,scaled,money} from '../public/quotation-math.js';
export {amountInWords} from './quotation-document.js';
export function financialYear(date){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw new Error('Enter a valid document date.');
 const year=Number(date.slice(0,4))-(date.slice(5,7)<'04'?1:0);return `${year}-${String(year+1).slice(-2)}`;
}
export function documentNumber(prefix,year,sequence){
 if(typeof prefix!=='string'||! /^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$/.test(prefix)||!/^\d{4}-\d{2}$/.test(year)||BigInt(sequence)<1n||BigInt(sequence)>999999999n)throw new Error('Configure a valid prefix and numbering sequence.');
 return `${prefix}/${year}/${String(sequence).padStart(6,'0')}`;
}
export function validateDocumentYear(date,existingDate){
 const year=financialYear(date);if(existingDate&&year!==financialYear(existingDate))throw new Error('A numbered document cannot move to another financial year. Cancel the draft and create a new document.');return year;
}
export function validateDocumentPrefixes(rfq,po){if(rfq&&po&&rfq===po)throw new Error('Use distinct RFQ and PO prefixes so document numbers cannot collide.');}
export function purchaseDocumentTotals(lines,supplierState,buyerState,roundToRupee=false){
 if(!/^(0[1-9]|[12][0-9]|3[0-8])$/.test(supplierState)||buyerState!=='33')throw new Error('Confirm supplier state and Mehta Tamil Nadu state (33).');
 const totals=calculateQuotation(lines,supplierState,buyerState);
 const minor=scaled(totals.total)/10000n;
 if(minor>99999999999900n)throw new Error('Document amount exceeds supported limit.');
 const rounded=roundToRupee?((minor+50n)/100n)*100n:minor,delta=rounded-minor;
 return {...totals,unroundedTotal:totals.total,roundOff:`${delta<0n?'-':''}${money(delta<0n?-delta:delta)}`,total:money(rounded)};
}
