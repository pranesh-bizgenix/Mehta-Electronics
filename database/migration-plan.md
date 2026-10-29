# PostgreSQL target-schema rollout

**Status:** Additive migrations `0017`–`0020` are applied to the configured local database `mehta_electronics_local`. No database reset or additional database creation was performed.

## Guardrails

- Migration files are ordered, checksummed, and forward-only. Never edit an applied migration.
- The configured PostgreSQL database is the only target for this rollout. Do not drop/recreate `public`, create another database, or point commands at any other database.
- Existing application tables, routes, statuses, and Tally read-only behavior remain in place.
- Preserve the PostgreSQL recovery archive at `data/backups/before-schema-redesign-20261024.dump` until the rollout is fully validated.
- Pending business rules must remain non-operative. Schema storage does not authorize invoice posting, Tally writes, unapproved email sending, or finance automation.

## Applied schema slices

- `0017_customer_po_normalization.sql` adds canonical party/part mappings, customer PO headers/lines/schedules/version history, and compatibility links from sales orders.
- `0018_target_domain_schema.sql` adds storage for party/product detail, price-list imports, procurement lines/acceptances/receipts, allocations, invoices, dispatch/tracking, source documents/extraction, Tally sync outcomes/reconciliation, workflow execution, approvals, email drafts/send attempts, reminders, and notifications.
- `0019_target_schema_integrity.sql` adds integrity guards and lookup indexes for the new structures.
- `0020_automation_approval_guards.sql` requires automation sends to have an approval decision matching the exact current email draft and requires context to be marked ready.
- These migrations are additive. They do not copy or delete business data and do not activate application workflows for the new entities.
- Payment/payable, bank reconciliation, cheque/PDC, TDS/TCS, and statutory posting tables remain unimplemented until their requirements and ownership are approved.

## Verification

- Confirm the configured database identity is `mehta_electronics_local`.
- Confirm `mehta_schema_migrations` records the applied migration checksums through `0020_automation_approval_guards.sql`.
- Inspect the resulting tables, columns, constraints, indexes, and append-only history triggers in PostgreSQL.
- Run build/lint and application compatibility checks without changing the target database contents.

## Recovery

- Keep the pre-change archive; never overwrite it.
- Never restore over an active application database. Any restore target must be explicitly approved and verified before switching `DATABASE_URL`.
