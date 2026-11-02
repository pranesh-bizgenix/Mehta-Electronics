import {s,validate} from '../../core/schema.js';
import {conflict,forbidden,notFound,validationFailed} from '../../core/errors.js';
import {requireCustomerHandler} from './customer-gates.js';
export class ContractsRepository {
 constructor(db){this.db=db;}
 async customer(id){return this.db.prepare('SELECT id,status FROM customers WHERE id=?').get(id);}
 async item(id){return this.db.prepare("SELECT id FROM items WHERE id=? AND status='ACTIVE'").get(id);}
 async list(customerId){return this.db.prepare(`SELECT r.*,r.quantity::text AS quantity,r.unit_price::text AS unit_price,i.part_code,i.uom FROM crm_customer_rate_contracts r JOIN items i ON i.id=r.item_id WHERE customer_id=? ORDER BY created_at DESC,id`).all(customerId);}
 async create(customerId,b,actorId){return this.db.prepare(`INSERT INTO crm_customer_rate_contracts(customer_id,item_id,quantity,unit_price,valid_from,valid_to,reason,created_by) VALUES(?,?,?,?,?,?,?,?) RETURNING id`).get(customerId,b.itemId,b.quantity,b.unitPrice,b.validFrom,b.validTo,b.reason,actorId);}
 async record(id){return this.db.prepare('SELECT *,quantity::text AS quantity,unit_price::text AS unit_price FROM crm_customer_rate_contracts WHERE id=? FOR UPDATE').get(id);}
 async overlap(row){return this.db.prepare(`SELECT id FROM crm_customer_rate_contracts WHERE customer_id=? AND item_id=? AND quantity=?::numeric AND status='APPROVED'
 AND daterange(valid_from,valid_to,'[]') && daterange(?::date,?::date,'[]')`).get(row.customer_id,row.item_id,String(row.quantity),row.valid_from,row.valid_to);}
 async lockScope(row){await this.db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,73429932))').get(`${row.customer_id}:${row.item_id}`);}
 async decide(id,status,actorId,reason){await this.db.prepare('UPDATE crm_customer_rate_contracts SET status=?,approved_by=?,decision_reason=?,decided_at=now() WHERE id=?').run(status,actorId,reason,id);}
}
export class ContractsService {
 constructor(dependencies){Object.assign(this,dependencies);}
 async list(user,customerId){this.access.require(user,'customers.read');await requireCustomerHandler(this.db,customerId,user);if(!await this.repository.customer(customerId))throw notFound('Customer not found.');return this.repository.list(customerId);}
 async create(user,customerId,b){this.access.require(user,'contracts.manage');if(!await this.repository.customer(customerId)||!await this.repository.item(b.itemId))throw validationFailed('Choose an existing customer and active product.');
  if(b.validTo<b.validFrom||b.quantity==='0')throw validationFailed('Enter a positive fixed quantity and valid date range.');
  return this.transactions.run(user,b.reason,async()=>{const created=await this.repository.create(customerId,b,user.id);await this.audit.record({actorId:user.id,entity:'RATE_CONTRACT',recordId:created.id,action:'CREATE',newValue:{customerId,...b},reason:b.reason});return created;});}
 async decide(user,id,b){this.access.require(user,'contracts.approve');return this.transactions.run(user,b.reason,async()=>{const row=await this.repository.record(id);if(!row)throw notFound('Rate contract not found.');if(row.status!=='DRAFT')throw conflict('A completed contract decision cannot be changed.');if(row.created_by===user.id)throw forbidden('A different authorised person must approve the contract.');
  await this.repository.lockScope(row);if(b.decision==='APPROVED'&&await this.repository.overlap(row))throw conflict('An approved contract already covers the same customer, product, quantity and dates.');
  await this.repository.decide(id,b.decision,user.id,b.reason);await this.audit.record({actorId:user.id,entity:'RATE_CONTRACT',recordId:id,action:b.decision,newValue:{customerId:row.customer_id},reason:b.reason});return {id,status:b.decision};});}
}
export class ContractsController {
 constructor({contracts}){this.contracts=contracts;}
 routes(){const c=this.contracts;return [
  {method:'GET',path:'/api/v1/customers/:id/rate-contracts',permission:'customers.read',handler:async({user,params})=>({data:await c.list(user,validate(s.id(),Number(params.id)))})},
  {method:'POST',path:'/api/v1/customers/:id/rate-contracts',permission:'contracts.manage',idempotency:'required',body:s.object({itemId:s.id(),quantity:s.decimal({min:'0.000001'}),unitPrice:s.decimal({min:0}),validFrom:s.date(),validTo:s.date(),reason:s.reason()}),handler:async({user,params,body})=>({status:201,data:await c.create(user,validate(s.id(),Number(params.id)),body)})},
  {method:'POST',path:'/api/v1/rate-contracts/:id/decision',permission:'contracts.approve',body:s.object({decision:s.enum(['APPROVED','REJECTED']),reason:s.reason()}),handler:async({user,params,body})=>({data:await c.decide(user,validate(s.uuid(),params.id),body)})}
 ];}
}
