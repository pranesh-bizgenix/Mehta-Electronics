/** Header mapping for the client-supplied level-wise workbook. Selecting this
 * preset is explicit: no list is published and no validity period is inferred. */
export const LEVEL_WORKBOOK_HEADERS=['Customer Article Number','Description','Price (Indian Rupee)','MOQ / Standard Packing (as printed)','Datasheet / Product Link','Brand','Standard Pack','UOM','Price-list edition','Discount'];
export function levelWorkbookPreset(header,sheet){
 if(!Array.isArray(header)||LEVEL_WORKBOOK_HEADERS.some((h,i)=>header[i]?.trim()!==h))return null;
 const match=/^level ([1-4])\s*$/i.exec(sheet??'');
 return {dataStartRow:2,discountUnit:'FRACTION',uomFallback:'MATCHED_CRM',columns:{partCode:0,description:1,unitPrice:2,minQuantity:3,uom:7,edition:8,...(match?{discountPercent:9}:{})},constants:{...(match?{level:match[1]}:{discountPercent:'0'})}};
}
