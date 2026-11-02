import {escapeLike} from '../../security.js';
export class OperationsRepository {
 constructor(db){this.db=db;}
 async user(id){return this.db.prepare("SELECT id,status FROM users WHERE id=? AND status='ACTIVE'").get(id);}
 async customer(id){return this.db.prepare("SELECT id,status,name FROM customers WHERE id=?").get(id);}
 async controls(id){return this.db.prepare('SELECT * FROM crm_customer_controls WHERE customer_id=?').get(id);}
 async saveControls(id,classification,creditExempt,reason,actor,pricingClass){return this.db.prepare(`INSERT INTO crm_customer_controls(customer_id,classification,credit_exempt,reason,updated_by,pricing_class) VALUES(?,?,?,?,?,?)
  ON CONFLICT(customer_id) DO UPDATE SET classification=EXCLUDED.classification,credit_exempt=EXCLUDED.credit_exempt,pricing_class=EXCLUDED.pricing_class,reason=EXCLUDED.reason,updated_by=EXCLUDED.updated_by,updated_at=now(),version=crm_customer_controls.version+1 RETURNING *`).get(id,classification,creditExempt,reason,actor,pricingClass);}
 async list(kind,{page=1,search='',status='',customerId=null}){
  const args=[kind,`%${escapeLike(search)}%`,`%${escapeLike(search)}%`,`%${escapeLike(search)}%`,status,status];
  const where="WHERE o.kind=? AND (o.title ILIKE ? ESCAPE '\\' OR o.reference ILIKE ? ESCAPE '\\' OR o.payload::text ILIKE ? ESCAPE '\\') AND (?='' OR o.status=?)"+(customerId?' AND o.customer_id=?':'');
  if(customerId)args.push(customerId);
  const total=(await this.db.prepare(`SELECT count(*) AS n FROM crm_operations o ${where}`).get(...args)).n;
  const data=await this.db.prepare(`SELECT o.*,c.name AS customer_name,u.name AS owner_name,b.name AS backup_name FROM crm_operations o LEFT JOIN customers c ON c.id=o.customer_id JOIN users u ON u.id=o.owner_id LEFT JOIN users b ON b.id=o.backup_id ${where} ORDER BY o.updated_at DESC,o.id LIMIT 25 OFFSET ?`).all(...args,(page-1)*25);
  return {data,pagination:{page,pageSize:25,total,pages:Math.ceil(total/25)}};
 }
 async record(id,{lock=false}={}){return this.db.prepare(`SELECT * FROM crm_operations WHERE id=?${lock?' FOR UPDATE':''}`).get(id);}
 async events(id){return this.db.prepare('SELECT e.*,u.name AS actor_name FROM crm_operation_events e JOIN users u ON u.id=e.actor_id WHERE record_id=? ORDER BY id DESC').all(id);}
 async original(channel,externalId){return this.db.prepare('SELECT * FROM crm_intake_originals WHERE channel=? AND external_id=?').get(channel,externalId);}
 async originalForRecord(id){return this.db.prepare('SELECT channel,external_id,sha256,original_text,created_at FROM crm_intake_originals WHERE record_id=?').get(id);}
 async retainOriginal(row,payload,hash){await this.db.prepare('INSERT INTO crm_intake_originals(record_id,channel,external_id,sha256,original_text) VALUES(?,?,?,?,?)').run(row.id,payload.channel,payload.externalId,hash,payload.originalText);}
 async insert(record){return this.db.prepare(`INSERT INTO crm_operations(kind,reference,title,customer_id,owner_id,backup_id,payload,due_at,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?::text::jsonb,?,?,?,?::timestamptz,?::timestamptz) RETURNING *`).get(record.kind,record.reference,record.title,record.customerId,record.ownerId,record.backupId,JSON.stringify(record.payload),record.dueAt,record.actorId,record.actorId,record.now,record.now);}
 async event(record,action,from,reason,actor,detail={}){await this.db.prepare('INSERT INTO crm_operation_events(record_id,action,from_status,to_status,version,reason,actor_id,detail) VALUES(?,?,?,?,?,?,?,?::text::jsonb)').run(record.id,action,from,record.status,record.version,reason,actor,JSON.stringify(detail));}
 async transition(row,status,actor,now,{response=false,closing=false}={}){return this.db.prepare(`UPDATE crm_operations SET status=?,version=version+1,updated_by=?,updated_at=?::timestamptz,
  first_response_at=CASE WHEN ?::boolean THEN COALESCE(first_response_at,?::timestamptz) ELSE first_response_at END,
  closed_at=CASE WHEN ?::boolean THEN ?::timestamptz ELSE NULL END WHERE id=? AND version=? RETURNING *`).get(status,actor,now,response,now,closing,now,row.id,row.version);}
 async revise(row,payload,actor,now){return this.db.prepare('UPDATE crm_operations SET payload=?::text::jsonb,version=version+1,updated_by=?,updated_at=?::timestamptz WHERE id=? AND version=? RETURNING *').get(JSON.stringify(payload),actor,now,row.id,row.version);}
 async lockKey(key){await this.db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,73429931))').get(key);}
 async confirmedTotal(invoiceId){return (await this.db.prepare("SELECT COALESCE(sum((payload->>'amount')::numeric),0)::text AS amount FROM crm_operations WHERE kind='RECEIPT' AND status='CONFIRMED' AND payload->>'invoiceId'=?").get(invoiceId)).amount;}
 async duplicateReceipt(invoiceId,reference){return this.db.prepare("SELECT id FROM crm_operations WHERE kind='RECEIPT' AND status<>'REJECTED' AND payload->>'invoiceId'=? AND payload->>'transactionReference'=?").get(invoiceId,reference);}
}
