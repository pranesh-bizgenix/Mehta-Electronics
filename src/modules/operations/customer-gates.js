import {OperationsRepository} from './operations-repository.js';
import {conflict,forbidden,validationFailed} from '../../core/errors.js';
import {compareDecimal} from '../../core/schema.js';
import {writeAudit} from '../../db.js';
export async function bindFirstQuotationOwner(db,customerId,creatorId,actor){
 const customer=await db.prepare('SELECT owner_id FROM customers WHERE id=? FOR UPDATE').get(customerId);
 const salesperson=await db.prepare("SELECT id FROM users WHERE id=? AND role='EXECUTIVE' AND status='ACTIVE'").get(creatorId);
 if(!customer||customer.owner_id||!salesperson)return;
 await db.prepare('UPDATE customers SET owner_id=?,updated_by=?,updated_at=now() WHERE id=?').run(creatorId,actor.id,customerId);
 await writeAudit(db,{userId:actor.id,entity:'CUSTOMER',recordId:customerId,action:'FIRST_QUOTATION_OWNER_BOUND',oldValue:{ownerId:null},newValue:{ownerId:creatorId},reason:'First approved quotation sent; salesperson binding'});
}
export async function requireQuotableCustomer(db,customerId){
 const control=await new OperationsRepository(db).controls(customerId);
 if(control?.classification==='DO_NOT_QUOTE')throw conflict('This customer is marked Do Not Quote. Admin review must clear the restriction before preparing or sending a quotation.','DO_NOT_QUOTE');
}
export async function requireCustomerHandler(db,customerId,user){
 const customer=await db.prepare('SELECT owner_id FROM customers WHERE id=?').get(customerId);
 if(user?.role==='EXECUTIVE'&&customer?.owner_id&&customer.owner_id!==user.id)throw forbidden('This customer belongs to another salesperson. Ask Admin to reassign the customer.','CUSTOMER_ASSIGNED_ELSEWHERE');
}
export async function contractForLine(db,customerId,line,at){
 for(const value of [line.quantity,line.unitPrice,line.discountPercent??'0'])if(!/^\d{1,14}(?:\.\d{1,6})?$/.test(String(value)))throw validationFailed('Contract quantity, price and discount must be exact non-negative decimals.');
 const options=await db.prepare(`SELECT id,quantity::text AS quantity,unit_price::text AS unit_price FROM crm_customer_rate_contracts
 WHERE customer_id=? AND item_id=? AND status='APPROVED' AND valid_from<=?::date AND valid_to>=?::date`).all(customerId,line.itemId,at,at);
 const controls=await new OperationsRepository(db).controls(customerId);
 if(!options.length){if(controls?.pricing_class==='RATE_CONTRACT')throw conflict('No valid approved rate contract covers this item. Admin must confirm new terms; expired rates cannot be used.','RATE_CONTRACT_MISSING');return null;}
 const matching=options.filter(c=>compareDecimal(c.quantity,String(line.quantity))===0);
 if(matching.length!==1)throw conflict('Contract quantity is fixed. Choose the agreed quantity or request an independently approved contract.','RATE_CONTRACT_QUANTITY');
 const contract=matching[0];if(compareDecimal(contract.unit_price,String(line.unitPrice))!==0||compareDecimal(String(line.discountPercent??'0'),'0')!==0)throw conflict('Use the agreed net contract price without an additional discount.','RATE_CONTRACT_PRICE');
 return contract.id;
}
