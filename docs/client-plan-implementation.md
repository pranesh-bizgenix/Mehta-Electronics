# Client plan implementation and remaining decisions

Source: **Mehta ControlDesk – Client Requirements & Development Plan (1).pdf**, 70 pages, supplied from the client's Downloads folder. This register follows its F1–F17 feature headings. Client statements, proposed designs and unresolved decisions in that document have different authority: a proposal is not recorded stakeholder acceptance. The earlier 164-row response matrix is still unavailable; its individual requirements are not invented here.

Updated: 2 November 2026, IST. Email and WhatsApp integrations remain inactive at the user's explicit request. No messages were sent during implementation or verification.

## Workflow available in the application

1. Maintain customers, registered contacts, customer part numbers and CRM product mappings.
2. Record enquiries manually; retain incoming source messages separately with duplicate detection. Bank/spam messages produce no case, draft or reply.
3. Prepare quotations using confirmed pricing policy and exact decimal calculations; submit for independent review. Customer PDFs show net selling prices, with internal margin/cost details excluded.
4. Record an approved customer-specific fixed-quantity rate contract where applicable. Expired contracts cannot price a rate-contract customer's quote; another customer's contract never applies.
5. Retain the customer's original PO, compare against the quotation, check credit and stock, then obtain order review.
6. Create purchase requests and multi-vendor RFQs, record supplier replies, compare offers, and let a person choose the winner.
7. Independently review supplier POs, receive goods and reconcile quantities/rates. Retain supplier originals and manually verify extracted fields.
8. Dispatch approved quantities, retain LR/transport details, and confirm delivery from uploaded evidence. Time passing alone does not confirm delivery.
9. Record existing invoice references, collections, receipts and payment authorisation requests. A different authorised person confirms a receipt; partial payment leaves the collection open.
10. Track complaints, warranty and returns with an owner, distinct backup, response time and history. Warranty approval requires a confirmed policy; return approval requires inspection evidence.

## Feature coverage

“Implemented” below means the stated internal behavior exists, not that the whole proposed feature is accepted or externally connected.

| Source feature | Internal implementation / screen | Limits and remaining inputs |
|---|---|---|
| F1 Foundation | Access matrix, audit, configurable rules, work ownership/backup, SLA engine, tasks, exceptions, switches; `/users`, `/rules`, `/work`, `/tasks`, `/exceptions`, `/audit` | Real business SLA values, escalation owners, deployment/backup schedule and acceptance still need confirmation. Unconfigured rules are shown as unavailable. |
| F2 Customers and CRM | Customer 360; assigned-salesperson checks on enquiry/quote creation; first sent executive quote binds an unassigned customer; Owner sets classification, pricing class and credit exemption; `/customers`, `/contracts` | Existing customer assignments must be reviewed by Admin. Class-specific discount formulas and approval hierarchy remain client decisions. Fixed contracts use product, customer, quantity, price and validity, with independent approval. |
| F3 Enquiry capture | Existing manual enquiries plus source-retaining manual intake, category routing, source-ID dedupe and bank/spam suppression; `/enquiries`, `/operations` | Email/WhatsApp adapters deliberately inactive. No claim of live mailbox polling, attachment OCR or model-based classification. Human-entered classification must be checked. |
| F4 Quotations | Versioned quotes, cost/policy checks, independent approval, net-price PDF, history, original attachments; `/quotations` | Confirm pricing values, company details and applicable approval policy in settings. Legacy unmanaged email cannot bypass managed approval. No external mail was sent by this work. |
| F5 Vendor RFQ | Purchase request, invitations, priced replies, side-by-side offers and human winner; `/purchasing` | Supplier invitations/reminders are not sent automatically. Actual supplier contacts and agreed terms are required. |
| F6 Purchasing and receipt | Supplier PO review, original documents, GRN, discrepancy comparison and independent posting; `/purchasing` | Customer-specific supplier templates and extraction adapters need real source documents; generic Excel export is labelled as generic. |
| F7 Customer PO and credit | PO snapshot/original, field comparison, verification fingerprint, current-source credit checks, Owner exemption, review, stock checks; `/orders` | Confirm `credit.validation` exposure basis, maximum source age and unavailable-balance policy. Until configured, non-exempt approval is blocked. This is not bill-level Tally reconciliation. |
| F8 Dispatch and delivery | Partial quantities, retry protection, LR/transporter references, delivery proof upload and evidence-based confirmation; `/orders` | No transporter integration or automatic delivery claim. Enter existing statutory transport references where applicable. |
| F9 Invoice/GST | Verified existing invoice-reference register only; Owner/Accounts; `/operations` | **Blocked:** confirm invoice origin, GST/IRN/e-Way provider, API credentials and approved statutory workflow. ControlDesk does not issue statutory invoices or fabricate IRNs. |
| F10 Tally | Read-only imported masters, complete field browser, source/history/reconciliation and permission-safe exports; `/tally` | Existing user read-only rule overrides any document proposal for two-way posting. Vouchers/invoices absent from the connector remain explicitly unavailable. See Tally visibility audit/report. |
| F11 Automated communication | Existing draft/approval gates, registered recipients, switches and audit; `/messages`, `/automations` | Integrations inactive. New reminder definitions start OFF. Material-delivered timing, templates and activation remain unconfirmed. No new automated draft generation is claimed. |
| F12 Collections and payments | Existing-invoice references, collection cases, receipt confirmation, overpayment prevention, partial-payment hold, policy/checklist-gated payment authorisation; `/operations` | No bank-feed reconciliation or payment transfer. Ageing/reminder cadence, allocation policy and bank adapter still need confirmation. Only Owner/Accounts can access financial cases. |
| F13 Support/RMA | Complaint, warranty and return workflows; revised findings retained before/after; response time; independent decisions; `/operations`, customer 360 | Configure `warranty.policy` and `payments.authorisation` only after confirmation. Proposed one-year/48-hour values were not silently adopted. RMA shipping/replacement automation is not implemented. |
| F14 Owner dashboard | Existing pipeline, SLA, exceptions, approvals, margin/activity; open support/collection counts and pending human decisions linked to exact cases; `/dashboard` | Confirm remaining business KPIs/targets. No inferred revenue from missing Tally vouchers. |
| F15 Mobile/portals | Native responsive screens using the existing design system | Separate external customer/vendor portals and identity/sharing rules remain pending. Existing internal screens do not create a public portal. |
| F16 Bulk price lists | CRM items and manually managed dated price lists/tiers; `/items` | Bulk PDF/Excel ingestion at 12–15k lines is **not complete**: needs actual files, templates, conflict rules, validation/review and scale acceptance. |
| F17 Supplier document extraction | Retained supplier originals and manual comparison/review; `/purchasing` | Automatic Connectwell/HCE/RR Kabel/Siemens extraction is **blocked on actual source samples and confirmed mappings**. Filenames listed in the plan are not sample contents. |

## New implementation

- Additive migrations `0029_client_operations.sql` and `0030_customer_contracts.sql`, with forward permission adjustment `0031_contract_reviewer_permissions.sql`: customer controls, versioned operations, immutable intake originals/events and fixed rate contracts. No imported Tally table is rewritten.
- `public/operation-descriptors.js` drives case fields, types, labels, roles and UI forms/details. Controllers, services and repositories live in `src/modules/operations`.
- Native screens: `/items`, `/purchasing`, `/orders`, `/contracts`, `/operations`; customer 360 links related cases by ID. Existing quote/Tally native screens are preserved.
- Exact amounts are retained as decimal strings/numeric columns; financial cases are rejected on the server for roles outside Owner/Accounts, including direct detail/list requests. Original intake text is restricted to those roles because it may contain financial information.
- Mutations carry reasons, versions and history; maker/checker decisions reject the creator. Source IDs and hashes prevent changed messages from replacing stored originals.
- All test writes use a random schema in the existing `DATABASE_URL` database and clean up afterwards. No separate database or alternate base connection is created.

## Verification

Commands and results are recorded here as checks finish; browser evidence is in `output/client-plan-review/verification.json` and corresponding PNGs. These are synthetic acceptance fixtures isolated from imported/business data, not mock production data.

- `npm.cmd test`: 90 passed, 0 failed, 5 explicitly optional database suites skipped.
- Focused opt-in quotation, procurement and sales-order suites: 7 passed, 0 failed before the final follow-up checks.
- Focused CRM CRUD integration suite: 3 passed; focused operations/dashboard/quote/order/procurement checks: 12 passed, one optional CRM run subsequently verified separately.
- Native browser acceptance: 10 workflow checks passed, 20 screenshots (1440/390 px, light/dark), no page errors or serious/critical structural accessibility findings (colour contrast excluded from this automated check).
- Web TypeScript and design-token checks passed.
- Native Next.js production build passed.
- `test/client-operations.test.js` verifies source dedupe/immutability, bank suppression, non-finance denial, do-not-quote, fixed contract exclusivity/exact price, expired terms, customer binding restriction, partial/full receipt confirmation, maker/checker, warranty policy and payment checks.
- `scripts/verify-client-plan.mjs` exercises real HTTP/native UI in a random schema, desktop/mobile light/dark, customer links and direct server denials. It does not run against production records.

## Activation and remaining work

Migrations are applied and their checksums validated in the existing database; see `client-plan-migration-verification.json` for the before/after imported-table integrity check. Future installations should apply additive migrations using `npm.cmd run db:migrate:postgres` before starting the updated application. Do not use demo seeding against imported business data. Review customer classifications/assignments, pricing and confirmed rules through the UI. Keep automation switches OFF while integrations are inactive.

The internal workflows are a substantial implementation of the plan. It would be inaccurate to label F1–F17 completely delivered: the external adapters, statutory issuance, bulk parsers, vendor templates, portals and unresolved policy decisions above still require work and client inputs. No stakeholder acceptance is inferred from passing tests.
