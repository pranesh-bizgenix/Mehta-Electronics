# Tally logistics and stock locations

## What is available

Open `/logistics` and select the source company in the header. The **Tally logistics & stock locations** panel provides:

- Godown/store-location masters and their parent locations.
- Delivery Notes, Receipt Notes, Stock Journals, Physical Stock, Rejections In and Rejections Out, with search and pagination.
- Click a movement to see its source party/date/status/reference, explicitly delivered shipping fields, inventory quantities and godown/batch/tracking/order allocations.
- Separate inward/outward inventory collections are labelled as supplied. Quantity strings retain their original precision and units.
- Per-dataset import evidence. An import timestamp does not prove live Tally freshness.

These views require both `logistics.read` and `logistics.orders.read`. Owner and Logistics lead can use the view under their existing permission matrix. Store staff continue to use assigned CRM orders and cannot browse all Tally movements. No new financial access is granted. Responses contain an operational whitelist, never raw vouchers, ledger entries, rates, costs, margins or amounts.

Godown masters are locations, not a live per-location stock balance. Movement documents do not establish current stock, completed delivery, approved CRM GRNs or staff assignments. No CRM workflow records are created from these source documents. Standard voucher names are matched explicitly; custom voucher types require a confirmed mapping. Dispatch information on sales invoices is outside this movement view.

## Connector 1.3.0

The existing Windows connector now exports `logisticsDocumentsXml` from the selected company's books-start date to the snapshot date on every successful cycle. This full movement snapshot refreshes unchanged historical vouchers independently of the generic voucher alteration checkpoint. Its date window and capture evidence travel through the existing upload metadata, immutable payload retention, importer and company-scoped visibility cache. Godowns continue through `godownsXml`. Invalid source identities/types are retained for review instead of name-only indexing.

The new dataset is additive: older connectors can still upload their existing datasets, but they cannot establish logistics completeness. An empty successful collection is distinguished from a missing receipt. Records remain read only. No Tally write requests are introduced.

The nested godown/batch mapping follows [Tally's official Sample XML](https://help.tallysolutions.com/sample-xml/). Only fields actually delivered are displayed; no sample godown, batch, quantity or shipping value is used as a default.

## Prepared update, not installed

The versioned package is `output/tally-sales-review/connector-prepared-1.3.0` (git ignored). The reviewed hash manifest is `docs/tally-sales-connector-update.json`. The existing update script validates this release, backs up installed folders when explicitly applied, checks hashes and restarts both existing profiles. Installed profile configuration remains separate from package defaults.

Validation only, from the repository:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/update-tally-sales-connector.ps1 -ValidateOnly
```

Applying the prepared package requires the existing Administrator update procedure and explicit authorization. No service was installed, restarted or updated by this task, following the earlier preparation-only instruction. After an authorized update, check `/tally/connector` for heartbeat version **1.3.0**, let both configured profiles complete a sync, then reload the selected company in `/logistics`. The CRM app must be available at the profiles' configured API URL. A built package or successful heartbeat alone does not prove a successful data import.

Initial read-only inspection on 4 November 2026 found **5 godowns across imported companies**, and **no supported logistics movement vouchers**. Existing voucher imports contained Sales Quotations and Sales Orders. This task does not claim new movement data was fetched from live Tally.

No migration, additional database, server, port, role, business default, messaging automation or sending behavior is introduced.
