import { writeAudit, enquiryView, recordEnquiryRevision } from './db.js';
import { normalizeKey, escapeLike } from './security.js';
import { pagination, classifyLedgers } from './tally-read-service.js';

const error=(status,message)=>Object.assign(new Error(message),{status});
export const id=value=>{if(!['string','number'].includes(typeof value)||typeof value==='string'&&!/^\d+$/.test(value))throw error(422,'Invalid record identifier.');const n=Number(value);if(!Number.isSafeInteger(n)||n<1)throw error(422,'Invalid record identifier.');return n;};
const text=(value,max=500)=>{if(value==null)return '';if(typeof value!=='string'||value.length>max)throw error(422,`Text must be at most ${max} characters.`);return value.trim();};
const required=(value,label,max=200)=>{const v=text(value,max);if(!v)throw error(422,`${label} is required.`);return v;};
export function decimal(value,label,{positive=false,percent=false}={}) {
  const v=String(value??'');
  if(!/^\d{1,14}(?:\.\d{1,6})?$/.test(v))throw error(422,`${label} must be a non-negative decimal with at most six decimal places.`);
  const [whole,fraction='']=v.split('.'),scaled=BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'));
  if(positive&&scaled===0n||percent&&scaled>100000000n)throw error(422,`${label} is outside its allowed range.`);
  return v;
}
export function validDate(value) {return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}
export function validateTax(gstin,stateCode) {
  const gst=text(gstin,15).toUpperCase(),state=text(stateCode,2);
  if(state&&!/^(0[1-9]|[12][0-9]|3[0-8]|97|99)$/.test(state))throw error(422,'Enter a two-digit state code.');
  if(gst&&!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gst))throw error(422,'GSTIN must have the expected 15-character format.');
  if(gst&&state&&gst.slice(0,2)!==state)throw error(422,'GSTIN and state code do not match.');
  return {gstin:gst||null,stateCode:state||gst.slice(0,2)||null};
}
const decimalKey=value=>{const [whole,fraction='']=String(value).split('.');return BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'));};
const status=(value,allowed)=>{if(!allowed.includes(value))throw error(422,'Invalid status.');return value;};
async function active(db,table,value,label) {
  const n=id(value);if(!await db.prepare(`SELECT id FROM ${table} WHERE id=? AND status='ACTIVE'`).get(n))throw error(422,`Select an active ${label}.`);return n;
}
export async function transaction(db,user,reason,callback) {
  return db.withConnection(async()=>{
    await db.exec('BEGIN');
    try{
      await db.prepare("SELECT set_config('mehta.actor_id',?,true),set_config('mehta.audit_reason',?,true)").get(String(user.id),reason);
      const result=await callback();await db.exec('COMMIT');return result;
    }catch(e){await db.exec('ROLLBACK');if(e.code==='23505')throw error(409,'A name, customer code, GSTIN, part number or price tier already exists.');throw e;}
  });
}
const editReason=(body,editing)=>editing?required(body.reason,'Edit reason',1000):text(body.reason,1000)||'CRM record created';
async function audit(db,user,entity,recordId,oldValue,newValue,reason,action) {await writeAudit(db,{userId:user.id,entity,recordId,action:action||(oldValue?'UPDATE':'CREATE'),oldValue,newValue,reason});}
async function profile(db,table,key,recordId,values,user) {
  const existing=await db.prepare(`SELECT id FROM ${table} WHERE ${key}=?`).get(recordId);
  const keys=Object.keys(values);
  if(existing)await db.prepare(`UPDATE ${table} SET ${keys.map(k=>`${k}=?`).join(',')} WHERE id=?`).run(...Object.values(values),existing.id);
  else await db.prepare(`INSERT INTO ${table}(${key},${keys.join(',')},created_by) VALUES(${Array(keys.length+2).fill('?').join(',')})`).run(recordId,...Object.values(values),user.id);
}
async function validateLink(db,companyId,name,kind) {
  if(!companyId&&!name)return {company_id:null,[kind==='customer'?'tally_ledger_name':'tally_stock_name']:null};
  if(typeof companyId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(companyId)||typeof name!=='string'||!name||name.length>1000)throw error(422,'Select a company and an exact Tally name, or clear both.');
  const table=kind==='customer'?'tally_ledgers':'tally_stock_items';
  const rows=await db.prepare(`SELECT id,name,parent_name FROM ${table} WHERE company_id=? AND name=?`).all(companyId,name);
  if(rows.length!==1)throw error(409,'The exact Tally name is missing or ambiguous in this company.');
  if(kind==='customer'){
    const groups=await db.prepare('SELECT name,parent_name FROM tally_groups WHERE company_id=?').all(companyId);
    if(classifyLedgers(groups,rows)[0].category!=='customers')throw error(422,'Customer links must refer to Sundry Debtors or a descendant group.');
  }
  return {company_id:companyId,[kind==='customer'?'tally_ledger_name':'tally_stock_name']:name};
}
export async function listRecords(db,kind,url) {
  const meta=pagination(url),search=text(url.searchParams.get('search')),filter=text(url.searchParams.get('status'));
  const table={customers:'customers',items:'items',enquiries:'enquiries'}[kind];
  if(!table)throw error(404,'Unknown CRM module.');
  const args=[],where=[];
  if(search){const q=`%${escapeLike(search)}%`;where.push(kind==='items'?"(r.part_code ILIKE ? ESCAPE '\\' OR r.description ILIKE ? ESCAPE '\\')":kind==='enquiries'?"(r.enquiry_number ILIKE ? ESCAPE '\\' OR r.subject ILIKE ? ESCAPE '\\' OR c.name ILIKE ? ESCAPE '\\')":"(r.name ILIKE ? ESCAPE '\\' OR r.gstin ILIKE ? ESCAPE '\\')");args.push(q,q);if(kind==='enquiries')args.push(q);}
  if(filter){where.push('r.status=?');args.push(filter);}
  if(kind==='enquiries'&&url.searchParams.get('ownerId')){where.push('r.assigned_to=?');args.push(id(url.searchParams.get('ownerId')));}
  if(kind==='enquiries'&&url.searchParams.get('source')){where.push('r.source=?');args.push(text(url.searchParams.get('source')));}
  for(const [key,op]of [['from','>='],['to','<=']])if(kind==='enquiries'&&url.searchParams.get(key)){const v=url.searchParams.get(key);if(!validDate(v))throw error(422,'Invalid expected-by date filter.');where.push(`r.expected_by ${op} ?`);args.push(v);}
  const joins=kind==='enquiries'?'JOIN customers c ON c.id=r.customer_id LEFT JOIN users u ON u.id=r.assigned_to':'';
  const clause=where.length?' WHERE '+where.join(' AND '):'';
  const total=(await db.prepare(`SELECT count(*) AS n FROM ${table} r ${joins}${clause}`).get(...args)).n;
  const extra=kind==='customers'?`,r.credit_limit::text AS credit_limit,(SELECT payment_terms FROM crm_customer_profiles p WHERE p.customer_id=r.id) AS payment_terms,(EXISTS(SELECT 1 FROM crm_customer_tally_facts f WHERE f.customer_id=r.id AND f.match_count=1) OR NOT EXISTS(SELECT 1 FROM crm_customer_profiles p WHERE p.customer_id=r.id) AND EXISTS(SELECT 1 FROM crm_parties p WHERE p.customer_id=r.id AND p.status='ACTIVE' AND NOT p.is_deleted AND (SELECT count(*) FROM tally_ledgers l WHERE l.company_id=p.company_id AND l.name=p.name)=1)) AS tally_linked`:
    kind==='items'?`,r.pack_size::text AS pack_size,(EXISTS(SELECT 1 FROM crm_item_tally_facts f WHERE f.item_id=r.id AND f.match_count=1) OR NOT EXISTS(SELECT 1 FROM crm_item_profiles p WHERE p.item_id=r.id) AND EXISTS(SELECT 1 FROM crm_tally_item_links p WHERE p.item_id=r.id AND p.status='ACTIVE' AND NOT p.is_deleted AND (SELECT count(*) FROM tally_stock_items t WHERE t.company_id=p.company_id AND t.name=p.tally_name)=1)) AS tally_linked`:
    ',c.name AS customer_name,u.name AS owner_name,(SELECT count(*) FROM enquiry_lines l WHERE l.enquiry_id=r.id AND NOT l.is_deleted) AS line_count';
  const data=await db.prepare(`SELECT r.*${extra} FROM ${table} r ${joins}${clause} ORDER BY r.updated_at DESC,r.id DESC LIMIT ? OFFSET ?`).all(...args,meta.pageSize,(meta.page-1)*meta.pageSize);
  return {data,pagination:{...meta,total,pages:Math.ceil(total/meta.pageSize)}};
}
export async function customerDetail(db,customerId,{financial=false}={}) {
  const row=await db.prepare('SELECT *,credit_limit::text AS credit_limit FROM customers WHERE id=?').get(id(customerId));if(!row)throw error(404,'Customer not found.');
  const p=await db.prepare('SELECT * FROM crm_customer_profiles WHERE customer_id=?').get(row.id);
  row.profile=p||{};
  if(!p){const links=await db.prepare("SELECT company_id,name FROM crm_parties WHERE customer_id=? AND status='ACTIVE' AND NOT is_deleted").all(row.id);if(links.length===1)row.profile={company_id:links[0].company_id,tally_ledger_name:links[0].name};}
  row.contacts=await db.prepare('SELECT * FROM customer_contacts WHERE customer_id=? AND NOT is_deleted ORDER BY is_primary DESC,id').all(row.id);
  row.partMappings=await db.prepare('SELECT m.*,i.part_code FROM crm_customer_part_mappings m JOIN items i ON i.id=m.item_id WHERE m.customer_id=? AND NOT m.is_deleted ORDER BY m.id').all(row.id);
  const link=row.profile;
  const facts=link.company_id?await db.prepare('SELECT name,closing_balance::text AS closing_balance,dr_cr,fetched_at FROM tally_ledgers WHERE company_id=? AND name=?').all(link.company_id,link.tally_ledger_name):[];
  row.tally={linked:facts.length===1,matchCount:facts.length,companyId:link.company_id||null,name:link.tally_ledger_name||null};
  row.dues={available:financial&&facts.length===1&&facts[0].closing_balance!=null,financialAccess:financial,
    ...(financial&&facts.length===1?{closingBalance:facts[0].closing_balance,drCr:facts[0].dr_cr,fetchedAt:facts[0].fetched_at}:{}),
    note:'Read-only signed Tally closing balance. This is not an overdue or ageing calculation.'};
  return row;
}
export async function saveCustomer(db,customerId,body,user) {
  const reason=editReason(body,!!customerId);
  return transaction(db,user,reason,async()=>{
    const old=customerId?await db.prepare('SELECT *,credit_limit::text AS credit_limit FROM customers WHERE id=? FOR UPDATE').get(id(customerId)):null;
    if(customerId&&!old)throw error(404,'Customer not found.');
    let oldProfile=old?await db.prepare('SELECT * FROM crm_customer_profiles WHERE customer_id=?').get(old.id):null;
    if(old&&!oldProfile){const links=await db.prepare("SELECT company_id,name AS tally_ledger_name FROM crm_parties WHERE customer_id=? AND status='ACTIVE' AND NOT is_deleted").all(old.id);if(links.length===1)oldProfile=links[0];}
    const tax=validateTax(body.gstin??old?.gstin,body.stateCode??oldProfile?.state_code);
    const name=required(body.name??old?.name,'Customer name');
    const limit=decimal(body.creditLimit??old?.credit_limit??0,'Credit limit');
    const days=Number(body.creditDays??old?.credit_days??0);if(!Number.isInteger(days)||days<0||days>3650)throw error(422,'Credit days must be an integer between 0 and 3650.');
    const owner=body.ownerId?await active(db,'users',body.ownerId,'owner'):old?.owner_id||null;
    const values=[name,normalizeKey(name),text(body.customerCode??old?.customer_code,100)||null,tax.gstin,limit,days,owner,status(body.status??old?.status??'ACTIVE',['ACTIVE','INACTIVE','ON_HOLD']),text(body.billingAddress??old?.billing_address,4000)||null,user.id];
    let recordId=old?.id;
    if(old)await db.prepare('UPDATE customers SET name=?,normalized_name=?,customer_code=?,gstin=?,credit_limit=?,credit_days=?,owner_id=?,status=?,billing_address=?,updated_by=?,updated_at=now() WHERE id=?').run(...values,recordId);
    else recordId=(await db.prepare('INSERT INTO customers(name,normalized_name,customer_code,gstin,credit_limit,credit_days,owner_id,status,billing_address,updated_by,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(...values,user.id)).insertedId;
    const link=await validateLink(db,body.companyId??oldProfile?.company_id,body.tallyName??oldProfile?.tally_ledger_name,'customer');
    await profile(db,'crm_customer_profiles','customer_id',recordId,{state_code:tax.stateCode,payment_terms:text(body.paymentTerms??oldProfile?.payment_terms,2000)||null,...link},user);
    if(body.contacts!==undefined)await saveContacts(db,recordId,body.contacts,user,reason);
    const result=await customerDetail(db,recordId);
    await audit(db,user,'CUSTOMER',recordId,old,result,reason);return result;
  });
}
async function saveContacts(db,customerId,contacts,user,reason) {
  if(!Array.isArray(contacts)||contacts.length>50)throw error(422,'Provide at most 50 contacts.');
  const existing=await db.prepare('SELECT * FROM customer_contacts WHERE customer_id=? AND NOT is_deleted FOR UPDATE').all(customerId);
  const ids=new Set();let primary=0;
  for(const c of contacts){
    if(!c||typeof c!=='object'||Array.isArray(c)||c.isPrimary!==undefined&&typeof c.isPrimary!=='boolean')throw error(422,'Each contact must be an object with a boolean primary flag.');
    const name=required(c.name,'Contact name'),email=text(c.email,254)||null,phone=text(c.phone,60)||null;
    if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw error(422,'Invalid contact email.');
    if(c.isPrimary)primary++;if(primary>1)throw error(422,'Only one contact can be primary.');
    const old=c.id?existing.find(row=>row.id===id(c.id)):null;if(c.id&&!old)throw error(422,'Contact does not belong to this customer.');
    let contactId;
    if(old&&ids.has(old.id))throw error(422,'A contact cannot be repeated.');
    if(old){contactId=old.id;await db.prepare('UPDATE customer_contacts SET name=?,designation=?,phone=?,email=?,is_primary=?,updated_at=now() WHERE id=?').run(name,text(c.designation,200)||null,phone,email,c.isPrimary?1:0,old.id);}
    else contactId=(await db.prepare('INSERT INTO customer_contacts(customer_id,name,designation,phone,email,is_primary,created_by) VALUES(?,?,?,?,?,?,?)').run(customerId,name,text(c.designation,200)||null,phone,email,c.isPrimary?1:0,user.id)).insertedId;
    ids.add(contactId);await audit(db,user,'CUSTOMER_CONTACT',contactId,old,{name,email,phone,customerId},reason);
  }
  for(const old of existing)if(!ids.has(old.id)){
    await db.prepare("UPDATE customer_contacts SET status='ARCHIVED',is_deleted=true,updated_at=now() WHERE id=?").run(old.id);
    await audit(db,user,'CUSTOMER_CONTACT',old.id,old,{...old,status:'ARCHIVED',is_deleted:true},reason,'ARCHIVE');
  }
}
export async function savePartMapping(db,customerId,mappingId,body,user) {
  const reason=editReason(body,!!mappingId);
  return transaction(db,user,reason,async()=>{
    const selectedStatus=status(body.status||'ACTIVE',['ACTIVE','INACTIVE','ARCHIVED']);
    if(selectedStatus==='ARCHIVED'){
      if(!await db.prepare('SELECT id FROM customers WHERE id=?').get(id(customerId))||!await db.prepare('SELECT id FROM items WHERE id=?').get(id(body.itemId)))throw error(422,'Select an existing customer and item.');
    }else{await active(db,'customers',customerId,'customer');await active(db,'items',body.itemId,'item');}
    const itemId=id(body.itemId);
    const part=required(body.customerPartNumber,'Customer part number');
    const value=status(body.status||'ACTIVE',['ACTIVE','INACTIVE','ARCHIVED']);
    if(mappingId){const old=await db.prepare('SELECT * FROM crm_customer_part_mappings WHERE id=? AND customer_id=? FOR UPDATE').get(id(mappingId),id(customerId));if(!old)throw error(404,'Mapping not found.');await db.prepare('UPDATE crm_customer_part_mappings SET item_id=?,customer_part_number=?,status=?,is_deleted=? WHERE id=?').run(itemId,part,value,value==='ARCHIVED',old.id);return {...old,item_id:itemId,customer_part_number:part,status:value};}
    return {id:(await db.prepare('INSERT INTO crm_customer_part_mappings(customer_id,item_id,customer_part_number,status,is_deleted,created_by) VALUES(?,?,?,?,?,?)').run(id(customerId),itemId,part,value,value==='ARCHIVED',user.id)).insertedId};
  });
}
export async function customerHistory(db,customerId,tab,{financial=false}={}) {
  const customer=await customerDetail(db,customerId,{financial});
  if(tab==='dues')return {data:customer.dues};
  if(tab==='invoices')return {data:[],available:false,reason:'Stored imports do not yet expose normalized invoice records. No invoice history or totals are inferred.'};
  const tables={enquiries:['enquiries','enquiry_number'],quotes:['quotations','quotation_number'],orders:['sales_orders','order_number']};
  if(!tables[tab])throw error(404,'Unknown history tab.');
  const [table,number]=tables[tab];return {data:await db.prepare(`SELECT id,${number} AS number,status,created_at,updated_at FROM ${table} WHERE customer_id=? ORDER BY created_at DESC,id DESC LIMIT 100`).all(customer.id),limit:100};
}
export async function itemDetail(db,itemId,{financial=false}={}) {
  const row=await db.prepare('SELECT *,pack_size::text AS pack_size FROM items WHERE id=?').get(id(itemId));if(!row)throw error(404,'Item not found.');
  const storedProfile=await db.prepare('SELECT *,moq::text AS moq,list_price::text AS list_price,discount_percent::text AS discount_percent FROM crm_item_profiles WHERE item_id=?').get(row.id);row.profile=storedProfile||{};
  if(!storedProfile){const links=await db.prepare("SELECT company_id,tally_name FROM crm_tally_item_links WHERE item_id=? AND status='ACTIVE' AND NOT is_deleted").all(row.id);if(links.length===1)row.profile={...row.profile,company_id:links[0].company_id,tally_stock_name:links[0].tally_name};}
  const p=row.profile,rows=p.company_id?await db.prepare(`SELECT name,base_unit,closing_quantity_text,closing_rate_text,fetched_at${financial?',closing_value::text AS closing_value':''} FROM tally_stock_items WHERE company_id=? AND name=?`).all(p.company_id,p.tally_stock_name):[];
  row.stock={linked:rows.length===1,matchCount:rows.length,note:'Read-only Tally stock; no reservation, adjustment or unit conversion is applied.',...(rows.length===1?rows[0]:{})};
  row.prices=await db.prepare(`SELECT e.*,e.min_quantity::text AS min_quantity,e.unit_price::text AS unit_price,e.discount_percent::text AS discount_percent,l.name AS list_name,l.currency,l.effective_from,l.effective_to,l.discount_percent AS list_discount FROM crm_price_list_items e JOIN crm_price_lists l ON l.id=e.price_list_id WHERE e.item_id=? AND NOT e.is_deleted AND NOT l.is_deleted ORDER BY l.effective_from DESC,e.min_quantity`).all(row.id);
  return row;
}
export async function saveItem(db,itemId,body,user) {
  const reason=editReason(body,!!itemId);
  return transaction(db,user,reason,async()=>{
    const old=itemId?await db.prepare('SELECT *,pack_size::text AS pack_size FROM items WHERE id=? FOR UPDATE').get(id(itemId)):null;if(itemId&&!old)throw error(404,'Item not found.');
    let p=old?await db.prepare('SELECT *,moq::text AS moq,list_price::text AS list_price,discount_percent::text AS discount_percent FROM crm_item_profiles WHERE item_id=?').get(old.id):null;
    if(old&&!p){const links=await db.prepare("SELECT company_id,tally_name AS tally_stock_name FROM crm_tally_item_links WHERE item_id=? AND status='ACTIVE' AND NOT is_deleted").all(old.id);if(links.length===1)p=links[0];}
    const values=[required(body.partCode??old?.part_code,'Part number'),required(body.description??old?.description,'Description',4000),text(body.hsn??old?.hsn,20)||null,required(body.uom??old?.uom,'UOM',30),decimal(body.packSize??old?.pack_size??1,'Pack size',{positive:true}),status(body.status??old?.status??'ACTIVE',['ACTIVE','INACTIVE','SUPERSEDED']),user.id];
    let recordId=old?.id;
    if(old)await db.prepare('UPDATE items SET part_code=?,description=?,hsn=?,uom=?,pack_size=?,status=?,updated_by=?,updated_at=now() WHERE id=?').run(...values,recordId);
    else recordId=(await db.prepare('INSERT INTO items(part_code,description,hsn,uom,pack_size,status,updated_by,created_by) VALUES(?,?,?,?,?,?,?,?)').run(...values,user.id)).insertedId;
    const link=await validateLink(db,body.companyId??p?.company_id,body.tallyName??p?.tally_stock_name,'item');
    await profile(db,'crm_item_profiles','item_id',recordId,{moq:decimal(body.moq??p?.moq??1,'MOQ',{positive:true}),list_price:decimal(body.listPrice??p?.list_price??0,'List price'),discount_percent:decimal(body.discountPercent??p?.discount_percent??0,'Discount',{percent:true}),...link},user);
    const result=await itemDetail(db,recordId);await audit(db,user,'ITEM',recordId,old,result,reason);return result;
  });
}
export async function priceLists(db) {return db.prepare('SELECT * FROM crm_price_lists ORDER BY effective_from DESC,id DESC').all();}
export async function priceListDetail(db,listId) {const row=await db.prepare('SELECT * FROM crm_price_lists WHERE id=?').get(id(listId));if(!row)throw error(404,'Price list not found.');return {...row,entries:await db.prepare('SELECT e.*,e.min_quantity::text AS min_quantity,e.unit_price::text AS unit_price,e.discount_percent::text AS discount_percent,i.part_code FROM crm_price_list_items e JOIN items i ON i.id=e.item_id WHERE e.price_list_id=? AND NOT e.is_deleted ORDER BY e.id').all(row.id)};}
export async function savePriceList(db,listId,body,user) {
  const reason=editReason(body,!!listId);
  return transaction(db,user,reason,async()=>{
    if(!validDate(body.effectiveFrom)||body.effectiveTo&&!validDate(body.effectiveTo)||body.effectiveTo&&body.effectiveTo<body.effectiveFrom)throw error(422,'Provide a valid price-list date range.');
    const currency=required(body.currency||'INR','Currency',3).toUpperCase();if(!/^[A-Z]{3}$/.test(currency))throw error(422,'Currency must have three letters.');
    const values=[required(body.name,'Price-list name'),currency,body.effectiveFrom,body.effectiveTo||null,decimal(body.discountPercent??0,'Discount',{percent:true}),status(body.status||'ACTIVE',['ACTIVE','INACTIVE','ARCHIVED']),body.status==='ARCHIVED'];
    let recordId=listId?id(listId):null;
    if(recordId){if(!await db.prepare('SELECT id FROM crm_price_lists WHERE id=? FOR UPDATE').get(recordId))throw error(404,'Price list not found.');await db.prepare('UPDATE crm_price_lists SET name=?,currency=?,effective_from=?,effective_to=?,discount_percent=?,status=?,is_deleted=? WHERE id=?').run(...values,recordId);}
    else recordId=(await db.prepare('INSERT INTO crm_price_lists(name,currency,effective_from,effective_to,discount_percent,status,is_deleted,created_by) VALUES(?,?,?,?,?,?,?,?)').run(...values,user.id)).insertedId;
    if(!Array.isArray(body.entries)||body.entries.length>200)throw error(422,'Provide at most 200 price tiers.');
    const old=await db.prepare('SELECT *,min_quantity::text AS min_quantity FROM crm_price_list_items WHERE price_list_id=? FOR UPDATE').all(recordId),keep=new Set();
    for(const entry of body.entries){
      if(!entry||typeof entry!=='object'||Array.isArray(entry))throw error(422,'Each price tier must be an object.');
      const item=await active(db,'items',entry.itemId,'item'),minimum=decimal(entry.minQuantity??1,'Minimum quantity',{positive:true}),price=decimal(entry.unitPrice,'Unit price'),discount=decimal(entry.discountPercent??0,'Discount',{percent:true});
      const previous=entry.id?old.find(row=>row.id===id(entry.id)):old.find(row=>row.item_id===item&&decimalKey(row.min_quantity)===decimalKey(minimum));
      if(entry.id&&!previous)throw error(422,'Price tier belongs to another list.');
      let tierId;
      if(previous){tierId=previous.id;await db.prepare("UPDATE crm_price_list_items SET item_id=?,min_quantity=?,unit_price=?,discount_percent=?,status='ACTIVE',is_deleted=false WHERE id=?").run(item,minimum,price,discount,tierId);}
      else tierId=(await db.prepare('INSERT INTO crm_price_list_items(price_list_id,item_id,min_quantity,unit_price,discount_percent,created_by) VALUES(?,?,?,?,?,?)').run(recordId,item,minimum,price,discount,user.id)).insertedId;
      if(keep.has(tierId))throw error(422,'Duplicate price tier.');keep.add(tierId);
    }
    for(const row of old)if(!keep.has(row.id)&&!row.is_deleted)await db.prepare("UPDATE crm_price_list_items SET status='ARCHIVED',is_deleted=true WHERE id=?").run(row.id);
    return priceListDetail(db,recordId);
  });
}
export async function saveEnquiry(db,enquiryId,body,user) {
  const reason=editReason(body,!!enquiryId);
  return transaction(db,user,reason,async()=>{
    const old=enquiryId?await db.prepare('SELECT * FROM enquiries WHERE id=? FOR UPDATE').get(id(enquiryId)):null;
    if(enquiryId&&!old)throw error(404,'Enquiry not found.');if(old&&!['NEW','QUALIFIED'].includes(old.status))throw error(409,'Only open new enquiries can be revised.');
    const customer=await active(db,'customers',body.customerId,'customer'),owner=await active(db,'users',body.ownerId??user.id,'owner');
    if(body.expectedBy&&!validDate(body.expectedBy))throw error(422,'Expected-by must be a valid date.');
    if(!Array.isArray(body.lines)||!body.lines.length||body.lines.length>200)throw error(422,'Add between 1 and 200 enquiry items.');
    const lines=[];
    for(const line of body.lines){if(!line||typeof line!=='object'||Array.isArray(line))throw error(422,'Each enquiry line must be an object.');const itemId=await active(db,'items',line.itemId,'item');const item=await db.prepare('SELECT description FROM items WHERE id=?').get(itemId);lines.push({itemId,description:item.description,quantity:decimal(line.quantity,'Quantity',{positive:true})});}
    const values=[customer,required(body.subject,'Subject'),text(body.source,100)||null,body.expectedBy||null,owner,text(body.notes,10000)||null,user.id];let recordId=old?.id;
    if(old)await db.prepare('UPDATE enquiries SET customer_id=?,subject=?,source=?,expected_by=?,assigned_to=?,notes=?,updated_by=?,updated_at=now() WHERE id=?').run(...values,recordId);
    else {const number=(await db.prepare("SELECT nextval('enquiry_document_numbers') AS n").get()).n;recordId=(await db.prepare('INSERT INTO enquiries(customer_id,subject,source,expected_by,assigned_to,notes,updated_by,enquiry_number,created_by) VALUES(?,?,?,?,?,?,?,?,?)').run(...values,`ENQ-${new Date().getUTCFullYear()}-${String(number).padStart(5,'0')}`,user.id)).insertedId;}
    const previous=old?await db.prepare('SELECT * FROM enquiry_lines WHERE enquiry_id=? AND NOT is_deleted').all(recordId):[];
    for(const row of previous){await db.prepare("UPDATE enquiry_lines SET status='ARCHIVED',is_deleted=true,updated_at=now() WHERE id=?").run(row.id);await audit(db,user,'ENQUIRY_LINE',row.id,row,{...row,status:'ARCHIVED'},reason,'ARCHIVE');}
    for(const [position,line]of lines.entries()){const r=await db.prepare('INSERT INTO enquiry_lines(enquiry_id,item_id,description,quantity,position,created_by) VALUES(?,?,?,?,?,?)').run(recordId,line.itemId,line.description,line.quantity,position,user.id);await audit(db,user,'ENQUIRY_LINE',r.insertedId,null,line,reason);}
    await recordEnquiryRevision(db,recordId,user.id,reason);const result=await enquiryView(db,recordId);await audit(db,user,'ENQUIRY',recordId,old,result,reason);return result;
  });
}
export const enquiryTransitions={NEW:['QUOTED','CANCELLED'],QUALIFIED:['QUOTED','LOST','CANCELLED'],QUOTED:['WON','LOST','CANCELLED'],WON:[],LOST:[],CANCELLED:[]};
export async function changeEnquiryStatus(db,enquiryId,body,user) {
  const reason=required(body.reason,'Status-change reason',1000);
  return transaction(db,user,reason,async()=>{
    const old=await db.prepare('SELECT * FROM enquiries WHERE id=? FOR UPDATE').get(id(enquiryId));if(!old)throw error(404,'Enquiry not found.');
    if(!enquiryTransitions[old.status]?.includes(body.status))throw error(409,'That enquiry status transition is not allowed.');
    await db.prepare('UPDATE enquiries SET status=?,updated_by=?,updated_at=now() WHERE id=?').run(body.status,user.id,old.id);
    await recordEnquiryRevision(db,old.id,user.id,reason);const result=await enquiryView(db,old.id);await audit(db,user,'ENQUIRY',old.id,old,result,reason,'STATUS_CHANGE');return result;
  });
}
