import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {readPriceWorkbook} from '../src/modules/pricing/tabular.js';
import {buildBaseCatalog} from '../src/modules/pricing/base-catalog.js';
const input=process.argv[2];if(!input)throw new Error('Usage: node scripts/prepare-base-price-catalog.mjs <workbook.xlsx>');
const bytes=fs.readFileSync(input),catalog=buildBaseCatalog(readPriceWorkbook(bytes,'master price'),createHash('sha256').update(bytes).digest('hex'));
fs.writeFileSync(new URL('../src/modules/pricing/base-catalog.json',import.meta.url),JSON.stringify(catalog));
console.log(JSON.stringify({sheet:catalog.sheet,rows:catalog.rows.length,displayablePrices:catalog.rows.filter(r=>r.unitPrice!==null).length,reviewRows:catalog.rows.filter(r=>r.issues.length).length,sourceSha256:catalog.sourceSha256}));
