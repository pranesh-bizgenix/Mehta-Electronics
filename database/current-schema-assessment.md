# Current schema assessment

**Assessment date:** 2026-10-24  
**Evidence scope:** live local PostgreSQL schema, repository migrations and code, repository documentation, supplied ER diagram, and the supplied 2026-10-23 meeting transcript. The proposal PDF and exact 164-row response matrix were not provided; requirements that depend on them remain pending.

## Executive finding

The supplied ERD is a useful domain starting point, but it is not the current database schema. The application uses PostgreSQL 17.5, `public`, with 58 base tables, 122 foreign keys, and 16 applied, checksummed migrations. The application is a Node.js service using parameterized PostgreSQL queries directly; it does not use an ORM. A direct drop/recreate of `public` would break the current application.

The ERD models customer and supplier documents, allocations, invoices, dispatches, tracking, and extraction. The existing application instead contains a working enquiry/quotation/order flow, CRM procurement records, shipment/delivery records, customer/item masters, and a read-only Tally connector/import layer. Several ERD concepts are absent, while some existing concepts are stored in JSONB workflow payloads or are embedded in sales orders.

The requested local reset is explicitly authorized. A fresh PostgreSQL custom-format recovery archive was created at `data/backups/before-schema-redesign-20261024.dump` before any destructive operation. The archive is 88,972,356 bytes. No database rows or schema have been changed by this assessment. The reset remains deferred until a replacement migration and application compatibility tests pass.

## Verified live database inventory

The configured target was verified as local database `mehta_electronics_local`, schema `public`, PostgreSQL 17.5. At inspection, there were no other connected sessions.

| Area | Verified row counts |
|---|---|
| Authentication and audit | `users` 1; `sessions` 8; `audit_logs` 69 |
| CRM masters and sales | `customers` 1; `customer_contacts` 0; `items` 0; enquiries, quotations, and sales orders currently 0 |
| Current order / quotation workflows | Workflow, revision, version, shipment, and document records currently 0 |
| Procurement | Vendors, requests, RFQs, supplier POs, GRNs, and supplier documents currently 0 |
| Tally connector and import | `tally_connectors` 30; `tally_sync_jobs` 4; `tally_upload_sessions` 7; `tally_upload_chunks` 519; connector heartbeats 6 |
| Imported Tally company/master data | Companies 1; groups 78; ledgers 4,149; stock items 10,988; raw payloads 24; run datasets 24; warnings 15; quarantine records 0 |
| CRM/Tally links | `crm_parties` 1; CRM customer-part mappings, item links, and company-scoped profile extensions currently 0 |

Counts are a point-in-time inventory, not business acceptance evidence. No personal row values or credentials are included here.

## Existing implementation and migration evidence

- `database/postgres/migrations/0001`–`0003` implement connector setup, sync jobs, upload sessions/chunks, and Windows pairing.
- `0004` creates authentication, customers/contacts, items, enquiries, quotations, quotation lines, revisions, sales orders/lines, direct CRM sync jobs, and audit logging.
- `0005` stores company-scoped Tally imports, raw payloads, datasets, warnings, quarantined records, groups, ledgers, and stock items.
- `0006`–`0011` add CRM party/item mapping and profile extensions, archival metadata, audit/immutability guards, and deletion protections.
- `0012` adds quotation pricing, versioned snapshots, approvals, and events.
- `0013`–`0014` add CRM order workflow, shipment/line records, original PO/delivery documents, and dispatch retry guards.
- `0015`–`0016` add CRM procurement vendors, requests, RFQs/replies, supplier POs, GRNs, supplier documents, and procurement history.
- Runtime code uses direct SQL across `src/app.js`, `src/db.js`, `src/crm-modules.js`, `src/quotation-workflow.js`, `src/sales-orders.js`, `src/procurement.js`, and Tally services/routes. Those table names and response contracts are compatibility dependencies.
- Financial columns use PostgreSQL `NUMERIC(20,6)`. Quotation calculations use explicit decimal arithmetic and paise rounding; changing these rules would change existing behavior.
- The Tally connector is documented and implemented as read-only. Imported snapshots and reconciliation records must not be treated as CRM-owned ledger/accounting records or silently overwritten.
- Procurement records currently use JSONB payloads for several header/line details. Existing supplier document kinds include acceptance, but there is no normalized supplier acceptance-line table.

## Image ERD comparison

| ERD concept | Current implementation | Assessment |
|---|---|---|
| Parties with legal name, GSTIN, role flags | `customers`, `crm_parties`, and `crm_procurement_vendors` are separate representations | Partial and duplicated. A canonical party model needs role and legacy/API identity mapping before application rewiring. |
| Customer PO header, lines, schedules | PO number/date and PO source are represented on sales-order/workflow records; original PO bytes are retained | No normalized customer PO / line / schedule model. The diagram's one-to-many schedule cardinality is plausible but the schedule lifecycle and revisions are unconfirmed. |
| Supplier PO header and lines | `crm_supplier_pos` exists; detailed commercial data is carried in JSONB | Partial. Supplier PO line identity, quantities, UOM, tax, price, and revision history are not first-class relational rows. |
| Sales order and lines | `sales_orders`, `sales_order_lines`, CRM workflow/version/event records | Implemented, with compatibility links to quotation/customer and controlled fulfilment. Existing order APIs and statuses must be preserved or versioned. |
| Supply allocations | No matching allocation table | Absent. Allocation quantity, source, reallocation, and over-allocation policy require confirmation. |
| Supplier acceptances and lines | Supplier documents can be classified as `ACCEPTANCE`; manual reviewed data is attached to a supplier PO | Partial document storage only. There is no acceptance entity/line model or confirmed multiple-acceptance/revision policy. |
| Sales invoices and lines | No invoice tables or posting workflow found | Absent. Invoice issuer, numbering, tax, accounting ownership, cancellations, and Tally identity are pending. |
| Dispatches, lines, tracking | `crm_shipments` and `crm_shipment_items` support dispatch quantities and delivery state/proof | Partial. LR and transporter are present in workflow data; separate tracking-event history and evidence-backed delivery semantics are not complete equivalents. |
| Source documents and extraction runs | Original customer PO, delivery proof, and supplier documents are stored in domain-specific tables; no generic extraction pipeline | Partial document retention; generic file identity, extraction versions/results, corrections, review history, and resulting-record links are absent. |

## Meeting evidence and classification

The 2026-10-23 transcript is client-provided evidence, not a complete approved requirements matrix.

| Classification | Evidence and implications |
|---|---|
| Client-confirmed in the meeting | Outbound email must remain a draft until an employee approves it; unclear cases must request missing information rather than send an asserted answer. Multiple customer POs/orders and partial billed/fulfilled quantities matter. Customer-specific pricing and repeat-customer workflows were discussed. The client explicitly excluded bank-email automation in that discussion. |
| Client-requested, details incomplete | Inquiry/quotation responses, pending-order follow-up, invoice/shipment status responses, warranty/customer-support workflows, selected PO extraction, pricing-list import, reminders/KPIs, and broader accounting/Tally data visibility. These are requests, not proof that the application implements them. |
| Existing behavior, code-verified | CRM authentication/RBAC, enquiries, quotations/revisions, orders, delivery/dispatch workflows, procurement, audit history, and read-only Tally connector/import/reconciliation paths exist in repository code and migrations. |
| Team proposal | The supplied ERD and the proposal-derived summaries in the master prompt. The full proposal PDF and requirement matrix are missing. |
| Pending confirmation | Tally ownership/direction and write authorization; exact pricing tiers/approval boundaries; document extraction acceptance; invoice and statutory rules; payment/receivable/payable ownership; bank reconciliation/PDC; allocation/quantity policies; numbering scope; and financial rounding/currency behavior. |

The transcript includes discussion of two-way Tally synchronization, invoices, receipts/payables, BRS, cheques/PDC, GST/TDS/TCS, and bank-wise records, but does not specify field ownership, safe write APIs, retry/idempotency behavior, legal controls, or reconciliation rules. The implementation remains read-only until those details are approved.

## High-risk design gaps to resolve in the target

1. Define the canonical party identity and preserve current customer, vendor, and Tally-link identifiers through compatibility mappings.
2. Separate customer PO source-document identity from the sales-order transaction and support multiple PO lines/schedules without double-counting.
3. Normalize supplier PO lines, acceptance documents/lines, receipts, and allocations only where supported by verified workflows.
4. Define invoice and payment ownership before adding accounting transactions or Tally write paths.
5. Keep source-document originals, extraction attempts, reviewer corrections, and links to created business records as distinct, auditable concepts.
6. Preserve existing API response shapes/statuses while changing internal relations; verify every affected route and frontend workflow.
7. Keep unresolved rules non-operative. A database constraint or trigger must not encode an inferred commercial policy as though the client approved it.

## Destructive reset status

The configured local database reset is approved but intentionally not yet performed. Before reset, the replacement migration must recreate every required table, seed/bootstrap behavior, indexes, constraints, triggers, and compatibility surfaces. Test the full migration and application against a disposable database first. Keep the verified pre-change archive and existing backups unchanged.
