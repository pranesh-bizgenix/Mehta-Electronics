import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import {withAuthorizedRdsRollbackVerification} from '../test-support/transaction.js';
import {BankService} from '../src/modules/accounts/bank-service.js';
import {TransactionRunner} from '../src/core/runtime.js';
import {BANK_COLUMNS} from '../src/modules/accounts/bank-domain.js';

const tag='ZZTEST_BANK_'+randomUUID(),reason=tag+' rollback-only verification',checks=[];
await withAuthorizedRdsRollbackVerification(async db=>{
 const owner=await db.prepare("SELECT id,role FROM users WHERE role='OWNER' AND status='ACTIVE' ORDER BY id LIMIT 1").get();assert.ok(owner);
 const reviewer={id:(await db.prepare("INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES(?,?,'OWNER','not-a-login',0) RETURNING id").get(tag,tag+'@example.test')).id,role:'OWNER'};
 const company=await db.prepare('SELECT id FROM tally_companies ORDER BY created_at LIMIT 1').get();assert.ok(company);
 const service=new BankService({db}),check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS',name);};
 const account=await service.createAccount(owner,{companyId:company.id,reference:tag,reason});
 await check('Bank account creator cannot verify own account',()=>assert.rejects(service.verifyAccount(owner,account.id,{reason}),{status:403}));
 await service.verifyAccount(reviewer,account.id,{reason});
 const csv=BANK_COLUMNS.join(',')+'\n2026-11-01,2026-11-01,CREDIT,100.00,1100.00,'+tag+',Rollback fixture\n2026-11-02,,DEBIT,1.00,1099.00,'+tag+'-FEE,Rollback fee';
 const body={requestKey:randomUUID(),bankAccountId:account.id,filename:tag+'.csv',base64:Buffer.from(csv).toString('base64'),openingBalance:'1000',closingBalance:'1099',order:'OLDEST_FIRST',reason};
 await check('Actual statement preview checks every running balance',async()=>assert.equal((await service.preview(owner,body)).plan.count,2));
 const statement=await service.import(owner,body);
 await check('Bank statement persists exact source rows and immutable original',async()=>{assert.equal(statement.lines.length,2);const original=await db.prepare('SELECT original_bytes,sha256 FROM crm_bank_source_files WHERE import_id=?').get(statement.id);assert.equal(Buffer.from(original.original_bytes).toString(),csv);});
 await check('Repeated import returns the same statement without duplicate bank rows',async()=>assert.equal((await service.import(owner,body)).id,statement.id));
 await check('Changed opening balance fails without creating another statement',()=>assert.rejects(service.import(owner,{...body,openingBalance:'1001'}),{status:422}));
 await check('Statement maker cannot approve own import',()=>assert.rejects(service.review(owner,statement.id,{decision:'APPROVE',reason}),{status:403}));
 await service.review(reviewer,statement.id,{decision:'APPROVE',reason});
 // Confirmed receipt fixture only: this verification does not claim to test
 // invoice issuance or the existing receipt-confirmation workflow.
 let receipt;
 await new TransactionRunner(db).run(owner,reason,async()=>{
  const customer=await db.prepare("INSERT INTO customers(name,normalized_name,created_by,updated_by) VALUES(?,?,?,?) RETURNING id").get(tag,tag.toLowerCase(),owner.id,owner.id);
  await db.prepare("INSERT INTO crm_customer_profiles(customer_id,company_id,tally_ledger_name,created_by) VALUES(?,?,?,?)").run(customer.id,company.id,tag,owner.id);
  receipt=await db.prepare("INSERT INTO crm_operations(kind,reference,title,customer_id,owner_id,backup_id,status,payload,created_by,updated_by) VALUES('RECEIPT',?,?,?, ?,?,'CONFIRMED',?::text::jsonb,?,?) RETURNING *").get(tag,tag,customer.id,owner.id,reviewer.id,JSON.stringify({amount:'100',transactionReference:tag,paymentDate:'2026-11-01'}),owner.id,owner.id);
 });
 const credit=statement.lines.find(line=>line.direction==='CREDIT');
 await check('Suggestions match the bank reference and customer company',async()=>assert.ok((await service.suggestions(owner,credit.id)).data.some(row=>row.id===receipt.id)));
 const proposal=await service.propose(owner,credit.id,{operationId:receipt.id,amount:'60',reason});
 await check('Bank match maker cannot confirm their own proposal',()=>assert.rejects(service.confirm(owner,proposal.id,{decision:'CONFIRM',reason}),{status:403}));
 await service.confirm(reviewer,proposal.id,{decision:'CONFIRM',reason});
 await check('Partial match updates the bank line without creating a receipt',async()=>{const after=await service.detail(owner,statement.id);assert.equal(after.lines.find(l=>l.id===credit.id).status,'PARTIALLY_MATCHED');assert.equal(after.lines.find(l=>l.id===credit.id).matched,'60.000000');});
 await check('Already matched receipt capacity cannot be consumed twice',()=>assert.rejects(service.propose(owner,credit.id,{operationId:receipt.id,amount:'41',reason}),{status:409}));
 await check('Bank register PDF renders with the existing branding',async()=>{const file=await service.pdf(owner,statement.id,{reason,preview:true});assert.equal(file.bytes.subarray(0,5).toString(),'%PDF-');});
 await check('Bank source audit contains hashes and IDs rather than file contents',async()=>{const row=await db.prepare("SELECT new_value FROM audit_logs WHERE entity='BANK_STATEMENT_SOURCE' AND record_id=?").get(statement.id);assert.ok(row);assert.ok(!JSON.stringify(row.new_value).includes('Rollback fixture'));});
},{productionTransactions:true});
await withAuthorizedRdsRollbackVerification(async db=>assert.equal((await db.prepare('SELECT count(*)::integer AS n FROM bank_accounts WHERE account_reference=?').get(tag)).n,0));
await fs.mkdir('verification-output/crm-completion',{recursive:true});await fs.writeFile('verification-output/crm-completion/bank-rds-report.json',JSON.stringify({checks,passed:checks.length,cleanup:'ROLLBACK_VERIFIED',scope:'Customer bank-credit matching. Confirmed receipts were rollback-only source fixtures. No bank transfer, receipt confirmation or Tally write was executed.'},null,2));
