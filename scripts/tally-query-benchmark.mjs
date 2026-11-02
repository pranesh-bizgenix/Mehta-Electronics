// SELECT-only measurement against the configured database; never emits row values.
import fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createDatabase } from '../src/postgres.js';
import { getConfig } from '../src/config.js';
import { TallyVisibilityService } from '../src/tally-visibility-service.js';
const config=getConfig();
if(new URL(config.databaseUrl).pathname!=='/mehta_electronics_local')throw new Error('Unexpected database');
const db=createDatabase(config),report={checkedAt:new Date().toISOString(),readOnly:true,measurements:[]};
try {
 await db.withConnection(async()=>{
  await db.exec('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const service=new TallyVisibilityService(db),company=await service.repository.company();
  for(const entity of ['ledgers','items'])for(const role of ['OWNER','MANAGER'])for(const mode of ['default','search','group','filter']){
   const url=new URL(`http://benchmark/?companyId=${company.id}&pageSize=25`);
   if(mode==='search')url.searchParams.set('search',entity==='items'?'switch':'electric');
   if(mode==='group'){const row=await db.prepare('SELECT parent_name FROM tally_visibility_current_cache WHERE company_id=? AND entity=? AND parent_name IS NOT NULL ORDER BY parent_name LIMIT 1').get(company.id,entity);if(row)url.searchParams.set('group',row.parent_name);}
   if(mode==='filter')url.searchParams.set('quality',entity==='items'?'missing_hsn':'missing_state');
   const ctx=await service.context(entity,url,{role}),queries=[];
   const original=db.prepare;
   db.prepare=query=>{
    const statement=original(query);
    if(!query.includes('FROM tally_visibility_current_cache'))return statement;
    return Object.fromEntries(Object.entries(statement).map(([method,fn])=>[method,async(...args)=>{
     const plan=await original('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+query).all(...args);
     const root=plan[0]['QUERY PLAN'][0];
     const nodes=[];const walk=n=>{nodes.push({type:n['Node Type'],index:n['Index Name']||null,rows:n['Actual Rows']});for(const child of n.Plans||[])walk(child);};walk(root.Plan);
     queries.push({executionMs:root['Execution Time'],planningMs:root['Planning Time'],nodes});
     return fn(...args);
    }]));
   };
   const start=performance.now();let result;
   try{result=await service.repository.list(ctx.scope,ctx.query);}finally{db.prepare=original;}
   if(queries.length!==2)throw new Error('Expected EXPLAIN for count and page queries');
   report.measurements.push({entity,role,mode,total:result.pagination.total,pageRows:result.data.length,wallMsIncludingExplain:Math.round(performance.now()-start),queries,eachQueryUnder300ms:queries.every(q=>q.executionMs<300)});
  }
  await db.exec('COMMIT');
 });
 await fs.writeFile('docs/tally-query-performance.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report.measurements.map(({queries,...row})=>row),null,2));
}catch(error){console.error(`Tally benchmark failed (${error.code||error.name}).`);process.exitCode=1;}finally{await db.close();}
