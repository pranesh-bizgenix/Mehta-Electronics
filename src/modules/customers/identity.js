import {conflict} from '../../core/errors.js';
export async function customerIdentity(db,id){
 const link=await db.prepare('SELECT source_id,target_id FROM crm_customer_merge_links WHERE source_id=?').get(id);
 const target=link?.target_id??id;
 const aliases=await db.prepare('SELECT source_id FROM crm_customer_merge_links WHERE target_id=? ORDER BY source_id').all(target);
 return {requestedId:id,canonicalId:target,merged:Boolean(link),customerIds:[target,...aliases.map(x=>x.source_id)]};
}
export async function requireUnmergedCustomer(db,id){
 const link=await db.prepare('SELECT target_id FROM crm_customer_merge_links WHERE source_id=?').get(id);
 if(link)throw conflict('This duplicate customer was merged. Open customer #'+link.target_id+' for new work.','CUSTOMER_MERGED',{customerId:link.target_id,href:'/customers/'+link.target_id});
}
