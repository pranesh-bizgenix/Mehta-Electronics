import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs/promises';
const output=process.env.UI_REVIEW_OUTPUT || 'output/ui-polish';await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext();const errors=[];const contrast=[];
const company={id:'11111111-1111-4111-8111-111111111111',name:'Mehta Electric Corporation',display_name:'Mehta Electric Corporation'};
const pagination={page:1,pageSize:25,total:3,pages:1};
await context.route('**/api/**',async route=>{
 const url=new URL(route.request().url());const path=url.pathname;let body={data:[]};
 if(path==='/api/auth/me')body={user:{id:1,name:'Presentation Owner',role:'OWNER',email:'preview@example.invalid',status:'ACTIVE'},permissions:['*'],csrfToken:'preview',mfa:{required:false,verified:true}};
 else if(path.includes('read-companies'))body={data:[company]};
 else if(path.includes('/preferences'))body={data:{theme:'light',density:'comfortable',sidebarCollapsed:false,savedFilters:{}}};
 else if(path.includes('/badges'))body={data:{}};
 else if(path.includes('/notifications'))body={data:[]};
 else if(path.includes('/dashboard/summary'))body={data:{kpis:{pipeline:{value:'284500',count:8},orderBook:{value:'172000',count:4},quotesAwaitingApproval:3,openEnquiries:12,slaBreaches:1,openExceptions:2},decisions:[],activity:[]}};
 else if(path.endsWith('/visibility/overview'))body={counts:[{entity:'items',count:10988},{entity:'ledgers',count:4152},{entity:'groups',count:78},{entity:'units',count:12}],sync:[{status:'stored',completed_at:'2026-11-02T08:30:00Z'}],warnings:2,quarantine:0};
 else if(path.includes('/visibility/')){const items=path.endsWith('/items');body={pagination,lastUpdated:'2026-11-02T08:30:00Z',emptyReason:'',data:['Siemens Industrial Controls','Precision Electricals','Atlas Engineering'].map((name,i)=>({id:String(i),record_key:String(i),name:items?['Siemens Contactor 3RT2026','Terminal Block 2.5 mm','MCB 32A Double Pole'][i]:name,parent_name:items?'Electrical components':'Sundry Debtors',fields:{'/stored/gstin':'27AABCP1234F1Z5','/stored/base_unit':'NOS','/stored/closing_quantity_text':String(120+i*15),'/stored/name':name}}))};}
 else if(path.includes('/crm/customers')||path.includes('/crm/items'))body={data:[],pagination:{...pagination,total:0}};
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
for(const screen of ['customers','items','dashboard']){
 await page.setViewportSize({width:1440,height:1000});await page.goto('http://localhost:3198/'+screen);await page.getByRole('heading',{level:1}).waitFor();
 if(screen!=='dashboard')await page.getByText(screen==='items'?'Siemens Contactor 3RT2026':'Siemens Industrial Controls',{exact:true}).waitFor();else await page.getByText('10,988',{exact:true}).first().waitFor();
 for(const theme of ['light','dark'])for(const width of [1440,390]){
  await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.setViewportSize({width,height:width===390?844:1000});
  const audit=await new AxeBuilder({page}).withRules(['color-contrast']).analyze();contrast.push({screen,theme,width,violations:audit.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))});
  await page.screenshot({path:`${output}/${screen}-${width}-${theme}.png`,fullPage:true,animations:'disabled'});
  if(!await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1))throw Error(`${screen} overflow at ${width}`);
 }
 if(screen==='customers'){
  await page.getByRole('tab',{name:'Tally imports'}).focus();await page.keyboard.press('ArrowRight');await page.getByRole('heading',{name:'No customers yet',exact:true}).waitFor();
  await page.getByRole('tab',{name:'Tally imports'}).click();await page.getByRole('button',{name:'View details',exact:true}).first().click();await page.getByLabel('Find a field').fill('gstin');await page.getByText('27AABCP1234F1Z5',{exact:true}).last().waitFor();
 }
 if(screen==='dashboard'){await page.getByText('Collection coverage',{exact:true}).click();await page.getByText('No records',{exact:true}).first().waitFor();}
}
await fs.writeFile(`${output}/verification.json`,JSON.stringify({fixturePreview:true,screens:['customers','items','dashboard'],viewports:[1440,390],themes:['light','dark'],checks:['no horizontal overflow','keyboard source tabs','drawer field search','expand collection coverage'],errors,contrast},null,2));
await browser.close();const failures=contrast.filter(c=>c.violations.length);if(failures.length)throw Error(JSON.stringify(failures,null,2));if(errors.length)throw Error(errors.join('\n'));console.log('Passed: 12 responsive screenshots, keyboard tabs, field search, coverage, no page errors. Fixture API only; no business data changed.');
