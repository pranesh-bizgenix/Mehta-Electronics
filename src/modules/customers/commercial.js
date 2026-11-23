import {conflict} from '../../core/errors.js';
import {fingerprint} from '../../core/runtime.js';
import {decimal,compare,format} from '../../../public/money.js';
import {resolveQuotationLevel,pricingToday} from '../pricing/quotation-source.js';

export async function customerCommercialContext(db,customerId,companyId){
 const controls=await db.prepare('SELECT pricing_class,version FROM crm_customer_controls WHERE customer_id=?').get(customerId);
 const policy=companyId?await db.prepare('SELECT version,value FROM crm_customer_commercial_policies WHERE company_id=?').get(companyId):null;
 return {pricingClass:controls?.pricing_class??null,controlVersion:controls?.version??0,companyId:companyId??null,policyVersion:policy?.version??0,strategy:policy?.value.classes?.[controls?.pricing_class]??(controls?.pricing_class==='RATE_CONTRACT'?{strategy:'RATE_CONTRACT'}:null)};
}
export async function resolveCustomerPricing(db,customerId,companyId,line,at=pricingToday()){
 const context=await customerCommercialContext(db,customerId,companyId);
 if(!context.pricingClass)return {state:'UNCLASSIFIED',context};
 if(!context.strategy||!companyId&&context.strategy.strategy!=='RATE_CONTRACT')throw conflict('Customer pricing class has no confirmed company pricing strategy. Configure it in Customer 360.','CUSTOMER_PRICING_NOT_CONFIGURED');
 const {strategy,level}=context.strategy;
 await db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,73429932))').get(`${customerId}:${line.itemId}`);
 const agreements=await db.prepare("SELECT id,quantity::text AS quantity,unit_price::text AS unit_price FROM crm_customer_rate_contracts WHERE customer_id=? AND item_id=? AND status='APPROVED' AND NOT is_deleted AND valid_from<=?::date AND valid_to>=?::date").all(customerId,line.itemId,at,at);
 if(strategy==='MANUAL_REVIEW'&&!agreements.length)return {state:'MANUAL_REVIEW',context,fingerprint:fingerprint(context)};
 let unitPrice,source;
 if(strategy==='RATE_CONTRACT'||agreements.length){
  await db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,73429932))').get(`${customerId}:${line.itemId}`);
  const rows=await db.prepare("SELECT id,unit_price::text AS unit_price FROM crm_customer_rate_contracts WHERE customer_id=? AND item_id=? AND quantity=?::numeric AND status='APPROVED' AND NOT is_deleted AND valid_from<=?::date AND valid_to>=?::date").all(customerId,line.itemId,line.quantity,at,at);
  if(rows.length!==1)throw conflict('Exactly one approved customer contract must cover this item, quantity and date.','RATE_CONTRACT_MISSING');
  unitPrice=rows[0].unit_price;source={contractId:rows[0].id};
 }else{const resolved=await resolveQuotationLevel(db,level,line.itemId,line.quantity,at);unitPrice=resolved.unitPrice;source={level:resolved.level,fingerprint:resolved.fingerprint};}
 return {state:'RESOLVED',context,unitPrice,discountPercent:'0',source,fingerprint:fingerprint({context,itemId:line.itemId,quantity:format(decimal(line.quantity),6),unitPrice,source})};
}
export async function bindCustomerPricing(db,customerId,companyId,line,at=pricingToday()){
 const current=await resolveCustomerPricing(db,customerId,companyId,line,at);
 if(current.state==='UNCLASSIFIED'){if(line.customerPricing)throw conflict('Customer pricing class changed. Refresh pricing and revise the draft.','CUSTOMER_PRICING_CHANGED');return null;}
 if(current.state==='RESOLVED'&&(compare(decimal(line.unitPrice),decimal(current.unitPrice))!==0||compare(decimal(line.discountPercent??'0'),decimal('0'))!==0))throw conflict('Apply the approved customer net price without another discount.','CUSTOMER_NET_PRICE_REQUIRED');
 if(line.customerPricing&&line.customerPricing.fingerprint!==current.fingerprint)throw conflict('Refresh and apply the current customer pricing class before saving or approving.','CUSTOMER_PRICING_CHANGED');
 return {fingerprint:current.fingerprint,pricingClass:current.context.pricingClass,policyVersion:current.context.policyVersion,state:current.state};
}
