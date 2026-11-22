# Sales intake, quotations and warehouse review — implementation brief

Work in the existing Mehta ControlDesk repository as a senior full-stack engineer.
First inspect the implementation, migrations, permissions and verification evidence.
Extend existing features; do not recreate customers, enquiries, quotations, customer
POs, sales orders, notifications, tasks, inventory or audit systems.

## Receiving structured sales requests

Accept authenticated Make.com JSON through the existing automation API for exactly
three categories: CUSTOMER_PO, QUOTATION_REQUEST and LEAD_ENQUIRY. Building email
polling, extraction, Make scenarios, WhatsApp integration or outbound sending is
outside this CRM task. Explain that mailbox delivery becomes automatic only after
the external automation has been connected and verified.

Retain these 23 fields, including multiple item lines:

1. PO number
2. PO date
3. Buyer/company name
4. Supplier/vendor name
5. Billing address
6. Delivery address
7. GSTIN
8. Contact person
9. Email
10. Phone number
11. Item description
12. Product/material code
13. HSN/SAC
14. Quantity
15. Unit of measurement
16. Unit price
17. Discount, with explicit percentage or line-amount meaning
18. GST rate
19. Taxable amount
20. Total PO value
21. Delivery date and any line delivery schedules
22. Payment terms
23. Other terms and conditions

Preserve the original JSON, source mailbox/message identity, receipt timestamps,
extractor provenance and attachment metadata/S3 references. Never store attachment
bytes or secrets in the payload. Store source documents once and keep links.
Missing values remain missing; never fabricate prices, tax, addresses or terms.
Reject malformed requests with field-specific errors. Retain structurally valid
incomplete requests in an actionable review state.

## Customer classification and canonical records

Classify requests as NEW, EXISTING or DO_NOT_QUOTE using verified CRM identity and
existing customer restrictions. Ambiguous matches require review; names or shared
email addresses alone must not merge customers. Existing onboarding, ownership,
credit and commercial gates continue to apply on the server.

For existing customers, display Early Bird below five qualifying records and Elite
from five onward. Exactly five is Elite, confirmed on 23 November 2026. PO requests
count distinct customer POs. Enquiry-based classification uses its separately
configured basis and qualifying statuses. Document
whether the current record counts and keep counts scoped to the selling company.
Duplicate deliveries and cancelled/excluded records must not inflate counts.

An eligible PO creates or links one canonical customer PO and one quotation DRAFT.
Quotation requests and leads create/link the existing enquiry and, when eligible,
one linked draft; do not invent PO fields for these categories. Preserve references
between the source request, customer, enquiry, PO, quotation and eventual order.
Keep ineligible requests visible with specific blockers. A draft is not approval.

## Sales and warehouse workflow

Show assigned requests in Incoming requests, the sales dashboard, Enquiries and
My Work, with links to existing records. Notify the assigned salesperson through
the existing internal notification system. Reuse existing theme, components,
layout, permission checks, filters, pagination, drawers and mobile behavior.

Create a version-specific pre-order warehouse check for each eligible draft.
Logistics & store must show the entire item list, including available lines,
shortage quantities, unverified lines and the associated quotation/customer PO.
Do not hide the rest of an order because one line is short.

Logistics assigns Store staff. Assigned staff record the checked warehouse,
quantity and evidence. Operational users must not receive prices, costs, margins
or other commercial details through either the UI or API. An independent eligible
Logistics reviewer may approve availability only when every required line is
supported by current verified stock evidence. A staff-entered quantity alone
cannot create warehouse stock or pretend a goods receipt occurred.

Reuse retained read-only stock sources and existing receiving/stock services.
If new CRM tables are necessary, add numbered additive migrations, indexes,
foreign keys and history; do not fabricate Tally data or modify the connector.
Handle grouped demand, concurrent reservations, source-reflected reservations,
partial shortages, stale stock and unresolved dispatch reconciliation. Never
double-subtract a reservation or guess its source identity.

After warehouse approval, notify Sales and allow the existing commercial
submission/approval workflow to continue. Warehouse approval never grants Sales
commercial approval permission. Preserve the existing documented Owner
self-approval exception and its required acknowledgement; do not invent new role
grants. Relevant revisions, source changes, expiry and cancellation invalidate
availability and release local holds. Conversion transfers reservations to the
existing sales order; existing dispatch controls consume them appropriately.

## Response clock and performance

Start the persisted response clock on the first actual assignment. Show elapsed
time and, only where configured, remaining/overdue time. Retain source receipt,
CRM receipt, assignment and first-response timestamps separately. Opening a page
does not count as responding. Qualifying responses need an auditable reference.
Reassignment must preserve history and follow an explicit attribution policy.
Cancellation stops the active clock without fabricating a response. Preserve
canonical enquiry/PO/quotation cancellation history and respect linked orders.

Use configured business hours, holidays, response deadlines, reporting periods,
cancellation exclusions and KPI formula/weight. Until these are confirmed, show
Not configured rather than invented countdown deadlines or performance scores.

## Integrity and release

Use company-scoped expiring credentials, existing rate limits and server permission
checks. Staff mutations require session and CSRF checks. Deduplicate by event,
message/document and scoped business identity; identical retries return the same
logical result, while changed data under the same identity returns a conflict.
Preserve originals and append review history. Use exact decimal arithmetic,
optimistic versions, atomic transactions and existing allocation locks. Audit
actions with IDs and actors without copying message bodies into audit logs.

Use only the authorized development RDS database. Keep the existing backup and
migration guards unchanged. Do not deploy, send messages or enable Tally writes
just to prove a test passed. Preserve unrelated changes in the workspace.

Run at least ten distinct PO-to-draft scenarios and explicitly verify new/existing/
restricted customers, threshold boundaries, duplicate deliveries, missing data,
tax/total differences, shortages, all-line display, source changes, role denials,
independent approvals, assignment/notifications, response timing, cancellation,
reservation transfer and rollback on failure. Exercise actual browser screens,
APIs and DB state; label browser fixtures separately from persisted checks.
Do not describe automated browser work as a human manual walkthrough.

For requested records that must remain visible, use clearly labelled TEST records
through existing services, identify their environment, names and links, and avoid
fake source-stock balances or unapproved permanent business settings. Rollback
verification IDs are historical evidence, not records the reviewer can open later.

Deliver implementation notes, the JSON contract and examples, migrations, actual
commands/results, test record names/links, exact navigation steps, deployment
status and unresolved business decisions. Never claim every feature or the live
mailbox integration works unless that precise path was executed successfully.
