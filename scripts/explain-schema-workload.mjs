// Planner-only evidence from real repository queries. No ANALYZE, row output or load generation.
import fs from 'node:fs';
import {getConfig} from '../src/config.js';
import {createDatabase} from '../src/postgres.js';
import {TallyVisibilityService} from '../src/tally-visibility-service.js';
const config=getConfig(),db=createDatabase(config);
try{
  await db.ready();
  const report={checkedAt:new Date().toISOString(),database:'mehta_electronics_local',readOnly:true,
    ranking:'Ten highest estimated planner costs among 32 representative generated Tally list/count queries. Not an observed production runtime ranking; pg_stat_statements is not installed.',queries:[]};
  await db.withConnection(async()=>{
    await db.exec('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try{
      const selected=process.argv.find(a=>a.startsWith('--company-id='))?.slice('--company-id='.length);
      const company=selected?await db.prepare('SELECT id FROM tally_companies WHERE id=?::uuid').get(selected):await db.prepare('SELECT id FROM tally_companies WHERE name=?').get(config.tallyCompany);
      if(!company)throw new Error('Choose an existing selected company with --company-id=<UUID>; no first-company fallback is permitted.');
      report.companyId=company.id;
      const service=new TallyVisibilityService(db);
      for(const entity of ['ledgers','items'])for(const role of ['OWNER','MANAGER'])for(const mode of ['default','search','group','filter']){
        const url=new URL(`/?companyId=${encodeURIComponent(company.id)}&pageSize=25`,'http://127.0.0.1:3000');
        if(mode==='search')url.searchParams.set('search',entity==='items'?'switch':'electric');
        if(mode==='group'){
          const row=await db.prepare('SELECT parent_name FROM tally_visibility_current_cache WHERE company_id=? AND entity=? AND parent_name IS NOT NULL ORDER BY parent_name LIMIT 1').get(company.id,entity);
          if(row)url.searchParams.set('group',row.parent_name);
        }
        if(mode==='filter')url.searchParams.set('quality',entity==='items'?'missing_hsn':'missing_state');
        const ctx=await service.context(entity,url,{role}),prepare=db.prepare;
        db.prepare=query=>{
          const statement=prepare(query);
          if(!query.includes('FROM tally_visibility_current_cache'))return statement;
          return Object.fromEntries(Object.keys(statement).map(method=>[method,async(...args)=>{
            if(!['get','all'].includes(method))throw new Error('Planner audit only permits SELECT queries.');
            const result=await prepare('EXPLAIN (FORMAT JSON) '+query).all(...args),plan=result[0]['QUERY PLAN'][0].Plan,nodes=[];
            const walk=node=>{nodes.push({type:node['Node Type'],index:node['Index Name']||null,estimatedRows:node['Plan Rows'],totalCost:node['Total Cost']});for(const child of node.Plans||[])walk(child);};
            walk(plan);
            report.queries.push({entity,role,mode,kind:method==='get'?'count':'page',totalCost:plan['Total Cost'],nodes});
            return method==='get'?{n:0}:[];
          }]));
        };
        try{await service.repository.list(ctx.scope,ctx.query);}finally{db.prepare=prepare;}
      }
    }finally{await db.exec('ROLLBACK');}
  });
  if(report.queries.length!==32)throw new Error('Expected both real count and page plans for each of 16 scenarios.');
  report.topTen=[...report.queries].sort((a,b)=>b.totalCost-a.totalCost).slice(0,10);
  fs.writeFileSync(new URL('../docs/schema-query-plans.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log('PASS: 32 planner-only EXPLAINs; top ten recorded in docs/schema-query-plans.json. No load test, ANALYZE or business-row output.');
}catch(error){console.error(`Planner audit failed (${error.code||error.name}): ${error.message}`);process.exitCode=1;}
finally{await db.close();}
