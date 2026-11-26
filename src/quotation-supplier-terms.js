import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

export const SUPPLIER_TERMS_FILENAME='KGEP-supplier-sales-terms-v1.1-original.pdf';
export const SUPPLIER_TERMS_LABEL='Separate supplier attachment: KGEP Standard Terms and Conditions of Sale for Products v1.1 (original, 6 pages).';
// Original supplied by the client. No company-name substitutions or legal edits.
export async function quotationSupplierTerms(){
 const bytes=await readFile(new URL('./assets/kgep-supplier-sales-terms-v1.1.pdf',import.meta.url));
 return {bytes,filename:SUPPLIER_TERMS_FILENAME,sha256:createHash('sha256').update(bytes).digest('hex')};
}
