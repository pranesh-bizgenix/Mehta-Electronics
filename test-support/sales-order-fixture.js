import {quotationFixture} from './quotation-fixture.js';
import {saveCustomer,saveItem} from '../src/crm-modules.js';
import {saveQuotePolicy,saveQuoteCost,saveQuote,quoteAction} from '../src/quotation-workflow.js';
export async function salesOrderFixture(){const f=await quotationFixture(),{db,owner,manager,executive,company}=f;
 const customer=await saveCustomer(db,f.customer.id,{reason:'Link credit source',creditLimit:'100000',companyId:company,tallyName:'Exact customer'},owner);
 const item=await saveItem(db,f.item.id,{reason:'Link saved stock',companyId:company,tallyName:'Exact stock'},owner);
 await saveQuotePolicy(db,{floorPercent:'20',marginBasis:'LINE_AND_TOTAL',sellerState:'27',letterhead:{name:'Mehta Electronics',gstin:'27ABCDE1234F1Z5'},reason:'Set order review policy'},owner);
 await saveQuoteCost(db,item.id,{unitCost:'70',reason:'Owner entered unit cost'},owner);
 let quote=await saveQuote(db,null,{customerId:customer.id,validUntil:'2099-12-31',placeOfSupply:'27',supplyType:'DOMESTIC_STANDARD',reason:'Order source quotation',lines:[{itemId:item.id,quantity:'10',unitPrice:'100',discountPercent:'0',taxPercent:'18'}]},executive);
 quote=await quoteAction(db,quote.id,{action:'SUBMIT',version:quote.version,reason:'Request source review'},executive);
 quote=await quoteAction(db,quote.id,{action:'APPROVE',version:quote.version,reason:'Approve source quotation'},manager);
 const body={customerId:customer.id,quotationId:quote.id,poNumber:'CLIENT-PO-001',poDate:'2026-10-22',promisedDate:'2026-11-01',poTotal:quote.total,placeOfSupply:'27',supplyType:'DOMESTIC_STANDARD',reason:'Customer approved PO',lines:quote.lines};
 return {...f,customer,item,quote,body};
}
export const sampleOriginal=Buffer.from('%PDF-1.4\n% Synthetic original customer PO for isolated testing\n%%EOF');
