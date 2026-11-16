import {s} from '../../core/schema.js';
import {MAX_DECISION_CSV_BYTES} from './csv.js';
const command={expectedVersion:s.int({min:0,max:2147483646}),requestKey:s.uuid(),reason:s.reason()};
export class DecisionController {
 constructor({decisions}){this.decisions=decisions;}
 routes(){const d=this.decisions;return [
  {method:'GET',path:'/api/v1/decisions',permission:'rules.manage',handler:async({user})=>({body:await d.list(user)})},
  {method:'GET',path:'/api/v1/decisions/sheet',permission:'rules.manage',handler:async({user,res})=>{const body=await d.sheet(user);res.writeHead(200,{'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="controldesk-decision-sheet.csv"','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(body);return {raw:true};}},
  {method:'GET',path:'/api/v1/decisions/:key/history',permission:'rules.manage',handler:async({user,params})=>({data:await d.history(user,params.key)})},
  {method:'POST',path:'/api/v1/decisions/preview-import',permission:'rules.manage',body:s.object({csv:s.string({max:MAX_DECISION_CSV_BYTES,trim:false})}),handler:async({user,body})=>({data:await d.previewImport(user,body)})},
  {method:'POST',path:'/api/v1/decisions/import',permission:'rules.manage',body:s.object({csv:s.string({max:MAX_DECISION_CSV_BYTES,trim:false}),fingerprint:s.string({pattern:/^[a-f0-9]{64}$/}),requestKey:s.uuid(),reason:s.reason()}),handler:async({user,body})=>({data:await d.import(user,body)})},
  {method:'POST',path:'/api/v1/decisions/bulk-decide',permission:'rules.manage',body:s.object({entries:s.array(s.object({key:s.string({min:1,max:160}),expectedVersion:command.expectedVersion}),{min:1,max:100}),decision:s.enum(['CONFIRM','REJECT','CLEAR']),requestKey:s.uuid(),reason:s.reason()}),handler:async({user,body})=>({data:await d.bulkDecide(user,body)})},
  {method:'POST',path:'/api/v1/decisions/:key/enter',permission:'rules.manage',body:s.object({...command,value:s.json({maxBytes:20000}),confirm:s.bool(),evidenceSource:s.string({max:2000}).optional()}),handler:async({user,params,body})=>({data:await d.enter(user,params.key,body)})},
  {method:'POST',path:'/api/v1/decisions/:key/decide',permission:'rules.manage',body:s.object({...command,decision:s.enum(['CONFIRM','REJECT','CLEAR'])}),handler:async({user,params,body})=>({data:await d.decide(user,params.key,body)})}
 ];}
}
