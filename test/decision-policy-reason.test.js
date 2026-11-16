import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withTestTransaction} from '../test-support/transaction.js';
import {quotationFixture} from '../test-support/quotation-fixture.js';
import {saveQuotePolicy,quotePolicy} from '../src/quotation-workflow.js';
import {DecisionService} from '../src/modules/decisions/service.js';

test('legacy quotation-policy reasons retain 2000-character compatibility and exact whitespace with atomic decision audit rollback',()=>withTestTransaction(async db=>{
 const f=await quotationFixture(db),service=new DecisionService({db});
 const reason='ZZTEST_ policy evidence  '+ 'x'.repeat(1120)+'\nSecond  independently reviewed line';
 assert.ok(reason.length>1000&&reason.length<2000);
 const body={floorPercent:'20',marginBasis:'TOTAL',sellerState:'27',letterhead:{name:'ZZTEST_ Reason Seller'},reason};
 const saved=await saveQuotePolicy(db,body,f.owner),decision=await service.repository.current('margin.floor_percent');
 assert.equal(decision.reason,reason);assert.equal(decision.status,'CONFIRMED');
 assert.equal((await db.prepare("SELECT reason FROM crm_quotation_events WHERE quotation_id IS NULL AND action='POLICY_CHANGED' AND created_by=? ORDER BY id DESC LIMIT 1").get(f.owner.id)).reason,reason);
 assert.equal((await db.prepare("SELECT reason FROM audit_logs WHERE entity='DECISION' AND record_id='margin.floor_percent' AND user_id=? ORDER BY id DESC LIMIT 1").get(f.owner.id)).reason,reason);
 const invoice=(await service.list(f.owner)).data.find(r=>r.key==='invoice.authority');
 await assert.rejects(()=>service.enter(f.owner,'invoice.authority',{expectedVersion:invoice.version,requestKey:randomUUID(),reason,value:'TALLY_CREATES',confirm:false}),{status:422});
 await assert.rejects(()=>service.confirmLegacy(f.owner,'margin.floor_percent',saved.floor_percent,'x'.repeat(2001)),{status:422});
 const failing=new Proxy(db,{get(target,key){
  if(key==='prepare')return statement=>{const prepared=target.prepare(statement);if(!statement.startsWith('INSERT INTO audit_logs('))return prepared;return {...prepared,run:async(...values)=>{if(values[1]==='DECISION')throw new Error('ZZTEST_ decision audit refused');return prepared.run(...values);}};};
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 const refusedReason=reason+'\nZZTEST_ rollback evidence';
 await assert.rejects(()=>saveQuotePolicy(failing,{...body,floorPercent:'21',reason:refusedReason},f.owner),/decision audit refused/);
 assert.deepEqual(await quotePolicy(db),saved,'The policy and its metadata roll back when decision audit fails.');
 assert.equal((await service.repository.current('margin.floor_percent')).version,decision.version);
 assert.equal((await db.prepare('SELECT count(*)::integer AS count FROM crm_quotation_events WHERE created_by=? AND reason=?').get(f.owner.id,refusedReason)).count,0);
 assert.equal((await db.prepare('SELECT count(*)::integer AS count FROM audit_logs WHERE user_id=? AND reason=?').get(f.owner.id,refusedReason)).count,0);
}));
