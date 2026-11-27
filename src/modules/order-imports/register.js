import {s,validate} from '../../core/schema.js';
import {hasPermission} from '../../rbac.js';
import {sourceRowIssues} from './domain.js';

// One read model over the existing records. Email receipts and managed orders
// are linked, never copied into a second PO, quotation or fulfilment ledger.
export class CustomerOrderRegister{
 constructor(service){this.service=service;this.db=service.db;}
 async list(actor,query={}){
  this.service.permission(actor);const view=validate(s.enum(['CUSTOMER_PO','OPEN_ORDERS']),query.view||'CUSTOMER_PO'),page=validate(s.int({min:1,max:100000}),query.page||1),company=query.companyId?validate(s.uuid(),query.companyId):null,customer=query.customerId?validate(s.id(),query.customerId):null,search='%'+String(query.search||'').slice(0,100)+'%',source=validate(s.enum(['ALL','EXCEL','MANUAL','AUTOMATION','ORDER']),query.source||'ALL');
  const params=[],parts=[],add=(sql,args)=>{parts.push(sql);params.push(...args);};
  add(`SELECT 'source:'||r.id AS id,r.id AS row_id,r.batch_id,b.version AS batch_version,r.version AS row_version,b.customer_id,c.name AS customer_name,b.company_id,
   CASE WHEN r.raw_row->>'origin'='MANUAL' THEN 'MANUAL' ELSE 'EXCEL' END AS source,b.status,r.source_facts||r.review_values AS facts,r.item_id,i.uom,r.layout,r.raw_row,b.as_of_date::text AS source_date,b.created_at,
   '/operations/order-imports?batch='||b.id AS href,NULL::text AS quotation_href,NULL::text AS order_href,b.filename AS source_name,NULL::text AS fulfilled
   FROM crm_order_import_rows r JOIN crm_order_import_batches b ON b.id=r.batch_id LEFT JOIN customers c ON c.id=b.customer_id LEFT JOIN items i ON i.id=r.item_id
   WHERE r.source_facts->>'kind'='PO_LINE' AND NOT EXISTS(SELECT 1 FROM crm_order_register_visibility v WHERE v.batch_id=b.id AND v.hidden) AND NOT r.excluded AND (b.status IN ('DRAFT','PENDING_REVIEW') OR b.status='APPROVED' AND EXISTS(SELECT 1 FROM crm_order_schedule_registry g WHERE g.row_id=r.id AND g.status='ACTIVE'))
   AND (?::boolean OR c.owner_id IS NULL OR c.owner_id=?) AND (b.customer_id IS NOT NULL OR b.created_by=? OR ?::boolean)`,[actor.role!=='EXECUTIVE',actor.id,actor.id,hasPermission(actor,'orders.review')]);
  if(view==='CUSTOMER_PO'&&hasPermission(actor,'sales_intake.read'))add(`SELECT 'email:'||a.id||':'||coalesce(l.n,0)::text,NULL::uuid,NULL::uuid,NULL::integer,NULL::integer,a.customer_id,coalesce(c.name,(a.normalized->'header'||coalesce(a.resolutions->'header','{}'::jsonb))->>'buyerName'),a.company_id,
   'AUTOMATION',a.status,jsonb_build_object('poNumber',(a.normalized->'header'||coalesce(a.resolutions->'header','{}'::jsonb))->>'poNumber','poLine',coalesce(l.item->>'lineId',l.n::text),'externalCode',l.item->>'productCode','description',l.item->>'description','orderedQuantity',l.item->>'quantity','openQuantity',NULL,'unitPrice',l.item->>'unitPrice','requiredDate',(a.normalized->'header'||coalesce(a.resolutions->'header','{}'::jsonb))->>'deliveryDate','scheduleKind','UNKNOWN','kind','PO_LINE'),NULL::integer,l.item->>'uom','AUTOMATION_PO',NULL::jsonb,NULL::text,a.received_at,
   '/incoming-requests?requestId='||a.id,CASE WHEN a.quotation_id IS NOT NULL THEN '/quotations/'||a.quotation_id END,CASE WHEN a.sales_order_id IS NOT NULL THEN '/orders?open='||a.sales_order_id END,'Make.com Sales request',NULL::text
   FROM crm_sales_intakes a LEFT JOIN customers c ON c.id=a.customer_id LEFT JOIN LATERAL jsonb_array_elements(coalesce(a.resolutions->'items',a.normalized->'items','[]'::jsonb)) WITH ORDINALITY l(item,n) ON true
   WHERE a.message_type='CUSTOMER_PO' AND a.status<>'CANCELLED' AND (?::boolean OR a.assigned_to=?) AND NOT EXISTS(SELECT 1 FROM sales_orders o WHERE NOT o.is_deleted AND (o.id=a.sales_order_id OR o.customer_po_id=a.customer_po_id))`,[actor.role==='OWNER'||hasPermission(actor,'work.reassign'),actor.id]);
  add(`SELECT 'order:'||l.id,NULL::uuid,NULL::uuid,w.version,NULL::integer,o.customer_id,c.name,nullif(w.public_snapshot->>'companyId','')::uuid,'ORDER',w.status,
   jsonb_build_object('kind','PO_LINE','poNumber',o.customer_po_number,'poLine',l.position::text,'externalCode',coalesce(i.part_code,l.description),'description',l.description,'orderedQuantity',l.ordered_quantity::text,'openQuantity',greatest(l.ordered_quantity-l.fulfilled_quantity,0)::text,'requiredDate',o.promised_date::text,'scheduleKind',CASE WHEN o.promised_date IS NULL THEN 'UNKNOWN' ELSE 'DATED' END),l.item_id,l.uom,'MANAGED_ORDER',NULL::jsonb,NULL::text,o.created_at,
   '/orders?open='||o.id,CASE WHEN o.quotation_id IS NOT NULL THEN '/quotations/'||o.quotation_id END,'/orders?open='||o.id,o.order_number,l.fulfilled_quantity::text
   FROM sales_orders o JOIN crm_order_workflows w ON w.sales_order_id=o.id JOIN sales_order_lines l ON l.sales_order_id=o.id JOIN customers c ON c.id=o.customer_id LEFT JOIN items i ON i.id=l.item_id
   WHERE NOT o.is_deleted AND NOT l.is_deleted AND (?::boolean OR c.owner_id IS NULL OR c.owner_id=?) ${view==='OPEN_ORDERS'?"AND w.status IN ('APPROVED','PARTIALLY_DISPATCHED','DISPATCHED') AND l.ordered_quantity>l.fulfilled_quantity":''}`,[actor.role!=='EXECUTIVE',actor.id]);
  const base='WITH records AS ('+parts.join(' UNION ALL ')+') ',where="WHERE (?::uuid IS NULL OR company_id=?::uuid OR company_id IS NULL) AND (?::integer IS NULL OR customer_id=?) AND (?='ALL' OR source=?) AND (coalesce(facts->>'poNumber','') ILIKE ? OR coalesce(facts->>'externalCode','') ILIKE ? OR coalesce(facts->>'description','') ILIKE ? OR coalesce(customer_name,'') ILIKE ?)"+(view==='OPEN_ORDERS'?" AND (facts->>'openQuantity' IS NULL OR facts->>'openQuantity' !~ '^0([.]0+)?$')":'');
  const args=[...params,company,company,customer,customer,source,source,search,search,search,search];
  const count=await this.service.one(base+'SELECT count(*)::integer AS n FROM records '+where,...args),rows=await this.service.all(base+'SELECT * FROM records '+where+' ORDER BY created_at DESC,id LIMIT 100 OFFSET ?',...args,(page-1)*100);
  return {view,rows:rows.map(row=>({...row,editable:row.batch_id&&row.status==='DRAFT'&&hasPermission(actor,'orders.update'),issues:row.batch_id?sourceRowIssues(row.facts,{layout:row.layout,formula:row.raw_row?.cells?.some(c=>c?.formula)}):[],raw_row:undefined})),pagination:{page,pageSize:100,total:count.n,pages:Math.ceil(count.n/100)},note:'Imported/manual open quantities are customer-reported source values. Only managed order rows show actual supplied/pending quantities. Email records use the existing Sales review and quotation workflow.'};
 }
 async requestSources(actor,companyId,customerId,poNumbers){
  if(!customerId||!poNumbers?.length||!hasPermission(actor,'orders.read'))return [];
  await this.service.scope(actor,{customer_id:customerId});
  return this.service.all(`SELECT b.id AS batch_id,b.as_of_date::text AS source_date,l.po_number,coalesce(x.mapping_snapshot->>'part_code',l.part_code) AS part_code,l.quantity::text AS reported_open,l.uom,l.schedule_date::text AS required_date,l.sales_order_id,l.order_line_id
   FROM crm_order_schedule_registry r JOIN crm_order_import_rows x ON x.id=r.row_id JOIN crm_order_import_batches b ON b.id=r.batch_id JOIN customer_open_order_lines l ON l.id=r.active_line_id
   WHERE r.customer_id=? AND r.company_id=? AND r.status='ACTIVE' AND b.status='APPROVED' AND l.po_number=ANY(?::text[]) ORDER BY l.po_number,l.part_code,l.schedule_date LIMIT 100`,customerId,companyId,poNumbers);
 }
}
