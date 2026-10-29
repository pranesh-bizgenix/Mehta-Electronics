# TallyPrime synchronization design

**Status:** Read-only behavior is current. Bidirectional/write capability remains a proposal pending field ownership, endpoint, authorization, and reconciliation approval.

## Current implementation

- The Node service and Windows connector request Tally XML exports and upload snapshots to the CRM.
- The CRM persists company-scoped Tally imports, source keys, raw payloads, datasets, warnings/quarantine, sync jobs, upload sessions/chunks, connector pairing, and heartbeats.
- Imported ledgers/items are surfaced through saved-data APIs and strict reconciliation views.
- A limited CRM-record creation path can use selected stored Tally customer/vendor/item records; it rechecks ambiguity and records an audit event.
- No invoice, purchase, receipt, payment, or voucher write is implemented. README and connector code explicitly describe the integration as read-only.
- Current Tally records are separated from CRM identities. Matching a name does not merge or overwrite either system.

## Source-of-truth boundary

| Data | Current owner | Current direction | Target handling |
|---|---|---|---|
| Tally ledger/stock masters and imported balances | Tally company | Tally → saved CRM snapshot | Preserve company scope, source keys, raw payload, import run, fetched time and original signs/values. |
| CRM customer/item/vendor records | CRM | CRM-owned; optional explicit link to imported Tally master | Never auto-assign an ambiguous Tally match. Keep CRM ID and Tally ID separate. |
| CRM enquiries, quotations, orders, procurement and shipment workflow | CRM | CRM-owned workflow | Do not treat an imported accounting balance as proof of line-level invoice/payment state. |
| Tally vouchers, invoices, receipts/payments, purchase posting | Tally today / not integrated for writes | No CRM write | Any future direction is pending approval; do not implement from meeting discussion alone. |

## Proposed target data

1. `tally_companies`: stable company identity and configured import scope.
2. `tally_external_mappings`: `(company, entity kind, internal entity, external identity)` with validity/status and audit.
3. `tally_sync_jobs` and `tally_sync_job_items`: run-level and entity-level outcomes, counts, retry state, source version, and idempotency key.
4. `tally_conflicts`: both compared snapshots, conflict category, status, resolution, actor/reason, and timestamps.
5. `tally_reconciliations`: company/entity/time-window scope, matched/unmatched/ambiguous totals, exact source snapshot and review state.
6. Keep current raw/import tables until a verified retention and replay strategy allows replacement.

## Mapping and safety requirements

- Scope every external identity by Tally company and entity type; external IDs are not globally unique.
- Persist source version/master/alter IDs and import run where available. A change requires a new observation/history, not a blind CRM overwrite.
- Use deterministic idempotency keys for an import batch and per entity. A retry of a stored result must not create another CRM voucher or duplicate mapping.
- Make missing and ambiguous mappings visible and recoverable. Never fuzzy-match into a write.
- Retain both source and CRM values for conflicts; record explicit resolution actor, reason, and chosen owner.
- Make cancellations/reversals separate source events, not deletion of prior successful sync history.
- Keep connector credentials and pairing tokens secret; never include raw secrets or full raw payloads in general logs.
- Redact financial balances and costs using server-side authorization, including aggregate endpoints.

## Future write path: blocked until approved

The meeting discusses two-way sync and broad accounting data, but does not specify a supported write API or the legal controls. Before any write migration, define per field/entity:

- owner and allowed direction;
- business key and external ID generation;
- request/response payload and supported Tally version;
- idempotency and duplicate detection;
- timeout/uncertain result handling and operator recovery;
- update/cancellation/reversal semantics;
- conflict precedence and human resolution;
- retry policy, audit and reconciliation;
- authorized roles and segregation of duties.

Never retry an uncertain voucher creation blindly. A timeout must produce an explicit `outcome_unknown`-style state until external reconciliation establishes whether the voucher exists.

## Verification gates

- Imports are isolated by company and preserve original signs/decimal strings.
- Repeated import delivery is idempotent; partial batches expose per-item errors.
- Ambiguous master matches do not create or overwrite CRM entities.
- Conflicts and unresolved mappings are searchable and auditable.
- Existing connector endpoints remain read-only; tests fail if a write request reaches Tally.
- Future write tests require a fake Tally endpoint and must cover duplicate response, timeout-after-commit, retry, cancellation, and reconciliation before enablement.
