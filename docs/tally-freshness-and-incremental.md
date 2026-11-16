# Tally freshness and incremental reads (P16–P17)

## Freshness evidence

`GET /api/v1/tally/visibility/freshness?companyId=<UUID>` requires a session and exactly one imported company. It returns dataset metadata only for permitted entities. Each dataset includes last successful import time, import age, source timestamp if actually reported, connector capture time/mode/window if reported, and the latest attempt. A failed or partial attempt does not erase the last successful timestamp. Future/invalid timestamps are not treated as a successful current source.

The shell shows this evidence on Tally-backed screens; imported detail drawers and order details also show it. Polling is every 30 seconds and company-keyed state prevents previous-company evidence remaining visible. Source freshness is explicitly unverified: an import timestamp is not a Tally timestamp or proof of current completeness. No stale-age business threshold has been invented. Existing workflow-specific freshness gates remain in force.

Migration `0036_tally_collection_metadata.sql` adds technical JSON metadata to upload sessions. Old sessions retain an empty object, not invented times. Authenticated connector uploads validate dataset names, date windows, extraction modes, ISO timestamps and decimal-string alteration bounds; session creation audits the evidence. The column was applied by the existing migration runner after a verified `pg_dump` backup of `mehta_electronics_local`. No other database was used.

## Prepared connector 1.2.0

After the existing initial history completes, the connector probes voucher identities and alteration IDs from the company's books-start date through today. It then exports only IDs above the acknowledged checkpoint and at or below the probe's upper bound. Every returned stable identity and alteration ID must agree with the probe's expected changed set. IDs use arbitrary-precision integers; no floating-point rounding.

The first pull for a new company GUID, date window/day or reset counter uses a zero lower bound to obtain a baseline. A missing company GUID, unavailable/malformed alteration metadata, duplicate IDs, unsupported/ignored filter, or concurrent change detected during validation falls back to the existing date-window reads and clears the next alteration checkpoint. Cancellation propagates. The app never infers deletions from missing rows. A restored source with reused IDs/counters may need an explicit full re-read; this is not a deletion feed or a guarantee against every form of source restoration.

Masters, balances, financial reports and dedicated Sales/Purchase Order collections remain full snapshot/window reads: voucher posting can change balances without changing a master. Dedicated order windows are explicitly reported separately from voucher history batches; reconciliation uses the dedicated declared order window when both types agree. Older sessions without that evidence cannot verify records outside their upload window.

The checkpoint travels with the existing durable queue package. Only a successful finalize response with `status=stored` advances it. Partial/indexing failures retain the package for retry and require reviewed recovery if the retained session remains partial. State is saved before the successful package is archived. No new worker, listener, network target, Tally import/create/alter operation, or automation switch was introduced.

The release manifest points to `output/tally-sales-review/connector-prepared-1.2.0` and hashes all 40 prepared payload files. The prior 1.1.0 preparation is historical. Installation remains a later Administrator operation; none was performed. The app's heartbeat display continues to show the actual last reported build, not the prepared version.

TDL collection/filter behaviour follows the official [Tally collection reference](https://help.tallysolutions.com/objects-and-collections/). Compatibility of the specific alteration fields still needs acceptance against the client's installed Tally version. The safe fallback remains available.

## Order drill-down

`GET /api/crm/tally-orders/:recordKey?companyId=<UUID>` requires `tally.read`, validates company scope and joins the actual cached snapshot to its immutable source record. Order rows open a native accessible drawer with party, dates, status, source company, item lines, actual/billed quantities and explicitly delivered pending quantities. Missing `PENDINGQTY` remains blank; actual minus billed is not guessed as pending.

Only Owner/Accounts receive delivered rates, amounts, totals and a link to the exact original retained payload. Other permitted roles receive a separate safe projection with those fields omitted on the server. Raw XML endpoints retain their existing financial-role check. Company changes discard the open drawer; voucher number and party search remain available.

## Verification and limitations

Tests cover timestamp honesty, exact bounds and validation, company isolation, successful versus incomplete receipts, audited upload metadata, real order handler projections and foreign-source rejection. `dotnet run --no-restore --project connectors/tally-windows/TallyConnector.Service/TallyConnector.Service.csproj -c Release -- --verify-incremental` runs 13 pure checks and exits before profile/service/network/database access. This verifies parsing and filter validation, not a live Tally export, service restart, concurrent source change or a production queue crash.

Browser interaction, source timestamp reporting, actual Tally compatibility and installed-service operation are not yet verified. Source timestamps remain null when the source does not report them. Live completeness still requires independent Tally evidence.
