# Tally Sales and Purchase Orders in ControlDesk

Sales Orders and Purchase Orders are exported by the existing Windows connector as separate, read-only Tally collections. Each normal sync requests the full available company history from its books start date. The connector sends the collections in the same authenticated upload session as the existing datasets.

The CRM validates the voucher type and stable Tally ID, retains the original XML, and indexes each source voucher. The Sales orders page lists imported Tally documents separately from customer POs entered into the CRM verification and dispatch workflow. Tally orders remain source records; they are not silently converted into approved CRM orders or purchasing records.

## Install the connector update

The release is staged at `output/tally-sales-review/connector-framework-dependent`. It targets the installed .NET 8 runtime. To install it, open an Administrator PowerShell in the repository and run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\update-tally-sales-connector.ps1
```

The updater verifies the release hashes and the existing API/company profile settings, backs up each replaced service file under `output/tally-sales-review/connector-backup`, then restarts both configured connector services. It preserves local connector settings, credentials, queues, checkpoints, and appsettings files.

## Current import state

The CRM server and migration are active. The current imported source cache contains five Sales Order vouchers: one cancelled and four optional. No Purchase Order vouchers have arrived. Those records came from the earlier sales-document export and do not represent the new full connector collections.

The Windows service update is prepared but was not installed in the current non-Administrator shell. The next successful connector sync after installation will populate the separate order collections. The Tally and CRM order lists should then be refreshed; synchronization status includes separate Sales Order and Purchase Order counts.
