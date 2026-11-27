import {s,validate} from '../../core/schema.js';
import {TransactionRunner,AuditRepository,fingerprint} from '../../core/runtime.js';
import {hasPermission} from '../../rbac.js';
import {forbidden,conflict,validationFailed,notFound} from '../../core/errors.js';
import {decimal,add,format,compare,mul,div,lineNet} from '../../../public/money.js';
import {calendarDay} from './delivery-schedule.js';
const value=s.string({pattern:/^\d{1,12}(?:\.\d{1,6})?$/});
const schema=s.object({requestKey:s.uuid(),vendorId:s.id(),name:s.string({min:1,max:200}),validFrom:s.date(),validTo:s.date(),basis:s.enum(['ACCEPTED_NET_VALUE','ACCEPTED_ITEM_QUANTITY']),itemId:s.id().nullable(),threshold:value,benefitKind:s.enum(['PERCENT_REBATE','FIXED_REBATE','NON_MONETARY']),benefitValue:value.nullable(),evidence:s.string({min:3,max:2000}),terms:s.text({max:10000}),reason:s.reason()});
const zero=()=>decimal('0');
export function validateScheme(b){
 calendarDay(b.validFrom);calendarDay(b.validTo);if(b.validTo<b.validFrom||compare(decimal(b.threshold),zero())<=0)throw validationFailed('Confirm a valid scheme window and positive target.');
 if(b.basis==='ACCEPTED_ITEM_QUANTITY'&&!b.itemId||b.basis==='ACCEPTED_NET_VALUE'&&b.itemId)throw validationFailed('Quantity schemes require one item; value schemes cover supplier goods value.');
 if(b.benefitKind!=='NON_MONETARY'&&(b.benefitValue===null||compare(decimal(b.benefitValue),zero())<0))throw validationFailed('Enter the supplier-confirmed rebate value.');
 if(b.benefitKind==='PERCENT_REBATE'&&compare(decimal(b.benefitValue),decimal('100'))>0)throw validationFailed('A rebate percentage cannot exceed 100.');
 return b;
}
export function schemeProgress(scheme,orders,receipts,asOf){
 calendarDay(asOf);const settings=scheme.payload,byPo=new Map(orders.map(po=>[po.id,po])),issues=[];let current=zero();
 const end=asOf<scheme.valid_to?asOf:scheme.valid_to;
 for(const receipt of receipts){if(receipt.status!=='POSTED'||receipt.is_deleted||receipt.payload.receivedDate<scheme.valid_from||receipt.payload.receivedDate>end)continue;
  const po=byPo.get(receipt.supplier_po_id);if(!po||po.vendor_id!==scheme.vendor_id)continue;
  for(const row of receipt.payload.lines){const matches=po.payload.lines.filter(line=>line.lineKey===row.poLineKey);if(matches.length!==1){issues.push('Unmatched receipt line');continue;}const line=matches[0];
   if(row.actualPartCode&&row.actualPartCode!==line.partCode){issues.push('Substitute part requires scheme review');continue;}
   if(settings.basis==='ACCEPTED_ITEM_QUANTITY'&&line.itemId!==settings.itemId)continue;
   if(settings.basis==='ACCEPTED_ITEM_QUANTITY'&&settings.uom&&String(line.uom).trim().toUpperCase()!==String(settings.uom).trim().toUpperCase()){issues.push('Item unit changed; quantity scheme requires review');continue;}
   const qty=decimal(row.accepted);if(qty.n<0n)throw validationFailed('Accepted scheme quantities cannot be negative.');
   if(settings.basis==='ACCEPTED_ITEM_QUANTITY')current=add(current,qty);else current=add(current,lineNet({quantity:row.accepted,unit_price:line.unitPrice,discount_percent:line.discountPercent}));
  }
 }
 return {value:format(current,settings.basis==='ACCEPTED_ITEM_QUANTITY'?6:2),target:settings.threshold,progressPercent:format(div(mul(current,decimal('100')),decimal(settings.threshold)),2),targetReached:compare(current,decimal(settings.threshold))>=0,confirmedRebate:null,issues:[...new Set(issues)],note:'Receipt-based target progress at PO prices, before invoice adjustments. The supplier rebate is not confirmed or posted by this calculation.'};
}
export class SupplierSchemeService{
 constructor({db}){this.db=db;this.transactions=new TransactionRunner(db);this.audit=new AuditRepository(db);}
 one(sql,...args){return this.db.prepare(sql).get(...args);}
 all(sql,...args){return this.db.prepare(sql).all(...args);}
 access(actor,key='purchasing.read'){if(!hasPermission(actor,key))throw forbidden();}
 write(actor,reason,fn){return this.transactions.run(actor,reason,async()=>{await this.one("SELECT pg_advisory_xact_lock(812731),set_config('mehta.procurement_write','authorized',true)");return fn();});}
 async list(actor,vendorId){this.access(actor);validate(s.id(),Number(vendorId));return this.all('SELECT s.*,s.valid_from::text AS valid_from,s.valid_to::text AS valid_to,u.name AS creator_name,r.name AS reviewer_name FROM supplier_schemes s JOIN users u ON u.id=s.created_by LEFT JOIN users r ON r.id=s.approved_by WHERE vendor_id=? ORDER BY s.created_at DESC,s.id LIMIT 100',vendorId);}
 async create(actor,body){this.access(actor,'purchasing.write');const b=validateScheme(validate(schema,body)),hash=fingerprint(b);return this.write(actor,b.reason,async()=>{
  const retry=await this.one('SELECT * FROM supplier_schemes WHERE request_key=?',b.requestKey);if(retry){if(retry.request_hash!==hash||retry.created_by!==actor.id)throw conflict('Scheme retry key already represents different terms.');return retry;}
  const vendor=await this.one("SELECT id FROM crm_procurement_vendors WHERE id=? AND status='ACTIVE' AND NOT is_deleted",b.vendorId);if(!vendor)throw validationFailed('Select an active supplier.');
  const item=b.itemId?await this.one("SELECT id,uom FROM items WHERE id=? AND status='ACTIVE' AND NOT is_deleted",b.itemId):null;if(b.itemId&&!item)throw validationFailed('Select an active existing item.');
  const payload={basis:b.basis,itemId:b.itemId,uom:item?.uom||'INR',threshold:b.threshold,benefitKind:b.benefitKind,benefitValue:b.benefitValue,evidence:b.evidence,terms:b.terms};
  if(await this.one("SELECT id FROM supplier_schemes WHERE vendor_id=? AND lower(name)=lower(?) AND valid_from=? AND valid_to=? AND status IN ('PENDING_APPROVAL','APPROVED')",b.vendorId,b.name,b.validFrom,b.validTo))throw conflict('This supplier scheme and validity window already exist.');
  const row=await this.one('INSERT INTO supplier_schemes(vendor_id,request_key,request_hash,name,valid_from,valid_to,payload,created_by) VALUES(?,?,?,?,?,?,?::text::jsonb,?) RETURNING *',b.vendorId,b.requestKey,hash,b.name,b.validFrom,b.validTo,JSON.stringify(payload),actor.id);
  await this.audit.record({actorId:actor.id,entity:'SUPPLIER_SCHEME',recordId:row.id,action:'REQUESTED',reason:b.reason,newValue:{vendorId:b.vendorId,basis:b.basis}});return row;
 });}
 async decide(actor,id,body){this.access(actor,'purchasing.approve');const b=validate(s.object({version:s.int({min:1}),decision:s.enum(['APPROVE','REJECT','CANCEL']),reason:s.reason()}),body);return this.write(actor,b.reason,async()=>{
  const row=await this.one('SELECT * FROM supplier_schemes WHERE id=? FOR UPDATE',validate(s.uuid(),id));if(!row)throw notFound();if(row.version!==b.version)throw conflict('Scheme changed. Reload.');
  if(b.decision==='CANCEL'){if(!['PENDING_APPROVAL','APPROVED'].includes(row.status))throw conflict('Scheme is already closed.');}else{if(row.status!=='PENDING_APPROVAL')throw conflict('Scheme already reviewed.');if(row.created_by===actor.id)throw forbidden('A different reviewer must approve or reject supplier terms.');}
  const status={APPROVE:'APPROVED',REJECT:'REJECTED',CANCEL:'CANCELLED'}[b.decision];
  const result=await this.one('UPDATE supplier_schemes SET status=?,version=version+1,approved_by=?,decision_reason=? WHERE id=? RETURNING *',status,b.decision==='APPROVE'?actor.id:row.approved_by,b.reason,id);
  await this.audit.record({actorId:actor.id,entity:'SUPPLIER_SCHEME',recordId:id,action:b.decision,reason:b.reason,newValue:{version:result.version,status}});return result;
 });}
 async progress(actor,id,asOf){this.access(actor);calendarDay(asOf);const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());if(asOf>today)throw validationFailed('Scheme progress cannot be measured in the future.');const scheme=await this.one('SELECT *,valid_from::text AS valid_from,valid_to::text AS valid_to FROM supplier_schemes WHERE id=?',validate(s.uuid(),id));if(!scheme)throw notFound();
  const receipts=await this.all("SELECT g.* FROM crm_grns g JOIN crm_supplier_pos p ON p.id=g.supplier_po_id WHERE p.vendor_id=? AND NOT p.is_deleted AND g.status='POSTED' AND NOT g.is_deleted AND (g.payload->>'receivedDate')::date BETWEEN ?::date AND LEAST(?::date,?::date) LIMIT 5001",scheme.vendor_id,scheme.valid_from,scheme.valid_to,asOf);if(receipts.length>5000)throw validationFailed('Scheme evidence exceeds 5,000 receipts; narrow the scheme window before verification.');
  const ids=[...new Set(receipts.map(r=>r.supplier_po_id))],orders=ids.length?await this.all('SELECT id,vendor_id,payload FROM crm_supplier_pos WHERE id=ANY(?::integer[])',ids):[];return {scheme,asOf,progress:schemeProgress(scheme,orders,receipts,asOf)};
 }
}
