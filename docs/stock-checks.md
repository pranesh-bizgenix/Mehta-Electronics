# Stock checks and daily analysis

## Operator flow

Open **Items > Check free and reserved stock, history and daily activity**
(`/items/stock-checks`). Select the Tally company in the existing header, an
active CRM product, an exact requested quantity and an explicit availability basis.
Preview the evidence before recording it with a reason.

Free stock is on-hand quantity minus the source reserved total. Reserved-stock
checks require the exact stable reservation ID displayed in the preview; an order
number or party name cannot substitute for identity. Repeated allocations with
the same stable ID are summed exactly. Nothing reserves stock, writes to Tally,
or authorises dispatch.

## Required Owner configuration (BLOCKED-PREM)

The new `stock.availability` rule starts absent. Owner must confirm, in `/rules`:

- Maximum acceptable source age in minutes.
- JSON pointers into the actual imported stock-item payload for reserved total,
  allocation collection, each allocation quantity and stable allocation/order ID.
- Whether the collection is an array or one object, plus optional operational
  order reference and party-name pointers, and confirmed instructions.

No source field paths, reserved zero, threshold or conversion factor are seeded.
The pointers are interpreted as own JSON properties, never executable expressions.
Only operational quantity, stable identity and display fields are supported;
financial fields are refused. If the connector does not deliver these actual
fields, configuration cannot make the missing evidence valid. Source enrichment
and real Tally layout acceptance remain pending.

## Evidence and outcomes

- CRM product must have an unambiguous GUID/Master-ID link in the selected company.
  Source and canonical product units must agree; no name-only match or conversion.
- Quantities are decimal strings, calculated with exact arithmetic. Source values
  must include their unit. Unsupported precision returns a clear error rather than
  truncating or overflowing the existing numeric(30,6) log columns.
- Reserved detail quantities must sum exactly to the explicit source reserved
  total. An absent collection is unknown; only an explicit empty array with an
  explicit zero total represents no reservations.
- Freshness uses the source timestamp from the matching successful stockXml receipt,
  not import/observation time. Missing/future timestamps, failed/incomplete latest
  attempts and quarantined receipts cannot pass as current.
- Outcomes are UNVERIFIED, STALE, REVIEW_REQUIRED or VERIFIED. `available` is null
  unless VERIFIED; VERIFIED can still mean insufficient quantity (`available=false`).
- Preview fingerprints bind source, rule version, item/company, request and outcome.
  Record reevaluates and refuses a changed preview. A UUID request ID prevents a
  retry from inflating daily counts; mismatched reuse returns conflict.

## History, permissions and boundaries

The existing append-only `stock_check_log` is used without schema changes. Each
record and explicit STOCK_CHECK audit event commit together. Audit failure rolls
back the check. Unverified/stale checks may be retained with their actual status.
Historical results are never described as current stock promises.

All endpoints require a session and exactly one selected `companyId`. POSTs require
CSRF. Preview/history require `items.read`; recording additionally requires
`orders.update`. Staff see their own history; existing `users.read` holders may see
company staff history and daily counts. Existing permissions are unchanged; no new
financial or logistics-role access is granted. Daily analysis uses India calendar
days, groups raw counts by staff/status and does not infer a productivity score or
sum incompatible product quantities.

Optional API order attachment also requires order/customer access, a matching
confirmed `public_snapshot.companyId`, and a matching product line. Existing orders
without that binding are blocked from attachment; independent checks still work.
This tool does not replace the existing order verification or fulfillment gates.
Integrating confirmed company/reservation evidence into those gates remains open.

## Verification and remaining acceptance

Pure tests cover precision, source-unit checks, stable identity, missing/failed/
quarantined/stale evidence and reservation reconciliation. Rollback database and
HTTP tests cover selected-company isolation, original financial-field exclusion,
retry/audit behavior, append-only history, daily counts, permission and CSRF checks.
See the latest stock checkpoint in `prompt-pack-completion-audit.md` for gate results.
Rendered-browser acceptance, real reservation mappings, connector source coverage,
independent-session contention and fulfillment integration are not yet verified.
