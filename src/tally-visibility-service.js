import { TallyVisibilityRepository } from './tally-visibility-repository.js';
import { classifyLedgers, pagination, groupHierarchy } from './tally-read-service.js';
import { tallyDisplay } from './tally-display.js';
import { TALLY_ENTITY_DESCRIPTORS,describeTallyEntity } from '../public/tally-entity-descriptors.js';
import { mapTallySalesDocument } from './tally-sales-documents.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
export const isTallyFinancial = user => ['OWNER','ACCOUNTS'].includes(user?.role);
const optionalEntities = ['companies','stock_groups','categories','units','godowns','price_levels','cost_centres','vouchers'];
const entityDatasets=Object.fromEntries(Object.values(TALLY_ENTITY_DESCRIPTORS).map(entity=>[entity.id,entity.dataset]));
export const visibilityKinds=Object.keys(TALLY_ENTITY_DESCRIPTORS);
const qualityFilters = ['missing_gstin','has_gstin','invalid_gstin','missing_hsn','missing_state','negative_stock','zero_stock','has_balance','zero_value','encoding','duplicates'];
export const visibilityPermission = kind => TALLY_ENTITY_DESCRIPTORS[kind]?.permission;

/** @implements {import('./tally-visibility-contracts').TallyService} */
export class TallyVisibilityService {
  /** @param {any} db @param {{repository?:import('./tally-visibility-contracts').TallyRepository}} dependencies */
  constructor(db,{repository=new TallyVisibilityRepository(db)}={}) { this.repository = repository; }
  async overview(url,user) {
    const ctx=await this.context('groups',url,user);
    return {company:ctx.company,source:'Stored Tally import (source labelled when recorded)',asOf:new Date().toISOString(),financial:ctx.financial,
      ...(ctx.company?await this.repository.overview(ctx.company.id,ctx.financial):{counts:[],datasets:[],sync:[],quarantine:0,warnings:0,stock:null,sources:[],emptyReason:'No sync yet'})};
  }
  async salesSummary(kind,url,user) {
    if(!['quotations','enquiries'].includes(kind))throw fail(422,'Choose quotations or enquiries.');
    const ctx=await this.context(kind,url,user);
    return ctx.company?this.repository.salesSummary(ctx.company.id,kind):{imported:0,sourceCount:null,pending:null,failed:null,cancelled:0,updated:0,types:[],periods:[],receipt:null};
  }
  async retainedPayloads(url,user,id) {
    if(!isTallyFinancial(user))throw fail(403,'Raw payloads require Owner or Accounts.');
    const ctx=await this.context('groups',url,user);
    if(id){const data=await this.repository.payload(ctx.company?.id||null,id);if(!data)throw fail(404,'Payload not found.');return {data};}
    return {data:ctx.company?await this.repository.payloads(ctx.company.id):[],source:'Stored connector payload',asOf:new Date().toISOString()};
  }
  async quarantine(url,user) {
    const ctx=await this.context('groups',url,user);
    return {...await this.repository.quarantined(ctx.company?.id,ctx.query,ctx.financial),financial:ctx.financial,source:'Stored connector quarantine',asOf:new Date().toISOString()};
  }
  async replay(sessionId,user,ip) {
    if(!['OWNER','MANAGER'].includes(user.role))throw fail(403,'Replay requires Manager or Owner.');
    if(!/^[0-9a-f-]{36}$/i.test(sessionId||''))throw fail(422,'Choose a saved upload session.');
    const result=await this.repository.replay(sessionId);
    const summary={payloads:result.payloads,indexed:result.indexed,errors:result.errors};
    await this.repository.audit({userId:user.id,entity:'TALLY_VISIBILITY',recordId:sessionId,action:'REPLAY_INDEX',newValue:summary,ipAddress:ip});
    return {...summary,note:'Replayed into field index only. Original quarantine and payloads retained.'};
  }
  async context(kind, url, user) {
    if (!visibilityKinds.includes(kind)) throw fail(404,'Unknown Tally entity.');
    const companyId = url.searchParams.get('companyId');
    if (companyId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(companyId)) throw fail(422,'Invalid company identifier.');
    const company = await this.repository.company(companyId);
    if (companyId && !company) throw fail(404,'Imported company not found.');
    const financial = isTallyFinancial(user);
    if (kind === 'reports' && !financial) throw fail(403,'Financial reports require Owner or Accounts.');
    let parents, entity = kind;
    if (['customers','vendors','banks','expenses','other'].includes(kind) && company) {
      entity = 'ledgers';
      const groups = await this.repository.groups(company.id);
      const names = await this.repository.parents(company.id);
      parents = classifyLedgers(groups,names).filter(r=>r.category===kind).map(r=>r.parent_name);
    }
    const query = { ...pagination(url), search: (url.searchParams.get('search') || '').trim().slice(0,1000), group:url.searchParams.get('group'), state:url.searchParams.get('state'),
      quality:url.searchParams.get('quality'),sort:url.searchParams.get('sort') || '/stored/name',direction:url.searchParams.get('direction') === 'desc' ? 'desc' : 'asc' };
    if(['quotations','enquiries'].includes(kind)) {
      for(const key of ['fromDate','toDate']) { const v=url.searchParams.get(key);if(v&&!/^\d{4}-\d{2}-\d{2}$/.test(v))throw fail(422,'Use YYYY-MM-DD dates.');query[key]=v||null; }
      if(query.fromDate&&query.toDate&&query.fromDate>query.toDate)throw fail(422,'Start date must precede end date.');
      query.customer=(url.searchParams.get('customer')||'').trim().slice(0,200);
      query.voucherStatus=url.searchParams.get('voucherStatus')||null;
      query.optional=url.searchParams.get('optional')||null;
      if(query.optional&&!['Yes','No'].includes(query.optional))throw fail(422,'Choose Yes or No for optional vouchers.');
      if(query.voucherStatus&&!['RECORDED','OPTIONAL','CANCELLED','DELETED'].includes(query.voucherStatus))throw fail(422,'Unknown source voucher status.');
    }
    if (query.quality && !qualityFilters.includes(query.quality)) throw fail(422,'Unknown quality filter.');
    if (!financial && ['has_balance','zero_value'].includes(query.quality)) throw fail(403,'Financial filters require Owner or Accounts.');
    const scope = company ? this.repository.scope(company.id,entity,financial,parents,url.searchParams.get('snapshots')==='all') : null;
    return { company,financial,entity,query,scope };
  }
  async list(kind,url,user) {
    const ctx = await this.context(kind,url,user);
    const columns = ctx.scope ? await this.repository.catalogue(ctx.scope) : [];
    if (columns.length && !columns.includes(ctx.query.sort)) {
      if (url.searchParams.has('sort')&&ctx.query.sort!=='/stored/name') throw fail(422,'Sort field is unavailable for this role.');
      ctx.query.sort = columns.includes('/stored/name') ? '/stored/name' : columns[0];
    }
    const result = ctx.scope ? await this.repository.list(ctx.scope,ctx.query) : {data:[],pagination:{...pagination(url),total:0,pages:0}};
    const metadata=ctx.scope ? await this.repository.metadata(ctx.scope) : null;
    const receipt=ctx.company&&entityDatasets[kind] ? await this.repository.receipt(ctx.company.id,entityDatasets[kind]) : null;
    const filtered=ctx.query.search||ctx.query.group||ctx.query.state||ctx.query.quality||ctx.query.fromDate||ctx.query.toDate||ctx.query.customer||ctx.query.voucherStatus||ctx.query.optional;
    const publicColumns=ctx.scope ? await this.repository.catalogue(this.repository.scope(ctx.company.id,ctx.entity,false,ctx.scope.parents)) : [];
    return {...result,columns,descriptor:describeTallyEntity(kind,columns,publicColumns),company:ctx.company,financial:ctx.financial,lastUpdated:metadata?.last_updated||null,source:'Stored Tally import (source is labelled per row when recorded)',
      asOf:new Date().toISOString(),emptyReason: !ctx.company ? 'No sync yet' : filtered ? 'No records match the selected filters.' : ['quotations','enquiries'].includes(kind) ? `No Tally ${kind} have been indexed. Check the selected company, voucher types and completed voucher imports. Existing CRM records are separate.` : kind === 'vouchers' ? 'Awaiting voucher data: structured voucher IDs, dates, ledger and inventory entries have not arrived.' : optionalEntities.includes(kind) ? receipt?.status==='failed' ? 'The last collection could not be indexed. Its raw data is retained for inspection/replay.' : receipt ? 'Tally delivered this collection with zero records.' : 'No records indexed for this entity. The connector must deliver its collection.' : 'No records match the selected filters.',
      data:result.data.map(r=>({...r,display_name:tallyDisplay(r.name),display_fields:Object.fromEntries(Object.entries(r.fields).map(([key,value])=>[key,tallyDisplay(value)]))}))};
  }
  async detail(kind,key,url,user) {
    const ctx = await this.context(kind,url,user);
    if (!ctx.company) throw fail(404,'No sync yet.');
    const history = await this.repository.history(ctx.company.id,ctx.entity,key,ctx.financial);
    if (!history.length) throw fail(404,'Imported record not found.');
    const selected=url.searchParams.get('snapshotId') ? history.find(row=>row.id===url.searchParams.get('snapshotId')) : history[0];
    if(!selected)throw fail(404,'Stored snapshot not found.');
    const changes = history.slice(0,-1).map((row,index)=>({at:row.observed_at,sessionId:row.session_id,
      fields:[...new Set([...Object.keys(row.fields),...Object.keys(history[index+1].fields)])]
        .filter(k=>!k.startsWith('/meta/')&&JSON.stringify(row.fields[k])!==JSON.stringify(history[index+1].fields[k]))
        .map(key=>({key,before:history[index+1].fields[key] ?? null,after:row.fields[key] ?? null}))}));
    const links = await this.repository.links(ctx.company.id,ctx.entity,key);
    const payloads=await this.repository.payloads(ctx.company.id,selected.session_id);
    for (const link of links) {
      link.record = await this.repository.crmRecord(link.crm_kind,link.crm_id);
    }
    const publicFields=(await this.repository.history(ctx.company.id,ctx.entity,key,false)).find(row=>row.id===selected.id)?.fields||{};
    const document=['quotations','enquiries'].includes(kind)&&ctx.financial?mapTallySalesDocument(selected.raw_record):null;
    if(document)document.relationships=await this.repository.salesRelationships(ctx.company.id,document);
    return {descriptor:describeTallyEntity(kind,Object.keys(selected.fields),Object.keys(publicFields)),data:{...selected,display_name:tallyDisplay(selected.name),display_fields:Object.fromEntries(Object.entries(selected.fields).map(([key,value])=>[key,tallyDisplay(value)]))},...(document?{document}:{}),history,changes,links,payloads,financial:ctx.financial,source:selected.source_system||'Stored Tally import (connector source unrecorded)',rawNote:ctx.financial?'Original parsed JSON; original XML is retained in payloads.':'Raw financial payload is restricted. This JSON contains permitted fields only.'};
  }
  async quality(kind,url,user) {
    const ctx=await this.context(kind,url,user),counts={};
    if(ctx.scope)for(const quality of qualityFilters.filter(q=>q!=='has_gstin' && (ctx.financial || !['has_balance','zero_value'].includes(q)))) {
      if(ctx.entity!=='items' && ['negative_stock','zero_stock','missing_hsn','zero_value'].includes(quality))continue;
      if(ctx.entity==='items' && ['missing_gstin','invalid_gstin','missing_state','has_balance'].includes(quality))continue;
      const result=await this.repository.list(ctx.scope,{...ctx.query,search:'',group:null,state:null,quality,page:1,pageSize:1});counts[quality]=result.pagination.total;
    }
    return {counts,company:ctx.company,lastUpdated:ctx.scope?(await this.repository.metadata(ctx.scope)).last_updated:null,source:'Stored Tally import',asOf:new Date().toISOString(),note:'Missing means not delivered or blank; it does not assert the field is blank in Tally.'};
  }
  async tree(url,user) {
    const ctx=await this.context('groups',url,user);
    if(!ctx.company)return {data:[],source:'Stored Tally import',asOf:new Date().toISOString()};
    const groups=groupHierarchy(await this.repository.groups(ctx.company.id));
    const ledgerScope=this.repository.scope(ctx.company.id,'ledgers',ctx.financial);
    const counts=await this.repository.groupCounts(ledgerScope);
    // Totals use PostgreSQL NUMERIC, never floating-point arithmetic.
    for(const node of groups) {
      const descendants=groups.filter(g=>g.path.includes(node.name)).map(g=>g.name);
      node.recordCount=counts.filter(c=>descendants.includes(c.parent_name)).reduce((sum,c)=>sum+c.count,0);
      if(ctx.financial)node.balance=await this.repository.groupBalance(ledgerScope,descendants);
    }
    return {data:groups,financial:ctx.financial,lastUpdated:(await this.repository.metadata(ctx.scope)).last_updated,source:'Stored Tally import',asOf:new Date().toISOString()};
  }
  async createCrm(kind,key,url,user,ip) {
    const ctx=await this.context(kind,url,user);
    const crmKind=kind==='items'?'item':kind==='vendors'?'vendor':'customer';
    if(!['items','customers','vendors'].includes(kind))throw fail(422,'Create CRM records from Customers, Vendors or Items.');
    const source=(await this.repository.history(ctx.company?.id,ctx.entity,key,false))[0];
    if(!source)throw fail(404,'Source record not found.');
    if(['customers','vendors'].includes(kind)) {
      const classified=classifyLedgers(await this.repository.groups(ctx.company.id),[source])[0];
      if(classified.category!==kind)throw fail(422,'Ledger is not in the requested group family.');
    }
    return this.repository.createLinkedCrm({ctx,source,key,crmKind,user,ip});
  }

  async reconciliation(kind,url,user) {
    if(!['customers','vendors','items'].includes(kind))throw fail(422,'Choose Customers, Vendors or Items.');
    const ctx=await this.context(kind,url,user),result=await this.list(kind,url,user);
    const crmKind=kind==='items'?'item':kind==='vendors'?'vendor':'customer';
    const links=ctx.company ? await this.repository.links(ctx.company.id,ctx.entity) : [];
    for(const row of result.data) {
      const link=links.find(l=>l.record_key===row.record_key);
      row.crm=link ? await this.repository.crmRecord(crmKind,link.crm_id) : null;
      row.conflicts=[];
      if(row.crm) {
        for(const [key,stored] of [['name','name'],...(crmKind==='item'?[['hsn','hsn'],['uom','base_unit']]:[['gstin','gstin']])]) {
          const before=row.fields[`/stored/${stored}`] ?? null,after=row.crm[key] ?? null;
          if(before!==after)row.conflicts.push({field:key,tally:before,crm:after});
        }
      }
      row.reconciliation_status=!row.crm?'missing_in_crm':row.conflicts.length?'conflict':'matched';
    }
    const crmOnly=ctx.company ? await this.repository.unlinkedCrm(crmKind,ctx.company.id,ctx.query) : [];
    return {...result,crmOnly,note:'Matching uses explicit Tally ID links only. Unlinked CRM records are not assumed to match by name. CRM-only records use the same page size.'};
  }
  async export(kind,url,user,columns,format='csv',ip) {
    const reconciliation=url.searchParams.get('view')==='reconciliation';
    const result = reconciliation ? await this.reconciliation(kind,url,user) : await this.list(kind,url,user);
    if(reconciliation)result.columns=[...result.columns,'reconciliation_status','crm'];
    if (!Array.isArray(columns) || !columns.length || columns.some(k=>!result.columns.includes(k))) throw fail(422,'Choose permitted export columns.');
    if (!['csv','excel'].includes(format)) throw fail(422,'Unsupported export format.');
    const safe = value => { const text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value); return /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text; };
    const csv = value => `"${safe(value).replaceAll('"','""')}"`;
    const xml = value => safe(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');
    const chunks = [format==='csv' ? '\ufeff'+columns.map(csv).join(',')+'\r\n' : '<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Tally"><Table><Row>'+columns.map(k=>`<Cell><Data ss:Type="String">${xml(k)}</Data></Cell>`).join('')+'</Row>'];
    const ctx = await this.context(kind,url,user);
    let exported = 0;
    // Stable read snapshot, all pages, no client-side truncation.
    if (ctx.scope) await this.repository.transaction(async()=>{
        for (let page=1;;page++) {
          const pageUrl=new URL(url);pageUrl.searchParams.set('page',String(page));pageUrl.searchParams.set('pageSize','100');
          const batch = reconciliation ? await this.reconciliation(kind,pageUrl,user) : await this.repository.list(ctx.scope,{...ctx.query,page,pageSize:100});
          const value=(row,key)=>key==='reconciliation_status'?row.reconciliation_status:key==='crm'?row.crm:row.fields[key];
          for (const row of batch.data) chunks.push(format==='csv' ? columns.map(k=>csv(value(row,k))).join(',')+'\r\n' : '<Row>'+columns.map(k=>`<Cell><Data ss:Type="String">${xml(value(row,k))}</Data></Cell>`).join('')+'</Row>');
          exported += batch.data.length;
          if (page>=batch.pagination.pages) break;
        }
    },{readOnly:true});
    if (format==='excel') chunks.push('</Table></Worksheet></Workbook>');
    await this.repository.audit({userId:user.id,entity:'TALLY_EXPORT',recordId:ctx.company?.id || 'none',action:'EXPORT',newValue:{kind,columns,format,count:exported,filters:Object.fromEntries(url.searchParams)},ipAddress:ip});
    return {filename:`tally-${kind}.${format==='csv'?'csv':'xml'}`,mime:format==='csv'?'text/csv;charset=utf-8':'application/vnd.ms-excel;charset=utf-8',content:chunks.join(''),count:exported};
  }
}
