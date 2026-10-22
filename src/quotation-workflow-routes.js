import {quotePolicy,saveQuotePolicy,quoteCost,saveQuoteCost,quoteList,quoteDetail,saveQuote,quoteAction,quoteHistory,duplicateQuote,pricingHistory,quoteForDocument,quotationEnquiry} from './quotation-workflow.js';
import {quotationPdf,quotationPrintHtml} from './quotation-document.js';
export function quotationWorkflowRoutes({db,route,json,readJson}){
 const save=(fn,code=200)=>async({req,res,params,user})=>{const b=await readJson(req);if(!b||Array.isArray(b)||typeof b!=='object')throw Object.assign(new Error('Provide a JSON object.'),{status:422});json(res,code,{data:await fn(params,b,user)});};
 return [
 route('GET','/api/crm/quotation-enquiries/:id','quotations.create',async({res,params,user})=>json(res,200,{data:await quotationEnquiry(db,params.id,user)})),
 route('GET','/api/crm/quotation-policy','quotations.read',async({res,user})=>{const p=await quotePolicy(db);json(res,200,{data:p?{seller_state:p.seller_state,letterhead:p.letterhead,revision:p.revision,...(['OWNER','MANAGER'].includes(user.role)?{floor_percent:p.floor_percent,margin_basis:p.margin_basis}:{})}:null});}),
 route('PUT','/api/crm/quotation-policy','quotations.policy.manage',save((p,b,u)=>saveQuotePolicy(db,b,u))),
 route('GET','/api/crm/quotation-policy/history','quotations.cost.read',async({res,user})=>json(res,200,{data:await pricingHistory(db,null,user)})),
 route('GET','/api/crm/quotation-costs/:id','quotations.cost.read',async({res,params,user})=>json(res,200,{data:await quoteCost(db,params.id,user)})),
 route('PUT','/api/crm/quotation-costs/:id','quotations.cost.manage',save((p,b,u)=>saveQuoteCost(db,p.id,b,u))),
 route('GET','/api/crm/quotation-costs/:id/history','quotations.cost.read',async({res,params,user})=>json(res,200,{data:await pricingHistory(db,params.id,user)})),
 route('GET','/api/crm/quotations','quotations.read',async({res,url,user})=>json(res,200,await quoteList(db,url,user))),
 route('POST','/api/crm/quotations','quotations.create',save((p,b,u)=>saveQuote(db,null,b,u),201)),
 route('GET','/api/crm/quotations/:id','quotations.read',async({res,params,user})=>json(res,200,{data:await quoteDetail(db,params.id,user)})),
 route('PUT','/api/crm/quotations/:id','quotations.update',save((p,b,u)=>saveQuote(db,p.id,b,u))),
 route('POST','/api/crm/quotations/:id/actions','quotations.read',save((p,b,u)=>quoteAction(db,p.id,b,u))),
 route('POST','/api/crm/quotations/:id/duplicate','quotations.create',save((p,b,u)=>duplicateQuote(db,p.id,b,u),201)),
 route('GET','/api/crm/quotations/:id/history','quotations.read',async({res,params,user})=>json(res,200,{data:await quoteHistory(db,params.id,user)})),
 ...['pdf','print'].map(kind=>route('GET',`/api/crm/quotations/:id/${kind}`,'quotations.read',async({res,params,user})=>{
 const q=await quoteForDocument(db,params.id,user),body=kind==='pdf'?await quotationPdf(q):quotationPrintHtml(q);
 res.writeHead(200,{'content-type':kind==='pdf'?'application/pdf':'text/html; charset=utf-8','cache-control':'no-store',...(kind==='pdf'?{'content-disposition':`inline; filename="${q.quotation_number}.pdf"`}:{})});res.end(body);
 }))
 ];
}
