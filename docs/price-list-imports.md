# Reviewed price-list imports

## Current delivery

Open **Items & price lists → Review bulk price-list imports and approvals** (`/items/price-imports`). The current implementation handles CSV, XLSX and text PDF tables with explicit column boundaries. Configured price levels, contract-driven price selection and the stock-check daily analysis remain S2 work; this document does not mark S2 complete.

1. Select a source format and file (maximum 8 MiB). XLSX requires an explicitly selected worksheet. Inspect literal source rows before mapping.
2. Set the first data row and each column or explicit constant. Required fields are CRM part code, unit, list price, minimum quantity and line discount. Edition and source level stay literal text; numeric edition cells are not interpreted as a pricing policy.
3. Enter list name, currency, both effective dates and list discount. There are no business defaults. Preview validates up to 15,000 rows and shows duplicates on both copies, missing/ambiguous/inactive products, unit mismatches, formulas and invalid decimal strings.
4. Save an inactive review with a reason. The server reparses the retained upload and compares the preview fingerprint, including product revisions. It saves no active price list at this point.
5. Submit against the Owner-confirmed `price_lists.approval_policy` in `/rules`. It starts unset. Missing policy blocks submission, approval and activation. Policy changes invalidate the pending decision rather than silently changing its meaning.
6. A different authorised reviewer approves the exact plan. Activation rechecks the policy, products and approval hash, then inserts the canonical list and its entries in one transaction. The importer cannot approve or activate their own import. New price entries use decimal strings and PostgreSQL exact numerics.

The recent-review list shows the latest 100 reviews. Detail rows are paged in groups of 100; the source and decisions remain retained. Preview is paged in the browser, with every mapped row checked on the server. Financial access requires `items.list_price.read`; editing additionally requires `items.update`. No permission grants were added.

### Existing app endpoints

All paths below are relative to the existing listener. Every endpoint uses its normal session and permission checks; POST also requires CSRF. Services enforce financial access again.

| Method and path | Purpose |
|---|---|
| `POST /api/crm/price-imports/inspect` | Worksheet manifest or bounded literal source sample; no persistence |
| `POST /api/crm/price-imports/preview` | Validate all mapped rows and return their errors and preview hash; no persistence |
| `POST /api/crm/price-imports` | Revalidate and save an inactive, audited source review; identical hash/plan replays the same review |
| `GET /api/crm/price-imports` | Latest 100 retained review summaries |
| `GET /api/crm/price-imports/:id?page=1` | Review metadata, 100 source rows and decision history; original file bytes are excluded |
| `POST /api/crm/price-imports/:id/decision` | Reasoned submit, independent approve, reject or approved activation |

## Identity, revisions and storage

Original bytes and SHA-256 are stored in the sole PostgreSQL database, never an external service or a new upload server. `source_documents` and `price_list_imports` retain provenance. New `crm_price_import_workflows`, `crm_price_import_entries` and append-only `crm_price_import_events` bridge that registry to existing integer CRM item IDs and bigint CRM price-list IDs. They deliberately do not place CRM IDs into the separate UUID `parts`/`price_lists` domain.

An identical file/plan replay returns the existing review. Reusing the same bytes with changed mapping or metadata requires explicitly replacing the latest completed review and creates another immutable revision. Invalid rows cannot be committed. Every change has an actual actor/reason and transaction audit; no hard delete path is supplied. The legacy price-list editor refuses changes to lists created by this import flow.

Revision creation currently does **not** automatically retire an earlier activated list. Names remain unique under the existing canonical schema; choose an explicit new version name. A confirmed supersession/selection policy and reviewed retirement workflow remain required before treating revised lists as the single authoritative quote-price source. Manual price-list creation now uses /items/manual-price-list, an explicit preview and the same immutable source/import approval lifecycle. Old direct POST/PATCH activation/edit requests return a 409 migration message. Retained canonical versions remain readable under the internal list-price permission. Existing rows with no retained review are labelled NO_RETAINED_REVIEW rather than being represented as independently approved.

XLSX extraction rejects encrypted/macro/external-link workbooks, unsafe ZIP paths, excessive inflation, invalid cell addresses and formulas as import values. CSV requires valid UTF-8 and literal exact decimals without exponent/currency/grouping syntax. Unit conversion and price-level meaning are never inferred. PDF layout extraction runs offline through a bounded transient Python CLI. It requires Python and the pinned pypdf dependency in scripts/lib/requirements-pdf.txt; missing support blocks clearly. No dependency was installed during this task. See docs/pdf-price-table-review.md for limits and mapping instructions.

## Database and operational evidence

Migration `0047_reviewed_price_imports.sql` was applied by the existing runner to `mehta_electronics_local`, after backup `mehta_electronics_local-2026-11-06T04-43-26-345Z-6aada36a.dump` was verified non-empty. Schema audit: 199 relations, 2,801 columns, 43 documented exceptions, zero unresolved findings. The immutable Tally schema baseline still checks all original tables and permits additional independent tables; its snapshot was not rewritten.

The parser's 15,000-row synthetic CSV/XLSX test makes no database writes. Database workflow tests use the shared rollback harness. No real price list, policy value, staff account, Tally write, connector installation or new listener is created by these tests. See `output/schema-audit/s2-price-*.log` for verification results; completion counts must be read from the finished run.

## Remaining acceptance

Private PDF layout acceptance; price-level configuration; explicit supersession and effective-date selection; dated customer-exclusive contracts; stock check logging and daily analysis; rendered browser acceptance; owner confirmation of approval policy and real import mappings. No real client prices or mappings have been seeded.

Verified checkpoint: full suite 267 passed / 0 failed / 0 skipped; initial and final residue scans clean. Root lint, web typecheck, production build and the 27-check read-only integrity preflight pass. S2 remains partial as listed above.


PDF follow-up (2026-11-06): explicit character-range mapping and optional excluded source rows are now part of the fingerprint, immutable review and independent approval. Raw source inspection is paginated in groups of 100; PDF page and global row numbers remain visible. Three pure PDF checks include a 15000-row synthetic file and a busy-limit check; an additional rollback test covers PDF retention and exact activation. No further migration is needed because 0047 already reserves PDF_TABLE. Final verification is recorded in the implementation log.


## Manual-entry follow-up

/items/manual-price-list accepts up to 200 explicit CRM item/price tiers. No currency, dates, list discount, minimum quantity, price or line discount is supplied automatically. Units and part identities come from the selected active canonical CRM products and are shown in preview. The form is stored as an escaped literal CSV source with entryMethod MANUAL_FORM; original source bytes/hash, item revisions, plan checks, replay, empty-policy blocks and independent approval are shared with file imports. Explicit prior exact-source review selection supports a changed named revision; it is not automatic supersession.

A new named version can be prepared from a retained canonical list, but the name starts empty and existing prices are not changed. Old versions stay retained and active status is not automatically retired by this action. Reviewed supersession/retirement is still required to close that S2 item. Duplicate canonical list names block activation clearly rather than silently overwriting a list.

Read access to canonical lists and list details now requires items.list_price.read. Normal item detail removes profile list-price/discount fields and returns no price tiers unless that permission is supplied by the server. Tally financial access is kept separate. The permissions matrix itself was not changed. Manual/file approval does not grant cost, margin or Tally financial access to any role.

Focused manual/import/CRUD regression: 12/0/0. Current full verification is recorded in s2-manual-* logs after completion; browser acceptance remains pending. No additional migration or business seed was made for this manual flow.

Final manual checkpoint: full suite 279/0/0; both residue scans clean; lint, web typecheck, production build, schema tests and 27-check read-only integrity preflight pass. Date-only revision responses are asserted. No new migration; S2 remains partial for the recorded remaining work.
