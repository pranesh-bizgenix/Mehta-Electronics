import {decimal,add,sub,compare,format} from '../../../public/money.js';
import {calendarDay} from '../sourcing/delivery-schedule.js';
import {validationFailed,conflict,forbidden} from '../../core/errors.js';
import {bankMoney} from './bank-domain.js';
export function receiptAllocations(amount,rows){
 const total=bankMoney(amount,{positive:true});if(!Array.isArray(rows)||!rows.length||rows.length>100)throw validationFailed('Allocate the payment to 1 to 100 invoices.');
 const ids=new Set();let allocated=decimal('0');const result=rows.map(row=>{if(ids.has(row.invoiceId))throw validationFailed('Select each invoice once.');ids.add(row.invoiceId);const value=bankMoney(row.amount,{positive:true});allocated=add(allocated,decimal(value));return {...row,amount:value};});
 if(compare(allocated,decimal(total))!==0)throw validationFailed('Invoice allocations must exactly equal the payment received.');return {amount:total,rows:result};
}
export function collectionBalance({amount,receipts=[],adjustments=[]}){
 const total=decimal(amount),paid=receipts.reduce((n,row)=>add(n,decimal(row.amount)),decimal('0')),credit=adjustments.filter(a=>a.kind==='CREDIT').reduce((n,a)=>add(n,decimal(a.amount)),decimal('0')),debit=adjustments.filter(a=>a.kind==='DEBIT').reduce((n,a)=>add(n,decimal(a.amount)),decimal('0')),adjusted=sub(add(total,debit),credit),outstanding=sub(adjusted,paid);
 return {original:format(total,6),debitNotes:format(debit,6),creditNotes:format(credit,6),adjusted:format(adjusted,6),paid:format(paid,6),outstanding:format(outstanding,6),overpaid:compare(outstanding,decimal('0'))<0};
}
export function collectionAgeing(balance,dueDate,asOf){calendarDay(asOf);const sign=compare(decimal(balance.outstanding),decimal('0'));if(sign<=0)return {...balance,dueDate:dueDate||null,daysOverdue:0,bucket:sign<0?'CREDIT_BALANCE':'SETTLED'};if(!dueDate)return {...balance,dueDate:null,daysOverdue:null,bucket:'DUE_DATE_NOT_CONFIRMED'};calendarDay(dueDate);const days=Math.floor((Date.parse(asOf)-Date.parse(dueDate))/86400000);return {...balance,dueDate,daysOverdue:Math.max(0,days),bucket:days<=0?'CURRENT':days<=30?'1_30':days<=60?'31_60':days<=90?'61_90':'OVER_90'};}
export function validateArrangement(kind,payload,outstanding){calendarDay(payload.date);if(kind==='DUE_DATE')return {date:payload.date};const amount=bankMoney(payload.amount,{positive:true});if(compare(decimal(amount),decimal(outstanding))>0)throw conflict('The promise or cheque exceeds the verified outstanding amount.');if(kind==='PDC'&&(!payload.chequeNumber?.trim()||!payload.bankName?.trim()))throw validationFailed('Record the cheque number and bank name.');return {date:payload.date,amount,...(kind==='PDC'?{chequeNumber:payload.chequeNumber.trim().toUpperCase(),bankName:payload.bankName.trim()}:{})};}
export function chequeClosure(row,{decision,actorId,evidence,receipt,today}){
 calendarDay(today);
 if(row.kind!=='PDC'||row.status!=='ACTIVE'||!['CLEARED','BOUNCED'].includes(decision))throw conflict('Only an active cheque can be cleared or marked bounced.');
 calendarDay(row.payload.date);
 if(today<row.payload.date)throw conflict('A post-dated cheque cannot be closed before its recorded date.');
 if(actorId===row.created_by)throw forbidden('Another authorised person must verify cheque closure.');
 if(typeof evidence!=='string'||evidence.trim().length<3)throw validationFailed('Record bank clearance or bounced-cheque evidence.');
 if(decision==='CLEARED'){
  if(!receipt||receipt.kind!=='RECEIPT'||receipt.status!=='CONFIRMED'||receipt.payload.invoiceId!==row.invoice_id||compare(decimal(receipt.payload.amount),decimal(row.payload.amount))!==0)throw conflict('Select the confirmed receipt matching this invoice and cheque amount exactly.');
  calendarDay(receipt.payload.paymentDate);
  if(receipt.payload.paymentDate<row.payload.date||receipt.payload.paymentDate>today)throw conflict('The receipt date must support clearance on or after the cheque date.');
 }
 return {status:decision,receiptId:decision==='CLEARED'?receipt.id:null};
}
export function assertIssuedInvoiceClosure({action,hasIssuedDocument,outstanding}){
 if(!hasIssuedDocument)return;
 if(action==='CANCEL')throw conflict('An issued invoice cannot be cancelled through its collection reference. Record verified billing adjustments through Accounts.');
 if(action==='RESOLVE'&&compare(decimal(outstanding),decimal('0'))>0)throw conflict('The issued invoice still has an outstanding balance. Keep its collection reference open for receipts.');
}
