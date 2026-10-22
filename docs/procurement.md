# Purchasing: RFQs, supplier POs, GRNs and supplier documents

Open **Purchasing** in the sidebar as Manager or Owner. Executive and Accounts do not have purchasing permissions; supplier costs and margin stay within authorised roles.

## Workflow

1. **Vendors:** create a CRM purchasing vendor, optionally linked to an existing CRM vendor imported through reconciliation. Enter GSTIN, state, address and contact information. Inactivate or archive with a reason; records remain available for history.
2. **Purchase requests:** enter required CRM items and quantities, or select an existing customer sales order. The source preserves commercial fields only; customer credit details are excluded.
3. **Vendor RFQs:** select vendors, record their replies manually, compare prices side by side and select a winner. Replies include quantities, discount, GST, validity, lead time and terms. The winner must cover every requested quantity and remain valid. Winner selection freezes the replies.
4. **Supplier POs:** create from the winning RFQ or a sales order. Sales-order sourcing requires entering purchase prices explicitly. Submit the draft, obtain independent Manager/Owner approval, then issue it. Issuing records the CRM state; it does not send email or write to Tally.
5. **Goods receipts:** record received, accepted and rejected quantities against issued PO lines. Actual part code, rate and GST can be entered to expose differences. Partial receipts show remaining quantities. Over-receipts, damaged/rejected goods and item/rate/tax differences need explicit independent review before posting. Posted receipts are retained and cannot be rewritten. GRNs never adjust Tally stock.
6. **Supplier documents:** retain PDF, PNG or JPEG originals up to 10 MB for acceptances, dispatch invoices, packing slips and test reports. View the original beside the manual entry form, confirm transcription, then review the comparison. The original file remains downloadable. A replacement archives the old record with a reason and preserves its bytes.

PO states: `DRAFT → PENDING_APPROVAL → APPROVED → ISSUED → PARTIALLY_RECEIVED / RECEIVED`. Pending or approved POs can be returned to draft. Cancel with a reason before posted receipts exist. Submitted/approved data changes invalidate approval; issuance checks the current approval fingerprint.

The creator/latest commercial editor cannot approve their own PO. GRNs require a different poster, and supplier documents require a reviewer different from the uploader/latest manual editor. Stale versions and stale comparison fingerprints are rejected. Audit events retain snapshots, actor, time and reason; the general audit log excludes supplier prices.

## Comparisons and margin

Comparisons flag missing/extra items, part codes, quantities, UOM and relevant price, discount and tax differences. Customer selling prices are not expected to equal supplier purchase prices. Acceptance/invoice prices are compared to the supplier PO, while customer PO quantities, parts and taxes are checked separately.

Margin uses the existing owner-configured quotation policy: gross margin on discounted sales before GST, with line and/or whole-document checks according to that policy. Supplier net costs are compared with the linked customer order's selling value for the purchase quantities. Unknown or ambiguous matching/UOM produces an unavailable-margin alert. Packing slips and test reports do not create assumed zero-cost margin. Exceptions require explicit acknowledgement and a review reason. Certain invalid source/vendor states block PO approval outright.

## Excel limitation

**Connectwell's exact workbook format is pending the original template.** The current download is explicitly labelled **Generic Excel** in both the UI and workbook. It is a valid XLSX containing supplier-facing PO fields, without customer selling prices or margin. It does not claim Connectwell compatibility. Provide the original Connectwell workbook to implement its exact sheets, cells, formatting and formulas.

## Database and API

New migrations only:

- `0015_procurement.sql`: nine CRM tables: `crm_procurement_vendors`, `crm_purchase_requests`, `crm_rfqs`, `crm_rfq_vendors`, `crm_rfq_vendor_replies`, `crm_supplier_pos`, `crm_grns`, `crm_supplier_documents`, `crm_procurement_events`.
- `0016_procurement_guard_fix.sql`: forward correction to the new record guard's table-specific field checks.

Tables have IDs, timestamps, creator, status and soft-delete metadata. Lines and commercial snapshots use JSONB payloads; entity/source relationships use foreign keys. Originals use immutable bytea plus SHA-256. DELETE/TRUNCATE guards reject hard deletion. Existing migrations, imported Tally tables and connector implementations are unchanged.

All routes are under `/api/crm/purchasing`, use the existing authenticated router and CSRF protection, and leave existing routes in place:

| Route | Purpose |
| --- | --- |
| `GET /vendor-sources`, `/order-source/:id` | CRM source selections |
| `GET /:kind`, `/:kind/:id`, `/:kind/:id/history` | Search/pagination, record and audit history |
| `POST /vendors`, `/requests`; `PUT /vendors/:id`, `/requests/:id` | Vendor/request editing |
| `POST /rfqs`, `/rfqs/:id/replies`, `/rfqs/:id/winner`; `GET /rfqs/:id/comparison` | RFQ workflow |
| `POST /pos`; `PUT /pos/:id`; `GET /pos/:id/detail`; `POST /pos/:id/actions` | PO workflow |
| `GET /pos/:id/export?format=generic` | Explicit generic XLSX; unspecified/exact format returns 409 |
| `POST /pos/:id/grns`; `GET /grns/:id/check`; `POST /grns/:id/post` | Receipt/review workflow |
| `POST /pos/:id/documents`; `GET /documents/:id/original` | Retained original upload/download |
| `PUT /documents/:id/review-data`; `GET /documents/:id/comparison`; `POST /documents/:id/approve` | Manual document review |
| `POST /:kind/:id/cancel` | Supported draft/request/RFQ/receipt cancellation with reason |

## Verification and files

Run `RUN_PROCUREMENT_DB_TEST=1 node --test test/procurement.test.js` with the environment variable syntax appropriate to your shell, then `node scripts/verify-procurement.mjs`. Tests use retained synthetic databases, verify unchanged raw imports and reject external Tally calls. Browser evidence, a generic workbook and results are in `output/procurement/`. Quotation and sales-order database regression tests also pass.

Changed files: `.gitattributes`; the two migrations above; `src/procurement.js`, `src/procurement-routes.js`, `src/procurement-xlsx.js`, CRM registration in `src/app.js`, `src/rbac.js`; `public/procurement.js`, CRM registration/navigation in `public/app.js`, `public/index.html`, `public/ui-components.js`, `public/design-system.css`; `test-support/crm-module-fixture.js`, `test-support/procurement-fixture.js`, `test/procurement.test.js`, `scripts/verify-procurement.mjs`; this document and `output/procurement/` evidence. None belongs to the frozen connector.
