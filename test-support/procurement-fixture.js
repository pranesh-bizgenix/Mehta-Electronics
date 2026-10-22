import {salesOrderFixture,sampleOriginal} from './sales-order-fixture.js';
import {saveOrder,uploadOriginal,orderAction} from '../src/sales-orders.js';
export async function procurementFixture(){const f=await salesOrderFixture();let order=await saveOrder(f.db,null,f.body,f.executive);
 await uploadOriginal(f.db,order.id,{name:'customer.pdf',base64:sampleOriginal.toString('base64'),version:order.version,reason:'Retain customer PO'},f.executive);
 order=await orderAction(f.db,order.id,{action:'VERIFY',version:2,reason:'Verify customer commitment'},f.executive);
 order=await orderAction(f.db,order.id,{action:'APPROVE',version:2,reason:'Independent customer order review'},f.manager);
 return {...f,order};
}
