import {AccountsIntakeService} from './service.js';
export const createAccountsIntake=options=>new AccountsIntakeService(options);
export function accountsIntakeRoutes({service,route,json,readJson}){const company=url=>url.searchParams.get('companyId');return [
 route('GET','/api/crm/accounts-intake','collections.read',async({res,url,user})=>json(res,200,await service.list(user,url.searchParams))),
 route('GET','/api/crm/accounts-intake/staff','collections.read',async({res,user})=>json(res,200,{data:await service.financeUsers(user)})),
 route('GET','/api/crm/accounts-intake/:id','collections.read',async({res,url,user,params})=>json(res,200,{data:await service.detail(user,params.id,company(url))})),
 ...[['review','review'],['actions','action'],['finance-draft','handoff']].map(([suffix,method])=>route('POST',`/api/crm/accounts-intake/:id/${suffix}`,'collections.write',async({req,res,url,user,params})=>json(res,200,{data:await service[method](user,params.id,company(url),await readJson(req))}))),
 route('GET','/api/crm/notification-history','authenticated',async({res,url,user})=>json(res,200,await service.notificationHistory(user,url.searchParams)))
];}
