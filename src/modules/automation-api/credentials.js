import crypto from 'node:crypto';
import {BlockList,isIP} from 'node:net';
import {s,validate} from '../../core/schema.js';
import {AppError,conflict,forbidden,notFound,unauthorized,validationFailed} from '../../core/errors.js';
import {fingerprint} from '../../core/runtime.js';
import {safeEqual,tokenDigest} from '../../security.js';
import {AUTOMATION_SCOPES} from './contract.js';
const createSchema=s.object({id:s.uuid(),label:s.string({min:1,max:120}),scopes:s.array(s.enum(AUTOMATION_SCOPES),{min:1,max:3}),companyIds:s.array(s.uuid(),{min:1,max:100}),ownerId:s.id(),backupOwnerId:s.id(),expiresAt:s.datetime(),ratePerMinute:s.int({min:1,max:100000}),ipAllowlist:s.array(s.string({min:1,max:100}),{max:100}),reason:s.reason()});
const changeSchema=s.object({requestKey:s.uuid(),expectedGeneration:s.int({min:1}),reason:s.reason()});
export const normalisePeer=value=>typeof value==='string'&&value.toLowerCase().startsWith('::ffff:')&&isIP(value.slice(7))===4?value.slice(7):value;
export function parseAllowlist(values){
 const list=new BlockList();
 for(const entry of values){const [address,prefix,...extra]=entry.split('/'),family=isIP(address);if(extra.length||!family||prefix!==undefined&&!/^\d{1,3}$/.test(prefix))throw validationFailed('IP allowlist must contain literal IP addresses or CIDR subnets; host names are not accepted.');
  const type=family===4?'ipv4':'ipv6';
  try{if(prefix===undefined)list.addAddress(address,type);else{const bits=Number(prefix);if(bits>(family===4?32:128))throw new Error();list.addSubnet(address,bits,type);}}catch{throw validationFailed('An IP allowlist address or subnet prefix is invalid.');}
 }return list;
}
export function allowsPeer(values,peer){if(!values.length)return true;peer=normalisePeer(peer);const family=isIP(peer);return Boolean(family&&parseAllowlist(values).check(peer,family===4?'ipv4':'ipv6'));}
const publicCredential=row=>({id:row.id,label:row.label,status:row.status,generation:row.generation,scopes:row.scopes,ownerId:row.owner_id,backupOwnerId:row.backup_owner_id,expiresAt:row.expires_at,ratePerMinute:row.rate_per_minute,ipAllowlist:row.ip_allowlist,createdBy:row.created_by,createdAt:row.created_at});
const secret=id=>`cdsvc.${id}.${crypto.randomBytes(32).toString('base64url')}`;
export class AutomationCredentialRepository {
 constructor(db){this.db=db;}
 lock(id){return this.db.prepare('SELECT * FROM automation_service_credentials WHERE id=? FOR UPDATE').get(id);}
 list(){return this.db.prepare('SELECT * FROM automation_service_credentials ORDER BY created_at DESC,id LIMIT 100').all();}
 companies(id){return this.db.prepare('SELECT company_id FROM automation_service_companies WHERE credential_id=? ORDER BY company_id').all(id);}
 user(id){return this.db.prepare('SELECT id,role,status FROM users WHERE id=?').get(id);}
 company(id){return this.db.prepare('SELECT id FROM tally_companies WHERE id=?').get(id);}
 async insert(b,actor,hash,configHash){
  await this.db.prepare('INSERT INTO automation_service_credentials(id,label,token_hash,scopes,owner_id,backup_owner_id,expires_at,rate_per_minute,ip_allowlist,config_hash,created_by) VALUES(?,?,?,?::text::jsonb,?,?,?,?,?::text::jsonb,?,?)').run(b.id,b.label,hash,JSON.stringify(b.scopes),b.ownerId,b.backupOwnerId,b.expiresAt,b.ratePerMinute,JSON.stringify(b.ipAllowlist),configHash,actor.id);
  for(const companyId of b.companyIds)await this.db.prepare('INSERT INTO automation_service_companies(credential_id,company_id,created_by) VALUES(?,?,?)').all(b.id,companyId,actor.id);
 }
 change(row,hash,revoke){return this.db.prepare('UPDATE automation_service_credentials SET token_hash=?,generation=generation+1,status=? WHERE id=?').run(hash,revoke?'REVOKED':'ACTIVE',row.id);}
 eventByKey(id,key){return this.db.prepare('SELECT action,details FROM automation_service_credential_events WHERE credential_id=? AND request_key=?').get(id,key);}
 async event(row,{action,actor=null,service=false,reason,requestKey=null,details={},at}){await this.db.prepare('INSERT INTO automation_service_credential_events(credential_id,action,generation,actor_kind,actor_user_id,actor_credential_id,reason,request_key,details,created_at) VALUES(?,?,?,?,?,?,?,?,?::text::jsonb,?)').all(row.id,action,row.generation,actor?'OWNER':service?'SERVICE':'UNAUTHENTICATED',actor?.id??null,service?row.id:null,reason,requestKey,JSON.stringify(details),at.toISOString());}
 async countInWindow(id,start,end){return (await this.db.prepare("SELECT count(*)::integer AS n FROM automation_service_credential_events WHERE credential_id=? AND action='AUTH_ACCEPTED' AND created_at>=? AND created_at<?").get(id,start.toISOString(),end.toISOString())).n;}
}
export class AutomationCredentialService {
 constructor(dependencies){Object.assign(this,dependencies);this.failedPeers=new Map();}
 owner(actor){this.access.require(actor,'rules.manage');if(actor?.role!=='OWNER')throw forbidden('Only Owner may provision automation service credentials.');}
 async list(actor){this.owner(actor);const rows=await this.repository.list();return Promise.all(rows.map(async row=>({...publicCredential(row),companyIds:(await this.repository.companies(row.id)).map(r=>r.company_id)})));}
 async create(actor,input){
  this.owner(actor);const b=validate(createSchema,input);parseAllowlist(b.ipAllowlist);
  if(new Set(b.scopes).size!==b.scopes.length||new Set(b.companyIds).size!==b.companyIds.length)throw validationFailed('Scopes and companies must not repeat.');
  if(b.ownerId===b.backupOwnerId)throw validationFailed('Choose a different actual backup owner.');
  b.scopes.sort();b.companyIds.sort();const configHash=fingerprint(b);
  return this.transactions.run(actor,b.reason,async()=>{
   await this.db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,0))').get(`automation-credential:${b.id}`);
   const existing=await this.repository.lock(b.id);if(existing){if(existing.created_by!==actor.id||existing.config_hash!==configHash)throw conflict('Credential ID was already used for different settings.');return {...publicCredential(existing),token:null,replayed:true};}
   if(new Date(b.expiresAt)<=this.clock.now())throw validationFailed('Choose an expiry in the future.');
   for(const id of [b.ownerId,b.backupOwnerId])if((await this.repository.user(id))?.status!=='ACTIVE')throw validationFailed('Owner and backup must be actual active staff accounts.');
   for(const id of b.companyIds)if(!await this.repository.company(id))throw validationFailed('Choose actual imported companies.');
   const token=secret(b.id);await this.repository.insert(b,actor,tokenDigest(token),configHash);const row=await this.repository.lock(b.id);
   await this.repository.event(row,{action:'CREATE',actor,reason:b.reason,at:this.clock.now()});await this.audit.record({actorId:actor.id,entity:'AUTOMATION_CREDENTIAL',recordId:b.id,action:'CREATE',reason:b.reason,newValue:{...publicCredential(row),companyIds:b.companyIds}});
   return {...publicCredential(row),token,replayed:false};
  });
 }
 async change(actor,id,input,revoke=false){
  this.owner(actor);id=validate(s.uuid(),id);const b=validate(changeSchema,input),action=revoke?'REVOKE':'ROTATE',commandHash=fingerprint({id,...b,action});
  return this.transactions.run(actor,b.reason,async()=>{
   const row=await this.repository.lock(id);if(!row)throw notFound('Service credential not found.');
   const old=await this.repository.eventByKey(id,b.requestKey);if(old){if(old.action!==action||old.details.commandHash!==commandHash)throw conflict('This request key was already used for a different credential change.');return {...publicCredential(row),token:null,replayed:true};}
   if(row.status!=='ACTIVE'||row.generation!==b.expectedGeneration)throw conflict('Credential state changed. Reload before rotating or revoking.');
   if(!revoke&&new Date(row.expires_at)<=this.clock.now())throw conflict('Expired credentials must be replaced; rotation does not extend their expiry.');
   const token=revoke?null:secret(id);await this.repository.change(row,revoke?row.token_hash:tokenDigest(token),revoke);const updated=await this.repository.lock(id);
   await this.repository.event(updated,{action,actor,reason:b.reason,requestKey:b.requestKey,details:{commandHash},at:this.clock.now()});await this.audit.record({actorId:actor.id,entity:'AUTOMATION_CREDENTIAL',recordId:id,action,reason:b.reason,newValue:publicCredential(updated)});
   return {...publicCredential(updated),token,replayed:false};
  });
 }
 // Security abuse cap for failed authentication only; valid request throughput
 // is governed by the Owner's explicit per-credential rate, not this counter.
 peerFailure(peer){const key=tokenDigest(peer||'unknown'),now=this.clock.now().getTime(),old=this.failedPeers.get(key);if(old&&now-old.at<60000){old.n++;return;}if(this.failedPeers.size>=10000)this.failedPeers.delete(this.failedPeers.keys().next().value);this.failedPeers.set(key,{at:now,n:1});}
 async authenticate({authorization,companyId,scope,peer}){
  const now=this.clock.now(),peerKey=tokenDigest(peer||'unknown'),failure=this.failedPeers.get(peerKey);
  if(failure&&now.getTime()-failure.at<60000&&failure.n>=100)throw new AppError(429,'RATE_LIMITED','Too many failed service authentication attempts.');
  const match=typeof authorization==='string'&&/^Bearer (cdsvc\.([a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\.[A-Za-z0-9_-]{43})$/.exec(authorization);
  if(!match){this.peerFailure(peer);throw unauthorized('A service bearer credential is required.');}
  companyId=validate(s.uuid(),companyId,'companyId');if(!AUTOMATION_SCOPES.includes(scope))throw forbidden('Unsupported automation scope.');
  const result=await this.transactions.run(null,'Authenticate scoped automation credential',async()=>{
   const row=await this.repository.lock(match[2]);
   let error=null,known=Boolean(row&&safeEqual(row.token_hash,tokenDigest(match[1])));
   if(!known||row.status!=='ACTIVE'||row.is_deleted||new Date(row.expires_at)<=now)error=unauthorized('Service credential is invalid, expired or revoked.');
   else if((await this.repository.user(row.created_by))?.role!=='OWNER'||(await this.repository.user(row.created_by))?.status!=='ACTIVE')error=unauthorized('Service credential is unavailable.');
   else if(!row.scopes.includes(scope))error=forbidden('This service credential lacks the required scope.');
   else if(!(await this.repository.companies(row.id)).some(r=>r.company_id===companyId))error=forbidden('This service credential cannot access the selected company.');
   else if(!allowsPeer(row.ip_allowlist,peer))error=forbidden('This source IP is not allowed.');
   const start=new Date(Math.floor(now.getTime()/60000)*60000),end=new Date(start.getTime()+60000);
   if(!error&&await this.repository.countInWindow(row.id,start,end)>=row.rate_per_minute)error=new AppError(429,'RATE_LIMITED','Service credential rate limit reached.');
   if(!error)await this.db.prepare("SELECT set_config('mehta.automation_credential_id',?,true)").get(row.id);
   if(row)await this.repository.event(row,{action:error?'AUTH_REFUSED':'AUTH_ACCEPTED',service:!error,reason:error?'Service authentication refused':'Scoped service authentication accepted',details:{scope,peerHash:peerKey,...(error?{code:error.code}:{companyId})},at:now});
   await this.audit.record({actorId:null,entity:'AUTOMATION_AUTH',recordId:row?.id??'unknown',action:error?'REFUSED':'ACCEPTED',reason:error?'Service authentication refused':'Scoped service authentication accepted',newValue:{credentialId:row?.id??null,scope,peerHash:peerKey,code:error?.code??'ACCEPTED'}});
   return error?{error}:{principal:{kind:'AUTOMATION_SERVICE',credentialId:row.id,generation:row.generation,scope,companyId,ownerId:row.owner_id,backupOwnerId:row.backup_owner_id}};
  });
  if(result.error){this.peerFailure(peer);throw result.error;}return result.principal;
 }
}
