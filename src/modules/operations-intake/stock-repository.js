import {StockCheckRepository} from '../stock/repository.js';

export class OperationsStockRepository extends StockCheckRepository {
 async batch(companyId,items){
  if(!items.length)return new Map();
  const wanted=new Set(items.map(item=>item.id)),links=await this.links(companyId);
  if(!links.some(link=>wanted.has(link.item_id)&&(link.tally_guid||link.tally_master_id))){
   // An unmapped CRM product has unknown stock. Do not scan every imported
   // stock master just to rediscover that no stable identity was configured.
   return new Map(items.map(item=>[item.id,{stable:false,company_id:companyId,item_id:item.id,uom:item.uom}]));
  }
  return super.batch(companyId,items);
 }
}
