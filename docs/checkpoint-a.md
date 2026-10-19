# Checkpoint A — import recovery

Implemented locally on 19 October 2026. The Windows connector, its configuration, packaging, and Tally data were not changed.

## Verified real upload counts

| Dataset | Payload records | Imported records |
|---|---:|---:|
| Ledgers | 4,149 | 4,149 |
| Groups | 78 | 78 |
| Stock items | 10,988 | 10,988 |
| Structured vouchers | 0 | 0 |

Two persisted upload sessions belonging to the 4:31 PM run were replayed from PostgreSQL chunks. They upsert into the same company; repeated replay does not double the master counts. All sixteen original datasets are retained as hashed raw payloads. No records from these real master datasets were quarantined. Twelve scalar voucher counters in the captured package are excluded from voucher records.

The 4:30 PM run has no upload session or raw chunks, so there is nothing to replay for that run. It is now visibly **stalled**, with an audited timeout reason. The 4:31 PM run is **stored** with actual import counts. No connector resend was requested.

## Five old identity collisions

Names below are original Tally spellings. Quotes, slashes and spaces are significant.

| Original name A | Original name B |
|---|---|
| `3WT81616UA345AB2/ACB1600A` | `3WT8161-6UA34-5AB2\\ACB 1600A` |
| `4"" FAN REXNORD 22038A2` | `4" FAN REXNORD 22038A2` |
| `4"" GRILL` | `4"  GRILL` |
| `6"" FAN REXNORD A2 21725` | `6" FAN REXNORD A2 21725` |
| `LG:507613 SPN DB 16 WAY IP43` | `LG 507613 SPN DB 16 WAY IP43` |

All ten records are retained. Stock identity hashes the company ID plus the exact original name. The punctuation-stripped matching number is a separate indexed column. Repeated exact identities with differing records are retained separately and warned about; invalid records are quarantined with their original parsed fields.

## Storage and replay

Migration: `database/postgres/migrations/0005_tally_master_import.sql`.

New tables: company registry; raw payloads; dataset results; quarantine; warnings; company-scoped groups, ledgers, and stock items. Money is PostgreSQL `NUMERIC(18,2)`. Original signed text remains in raw XML/record fields. Dr/Cr is populated only when explicitly delivered; no sign inversion or inferred Dr/Cr is introduced. Non-monetary quantity/rate text remains as Tally delivered it.

Finalization is serialized per session and cached after completion. Upserts replace deletion/reinsertion. SQL batch failures fall back to isolated record savepoints. Failure details and raw payloads are retained; failures, quarantines, imports, and stalled runs produce audit events. Stalled timeout defaults to 30 minutes and is configurable with `TALLY_STALLED_RUN_MINUTES`. Server maintenance checks every 30 seconds. Polling status is explicitly labelled **Direct polling**.

Use `npm.cmd run tally:replay` for cached/idempotent recovery, or `npm.cmd run tally:replay -- --reprocess` to explicitly reparse stored chunks. The latter writes new audit evidence but does not duplicate normalized masters.

## Immediate user test

1. Open `http://127.0.0.1:3000` and refresh. If the existing first-login password reminder appears, complete it or close it to navigate.
2. Open **Customers**. Its default **Tally ledgers** view must show **4,149 imported records**. This is the full ledger list, not yet the Sundry Debtors-only screen planned for Step 3.
3. Open **Items**. Its default **Tally stock items** view must show **10,988 imported records**.
4. Search `507613`; both formerly colliding spellings must remain separately visible. Try another collision pair above.
5. Try the company selector, search, sorting, pagination and **View all fields**. Raw financial records are restricted to the configured financial roles, default Owner and Accounts (`TALLY_FINANCIAL_ROLES`). Non-financial list access still requires the existing customer/item permission.
6. Use **CRM customers** / **CRM items** to reach the unchanged sales-master workflows. Imported accounting ledgers are not automatically copied into those editable tables.
7. Open **Tally Connector**. The recovered run must show its counts; the run with no uploaded data must show **stalled** and the reason.

## Verification and screenshots

38 automated tests pass, including collisions, duplicate identities, malformed record quarantine, failed datasets, exact monetary storage, replay idempotency, role checks, pagination totals, scalar voucher exclusion, and stalled-run audit handling.

`scripts/verify-tally-checkpoint-a.mjs` checks the running local app using a temporary, audited Owner verification session that is removed afterward. Chrome checks used desktop 1440×1000 and phone 390×844. Customers, Items, and their all-fields dialogs were opened; the successful check recorded zero browser console errors. The owner's password was not changed.

Screenshots are under `output/checkpoint-a/`: `customers-desktop.png`, `customers-phone.png`, `items-desktop.png`, `items-phone.png`, plus all-fields dialog screenshots at both widths.

## Not implemented in this checkpoint

Steps 2–5 remain unfinished: the detailed pipeline, finance overview, debtor/supplier and ageing views, financial-report presentation, data coverage, voucher UI, and raw explorer. Report XML and bills are retained but not normalized or displayed yet. No claim of financial parity or a completed historical sync is made. Browser screenshots confirm CRM views of delivered data; balances have not been manually compared with a Tally screen.
