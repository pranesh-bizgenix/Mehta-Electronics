# Implementation roadmap and gates

This roadmap is conditional on receiving authoritative requirements and named stakeholder decisions. It does not approve ambiguous financial/statutory behavior or claim any phase complete beyond the tested repository baseline.

## Phase 1 — business rules and architecture (current planning increment)

**Inputs:** proposal PDF, 164-row matrix, named decision owners, current API evidence, deployment constraints.

**Work:** populate traceability; resolve business rules; approve architecture records; agree security, scale, backup/recovery, integration, and acceptance targets.

**Acceptance:** source IDs/wording retained; all blocking decisions assigned; architecture and migration approach approved; requirements mapped to owners and test/acceptance evidence.

**Stop/go:** stop commercial, statutory, stock, receipt, or Tally-write work where rules/contracts remain unclear. Go to foundation only after relevant decisions are recorded.

## Phase 2 — foundation and safety rails

**Dependencies:** approved module boundaries, hosting/session model, currency/precision decision, migration and recovery policy.

**Work:** versioned SQLite migration runner; exact-money foundation; contract characterization; structured safe errors/correlation IDs; security and permission model; test infrastructure; frontend shell only after deployment decisions.

**Tests/evidence:** fresh and upgrade migrations; copy-of-production-schema migration; FK/constraint/transaction/lock tests; backup/restore drill; auth/CSRF/role tests; API compatibility tests.

**Acceptance:** all data-integrity/recovery gates pass with signed reconciliation; no legacy workflow regression.

**Stop/go:** any unexplained monetary or record discrepancy, untested restore, or permission gap stops cutover.

## Phase 3 — current workflow UI migration

**Dependencies:** Phase 2 contract and deployment gates.

**Work:** Next.js screens migrated one existing workflow at a time using the same backend.

**Tests/evidence:** role-based API/UI tests, error/loading/empty states, accessibility/responsiveness checks, workflow parity and rollback drill.

**Acceptance:** each workflow accepted by designated users; old UI remains available until full cutover.

## Phase 4 — business modules by approved dependency order

Potential dependency order, subject to matrix and business approval: master governance → enquiries/CRM → approved pricing/quotation controls → purchasing/receipts → stock/order/dispatch → billing/Tally → receivables → after-sales/returns → reports/accountability. This ordering is a planning hypothesis, not an approved delivery schedule.

For every requirement: confirm source and rules; design schema/API/permissions; implement use case; build UI; test success, denial, duplicates, concurrency and failure; demonstrate with controlled data; record acceptance; update documentation.

**Acceptance:** exact requirement-level evidence and agreed workflow scenarios. A rendered page or passing build alone is insufficient.

## Phase 5 — integrations and migration

**Dependencies:** provider contracts, authorized credentials/accounts, data mapping, reconciliation owner, approved side-effect/idempotency policy.

**Work:** adapters, durable jobs/outbox where required, import preview and row reports, failure/retry/reconciliation workflows, Tally capability verification.

**Tests/evidence:** duplicate/timeout/uncertain outcome/restart/provider denial tests; sandbox connection evidence; reconciliation results; operator recovery drill.

**Stop/go:** never report external posting/delivery as successful without verified provider evidence. Keep Tally read-only until write access and workflow are explicitly approved.

## Phase 6 — integrated UAT and production readiness

**Dependencies:** accepted modules, production deployment and data plan, named support/operations owners.

**Work:** end-to-end business scenarios, security review/testing, representative load tests, backup restore, incident runbooks, training and support readiness.

**Acceptance:** sponsor-approved UAT cases pass; security findings dispositioned; approved performance/availability targets met; restore meets approved RPO/RTO; integration failures are visible and recoverable; deployment/rollback rehearsed.

## Sequencing rule

Implement the smallest independently reviewable increment. Avoid mixing frontend migration, money conversion, business-rule changes, and integration write behavior in one release. Record changed files, source requirements, tests, outcomes, blockers, and risks per increment.
