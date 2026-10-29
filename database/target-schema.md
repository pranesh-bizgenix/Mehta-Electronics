# Target schema design

**Status:** Structural schema implemented by PostgreSQL migrations `0017`–`0020`; workflow behavior and unresolved business policies remain inactive.  
**Inputs:** Supplied ERD and master prompt, current PostgreSQL migrations/code, repository business-rule register, and Prem Mehta's 2026-10-23 meeting transcript. The proposal PDF and 164-row response matrix remain unavailable.

The image ERD is the baseline to validate, not an approved physical schema. This design separates established current behavior from proposed domain entities. It does not authorize financial posting, statutory calculations, new automatic approvals, or Tally writes. Those remain pending until the relevant rules and ownership are confirmed.

## Implementation status

Migration `0017_customer_po_normalization.sql` adds canonical parties/parts and normalized customer PO headers, lines, schedules, versions, and sales-order links. Managed order saves dual-write the normalized PO inside the existing transaction.

Migration `0018_target_domain_schema.sql` adds structural storage for party/product detail, pricing imports, normalized procurement, invoices, dispatch/tracking, source documents and extraction, Tally reconciliation, workflow execution, approvals, email drafts/send attempts, reminders, and notifications. Migration `0019_target_schema_integrity.sql` adds further relationship guards, source-document immutability, and lookup indexes. Migration `0020_automation_approval_guards.sql` enforces that an automation email send attempt has an approval for the exact current draft fingerprint and that required context is marked ready. These changes are additive and do not replace existing application tables or change their API contracts. They have been applied to the configured `mehta_electronics_local` database.

The new entities are a persistence foundation, not enabled automation or accounting workflows. Pending commercial, numbering, tax, allocation, and Tally ownership rules are deliberately not enforced as business constraints. Payment, payable, bank reconciliation, cheque/PDC, TDS/TCS, and statutory posting domains remain outside this schema until their requirements are approved. No reset or business-row copy was performed as part of migration `0018`.

## PostgreSQL conventions

- Use PostgreSQL and the repository's ordered, checksummed migration runner. Never edit an already-applied migration.
- Use UUID primary keys for newly designed business entities; retain existing integer CRM IDs behind explicit compatibility mappings until API migration is complete.
- Store business timestamps as `timestamptz`; use `date` for a document's civil date and `numeric` for amounts and quantities. Never use floating-point types for financial values.
- Keep internal IDs, human document numbers, source-system IDs, and external business identifiers distinct.
- Preserve document-supplied totals and line values separately from calculated totals when reconciliation requires both.
- Model party roles as rows in a role relation rather than a mutable comma-delimited `role_flags` string. Allow a party to hold multiple roles.
- Avoid global uniqueness for legal/business identifiers until company, branch, financial-year, and source-system scope is confirmed.
- Keep audit history append-only. Document originals and extraction results are immutable; corrections and decisions are additional records.
- Do not encode pending commercial policies as database triggers or implicit defaults.

## Core master data

### Parties

Proposed entities:

- `parties`: canonical legal/business identity, normalized legal name, optional raw GSTIN/PAN, active/archive state, and audit metadata.
- `party_roles`: `(party_id, role)` relation for customer, supplier, issuer, transporter, and any other confirmed roles. One party may hold multiple roles.
- `party_identifiers`: identifier namespace/type/value, optional issuing company/source, and effective dates. Uniqueness is scoped only after identifier ownership is confirmed.
- `party_contacts` and `party_addresses`: multiple contacts/addresses with primary/effective flags; keep contact data separate from the legal party.
- `party_external_mappings`: scoped Tally company and external master identifiers, retaining source identity and synchronization state.

This replaces neither `customers` nor `crm_parties` until compatibility mappings and route changes are tested. Current customer ID, CRM party ID, procurement vendor ID, and imported Tally ledger ID are separate existing identities.

### Parts and pricing

- `parts`: CRM-owned item/part identity, description, brand/principal, UOM, HSN classification, and lifecycle state.
- `part_identifiers`: internal part code, customer part number, supplier part number, Tally item identity, and other identifiers, each with source/type scope and effective dates.
- `units_of_measure`: canonical code and display metadata. Any conversions require explicit conversion factors and approval; no guessed conversion is allowed.
- `price_lists` and `price_list_items`: customer/brand-specific price versions, effective intervals, source/import provenance, and item pricing components.
- `price_list_imports` and `price_list_import_rows`: source file, hash, parser/version, original row, validation/review status, and accepted mapping to a price version.

The meeting confirms customer-specific/repeat-customer pricing, three pricing structures, periodic product-price updates, and that customer-facing quotations must not reveal list price/discount internals. It does not establish the tier definitions, approval thresholds, effective-date precedence, import template, or retroactivity. Those remain non-operative until approved.

## Customer demand and sales

- `customer_pos`: customer party, external PO number/date, received/source-document reference, currency, supplied total, lifecycle/revision, and audit metadata.
- `customer_po_lines`: PO line sequence, optional mapped part, original customer part number/description, quantity/UOM, supplied rate/tax/line total, and source-row identity.
- `po_line_schedules`: customer PO line, schedule sequence/date/quantity, with source provenance. Schedule changes must be versioned; schedule quantity reconciliation requires an approved rule.
- `enquiries` / `enquiry_lines`: preserve the existing CRM inquiry contract, with customer and salesperson ownership.
- `quotations` / `quotation_lines`: preserve the existing workflow contract, with versioned public and private pricing snapshots. Public documents disclose approved sell price and agreed fields, not internal list-price/discount data.
- `sales_orders` / `sales_order_lines`: customer, optional source quotation, customer PO association, document identity/date, approval state, ordered quantity and immutable price snapshot. A sales order can contain multiple lines and can reference only eligible PO line demand.
- `supply_allocations`: sales-order line, supplier-PO line, allocated quantity, status/version, and audit actor. Concurrent allocation limits require transaction-level enforcement; exact excess/reallocation rules remain pending.

Existing sales orders are not universally quotation-backed, and existing order APIs already support manual orders and customer PO identity. The target must retain those behaviors unless a reviewed API-version change is approved.

## Procurement and supplier response

- `supplier_pos`: supplier party, external supplier order number/date, optional CRM request/RFQ, currency, supplied totals, status/version, approval fingerprint, and audit metadata.
- `supplier_po_lines`: supplier PO, sequence, part, ordered quantity/UOM, source supplier part code, price/tax snapshots, and source provenance.
- `supplier_po_schedules`: supplier PO line, date/quantity, and revision provenance where schedule behavior is confirmed.
- `supplier_acceptances`: supplier PO, supplier acceptance number/reference/date, source document, supplied total/rounding, revision and review state.
- `acceptance_lines`: acceptance and supplier PO line, accepted quantity/UOM/net price/schedule, and source-line identity.
- `goods_receipts` / `goods_receipt_lines`: candidate normalized names for existing GRNs, received/accepted/rejected quantities, actual part/price/tax, and independent posting/review evidence.
- `procurement_events`: append-only actor/action/reason/version history.

Current procurement already supports vendors, requests, RFQs, replies, approvals, supplier POs, GRNs, supplier source documents, and audit history. Its JSONB payloads are a compatibility surface to normalize only after a deterministic payload-to-column mapping and regression tests exist.

## Invoice, dispatch, and delivery

- `sales_invoices`: issuing party, customer party, scoped invoice number/date, currency, source-system/voucher identity, original supplied totals, calculation totals, cancellation/amendment state, and audit history.
- `invoice_lines`: invoice header, optional/required sales-order line according to the approved source rule, item/description/UOM/quantity/price/tax/discount snapshots, and original line identity.
- `dispatches`: transporter, LR number/date, vehicle/e-way references, document links, and dispatch state.
- `dispatch_lines`: dispatch, invoice line or approved order-line source, and dispatched quantity.
- `tracking_events`: append-only event time, source/status/location/evidence, actor/source, and idempotency key. A tracking event alone must not imply confirmed delivery.
- `delivery_confirmations`: explicit confirmation actor/time and proof reference, separate from carrier events.

Invoice numbering scope, whether every invoice must reference an order, cancellation/amendment behavior, statutory treatment, partial-invoice reconciliation, and delivery-completion rules are not fully approved. Do not create or post invoices from the present read-only Tally connector.

## Source documents and extraction

- `source_documents`: immutable file hash, storage reference/bytes policy, original name/MIME/size, document type, issuer candidate, ingestion provenance, and lifecycle state.
- `document_associations`: explicit links to customer POs, supplier POs/acceptances, invoices, dispatches, and other supported business records. Prefer typed association tables with real foreign keys; avoid an unconstrained polymorphic record ID.
- `extraction_runs`: document, engine/model/version, run time, raw result JSON, validation outcome, and result checksum. Each retry/reprocess is a new row.
- `extracted_fields`: normalized field name/value, confidence as supplied, source page/region, and validation state.
- `document_reviews` / `field_corrections`: append-only human decisions, prior and corrected value, reviewer, reason, and review time.

The ERD's unique `file_hash` should not prohibit a document from being deliberately associated with multiple valid records. Use hash-based duplicate detection plus explicit ingestion/association decisions, not an unconditional single-association rule.

## Email automation and approvals

Proposed entities:

- `email_accounts` and `email_threads`: authorized mailbox identity and linked CRM/customer/order context, subject to provider/security approval.
- `email_messages`: direction, provider message/thread IDs, parsed headers, safe body/reference, attachment links, and received/sent timestamps.
- `workflow_definitions` / `workflow_versions`: owner, trigger, versioned rules/configuration and activation state.
- `workflow_executions` / `workflow_steps`: trigger input, execution state, retries, error visibility, idempotency key, and timestamps.
- `approval_requests` / `approval_decisions`: record/version/payload fingerprint, requester, reviewer, outcome, reason, and immutable decision history.
- `email_drafts` / `email_send_attempts`: generated recipient/content references, approval binding, send state, provider ID, retry/idempotency, and failure response.
- `reminders` / `notifications`: assigned user, due time, state, and delivery evidence.

The meeting confirms that outbound messages generated from CRM data require human approval and unclear cases must ask for details. Automated bank-email handling was explicitly excluded in the discussed workflow. Exact eligible intents, response templates, time windows, mailbox permissions, attachment rules, and reminder SLAs remain pending.

## TallyPrime and accounting boundary

- Keep Tally company identity distinct from CRM party/part identity.
- Add scoped external mappings and retain imported source keys, company, import run, raw payload, and timestamps.
- Track sync job items, conflicts, and reconciliation outcomes independently; retries must be idempotent and visibly recoverable.
- The existing path is read-only. Two-way sync, voucher creation, invoice/receipt/payable posting, and ownership of changed fields are proposed or discussed, not implemented or approved for writing.
- Payments, allocations, payables, bank statements/reconciliation, cheques/PDC, TDS/TCS, and statutory tax ledgers are candidate accounting domains, not committed tables for the first migration. The exact source of truth, authorization, reversal, audit, and reconciliation rules are still open.

## Compatibility and release boundary

1. Preserve existing `GET/POST` API shapes, auth/CSRF, RBAC, status transitions, decimal behavior, audit, retry/idempotency, and read-only Tally guarantees.
2. Add explicit legacy-ID mappings; do not reuse customer, supplier, item, or Tally IDs across namespaces.
3. Normalize one bounded domain at a time with forward migrations, compatibility views/adapters where they remain safe, and a rollback/recovery rehearsal.
4. Keep proposal-only capabilities outside runtime behavior until their requirements and acceptance tests are approved.
5. Only after the complete migration and app pass disposable-DB tests may the confirmed local database be reset. Its verified archive must remain available for recovery.
