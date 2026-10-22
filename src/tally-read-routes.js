import { hasPermission } from './rbac.js';
import { readStoredTally, readReconciliation, createCrmFromStored, companyDisplayName } from './tally-read-service.js';

export function storedTallyRoutes({ db, config, route, json, readJson }) {
  const definitions = { customers:'customers.read', vendors:'tally.read', items:'items.read', groups:'tally.read', banks:'tally.read', expenses:'tally.read', other:'tally.read', ledgers:'tally.read' };
  return ['/tally','/api/tally'].flatMap(prefix => [
    ...Object.entries(definitions).map(([kind,permission]) => route('GET',`${prefix}/${kind}`,permission,async({res,url,user}) => {
      json(res,200,await readStoredTally(db,kind,url,{financial:config.tallyFinancialRoles.includes(user.role)}));
    })),
    route('GET',`${prefix}/read-companies`,'authenticated',async({res,user}) => {
      if (!hasPermission(user,'customers.read') && !hasPermission(user,'items.read')) throw Object.assign(new Error('Permission denied.'),{status:403});
      const rows = await db.prepare('SELECT id,name FROM tally_companies ORDER BY name,id').all();
      json(res,200,{data:rows.map(row => ({...row,display_name:companyDisplayName(row.name)}))});
    }),
    route('GET',`${prefix}/reconciliation`,'tally.read',async({res,url}) => json(res,200,await readReconciliation(db,url))),
    route('POST',`${prefix}/crm-records`,'authenticated',async({req,res,user,ip}) => {
      const body = await readJson(req);
      const permission = body?.kind === 'item' ? 'items.create' : 'customers.create';
      if (!hasPermission(user,permission)) throw Object.assign(new Error('You do not have permission to create this CRM record.'),{status:403});
      if (body.kind==='vendor' && !hasPermission(user,'tally.read')) throw Object.assign(new Error('Vendor records require Tally read access.'),{status:403});
      const result = await createCrmFromStored(db,body,user,ip);
      json(res,result.created ? 201 : 200,result);
    })
  ]);
}
