import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {readCompany,pagination} from './tally-read-service.js';
import {isTallyFinancial} from './tally-visibility-service.js';
import {mapTallySalesDocument} from './tally-sales-documents.js';
import {tallyFreshness} from './tally-freshness.js';
import {cleanXml} from './tally-import.js';
import {validDate} from './crm-modules.js';
import {forbidden,validationFailed,notFound} from './core/errors.js';
const scalar=value=>value==null?null:typeof value==='object'?scalar(value['#text']):String(value).trim()||null;
const array=value=>value==null?[]:Array.isArray(value)?value:[value];
const field=(raw,...keys)=>keys.map(key=>scalar(raw?.[key])).find(Boolean)||null;
const financial=user=>{if(!isTallyFinancial(user))throw forbidden('Tally financial records require Owner or Accounts.');};
const exact=/^[+-]?\d{1,30}(?:\.\d{1,12})?$/;
export function normalizedTallyDate(value){
 if(!value)return null;if(/^\d{8}$/.test(value))value=`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6)}`;
 if(validDate(value))return value;
 const match=value.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/),months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
 if(!match)return null;const month=months.indexOf(match[2].toLowerCase())+1;if(!month)return null;
 const iso=`${match[3]}-${String(month).padStart(2,'0')}-${match[1].padStart(2,'0')}`;return validDate(iso)?iso:null;
}
function filters(url){
 const out={search:(url.searchParams.get('search')||'').trim().slice(0,200),cheque:(url.searchParams.get('cheque')||'').trim().slice(0,100),amount:url.searchParams.get('amount')||'',percentage:url.searchParams.get('percentage')||'',from:url.searchParams.get('from')||'',to:url.searchParams.get('to')||''};
 if(out.amount&&!exact.test(out.amount))throw validationFailed('Amount must be an exact decimal with up to 30 whole digits and 12 decimal places.');
 if(out.percentage&&!/^(?:\d{1,2}(?:\.\d{1,12})?|100(?:\.0{1,12})?)$/.test(out.percentage))throw validationFailed('Percentage must be an exact decimal from 0 to 100.');
 if(out.from&&!validDate(out.from)||out.to&&!validDate(out.to)||out.from&&out.to&&out.from>out.to)throw validationFailed('Choose a valid ordered date range.');
 return out;
}
export function financialVoucher(raw){
 const document=mapTallySalesDocument(raw),entries=array(raw['ALLLEDGERENTRIES.LIST']||raw['LEDGERENTRIES.LIST']);
 const banks=[...array(raw['BANKALLOCATIONS.LIST']),...entries.flatMap(entry=>array(entry['BANKALLOCATIONS.LIST']))].map(bank=>({instrumentNumber:field(bank,'INSTRUMENTNUMBER','CHEQUENUMBER','CHEQUENO'),instrumentDate:field(bank,'INSTRUMENTDATE','CHEQUEDATE'),transactionType:field(bank,'TRANSACTIONTYPE'),bankName:field(bank,'BANKNAME'),partyName:field(bank,'BANKPARTYNAME'),amount:field(bank,'AMOUNT')}));
 const directInstrument=field(raw,'INSTRUMENTNUMBER','CHEQUENUMBER','CHEQUENO');if(directInstrument)banks.unshift({instrumentNumber:directInstrument,instrumentDate:field(raw,'INSTRUMENTDATE','CHEQUEDATE'),transactionType:null,bankName:null,partyName:null,amount:null});
 const bills=entries.flatMap(entry=>array(entry['BILLALLOCATIONS.LIST']).map(bill=>({ledgerName:field(entry,'LEDGERNAME'),name:field(bill,'NAME'),type:field(bill,'BILLTYPE'),amount:field(bill,'AMOUNT'),sourceBillId:field(bill,'BILLID'),voucherGuid:field(bill,'VOUCHERGUID')})));
 return {document,banks:banks.map((row,index)=>({...row,position:index+1})),bills:bills.map((row,index)=>({...row,position:index+1}))};
}
async function relationships(db,companyId,partyName,partyId,bills){
 const ledgers=await db.prepare(`SELECT record_key,name,summary_fields->>'/stored/tally_guid' AS guid,summary_fields->>'/stored/master_id' AS master_id FROM tally_visibility_current_cache
  WHERE company_id=? AND entity='ledgers' AND ${partyId?"(summary_fields->>'/stored/tally_guid'=? OR summary_fields->>'/stored/master_id'=?)":'name=?'} LIMIT 2`).all(companyId,...(partyId?[partyId,partyId]:[partyName||'']));
 const ledger=ledgers.length===1&&(ledgers[0].guid||ledgers[0].master_id)?ledgers[0]:null;
 const customers=ledger?await db.prepare("SELECT c.id,c.name FROM tally_visibility_crm_links l JOIN customers c ON c.id=l.crm_id WHERE l.company_id=? AND l.entity='ledgers' AND l.record_key=? AND l.crm_kind='customer'").all(companyId,ledger.record_key):[];
 const customer=customers.length===1?{...customers[0],path:`/customers/${customers[0].id}`} : null;
 const invoices=[];
 for(const bill of bills){
  if(!bill.name&&!bill.voucherGuid){invoices.push({...bill,invoice:null});continue;}
  const candidates=await db.prepare(`SELECT c.record_key,c.summary_fields->>'/stored/voucher_number' AS number,c.summary_fields->>'/stored/guid' AS guid,c.summary_fields->>'/stored/master_id' AS master_id
   FROM tally_visibility_current_cache c JOIN tally_visibility_records r ON r.id=c.record_id AND r.company_id=c.company_id
   WHERE c.company_id=? AND c.entity='vouchers' AND (c.summary_fields->>'/stored/voucher_type' IN ('Sales','Purchase','Sales Invoice','Purchase Invoice') OR lower(COALESCE(r.fields->>'/xml/ISINVOICE/#text',r.fields->>'/xml/ISINVOICE',''))='yes')
   AND ${bill.voucherGuid?"c.summary_fields->>'/stored/guid'=?":"(c.summary_fields->>'/stored/voucher_number'=? OR c.summary_fields->>'/stored/reference'=?) AND c.summary_fields->>'/stored/party_name'=?"} LIMIT 2`).all(companyId,...(bill.voucherGuid?[bill.voucherGuid]:[bill.name,bill.name,ledger?.name||'']));
  const match=candidates.length===1&&(candidates[0].guid||candidates[0].master_id)?candidates[0]:null;
  invoices.push({...bill,invoice:match?{number:match.number,recordKey:match.record_key,path:`/tally/financial?companyId=${companyId}&open=${encodeURIComponent(match.record_key)}`} :null});
 }
 return {customer,sourceLedger:ledger?{recordKey:ledger.record_key,guid:ledger.guid,masterId:ledger.master_id}:null,invoices,
  note:'CRM links use an existing company-scoped stable ledger link. A Tally party reference is resolved only when its source ledger is unique and has a stable ID; CRM names are never matched. Invoice references remain unlinked when source identity is unavailable or ambiguous.'};
}
export class TallyFinancialReadService {
 constructor(db){this.db=db;}
 async vouchers(url,user){
  financial(user);const company=await readCompany(this.db,url),f=filters(url),{page,pageSize}=pagination(url),kind=url.searchParams.get('kind')||'receipts_payments',sourceType=(url.searchParams.get('type')||'').slice(0,200);
  if(!['receipts_payments','receipts','payments','all'].includes(kind))throw validationFailed('Choose receipts, payments or all source voucher types.');
  const where=["c.company_id=?","c.entity='vouchers'"],args=[company.id];
  const types=kind==='receipts_payments'?['Receipt','Payment']:kind==='receipts'?['Receipt']:kind==='payments'?['Payment']:[];
  if(types.length){where.push(`c.summary_fields->>'/stored/voucher_type' IN (${types.map(()=>'?').join(',')})`);args.push(...types);}
  if(sourceType){where.push("c.summary_fields->>'/stored/voucher_type'=?");args.push(sourceType);}
  if(f.search){where.push("(strpos(lower(COALESCE(c.summary_fields->>'/stored/voucher_number','')),lower(?))>0 OR strpos(lower(COALESCE(c.summary_fields->>'/stored/party_name','')),lower(?))>0 OR strpos(lower(COALESCE(c.summary_fields->>'/stored/reference','')),lower(?))>0)");args.push(f.search,f.search,f.search);}
  if(f.from){where.push("c.summary_fields->>'/stored/date'>=?");args.push(f.from.replaceAll('-',''));}if(f.to){where.push("c.summary_fields->>'/stored/date'<=?");args.push(f.to.replaceAll('-',''));}
  if(f.cheque){where.push("EXISTS(SELECT 1 FROM jsonb_each_text(r.fields) f WHERE f.key ~* '(INSTRUMENTNUMBER|CHEQUENUMBER|CHEQUENO)(/#text)?$' AND strpos(lower(f.value),lower(?))>0)");args.push(f.cheque);}
  if(f.amount){where.push("EXISTS(SELECT 1 FROM jsonb_each_text(r.fields) f WHERE f.key ~* '(AMOUNT|document_total)(/#text)?$' AND CASE WHEN trim(f.value) ~ '^[+-]?[0-9]{1,30}(\\.[0-9]{1,12})?$' THEN trim(f.value)::numeric END=?::numeric)");args.push(f.amount);}
  if(f.percentage){where.push("EXISTS(SELECT 1 FROM jsonb_each_text(r.fields) f WHERE f.key ~* '(^|/)(DISCOUNT|DISCOUNTPERCENT|GSTRATE|PERCENTAGE|PERCENT)(/#text)?$' AND CASE WHEN trim(f.value) ~ '^[0-9]{1,3}(\\.[0-9]{1,12})?[ ]*%?$' THEN trim(replace(f.value,'%',''))::numeric END=?::numeric)");args.push(f.percentage);}
  const from='FROM tally_visibility_current_cache c LEFT JOIN tally_visibility_records r ON r.id=c.record_id AND r.company_id=c.company_id',condition=where.join(' AND ');
  const total=(await this.db.prepare(`SELECT count(*) AS n ${from} WHERE ${condition}`).get(...args)).n;
  const rows=await this.db.prepare(`SELECT c.record_key,c.observed_at,c.summary_fields,r.raw_record ${from} WHERE ${condition} ORDER BY c.summary_fields->>'/stored/date' DESC NULLS LAST,c.record_key LIMIT ? OFFSET ?`).all(...args,pageSize,(page-1)*pageSize);
  const data=rows.map(row=>{const {document,banks}=financialVoucher(row.raw_record||{}),stored=key=>row.summary_fields[`/stored/${key}`];return {id:row.record_key,type:stored('voucher_type')||document.voucher_type,number:stored('voucher_number')||document.voucher_number,party:stored('party_name')||document.party_name,date:stored('date')||document.date,amount:document.document_total,status:stored('voucher_status')||document.voucher_status,instruments:banks.map(bank=>bank.instrumentNumber).filter(Boolean),observedAt:row.observed_at};});
  return {company,data,pagination:{page,pageSize,total,pages:Math.ceil(total/pageSize)},freshness:await tallyFreshness(this.db,company.id,['vouchersXml']),readOnly:true,
   note:'Receipt/Payment filters use exact source voucher types. Use All source types for custom vouchers. Amount matches any delivered amount exactly; percentage searches only supplied percentage fields, not an inferred paid percentage. Signs and decimals are preserved.'};
 }
 async voucher(url,key,user){
  financial(user);const company=await readCompany(this.db,url),row=await this.db.prepare(`SELECT c.record_key,c.observed_at,r.raw_record,r.payload_id FROM tally_visibility_current_cache c JOIN tally_visibility_records r ON r.id=c.record_id AND r.company_id=c.company_id WHERE c.company_id=? AND c.entity='vouchers' AND c.record_key=?`).get(company.id,key);
  if(!row)throw notFound('Financial voucher not found in the selected company.');
  const parsed=financialVoucher(row.raw_record),links=await relationships(this.db,company.id,parsed.document.party_name,parsed.document.partyLedgerId,parsed.bills);
  return {company,data:{id:row.record_key,observedAt:row.observed_at,...parsed,links,originalPayload:row.payload_id?`/api/v1/tally/retained/payloads/${row.payload_id}`:null},freshness:await tallyFreshness(this.db,company.id,['vouchersXml']),readOnly:true};
 }
 async outstanding(url,user){
  financial(user);const company=await readCompany(this.db,url),f=filters(url),{page,pageSize}=pagination(url),direction=url.searchParams.get('direction')||'receivable';
  if(f.cheque||f.percentage)throw validationFailed('Instrument and supplied-percentage filters apply to vouchers, not the bill outstanding report.');
  if(!['receivable','payable'].includes(direction))throw validationFailed('Choose receivable or payable bills.');
  const dataset=direction==='receivable'?'billsReceivableXml':'billsPayableXml';
  const source=await this.db.prepare(`SELECT c.observed_at,r.payload_id,p.content,octet_length(p.content) AS bytes FROM tally_visibility_current_cache c JOIN tally_visibility_records r ON r.id=c.record_id AND r.company_id=c.company_id JOIN tally_raw_payloads p ON p.id=r.payload_id AND p.company_id=c.company_id WHERE c.company_id=? AND c.entity='reports' AND c.record_key=? AND octet_length(p.content)<=16777216`).get(company.id,dataset);
  const parsed=source?parseOutstandingBills(source.content):{rows:[],verified:false,note:'No usable retained bill report is available. No zero outstanding balance is inferred.'};
  const all=parsed.rows.filter(row=>(!f.search||`${row.party||''} ${row.reference||''} ${row.sourceDate||''}`.toLowerCase().includes(f.search.toLowerCase()))&&(!f.amount||sameDecimal(row.closingAmount,f.amount))&&(!f.from||row.date&&row.date>=f.from)&&(!f.to||row.date&&row.date<=f.to));
  const data=[];for(const row of all.slice((page-1)*pageSize,page*pageSize)){const links=await relationships(this.db,company.id,row.party,null,[{name:row.reference,amount:row.closingAmount}]);data.push({...row,id:`${source.payload_id}:${row.position}`,customer:links.customer,invoice:links.invoices[0]?.invoice??null});}
  return {company,dataset,data,pagination:{page,pageSize,total:all.length,pages:Math.ceil(all.length/pageSize)},verified:parsed.verified,unparsedDates:parsed.rows.filter(row=>row.sourceDate&&!row.date).length,sourceObservedAt:source?.observed_at??null,originalPayload:source?`/api/v1/tally/retained/payloads/${source.payload_id}`:null,freshness:await tallyFreshness(this.db,company.id,[dataset]),readOnly:true,note:parsed.note};
 }
}
function sameDecimal(left,right){if(!left||!exact.test(left)||!exact.test(right))return false;const parts=value=>{const negative=value.startsWith('-'),[whole,fraction='']=value.replace(/^[+-]/,'').split('.');return {negative,whole,fraction};},a=parts(left),b=parts(right),places=Math.max(a.fraction.length,b.fraction.length),units=value=>BigInt(value.whole+value.fraction.padEnd(places,'0'))*(value.negative?-1n:1n);return units(a)===units(b);}

/** Tally report rows are interleaved BILLFIXED/BILLCL/BILLDUE/BILLOVERDUE nodes.
 * Preserve XML order; never zip unrelated arrays or infer an aggregate ledger balance. */
export function parseOutstandingBills(input){
 const xml=cleanXml(input);if(/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)throw validationFailed('The retained bill report XML is invalid; original data remains available.');
 const parsed=new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:true}).parse(xml),rows=[];
 const text=nodes=>array(nodes).map(node=>typeof node==='object'?node['#text']??'':node).join('').trim()||null;
 const walk=nodes=>{let current=null;const finish=()=>{if(!current)return;if(!current.deliveredClosing)throw validationFailed('A bill row has no corresponding source closing amount; report alignment is unverified.');delete current.deliveredClosing;rows.push(current);current=null;};
  for(const node of array(nodes)){
   if(!node||typeof node!=='object')continue;
   if(node.LINEERROR)throw validationFailed('Tally returned an error instead of bill-wise outstanding.');
   if(node.BILLFIXED){finish();const fields=Object.fromEntries(array(node.BILLFIXED).flatMap(part=>Object.entries(part).map(([key,value])=>[key,text(value)])));current={position:rows.length+1,reference:fields.BILLREF??null,party:fields.BILLPARTY??null,sourceDate:fields.BILLDATE??null,date:normalizedTallyDate(fields.BILLDATE),closingAmount:null,dueDate:null,overdue:null,deliveredClosing:false};continue;}
   const tag=['BILLCL','BILLDUE','BILLOVERDUE'].find(key=>Object.hasOwn(node,key));
   if(tag){if(!current||tag==='BILLCL'&&current.deliveredClosing)throw validationFailed('Bill report source columns are not aligned; no balances were guessed.');const value=text(node[tag]);if(tag==='BILLCL'){current.closingAmount=value;current.deliveredClosing=true;}else if(tag==='BILLDUE')current.dueDate=value;else current.overdue=value;continue;}
   for(const [key,children]of Object.entries(node))if(key!==':@'&&Array.isArray(children))walk(children);
  }finish();
 };walk(parsed);
 return {rows,verified:rows.length>0,note:rows.length?'Bill closing amounts, due dates and overdue values are preserved exactly from the retained Tally report. Report values are not recomputed from receipts or aggregate customer balances. Unparseable source dates remain visible and are excluded from date-range filters.':'No recognised bill rows were delivered. Zero outstanding is not inferred; inspect the original report.'};
}
