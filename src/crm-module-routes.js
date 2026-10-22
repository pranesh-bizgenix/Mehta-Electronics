import { hasPermission } from './rbac.js';
import { enquiryView } from './db.js';
import { listRecords,customerDetail,saveCustomer,savePartMapping,customerHistory,itemDetail,saveItem,priceLists,priceListDetail,savePriceList,saveEnquiry,changeEnquiryStatus,id } from './crm-modules.js';
export function crmModuleRoutes({db,config,route,json,readJson}) {
  const financial=user=>config.tallyFinancialRoles.includes(user.role);
  const save=(fn,created=false)=>async({req,res,params,user})=>{
    const body=await readJson(req);
    if(!body||typeof body!=='object'||Array.isArray(body))throw Object.assign(new Error('Provide a JSON object.'),{status:422});
    json(res,created?201:200,{data:await fn(params,body,user)});
  };
  return [
    ...['customers','items','enquiries'].map(kind=>route('GET',`/api/crm/${kind}`,`${kind}.read`,async({res,url})=>json(res,200,await listRecords(db,kind,url)))),
    route('GET','/api/crm/customers/:id','customers.read',async({res,params,user})=>json(res,200,{data:await customerDetail(db,params.id,{financial:financial(user)})})),
    route('POST','/api/crm/customers','customers.create',save((p,b,u)=>saveCustomer(db,null,b,u),true)),
    route('PATCH','/api/crm/customers/:id','customers.update',save((p,b,u)=>saveCustomer(db,p.id,b,u))),
    route('GET','/api/crm/customers/:id/history/:tab','customers.read',async({res,params,user})=>{
      const permission={enquiries:'enquiries.read',quotes:'quotations.read',orders:'orders.read',invoices:'customers.read',dues:'customers.read'}[params.tab];
      if(!permission||!hasPermission(user,permission))throw Object.assign(new Error('History access denied.'),{status:403});
      json(res,200,await customerHistory(db,params.id,params.tab,{financial:financial(user)}));
    }),
    route('POST','/api/crm/customers/:id/part-mappings','customers.update',save((p,b,u)=>savePartMapping(db,p.id,null,b,u),true)),
    route('PATCH','/api/crm/customers/:id/part-mappings/:mapping','customers.update',save((p,b,u)=>savePartMapping(db,p.id,p.mapping,b,u))),
    route('GET','/api/crm/items/:id','items.read',async({res,params,user})=>json(res,200,{data:await itemDetail(db,params.id,{financial:financial(user)})})),
    route('POST','/api/crm/items','items.create',save((p,b,u)=>saveItem(db,null,b,u),true)),
    route('PATCH','/api/crm/items/:id','items.update',save((p,b,u)=>saveItem(db,p.id,b,u))),
    route('GET','/api/crm/price-lists','items.read',async({res})=>json(res,200,{data:await priceLists(db)})),
    route('GET','/api/crm/price-lists/:id','items.read',async({res,params})=>json(res,200,{data:await priceListDetail(db,params.id)})),
    route('POST','/api/crm/price-lists','items.update',save((p,b,u)=>savePriceList(db,null,b,u),true)),
    route('PATCH','/api/crm/price-lists/:id','items.update',save((p,b,u)=>savePriceList(db,p.id,b,u))),
    route('GET','/api/crm/enquiries/:id','enquiries.read',async({res,params})=>{const data=await enquiryView(db,id(params.id));if(!data)throw Object.assign(new Error('Enquiry not found.'),{status:404});json(res,200,{data});}),
    route('POST','/api/crm/enquiries','enquiries.create',save((p,b,u)=>saveEnquiry(db,null,b,u),true)),
    route('PUT','/api/crm/enquiries/:id','enquiries.update',save((p,b,u)=>saveEnquiry(db,p.id,b,u))),
    route('PATCH','/api/crm/enquiries/:id/status','enquiries.update',save((p,b,u)=>changeEnquiryStatus(db,p.id,b,u))),
    route('GET','/api/crm/owners','authenticated',async({res,user})=>{
      if(!hasPermission(user,'enquiries.read')&&!hasPermission(user,'customers.read'))throw Object.assign(new Error('Permission denied.'),{status:403});
      json(res,200,{data:await db.prepare("SELECT id,name FROM users WHERE status='ACTIVE' ORDER BY name").all()});
    })
  ];
}
