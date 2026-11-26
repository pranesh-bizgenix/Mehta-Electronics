import test from 'node:test';
import assert from 'node:assert/strict';
import {selectNavigationItem} from '../public/navigation-match.js';
const items=['/operations','/operations?kind=SUPPORT','/operations?kind=WARRANTY','/operations?kind=COLLECTION','/purchasing','/purchasing/sourcing','/tally','/tally/connector'].map(href=>({href}));
for(const kind of ['SUPPORT','WARRANTY','COLLECTION'])test('Navigation selects the exact '+kind+' workflow',()=>assert.equal(selectNavigationItem(items,'/operations','?kind='+kind+'&open=record').href,'/operations?kind='+kind));
test('Unknown workflow query retains the base destination',()=>assert.equal(selectNavigationItem(items,'/operations','?kind=UNKNOWN').href,'/operations'));
test('Child routes prefer their specific destination',()=>assert.equal(selectNavigationItem(items,'/purchasing/sourcing').href,'/purchasing/sourcing'));
test('Tally connector selects one destination without changing its route',()=>assert.equal(selectNavigationItem(items,'/tally/connector').href,'/tally/connector'));
test('Similar prefixes and external URLs cannot become active',()=>{assert.equal(selectNavigationItem(items,'/purchasing-other'),undefined);assert.equal(selectNavigationItem([{href:'https://external.invalid/operations'}],'/operations'),undefined);});
