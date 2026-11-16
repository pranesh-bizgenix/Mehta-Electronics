import {required,fail,category,businessApproval} from './contracts.js';

function field(object,path,key){
  required(path,`field_mapping.source_fields.${key}`);
  if(typeof path!=='string'||!/^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)*$/.test(path)||/constructor|prototype|__/.test(path))fail(422,'Invalid CRM field mapping.');
  let value=object;for(const part of path.split('.'))value=value?.[part];
  return required(value,`document.${path}`);
}
export class WriteSources{
  constructor(db){this.db=db;}
  async company(id){const row=await this.db.prepare('SELECT id,name,tally_guid FROM tally_companies WHERE id=?').get(id);if(!row)fail(404,'Selected company is not imported.');return {id:row.id,name:row.name,guid:required(row.tally_guid,'company.guid')};}
  async imported(companyId,entity,key){
    required(key,`field_mapping.${entity}.record_key`);
    const row=await this.db.prepare('SELECT record_key,record_id,name,summary_fields FROM tally_visibility_current_cache WHERE company_id=? AND entity=? AND record_key=?').get(companyId,entity,key);
    if(!row)fail(409,`Selected ${entity} record is absent from this company.`);
    const f=row.summary_fields;
    const guid=f['/stored/tally_guid']??f['/stored/guid']??f['/xml/GUID/#text']??f['/xml/GUID'];
    const master=f['/stored/master_id']??f['/xml/MASTERID/#text']??f['/xml/MASTERID'];
    if(!guid&&!master)fail(409,`Selected ${entity} lacks a stable Tally GUID/master ID.`);
    return {...row,guid:guid??null,masterId:master??null};
  }
  async validateMappingImports(companyId,mapping,kind){
    const evidence=[];
    if(kind==='PARTY_LEDGER'){
      const group=await this.imported(companyId,'groups',mapping.parentSourceKey);
      if(group.name!==mapping.parentName)fail(409,'Mapped ledger group changed after review.');evidence.push(group);
    }else{
      const voucher=await this.imported(companyId,'voucher_types',mapping.voucherTypeSourceKey);
      if(voucher.name!==mapping.voucherType)fail(409,'Mapped voucher type changed after review.');evidence.push(voucher);
      const godown=await this.imported(companyId,'godowns',mapping.godownSourceKey);
      if(godown.name!==mapping.godown)fail(409,'Mapped godown changed after review.');evidence.push(godown);
      for(const entry of mapping.ledgerEntries??[])if(entry.party!==true){
        const ledger=await this.imported(companyId,'ledgers',entry.recordKey);
        if(ledger.name!==entry.name)fail(409,'Mapped accounting ledger changed after review.');evidence.push(ledger);
      }
      for(const [itemId,unit]of Object.entries(mapping.units??{})){
        const source=await this.imported(companyId,'units',mapping.unitSourceKeys?.[itemId]);
        if(source.name!==unit)fail(409,'Mapped unit changed after review.');evidence.push(source);
      }
    }
    return evidence.map(r=>({entityKey:r.record_key,recordId:r.record_id,guid:r.guid,masterId:r.masterId}));
  }
  async document(kind,entityId,companyId,mapping){
    category(kind);let row,p,partyType,partyId,versionMaker;
    if(kind==='SALES_ORDER'){
      row=await this.db.prepare('SELECT w.*,o.order_number FROM crm_order_workflows w JOIN sales_orders o ON o.id=w.sales_order_id WHERE w.sales_order_id=?').get(entityId);
      if(!row)fail(404,'CRM sales order not found.');p=row.public_snapshot;partyType='CUSTOMER';partyId=p.customerId;
      versionMaker=await this.db.prepare('SELECT created_by FROM crm_order_versions WHERE sales_order_id=? AND version=?').get(entityId,row.version);
    }else if(kind==='PURCHASE_ORDER'){
      row=await this.db.prepare('SELECT * FROM crm_supplier_pos WHERE id=?').get(entityId);
      if(!row)fail(404,'Supplier PO not found.');p=row.payload;partyType='VENDOR';partyId=row.vendor_id;
      versionMaker={created_by:p._editor};
    }else{
      const review=await this.db.prepare('SELECT * FROM tw_party_reviews WHERE id=? AND company_id=?').get(entityId,companyId);
      if(!review)fail(404,'Approved party review not found in this company.');
      const table=review.entity_type==='CUSTOMER'?'customers':'crm_procurement_vendors';
      const actual=await this.db.prepare(`SELECT * FROM ${table} WHERE id=? AND NOT is_deleted`).get(review.entity_id);
      if(!actual||actual.status!=='ACTIVE')fail(409,'Party is unavailable or inactive.');
      const current=review.entity_type==='CUSTOMER'?{name:actual.name,gstin:actual.gstin,address:actual.billing_address}:{name:actual.payload.name,gstin:actual.payload.gstin,address:actual.payload.address};
      for(const key of Object.keys(review.snapshot))if(review.snapshot[key]!==current[key])fail(409,'Party changed after its extra approval.');
      return {...review.snapshot,companyId,sourceId:String(entityId),entityType:review.entity_type,entityId:review.entity_id,status:review.status,locked:review.status==='APPROVED',createdBy:review.created_by,updatedBy:review.created_by,approvedBy:review.approved_by,extraPartyApproval:true,version:review.snapshot_hash};
    }
    const approved=row.status==='APPROVED'||kind==='PURCHASE_ORDER'&&row.status==='ISSUED';
    const document={companyId,sourceId:String(entityId),entityType:kind,entityId:String(entityId),version:row.version,status:approved?'APPROVED':row.status,
      locked:approved&&!!row.approval_fingerprint&&(kind!=='SALES_ORDER'||row.approved_version===row.version),
      createdBy:row.created_by,updatedBy:versionMaker?.created_by??row.created_by,approvedBy:row.approved_by,
      number:kind==='SALES_ORDER'?row.order_number:row.number,total:p.total,lines:[],sourceEvidence:[]};
    const source=JSON.parse(JSON.stringify({...row,...p}));
    for(const key of ['date','sellerState','placeOfSupply'])document[key]=field(source,mapping.sourceFields?.[key],key);
    if(mapping.dateTransform==='ISO_DATE')document.date=String(document.date).slice(0,10);
    const override=mapping.partyBindings?.[`${partyType}:${partyId}`];let partyKey=override;
    if(!partyKey&&partyType==='CUSTOMER'){
      const links=await this.db.prepare("SELECT record_key FROM tally_visibility_crm_links WHERE company_id=? AND entity='ledgers' AND crm_kind='customer' AND crm_id=?").all(companyId,partyId);
      if(links.length!==1)fail(409,'Exactly one stable customer link in this company is required.');partyKey=links[0].record_key;
    }
    const party=await this.imported(companyId,'ledgers',required(partyKey,'field_mapping.stable_party_binding'));
    document.partyLedgerName=party.name;document.partyIdentity={key:party.record_key,guid:party.guid,masterId:party.masterId};
    for(const line of p.lines??[]){
      required(line.itemId,'document.item_id');let itemKey=mapping.itemBindings?.[String(line.itemId)];
      if(!itemKey){const link=await this.db.prepare("SELECT tally_record_key FROM crm_tally_item_links WHERE company_id=? AND item_id=? AND status='ACTIVE' AND NOT is_deleted").all(companyId,line.itemId);if(link.length!==1)fail(409,'Exactly one stable item link in this company is required.');itemKey=link[0].tally_record_key;}
      const item=await this.imported(companyId,'items',itemKey);
      document.lines.push({itemId:line.itemId,tallyItemName:item.name,uom:line.uom,quantity:line.quantity,unitPrice:line.unitPrice,discountPercent:line.discountPercent,taxPercent:line.taxPercent,
        tallyIdentity:{key:item.record_key,guid:item.guid,masterId:item.masterId}});
    }
    document.sourceEvidence=await this.validateMappingImports(companyId,mapping,kind);
    businessApproval(document,kind);return document;
  }
}
