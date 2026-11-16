import {s,validate} from '../../core/schema.js';
import {conflict,forbidden,validationFailed} from '../../core/errors.js';
import {fingerprint} from '../../core/runtime.js';
import {decimal,mul,div,sub,format,compare} from '../../../public/money.js';
const calculations=['LIST_ONLY','LINE_DISCOUNT','LIST_DISCOUNT','BOTH_DISCOUNTS'];
const settings=s.object({label:s.string({min:1,max:100}),instructions:s.string({min:3,max:2000}),priceListId:s.id(),calculation:s.enum(calculations)});
const levelNumber=value=>validate(s.int({min:1,max:3}),value,'level');
const revision=row=>row?fingerprint({id:row.id,label:row.label,meaning:row.meaning,configuration:row.configuration,status:row.status,updated_at:row.updated_at}):null;
export class PriceLevelRepository {
 constructor(db){this.db=db;}
 async all(){return this.db.prepare('SELECT *,updated_at::text AS updated_at FROM crm_price_levels ORDER BY level_number').all();}
 async record(level,lock=false){return this.db.prepare(`SELECT *,updated_at::text AS updated_at FROM crm_price_levels WHERE level_number=?${lock?' FOR UPDATE':''}`).get(level);}
 async list(id){return this.db.prepare(`SELECT p.*,p.discount_percent::text AS discount_percent,p.effective_from::text AS effective_from,p.effective_to::text AS effective_to FROM crm_price_lists p
 WHERE p.id=? AND p.status='ACTIVE' AND NOT p.is_deleted AND EXISTS(SELECT 1 FROM crm_price_import_workflows w WHERE w.target_list_id=p.id AND w.status='ACTIVATED' AND NOT w.is_deleted)`).get(id);}
 async available(){return this.db.prepare(`SELECT p.id,p.name,p.currency,p.effective_from,p.effective_to FROM crm_price_lists p WHERE p.status='ACTIVE' AND NOT p.is_deleted
 AND EXISTS(SELECT 1 FROM crm_price_import_workflows w WHERE w.target_list_id=p.id AND w.status='ACTIVATED' AND NOT w.is_deleted) ORDER BY p.name LIMIT 1000`).all();}
 async tier(listId,itemId,quantity){return this.db.prepare(`SELECT e.id,e.unit_price::text AS unit_price,e.discount_percent::text AS discount_percent,e.min_quantity::text AS min_quantity,
 r.item_revision,r.uom AS approved_uom,r.part_code AS approved_part_code,i.updated_at::text AS current_item_revision,i.uom AS current_uom,i.part_code AS current_part_code
 FROM crm_price_list_items e JOIN items i ON i.id=e.item_id JOIN crm_price_import_entries r ON r.activated_entry_id=e.id
 JOIN crm_price_import_workflows w ON w.id=r.import_id AND w.target_list_id=e.price_list_id AND w.status='ACTIVATED' AND NOT w.is_deleted
 WHERE e.price_list_id=? AND e.item_id=? AND e.status='ACTIVE' AND NOT e.is_deleted AND i.status='ACTIVE' AND NOT i.is_deleted AND e.min_quantity<=?::numeric ORDER BY e.min_quantity DESC LIMIT 1`).get(listId,itemId,quantity);}
 async lock(level){await this.db.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get(`price-level:${level}`);}
 async save(level,b,actor,old){
  if(b.clear){await this.db.prepare("UPDATE crm_price_levels SET status='NOT_SET',label=NULL,meaning=NULL,configuration=NULL WHERE level_number=?").run(level);return;}
  const meaning=JSON.stringify({instructions:b.instructions}),configuration=JSON.stringify({priceListId:b.priceListId,calculation:b.calculation});
  if(old)await this.db.prepare("UPDATE crm_price_levels SET label=?,meaning=?::text::jsonb,configuration=?::text::jsonb,status='CONFIRMED',is_deleted=false,deleted_at=NULL,deleted_by=NULL,delete_reason=NULL WHERE level_number=?").run(b.label,meaning,configuration,level);
  else await this.db.prepare("INSERT INTO crm_price_levels(level_number,label,meaning,configuration,status,created_by) VALUES(?,?,?::text::jsonb,?::text::jsonb,'CONFIRMED',?)").run(level,b.label,meaning,configuration,actor.id);
 }
}
/** Supported calculation choices are technical options. Owner must select one;
 * no level is given a label, meaning, price list or calculation automatically. */
export class PriceLevelService {
 constructor(dependencies){Object.assign(this,dependencies);}
 read(actor){this.access.require(actor,'items.read');this.access.require(actor,'items.list_price.read');}
 async list(actor){this.read(actor);const rows=await this.repository.all();return {levels:[1,2,3].map(number=>{const row=rows.find(r=>r.level_number===number);return {number,label:row?.label??null,meaning:row?.meaning??null,configuration:row?.configuration??null,status:row?.is_deleted?'NOT_SET':row?.status??'NOT_SET',revision:revision(row)};}),priceLists:await this.repository.available()};}
 async save(actor,level,input){
  this.read(actor);this.access.require(actor,'items.update');if(actor.role!=='OWNER')throw forbidden('Only the Owner may confirm price-level meanings.');
  level=levelNumber(level);const {reason:rawReason,expectedRevision,clear,...rawSettings}=input,reason=validate(s.reason(),rawReason,'reason');
  if(expectedRevision!==null&&(typeof expectedRevision!=='string'||!/^[a-f0-9]{64}$/.test(expectedRevision)))throw validationFailed('Reload the current price-level revision before confirming.');
  const b=clear===true?{clear:true}:validate(settings,rawSettings);
  return this.transactions.run(actor,reason,async()=>{
   await this.repository.lock(level);const old=await this.repository.record(level,true);
   if(expectedRevision!==revision(old))throw conflict('Price-level settings changed. Reload before confirming.');
   if(!b.clear&&!await this.repository.list(b.priceListId))throw validationFailed('Select an independently approved, active imported price list.');
   if(!old&&b.clear)return {number:level,status:'NOT_SET',revision:null};
   await this.repository.save(level,b,actor,old);const row=await this.repository.record(level);
   await this.audit.record({actorId:actor.id,entity:'PRICE_LEVEL',recordId:level,action:b.clear?'CLEAR':'CONFIRM',reason,oldValue:old?{label:old.label,meaning:old.meaning,configuration:old.configuration}:null,newValue:{label:row.label,meaning:row.meaning,configuration:row.configuration,status:row.status}});
   return {number:level,status:row.status,revision:revision(row)};
  });
 }
 async resolve(level,itemId,quantity,at){
  at=validate(s.date(),at,'pricing date');
  level=levelNumber(level);itemId=validate(s.id(),itemId);quantity=validate(s.string({pattern:/^\d{1,14}(?:\.\d{1,6})?$/}),quantity,'quantity');
  if(compare(decimal(quantity),decimal('0'))<=0)throw validationFailed('Quantity must be positive.');
  const row=await this.repository.record(level);
  if(!row||row.status!=='CONFIRMED'||row.is_deleted)throw conflict(`Not set: crm_price_levels.${level} — blocks level-based pricing.`);
  let b;try{b=validate(settings,{label:row.label,instructions:row.meaning?.instructions,...row.configuration});}catch{throw conflict(`Not set: crm_price_levels.${level}.configuration — blocks level-based pricing.`);}
  const list=await this.repository.list(b.priceListId);
  if(!list||String(list.effective_from).slice(0,10)>at||list.effective_to&&String(list.effective_to).slice(0,10)<at)throw conflict('The configured approved price list is inactive, future-dated or expired. Ask Owner to confirm a current list.');
  const tier=await this.repository.tier(list.id,itemId,quantity);if(!tier)throw conflict('No approved price tier covers this active product and quantity.');
  if(tier.item_revision!==tier.current_item_revision||tier.approved_uom!==tier.current_uom||tier.approved_part_code!==tier.current_part_code)throw conflict('The source product or unit changed after price-list approval. Create a reviewed price-list revision before using it.');
  let net=decimal(tier.unit_price);
  for(const [apply,discount]of [[['LINE_DISCOUNT','BOTH_DISCOUNTS'].includes(b.calculation),tier.discount_percent],[['LIST_DISCOUNT','BOTH_DISCOUNTS'].includes(b.calculation),list.discount_percent]])if(apply)net=mul(net,div(sub(decimal('100'),decimal(discount)),decimal('100')));
  const result={level,levelRevision:revision(row),listId:list.id,entryId:tier.id,currency:list.currency,unitPrice:format(net,6),quantity,asOf:at};
  // Validate current eligibility each time, without invalidating an unchanged
  // approved source merely because the calendar day advanced within validity.
  const {asOf:ignored,...identity}=result;return {...result,fingerprint:fingerprint({...identity,quantity:format(decimal(quantity),6)})};
 }
}
