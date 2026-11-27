import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {MaterialService} from '../src/modules/materials/service.js';
const service=new MaterialService({db:{},operations:null}),actor={id:1,role:'OWNER'};
const body=data=>({requestKey:randomUUID(),version:1,action:'INSPECT',reason:'SAMPLE validation only',data:{accepted:'1',rejected:'0',fault:'TECHNICAL_FAULT',evidence:'SAMPLE inspection',...data}});
test('Future inspection visits are rejected before database access',async()=>{await assert.rejects(service.act(actor,randomUUID(),body({visitDate:'2999-01-01'})),{status:422});});
test('A named engineer requires their type and actual visit date',async()=>{await assert.rejects(service.act(actor,randomUUID(),body({engineerName:'SAMPLE engineer'})),{status:422});});
test('Unsupported inspection fields are rejected rather than silently saved',async()=>{await assert.rejects(service.act(actor,randomUUID(),body({approveAutomatically:true})),{status:422});});
test('Unauthorised staff cannot start a material action',async()=>{await assert.rejects(service.act({id:2,role:'NO_ACCESS'},randomUUID(),body({})),{status:403});});

test('Invalid evidence controls are rejected before database writes',async()=>{await assert.rejects(service.act(actor,randomUUID(),body({evidence:'SAMPLE\u0000invalid'})),{status:422});});
