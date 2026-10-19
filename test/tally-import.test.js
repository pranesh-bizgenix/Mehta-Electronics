import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import { temporaryDatabase } from '../test-support/postgres.js';
import { openDatabase } from '../src/db.js';
import { getConfig } from '../src/config.js';
import { importTallySession,parseStructuredVouchers,prepareMasterRecords,markStalledRuns } from '../src/tally-import.js';
import { tallyMasterList } from '../src/tally-masters.js';

// Synthetic edge-case fixtures for parser/transaction tests; never used by production.
test('keeps punctuation-distinct names and exact-name duplicates, quarantining only bad money records',()=>{
  const records=[{'@_NAME':'LG:507613 SPN DB 16 WAY IP43'},{'@_NAME':'LG 507613 SPN DB 16 WAY IP43'},
    {'@_NAME':'Repeated'},{'@_NAME':'Repeated',CLOSINGVALUE:{'#text':'1.00'}},{'@_NAME':'Bad',CLOSINGVALUE:{'#text':'broken'}}];
  const result=prepareMasterRecords(records,'items','company','session');
  assert.equal(result.good.length,4);assert.equal(new Set(result.good.map(item=>item.row.id)).size,4);
  assert.equal(result.bad.length,1);assert.equal(result.warnings.length,2);
  assert.notEqual(prepareMasterRecords(records,'items','another','session').good[0].row.id,result.good[0].row.id);
});

test('does not treat scalar voucher metadata counters as financial records',()=>{
  assert.equal(parseStructuredVouchers('<ENVELOPE><BODY><DATA><COLLECTION><VOUCHER>12</VOUCHER><VOUCHER><DATE>20260401</DATE><GUID>v1</GUID></VOUCHER></COLLECTION></DATA></BODY></ENVELOPE>').length,1);
});

test('replays idempotently, isolates invalid records, retains raw payloads, and reports stalled and failed runs',async()=>{
  const temporary=await temporaryDatabase();
  const db=await openDatabase(getConfig({databaseUrl:temporary.databaseUrl}));
  try{
    const connector=crypto.randomUUID(),job=crypto.randomUUID(),session=crypto.randomUUID();
    await db.sql`INSERT INTO tally_connectors(id,profile_name,expected_company_name,token_hash) VALUES(${connector},'fixture','fixture','fixture-hash')`;
    await db.sql`INSERT INTO tally_sync_jobs(id,connector_id,company_name,status) VALUES(${job},${connector},'fixture','running')`;
    await db.sql`INSERT INTO tally_upload_sessions(id,connector_id,sync_job_id,company_name,sync_from,sync_to,status) VALUES(${session},${connector},${job},'fixture','2026-04-01','2026-10-19','receiving')`;
    const contents={stockXml:'<ENVELOPE><BODY><DATA><COLLECTION><STOCKITEM NAME="AB-1"><CLOSINGVALUE>123.45</CLOSINGVALUE></STOCKITEM><STOCKITEM NAME="AB1"><CLOSINGVALUE>-2.50</CLOSINGVALUE></STOCKITEM><STOCKITEM NAME="Bad"><CLOSINGVALUE>invalid</CLOSINGVALUE></STOCKITEM><STOCKITEM><PARENT>Missing name</PARENT></STOCKITEM></COLLECTION></DATA></BODY></ENVELOPE>',
      ledgersXml:'<ENVELOPE><BODY><DATA><COLLECTION><LEDGER NAME="Debtor"><GUID>ledger1</GUID><CLOSINGBALANCE>-100.25</CLOSINGBALANCE></LEDGER></COLLECTION></DATA></BODY></ENVELOPE>',groupsXml:'<ENVELOPE/>',vouchersXml:'<ENVELOPE><BODY><DATA><COLLECTION><VOUCHER>1</VOUCHER></COLLECTION></DATA></BODY></ENVELOPE>',balanceSheetXml:'<ENVELOPE/>',profitAndLossXml:'<ENVELOPE/>',billsReceivableXml:'<ENVELOPE/>',billsPayableXml:'<ENVELOPE/>'};
    for(const [field,content]of Object.entries(contents))await db.sql`INSERT INTO tally_upload_chunks(session_id,field_name,sequence,content) VALUES(${session},${field},0,${content})`;
    const first=await importTallySession(db,session);assert.equal(first.status,'partial');assert.equal(first.items,2);assert.equal(first.customers,1);assert.equal(first.quarantined,2);assert.equal(first.vouchers,0);
    const again=await importTallySession(db,session);assert.deepEqual(again,first);
    await importTallySession(db,session,{replay:true});
    assert.equal((await db.sql`SELECT COUNT(*) AS n FROM tally_stock_items`)[0].n,2);
    assert.equal((await db.sql`SELECT COUNT(*) AS n FROM tally_raw_payloads`)[0].n,8);
    assert.equal((await db.sql`SELECT jsonb_typeof(raw_record) AS type FROM tally_stock_items LIMIT 1`)[0].type,'object');
    const list=await tallyMasterList(db,'items',new URL('http://test/?pageSize=1&search=AB'),{financial:true});
    assert.equal(list.pagination.total,2);assert.equal(list.data.length,1);
    assert.equal((await db.sql`SELECT closing_value::text AS value FROM tally_stock_items WHERE name='AB1'`)[0].value,'-2.50');
    await db.sql`UPDATE tally_upload_chunks SET content='<ENVELOPE><broken>' WHERE session_id=${session} AND field_name='groupsXml'`;
    const failed=await importTallySession(db,session,{replay:true});assert.equal(failed.status,'failed');
    assert.equal((await db.sql`SELECT status FROM tally_sync_jobs WHERE id=${job}`)[0].status,'failed');
    await db.sql`UPDATE tally_sync_jobs SET status='running',last_progress_at=now()-interval '2 hours' WHERE id=${job}`;
    assert.equal(await markStalledRuns(db.sql,30),1);assert.equal(await markStalledRuns(db.sql,30),0);
    assert.equal((await db.sql`SELECT COUNT(*) AS n FROM audit_logs WHERE action='SYNC_STALLED'`)[0].n,1);
  }finally{await db.close();await temporary.close()}
});
