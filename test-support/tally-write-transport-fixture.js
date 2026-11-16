import {writeFixture} from './tally-write-fixture.js';
import {writeMapping,writeDocument} from './tally-write-data.js';
import {TallyWriteTransport} from '../src/modules/tally-write/transport.js';
import {fixtureReadback} from './tally-write-data.js';
import {randomUUID} from 'node:crypto';
export async function transportFixture(db,kind='SALES_ORDER'){
  const f=await writeFixture(db),service=new TallyWriteTransport(db),company={id:f.company,name:'ZZTEST_Write Company',guid:'ZZTEST_write_company_guid'};
  const state={document:{...writeDocument,...(kind==='PARTY_LEDGER'?{name:'ZZTEST New party',gstin:'ZZTEST_no_real_tax_id',extraPartyApproval:true,entityId:'ZZTEST_party'}:{}),createdBy:f.maker.id,updatedBy:f.maker.id,approvedBy:f.checker.id,entityType:kind==='PARTY_LEDGER'?'CUSTOMER':kind}};
  const configuration=kind==='PARTY_LEDGER'?{templateVersion:1,reportName:'ZZTEST Masters',idempotencyField:'REFERENCE',idempotencyMethod:'Reference',companyProbe:writeMapping.companyProbe,identityProbe:{collectionType:'Ledger',method:'Name'},readback:{collectionType:'Ledger',fields:[{crm:'name',tally:'NAME',kind:'TEXT'},{crm:'gstin',tally:'PARTYGSTIN',kind:'TEXT'}]},parentField:'PARENT',parentName:'ZZTEST Debtors',partyFields:{gstin:'PARTYGSTIN'}}:writeMapping;
  service.sources={company:async id=>{if(id!==f.company)throw Object.assign(new Error('Wrong fixture company.'),{status:403});return company;},validateMappingImports:async()=>[],document:async()=>state.document};
  await service.setControl(f.maker,{masterEnabled:true,approvalMode:'AUTO_AFTER_BUSINESS_APPROVAL',reason:'ZZTEST isolated protocol fixture'});
  const draft=await service.saveMapping(f.maker,{companyId:f.company,category:kind,configuration,status:'DRAFT',reason:'ZZTEST explicit fake mapping draft'});
  const evidence=await service.mappingDrafts.evidence(f.checker,f.company,draft.id);
  const mapping=await service.saveMapping(f.checker,{companyId:f.company,category:kind,parentVersionId:draft.id,sourceFingerprint:evidence.source_fingerprint,requestKey:randomUUID(),expertName:'ZZTEST Tally expert',expertReference:'ZZTEST retained fixture review',status:'APPROVED',reason:'ZZTEST independent fake mapping review'});
  await service.setCategory(f.maker,kind,{enabled:true,dry_run_only:false,confirmLive:true,company_id:f.company,mapping_id:mapping.id,conflict_winner:{mapped_record:'TALLY',total:'CRM',partyLedgerName:'TALLY',date:'TALLY',number:'TALLY',name:'TALLY',gstin:'TALLY'},tally_version:'ZZTEST fake Tally',xml_import_verified:true,max_attempts:3,backoff_seconds:1,failure_threshold:2,min_gap_seconds:1,per_day_cap:5,lease_seconds:30,reason:'ZZTEST fake-transport-only settings'});
  const connector={id:f.connector,expected_company_name:company.name};
  service.observeHeartbeat(connector,{writeCapability:{protocol:1,version:'1.0.0',createOnly:true},selectedCompany:company.name,selectedCompanyGuid:company.guid});
  const companyXml='<ENVELOPE><BODY><DATA><COLLECTION><COMPANY NAME="ZZTEST_Write Company"><GUID>ZZTEST_write_company_guid</GUID></COMPANY></COLLECTION></DATA></BODY></ENVELOPE>';
  const emptyXml='<ENVELOPE><BODY><DATA><COLLECTION></COLLECTION></DATA></BODY></ENVELOPE>';
  const queue=async()=>{const row=await service.queue(f.maker,{category:kind,entityId:'ZZTEST_1',reason:'ZZTEST queue fake transport'});if(kind==='PARTY_LEDGER')await service.approve(f.checker,f.company,row.id,{reason:'ZZTEST extra independent party push'});return row;};
  const claim=()=>service.claim(connector,{companyId:f.company});
  const found=key=>kind==='PARTY_LEDGER'?`<ENVELOPE><COLLECTION><LEDGER NAME="ZZTEST New party"><GUID>ZZTEST_created_party</GUID><NAME>ZZTEST New party</NAME><PARENT>ZZTEST Debtors</PARENT><PARTYGSTIN>ZZTEST_no_real_tax_id</PARTYGSTIN><REFERENCE>${key}</REFERENCE></LEDGER></COLLECTION></ENVELOPE>`:fixtureReadback(key);
  const leaseBody=job=>({jobId:job.id,leaseToken:job.leaseToken,companyProbeXml:companyXml,readbackXml:emptyXml,identityProbeXml:emptyXml});
  return {...f,service,company,connector,state,companyXml,emptyXml,queue,claim,found,leaseBody};
}
