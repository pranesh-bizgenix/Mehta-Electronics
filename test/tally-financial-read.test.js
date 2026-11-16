import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withTestTransaction} from '../test-support/transaction.js';
import {tallyFixture} from '../test-support/tally-fixture.js';
import {TallyFinancialReadService,financialVoucher,parseOutstandingBills,normalizedTallyDate} from '../src/tally-financial-read.js';
import {replayVisibilityPayload} from '../src/tally-visibility-replay.js';
import crypto from 'node:crypto';

test('financial parser preserves cheque/bill decimals and validates source report row alignment',()=>{
 const raw={VOUCHERTYPENAME:'Receipt',AMOUNT:'9007199254740993.123456','ALLLEDGERENTRIES.LIST':{LEDGERNAME:'ZZTEST_party','BANKALLOCATIONS.LIST':{INSTRUMENTNUMBER:'000123',AMOUNT:'9007199254740993.123456'},'BILLALLOCATIONS.LIST':{NAME:'ZZTEST_invoice',AMOUNT:'12.345678'}}};
 const parsed=financialVoucher(raw);assert.equal(parsed.banks[0].instrumentNumber,'000123');assert.equal(parsed.banks[0].amount,'9007199254740993.123456');assert.equal(parsed.bills[0].amount,'12.345678');
 const xml='<ENVELOPE><BILLFIXED><BILLREF>ZZTEST_inv</BILLREF><BILLPARTY>ZZTEST_party</BILLPARTY><BILLDATE>04-Nov-2026</BILLDATE></BILLFIXED><BILLCL>-12.345678</BILLCL><BILLDUE>10-Nov-2026</BILLDUE></ENVELOPE>';
 const report=parseOutstandingBills(xml);assert.equal(report.rows[0].date,'2026-11-04');assert.equal(report.rows[0].closingAmount,'-12.345678');assert.equal(report.verified,true);
 assert.throws(()=>parseOutstandingBills(xml.replace('<BILLCL>-12.345678</BILLCL>','')),{status:422});assert.equal(normalizedTallyDate('04-Nov-26'),null);assert.equal(parseOutstandingBills('<ENVELOPE/>').verified,false);
});

test('financial reads scope exact decimal/cheque/percentage searches and deny nonfinancial roles',()=>withTestTransaction(async db=>{
 const a=await tallyFixture(db,'ZZTEST_Finance A'),b=await tallyFixture(db,'ZZTEST_Finance B');
 for(const source of [a,b]){
  const id=crypto.randomUUID(),xml=`<ENVELOPE><BODY><DATA><COLLECTION><VOUCHER><GUID>ZZTEST_fin_guid</GUID><VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME><VOUCHERNUMBER>ZZTEST_receipt</VOUCHERNUMBER><PARTYLEDGERNAME>${source===a?'ZZTEST_A_party':'ZZTEST_B_party'}</PARTYLEDGERNAME><DATE>20261104</DATE><AMOUNT>9007199254740993.123456</AMOUNT><DISCOUNTPERCENT>12.345678</DISCOUNTPERCENT><BANKALLOCATIONS.LIST><INSTRUMENTNUMBER>000123</INSTRUMENTNUMBER></BANKALLOCATIONS.LIST></VOUCHER></COLLECTION></DATA></BODY></ENVELOPE>`;
  await db.sql`INSERT INTO tally_raw_payloads(id,company_id,session_id,dataset,content_hash,content) VALUES(${id},${source.company},${source.session},'vouchersXml','ZZTEST_hash',${xml})`;
  await replayVisibilityPayload(db.sql,{id,company_id:source.company,session_id:source.session,dataset:'vouchersXml',content:xml,received_at:new Date()});
 }
 const service=new TallyFinancialReadService(db),url=(company=a.company,filter='')=>new URL(`http://localhost/?companyId=${company}${filter}`);
 const result=await service.vouchers(url(a.company,'&amount=9007199254740993.123456&cheque=000123&percentage=12.345678&from=2026-11-04&to=2026-11-04'),{role:'ACCOUNTS'});
 assert.equal(result.data.length,1);assert.equal(result.data[0].party,'ZZTEST_A_party');assert.equal(result.data[0].amount,'9007199254740993.123456');assert.deepEqual(result.data[0].instruments,['000123']);
 assert.equal((await service.vouchers(url(a.company,'&amount=9007199254740993.123457'),{role:'OWNER'})).data.length,0);
 assert.equal((await service.vouchers(url(a.company,'&search=ZZTEST_B_party'),{role:'OWNER'})).data.length,0);
 const key=result.data[0].id;const detail=await service.voucher(url(),key,{role:'ACCOUNTS'});assert.equal(detail.data.document.party_name,'ZZTEST_A_party');
 await assert.rejects(service.voucher(url(b.company),key,{role:'OWNER'}),{status:404});
 for(const role of ['MANAGER','EXECUTIVE','LOGISTICS_LEAD','STORE_STAFF'])await assert.rejects(service.vouchers(url(),{role}),{status:403});
 for(const filter of ['&amount=1e3','&percentage=101','&from=2026-02-30'])await assert.rejects(service.vouchers(url(a.company,filter),{role:'OWNER'}),{status:422});
 await assert.rejects(service.vouchers(new URL('http://localhost/'),{role:'OWNER'}),{status:422});
}));
