import {selectedOrderCompany} from './tally-order-list.js';
import {parseCollection} from './tally-import.js';
import {tallyVoucherMetadata} from './tally-sales-documents.js';
import {validDate} from './crm-modules.js';
import {validationFailed} from './core/errors.js';
import {TallyVisibilityRepository} from './tally-visibility-repository.js';
const kinds={sales_orders:{type:'Sales Order',dataset:'salesOrdersXml'},purchase_orders:{type:'Purchase Order',dataset:'purchaseOrdersXml'}};
const cleanStatus=value=>typeof value==='string'&&value.trim()?value.trim().toUpperCase():'NOT_REPORTED';
const group=rows=>{const out={};for(const row of rows)out[row.status]=(out[row.status]??0)+1;return out;};
const sum=counts=>Object.values(counts).reduce((total,n)=>total+n,0);
const date=value=>value?.replaceAll('-','');
function scope(value){
 if(!value||typeof value!=='object')throw validationFailed('Specify scope: ALL_RETAINED or DATE_WINDOW with from/to dates.');
 if(value.mode==='ALL_RETAINED'&&value.from==null&&value.to==null)return {mode:'ALL_RETAINED'};
 if(value.mode==='DATE_WINDOW'&&validDate(value.from)&&validDate(value.to)&&value.from<=value.to)return {mode:'DATE_WINDOW',from:value.from,to:value.to};
 throw validationFailed('Use an explicit ALL_RETAINED scope or an ordered DATE_WINDOW with valid dates.');
}
export function compareOrderCounts(actual,expected,identities=null,identityMode='number'){
 const actualCounts=group(actual),statuses=[...new Set([...Object.keys(actualCounts),...Object.keys(expected)])].sort();
 const counts=statuses.map(status=>({status,controlDesk:actualCounts[status]??0,tally:expected[status]??0,difference:(actualCounts[status]??0)-(expected[status]??0)}));
 let missing=[],unexpected=[],statusDifferences=[],identityVerified=identities!==null;
 if(identities!==null){
  const key=row=>identityMode==='stable'?row.identity:row.number;
  const actualKeys=actual.map(key).filter(Boolean),expectedKeys=identities.map(key).filter(Boolean);
  if(new Set(actualKeys).size!==actualKeys.length||new Set(expectedKeys).size!==expectedKeys.length)identityVerified=false;
  const known=new Map();for(const row of actual){const id=key(row);if(!id){identityVerified=false;continue;}known.set(id,[...(known.get(id)??[]),row]);}
  for(const row of identities){const id=key(row);if(!id){identityVerified=false;continue;}const found=known.get(id)?.shift();if(!found)missing.push({number:row.number,identity:row.identity??null,status:row.status});else if(found.status!==row.status)statusDifferences.push({number:row.number,controlDesk:found.status,tally:row.status});}
  unexpected=[...known.values()].flat().map(row=>({number:row.number,status:row.status}));
 }
 const mismatch=counts.some(row=>row.difference!==0)||missing.length>0||unexpected.length>0||statusDifferences.length>0;
 return {outcome:mismatch?'MISMATCH':identityVerified?'PASS':'COUNTS_MATCH_NOT_IDENTITY_VERIFIED',counts,controlDeskTotal:actual.length,tallyTotal:sum(expected),missing,unexpected,statusDifferences,identityVerified};
}
export function manualOrderReference(body,companyId){
 if(!body||body.companyId!==companyId||body.complete!==true||!Array.isArray(body.datasets)||body.datasets.length!==2)throw validationFailed('Supply the selected companyId, complete:true and both sales_orders and purchase_orders datasets.');
 const selectedScope=scope(body.scope),datasets={};
 for(const entry of body.datasets){
  if(!kinds[entry?.kind]||datasets[entry.kind]||!Array.isArray(entry.counts)||!entry.counts.length||entry.counts.length>100)throw validationFailed('Each order type needs one dataset with explicit per-status counts.');
  const counts={};for(const row of entry.counts){if(typeof row?.status!=='string'||!row.status.trim()||row.status.length>80||!Number.isSafeInteger(row.count)||row.count<0||Object.hasOwn(counts,cleanStatus(row.status)))throw validationFailed('Statuses must be unique and counts must be non-negative whole numbers.');counts[cleanStatus(row.status)]=row.count;}
  if(!Number.isSafeInteger(sum(counts)))throw validationFailed('The total count exceeds the supported exact integer range.');
  let numbers=null;
  if(entry.vouchers!==undefined){
   if(!Array.isArray(entry.vouchers)||entry.vouchers.length>20000)throw validationFailed('Supply at most 20,000 voucher numbers per type.');
   numbers=entry.vouchers.map(row=>{if(typeof row?.number!=='string'||!row.number.trim()||row.number.length>200||typeof row.status!=='string'||!Object.hasOwn(counts,cleanStatus(row.status)))throw validationFailed('Every voucher needs a number and one of the supplied statuses.');return {number:row.number.trim(),status:cleanStatus(row.status)};});
   const listed=group(numbers);if(Object.keys(counts).some(status=>(listed[status]??0)!==counts[status]))throw validationFailed('The voucher list must agree with every per-status count.');
  }
  datasets[entry.kind]={counts,numbers};
 }
 return {scope:selectedScope,datasets};
}
export class OrderReconciliationRepository{
 constructor(db){this.db=db;}
 async latestRun(companyId){return this.db.prepare(`SELECT s.id,s.status,s.created_at,s.completed_at,s.sync_from::text AS sync_from,s.sync_to::text AS sync_to,s.import_summary,s.collection_metadata
 FROM tally_upload_sessions s WHERE EXISTS(SELECT 1 FROM tally_run_datasets d WHERE d.session_id=s.id AND d.company_id=?)
 ORDER BY s.created_at DESC,s.id DESC LIMIT 1`).get(companyId);}
 async current(companyId,selectedScope){
  const args=[companyId],window=selectedScope.mode==='DATE_WINDOW'?" AND summary_fields->>'/stored/date' BETWEEN ? AND ?":'';
  if(window)args.push(date(selectedScope.from),date(selectedScope.to));
  const rows=await this.db.prepare(`SELECT summary_fields->>'/stored/voucher_type' AS type,summary_fields->>'/stored/voucher_number' AS number,
   summary_fields->>'/stored/voucher_status' AS status,summary_fields->>'/stored/guid' AS guid,summary_fields->>'/stored/master_id' AS master_id
   FROM tally_visibility_current_cache WHERE company_id=? AND entity='vouchers' AND summary_fields->>'/stored/voucher_type' IN ('Sales Order','Purchase Order')${window} LIMIT 40001`).all(...args);
  if(rows.length>40000)throw validationFailed('More than 40,000 orders are in this scope. Compare a smaller date window.');
  return rows.map(row=>({...row,status:cleanStatus(row.status),identity:row.guid?`guid:${row.guid}`:row.master_id?`master:${row.master_id}`:null}));
 }
 async receipts(companyId,sessionId){return this.db.prepare('SELECT dataset,status,payload_count,imported_count,quarantined_count FROM tally_run_datasets WHERE company_id=? AND session_id=?').all(companyId,sessionId);}
 async payloads(companyId,sessionId){return this.db.prepare(`SELECT dataset,octet_length(content) AS bytes,CASE WHEN octet_length(content)<=8388608 THEN content ELSE NULL END AS content
 FROM tally_raw_payloads WHERE company_id=? AND session_id=? AND dataset IN ('salesOrdersXml','purchaseOrdersXml') ORDER BY received_at,id`).all(companyId,sessionId);}
}
export class OrderReconciliationService{
 constructor(db,{repository=new OrderReconciliationRepository(db)}={}){this.db=db;this.repository=repository;}
 async read(url,manual){return new TallyVisibilityRepository(this.db).transaction(()=>this.report(url,manual),{readOnly:true});}
 async report(url,manual){
  const company=await selectedOrderCompany(this.db,url),run=await this.repository.latestRun(company.id);
  const reference=manual===undefined?null:manualOrderReference(manual,company.id);
  const salesEvidence=run?.collection_metadata?.salesOrdersXml,purchaseEvidence=run?.collection_metadata?.purchaseOrdersXml;
  const matchingEvidence=salesEvidence?.mode==='DATE_WINDOW'&&purchaseEvidence?.mode==='DATE_WINDOW'&&salesEvidence.from===purchaseEvidence.from&&salesEvidence.to===purchaseEvidence.to;
  const selectedScope=reference?.scope??(matchingEvidence?scope({mode:'DATE_WINDOW',from:salesEvidence.from,to:salesEvidence.to}):run?scope({mode:'DATE_WINDOW',from:run.sync_from,to:run.sync_to}):{mode:'ALL_RETAINED'});
  const [all,actual,receipts,payloads]=await Promise.all([this.repository.current(company.id,{mode:'ALL_RETAINED'}),this.repository.current(company.id,selectedScope),run?this.repository.receipts(company.id,run.id):[],run?this.repository.payloads(company.id,run.id):[]]);
  const datasets=[];
  for(const [kind,definition]of Object.entries(kinds)){
   const rows=actual.filter(row=>row.type===definition.type),currentAll=group(all.filter(row=>row.type===definition.type));
   const receipt=receipts.find(row=>row.dataset===definition.dataset);let expected=reference?.datasets[kind],problem=null;
   if(!reference){
    const raw=payloads.filter(row=>row.dataset===definition.dataset);
    if(!receipt||!['imported','received_empty'].includes(receipt.status)||receipt.quarantined_count>0||raw.length!==1||!raw[0].content)problem='The latest delivered run has no complete, usable dedicated order payload. Upload or paste independent Tally counts.';
    else try{
     if(/<!DOCTYPE|<!ENTITY/i.test(raw[0].content)||!/<COLLECTION(?:\s|>)/i.test(raw[0].content))throw new Error();
     const vouchers=parseCollection(raw[0].content,'VOUCHER').map(tallyVoucherMetadata);
     if(vouchers.some(row=>row.voucher_type!==definition.type)||vouchers.length!==receipt.payload_count)throw new Error();
     if(vouchers.some(row=>!row.date||row.date<date(selectedScope.from)||row.date>date(selectedScope.to)))throw new Error();
     const numbers=vouchers.map(row=>({number:row.voucher_number,status:cleanStatus(row.voucher_status),identity:row.guid?`guid:${row.guid}`:row.master_id?`master:${row.master_id}`:null}));
     expected={counts:group(numbers),numbers};
    }catch{problem='The retained order payload, receipt count or declared date window could not be reconciled safely. Supply reviewed Tally counts.';}
   }
   const comparison=expected?compareOrderCounts(rows,expected.counts,expected.numbers,reference?'number':'stable'):null;
   datasets.push({kind,currentAllStatuses:currentAll,receipt:receipt??null,...(comparison??{outcome:'NOT_VERIFIED',counts:[],controlDeskTotal:rows.length,tallyTotal:null,missing:[],unexpected:[],statusDifferences:[],identityVerified:false}),note:problem});
  }
  return {company,readOnly:true,source:reference?'USER_SUPPLIED_TALLY_COUNTS':'LATEST_CONNECTOR_DELIVERED_XML',scope:selectedScope,run:run?{id:run.id,status:run.status,startedAt:run.created_at,completedAt:run.completed_at,from:run.sync_from,to:run.sync_to}:null,datasets,
   outcome:datasets.some(row=>row.outcome==='MISMATCH')?'MISMATCH':datasets.every(row=>row.outcome==='PASS')?'PASS':'NOT_VERIFIED',
   note:'Connector comparison covers its declared dedicated order window when reported, otherwise the upload run window; records outside it prevent verification. XML counts describe connector-delivered records, not an independent live Tally count. Statuses are imported voucher flags, not inferred fulfilment. Count-only matches never verify voucher identities.'};
 }
}
