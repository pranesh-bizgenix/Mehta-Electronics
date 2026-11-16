# Owner-confirmed price levels

## Delivery and scope

`/items/price-levels` uses the existing `crm_price_levels` table. It shows the three slots permitted by that schema without inserting any rows or business values. An absent, cleared, archived or invalid level stops resolution with `Not set: crm_price_levels.<number>`. Level numbers have no predefined business meaning.

Only the Owner can confirm or clear settings, with a reason and the current revision fingerprint. The server rechecks role and permissions; session and CSRF use the existing app middleware. Every change is transactional and recorded in the audit log, in addition to the table's existing provenance triggers. A concurrent/stale edit is rejected. Clearing retains the row and audit history, rather than deleting it. No migration or permission grant is added.

## Required decisions

For each level the Owner must explicitly choose:

- Its label and confirmed meaning/instructions.
- A canonical price list that was independently approved and activated through the reviewed import flow.
- Its calculation: listed unit price only, line discount only, list discount only, or both discounts successively.

These are supported calculation options, not confirmed business settings. Nothing is selected automatically. A level cannot point at an unreviewed legacy manually created list. The resolver refuses deleted/inactive products and entries, inactive or future/expired lists, and quantities below every configured minimum tier. The eligible tier is the highest minimum quantity not exceeding the requested quantity.

Calculation uses shared rational BigInt arithmetic. The configured percentages are applied exactly, with one final rounding of the unit price to six decimal places under the existing exact-money contract. The result carries currency, source list/entry identities, the level revision, pricing date and a fingerprint. There is no exchange-rate conversion or cross-currency assumption.

Financial configuration access requires `items.list_price.read` and `items.read`; confirming also requires `items.update` and the actual Owner role. Accounts, Executive and the logistics roles receive no new financial permissions.

## API and remaining work

| Endpoint | Use |
|---|---|
| `GET /api/crm/price-levels` | Live settings/revisions and independently approved active source-list choices |
| `PUT /api/crm/price-levels/:level` | Owner confirmation or reasoned clearing, with expectedRevision |
| `GET /api/crm/quotation-price-levels` | Sales-role level labels only |
| `POST /api/crm/quotation-price-level-preview` | Assigned/eligible customer and active-item net-price preview, with CSRF; no source financial internals |

Quotation editing now offers an explicit configured-level preview and apply step. Only the net unit price, INR currency, level number and opaque fingerprint are returned to sales roles; no list prices or discounts are exposed by that endpoint. Applying a price sets no additional discount. Draft save, submission, approval and send revalidate current source eligibility and fingerprint. Changed definitions or entries invalidate a bound draft even when the resulting price is equal. Unchanged sources remain valid across calendar days and equivalent quantity formatting within their validity dates. Existing quotations are never silently repriced. Non-INR sources block because the existing quotation workflow has no reviewed conversion policy. A conflicting customer-specific fixed contract also blocks; no source precedence is guessed.

Source review confirmed that existing `contractForLine` already enforces fixed quantity, exact net price/no extra discount, customer exclusivity and current validity. Later workflow validation now also compares the current contract identity with the retained line rateContractId. A replacement with an equal price, expiration, or an agreement introduced after approval invalidates the old binding. Contract approval and quotation validation use the same customer/item advisory lock; preview shares the existing quotation transaction lock to preserve lock order. Tests cover these identity changes and document-status downgrade until draft revision. Broader real-client acceptance and remaining pricing workflows are still required.

`test/price-levels.test.js` uses rollback transactions on `mehta_electronics_local`: empty-level blocking, independent source approval, Owner-only configuration, revision conflicts, decimal calculation, validity/MOQ, clearing, financial-role restrictions and HTTP session/CSRF. The latest focused run passed 2/0/0; the final full run is recorded in the implementation log after completion. No real level was configured by tests.

Final configuration checkpoint: full suite 273 passed / 0 failed / 0 skipped, both whole-database residue scans clean; lint, web typecheck and production build pass (s2-levels-* logs). This does not complete quotation source binding, all S2 work or release acceptance.


Quotation-source follow-up: src/modules/pricing/quotation-source.js, customer-gates.js and quotation-workflow.js enforce retained contract/level sources; the quote editor retains pricingSelection through reload and save, and level-price.tsx requires explicit application. Focused source/contract/level gate: 5 passed, zero failed/skipped. Full verification logs are s2-source-*. Customer-level source permissions, CSRF and label/net-only response shapes are tested. Renderer/browser acceptance remains pending. Manual-list approval consistency, supersession and stock analysis remain S2 work; this is not stage completion.

Quotation-source final gate: full suite 276/0/0 and clean initial/final residue scans; lint/typecheck/build, schema tests and 27-check integrity preflight PASS (s2-source-* logs). S2 remains partial for the recorded remaining workflows and acceptance.
