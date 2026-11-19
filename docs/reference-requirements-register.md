# Reference requirements register — 4 November 2026

## Authority and scope

The user's MASTER RULES and explicit P08–P66 prompts govern implementation. The supplied `Mehta Documents.zip` is evidence for document formats and business examples, not permission to import contacts, activate automation, change confirmed rules or send messages. The user authorised continuing through unblocked items in order. Prem-dependent decisions and the unapproved load-test window remain pending.

The ZIP was inspected in memory; its documents were not imported into CRM. It contains 21 files plus a directory entry: price workbooks and business emails with order, invoice, dispatch, payment, packing-slip, outstanding-statement and related attachments. Email attachments are reference samples only; no intake integration was changed.

## Usable examples and unresolved requirements

### Quotation reference review — 4 November 2026

The user identified `Mehta Documents/Quote.eml` and asked that it and the earlier documents be used as quotation drafting references. The email was inspected in place, including both MIME alternatives. It has no attachment. Its SHA256 is `822c810f8e2dbee690a196cce218450d24a325e8a448db1b97dcfe8f7aed38e8`.

Despite its subject, this is an incoming request for prices, not an issued quotation or approved pricing policy. It contains 11 Siemens item rows with source serial number, tag number, specification, model/part number, make and quantity, plus a heading of `Qty: 3 set`. Some part numbers repeat under different tags. The email supplies no selling prices, margin floor, cost basis, GST rates, quotation validity, approval limits or payment terms. Contact/signature details were not copied into business tables.

Drafting interpretation:

- Keep the source serial/tag, model code, specification and make available when preparing each line; select a verified existing CRM/Tally item. Do not create an item merely because its model appears in the request.
- Preserve repeated models under their distinct tags unless the salesperson explicitly reviews consolidation. Do not silently merge the request lines by part number.
- The relationship between the `3 set` heading and each row quantity is unconfirmed. Confirm whether quantities are per set or totals before applying any multiplier. No quantities were imported or multiplied during this review.
- Treat the plain-text and HTML bodies as alternatives of one message, not two separate enquiries.
- Use the request as source evidence; neither an email's text nor its signature authorizes sending, policy changes, automatic extraction or real record creation.

The earlier exported client plan was reread directly: `F4 Items, pricing and quotation …html`, `F2 Customer and CRM …html`, and `F16 Data migration and SKU master …html`, together with the top-level business-rule/conflict index. These are requirements evidence; proposal/pending sections remain distinguishable from confirmed meeting statements.

| Source requirement | Current quotation implementation / remaining work |
|---|---|
| F4: resolve customer rate contract, then slab, then the price-list version valid on the quotation date; customer classes include rate contract, medium discount, dealer network and new | The current editor is a manual draft editor. Automatic class/contract/slab/dated-list selection is **not complete**. Do not describe manually entered unit rate as a locked list price. |
| BR-01: list price is locked; use of an older price list requires approval | Dated price provenance, locked list-price display and older-version approval remain to implement with the pricing work. The supplier workbook has four levels versus three in the prompt; no choice is inferred. |
| F4 / BR-02: cost and margin restricted to authorized roles; green/blue/red flags and margin review | Existing policy/cost permissions, exact quotation calculations and independent approval are implemented and tested. The current floor-based flag interpretation is not proof that Prem confirmed the cost basis or the documented floor/negative-margin conflict. |
| F4 / F2: salesperson reviews discount within permitted limits; one salesperson owns a customer | Existing server assignment and business-rule gates remain. Role discount limits and approval levels must be supplied by the Owner; the source email does not set them. |
| F4: unknown code or missing price stops the quotation | Editor requires a CRM item and an explicit unit rate on each line. Automatic resolution against a confirmed SKU master and active price provenance remains unfinished. |
| F4: every revision has a new retained version; internal approval before sending | Existing versioned workflow and independent approval remain. Reading this reference does not authorize any outbound implementation or message. |
| F4: expiry, tax/rounding treatment and quote lapse | Validity and GST inputs now start empty. Existing decimal/tax math is implementation behavior, not evidence of client approval of all tax/rounding cases. F4 explicitly leaves validity/lapse and tax/rounding decisions open. |
| BR-17 / BR-18: items originate in Tally; CRM does not overwrite Tally | Use existing stable company-scoped links and item review. No Tally write or automatic business import was performed. |

This review does not confirm any global business values or clear the missing quotation-policy block. The sample supplies an RFQ layout, not a completed Mehta quotation/letterhead template.

| Reference | Intended use | Limit |
|---|---|---|
| `2026-2027 New Rc price list Connectwell.xlsx` | Supplier/customer price workbook layout for P30/P31 | Multiple customer-specific sheets require explicit review and mapping; prices are not global policy. |
| `pricelist level wise.xlsx` | Dated/level price import reference | Includes four levels; prompts request three. Prem must confirm supported levels before activation. |
| Siemens open-order email attachments | Deterministic spreadsheet review and reconciliation references | No email intake or automatic source ingestion authorised. P39 requires explicit ownership confirmation before implementation. |
| Sales/purchase-order PDFs and invoices | Field/layout evidence and manual comparison | Sample terms do not confirm warranty, credit, margin, approval or statutory policy. |
| Packing slips, dispatch PDFs, payment and outstanding documents | Evidence attachment and reconciliation field examples | No dispatch/payment outcome inferred from filename alone. |
| Attendance/contact workbook | None for CRM requirements | Unrelated company roster; excluded from CRM imports and requirements. |

No Johnson Lifts sample, explicit Connectwell supplier-PO export template, confirmed SKU master or bank-field mapping was identified. Ask for the relevant missing input when reaching P34/P35/P38/P43. Do not label these parsers/templates complete without the required source evidence.

## Sequence and blockers

### Additional PDFs supplied on 4 November

| File | Observed document | Requirements evidence |
|---|---|---|
| `9026207786.pdf` (12 pages) | Siemens supplier tax invoice to Mehta Electric Corporation | Multi-page invoice lines, material/part codes, quantity/UOM, gross price/discount, taxable amount, tax, customer/order and delivery-note references. Reference for retained evidence/manual invoice and receipt comparisons; no statutory issuer/provider decision inferred. |
| `10925-2601084.pdf` (6 pages) | KG Electro-Power purchase order issued to Mehta Electric Corporation | Customer PO header, delivery/payment terms, part/item/HSN codes, quantity/UOM, rate/discount, tax, withholding and totals. Reference for PO review and exact decimal comparison, including totals retained independently. |
| `1250031480.pdf` (1 page) | Vashi Integrated Solutions purchase order issued to Mehta Electric Corporation | Customer PO layout with list price, discount, net price, quantity/UOM, delivery date and taxes. Reference for review of line and header differences. |

All three have extractable text. None identifies Johnson Lifts or Connectwell, supplies a confirmed SKU master, or defines bank-report field mappings. Those specific prerequisites remain outstanding. Terms printed in these examples are document-specific evidence, not Owner-confirmed global rules. Files were read in place, not imported into business tables; no PDF intake/extraction feature was built from this review.

SHA256 evidence: `9026207786.pdf`: `4d96899edc4cec3c0d4e41078ea04432c80b1fd93a87014196da7b0376e4b325`; `10925-2601084.pdf`: `5f3c59992c9e6a78e1b169c584191ce555421d082afb7d45467604b5361efa8f`; `1250031480.pdf`: `9ad7f9ccbd09d4ac481eec62fe2ba6d88b34d21e833cd2e009ddd4470887e1bc`.

The user explicitly approved P39 **spreadsheet review only**. Email intake and extraction remain owned by the other engineer. This approval does not activate sending or permit a PDF extractor.

### Further source documents supplied on 4 November

| File | Evidence and use | Limits |
|---|---|---|
| `Mehta P.O 204.pdf` (5 pages) | Johnson Lifts customer PO `POTN10260800204`: part/drawing number, customer material ID, description, quantity, UOM, rate, basic amount, split tax, total and delivery schedule. **P35 now has a Johnson Lifts source sample.** | Preserve customer part/material IDs separately; table extraction order differs from visual column order. Document terms are not global policy. |
| `ORDER-0304 JOHNSONLIFT (1).xlsx` | Connectwell supplier purchase-order form, order `0304`, for Johnson Lift; sheets `Form` (120×20), `Master Price List` (3539×15) and term options. **P38 now has an actual supplier form reference.** | Contains lookup/formula cells and a missing Part No. with a code in Remarks. Do not execute formulas or silently move remarks into part fields. Embedded master prices are an example snapshot, not a confirmed universal SKU master or active price list. |
| `AO 338066 Mehta.pdf` (3 pages) | Connectwell acceptance of order, supplier PO reference `304`, with part, HSN, quantity/UOM, exact net prices/value and schedule lines. | Useful for supplier confirmation versus PO review; acceptance dates are not proof of receipt or dispatch. |
| `148450.Pdf` (1 page) | HCE Dynamics order acceptance with item/product codes, quantities, rates, packing charges, taxes, rounding and schedule date. | PDF text columns are interleaved; require deterministic verified mapping/review before any extraction result is accepted. |
| `consginment details.xlsx` | Siemens `ConsignmentDetails`, 7×13, with 2 business rows. Green header cells identify **Customer PO, Sales Order Number, MLFB, Qty Invoiced, ODN Number, Invoice Date, LR No & Date** (B/C/E/F/H/J/K). P39 ownership is confirmed for spreadsheet review. | Rows 4–7 are annotations/contact instructions, not consignments. No email address or title is an automation instruction. Green cells are evidence of proposed extraction columns; original additional identifiers remain available for review. |
| Both `Dispatch Document - DSLV-27005856 … .eml` files | Byte-identical duplicate email samples: one dispatch PDF, one packing slip and four test-report PDFs. Relevant to evidence retention/deduplication and dispatch review. | Inspect attachments as reference only; do not build/change email intake. A dispatch document is not signed proof of delivery. |

Content hashes: both emails `d2a26598318ba907f4710ce700ca99fbf72be1cda8447d910346ab543809fb76`; consignment workbook `d5a423a0bebb3bb4882318b9cd6728b756afaa2542058d3f6db9b5e503aa75c3`; HCE PDF `95089aec47bf07fd3882e4beea4242e2e0b402f7a6c4c932d47adfd003c8ec4f`; Connectwell AO `a775949149038b41b295618b0bd2d8426da9bb315fb0b62cc14fd8efd757614f`; Johnson PO `42258e36b76e15ea7b73c19aceae9896d66e96702d7c32c4d7a5b7fe77b17b72`; supplier form `6b501b9afdeed4a4ec0f20e788954d2a8c7862d421aced9077f1ba8bb8546557`.

These later files supersede the earlier missing-Johnson-sample/supplier-template finding. A confirmed SKU master and Prem's bank-field mapping remain outstanding. Inspection did not save or rewrite the original workbooks (including their unsupported embedded header/drawing/validation extensions).

- P13–P15: implemented company isolation and read-only order reconciliation; verification recorded in the implementation log.
- P16 onward: continue sequentially; preserve exact decimals, server permissions, rollback tests, reasons/audit for mutations, and source-company identity.
- P20–P23, P36, P41–P42, P56–P57: require Prem's mappings/directions/credit/invoice/GST/portal decisions. Direction remains off and rules empty until confirmed.
- P35: requires the Johnson Lifts sample. P38: supplier export must use a supplied/confirmed template. P39: user must confirm ownership before work starts. P43: needs bank mapping fields. P47: agreed RMA status/values required before activation.
- P59: prepare MFA controls but do not enforce without Owner confirmation. No Admin role is defined.
- P60: prepare backups/integrity/runbook; no restore to a second database or destructive restore without explicit authority.
- P62: prepare load-test tooling only until the user confirms a window; never run it silently.
- P65/P66: record actual acceptance results and outstanding dependencies; do not claim F1–F17 fully delivered from code presence alone.

### Additional quotation request: `Request for quotation.eml`

Inspected on 4 November 2026 as a user-supplied drafting reference. SHA256: `c56c2283ce1746d4e224fd465b21713b92c217956475e0c27b26a265f64ae424`. Plain-text and HTML are alternatives of one RFQ; the only attachment is an inline JPEG signature/logo, not a quotation or policy document.

The customer requests four RR-make flexible copper cable specifications, FRLSH insulation, 1100V, and compliance with IS-694, REACH and ROHS. Each listed request says 100 MTR; one specification lists red, yellow, blue and green together. Whether that 100 MTR is total or per colour must be reviewed before splitting quantities. The customer also requests stock availability, delivery lead time measured from PO date and a best/no-regret price.

Drafting implications: preserve requested make, size, colour, insulation, voltage and compliance wording; match verified item codes and metre UOM; review colour allocation; obtain actual stock evidence and an explicitly confirmed lead time; quote an approved selling rate. Requested compliance is not proof of certification. A no-regret price request does not authorize bypassing margin/discount approval. No stock, lead time, price, compliance claim or policy value was inferred or stored. The current editor can hold specifications in line descriptions and confirmed delivery terms in printed terms; dedicated source-backed stock/lead-time and automatic pricing remain unfinished.

### RFQ implementation update

The quotation editor now has dedicated saved fields for RFQ reference, quantity instructions/review, line/customer reference, tag, make, requested specification, reviewed availability/check date/source and lead time from PO date. These fields are versioned and public details are printed; availability sources remain internal. Set/colour instructions require quantity confirmation before submission. This supersedes the earlier statement that specifications and delivery information could only be placed in free-text descriptions/terms. Automatic pricing, actual inventory verification and certification decisions remain unconfirmed/unimplemented as recorded above.

### Supplied pricing references - 18 November 2026
User approved four source selling levels (rather than the prior three-level assumption), and permitted expired files as development references. Siemens sheet discounts are fractional Excel values; import must select FRACTION and retain the original reviewed value. Do not use master-price sheet or CP columns as a proven landed-cost policy. Connectwell contracts remain customer-exclusive, retain their validity, and include concurrent old/new blocks and formula cells requiring review. Workbook1 has 35 requested lines without a price or customer identity. Screenshot terms (45 days, 12/18-month warranty, LD, certificates, set/colour quantities) are requests, not seller acceptance. New internal requested-term review is separate from printed accepted terms. Historical reference drafts cannot be submitted or issued. Hidden workbook metadata was excluded from the source review. See source-review.json under verification-output/quotation-policy/2026-11-18/.

### 18 November 2026 - additional EML reference classification

- Reviewed hash-deduplicated EMLs and PDF/XLSX attachments from the user-supplied Mehta Documents folder. The inventory is verification-output/quotation-policy/2026-11-18/email-reference-review.json; original files were not changed.
- Multiple supplier/customer documents identify Mehta Electric Corporation as GSTIN 33AAGPM1577N1ZD. The source identity is documented but not combined with invented commercial policy to save quotation setup.
- KGEP CR4 / 45 Days credit, supplier warranty and late-payment interest remain scoped to that supplier transaction. Incoming stock enquiries and blank availability columns do not prove inventory. No global Mehta selling margin or cost basis was established.
