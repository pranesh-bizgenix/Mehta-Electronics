# Relationships and cardinalities

**Status:** Proposed cardinalities for target-schema review. The ERD is a hypothesis; existing runtime relationships are noted separately. Any rule marked pending must not be enforced as an approved business invariant.

| Parent → child | Proposed cardinality | FK / integrity rule | Evidence and open question |
|---|---:|---|---|
| `parties` → `party_roles` | 1 → 1..N | `party_roles.party_id`; unique `(party_id, role)` | Supports customers also acting as suppliers. Confirm permitted role vocabulary and lifecycle. |
| `parties` → contacts / addresses / identifiers | 1 → 0..N each | Required parent FK; scoped identifier uniqueness | Multiple contacts and addresses are needed; primary-contact and address-effective rules need confirmation. |
| `parties` → customer POs | 1 → 0..N | `customer_pos.customer_party_id` | Baseline ERD and client transcript; multiple POs per customer are explicitly discussed. |
| `customer_pos` → PO lines | 1 → 1..N | `customer_po_lines.customer_po_id`, unique line sequence per PO | A PO with no lines should not be issued, but draft/ingest state policy needs confirmation. |
| PO line → schedules | 1 → 0..N | `po_line_schedules.customer_po_line_id`, unique schedule sequence per line | Diagram proposes this. Quantity totals, schedule revision, and unscheduled demand behavior are pending. |
| `parties` (supplier) → supplier POs | 1 → 0..N | Supplier role and FK on supplier PO | Existing CRM procurement links one supplier vendor to many POs. |
| supplier PO → supplier PO lines | 1 → 1..N | `supplier_po_lines.supplier_po_id`, unique line sequence | Normalize current JSONB payload only with deterministic mapping. |
| supplier PO → acceptances | 1 → 0..N | `supplier_acceptances.supplier_po_id` | Multiple acceptance/revision documents are possible in the target model; actual business rule is pending. |
| acceptance → acceptance lines | 1 → 0..N | `acceptance_lines.acceptance_id` | Each line should also reference the supplier PO line it responds to; quantity/price/schedule revisions need confirmation. |
| supplier PO line ↔ sales order line | M ↔ N through `supply_allocations` | Both FKs; positive allocated quantity; history retained on reallocation | Allocation cap, cancellation and reuse rules are pending; enforce concurrency in a transaction, not with a cross-row `CHECK`. |
| customer → sales orders | 1 → 0..N | `sales_orders.customer_party_id` | Existing API creates manual orders and quote-derived orders. |
| quotation → sales order | 1 → 0..1 for current conversion contract | Nullable unique FK or explicit conversion relation | Existing application documents one order per quotation, while manual orders have no quotation. Preserve until product approves change. |
| customer PO → sales orders | 1 → 0..N candidate | Nullable/required association is policy dependent | Customer may have multiple POs and sales orders. Scope for one order per PO is not established by the ERD/transcript. |
| sales order → order lines | 1 → 1..N | `sales_order_lines.sales_order_id`, unique position/version as designed | Existing app supports multi-line orders and preserves revisions/snapshots. |
| sales order line → invoice lines | 1 → 0..N | Invoice line references source line when invoice is order-derived | Supports partial invoicing. Whether standalone invoices are allowed is pending. |
| invoice → invoice lines | 1 → 1..N | `invoice_lines.invoice_id`, unique line sequence | Do not post an empty invoice. Issuance and cancellation rules are pending. |
| invoice line → dispatch lines | 1 → 0..N | `dispatch_lines.invoice_line_id` for invoice-based dispatch | Supports partial dispatch. Whether dispatch can precede invoicing or directly reference an order line is pending. |
| dispatch → dispatch lines | 1 → 1..N | `dispatch_lines.dispatch_id` | Quantity cannot exceed the approved outstanding quantity under a transaction-safe rule. |
| transporter party → dispatches | 1 → 0..N | Optional transporter FK until known | Current workflow captures transporter text; canonical party mapping is not required for every legacy record. |
| dispatch → tracking events | 1 → 0..N | `tracking_events.dispatch_id`; unique provider event key where available | Append-only timeline; an event does not itself confirm delivery. |
| dispatch → delivery confirmation | 1 → 0..N history; at most one current accepted confirmation | Separate confirmation record plus proof reference | Reconfirmation/undo policy and authorized roles require confirmation. |
| source document → extraction runs | 1 → 0..N | `extraction_runs.document_id` | Reprocessing must add a run and preserve prior output. |
| source document ↔ business records | M ↔ N via typed association tables | Actual FK per supported target record type | A single file may evidence legitimate multiple records; a global unique hash must not prevent this. |
| extraction run → extracted fields/reviews | 1 → 0..N each | FK to immutable run; corrections append rather than overwrite | Reviewer correction fields and evidence location need agreed validation format. |
| workflow definition → versions | 1 → 1..N | Unique `(workflow_id, version)` | New versions must not mutate execution history. |
| workflow version → executions | 1 → 0..N | FK to exact version; idempotency key scoped to trigger/source | Retry and deduplication semantics depend on provider contracts. |
| execution → steps / send attempts | 1 → 0..N each | Immutable event/attempt rows | Approval must bind to exact payload/version before an outbound send. |
| Tally company → external mappings/imports | 1 → 0..N | Scoped by company, entity kind, external ID | Never assume external IDs are globally unique across companies. |
| Tally sync job → job items/conflicts/reconciliation | 1 → 0..N each | Idempotent item identity and explicit status | Keep read/import and any future write path separately authorized. |

## Current implementation cardinalities to preserve

- Customer, item, enquiry, quotation, sales-order, CRM workflow, shipment, and procurement entities have existing foreign keys; the live schema contains 122 FK constraints.
- A current quotation has at most one converted sales order; manual orders are allowed.
- A sales order has multiple lines and shipments. A shipment may contain multiple shipment items; an order line may be shipped in multiple shipments.
- Current order records require verified workflow data before dispatch, use a request key for dispatch retry, and require explicit delivery confirmation with proof.
- Current RFQs can invite multiple vendors, retain vendor replies, and choose a winning reply; supplier POs and GRNs are separate CRM records.
- Existing imported Tally company/master/sync identifiers are company-scoped and must not be conflated with CRM IDs.
