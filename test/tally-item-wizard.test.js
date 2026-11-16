import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {Readable} from 'node:stream';
import {test} from 'node:test';
import {canonicalItemSources} from '../src/tally-item-links.js';
import {ItemWizardRepository,ItemWizardService,itemPartKey} from '../src/modules/admin/tally-item-wizard.js';
import {withTestTransaction} from '../test-support/transaction.js';
import {tallyFixture} from '../test-support/tally-fixture.js';
import {createApp} from '../src/app.js';
import {getConfig} from '../src/config.js';
import {tokenDigest} from '../src/security.js';
import {installPermissionProvider} from '../src/rbac.js';
import {itemDetail,listRecords} from '../src/crm-modules.js';
import {TallyVisibilityRepository} from '../src/tally-visibility-repository.js';

test('item identity follows the newest GUID observation across renames, rejects ties and keeps missing IDs unselectable',()=>{
  assert.equal(itemPartKey('Part - 01'),itemPartKey('PART_01'));assert.notEqual(itemPartKey('भाग'),itemPartKey('अन्य'));
  const row=(key,guid,at)=>({record_key:key,record_id:key,name:key,guid,observed_at:at});
  const rows=canonicalItemSources([row('VERIFY-old','VERIFY-guid','2026-01-01T00:00:00Z'),row('VERIFY-new','verify-GUID','2026-02-01T00:00:00Z'),row('VERIFY-no_id',null,'2026-02-01T00:00:00Z')]);
  assert.equal(rows.length,2);assert.equal(rows.find(r=>r.guid).record_key,'VERIFY-new');assert.equal(rows.find(r=>r.guid).stable,true);assert.equal(rows.find(r=>!r.guid).stable,false);
  const tied=canonicalItemSources([row('VERIFY-a','VERIFY-same','2026-01-01T00:00:00Z'),row('VERIFY-b','VERIFY-same','2026-01-01T00:00:00Z')]);assert.equal(tied[0].stable,false);
  const master=canonicalItemSources([{...row('VERIFY-master',null,'2026-01-01T00:00:00Z'),master_id:'77'}]);assert.equal(master[0].stable,true);
  const precise=canonicalItemSources([row('VERIFY-before','VERIFY-quick',new Date('2026-01-01T00:00:00.001Z')),row('VERIFY-after','VERIFY-quick',new Date('2026-01-01T00:00:00.002Z'))]);assert.equal(precise[0].record_key,'VERIFY-after');assert.equal(precise[0].stable,true);
});

test('item review rejects missing pack size and unit mismatch; HSN/UOM similarities need review rather than automatic linking',async()=>{
  const companyId=crypto.randomUUID(),source={record_key:'VERIFY-source',record_id:'VERIFY-revision',name:'VERIFY-Tally item',part_code:'VERIFY-Part-1',hsn:'8536',uom:'NOS',brand:null,stable:true,guid:'VERIFY-GUID'};
  const target={id:2,part_code:'VERIFY-PART1',hsn:'8536',uom:'NOS',status:'ACTIVE'};
  const w=new ItemWizardService({repository:{company:async()=>({id:companyId}),sources:async()=>[source],items:async()=>[target],links:async()=>[],visibilityLinks:async()=>[]},access:{require:()=>{}}});
  const body={companyId,reason:'VERIFY- review',entries:[{recordKey:source.record_key,action:'create'}]};
  assert.equal((await w.preview({},body)).canSave,false);
  const chosen={...body,entries:[{...body.entries[0],packSize:'1'}]};assert.equal((await w.preview({},chosen)).canSave,false);
  chosen.entries[0].acknowledgeDuplicates=true;const reviewed=await w.preview({},chosen);assert.equal(reviewed.canSave,true);assert.equal(reviewed.rows[0].target,null);assert.equal(reviewed.rows[0].outcome,'CREATE_AND_LINK');
  target.uom='BOX';const link={...body,entries:[{recordKey:source.record_key,action:'link',itemId:2}]};assert.equal((await w.preview({},link)).canSave,false);
});

test('item wizard uses canonical item links, selected company, review/idempotency/audit and rollback without writing Tally',()=>withTestTransaction(async db=>{
  const a=await tallyFixture(db,'VERIFY-Item Wizard A'),b=await tallyFixture(db,'VERIFY-Item Wizard B');
  const add=(id,name,extra={})=>a.insert('tally_stock_items',{id,name,parent_name:'VERIFY-Cables',base_unit:'NOS',hsn:'8536',raw_record:{GUID:{'#text':`VERIFY-GUID_${id}`},BRANDNAME:{'#text':'VERIFY-Brand_A'}},...extra});
  await add('VERIFY-iw_new','VERIFY-New Tally item',{raw_record:{GUID:{'#text':'VERIFY-GUID_new'},PARTNO:{'#text':'VERIFY-NEW_PART'},BRANDNAME:{'#text':'VERIFY-Brand_A'}},closing_quantity_text:'15 NOS',closing_value:'9999999999999999.99',closing_rate_text:'10 / NOS'});
  await add('VERIFY-iw_dup','VERIFY-Duplicate Tally item',{raw_record:{GUID:'VERIFY-GUID_dup',PARTNO:'VERIFY-PART-EXIST',BRAND:'VERIFY-Brand_B'}});
  await add('VERIFY-iw_missing','VERIFY-Missing ID',{raw_record:{}});
  await add('VERIFY-iw_unit','VERIFY-Missing unit',{base_unit:null});
  await add('VERIFY-iw_legacy','VERIFY-Legacy Tally item');
  await add('VERIFY-iw_stale','VERIFY-Stale item');await add('VERIFY-iw_rb1','VERIFY-Rollback item 1');await add('VERIFY-iw_rb2','VERIFY-Rollback item 2');
  await b.insert('tally_stock_items',{id:'VERIFY-iw_other',name:'VERIFY-Other company item',base_unit:'NOS',hsn:'8536',raw_record:{GUID:'VERIFY-GUID_other'}});
  const make=async(role,suffix)=>({role,id:(await db.sql`INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES(${`VERIFY-item_${suffix}`},${`VERIFY-item_${suffix}@example.test`},${role},'not-a-login',0) RETURNING id`)[0].id});
  const owner=await make('OWNER','owner'),reader=await make('EXECUTIVE','reader'),store=await make('STORE_STAFF','store');
  const product=async(code,uom='NOS',hsn='8536')=>(await db.sql`INSERT INTO items(part_code,description,hsn,uom,pack_size,created_by,updated_by) VALUES(${code},'VERIFY- fixture product',${hsn},${uom},2,${owner.id},${owner.id}) RETURNING id`)[0].id;
  const existing=await product('VERIFY-PART_EXIST'),legacyItem=await product('VERIFY-LEGACY_PART'),wrongUnit=await product('VERIFY-WRONG_UNIT','BOX');
  await db.prepare("SELECT set_config('mehta.actor_id',?,true),set_config('mehta.audit_reason','VERIFY- fixture setup',true)").get(String(owner.id));
  const legacyId=(await db.sql`INSERT INTO crm_tally_item_links(company_id,item_id,tally_name,created_by) VALUES(${a.company},${legacyItem},'VERIFY-Legacy Tally item',${owner.id}) RETURNING id`)[0].id;
  const rawBefore=await db.sql`SELECT id,name,raw_record FROM tally_stock_items WHERE company_id IN (${a.company},${b.company}) ORDER BY id`;
  const app=createApp({db,config:getConfig({mfaEnabled:false})}),tokens=new Map();
  for(const user of [owner,reader,store]){const token=crypto.randomUUID();tokens.set(user.id,token);await db.sql`INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at) VALUES(${user.id},${tokenDigest(token)},'VERIFY-csrf',now()+interval '1 hour')`;}
  async function request(method,path,actor=owner,body,headers={}){const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);Object.assign(req,{method,url:path,headers:{host:'localhost','content-type':'application/json','x-csrf-token':'VERIFY-csrf',...(actor?{cookie:`crm_session=${tokens.get(actor.id)}`}:{}),...headers},socket:{remoteAddress:'test'}});const res={status:0,headersSent:false,setHeader(){},writeHead(s){this.status=s;this.headersSent=true;},end(v){this.body=JSON.parse(String(v));}};await app(req,res);return res;}
  const path='/api/v1/tally/item-wizard',base={companyId:a.company,reason:'VERIFY- confirmed item mapping'},entry={recordKey:'VERIFY-iw_new',action:'create',packSize:'12.500001',acknowledgeDuplicates:true};
  try{
    assert.equal((await request('GET',`${path}?companyId=${a.company}`,null)).status,401);assert.equal((await request('GET',`${path}?companyId=${a.company}`,store)).status,403);assert.equal((await request('GET',path)).status,422);
    const listing=await request('GET',`${path}?companyId=${a.company}&pageSize=100&linkage=all`,reader);assert.equal(listing.status,200);
    const rows=listing.body.data.data;assert.ok(!rows.some(r=>r.record_key==='VERIFY-iw_other'));assert.equal(rows.find(r=>r.record_key==='VERIFY-iw_missing').stable,false);
    const dup=rows.find(r=>r.record_key==='VERIFY-iw_dup').duplicates.find(d=>d.id===existing);assert.deepEqual(dup.reasons,['PART_NUMBER','HSN_UOM']);
    assert.ok(!JSON.stringify(listing.body).includes('closing_value'));assert.ok(!JSON.stringify(listing.body).includes('closing_rate_text'));
    const filtered=await request('GET',`${path}?companyId=${a.company}&brand=VERIFY-Brand_B&group=VERIFY-Cables`);assert.deepEqual(filtered.body.data.data.map(r=>r.record_key),['VERIFY-iw_dup']);
    const missing=await request('GET',`${path}?companyId=${a.company}&brandStatus=missing`);assert.ok(missing.body.data.data.every(r=>!r.brand));
    const body={...base,entries:[entry,{recordKey:'VERIFY-iw_dup',action:'link',itemId:existing},{recordKey:'VERIFY-iw_legacy',action:'link',itemId:legacyItem}]};
    assert.equal((await request('POST',`${path}/preview`,reader,body)).status,403);assert.equal((await request('POST',`${path}/preview`,owner,body,{'x-csrf-token':'bad'})).status,403);
    assert.equal((await request('POST',`${path}/preview`,owner,{...body,reason:''})).status,422);
    assert.equal((await request('POST',`${path}/preview`,owner,{...body,entries:Array.from({length:101},()=>entry)})).status,422);
    assert.equal((await request('POST',`/api/v1/tally/inspection/items/create-crm?companyId=${a.company}`,owner,{recordKeys:[entry.recordKey]})).status,422);
    for(const bad of [{...entry,recordKey:'VERIFY-iw_missing'},{...entry,recordKey:'VERIFY-iw_unit'},{...entry,recordKey:'VERIFY-iw_other'},{...entry,packSize:'0'},{...entry,packSize:'1e3'},{recordKey:'VERIFY-iw_dup',action:'link',itemId:wrongUnit}])assert.equal((await request('POST',`${path}/preview`,owner,{...base,entries:[bad]})).body.data.canSave,false);
    const countBefore=(await db.sql`SELECT count(*) AS n FROM items`)[0].n,oldTarget=(await db.sql`SELECT part_code,hsn,uom,pack_size::text AS pack_size FROM items WHERE id=${existing}`)[0];
    const preview=await request('POST',`${path}/preview`,owner,body);assert.equal(preview.status,200);assert.equal(preview.body.data.canSave,true);assert.equal(preview.body.data.rows[2].outcome,'CONFIRM_LEGACY_LINK');
    assert.equal((await db.sql`SELECT count(*) AS n FROM items`)[0].n,countBefore);
    const command={...body,previewFingerprint:preview.body.data.previewFingerprint},headers={'idempotency-key':crypto.randomUUID()};
    assert.equal((await request('POST',`${path}/commit`,owner,command)).status,422);
    const saved=await request('POST',`${path}/commit`,owner,command,headers);assert.equal(saved.status,200);
    assert.deepEqual((await request('POST',`${path}/commit`,owner,command,headers)).body,saved.body);
    assert.equal((await request('POST',`${path}/commit`,owner,{...command,companyId:b.company},headers)).status,409);
    const created=saved.body.data.results[0].itemId;
    assert.equal((await db.sql`SELECT pack_size::text AS pack FROM items WHERE id=${created}`)[0].pack,'12.500001');
    assert.deepEqual((await db.sql`SELECT part_code,hsn,uom,pack_size::text AS pack_size FROM items WHERE id=${existing}`)[0],oldTarget);
    const metadata=(await db.sql`SELECT * FROM crm_tally_item_links WHERE company_id=${a.company} AND item_id=${created}`)[0];assert.equal(metadata.tally_guid,'VERIFY-GUID_new');assert.equal(metadata.tally_record_key,'VERIFY-iw_new');
    const indexItem=await product('VERIFY-GUID_INDEX_CHECK');
    await assert.rejects(db.sql`INSERT INTO crm_tally_item_links(company_id,item_id,tally_name,tally_record_key,tally_guid,created_by) VALUES(${a.company},${indexItem},'VERIFY-unique_name','VERIFY-unique_key','verify-guid_NEW',${owner.id})`,{code:'23505'});
    assert.equal((await db.sql`SELECT tally_guid FROM crm_tally_item_links WHERE id=${legacyId}`)[0].tally_guid,'VERIFY-GUID_VERIFY-iw_legacy');
    const audit=await db.sql`SELECT reason,new_value FROM audit_logs WHERE entity='TALLY_ITEM_LINK' AND record_id=${String(metadata.id)}`;assert.equal(audit.length,1);assert.equal(audit[0].reason,base.reason);
    const stock=await itemDetail(db,created);assert.equal(stock.stock.linked,true);assert.equal(stock.stock.companyId,a.company);assert.equal('closing_value' in stock.stock,false);
    assert.equal((await itemDetail(db,created,{financial:true})).stock.closing_value,'9999999999999999.99');
    assert.equal((await listRecords(db,'items',new URL('http://localhost?search=VERIFY-NEW_PART'))).data.find(i=>i.id===created).tally_linked,true);
    assert.ok((await new TallyVisibilityRepository(db).links(a.company,'items')).some(l=>l.record_key==='VERIFY-iw_new'&&l.crm_id===created));
    const again=await request('POST',`${path}/preview`,owner,body);assert.ok(again.body.data.rows.every(r=>r.outcome==='ALREADY_LINKED'));
    const staleBody={...base,entries:[{...entry,recordKey:'VERIFY-iw_stale',partCode:'VERIFY-STALE_CODE'}]},stale=await request('POST',`${path}/preview`,owner,staleBody);assert.equal(stale.body.data.canSave,true);
    await product('VERIFY-STALE_CODE');assert.equal((await request('POST',`${path}/commit`,owner,{...staleBody,previewFingerprint:stale.body.data.previewFingerprint},{'idempotency-key':crypto.randomUUID()})).status,409);
    const failingBody={...base,entries:[{...entry,recordKey:'VERIFY-iw_rb1'},{...entry,recordKey:'VERIFY-iw_rb2'}]};let audits=0;
    const service=new ItemWizardService({repository:new ItemWizardRepository(db),access:app.modules.services.access,transactions:app.modules.transactions,audit:{record:async()=>{if(++audits===3)throw new Error('VERIFY- item audit failure');}}});
    const failedPreview=await service.preview(owner,failingBody);assert.equal(failedPreview.canSave,true);
    await assert.rejects(service.commit(owner,{...failingBody,previewFingerprint:failedPreview.previewFingerprint}),/VERIFY- item audit failure/);
    assert.equal((await db.sql`SELECT count(*) AS n FROM items WHERE part_code IN ('VERIFY-Rollback item 1','VERIFY-Rollback item 2')`)[0].n,0);
    assert.equal((await db.sql`SELECT count(*) AS n FROM crm_tally_item_links WHERE company_id=${a.company} AND tally_record_key IN ('VERIFY-iw_rb1','VERIFY-iw_rb2')`)[0].n,0);
    await db.sql`INSERT INTO tally_visibility_records(id,company_id,entity,record_key,session_id,name,parent_name,raw_record,fields,content_hash,observed_at)
      SELECT 'VERIFY-item_rename_snapshot',company_id,entity,'VERIFY-item_renamed_key',session_id,'VERIFY-Renamed Tally item',parent_name,raw_record,
      fields||jsonb_build_object('/stored/name','VERIFY-Renamed Tally item'),'VERIFY-item_rename_hash',observed_at+interval '1 hour'
      FROM tally_visibility_records WHERE company_id=${a.company} AND record_key='VERIFY-iw_new' LIMIT 1`;
    const renamed=await itemDetail(db,created);assert.equal(renamed.stock.name,'VERIFY-Renamed Tally item');assert.equal(renamed.part_code,'VERIFY-NEW_PART');
    assert.ok((await new TallyVisibilityRepository(db).links(a.company,'items')).some(l=>l.record_key==='VERIFY-item_renamed_key'&&l.crm_id===created));
    const bOnly=await request('GET',`${path}?companyId=${b.company}&linkage=all`);assert.deepEqual(bOnly.body.data.data.map(r=>r.record_key),['VERIFY-iw_other']);
    const bodyB={companyId:b.company,reason:base.reason,entries:[{recordKey:'VERIFY-iw_other',action:'link',itemId:created}]};
    const previewB=await request('POST',`${path}/preview`,owner,bodyB);assert.equal(previewB.body.data.canSave,true);
    assert.equal((await request('POST',`${path}/commit`,owner,{...bodyB,previewFingerprint:previewB.body.data.previewFingerprint},{'idempotency-key':crypto.randomUUID()})).status,200);
    const multi=await itemDetail(db,created,{financial:true});assert.equal(multi.stock.links.length,2);assert.equal('closing_value' in multi.stock,false);assert.equal('closing_quantity_text' in multi.stock,false);
    assert.deepEqual(await db.sql`SELECT id,name,raw_record FROM tally_stock_items WHERE company_id IN (${a.company},${b.company}) ORDER BY id`,rawBefore);
  }finally{await app.close();installPermissionProvider(null);}
}));
