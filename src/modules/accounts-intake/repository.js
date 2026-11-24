export class AccountsIntakeRepository {
 constructor(db){this.db=db;}
 one(sql,...args){return this.db.prepare(sql).get(...args);}
 all(sql,...args){return this.db.prepare(sql).all(...args);}
 get(id,companyId,lock=false){return this.one(`SELECT * FROM crm_accounts_intakes WHERE id=? AND company_id=?${lock?' FOR UPDATE':''}`,id,companyId);}
 existing(companyId,emailId,providerId){return this.one('SELECT * FROM crm_accounts_intakes WHERE company_id=? AND (email_message_id=? OR provider_message_id=?) ORDER BY CASE WHEN email_message_id=? THEN 0 ELSE 1 END LIMIT 1',companyId,emailId,providerId,emailId);}
 contacts(email){return this.all("SELECT DISTINCT c.id,c.name FROM customer_contacts cc JOIN customers c ON c.id=cc.customer_id WHERE lower(trim(cc.email::text))=? AND cc.status='ACTIVE' AND NOT cc.is_deleted AND c.status='ACTIVE' AND NOT c.is_deleted ORDER BY c.id",email);}
 scopedInvoices(companyId,customerId,numbers){return this.all("SELECT DISTINCT d.id FROM billing_documents d LEFT JOIN crm_order_workflows w ON w.sales_order_id=d.sales_order_id WHERE d.customer_id=? AND d.status<>'CANCELLED' AND (d.payload->>'companyId'=? OR w.public_snapshot->>'companyId'=?) AND lower(trim(d.number))=ANY(?::text[]) ORDER BY d.id",customerId,companyId,companyId,numbers.map(n=>n.toLowerCase()));}
 async list(companyId,category,status,search,page){
  const where="WHERE i.company_id=? AND (?='' OR (?='ADJUSTMENTS' AND i.category IN ('CREDIT_NOTE','DEBIT_NOTE')) OR i.category=?) AND (?='' OR i.status=?) AND (coalesce(i.source->>'subject','')||' '||coalesce(i.source->>'sender','')||' '||coalesce(c.name,'')||' '||coalesce(i.source->'invoiceNumbers','[]'::jsonb)::text) ILIKE ? ESCAPE '\\'";
  const args=[companyId,category,category,category,status,status,'%'+search.replace(/[\\%_]/g,'\\$&')+'%'];
  const [data,count]=await Promise.all([this.all(`SELECT i.id,i.category,i.status,i.version,i.customer_id,i.invoice_document_id,i.finance_operation_id,i.assigned_to,i.created_at,i.source->>'subject' AS subject,i.source->>'sender' AS sender,i.source->>'summary' AS summary,c.name AS customer_name,u.name AS assigned_name FROM crm_accounts_intakes i LEFT JOIN customers c ON c.id=i.customer_id JOIN users u ON u.id=i.assigned_to ${where} ORDER BY i.created_at DESC,i.id LIMIT 25 OFFSET ?`,...args,(page-1)*25),this.one(`SELECT count(*)::integer AS n FROM crm_accounts_intakes i LEFT JOIN customers c ON c.id=i.customer_id ${where}`,...args)]);
  return {data,pagination:{page,pageSize:25,total:count.n,pages:Math.ceil(count.n/25)}};
 }
 events(id){return this.all('SELECT e.id,e.action,e.actor_id,e.reason,e.detail,e.created_at,u.name AS actor_name FROM crm_accounts_intake_events e LEFT JOIN users u ON u.id=e.actor_id WHERE e.intake_id=? ORDER BY e.id LIMIT 200',id);}
}
