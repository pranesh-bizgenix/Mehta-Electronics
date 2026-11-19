# Customer PO against quotation

Open **Sales orders → Record customer PO**. Select the approved quotation, enter the customer's actual PO quantities/prices, number/date and declared total, then save. Open the saved order to see **Customer PO compared with quotation**. Retain the original PO file and use the existing verification and independent approval workflow.

The comparison uses the quotation snapshot/version captured when the PO was saved. It does not compare incoming supplier POs or silently replace the PO values with quoted values. An order entered without a quotation displays an explicit unlinked warning. Imported Tally orders remain separate and read only.

## Comparison rules

- Match confirmed CRM item IDs first. Customer aliases can match through the same item ID. If an ID is unavailable, only the exact part code can match. Different confirmed item IDs cannot match merely because their codes look alike.
- Compare quantities, original unit prices, discounts and GST exactly. Show signed PO-minus-quotation differences. Also compare the effective net rate after discount using exact decimal arithmetic. Net-rate output retains up to twelve decimal places so small differences remain visible.
- Flag unit differences without converting units. Missing quotation items and extra PO items have explicit rows.
- Duplicate matching items on either side are ambiguous. They are not paired by row position, and approval is blocked until the PO/quotation lines are corrected. Split schedules or repeated identical items need deliberate correction; no automatic aggregation is applied.
- Preserve the existing total-review rule: absolute declared-PO/quotation total differences greater than ₹1 set the existing total exception flag. The signed total difference is shown even below that boundary. Every line price/quantity difference is flagged without introducing a new tolerance.
- Preserve existing source-change, credit, stock, cost, original-file and independent-review gates. Ordinary differences continue to require explicit exception acknowledgement and a reason. No automatic approval or source-price update occurs.

## Permissions and persistence

The existing `/api/crm/orders/:id` response contains the public comparison under `verification.comparison`; no new endpoint or permission is added. Existing `orders.read`, create/update and review checks remain on the server. Logistics role projections do not expose this commercial comparison. Comparison lines project only public commercial fields, excluding costs, margins and private source information.

Existing order and quotation snapshots/versions supply the saved data. Comparisons are recomputed on read/verification and enter the existing verification flags and approval audit evidence. No migration or additional business settings are required. The development deep-link loading fix resets the handled-query marker when cancelling the initial effect request, allowing React effect replay to load the order again.

## Acceptance examples

All examples are fictional. Supplied incoming customer POs are field references, not authority to issue orders or import legal terms.

1. Quotation: quantity 2, unit price 100, discount 60%, GST 18%; PO repeats those values. Expected comparison: lines agree; local total 94.40.
2. PO changes quantity to 3 and price to 101. Expected quantity delta +1, list-rate delta +1, net-rate delta +0.40; quantity/rate/net-rate exceptions appear.
3. Change quantity by 0.000001. The exact difference must remain visible.
4. Remove one quoted item and add a different item. Both missing/extra rows appear.
5. Repeat an item on either side. Ambiguous-match warning appears, with no positional pairing.
6. Change units or tax jurisdiction. Corresponding warnings appear; no conversion occurs.
7. Open an unlinked manual PO. A warning explains why quotation comparison is unavailable.
8. Review a record with an authorised sales user and a restricted store user: commercial access follows the existing server role policy; private costs remain absent from sales responses.

## Checks

`node --test test/customer-po-comparison.test.js test/purchase-documents.test.js test/quotation-approval-plan.test.js test/quotation-source-policies.test.js`

`VERIFY_AUTHORIZED_RDS_ROLLBACK=true node scripts/verify-customer-po-comparison-rds.mjs` uses temporary CRM-only snapshots and an outer rollback on the already authorised RDS. It tests authenticated read integration, not normal order creation or a complete dispatch approval. No Tally rows are written.

`node scripts/verify-customer-po-comparison-ui.mjs` checks the actual orders drawer using fictional intercepted order-read responses; real authentication is used and no business records are saved. See `verification-output/customer-po-comparison/2026-11-19/` for results, screenshots and limits.
