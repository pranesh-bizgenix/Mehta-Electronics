export class CustomerManagementRepository{
 constructor(db){this.db=db;}
 one(sql,...args){return this.db.prepare(sql).get(...args);}
 all(sql,...args){return this.db.prepare(sql).all(...args);}
 async customer(id,lock=false){return this.one(`SELECT c.*,c.credit_limit::text AS credit_limit,p.company_id,p.backup_owner_id FROM customers c LEFT JOIN crm_customer_profiles p ON p.customer_id=c.id WHERE c.id=? AND NOT c.is_deleted${lock?' FOR UPDATE OF c':''}`,id);}
 async addresses(ids){return this.all('SELECT * FROM crm_customer_addresses WHERE customer_id=ANY(?::integer[]) ORDER BY status,is_default DESC,label,id',ids);}
 async activities(ids,page){return this.all('SELECT a.*,u.name AS owner_name FROM crm_customer_activities a JOIN users u ON u.id=a.owner_id WHERE customer_id=ANY(?::integer[]) ORDER BY occurred_at DESC,a.id LIMIT 25 OFFSET ?',ids,(page-1)*25);}
 async opportunities(ids,page){return this.all('SELECT o.*,o.expected_value::text AS expected_value,u.name AS owner_name FROM crm_customer_opportunities o JOIN users u ON u.id=o.owner_id WHERE customer_id=ANY(?::integer[]) ORDER BY updated_at DESC,o.id LIMIT 25 OFFSET ?',ids,(page-1)*25);}
 async policy(companyId){return await this.one('SELECT * FROM crm_customer_commercial_policies WHERE company_id=?',companyId)??{company_id:companyId,version:0,value:{}};}
 async related(kind,id){const table={ENQUIRY:'enquiries',QUOTATION:'quotations',ORDER:'sales_orders'}[kind];return this.one(`SELECT id,customer_id,status FROM ${table} WHERE id=? AND NOT is_deleted`,id);}
 async user(id){return this.one("SELECT id FROM users WHERE id=? AND status='ACTIVE'",id);}
 async merges(customerId){return this.all('SELECT r.id,r.source_id,r.target_id,r.status,r.reason,r.version,r.created_by,r.created_at,r.decided_by,r.decided_at,r.decision_reason,s.name AS source_name,t.name AS target_name FROM crm_customer_merge_requests r JOIN customers s ON s.id=r.source_id JOIN customers t ON t.id=r.target_id WHERE r.source_id=? OR r.target_id=? ORDER BY r.created_at DESC LIMIT 50',customerId,customerId);}
 async history(ids,unions,{page=1,kind='ALL'}={}){
  if(!unions.length)return {data:[],pagination:{page,pageSize:25,total:0,pages:0}};
  const base=`WITH wanted AS (SELECT unnest(?::integer[]) AS id), records AS (${unions.join(' UNION ALL ')}) `;
  const where="WHERE (?='ALL' OR kind=?)";
  const count=await this.one(base+'SELECT count(*)::integer AS n FROM records '+where,ids,kind,kind);
  const data=await this.all(base+'SELECT * FROM records '+where+' ORDER BY created_at DESC,id DESC LIMIT 25 OFFSET ?',ids,kind,kind,(page-1)*25);
  return {data,pagination:{page,pageSize:25,total:count.n,pages:Math.ceil(count.n/25)}};
 }
}
