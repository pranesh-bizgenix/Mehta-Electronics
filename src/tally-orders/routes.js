import {compareOrders} from './compare.js';
import {orderFlags} from './flags.js';
const fail=(status,message)=>Object.assign(new Error(message),{status});
/** Preview-only API. Does not fetch, persist, or update existing entities. */
export function tallyOrderComparisonRoutes({route,json,readJson,env=process.env}){
  const authorize=user=>{if(!['OWNER','ACCOUNTS'].includes(user?.role))throw fail(403,'Order margin review requires Owner or Accounts access.');};
  return [
    route('GET','/api/tally/order-comparison/status','tally.read',async({res,user})=>{
      authorize(user);json(res,200,{flags:orderFlags(env),mode:'PREVIEW_ONLY',productionWrites:false,liveFetchRegistered:false});
    }),
    route('POST','/api/tally/order-comparison/preview','tally.read',async({req,res,user})=>{
      authorize(user);
      if(!orderFlags(env).comparison)throw fail(409,'Order comparison is disabled pending approval.');
      const body=await readJson(req);
      for(const document of [body.salesOrder,body.purchaseOrder]){
        if(!document||typeof document.companyId!=='string'||!Array.isArray(document.lines)||document.lines.length>200)throw fail(422,'Supply two review documents with company IDs and at most 200 lines each.');
        if(document.lines.some(line=>!line||typeof line!=='object'))throw fail(422,'Invalid order line.');
      }
      try{json(res,200,{data:compareOrders(body.salesOrder,body.purchaseOrder,{mode:body.mode,netExTaxConfirmed:body.netExTaxConfirmed===true}),previewOnly:true});}
      catch(error){throw fail(422,error.message);}
    })
  ];
}
