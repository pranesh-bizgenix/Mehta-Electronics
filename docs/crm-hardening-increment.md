# CRM readiness, retained downloads and sensitive screens

## Quotation setup readiness

Setup now checks the same confirmed margin decision as the quotation workflow.
A saved policy without its current confirmation is **Needs attention**, with an
exact link to `/decisions?key=margin.floor_percent`. Missing policy still links to
the Policy and letterhead drawer. Staging or withdrawing a decision preserves the
retained policy and blocks its use; it does not invent replacement values.

## Large retained XML downloads

The sync monitor uses a same-origin attachment link rather than requesting the
whole XML as JSON and constructing a browser Blob. Both existing Tally route
prefixes provide `GET /retained/payloads/:id/download?companyId=...`.

The endpoint requires a staff session, `tally.read`, literal Owner or Accounts
role and exactly one imported company. A payload from another company returns
404. It reads a consistent, read-only PostgreSQL snapshot, materializes the
retained UTF-8 value on PostgreSQL once, and fetches/writes at most 256 KiB per
iteration. It respects HTTP backpressure, has a 30-second drain/query limit and
a five-minute total stream deadline, and rolls back/closes the cursor on failure.
A partial attachment is aborted even if rollback reports a disconnected database.
The original retained record is not
modified, and XML is an attachment with `no-store` and `nosniff` headers.

This bounds application and browser buffering; PostgreSQL still needs resources
to materialize the source value. It is not a benchmark or proof that arbitrary
gigabyte downloads fit every target host. The existing JSON payload endpoint is
retained for compatibility.

`test/tally-payload-download.test.js` covers byte-identical XML above the former
16 MiB limit, multibyte boundaries, both aliases, permissions/session/company,
backpressure and disconnection. Its sole-database fixtures roll back. The initial
combined setup/download focus passed 7 tests, zero failures/skips; use the final
integrated log for the final source state.

## Sensitive-screen deterrence

Authorized cost screens show a repeated staff name, ID and UTC time watermark.
It covers quotation/order/purchasing/item screens when the current user already
has cost-read permission, Owner decision/rule management, and Owner/Accounts
Tally screens with Tally read access. Route matching respects path boundaries.
It changes no financial permissions or API projection.

Losing window focus or hiding the tab blurs content and portaled dialogs/palette;
returning focus restores the view. The watermark has no pointer interception and
is hidden from assistive technology. Print retains identity/time without masking
the print content. No clipboard, camera, operating-system or external service
access is added. This is a visual deterrent; it cannot prevent screenshots or
replace server authorization.

Pure tests cover scope/permission selection and bounded identity text. Design
tokens and TypeScript passed after the change. The built-screen review harness
serves compiled files through Playwright interception with browser-only fixtures,
without starting another listener or sending real API writes. Its five checks
passed: register/fix links, empty explicit-input editor, watermark/focus concealment,
mobile/print layout and denial for a non-Owner with broad grants. This uses
intercepted synthetic API responses; host/device/client acceptance remains a
human release gate.
