import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import { temporaryDatabase } from '../test-support/postgres.js';
import { openDatabase } from '../src/db.js';
import { getConfig } from '../src/config.js';
import { overviewContext,tallyOverview } from '../src/overview.js';
import { overviewMoney } from '../public/overview.js';

test('formats signed decimal money without losing precision or replacing missing values with zero',()=>{
  assert.equal(overviewMoney('-367136280.98'),'−₹36,71,36,280.98');
  assert.equal(overviewMoney('-367136280.98',{compact:true}),'−₹36.71 Cr');
  assert.equal(overviewMoney('9999999999999999.99'),'₹9,99,99,99,99,99,99,999.99');
  assert.equal(overviewMoney(null),'Not provided');assert.equal(overviewMoney('0.00'),'₹0.00');
});

test('overview totals stay company-scoped, preserve negative stock values, and disclose absent values',async()=>{
  const temporary=await temporaryDatabase(),config=getConfig({databaseUrl:temporary.databaseUrl});
  const db=await openDatabase(config);
  try{
    const company=crypto.randomUUID(),other=crypto.randomUUID(),connector=crypto.randomUUID(),session=crypto.randomUUID();
    await db.sql`INSERT INTO tally_companies(id,name) VALUES(${company},'Overview test'),(${other},'Other test')`;
    await db.sql`INSERT INTO tally_connectors(id,profile_name,expected_company_name,token_hash) VALUES(${connector},'overview','Overview test','overview-test')`;
    await db.sql`INSERT INTO tally_upload_sessions(id,connector_id,company_name,sync_from,sync_to,status,completed_at) VALUES(${session},${connector},'Overview test','2026-04-01','2026-10-19','stored',now())`;
    await db.sql`INSERT INTO tally_stock_items(id,company_id,source_key,name,normalized_part_number,raw_record,session_id,closing_value,closing_quantity_text)
      VALUES('ov-a',${company},'a','A','A','{}',${session},-123.45,'-2 NOS'),('ov-b',${company},'b','B','B','{}',${session},NULL,NULL),
      ('ov-other',${other},'c','C','C','{}',${session},9000,'3 NOS')`;
    const context=await overviewContext(db,config,new URL(`http://test/?companyId=${company}`));
    const result=await tallyOverview(db,context);
    assert.equal(result.stock.signedValue,'-123.45');assert.equal(result.counts.items,2);
    assert.equal(result.stock.missingValue,1);assert.equal(result.stock.negativeQuantity,1);
    assert.equal(result.stock.unclassifiedQuantity,1);assert.equal(result.parity.status,'not_checked');
    assert.equal(result.coverage.find(row=>row.dataset==='billsPayableXml').state,'not_provided');
    await assert.rejects(overviewContext(db,config,new URL(`http://test/?companyId=${crypto.randomUUID()}`)),{status:422});
    await assert.rejects(overviewContext(db,config,new URL(`http://test/?companyId=${company}&periodId=${crypto.randomUUID()}`)),{status:422});
  }finally{await db.close();await temporary.close()}
});
