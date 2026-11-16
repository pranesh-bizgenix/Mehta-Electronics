import {TallyFinancialReadService} from './tally-financial-read.js';
export function tallyFinancialRoutes({db,route,json}){
 const service=new TallyFinancialReadService(db);
 return ['/api/tally','/api/v1/tally'].flatMap(prefix=>[
  route('GET',`${prefix}/financial/vouchers`,'tally.read',async({res,url,user})=>json(res,200,await service.vouchers(url,user))),
  route('GET',`${prefix}/financial/vouchers/:id`,'tally.read',async({res,url,user,params})=>json(res,200,await service.voucher(url,params.id,user))),
  route('GET',`${prefix}/financial/outstanding`,'tally.read',async({res,url,user})=>json(res,200,await service.outstanding(url,user)))
 ]);
}
