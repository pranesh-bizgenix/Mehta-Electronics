import {hasPermission} from '../../rbac.js';
import {forbidden,validationFailed} from '../../core/errors.js';
import {transaction,validDate} from '../../crm-modules.js';
import {writeAudit} from '../../db.js';
import {text} from './domain.js';
import {financeAccess} from './service.js';
import {renderPdf} from './pdf.js';
import {staffPerformance,PERFORMANCE_NOTE} from './performance.js';

export const REPORTS={
 quotations:{label:'Quotation register',permission:'quotations.read',financial:false},
 orders:{label:'Sales order quantities',permission:'orders.read',financial:false},
 support:{label:'Support and warranty register',permission:'operations.read',financial:false},
 collections:{label:'Collection case register',permission:'collections.read',financial:true},
 receipts:{label:'Confirmed receipt register',permission:'collections.read',financial:true},
 invoices:{label:'Invoice document register',permission:'collections.read',financial:true},
 tasks:{label:'Staff task register',permission:'tasks.read',financial:false},
 staff_performance:{label:'Staff performance',permission:'tasks.read',financial:false}
};
const performanceAccess=u=>['tasks.read','enquiries.read','quotations.read','orders.read','sales_intake.read'].every(p=>hasPermission(u,p));
export const reportCatalogue=u=>Object.entries(REPORTS).filter(([key,r])=>hasPermission(u,r.permission)&&(!r.financial||['OWNER','ACCOUNTS'].includes(u.role))&&(key!=='staff_performance'||performanceAccess(u))).map(([key,r])=>({key,label:r.label}));
export function reportFilters(b){
 if(!validDate(b.from)||!validDate(b.to)||b.from>b.to||Date.parse(b.to)-Date.parse(b.from)>366*86400000)throw validationFailed('Choose a valid date range of at most 366 days.');
 const status=text(b.status??'','Status',40,false);if(status&&!/^[A-Z_]+$/.test(status))throw validationFailed('Use an exact status, such as APPROVED.');
 return {from:b.from,to:b.to,status};
}
export async function reportData(db,u,key,b){
 const d=REPORTS[key];if(!d)throw validationFailed('Choose an available report.');if(!hasPermission(u,d.permission))throw forbidden();if(d.financial)financeAccess(u);
 const f=reportFilters(b),args=[f.from,f.to,f.status,f.status];let rows,columns;
 const dates="created_at >= ?::date::timestamp AT TIME ZONE 'Asia/Kolkata' AND created_at < (?::date+1)::timestamp AT TIME ZONE 'Asia/Kolkata' AND (?='' OR status=?)";
 if(key==='staff_performance'){
  if(f.status)throw validationFailed('Staff performance uses several workflows. Leave the status filter empty.');
  if(!hasPermission(u,'enquiries.read')||!hasPermission(u,'quotations.read')||!hasPermission(u,'orders.read')||!hasPermission(u,'sales_intake.read'))throw forbidden('Staff performance requires access to enquiries, quotations, orders and sales intake.');
  rows=await staffPerformance(db,u,f,hasPermission(u,'tasks.assign'));
  columns=['staff','enquiries','quoted_enquiries','enquiry_conversion','issued_quotes','ordered_quotes','order_conversion','responded_requests','unanswered_requests','average_response_minutes','tasks_due','tasks_on_time','on_time_tasks'];
 }else if(key==='quotations'){
  rows=await db.prepare(`SELECT quotation_number AS reference,customer_name,status,created_at FROM (SELECT q.quotation_number,c.name AS customer_name,q.status,q.created_at FROM quotations q JOIN customers c ON c.id=q.customer_id) r WHERE ${dates} ORDER BY created_at,reference LIMIT 1001`).all(...args);
  columns=['reference','customer_name','status','created_at'];
 }else if(key==='orders'){
  rows=await db.prepare(`SELECT reference,customer_name,status,ordered,supplied,pending FROM (SELECT o.order_number AS reference,c.name AS customer_name,COALESCE(w.status,o.status) AS status,o.created_at,COALESCE(sum(l.ordered_quantity),0)::text AS ordered,COALESCE(sum(l.fulfilled_quantity),0)::text AS supplied,COALESCE(sum(l.ordered_quantity-l.fulfilled_quantity),0)::text AS pending FROM sales_orders o JOIN customers c ON c.id=o.customer_id LEFT JOIN crm_order_workflows w ON w.sales_order_id=o.id LEFT JOIN sales_order_lines l ON l.sales_order_id=o.id AND l.status='ACTIVE' GROUP BY o.id,c.name,w.status) r WHERE ${dates} ORDER BY created_at,reference LIMIT 1001`).all(...args);columns=['reference','customer_name','status','ordered','supplied','pending'];
 }else if(['support','collections','receipts'].includes(key)){
  const kinds=key==='support'?['SUPPORT','WARRANTY','RETURN']:key==='collections'?['COLLECTION']:['RECEIPT'];
  const extra=key==='receipts'?" AND status='CONFIRMED'":'';
  rows=await db.prepare(`SELECT reference,customer_name,status,kind,${key==='support'?'title':'amount'} FROM (SELECT o.reference,c.name AS customer_name,o.status,o.kind,o.title,o.payload->>'amount' AS amount,o.created_at FROM crm_operations o LEFT JOIN customers c ON c.id=o.customer_id WHERE o.kind=ANY(?::text[])) r WHERE ${dates}${extra} ORDER BY created_at,reference LIMIT 1001`).all(kinds,...args);columns=['reference','customer_name','kind','status',key==='support'?'title':'amount'];
 }else if(key==='invoices'){
  rows=await db.prepare(`SELECT reference,customer_name,source,status,amount FROM (SELECT COALESCE(d.number,d.id::text) AS reference,c.name AS customer_name,d.source,d.status,d.payload->'totals'->>'total' AS amount,d.created_at FROM billing_documents d JOIN customers c ON c.id=d.customer_id) r WHERE ${dates} ORDER BY created_at,reference LIMIT 1001`).all(...args);columns=['reference','customer_name','source','status','amount'];
 }else{
  const all=hasPermission(u,'tasks.assign');
  rows=await db.prepare(`SELECT title,status,owner_name,due_at FROM (SELECT t.title,t.status,u.name AS owner_name,t.due_at,t.created_at FROM tasks t JOIN users u ON u.id=t.owner_user_id WHERE NOT t.is_deleted AND (?::boolean OR t.owner_user_id=? OR t.created_by=? OR t.backup_user_id=?)) r WHERE ${dates} ORDER BY created_at,title LIMIT 1001`).all(all,u.id,u.id,u.id,...args);columns=['title','status','owner_name','due_at'];
 }
 if(rows.length>1000)throw validationFailed('More than 1,000 rows match. Narrow the date or status filters; no incomplete PDF is exported.');
 return {key,title:d.label,filters:f,columns,rows:rows.map(r=>Object.fromEntries([...columns,...(key==='staff_performance'?['staff_id']:[])].map(c=>[c,r[c] instanceof Date?r[c].toISOString():String(r[c]??'')]))),count:rows.length,generatedAt:new Date().toISOString(),note:key==='staff_performance'?PERFORMANCE_NOTE:'CRM records only. Collection amounts are recorded case amounts, not reconciled Tally balances. Quantities may use different UoMs; they are not summed across orders.'};
}
export async function reportPdf(db,u,key,b){
 const reason=text(b.reason,'Export reason');
 return transaction(db,u,reason,async()=>{
  const data=await reportData(db,u,key,b);
  const performance=key==='staff_performance',pdfColumns=performance?['staff','measure','result']:data.columns,pdfRows=performance?data.rows.flatMap(r=>[[r.staff,'Enquiry to quotation',`${r.enquiry_conversion} (${r.quoted_enquiries} / ${r.enquiries})`],[r.staff,'Quotation to order',`${r.order_conversion} (${r.ordered_quotes} / ${r.issued_quotes})`],[r.staff,'First response',`${r.average_response_minutes} minutes; ${r.responded_requests} responses; ${r.unanswered_requests} unanswered`],[r.staff,'Tasks on time',`${r.on_time_tasks} (${r.tasks_on_time} / ${r.tasks_due})`]]):data.rows.map(r=>data.columns.map(c=>r[c]));
  if(pdfRows.length>1000)throw validationFailed('More than 1,000 PDF rows match. Narrow the reporting period; no partial report is exported.');
  const bytes=await renderPdf({title:data.title,subtitle:`${data.filters.from} to ${data.filters.to} | ${data.count} records`,sections:[{label:'Scope',value:`${data.note}\nStatus: ${data.filters.status||'All'} | Generated: ${data.generatedAt}` }],columns:pdfColumns.map(c=>({label:c.replaceAll('_',' '),fraction:1/pdfColumns.length})),rows:pdfRows});
  await writeAudit(db,{userId:u.id,entity:'CRM_REPORT',recordId:key,action:b.preview?'PDF_PREVIEW':'PDF_DOWNLOAD',reason,newValue:{filters:data.filters,count:data.count}});
  return {bytes,filename:`${key}-${data.filters.from}-${data.filters.to}.pdf`};
 });
}
