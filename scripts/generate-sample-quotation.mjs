import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '../src/config.js';
import { openDatabase, quotationView } from '../src/db.js';
import { createQuotationPdf } from '../src/quotation-pdf.js';

const config=getConfig();
const db=(await openDatabase(config));
try{
  const row=(await db.prepare("SELECT id FROM quotations ORDER BY CASE WHEN quotation_number LIKE 'DEMO-%' THEN 0 ELSE 1 END,id LIMIT 1").get());
  if(!row)throw new Error('Create a quotation before generating a sample PDF.');
  const outputDir=path.resolve('output/pdf');fs.mkdirSync(outputDir,{recursive:true});
  const output=path.join(outputDir,'quotation-sample.pdf');
  fs.writeFileSync(output,await createQuotationPdf(config,(await quotationView(db,row.id))));
  console.log(`Sample quotation PDF created at ${output}`);
}finally{(await db.close())}
