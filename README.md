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

Requires Node.js 22.5 or newer.

```powershell
Copy-Item .env.example .env
npm start
```

Open `http://127.0.0.1:3000`. On a new database the bootstrap owner is read from `SEED_OWNER_EMAIL` and `SEED_OWNER_PASSWORD`. Change the temporary password at first login. Never use the example password in production.

The server loads simple `KEY=value` entries from `.env`; shell environment variables take precedence.

## Verification

```powershell
npm test
npm run lint
npm run build
```

## Security model

- Passwords use Node's `scrypt` with a per-user random salt.
- Opaque session tokens are stored only as SHA-256 hashes; cookies are HttpOnly and SameSite=Strict.
- Mutating authenticated requests require a per-session CSRF token.
- Login attempts are rate limited and disabled users cannot authenticate.
- Backend permission checks protect every API; the UI also hides actions the current user cannot perform.
- All SQL values are parameterized, resource identifiers are validated, and masters cannot be hard-deleted.
- Audit records have no update/delete API and are protected by SQLite triggers.

## Tally integration

Configure `TALLY_URL` and `TALLY_COMPANY`. The connector sends only Tally XML export/read requests. There is no write, import, voucher, invoice, or posting path. Sync jobs persist their status, errors, attempts, and next retry time. Successful snapshots are compared with CRM masters by GSTIN/PAN/name for customers and part code/alternate codes for items.

The actual Tally server must allow HTTP XML export access from the CRM host. Use the **Sync now** action as Manager, Accounts, or Owner.

