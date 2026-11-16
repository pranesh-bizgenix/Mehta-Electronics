# Tally customer review and linking (P08)

Implemented 4 November 2026 in the existing application and `mehta_electronics_local` database. No migration is needed; links reuse `tally_visibility_crm_links` and its existing uniqueness constraints.

## User flow

1. Open `/tally?entity=customers`, select the source company, then **Review & link customers**.
2. Review candidates from Sundry Debtors and descendant groups only. Filter by subgroup, search, duplicate suggestions and existing links. No rows are preselected, and there is no select-all-ledgers operation. Up to 100 specific source records can be reviewed in one batch, across pages.
3. Inspect GSTIN, normalised-name and phone duplicate suggestions. These are possible matches, never automatic links. Inactive CRM candidates are labelled and cannot be selected as link targets. Existing same-company links are shown.
4. For each selected ledger, choose **Create and link** or explicitly select an active existing CRM customer. Existing target search supports name, GSTIN, phone and CRM ID. Results are bounded to 100; narrow the search as needed.
5. For creation, enter explicit credit limit and credit days. They start empty, with no inferred business values. Credit limits remain decimal strings throughout validation, preview and database writes. Existing CRM customer fields are not changed by linking.
6. Enter a batch reason, then preview. The review shows source company/IDs, delivered details, proposed credit values or target customer, duplicate suggestions and blockers. Nothing is saved by preview.
7. Save the reviewed batch. Every row must be valid. Results link to the native `/customers/:id` pages. Any error rolls back the whole batch.

The native customer browser/detail actions open this wizard. The previous visibility `inspection/customers/create-crm` shortcut, including its versioned alias, now refuses direct creation and directs callers to the reviewed flow. Vendor and item actions are unchanged. Other pre-existing CRM entry APIs are outside this wizard's scope.

## Identity, company and duplicates

Every API requires an explicit UUID `companyId`; no first-company fallback is used. Write requests carry company identity in the body, so the existing idempotency request fingerprint includes it. Only source records found in that company and classified as customers are eligible.

A source must have a delivered GUID or Master ID. GUIDs take priority; duplicate GUIDs are checked case-insensitively. A Master-ID fallback is blocked if that ID is ambiguous within the company, including a conflicting GUID-bearing source. Name-only sources and ambiguous identities are visible but cannot be selected/saved. Source lookup uses company + entity + record key, not name. Existing links retain that tuple, and link audit entries additionally retain company GUID, Tally GUID/Master ID and source revision.

Duplicate detection uses trimmed uppercase GSTIN; Unicode-aware NFKC normalised names with punctuation/spacing removed; and phone digits, treating an Indian +91 prefix as equivalent to its 10-digit national form. Missing/short phone values do not match. Names and phones are advisory similarity checks, not identity proof. International/multiple-number formats can still require manual review. CRM duplicates are searched across existing CRM customers; only the selected company's Tally data and existing links are read.

An existing CRM GSTIN blocks creation because GSTIN is unique. Name/phone similarities require an explicit acknowledgement to create a genuinely separate customer. Same-GSTIN creations within the selected batch are blocked. Similar selected source names/phones also need acknowledgement. Linking requires an explicitly chosen active CRM ID, with no automatic choice based on similarity. Existing source links cannot be reassigned, and two ledgers cannot target the same CRM customer within a company. The same CRM customer may have independently reviewed links in different companies.

CRM lists and setup readiness now recognise stable visibility links. Customer detail resolves current imported values through the source key and company, so an imported name change preserves the link without renaming the CRM customer. Existing profile/name-based fallback behavior remains for legacy records. Multiple stable company links are displayed without automatically selecting or combining their financial balances. Financial detail remains restricted through the existing API permission boundary; wizard responses contain no balances or raw payloads.

## Endpoints and permissions

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1/tally/customer-wizard` | Paginated candidates, group/duplicate/link filters |
| GET | `/api/v1/tally/customer-wizard/targets` | Active existing CRM customer search |
| POST | `/api/v1/tally/customer-wizard/preview` | Read-only proposed actions and review fingerprint |
| POST | `/api/v1/tally/customer-wizard/commit` | Atomic save with required `Idempotency-Key` |

All routes retain session, forced-password, MFA and server CSRF behavior. The service requires existing `customers.read` and `customers.duplicates`; each proposed create additionally requires `customers.create`, and each existing-customer link requires `customers.update`. No permission definition or role grant changes.

Preview and commit accept explicit selections of 1–100 records plus a reason. Commit also requires the preview fingerprint. The server rebuilds the plan after taking the same advisory transaction lock as the older linking implementation, with short table locks protecting customer/contact/source-cache rechecks. Changed sources, target fields, duplicate evidence or links invalidate the fingerprint before writes. The fingerprint binds reviewed data; it is not a claim that the server can prove a human read the preview.

Customer, contact and link changes are audited in the same transaction. Audits retain the reason and source identity. A failure, including audit failure midway through the batch, rolls back every customer/contact/link change. The existing shared idempotency implementation stores the successful response atomically; retries with the same key/body replay it. Reusing the key for another company or request conflicts. Re-previewing already linked sources produces no-op results rather than another customer or link.

## Files changed

- `src/modules/admin/tally-customer-wizard.js`: repository/service/controller and validation.
- `src/modules/container.js`: registration in the existing backend.
- `src/tally-customer-links.js`: shared stable-link reads.
- `src/crm-modules.js`, `src/modules/admin/setup-service.js`: recognise stable customer links.
- `src/tally-visibility-routes.js`: retire the customer visibility creation shortcut.
- `apps/web/features/workflows/tally-customer-wizard.tsx`: selection, duplicate review, target selection, preview and save UI.
- `apps/web/app/(app)/tally/page.tsx`: entry points and selected-company integration.
- `test/tally-customer-wizard.test.js`: duplicate and rollback integration tests.
- `docs/tally-customer-wizard.md`, `docs/client-plan-implementation.md`: implementation record.

## Verification and limits

- New wizard tests: **3 passed, 0 failed/cancelled/skipped**. Cover normalisation, ambiguous identities, explicit duplicate acknowledgement, customer-group filtering, company isolation, permissions/CSRF, missing reason/credit, batch limit, preview non-mutation, exact decimals, idempotency, unchanged existing customer fields, audits, stale preview, mid-batch rollback, source rename continuity and raw source invariance.
- Regression command: `node --test --test-concurrency=1 test/tally-customer-wizard.test.js test/crm-modules.test.js test/tally-read.test.js test/setup.test.js test/user-provisioning.test.js test/logistics-roles.test.js test/quotations.test.js test/sales-orders.test.js test/procurement.test.js` — **30 passed, 0 failed/cancelled/skipped**.
- `npm.cmd run lint`: PASS. `npm.cmd --prefix apps/web run typecheck`: PASS. Final `npm.cmd run build`: PASS, including TypeScript, design-token checks and packaged production artifact.
- `npm.cmd run db:verify`: PASS, 34 matching checksums, 0 pending; read-only.
- Live read-only candidate check: **2,484 customer candidates** in the current imported company; the first 100 returned have stable IDs. This check created or linked nothing. No business records were imported as part of implementation.
- Post-regression shared `assertNoTestRows()` scan: PASS, no `ZZTEST_` rows remain in public tables. Task-specific tracked diff whitespace check: PASS.

Database fixtures use the shared transaction helper and roll back in the only permitted database; no schema/test database or second listener is created. No migration, real customer import, connector deployment, Tally mutation, outbound change, automation switch change or commit.

The full legacy suite, manual browser acceptance, independent-session concurrency/load behavior and running-service restart are not verified in this task. Commit table locks can briefly wait for or pause customer/contact updates and import-cache refreshes; selections are capped at 100. Existing processes must load the rebuilt code to expose the new API/UI. Source records with missing IDs or invalid GSTIN/email require source correction or a valid reviewed existing target. Relinking/unlinking is intentionally not introduced; existing mappings are preserved.
