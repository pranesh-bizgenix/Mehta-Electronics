import {orderFlags} from '../flags.js';
import {parseOrderResponse} from '../parse.js';

const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const types={sales_orders:'Sales Order',purchase_orders:'Purchase Order'};
export function orderRequest({kind,companyName,from,to,afterAlterId='0',afterMasterId='0'}){
  if(!types[kind]||!companyName||![from,to].every(v=>/^\d{8}$/.test(v))||from>to)throw new Error('An entity, company and ordered YYYYMMDD date window are required.');
  if(![afterAlterId,afterMasterId].every(v=>/^\d{1,20}$/.test(String(v))))throw new Error('Invalid order cursor.');
  return `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>ControlDeskOrderShadow</ID></HEADER><BODY><DESC><STATICVARIABLES><SVCURRENTCOMPANY>${escape(companyName)}</SVCURRENTCOMPANY><SVFROMDATE>${from}</SVFROMDATE><SVTODATE>${to}</SVTODATE><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="ControlDeskOrderShadow"><TYPE>Voucher</TYPE><FETCH>*</FETCH><FILTER>ControlDeskOrderFilter</FILTER><SORT>Default : $MasterID</SORT></COLLECTION><SYSTEM TYPE="Formulae" NAME="ControlDeskOrderFilter">$VoucherTypeName = &quot;${types[kind]}&quot; AND $Date &gt;= $$Date:&quot;${from}&quot; AND $Date &lt;= $$Date:&quot;${to}&quot; AND $AlterID &gt; ${afterAlterId} AND $MasterID &gt; ${afterMasterId}</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;
}

/** Intentionally unregistered. A coordinator must hold a lease for the ENTIRE existing sync cycle. */
export async function dryRunOrders(kind,{env=process.env,coordinator,transport,windows,companyId,companyName,afterAlterId='0',delayMs=1000,signal}={}){
  if(!orderFlags(env)[kind])return {enabled:false,records:[],errors:[],writes:0};
  if(!coordinator?.withExclusiveSyncCycle)throw new Error('Whole-cycle sync coordination is required before reading Tally.');
  if(!transport?.request||!Array.isArray(windows)||windows.length===0)throw new Error('A reviewed transport and date windows are required.');
  if(!Number.isInteger(delayMs)||delayMs<250||delayMs>60000)throw new Error('Request delay must be 250–60000 ms.');
  return coordinator.withExclusiveSyncCycle(async()=>{
    const result={enabled:true,dryRun:true,records:[],errors:[],received:0,excluded:0,cancelled:0,writes:0,watermarkAdvanced:false};
    for(const [index,window] of windows.entries()){
      signal?.throwIfAborted();
      if(index)await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,delayMs);signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(signal.reason);},{once:true});});
      const xml=await transport.request(orderRequest({kind,companyName,...window,afterAlterId}),{signal});
      const batch=parseOrderResponse(xml,{kind,companyId});
      if(batch.received>200)throw new Error('Date window exceeds the 200-voucher review limit. Narrow the window; no data was written.');
      result.records.push(...batch.records);result.errors.push(...batch.errors);
      result.received+=batch.received;result.excluded+=batch.excluded;result.cancelled+=batch.cancelled;
    }
    return result;
  });
}
