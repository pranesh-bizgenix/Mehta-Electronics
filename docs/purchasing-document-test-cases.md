# Purchasing document checks — 19 November 2026

These cases cover vendor RFQ and supplier PO documents. Mehta is the issuer. Supplied incoming documents remain field/layout references; their terms, numbers and customer data are not defaults. All monetary examples below are fictional arithmetic inputs. The supplied Siemens levels are selling discounts, not evidence of Mehta's purchase costs.

## Automated checks

Run `node --test test/purchase-documents.test.js test/quotation-approval-plan.test.js test/quotation-source-policies.test.js`.

| Area | Cases and expected result |
| --- | --- |
| Discounts | On a fictional list price 100, discounts 60/63/68/74 produce net 40/37/32/26. No workbook prices are activated. |
| Input validation | Reject negative, blank, exponent, comma-separated, non-finite, oversized and over-precision inputs; reject zero quantity and discount/GST above 100. Full discount produces zero. |
| Local GST | Quantity 2, list 100, discount 60, GST 18: taxable 80, CGST 7.20, SGST 7.20, total 94.40. |
| Interstate GST | Same inputs: IGST 14.40, no CGST/SGST, total 94.40. |
| Mixed rates | Three units at 19.99 less 5%, GST 18, plus 0.125 units at 80, GST 5: taxable 66.97; local total 77.73, interstate total 77.72. Components round independently. |
| Round-off | Untaxed 10.49/10.50/10.51 round to 10/11/11, adjustments -0.49/+0.50/+0.49. Tax components remain unchanged. |
| Amount in words | Zero, paise, lakh and crore examples. |
| Financial year | March 31/April 1 boundary, valid leap date, invalid date rejection, distinct prefixes, sequence upper bound, cross-FY edit rejection. |
| Lifecycle | Every status/action combination; creator and latest editor cannot approve. Sent and Cancelled have no further transitions. Purchasing has no quotation Owner self-approval exception. |
| Quotation regression | Existing four-level source checks, historical-reference restrictions and approval-plan checks remain passing. |

## Authenticated API and RDS checks

Run only against the already authorised RDS target using `VERIFY_AUTHORIZED_RDS_ROLLBACK=true node scripts/verify-purchase-documents-rds.mjs`. The harness uses an outer rollback transaction, temporary fictional settings/vendors/documents and existing active accounts. It does not send messages or modify Tally.

The script checks restricted create/read/download/approval, creator self-approval, independent approval, stale approval versions, approved-record edit rejection, invalid discount rejection, cross-FY edit rejection without changing number/version, exact retry identity, retry conflict, FY rollover, GST/net rate, default draft-download rejection, explicit draft preview, PDF bytes, audit events and preserved Sent snapshots after configuration changes.

Expected HTTP outcomes: permission rejection 403; invalid monetary/date input 422; stale version, forbidden workflow state or disabled draft access 409. A successful create returns 201; approval/download return 200.

## Manual review

1. Open Purchasing → Vendor RFQs or Supplier purchase orders. Confirm setup remains required until actual company details, permissions and prefixes are approved.
2. In an authorised acceptance session, enter the fictional arithmetic cases above and compare displayed amounts with the saved record and PDF. Do not issue test documents to a supplier.
3. Submit as the creator, then try approval as that same account: it must fail. Sign in as a different user with the configured approval permission and review before approving.
4. Confirm Draft preview/download is unavailable by default. Check the approved PDF's issuer/recipient direction, tax split, words and numbering.
5. Test role revocation, production MFA and independent concurrent submissions in a scheduled acceptance session. Those are separate from the focused rollback checks; a serialized harness is not a concurrency/load test.

No new business values or commercial terms are established by these checks. Results and limitations are recorded under `verification-output/purchase-documents/2026-11-19/`.
