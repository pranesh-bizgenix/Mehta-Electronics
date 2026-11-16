import assert from 'node:assert/strict';
import {test} from 'node:test';
import {financialEvidence,withinDocumentTolerance} from '../src/modules/documents/financial-evidence.js';

test('financial evidence retains explicit split tax and detects changed printed line totals without changing arithmetic',()=>{
 const plain='Item Material\n00010 ZZTEST_PART 0000 01.01.2026 2 PC 5.00 / 10.00\nDescription 1 PC\nCGST 9.00% 0.90\nSGST 9.00% 0.90\nTotal Amount with Tax 11.80';
 const result=financialEvidence('KONE_PO_V1',{plain});assert.equal(result.lines.length,1);assert.equal(result.lines[0].netMatches,true);assert.equal(result.lines[0].totalDifference,'0.00');assert.ok(result.lines[0].taxes.every(t=>t.matches));
 const changed=financialEvidence('KONE_PO_V1',{plain:plain.replace('Tax 11.80','Tax 12.00')});assert.equal(changed.lines[0].totalDifference,'0.20');
 assert.equal(withinDocumentTolerance('-0.20','1.00'),true);assert.equal(withinDocumentTolerance('1.01','1.00'),false);
 assert.throws(()=>financialEvidence('KONE_PO_V1',{plain:plain.replace('Description 1 PC','Description 100 PC')}),/unit conversion/);
 const absent=financialEvidence('KONE_PO_V1',{plain:plain.replace('0000 01.01.2026','01.01.2026').replace('CGST 9.00% 0.90\nSGST 9.00% 0.90\n','')});
 assert.deepEqual(absent.lines[0].sourceGaps,['TAX_NOT_PRINTED','HSN_NOT_PRINTED']);assert.equal(absent.lines[0].computedTotal,null);
 assert.equal(absent.reviewRequired,true);
});

test('document evidence refuses unknown layouts, missing financial fields, excessive input and fabricated tax components',()=>{
 assert.throws(()=>financialEvidence('UNCONFIRMED_LAYOUT',{}),/explicitly supported/);
 assert.throws(()=>financialEvidence('HCE_OA_V1',{plain:'ORDER ACCEPTANCE FORM Pkg. Chrgs.'}),/missing/);
 assert.throws(()=>financialEvidence('KONE_PO_V1',{plain:'Item Material Total Amount with Tax'}),/row was not extracted/);
 assert.throws(()=>financialEvidence('KONE_PO_V1',{plain:'x'.repeat(12*1024*1024+1)}),/excessive/);
});
