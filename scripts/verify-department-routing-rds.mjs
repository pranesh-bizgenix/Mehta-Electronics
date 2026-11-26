import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {getConfig} from '../src/config.js';
import {createApp} from '../src/app.js';
import {withAuthorizedRdsRollbackVerification} from '../test-support/transaction.js';
import {operationsFixture} from '../test-support/operations-intake-fixture.js';
import {supportFixture} from '../test-support/support-intake-fixture.js';
import {OperationsIntakeService} from '../src/modules/operations-intake/service.js';
import {AccountsIntakeService} from '../src/modules/accounts-intake/service.js';
import {SupportIntakeService} from '../src/modules/support-intake/service.js';
const report={checks:[],records:[],cleanup:'All source requests, notifications and audit events roll back.'};let app;
try{
 await withAuthorizedRdsRollbackVerification(async db=>{
  app=createApp({db,config:getConfig({schedulerEnabled:false})});await app.modules.ready();
  const saved=JSON.parse(fs.readFileSync('.vercel/acceptance/make-sales-service-credential.private.json'));
  const credential=await db.prepare("SELECT c.*,x.company_id FROM automation_service_credentials c JOIN automation_service_companies x ON x.credential_id=c.id WHERE c.id=? AND c.status='ACTIVE'").get(saved.id);assert.ok(credential);
  const principal={kind:'AUTOMATION_SERVICE',scope:'automation.write.intake',companyId:credential.company_id,credentialId:credential.id,ownerId:credential.owner_id,backupOwnerId:credential.backup_owner_id};
  const operations=new OperationsIntakeService({db}),accounts=new AccountsIntakeService({db,operations:app.modules.services.operations}),support=new SupportIntakeService({db,operations:app.modules.services.operations});
  const a=randomUUID(),po=operationsFixture();po.email_message_id=a;po.provider_message_id='ZZTEST_ROUTING_'+a;
  const b=randomUUID(),payment={schema_version:'meheta-accounts-v1',email_message_id:b,provider_message_id:'ZZTEST_ROUTING_'+b,department:'ACCOUNTS',accounts_branch:'PAYMENT',category:'DUE_PAYMENT',request:{accounts_branch:'PAYMENT',category:'DUE_PAYMENT',intent:{action:'OTHER',summary:'ZZTEST routing only'},invoice_numbers:[],po_numbers:[],payment_references:[],claimed_amount:null,requested_adjustment_amount:null,stated_due_amount:null,currency:'INR',payment_date:null,stated_due_date:null,reason:'ZZTEST routing verification'},original_email:{sender:'fictional@example.test',subject:'ZZTEST_ROUTING Accounts',body:'Fictional routing verification only; no payment occurred.'},review_reasons:[]};
  const question=supportFixture('PRODUCT_ENQUIRY',principal.companyId);
  const cases=[{service:operations,body:po,key:'ops:'+a,table:'crm_operations_intakes',email:'operations@test.local',entity:'OPERATIONS_INTAKE'},
   {service:accounts,body:payment,key:'accounts:'+b,table:'crm_accounts_intakes',email:'accounts@test.local',entity:'ACCOUNTS_INTAKE'},
   {service:support,body:question,key:question.eventId,table:'crm_support_intakes',email:'support@test.local',entity:'SUPPORT_INTAKE'}];
  for(const c of cases){
   const assignee=await db.prepare("SELECT id FROM users WHERE email=? AND status='ACTIVE' AND must_change_password=0").get(c.email);assert.ok(assignee,'Complete the fictional account setup first');
   const first=await c.service.receive(principal,c.body,c.key),second=await c.service.receive(principal,c.body,c.key);
   assert.equal(first.id,second.id);assert.equal(second.duplicate,true);
   const row=await db.prepare(`SELECT assigned_to,backup_owner_id FROM ${c.table} WHERE id=?`).get(first.id);assert.equal(row.assigned_to,assignee.id);assert.equal(row.backup_owner_id,47);
   const notifications=await db.prepare("SELECT count(*)::integer AS n FROM notifications WHERE user_id=? AND payload->>'entityId'=?").get(assignee.id,first.id);assert.equal(notifications.n,1);
   const events=await db.prepare('SELECT count(*)::integer AS n FROM audit_logs WHERE entity=? AND record_id=?').get(c.entity,first.id);assert.ok(events.n>=1);
   report.records.push({table:c.table,id:first.id});report.checks.push(c.entity+': correct owner/backup, one notification, audited receipt and duplicate replay');console.log('PASS '+report.checks.at(-1));
  }
  await app.close();app=null;
 },{productionTransactions:true});
 report.passed=true;
}catch(error){report.error=error.message;process.exitCode=1;}
finally{if(app)await app.close();fs.mkdirSync('verification-output/crm-expansion',{recursive:true});fs.writeFileSync('verification-output/crm-expansion/department-routing-report.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify(report));
