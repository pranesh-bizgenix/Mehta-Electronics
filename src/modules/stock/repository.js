import {readItemSources,itemLinkMatches} from '../../tally-item-links.js';
export class StockCheckRepository {
 constructor(db){this.db=db;}
 async item(id){return this.db.prepare("SELECT id,part_code,description,uom FROM items WHERE id=? AND status='ACTIVE' AND NOT is_deleted").get(id);}
 async source(companyId,item){
  const links=await this.db.prepare("SELECT tally_guid,tally_master_id FROM crm_tally_item_links WHERE company_id=? AND item_id=? AND status='ACTIVE' AND NOT is_deleted AND tally_record_key IS NOT NULL").all(companyId,item.id);
  const empty={stable:false,company_id:companyId,item_id:item.id,uom:item.uom};if(!links.length)return empty;
  const matches=(await readItemSources(this.db,companyId)).filter(source=>source.stable&&links.some(link=>itemLinkMatches(link,source)));if(matches.length!==1)return empty;
  const source=matches[0];if(source.uom?.normalize('NFKC').trim().toUpperCase()!==item.uom?.normalize('NFKC').trim().toUpperCase())return empty;
  const receipt=await this.db.prepare(`SELECT r.raw_record,s.collection_metadata,d.status,d.quarantined_count FROM tally_visibility_records r
   LEFT JOIN tally_upload_sessions s ON s.id=r.session_id LEFT JOIN tally_run_datasets d ON d.session_id=s.id AND d.company_id=r.company_id AND d.dataset='stockXml'
   WHERE r.id=? AND r.company_id=? AND r.entity='items'`).get(source.record_id,companyId);
  const usable=receipt&&['imported','received_empty','retained'].includes(receipt.status)&&receipt.quarantined_count===0;
  return {...source,item_id:item.id,raw_record:receipt?.raw_record??null,sourceTimestamp:usable?receipt.collection_metadata?.stockXml?.sourceTimestamp??null:null};
 }
 async latest(companyId){return this.db.prepare("SELECT status,quarantined_count,processed_at,session_id FROM tally_run_datasets WHERE company_id=? AND dataset='stockXml' ORDER BY processed_at DESC NULLS LAST,session_id DESC LIMIT 1").get(companyId);}
 async existing(id){return this.db.prepare('SELECT id,company_id,created_by,status,reservation_detail FROM stock_check_log WHERE id=?').get(id);}
 async order(id){return this.db.prepare('SELECT sales_order_id,public_snapshot FROM crm_order_workflows WHERE sales_order_id=?').get(id);}
 async insert(company,item,input,plan,actor,requestHash){return this.db.prepare(`INSERT INTO stock_check_log(id,company_id,item_id,sales_order_id,requested_quantity,stock_in_hand,reserved_quantity,source_session_id,source_observed_at,selected_basis,reservation_detail,status,reason,created_by)
  VALUES(?,?,?,?,?,?,?,?,?,?,?::text::jsonb,?,?,?) RETURNING id`).get(input.requestId,company.id,item.id,input.salesOrderId??null,input.requestedQuantity,plan.stockInHand,plan.reservedQuantity,plan.sourceSessionId,plan.sourceTimestamp,input.basis,JSON.stringify({uom:plan.uom,sourceRecordKey:plan.sourceRecordKey,policyVersion:plan.policyVersion,reservationKey:plan.reservationKey,rows:plan.reservations,issues:plan.issues,available:plan.available,previewFingerprint:plan.previewFingerprint,requestHash}),plan.status,input.reason,actor.id);}
 async history(companyId,actorId,page){return this.db.prepare(`SELECT l.id,l.created_at,l.created_by,u.name AS staff_name,l.item_id,i.part_code,l.sales_order_id,l.requested_quantity::text AS requested_quantity,l.stock_in_hand::text AS stock_in_hand,l.reserved_quantity::text AS reserved_quantity,l.free_quantity::text AS free_quantity,l.source_observed_at,l.selected_basis,l.reservation_detail,l.status,l.reason
  FROM stock_check_log l JOIN items i ON i.id=l.item_id JOIN users u ON u.id=l.created_by WHERE l.company_id=? AND (?::integer IS NULL OR l.created_by=?) ORDER BY l.created_at DESC,l.id LIMIT 100 OFFSET ?`).all(companyId,actorId,actorId,(page-1)*100);}
 async daily(companyId,day){return this.db.prepare(`SELECT l.created_by,u.name AS staff_name,l.status,count(*)::text AS check_count,count(DISTINCT l.item_id)::text AS product_count
  FROM stock_check_log l JOIN users u ON u.id=l.created_by WHERE l.company_id=? AND l.created_at>=(?::date::timestamp AT TIME ZONE 'Asia/Kolkata') AND l.created_at<((?::date+1)::timestamp AT TIME ZONE 'Asia/Kolkata') GROUP BY l.created_by,u.name,l.status ORDER BY u.name,l.created_by,l.status`).all(companyId,day,day);}
}
