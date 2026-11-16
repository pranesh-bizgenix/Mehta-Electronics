import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {Readable} from 'node:stream';
import {test} from 'node:test';
import {CustomerWizardRepository,CustomerWizardService,customerNameKey,customerPhoneKey} from '../src/modules/admin/tally-customer-wizard.js';
import {withTestTransaction} from '../test-support/transaction.js';
import {tallyFixture} from '../test-support/tally-fixture.js';
import {getConfig} from '../src/config.js';
import {createApp} from '../src/app.js';
import {tokenDigest} from '../src/security.js';
import {installPermissionProvider} from '../src/rbac.js';
import {customerDetail,listRecords} from '../src/crm-modules.js';
import {SetupRepository} from '../src/modules/admin/setup-service.js';

test('customer duplicate keys normalise name/phone without treating missing data as a match',()=>{
  assert.equal(customerNameKey(' Mehta & Co. '),customerNameKey('MEHTA CO'));
  assert.notEqual(customerNameKey('मेहता'),customerNameKey('अन्य'));
  assert.equal(customerPhoneKey('+91 98765-43210'),customerPhoneKey('9876543210'));
  assert.equal(customerPhoneKey(null),'');assert.equal(customerPhoneKey('123'),'');
});

test('wizard blocks ambiguous source IDs and requires explicit acknowledgement for similar names, never auto-linking',async()=>{
  const companyId=crypto.randomUUID(),user={id:1};
  const raw=[{record_key:'VERIFY-one',record_id:'VERIFY-revision',name:'VERIFY- Name Co',parent_name:'Sundry Debtors',summary_fields:{'/stored/tally_guid':'VERIFY-guid'}},
    {record_key:'VERIFY-two',record_id:'VERIFY-revision2',name:'VERIFY- Name Other',parent_name:'Sundry Debtors',summary_fields:{'/stored/tally_guid':'verify-GUID'}}];
  const customer={id:2,name:'VERIFY-Name & Co',gstin:null,status:'ACTIVE',phones:[]};
  const service=new CustomerWizardService({repository:{company:async()=>({id:companyId,name:'VERIFY-Company'}),sources:async()=>raw,groups:async()=>[],customers:async()=>[customer],links:async()=>[]},access:{require:()=>{}}});
  const entry={recordKey:'VERIFY-one',action:'create',creditLimit:'0',creditDays:0,acknowledgeDuplicates:true};
  const body={companyId,entries:[entry],reason:'VERIFY- review'};
  let result=await service.preview(user,body);assert.equal(result.canSave,false);assert.match(result.rows[0].issues.join(' '),/ambiguous/);
  raw.pop();
  result=await service.preview(user,{...body,entries:[{...entry,acknowledgeDuplicates:false}]});assert.equal(result.canSave,false);assert.match(result.rows[0].issues.join(' '),/acknowledge/);
  result=await service.preview(user,body);assert.equal(result.canSave,true);assert.equal(result.rows[0].outcome,'CREATE_AND_LINK');assert.equal(result.rows[0].target,null);
  const link=await service.preview(user,{...body,entries:[{recordKey:'VERIFY-one',action:'link',customerId:2}]});assert.equal(link.rows[0].outcome,'LINK_EXISTING');
  const repeated=await service.preview(user,{...body,entries:[entry,entry]});assert.equal(repeated.canSave,false);
});

test('reviewed customer wizard: scoped candidates, duplicates, preview, atomic/idempotent links, audits and stable CRM reads',()=>withTestTransaction(async db=>{
  const a=await tallyFixture(db,'VERIFY-Wizard Company A'),b=await tallyFixture(db,'VERIFY-Wizard Company B');
  await a.insert('tally_groups',{id:'VERIFY-wiz_group',name:'VERIFY-Wizard Debtors',parent_name:'Sundry Debtors'});
  await a.insert('tally_groups',{id:'VERIFY-wiz_child',name:'VERIFY-Wizard Child',parent_name:'VERIFY-Wizard Debtors'});
  const ledger=(id,name,extra={})=>a.insert('tally_ledgers',{id,name,parent_name:'VERIFY-Wizard Child',tally_guid:`VERIFY-guid_${id}`,raw_record:{GUID:`VERIFY-guid_${id}`},...extra});
  await ledger('VERIFY-wiz_new','VERIFY-New Wizard Customer',{phone:'9000012345',gstin:'27ABCDE2234F1Z5'});
  await ledger('VERIFY-wiz_dup','VERIFY- Existing Co',{phone:'+91 9876543210',gstin:'27ZZZZZ0042Z1Z5'});
  await ledger('VERIFY-wiz_missing','VERIFY-Unstable name only',{tally_guid:null,raw_record:{NAME:'VERIFY-Unstable name only'}});
  await ledger('VERIFY-wiz_bank','VERIFY-Not a customer',{parent_name:'Bank Accounts'});
  await ledger('VERIFY-wiz_master','VERIFY-Master only',{tally_guid:null,master_id:'987654321',raw_record:{MASTERID:'987654321'}});
  await ledger('VERIFY-wiz_stale','VERIFY-Stale Preview Source',{phone:'9000098765'});
  await ledger('VERIFY-wiz_rollback','VERIFY-Rollback Customer');
  await b.insert('tally_ledgers',{id:'VERIFY-wiz_other',name:'VERIFY-Other Company Customer',parent_name:'Sundry Debtors',tally_guid:'VERIFY-other_guid'});
  const make=async(role,suffix)=>({role,id:(await db.sql`INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES(${`VERIFY-wizard_${suffix}`},${`VERIFY-wizard_${suffix}@example.test`},${role},'not-a-login',0) RETURNING id`)[0].id});
  const owner=await make('OWNER','owner'),store=await make('STORE_STAFF','store'),accounts=await make('ACCOUNTS','accounts');
  const existing=(await db.sql`INSERT INTO customers(name,normalized_name,gstin,credit_limit,credit_days,created_by,updated_by) VALUES('VERIFY-Existing & Co','ZZTESTEXISTINGCO','27ZZZZZ0042Z1Z5',222.123456,17,${owner.id},${owner.id}) RETURNING id`)[0].id;
  await db.sql`INSERT INTO customer_contacts(customer_id,name,phone,is_primary,created_by,updated_by) VALUES(${existing},'VERIFY-contact','98765 43210',1,${owner.id},${owner.id})`;
  const app=createApp({db,config:getConfig({mfaEnabled:false})}),tokens=new Map();
  for(const person of [owner,store,accounts]){const token=crypto.randomUUID();tokens.set(person.id,token);await db.sql`INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at) VALUES(${person.id},${tokenDigest(token)},'VERIFY-csrf',now()+interval '1 hour')`;}
  async function request(method,path,actor=owner,body,headers={}){
    const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);Object.assign(req,{method,url:path,headers:{host:'localhost','content-type':'application/json','x-csrf-token':'VERIFY-csrf',...(actor?{cookie:`crm_session=${tokens.get(actor.id)}`}:{}),...headers},socket:{remoteAddress:'test'}});
    const res={status:0,headersSent:false,setHeader(){},writeHead(status){this.status=status;this.headersSent=true;},end(value){this.body=JSON.parse(String(value));}};
    await app(req,res);return res;
  }
  const path='/api/v1/tally/customer-wizard',repo=new CustomerWizardRepository(db);
  const rawBefore=await db.sql`SELECT id,raw_record,name,parent_name FROM tally_ledgers WHERE company_id IN (${a.company},${b.company}) ORDER BY id`;
  try{
    assert.equal((await request('GET',`${path}?companyId=${a.company}`,null)).status,401);
    assert.equal((await request('GET',`${path}?companyId=${a.company}`,store)).status,403);
    assert.equal((await request('GET',path)).status,422);
    assert.equal((await request('GET',`${path}?companyId=invalid`)).status,422);
    const listing=await request('GET',`${path}?companyId=${a.company}&pageSize=100`);assert.equal(listing.status,200);
    const rows=listing.body.data.data;
    assert.ok(!rows.some(r=>r.name==='VERIFY-Not a customer'||r.name==='VERIFY-Other Company Customer'));
    const find=id=>rows.find(r=>r.recordKey===id);
    assert.equal(find('VERIFY-wiz_missing').stable,false);assert.equal(find('VERIFY-wiz_master').stable,true);
    assert.deepEqual(find('VERIFY-wiz_dup').duplicates.find(c=>c.id===existing).reasons,['GSTIN','NORMALISED_NAME','PHONE']);
    const filtered=await request('GET',`${path}?companyId=${a.company}&duplicates=with&group=VERIFY-Wizard%20Child`);
    assert.ok(filtered.body.data.data.every(r=>r.duplicates.length&&r.parent_name==='VERIFY-Wizard Child'));
    assert.ok((await request('GET',`${path}/targets?companyId=${a.company}&search=Existing`)).body.data.data.some(c=>c.id===existing));
    const createEntry={recordKey:'VERIFY-wiz_new',action:'create',creditLimit:'99999999999999.123456',creditDays:30};
    const body={companyId:a.company,entries:[createEntry,{recordKey:'VERIFY-wiz_dup',action:'link',customerId:existing}],reason:'VERIFY- confirmed customer review'};
    assert.equal((await request('POST',`${path}/preview`,accounts,body)).status,403);
    const accountsLink=await request('POST',`${path}/preview`,accounts,{...body,entries:[body.entries[1]]});assert.equal(accountsLink.status,200);assert.equal(accountsLink.body.data.canSave,true);
    assert.ok(!JSON.stringify(accountsLink.body).includes('closing_balance'));
    assert.equal((await request('POST',`${path}/preview`,owner,body,{'x-csrf-token':'bad'})).status,403);
    assert.equal((await request('POST',`${path}/preview`,store,body)).status,403);
    assert.equal((await request('POST',`/api/v1/tally/inspection/customers/create-crm?companyId=${a.company}`,owner,{recordKeys:['VERIFY-wiz_new']})).status,422);
    assert.equal((await request('POST',`${path}/preview`,owner,{...body,reason:''})).status,422);
    assert.equal((await request('POST',`${path}/preview`,owner,{...body,entries:Array.from({length:101},()=>createEntry)})).status,422);
    for(const entry of [{recordKey:'VERIFY-wiz_missing',action:'create'},{recordKey:'VERIFY-wiz_bank',action:'create'},{recordKey:'VERIFY-wiz_other',action:'create'},{recordKey:'VERIFY-wiz_new',action:'create'},{...createEntry,creditLimit:'1e3'},{recordKey:'VERIFY-wiz_dup',action:'create',creditLimit:'0',creditDays:0,acknowledgeDuplicates:true}]){
      const p=await request('POST',`${path}/preview`,owner,{...body,entries:[entry]});assert.equal(p.status,200);assert.equal(p.body.data.canSave,false);
    }
    const beforeCustomer=(await db.sql`SELECT name,credit_limit::text AS limit,credit_days FROM customers WHERE id=${existing}`)[0];
    const beforeLinks=(await db.sql`SELECT count(*) AS n FROM tally_visibility_crm_links WHERE company_id=${a.company}`)[0].n;
    const preview=await request('POST',`${path}/preview`,owner,body);assert.equal(preview.status,200);assert.equal(preview.body.data.canSave,true);
    assert.equal((await db.sql`SELECT count(*) AS n FROM tally_visibility_crm_links WHERE company_id=${a.company}`)[0].n,beforeLinks);
    assert.equal((await db.sql`SELECT count(*) AS n FROM customers WHERE name='VERIFY-New Wizard Customer'`)[0].n,0);
    const command={...body,previewFingerprint:preview.body.data.previewFingerprint};
    assert.equal((await request('POST',`${path}/commit`,owner,command)).status,422);
    const key=crypto.randomUUID(),headers={'idempotency-key':key};
    const saved=await request('POST',`${path}/commit`,owner,command,headers);assert.equal(saved.status,200);
    const replay=await request('POST',`${path}/commit`,owner,command,headers);assert.equal(replay.status,200);assert.deepEqual(replay.body,saved.body);
    assert.equal((await request('POST',`${path}/commit`,owner,{...command,companyId:b.company},headers)).status,409);
    const created=saved.body.data.results.find(r=>r.recordKey==='VERIFY-wiz_new').customerId;
    assert.equal((await db.sql`SELECT credit_limit::text AS value FROM customers WHERE id=${created}`)[0].value,'99999999999999.123456');
    assert.deepEqual((await db.sql`SELECT name,credit_limit::text AS limit,credit_days FROM customers WHERE id=${existing}`)[0],beforeCustomer);
    const link=await db.sql`SELECT company_id,entity,record_key,crm_id FROM tally_visibility_crm_links WHERE company_id=${a.company} ORDER BY record_key`;
    assert.equal(link.length,beforeLinks+2);assert.ok(link.every(l=>l.company_id===a.company&&l.entity==='ledgers'));
    const audits=await db.sql`SELECT new_value,reason FROM audit_logs WHERE entity='TALLY_CRM_LINK' AND record_id='VERIFY-wiz_new' AND action='BULK_CREATE_AND_LINK'`;
    assert.equal(audits.length,1);assert.equal(audits[0].reason,body.reason);assert.equal(JSON.parse(audits[0].new_value).tallyGuid,'VERIFY-guid_VERIFY-wiz_new');
    const detail=await customerDetail(db,created);assert.equal(detail.tally.linked,true);assert.equal(detail.tally.companyId,a.company);assert.equal(detail.dues.available,false);assert.equal('closingBalance' in detail.dues,false);
    const crmList=await listRecords(db,'customers',new URL('http://localhost?search=VERIFY-New%20Wizard'));assert.equal(crmList.data.find(r=>r.id===created).tally_linked,true);
    assert.ok((await new SetupRepository(db).mappings('customers')).linked>=2);
    const companyB=await request('GET',`${path}?companyId=${b.company}&linkage=all`);assert.deepEqual(companyB.body.data.data.map(r=>r.recordKey),['VERIFY-wiz_other']);
    const bodyB={...body,companyId:b.company,entries:[{recordKey:'VERIFY-wiz_other',action:'link',customerId:existing}]};
    const previewB=await request('POST',`${path}/preview`,accounts,bodyB);assert.equal(previewB.body.data.canSave,true);
    assert.equal((await request('POST',`${path}/commit`,accounts,{...bodyB,previewFingerprint:previewB.body.data.previewFingerprint},{'idempotency-key':crypto.randomUUID()})).status,200);
    const multi=await customerDetail(db,existing,{financial:true});assert.equal(multi.tally.links.length,2);assert.equal(multi.tally.companyId,null);assert.equal(multi.dues.available,false);assert.equal('closingBalance' in multi.dues,false);
    const repeated=await request('POST',`${path}/preview`,owner,body);assert.ok(repeated.body.data.rows.every(r=>r.outcome==='ALREADY_LINKED'));
    const already=await request('POST',`${path}/commit`,owner,{...body,previewFingerprint:repeated.body.data.previewFingerprint},{'idempotency-key':crypto.randomUUID()});assert.equal(already.status,200);
    const conflictBody={...body,entries:[{recordKey:'VERIFY-wiz_master',action:'link',customerId:existing}]};
    assert.equal((await request('POST',`${path}/preview`,owner,conflictBody)).body.data.canSave,false);
    const staleBody={...body,entries:[{...createEntry,recordKey:'VERIFY-wiz_stale'}]};
    const stale=await request('POST',`${path}/preview`,owner,staleBody);assert.equal(stale.body.data.canSave,true);
    await db.sql`INSERT INTO customer_contacts(customer_id,name,phone,created_by,updated_by) VALUES(${existing},'VERIFY-new_duplicate','9000098765',${owner.id},${owner.id})`;
    assert.equal((await request('POST',`${path}/commit`,owner,{...staleBody,previewFingerprint:stale.body.data.previewFingerprint},{'idempotency-key':crypto.randomUUID()})).status,409);
    const failureBody={...body,entries:[{...createEntry,recordKey:'VERIFY-wiz_master'},{...createEntry,recordKey:'VERIFY-wiz_rollback'}]};
    let auditCalls=0;
    const failing=new CustomerWizardService({repository:repo,access:app.modules.services.access,transactions:app.modules.transactions,audit:{record:async()=>{if(++auditCalls===3)throw new Error('VERIFY- audit failed');}}});
    const failurePreview=await failing.preview(owner,failureBody);
    await assert.rejects(failing.commit(owner,{...failureBody,previewFingerprint:failurePreview.previewFingerprint}),/VERIFY- audit failed/);
    assert.equal((await db.sql`SELECT count(*) AS n FROM customers WHERE name='VERIFY-Rollback Customer'`)[0].n,0);
    assert.equal((await db.sql`SELECT count(*) AS n FROM customers WHERE name='VERIFY-Master only'`)[0].n,0);
    assert.equal((await db.sql`SELECT count(*) AS n FROM tally_visibility_crm_links WHERE company_id=${a.company} AND record_key='VERIFY-wiz_rollback'`)[0].n,0);
    assert.equal((await db.sql`SELECT count(*) AS n FROM tally_visibility_crm_links WHERE company_id=${a.company} AND record_key='VERIFY-wiz_master'`)[0].n,0);
    await db.sql`INSERT INTO tally_visibility_records(id,company_id,entity,record_key,session_id,name,parent_name,raw_record,fields,content_hash,observed_at)
      SELECT 'VERIFY-wizard_renamed_snapshot',company_id,entity,record_key,session_id,'VERIFY-Renamed Tally customer',parent_name,raw_record,
      fields||jsonb_build_object('/stored/name','VERIFY-Renamed Tally customer'),'VERIFY-renamed_hash',observed_at+interval '1 hour'
      FROM tally_visibility_records WHERE company_id=${a.company} AND record_key='VERIFY-wiz_new' LIMIT 1`;
    const renamed=await customerDetail(db,created);assert.equal(renamed.tally.linked,true);assert.equal(renamed.tally.name,'VERIFY-Renamed Tally customer');assert.equal(renamed.name,'VERIFY-New Wizard Customer');
    assert.deepEqual(await db.sql`SELECT id,raw_record,name,parent_name FROM tally_ledgers WHERE company_id IN (${a.company},${b.company}) ORDER BY id`,rawBefore);
  }finally{await app.close();installPermissionProvider(null);}
}));
