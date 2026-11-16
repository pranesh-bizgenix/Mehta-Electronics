# Business rules screen — 4 November 2026

## Behaviour

`/rules` reads the existing versioned rule store. Every missing, cleared or schema-invalid rule has a null value and displays **Not set — blocks: <workflow>**. New editors start empty; shape descriptions are instructions, not prefilled example values. Saving requires explicit JSON and a reason. Only an Owner with `rules.manage` can save or clear a rule, enforced both by the UI and the service. A mistaken permission grant to a different role cannot bypass the Owner check. Existing permissions are unchanged.

Each change appends a version, preserves previous values and records an audit entry with actor, reason and before/after values. Clear appends an empty version, so dependent operations block again. Previewing/listing does not write values. Invalid stored values are treated as unconfigured until an Owner confirms a valid replacement. No rule value is seeded and no business record was configured for this task.

## Requested decisions

| Decision | Rule key | Blocked workflow / behaviour |
| --- | --- | --- |
| Pricing approval levels | `quotation.approval_levels` | Quotation submission and independent approval. Permission keys must exist. A policy with multiple applicable approval levels remains blocked because the existing workflow has one approval step. |
| Discount limits per role | `discount.role_limits` | Quotation submission/approval; a missing editor-role entry or excessive discount blocks. |
| Discount bands | `discount.levels` | Quotation submission/approval; inclusive bands cannot overlap, including endpoints. Discounts outside all bands block. Decimal strings and BigInt comparisons preserve precision. |
| Credit tiers | `credit.tiers` | Non-exempt order credit approval. Tier names, criteria and limit decisions must be confirmed; existing explicit customer limits remain authoritative inputs to the existing exposure check. |
| Grace days | `credit.grace_days` | Non-exempt order credit approval. Zero is accepted only when explicitly confirmed; no zero is prefilled. |
| Warranty period | `warranty.policy` | Existing warranty approval/response-target check remains blocked until confirmed. |
| Complaint bands | `complaints.bands` | Complaints can be recorded or cancelled, but START/RESPOND/RESOLVE require confirmed bands and a matching band name in the findings. The selected band's response target is shown in detail. |
| Principal-ordering rule | `procurement.principal_ordering` | Supplier PO SUBMIT/APPROVE/ISSUE. Instructions are visible in purchasing review; changes invalidate its approval fingerprint. |
| Reminder limits | `reminders.limits` | Message-reminder policy only. Sending remains inactive and belongs to the separate integration engineer. No sender, reminder job or automation switch was changed. |
| KPI weights | `kpi.weights` | Weighted KPI scoring remains unavailable. Owner supplies metric definitions and exact percentage weights totaling 100; no score formula is invented. Existing factual dashboard counts remain available. |
| Audit retention | `audit.retention_days` | Archival policy only. There is no automatic archival/deletion process; audit records continue to be retained. |

All other existing rules stay visible. The margin floor continues to use the existing quotation policy rather than a duplicate rule value. No Admin role is introduced.

## Workflow integrity

- Draft quotations may be recorded before pricing decisions are set. Submission requires confirmed discount bands, role limits and approval policy, as well as existing policy/cost/customer checks. The draft stores rule versions and editor role in its private snapshot. Confirming or changing a rule requires a new draft revision before proceeding. Existing maker-checker and margin exception requirements continue to apply.
- Credit prerequisites appear as explicit verification flags. They cannot be waived through an order's general exception acknowledgement. Only an existing Owner-authorised customer credit exemption bypasses credit prerequisites; other checks remain required. Rule values/versions are included in the verification fingerprint so a later edit invalidates review.
- Principal ordering uses the existing manual supplier review and reason. Since there is no confirmed principal/vendor classification policy, all supplier POs require confirmed ordering instructions; the app does not guess principal suppliers by name.
- Complaint band names can be entered when creating a complaint or through the existing **Revise findings** flow. Classification criteria are applied by the employee, with the chosen response target read from the confirmed rule.

## Deliberate limits and open decisions

This delivers rule configuration, readiness and applicable workflow blocks. It does not implement multi-step approval routing, automatic credit-tier assignment, bill-level overdue/grace calculations, a weighted KPI formula, message sending or audit archival. Aggregate Tally balances do not establish bill age, so no grace-day credit exception is inferred. Those workflows need their own confirmed inputs and implementation. A configured policy is not a claim that those pending engines are operational.

Previously created quotation drafts/approvals without rule-version snapshots require revision. Old discount-band values containing numeric JSON or overlapping endpoints require Owner reconfirmation as valid exact decimal strings. None are silently rewritten. No live business values, Tally data, automation switches or role grants were changed.

## Files

- `apps/web/app/(app)/rules/page.tsx`
- `apps/web/app/(app)/purchasing/page.tsx`
- `src/modules/rules/business-rule-definitions.js` (new)
- `src/modules/rules/workflow-rules.js` (new)
- `src/modules/rules/rule-definitions.js`
- `src/modules/rules/rule-service.js`
- `src/modules/rules/rule-repository.js`
- `src/modules/container.js`
- `src/quotation-workflow.js`
- `src/sales-orders.js`
- `src/procurement.js`
- `src/modules/operations/operations-service.js`
- `public/operation-descriptors.js`
- `test/business-rules.test.js` (new)
- `test-support/business-rule-fixture.js` (new)
- `test-support/sales-order-fixture.js`
- `test/quotations.test.js`
- `docs/business-rules.md` and `docs/client-plan-implementation.md`

No migration or dependency is added. The existing `business_rule_values`, quotation private snapshots, operation payloads and audit/event tables support the changes.

## Verification

New business-rule tests: **6 passed, 0 failed, 0 skipped**. Existing focused quotation/setup/order/procurement tests: **14 passed, 0 failed, 0 skipped**. These use only `mehta_electronics_local` with tagged fixtures rolled back through the shared helper; no database/schema creation or extra listener. Tests cover live HTTP session/CSRF/permissions, direct-service Owner checks, reasons, null/unset values, version history/audit/clear, exact weights, pricing prerequisite/version/limit blocks, credit flags, principal policy and complaint progression/response targets.

`npm.cmd --prefix apps/web run typecheck`, `npm.cmd run lint`, `npm.cmd run build` and scoped `git diff --check` passed. `npm.cmd run db:verify` passed with 35 checksums and zero pending migrations. The broader guarded command also includes setup, logistics and provisioning; its final result is recorded in the client implementation log after completion. Browser interaction, independent concurrent-session races and deployment/restart were not verified. The full repository suite was not run.

Final guarded command: `npm.cmd test -- test/business-rules.test.js test/quotation-setup.test.js test/quotations.test.js test/sales-orders.test.js test/procurement.test.js test/setup.test.js test/logistics-roles.test.js test/user-provisioning.test.js` — **31 passed, 0 failed, 0 cancelled, 0 skipped**. Its initial residue scan passed. A byte-for-byte comparison confirmed that production copies of the rule definitions/helpers and quotation/order/procurement backend code match the current sources. The final database-wide residue scan passed: no committed ZZTEST_ rows remain; the guarded runner exited successfully.
