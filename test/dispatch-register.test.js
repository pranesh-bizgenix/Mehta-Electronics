import test from 'node:test';
import assert from 'node:assert/strict';
import {shipmentFilters,shipmentRegister} from '../src/modules/dispatch/routes.js';
test('Manual tracking permits only recorded shipment states and bounded filters',()=>{assert.deepEqual(shipmentFilters(new URLSearchParams()),{page:1,search:'',status:''});for(const q of ['page=0','page=1.5','status=CONNECTED','status=IN_TRANSIT','search='+ 'x'.repeat(201)])assert.throws(()=>shipmentFilters(new URLSearchParams(q)),{status:422});});
test('Shipment register rejects absent permissions before reading records',()=>assert.rejects(shipmentRegister({prepare(){throw Error('Must not query');}},{role:'UNKNOWN'},new URLSearchParams()),{status:403}));
