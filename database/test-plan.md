# Database redesign test plan

**Status:** Acceptance plan; tests become executable as migration and application work lands. Never point destructive or synthetic-data tests at the configured CRM database.

## Empty-install and migration tests

- Apply the full migration chain to an empty disposable PostgreSQL database.
- Verify ordered checksums and required extensions.
- Reapply migrations and confirm no duplicate objects/data changes.
- Force a migration failure and verify the transaction rolls back fully.
- Verify generated ERD source agrees with the applied tables, columns, keys, nullability, indexes, and triggers.
- Confirm no unapproved accounting, Tally write, or bank-email operation is enabled.

## Relational integrity

- Required/optional FK enforcement for parties/roles, PO headers/lines/schedules, supplier POs/acceptances, sales orders/lines, allocations, invoices, dispatches, documents, extraction runs, and external mappings.
- Party can hold customer and supplier roles without duplicate party identity.
- Customer can own multiple POs; PO can own multiple lines and schedules.
- Supplier PO lines and acceptance lines identify the correct parent PO line.
- Source document can have multiple extraction runs and valid typed associations; same file hash does not prohibit legitimate associations.
- Scope-sensitive document numbers and external IDs cannot collide within their approved scope but can occur in different scopes.

## Quantity and workflow behavior

- Partial sales order, partial invoice, and partial dispatch retain separate ordered/invoiced/dispatched/delivered quantities.
- Repeated dispatch idempotency key returns the original dispatch; conflicting reuse rejects.
- Concurrent allocation/dispatch/receipt operations cannot exceed approved quantities.
- Schedules, allocations, invoices, and receipts do not double-count the same physical/commercial quantity.
- Supplier acceptance differences and GRN exceptions remain visible and reviewable.
- Tracking event alone cannot confirm delivery; explicit delivery confirmation and evidence are required.

## Financial and source-document checks

- Numeric values preserve precision without binary float conversion.
- Existing quotation calculation and rounding test cases continue to pass exactly.
- Supplied source totals remain available for reconciliation with calculated totals.
- Source-document hash duplicate detection is deterministic; originals are immutable and reviewer corrections preserve the source value.
- No derived total is labeled final when source data is missing or ambiguous.
- Currency, taxes, rounding, and invoice-number tests are blocked until an approved policy is recorded.

## Email and automation

- Every generated outbound response remains a draft until an authorized human approval.
- Any change to recipient, body, attachment, source record version, or workflow version invalidates prior approval.
- Missing/ambiguous context enters `NEEDS_INFORMATION`; it does not send.
- Duplicate trigger/retry produces one logical action; a provider timeout records an uncertain outcome for reconciliation.
- Bank-email workflow is absent/disabled.
- Role boundaries, audit redaction, and user-visible failure states are tested.

## Tally integration

- Connector upload/import is company-scoped and idempotent.
- Reconciliation preserves external identities and never merges ambiguous masters.
- Imported history/raw payloads and values are immutable to CRM business services.
- Tests fail on any unexpected outbound Tally write/voucher request.
- A future write-enabled mode requires explicit approval and additional timeout-after-commit, retry, duplicate, cancellation, and reconciliation tests.

## Compatibility and app-level tests

- Existing auth/session/CSRF/RBAC behavior remains intact.
- Existing inquiry, quotation, manual/quote order, procurement, shipment, delivery confirmation, audit, and Tally saved-data routes retain documented request/response/status behavior.
- Existing PDF, email, and frontend screens still work on the empty schema with the bootstrapped owner.
- Real PostgreSQL integration tests cover constraints/transactions; mocks alone do not establish migration correctness.
- Run `npm test`, `npm run lint`, `npm run build`, focused domain tests, and `node scripts/verify-migrations-copy.mjs` as applicable.

## Final reset verification

- Confirm only the preapproved local database identity is targeted.
- Confirm the fresh archive can restore into a separate disposable DB before reset.
- Confirm no active CRM/connector connections.
- After migration, assert the expected schema/migration version, empty business tables, owner bootstrap, and route smoke behavior.
- Record actual commands and results; do not report a test as passed unless it ran.
