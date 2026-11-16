import {readCompany} from './tally-read-service.js';
import {hasPermission} from './rbac.js';
import {TALLY_ENTITY_DESCRIPTORS} from '../public/tally-entity-descriptors.js';

export function datasetFreshness(dataset,latest,successful,now=new Date()){
 const timestamp=successful?.processed_at?new Date(successful.processed_at):null;
 const valid=timestamp&&Number.isFinite(timestamp.getTime())&&timestamp<=now;
 const evidence=successful?.collection_metadata?.[dataset],source=evidence?.sourceTimestamp?new Date(evidence.sourceTimestamp):null;
 const validSource=source&&Number.isFinite(source.getTime())&&source<=now;
 return {dataset,lastSuccessfulSync:valid?timestamp.toISOString():null,sourceTimestamp:validSource?source.toISOString():null,
  capturedAt:evidence?.capturedAt??null,extractionMode:evidence?.mode??null,window:evidence?{from:evidence.from,to:evidence.to}:null,
  ageSeconds:valid?Math.floor((now-timestamp)/1000):null,
  latestAttempt:latest?{status:latest.status,at:latest.processed_at??null,sessionId:latest.session_id}:null,
  state:latest&&!['imported','received_empty','retained'].includes(latest.status)?'LAST_ATTEMPT_INCOMPLETE':!valid?'NO_SUCCESSFUL_SYNC':validSource?'SOURCE_AGE_REPORTED':'SOURCE_TIME_UNAVAILABLE',
  note:'Import age is not source freshness. A reported source timestamp is evidence, not a live completeness check; no unconfirmed stale-age threshold is assumed.'};
}
export async function tallyFreshness(db,companyId,datasets,now=new Date()){
 const unique=[...new Set(datasets.filter(Boolean))];
 if(!unique.length)return [];
 const rows=await db.prepare(`SELECT DISTINCT ON(dataset) dataset,status,processed_at,session_id FROM tally_run_datasets
  WHERE company_id=? AND dataset IN (${unique.map(()=>'?').join(',')}) ORDER BY dataset,processed_at DESC NULLS LAST,session_id DESC`).all(companyId,...unique);
 const successes=await db.prepare(`SELECT DISTINCT ON(d.dataset) d.dataset,d.status,d.processed_at,d.session_id,s.collection_metadata FROM tally_run_datasets d
  JOIN tally_upload_sessions s ON s.id=d.session_id
  WHERE d.company_id=? AND d.dataset IN (${unique.map(()=>'?').join(',')}) AND d.status IN ('imported','received_empty','retained') AND d.quarantined_count=0
  ORDER BY d.dataset,d.processed_at DESC NULLS LAST,d.session_id DESC`).all(companyId,...unique);
 return unique.map(dataset=>datasetFreshness(dataset,rows.find(row=>row.dataset===dataset),successes.find(row=>row.dataset===dataset),now));
}
export async function readTallyFreshness(db,url,user){
 const company=await readCompany(db,url);
 const datasets=Object.values(TALLY_ENTITY_DESCRIPTORS).filter(entity=>hasPermission(user,entity.permission)).map(entity=>entity.dataset);
 if(hasPermission(user,'quotations.read')||hasPermission(user,'enquiries.read'))datasets.push('salesDocumentsXml');
 if(hasPermission(user,'tally.read'))datasets.push('salesOrdersXml','purchaseOrdersXml');
 return {company,data:await tallyFreshness(db,company.id,datasets),asOf:new Date().toISOString(),readOnly:true};
}
