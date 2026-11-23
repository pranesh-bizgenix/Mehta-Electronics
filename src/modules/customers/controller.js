import {s,validate} from '../../core/schema.js';
const version=s.int({min:1}),reason=s.reason(),company=s.object({companyId:s.uuid()}),page=s.object({page:s.int({min:1,max:100000}).default(1)});
const write={value:s.json({maxBytes:20000}),reason},change={...write,version};
export class CustomerManagementController{
 constructor(service){this.service=service;}
  routes(){const c=this.service,id=x=>validate(s.id(),x.params.id),row=x=>validate(s.uuid(),x.params.record);
  const route=(method,path,permission,handler,options={})=>({method,path:'/api/v1/customers/:id/'+path,permission,...options,handler:async x=>({data:await handler(x)})});
  return [
   route('GET','identity','customers.read',x=>c.context(x.user,id(x))),
   route('GET','addresses','customers.read',x=>c.addresses(x.user,id(x))),
   route('POST','addresses','customers.update',x=>c.saveAddress(x.user,id(x),null,x.body),{body:s.object(write),idempotency:'required'}),
   route('PUT','addresses/:record','customers.update',x=>c.saveAddress(x.user,id(x),row(x),x.body),{body:s.object(change)}),
   route('POST','addresses/:record/archive','customers.update',x=>c.archive(x.user,id(x),'address',row(x),x.body),{body:s.object({version,reason})}),
   route('GET','activities','customers.read',x=>c.activities(x.user,id(x),x.query.page),{query:page}),
   route('POST','activities','customers.update',x=>c.saveActivity(x.user,id(x),x.body),{body:s.object(write),idempotency:'required'}),
   route('POST','activities/:record/archive','customers.update',x=>c.archive(x.user,id(x),'activity',row(x),x.body),{body:s.object({version,reason})}),
   route('GET','opportunities','enquiries.read',x=>c.opportunities(x.user,id(x),x.query.page),{query:page}),
   route('POST','opportunities','enquiries.update',x=>c.saveOpportunity(x.user,id(x),null,x.body),{body:s.object(write),idempotency:'required'}),
   route('PUT','opportunities/:record','enquiries.update',x=>c.saveOpportunity(x.user,id(x),row(x),x.body),{body:s.object(change)}),
   route('GET','commercial-policy','customers.read',x=>c.policy(x.user,id(x),x.query.companyId),{query:company}),
   route('PUT','commercial-policy','rules.manage',x=>c.savePolicy(x.user,id(x),x.query.companyId,x.body),{query:company,body:s.object({...write,version:s.int({min:0})})}),
   route('POST','pricing-preview','quotations.read',x=>c.previewPricing(x.user,id(x),x.query.companyId,x.body),{query:company,body:s.object({itemId:s.id(),quantity:s.string({min:1,max:30})})}),
   route('GET','classification','customers.read',x=>c.classification(x.user,id(x),x.query.companyId),{query:company}),
   route('POST','classification/apply','customers.controls',x=>c.applyClassification(x.user,id(x),x.query.companyId,x.body),{query:company,body:s.object({policyVersion:s.int({min:1}),controlVersion:s.int({min:0}),reason})}),
   route('GET','timeline','customers.read',x=>c.history(x.user,id(x),x.query),{query:s.object({page:s.int({min:1,max:100000}).default(1),kind:s.string({min:1,max:30}).default('ALL')})}),
   route('GET','merges','customers.read',x=>c.merges(x.user,id(x))),
   route('POST','merge-preview','customers.merge.request',x=>c.previewMerge(x.user,id(x),x.body),{body:s.object({targetId:s.id()})}),
   route('POST','merges','customers.merge.request',x=>c.requestMerge(x.user,id(x),x.body),{body:s.object({targetId:s.id(),fingerprint:s.string({pattern:/^[a-f0-9]{64}$/}),reason}),idempotency:'required'}),
   route('POST','merges/:record/decision','customers.merge.approve',x=>c.decideMerge(x.user,id(x),row(x),x.body),{body:s.object({decision:s.enum(['APPROVE','REJECT']),version,reason})})
  ];
 }
}
