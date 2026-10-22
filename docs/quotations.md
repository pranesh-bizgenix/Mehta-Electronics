# Quotations

Open **Quotations** in the existing CRM. The project remains stopped; start it normally when ready to use the changes.

## First use

1. Sign in as an owner. Open **Policy & letterhead**, enter the margin floor, seller GST state, company details and a reason.
2. Open **Item costs** and enter each item's CRM cost before GST. Costs are owner-entered; Tally quantities/rates/values are never treated as costs or updated.
3. Create a quotation, search for a customer and items, confirm the place of supply, enter GST rates, validity, terms and a creation reason. An enquiry's **Create quotation** button carries its customer, items, quantities and target rates into a draft.
4. Submit the draft. A different manager or owner reviews the saved version. Below-floor approval requires an explicit exception checkbox and reason.
5. Export PDF or open the print view. **Mark sent** records delivery performed outside the CRM; it does not send email. The existing email endpoint also works for managed quotations after approval.
6. Mark a sent quotation won/lost. Cancel with a reason, or explicitly mark an elapsed quotation expired. Won quotations can use the existing sales-order conversion.

No default floor or guessed seller state is activated in the real database. Missing policy prevents creation; missing costs prevent submission. A missing cost entered later must be captured through **Edit / revise** before submission.

## Margin, tax and rounding policy

The default basis is gross margin on discounted sales before GST: `(net sales − extended CRM cost) / net sales × 100`. The owner chooses **every line and total** (default) or **total only**. Every submitted quotation goes through independent review, including quotations above the floor. The creator and the latest version's editor cannot approve it.

Inputs accept up to 12 whole and six decimal places. Shared browser/server BigInt arithmetic rounds each line's discounted amount, extended cost and tax component half-up to paise. Totals sum those rounded amounts. Floor comparisons use exact integer cross multiplication; displayed percentages truncate to two decimal places. A zero net-sales quotation cannot be submitted. Currency is INR.

GST uses the configured supplier state and an explicitly confirmed **place of supply**, initially suggested from the customer. Standard domestic same-state supplies use CGST + SGST (UTGST for applicable territories); different-state supplies use IGST. GST rates are entered by the user, not inferred from HSN. SEZ, export and other special supplies are blocked from this editor until a separate tax treatment is implemented. This distinction follows [CBIC's IGST provisions, sections 7–8](https://cbic-gst.gov.in/hindi/IGST-bill-e.html).

Validity is checked using the India calendar date. Expiry is an explicit, audited action; reads never silently alter status.

## Approval and version integrity

`DRAFT → PENDING_APPROVAL → APPROVED → SENT → WON / LOST`

Managers can return pending drafts for changes. Active non-terminal quotations can be cancelled, with a reason. Elapsed drafts, pending, approved or sent quotations can be explicitly expired.

Editing a draft, pending or approved quotation saves a new immutable version and returns it to draft. Sent/terminal quotations are immutable; duplicate them into a new draft with current policy/costs. Duplicate records retain their source quotation ID and inherit no approval.

Changes to policy or item cost block approval/sending until the quotation is revised and reviewed again. Stale unsent approvals render as draft documents. Draft/pending/cancelled/lost/expired documents carry **NOT APPROVED FOR ISSUE**. Issued documents retain their historical commercial details. PDF and print render public fields only, even for an owner. The bundled SIL Open Font License Noto Sans Devanagari font supports Latin and Devanagari names in PDFs; the browser print view uses system fonts.

## Access and audits

| Role | Quotation access | Internal pricing | Approval | Policy / cost changes |
| --- | --- | --- | --- | --- |
| Executive | Read, create, revise, submit, duplicate, documents | Hidden | No | No |
| Manager | Above plus outcomes, cancellation, delivery and order conversion | Read | Independent approval, including explicit floor exceptions | No |
| Accounts | Read, history, documents | Hidden | No | No |
| Owner | All business actions | Read | Independent approval | Yes |

General audit logs contain public action metadata, version and reason. Sensitive cost and policy changes, version pricing, and approval details live in dedicated quotation history records. Those details are returned only to pricing-authorized roles, including through the policy/cost history endpoints. Server responses redact pricing from quotation lists, details and version histories for other roles; hiding is not delegated to CSS.

Lines removed during revision are archived; every revision records its reason. Versions/events reject updates, deletes and truncation. Business quotation records cannot be deleted or truncated. No DELETE API exists. Existing raw imports, connector code and connector calls are unchanged.

## Additive schema and API

Migration **0012_quotation_workflow.sql** adds five CRM tables, each with `id`, `created_at`, `updated_at`, `created_by`, `status`, `is_deleted`:

| Table | Purpose |
| --- | --- |
| `crm_quotation_policy` | Owner floor, basis, seller state, letterhead and policy revision |
| `crm_quotation_costs` | Owner-entered cost per existing CRM item |
| `crm_quotation_workflows` | Canonical workflow, version, public/private snapshots, duplicate source |
| `crm_quotation_versions` | Immutable commercial and private pricing snapshots |
| `crm_quotation_events` | Immutable business actions and private approval/pricing history |

Existing `quotations` and `quotation_lines` identities remain available to customer history and sales orders. Workflow statuses map to legacy statuses: pending/approved remain legacy `DRAFT`, won maps to `ACCEPTED`, lost to `REJECTED`. New workflow lists show canonical statuses. Existing historical quotations stay available through **View historical quotations**; they are not silently enrolled or rewritten.

The migration only creates CRM tables, functions, indexes and guards. It neither alters imported tables nor rewrites existing migrations or existing records. The local migration runner verified all 12 checksums; row counts in all 42 previously existing tables were unchanged. A pre-verification backup is retained at `%TEMP%/mehta-before-quotations-098ee6cbcbad.dump`.

| Endpoint | Purpose |
| --- | --- |
| `GET/PUT /api/crm/quotation-policy` | Read policy / owner configure |
| `GET /api/crm/quotation-policy/history` | Authorized policy audit |
| `GET/PUT /api/crm/quotation-costs/:id` | Authorized cost read / owner change |
| `GET /api/crm/quotation-costs/:id/history` | Authorized cost audit |
| `GET /api/crm/quotation-enquiries/:id` | Enquiry draft source with exact decimal quantities/rates |
| `GET/POST /api/crm/quotations` | Search/status/paginated list / create |
| `GET/PUT /api/crm/quotations/:id` | Detail / versioned revision |
| `POST /api/crm/quotations/:id/actions` | SUBMIT, APPROVE, RETURN, SEND, WON, LOST, EXPIRE, CANCEL |
| `POST /api/crm/quotations/:id/duplicate` | New draft linked to source |
| `GET /api/crm/quotations/:id/history` | Saved versions and events |
| `GET /api/crm/quotations/:id/pdf` | Letterhead PDF |
| `GET /api/crm/quotations/:id/print` | Print-friendly customer document |

New writes require session/CSRF, permission, validation and a reason. Revisions/actions require the current integer `version`; stale requests return 409. Approval exceptions require `overrideFloor: true`. Cost input is `unitCost`; quotation line fields are `itemId`, `quantity`, `unitPrice`, `discountPercent`, `taxPercent`.

Existing `/api/quotations` routes remain registered. New quotations created there also enter the workflow. Legacy managed-draft edits create a workflow revision; legacy status/email calls cannot skip approval. Legacy reads/PDF use stored rounded totals for managed quotations. Previously existing unmanaged records retain their existing behavior. SMTP configuration is unchanged. As with any SMTP delivery, a lost connection after acceptance can require checking delivery before retrying; SMTP and PostgreSQL do not share an atomic transaction.

## Verification and changed files

Run quotation tests with `RUN_QUOTATION_DB_TEST=1 node --test test/quotations.test.js` (PowerShell: set `$env:RUN_QUOTATION_DB_TEST='1'` first). Run `node scripts/verify-quotations.mjs` for real browser/API/PostgreSQL checks. Tests retain isolated synthetic databases; they never contact live Tally. `scripts/verify-crm-modules.mjs` also passes with the new workflow setup.

Evidence: [desktop editor](../output/quotations/editor-desktop.png), [manager review](../output/quotations/manager-review.png), [history](../output/quotations/history.png), [mobile enquiry conversion](../output/quotations/enquiry-quotation-mobile.png), [print view](../output/quotations/print-view.png), [sample PDF](../output/quotations/sample-quotation.pdf), [verification report](../output/quotations/verification.json).

Files changed for this module:

- `.gitattributes`
- `database/postgres/migrations/0012_quotation_workflow.sql`
- `src/app.js` (CRM quotation imports, registration and handlers only)
- `src/rbac.js`
- `src/quotation-workflow.js`
- `src/quotation-workflow-routes.js`
- `src/quotation-document.js`
- `src/assets/NotoSansDevanagari.ttf`
- `src/assets/OFL-NotoSansDevanagari.txt`
- `public/app.js` (CRM navigation/callbacks only)
- `public/design-system.css`
- `public/quotations.js`
- `public/quotation-math.js`
- `public/quotation-print.css`
- `public/quotation-print.js`
- `test-support/crm-module-fixture.js`
- `test-support/quotation-fixture.js`
- `test/quotations.test.js`
- `scripts/verify-crm-modules.mjs`
- `scripts/verify-quotations.mjs`
- `docs/quotations.md`
- Seven evidence files under `output/quotations/`, linked above.

The unrelated existing edit to `apps/web/next-env.d.ts` is preserved and excluded from these commits. No connector file is changed. No project service is started by this delivery.
