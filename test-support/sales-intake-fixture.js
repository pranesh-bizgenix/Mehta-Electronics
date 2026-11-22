import {randomUUID} from 'node:crypto';
import {TransactionRunner} from '../src/core/runtime.js';
import {createModules} from '../src/modules/container.js';
import {getConfig} from '../src/config.js';
import {saveCustomer,saveItem,decideCustomerOnboarding} from '../src/crm-modules.js';
import {saveQuotePolicy,saveQuoteCost} from '../src/quotation-workflow.js';
import {fixtureRuleService} from './business-rule-fixture.js';
import {createAutomationCredentials} from '../src/modules/automation-api/credential-controller.js';
import {createSalesIntake} from '../src/modules/sales-intake/routes.js';

/** Explicit synthetic inputs, used only by the authorized rollback verifier. */
export async function salesIntakeFixture(db,{progress=()=>{}}={}){
 const tag='ZZTEST_'+randomUUID().slice(0,8),company=randomUUID(),connector=randomUUID(),session=randomUUID(),users={};
 progress('Opening rollback fixtures',{tag,company});
 for(const [key,role]of Object.entries({owner:'OWNER',reviewer:'OWNER',manager:'MANAGER',sales:'EXECUTIVE',store:'STORE_STAFF',otherStore:'STORE_STAFF',lead:'LOGISTICS_LEAD'}))users[key]=await db.prepare('INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES(?,?,?,?,0) RETURNING id,role').get(tag+'_'+key,tag+'_'+key+'@example.test',role,'not-a-login');
 const {owner,reviewer}=users,tx=new TransactionRunner(db);
 for(const user of [owner,reviewer])await db.prepare('INSERT INTO user_mfa(user_id,secret_ciphertext,enabled_at) VALUES(?,?,clock_timestamp()) RETURNING user_id').get(user.id,tag+'_not_a_real_mfa_secret');
 progress('Temporary staff created inside rollback');
 await tx.run(owner,tag+' source fixture',async()=>{
  await db.prepare('INSERT INTO tally_companies(id,name) VALUES(?,?) RETURNING id').get(company,tag+'_company');
  await db.prepare('INSERT INTO tally_connectors(id,profile_name,expected_company_name,token_hash) VALUES(?,?,?,?) RETURNING id').get(connector,tag+'_connector',tag+'_company',randomUUID());
  await db.prepare("INSERT INTO tally_upload_sessions(id,connector_id,company_name,sync_from,sync_to,status) VALUES(?,?,?,'2026-01-01','2026-12-31','stored') RETURNING id").get(session,connector,tag+'_company');
  await db.prepare("INSERT INTO tally_groups(company_id,id,source_key,session_id,name,parent_name,raw_record) VALUES(?,?,?,?,?,'Sundry Debtors','{}') RETURNING id").get(company,tag+'_group',tag+'_group',session,tag+'_debtors');
  await db.prepare("INSERT INTO tally_ledgers(company_id,id,source_key,session_id,name,parent_name,raw_record) VALUES(?,?,?,?,?,?, '{}') RETURNING id").get(company,tag+'_ledger',tag+'_ledger',session,tag+'_buyer',tag+'_debtors');
 });
 const customer=await saveCustomer(db,null,{name:tag+'_customer',gstin:'33ZZZZZ1234Z1Z5',stateCode:'33',creditLimit:'0',creditDays:0,ownerId:users.sales.id,companyId:company,tallyName:tag+'_buyer',reason:tag+' reviewed customer identity'},owner);
 await decideCustomerOnboarding(db,customer.id,{decision:'APPROVE',version:customer.onboarding.version,reason:tag+' independent onboarding'},reviewer);
 progress('Canonical customer onboarded inside rollback');
 const items=[];for(let i=0;i<2;i++){const item=await saveItem(db,null,{partCode:tag+'_item_'+i,description:tag+' test terminal '+i,uom:'NOS',hsn:'8536',packSize:'1',listPrice:'100',moq:'1',reason:tag+' explicit item'},owner);items.push(item);await saveQuoteCost(db,item.id,{unitCost:'50',reason:tag+' explicit cost'},owner);}
 await saveQuotePolicy(db,{floorPercent:'10',marginBasis:'LINE_AND_TOTAL',sellerState:'33',letterhead:{name:tag+'_issuer'},reason:tag+' temporary pricing'},owner);
 const rules=fixtureRuleService(db);
 await rules.set(owner,'discount.levels',{level1:{min:'0',max:'10'},level2:{min:'10.000001',max:'20'},level3:{min:'20.000001',max:'100'}},tag+' temporary discount bands');
 await rules.set(owner,'discount.role_limits',['OWNER','MANAGER','EXECUTIVE'].map(role=>({role,maximumPercent:'100'})),tag+' temporary role limits');
 await rules.set(owner,'quotation.approval_levels',[{name:tag+' independent review',permission:'quotations.approve',appliesTo:'ALL'}],tag+' temporary review');
 // A long remote rollback suite must not expire otherwise valid fixture stock
 // halfway through unrelated permission checks. Dedicated stale-source cases
 // explicitly exceed this temporary limit. It is never committed as policy.
 const stockPolicy={maximumSourceAgeMinutes:1440,reservedQuantityPointer:'/RESERVEDQTY',reservationsPointer:'/ORDERALLOCATIONS.LIST',reservationShape:'ARRAY',reservationQuantityPointer:'/ACTUALQTY',reservationKeyPointer:'/ORDERGUID',instructions:tag+' retained source quantities - temporary long-suite fixture only'};
 await rules.set(owner,'stock.availability',stockPolicy,tag+' temporary source mapping');
 progress('Existing quotation/stock rules temporarily configured inside rollback');
 // Existing permission administration, inside this rollback only. No live grants.
 for(const key of ['sales_intake.read','sales_intake.review'])await db.prepare("INSERT INTO role_permissions(role_key,permission_key) VALUES('EXECUTIVE',?) ON CONFLICT DO NOTHING RETURNING role_key").get(key);
 const config={...getConfig(),mfaEnabled:false,schedulerEnabled:false},modules=createModules({db,config});await modules.ready();
 const services=createSalesIntake({db,work:modules.services.work});
 const policy={ingestionEnabled:true,sellerState:'33',taxTreatment:'DOMESTIC_STANDARD',mailboxes:[tag.toLowerCase()+'@example.test'],assignment:{mode:'FIXED',userId:users.sales.id},tiers:{po:{basis:'PO',statuses:['ACTIVE'],includeCurrent:true,threshold:5,exactlyFive:'ELITE',companyScoped:true},enquiry:{basis:'ENQUIRY',statuses:['NEW','QUALIFIED','QUOTED'],includeCurrent:true,threshold:5,exactlyFive:'ELITE',companyScoped:true}},quotationValidityDays:30,locationStock:{balancesPointer:'/WAREHOUSES',namePointer:'/NAME',quantityPointer:'/QTY',reservedPointer:'/RESERVEDQTY',reservationsPointer:'/RESERVATIONS'},response:{qualifyingActions:['CUSTOMER_RESPONSE_REFERENCE'],instructions:tag+' evidence reference required',reassignmentAttribution:'FIRST_ASSIGNEE',excludeCancelled:true,pauseMode:'NO_PAUSES',reopenBehavior:'KEEP_FIRST_ASSIGNMENT_AND_RESPONSE'}};
 await services.intake.savePolicy(owner,company,{version:0,value:policy,reason:tag+' temporary intake decisions'});
 const credentials=createAutomationCredentials(db),credential=await credentials.create(owner,{id:randomUUID(),label:tag+'_credential',scopes:['automation.write.intake'],companyIds:[company],ownerId:owner.id,backupOwnerId:reviewer.id,expiresAt:new Date(Date.now()+6*3600_000).toISOString(),ratePerMinute:10000,ipAllowlist:[],reason:tag+' temporary credential'});
 const principal=await credentials.authenticate({authorization:'Bearer '+credential.token,companyId:company,scope:'automation.write.intake',peer:'127.0.0.1'});
 const receipt=async(item,onHand='1000',{at=new Date().toISOString(),reserved='0',reservations=[],locationReservations=[]}={})=>tx.run(owner,tag+' synthetic retained stock',async()=>{
  const id=tag+'_stock_'+randomUUID(),receiptId=randomUUID(),guid=tag+'_guid_'+item.id;
  await db.prepare("INSERT INTO tally_upload_sessions(id,connector_id,company_name,sync_from,sync_to,status,collection_metadata) VALUES(?,?,?,'2026-01-01','2026-12-31','stored',?::text::jsonb) RETURNING id").get(receiptId,connector,tag+'_company',JSON.stringify({stockXml:{sourceTimestamp:at}}));
  const raw={GUID:guid,RESERVEDQTY:reserved+' NOS','ORDERALLOCATIONS.LIST':reservations,WAREHOUSES:[{NAME:tag+'_warehouse',QTY:onHand+' NOS',RESERVEDQTY:reserved+' NOS',RESERVATIONS:locationReservations}]};
  await db.prepare("INSERT INTO tally_stock_items(company_id,id,source_key,session_id,name,base_unit,normalized_part_number,closing_quantity_text,raw_record,fetched_at) VALUES(?,?,?,?,?,'NOS',?,?,?::text::jsonb,clock_timestamp()) RETURNING id").get(company,id,id,receiptId,item.part_code,item.part_code,onHand+' NOS',JSON.stringify(raw));
  const old=await db.prepare('SELECT id FROM crm_tally_item_links WHERE company_id=? AND item_id=? AND tally_guid=?').get(company,item.id,guid);
  if(old)await db.prepare('UPDATE crm_tally_item_links SET tally_record_key=? WHERE id=?').run(id,old.id);else await db.prepare('INSERT INTO crm_tally_item_links(company_id,item_id,tally_name,tally_record_key,tally_guid,created_by) VALUES(?,?,?,?,?,?) RETURNING id').get(company,item.id,item.part_code,id,guid,owner.id);
  await db.prepare("INSERT INTO tally_run_datasets(company_id,session_id,dataset,status,processed_at) VALUES(?,?,'stockXml','imported',clock_timestamp()) RETURNING session_id").get(company,receiptId);
 });
 for(const item of items)await receipt(item);
 progress('Structured intake credential and retained stock fixtures ready');
 const payload=(i,type='CUSTOMER_PO')=>({schemaVersion:'1.0',eventId:tag+'_event_'+i,messageType:type,companyId:company,source:{system:'Make',mailbox:policy.mailboxes[0],messageId:tag+'_message_'+i,receivedAt:new Date(Date.now()-1000).toISOString(),originalText:tag+' fictional source'},provenance:{extractor:tag+'_extractor',version:'1',reference:tag+'_reference'},header:{buyerName:customer.name,customerId:customer.id,gstin:customer.gstin,placeOfSupply:'33',...(type==='CUSTOMER_PO'?{poNumber:tag+'_PO_'+i,poDate:new Date().toISOString().slice(0,10),totalPoValue:'118'}:{})},items:[{lineId:'1',itemId:items[0].id,productCode:items[0].part_code,description:items[0].description,quantity:'1',uom:'NOS',unitPrice:'100',discount:{kind:'PERCENT',value:'0'},gstRate:'18',taxableAmount:'100'}]});
 return {db,tag,company,users,customer,items,modules,config,services,policy,principal,credential,credentials,receipt,payload};
}
