import fs from 'node:fs';import assert from 'node:assert/strict';import {chromium} from 'playwright';
const out='verification-output/purchase-documents/2026-11-18',credentials=fs.readFileSync('verification-output/role-access/credentials.md','utf8').split('\n').find(l=>l.startsWith('| OWNER |')).split('|').map(s=>s.trim());
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000},colorScheme:'dark'}),page=await context.newPage();page.setDefaultTimeout(60000);
const policy={create:'purchasing.write',approve:'purchasing.approve',download:'purchasing.read',send:'purchasing.write',prefix:'DEMO',allowDraftDownload:false},settings={version:1,value:{name:'DEMO UI fixture only',documents:{RFQ:policy,PO:policy}}},records=[];let sequence=0;const checks=[];
try{
 await context.route('**/api/crm/purchase-documents**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname,body=req.method()==='GET'?{}:req.postDataJSON();let data,status=200;
  if(path.endsWith('/settings'))data=settings;
  else if(path.endsWith('/vendors'))data=[{id:99999,payload:{name:'DEMO Supplier - UI fixture',address:'DEMO address',gstin:'DEMO'}}];
  else if(path.endsWith('/permissions'))data=['purchasing.write','purchasing.approve','purchasing.read'].map(key=>({key,description:key}));
  else if(req.method()==='GET'&&!/\d+$/.test(path)){data=records.filter(r=>r.kind===url.searchParams.get('kind'));return route.fulfill({json:{data,pagination:{page:1,pageSize:25,total:data.length,pages:Math.ceil(data.length/25)}}});}
  else if(req.method()==='POST'&&path.endsWith('/purchase-documents')){data={id:++sequence,kind:body.kind,number:`DEMO-${body.kind}/${sequence}`,status:'DRAFT',version:1,created_by:999999,payload:{...body,supplier:{name:'DEMO Supplier - UI fixture'},totals:body.kind==='PO'?{total:'94.40'}:undefined}};records.push(data);}
  else{const r=records.find(r=>r.id===Number(path.split('/').find(s=>/^\d+$/.test(s))));assert.ok(r);
   if(path.endsWith('/actions')){r.status={SUBMIT:'PENDING_APPROVAL',APPROVE:'APPROVED',MARK_SENT:'SENT',RETURN:'DRAFT',CANCEL:'CANCELLED'}[body.action];r.version++;data=r;}
   else if(path.endsWith('/pdf')){if(r.status==='DRAFT')return route.fulfill({status:409,json:{error:'Draft downloads are disabled by default.'}});return route.fulfill({status:200,contentType:'application/pdf',body:fs.readFileSync(`${out}/${r.kind==='RFQ'?'sample-vendor-rfq.pdf':'sample-supplier-po-33.pdf'}`)});}
   else data=r;
  }await route.fulfill({status,json:{data}});
 });
 await page.goto('http://127.0.0.1:3000/login?next=/purchasing/rfqs');await page.getByLabel(/^Email/).fill(credentials[2]);await page.getByLabel(/^Password/).fill(credentials[3]);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(u=>u.pathname==='/purchasing/rfqs');
 for(const kind of ['RFQ','PO']){console.log('Checking browser form:',kind);
  await page.goto(`http://127.0.0.1:3000/purchasing/${kind==='RFQ'?'rfqs':'purchase-orders'}`);await page.getByRole('button',{name:`New ${kind}`,exact:true}).click();let dialog=page.getByRole('dialog',{name:`New ${kind} draft`,exact:true});
  await dialog.getByRole('combobox',{name:'Supplier',exact:true}).selectOption('99999');await dialog.getByRole('textbox',{name:'Find supplier',exact:true}).fill('DEMO');await dialog.getByLabel('Document date').fill('2026-11-18');
  if(kind==='RFQ')await dialog.getByLabel('Response deadline').fill('2026-11-25');else{await dialog.getByLabel('Delivery date').fill('2026-11-30');for(const label of ['Bill-to address','Ship-to address','Payment terms','Freight / packing','Signatory name / designation'])await dialog.getByLabel(label).fill('DEMO UI fixture');}
  for(const [label,value]of [['Item code','DEMO-ITEM'],['Description','DEMO UI component'],['Make','DEMO MAKE'],['Quantity','2'],['Unit of measure','NOS'],...(kind==='PO'?[['HSN','00000000'],['List unit price INR','100'],['Discount %','60'],['GST %','18']]:[])])await dialog.getByLabel(label).fill(value);
  await dialog.getByLabel('Save reason').fill('DEMO UI fixture only - intercepted request');await dialog.getByRole('button',{name:'Save draft',exact:true}).click();console.log('Browser draft saved:',kind);
  dialog=page.getByRole('dialog',{name:`DEMO-${kind}/${sequence}`,exact:true});await dialog.getByLabel('Action / PDF reason').fill('DEMO UI action');assert.equal(await dialog.getByRole('button',{name:'Download PDF',exact:true}).isDisabled(),true);await dialog.getByText(/PDF access requires approval/).waitFor();
  await dialog.getByRole('button',{name:'Submit for approval',exact:true}).click();await dialog.getByRole('button',{name:'Approve',exact:true}).click();await dialog.getByText(/APPROVED/).waitFor();
  const download=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download PDF',exact:true}).click();const d=await download;assert.ok(d.suggestedFilename().endsWith('.pdf'));
  await dialog.getByRole('button',{name:'Preview PDF',exact:true}).click();await page.getByRole('dialog',{name:'PDF preview',exact:true}).getByTitle('Purchasing document PDF').waitFor();await page.keyboard.press('Escape');
  await page.screenshot({path:`${out}/ui-${kind}-desktop.png`});await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:`${out}/ui-${kind}-mobile.png`});await page.keyboard.press('Escape');await page.setViewportSize({width:1440,height:1000});checks.push({kind,create:true,draftBlocked:true,submit:true,approvalUi:true,pdfDownload:true,preview:true,mobileNoOverflow:true});
 }
 fs.writeFileSync(out+'/ui-verification.json',JSON.stringify({at:new Date().toISOString(),status:'PASS',checks,scope:'Actual browser components with intercepted purchasing document API responses; separate RDS API verification establishes backend behavior. No business writes.'},null,2));console.log('PASS: RFQ and PO browser forms, lifecycle, PDF download/preview and mobile layout.');
}catch(e){if(!page.url().includes('/login'))await page.screenshot({path:out+'/ui-failure.png'}).catch(()=>{});console.error('Purchase document UI check failed:',e.name,e.message?.slice(0,400));process.exitCode=1;}
finally{try{const r=await context.request.get('http://127.0.0.1:3000/api/auth/me');if(r.ok()){const m=await r.json();await context.request.post('http://127.0.0.1:3000/api/auth/logout',{headers:{'x-csrf-token':m.csrfToken},data:{}});}}catch{}await browser.close();}
