import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBaseCatalog,baseCatalogPage} from '../src/modules/pricing/base-catalog.js';
import {priceImportRoutes} from '../src/modules/pricing/controller.js';
const row=(number,code,price,formula=false)=>({number,cells:[{text:code},{text:'Component'},{text:price,formula},null,null,null,null,{text:''},{text:'Original edition'}]});
const build=rows=>buildBaseCatalog({sheet:'master price',rows},'fixture-sha');
test('master source displays the exact price without applying level discounts or inventing a unit',()=>{
 const c=build([row(2,'A','123.4567')]);assert.equal(c.rows[0].unitPrice,'123.4567');assert.equal(c.rows[0].uom,null);assert.equal(c.referenceOnly,true);
 assert.throws(()=>buildBaseCatalog({sheet:'level 1',rows:[]},''));
});
for(const [name,price,formula] of [['zero','0',false],['negative','-1',false],['text','on request',false],['blank','',false],['formula','123',true]])test(`withholds ${name} prices`,()=>assert.equal(build([row(2,'A',price,formula)]).rows[0].unitPrice,null));
test('duplicate codes withhold both source prices',()=>{const c=build([row(2,'A','10'),row(3,'A','20')]);assert.ok(c.rows.every(r=>r.unitPrice===null&&r.issues.includes('Duplicate article code')));});
test('search and bounded pagination retain source rows and hide the full catalog',()=>{const c=build(Array.from({length:30},(_,i)=>row(i+2,`A${i}`,'1')));const p=baseCatalogPage(new URLSearchParams('page=2'),c);assert.equal(p.data.length,5);assert.equal(p.pagination.total,30);assert.equal(p.source.rows,undefined);assert.equal(baseCatalogPage(new URLSearchParams('search=A29'),c).data.length,1);assert.throws(()=>baseCatalogPage(new URLSearchParams('page=-1'),c));});
test('catalog endpoint uses internal-price permission and additionally requires item access',async()=>{
 const routes=priceImportRoutes({db:{},route:(method,path,permission,handler)=>({method,path,permission,handler}),json:()=>{},readJson:()=>{}});
 const route=routes.find(r=>r.path==='/api/crm/base-price-catalog');assert.equal(route.method,'GET');assert.equal(route.permission,'items.list_price.read');
 await assert.rejects(route.handler({user:{id:5,role:'UNRECOGNISED'},url:new URL('http://localhost/?page=1'),res:{}}),e=>e.status===403);
});
