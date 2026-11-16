import { getConfig } from '../src/config.js';
import { tallyFixture } from './tally-fixture.js';
export async function crmFixture(db) {
 if (!db) throw new Error('crmFixture requires withTestTransaction(db).');
 const source=await tallyFixture(db),company=source.company;
 await source.insert('tally_groups',{id:'VERIFY-g1',name:'VERIFY-Retail',parent_name:'Sundry Debtors'});
 await source.insert('tally_ledgers',{id:'VERIFY-l1',name:'VERIFY-Exact customer',parent_name:'VERIFY-Retail',closing_balance:'12500.25',dr_cr:'Dr'});
 await source.insert('tally_stock_items',{id:'VERIFY-s1',name:'VERIFY-Exact stock',parent_name:'Switchgear',base_unit:'NOS',closing_quantity_text:'24 NOS',closing_rate_text:'125 / NOS',closing_value:'3000'});
 const owner=(await db.sql`INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES('VERIFY-Review Owner','VERIFY-owner@example.test','OWNER','not-a-login',0) RETURNING id`)[0].id;
 const accounts=(await db.sql`INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES('VERIFY-Review Accounts','VERIFY-accounts@example.test','ACCOUNTS','not-a-login',0) RETURNING id`)[0].id;
 return {db,config:getConfig(),company,owner,accounts,close:async()=>{}};
}
