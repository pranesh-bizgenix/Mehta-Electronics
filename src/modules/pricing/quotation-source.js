import {s,validate} from '../../core/schema.js';
import {conflict} from '../../core/errors.js';
import {compare,decimal} from '../../../public/money.js';
import {PriceLevelRepository,PriceLevelService} from './levels.js';
export const pricingToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const selectionSchema=s.object({level:s.int({min:1,max:4}),fingerprint:s.string({pattern:/^[a-f0-9]{64}$/})});
export async function resolveQuotationLevel(db,level,itemId,quantity,at=pricingToday()){
 const repository=new PriceLevelRepository(db);await repository.lock(validate(s.int({min:1,max:4}),level));
 const result=await new PriceLevelService({repository}).resolve(level,itemId,quantity,at);
 if(result.currency!=='INR')throw conflict('This quotation workflow supports INR only. A reviewed currency/conversion policy is required before using this source.');
 return result;
}
export async function bindQuotationLevel(db,line,selection,at=pricingToday()){
 if(selection==null)return null;
 const selected=validate(selectionSchema,selection,'pricingSelection'),resolved=await resolveQuotationLevel(db,selected.level,line.itemId,line.quantity,at);
 if(selected.fingerprint!==resolved.fingerprint)throw conflict('Price-level configuration or source changed. Preview the current net price and revise the draft.','PRICE_SOURCE_CHANGED');
 if(compare(decimal(line.unitPrice),decimal(resolved.unitPrice))!==0||compare(decimal(line.discountPercent),decimal('0'))!==0)throw conflict('Use the previewed net level price without another discount.','PRICE_SOURCE_NET_REQUIRED');
 return {level:selected.level,fingerprint:resolved.fingerprint};
}
