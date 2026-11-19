# Quotation source policies and manual acceptance

Date: 18 November 2026. This records source evidence and implementation decisions; it does not declare commercial rollout complete.

## Decisions implemented

| Area | Behaviour | Authority |
| --- | --- | --- |
| Selling levels | Support levels 1, 2, 3 and 4. A level stays Not set until its reviewed source is configured. | User explicitly approved all four Siemens workbook levels. |
| Excel discounts | Explicitly select percentage or Excel fraction. A fraction of 0.60 becomes 60%, not 0.60%. Invalid fractions are blocked. | Literal supplied workbook values; conversion is included in the review fingerprint. |
| Expired rates | Permit a dated development reference draft only. Preserve original validity and mark its PDF as a historical reference. Block submission and customer issue; reject reference creation in production. | User allowed expired prices for development reference. No commercial validity was extended. |
| Customer conditions | Keep requested payment, freight, warranty and other conditions separate from accepted, printed quotation terms. Require review before submission. | Supplied incoming RFQs contain requests, not Mehta's acceptance. |
| Customer PDF | Show discounted selling rates, quantities, tax and accepted terms. Hide source discounts, cost and margin. | Existing client-plan quotation requirements. |
| Quantity ambiguity | Retain the existing confirmation requirement for uncertain set quantities. | The supplied three-set request does not establish an unambiguous multiplier. |
| Activation | Preview and save do not activate prices. Existing independent approval and configuration gates remain. | Existing approved-source workflow. |

## What the new emails establish

The hash-deduplicated MIME/attachment inventory is in `verification-output/quotation-policy/2026-11-18/email-reference-review.json`. Only visible workbook sheets were inspected. No email was sent, imported into an intake system or executed.

- KGEP invoice `10626-2700426.pdf`, sales order `10226-2707445.pdf`, and DK Elektro's `mehta rev po 2563.pdf` identify Mehta Electric Corporation with GSTIN `33AAGPM1577N1ZD`. The GST state prefix is 33. These are identity references; the active quotation policy has not been saved.
- KGEP's 45-day credit, 24% late-payment interest and warranty wording belong to KGEP's transaction/conditions. They were not adopted as Mehta's customer credit, interest or warranty defaults.
- `Quote.eml` and the other RFQs request prices or availability. They do not establish a Mehta-issued quotation template or a global margin floor.
- The stock-request screenshot has requested quantities and an unfilled stock column. It does not prove availability.
- Open-order and dispatch attachments describe particular transactions. They do not establish all CRM item mappings or current stock.

## Commercial setup still required

The actual CRM catalog, CRM customers, price reviews, level bindings and quotation policy were empty during this verification. Imported Tally data is a separate source and was not silently promoted into CRM master records.

No supplied document establishes a global minimum selling margin or whether authorised costs must include freight and other landed charges. The existing policy form requires a margin floor and whether it applies to each line and total or total only. Per-item costs must also be supplied and reviewed. Supplier CP margin cells are not a company-wide floor. Do not enter zero merely to bypass setup.

Before commercial acceptance, configure the supported seller identity, confirmed margin controls, authorised per-item costs, actual customer/item mappings, applicable tax/HSN details and accepted terms. Review and approve the relevant price source. Do not activate expired prices for normal customer issue.

## Manual testing

1. Sign in with the existing Owner account. Open Items and price lists, then Price levels. Confirm four levels appear and unconfigured levels say Not set.
2. Open Price-list imports. Choose the correct workbook and worksheet. Inspect it before mapping. Do not choose hidden metadata, CP margin or purchase cost as selling prices.
3. Choose Excel fraction for a source discount such as 0.60. Map the literal item code, unit, list price, quantity and discount columns; enter the original source validity and an explanation. Preview every row.
4. Confirm 0.60 displays as 60%. Unmapped CRM products, missing units, unsupported formulas and invalid values must remain blocked. Saving a preview must not activate a price list.
5. Open a new quotation. Enter customer-requested conditions in the internal review field. Confirm the printed Terms field stays unchanged. Record the accepted terms separately; review confirmation must reset when terms change.
6. For an expired-source development check, select Development reference only and a historical pricing date inside the source validity. Use only an approved source binding and mapped records. The reference PDF must show its historical warning and cannot be submitted or issued. Production must reject creating this kind of reference quotation.
7. After real setup is complete, create a normal quotation with an active source. For an explicit test example only, two units at list 100 with 60% discount produce net unit 40 and taxable total 80. At a supplied 18% test tax, same-state tax is 7.20 plus 7.20 and total 94.40; interstate tax is 14.40. These are test values, not configured product tax or pricing policies.
8. Download the PDF. Check customer, item codes, quantities, unit rates, HSN, accepted terms, tax split, total and page continuity. It must not disclose list discount, purchase cost, margin or unaccepted customer conditions.
9. Use a different authorised reviewer for approval. Test creator self-approval rejection, revision invalidation, expired current-source rejection and restricted cost visibility before customer rollout. These complete commercial acceptance flows were not re-proven by the reference-only check.

## Verified evidence

See `verification-output/quotation-policy/2026-11-18/REPORT.md`. Temporary API/database fixtures were rolled back and independently checked absent. No supplied business rows or invented policies were activated.

## Later user-authorised provisional setup - 18 November 2026

The user then instructed: "set up thequotation policies anyhow", after the missing commercial rules were explained. A provisional DEVELOPMENT assumption was saved through the existing Owner session and permission/CSRF-protected API: 10% minimum gross margin, checked on every line and total; seller Mehta Electric Corporation, GSTIN 33AAGPM1577N1ZD, state 33. This overrides the earlier unset setup state above, not the source evidence. The audit reason explicitly says this is an implementation assumption, not a documented client rule. The existing internal decision mechanism records the configured value as usable; that is not evidence of Prem's commercial approval.

API read-back matched and the browser's setup warning disappeared. No invented item costs, customer records, payment terms or warranties were added. Address/contact fields remain blank. No schema migration was needed for this setup. Before commercial use, review the provisional margin and complete actual costs and letterhead details. Evidence: development-policy-configured.json, development-policy-configured.png and development-policy-db-check.json in the quotation-policy evidence directory.

## User-authorised provisional discount and approval setup

On 18 November the user instructed "resolve it" after the submission error identified missing discount rules. To unblock development testing, the following assumptions were selected, explicitly separate from Prem's documented commercial policies:

| Setting | Provisional value | Reason |
| --- | --- | --- |
| Discount band 1 | 0 to 10 percent inclusive | Low-discount test band. |
| Discount band 2 | 10.000001 to 25 percent inclusive | Non-overlapping intermediate test band. |
| Discount band 3 | 25.000001 to 100 percent inclusive | Higher-discount band covering the current 60 percent test. Six-decimal precision avoids gaps at supported input precision. |
| Role discount cap | 74 percent for Owner, Manager and Executive | Development cap chosen alongside supplied four-level pricing references; not a client-authorised commercial limit. Other roles receive no new quotation grants. |
| Approval | One ALL stage requiring quotations.approve | Every quotation, including high discounts, needs an independent review. Existing Owner/Manager permission grants are used. |
| Reviewer independence | Existing creator/latest-editor rejection retained | No self-approval or below-margin exception bypass. Multiple stages/reviewer-reuse settings are unnecessary for this single-stage assumption. |

Rule changes use existing authenticated Owner APIs, validation, versioning and audit/decision recording. Their audit reason labels them PROVISIONAL DEVELOPMENT ASSUMPTION and requests review before rollout. Configured/confirmed in the application does not prove client commercial approval. No price-level source was activated and no outbound/Tally write setting was changed. Execution evidence and exact values are retained under approval-configuration-check.json in the quotation-policy verification directory.

## Later exception: Owner may approve their own quotation

On 18 November 2026 the user explicitly requested Owner quotation self-approval. The earlier independent-review description now has this exception: an active eligible Owner can approve their own created/edited quotation with an explicit self-approval checkbox and reason, retained in review evidence and audit history. Manager self-approval remains forbidden. Existing cost, margin, validity and source checks are unchanged. The independent-review stage name is historical; it does not override this later authorised exception. No schema migration is needed because existing JSON review/audit evidence stores the marker.
