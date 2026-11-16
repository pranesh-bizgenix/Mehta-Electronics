# Transactional database tests

`test-support/transaction.js` exports `withTestTransaction(async db => { ... })`.
It opens the existing `mehta_electronics_local` through the production PostgreSQL
factory, verifies `SELECT current_database()` on the reserved connection, starts
one transaction, and always issues `ROLLBACK` in `finally` before releasing it.
It does not run startup bootstrapping or migrations, create a schema/database,
open an HTTP listener or seed persistent business data.

The test adapter supports the existing `db.prepare`, tagged/unsafe SQL,
`db.withConnection`, `db.exec` and SQL transaction patterns. Workflow transactions
use savepoints so a service's `COMMIT` cannot commit fixtures. Statement savepoints
recover expected database errors without aborting the outer transaction.
Transaction-local actor/reason and quotation/order/procurement authorization
settings are restored when each workflow ends, matching their production
transaction lifetime. This is a test adapter; application gates are unchanged.
Raw DDL, multiple statements and raw transaction control are refused through the
SQL/prepare interfaces. Use `db.exec('BEGIN'/'COMMIT'/'ROLLBACK')` for managed
workflow transactions.

The five formerly skipped suites now run unconditionally against the existing
migrated schema:

- `test/crm-modules.test.js`
- `test/tally-read.test.js`
- `test/quotations.test.js`
- `test/sales-orders.test.js`
- `test/procurement.test.js`

Their fixtures create `ZZTEST_` users, company/source records and CRM records
inside the outer transaction. Supporting source rows satisfy the real foreign
keys through a test connector/upload session. Fixture policy values exist only
inside the transaction. Existing Tally records are not rewritten. Raw-source
comparisons are scoped to fixture companies; database counts use fixture actor
or record IDs where needed. Trigger-denial deletes target fixture IDs. Truncate
protection is inspected through the trigger catalog rather than acquiring a
table-wide truncate lock on business records.

## Test run and residue guard

```powershell
npm.cmd test
# Focused run with the same before/after residue guard:
npm.cmd test -- test/crm-modules.test.js test/tally-read.test.js test/quotations.test.js test/sales-orders.test.js test/procurement.test.js test/transaction-helper.test.js
```

`scripts/run-tests.mjs` runs a read-only residue scan before starting tests and again
after the child test process exits, including when tests fail. Every public table
is scanned for the exact `ZZTEST_` marker in the JSON representation of each row,
including nested text/JSON fields. A match reports table names and fails the
command; it never deletes rows or prints row contents. Database access errors
also fail the command. Run one test command at a time to avoid collisions and
false positives from other test sessions. Full scans include imported payloads
and can take several minutes on this local dataset. Direct `node --test` runs
bypass this command-level guard; use `npm.cmd test` for the guarded run.

`test/transaction-helper.test.js` verifies rollback after successful workflow
commits and deliberate callback failure, same-connection use, SQL-error recovery,
authorization-setting cleanup and the detector's failure path. The detector
failure-path check uses a SQL protocol spy; it does not deliberately commit
residue into the business database.

## Verification on 3 November 2026

| Run | Passed | Failed | Cancelled | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Five converted files and helper tests | 19 | 0 | 0 | 0 |
| Full repository (129 tests, 17 suites) | 72 | 11 | 46 | 0 |

The guarded full command exited with failure because other suites still call the
disabled legacy database/schema helpers. Its initial and final full residue
scans passed. A separate TAP summary confirmed the same repository-wide counts.
Syntax lint, explicit helper/runner syntax checks and tracked diff whitespace
checks passed. No database, schema or migration was added.

## Remaining limitations

The helper serializes root workflows on one connection. The Tally read test's
parallel requests verify idempotency on that connection, not independent-session
race behavior. Database sequences can advance during rolled-back inserts;
sequence values are not reset because that could conflict with live inserts.
The historical full-suite failures above are retained as dated evidence. The
5 November conversion below supersedes the legacy-helper limitation.

## Additional legacy conversions — 5 November 2026

Converted client-operations, CRM HTTP, dashboard-summary, foundation, migration,
overview, Tally import, sales-document and visibility suites, plus the web
connectivity test. HTTP cases call the real handler using
`test-support/http-client.js`; no extra listener is opened. Suite hooks use
`openTestTransactionScope()` and always close the outer rollback transaction.
Migration protocol tests use a SQL-call spy instead of creating tables or schemas;
connection isolation tests use uncommitted audit fixtures in the allowed database.

The adapter supports postgres.js bulk fragments and the importer's two named
savepoints, mapped into each managed workflow. Arbitrary raw transaction control,
DDL and outer commits remain refused. Import processing timestamps use
`clock_timestamp()` so repeated processing inside a transaction remains ordered;
this does not invent a Tally source timestamp.

The audit found connector HTTP traffic opening its own pool despite an injected
test database. `createApp` now supplies `db.sql` to its default connector store.
This keeps pairing, upload and indexing on the same provided transaction. Five
synthetic Test PC profiles had escaped earlier rollback. After automatic review
rejected hard deletion, the user explicitly approved removal of only those five
exact identities and their receiving-only staging rows. Cleanup checked for
retained payloads, imported source records and read requests before proceeding:
five profiles removed, zero retained/source records removed, zero of those
profiles remaining. This exception does not authorize business-data deletion.

The first complete rerun reported **195 passed, 2 failed, 0 skipped**; both residue
checks passed. The failures were the additional web legacy helper and a stale
unscoped dashboard request. Both were corrected; the final guarded rerun is
recorded in `docs/client-plan-implementation.md` after completion.

Final guarded full run on 5 November: **198 passed, 0 failed, 0 cancelled,
0 skipped**, 16 suites. Both initial and final whole-database ZZTEST_ scans
passed. This includes the named-savepoint/bulk-fragment regression and the CRM
suite's fresh-connection assertion that connector records and staging jobs do
not survive rollback. The web package's test shortcut now delegates to the root
guarded runner rather than invoking an unguarded `node --test` command.
