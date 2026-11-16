import assert from 'node:assert/strict';
import {test} from 'node:test';
import {marginFlag} from '../public/quotation-margin.js';

test('margin display compares exact decimals and never infers an unconfirmed floor',()=>{
 assert.equal(marginFlag('20.000000000001','20.000000000002'),'red');
 assert.equal(marginFlag('20.000000000002','20.000000000002'),'green');
 assert.equal(marginFlag('-0.000000000001',undefined),'red');
 assert.equal(marginFlag('0',undefined),'blue');
 for(const floor of [undefined,null,''])assert.equal(marginFlag('20',floor),null);
 assert.equal(marginFlag(null,'20'),null);assert.equal(marginFlag('NaN','20'),null);
});
