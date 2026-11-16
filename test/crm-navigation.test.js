import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {Readable} from 'node:stream';
import {readFileSync} from 'node:fs';
import {customerEnquiryHref,quotationOrderHref,commercialRecordHref,tallyRecordHref,contextId,navigationId} from '../public/crm-navigation.js';
import {withTestTransaction} from '../test-support/transaction.js';
import {salesOrderFixture} from '../test-support/sales-order-fixture.js';
import {saveEnquiry} from '../src/crm-modules.js';
import {saveOrder} from '../src/sales-orders.js';
import {saveQuoteCost} from '../src/quotation-workflow.js';
import {createApp} from '../src/app.js';
import {getConfig} from '../src/config.js';
import {tokenDigest} from '../src/security.js';
import {installPermissionProvider} from '../src/rbac.js';

const local=path=>new URL(path,'http://127.0.0.1:3000');
test('customer to enquiry and quote to order carry exact IDs and reject malformed or ambiguous links',()=>{
 const enquiry=local(customerEnquiryHref(42)),order=local(quotationOrderHref('73'));
 assert.equal(enquiry.pathname,'/enquiries');assert.equal(enquiry.searchParams.get('new'),'1');assert.equal(contextId(enquiry.searchParams,'customerId'),'42');
 assert.equal(order.pathname,'/orders');assert.equal(contextId(order.searchParams,'quotationId'),'73');
 assert.equal(contextId(new URLSearchParams(),'open'),null);
 for(const invalid of [0,-1,'','01','1e2','1/2','42&other=1',Number.MAX_SAFE_INTEGER+1])assert.throws(()=>navigationId(invalid));
 assert.throws(()=>contextId(new URLSearchParams('customerId=42&customerId=43'),'customerId'),/more than one/);
});
test('commercial history points to the selected modern or historical record rather than its list',()=>{
 assert.equal(commercialRecordHref('enquiries',101),'/enquiries?open=101');
 assert.equal(commercialRecordHref('quotes',102),'/quotations/102');
 assert.equal(commercialRecordHref('orders',103),'/orders?open=103');
 assert.equal(commercialRecordHref('quotes',104,false),'/api/quotations/104/pdf');
 assert.equal(commercialRecordHref('orders',105,false),'/orders?open=105&legacy=1');
 assert.throws(()=>commercialRecordHref('unknown',1));
});
test('import-history shortcuts preserve entity, source company and special characters in stable record keys',()=>{
 const company=crypto.randomUUID(),key='VERIFY-guid:a/b?#%& +';
 for(const kind of ['customers','items','quotations','enquiries']){const url=local(tallyRecordHref(kind,company,key));assert.equal(url.origin,'http://127.0.0.1:3000');assert.equal(url.searchParams.get('companyId'),company);assert.equal(url.searchParams.get('recordKey'),key);assert.equal(url.searchParams.get('entity'),kind);}
 assert.throws(()=>tallyRecordHref('customers','',key));assert.throws(()=>tallyRecordHref('items',company,''));assert.throws(()=>tallyRecordHref('../bad',company,key));
});
test('frontend link producers and destinations are wired to identity-aware helpers and form context',()=>{
 const read=file=>readFileSync(new URL(`../${file}`,import.meta.url),'utf8');
 assert.match(read('apps/web/app/(app)/customers/[id]/page.tsx'),/customerEnquiryHref\(customer.id\)/);
 assert.match(read('apps/web/features/quotations/quote-editor.tsx'),/quotationOrderHref\(q.id\)/);
 assert.match(read('apps/web/app/(app)/enquiries/page.tsx'),/initialCustomerId=\{initialCustomerId\}/);
 assert.match(read('apps/web/app/(app)/enquiries/page.tsx'),/preferredSource=\{selectedId\|\|creating\?'crm'/);
 assert.match(read('apps/web/app/(app)/orders/page.tsx'),/contextId\(new URLSearchParams\(queryText\),'quotationId'\)/);
 assert.match(read('apps/web/app/(app)/orders/page.tsx'),/setSourceQuote\(q\);if\(q.companyId\)setOrderCompanyId\(q.companyId\);setCustomerId\(String\(q.customerId\)\);setLines\(q.lines\)/);
 for(const file of ['tally-imports.tsx','tally-sales-documents.tsx'])assert.match(read(`apps/web/features/workflows/${file}`),/tallyRecordHref\(kind,companyId!?,selected.record_key\)/);
 assert.match(read('apps/web/app/(app)/tally/page.tsx'),/openDetail\(\{record_key:initialRecordKey\}\)/);
});
test('linked destinations load exact customer/enquiry/quote/order records and retain permissions and approved-source gates',()=>withTestTransaction(async db=>{
 const f=await salesOrderFixture(db),app=createApp({db,config:getConfig({mfaEnabled:false,localReviewAccess:false})}),tokens=new Map();
 for(const actor of [f.executive,f.accounts]){const token=crypto.randomUUID();tokens.set(actor.id,token);await db.sql`INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at) VALUES(${actor.id},${tokenDigest(token)},'VERIFY-csrf',now()+interval '1 hour')`;}
 const request=async(path,actor=f.executive)=>{const req=Readable.from([]);Object.assign(req,{method:'GET',url:path,headers:{host:'localhost',...(actor?{cookie:`crm_session=${tokens.get(actor.id)}`} :{})},socket:{remoteAddress:'test'}});const res={headersSent:false,setHeader(){},writeHead(status){this.status=status;this.headersSent=true;},end(body){this.body=JSON.parse(String(body));}};await app(req,res);return res;};
 try{
  const enquiry=await saveEnquiry(db,null,{customerId:f.customer.id,subject:'VERIFY- context enquiry',lines:[{itemId:f.item.id,quantity:'2'}]},f.executive),order=await saveOrder(db,null,f.body,f.executive);
  const customerId=contextId(local(customerEnquiryHref(f.customer.id)).searchParams,'customerId');
  const customer=await request(`/api/crm/customers/${customerId}`);assert.equal(customer.status,200);assert.equal(customer.body.data.id,f.customer.id);
  const quoteId=contextId(local(quotationOrderHref(f.quote.id)).searchParams,'quotationId'),source=await request(`/api/crm/order-quotes/${quoteId}`);assert.equal(source.status,200);assert.equal(source.body.data.id,f.quote.id);assert.equal(source.body.data.customerId,f.customer.id);assert.equal(source.body.data.lines[0].unitPrice,'100');assert.equal(source.body.data.pricing,undefined);
  assert.equal((await request(`/api/crm/order-quotes/${quoteId}`,null)).status,401);assert.equal((await request(`/api/crm/order-quotes/${quoteId}`,f.accounts)).status,403);
  for(const [kind,id,path]of [['enquiries',enquiry.id,`/api/crm/enquiries/${enquiry.id}`],['quotes',f.quote.id,`/api/crm/quotations/${f.quote.id}`],['orders',order.id,`/api/crm/orders/${order.id}`]]){
   const history=await request(`/api/crm/customers/${f.customer.id}/history/${kind}`);assert.equal(history.status,200);const row=history.body.data.find(row=>row.id===id);assert.equal(row.href,commercialRecordHref(kind,id));assert.equal(row.managed,true);assert.equal((await request(path)).body.data.id,id);
  }
  const legacyQuote=(await db.sql`INSERT INTO quotations(quotation_number,customer_id,valid_until,created_by,updated_by) VALUES('VERIFY-CONTEXT_OLD_Q',${f.customer.id},'2099-12-31',${f.owner.id},${f.owner.id}) RETURNING id`)[0].id;
  const legacyOrder=(await db.sql`INSERT INTO sales_orders(order_number,quotation_id,customer_id,created_by,updated_by) VALUES('VERIFY-CONTEXT_OLD_O',${legacyQuote},${f.customer.id},${f.owner.id},${f.owner.id}) RETURNING id`)[0].id;
  const oldQuotes=(await request(`/api/crm/customers/${f.customer.id}/history/quotes`)).body.data,oldOrders=(await request(`/api/crm/customers/${f.customer.id}/history/orders`)).body.data;
  assert.equal(oldQuotes.find(row=>row.id===legacyQuote).href,commercialRecordHref('quotes',legacyQuote,false));assert.equal(oldOrders.find(row=>row.id===legacyOrder).href,commercialRecordHref('orders',legacyOrder,false));
  assert.equal((await request(`/api/orders/${legacyOrder}`)).body.data.id,legacyOrder);
  await saveQuoteCost(db,f.item.id,{unitCost:'69',reason:'VERIFY- invalidate approved pricing'},f.owner);
  assert.equal((await request(`/api/crm/order-quotes/${quoteId}`)).status,409);
 }finally{await app.close();await f.close();installPermissionProvider(null);}
}));
