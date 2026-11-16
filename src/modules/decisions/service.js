import {randomUUID} from 'node:crypto';
import {s,validate,compareDecimal} from '../../core/schema.js';
import {forbidden,conflict,ruleNotConfigured,validationFailed} from '../../core/errors.js';
import {AuditRepository,TransactionRunner,fingerprint,canonicalJson} from '../../core/runtime.js';
import {hasPermission} from '../../rbac.js';
import {DecisionCatalog} from './catalog.js';
import {DecisionRepository} from './repository.js';
import {decisionCsv,readDecisionCsv,MAX_DECISION_CSV_BYTES} from './csv.js';

const base={expectedVersion:s.int({min:0,max:2147483646}),requestKey:s.uuid(),reason:s.reason()};
const enterSchema=s.object({...base,value:s.json({maxBytes:20000}),evidenceSource:s.string({max:2000}).optional(),confirm:s.bool()});
const decideSchema=s.object({...base,decision:s.enum(['CONFIRM','REJECT','CLEAR'])});
const bulkSchema=s.object({entries:s.array(s.object({key:s.string({min:1,max:160}),expectedVersion:base.expectedVersion}),{min:1,max:100}),decision:s.enum(['CONFIRM','REJECT','CLEAR']),requestKey:s.uuid(),reason:s.reason()});
const importSchema=s.object({csv:s.string({max:MAX_DECISION_CSV_BYTES,trim:false}),fingerprint:s.string({pattern:/^[a-f0-9]{64}$/}),requestKey:s.uuid(),reason:s.reason()});
function plainObject(value){if(!value||typeof value!=='object'||Array.isArray(value))throw validationFailed('Provide a JSON object.');return value;}
// The pre-existing quotation policy accepts 2,000-character reasons and keeps
// internal whitespace. Trusted adapters must preserve that existing contract;
// the new decision API continues to use s.reason() and its 1,000-character cap.
function legacyReason(value){if(typeof value!=='string'||value.length>2000||value.trim().length<3)throw validationFailed('A policy reason of 3 to 2,000 characters is required.');return value.trim();}
function boundedValue(value){const stack=[[value,0]];let count=0;while(stack.length){const [node,depth]=stack.pop();if(++count>5000||depth>12)throw validationFailed('Decision value has too many nested fields.');if(node&&typeof node==='object'){for(const [key,child]of Object.entries(node)){if(['__proto__','constructor','prototype'].includes(key))throw validationFailed('Decision value has an unsupported field.');stack.push([child,depth+1]);}}}let text;try{text=JSON.stringify(value);}catch{throw validationFailed('Decision value must be bounded JSON.');}if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>20000)throw validationFailed('Decision value must be at most 20,000 UTF-8 bytes.');}

export class DecisionService {
 constructor({db,registry,transactions,audit,access,repository}={}){this.db=db;this.catalog=new DecisionCatalog(registry);this.repository=repository??new DecisionRepository(db);this.transactions=transactions??new TransactionRunner(db);this.audit=audit??new AuditRepository(db);this.access=access??{require(actor,permission){if(!hasPermission(actor,permission))throw forbidden();}};}
 async owner(actor){if(actor?.role!=='OWNER'||!Number.isSafeInteger(actor?.id))throw forbidden('Only the Owner may review or change the decision register.');this.access.require(actor,'rules.manage');if(!await this.repository.owner(actor.id))throw forbidden('An active Owner account is required.');}
 async state(d,current){
  const row=current===undefined?await this.repository.current(d.key):current,canonical=await this.repository.canonical(d),available=canonical&&!canonical.is_cleared;
  let status=row?.status??(available?'ENTERED':'EMPTY'),value=row?row.value_json:(available?canonical.value:null),sourceChanged=false;
  if(row?.status==='CONFIRMED'&&!d.decisionOnly){sourceChanged=!available||row.canonical_version!==canonical.version||row.canonical_hash!==fingerprint(canonical.value);if(sourceChanged){status=available?'ENTERED':'EMPTY';value=available?canonical.value:null;}}
  if(status==='CONFIRMED')try{await this.checked(d,value);}catch{status='ENTERED';sourceChanged=true;}
  return {...this.catalog.metadata(d),value,status,version:row?.version??0,evidenceSource:row?.evidence_source??null,enteredBy:row?.entered_by??(available?canonical.created_by??null:null),enteredByName:row?.entered_by_name??null,confirmedBy:status==='CONFIRMED'?row.confirmed_by:null,confirmedByName:status==='CONFIRMED'?row.confirmed_by_name??null:null,confirmedAt:status==='CONFIRMED'?row.confirmed_at:null,reason:row?.reason??null,updatedAt:row?.created_at??(available?canonical.created_at??null:null),usable:status==='CONFIRMED',sourceChanged,canonical};
 }
 project(state){const {canonical:ignored,...dto}=state;return dto;}
 async list(actor){await this.owner(actor);const current=new Map((await this.repository.currentAll()).map(r=>[r.decision_key,r])),data=[];for(const d of this.catalog.all())data.push(this.project(await this.state(d,current.get(d.key)??null)));const confirmed=data.filter(r=>r.usable).length,owners=await this.repository.owners();return {data,summary:{total:data.length,confirmed,blocked:data.length-confirmed,confirmedPercent:data.length?Math.floor(confirmed*100/data.length):0,onlyOneOwner:owners===1,activeOwners:owners}};}
 async history(actor,key){await this.owner(actor);this.catalog.require(key);return (await this.repository.history(key)).map(r=>({version:r.version,status:r.status,value:r.value_json,evidenceSource:r.evidence_source,reason:r.reason,enteredBy:r.entered_by,confirmedBy:r.confirmed_by,confirmedAt:r.confirmed_at,at:r.created_at,by:r.created_by}));}
 async sheet(actor){return decisionCsv((await this.list(actor)).data);}
 async getSetting(key,{required=false}={}){const d=this.catalog.require(key),state=await this.state(d);let value=null,valid=state.usable;if(valid)try{value=await this.checked(d,state.value);}catch{valid=false;}if(!valid){if(required)throw ruleNotConfigured(key,`Not set: ${key} (awaiting confirmation) — blocks: ${d.dependents.join(', ')}`);return null;}return {value,version:state.canonical?.version??state.version,decisionVersion:state.version,status:'CONFIRMED'};}
 requireSetting(key){return this.getSetting(key,{required:true});}
 async checked(d,raw){boundedValue(raw);const value=this.catalog.validate(d,raw);if(d.key==='quotation.approval_levels')for(const level of value)if(!await this.repository.knownPermission(level.permission))throw validationFailed('Approval levels must use existing permission keys.',{rule:d.key});if(d.key==='credit.exception_authority'&&!await this.repository.knownPermission(value.permission))throw validationFailed('Credit exception authority must use an existing permission.');return value;}
 async append(actor,d,state,{status,value,evidenceSource,reason,requestKey,enteredBy=actor.id,canonicalAlreadyWritten=false}){
  let binding=null;
  if(status==='CONFIRMED'){
   value=await this.checked(d,value);
   if(d.key==='margin.floor_percent'){
    binding=await this.repository.canonical(d);if(!binding||compareDecimal(String(binding.value),String(value))!==0)throw conflict('Save the complete quotation policy first, then confirm its current margin floor. The decision screen cannot replace letterhead or policy settings.','DECISION_EXTERNAL_POLICY_REQUIRED');
   }else if(canonicalAlreadyWritten){binding=await this.repository.canonical(d);if(!binding||binding.is_cleared||canonicalJson(binding.value)!==canonicalJson(value))throw conflict('The saved rule no longer matches this confirmation.','DECISION_SOURCE_CHANGED');}
   else binding=await this.repository.setLegacy(d,value,actor,reason);
  }else if(status==='EMPTY'&&!canonicalAlreadyWritten&&d.key!=='margin.floor_percent')await this.repository.setLegacy(d,null,actor,reason);
  const saved=await this.repository.insert({key:d.key,version:state.version+1,...this.catalog.metadata(d),status,value:status==='EMPTY'?null:value,evidenceSource:evidenceSource??state.evidenceSource??null,reason,requestKey,enteredBy,actor,canonicalVersion:binding?.version??null,canonicalHash:status==='CONFIRMED'?fingerprint(binding?.value??value):null});
  await this.audit.record({actorId:actor.id,entity:'DECISION',recordId:d.key,action:status==='EMPTY'?'CLEAR':status,oldValue:{version:state.version,status:state.status},newValue:{version:saved.version,status,key:d.key,canonicalVersion:binding?.version??null},reason});
  return this.project(await this.state(d,saved));
 }
 async request(actor,operation,input,keys,run){await this.owner(actor);return this.transactions.run(actor,input.reason,async()=>{
  await this.repository.requestLock(input.requestKey);const hash=fingerprint({operation,input}),existing=await this.repository.request(input.requestKey);
  if(existing){if(existing.actor_id!==actor.id||existing.request_hash!==hash||existing.operation!==operation)throw conflict('This requestKey was already used for another decision command.','IDEMPOTENCY_KEY_REUSED');return {...existing.response_body,replayed:true};}
  for(const key of [...new Set(keys)].sort())await this.repository.lock(key);
  const response=await run();if(Buffer.byteLength(JSON.stringify(response),'utf8')>1900000)throw validationFailed('This decision command is too large. Review a smaller selection.');await this.repository.saveRequest({key:input.requestKey,actorId:actor.id,hash,operation,response});return response;
 });}
 async enter(actor,key,raw){const d=this.catalog.require(key),input=validate(enterSchema,plainObject(raw));const value=await this.checked(d,input.value);return this.request(actor,`ENTER:${key}`,input,[key],async()=>{const current=await this.state(d);if(current.version!==input.expectedVersion)throw conflict('Decision changed. Refresh the register before saving.','DECISION_VERSION_CHANGED');return this.append(actor,d,current,{status:input.confirm?'CONFIRMED':'ENTERED',value,evidenceSource:input.evidenceSource,reason:input.reason,requestKey:input.requestKey});});}
 async transition(actor,d,current,decision,reason,requestKey){if(decision==='CLEAR')return this.append(actor,d,current,{status:'EMPTY',value:null,reason,requestKey});if(current.value===null)throw conflict('Enter a value before confirming or rejecting this decision.','DECISION_VALUE_REQUIRED');if(decision==='CONFIRM'&&current.sourceChanged)throw conflict('The canonical policy changed after this decision. Review and re-enter its current value before confirming.','DECISION_SOURCE_CHANGED');if(decision==='CONFIRM'&&current.status==='REJECTED')throw conflict('Re-enter the rejected value for review before confirming it.','DECISION_REJECTED');return this.append(actor,d,current,{status:decision==='CONFIRM'?'CONFIRMED':'REJECTED',value:current.value,enteredBy:current.enteredBy??actor.id,reason,requestKey});}
 async decide(actor,key,raw){const d=this.catalog.require(key),input=validate(decideSchema,plainObject(raw));return this.request(actor,`DECIDE:${key}`,input,[key],async()=>{const current=await this.state(d);if(current.version!==input.expectedVersion)throw conflict('Decision changed. Refresh before deciding.','DECISION_VERSION_CHANGED');return this.transition(actor,d,current,input.decision,input.reason,input.requestKey);});}
 async bulkDecide(actor,raw){const input=validate(bulkSchema,plainObject(raw));if(new Set(input.entries.map(r=>r.key)).size!==input.entries.length)throw validationFailed('Select each decision key only once.');for(const entry of input.entries)this.catalog.require(entry.key);return this.request(actor,'BULK_DECIDE',input,input.entries.map(r=>r.key),async()=>{const rows=[];for(const entry of [...input.entries].sort((a,b)=>a.key.localeCompare(b.key))){const d=this.catalog.require(entry.key),current=await this.state(d);if(current.version!==entry.expectedVersion)throw conflict(`Decision changed: ${entry.key}. Refresh the register.`, 'DECISION_VERSION_CHANGED');rows.push(await this.transition(actor,d,current,input.decision,input.reason,input.requestKey));}return {rows,replayed:false};});}
 async importPlan(actor,csv){await this.owner(actor);const source=readDecisionCsv(csv),rows=[],issues=[],seen=new Set();
  for(const entry of source){
   if(!entry.answer.trim())continue;
   const problems=[];let d,value=null,current=null;
   if(seen.has(entry.key))problems.push('Duplicate decision key.');seen.add(entry.key);
   try{d=this.catalog.require(entry.key);current=await this.state(d);}catch{problems.push('Unknown decision key.');}
   if(!/^(0|[1-9]\d{0,9})$/.test(entry.version)||!Number.isSafeInteger(Number(entry.version)))problems.push('Use the exported whole-number version.');
   else if(current&&Number(entry.version)!==current.version)problems.push('Decision changed since this sheet was exported.');
   try{value=JSON.parse(entry.answer);if(d)value=await this.checked(d,value);}catch(error){problems.push(error.status===422?error.message:'Answer must be valid JSON; quote text and exact decimal strings.');}
   const evidence=entry.evidence_source?.trim()||null;if(evidence&&evidence.length>2000)problems.push('Evidence source must be at most 2000 characters.');
   rows.push({row:entry.row,key:entry.key,label:d?.label??entry.key,expectedVersion:current?.version??null,currentStatus:current?.status??null,currentValue:current?.value??null,value,evidenceSource:evidence,changed:current?canonicalJson(current.value)!==canonicalJson(value)||current.status!=='ENTERED':true,issues:problems});
  }
  if(!rows.length)issues.push('Fill at least one answer cell before importing.');
  return {fingerprint:fingerprint({csv,rows,issues}),canImport:rows.length>0&&!issues.length&&rows.every(r=>!r.issues.length),rows,issues};
 }
 async previewImport(actor,raw){const input=validate(s.object({csv:s.string({max:MAX_DECISION_CSV_BYTES,trim:false})}),plainObject(raw));return this.importPlan(actor,input.csv);}
 async import(actor,raw){const input=validate(importSchema,plainObject(raw));const parsed=readDecisionCsv(input.csv),keys=parsed.filter(r=>r.answer.trim()).map(r=>r.key);return this.request(actor,'IMPORT',input,keys,async()=>{const plan=await this.importPlan(actor,input.csv);if(!plan.canImport)throw validationFailed('Decision import is blocked. Review all row issues.',{issues:plan.issues,rows:plan.rows.filter(r=>r.issues.length).map(r=>({row:r.row,key:r.key,issues:r.issues}))});if(plan.fingerprint!==input.fingerprint)throw conflict('Decision import preview changed. Review the file again.','DECISION_PREVIEW_CHANGED');const rows=[];for(const entry of [...plan.rows].sort((a,b)=>a.key.localeCompare(b.key))){const d=this.catalog.require(entry.key),current=await this.state(d);rows.push(await this.append(actor,d,current,{status:'ENTERED',value:entry.value,evidenceSource:entry.evidenceSource,reason:input.reason,requestKey:input.requestKey}));}return {rows,replayed:false};});}
 // Trusted bridge for the existing Owner policy/rules screens. The caller must
 // have saved the canonical source; no historical row is confirmed on startup.
 async confirmLegacy(actor,key,value,reason,{withinTransaction=false}={}){const d=this.catalog.require(key),why=legacyReason(reason);const run=async()=>{await this.owner(actor);await this.repository.lock(key);const current=await this.state(d);return this.append(actor,d,current,{status:'CONFIRMED',value,evidenceSource:'Owner saved the existing policy or rule screen',reason:why,requestKey:randomUUID(),canonicalAlreadyWritten:true});};return withinTransaction?run():this.transactions.run(actor,why,run);}
 async clearLegacy(actor,key,reason,{withinTransaction=false}={}){const d=this.catalog.require(key),why=legacyReason(reason);const run=async()=>{await this.owner(actor);await this.repository.lock(key);const source=await this.repository.canonical(d);if(source&&!source.is_cleared)throw conflict('Clear the canonical rule before recording its empty decision.');return this.append(actor,d,await this.state(d),{status:'EMPTY',value:null,reason:why,requestKey:randomUUID(),canonicalAlreadyWritten:true});};return withinTransaction?run():this.transactions.run(actor,why,run);}
}
export async function usableSetting(db,key,registry){return new DecisionService({db,registry}).getSetting(key);}
export async function requireSetting(db,key,registry){return new DecisionService({db,registry}).requireSetting(key);}
