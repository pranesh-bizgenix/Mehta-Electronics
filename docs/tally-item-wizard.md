# Tally item review and linking (P09)

Implemented 4 November 2026 in the existing app and `mehta_electronics_local` database.

## Flow

Open `/tally?entity=items`, choose the source company, then **Review & link items**. Filter by stock group, delivered brand, missing brand, duplicate suggestions, existing linkage or part/name/HSN/source-ID search. No items are preselected; choose at most 100 specific items per batch, including across pages.

For each source, choose **Create and link a CRM product** or **Link to an existing CRM product**. New CRM part codes start with an explicitly delivered part number, falling back to the exact Tally item name when no part number was delivered. The CRM code can be reviewed/changed without renaming Tally. Pack size starts empty and requires an explicit positive decimal. No MOQ, price, discount or cost is seeded. HSN, unit, description and brand come from the stored source; missing brand is left empty, never inferred from a name or group.

Enter a batch reason, then preview every proposed product or target, source company/identity, duplicate evidence and blockers. Nothing is written by preview. Save the reviewed batch only when all rows are valid. Success links open the product drawer on `/items?open=<id>`. The older customer wizard is retained. Item browser/detail actions enter the new flow; the old visibility item creation shortcut refuses direct creation and directs callers to reviewed preview/commit.

BR-17 applies to this flow: product masters originate in Tally, and the wizard only creates CRM references. It never creates, updates or deletes a Tally stock item. Existing manual/legacy CRM entry interfaces are not redesigned by this task.

## Duplicate and mapping checks

- Similar part numbers use Unicode NFKC, uppercase and punctuation/spacing removal. Exact case-insensitive CRM part-code collisions block creation; other similarities need acknowledgement before creating a separate product.
- An HSN + unit combination is a review hint, not product identity. Acknowledgement permits distinct products sharing that combination. Missing HSN/unit never counts as a positive duplicate match.
- Responses show up to 20 suggestions per source with the full duplicate count and a fingerprint covering all matching evidence. Active target search is bounded to 100 results and supports part code, description, HSN and CRM ID. Narrow the search when needed.
- Selected creates are also checked against one another. Duplicate source selection and exact repeated CRM part codes block the batch; other part/HSN-unit similarities require acknowledgement.
- Linking requires an explicitly selected active CRM item. Missing source unit, conflicting units, or conflicting nonempty HSN values block the link rather than inferring conversion or overwriting either product.
- Existing same-company mappings and unique source/target slots are preserved. An active legacy name mapping can be upgraded to a stable-ID mapping only by explicitly choosing its existing product and reviewing the preview. Archived or conflicting mappings are not replaced automatically.
- Existing visibility links to another product are surfaced as blockers; canonical item links live in `crm_tally_item_links` rather than creating another competing mapping table.

## Stable identities and company boundaries

Every endpoint requires a selected company UUID, with no first-company fallback. Company identity is in write bodies and therefore in the shared idempotency request hash. Only source items from that company are accepted. CRM products are global records; each company link is independently reviewed.

GUIDs are preferred; Master IDs are fallback identities. Missing IDs and identities shared by multiple items in the latest observation block saving. Old cached names with the same GUID are treated as history: the newest observation supplies the current item. Conflicting observations at the same latest timestamp remain ambiguous. A Master-ID fallback that also identifies a GUID-bearing source is blocked.

Migration `0035_tally_item_stable_links.sql` adds nullable `tally_record_key`, `tally_guid` and `tally_master_id` to the existing CRM item-link table, with a consistency check and active-link uniqueness indexes for source keys, case-insensitive GUIDs and Master-ID fallbacks. Existing rows are not backfilled or guessed by name. `tally_name` remains the reviewed name snapshot for legacy compatibility; new stable mappings resolve by source identity and company, including after a rename changes the cache record key.

CRM lists, item stock detail, setup readiness and the current visibility reconciliation/detail layer recognise the canonical item links. Reconciliation does not treat a deliberately different CRM part code and Tally display name as an identity conflict for a confirmed stable mapping. Existing profile/name fallbacks remain for legacy records. Stable item detail does not fall back to a name when its ID is missing/ambiguous. With multiple company links, no quantity or financial values are combined or selected automatically. Stock financial values remain available only through the existing permitted detail path and are read as database decimal text; wizard responses never contain rates, values, prices, costs or raw payloads.

## API and integrity

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1/tally/item-wizard` | Company-scoped candidates and filters |
| GET | `/api/v1/tally/item-wizard/targets` | Existing active CRM product search |
| POST | `/api/v1/tally/item-wizard/preview` | Read-only review and fingerprint |
| POST | `/api/v1/tally/item-wizard/commit` | Atomic save; required `Idempotency-Key` |

Existing session, CSRF, forced-password and MFA gates apply. Reads require `items.read`; each create requires `items.create`, and each existing-product link requires `items.update`. No existing permission or role grant changes. The commit uses the existing transaction/idempotency framework, serializes with older linking paths, and locks CRM item metadata and the derived current cache for the final check. Lock waits are bounded to five seconds. Source, duplicate or mapping changes invalidate the preview before writes.

Item and link changes are audited with reason and source identity in the same transaction; the existing metadata trigger also records canonical link inserts/identity upgrades. Any failure rolls back the complete batch. Repeated successful requests replay their saved response, and another company/body cannot reuse the same key. A fresh review of already linked sources yields no-op results. Unlinking/reassignment is not added.

## Files changed

- `database/postgres/migrations/0035_tally_item_stable_links.sql` — additive identity columns, constraints and indexes.
- `src/modules/admin/tally-item-wizard.js` — repository, service, validation and controller.
- `src/modules/container.js` — module registration.
- `src/tally-item-links.js` — source projection, canonical GUID resolution and shared link reads.
- `src/crm-modules.js`, `src/modules/admin/setup-service.js` — canonical link/stock readiness.
- `src/tally-visibility-repository.js`, `src/tally-visibility-service.js`, `src/tally-visibility-routes.js` — current reconciliation and reviewed creation entry point.
- `apps/web/features/workflows/tally-item-wizard.tsx` — candidate selection, duplicate/target review, preview and save.
- `apps/web/app/(app)/tally/page.tsx`, `apps/web/app/(app)/items/page.tsx` — wizard entry points and result deep links.
- `test/tally-item-wizard.test.js` — pure and rollback database/HTTP tests.
- `docs/tally-item-wizard.md`, `docs/client-plan-implementation.md` — implementation and verification.

## Verification

- `npm.cmd run db:backup` — PASS, verified **218,833,097-byte** archive in ignored `backups` before migration.
- `npm.cmd run db:migrate:postgres` — PASS, **1 migration applied, 35 total**, using the existing runner/fresh-backup gate on the only permitted database.
- `npm.cmd run db:verify` — PASS, **35 matching checksums, 0 pending**.
- `node --test --test-concurrency=1 test/tally-item-wizard.test.js` — PASS, **3 passed, 0 failed/cancelled/skipped**, including additional database-index collision and multiple-company assertions in the final rerun.
- Focused regression over item/customer wizards, CRM modules, Tally read, setup, user provisioning, logistics, quotations, sales orders and procurement — PASS, **33 passed, 0 failed/cancelled/skipped**.
- `npm.cmd run lint`, web TypeScript and production build/design-token checks — PASS.
- Task-specific tracked diff whitespace check — PASS.
- Shared post-regression `assertNoTestRows()` scan — PASS, no `ZZTEST_` rows remain in public tables. New-file whitespace/newline checks also passed.
- Live read-only source check — **10,988** canonical imported items, with stable IDs on the returned first 25. **No explicit delivered brands**; all 10,988 are labelled missing brand. No CRM items were created or linked by this live check.

All synthetic database/HTTP fixtures use the shared outer rollback transaction, with `ZZTEST_` markers and no extra listener, schema or database. Tests cover source/group/brand filters, part/HSN-unit duplicates, missing IDs/pack/unit, permission and CSRF denial, company isolation, preview non-mutation, exact decimal pack sizes and financial text, idempotency, legacy identity upgrades, unchanged existing products, stale review, mid-batch audit failure rollback, GUID continuity after rename, database uniqueness and no cross-company stock aggregation. Original Tally source rows are compared before/after and remain unchanged.

No real products were imported, no Tally records rewritten, no connector/service restarted, no automation switch/outbound behavior changed and no commit made. Full legacy-suite conversion, manual browser acceptance, independent-session load/race behavior and application restart are not verified. Commit locks can briefly wait for or delay other CRM/cache writes. Existing processes must load the rebuilt code before the new routes and UI become available.
