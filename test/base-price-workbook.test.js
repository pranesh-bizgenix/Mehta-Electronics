import test from 'node:test';
import assert from 'node:assert/strict';
import {levelWorkbookPreset,LEVEL_WORKBOOK_HEADERS} from '../src/modules/pricing/workbook-preset.js';
import {readPriceCsv} from '../src/modules/pricing/tabular.js';
import {planPriceImport} from '../src/modules/pricing/import-plan.js';

test('Master price preview explicitly uses the base rate without inheriting a level discount',()=>{
 const table=readPriceCsv('Code,Description,Price,MOQ,Link,Brand,Pack,UOM,Edition,Discount\nSAMPLE-1,Component,100,1,,,1,NOS,Edition,0.63'),mapping=levelWorkbookPreset(LEVEL_WORKBOOK_HEADERS,'master price');
 const plan=planPriceImport(table,mapping,[{id:1,part_code:'SAMPLE-1',uom:'NOS',status:'ACTIVE',updated_at:'version1'}]);assert.equal(plan.canSave,true);assert.equal(plan.rows[0].unitPrice,'100');assert.equal(plan.rows[0].discountPercent,'0.000000');assert.equal(plan.rows[0].level,'');
});
