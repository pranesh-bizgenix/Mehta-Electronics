# Invoice documents and report PDFs

Open https://mehta-controldesk.vercel.app. Only the existing development RDS is used. No Tally connector code or source records are modified.

## Manual test: CRM invoice draft

1. Sign in as an authorised Accounts or Owner user. Open **Sales > Invoice documents** (`/billing`).
2. Select **New invoice document > CRM invoice draft**. Find an active approved TEST customer. Enter the invoice date, two-digit place-of-supply state, bill-to and ship-to addresses.
3. For a preview-only draft, enter item code, description, HSN, UoM, quantity, net unit rate and GST. Example: quantity 2, rate 100, GST 18 gives INR 236.00; state 33 splits INR 18.00 CGST and INR 18.00 SGST, state 27 gives INR 36.00 IGST.
4. Enter a create reason and select **Save invoice document**. Enter **PDF access reason**, then **Preview PDF** and **Download PDF**. The document has a plain draft label, no overlay watermark, and no statutory number.
5. Enter **Invoice action reason > Submit invoice for approval**. The creator's approval button must be disabled. Sign in as a different authorised Accounts/Owner user, open the same draft and select **Approve invoice**.
6. **Issue tax invoice** must fail while billing settings are unconfirmed, IRN is required without an integration, or the draft has no recorded shipment. A manual draft can never become an issued invoice. Cancel a TEST draft after testing.

## Final CRM invoice prerequisites

The Owner opens **Billing settings**, supplies confirmed company name, Tamil Nadu GSTIN/address, contact, 1–3 character numbering prefix, verbatim terms and signatory; explicitly confirms origin and GST applicability. Issuance starts disabled. No actual policy is inferred from a TEST configuration.

Final issuance requires a recorded shipment belonging to the customer and an approved order. Enter its ID in the creation form; quantities, net prices, taxes and place of supply come from that existing shipment/order. One active invoice document per shipment prevents duplicate billing; cancelled drafts release the shipment. Final issue requires today's India date, current settings, unchanged order version and independent approval. It allocates the next financial-year number transactionally. Issued records are immutable. No invoice is posted to Tally, no IRN/e-Way number is fabricated, and no email is sent. Where IRN is required, final issuance remains blocked until a separate verified GST integration is supplied. Existing e-Way requirements remain part of the operational dispatch controls; this module does not generate e-Way bills.

## Manual test: retrieve an existing invoice copy

1. Under **Work > Support & collections**, select **Invoice references**, then **New record**. Record the correct customer, invoice number/date/amount and source evidence, with different primary and backup owners.
2. Open **Invoice documents > New invoice document > Existing Tally invoice copy**. Select the same customer, use **Find invoice number** if necessary and choose the invoice reference. Paid/closed references are supported; cancelled references are rejected. Optionally enter **Related recorded shipment ID** to link the existing sales order; the server checks that it belongs to this customer. Enter Tally verification evidence and a create reason, then save.
3. Enter an invoice action reason, choose the original PDF (maximum 5 MB) and select **Retain original PDF**. Normal retrieval must be blocked while unverified. Uploader/creator cannot verify their own original.
4. A different authorised Accounts/Owner reviewer opens the record, uses **Review unverified original > Preview PDF** to inspect the original, checks customer, number, date and total against the source evidence, ticks the matching acknowledgement, enters a reason and selects **Verify invoice copy**.
5. Enter **PDF access reason > Download PDF**. The downloaded bytes and SHA-256 must match the uploaded original exactly. This is independent human verification, not automatic Tally invoice ingestion or PDF extraction. Originals cannot be silently replaced. A source invoice reference can be linked only once.

## Manual test: business reports

1. Open **Overview > Business report PDFs** (`/reports`). Select quotation register, sales-order quantities, support/warranty register, collection cases, confirmed receipts, invoice documents or staff tasks.
2. Enter **From date** and **To date**; optionally enter an exact status such as `APPROVED`. Select **Load report** and compare rows with their existing CRM screens.
3. Enter **PDF access reason**, preview and download. Export reads current matching records again. Date filtering uses India calendar days and record creation date, not invoice/payment/due date. Maximum range is 366 days and 1,000 rows; larger results are rejected without silent truncation.
4. Verify a Sales/warehouse user cannot access invoice documents or financial reports through the UI or direct API. Staff task visibility follows the existing assignment permission; ordinary staff see their own/created/backup tasks.
5. In **Administration > Audit trail**, filter module `BILLING_DOCUMENT` or `CRM_REPORT` to inspect create, approval, source-review and PDF-access events. Audit entries contain IDs, reasons and metadata, not attachment bytes.

Reports show CRM registers, not statutory accounts or reconciled bank/Tally balances. Collection case amounts are not an ageing calculation; order quantities can have different units and are not combined into an invented grand total. Report formats/KPIs still need client acceptance.

## Implementation and checks

Additive migration: `0062_billing_documents.sql` (settings, counters, snapshots, immutable originals and guarded writes). Existing migration files and the ten-minute verified-backup guard are unchanged. New services/renderers/routes live under `src/modules/billing`; typed client and PDF preview controls under `apps/web/features/billing`; pages are `/billing` and `/reports`. Existing navigation and backend route registration receive small additive entries. Quotation/purchasing PDF renderers have their overlay watermarks removed, retaining plain status text and existing access gates. `src/document-branding.js` uses `src/assets/mehta-logo-document.png`, copied from the existing optimized web logo: example invoice PDFs fall from about 1.08 MB to 56 KB without changing the supplied mark. Uploaded original invoices remain byte-for-byte unchanged.

Final deployed verification on 21 November 2026: 18 focused checks passed, lint/typecheck and Vercel production build passed, all 62 RDS migration checksums matched. Browser-driven deployed acceptance passed for draft creation/GST/preview/download, independent approval, blocked unconfigured issuance, closed-invoice copy retention/verification/exact retrieval, seven report downloads, restricted/anonymous access, customer mismatch/duplicate denial, mobile width and existing quotation compatibility. Additional CSRF, date-range and immutable-copy API denials passed. Earlier incorrect test selectors and one promotion-interrupted request are retained in raw diagnostic history. The verified test originals remain clearly fictional; unissued test drafts were cancelled. Billing settings remain empty at version 0. Final legal invoice issuance is **not live-certified**: no eligible TEST shipment or confirmed business/GST policy exists, and no IRN provider is configured. Its guarded transaction path passed a protocol-level test, which is not a substitute for statutory acceptance.

Run `node --test test/billing-documents.test.js test/document-branding.test.js test/quotation-source-policies.test.js`, `npm.cmd run lint`, `npm.cmd --prefix apps/web run typecheck`, and `npm.cmd --prefix apps/web run build`. Generate file-only fictional examples with `node scripts/sample-billing-pdfs.mjs`. No database is used by those sample/pure-test commands. Cloud browser acceptance evidence is private under `.vercel/acceptance/billing`, excluded from source upload and Git.

## Needs confirmation

- Real issuer GSTIN/address/contact, approved terms and signatory.
- Invoice origin per transaction, GST/IRN applicability and any applicable provider integration.
- Numbering prefix, correction/credit-note process and whether shipments can be billed in smaller splits.
- Final financial role grants and independent approval responsibilities.
- Report list, business formulas, retention and whether automatic verified Tally-copy ingestion is separately required.
