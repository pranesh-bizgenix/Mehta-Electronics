import {crmFixture} from './crm-module-fixture.js';
import {saveCustomer,saveItem} from '../src/crm-modules.js';
export async function quotationFixture(){const f=await crmFixture();
 const owner={id:f.owner,role:'OWNER'},accounts={id:f.accounts,role:'ACCOUNTS'};
 const manager={id:(await f.db.sql`INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES('Quote Manager','manager@example.test','MANAGER','not-a-login',0) RETURNING id`)[0].id,role:'MANAGER'};
 const executive={id:(await f.db.sql`INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES('Quote Executive','executive@example.test','EXECUTIVE','not-a-login',0) RETURNING id`)[0].id,role:'EXECUTIVE'};
 const customer=await saveCustomer(f.db,null,{name:'Quotation Customer',stateCode:'27',gstin:'27ABCDE1234F1Z5',contacts:[{name:'Buyer',email:'buyer@example.test'}]},owner);
 const item=await saveItem(f.db,null,{partCode:'QUOTE-PART',description:'Industrial contactor',uom:'NOS',hsn:'8536',packSize:1,listPrice:'100',moq:1},owner);
 return {...f,owner,manager,executive,accounts,customer,item};
}
