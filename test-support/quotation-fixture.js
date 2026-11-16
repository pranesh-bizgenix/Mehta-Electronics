import {crmFixture} from './crm-module-fixture.js';
import {saveCustomer,saveItem,decideCustomerOnboarding} from '../src/crm-modules.js';
export async function quotationFixture(transactionDb){const f=await crmFixture(transactionDb);try{
 const owner={id:f.owner,role:'OWNER'},accounts={id:f.accounts,role:'ACCOUNTS'};
 const manager={id:(await f.db.sql`INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES('VERIFY-Quote Manager','VERIFY-manager@example.test','MANAGER','not-a-login',0) RETURNING id`)[0].id,role:'MANAGER'};
 const executive={id:(await f.db.sql`INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES('VERIFY-Quote Executive','VERIFY-executive@example.test','EXECUTIVE','not-a-login',0) RETURNING id`)[0].id,role:'EXECUTIVE'};
 const customer=await saveCustomer(f.db,null,{name:'VERIFY-Quotation Customer',stateCode:'27',gstin:'27ZZZZZ0003Z1Z5',creditLimit:'0',creditDays:0,ownerId:executive.id,contacts:[{name:'Buyer',email:'verify-quotation-buyer@example.test'}]},owner);
 const customerReviewer={id:(await f.db.sql`INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES('VERIFY-Customer Reviewer','VERIFY-customer_reviewer@example.test','OWNER','not-a-login',0) RETURNING id`)[0].id,role:'OWNER'};
 await decideCustomerOnboarding(f.db,customer.id,{decision:'APPROVE',version:customer.onboarding.version,reason:'VERIFY- independent customer review'},customerReviewer);
 const item=await saveItem(f.db,null,{partCode:'VERIFY-QUOTE-PART',description:'Industrial contactor',uom:'NOS',hsn:'8536',packSize:1,listPrice:'100',moq:1},owner);
 return {...f,owner,manager,executive,accounts,customerReviewer,customer,item};}catch(error){await f.close();throw error;}
}
