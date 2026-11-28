import test from 'node:test';
import assert from 'node:assert/strict';
import {portalLine,customerPortalLine,PortalRecords} from '../src/modules/portals/records.js';
import {PortalAccess,portalEmailHash} from '../src/modules/portals/access.js';
import {supplierOfferSchema} from '../src/modules/sourcing/service.js';
import {validate} from '../src/core/schema.js';
test('Supplier publication retains requested items but never customer prices or internal costs',()=>{
 const line={itemId:17,partCode:'PART',description:'Component',quantity:'2.250000',uom:'Nos',hsn:'1234',unitPrice:'500',cost:'200',margin:'60',vendorId:9,taxPercent:'18',private_snapshot:{cost:'200'}};
 assert.deepEqual(portalLine(line),{itemId:17,code:'PART',description:'Component',quantity:'2.250000',uom:'Nos',hsn:'1234'});
});
test('Contact identity hashes ignore email case and surrounding whitespace',()=>{assert.equal(portalEmailHash(' Partner@Example.test '),portalEmailHash('partner@example.test'));assert.notEqual(portalEmailHash('other@example.test'),portalEmailHash('partner@example.test'));});
test('Customer quotation details expose the same net rate as the PDF without discount or list price',()=>{
 const r=customerPortalLine({itemId:1,partCode:'SAMPLE',description:'SAMPLE component',quantity:'2',uom:'Nos',unitPrice:'123.456789',discountPercent:'12.5',taxPercent:'18',net:'216.05',cost:'70',listPrice:'200'});
 assert.equal(r.unitPrice,'108.02');assert.equal(r.netAmount,'216.05');for(const key of ['discountPercent','listPrice','cost'])assert.equal(Object.hasOwn(r,key),false);
});
const offer=()=>({rfqVersion:1,replyVersion:null,vendorId:1,validUntil:'2026-12-31',promisedOn:null,currency:'INR',terms:'',reason:'Supplier submission',evidence:'Supplier reference',chargesConfirmed:false,charges:[],lines:[{itemId:1,uom:'Nos',quantity:'2.25',unitPrice:'123.123456',discountPercent:'0',taxPercent:'18'}]});
test('Portal and staff supplier offers share exact decimal strings and unconfirmed charge state',()=>{const r=validate(supplierOfferSchema,offer());assert.equal(r.lines[0].unitPrice,'123.123456');assert.equal(r.chargesConfirmed,false);});
test('Supplier submissions cannot silently include unknown commercial or approval fields',()=>{assert.throws(()=>validate(supplierOfferSchema,{...offer(),approved:true}));assert.throws(()=>validate(supplierOfferSchema,{...offer(),lines:[{...offer().lines[0],margin:'50'}]}));});
test('Supplier prices require decimal strings and refuse non-finite or scientific notation',()=>{for(const unitPrice of [0.1,Infinity,'1e8','NaN','-1'])assert.throws(()=>validate(supplierOfferSchema,{...offer(),lines:[{...offer().lines[0],unitPrice}]}));});
test('Unbound partner and staff accounts cannot impersonate a customer portal session',async()=>{const a=new PortalAccess({db:{}});await assert.rejects(a.member({id:1,role:'OWNER'}),{status:403});});
test('An unrecognised partner record kind fails before any unscoped record query',async()=>{const records=new PortalRecords({access:{db:{},member:async()=>({kind:'CUSTOMER',customer_id:1,company_id:'own-company'})}});await assert.rejects(records.source({},'RFQS',12),{status:403});});
test('An empty portal search is valid and retains server-side party and company filters',async()=>{
 const calls=[],db={prepare:sql=>({get:async(...args)=>{calls.push({sql,args});return {n:0};},all:async(...args)=>{calls.push({sql,args});return [];}})},records=new PortalRecords({access:{db,member:async()=>({kind:'CUSTOMER',customer_id:17,company_id:'bound-company'})}});
 const result=await records.list({},'QUOTATIONS');assert.equal(result.pagination.total,0);assert.equal(calls.length,2);for(const c of calls){assert.deepEqual(c.args.slice(0,3),[17,'bound-company','%%']);assert.match(c.sql,/q.customer_id=\?/);assert.match(c.sql,/public_snapshot->>'companyId'=\?/);}
});
