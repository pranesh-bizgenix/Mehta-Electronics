import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {readPriceWorkbook,readPriceCsv} from '../src/modules/pricing/tabular.js';
import {planPriceImport,priceFileHash} from '../src/modules/pricing/import-plan.js';
import {priceWorkbookFixture} from '../test-support/xlsx-fixture.js';
import {samplePath} from '../test-support/client-samples.js';
const mapping={dataStartRow:2,columns:{partCode:0,uom:1,unitPrice:2,minQuantity:3,discountPercent:4,edition:5}};
const item={id:1,part_code:'VERIFY-A',uom:'NOS',status:'ACTIVE',updated_at:'VERIFY-revision_1'};

test('price review preserves exact money and mixed numeric/text editions; sheets and mappings are explicit',()=>{
 const bytes=priceWorkbookFixture([['Part','Unit','List','MOQ','Discount','Edition'],['VERIFY-A','NOS',{value:'99999999999999.123456'},'1','0',{value:'1.20'}],['VERIFY-B','NOS','0.1','1','10','2026-A']]);
 assert.deepEqual(readPriceWorkbook(bytes).sheets,['VERIFY- Prices']);assert.throws(()=>readPriceWorkbook(bytes,'Missing sheet'),{status:422});
 const table=readPriceWorkbook(bytes,'VERIFY- Prices'),plan=planPriceImport(table,mapping,[item,{...item,id:2,part_code:'VERIFY-B'}],{fileSha256:priceFileHash(bytes),metadata:{name:'VERIFY- internal list'}});
 assert.equal(plan.canSave,true);assert.equal(plan.rows[0].unitPrice,'99999999999999.123456');assert.equal(plan.rows[0].edition,'1.20');assert.equal(plan.rows[1].edition,'2026-A');
 assert.throws(()=>planPriceImport(table,{dataStartRow:2},[item]),/Not set: price_import.mapping.partCode/);
 assert.throws(()=>planPriceImport(table,{...mapping,columns:{...mapping.columns,unitPrice:0}},[item]),/one meaning/);
 const changed=planPriceImport(table,mapping,[{...item,updated_at:'VERIFY-revision_2'},{...item,id:2,part_code:'VERIFY-B'}],{fileSha256:priceFileHash(bytes),metadata:{name:'VERIFY- internal list'}});
 assert.notEqual(changed.previewFingerprint,plan.previewFingerprint);
});
test('review shows both duplicate rows, wrong units, missing items, bad decimals, zero MOQ and formulas',()=>{
 const bytes=priceWorkbookFixture([['Part','Unit','Price','MOQ','Discount'],['VERIFY-A','BOX','1.00','1','0'],['VERIFY-A','NOS','1.00','1.000000','0'],['VERIFY-missing','NOS','1e3','0','101'],['VERIFY-A','NOS',{value:'2',formula:'1+1'},'2','0']]);
 const plan=planPriceImport(readPriceWorkbook(bytes,'VERIFY- Prices'),mapping,[item]);
 assert.equal(plan.canSave,false);assert.ok(plan.rows.slice(0,2).every(r=>r.issues.some(i=>i.startsWith('Duplicate'))));assert.ok(plan.rows[0].issues.some(i=>i.startsWith('uom:')));assert.ok(plan.rows[2].issues.length>=4);assert.ok(plan.rows[3].issues.some(i=>i.includes('formula')));
 assert.throws(()=>readPriceCsv('"bad"tail,1'),{status:422});assert.throws(()=>readPriceCsv('"unclosed'),{status:422});
 assert.throws(()=>readPriceWorkbook(Buffer.from('not zip'),'VERIFY- Prices'),{status:422});
});
test('15,000-row CSV and XLSX plans run without database writes or per-row database queries',()=>{
 const rows=[['Part','UOM','Price','MOQ','Discount','Edition']],items=[];
 for(let i=0;i<15000;i++){const code=`VERIFY-${i}`;rows.push([code,'NOS','0.10','1','0',i%2?'Edition A':{value:'2.5'}]);items.push({...item,id:i+1,part_code:code});}
 const bytes=priceWorkbookFixture(rows),xlsx=planPriceImport(readPriceWorkbook(bytes,'VERIFY- Prices'),mapping,items);
 assert.equal(xlsx.rows.length,15000);assert.equal(xlsx.invalidRows,0);
 const csv=rows.map(row=>row.map(v=>typeof v==='object'?v.value:v).join(',')).join('\n');
 const result=planPriceImport(readPriceCsv(csv),mapping,items);assert.equal(result.rows.length,15000);assert.equal(result.invalidRows,0);
 assert.throws(()=>planPriceImport(readPriceCsv(csv+'\nVERIFY-extra,NOS,1,1,0,A'),mapping,items),/15,000/);
});
for(const filename of ['price-levels-01.xlsx','master-pricing-01.xlsx'])test(`private price workbook (${filename}) exposes literal tables for explicit mapping without policy inference`,t=>{
 const file=samplePath('04-price-lists',filename,{testContext:t});if(!file)return;
 const bytes=fs.readFileSync(file),manifest=readPriceWorkbook(bytes);assert.ok(manifest.sheets.length>0,'No source worksheets.');
 let populated=0;for(const sheet of manifest.sheets){const table=readPriceWorkbook(bytes,sheet);assert.ok(table.rows.every(row=>row.cells.every(cell=>!cell||typeof cell.text==='string')),'Every source value must remain text.');populated+=table.rows.length;}
 assert.ok(populated>0,'No source rows extracted.');
});
