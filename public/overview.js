// Presentation only: all financial totals, classifications and counts come from the API.
let state,$,$$,allowed,esc,api,openModal,navigate,toast;
export function configureOverview(context){({state,$,$$,allowed,esc,api,openModal,navigate,toast}=context);}
export function overviewMoney(value,{compact=false}={}){
  if(value==null)return 'Not provided';
  const text=String(value),negative=text.startsWith('-');
  const [whole,fraction='']=text.replace(/^[+-]/,'').split('.');
  const amount=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0').slice(0,2));
  if(compact){
    for(const [limit,suffix]of [[1000000000n,'Cr'],[10000000n,'L']]){
      if(amount>=limit){const hundredths=(amount*100n+limit/2n)/limit;return `${negative?'−':''}₹${hundredths/100n}.${String(hundredths%100n).padStart(2,'0')} ${suffix}`;}
    }
  }
  return `${negative?'−':''}₹${BigInt(whole).toLocaleString('en-IN')}.${fraction.padEnd(2,'0').slice(0,2)}`;
}
const overviewCount=value=>value==null?'Not provided':Number(value).toLocaleString('en-IN');
const overviewDay=value=>value?new Date(value).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Kolkata'}):'Not received';
const overviewTime=value=>value?new Date(value).toLocaleString('en-IN',{day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit',timeZone:'Asia/Kolkata'}):'Not received';
const overviewStamp=value=>`<span class="ov-stamp">As of ${esc(overviewTime(value))}</span>`;

export async function loadDashboard(){
  $('#view').innerHTML='<div class="overview ov-skeleton" aria-busy="true" aria-label="Loading saved Tally overview"><div></div><div></div><div></div></div>';
  try{
    const query=new URLSearchParams();
    if(state.overviewCompany)query.set('companyId',state.overviewCompany);
    if(state.overviewPeriod)query.set('periodId',state.overviewPeriod);
    const dashboard=await api(`/api/dashboard?${query}`);
    if(dashboard.company)query.set('companyId',dashboard.company.id);
    if(dashboard.period)query.set('periodId',dashboard.period.id);
    const tally=dashboard.access.financial?await api(`/api/dashboard/tally?${query}`):null;
    if(state.view!=='dashboard')return;
    renderOverview(dashboard,tally,query);
  }catch(error){
    if(state.view!=='dashboard')return;
    $('#view').innerHTML=`<section class="overview ov-error" role="alert"><span class="ov-eyebrow">OVERVIEW UNAVAILABLE</span><h2>We couldn’t load the saved snapshot.</h2><p>${esc(error.message)}</p><button id="overview-retry" class="primary">Retry</button></section>`;
    $('#overview-retry').onclick=()=>{state.overviewCompany=null;state.overviewPeriod=null;loadDashboard()};
  }
}

function renderOverview(d,t,query){
  const sync=d.sync,ready=t?.available,financial=d.access.financial;
  const warning=sync.latestRun&&['failed','stalled','partial','quarantined'].includes(sync.latestRun.status);
  const stamp=ready?t.asOf:d.period?.received_at;
  const financialHeader=financial?`<div class="ov-controls"><label>Company<select id="overview-company">${d.companies.map(company=>`<option value="${esc(company.id)}" ${company.id===d.company?.id?'selected':''}>${esc(company.name)}</option>`).join('')||'<option>No imported company</option>'}</select></label><label>Delivered upload window<select id="overview-period">${d.periods.map(period=>`<option value="${esc(period.id)}" ${period.id===d.period?.id?'selected':''}>${overviewDay(period.date_from)} — ${overviewDay(period.date_to)}</option>`).join('')||'<option>No completed upload</option>'}</select></label></div>`:'';
  $('#view').innerHTML=`<div class="overview">
    <header class="ov-heading"><div><span class="ov-eyebrow">MEHTA ELECTRONICS / BUSINESS PULSE</span><h2>Your books. A clearer picture.</h2><p>Saved Tally records, with the source behind every number.</p></div><button class="ov-refresh" id="overview-refresh" aria-label="Refresh saved overview">↻ <span>Refresh</span></button></header>
    ${financialHeader}
    <section class="ov-sync ${warning?'ov-sync-warning':''}" aria-label="Sync health"><span class="ov-live ${sync.state==='Connector online'?'is-online':''}" aria-hidden="true"></span><div class="ov-sync-main"><strong>${esc(sync.state)}</strong><span>${esc(sync.company||'Waiting for a Tally company')}</span></div><div class="ov-sync-detail"><strong>${overviewCount(sync.receivedDatasets)} of ${sync.expectedDatasets}</strong><span>datasets received</span></div><div class="ov-sync-detail"><strong>${esc(overviewTime(sync.lastSuccess))}</strong><span>last successful import</span></div><button class="ov-text-button" id="overview-sync">Sync details ↗</button>${warning?`<p class="ov-sync-reason">${esc(sync.latestRun.status)}: ${esc(sync.latestRun.message||'Review the latest run for details.')}</p>`:''}</section>
    ${financial?ready?overviewTallyPanels(t):`<section class="ov-unavailable"><h3>Waiting for a usable Tally snapshot</h3><p>${esc(t?.reason||'No completed upload is available.')}</p></section>`:''}
    ${overviewWorkflow(d.workflow)}
    <footer class="ov-footer"><span>Read-only Tally connection · PostgreSQL-backed</span><span>Last connector contact: ${esc(overviewTime(sync.lastSeen))}</span></footer>
  </div>`;
  $('#overview-refresh').onclick=()=>loadDashboard();
  $('#overview-company')?.addEventListener('change',event=>{state.overviewCompany=event.target.value;state.overviewPeriod=null;loadDashboard()});
  $('#overview-period')?.addEventListener('change',event=>{state.overviewPeriod=event.target.value;loadDashboard()});
  $('#overview-sync').onclick=()=>{
    if(allowed('tally.connector.manage'))return navigate('tally-connector');
    openModal('Sync health',`<div class="detail"><p>${esc(sync.state)}</p><p>${esc(sync.company||'No company received')}</p><p>Last successful import: ${esc(overviewTime(sync.lastSuccess))}</p><p>${esc(sync.latestRun?.message||'No failed run reported.')}</p></div>`,null);
  };
  $$('.ov-nav').forEach(button=>button.onclick=()=>{
    if(button.dataset.view==='customers'||button.dataset.view==='items'){state.masterSource='tally';state.tallyCompanyId=d.company?.id;}
    navigate(button.dataset.view);
  });
  $('#overview-groups')?.addEventListener('click',async()=>{
    try{const result=await api(`/api/tally/masters/groups?companyId=${encodeURIComponent(d.company.id)}&pageSize=100`);openModal('Tally groups',`<div class="detail"><p>${overviewCount(result.pagination.total)} groups · ${esc(d.company.name)}</p><div class="table-wrap"><table><thead><tr><th>Original group name</th><th>Parent</th></tr></thead><tbody>${result.data.map(group=>`<tr><td>${esc(group.name)}</td><td>${esc(group.parent_name||'Not provided')}</td></tr>`).join('')}</tbody></table></div></div>`,null)}catch(error){toast(error.message,true)}
  });
  $('#overview-banks')?.addEventListener('click',()=>openModal('Cash and bank — signed ledger balances',`<div class="detail"><p>As reported by Tally · received ${esc(overviewTime(t.asOf))}. Original signs are preserved. No net cash position is inferred.</p>${overviewBankTable(t.banks)}</div>`,null));
  $$('.ov-quality-details').forEach(button=>button.onclick=async()=>{
    try{const result=await api(`/api/dashboard/quality?${query}`);openModal('Data quality',`<div class="detail"><h3>Original-name collisions</h3>${result.warnings.length?result.warnings.map(warning=>`<article><p>${esc(warning.message)}</p><pre class="tally-all-fields">${esc(JSON.stringify(warning.details,null,2))}</pre></article>`).join(''):'<p>No collisions recorded for this upload.</p>'}<h3>Quarantine</h3>${result.quarantine.length?result.quarantine.map(item=>`<p>${esc(item.dataset)} · record ${item.record_index}: ${esc(item.reason)}</p>`).join(''):'<p>No records quarantined.</p>'}<h3>Parity</h3><p>${esc(result.parity)}</p></div>`,null)}catch(error){toast(error.message,true)}
  });
}

function overviewTallyPanels(t){
  const c=t.counts,s=t.stock,exact=overviewMoney(s.signedValue);
  const hasBankBalances=t.banks.some(bank=>bank.balance!=null);
  const datasetLabels={ledgersXml:'Ledgers',stockXml:'Stock items',groupsXml:'Groups',billsReceivableXml:'Receivable bills',billsPayableXml:'Payable bills',balanceSheetXml:'Balance Sheet',profitAndLossXml:'Profit & Loss',vouchersXml:'Vouchers'};
  const coverageState=item=>item.state==='imported'?`${overviewCount(item.count)} records imported`:item.state==='retained'?'XML received · not processed':item.state==='awaiting_data'?'Awaiting voucher data':item.state==='failed'?'Import failed':'Not provided by the connector';
  return `<p class="ov-context-note">Upload window: ${overviewDay(t.period.date_from)} — ${overviewDay(t.period.date_to)}. This is the connector’s historical window; a master valuation date was not supplied. Received ${esc(overviewTime(t.asOf))}.</p>
    <section class="ov-hero" aria-label="Saved Tally snapshot">
      <article class="ov-stat ov-stat-featured"><div class="ov-stat-top"><span>Recorded stock value</span><span class="ov-badge">${s.missingValue?'PARTIAL VALUE':'SIGNED SUM'}</span></div><strong class="ov-value" tabindex="0" title="${esc(exact)}" aria-label="${esc(exact)}">${esc(overviewMoney(s.signedValue,{compact:true}))}</strong><span class="ov-exact">${esc(exact)}</span><p>${overviewCount(s.valuedItems)} of ${overviewCount(s.totalItems)} items supplied a value.</p><div class="ov-stat-bottom"><span>Computed by CRM</span>${overviewStamp(t.asOf)}</div></article>
      <article class="ov-stat"><div class="ov-stat-top"><span>Tally ledgers</span><span class="ov-mini-icon">↗</span></div><strong class="ov-value">${overviewCount(c.ledgers)}</strong><p>The complete imported ledger universe.</p><button class="ov-text-button ov-nav" data-view="customers">Browse original ledgers →</button><div class="ov-stat-bottom"><span>Computed by CRM · count</span>${overviewStamp(t.asOf)}</div></article>
      <article class="ov-stat"><div class="ov-stat-top"><span>Stock items</span><span class="ov-mini-icon">▦</span></div><strong class="ov-value">${overviewCount(c.items)}</strong><p>Every original name, including punctuation.</p><button class="ov-text-button ov-nav" data-view="items">Open item catalogue →</button><div class="ov-stat-bottom"><span>Computed by CRM · count</span>${overviewStamp(t.asOf)}</div></article>
      <article class="ov-stat"><div class="ov-stat-top"><span>Ledger groups</span><span class="ov-mini-icon">⌘</span></div><strong class="ov-value">${overviewCount(c.groups)}</strong><p>Tally’s original accounting hierarchy.</p><button class="ov-text-button" id="overview-groups">Inspect groups →</button><div class="ov-stat-bottom"><span>Computed by CRM · count</span>${overviewStamp(t.asOf)}</div></article>
    </section>
    <section class="ov-value-note"><span class="ov-note-mark" aria-hidden="true">i</span><p><strong>Read the stock figure with its coverage.</strong> ${overviewCount(s.missingValue)} items have no delivered closing value; they are excluded, never assumed to be zero. ${esc(s.signConvention)}</p></section>
    <section class="ov-classification" aria-label="Ledger classification"><div><span>Customer ledgers</span><strong>${overviewCount(c.customers)}</strong><small>Sundry Debtors and descendant groups</small></div><div><span>Supplier ledgers</span><strong>${overviewCount(c.suppliers)}</strong><small>Sundry Creditors and descendant groups</small></div><div><span>Negative-stock items</span><strong>${overviewCount(s.negativeQuantity)}</strong><small>From readable delivered quantities</small></div><div><span>Zero-stock items</span><strong>${overviewCount(s.zeroQuantity)}</strong><small>${overviewCount(s.unclassifiedQuantity)} quantities could not be classified</small></div><p>Computed by CRM from saved records · ${overviewStamp(t.asOf)}</p></section>
    <div class="ov-two-col"><section class="ov-panel"><header><div><span class="ov-eyebrow">INVENTORY MIX</span><h3>Where your catalogue sits</h3></div><span class="ov-source">Computed by CRM</span></header><p class="ov-description">Six largest stock groups by item count. These bars show records, not sales.</p><div class="ov-group-list">${t.stockGroups.map(group=>`<div class="ov-group-row"><div><span>${esc(group.name||'Group not provided')}</span><strong>${overviewCount(group.count)}</strong></div><meter min="0" max="${c.items}" value="${group.count}" aria-label="${esc(group.name||'Group not provided')}: ${group.count} items"></meter></div>`).join('')}</div>${overviewStamp(t.asOf)}</section>
    <section class="ov-panel"><header><div><span class="ov-eyebrow">CASH & BANK LEDGERS</span><h3>${hasBankBalances?'Balances, as delivered':'Your account directory'}</h3></div><span class="ov-source">As reported by Tally</span></header><p class="ov-description">${hasBankBalances?'Signed closing balances. We have not inferred a net cash position.':`${overviewCount(t.banks.length)} cash and bank ledgers are identified. Closing balances were not provided; no cash total or net position is assumed.`}</p>${overviewBankTable(t.banks.slice(0,5))}${t.banks.length>5?`<button class="ov-text-button" id="overview-banks">View all ${overviewCount(t.banks.length)} accounts →</button>`:''}${overviewStamp(t.asOf)}</section></div>
    <section class="ov-quality"><header><div><span class="ov-eyebrow">TRUST & TRACEABILITY</span><h3>What needs your attention</h3></div><button class="ov-text-button ov-quality-details">Inspect quality details ↗</button></header><div class="ov-quality-grid"><article class="ov-quality-amber"><strong>${overviewCount(t.quality.warnings)}</strong><div><h4>Name-collision warnings</h4><p>Distinct original items are retained separately.</p></div></article><article><strong>${overviewCount(t.quality.quarantined)}</strong><div><h4>Quarantined records</h4><p>Records held aside rather than dropping the whole import.</p></div></article><article class="ov-quality-amber"><span class="ov-quality-symbol">?</span><div><h4>Financial parity not checked</h4><p>Bill and report totals still need processing.</p></div></article></div>${overviewStamp(t.asOf)}</section>
    <section class="ov-panel ov-coverage"><header><div><span class="ov-eyebrow">DELIVERED, NOT ASSUMED</span><h3>Your data coverage</h3></div><span class="ov-source">Saved upload</span></header><p class="ov-description">Receivables, payables, ageing and headline report figures will remain unavailable until their retained XML is processed. No estimated amounts are shown.</p><div class="ov-coverage-grid">${t.coverage.map(item=>`<div><span class="ov-coverage-dot ${item.state==='imported'?'is-imported':''}" aria-hidden="true"></span><div><strong>${datasetLabels[item.dataset]}</strong><span>${coverageState(item)}</span></div></div>`).join('')}</div>${overviewStamp(t.asOf)}</section>
    <section class="ov-awaiting"><span class="ov-eyebrow">AWAITING VOUCHER DATA</span><h3>Sales, billing and collections need real transactions.</h3><p>Sales today and this month, billed today, collections today and top-selling items are not inferred from stock or outstanding bills.</p></section>`;
}

function overviewBankTable(banks){
  if(!banks.length)return '<p class="ov-description">No cash or bank accounts delivered for this snapshot.</p>';
  const hasBalances=banks.some(bank=>bank.balance!=null);
  return `<div class="ov-bank-table"><table><thead><tr><th>Account</th><th>${hasBalances?'Signed balance':'Tally group'}</th></tr></thead><tbody>${banks.map(bank=>`<tr><td><strong>${esc(bank.name)}</strong>${hasBalances?`<small>${esc(bank.root)}</small>`:''}</td><td>${hasBalances?`${esc(overviewMoney(bank.balance))}${bank.dr_cr?` ${esc(bank.dr_cr)}`:''}`:esc(bank.root)}</td></tr>`).join('')}</tbody></table></div>`;
}

function overviewWorkflow(workflow){
  const s=workflow.stats,active=s.enquiries+s.quotations+s.orders>0;
  return `<section class="ov-panel ov-workflow"><header><div><span class="ov-eyebrow">YOUR TEAM’S WORK</span><h3>CRM workflow</h3></div><span class="ov-source">Computed by CRM · CRM records</span></header><p class="ov-description">${active?'Sales activity entered in CRM, kept separate from Tally accounting.':'No activity yet. Add your first enquiry or quotation to begin tracking your sales workflow.'}</p><div class="ov-workflow-grid"><button class="ov-nav" data-view="enquiries"><span>Open enquiries</span><strong>${overviewCount(s.enquiries)}</strong></button><button class="ov-nav" data-view="quotations"><span>Open quotations</span><strong>${overviewCount(s.quotations)}</strong></button><button class="ov-nav" data-view="orders"><span>Open sales orders</span><strong>${overviewCount(s.orders)}</strong></button><button class="ov-nav" data-view="orders"><span>Order book value</span><strong>${esc(overviewMoney(s.order_value))}</strong></button></div><details class="ov-workflow-unavailable"><summary>Workflow features not configured</summary><p>${workflow.unavailable.map(esc).join(' · ')}. These queues are not implemented; no counts are invented.</p></details>${overviewStamp(workflow.asOf)}</section>`;
}
