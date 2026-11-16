import {randomUUID} from 'node:crypto';
import {TransactionRunner} from '../src/core/runtime.js';
import {fixtureRuleService} from './business-rule-fixture.js';
export const fixtureStockPolicy={maximumSourceAgeMinutes:60,reservedQuantityPointer:'/RESERVEDQTY',reservationsPointer:'/ORDERALLOCATIONS.LIST',reservationShape:'ARRAY',reservationQuantityPointer:'/ACTUALQTY',reservationKeyPointer:'/ORDERGUID',instructions:'ZZTEST_ explicit order-stock test evidence; no inferred reservations'};
/** Synthetic retained receipts, only called with the sole-DB rollback fixture. */
export async function orderStockReceipt(db,f,{onHand='24',reserved='0',reservations=[],sourceTimestamp=new Date().toISOString()}={}){
 const why='ZZTEST_ retained order-stock receipt',id=`ZZTEST_stock_${randomUUID()}`,session=randomUUID(),guid=f.stockGuid??`ZZTEST_order_item_${f.item.id}`,sourceKey=id;
 await new TransactionRunner(db).run(f.owner,why,async()=>{
  const previous=await db.prepare('SELECT session_id FROM tally_stock_items WHERE company_id=? ORDER BY fetched_at DESC LIMIT 1').get(f.company);
  await db.prepare("INSERT INTO tally_upload_sessions(id,connector_id,company_name,sync_from,sync_to,status,collection_metadata) SELECT ?,connector_id,company_name,sync_from,sync_to,'stored',?::text::jsonb FROM tally_upload_sessions WHERE id=? RETURNING id").get(session,JSON.stringify({stockXml:{sourceTimestamp}}),previous.session_id);
  await db.prepare("INSERT INTO tally_stock_items(company_id,id,source_key,session_id,name,base_unit,normalized_part_number,closing_quantity_text,raw_record,fetched_at) VALUES(?,?,?,?,?,'NOS',?,?,?::text::jsonb,clock_timestamp())").run(f.company,id,sourceKey,session,'ZZTEST_Exact stock','ZZTEST_Exact stock',`${onHand} NOS`,JSON.stringify({GUID:guid,RESERVEDQTY:`${reserved} NOS`,'ORDERALLOCATIONS.LIST':reservations}));
  const old=await db.prepare("SELECT id FROM crm_tally_item_links WHERE company_id=? AND item_id=? AND tally_name='ZZTEST_Exact stock' AND status='ACTIVE' AND NOT is_deleted").get(f.company,f.item.id);
  if(old)await db.prepare('UPDATE crm_tally_item_links SET tally_record_key=?,tally_guid=? WHERE id=?').run(sourceKey,guid,old.id);
  else await db.prepare('INSERT INTO crm_tally_item_links(company_id,item_id,tally_name,tally_record_key,tally_guid,created_by) VALUES(?,?,?,?,?,?)').run(f.company,f.item.id,'ZZTEST_Exact stock',sourceKey,guid,f.owner.id);
  await db.prepare("INSERT INTO tally_run_datasets(company_id,session_id,dataset,status,processed_at) VALUES(?,?,'stockXml','imported',clock_timestamp()) RETURNING dataset").get(f.company,session);
 });
 return {id,session,guid,sourceTimestamp,sourceKey};
}
export async function prepareOrderStock(db,f){await fixtureRuleService(db).set(f.owner,'stock.availability',fixtureStockPolicy,'ZZTEST_ confirmed stock evidence fields');return orderStockReceipt(db,f);}
