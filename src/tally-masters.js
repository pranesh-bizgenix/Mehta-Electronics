import { escapeLike } from './security.js';

const definitions={ledgers:{table:'tally_ledgers',permission:'customers.read',columns:'id,name,parent_name,gstin,pan,phone,email,contact_person',sorts:['name','parent_name','phone','email','closing_balance']},
  items:{table:'tally_stock_items',permission:'items.read',columns:'id,name,parent_name,normalized_part_number,base_unit,closing_quantity_text,closing_rate_text',sorts:['name','parent_name','normalized_part_number','closing_quantity_text','closing_rate_text','closing_value']},
  groups:{table:'tally_groups',permission:'tally.read',columns:'id,name,parent_name',sorts:['name','parent_name']}};
export const masterDefinition=kind=>definitions[kind];
export async function tallyMasterList(db,kind,url,{financial=false}={}) {
  const definition=definitions[kind];
  const page=Math.max(1,parseInt(url.searchParams.get('page'),10)||1),pageSize=Math.min(100,Math.max(1,parseInt(url.searchParams.get('pageSize'),10)||25));
  const requested=url.searchParams.get('companyId');
  const company=requested?await db.prepare('SELECT id,name FROM tally_companies WHERE id=?').get(requested):await db.prepare('SELECT id,name FROM tally_companies ORDER BY name LIMIT 1').get();
  if(!company)return {data:[],pagination:{page,pageSize,total:0,pages:0},company:null};
  const args=[company.id],where=['company_id=?'];
  const search=url.searchParams.get('search')?.trim();
  if(search){where.push("(name ILIKE ? ESCAPE '\\' OR parent_name ILIKE ? ESCAPE '\\')");args.push(`%${escapeLike(search)}%`,`%${escapeLike(search)}%`);}
  if(url.searchParams.get('group')){where.push('parent_name=?');args.push(url.searchParams.get('group'));}
  const allowedSorts=definition.sorts.filter(key=>financial || !['closing_value','closing_balance'].includes(key));
  const clause=where.join(' AND '),sort=allowedSorts.includes(url.searchParams.get('sort'))?url.searchParams.get('sort'):'name',direction=url.searchParams.get('direction')==='desc'?'DESC':'ASC';
  const total=(await db.prepare(`SELECT COUNT(*) AS n FROM ${definition.table} WHERE ${clause}`).get(...args)).n;
  const financialColumn=financial?(kind==='items'?',closing_value::text AS closing_value':',opening_balance::text AS opening_balance,closing_balance::text AS closing_balance,dr_cr'):'';
  const data=await db.prepare(`SELECT ${definition.columns}${financialColumn} FROM ${definition.table} WHERE ${clause} ORDER BY ${sort} ${direction},id LIMIT ? OFFSET ?`).all(...args,pageSize,(page-1)*pageSize);
  return {data,pagination:{page,pageSize,total,pages:Math.ceil(total/pageSize)},company,source:'Tally connector',financial};
}
