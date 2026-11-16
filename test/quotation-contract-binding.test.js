import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withTestTransaction} from '../test-support/transaction.js';
import {quotationFixture} from '../test-support/quotation-fixture.js';
import {confirmFixturePricing} from '../test-support/business-rule-fixture.js';
import {ContractsRepository,ContractsService} from '../src/modules/operations/contracts.js';
import {TransactionRunner,AuditRepository} from '../src/core/runtime.js';
import {hasPermission} from '../src/rbac.js';
import {forbidden} from '../src/core/errors.js';
import {contractForLine,requireContractBinding} from '../src/modules/operations/customer-gates.js';
import {saveQuotePolicy,saveQuoteCost,saveQuote,quoteAction,quoteForDocument} from '../src/quotation-workflow.js';
const reason='VERIFY- independently reviewed contract binding';
async function setup(db){
 const f=await quotationFixture(db),[reviewer]=await db.sql`INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES('VERIFY-contract_reviewer','VERIFY-contract_review@example.test','OWNER','not-a-login',0) RETURNING id,role`;
 const contracts=new ContractsService({db,repository:new ContractsRepository(db),transactions:new TransactionRunner(db),audit:new AuditRepository(db),access:{require(actor,p){if(!hasPermission(actor,p))throw forbidden();}}});
 const create=async(from,to)=>{const row=await contracts.create(f.owner,f.customer.id,{itemId:f.item.id,quantity:'1',unitPrice:'100',validFrom:from,validTo:to,reason});await contracts.decide(reviewer,row.id,{decision:'APPROVED',reason});return row.id;};
 return {f,create};
}
test('equal-priced replacement agreements and expiry cannot silently replace a retained customer contract',()=>withTestTransaction(async db=>{
 const {f,create}=await setup(db),old=await create('2025-01-01','2025-12-31'),replacement=await create('2026-01-01','2026-12-31'),line={itemId:f.item.id,quantity:'1',unitPrice:'100',discountPercent:'0',rateContractId:old};
 assert.equal(await requireContractBinding(db,f.customer.id,line,'2025-12-31'),old);
 assert.equal(await contractForLine(db,f.customer.id,line,'2026-01-01'),replacement);
 await assert.rejects(()=>requireContractBinding(db,f.customer.id,line,'2026-01-01'),{code:'RATE_CONTRACT_CHANGED'});
 await assert.rejects(()=>requireContractBinding(db,f.customer.id,{...line,rateContractId:replacement},'2027-01-01'),{code:'RATE_CONTRACT_CHANGED'});
 assert.equal(await requireContractBinding(db,f.customer.id,{...line,rateContractId:replacement},'2026-12-31'),replacement);
 await assert.rejects(()=>requireContractBinding(db,f.customer.id,{...line,rateContractId:null},'2026-11-06'),{code:'RATE_CONTRACT_CHANGED'});
}));
test('an agreement added after quotation approval invalidates send and document approval until the draft rebinds',()=>withTestTransaction(async db=>{
 const {f,create}=await setup(db);await confirmFixturePricing(db,f.owner);
 await saveQuotePolicy(db,{floorPercent:'0',marginBasis:'TOTAL',sellerState:'27',letterhead:{name:'VERIFY- seller'},reason},f.owner);
 await saveQuoteCost(db,f.item.id,{unitCost:'1',reason},f.owner);
 const body={customerId:f.customer.id,validUntil:'2099-12-31',placeOfSupply:'27',supplyType:'DOMESTIC_STANDARD',reason,lines:[{itemId:f.item.id,quantity:'1',unitPrice:'100',discountPercent:'0',taxPercent:'0'}]};
 let quote=await saveQuote(db,null,body,f.executive);assert.equal(quote.lines[0].rateContractId,null);
 quote=await quoteAction(db,quote.id,{action:'SUBMIT',version:quote.version,reason},f.executive);quote=await quoteAction(db,quote.id,{action:'APPROVE',version:quote.version,reason},f.manager);
 const contract=await create('2000-01-01','2099-12-31');
 await assert.rejects(()=>quoteAction(db,quote.id,{action:'SEND',version:quote.version,reason},f.manager),{code:'RATE_CONTRACT_CHANGED'});
 assert.equal((await quoteForDocument(db,quote.id,f.accounts)).status,'DRAFT');
 quote=await saveQuote(db,quote.id,{...body,version:quote.version},f.executive);assert.equal(quote.lines[0].rateContractId,contract);
 quote=await quoteAction(db,quote.id,{action:'SUBMIT',version:quote.version,reason},f.executive);assert.equal(quote.status,'PENDING_APPROVAL');
}));
