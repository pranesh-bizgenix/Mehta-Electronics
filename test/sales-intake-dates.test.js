import {test} from 'node:test';
import assert from 'node:assert/strict';
import {quotationValidityDate} from '../src/modules/sales-intake/policy.js';

const cases=[
 ['2026-11-21T18:29:59Z',1,'2026-11-22'],
 ['2026-11-21T18:30:00Z',1,'2026-11-23'],
 ['2026-11-21T23:59:59Z',30,'2026-12-22'],
 ['2026-01-31T18:30:00Z',1,'2026-02-02'],
 ['2028-02-28T18:30:00Z',1,'2028-03-01'],
 ['2028-02-27T18:30:00Z',1,'2028-02-29'],
 ['2026-12-31T18:30:00Z',1,'2027-01-02'],
 ['2026-03-31T18:30:00Z',30,'2026-05-01'],
 ['2026-04-01T00:00:00Z',30,'2026-05-01'],
 ['2026-11-22T04:00:00Z',366,'2027-11-23']
];
for(const [now,days,expected]of cases)test(`quotation validity uses India business date: ${now} + ${days} days`,()=>assert.equal(quotationValidityDate(new Date(now),days),expected));
