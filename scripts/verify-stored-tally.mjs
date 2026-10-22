// Browser verification with a static shell, synthetic stored responses and no backend.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const root=path.resolve('public'),output=path.resolve('output/tally-read-review');
await fs.mkdir(output,{recursive:true});
const server=http.createServer(async(req,res)=>{
  try {
    const pathname=new URL(req.url,'http://localhost').pathname;
    const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
    res.setHeader('content-type',({'.html':'text/html','.css':'text/css','.js':'text/javascript'})[path.extname(file)]+'; charset=utf-8');
    res.end(await fs.readFile(file));
  }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const company={id:'00000000-0000-0000-0000-000000000001',name:'Mehta (from 1-Apr-23) (from 1-Apr-23)',display_name:'Mehta (from 1-Apr-23)'};
const sync={status:'partial',lastSyncAt:null,lastSuccessfulSyncAt:'2026-10-21T04:30:00Z'};
const pagination={page:1,pageSize:25,total:1,pages:1};
const requests=[],errors=[];
let browser,created=false;
try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url()),pathname=url.pathname;
    requests.push(`${request.method()} ${pathname}`);
    assert.equal(/sync|pair|upload|heartbeat|connector/.test(pathname),false,'No connector requests allowed');
    if(pathname==='/api/auth/me')return route.fulfill({json:{user:{id:1,name:'Preview Owner',role:'OWNER',mustChangePassword:false},permissions:['*'],csrfToken:'preview-csrf'}});
    if(pathname==='/api/dashboard')return route.fulfill({status:503,json:{error:'Overview intentionally not loaded by this focused test'}});
    if(pathname==='/api/tally/read-companies')return route.fulfill({json:{data:[company]}});
    if(pathname==='/api/tally/crm-records'){
      assert.equal(request.method(),'POST');assert.equal(request.headers()['x-csrf-token'],'preview-csrf');
      assert.deepEqual(request.postDataJSON(),{companyId:company.id,kind:'vendor',sourceId:'vendor-1'});
      created=true;return route.fulfill({status:201,json:{created:true,record:{id:1}}});
    }
    if(pathname==='/api/tally/reconciliation')return route.fulfill({json:{company,sync,pagination,data:[{kind:'vendor',name:'Vendor A',display_name:'Vendor A',status:created?'matched':'missing_in_crm',conflicts:[],tally:[{id:'vendor-1',name:'Vendor A'}],crm:created?[{id:1,name:'Vendor A'}]:[]}],summary:{matched:created?1:0,missing_in_crm:created?0:1,missing_in_tally:0,conflict:0}}});
    const kind=pathname.split('/').at(-1);
    if(['customers','vendors','banks','expenses','other','groups','items'].includes(kind)){
      let row={id:'c1',name:'CafÃ©',original_name:'CafÃ©',display_name:'Café',display_group:'Retail',display_phone:'+91 98765',email:null,closing_balance:'-250.00'};
      if(kind==='items')row={id:'i1',name:'Part-1',original_name:'Part-1',display_name:'Part-1',display_group:'Switchgear',closing_quantity_text:'-2 NOS',closing_rate_text:null,closing_value:'-125.25'};
      if(kind==='groups')row={id:'g1',name:'Retail',original_name:'Retail',display_name:'Retail',display_group:'Sundry Debtors',depth:1,path:['Sundry Debtors','Retail'],hierarchy_status:'resolved'};
      if(kind==='vendors')row={...row,name:'Vendor A',display_name:'Vendor A',original_name:'Vendor A'};
      return route.fulfill({json:{company,sync,pagination,data:[row],financial:true,groupCount:78,coverage:kind==='items'?{totalItems:2,valuedItems:1,missingValue:1,totalValue:null,knownSignedValue:'-125.25',partial:true,label:'Partial value',note:'Signed values only. Missing values are not zero.'}:null}});
    }
    throw new Error(`Unmocked route: ${pathname}`);
  });
  await page.goto(base);await page.locator('#app:not(.hidden)').waitFor();
  await page.locator('#nav [data-view=customers]').click();
  await page.getByRole('heading',{name:'Saved Tally customers',exact:true}).waitFor();
  assert.match(await page.locator('#view').innerText(),/Café/);
  assert.equal(await page.locator('#stored-company').inputValue(),company.id);
  assert.equal(await page.locator('#stored-company option').innerText(),company.display_name);
  assert.equal(await page.locator('#view [title="This field is absent in the saved import"]').count(),1);
  await page.screenshot({path:path.join(output,'customers.png'),fullPage:true});
  await page.locator('#stored-category').selectOption('groups');
  await page.getByRole('heading',{name:'Saved Tally group hierarchy',exact:true}).waitFor();
  assert.match(await page.locator('#view').innerText(),/78 imported groups/);
  await page.screenshot({path:path.join(output,'groups.png'),fullPage:true});
  await page.locator('#nav [data-view=items]').click();
  await page.locator('.stock-coverage').waitFor();
  assert.match(await page.locator('.stock-coverage').innerText(),/Stock total unavailable/);
  assert.match(await page.locator('.stock-coverage').innerText(),/1 items with value · 1 without value/);
  await page.screenshot({path:path.join(output,'items.png'),fullPage:true});
  await page.locator('#nav [data-view=tally]').click();
  await page.getByRole('button',{name:'Create CRM record',exact:true}).waitFor();
  await page.screenshot({path:path.join(output,'reconciliation.png'),fullPage:true});
  await page.getByRole('button',{name:'Create CRM record',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.reconciliation-table')?.textContent.includes('Exact name match'));
  assert.equal(await page.getByRole('button',{name:'Create CRM record',exact:true}).count(),0);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.join(output,'reconciliation-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(output,'verification.json'),JSON.stringify({fixtureData:true,browserErrors:errors,crmCreateVerified:created,requests},null,2));
  console.log('Stored Tally browser checks passed: classification UI, display repair, hierarchy, coverage, CRM-only create, CSRF, sync display, mobile.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
