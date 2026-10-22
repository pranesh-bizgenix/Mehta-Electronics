# Stored Tally read layer

The website reads existing PostgreSQL imports. The new services import no connector modules, send no Tally requests, schedule no synchronization, and never mutate imported records. Connector implementation files and existing migrations `0001`–`0005` are unchanged. Existing API routes remain registered; the website's saved-data screens use the additive APIs below.

## APIs

All routes require the existing authenticated session. The same routes exist under both `/tally` and `/api/tally`.

| GET suffix | Source and classification | Required permission |
|---|---|---|
| `/customers` | Ledgers under Sundry Debtors, including descendants | `customers.read` |
| `/vendors` | Ledgers under Sundry Creditors, including descendants | `tally.read` |
| `/banks` | Bank Accounts, Bank OD A/c, Cash-in-Hand and descendants | `tally.read` |
| `/expenses` | Direct Expenses, Indirect Expenses and descendants | `tally.read` |
| `/other` | Other ledgers | `tally.read` |
| `/ledgers` | All classified ledgers | `tally.read` |
| `/items` | Original stock name, group, delivered quantity/rate, permitted value | `items.read` |
| `/groups` | Flat, paginated hierarchy with path/depth and parent/cycle diagnostics | `tally.read` |
| `/reconciliation` | Exact-name company-scoped comparisons | `tally.read` |
| `/read-companies` | Original company identities plus cleaned display labels | Customer or item read permission |

Dataset and reconciliation endpoints accept `companyId`, `search`, `page`, and `pageSize` (maximum 100). An omitted company chooses the first imported company; invalid or missing requested IDs are rejected. Lists return `data`, `pagination`, `company`, and saved `sync` metadata. Master lists also support exact parent `group`; allowlisted sorts/directions are supported. Group totals reflect the stored rows; 78 is not hardcoded.

Reconciliation accepts `kind=customer|vendor|item` and `status=matched|missing_in_crm|missing_in_tally|conflict`. Its summary is company-wide; search/status/kind filter the paginated table. Raw monetary values and aggregate coverage require an existing authorized financial role. No balances are returned to workflow-only roles.

`POST /tally/crm-records` (also `/api/tally/crm-records`) accepts:

```json
{"companyId":"<imported company UUID>","kind":"customer|vendor|item","sourceId":"<stored record id>"}
```

The route uses the existing CSRF checks and requires `customers.create` for parties or `items.create` for items. Vendors additionally require `tally.read`. It reads the selected source inside a transaction and rechecks reconciliation. An advisory transaction lock serializes duplicate creation attempts; a repeated successful request returns the existing match. Ambiguous/duplicate names, conflicting CRM codes/GSTINs, inactive records, or missing item units produce explicit errors rather than overwrites.

Writes go only to existing CRM `customers`, `customer_contacts`, `items`, and `audit_logs`, plus new CRM metadata tables. No raw master, payload, sync status, upload session, or connector table is written by these services. Customer creation populates the existing customer screens; vendor creation populates the new company-scoped CRM party table. Source names remain unchanged in new CRM records.

## Display and matching

- `name`/`original_name` retain the stored identity. `display_name`, `display_phone`, `display_group`, and related display fields conservatively repair reversible UTF-8/Latin-1/Windows-1252 mojibake. Valid Unicode is preserved. Irrecoverable replacement characters cannot be reconstructed; stored data is never guessed or rewritten.
- Repeated identical `(from …)` company suffixes collapse only in display labels. IDs and original names still select companies and join saved sync jobs.
- Quantity and rate stay as delivered, with units. Decimal values remain strings; the service performs no JavaScript floating-point total.
- Company-wide stock coverage reports valued/missing/negative counts. `totalValue` is null when any value is missing or no items exist. `knownSignedValue` is explicitly a partial signed sum, never a complete total. Complete negative sums retain their sign and an explanatory label.
- Missing cells render a focusable dash with a tooltip. The Overview labels partial stock valuation prominently and discloses both counts.
- Last completion, last successful import, and status come solely from `tally_sync_jobs`. No heartbeat or live connection is inferred by the new read screens. There is no sync button in the new reconciliation screen.

Matching is strict original-name equality: punctuation, case, spacing, and original encoding are significant. CRM item identity uses `items.part_code`; company links retain the exact source name. GSTIN/UOM differences, duplicate exact names, inactive/archived records, and subsequent CRM name/code changes are conflicts. Display repair never merges records.

Legacy customers/items have no company column. Explicit new mappings establish scope. Unmapped legacy records can be compared when there is one imported company or an exact source name establishes a candidate company. Names shared by multiple companies are conflicts. In a multi-company installation, unmatched global CRM records without a company mapping cannot safely be attributed to a company and are excluded from that company's missing-in-Tally list; they are never silently assigned.

## Additive database objects

- `0006_stored_tally_read_layer.sql`: `crm_parties`, `crm_tally_item_links`, immutable-deletion/audit triggers, and the non-updatable aggregate view `crm_tally_stock_coverage`.
- `0007_stored_tally_audit_guards.sql`: forward-only archive-reason and actor validation for those new CRM objects.
- Both new tables include ID, creation/update timestamps, creator, status, and soft-delete flag. Physical deletion/truncation is rejected. Archival requires a reason and audit actor; audit insertion is transactional.
- `.gitattributes` fixes LF endings for these two new checksummed migrations only. Earlier migration bytes are unaffected.

The local running application automatically applied the initial `0006` during development. Its applied contents were preserved byte-for-byte; later safeguards were placed in `0007`. The existing startup runner has now applied both. Their recorded checksums match the files. No destructive SQL or historical migration rewrite was used. The local server is running at `http://127.0.0.1:3000`.

## Verification

```powershell
node --test test/tally-read.test.js
$env:RUN_TALLY_READ_DB_TEST='1'
node --test test/tally-read.test.js
node scripts/verify-stored-tally.mjs
node scripts/preview-design.mjs
```

All six focused tests passed, including real PostgreSQL execution of both migrations against isolated synthetic source tables. Checks cover company separation, descendants/cycles, exact matching, encoding, precision/partial coverage, financial visibility, concurrent idempotent creation, audits, and archive safeguards. Imported fixture tables are compared before/after CRM creation and remain identical.

The focused browser run checks repaired display fields, company labels, hierarchy, partial values, dash tooltips, CSRF-bearing CRM creation, mobile overflow, and absence of connector requests. [Captured requests](../output/tally-read-review/verification.json) contain no sync/pairing/upload/heartbeat calls. The existing ten-screen desktop/tablet/simulated-4G preview passed after its fixtures were updated; historical design-review captures were preserved.

Read-only checks against the application's stored database found 78 groups; stock coverage was 5,191 valued and 5,797 missing out of 10,988 items. Stored sync status was `stalled`. New GET routes returned 401 without authentication; no live CRM-create operation was performed for verification.

Test databases are retained, rather than dropped, for explicit review. This task created `mehta_read_review_5dbdad77e65e`, `mehta_read_review_ead4213e413d`, `mehta_read_review_434a9cc4201a`, `mehta_read_review_642abd0c9286`, and final `mehta_read_review_290ec6e51da6`. They contain synthetic fixtures, not copied business data.

## Changed files

- `.gitattributes`
- `database/postgres/migrations/0006_stored_tally_read_layer.sql`
- `database/postgres/migrations/0007_stored_tally_audit_guards.sql`
- `src/tally-read-service.js`
- `src/tally-read-routes.js`
- `src/app.js` — additive route registration and `/tally/` dispatch only
- `public/tally-data.js`
- `public/app.js` — saved-data page wiring only; frozen functions unchanged
- `public/overview.js` — partial valuation and display-only labels/tooltips
- `public/design-system.css` — saved-data component styles
- `test/tally-read.test.js`
- `scripts/verify-stored-tally.mjs`
- `scripts/preview-design.mjs` — new response fixtures and screenshot timeout
- `docs/tally-read-layer.md`
- `output/tally-read-review/customers.png`
- `output/tally-read-review/groups.png`
- `output/tally-read-review/items.png`
- `output/tally-read-review/reconciliation.png`
- `output/tally-read-review/reconciliation-mobile.png`
- `output/tally-read-review/verification.json`

The unrelated pre-existing `apps/web/next-env.d.ts` change is excluded from all task commits.
