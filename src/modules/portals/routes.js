import {PortalAccess} from './access.js';
import {PortalRecords} from './records.js';
import {PortalRequests} from './requests.js';
export function portalRoutes({db,route,json,readJson,operations,work}){
 const access=new PortalAccess({db}),records=new PortalRecords({access}),requests=new PortalRequests({access,records,operations,work});
 const get=(path,permission,fn)=>route('GET',path,permission,async c=>json(c.res,200,await fn(c)));
 const post=(path,permission,fn)=>route('POST',path,permission,async c=>json(c.res,200,{data:await fn(c,await readJson(c.req))}));
 return [
  get('/api/crm/portal/me','authenticated',c=>records.me(c.user)),
  get('/api/crm/portal/records','authenticated',c=>records.list(c.user,c.url.searchParams.get('type'),Object.fromEntries(c.url.searchParams))),
  get('/api/crm/portal/records/:type/:id','authenticated',async c=>({data:await records.detail(c.user,c.params.type,c.params.id,Object.fromEntries(c.url.searchParams))})),
  get('/api/crm/portal/requests','authenticated',c=>requests.mine(c.user,Object.fromEntries(c.url.searchParams))),
  post('/api/crm/portal/requests','authenticated',(c,b)=>requests.submit(c.user,b)),
  get('/api/crm/portal/acknowledgements','authenticated',c=>requests.acknowledgements(c.user,Object.fromEntries(c.url.searchParams))),
  post('/api/crm/portal/acknowledgements','authenticated',(c,b)=>requests.acknowledge(c.user,b)),
  route('POST','/api/crm/portal/documents/:type/:id','authenticated',async c=>{const b=await readJson(c.req),f=await records.document(c.user,c.params.type,c.params.id,b);c.res.writeHead(200,{'content-type':'application/pdf','content-disposition':`${b.preview?'inline':'attachment'}; filename="${f.filename}"`,'content-length':f.bytes.length,'cache-control':'no-store','x-content-type-options':'nosniff'});c.res.end(f.bytes);}),
  get('/api/crm/portal-admin/memberships','portal.manage',c=>access.list(c.user,Object.fromEntries(c.url.searchParams))),
  get('/api/crm/portal-admin/staff','portal.manage',async c=>({data:await access.eligibleStaff(c.user)})),
  post('/api/crm/portal-admin/memberships','portal.manage',(c,b)=>access.create(c.user,b)),
  post('/api/crm/portal-admin/memberships/:id/decision','portal.manage',(c,b)=>access.decide(c.user,c.params.id,b)),
  get('/api/crm/partner-review/requests','authenticated',c=>requests.queue(c.user,c.url.searchParams.get('kind'),Object.fromEntries(c.url.searchParams))),
  get('/api/crm/partner-review/acknowledgements','authenticated',c=>requests.staffAcknowledgements(c.user,Object.fromEntries(c.url.searchParams))),
  get('/api/crm/partner-review/requests/:id','authenticated',async c=>({data:await requests.detail(c.user,c.params.id)})),
  post('/api/crm/partner-review/requests/:id/decision','authenticated',(c,b)=>requests.review(c.user,c.params.id,b)),
  post('/api/crm/partner-review/rfqs/:id/publish','purchasing.approve',(c,b)=>records.publishRfq(c.user,c.params.id,b))
 ];
}
