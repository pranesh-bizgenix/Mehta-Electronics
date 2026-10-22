// Overview reads PostgreSQL only. It never contacts Tally or the connector.
export async function overviewContext(db,config,url) {
  const companies=await db.prepare('SELECT id,name FROM tally_companies ORDER BY name').all();
  const companyId=url.searchParams.get('companyId')||companies[0]?.id||null;
  if(companyId&&!companies.some(company=>company.id===companyId)){
    const error=new Error('Select an imported Tally company.');error.status=422;throw error;
  }
  const company=companies.find(company=>company.id===companyId)||null;
  const periods=company?await db.prepare(`SELECT DISTINCT ON (sync_from,sync_to) id,sync_from::text AS date_from,sync_to::text AS date_to,
    created_at AS received_at,completed_at AS imported_at FROM tally_upload_sessions
    WHERE company_name=? AND status='stored' ORDER BY sync_from,sync_to,created_at DESC`).all(company.name):[];
  periods.sort((a,b)=>new Date(b.received_at)-new Date(a.received_at));
  const periodId=url.searchParams.get('periodId')||periods[0]?.id||null;
  if(periodId&&!periods.some(period=>period.id===periodId)){
    const error=new Error('Select a delivered upload window.');error.status=422;throw error;
  }
  const period=periods.find(item=>item.id===periodId)||null;
  const connector=company?await db.prepare(`SELECT c.profile_name,c.status,c.machine_name,c.last_seen_at,c.last_sync_at,
    h.tally_available,h.selected_company,h.updated_at AS heartbeat_at
    FROM tally_connectors c LEFT JOIN tally_connector_heartbeats h ON h.connector_id=c.id
    WHERE c.expected_company_name=? ORDER BY c.last_seen_at DESC NULLS LAST,c.created_at DESC LIMIT 1`).get(company.name):null;
  const latestRun=company?await db.prepare(`SELECT status,message,record_count,started_at,completed_at,last_progress_at
    FROM tally_sync_jobs WHERE company_name=? ORDER BY started_at DESC LIMIT 1`).get(company.name):null;
  if(latestRun?.status==='running' && Date.now()-new Date(latestRun.last_progress_at).getTime()>config.tallyStalledRunMinutes*60_000){
    latestRun.status='stalled';latestRun.message='No upload or progress has arrived within the configured timeout.';
  }
  const datasets=period?await db.prepare(`SELECT dataset,status,payload_count,imported_count,quarantined_count,error,processed_at
    FROM tally_run_datasets WHERE session_id=? ORDER BY dataset`).all(period.id):[];
  const received=period?(await db.prepare('SELECT COUNT(DISTINCT dataset) AS n FROM tally_raw_payloads WHERE session_id=?').get(period.id)).n:0;
  const seen=connector?.heartbeat_at||connector?.last_seen_at;
  const online=seen && Date.now()-new Date(seen).getTime()<=180_000;
  const sync={company:company?.name||null,state:!connector?'Not connected':connector.status==='revoked'?'Revoked':!online?'Connector offline':connector.tally_available===false?'Tally unavailable':connector.selected_company!==company.name?'Company not matched':'Connector online',
    lastSeen:seen||null,lastSuccess:connector?.last_sync_at||null,receivedDatasets:received,expectedDatasets:8,
    latestRun:latestRun?{status:latestRun.status,message:['failed','stalled','partial','quarantined'].includes(latestRun.status)?latestRun.message:null}:null};
  return {companies,company,periods,period,datasets,sync};
}

export async function workflowOverview(db) {
  const stats=await db.prepare(`SELECT
    (SELECT COUNT(*) FROM enquiries WHERE status NOT IN ('WON','LOST','CANCELLED')) AS enquiries,
    (SELECT COUNT(*) FROM quotations WHERE status IN ('DRAFT','SENT')) AS quotations,
    (SELECT COUNT(*) FROM sales_orders WHERE status NOT IN ('COMPLETED','CANCELLED')) AS orders,
    (SELECT ROUND(COALESCE(SUM(l.ordered_quantity*l.unit_price*(1-l.discount_percent/100)*(1+l.tax_percent/100)),0),2)::text
      FROM sales_order_lines l JOIN sales_orders o ON o.id=l.sales_order_id WHERE o.status NOT IN ('COMPLETED','CANCELLED')) AS order_value,
    (SELECT ROUND(COALESCE(SUM(l.quantity*l.unit_price*(1-l.discount_percent/100)*(1+l.tax_percent/100)),0),2)::text
      FROM quotation_lines l JOIN quotations q ON q.id=l.quotation_id WHERE NOT l.is_deleted AND q.status IN ('DRAFT','SENT')) AS pipeline,
    (SELECT COUNT(*) FROM customers) AS customers,(SELECT COUNT(*) FROM items) AS items,
    (SELECT COUNT(*) FROM users WHERE status='ACTIVE') AS users`).get();
  const recent=await db.prepare(`SELECT entity,action,created_at,record_id FROM audit_logs
    WHERE entity IN ('ENQUIRY','QUOTATION','SALES_ORDER') ORDER BY created_at DESC,id DESC LIMIT 5`).all();
  return {stats,recent,source:'CRM workflow',asOf:new Date().toISOString(),
    unavailable:['Quotation approval queue','Margin flags','Order-reply approvals','Overdue tasks']};
}

export async function tallyOverview(db,context) {
  const {company,period,datasets}=context;
  if(!company||!period)return {available:false,reason:'Waiting for a completed Tally upload.',asOf:null};
  const args=[company.id,period.id];
  const items=await db.prepare(String.raw`SELECT COUNT(*) AS count,COUNT(closing_value) AS valued,
    SUM(closing_value)::text AS value,
    COUNT(*) FILTER(WHERE closing_quantity_text IS NOT NULL) AS quantity_reported,
    COUNT(*) FILTER(WHERE q IS NOT NULL AND q::numeric<0) AS negative_quantity,
    COUNT(*) FILTER(WHERE q IS NOT NULL AND q::numeric=0) AS zero_quantity,
    COUNT(*) FILTER(WHERE q IS NULL) AS unclassified_quantity
    FROM (SELECT closing_value,closing_quantity_text,
      replace(substring(closing_quantity_text FROM '^\s*([+-]?[0-9,]+(?:\.[0-9]+)?)(?:\s|$)'),',','') AS q
      FROM tally_stock_items WHERE company_id=? AND session_id=?) snapshot`).get(...args);
  const ledgers=(await db.prepare('SELECT COUNT(*) AS n FROM tally_ledgers WHERE company_id=? AND session_id=?').get(...args)).n;
  const groups=(await db.prepare('SELECT COUNT(*) AS n FROM tally_groups WHERE company_id=? AND session_id=?').get(...args)).n;
  const expectedItems=datasets.find(item=>item.dataset==='stockXml')?.imported_count||0;
  if(expectedItems>0&&items.count===0)return {available:false,reason:'This historical master snapshot has been superseded. Select the latest delivered upload window.',asOf:period.received_at};
  const families=await db.prepare(`WITH RECURSIVE family(root,name) AS (
    SELECT name,name FROM tally_groups WHERE company_id=? AND lower(name) IN ('sundry debtors','sundry creditors','bank accounts','cash-in-hand')
    UNION SELECT f.root,g.name FROM tally_groups g JOIN family f ON lower(g.parent_name)=lower(f.name) WHERE g.company_id=?
  ) SELECT f.root,COUNT(l.id) AS ledger_count FROM family f LEFT JOIN tally_ledgers l
    ON lower(l.parent_name)=lower(f.name) AND l.company_id=? AND l.session_id=? GROUP BY f.root ORDER BY f.root`).all(company.id,company.id,...args);
  const banks=await db.prepare(`WITH RECURSIVE family(root,name) AS (
    SELECT name,name FROM tally_groups WHERE company_id=? AND lower(name) IN ('bank accounts','cash-in-hand')
    UNION SELECT f.root,g.name FROM tally_groups g JOIN family f ON lower(g.parent_name)=lower(f.name) WHERE g.company_id=?
  ) SELECT l.name,f.root,l.closing_balance::text AS balance,l.dr_cr FROM tally_ledgers l
    JOIN family f ON lower(l.parent_name)=lower(f.name) WHERE l.company_id=? AND l.session_id=? ORDER BY f.root,l.name`).all(company.id,company.id,...args);
  const stockGroups=await db.prepare(`SELECT parent_name AS name,COUNT(*) AS count FROM tally_stock_items
    WHERE company_id=? AND session_id=? GROUP BY parent_name ORDER BY count DESC,parent_name NULLS LAST LIMIT 6`).all(...args);
  const quality=await db.prepare(`SELECT
    (SELECT COUNT(*) FROM tally_import_warnings WHERE company_id=? AND session_id=?) AS warnings,
    (SELECT COUNT(*) FROM tally_import_quarantine WHERE company_id=? AND session_id=?) AS quarantined`).get(...args,...args);
  const coverage=['ledgersXml','stockXml','groupsXml','billsReceivableXml','billsPayableXml','balanceSheetXml','profitAndLossXml','vouchersXml'].map(name=>{
    const dataset=datasets.find(row=>row.dataset===name);
    return {dataset:name,state:dataset?.status||'not_provided',count:dataset?.status==='imported'?dataset.imported_count:null,error:dataset?.error||null};
  });
  return {available:true,asOf:period.received_at,processedAt:period.imported_at,period,
    counts:{ledgers,items:items.count,groups,customers:families.find(f=>f.root.toLowerCase()==='sundry debtors')?.ledger_count??null,
      suppliers:families.find(f=>f.root.toLowerCase()==='sundry creditors')?.ledger_count??null},
    stock:{signedValue:items.value,valuedItems:items.valued,missingValue:items.count-items.valued,totalItems:items.count,
      negativeQuantity:items.negative_quantity,zeroQuantity:items.zero_quantity,unclassifiedQuantity:items.unclassified_quantity,
      source:'Computed by CRM',signConvention:'Sum of delivered signed closing values. Signs are preserved; blank values are excluded, never assumed zero.'},
    banks,stockGroups,quality,coverage,
    parity:{status:'not_checked',reason:'Outstanding and reported totals are retained as XML but have not been normalized. Parity cannot yet be calculated.'},
    missing:{receivables:'Bill XML received; awaiting bill processing.',payables:'Bill XML received; awaiting bill processing.',
      statements:'Report XML received; awaiting report processing.',sales:'Awaiting voucher data'}};
}
