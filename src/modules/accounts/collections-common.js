import {collectionBalance} from './collection-domain.js';
import {notFound,validationFailed} from '../../core/errors.js';
export async function financialInvoice(db,id,{lock=false}={}){const row=await db.prepare("SELECT * FROM crm_operations WHERE id=? AND kind='INVOICE'"+(lock?' FOR UPDATE':'')).get(id);if(!row)throw notFound('Invoice reference not found.');return row;}
export async function invoiceBalance(db,invoice,asOf=null){
 const receipts=await db.prepare("SELECT id,payload->>'amount' AS amount FROM crm_operations WHERE kind='RECEIPT' AND status='CONFIRMED' AND payload->>'invoiceId'=? AND (?::date IS NULL OR (payload->>'paymentDate')::date<=?::date)").all(invoice.id,asOf,asOf);
 const adjustments=await db.prepare("SELECT kind,amount::text AS amount FROM crm_invoice_adjustments WHERE invoice_id=? AND status='CONFIRMED' AND (?::date IS NULL OR document_date<=?::date)").all(invoice.id,asOf,asOf);
 return collectionBalance({amount:invoice.payload.amount,receipts,adjustments});
}
export async function financialCompany(db,invoice){
 const scope=await db.prepare("SELECT company_id FROM crm_financial_scopes WHERE operation_id=? AND status='CONFIRMED'").get(invoice.id),profile=await db.prepare("SELECT company_id FROM crm_customer_profiles WHERE customer_id=? AND status='ACTIVE' AND NOT is_deleted").get(invoice.customer_id);
 if(scope&&profile?.company_id&&scope.company_id!==profile.company_id)throw validationFailed('Invoice company and the mapped customer company differ. Review the source mapping.');return scope?.company_id||profile?.company_id||null;
}
