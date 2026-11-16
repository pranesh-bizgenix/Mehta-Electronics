import {fingerprint} from '../../core/runtime.js';

export const CATEGORIES=Object.freeze(['SALES_ORDER','PURCHASE_ORDER','PARTY_LEDGER']);
export const STATUSES=Object.freeze(['PENDING','APPROVED','CLAIMED','SENT','CONFIRMED','FAILED','UNKNOWN','CANCELLED','HELD']);
export const APPROVAL_MODES=Object.freeze(['AUTO_AFTER_BUSINESS_APPROVAL','SEPARATE_PUSH_APPROVAL']);
export const WRITE_CAPABILITY=Object.freeze({protocol:1,version:'1.0.0',createOnly:true});
export const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export function required(value,key){if(value===null||value===undefined||value==='')fail(409,`Not set: ${key}`);return value;}
export function category(value){if(!CATEGORIES.includes(value))fail(422,'Unknown Tally write category.');return value;}
export function reason(value){if(typeof value!=='string'||value.trim().length<3||value.length>2000)fail(422,'A reason of 3 to 2,000 characters is required.');return value.trim();}
export function uuid(value){if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value??''))fail(422,'Invalid record identity.');return value;}
export function settingsIssues(config,{live=false}={}){
  const issues=[];
  const missing=key=>issues.push(`Not set: tally.write.${key}`);
  for(const key of ['company_id','approval_mode','mapping_id','conflict_winner','tally_version'])if(config[key]==null||config[key]==='')missing(key);
  if(config.conflict_winner!=null&&(!config.conflict_winner||typeof config.conflict_winner!=='object'||Array.isArray(config.conflict_winner)||!Object.keys(config.conflict_winner).length||Object.values(config.conflict_winner).some(value=>!['CRM','TALLY'].includes(value))))missing('conflict_winner');
  if(!APPROVAL_MODES.includes(config.approval_mode)&&config.approval_mode!=null)issues.push('Invalid approval mode.');
  for(const key of ['max_attempts','backoff_seconds','failure_threshold','min_gap_seconds','per_day_cap','lease_seconds'])if(!Number.isSafeInteger(config[key])||config[key]<1)missing(key);
  if(config.xml_import_verified!==true)issues.push('Unverified: Tally XML import availability.');
  if(live&&config.dry_run_only!==false)issues.push('Live writes blocked: category is dry-run only.');
  return issues;
}
export function businessApproval(document,categoryName){
  required(document,'document');
  if(document.status!=='APPROVED'||document.locked!==true)fail(409,'Only an approved, locked document is eligible for a Tally create.');
  if(!document.approvedBy||document.approvedBy===document.createdBy||document.approvedBy===document.updatedBy)fail(409,'Independent business approval is required.');
  if(categoryName==='PARTY_LEDGER'&&document.extraPartyApproval!==true)fail(409,'Separate approval for new party-ledger creation is required.');
}
export function documentHash(document){return fingerprint({...document,...(document.sourceEvidence?{sourceEvidence:document.sourceEvidence.map(({recordId,...identity})=>identity)}:{})});}
export function idempotencyKey(companyId,categoryName,entityId,versionHash){return fingerprint({companyId,category:categoryName,entityId:String(entityId),versionHash});}
export function importCapability(value){return value?.protocol===1&&value.createOnly===true&&typeof value.version==='string'&&/^\d+\.\d+\.\d+$/.test(value.version)?{...WRITE_CAPABILITY,version:value.version}:null;}
export function mayProduce(master,config){return master===true&&config?.enabled===true&&config.paused!==true;}
export function expireStatus(row){return row.sent_at||row.status==='SENT'||row.send_authorized_at?'UNKNOWN':'PENDING';}

/** No repository, builder or transport call is allowed before this gate. */
export async function guardedProduce({master,config,produce}){
  if(!mayProduce(master,config))return {inactive:true};
  return produce();
}
