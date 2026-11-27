import {createHash} from 'node:crypto';
import {decimal,add,sub,compare,format} from '../../../public/money.js';
import {readPriceCsv} from '../pricing/tabular.js';
import {calendarDay} from '../sourcing/delivery-schedule.js';
import {validationFailed,conflict} from '../../core/errors.js';
const fail=message=>{throw validationFailed(message);};
export const BANK_COLUMNS=['transaction_date','value_date','direction','amount','balance','reference','narration'];
export function bankMoney(value,{signed=false,positive=false}={}){
 if(typeof value!=='string'||!(signed?/^-?\d{1,14}(?:\.\d{1,2})?$/:/^\d{1,14}(?:\.\d{1,2})?$/).test(value))fail('Bank values must be plain decimal text with at most two decimal places.');
 const n=decimal(value);if(positive&&compare(n,decimal('0'))<=0)fail('Bank transaction amounts must be positive.');return format(n,2);
}
export function bankStatementPlan({csv,openingBalance,closingBalance,order,today}){
 calendarDay(today);if(!['OLDEST_FIRST','NEWEST_FIRST'].includes(order))fail('Select the statement row order.');
 const opening=bankMoney(openingBalance,{signed:true}),closing=bankMoney(closingBalance,{signed:true}),table=readPriceCsv(csv);
 if(BANK_COLUMNS.some((key,i)=>table.rows[0]?.cells[i]?.text.trim()!==key)||table.rows[0].cells.length!==BANK_COLUMNS.length)fail('Use the displayed seven-column bank CSV template.');
 const input=table.rows.slice(1).filter(row=>row.cells.some(cell=>cell?.text.trim()));if(!input.length||input.length>10000)fail('A statement must contain 1 to 10,000 non-empty transaction rows.');
 const seen=new Set(),references=new Set();let running=decimal(opening),credits=decimal('0'),debits=decimal('0'),previousDate=null;
 const rows=(order==='NEWEST_FIRST'?[...input].reverse():input).map(row=>{
  if(row.cells.length!==BANK_COLUMNS.length||row.cells.some(cell=>cell.formula))fail('Every bank row must contain seven literal values.');
  const raw=Object.fromEntries(BANK_COLUMNS.map((key,i)=>[key,row.cells[i].text.trim()]));
  const date=calendarDay(raw.transaction_date),valueDate=raw.value_date?calendarDay(raw.value_date):null;
  if(date>today||valueDate&&valueDate>today)fail('Future bank transactions cannot be reconciled.');if(previousDate&&date<previousDate)fail('Statement dates do not follow the selected row order.');previousDate=date;
  if(!['DEBIT','CREDIT'].includes(raw.direction))fail('Use DEBIT or CREDIT for each transaction.');
  if(raw.reference.length>200||raw.narration.length>2000)fail('Bank reference or narration is too long.');
  if([raw.reference,raw.narration].some(value=>/^[=+@\t]/.test(value)))fail('Formula-like bank references or narration require a literal-text source review.');
  const amount=bankMoney(raw.amount,{positive:true}),balance=bankMoney(raw.balance,{signed:true}),n=decimal(amount);
  running=raw.direction==='CREDIT'?add(running,n):sub(running,n);if(compare(running,decimal(balance))!==0)fail('Running balance does not reconcile at source row '+row.number+'.');
  if(raw.direction==='CREDIT')credits=add(credits,n);else debits=add(debits,n);
  const key=createHash('sha256').update(JSON.stringify([date,valueDate,raw.direction,amount,balance,raw.reference,raw.narration])).digest('hex');
  if(seen.has(key)||raw.reference&&references.has(raw.reference.toUpperCase()))fail('Duplicate transaction or reference in the statement requires review.');seen.add(key);if(raw.reference)references.add(raw.reference.toUpperCase());
  return {sourceRow:row.number,key,date,valueDate,direction:raw.direction,amount,balance,reference:raw.reference||null,narration:raw.narration,raw};
 });
 if(compare(running,decimal(closing))!==0)fail('Closing balance differs from the statement transactions.');
 return {rows,openingBalance:opening,closingBalance:closing,credits:format(credits,2),debits:format(debits,2),count:rows.length,from:rows[0].date,to:rows.at(-1).date,order};
}
export function bankMatchCapacity({line,operation,statementMatched='0',operationMatched='0',amount,companyId}){
 const value=bankMoney(amount,{positive:true});
 if(line.account_status!=='ACTIVE'||line.import_status!=='APPROVED'||!['UNMATCHED','PARTIALLY_MATCHED'].includes(line.status))throw conflict('Only an approved, unmatched transaction from an active bank account can be reconciled.');
 if(operation.status!=='CONFIRMED'||!((operation.kind==='RECEIPT'&&line.direction==='CREDIT')||(operation.kind==='VENDOR_PAYMENT'&&line.direction==='DEBIT')))throw conflict('Match a customer credit to a confirmed receipt, or a supplier debit to a confirmed supplier payment.');
 if(!operation.company_id||operation.company_id!==companyId)throw conflict('The confirmed receipt or supplier payment must belong to this bank account company.');
 if(compare(decimal(value),sub(decimal(line.amount),decimal(statementMatched)))>0||compare(decimal(value),sub(decimal(operation.payload.amount),decimal(operationMatched)))>0)throw conflict('Match exceeds the remaining statement or confirmed receipt amount.');
 if(line.reference&&operation.payload.transactionReference&&line.reference.trim().toUpperCase()!==operation.payload.transactionReference.trim().toUpperCase())throw conflict('Bank and receipt transaction references differ.');
 return value;
}
