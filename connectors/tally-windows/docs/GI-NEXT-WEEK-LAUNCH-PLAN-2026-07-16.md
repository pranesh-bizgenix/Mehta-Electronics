# Growth Intelligence — next-week guided-pilot plan

Date: 16 July 2026  
Branch: `codex/gi-launch-candidate`

## CTO decision

Use four phases. Launch next week only as a founder-led design-partner pilot. Do not call the product self-serve or accounting-grade until the reconciliation gate is green across multiple real books.

## Phase 1 — Trust, client identity and data safety

Status: **built and live for acceptance**.

- One organisation can retain multiple Tally company workspaces without overwriting another client.
- Tally GUID is the stable key; exact Tally company name is the fallback.
- The active client is unmistakable in the global header.
- Tally discovery lists every open company and its GUID, then requires an exact selection.
- Cash assumptions, budgets, funding plans, scenarios, collection actions, GI actions, performance snapshots and outcomes are scoped below the selected company—not merely below the CA firm.
- Voice lookup refuses to guess when an organisation has multiple clients.
- Every successful or quarantined Tally sync creates a durable audit receipt.
- Data quality is classified by business shape and domain: identity, sales, purchases, cash, receivables, payables and inventory. A service-shaped book does not fail merely because inventory is not applicable.

### Live acceptance evidence

Tally at `localhost:9000` exposed four distinct companies:

1. Agastya Corporation — GUID ending `313ec716`.
2. Mansiben Thakkar — GUID ending `b5194f14`.
3. Tanviben Chiragbhai Dalal — GUID ending `1f13504e`.
4. VIJAY R THAKKAR — GUID ending `1144c20e`.

Agastya was selected and tested. GI received 54 ledgers and 6 stock items, but no valid dated vouchers in the selected 1 April 2022–16 July 2026 period. Trade receivable bills differed from debtor ledgers by 18.43%; trade payable bills differed from creditor ledgers by 100%. The snapshot was quarantined and recorded in the Import Audit Trail. The previously active QA company stayed intact. This is the required fail-closed result.

## Phase 2 — Agent v2 complete voucher spine

Status: **built and verified**.

- Capture voucher GUID and AlterID when Tally returns them so duplicate and
  revision evidence can be diagnosed.
- Continue authoritative current-FY full snapshots for the pilot. Incremental
  cursor publication is deliberately not claimed until altered, cancelled and
  deleted vouchers can be reconciled safely.
- Make monthly extraction fail the whole sync when a month fails; no silent holes.
- Add resumable/chunked upload for large companies.
- Confirm Purchase, Receipt, Payment, Contra, Journal, Credit Note and Debit Note across custom voucher types.
- Add a one-click Windows installer and plain-language connector doctor.
- Preserve durable parsed datasets and sync receipts. Raw transport chunks are
  resumable working data and completed sessions are cleaned after seven days;
  they are not represented as a permanent raw archive.

## Phase 3 — Reconciliation pack and evidence gates

Status: **built, golden-tested and live for acceptance**.

- Reconcile Sales Register, Purchase Register, Day Book voucher counts, Trial Balance, Bills Outstanding, cash/bank books and Stock Summary.
- Explain bills-versus-ledger differences party by party, including advances, on-account balances and bill-wise-disabled ledgers.
- Build golden regression datasets from Champion, Ghanshyam, Agastya and the remaining live service/inventory companies.
- Enforce domain gates in Ask GI and every action lane; verified domains may operate while failed domains remain blocked.

## Phase 4 — Guided pilot release and scope freeze

Status: **operations build complete; production channel acceptance and design-partner workshops require the relevant external accounts and participants**.

- Self-contained deployment, managed PostgreSQL, production secrets, backup/restore rehearsal and monitoring.
- One production delivery channel first, with owner approval and outcome logging.
- Onboard 2–3 design partners through a live reconciliation workshop with their accountant/CA.
- Freeze new screens, write-back, billing, generic Julius-style AI and new accounting connectors until reconciliation remains green for two consecutive weeks.

## Phase 5 — Rolling refresh and visible company truth

Status: **merged and deployed on 17 July 2026**.

- Exact active company, books-through date, stored time and dataset version are
  visible across every authenticated module.
- The outbound Tally Engine resolves `current-fy` through `today` on every
  hourly run, instead of freezing the end date when the config is installed.
- “Check latest stored data” reloads GI; “Sync from Tally” remains a distinct
  accounting operation.
- PostgreSQL storage evidence distinguishes the current canonical dataset,
  durable sync receipts, financial checkpoints and temporary ingest transport.
- Production is live at `https://growth-intelligence-three.vercel.app` on
  commit `95683bd`, with database health green and scope freeze enabled.

## Phase 6 — Pilot acceptance and opening day

Status: **started 17 July 2026**.

- Production publishing, managed PostgreSQL, production secrets and AI provider
  are configured.
- One owner-approved delivery channel still needs credentials and an
  acceptance test.
- The previously known Tally LAN endpoint `localhost:9000` timed out on the
  latest check. The Windows Tally PC must be online with the company open and
  its HTTP/XML server enabled, or the outbound Engine must be running.
- Opening day is the first 75-minute real-book reconciliation workshop, not
  another feature release.

## Launch gate

Launch when all are true:

- Exact company identity is visible and stable.
- No cross-client dataset, plan, action or voice lookup is possible.
- Current period and freshness are explicit.
- Required Tally reports reconcile within agreed tolerance or the affected domain is visibly quarantined.
- No outbound communication occurs without approval.
- Backup/restore and rollback have been rehearsed.
