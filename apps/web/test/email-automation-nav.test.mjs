import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';

async function navigation(variant) {
 // Use the actual config and navigation source with Node's native type stripping.
 // Next resolves extensionless TS imports; Node's test loader does not.
 const config=fs.readFileSync(new URL('../features/email-automation/config.ts',import.meta.url),'utf8');
 const nav=fs.readFileSync(new URL('../components/shell/nav-config.ts',import.meta.url),'utf8').replace(/^import \{emailAutomationEnabled\}.*;\r?$/m,'');
 const code=stripTypeScriptTypes(config+'\n'+nav);
 return (await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64')+'#'+variant)).NAV;
}

test('module navigation is absent by default and adds one permission-based collapsible group only when enabled',async()=>{
 const previous=process.env.NEXT_PUBLIC_EMAIL_AUTOMATION_ENABLED;
 try {
  delete process.env.NEXT_PUBLIC_EMAIL_AUTOMATION_ENABLED;
  const off=await navigation('off');
  assert.ok(!off.some(g=>g.label==='EMAIL AUTOMATION'));
  process.env.NEXT_PUBLIC_EMAIL_AUTOMATION_ENABLED='true';
  const on=await navigation('on');
  const group=on.find(g=>g.label==='EMAIL AUTOMATION');assert.ok(group?.collapsible);assert.equal(group.items.length,6);
  assert.deepEqual(on.filter(g=>g.label!=='EMAIL AUTOMATION'),off,'Existing navigation and Administration are unchanged');
  for(const item of group.items){assert.match(item.href,/^\/email-automation\//);assert.match(item.permission,/^email_automation\./);assert.equal(item.ownerOnly,undefined);}
 }finally{if(previous===undefined)delete process.env.NEXT_PUBLIC_EMAIL_AUTOMATION_ENABLED;else process.env.NEXT_PUBLIC_EMAIL_AUTOMATION_ENABLED=previous;}
});
