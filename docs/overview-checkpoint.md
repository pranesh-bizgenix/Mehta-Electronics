# Overview — available delivered-data checkpoint

All changes are in the local `feature/base-building` working tree. No connector, connector configuration, or Tally records were modified. No new database migration was required.

## Implemented

- Company and delivered-upload-window selectors, refresh, sync state, last successful import, dataset coverage, and latest-run failure/stall messages.
- Recorded signed stock value, ledger/item/group counts, customer and supplier classifications from Sundry Debtors/Creditors and descendant groups, and readable negative/zero quantity counts.
- Inventory group distribution by actual item count, cash/bank account directory, data-quality details, missing-data coverage, and original CRM workflow metrics.
- Customer, item, group, quality and sync drill-downs. When account balances are absent, the page shows the delivered account directory and explicitly withholds a cash total.
- Responsive dark-green visual treatment, keyboard focus, loading/error/retry states and exact Indian-formatted amounts. Card abbreviations retain the exact amount immediately below and on focus/hover.

The new page reads PostgreSQL only. It does not trigger a Tally request or a connector sync.

## Verified against real stored records

At the browser-check snapshot: 4,149 ledgers, 10,988 items, 78 groups, 2,484 customer ledgers, and 933 supplier ledgers. Classification counts are labelled **Computed by CRM** and are not editable CRM sales-master counts.

5,191 items have closing values; 5,797 do not. The stock figure is the database sum of the supplied signed values, not an asserted complete inventory valuation. Missing values are excluded, not converted to zero. Original signs are preserved; no debit/credit convention or net position is inferred. The exact amount can change with later real uploads.

The checked snapshot contains 627 items with readable negative quantities and 1,729 with readable zero quantities. Another 4,084 quantity values could not be classified; that limitation is displayed. Cash/bank grouping identifies 17 accounts, but their closing balances are absent in this snapshot.

The displayed upload window is the connector's historical voucher window. It is **not** presented as a verified master valuation date. Each Tally metric is dated with the upload's received timestamp; the page also distinguishes import time from workflow query time.

## Access control

`TALLY_FINANCIAL_ROLES` defaults to `OWNER,ACCOUNTS`. The server rejects other roles on `/api/dashboard/tally` and `/api/dashboard/quality`. Overview for those roles contains workflow and basic sync health only. Accounts does not gain connector pairing/revocation privileges.

The overview intentionally does not expose the general audit feed, which can contain unrelated business events. Existing enquiry, quotation, order and master workflows remain available.

## Withheld figures

Receivable/payable totals, overdue percentages, ageing, top debtors/creditors by outstanding, reported statement headlines, financial parity and net position remain unimplemented. Their raw XML is retained, but no financial totals are invented from it. Sales/billing/collections and top-selling items remain labelled **Awaiting voucher data**.

Workflow queues that do not exist in the current schema—quotation approvals, margin flags, order-reply approvals and overdue tasks—are named as unavailable rather than assigned fake zero counts. Actual empty CRM workflow tables display **No activity yet**.

## Verification

- 41 tests passed: existing CRM workflows and imports, exact decimal formatting, negative and missing stock values, company isolation, invalid company/period selection, Owner/Accounts access and rejection of non-financial roles.
- Chrome checked the actual local PostgreSQL-backed page at 1440×1000 and 390×844, company/window selectors, quality details, group details and item navigation; zero console errors and no horizontal page overflow.
- Screenshots: `output/overview/overview-desktop.png`, `overview-phone.png`, `quality-desktop.png`, `quality-phone.png`.
- Run `npm.cmd run tally:verify:overview` to repeat the browser check. It starts an ephemeral HTTP server, uses a temporary audited Owner verification session, and removes that session and stops its server afterward. It does not change the owner's password.

## What to open

Start the project with `npm.cmd run dev`, open `http://127.0.0.1:3000`, and select **Overview**. Check the company/window selectors, partial-value disclosure, master counts, group chart, quality details and links into Customers/Items. The local project is not left running by the verification command.

Primary files: `src/overview.js`, dashboard routes in `src/app.js`, `public/overview.js`, `public/overview.css`, module wiring in `public/app.js` and stylesheet wiring in `public/index.html`.
