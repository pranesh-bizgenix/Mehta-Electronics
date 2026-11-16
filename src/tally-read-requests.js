import {validationFailed,forbidden} from './core/errors.js';
import {readCompany} from './tally-read-service.js';
import {hasPermission} from './rbac.js';
import {transaction} from './crm-modules.js';
import {writeAudit} from './db.js';
export function readRequestIds(value){
 if(value===undefined)return [];
 if(!Array.isArray(value)||value.length>20||new Set(value).size!==value.length||value.some(id=>typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))throw validationFailed('Provide at most 20 unique read request UUIDs.');
 return value;
}
export async function requestTallyRead(db,url,body,user,{conflictId=null,entityKind='company',recordKey=null}={}){
 if(!hasPermission(user,'tally.sync'))throw forbidden('Tally sync permission is required.');
 const company=await readCompany(db,url),reason=typeof body?.reason==='string'?body.reason.trim():'';
 if(reason.length<3||reason.length>2000)throw validationFailed('Provide a recovery reason of 3–2000 characters.');
 return transaction(db,user,reason,async()=>{
  const connectors=await db.prepare("SELECT id FROM tally_connectors WHERE expected_company_name=? AND status='active' AND revoked_at IS NULL ORDER BY id").all(company.name);
  if(connectors.length!==1)throw validationFailed('Select a company with exactly one active connector profile. Review Tally connector setup first.');
  await db.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get(`${company.id}:${conflictId??'company-read'}`);
  const existing=await db.prepare(`SELECT id,status,created_at FROM tally_read_requests WHERE company_id=? AND connector_id=? AND status='REQUESTED' AND conflict_id IS NOT DISTINCT FROM ?::uuid ORDER BY created_at LIMIT 1`).get(company.id,connectors[0].id,conflictId);
  if(existing)return {...existing,alreadyRequested:true};
  const saved=await db.prepare('INSERT INTO tally_read_requests(company_id,connector_id,conflict_id,entity_kind,record_key,reason,created_by) VALUES(?,?,?,?,?,?,?) RETURNING id,status,created_at').get(company.id,connectors[0].id,conflictId,entityKind,recordKey,reason,user.id);
  await writeAudit(db,{userId:user.id,entity:'TALLY_READ_REQUEST',recordId:saved.id,action:'REQUESTED',newValue:{companyId:company.id,connectorId:connectors[0].id,conflictId,entityKind,recordKey},reason});
  return {...saved,note:'Queued for the existing connector. It will refresh company collections including this record and re-index after delivery. This is not a completed live Tally read.'};
 });
}
