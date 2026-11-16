import {quotationFixture} from './quotation-fixture.js';
import {confirmFixturePricing,confirmFixtureCredit,fixtureRuleService} from './business-rule-fixture.js';
import {saveCustomer,saveItem,decideCustomerOnboarding} from '../src/crm-modules.js';
import {saveQuotePolicy,saveQuoteCost,saveQuote,quoteAction} from '../src/quotation-workflow.js';
import {prepareOrderStock} from './order-stock-fixture.js';
export async function salesOrderFixture(transactionDb){const f=await quotationFixture(transactionDb),{db,owner,manager,executive,company}=f;try{
 await confirmFixturePricing(db,owner);await confirmFixtureCredit(db,owner);
 await fixtureRuleService(db).set(owner,'credit.validation',{exposureBasis:'DEBIT_BALANCE_PLUS_OPEN_ORDERS',maximumSourceAgeMinutes:60,allowUnavailableOwnerReview:true},'VERIFY- confirmed policy for isolated test fixture');
 const customer=await saveCustomer(db,f.customer.id,{reason:'Link credit source',creditLimit:'100000',companyId:company,tallyName:'VERIFY-Exact customer'},owner);
 await decideCustomerOnboarding(db,customer.id,{decision:'APPROVE',version:customer.onboarding.version,reason:'VERIFY- review updated billing identity'},f.customerReviewer);
 const item=await saveItem(db,f.item.id,{reason:'Link saved stock',companyId:company,tallyName:'VERIFY-Exact stock'},owner);
 const stockSource=await prepareOrderStock(db,{...f,item});
 await saveQuotePolicy(db,{floorPercent:'20',marginBasis:'LINE_AND_TOTAL',sellerState:'27',letterhead:{name:'Mehta Electronics',gstin:'27ABCDE1234F1Z5'},reason:'Set order review policy'},owner);
 await saveQuoteCost(db,item.id,{unitCost:'70',reason:'Owner entered unit cost'},owner);
 let quote=await saveQuote(db,null,{customerId:customer.id,validUntil:'2099-12-31',placeOfSupply:'27',supplyType:'DOMESTIC_STANDARD',reason:'Order source quotation',lines:[{itemId:item.id,quantity:'10',unitPrice:'100',discountPercent:'0',taxPercent:'18'}]},executive);
 quote=await quoteAction(db,quote.id,{action:'SUBMIT',version:quote.version,reason:'Request source review'},executive);
 quote=await quoteAction(db,quote.id,{action:'APPROVE',version:quote.version,reason:'Approve source quotation'},manager);
 const body={companyId:company,customerId:customer.id,quotationId:quote.id,poNumber:'VERIFY-CLIENT-PO-001',poDate:'2026-10-22',promisedDate:'2026-11-01',poTotal:quote.total,placeOfSupply:'27',supplyType:'DOMESTIC_STANDARD',reason:'Customer approved PO',lines:quote.lines.map(line=>({...line,stockBasis:'FREE_STOCK',stockReservationKey:null,stockTallyOrderKey:null}))};
 return {...f,customer,item,quote,body,stockGuid:stockSource.guid};}catch(error){await f.close();throw error;}
}
export const sampleOriginal=Buffer.from('%PDF-1.4\n% Synthetic original customer PO for isolated testing\n%%EOF');
