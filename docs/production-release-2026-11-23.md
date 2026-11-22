# Production release — 23 November 2026

Production: https://mehta-controldesk.vercel.app

Deployment: `dpl_3GftBBKavxpL82xfrLeTqpF2vM2u` (Vercel, Sydney).
Application source: `e491ce34d5c83aab55cebf4572542ebcf16f0d18`.
The public domain was checked after promotion and points to this READY deployment.

## Released changes

Thirteen manually created feature commits cover the scoped test-account MFA
exception, invoice documents/report PDF exports, smaller document logo and PDF
status labels, read-only Tally posting readiness, level-wise workbook mapping,
canonical enquiry transactions, warehouse reviews/reservations, structured Make
intake, sales review screens, verification helpers and deployment packaging.
Existing explicit policies and approval permissions remain authoritative.

The release includes migrations 0062, 0063 and 0064, already applied in the
authorized development RDS. No additional migration was run for this release.
No migration or backup-freshness guard was edited. No connector implementation,
mailbox connection, outbound sender or Tally write switch was changed.

The upload manifest contains 468 source files and excludes credentials, private
environment files, backups, QA tools, generated documents, verification evidence
and Windows connector code. The pre-existing unrelated text edit in
`docs/role-access-decisions.md` was deliberately preserved outside the commits.

## Verification actually executed

- Production build, design-token checks and syntax lint: PASS.
- The recorded 15-file focused Node test command: 176 passed, zero failed/skipped.
- Fictional read-only API browser suite: 30 passed, including visible count five
  as Elite, mobile layout, notification links and operational access restrictions.
- Actual deployed UI/API smoke suite: 21 passed, zero browser runtime errors.
  It used the existing authorized Owner test login without creating business records.
- Production checks covered health, anonymous access denial, logo/icon, the new
  incoming page, all ten fictional detail drawers, mobile layout, the saved-intake
  API, unconfigured KPI behavior, warehouse queue, existing quotation 11 PDF,
  invoice register API and report catalogue API.

The longer RDS rollback suite completed 37 scenarios before it was intentionally
interrupted during GATES-8 to release startup locks for deployment. Those passed
scenarios were ten PO-to-draft cases, ten duplicate-delivery cases, ten incomplete
extraction cases and seven warehouse/commercial approval cases. The interrupted
scenario is not recorded as a pass. The original run began before the exact-five
Elite confirmation; that new boundary has focused/UI coverage, while its added
actual-count RDS scenarios remain unexecuted.

Rollback cleanup was independently checked: zero retained fixture users,
companies or intake records. The first protected deployment health check failed
while the verification transaction held startup locks. After verified rollback,
the health check returned HTTP 200 before promotion.

The standard npm test runner remains local-database-only and was not repointed
or bypassed to run against RDS. The focused command and explicitly authorized
rollback verifier are distinct from a passing full npm test suite.

## Operational state and remaining verification

Owner navigation: **Sales > Incoming requests**. The initial Sample walkthrough
contains ten clearly fictional entries; none is a saved customer message. Select
Saved CRM requests to inspect the real queue. Intake remains OFF, with no live
policy or permanent test-intake records created by this release.

Make must be connected later using the documented scoped JSON endpoint and a
deliberately configured company policy. Counting statuses/current-record inclusion,
assignment, response deadlines/KPI and stock-location bindings still need approved
configuration. Exactly five qualifying POs or enquiries is confirmed as Elite.

Full persisted enquiry/response, shortage/replenishment, new-customer, cancellation,
reservation-transfer, failure-atomicity and actual-API browser verification remain
pending completion. This deployment and its smoke checks do not certify those
unfinished scenarios, legal invoice issuance or live two-way Tally posting.

Private evidence and screenshots remain under `.vercel/release/` and
`verification-output/sales-intake/`, outside Git and the deployment upload.
