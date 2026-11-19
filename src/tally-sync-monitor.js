import {hasPermission} from './rbac.js';
import {readCompany} from './tally-read-service.js';
import {connectorConnectionState} from './connector-store.js';
import {forbidden,notFound,validationFailed} from './core/errors.js';
import {requestTallyRead} from './tally-read-requests.js';

// Connection/delivery evidence is available before the first company is indexed.
// Deliberately excludes XML, financial values and connector credentials.
export async function tallyInitialSyncMonitor(db,user){
 if(!hasPermission(user,'tally.read'))throw forbidden();
 const connectors=await db.prepare(`SELECT c.id,c.profile_name,c.expected_company_name,c.status,c.last_seen_at,
 h.updated_at AS heartbeat_at,h.tally_available,h.selected_company
 FROM tally_connectors c LEFT JOIN tally_connector_heartbeats h ON h.connector_id=c.id ORDER BY c.created_at DESC`).all();
 const uploads=await db.prepare(`SELECT s.id,s.connector_id,s.company_name,s.status,s.created_at,s.completed_at,j.last_progress_at,j.message,
 (SELECT count(*) FROM tally_upload_chunks k WHERE k.session_id=s.id) AS received_chunks
 FROM tally_upload_sessions s LEFT JOIN tally_sync_jobs j ON j.id=s.sync_job_id ORDER BY s.created_at DESC,s.id DESC LIMIT 20`).all();
 const jobs=await db.prepare(`SELECT id,company_name,status,message,record_count,started_at,last_progress_at FROM tally_sync_jobs ORDER BY started_at DESC,id DESC LIMIT 20`).all();
 return {asOf:new Date().toISOString(),connectors,uploads,jobs,note:'Receiving means delivery is in progress. Companies and records become available after upload finalization and indexing. Chunk counts are not a completion percentage.'};
}

export async function tallySyncMonitor(db,url,user){
 if(!hasPermission(user,'tally.read'))throw forbidden();
 const company=await readCompany(db,url);
 const connectors=await db.prepare(`SELECT c.id,c.profile_name,c.status,c.revoked_at,c.pairing_expires_at,c.last_seen_at,c.last_sync_at,c.agent_version,(c.access_token_hash IS NOT NULL) AS paired,
 h.updated_at AS heartbeat_at,h.tally_available,h.selected_company
 FROM tally_connectors c LEFT JOIN tally_connector_heartbeats h ON h.connector_id=c.id WHERE c.expected_company_name=? AND (c.expected_company_guid IS NULL OR c.expected_company_guid=(SELECT tally_guid FROM tally_companies WHERE id=?)) ORDER BY c.created_at DESC`).all(company.name,company.id);
 const jobs=await db.prepare(`SELECT j.id,j.connector_id,j.status,j.message,j.record_count,j.started_at,j.last_progress_at,j.completed_at FROM tally_sync_jobs j
 JOIN tally_connectors c ON c.id=j.connector_id WHERE j.company_name=? AND c.expected_company_name=? AND (j.company_guid IS NULL OR j.company_guid=(SELECT tally_guid FROM tally_companies WHERE id=?)) ORDER BY j.started_at DESC,j.id DESC LIMIT 30`).all(company.name,company.name,company.id);
 const uploads=await db.prepare(`SELECT s.id,s.connector_id,s.status,s.created_at,s.completed_at,
 (SELECT count(*) FROM tally_raw_payloads p WHERE p.session_id=s.id AND p.company_id=?) AS retained_payloads,
 (SELECT count(*) FROM tally_run_datasets d WHERE d.session_id=s.id AND d.company_id=?) AS indexed_datasets,
 (SELECT count(*) FROM tally_run_datasets d WHERE d.session_id=s.id AND d.company_id=? AND (d.status NOT IN ('imported','received_empty','retained') OR d.quarantined_count>0)) AS incomplete_datasets
 FROM tally_upload_sessions s JOIN tally_connectors c ON c.id=s.connector_id WHERE s.company_name=? AND c.expected_company_name=? AND (s.company_guid IS NULL OR s.company_guid=(SELECT tally_guid FROM tally_companies WHERE id=?)) ORDER BY s.created_at DESC,s.id DESC LIMIT 30`).all(company.id,company.id,company.id,company.name,company.name,company.id);
 const queue=await db.prepare(`SELECT count(*) FILTER(WHERE status='REQUESTED') AS requested,count(*) FILTER(WHERE status='FAILED') AS failed FROM tally_read_requests WHERE company_id=?`).get(company.id);
 const receiving=await db.prepare(`SELECT count(*) AS n FROM tally_upload_sessions s JOIN tally_connectors c ON c.id=s.connector_id WHERE s.company_name=? AND c.expected_company_name=? AND s.status='receiving'`).get(company.name,company.name);
 const requests=await db.prepare('SELECT id,status,entity_kind,created_at,completed_at,last_session_id,error_code FROM tally_read_requests WHERE company_id=? ORDER BY created_at DESC,id DESC LIMIT 30').all(company.id);
 return {company,asOf:new Date().toISOString(),connectors:connectors.map(c=>({...c,connectionState:connectorConnectionState(c),note:'Paired indicates an issued access credential; legacy token profiles may authenticate without pairing. Heartbeat reachability does not prove delivery or indexing.'})),jobs,uploads:uploads.map(s=>({...s,deliveryState:s.retained_payloads?'RETAINED_PAYLOADS':s.status==='receiving'?'RECEIVING':'NO_RETAINED_PAYLOADS',indexState:s.incomplete_datasets?'INCOMPLETE':s.indexed_datasets?'DATASET_RECEIPTS_AVAILABLE':'NOT_INDEXED'})),requests,
 queue:{pendingReadRequests:queue.requested,failedReadRequests:queue.failed,inProgressUploads:receiving.n,connectorLocalQueueDepth:null,note:'Counts cover the server only. The installed connector does not report its local queue depth; unknown is not zero.'},
 capabilities:{requestRead:hasPermission(user,'tally.sync'),payloads:hasPermission(user,'tally.read')&&['OWNER','ACCOUNTS'].includes(user.role)},
 note:'Read only monitor. Stored jobs may be failed or stalled; refreshing this view does not alter job statuses. Retry requests a new company read through the existing connector and does not claim completion.'};
}

export async function retryTallyRead(db,url,jobId,body,user){
 if(!hasPermission(user,'tally.sync'))throw forbidden('Tally sync permission is required.');
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId||''))throw validationFailed('Choose a recorded sync job.');
 const reason=typeof body?.reason==='string'?body.reason.trim():'';
 if(reason.length<3||reason.length>1900)throw validationFailed('Provide a retry reason of 3–1900 characters.');
 const company=await readCompany(db,url),job=await db.prepare(`SELECT j.status FROM tally_sync_jobs j JOIN tally_connectors c ON c.id=j.connector_id WHERE j.id=? AND j.company_name=? AND c.expected_company_name=?`).get(jobId,company.name,company.name);
 if(!job)throw notFound('Sync job not found in the selected company.');
 if(!['failed','stalled','quarantined','partial'].includes(job.status))throw validationFailed('Only failed, stalled, quarantined or partial jobs can request a retry.');
 return requestTallyRead(db,url,{reason:`Retry ${jobId}: ${reason}`},user);
}
