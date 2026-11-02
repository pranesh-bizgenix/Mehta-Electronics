import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import { temporaryDatabase } from '../test-support/postgres.js';
import { createDatabase } from '../src/postgres.js';
import { TallyVisibilityService } from '../src/tally-visibility-service.js';
import { getConfig } from '../src/config.js';
import { tallyDisplay } from '../src/tally-display.js';

test('financial role configuration cannot grant Tally figures to managers',()=>{
  assert.deepEqual(getConfig({tallyFinancialRoles:['OWNER','MANAGER','EXECUTIVE','ACCOUNTS']}).tallyFinancialRoles,['OWNER','ACCOUNTS']);
});
test('modern display repair preserves Unicode and changes no source identity',()=>{
  assert.equal(tallyDisplay('CafÃ©'),'Café');assert.equal(tallyDisplay('CafÃƒÂ©'),'Café');
  assert.equal(tallyDisplay('भारत · Müller'),'भारत · Müller');
});

test('all-field index: additive capture, role-safe search/detail/sort/export, pagination and history',async()=>{
  const temporary=await temporaryDatabase('visibility');
  const db=createDatabase({databaseUrl:temporary.databaseUrl});
  try {
    const company=crypto.randomUUID(),connector=crypto.randomUUID(),session=crypto.randomUUID();
    await db.sql`INSERT INTO users(id,name,email,role,password_hash) VALUES(900,'Fixture','fixture-visibility@example.invalid','OWNER','unused')`;
    await db.sql`INSERT INTO tally_connectors(id,profile_name,expected_company_name,token_hash) VALUES(${connector},'fixture','fixture','unused')`;
    await db.sql`INSERT INTO tally_upload_sessions(id,connector_id,company_name,sync_from,sync_to,status) VALUES(${session},${connector},'fixture','2026-04-01','2026-10-30','stored')`;
    await db.sql`INSERT INTO tally_companies(id,name) VALUES(${company},'fixture')`;
    const raw={'@_NAME':'Switch',LANGUAGENAME:{'#text':'not-allowlisted'},'LANGUAGENAME.LIST':{'NAME.LIST':{NAME:[{'#text':'Alias needle'}, {'#text':'=HYPERLINK("bad")'}]},CLOSINGVALUE:{'#text':'secret-nested'}},CLOSINGRATE:{'#text':'sensitive-rate-98765'},UNKNOWNNEWFIELD:{'#text':'owner-only-needle'}};
    await db.sql`INSERT INTO tally_stock_items(id,company_id,source_key,name,normalized_part_number,base_unit,closing_quantity_text,closing_rate_text,closing_value,raw_record,session_id)
      VALUES('item1',${company},'name:Switch','Switch','SWITCH','NOS','-2 NOS','sensitive-rate-98765',123.45,${db.sql.json(raw)},${session})`;
    const service=new TallyVisibilityService(db),url=new URL(`http://test/?companyId=${company}&pageSize=1`),owner={id:900,role:'OWNER'},manager={id:900,role:'MANAGER'};
    const emptyUrl=new URL(url);emptyUrl.searchParams.set('sort','/stored/name');
    const awaiting=await service.list('vouchers',emptyUrl,owner);
    assert.equal(awaiting.pagination.total,0);assert.match(awaiting.emptyReason,/Awaiting voucher data/);
    const original=(await db.sql`SELECT raw_record FROM tally_stock_items WHERE id='item1'`)[0].raw_record;
    const list=await service.list('items',url,owner);
    assert.equal(list.pagination.total,1);assert.equal(list.data.length,1);
    assert.ok(list.columns.includes('/xml/UNKNOWNNEWFIELD/#text'));
    assert.ok(list.columns.includes('/stored/closing_rate_text'));
    const nonfinancial=await service.list('items',url,manager);
    assert.equal(JSON.stringify(nonfinancial).includes('sensitive-rate-98765'),false);
    assert.equal(JSON.stringify(nonfinancial).includes('secret-nested'),false);
    assert.equal(nonfinancial.columns.includes('/xml/UNKNOWNNEWFIELD/#text'),false);
    const search=new URL(url);search.searchParams.set('search','Alias needle');
    assert.equal((await service.list('items',search,manager)).pagination.total,1);
    search.searchParams.set('search','sensitive-rate-98765');
    assert.equal((await service.list('items',search,manager)).pagination.total,0);
    assert.equal((await service.list('items',search,owner)).pagination.total,1);
    search.searchParams.delete('search');search.searchParams.set('sort','/stored/closing_value');
    await assert.rejects(service.list('items',search,manager),{status:422});
    await assert.rejects(service.export('items',url,manager,['/stored/closing_value']),{status:422});
    const exported=await service.export('items',url,manager,['/xml/LANGUAGENAME.LIST/NAME.LIST/NAME/1/#text']);
    assert.ok(exported.content.includes("'=HYPERLINK"));
    assert.equal((await db.sql`SELECT count(*) AS n FROM audit_logs WHERE entity='TALLY_EXPORT'`)[0].n,1);
    await db.sql`UPDATE tally_stock_items SET raw_record=raw_record || '{"NEWFIELD":"next"}'::jsonb,fetched_at=now()+interval '1 second' WHERE id='item1'`;
    const detail=await service.detail('items','item1',url,owner);
    assert.equal(detail.history.length,2);assert.ok(detail.changes[0].fields.some(f=>f.key==='/xml/NEWFIELD'));
    const rawSort=new URL(url);rawSort.searchParams.set('sort','/xml/NEWFIELD');
    assert.equal((await service.list('items',rawSort,owner)).pagination.total,1,'Raw-field sorting must use current records, not duplicate snapshots');
    const safeDetail=await service.detail('items','item1',url,manager);
    assert.equal(Object.hasOwn(safeDetail.data,'raw_record'),false);
    assert.equal(JSON.stringify(safeDetail).includes('sensitive-rate-98765'),false);
    assert.deepEqual(original,(await db.sql`SELECT raw_record - 'NEWFIELD' AS raw_record FROM tally_stock_items WHERE id='item1'`)[0].raw_record);
    const snapshots=new URL(url);snapshots.searchParams.set('snapshots','all');
    assert.equal((await service.list('items',snapshots,owner)).pagination.total,2);
    const snapshotDetail=new URL(url);snapshotDetail.searchParams.set('snapshotId',detail.history[1].id);
    assert.equal((await service.detail('items','item1',snapshotDetail,owner)).data.id,detail.history[1].id);
    const linked=await service.createCrm('items','item1',url,owner);
    assert.equal(linked.created,true);assert.equal((await service.createCrm('items','item1',url,owner)).created,false);
    const reconciliation=await service.reconciliation('items',url,owner);
    assert.equal(reconciliation.data[0].reconciliation_status,'matched');
    const reconciledUrl=new URL(url);reconciledUrl.searchParams.set('view','reconciliation');
    assert.ok((await service.export('items',reconciledUrl,owner,['/stored/name','reconciliation_status','crm'])).content.includes('matched'));
    await db.sql`INSERT INTO tally_stock_items(id,company_id,source_key,name,normalized_part_number,base_unit,closing_value,raw_record,session_id)
      SELECT 'bulk-'||n,${company},'bulk-'||n,'Bulk '||n,'BULK'||n,'NOS',9007199254740993.12,'{}'::jsonb,${session} FROM generate_series(1,101) n`;
    const exportedAll=await service.export('items',url,owner,['/stored/name','/stored/closing_value']);
    assert.equal(exportedAll.count,102);assert.ok(exportedAll.content.includes('Bulk 101'));assert.ok(exportedAll.content.includes('9007199254740993.12'));
    assert.ok((await service.export('items',url,manager,['/stored/name'],'excel')).content.includes('ss:Type="String"'));
    await assert.rejects(db.sql`DELETE FROM tally_visibility_records`,/append-only/);
  } finally {await db.close();await temporary.close();}
});
