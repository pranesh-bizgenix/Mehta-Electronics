import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {auditPageStates} from '../scripts/audit-page-states.mjs';
test('page audit covers actual routes, reports missing evidence and does not claim runtime verification',()=>{
 const rows=auditPageStates();assert.ok(rows.length>=31);assert.ok(rows.some(row=>row.page.endsWith('/tally/monitor/page.tsx')));assert.ok(rows.some(row=>row.page.endsWith('/logistics/page.tsx')));
 assert.ok(rows.every(row=>Object.keys(row.checks).length===6&&row.sharedReview.length===2));
 assert.ok(rows.every(row=>JSON.stringify(row.missing)===JSON.stringify(Object.entries(row.checks).filter(([,present])=>!present).map(([key])=>key))),'Missing states must be derived from evidence rather than hardcoded away.');
 const monitor=rows.find(row=>row.page.endsWith('/tally/monitor/page.tsx'));assert.deepEqual(monitor.missing,[]);
 const feedback=fs.readFileSync(new URL('../apps/web/components/ds/feedback.tsx',import.meta.url),'utf8');assert.match(feedback,/error\.isUnauthorized/);assert.match(feedback,/error\.isForbidden/);assert.match(feedback,/\[409,422\]/);assert.match(feedback,/error\.fields/);
});
