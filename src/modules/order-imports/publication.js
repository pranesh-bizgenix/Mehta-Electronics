import {randomUUID} from 'node:crypto';
import {conflict} from '../../core/errors.js';
import {businessKey} from './domain.js';

// The caller owns the existing audited transaction and import advisory lock.
// Bulk operations avoid a network round trip for every source schedule.
export async function publishOrderSnapshot(service,actor,batch,plan){
 const previous=[...plan.retire,...plan.mapped.flatMap(row=>row.current?[row.current]:[])];
 const previousBatches=[...new Set(previous.map(row=>row.batch_id))];
 if(previousBatches.length){
  const dates=await service.all('SELECT as_of_date::text AS as_of_date FROM crm_order_import_batches WHERE id=ANY(?::uuid[])',previousBatches);
  if(dates.some(row=>!row.as_of_date||row.as_of_date>batch.as_of_date))throw conflict('An older source snapshot cannot replace newer approved schedules.');
  await service.db.prepare("UPDATE customer_open_order_lines SET status='ARCHIVED' WHERE id=ANY(?::uuid[])").run([...new Set(previous.map(row=>row.active_line_id))]);
 }
 if(plan.retire.length)await service.db.prepare("UPDATE crm_order_schedule_registry SET status='ARCHIVED',version=version+1 WHERE customer_id=? AND company_id=? AND business_key=ANY(?::text[])").run(batch.customer_id,batch.company_id,plan.retire.map(row=>row.business_key));
 const published=plan.mapped.map(row=>({
  id:randomUUID(),rowId:row.id,sourceKey:row.source_key,businessKey:businessKey(row.effective),
  poNumber:row.effective.poNumber,partCode:row.effective.externalCode,
  requiredDate:row.effective.requiredDate,quantity:row.effective.openQuantity,uom:row.uom,
  status:row.effective.openQuantity==='0.000000'?'CLOSED':'UNMATCHED',fingerprint:row.publishFingerprint,
  raw:{importBatchId:batch.id,importRowId:row.id,sourceAsOf:batch.as_of_date,sourceFacts:row.effective,crmItemId:row.itemId,
   basis:'Quantity is customer-reported open scheduled demand. Original PO quantity and reported open balance remain source facts; physical dispatch is not inferred.'}
 }));
 await service.db.prepare('INSERT INTO customer_open_order_lines(id,import_id,customer_id,source_line_key,po_number,part_code,schedule_date,quantity,dispatched_quantity,uom,raw_row,status,created_by) SELECT r.id,?,?,r."sourceKey",r."poNumber",r."partCode",r."requiredDate",r.quantity,NULL,r.uom,r.raw,r.status,? FROM jsonb_to_recordset(?::text::jsonb) AS r(id uuid,"sourceKey" text,"poNumber" text,"partCode" text,"requiredDate" date,quantity numeric,uom text,raw jsonb,status text)').run(batch.schedule_import_id,batch.customer_id,actor.id,JSON.stringify(published));
 await service.db.prepare("INSERT INTO crm_order_schedule_registry(customer_id,company_id,business_key,active_line_id,batch_id,row_id,snapshot_fingerprint,created_by,updated_by) SELECT ?,?,r.\"businessKey\",r.id,?,r.\"rowId\",r.fingerprint,?,? FROM jsonb_to_recordset(?::text::jsonb) AS r(id uuid,\"rowId\" uuid,\"businessKey\" text,fingerprint text) WHERE true ON CONFLICT(customer_id,company_id,business_key) DO UPDATE SET status='ACTIVE',active_line_id=EXCLUDED.active_line_id,batch_id=EXCLUDED.batch_id,row_id=EXCLUDED.row_id,snapshot_fingerprint=EXCLUDED.snapshot_fingerprint,version=crm_order_schedule_registry.version+1").run(batch.customer_id,batch.company_id,batch.id,actor.id,actor.id,JSON.stringify(published));
 return {rows:published.length,retired:plan.retire.length,unchangedQuantities:plan.counts.unchanged};
}
