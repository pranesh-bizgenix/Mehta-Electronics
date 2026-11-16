# Private client samples

These are real client documents. **Never commit them.** Never copy real names,
GSTINs, prices, bank details or phone numbers into code, seeds or committed tests.
The ignore rules permit only this README and empty `.gitkeep` markers. Do not use
`git add -f` for a sample. This folder does not upload or import documents into CRM.

Tests read these files at run time and must **skip cleanly, not fail**, when a
sample is missing. Do not replace missing samples with invented business values.
Missing private samples must be reported as skipped coverage, not a passing parser
or completed client acceptance. Keep ordinary synthetic regression tests separate.

## Where to paste files

| Folder | Contents |
|---|---|
| `01-customer-pos/` | Johnson, KONE, DK Elektro and EMR purchase orders |
| `02-customer-emails/` | Enquiries, stock requests, RFQs, complaints and open-order emails |
| `03-customer-open-orders/` | Grundfos and GE Vernova open-order schedule files |
| `04-price-lists/` | Siemens level-wise list, Connectwell rate-contract lists and master price list |
| `05-part-mappings/` | `KONE_PART_NO.xlsx` and similar part mappings |
| `06-supplier-documents/` | Connectwell AO, HCE OA, order forms and KGEP order/invoice/LR |
| `07-supplier-dispatch/` | RR Kabel dispatch emails |
| `08-principal-sheets/` | Siemens consignment and pending-order Excel files |
| `09-payments-and-statements/` | KGEP statements, payment advices and Siemens debit note |
| `99-unsorted/` | Documents not yet sorted |

## Using the helper

From a test under `test/`:

```js
import {test} from 'node:test';
import {samplePath} from '../test-support/client-samples.js';

test('optional document layout check',async t=>{
  const file=samplePath('01-customer-pos','reference-po.pdf',{testContext:t});
  if(!file)return; // The helper marks this test skipped with a clear message.
  // Read and validate the document here, at run time. Never log its contents.
});
```

Without a test context, the helper returns `null` and prints a `SKIP:` message.
It rejects traversal and samples that resolve outside this private folder.
It does not access the database, start a server or send messages.

## Manifest — fill in as files and tests are added

Supplied samples and their source paths, hashes and duplicate groups are recorded
in `manifest.local.json`, which is ignored. A `test: null` entry means no layout
test has been registered yet; receiving a sample does not prove parser coverage.

List filenames and test paths only. Do not paste document contents or personal,
financial or banking details into this committed README. If a filename contains
sensitive information, use a neutral local filename and list that instead.

| Folder / neutral filename | Test file and test name | Layout / purpose |
|---|---|---|
| `01-customer-pos/johnson-po-reference-01.pdf` | `test/private-financial-evidence.test.js` - Johnson financial evidence | Fifteen item nets; printed split tax and line-total differences remain reviewable |
| `01-customer-pos/purchase-order-reference-02.pdf` | `test/private-financial-evidence.test.js` - first KONE financial evidence | Net/split-tax line checks; missing source HSN/tax is flagged |
| `01-customer-pos/purchase-order-reference-03.pdf` | `test/private-financial-evidence.test.js` - second KONE financial evidence | Same independent financial check on the second layout sample |
| `06-supplier-documents/connectwell-ao-reference-01.pdf` | `test/private-financial-evidence.test.js` - acceptance financial evidence | Fifteen net lines, printed tax and grand total; no inferred tax rate |
| `06-supplier-documents/hce-oa-reference-01.pdf` | `test/private-financial-evidence.test.js` - packing and rounding evidence | Item amounts, packing, IGST and explicit signed round-off |
| `02-customer-emails/po-email-02.eml` | `test/private-financial-evidence.test.js` - PDF reference attachment | Offline fixture attachment only; list/discount net, split tax, signed adjustment; no intake integration |
| `manifest.local.json` (private inventory) | Other entries may still have `test: null` | Receiving a file is not completed importer or acceptance coverage |

The helper unit test (`test/client-samples.test.js`) uses a synthetic file in the
system temporary directory and removes it afterwards. It does not require any
client sample and is not evidence that a business document parser is implemented.
