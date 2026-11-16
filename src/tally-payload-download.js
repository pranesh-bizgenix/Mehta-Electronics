import {randomUUID} from 'node:crypto';
import {hasPermission} from './rbac.js';
import {readCompany} from './tally-read-service.js';
import {forbidden,notFound,validationFailed} from './core/errors.js';

// One cursor fetch and one HTTP write at a time. The browser receives an
// attachment; neither the API client nor the application buffers the XML.
export const PAYLOAD_CHUNK_BYTES=256*1024;
export const PAYLOAD_DRAIN_TIMEOUT_MS=30000;
export const PAYLOAD_DOWNLOAD_TIMEOUT_MS=300000;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function waitForDrain(response,{signal,timeoutMs}){
 return new Promise((resolve,reject)=>{
  const cleanup=()=>{clearTimeout(timer);response.off('drain',drain);response.off('close',closed);response.off('error',failed);signal?.removeEventListener('abort',aborted);};
  const drain=()=>{cleanup();resolve();},closed=()=>{cleanup();reject(new Error('Payload download disconnected.'));},failed=error=>{cleanup();reject(error);};
  const aborted=()=>failed(signal.reason??new Error('Payload download aborted.'));
  const timer=setTimeout(()=>failed(new Error('Payload download stopped: client did not drain within the time limit.')),timeoutMs);
  response.once('drain',drain);response.once('close',closed);response.once('error',failed);
  signal?.addEventListener('abort',aborted,{once:true});
  if(signal?.aborted)aborted();
  if(response.destroyed)closed();
 });
}
export async function writePayloadChunks(response,chunks,{signal,drainTimeoutMs=PAYLOAD_DRAIN_TIMEOUT_MS}={}){
 for await(const chunk of chunks){
  signal?.throwIfAborted();
  if(response.destroyed||response.writableEnded)throw new Error('Payload download disconnected.');
  if(!Buffer.isBuffer(chunk)||chunk.length>PAYLOAD_CHUNK_BYTES)throw new Error('Invalid retained-payload stream chunk.');
  if(response.write(chunk)===false)await waitForDrain(response,{signal,timeoutMs:drainTimeoutMs});
 }
}
export async function downloadRetainedPayload(db,url,payloadId,user,response){
 if(!hasPermission(user,'tally.read')||!['OWNER','ACCOUNTS'].includes(user?.role))throw forbidden('Raw payloads require Owner or Accounts financial access.');
 if(!uuid.test(payloadId??''))throw validationFailed('Choose a retained payload ID.');
 const company=await readCompany(db,url);
 return db.withConnection(async()=>{
  await db.exec('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const cursor=`payload_${randomUUID().replaceAll('-','')}`;
  try{
   const metadata=await db.prepare('SELECT id,octet_length(content) AS bytes FROM tally_raw_payloads WHERE id=? AND company_id=?').get(payloadId,company.id);
   if(!metadata)throw notFound('Payload not found in the selected company.');
   // Materialize the retained value once on PostgreSQL, then fetch byte slices.
   // Byte slices preserve the original UTF-8 even across multibyte boundaries.
   await db.exec("SET LOCAL statement_timeout = '30s'");
   await db.prepare(`DECLARE ${cursor} NO SCROLL CURSOR FOR WITH source AS MATERIALIZED
    (SELECT convert_to(content,'UTF8') AS bytes FROM tally_raw_payloads WHERE id=? AND company_id=?)
    SELECT substring(bytes FROM offset_bytes FOR ${PAYLOAD_CHUNK_BYTES}) AS chunk
    FROM source CROSS JOIN LATERAL generate_series(1,octet_length(bytes),${PAYLOAD_CHUNK_BYTES}) AS offset_bytes`).all(payloadId,company.id);
   response.writeHead(200,{'content-type':'application/xml; charset=utf-8','content-disposition':`attachment; filename="tally-payload-${metadata.id}.xml"`,'content-length':String(metadata.bytes),'cache-control':'no-store','x-content-type-options':'nosniff'});
   async function* chunks(){while(true){const row=await db.prepare(`FETCH FORWARD 1 FROM ${cursor}`).get();if(!row)break;yield row.chunk;}}
   const abort=new AbortController(),timer=setTimeout(()=>abort.abort(new Error('Payload download exceeded the time limit.')),PAYLOAD_DOWNLOAD_TIMEOUT_MS);
   try{await writePayloadChunks(response,chunks(),{signal:abort.signal});}finally{clearTimeout(timer);}
   await db.exec(`CLOSE ${cursor}`);
   await db.exec('COMMIT');
   response.end();
  }catch(error){
   try{await db.exec('ROLLBACK');}catch{/* Preserve the download failure if the connection has already closed. */}
   finally{
    // A partial attachment must fail, never look like a successful truncated XML.
    if(response.headersSent&&typeof response.destroy==='function')response.destroy(error);
   }
   throw error;
  }
 });
}
