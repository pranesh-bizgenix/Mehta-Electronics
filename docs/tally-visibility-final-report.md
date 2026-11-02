# Tally visibility delivery report

Verified 2026-10-30T12:36:42.788Z. Database: **mehta_electronics_local**, exclusively through DATABASE_URL.

## Root causes and fixes

1. Native ControlDesk sent the Tally navigation to the legacy app root; it now has a native design-system page at /tally.
2. Existing APIs exposed a short projection and searched name/parent only, hiding retained JSONB fields. The append-only field index preserves every parsed JSON pointer, including arrays, attributes, report fields and historical snapshots. Shared entity descriptors drive additive /api/v1/tally endpoints, column selection, grouped details and exact formatting.
3. The connector requested too few methods. A real read-only export recovered full masters and optional collections. The connector source now requests wildcard fields **and explicit computed fields**; wildcard alone did not deliver closing quantities/rates/values.
4. Stored legacy customer/item mirror tables were empty despite populated company-scoped master tables. Browsers query the company-scoped indexed imports. No mock production data was added.
5. Item closing_rate_text escaped financial authorization. Both old and new server endpoints now restrict financial figures to Owner/Accounts, including search, sort, raw views and export.
6. Metadata and XML snapshots initially appeared as two companies when the original company GUID was absent. Migration 0028 adds identity aliases while retaining both immutable snapshots.
7. An absent entity plus the UI default name sort produced an error. Default sorting now falls back to available metadata so missing collections show an honest empty state.

## Before and after counts

The legacy mirror tables remain untouched and empty. Counts below concern imported entities. The API and native table use the same server pagination total; every populated browser/detail is also exercised with isolated fixtures. Production verification is read-only, so no real login/audit sessions were created for screenshots.

| Entity | Before imported rows | After DB/API total | UI count source | Owner/Accounts selectable fields |
| --- | ---: | ---: | --- | ---: |
| companies | 1 | 1 | API pagination.total | 425 |
| groups | 78 | 78 | API pagination.total | 152 |
| ledgers | 4152 | 4152 | API pagination.total | 2313 |
| items | 10988 | 10988 | API pagination.total | 727 |
| stock_groups | 0 | 167 | API pagination.total | 229 |
| categories | 0 | 1 | API pagination.total | 35 |
| units | 0 | 12 | API pagination.total | 41 |
| godowns | 0 | 5 | API pagination.total | 94 |
| price_levels | 0 | 0 | API pagination.total | 3 |
| cost_centres | 0 | 0 | API pagination.total | 3 |
| vouchers | 0 | 0 | API pagination.total | 3 |
| reports | 0 | 10 | API pagination.total | 41102 |

| Retained storage | Before | After |
| --- | ---: | ---: |
| tally_import_quarantine | 0 | 0 |
| tally_raw_payloads | 16 | 24 |
| tally_upload_chunks | 642 | 1003 |
| tally_upload_sessions | 8 | 10 |
| tally_sync_jobs | 3 | 5 |
| tally_import_warnings | 10 | 15 |
| tally_visibility_records | 0 | 45858 |

All 24 original payload hashes pass SHA-256 verification; 54,19,262 raw XML leaves match the immutable field index. No imported source/master/quarantine row was rewritten, truncated or removed. Migrations 0023–0028 are additive. 45,091 entity/field paths are catalogued. Full per-field coverage and role policy: [tally-visibility-audit.md](tally-visibility-audit.md).

## Fields recovered per entity

The index stores arbitrary nested delivered fields in JSONB instead of adding thousands of positional columns. The audit lists every path individually. Unavailable values are labelled Not delivered.

| Entity | Coverage added |
| --- | --- |
| Companies | Complete delivered company XML, dates, address/tax/currency configuration and metadata/history |
| Groups | Every delivered group method, parent/primary/nature flags and computed hierarchy/tree |
| Ledgers | Aliases, IDs, GST/PAN/state, nested addresses/contact/bank/credit/bill-wise/date configuration and all other delivered methods; financial paths remain restricted |
| Items | Aliases/IDs, units/conversions, nested GST/HSN configuration, category/group, batch/MRP flags, cost/price configuration and every delivered nested list |
| Stock groups/categories | Complete delivered XML plus source/history metadata |
| Units/godowns | Complete delivered XML, conversion/address/configuration fields plus source/history |
| Price levels/cost centres | Parser, descriptor, storage and UI support ready; live exports timed out, so no records invented |
| Vouchers | Generic retained-XML support and honest Awaiting voucher data; structured connector collection still required |
| Reports | All retained document leaves are browsable, searchable and exportable for financial roles |

## Source health and remaining data gaps

- **Direct XML:** failed; last successful source-labelled sync unknown / none recorded; errors 2; retries 0; next sync unknown.
- **Tally Engine:** Unknown: no source-labelled sync; last successful source-labelled sync unknown / none recorded; errors unknown; retries unknown; next sync unknown.
- **Bizgenix:** Unknown: no source-labelled sync; last successful source-labelled sync unknown / none recorded; errors unknown; retries unknown; next sync unknown.

Two historical connector runs succeeded, latest at 2026-10-29T10:34:38.362Z, and one stalled. Historical Engine/Bizgenix attribution was never stored; it cannot be reconstructed honestly. The two new Direct XML attempts failed/incomplete: PriceLevel timed out in the full master run, and the separately scoped CostCentre export also timed out. The final existing company diagnostic timed out too. Valid received master collections were retained and indexed. No Tally Import/write request was sent.

Current full-field stock snapshots: **0 valued / 10,988 unvalued**, labelled partial. Earlier snapshots still contain **5,191 valued / 5,797 unvalued** records and remain available using Every imported sync snapshot. Historical values are not silently substituted into current figures. The corrected export explicitly requests computed closing fields, but another live run cannot be verified until Tally responds. Godown-wise stock, batch balances, dated price lists and optional fields appear only where actually delivered; a configured collection/report is needed for any absent list.

Deploy the updated Windows connector for ongoing full imports; only its source/Core build was changed here, not the installed service. Add read-only voucher exports with stable GUID/master IDs, voucher dates/types/numbers, ledger entries, inventory/godown/batch entries, GST amounts and invoice references; transport them in chunks and replay idempotently. Invoice browsing/reconciliation requires those delivered voucher/invoice entries. No fake vouchers or invoices were created.

## Validation

- Full suite: 94 tests, **89 passed, 5 opt-in skipped, 0 failed**.
- Focused import/read/visibility suite with opt-in database checks: **12 passed**, no skips. Final descriptor/visibility rerun: **13 passed**.
- Real anonymized XML fixtures cover all eight available entity collections, garbled ledger text, sparse fields and exhaustive descriptor/column/detail coverage.
- Permission tests cover raw payload denial, financial search/sort/export stripping, exact decimals, all-page exports, immutable history, replay, ID-only CRM links and before/after history.
- All database tests and browser fixtures use random test_<random> schemas in the same database and drop them in finally.
- Native production build, TypeScript, design-token check, backend syntax lint and backend production artifact passed. Windows connector Core builds successfully.

### Query performance

EXPLAIN ANALYZE/BUFFERS checked count and page SQL separately for the real 4,152 ledgers and 10,988 items, Owner and Manager, default/text search/group/quality filtering. Plans expose node/index names and timings without row values or search literals.

| Entity | Role | Case | Count ms | Page ms |
| --- | --- | --- | ---: | ---: |
| ledgers | OWNER | default | 7.674 | 69.116 |
| ledgers | OWNER | search | 70.023 | 84.865 |
| ledgers | OWNER | group | 0.048 | 0.863 |
| ledgers | OWNER | filter | 16.315 | 47.371 |
| ledgers | MANAGER | default | 0.705 | 25.675 |
| ledgers | MANAGER | search | 10.018 | 15.629 |
| ledgers | MANAGER | group | 0.074 | 0.516 |
| ledgers | MANAGER | filter | 12.323 | 37.616 |
| items | OWNER | default | 2.963 | 90.987 |
| items | OWNER | search | 28.478 | 39.489 |
| items | OWNER | group | 0.102 | 14.815 |
| items | OWNER | filter | 106.611 | 59.294 |
| items | MANAGER | default | 2.369 | 69.846 |
| items | MANAGER | search | 5.19 | 8.449 |
| items | MANAGER | group | 0.089 | 3.397 |
| items | MANAGER | filter | 35.035 | 38.559 |

All measured SQL statements are under 300 ms. This is database query execution, not a guarantee for every network transfer or arbitrary raw-XML sort. Historical/raw-field sorts remain functional and can cost more. See [tally-query-performance.json](tally-query-performance.json).

### UI evidence

25 browser checks passed; no page errors; no serious/critical axe findings. See [verification.json](../output/tally-visibility-review/verification.json).

Screenshots use isolated anonymized/synthetic test records, never production financial data. Every available entity browser/detail and unavailable collection state is captured at **1440 and 390 px, light and dark** in [tally-visibility-review](../output/tally-visibility-review/). Examples: [items desktop light](../output/tally-visibility-review/items-browser-1440-light.png), [items mobile dark](../output/tally-visibility-review/items-browser-390-dark.png), [ledger detail](../output/tally-visibility-review/ledgers-detail-1440-light.png).

## Operation

Use /tally in the native UI. Choose a company, entity and Latest record or Every imported sync snapshot. Search covers all permitted text values, not just visible columns; the column chooser itself is searchable and paginated. Saved views retain filters, sort, snapshot mode and selected columns. CSV/Excel exports run on the server over every filtered page, preserve decimal text, neutralize spreadsheet formulas, enforce permissions and audit the operation. Excel is native Spreadsheet XML (.xml), not XLSX. Manager/Owner quarantine replay writes only the derived index and keeps the original row/reason. Reconciliation uses explicit imported IDs; name collisions produce conflicts rather than automatic links.
