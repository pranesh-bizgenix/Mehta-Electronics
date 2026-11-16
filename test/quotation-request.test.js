import assert from 'node:assert/strict';
import {test} from 'node:test';
import crypto from 'node:crypto';
import {Readable} from 'node:stream';
import {quotationRequest,quotationLineRequest,quotationRequestBlock} from '../public/quotation-request.js';
import {withTestTransaction} from '../test-support/transaction.js';
import {quotationFixture} from '../test-support/quotation-fixture.js';
import {confirmFixturePricing} from '../test-support/business-rule-fixture.js';
import {saveQuotePolicy,saveQuoteCost,saveQuote,quoteAction,quoteHistory,duplicateQuote} from '../src/quotation-workflow.js';
import {quotationPrintHtml,quotationPdf,quotationLineDescription} from '../src/quotation-document.js';
import {createApp} from '../src/app.js';
import {getConfig} from '../src/config.js';
import {tokenDigest} from '../src/security.js';
import {installPermissionProvider} from '../src/rbac.js';

const policy={floorPercent:'10',marginBasis:'TOTAL',sellerState:'27',letterhead:{name:'VERIFY- seller'},reason:'VERIFY- request test policy'};
const details={sourceLine:'7',tag:'16QM1',make:'VERIFY- RR',requestedSpecification:'4 sqmm / FRLSH / 1100V; requested IS-694, REACH, ROHS',availability:'VERIFY- 100 metres checked',availabilityAsOf:'2026-01-01',availabilitySource:'VERIFY- internal source - do not print',leadTime:'VERIFY- 7 working days from PO date'};
const body=f=>({customerId:f.customer.id,validUntil:'2099-12-31',placeOfSupply:'27',supplyType:'DOMESTIC_STANDARD',reason:'VERIFY- review RFQ',request:{reference:'VERIFY- RFQ <script>bad</script>',quantityInstructions:'VERIFY- 3 sets; confirm the final quantities',quantityConfirmed:false},lines:[{itemId:f.item.id,quantity:'2',unitPrice:'100.123456',discountPercent:'0',taxPercent:'18',requestDetails:details},{itemId:f.item.id,quantity:'1',unitPrice:'100',discountPercent:'0',taxPercent:'18',requestDetails:{...details,sourceLine:'23',tag:'24KM-1'}}]});

test('manual RFQ validation starts empty, rejects malformed fields and never infers set or colour quantities',()=>{
 assert.deepEqual(quotationRequest(),{reference:'',quantityInstructions:'',quantityConfirmed:false});
 assert.equal(quotationLineRequest(undefined,'2026-11-04').availability,'');
 for(const bad of [null,[],{reference:1},{quantityConfirmed:'true'},{quantityInstructions:'x'.repeat(1001)}])assert.throws(()=>quotationRequest(bad));
 assert.match(quotationRequestBlock({quantityInstructions:'3 sets',quantityConfirmed:false}),/final quantities/);
 assert.equal(quotationRequestBlock({quantityInstructions:'3 sets',quantityConfirmed:true}),null);
 assert.equal(quotationRequestBlock(),null);
 assert.deepEqual(quotationLineRequest({...details,unitCost:'secret'},'2026-11-04'),details);
});
test('availability statements require a real nonfuture date and check source; no live stock is invented',()=>{
 for(const patch of [{availabilityAsOf:''},{availabilitySource:''},{availabilityAsOf:'2026-02-31'},{availabilityAsOf:'2027-01-01'},{availabilityAsOf:'invalid'},{availability:''}])assert.throws(()=>quotationLineRequest({...details,...patch},'2026-11-04'));
 assert.deepEqual(quotationLineRequest(details,'2026-11-04'),details);
 assert.throws(()=>quotationLineRequest({tag:12},'2026-11-04'));
});
test('RFQ fields persist per repeated line and version, quantity review blocks submission, duplicates require a fresh quantity check',()=>withTestTransaction(async db=>{
 const f=await quotationFixture(db);try{
  await saveQuotePolicy(db,policy,f.owner);await saveQuoteCost(db,f.item.id,{unitCost:'1',reason:'VERIFY- request item cost'},f.owner);await confirmFixturePricing(db,f.owner);
  const input=body(f);let q=await saveQuote(db,null,input,f.executive);
  assert.equal(q.lines.length,2);assert.deepEqual(q.lines.map(l=>l.quantity),['2','1']);assert.equal(q.lines[0].requestDetails.tag,'16QM1');assert.equal(q.lines[1].requestDetails.tag,'24KM-1');assert.equal(q.lines[0].unitPrice,'100.123456');
  await assert.rejects(quoteAction(db,q.id,{action:'SUBMIT',version:q.version,reason:'VERIFY- unresolved sets'},f.executive),e=>e.status===422&&/final quantities/.test(e.message));
  const html=quotationPrintHtml(q);assert.ok(html.includes('Customer requested specification'));assert.ok(html.includes('Delivery lead time from PO date'));assert.ok(html.includes('&lt;script&gt;bad&lt;/script&gt;'));assert.ok(!html.includes(details.availabilitySource));assert.ok(!html.includes('unitCost'));
  assert.ok(!quotationLineDescription(q.lines[0]).includes(details.availabilitySource));
  const pdf=await quotationPdf(q);assert.equal(pdf.subarray(0,4).toString(),'%PDF');
  const long={...q,lines:[{...q.lines[0],description:'VERIFY- long specification '.repeat(35),requestDetails:{...details,requestedSpecification:'VERIFY- requested standard '.repeat(40)}}]};
  const pages=await quotationPdf(long);assert.ok((pages.toString('latin1').match(/\/Type \/Page\b/g)||[]).length>1);
  q=await saveQuote(db,q.id,{...input,version:q.version,request:{...input.request,quantityConfirmed:true},reason:'VERIFY- reviewed quantities'},f.executive);
  const history=await quoteHistory(db,q.id,f.owner);assert.equal(history.versions[0].public_snapshot.request.quantityConfirmed,true);assert.equal(history.versions[1].public_snapshot.request.quantityConfirmed,false);
  q=await quoteAction(db,q.id,{action:'SUBMIT',version:q.version,reason:'VERIFY- reviewed RFQ ready'},f.executive);assert.equal(q.status,'PENDING_APPROVAL');
  await assert.rejects(quoteAction(db,q.id,{action:'APPROVE',version:q.version,reason:'VERIFY- own approval attempt'},f.executive),{status:403});
  const copy=await duplicateQuote(db,q.id,{reason:'VERIFY- duplicate RFQ'},f.executive);assert.equal(copy.request.quantityConfirmed,false);assert.equal(copy.lines[1].requestDetails.tag,'24KM-1');
  const legacy=await saveQuote(db,null,{...input,request:undefined,lines:input.lines.map(({requestDetails,...line})=>line)},f.executive);assert.equal(legacy.request.reference,'');assert.equal(legacy.lines[0].requestDetails.leadTime,'');
 }finally{await f.close();}
}));
test('real quotation route enforces session, CSRF, creation permission and new field validation without a new listener',()=>withTestTransaction(async db=>{
 const f=await quotationFixture(db),app=createApp({db,config:getConfig({mfaEnabled:false,localReviewAccess:false})}),tokens=new Map();
 for(const actor of [f.executive,f.accounts]){const token=crypto.randomUUID();tokens.set(actor.id,token);await db.sql`INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at) VALUES(${actor.id},${tokenDigest(token)},'VERIFY-csrf',now()+interval '1 hour')`;}
 const call=async(actor,input,csrf=true)=>{const req=Readable.from([Buffer.from(JSON.stringify(input))]);Object.assign(req,{method:'POST',url:'/api/crm/quotations',headers:{host:'localhost','content-type':'application/json',...(actor?{cookie:`crm_session=${tokens.get(actor.id)}`} :{}),...(csrf?{'x-csrf-token':'VERIFY-csrf'}:{})},socket:{remoteAddress:'test'}});const res={headersSent:false,setHeader(){},writeHead(status){this.status=status;this.headersSent=true;},end(data){this.body=JSON.parse(String(data));}};await app(req,res);return res;};
 try{
  await saveQuotePolicy(db,policy,f.owner);const input=body(f);
  assert.equal((await call(null,input)).status,401);assert.equal((await call(f.executive,input,false)).status,403);assert.equal((await call(f.accounts,input)).status,403);
  const invalid=await call(f.executive,{...input,lines:[{...input.lines[0],requestDetails:{...details,availabilitySource:''}}]});assert.equal(invalid.status,422);assert.match(invalid.body.error,/source/);
  const saved=await call(f.executive,input);assert.equal(saved.status,201);assert.equal(saved.body.data.lines[0].requestDetails.leadTime,details.leadTime);assert.equal(saved.body.data.pricing,undefined);
 }finally{await app.close();await f.close();installPermissionProvider(null);}
}));
