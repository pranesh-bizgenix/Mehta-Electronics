import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {NAV} from '../apps/web/components/shell/nav-config.ts';

const output=new URL('../verification-output/role-access/2026-11-17/final-rerun/',import.meta.url);
await fs.mkdir(output,{recursive:true});
const accounts=(await fs.readFile(new URL('../verification-output/role-access/credentials.md',import.meta.url),'utf8')).split('\n').filter(line=>/^\| (OWNER|MANAGER|EXECUTIVE|ACCOUNTS|LOGISTICS_LEAD|STORE_STAFF) \|/.test(line)).map(line=>{const c=line.split('|').map(v=>v.trim());return {role:c[1],email:c[2],password:c[3]};});
assert.equal(accounts.length,6);
const browser=await chromium.launch({headless:true});
const results={at:new Date().toISOString(),roles:[],status:'RUNNING'};
try {
  for(const account of accounts){
    const context=await browser.newContext();
    try {
      const page=await context.newPage();page.setDefaultTimeout(90000);
      const response=await context.request.post('http://127.0.0.1:3000/api/auth/login',{data:{email:account.email,password:account.password}});
      assert.equal(response.status(),200,account.role+' login');
      const me=await (await context.request.get('http://127.0.0.1:3000/api/auth/me')).json();
      assert.equal(me.user.role,account.role);
      const home=['STORE_STAFF','LOGISTICS_LEAD'].includes(account.role)?'/logistics':'/dashboard';
      await page.goto('http://127.0.0.1:3000'+home,{timeout:180000});
      const nav=page.getByRole('navigation',{name:'Main',exact:true});await nav.waitFor();
      const admin=nav.getByRole('button',{name:'Administration'});
      if(await admin.count()&&await admin.getAttribute('aria-expanded')!=='true')await admin.click();
      const checks=[];
      for(const group of NAV)for(const item of group.items){
        const expected=(!item.ownerOnly||account.role==='OWNER')&&(item.permission==='authenticated'||me.permissions.includes('*')||me.permissions.includes(item.permission));
        const link=nav.locator(`a[href="${item.href}"]`).filter({hasText:item.label});
        assert.equal(await link.count(),expected?1:0,account.role+' sidebar '+item.label);
        checks.push({href:item.href,label:item.label,visible:expected});
      }
      // Follow a real visible menu link rather than only checking DOM presence.
      await nav.locator(`a[href="${home}"]`).filter({hasText:home==='/logistics'?'Logistics & store':'Dashboard'}).click();
      await page.waitForURL('http://127.0.0.1:3000'+home);
      if(account.role!=='OWNER'){
        await page.goto('http://127.0.0.1:3000/setup',{timeout:180000});
        await page.getByRole('heading',{name:'Access restricted',exact:true}).waitFor();
      }
      const current=await (await context.request.get('http://127.0.0.1:3000/api/auth/me')).json();
      assert.equal((await context.request.post('http://127.0.0.1:3000/api/auth/logout',{headers:{'x-csrf-token':current.csrfToken},data:{}})).status(),200);
      assert.equal((await context.request.get('http://127.0.0.1:3000/api/auth/me')).status(),401);
      results.roles.push({role:account.role,checks,homeLinkWorked:true,ownerSetupDenied:account.role!=='OWNER',logoutInvalidatedSession:true});
      console.log(account.role+': navigation passed');
    } finally {await context.close();}
  }
  results.status='PASS';
} catch(error){
  results.status='FAIL';results.error=accounts.reduce((message,a)=>message.replaceAll(a.password,'[redacted]'),String(error.message)).slice(0,1200);process.exitCode=1;
} finally {
  await browser.close();await fs.writeFile(new URL('navigation.json',output),JSON.stringify(results,null,2));
}
console.log('Navigation acceptance: '+results.status);
