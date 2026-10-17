# ADR-0002: Keep SQLite and introduce versioned migrations with exact money

- **Status:** Proposed; approval pending
- **Date:** 2026-10-17

## Context

SQLite through Node's built-in `node:sqlite` is the current and required database. The schema is currently created in `src/db.js` without identified migration history. Existing monetary values use SQLite `REAL`, which is not an exact decimal representation.

## Decision proposed

Retain SQLite. Add a migration runner with an ordered migration ledger, checksums, foreign-key validation, explicit backup requirements, and forward-only schema evolution. For new financial values, prefer integer minor units per an approved currency/scale policy. Do not convert existing rows until currency, historical precision, rounding, and reconciliation rules are approved and a dry-run shows every conversion.

## Alternatives considered

1. Continue inline `CREATE TABLE IF NOT EXISTS`: simple but does not provide ordered upgrades or repeatable upgrade evidence.
2. Replace SQLite: not permitted by the current requirement and unsupported by measured evidence.
3. SQLite plus explicit versioned migrations: compatible with the requirement and provides auditable evolution.
4. Store decimal text: avoids binary floating point but requires carefully specified arithmetic and indexes; consider only if multi-currency/scales make minor-unit integers unsuitable.

## Migration safety proposal

1. Determine the exact active DB path and create a consistent, access-controlled backup; verify it by restoring to an isolated copy.
2. Inventory schema, row counts, monetary columns, ranges, nulls, and relationships without modifying production data.
3. Implement a migration on a copy. Preserve original values in a recoverable legacy representation or immutable export; do not overwrite the only source value.
4. Convert using decimal-safe parsing, never binary floating-point multiplication. Produce per-row before/after reports, exception rows, totals, and checksums.
5. Reconcile all rows and representative quotation/order totals under explicitly approved rules. Unknown/ambiguous values stop the migration.
6. Test migration from a copy of the real schema, interruption/restart, transaction rollback, FK and integrity checks, and application compatibility.
7. Back up and rehearse restore immediately before cutover. Keep the prior application/data backup as a matched recovery point.
8. If validation fails, stop before cutover and restore the matched backup. After new writes begin, prefer a tested forward repair; do not downgrade destructively or discard new records.

SQLite locking, `busy_timeout`, journal mode, single-writer behavior, and expected concurrency must be measured and tested. WAL does not remove write contention.

## Consequences and risks

- No database engine change is needed.
- Migration discipline and recovery testing become required release gates.
- Converting `REAL` values cannot recover precision that was never stored; business approval is required for any rounding or exception handling.
- Integer minor units depend on confirmed currency scale and calculation/rounding order.
- Backups contain sensitive records and require access, encryption, retention, and restore controls.

## Approval record

Pending: business owner approval of currency/rounding and data treatment; technical owner approval of runner/recovery mechanics.
