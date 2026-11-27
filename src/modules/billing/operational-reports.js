import {hasPermission} from '../../rbac.js';
import {forbidden,validationFailed} from '../../core/errors.js';
import {collectionBalance,collectionAgeing} from '../accounts/collection-domain.js';
import {decimal,compare} from '../../../public/money.js';

export const OPERATIONAL_REPORTS={
 stock_evidence:{label:'Recorded stock availability evidence',permission:'items.read',financial:false},
 warehouse_ageing:{label:'Warehouse lot age and remaining custody',permission:'logistics.grn.read',financial:false},
 sales_losses:{label:'Lost sales opportunities and reasons',permission:'quotations.read',financial:false},
 receivables_ageing:{label:'Confirmed invoice balances and ageing',permission:'collections.read',financial:true}
};
export const operationalReportAccess=(actor,key)=>key!=='sales_losses'||hasPermission(actor,'enquiries.read');
export function receivableReportRow(row,asOf){
 try{
  for(const value of [row.amount,...row.receipts.map(x=>x.amount),...row.adjustments.map(x=>x.amount)])if(typeof value!=='string'||compare(decimal(value),decimal('0'))<0)throw Error('Invalid financial source');
  const balance=collectionAgeing(collectionBalance(row),row.due_date||null,asOf);
  return {reference:row.reference,customer_name:row.customer_name,status:row.status,invoice_date:row.invoice_date,due_date:balance.dueDate||'Not confirmed',original:balance.original,debit_notes:balance.debitNotes,credit_notes:balance.creditNotes,confirmed_paid:balance.paid,outstanding:balance.outstanding,days_overdue:balance.daysOverdue===null?'Not confirmed':String(balance.daysOverdue),bucket:balance.bucket};
 }catch{throw validationFailed('An invoice balance contains invalid amount or date evidence. Review the source invoice before exporting ageing.');}
}

export async function operationalReport(db,actor,key,filters){
 const {from,to,status}=filters,today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 if(!operationalReportAccess(actor,key))throw forbidden('Sales opportunity reporting also requires enquiry access.');
 if(to>today)throw validationFailed('Operational reports cannot claim future stock, loss or payment evidence.');
 const time="created_at>=?::date::timestamp AT TIME ZONE 'Asia/Kolkata' AND created_at<(?::date+1)::timestamp AT TIME ZONE 'Asia/Kolkata'",args=[from,to,status,status];
 if(key==='stock_evidence'){
  const rows=await db.prepare(`SELECT l.id AS reference,c.name AS company,i.part_code,i.uom,l.status,l.stock_in_hand::text AS recorded_on_hand,l.reserved_quantity::text AS recorded_reserved,l.free_quantity::text AS recorded_free,l.source_observed_at,l.created_at AS checked_at FROM (SELECT DISTINCT ON (company_id,item_id) * FROM stock_check_log WHERE NOT is_deleted AND ${time} AND (?::boolean OR created_by=?) ORDER BY company_id,item_id,created_at DESC,id DESC) l JOIN items i ON i.id=l.item_id JOIN tally_companies c ON c.id=l.company_id WHERE (?='' OR l.status=?) ORDER BY c.name,i.part_code,l.id LIMIT 1001`).all(from,to,hasPermission(actor,'users.read'),actor.id,status,status);
  return {rows,columns:['reference','company','part_code','uom','status','recorded_on_hand','recorded_reserved','recorded_free','source_observed_at','checked_at'],note:'Latest saved stock check per company/product within the selected check-date period. These are recorded source quantities, not a fresh live-stock check or authority to allocate. Unavailable quantities remain blank, not zero. Status is the status when the check was saved; inspect source time and perform a fresh check before committing stock. Restricted users see only their own checks. Units and companies are never combined.'};
 }
 if(key==='warehouse_ageing'){
  const rows=await db.prepare(`SELECT l.id AS reference,c.name AS company,i.part_code,l.uom,p.code AS location,l.batch_number,l.status,l.quantity::text AS received_quantity,COALESCE(a.reserved,0)::text AS reserved_quantity,COALESCE(a.consumed,0)::text AS dispatched_quantity,CASE WHEN l.status='AVAILABLE' THEN (l.quantity-COALESCE(a.reserved,0)-COALESCE(a.consumed,0))::text ELSE NULL END AS unallocated_quantity,GREATEST(0,(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date-(l.created_at AT TIME ZONE 'Asia/Kolkata')::date)::text AS days_since_custody,l.created_at AS custody_recorded_at FROM warehouse_receipt_lots l JOIN warehouse_locations p ON p.id=l.location_id JOIN tally_companies c ON c.id=l.company_id JOIN items i ON i.id=l.item_id LEFT JOIN LATERAL (SELECT sum(quantity) FILTER(WHERE status='RESERVED') AS reserved,sum(quantity) FILTER(WHERE status='CONSUMED') AS consumed FROM warehouse_pick_allocations WHERE lot_id=l.id) a ON true WHERE ${time.replaceAll('created_at','l.created_at')} AND (?='' OR l.status=?) ORDER BY l.created_at,l.id LIMIT 1001`).all(...args);
  return {rows,columns:['reference','company','part_code','uom','location','batch_number','status','received_quantity','reserved_quantity','dispatched_quantity','unallocated_quantity','days_since_custody','custody_recorded_at'],note:'Current CRM physical-custody balances for lots first recorded in the selected period, measured now rather than at the historical end date. Only independently verified AVAILABLE lots have an unallocated balance. Released picks do not consume stock. Lot age is time since custody recording; it is not product shelf age, last-sale age or a dead-stock classification. Tally stock, damaged returned goods and unrecorded opening stock are not silently added. No dead-stock threshold is assumed.'};
 }
 if(key==='sales_losses'){
  const rows=await db.prepare("SELECT o.id AS reference,c.name AS customer_name,u.name AS responsible_staff,o.title,o.stage AS status,o.expected_value::text AS expected_pipeline_value,o.close_reason,o.updated_at AS last_recorded_at FROM crm_customer_opportunities o JOIN customers c ON c.id=o.customer_id JOIN users u ON u.id=o.owner_id WHERE o.stage='LOST' AND o.updated_at>=?::date::timestamp AT TIME ZONE 'Asia/Kolkata' AND o.updated_at<(?::date+1)::timestamp AT TIME ZONE 'Asia/Kolkata' AND (?='' OR o.stage=?) AND (?::boolean OR o.owner_id=?) ORDER BY o.updated_at,o.id LIMIT 1001").all(...args,hasPermission(actor,'work.reassign'),actor.id);
  return {rows,columns:['reference','customer_name','responsible_staff','title','status','expected_pipeline_value','close_reason','last_recorded_at'],note:'Currently LOST customer opportunities last updated in the selected period, with saved closing reasons. Expected pipeline value is a recorded opportunity estimate, not lost invoiced revenue, realised margin or a historical stage-transition ledger. Reopened opportunities are excluded. Staff attribution follows the current responsible owner; restricted users see only their own records. Enquiry and quotation access are both required.'};
 }
 if(key==='receivables_ageing'){
  const rows=await db.prepare(`SELECT o.id,o.status,c.name AS customer_name,o.payload->>'invoiceNumber' AS reference,o.payload->>'invoiceDate' AS invoice_date,o.payload->>'amount' AS amount,
   COALESCE((SELECT a.payload->>'date' FROM crm_collection_arrangements a WHERE a.invoice_id=o.id AND a.kind='DUE_DATE' AND a.status='ACTIVE' ORDER BY a.created_at DESC,a.id LIMIT 1),(SELECT d.payload->'references'->>'dueDate' FROM billing_documents d WHERE d.invoice_reference_id=o.id AND d.status='ISSUED' ORDER BY d.created_at DESC,d.id LIMIT 1)) AS due_date,
   COALESCE((SELECT jsonb_agg(jsonb_build_object('amount',r.payload->>'amount')) FROM crm_operations r WHERE r.kind='RECEIPT' AND r.status='CONFIRMED' AND r.payload->>'invoiceId'=o.id::text AND (r.payload->>'paymentDate')::date<=?::date),'[]'::jsonb) AS receipts,
   COALESCE((SELECT jsonb_agg(jsonb_build_object('kind',a.kind,'amount',a.amount::text)) FROM crm_invoice_adjustments a WHERE a.invoice_id=o.id AND a.status='CONFIRMED' AND a.document_date<=?::date),'[]'::jsonb) AS adjustments
   FROM crm_operations o JOIN customers c ON c.id=o.customer_id WHERE o.kind='INVOICE' AND o.status<>'CANCELLED' AND (o.payload->>'invoiceDate')::date BETWEEN ?::date AND ?::date AND (?='' OR o.status=?) ORDER BY o.payload->>'invoiceDate',o.id LIMIT 1001`).all(to,to,...args);
  return {rows:rows.map(row=>receivableReportRow(row,to)),columns:['reference','customer_name','status','invoice_date','due_date','original','debit_notes','credit_notes','confirmed_paid','outstanding','days_overdue','bucket'],note:'Current independently confirmed invoice references dated within the selected range, with confirmed receipts and credit/debit notes whose payment/document date is no later than the end date. Not a historical database snapshot, bank reconciliation, full customer statement or Tally-certified opening balance. Earlier invoices outside this range are excluded. Only independently confirmed due-date changes or the issued invoice due date are used. Unknown due dates stay explicit; overpayments stay credit balances. Ageing uses the existing calendar-day 1–30, 31–60, 61–90 and over-90 buckets. No reminder or payment is sent.'};
 }
 throw validationFailed('Choose an operational report.');
}
