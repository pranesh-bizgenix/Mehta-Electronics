import {AutomationCredentialRepository,AutomationCredentialService} from './credentials.js';
import {AuditRepository,TransactionRunner,SystemClock} from '../../core/runtime.js';
import {forbidden} from '../../core/errors.js';
import {hasPermission} from '../../rbac.js';
export function createAutomationCredentials(db,clock=new SystemClock()){return new AutomationCredentialService({db,repository:new AutomationCredentialRepository(db),transactions:new TransactionRunner(db),audit:new AuditRepository(db),clock,access:{require(actor,key){if(!actor?.id||!hasPermission(actor,key))throw forbidden();}}});}
export function automationCredentialRoutes({service,route,json,readJson}){return [
 route('GET','/api/v1/automation-credentials','rules.manage',async({res,user})=>json(res,200,{data:await service.list(user)})),
 route('POST','/api/v1/automation-credentials','rules.manage',async({req,res,user})=>{const data=await service.create(user,await readJson(req));json(res,data.replayed?200:201,{data});}),
 route('POST','/api/v1/automation-credentials/:id/rotate','rules.manage',async({req,res,user,params})=>json(res,200,{data:await service.change(user,params.id,await readJson(req))})),
 route('POST','/api/v1/automation-credentials/:id/revoke','rules.manage',async({req,res,user,params})=>json(res,200,{data:await service.change(user,params.id,await readJson(req),true)}))
];}
