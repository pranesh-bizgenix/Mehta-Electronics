import {s} from '../../core/schema.js';
export class OperationsController {
 constructor({operations}){this.operations=operations;}
 routes(){const service=this.operations;return [
  {method:'GET',path:'/api/v1/operations/catalogue',permission:'authenticated',handler:async({user})=>({data:await service.catalogue(user)})},
  {method:'GET',path:'/api/v1/operations/records/:id',permission:'authenticated',handler:async({user,params})=>({data:await service.detail(user,params.id)})},
  {method:'PATCH',path:'/api/v1/operations/records/:id',permission:'authenticated',body:s.object({version:s.int({min:1}),reason:s.reason(),payload:s.object({},{strict:false})}),handler:async({user,params,body})=>({data:await service.revise(user,params.id,body)})},
  {method:'GET',path:'/api/v1/operations/:kind',permission:'authenticated',query:s.object({page:s.int({min:1,max:1000000}).default(1),search:s.string({max:200}).default(''),status:s.string({max:50}).default(''),customerId:s.id().optional()}),handler:async({user,params,query})=>({body:await service.list(user,params.kind,query)})},
  {method:'POST',path:'/api/v1/operations/:kind',permission:'authenticated',idempotency:'required',body:s.object({title:s.string({min:1,max:200}),customerId:s.id().nullable().optional(),ownerId:s.id(),backupId:s.id(),dueAt:s.datetime().nullable().optional(),reason:s.reason(),payload:s.object({},{strict:false})}),handler:async({user,params,body})=>({status:201,data:await service.create(user,params.kind,body)})},
  {method:'POST',path:'/api/v1/operations/records/:id/actions',permission:'authenticated',idempotency:'required',body:s.object({action:s.string({min:1,max:30}),version:s.int({min:1}),reason:s.reason(),response:s.text({max:10000}).optional(),checks:s.object({},{strict:false}).optional()}),handler:async({user,params,body})=>({data:await service.act(user,params.id,body)})},
  {method:'GET',path:'/api/v1/customer-controls/:id',permission:'customers.controls',handler:async({user,params})=>({data:await service.controls(user,params.id)})},
  {method:'PUT',path:'/api/v1/customer-controls/:id',permission:'customers.controls',body:s.object({classification:s.enum(['NEW','EXISTING','POTENTIAL','DO_NOT_QUOTE']),pricingClass:s.enum(['RATE_CONTRACT','MEDIUM_DISCOUNT','DEALER_NETWORK','NEW']).nullable().optional(),creditExempt:s.bool(),version:s.int({min:0}),reason:s.reason()}),handler:async({user,params,body})=>({data:await service.controls(user,params.id,body)})}
 ];}
}
