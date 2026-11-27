import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readPriceWorkbook} from '../src/modules/pricing/tabular.js';

const baseURL=process.env.CRM_RELEASE_URL,host=baseURL&&new URL(baseURL).hostname;
if(!host||!['mehta-controldesk.vercel.app',process.env.CRM_CANDIDATE_HOST].filter(Boolean).includes(host)||!/^mehta-controldesk(?:-[a-z0-9]+-umang-ratanis-projects)?\.vercel\.app$/.test(host))throw Error('Unexpected deployment origin.');
const owner=JSON.parse(fs.readFileSync('.vercel/acceptance/operating-test-accounts.private.json','utf8')).find(a=>a.role==='OWNER');assert.ok(owner?.verified);
let bypass='';if(host!=='mehta-controldesk.vercel.app'){const bytes=fs.readFileSync('.vercel/acceptance/project-before-git-push.private.json'),meta=JSON.parse((bytes[0]===255&&bytes[1]===254?bytes.toString('utf16le'):bytes.toString('utf8')).replace(/^\uFEFF/,''));bypass=Object.keys(meta.protectionBypass??{})[0]||'';assert.ok(bypass);}
const out='verification-output/materials-deployed/'+host;fs.mkdirSync(out,{recursive:true});
const report={scope:'Normal Owner sign-in and actual material queue reads; unsaved forms only. No material receipt, approval, financial posting or fixture persistence.',checks:[],errors:[],serverErrors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({baseURL,viewport:{width:1440,height:1000},acceptDownloads:true}),page=await context.newPage();
 await context.route('**/*',route=>{const request=route.request(),url=new URL(request.url()),headers={...request.headers()};if(url.origin===baseURL&&bypass)headers['x-vercel-protection-bypass']=bypass;else delete headers['x-vercel-protection-bypass'];
  if(url.origin===baseURL&&!['GET','HEAD','OPTIONS'].includes(request.method())&&!/^\/api\/(auth\/(login|logout)|crm\/reports\/[^/]+\/(pdf|xlsx))$/.test(url.pathname))return route.abort();return route.continue({headers});});
 page.setDefaultTimeout(60000);page.on('pageerror',e=>report.errors.push(e.message));page.on('response',r=>{if(r.status()>=500&&new URL(r.url()).origin===baseURL)report.serverErrors.push({path:new URL(r.url()).pathname,status:r.status()});});
 const check=async(name,fn)=>{await fn();report.checks.push(name);console.log('PASS',name);};
 let csrf;const headers=bypass?{'x-vercel-protection-bypass':bypass}:{};
 await check('Existing Owner signs in normally',async()=>{assert.equal((await page.goto('/login')).status(),200);await page.locator('input[name=email]').fill(owner.email);await page.locator('input[name=password]').fill(owner.password);const login=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/login');await page.getByRole('button',{name:'Sign in',exact:true}).click();const r=await login;assert.equal(r.status(),200);csrf=(await r.json()).csrfToken;await page.waitForURL(u=>!u.pathname.includes('login'));});

 await check('Actual material queue and eligible cases return permission-checked records',async()=>{for(const path of ['/api/crm/support/materials','/api/crm/support/materials/eligible']){const r=await context.request.get(path,{headers,maxRetries:2});assert.equal(r.status(),200);assert.ok(Array.isArray((await r.json()).data));}});
 for(const width of [1440,390])await check('Material workspace fits '+width+'px',async()=>{await page.setViewportSize({width,height:950});assert.equal((await page.goto('/support/materials')).status(),200);await page.getByRole('heading',{name:'Return material custody',exact:true}).waitFor();await page.evaluate(()=>window.scrollTo(0,0));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));await page.screenshot({path:`${out}/materials-${width}.png`,fullPage:true});});
 await check('Create form opens without saving a material or business record',async()=>{await page.getByRole('button',{name:'Start material tracking',exact:true}).click();await page.getByLabel('Find warranty or return case',{exact:false}).fill('SAMPLE UNSAVED SEARCH');await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');});
 await check('Malformed material identity is rejected',async()=>{const r=await context.request.get('/api/crm/support/materials/not-a-valid-id',{headers,maxRetries:2});assert.equal(r.status(),422);});
 await check('Actual invoice-copy register remains accessible',async()=>{const r=await context.request.get('/api/crm/billing',{headers,maxRetries:2});assert.equal(r.status(),200);assert.ok(Array.isArray((await r.json()).data));});
 await check('Original invoice product editor opens without saving a business record',async()=>{await page.goto('/billing');await page.getByRole('button',{name:'New invoice document',exact:true}).click();await page.getByLabel('Invoice source',{exact:false}).selectOption('TALLY');await page.getByLabel('Product code, original line 1',{exact:false}).fill('SAMPLE UNSAVED');await page.getByLabel('Quantity, original line 1',{exact:false}).fill('2.000001');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));await page.screenshot({path:`${out}/invoice-source-unsaved.png`,fullPage:true});await page.keyboard.press('Escape');});
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.serverErrors,[]);report.passed=true;
}catch(e){report.error=[bypass,owner.password].filter(Boolean).reduce((s,v)=>s.replaceAll(v,'[private]'),String(e.message).split(/\r?\n/)[0]);process.exitCode=1;}
finally{await browser.close();fs.writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed||false,checks:report.checks.length,error:report.error}));}
