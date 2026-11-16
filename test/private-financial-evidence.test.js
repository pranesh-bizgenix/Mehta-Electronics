import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {samplePath} from '../test-support/client-samples.js';
import {financialEvidence,withinDocumentTolerance} from '../src/modules/documents/financial-evidence.js';

const extractor=fileURLToPath(new URL('../test-support/read-pdf-financial-evidence.py',import.meta.url));
function read(t,folder,name){
 const file=samplePath(folder,name,{testContext:t});if(!file)return null;
 const result=spawnSync('python',[extractor,file],{encoding:'utf8',maxBuffer:24*1024*1024,windowsHide:true,timeout:30000});
 if(result.error?.code==='ENOENT'||result.status===77){t.skip('Optional private-document checks require Python and pypdf; no sample values were substituted.');return null;}
 assert.ok(result.status===0,'Private financial extraction failed; inspect the source privately. Contents are not logged.');
 try{return JSON.parse(result.stdout);}catch{assert.fail('Private financial extractor returned invalid evidence; document contents are not logged.');}
}
function cleanLines(report){assert.ok(report.lines.length>0,'No financial rows covered.');assert.ok(report.lines.every(l=>l.netMatches),'A source line net differs from exact quantity/rate/discount arithmetic.');}

test('private Johnson PO: all 15 financial rows compare exact base and printed tax components; differences remain reviewable',t=>{
 const evidence=read(t,'01-customer-pos','johnson-po-reference-01.pdf');if(!evidence)return;
 const result=financialEvidence('JOHNSON_PO_V1',evidence);cleanLines(result);assert.ok(result.lines.length===15,'The reviewed financial layout must cover every item.');
 assert.ok(result.lines.every(l=>withinDocumentTolerance(l.totalDifference,'1.00')),'A printed line total exceeds the user-specified one-rupee PO validation tolerance.');
 assert.ok(result.reviewRequired,'Printed rounding differences must remain visible rather than becoming a business default.');assert.ok(result.documentTotal===null,'Do not invent a missing document grand total.');
});
for(const name of ['purchase-order-reference-02.pdf','purchase-order-reference-03.pdf'])test(`private KONE PO (${name}): exact net and printed split tax; missing tax/HSN stay flagged`,t=>{
 const evidence=read(t,'01-customer-pos',name);if(!evidence)return;
 const result=financialEvidence('KONE_PO_V1',evidence);cleanLines(result);
 assert.ok(result.lines.every(l=>l.taxes.length?l.taxes.every(tax=>tax.matches)&&l.totalDifference==='0.00':l.sourceGaps.includes('TAX_NOT_PRINTED')&&l.computedTotal===null&&l.totalDifference===null),'Printed KONE line/tax evidence differs or an omission was silently filled.');
});
test('private Connectwell AO: exact rate-times-quantity net, declared net plus printed tax total',t=>{
 const evidence=read(t,'06-supplier-documents','connectwell-ao-reference-01.pdf');if(!evidence)return;
 const result=financialEvidence('CONNECTWELL_AO_V1',evidence);cleanLines(result);
 assert.ok(result.lines.length===15,'Every reviewed acceptance item must be covered.');assert.ok(result.netDifference==='0.00'&&result.totalDifference==='0.00','Printed acceptance totals do not reconcile.');
});
test('private HCE OA: exact item amounts, printed packing, IGST and signed round-off reconcile',t=>{
 const evidence=read(t,'06-supplier-documents','hce-oa-reference-01.pdf');if(!evidence)return;
 const result=financialEvidence('HCE_OA_V1',evidence);cleanLines(result);
 assert.ok(result.lines.length===3,'Every reviewed acceptance item must be covered.');assert.ok(result.packingMatches&&result.baseDifference==='0.00'&&result.taxDifference==='0.00'&&result.totalDifference==='0.00','Printed packing/tax/round-off evidence does not reconcile.');
});
test('private DK PO PDF attachment: explicit list/discount net, split tax and signed adjustment reconcile',t=>{
 const evidence=read(t,'02-customer-emails','po-email-02.eml');if(!evidence)return;
 const result=financialEvidence('DK_PO_V1',evidence);cleanLines(result);
 assert.ok(result.netDifference==='0.00'&&result.taxMatches&&result.totalDifference==='0.00','Printed PO totals do not reconcile.');
});
