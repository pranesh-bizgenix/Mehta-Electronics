# Customers, items and enquiries

These modules extend existing CRM records and keep Tally accounting/stock facts read-only. No connector implementation, pairing/sync/polling/upload handler, or existing raw/imported table was edited. Existing routes remain available.

## Customers

The Customers navigation now opens the CRM list with search, status filters, Tally-linked badges, credit information and create/view actions. **Saved Tally** opens the stored read-only master browser.

Customer create/edit supports GSTIN format validation, GSTIN/state-code agreement, payment terms, credit days, credit limit, billing address, multiple contacts, a single primary contact, and an explicit company/exact-ledger-name mapping. Contacts retain stable IDs when edited. Removing an existing contact archives it with the customer's required edit reason; it is not deleted.

Detail tabs show overview, contacts, customer part numbers, enquiries, quotes, orders, invoices and dues. Customer part mappings support create/edit/inactivate/archive against active CRM items. History lists show the latest 100 records, using existing document tables and the viewer's corresponding read permission.

**Invoice history is explicitly unavailable:** the existing imported data does not expose normalized invoice records. The tab reports that limitation; it does not fabricate invoices or infer invoice totals from a closing balance.

Dues are the uniquely linked Tally ledger's signed closing balance, explicit Dr/Cr when supplied, and fetch time. Missing or ambiguous links produce an unavailable state. This figure is not a bill-level due, overdue balance or ageing calculation. Only existing configured financial roles receive balances; other roles receive an access explanation.

## Items and prices

Item create/edit supports part number, description, HSN, UOM, pack size, MOQ, list price, default discount and company/exact-stock-name mapping. The Stock tab reads original quantity, rate and permitted closing value from the stored stock item; it performs no adjustment, reservation or unit conversion. A unique audited link can use an internal CRM part number distinct from the exact stored stock name.

Price lists support create/edit/inactivate/archive, currency, effective dates, list discount and multiple item quantity tiers with unit price and tier discount. Removed tiers remain archived. Prices are PostgreSQL NUMERIC(20,6); new pricing reads return decimal strings. Financial values are not summed using JavaScript floating point in these modules. List/item/tier discounts are recorded separately: no unapproved discount stacking, automatic list precedence, quotation repricing or historical document rewrite is introduced.

Explicit new master mappings are recognized by the stored-data reconciliation service, preventing an already-linked CRM alias from being offered for duplicate creation. Company plus exact stored Tally name establishes identity; no fuzzy matching is used. Older ambiguous mappings remain conflicts.

## Enquiries

The new form supports searchable customer/item lookups, quantity, subject, source, expected-by date, notes and active owner assignment. Lookup searches reach the server and show up to 100 results per search, so records beyond the initial page remain selectable.

Lists support text, status, owner, source and expected-date-range filtering with server pagination. The new flow is NEW → QUOTED → WON/LOST; invalid jumps are rejected. Legacy QUALIFIED/CANCELLED states remain supported for compatibility. Status changes require a reason. Terminal records do not offer editing. New/qualified enquiries can be revised; previous lines are archived and immutable revision snapshots retained. Create quotation opens the existing quotation workflow.

## APIs and authorization

All APIs use existing sessions, CSRF protection and backend permissions. Reads and writes are independent of UI button visibility. Each write is validated, transactional and audited. Edit/status/archive operations require a reason; failed validation rolls back the entire operation.

| Endpoint | Methods | Permission |
|---|---|---|
| `/api/crm/customers` | GET / POST | `customers.read` / `customers.create` |
| `/api/crm/customers/:id` | GET / PATCH | `customers.read` / `customers.update` |
| `/api/crm/customers/:id/history/:tab` | GET | Customer read plus the document's read permission; dues additionally mask financial data |
| `/api/crm/customers/:id/part-mappings` | POST | `customers.update` |
| `/api/crm/customers/:id/part-mappings/:mapping` | PATCH | `customers.update` |
| `/api/crm/items` | GET / POST | `items.read` / `items.create` |
| `/api/crm/items/:id` | GET / PATCH | `items.read` / `items.update` |
| `/api/crm/price-lists` | GET / POST | `items.read` / `items.update` |
| `/api/crm/price-lists/:id` | GET / PATCH | `items.read` / `items.update` |
| `/api/crm/enquiries` | GET / POST | `enquiries.read` / `enquiries.create` |
| `/api/crm/enquiries/:id` | GET / PUT | `enquiries.read` / `enquiries.update` |
| `/api/crm/enquiries/:id/status` | PATCH | `enquiries.update` |
| `/api/crm/owners` | GET | Authenticated customer/enquiry readers; active IDs/names only |

Master and enquiry lists accept `search`, `status`, `page`, `pageSize` (maximum 100). Enquiries additionally accept `ownerId`, `source`, `from`, `to`.

Customer body fields include `name`, `customerCode`, `gstin`, `stateCode`, `paymentTerms`, `creditDays`, `creditLimit`, `billingAddress`, `status`, `companyId`, `tallyName`, `contacts`, `reason`. Contact entries use `id` for edits plus `name`, `designation`, `phone`, `email`, `isPrimary`.

Item fields include `partCode`, `description`, `hsn`, `uom`, `packSize`, `moq`, `listPrice`, `discountPercent`, `status`, `companyId`, `tallyName`, `reason`.

Enquiry fields include `customerId`, `subject`, `source`, `expectedBy`, `ownerId`, `notes`, `lines:[{itemId,quantity}]`, `reason`. A status request uses `{status,reason}`.

Price lists use `name`, `currency`, `effectiveFrom`, `effectiveTo`, `discountPercent`, `status`, `entries:[{id,itemId,minQuantity,unitPrice,discountPercent}]`, `reason`.

GSTIN checks are structural and state-prefix checks, not verification of a registration against an external authority. Quantities/amounts must be valid non-negative decimal inputs with at most six fractional digits; quantities, pack sizes and MOQ must be positive. Discounts stay within 0–100. Calendar dates, referenced active records, parent ownership of child IDs, primary-contact uniqueness, email format and source-link uniqueness are validated.

## Database and compatibility

Only new migrations were added:

- `0008_crm_master_extensions.sql`: five audited CRM tables (`crm_customer_profiles`, `crm_item_profiles`, `crm_customer_part_mappings`, `crm_price_lists`, `crm_price_list_items`) and two aggregate, non-updatable read views for linked dues/stock.
- `0009_crm_child_archival.sql`: archival metadata on CRM contacts and enquiry lines.
- `0010_crm_quotation_line_archival.sql`: quotation-line archival metadata for the existing revision path.
- `0011_crm_hard_delete_guards.sql`: reject physical deletion/truncation of CRM master/document history.

All new tables have ID, creation/update timestamps, creator, status and soft-delete flag. Metadata triggers write before/after audits in the transaction. Foreign keys preserve relationships. Historical migration files and imported schemas remain untouched; LF rules apply only to new migration files.

The existing contact, enquiry and quotation revision paths now retain archived children. Existing detail readers, duplicate contact checks, enquiry line counts, quotation list totals and workflow pipeline sums exclude archived rows. Quotation create/edit/PDF and existing sales flows continue to use the existing contracts.

The local migration runner reported all 11 migrations current. No business fixture records were added to the application database.

## Verification and screenshots

```powershell
$env:RUN_CRM_MODULE_DB_TEST='1'
node --test test/crm-modules.test.js
$env:RUN_TALLY_READ_DB_TEST='1'
node --test test/tally-read.test.js
node scripts/verify-crm-modules.mjs
node scripts/verify-stored-tally.mjs
node scripts/preview-design.mjs
```

The three module tests and six stored-data tests passed, including PostgreSQL integration. The CRM browser test uses the actual UI, API handlers and PostgreSQL in a synthetic isolated database. It verified customer/item create/edit, contacts and tiers retained as archives, customer part mapping, read-only dues/stock, enquiry revision and transitions, immutable revision history, role denial and CSRF denial, and mobile page overflow. Existing quotation create/edit retained old lines and returned the correct revised total in both detail and list responses. The final browser run produced 20 audit entries, zero browser errors and zero external Tally calls. Imported fixture rows were identical before and after the workflows.

The stored-data browser check and ten-screen desktop/tablet/simulated-4G design preview also passed. Their historical capture files were preserved. Synthetic review databases are retained rather than silently dropped; their names appear in the test output and the final [verification record](../output/crm-modules/verification.json).

- [Customer dues](../output/crm-modules/customer-dues.png)
- [Customer part mappings](../output/crm-modules/customer-part-mappings.png)
- [Customer on mobile](../output/crm-modules/customer-mobile.png)
- [Item stock](../output/crm-modules/item-stock.png)
- [Price-list form](../output/crm-modules/price-list-form.png)
- [Enquiry history](../output/crm-modules/enquiry-history.png)
- [Enquiry on mobile](../output/crm-modules/enquiry-mobile.png)

## Changed files

- `.gitattributes`
- `database/postgres/migrations/0008_crm_master_extensions.sql`
- `database/postgres/migrations/0009_crm_child_archival.sql`
- `database/postgres/migrations/0010_crm_quotation_line_archival.sql`
- `database/postgres/migrations/0011_crm_hard_delete_guards.sql`
- `src/crm-modules.js`
- `src/crm-module-routes.js`
- `src/app.js` — additive route registration and CRM archival/read compatibility only
- `src/db.js` — CRM child archival/read helpers only
- `src/overview.js` — CRM pipeline excludes archived quotation lines
- `src/tally-read-service.js` — new audited CRM mappings recognized during reconciliation
- `public/crm-modules.js`
- `public/app.js` — module navigation wiring only
- `public/design-system.css`
- `public/ui-components.js` — guard shell bootstrap for historical previews
- `test/crm-modules.test.js`
- `test/tally-read.test.js`
- `test-support/crm-module-fixture.js`
- `scripts/verify-crm-modules.mjs`
- `scripts/verify-stored-tally.mjs`
- `scripts/preview-design.mjs`
- `docs/crm-modules.md`
- `output/crm-modules/customer-dues.png`
- `output/crm-modules/customer-part-mappings.png`
- `output/crm-modules/customer-mobile.png`
- `output/crm-modules/item-stock.png`
- `output/crm-modules/price-list-form.png`
- `output/crm-modules/enquiry-history.png`
- `output/crm-modules/enquiry-mobile.png`
- `output/crm-modules/verification.json`

The pre-existing `apps/web/next-env.d.ts` modification is excluded from these changes and commits.
