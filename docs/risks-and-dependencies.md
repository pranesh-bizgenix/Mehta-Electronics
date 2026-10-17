# Risks, dependencies, and approvals

## High risks

| Risk | Impact | Current evidence | Mitigation / gate | Owner needed |
|---|---|---|---|---|
| Proposal PDF and authoritative 164-row matrix unavailable | Requirement traceability and acceptance can be incomplete or misinterpreted | Only proposal-derived summary is in supplied prompt; no source files found in repository | Obtain approved sources; preserve exact IDs/wording before claiming compliance | Sponsor / business analyst |
| Approximate SQLite `REAL` financial values | Existing values may not exactly represent intended amounts; conversion can change totals | `src/db.js` monetary columns use `REAL` | Approve currency/rounding; dry-run and reconcile; backup/restore gate | Finance owner + data owner |
| Unapproved commercial rules | Wrong prices, credit decisions, margin overrides, fulfilment, or allocations | Clarification register open | Block affected automation until worked examples and policy approval | Commercial/finance owners |
| Tally is read-only and actual deployment/API is unverified | Posting requirements cannot be safely implemented or accepted | Current `src/tally.js` connector is read-only | Confirm Tally version/company/API/rights and provider contract; test reconciliation; keep read-only meanwhile | Accounts/Tally administrator |
| Large pre-existing worktree changes | Accidental loss or unrelated modifications during development | Phase 0 found ~988 local changes, including dependencies/manifests/local env | Do not reset, clean, stash, or commit. Inventory exact deltas before editing; isolate new changes and review diffs | Repository owner |
| No versioned migration history | Upgrades/recovery cannot be proven from ordered schema versions | Schema defined in `src/db.js` | Build runner against copied legacy DB; test interruption and restore before production use | Technical/data owner |
| SQLite single-writer and topology constraints | Contention or unsafe shared/network-file deployment at unverified scale | SQLite and WAL configured; no measured scale evidence | Approve topology/targets; measure locks, latency, DB growth; do not assume WAL removes contention | Technical/operations owner |
| Frontend split adds deployment and session complexity | Cookie/CSRF/CORS failures or duplicated UI behavior | Current static UI and API share one Node server | Approve proxy/origin; characterize API; one backend; staged parity and rollback | Technical/security owner |
| Security/production readiness unverified | Sensitive customer/financial data exposure or inability to recover | Existing auth tests pass, but no full threat model, restore/load evidence | Complete role model, security review, operational controls, restore/load tests before production acceptance | Security/operations owner |

## Required decisions and dependencies

1. Deliver the proposal PDF and 164-row response matrix; identify source version and approval status.
2. Name business decision owners for pricing, margin, credit, tax, numbering, approvals, stock, partial fulfilment, receipt allocation, and Tally.
3. Approve currency/precision/rounding and historical-data migration policy.
4. Confirm TallyPrime version, company, deployment, authorized interface, permissions, and reconciliation owner.
5. Approve identity provisioning, roles, row-level visibility, commercial approval segregation, MFA, and session policy.
6. Approve target hosting, domain/proxy, user/concurrency/volume/latency goals, availability, backup retention, RPO/RTO.
7. Identify data owners and source extracts for customer/item/open balance/stock/history migration; agree cleansing and reconciliation rules.
8. Confirm authorized provider accounts/contracts for any external integrations and test/sandbox access.
9. Name UAT acceptors, workflow participants, support owner, and change/release authority.

## Stop conditions

- Missing source requirement that affects the requested behavior.
- Unapproved financial/statutory rule or ambiguous conversion.
- Unexplained data reconciliation difference or unverified restore.
- Unclear authorization, record visibility, or approval segregation.
- External provider contract/permission or outcome cannot be verified.
- Deployment topology or recovery capability conflicts with approved operating targets.

When stopped, keep the current safe behavior, expose a clear operational blocker where relevant, record evidence, and request the specific decision. Do not substitute guessed rules or a success-shaped placeholder.
