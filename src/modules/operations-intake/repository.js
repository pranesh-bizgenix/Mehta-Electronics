export class OperationsIntakeRepository {
 constructor(db){this.db=db;}
 one(sql,...v){return this.db.prepare(sql).get(...v);}
 all(sql,...v){return this.db.prepare(sql).all(...v);}
 get(id,companyId,lock=false){return this.one(`SELECT * FROM crm_operations_intakes WHERE id=? AND company_id=?${lock?' FOR UPDATE':''}`,id,companyId);}
 existing(companyId,emailId){return this.one('SELECT * FROM crm_operations_intakes WHERE company_id=? AND email_message_id=?',companyId,emailId);}
 contacts(email){return this.all("SELECT DISTINCT c.id,c.name FROM customer_contacts cc JOIN customers c ON c.id=cc.customer_id WHERE lower(trim(cc.email))=? AND cc.status='ACTIVE' AND NOT cc.is_deleted AND c.status='ACTIVE' AND NOT c.is_deleted ORDER BY c.id",email);}
 orders(companyId,customerId,po){return this.all("SELECT o.id,w.version FROM sales_orders o JOIN crm_order_workflows w ON w.sales_order_id=o.id WHERE o.customer_id=? AND NOT o.is_deleted AND w.public_snapshot->>'companyId'=? AND lower(trim(o.customer_po_number))=lower(trim(?)) ORDER BY o.id",customerId,companyId,po);}
 list(companyId,kind,status,page,actorId){
  const where="WHERE i.company_id=? AND i.kind=? AND (?='' OR i.status=?) AND (?::integer IS NULL OR i.assigned_to=? OR i.backup_owner_id=?)",v=[companyId,kind,status,status,actorId,actorId,actorId];
  return Promise.all([this.all(`SELECT i.id,i.kind,i.status,i.version,i.sales_order_id,i.purchase_request_id,i.customer_id,i.assigned_to,i.created_at,i.source->>'subject' AS subject,i.source->>'summary' AS summary,c.name AS customer_name,u.name AS assigned_name FROM crm_operations_intakes i LEFT JOIN customers c ON c.id=i.customer_id JOIN users u ON u.id=i.assigned_to ${where} ORDER BY i.created_at DESC,i.id LIMIT 25 OFFSET ?`,...v,(page-1)*25),this.one(`SELECT count(*)::integer AS n FROM crm_operations_intakes i ${where}`,...v)]).then(([data,count])=>({data,pagination:{page,pageSize:25,total:count.n,pages:Math.ceil(count.n/25)}}));
 }
 events(id){return this.all('SELECT e.id,e.action,e.actor_id,e.reason,e.detail,e.created_at,u.name AS actor_name FROM crm_operations_intake_events e LEFT JOIN users u ON u.id=e.actor_id WHERE intake_id=? ORDER BY e.id LIMIT 200',id);}
 async event(row,actor,action,reason,detail={},credentialId=null){await this.db.prepare('INSERT INTO crm_operations_intake_events(intake_id,action,actor_id,credential_id,reason,detail) VALUES(?,?,?,?,?,?::text::jsonb)').run(row.id,action,actor?.id??null,credentialId,reason,JSON.stringify(detail));}
}
