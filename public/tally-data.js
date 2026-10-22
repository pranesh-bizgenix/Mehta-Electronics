// Website adapter for saved imports. No sync, pairing, polling or upload calls.
let ui;
const state = { companyId:'',category:'customers',search:'',page:1,status:'',kind:'',mode:'masters' };
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
export function configureTallyData(context) { ui = context; }
const missing = () => '<span class="missing-value" tabindex="0" title="This field is absent in the saved import" aria-label="Not available in saved data">—</span>';
const text = value => value == null || value === '' ? missing() : ui.esc(value);
const when = value => value ? new Date(value).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'}) : '—';
function query() {
  const params = new URLSearchParams({page:String(state.page),pageSize:'25',search:state.search});
  if (state.companyId) params.set('companyId',state.companyId);
  if (state.status) params.set('status',state.status);
  if (state.kind) params.set('kind',state.kind);
  return params;
}
function controls(companies,result,reconciliation) {
  const categories = ui.allowed('tally.read') ? [['customers','Customers'],['vendors','Vendors'],['banks','Banks & cash'],['expenses','Expenses'],['other','Other ledgers'],['groups','Group hierarchy'],['items','Stock items']] : [['customers','Customers'],['items','Stock items']];
  return `<div class="toolbar"><div class="filters"><label>Company<select id="stored-company">${companies.map(company=>`<option value="${ui.esc(company.id)}" ${company.id===result.company?.id?'selected':''}>${ui.esc(company.display_name || company.name)}</option>`).join('') || '<option value="">No imported company</option>'}</select></label>${!reconciliation ? `<label>Dataset<select id="stored-category">${categories.map(([value,label])=>`<option value="${value}" ${value===state.category?'selected':''}>${label}</option>`).join('')}</select></label>` : `<label>Records<select id="stored-kind"><option value="">All records</option>${['customer','vendor','item'].map(kind=>`<option value="${kind}" ${state.kind===kind?'selected':''}>${kind}</option>`).join('')}</select></label><label>Result<select id="stored-status"><option value="">All results</option>${['matched','missing_in_crm','missing_in_tally','conflict'].map(status=>`<option value="${status}" ${state.status===status?'selected':''}>${status.replaceAll('_',' ')}</option>`).join('')}</select></label>`}<label>Search<input id="stored-search" type="search" value="${ui.esc(state.search)}" placeholder="Search saved records"></label><button id="stored-go" class="secondary">Search</button></div>${!reconciliation && ['customers','items'].includes(state.category) ? `<button id="stored-crm" class="secondary">CRM ${state.category}</button>` : ''}</div><div class="stored-sync" role="status"><span class="status">${ui.esc(result.sync.status.replaceAll('_',' '))}</span><span>Last completed run: ${ui.esc(when(result.sync.lastSyncAt))}</span><span>Last successful import: ${ui.esc(when(result.sync.lastSuccessfulSyncAt))}</span><small>Saved sync status only · no live connection check</small></div>`;
}
function pages(meta) {
  return `<div class="pager"><button id="stored-prev" ${meta.page<=1?'disabled':''}>Previous</button><span>Page ${meta.page} of ${Math.max(meta.pages,1)} · ${meta.total} records</span><button id="stored-next" ${meta.page>=meta.pages?'disabled':''}>Next</button></div>`;
}
function bind(reload) {
  $('#stored-company').onchange = event => { state.companyId=event.target.value;state.page=1;reload(); };
  const search = () => {state.search=$('#stored-search').value;state.page=1;reload();};
  $('#stored-go').onclick=search;
  $('#stored-search').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();search();}};
  $('#stored-category')?.addEventListener('change',event=>{state.category=event.target.value;state.page=1;state.search='';reload();});
  $('#stored-kind')?.addEventListener('change',event=>{state.kind=event.target.value;state.page=1;reload();});
  $('#stored-status')?.addEventListener('change',event=>{state.status=event.target.value;state.page=1;reload();});
  $('#stored-prev').onclick=()=>{state.page--;reload();};
  $('#stored-next').onclick=()=>{state.page++;reload();};
  $('#stored-crm')?.addEventListener('click',()=>ui.openCrm(state.category));
}
function loading() {
  $('#view').innerHTML='<div class="loading-grid" role="status" aria-label="Loading saved data"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>';
}
function errorView(error,reload) {
  $('#view').innerHTML=`<section class="feedback-error" role="alert"><h2>Saved data is unavailable</h2><p>${ui.esc(error.message)}</p><button id="stored-retry" class="secondary">Try again</button></section>`;
  $('#stored-retry').onclick=reload;
}
let generation=0;
export async function loadStoredMasters(kind) {
  if (kind) {state.category=kind==='ledgers'?'customers':kind;state.page=1;state.search='';}
  state.mode='masters';
  const current=++generation;
  loading();
  try {
    const companies=(await ui.api('/api/tally/read-companies')).data;
    const result=await ui.api(`/api/tally/${state.category}?${query()}`);
    if(current!==generation || !['customers','items'].includes(ui.currentView()))return;
    state.companyId=result.company?.id||'';
    const items=state.category==='items',groups=state.category==='groups';
    const columns=items ? [['display_name','Stock item'],['display_group','Group'],['closing_quantity_text','Quantity'],['closing_rate_text','Rate'],...(result.financial?[['closing_value','Signed value']]:[])] : groups ? [['display_name','Group'],['display_group','Parent'],['depth','Depth'],['hierarchy_status','Hierarchy']] : [['display_name','Ledger'],['display_group','Group'],['display_phone','Phone'],['email','Email'],...(result.financial?[['closing_balance','Signed balance']]:[])];
    const coverage=result.coverage;
    const label=coverage?`<aside class="stock-coverage ${coverage.partial?'is-partial':''}"><strong>${ui.esc(coverage.label)}</strong><small>Company-wide valuation coverage</small><span>${coverage.valuedItems} items with value · ${coverage.missingValue} without value · ${coverage.totalItems} items total</span>${coverage.totalValue!=null?`<span>Complete signed sum: ${text(coverage.totalValue)}</span>`:`<span>Stock total unavailable. Known signed values only: ${text(coverage.knownSignedValue)}</span>`}<small>${ui.esc(coverage.note)}</small></aside>`:'';
    $('#view').innerHTML=`<section class="panel"><header><h2>Saved Tally ${groups?'group hierarchy':state.category}</h2></header><p class="muted">Read-only imported data. Original names remain the matching identity.${groups?` ${result.groupCount} imported groups; unresolved parents and cycles are flagged.`:''}</p>${controls(companies,result,false)}${label}<div class="table-wrap"><table><thead><tr>${columns.map(([,label])=>`<th>${label}</th>`).join('')}</tr></thead><tbody>${result.data.map(row=>`<tr>${columns.map(([key])=>`<td${key==='display_name'?` title="${ui.esc(row.original_name)}"`:''}>${text(row[key])}${groups&&key==='display_name'?`<small class="group-path">${ui.esc((row.display_path||row.path).join(' › '))}</small>`:''}</td>`).join('')}</tr>`).join('')||`<tr><td class="empty" colspan="${columns.length}">No saved records match this selection.</td></tr>`}</tbody></table></div>${pages(result.pagination)}</section>`;
    bind(()=>loadStoredMasters());
  } catch(error) {if(current===generation && ['customers','items'].includes(ui.currentView()))errorView(error,()=>loadStoredMasters());}
}
export async function loadStoredReconciliation() {
  state.mode='reconciliation';
  const current=++generation;
  loading();
  try {
    const companies=(await ui.api('/api/tally/read-companies')).data;
    const result=await ui.api(`/api/tally/reconciliation?${query()}`);
    if(current!==generation || ui.currentView()!=='tally')return;
    state.companyId=result.company?.id||'';
    $('#view').innerHTML=`<section class="panel"><header><h2>Tally & CRM reconciliation</h2></header><p class="muted">Exact original names only, scoped to the selected company. Creating a CRM record never changes Tally.</p>${controls(companies,result,true)}<p class="muted">Company-wide summary ? filters apply to the table below.</p><div class="cards">${Object.entries(result.summary).map(([key,value])=>`<article class="card"><span>${ui.esc(key.replaceAll('_',' '))}</span><strong>${value}</strong></article>`).join('')}</div><div class="table-wrap reconciliation-table"><table><thead><tr><th>Record</th><th>Type</th><th>Result</th><th>Details</th><th>CRM action</th></tr></thead><tbody>${result.data.map((row,index)=>`<tr><td title="${ui.esc(row.name)}">${text(row.display_name)}</td><td>${ui.esc(row.kind)}</td><td><span class="status ${row.status==='conflict'?'on_hold':''}">${ui.esc(row.status.replaceAll('_',' '))}</span></td><td>${row.conflicts.length?ui.esc(row.conflicts.join('; ')):row.status==='missing_in_crm'?'No exact CRM name':row.status==='missing_in_tally'?'No exact imported name':'Exact name match'}</td><td>${row.status==='missing_in_crm'&&ui.allowed(row.kind==='item'?'items.create':'customers.create')?`<button class="secondary stored-create" data-index="${index}">Create CRM record</button>`:'—'}</td></tr>`).join('')||'<tr><td class="empty" colspan="5">No reconciliation results match this selection.</td></tr>'}</tbody></table></div>${pages(result.pagination)}</section>`;
    bind(loadStoredReconciliation);
    $$('.stored-create').forEach(button=>button.onclick=async()=>{
      const row=result.data[Number(button.dataset.index)];
      button.disabled=true;button.textContent='Creating CRM record…';
      try {
        const response=await ui.api('/api/tally/crm-records',{method:'POST',body:JSON.stringify({companyId:result.company.id,kind:row.kind,sourceId:row.tally[0].id})});
        ui.toast(response.created?'CRM record created and audited.':'This CRM record already exists.');
        await loadStoredReconciliation();
      } catch(error){ui.toast(error.message,true);button.disabled=false;button.textContent='Create CRM record';}
    });
  } catch(error){if(current===generation&&ui.currentView()==='tally')errorView(error,loadStoredReconciliation);}
}
