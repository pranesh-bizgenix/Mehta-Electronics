import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

// Offline browser check: intercept every request; never contact the CRM or mail.
const output='verification-output/quotation-format';
const html=await readFile(`${output}/sample-quotation-cgst-sgst.html`);
const longHtml=await readFile(`${output}/sample-quotation-long.html`);
const css=await readFile('public/quotation-print.css');
const logo=await readFile('public/brand/mehta-logo.png');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1200,height:900}}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin!=='https://quotation-preview.test')return route.abort();
  const value=url.pathname==='/'?[html,'text/html']:url.pathname==='/long'?[longHtml,'text/html']:url.pathname==='/quotation-print.css'?[css,'text/css']:url.pathname==='/brand/mehta-logo.png'?[logo,'image/png']:url.pathname==='/quotation-print.js'?[Buffer.from("document.getElementById('print').addEventListener('click',()=>window.print());"),'text/javascript']:null;
  return value?route.fulfill({status:200,body:value[0],contentType:value[1]}):route.abort();
 });
 await page.goto('https://quotation-preview.test/');await page.locator('.company-logo').first().waitFor();await page.evaluate(()=>document.fonts.ready);
 assert.equal(await page.locator('article.sheet').count(),3);assert.equal(await page.locator('.company-logo').count(),3);
 assert.equal(await page.locator('.company-logo').first().evaluate(image=>image.complete&&image.naturalWidth>0),true);
 await page.pdf({path:`${output}/sample-quotation-browser-print.pdf`,format:'A4',printBackground:true,preferCSSPageSize:true});
 await page.screenshot({path:`${output}/quotation-print-desktop.png`,fullPage:true});
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'Mobile print preview must not scroll horizontally.');
 await page.screenshot({path:`${output}/quotation-print-mobile.png`,fullPage:true});
 await page.setViewportSize({width:1200,height:900});await page.goto('https://quotation-preview.test/long');await page.evaluate(()=>document.fonts.ready);
 await page.pdf({path:`${output}/sample-quotation-browser-print-long.pdf`,format:'A4',printBackground:true,preferCSSPageSize:true});
 assert.deepEqual(errors,[]);await writeFile(`${output}/browser-verification.json`,JSON.stringify({status:'PASS',sections:3,logos:3,desktop:true,mobile:true,pageErrors:errors},null,2));
 console.log('PASS: three print sections, all logos, desktop/mobile layout and browser PDF export; no database/network changes.');
}finally{await browser.close();}
