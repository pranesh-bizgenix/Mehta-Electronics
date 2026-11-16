# Quotation policy and cost setup — 4 November 2026

## Screens

- `/quotations?tool=policy`: field errors for margin floor, margin basis, seller state, company name, GSTIN/state consistency, optional email and field lengths. The margin basis starts empty when no policy exists. A failed load is shown and prevents saving. History shows actor, timestamp, reason and before/after values.
- `/quotations?tool=costs`: select an active CRM item, inspect its recorded cost to six decimal places, enter a replacement with a reason, and inspect that item's change history. A failed cost load is not shown as a missing cost.
- Quotation creation and submission explain missing setup and link authorised users directly to the setup drawer. After entering missing costs, save the draft again so the reviewed version captures those costs.

Role permissions remain unchanged. Import preview and commit require both `quotations.cost.manage` and `quotations.cost.read`; the existing handler enforces session, CSRF for writes and configured MFA. History retains its existing `quotations.cost.read` restriction.

## Reviewed import

1. Prepare UTF-8 CSV or a single-worksheet `.xlsx` workbook with exactly two columns: `part_code` and `unit_cost`. Part codes identify existing active CRM items; this does not create items or write to Tally.
2. Costs are literal non-negative decimals with at most 14 whole digits and six decimal places. Currency signs, thousands separators, scientific notation and formulas are rejected. For long exact decimals in Excel, enter the cell as text so the file itself preserves the entered digits.
3. Upload a non-empty file no larger than 512 KB and containing at most 1,000 item rows, and provide a reason. These are technical upload limits, not business policy defaults. Save legacy `.xls` as `.xlsx` or CSV first.
4. **Review import** shows each part code, description, current cost, proposed cost and issues. Preview writes nothing. Duplicate codes, inactive/unknown items and invalid decimals block the entire import.
5. **Confirm and save** reparses the upload and rebuilds the preview under the existing quotation advisory lock. The fingerprint includes file content, filename, reason, item identity/version and current cost/version. Changed data requires another preview. Item rows are held with share locks. All costs, history events and audits commit together; a failure rolls everything back. Reusing an old preview after saving cannot duplicate the changes.

The bounded ZIP/XML parser validates archive sizes and CRC, rejects encrypted/unsafe entries, XML DTDs/entities and formulas, and reads shared strings, inline strings and numeric cells without converting costs to JavaScript numbers. No filesystem extraction, external requests or new dependency. Uploads are not retained; individual cost events record the filename and reason.

## Storage and verification

Reuses `crm_quotation_policy`, `crm_quotation_costs`, `crm_quotation_events` and the audit log. No migrations or seeded policy/cost values.

Tests use only the guarded connection to `mehta_electronics_local`, with `withTestTransaction`, tagged `ZZTEST_` fixtures and rollback. The missing-policy test intercepts the policy read without deleting existing policy. Coverage includes field validation, CSV/XLSX exact decimals, formulas/damaged files, missing policy/cost gates, session/CSRF/permissions, preview without writes, bad rows, stale previews, history, repeated confirmation, and a second-row storage failure rolling back the first cost and history event.

Final targeted run: **14 passed, 0 failed, 0 skipped**. The guarded runner's earlier 13-test run also passed with initial/final residue scans; the extra rollback test was added afterwards and is included in the final 14-test run. Syntax lint, typecheck, production build and read-only migration verification passed. No browser acceptance or app restart was performed.

## Files changed for this task

- `public/quotation-setup-validation.js` and `.d.ts`
- `src/quotation-workflow.js`
- `src/quotation-workflow-routes.js`
- `src/quotation-cost-import.js`
- `apps/web/features/quotations/api.ts`
- `apps/web/features/quotations/owner-tools.tsx`
- `apps/web/features/quotations/quote-editor.tsx`
- `apps/web/features/quotations/setup-history.tsx`
- `apps/web/features/quotations/cost-import.tsx`
- `test/quotation-setup.test.js`
- `docs/client-plan-implementation.md`
- `docs/quotation-setup.md`

Verification commands: `node --test --test-concurrency=1 test/quotation-setup.test.js test/quotations.test.js test/sales-orders.test.js test/procurement.test.js` (14 passed); `npm.cmd test -- test/quotation-setup.test.js test/quotations.test.js test/sales-orders.test.js test/procurement.test.js` (earlier 13 passed, initial/final residue checks passed); `npm.cmd --prefix apps/web run typecheck`; `npm.cmd run lint`; `npm.cmd run build`; `npm.cmd run db:verify` (35 migration checksums, zero pending); scoped `git diff --check`. All final checks passed. Initial failures in a component prop and two test assertions were corrected before these final passes. The entire repository test suite was not run for this change.

Remaining limits: test coverage models a mid-save failure but not independent concurrent sessions; browser interaction and client acceptance still need review. Restart the existing app process to load updated backend code. No unresolved business values were filled automatically.
