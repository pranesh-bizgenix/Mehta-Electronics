import {s,validate} from '../../core/schema.js';
import {validationFailed} from '../../core/errors.js';
import {importMetadata} from './contracts.js';
const exact=s.string({pattern:/^\d{1,14}(?:\.\d{1,6})?$/});
const schema=s.object({metadata:s.json(),entries:s.array(s.object({itemId:s.id(),minQuantity:exact,unitPrice:exact,discountPercent:exact}),{min:1,max:200}),reason:s.reason(),previewFingerprint:s.string({pattern:/^[a-f0-9]{64}$/}).optional(),replacesId:s.uuid().optional()});
const cell=value=>'"'+String(value).replaceAll('"','""')+'"';
/** Manual entry is retained as a literal source document and uses the same
 * validation, hash replay, maker-checker and activation workflow as file imports. */
export class ManualPriceService {
 constructor(imports){this.imports=imports;}
 async source(actor,input){
  this.imports.manage(actor);const b=validate(schema,input),metadata=importMetadata(b.metadata),items=new Map((await this.imports.repository.items(true)).map(item=>[item.id,item]));
  const rows=[['partCode','uom','unitPrice','minQuantity','discountPercent']];
  for(const row of b.entries){const item=items.get(row.itemId);if(!item||item.status!=='ACTIVE')throw validationFailed('Every manual row must reference an active CRM product.');rows.push([item.part_code,item.uom,row.unitPrice,row.minQuantity,row.discountPercent]);}
  const bytes=Buffer.from(rows.map(row=>row.map(cell).join(',')).join('\n'),'utf8');
  return {format:'CSV',filename:'manual-price-list.csv',contentBase64:bytes.toString('base64'),metadata,mapping:{dataStartRow:2,columns:{partCode:0,uom:1,unitPrice:2,minQuantity:3,discountPercent:4},entryMethod:'MANUAL_FORM'},reason:b.reason,previewFingerprint:b.previewFingerprint,replacesId:b.replacesId};
 }
 async preview(actor,input){return this.imports.transactions.run(actor,validate(s.reason(),input?.reason),async()=>this.imports.preview(actor,await this.source(actor,input)));}
 async save(actor,input){return this.imports.transactions.run(actor,validate(s.reason(),input?.reason),async()=>this.imports.save(actor,await this.source(actor,input)));}
}
