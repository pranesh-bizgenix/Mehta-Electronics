import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveCustomerPricing,bindCustomerPricing} from '../src/modules/customers/commercial.js';

function contractSource({price='40.123456',pricingClass='RATE_CONTRACT',policyVersion=1,quantity='2'}={}){
 return {prepare:sql=>({get:async()=>sql.includes('crm_customer_controls')?{pricing_class:pricingClass,version:1}:sql.includes('commercial_policies')?{version:policyVersion,value:{classes:{RATE_CONTRACT:{strategy:'RATE_CONTRACT'}}}}:{},all:async(...args)=>sql.includes('quantity=?')?(args[2]===quantity?[{id:'contract-1',unit_price:price}]:[]):[{id:'contract-1',unit_price:price,quantity}]})};
}
test('contract pricing preserves six-decimal net rates and forbids another discount',async()=>{
 const db=contractSource(),line={itemId:1,quantity:'2',unitPrice:'40.123456',discountPercent:'0'};
 const value=await resolveCustomerPricing(db,1,'company',line,'2026-11-23');assert.equal(value.unitPrice,'40.123456');
 assert.equal((await bindCustomerPricing(db,1,'company',line,'2026-11-23')).state,'RESOLVED');
 for(const patch of [{unitPrice:'40.123455'},{discountPercent:'0.000001'}])await assert.rejects(bindCustomerPricing(db,1,'company',{...line,...patch},'2026-11-23'),{code:'CUSTOMER_NET_PRICE_REQUIRED'});
});
test('contract quantity mismatch and stale policy bindings fail closed',async()=>{
 const db=contractSource(),line={itemId:1,quantity:'2',unitPrice:'40.123456',discountPercent:'0'};
 const binding=await bindCustomerPricing(db,1,'company',line,'2026-11-23');
 await assert.rejects(bindCustomerPricing(db,1,'company',{...line,quantity:'3'},'2026-11-23'),{code:'RATE_CONTRACT_MISSING'});
 await assert.rejects(bindCustomerPricing(contractSource({policyVersion:2}),1,'company',{...line,customerPricing:binding},'2026-11-23'),{code:'CUSTOMER_PRICING_CHANGED'});
});
test('removing a pricing class cannot silently preserve its old authority',async()=>{
 const db=contractSource({pricingClass:null});
 await assert.rejects(bindCustomerPricing(db,1,'company',{itemId:1,quantity:'2',customerPricing:{fingerprint:'retained'}},'2026-11-23'),{code:'CUSTOMER_PRICING_CHANGED'});
 assert.equal(await bindCustomerPricing(db,1,'company',{itemId:1,quantity:'2'},'2026-11-23'),null);
});
for(const pricingClass of ['MEDIUM_DISCOUNT','DEALER_NETWORK','NEW'])test(pricingClass+' uses the configured approved price-level calculation',async()=>{
 const db={prepare:sql=>({all:async()=>[],get:async()=>{
  if(sql.includes('crm_customer_controls'))return {pricing_class:pricingClass,version:1};
  if(sql.includes('commercial_policies'))return {version:1,value:{classes:{[pricingClass]:{strategy:'PRICE_LEVEL',level:2}}}};
  if(sql.includes('FROM crm_price_levels'))return {id:2,label:'Synthetic level',meaning:{instructions:'Synthetic approved source'},configuration:{priceListId:10,calculation:'BOTH_DISCOUNTS'},status:'CONFIRMED',updated_at:'2026-11-01'};
  if(sql.includes('FROM crm_price_lists'))return {id:10,currency:'INR',effective_from:'2026-01-01',effective_to:'2026-12-31',discount_percent:'5'};
  if(sql.includes('FROM crm_price_list_items'))return {id:20,unit_price:'100.123456',discount_percent:'10',item_revision:'same',current_item_revision:'same',approved_uom:'NOS',current_uom:'NOS',approved_part_code:'SAMPLE',current_part_code:'SAMPLE'};
  return {};
 }})};
 const value=await resolveCustomerPricing(db,1,'company',{itemId:1,quantity:'1'},'2026-11-23');
 assert.equal(value.unitPrice,'85.605555');assert.equal(value.source.level,2);
 await assert.rejects(bindCustomerPricing(db,1,'company',{itemId:1,quantity:'1',unitPrice:value.unitPrice,discountPercent:'1'},'2026-11-23'),{code:'CUSTOMER_NET_PRICE_REQUIRED'});
});
