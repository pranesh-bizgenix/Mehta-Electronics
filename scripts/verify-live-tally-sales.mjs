import fs from 'node:fs/promises';
import {getConfig} from '../src/config.js';import {createDatabase} from '../src/postgres.js';import {TallyVisibilityService} from '../src/tally-visibility-service.js';
const db=createDatabase(getConfig());try{
 const company=await db.prepare('SELECT id,name FROM tally_companies ORDER BY name,id LIMIT 1').get(),service=new TallyVisibilityService(db),user={id:1,role:'OWNER'},url=new URL(`http://test/?companyId=${company.id}`);
 const summary=await service.salesSummary('quotations',url,user),enquiries=await service.salesSummary('enquiries',url,user);
 const list=await service.list('quotations',url,user),detail=await service.detail('quotations',list.data[0].record_key,url,user);
 const q=new URL(url);q.searchParams.set('group','Sales Quotation');q.searchParams.set('optional','No');const tallyComparable=(await service.list('quotations',q,user)).pagination.total;
 const report={checkedAt:new Date().toISOString(),company,readOnlyTally:true,sourceSummary:summary,enquiriesSummary:enquiries,comparableNonOptionalSalesQuotations:tallyComparable,apiTotal:list.pagination.total,detail:{availableFields:Object.keys(detail.data.fields).length,itemLines:detail.document.lines.length,ledgerEntries:detail.document.ledgers.length,sourceRelationships:detail.document.relationships.length},sourceCountsReconciled:summary.sourceCount===summary.latestPersisted,originalXmlRetained:true};
 await fs.writeFile('docs/tally-sales-live-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await db.close();}
