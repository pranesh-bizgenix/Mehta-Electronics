import {WarehouseService} from './service.js';
import {validationFailed} from '../../core/errors.js';
export function warehouseRoutes({db,route,json,readJson}){const s=new WarehouseService({db});
 const upload=async req=>{let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>14*1024*1024)throw Object.assign(new Error('Photo upload exceeds 10 MiB.'),{status:413});chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw validationFailed('Upload valid photo JSON.');}};
 return [
  route('GET','/api/crm/warehouse/locations','logistics.grn.read',async({res,user})=>json(res,200,{data:await s.locations(user)})),
  route('POST','/api/crm/warehouse/locations','logistics.grn.manage',async({req,res,user})=>json(res,201,{data:await s.createLocation(user,await readJson(req))})),
  route('GET','/api/crm/warehouse/receipts','logistics.grn.read',async({res,user,url})=>{s.access(user,'logistics.grn.read');const page=Number(url.searchParams.get('page')||1),search=String(url.searchParams.get('search')||'').slice(0,100);if(!Number.isSafeInteger(page)||page<1||page>1000000)throw validationFailed('Choose a valid receipt page.');const receipts=await db.prepare("SELECT g.id,g.number,g.payload,p.payload AS po_payload FROM crm_grns g JOIN crm_supplier_pos p ON p.id=g.supplier_po_id WHERE g.status='POSTED' AND NOT g.is_deleted AND NOT p.is_deleted AND g.number ILIKE ? ORDER BY g.id DESC LIMIT 100 OFFSET ?").all('%'+search+'%',(page-1)*100);json(res,200,{data:receipts.map(g=>({id:g.id,number:g.number,lines:g.payload.lines.map(l=>({poLineKey:l.poLineKey,partCode:g.po_payload.lines.find(p=>p.lineKey===l.poLineKey)?.partCode||'',uom:g.po_payload.lines.find(p=>p.lineKey===l.poLineKey)?.uom||'',accepted:l.accepted}))}))});}),
  route('GET','/api/crm/warehouse/lots','logistics.grn.read',async({res,user,url})=>json(res,200,{data:await s.lots(user,Object.fromEntries(url.searchParams))})),
  route('POST','/api/crm/warehouse/lots','logistics.grn.manage',async({req,res,user})=>json(res,201,{data:await s.createLot(user,await readJson(req))})),
  route('POST','/api/crm/warehouse/lots/:id/review','logistics.grn.post',async({req,res,user,params})=>json(res,200,{data:await s.reviewLot(user,params.id,await readJson(req))})),
  route('GET','/api/crm/warehouse/lots/:id/serials','logistics.grn.read',async({res,user,params})=>json(res,200,{data:await s.serials(user,params.id)})),
  route('GET','/api/crm/warehouse/orders/:id/packing','logistics.read',async({res,user,params})=>json(res,200,{data:await s.packing(user,params.id)})),
  route('GET','/api/crm/warehouse/orders/:id/trace','logistics.read',async({res,user,params,url})=>json(res,200,{data:await s.trace(user,params.id,url.searchParams.get('boxId')||null)})),
  route('POST','/api/crm/warehouse/orders/:id/packing/enable','logistics.dispatch.manage',async({req,res,user,params})=>json(res,200,{data:await s.enable(user,params.id,await readJson(req))})),
  route('POST','/api/crm/warehouse/orders/:id/boxes','logistics.dispatch.manage',async({req,res,user,params})=>json(res,201,{data:await s.createBox(user,params.id,await readJson(req))})),
  route('POST','/api/crm/warehouse/boxes/:id/items','logistics.dispatch.manage',async({req,res,user,params})=>json(res,200,{data:await s.item(user,params.id,await readJson(req))})),
  route('POST','/api/crm/warehouse/boxes/:id/scans','logistics.dispatch.manage',async({req,res,user,params})=>json(res,201,{data:await s.scan(user,params.id,await readJson(req))})),
  route('POST','/api/crm/warehouse/boxes/:id/scans/:scan/reject','logistics.dispatch.manage',async({req,res,user,params})=>json(res,200,{data:await s.rejectScan(user,params.id,params.scan,await readJson(req))})),
  route('POST','/api/crm/warehouse/boxes/:id/allocations','logistics.dispatch.manage',async({req,res,user,params})=>json(res,201,{data:await s.allocate(user,params.id,await readJson(req))})),
  route('POST','/api/crm/warehouse/boxes/:id/photo','logistics.evidence.write',async({req,res,user,params})=>json(res,201,{data:await s.photo(user,params.id,await upload(req))})),
  route('POST','/api/crm/warehouse/boxes/:id/decision','logistics.dispatch.manage',async({req,res,user,params})=>json(res,200,{data:await s.decide(user,params.id,await readJson(req))})),
  route('POST','/api/crm/warehouse/orders/:id/packing/pdf','logistics.read',async({req,res,user,params})=>{const b=await readJson(req),f=await s.pdf(user,params.id,b);res.writeHead(200,{'content-type':'application/pdf','content-length':f.bytes.length,'content-disposition':`${b?.preview?'inline':'attachment'}; filename="${f.filename}"`,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(f.bytes);})
 ];
}
