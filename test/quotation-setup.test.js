import assert from 'node:assert/strict';
import {test} from 'node:test';
import crypto from 'node:crypto';
import {Readable} from 'node:stream';
import {deflateRawSync} from 'node:zlib';
import {costErrors,policyErrors} from '../public/quotation-setup-validation.js';
import {parseCostFile,previewQuoteCosts} from '../src/quotation-cost-import.js';
import {saveQuotePolicy,saveQuoteCost,saveQuote,quoteAction,quoteCost,pricingHistory,importQuoteCosts} from '../src/quotation-workflow.js';
import {withTestTransaction} from '../test-support/transaction.js';
import {quotationFixture} from '../test-support/quotation-fixture.js';
import {createApp} from '../src/app.js';
import {getConfig} from '../src/config.js';
import {tokenDigest} from '../src/security.js';
import {saveItem} from '../src/crm-modules.js';

const upload=(csv)=>({filename:'ZZTEST_costs.csv',base64:Buffer.from(csv).toString('base64'),reason:'ZZTEST reviewed cost import'});
const policy={floorPercent:'20',marginBasis:'TOTAL',sellerState:'27',letterhead:{name:'ZZTEST Seller',email:'seller@example.test'},reason:'ZZTEST policy setup'};
function xlsx(sheet,shared=''){
 const contents={'xl/workbook.xml':'<workbook><sheets><sheet r:id="r1"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>','xl/worksheets/sheet1.xml':sheet,...(shared?{'xl/sharedStrings.xml':shared}:{})};
 const local=[],central=[];let offset=0;
 for(const [name,text]of Object.entries(contents)){
  const raw=Buffer.from(text),packed=deflateRawSync(raw),filename=Buffer.from(name);let crc=0xffffffff;
  for(const b of raw){crc^=b;for(let k=0;k<8;k++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;}crc=(crc^0xffffffff)>>>0;
  const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(8,8);h.writeUInt32LE(crc,14);h.writeUInt32LE(packed.length,18);h.writeUInt32LE(raw.length,22);h.writeUInt16LE(filename.length,26);local.push(h,filename,packed);
  const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(8,10);c.writeUInt32LE(crc,16);c.writeUInt32LE(packed.length,20);c.writeUInt32LE(raw.length,24);c.writeUInt16LE(filename.length,28);c.writeUInt32LE(offset,42);central.push(c,filename);offset+=30+filename.length+packed.length;
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(contents).length,8);end.writeUInt16LE(Object.keys(contents).length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
 return {filename:'ZZTEST_costs.xlsx',base64:Buffer.concat([...local,directory,end]).toString('base64'),reason:'ZZTEST workbook import'};
}
const sheet=value=>`<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>part_code</t></is></c><c r="B1" t="inlineStr"><is><t>unit_cost</t></is></c></row><row><c r="A2" t="s"><v>0</v></c><c r="B2">${value}</c></row></sheetData></worksheet>`;

test('setup validation has no defaults and rejects numeric money, invalid precision and mismatched GSTIN',()=>{
 assert.deepEqual(policyErrors(policy),{});assert.ok(policyErrors({...policy,marginBasis:''}).marginBasis);
 for(const value of ['',101,'100.000001','-1','1e2'])assert.ok(policyErrors({...policy,floorPercent:value}).floorPercent);
 assert.deepEqual(policyErrors({...policy,floorPercent:'100.000000'}),{});
 assert.ok(policyErrors({...policy,letterhead:{name:'Seller',gstin:'24ABCDE1234F1Z5'}})['letterhead.gstin']);
 for(const value of [12.34,'-1','1e3','1.0000001','123456789012345'])assert.ok(costErrors({unitCost:value,reason:'ZZTEST reason'}).unitCost);
 assert.deepEqual(costErrors({unitCost:'99999999999999.123456',reason:'ZZTEST reason'}),{});
});
test('CSV preserves exact decimal text, quoted part codes, BOM and CRLF',()=>{
 const rows=parseCostFile(upload('\uFEFFpart_code,unit_cost\r\n"ZZTEST_part, one",99999999999999.123456\r\n'));
 assert.equal(rows[0].unitCost,'99999999999999.123456');assert.equal(rows[0].partCode,'ZZTEST_part, one');
 for(const csv of ['part_code,cost\nA,1','part_code,unit_cost\n"A,1','part_code,unit_cost\n"A"x,1'])assert.throws(()=>parseCostFile(upload(csv)),{status:422});
});
test('compressed XLSX reads shared strings and numeric cells without rounding, and rejects formulas and damaged files',()=>{
 const file=xlsx(sheet('<v>99999999999999.123456</v>'),'<sst><si><t>ZZTEST_PART&amp;ONE</t></si></sst>');
 const row=parseCostFile(file)[0];assert.equal(row.unitCost,'99999999999999.123456');assert.equal(row.partCode,'ZZTEST_PART&ONE');
 assert.throws(()=>parseCostFile(xlsx(sheet('<f>1+1</f><v>2</v>'),'<sst><si><t>PART</t></si></sst>')),{status:422});
 assert.throws(()=>parseCostFile({...file,base64:Buffer.from('broken').toString('base64')}),{status:422});
});
test('missing policy blocks creation; missing cost blocks submission in the live rollback fixture',()=>withTestTransaction(async db=>{
 const f=await quotationFixture(db);
 const body={customerId:f.customer.id,validUntil:'2099-12-31',placeOfSupply:'27',supplyType:'DOMESTIC_STANDARD',reason:'ZZTEST quotation setup gates',lines:[{itemId:f.item.id,quantity:'1',unitPrice:'100',discountPercent:'0',taxPercent:'18'}]};
 // Model an absent policy query without deleting or replacing any real policy.
 const absent=new Proxy(db,{get(target,key){if(key==='prepare')return sql=>sql.startsWith('SELECT *,floor_percent::text')?{get:async()=>undefined}:target.prepare(sql);const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 await assert.rejects(saveQuote(absent,null,body,f.executive),error=>error.status===409&&/creation is blocked/.test(error.message));
 await saveQuotePolicy(db,policy,f.owner);
 const quote=await saveQuote(db,null,body,f.executive);
 await assert.rejects(quoteAction(db,quote.id,{action:'SUBMIT',version:quote.version,reason:'ZZTEST missing cost'},f.executive),error=>error.status===422&&/Submission is blocked/.test(error.message));
}));
test('cost import is read-only before confirmation, validates all rows, blocks stale previews, audits and preserves exact costs',()=>withTestTransaction(async db=>{
 const f=await quotationFixture(db),file=upload(`part_code,unit_cost\n${f.item.part_code},99999999999999.123456`);
 const initial=await previewQuoteCosts(db,file,f.owner);assert.equal(initial.canSave,true);assert.equal((await quoteCost(db,f.item.id,f.owner)).unit_cost,null);
 await assert.rejects(previewQuoteCosts(db,file,f.executive),{status:403});
 const invalid=upload(`part_code,unit_cost\n${f.item.part_code},12\n${f.item.part_code},1e3\nZZTEST_UNKNOWN,1`),bad=await previewQuoteCosts(db,invalid,f.owner);
 assert.equal(bad.canSave,false);assert.ok(bad.rows[1].issues.some(i=>i.includes('Duplicate')));
 await assert.rejects(importQuoteCosts(db,{...invalid,fingerprint:bad.fingerprint},f.owner,previewQuoteCosts),{status:422});
 assert.equal((await quoteCost(db,f.item.id,f.owner)).unit_cost,null);
 await saveQuoteCost(db,f.item.id,{unitCost:'1.000001',reason:'ZZTEST competing update'},f.owner);
 await assert.rejects(importQuoteCosts(db,{...file,fingerprint:initial.fingerprint},f.owner,previewQuoteCosts),{status:409});
 const fresh=await previewQuoteCosts(db,file,f.owner);
 assert.deepEqual(await importQuoteCosts(db,{...file,fingerprint:fresh.fingerprint},f.owner,previewQuoteCosts),{saved:1});
 assert.equal((await quoteCost(db,f.item.id,f.owner)).unit_cost,'99999999999999.123456');
 const history=await pricingHistory(db,f.item.id,f.owner);assert.equal(history[0].private_detail.after,'99999999999999.123456');assert.equal(history[0].public_detail.sourceFile,file.filename);
 await assert.rejects(importQuoteCosts(db,{...file,fingerprint:fresh.fingerprint},f.owner,previewQuoteCosts),{status:409});
 assert.equal((await pricingHistory(db,f.item.id,f.owner)).length,2);
}));
test('import endpoints enforce session, CSRF, cost permissions and field errors in the real handler without another listener',()=>withTestTransaction(async db=>{
 const f=await quotationFixture(db),app=createApp({db,config:getConfig({mfaEnabled:false})}),tokens=new Map();
 for(const actor of [f.owner,f.executive]){const token=crypto.randomUUID();tokens.set(actor.id,token);await db.sql`INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at) VALUES(${actor.id},${tokenDigest(token)},'ZZTEST_csrf',now()+interval '1 hour')`;}
 async function request(path,actor,body,csrf=true){const req=Readable.from([Buffer.from(JSON.stringify(body))]);Object.assign(req,{method:'POST',url:path,headers:{host:'localhost','content-type':'application/json',...(actor?{cookie:`crm_session=${tokens.get(actor.id)}`} :{}),...(csrf?{'x-csrf-token':'ZZTEST_csrf'}:{})},socket:{remoteAddress:'test'}});const res={status:0,headersSent:false,setHeader(){},writeHead(n){this.status=n;this.headersSent=true;},end(value){this.body=value?JSON.parse(String(value)):null;}};await app(req,res);return res;}
 try{
  const path='/api/crm/quotation-cost-import/preview',file=upload(`part_code,unit_cost\n${f.item.part_code},42.000001`);
  assert.equal((await request(path,null,file)).status,401);assert.equal((await request(path,f.executive,file)).status,403);assert.equal((await request(path,f.owner,file,false)).status,403);
  const response=await request(path,f.owner,file);assert.equal(response.status,200);assert.equal(response.body.data.canSave,true);
  assert.equal((await request('/api/crm/quotation-cost-import/commit',f.owner,{...file,fingerprint:response.body.data.fingerprint})).status,200);
  const invalid=await request(path,f.owner,{...file,reason:''});assert.equal(invalid.status,422);assert.equal(invalid.body.details.fields[0].path,'reason');
 }finally{await app.close?.();}
}));
test('a failure during batch save rolls back preceding costs and their history',()=>withTestTransaction(async db=>{
 const f=await quotationFixture(db),other=await saveItem(db,null,{partCode:'ZZTEST_QUOTE-SECOND',description:'ZZTEST second cost',uom:'NOS',hsn:'8536',packSize:1,listPrice:'100',moq:1},f.owner);
 const file=upload(`part_code,unit_cost\n${f.item.part_code},11.123456\n${other.part_code},22.123456`),plan=await previewQuoteCosts(db,file,f.owner);
 let writes=0;
 const failing=new Proxy(db,{get(target,key){
  if(key==='prepare')return sql=>{const statement=target.prepare(sql);if(sql.startsWith('INSERT INTO crm_quotation_costs'))return {...statement,run:async(...args)=>{if(++writes===2)throw new Error('ZZTEST simulated second-row storage failure');return statement.run(...args);}};return statement;};
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 await assert.rejects(importQuoteCosts(failing,{...file,fingerprint:plan.fingerprint},f.owner,previewQuoteCosts),/simulated second-row/);
 assert.equal(writes,2);assert.equal((await quoteCost(db,f.item.id,f.owner)).unit_cost,null);assert.equal((await quoteCost(db,other.id,f.owner)).unit_cost,null);
 assert.equal((await pricingHistory(db,f.item.id,f.owner)).length,0);
}));
