# Data dictionary

**Status:** Target logical dictionary with physical structures implemented in PostgreSQL migrations `0017`–`0020`. Items marked **pending** remain non-operative and must not be treated as implementation instructions.

## Conventions

- `id`: internal UUID for new records; legacy integer IDs remain mapped during compatibility work.
- `created_at`, `updated_at`: UTC-aware `timestamptz`; append-only history records use `created_at` and do not update.
- `created_by` / actor fields: FK to authenticated CRM users where the action is performed by a human.
- Money and quantity: exact `numeric`; no `real`/`double precision`. Currency and scale require an approved policy.
- `source_*`: retain original source value/identity separately from normalized CRM values.
- `version`: optimistic-concurrency revision, not a business sequence number.

## Party and product master

| Table | Important columns | Meaning / constraints |
|---|---|---|
| `parties` | `id`, `legal_name`, `normalized_name`, `gstin`, `pan`, `status`, timestamps | Canonical legal/business identity. Do not globally unique GSTIN or legal name until branch/registration rules are approved. |
| `party_roles` | `party_id`, `role`, `valid_from`, `valid_to`, `status` | One row per role held by a party; unique party/role where periods do not overlap. Role vocabulary pending. |
| `party_identifiers` | `party_id`, `identifier_type`, `identifier_value`, `issuer_scope`, `valid_from`, `valid_to` | Customer/vendor codes, registration identifiers, and source-specific keys. Uniqueness is scope-dependent. |
| `party_contacts` | `party_id`, `name`, `designation`, `email`, `phone`, `is_primary`, `status` | Multiple named contacts; primary-contact rules pending. |
| `party_addresses` | `party_id`, `address_type`, address components, `valid_from`, `valid_to` | Billing, shipping, branch, and other addresses. Place-of-supply use must be confirmed. |
| `party_external_mappings` | `party_id`, `system`, `company_id`, `external_id`, `external_key`, `sync_state` | Links internal party to an external master without reusing external IDs as PKs. |
| `brands` | `id`, `name`, `principal_party_id`, `status` | Product brand/principal identity; relationship needs source-data review. |
| `units_of_measure` | `code`, `name`, `dimension`, `status` | Canonical UOM. Conversion factors are separate and only valid when approved. |
| `parts` | `id`, `part_code`, `description`, `brand_id`, `hsn_code`, `base_uom_code`, `status` | CRM-owned product/part master. HSN validation source/effective dates pending. |
| `part_identifiers` | `part_id`, `identifier_type`, `identifier_value`, `party_id`, `company_id`, `valid_from`, `valid_to` | Internal, customer, supplier, and Tally part-code mappings; scope-aware uniqueness. |
| `price_lists` | `id`, `owner_party_id`, `brand_id`, `name`, `currency`, `version`, `valid_from`, `valid_to`, `status`, `source_document_id` | Versioned source price list/rate contract. Pricing precedence and three-tier semantics pending. |
| `price_list_items` | `price_list_id`, `part_id`, `list_price`, discount components, net price, effective dates | Exact source and derived pricing values. Store only approved calculation fields; internal list/discount details stay private in customer documents. |
| `price_list_imports` | `id`, `source_document_id`, `format`, `parser_version`, `status`, `reviewed_by` | Provenance and review of imported Excel/PDF price lists. Automatic PDF parsing is proposed, not verified. |
| `price_list_import_rows` | `import_id`, `row_number`, `raw_row`, `parsed_fields`, `validation_state`, `part_id` | Preserves source row and review/mapping outcome. |

## Customer demand, sales, and procurement

| Table | Important columns | Meaning / constraints |
|---|---|---|
| `customer_pos` | `id`, `customer_party_id`, `po_number`, `po_date`, `currency`, `source_total`, `document_id`, `status`, `version` | Customer-issued PO, separate from CRM sales order. Numbering scope and currency rule pending. |
| `customer_po_lines` | `id`, `customer_po_id`, `line_number`, `part_id`, `customer_part_number`, `description`, `quantity`, `uom`, `source_rate`, `source_tax`, `source_total` | Immutable source-line facts plus optional CRM part mapping. |
| `po_line_schedules` | `id`, `customer_po_line_id`, `schedule_number`, `schedule_date`, `quantity`, `version` | Delivery schedule evidence; schedule totals and amendments pending. |
| `enquiries` / `enquiry_lines` | Current CRM identifiers, customer, owner, state, product/description, quantity, target price | Existing inquiry API/workflow. Preserve route contract and state history. |
| `quotations` / `quotation_lines` | Current CRM identifiers, customer, enquiry, validity, state, item, quantity, UOM, sell rate, discount/tax inputs | Existing quote APIs and immutable workflow snapshots. Internal price breakdown must not leak to customer output. |
| `sales_orders` | `id`, `order_number`, `customer_party_id`, `customer_po_id`, optional `quotation_id`, `order_date`, `promised_date`, `status`, `version` | Order accepted by CRM; current app also permits manual orders. |
| `sales_order_lines` | `id`, `sales_order_id`, optional source PO/quote line, `part_id`, `quantity_ordered`, `uom`, `sell_price_snapshot`, `status` | Preserve product and commercial snapshot as sold. |
| `supply_allocations` | `id`, `sales_order_line_id`, `supplier_po_line_id`, `quantity`, `status`, `version` | Procurement coverage for customer demand. Prevent invalid totals transactionally; exact policy pending. |
| `purchase_requests` | `id`, `number`, source order/reference, `payload` or normalized request lines, `status`, `version` | Existing procurement request concept. Normalize child lines in target. |
| `rfqs` / `rfq_vendors` / `rfq_vendor_replies` | RFQ identity, invited supplier, response version, commercial/lead-time/validity fields, winner state | Existing procurement workflow; preserve comparison/selection history. |
| `supplier_pos` | `id`, `number`, `supplier_party_id`, optional RFQ/request/order, `order_date`, `currency`, totals, `status`, `version` | CRM-issued supplier order, not a Tally purchase voucher. |
| `supplier_po_lines` | `id`, `supplier_po_id`, `line_number`, `part_id`, `supplier_part_number`, `quantity`, `uom`, `unit_price`, tax fields | Proposed normalized replacement for embedded supplier PO JSONB line data. |
| `supplier_po_schedules` | `id`, `supplier_po_line_id`, `schedule_number`, `schedule_date`, `quantity`, `version` | Supplier delivery commitments; pending if not required by approved workflow. |
| `supplier_acceptances` | `id`, `supplier_po_id`, `acceptance_number`, `supplier_reference`, `source_total`, `round_off`, `document_id`, `status`, `version` | Acceptance/acknowledgement document header; multi-acceptance rules pending. |
| `acceptance_lines` | `id`, `acceptance_id`, `supplier_po_line_id`, `quantity`, `uom`, `net_price`, source line | Supplier commitment to a PO line. Revision effects need approval. |
| `goods_receipts` / `goods_receipt_lines` | Receipt number, supplier PO line, received/accepted/rejected quantities, actual item/price/tax, reviewer/poster | Normalized GRN. Existing receipts are reviewed CRM records and do not post Tally stock. |

## Invoicing, dispatch, and delivery

| Table | Important columns | Meaning / constraints |
|---|---|---|
| `sales_invoices` | `id`, `issuer_party_id`, `customer_party_id`, `invoice_number`, `invoice_date`, `currency`, supplied/calculated totals, source-system voucher key, status | Candidate accounting document; number scope, tax behavior, issuer, cancellation, and Tally ownership pending. |
| `invoice_lines` | `id`, `invoice_id`, optional/required order-line FK, `part_id`, description/UOM, quantity, price, discount/tax/charge snapshots, source line | Preserve exact issued-line facts. Standalone invoice eligibility pending. |
| `dispatches` | `id`, `lr_number`, `lr_date`, optional transporter, vehicle/e-way references, status | Physical shipment header. |
| `dispatch_lines` | `id`, `dispatch_id`, invoice/order source line, quantity | Partial quantity dispatch; no over-dispatch under approved transaction rules. |
| `tracking_events` | `id`, `dispatch_id`, `source`, `source_event_id`, `status`, `event_at`, location/evidence | Append-only carrier/customer tracking. Event alone is not delivery confirmation. |
| `delivery_confirmations` | `id`, `dispatch_id`, `confirmed_at`, `confirmed_by`, `proof_document_id`, `reason` | Explicit delivery evidence, distinct from tracking. |

## Documents and extraction

| Table | Important columns | Meaning / constraints |
|---|---|---|
| `source_documents` | `id`, `file_hash`, `document_type`, `issuer_party_id`, original filename/MIME/size, storage reference, `review_status`, `ingested_at` | Immutable original/source metadata. Hash detects duplicates but does not prohibit multiple valid associations. |
| Typed document association tables | `source_document_id`, business-record FK, `association_role`, `created_by` | Real FKs from a document to each supported business type. Avoid a polymorphic ID without FK enforcement. |
| `extraction_runs` | `id`, `document_id`, engine/model/version, `raw_result`, `confidence`, `totals_match`, `run_at`, `status` | One immutable row per extraction/retry. Confidence scale is engine-defined until normalized. |
| `extracted_fields` | `run_id`, field name, raw/normalized value, page/region, confidence, validation state | Machine-observed field values, separate from human corrections. |
| `document_reviews` | `id`, document/run, reviewer, decision, reason, `reviewed_at` | Append-only review lifecycle. |
| `field_corrections` | `id`, extracted field, old/new value, reviewer, reason, `corrected_at` | Append-only human correction evidence. |

## Tally, automation, and governance

| Table | Important columns | Meaning / constraints |
|---|---|---|
| `tally_companies` | Existing company UUID, name, source identity | Company-scoped import identity. |
| `tally_external_mappings` | `company_id`, entity kind, internal ID, external ID/key, sync state | Tally link separate from CRM primary keys. |
| `tally_sync_jobs` / `tally_sync_job_items` | Existing job plus per-entity outcome, retry/idempotency key, source version | Read-only import is current; future writes require separate approval and explicit ownership. |
| `tally_conflicts` / `tally_reconciliations` | Internal/external snapshots, reason, resolution actor/time | Visible, recoverable mapping/conflict history. |
| `workflow_definitions` / `workflow_versions` | Trigger, versioned configuration, owner, active state | Proposed automation configuration. |
| `workflow_executions` / `workflow_steps` | Trigger/source idempotency, state, attempt/error/result/timing | Durable execution history and retry state. |
| `approval_requests` / `approval_decisions` | Record/version/payload fingerprint, requester, reviewer, outcome, reason | Independent approval bound to exact content; immutable decision history. |
| `email_accounts` / `email_threads` / `email_messages` | Provider identity, direction, thread/message IDs, sender/recipient metadata, timestamps | Mailbox integration subject to security and provider approval. |
| `email_drafts` / `email_send_attempts` | Linked business record, content reference, approval ID, state, idempotency/provider ID, error | Do not send without a current approval; expose uncertain outcomes. |
| `reminders` / `notifications` | User/role, due time, event, state, delivery evidence | Follow-up and KPI support; time windows/SLA pending. |
| `audit_logs` | Existing actor/entity/action/before-after/reason/time | Append-only history with redacted general audit payloads. |

Payments, payables, bank statements/reconciliation, cheque/PDC, TDS/TCS, credit/debit notes, and statutory posting tables remain **pending target domains**. The meeting mentions them, but source of truth, accounting controls, and accepted workflows are not yet specified.
