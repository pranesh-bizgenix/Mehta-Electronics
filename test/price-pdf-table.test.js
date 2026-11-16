import assert from 'node:assert/strict';
import {test} from 'node:test';
import {extractPricePdf,pdfLayoutTable} from '../src/modules/pricing/pdf-table.js';
import {planPriceImport,priceFileHash} from '../src/modules/pricing/import-plan.js';
import {pricePdfFixture} from '../test-support/price-pdf-fixture.js';
test('PDF table boundaries and repeated-header exclusions are explicit and fingerprinted',()=>{
 const layout={pages:2,rows:[{number:1,page:1,text:'PART      UOM PRICE'},{number:2,page:1,text:'ZZTEST_A  NOS 0.123456'},{number:3,page:2,text:'PART      UOM PRICE'},{number:4,page:2,text:'ZZTEST_B  NOS 9.876543'}]};
 const ranges=[{start:0,end:10},{start:10,end:14},{start:14,end:30}],items=['ZZTEST_A','ZZTEST_B'].map((part_code,id)=>({id:id+1,part_code,uom:'NOS',status:'ACTIVE',updated_at:'ZZTEST_revision'}));
 assert.equal(pdfLayoutTable(layout).unmapped,true);
 assert.throws(()=>pdfLayoutTable(layout,[{start:10,end:10}]),{status:422});assert.throws(()=>pdfLayoutTable(layout,[{start:0,end:15},{start:10,end:20}]),{status:422});
 const table=pdfLayoutTable(layout,ranges),mapping={dataStartRow:2,excludeRows:[3],pdfColumns:ranges,columns:{partCode:0,uom:1,unitPrice:2},constants:{minQuantity:'1',discountPercent:'0'}};
 const plan=planPriceImport(table,mapping,items);assert.equal(plan.canSave,true);assert.equal(plan.rows.length,2);assert.equal(plan.rows[0].unitPrice,'0.123456');assert.equal(plan.rows[1].sourceRow,4);
 assert.notEqual(plan.previewFingerprint,planPriceImport(table,{...mapping,excludeRows:[]},items).previewFingerprint);
 assert.throws(()=>planPriceImport(table,{...mapping,excludeRows:[3,3]},items),{status:422});
});
test('offline PDF extraction reads literal synthetic text and rejects malformed or image-only input',async()=>{
 const bytes=await pricePdfFixture(),layout=await extractPricePdf(bytes);
 assert.equal(layout.pages,1);assert.ok(layout.rows.some(r=>r.text.includes('ZZTEST_PDF')));assert.ok(layout.rows.some(r=>r.text.includes('123.456789')));assert.equal(priceFileHash(bytes).length,64);
 await assert.rejects(()=>extractPricePdf(Buffer.from('not a PDF')),{status:422});
 await assert.rejects(()=>extractPricePdf(Buffer.from('%PDF-damaged')),{status:422});
 const empty=await pricePdfFixture([]);await assert.rejects(()=>extractPricePdf(empty),/no readable table text/);
 const running=[extractPricePdf(bytes),extractPricePdf(bytes)];
 await assert.rejects(()=>extractPricePdf(bytes),{code:'PDF_EXTRACTOR_BUSY'});await Promise.all(running);
});
test('15,000 PDF price rows extract and validate without database writes or invented column mappings',async()=>{
 const lines=[],items=[];for(let i=0;i<15000;i++){const code=`ZZTEST_${String(i).padStart(5,'0')}`;lines.push(code.padEnd(20)+'NOS'.padEnd(10)+'0.123456');items.push({id:i+1,part_code:code,uom:'NOS',status:'ACTIVE',updated_at:'ZZTEST_revision'});}
 const layout=await extractPricePdf(await pricePdfFixture(lines)),first=layout.rows.find(r=>r.text.includes('ZZTEST_00000'));
 assert.ok(first);const unit=first.text.indexOf('NOS'),price=first.text.indexOf('0.123456'),pdfColumns=[{start:0,end:unit},{start:unit,end:price},{start:price,end:price+8}];
 const plan=planPriceImport(pdfLayoutTable(layout,pdfColumns),{dataStartRow:1,pdfColumns,columns:{partCode:0,uom:1,unitPrice:2},constants:{minQuantity:'1',discountPercent:'0'}},items);
 assert.equal(plan.rows.length,15000);assert.equal(plan.invalidRows,0);assert.equal(plan.rows[14999].unitPrice,'0.123456');
});
