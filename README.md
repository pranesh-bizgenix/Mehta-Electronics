# Mehta Siemens CRM - Phase 2 Sales Pipeline

A dependency-light CRM implementing authentication, users, RBAC, customer and item masters, duplicate detection, read-only Tally synchronization, reconciliation, audit logs, and a central dashboard.

Phase 2 development has started with the sales pipeline milestone:

- Multi-line customer enquiries with ownership, expected dates, and controlled status transitions.
- Multi-line quotations linked to enquiries, with discounts, taxes, totals, validity, and terms.
- Draft editing for enquiries and quotations with mandatory change reasons and immutable numbered revisions.
- Branded quotation PDF generation, browser printing, downloads, and SMTP email delivery with the PDF attached.
- Manager-controlled quotation lifecycle and automatic enquiry progression when a quotation is sent.
- Accepted quotation conversion into a price-snapshot sales order, with PO details and controlled fulfilment statuses.
- Role permissions, immutable audit events, search, pagination, and dashboard pipeline metrics.

Purchasing, billing/posting, collections, dispatch quantities, and advanced MIS remain planned Phase 2 milestones.

## Demo data

Load a repeatable sample dataset into the configured database:

```powershell
npm run seed:demo
```

This adds three fictional customers, four Siemens sample items, three enquiries, two quotations, and one sales order. It is safe to run again: the importer records its version and will not duplicate the dataset. Demo records are never added automatically.

## Quotation email delivery

PDF viewing, printing, and downloads work without additional configuration. To send quotation emails, set these values in `.env`:

```text
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-user
SMTP_PASSWORD=your-smtp-password
SMTP_FROM=sales@example.com
```

Set `COMPANY_NAME`, `COMPANY_ADDRESS`, `COMPANY_GSTIN`, `COMPANY_EMAIL`, and `COMPANY_PHONE` to control the business information printed on quotation PDFs. Keep SMTP credentials out of source control.

## Run

Requires Node.js 22.5 or newer and PostgreSQL. All CRM and connector data use the database configured by `DATABASE_URL`. The database user must be able to create tables, sequences, and the `citext` extension (or have an administrator install it first).

```powershell
Copy-Item .env.example .env
# Set DATABASE_URL to your PostgreSQL database before continuing.
npm.cmd install
npm.cmd run db:migrate:postgres
npm.cmd start
```

Open `http://127.0.0.1:3000`. On a new database the bootstrap owner is read from `SEED_OWNER_EMAIL` and `SEED_OWNER_PASSWORD`. Change the temporary password at first login. Never use the example password in production.

The server loads simple `KEY=value` entries from `.env`, then fills unset values from `.env.local`; shell environment variables take precedence. `DATABASE_URL` is required. Startup applies pending PostgreSQL migrations before listening.

## Verification

```powershell
npm test
npm run lint
npm run build
```

Tests create and drop isolated PostgreSQL databases using `TEST_DATABASE_URL` (or `DATABASE_URL` when unset). The test connection needs `CREATEDB` permission. They do not write test records into the configured CRM database. PostgreSQL client tools are required for the backup/restore test; set `PG_BIN` if they are not on PATH. Windows installations under Program Files are detected automatically.

Create a PostgreSQL archive with `npm.cmd run db:backup -- ./data/backups/crm.dump`. Existing destinations are never overwritten. Restore into a separate empty database with `pg_restore --exit-on-error --no-owner --no-acl --dbname=<target> <archive>`, then verify it before switching `DATABASE_URL`. See `docs/database-migration-plan.md`.

## Security model

- Passwords use Node's `scrypt` with a per-user random salt.
- Opaque session tokens are stored only as SHA-256 hashes; cookies are HttpOnly and SameSite=Strict.
- Mutating authenticated requests require a per-session CSRF token.
- Login attempts are rate limited and disabled users cannot authenticate.
- Backend permission checks protect every API; the UI also hides actions the current user cannot perform.
- All SQL values are parameterized, resource identifiers are validated, and masters cannot be hard-deleted.
- Audit records have no update/delete API and are protected by PostgreSQL triggers.

## Tally integration

Configure `TALLY_URL` and `TALLY_COMPANY`. The connector sends only Tally XML export/read requests. There is no write, import, voucher, invoice, or posting path. Sync jobs persist their status, errors, attempts, and next retry time. Successful snapshots are compared with CRM masters by GSTIN/PAN/name for customers and part code/alternate codes for items.

The actual Tally server must allow HTTP XML export access from the CRM host. Use the **Sync now** action as Manager, Accounts, or Owner.

## Windows Tally Connector

The CRM supports both the Node.js Tally Engine and the Bizgenix Windows Tally Connector for a Tally PC that cannot be reached directly by the CRM. Both are outbound, read-only connections: they read Tally on `localhost:9000` and upload snapshots to the CRM over HTTPS. Neither writes to Tally.

1. Set `DATABASE_URL` and run `npm.cmd run db:migrate:postgres`.
2. Sign in as the CRM Owner and open **Tally Connector**.
3. For the Node.js Engine, create a **Node.js connector setup** using the exact company name shown in TallyPrime. On the Tally PC, run the Engine's `node setup.mjs` and enter the website URL, organization ID, setup token, profile name, and exact company name displayed by the CRM.
4. For the Bizgenix Windows app, choose **Generate Windows app pairing code** and enter the one-time code and CRM URL in the app within 10 minutes.
5. Keep TallyPrime open and enable its HTTP server on port `9000`; start the Node.js Engine in watch mode or the Windows connector service as appropriate.

The Node.js setup token is shown once and stored in PostgreSQL only as a hash. The Windows app's pairing code can be used once, expires after 10 minutes, and exchanges for expiring bearer/refresh tokens stored only as hashes. Revoke the connector from the CRM if the PC or token is no longer trusted.

If no data arrives, run `npm.cmd run tally:diagnose` on the CRM computer. It sends the same read-only company-list request as the Windows connector and reports pairing/heartbeat/upload status without printing credentials. When CRM and Tally run on different computers, this checks the CRM's configured Tally address; use the Windows app's own **Load from Tally** control to check the Tally PC.

A company visible on Tally's selection screen may not be open. Open it into Gateway of Tally, then choose the exact name returned by **Load from Tally**, including any suffix. Maximize the Windows setup window if its lower controls are clipped, and click **Connect and Start Service** after entering a fresh pairing code. Typing a code alone does not complete pairing. CRM shows **Awaiting pairing** until the exchange succeeds and tracks actual heartbeats separately from the setup record's enabled status.

The CRM accepts the Windows connector's eight core XML fields and six optional control reports. Uploaded Tally ledgers and stock items appear under **Tally & reconciliation**, including records not linked to CRM masters. Importing a snapshot does not automatically create CRM customers from every accounting ledger.
