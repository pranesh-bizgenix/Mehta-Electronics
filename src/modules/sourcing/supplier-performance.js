import {decimal,add,mul,div,format,compare,lineNet} from '../../../public/money.js';
import {calendarDay} from './delivery-schedule.js';
import {hasPermission} from '../../rbac.js';
import {forbidden,validationFailed} from '../../core/errors.js';
import {renderPdf} from '../billing/pdf.js';
import {AuditRepository} from '../../core/runtime.js';
const zero=()=>decimal('0');
const percentage=(part,total)=>total?format(div(mul(decimal(String(part)),decimal('100')),decimal(String(total))),2):null;
export const SUPPLIER_PERFORMANCE_BASIS='Response timing uses the first saved supplier reply. Delivery measures posted accepted goods against the original PO final delivery date. Missing evidence is shown separately. Accepted value uses approved PO prices, excludes freight/GST and is before invoice adjustments. No weighted supplier grade or earned scheme rebate is inferred.';

export function supplierPerformance({vendor,invitations,replies,orders,receipts,to}){
 calendarDay(to);const cutoff=new Date(to+'T23:59:59.999+05:30');
 const sourceIssues=[],replyById=new Map();
 for(const reply of replies){const recorded=new Date(reply.created_at);if(!Number.isFinite(recorded.valueOf())||recorded>cutoff)continue;const first=replyById.get(reply.rfq_id);if(!first||recorded<new Date(first.created_at))replyById.set(reply.rfq_id,reply);}
 let responded=0,onTimeReplies=0,knownReplyDates=0,responseHours=0;
 for(const invite of invitations){const reply=replyById.get(invite.rfq_id);if(!reply)continue;responded++;
  const invitedAt=new Date(invite.created_at),recordedAt=new Date(reply.created_at);
  if(Number.isFinite(invitedAt.valueOf())&&Number.isFinite(recordedAt.valueOf())&&recordedAt>=invitedAt){responseHours+=(recordedAt-invitedAt)/3600000;knownReplyDates++;}else sourceIssues.push('Reply timing missing or inconsistent for RFQ '+invite.rfq_id);
  if(invite.replyBy&&Number.isFinite(Date.parse(invite.replyBy))&&Number.isFinite(recordedAt.valueOf())){
   const cutoff=new Date(invite.replyBy+'T23:59:59.999+05:30');if(recordedAt<=cutoff)onTimeReplies++;
  }
 }
 let completed=0,onTimeCompleted=0,receiptCount=0,damagedReceipts=0,acceptedValue=zero();const units=new Map(),byPo=new Map();
 for(const receipt of receipts){const values=byPo.get(receipt.supplier_po_id)||[];values.push(receipt);byPo.set(receipt.supplier_po_id,values);}
 for(const po of orders){
  const lines=new Map(po.payload.lines.map(line=>[line.lineKey,line]));if(lines.size!==po.payload.lines.length){sourceIssues.push('Ambiguous PO lines for '+po.id);continue;}
  const accepted=new Map();let completedOn=null;
  const sources=(byPo.get(po.id)||[]).filter(receipt=>receipt.status==='POSTED'&&!receipt.is_deleted&&receipt.payload.receivedDate<=to).sort((a,b)=>a.payload.receivedDate.localeCompare(b.payload.receivedDate)||a.id-b.id);
  for(const receipt of sources){let hasAccepted=false,hasDamage=false;calendarDay(receipt.payload.receivedDate);
   for(const item of receipt.payload.lines){const line=lines.get(item.poLineKey);if(!line){sourceIssues.push('Receipt line outside PO '+po.id);continue;}
    const qty=decimal(item.accepted),damage=decimal(item.rejected);if(qty.n<0n||damage.n<0n)throw validationFailed('Posted receipt quantities cannot be negative.');
    hasAccepted||=qty.n>0n;hasDamage||=damage.n>0n;accepted.set(item.poLineKey,add(accepted.get(item.poLineKey)||zero(),qty));
    const uom=line.uom,unit=units.get(uom)||{uom,accepted:zero(),rejected:zero()};unit.accepted=add(unit.accepted,qty);unit.rejected=add(unit.rejected,damage);units.set(uom,unit);
    acceptedValue=add(acceptedValue,lineNet({quantity:item.accepted,unit_price:line.unitPrice,discount_percent:line.discountPercent}));
   }
   if(hasAccepted)receiptCount++;if(hasDamage)damagedReceipts++;
   if(!completedOn&&po.payload.lines.every(line=>compare(accepted.get(line.lineKey)||zero(),decimal(line.quantity))>=0))completedOn=receipt.payload.receivedDate;
  }
  if(completedOn){completed++;if(completedOn<=po.payload.deliveryBy)onTimeCompleted++;}
 }
 return {vendorId:vendor.id,name:vendor.payload.name,invitations:invitations.length,responded,responseRate:percentage(responded,invitations.length),onTimeReplies,averageRecordedResponseHours:knownReplyDates?(responseHours/knownReplyDates).toFixed(2):null,knownReplyDates,
  orders:orders.length,completed,onTimeCompleted,onTimeCompletionRate:percentage(onTimeCompleted,orders.length),acceptedReceipts:receiptCount,damagedReceipts,acceptedValueExGst:format(acceptedValue,2),
  units:[...units.values()].map(unit=>({uom:unit.uom,accepted:format(unit.accepted,6),rejected:format(unit.rejected,6)})),sourceIssues,weightedScore:null};
}

export class SupplierPerformanceService{
 constructor({db}){this.db=db;this.audit=new AuditRepository(db);}
 async read(actor,query){
  if(!hasPermission(actor,'purchasing.read'))throw forbidden();
  const from=calendarDay(query.from),to=calendarDay(query.to),page=Number(query.page||1),search=String(query.search||'').trim();
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  if(to<from||to>today||Date.parse(to)-Date.parse(from)>366*86400000||!Number.isSafeInteger(page)||page<1||page>1000000||search.length>200)throw validationFailed('Choose a nonfuture supplier reporting window up to 366 days and a valid page.');
  const where="WHERE NOT is_deleted AND status<>'ARCHIVED' AND payload->>'name' ILIKE ?",pattern='%'+search+'%';
  const vendors=await this.db.prepare(`SELECT id,payload FROM crm_procurement_vendors ${where} ORDER BY payload->>'name',id LIMIT 25 OFFSET ?`).all(pattern,(page-1)*25);
  const {total}=await this.db.prepare(`SELECT count(*)::integer AS total FROM crm_procurement_vendors ${where}`).get(pattern),ids=vendors.map(v=>v.id);
  if(!ids.length)return {data:[],pagination:{page,pageSize:25,total},from,to,basis:SUPPLIER_PERFORMANCE_BASIS};
  const invited=await this.db.prepare("SELECT i.vendor_id,i.rfq_id,i.created_at,r.payload->>'replyBy' AS \"replyBy\" FROM crm_rfq_vendors i JOIN crm_rfqs r ON r.id=i.rfq_id WHERE i.vendor_id=ANY(?::integer[]) AND NOT i.is_deleted AND NOT r.is_deleted AND r.status<>'CANCELLED' AND (i.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ?::date AND ?::date LIMIT 5001").all(ids,from,to);
  const replies=invited.length?await this.db.prepare("SELECT vendor_id,rfq_id,created_at FROM crm_rfq_vendor_replies WHERE vendor_id=ANY(?::integer[]) AND rfq_id=ANY(?::integer[]) AND NOT is_deleted AND created_at<(?::date+1)::timestamp AT TIME ZONE 'Asia/Kolkata' LIMIT 5001").all(ids,[...new Set(invited.map(row=>row.rfq_id))],to):[];
  const orders=await this.db.prepare("SELECT id,vendor_id,payload FROM crm_supplier_pos WHERE vendor_id=ANY(?::integer[]) AND NOT is_deleted AND status IN ('ISSUED','PARTIALLY_RECEIVED','RECEIVED') AND (payload->>'deliveryBy')::date BETWEEN ?::date AND ?::date LIMIT 5001").all(ids,from,to);
  const receipts=orders.length?await this.db.prepare("SELECT id,supplier_po_id,status,is_deleted,payload FROM crm_grns WHERE supplier_po_id=ANY(?::integer[]) AND status='POSTED' AND NOT is_deleted ORDER BY id LIMIT 10001").all(orders.map(po=>po.id)):[];
  if(invited.length>5000||replies.length>5000||orders.length>5000||receipts.length>10000)throw validationFailed('This supplier report exceeds its evidence limit. Narrow the dates or supplier search; no rows were silently dropped.');
  return {data:vendors.map(vendor=>supplierPerformance({vendor,invitations:invited.filter(i=>i.vendor_id===vendor.id),replies:replies.filter(r=>r.vendor_id===vendor.id),orders:orders.filter(o=>o.vendor_id===vendor.id),receipts,to})),pagination:{page,pageSize:25,total},from,to,basis:SUPPLIER_PERFORMANCE_BASIS};
 }
 async pdf(actor,b){const report=await this.read(actor,b);if(typeof b.reason!=='string'||b.reason.trim().length<3)throw validationFailed('Provide a PDF access reason.');const bytes=await renderPdf({title:'Supplier performance',subtitle:`${report.from} to ${report.to} | Page ${report.pagination.page}`,sections:[{label:'Evidence basis',value:report.basis}],columns:[{label:'Supplier',fraction:.24},{label:'Replies / invited',fraction:.16},{label:'Completed / due',fraction:.17},{label:'On-time complete',fraction:.16},{label:'Accepted INR ex GST',fraction:.27}],rows:report.data.map(row=>[row.name,`${row.responded} / ${row.invitations}`,`${row.completed} / ${row.orders}`,row.onTimeCompletionRate===null?'No evidence':row.onTimeCompletionRate+'%',row.acceptedValueExGst])});await this.audit.record({actorId:actor.id,entity:'SUPPLIER_PERFORMANCE',recordId:report.from+'_'+report.to,action:b.preview?'PDF_PREVIEW':'PDF_DOWNLOAD',reason:b.reason,newValue:{page:report.pagination.page,rows:report.data.length}});return {bytes,filename:'supplier-performance.pdf'};}
}
