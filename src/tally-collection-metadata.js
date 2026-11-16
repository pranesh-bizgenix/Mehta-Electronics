import {validationFailed} from './core/errors.js';
const datasets=new Set(['vouchersXml','salesDocumentsXml','salesOrdersXml','purchaseOrdersXml','logisticsDocumentsXml','ledgersXml','stockXml','groupsXml','companiesXml','stockGroupsXml','stockCategoriesXml','unitsXml','godownsXml','priceLevelsXml','costCentresXml','balanceSheetXml','profitAndLossXml','billsReceivableXml','billsPayableXml','salesRegisterXml','purchaseRegisterXml','dayBookReportXml','trialBalanceXml','cashBankControlXml','stockSummaryReportXml']);
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
export function collectionMetadata(input){
 if(input===undefined)return {};
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length>32)throw validationFailed('Invalid collection metadata.');
 const result={};
 for(const [dataset,row]of Object.entries(input)){
  if(!datasets.has(dataset)||!row||typeof row!=='object'||!['DATE_WINDOW','ALTER_ID','SNAPSHOT'].includes(row.mode)||!validDate(row.from)||!validDate(row.to)||row.from>row.to)throw validationFailed('Collection metadata needs a known dataset, extraction mode and valid ordered date window.');
  for(const key of ['capturedAt','sourceTimestamp'])if(row[key]!=null&&(typeof row[key]!=='string'||row[key].length>40||!/^\d{4}-\d\d-\d\dT/.test(row[key])||!Number.isFinite(Date.parse(row[key]))))throw validationFailed('Collection timestamps must be ISO timestamps or null.');
  if(row.mode==='ALTER_ID'&&(['after','through'].some(key=>typeof row[key]!=='string'||!/^\d{1,30}$/.test(row[key]))||BigInt(row.after)>BigInt(row.through)))throw validationFailed('Invalid alteration checkpoint range.');
  result[dataset]={mode:row.mode,from:row.from,to:row.to,capturedAt:row.capturedAt??null,sourceTimestamp:row.sourceTimestamp??null,...(row.mode==='ALTER_ID'?{after:row.after,through:row.through}:{})};
 }
 return result;
}
