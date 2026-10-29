# CRM scope (F1–F4) gap analysis

**Date:** 29 Oct 2026. **Branch:** `feature/base-building`.
**Source:** *Mehta ControlDesk – Client Requirements & Development Plan* (compiled 29 Oct 2026, F1–F4, pages 10–26). Tags follow that document: **E** = client said it in a meeting, **P** = engineering proposal, **PENDING/BLOCKED** = client answer missing.

This note records the starting point for the F1–F4 build. Requirement-level mapping to code and tests is in [crm-traceability.md](crm-traceability.md), which is updated as each slice ships.

## Baseline at the start of this work

- `npm test`: 57/57 passing after the stale legacy pipeline test was aligned with the enforced quotation workflow (`a2f7a44`). Before that, 8 tests in `test/crm.test.js` failed on one cause: legacy quotation creation now needs owner policy and independent approval.
- `npm run lint`, `npm run build`, `apps/web` `tsc --noEmit`: passing.
- Migrations 0017–0020 were applied locally but uncommitted. They are now committed byte-for-byte (`4b23baa`) so recorded checksums stay valid.

## F1 Platform foundation

| Requirement | Today | Gap |
|---|---|---|
| Password login, rate limiting, CSRF, sessions | Done (`src/app.js`, `src/security.js`) | None |
| OTP / 2FA, mandatory for owner and admin (E) | Missing | TOTP + recovery codes; enforcement per role flag. *Admin* is not a defined role (PENDING), so the flag is seeded on Owner only |
| Role decides screens and fields; cost/margin only for authorised roles | Static 4-role map in `src/rbac.js`; pricing redaction in quotation/order modules | Database-stored, editable matrix (resource × R/W/A) with field-level privacy; Users & Roles screen (S-24) |
| Owner, backup owner, due time, status on every record | `owner_id` on customers, `assigned_to` on enquiries only | Generic ownership + SLA record per business record |
| Escalation owner → backup → manager; SLA clock | Missing | SLA policy (versioned, timezone, business hours) starting empty; scheduler job; escalation events |
| Move all open work to backup in one action | Missing | Reassign endpoint with audit |
| Exception queue with approve/reject and maker-checker | Quotation/order review only; no shared queue | Shared exception queue (unknown code, low margin, credit, failed check, Do Not Quote) |
| Controlled, logged backdating | Missing | Backdate requests require an exception approval |
| Rules editable in a screen, not code; unset rules block | Quotation margin floor only (`crm_quotation_policy`) | Versioned rules engine and Rules screen (margin floor, credit, TAT, approval levels, discount levels 1–3, reminder interval, potential-customer threshold, audit retention) |
| Per-workflow ON/OFF switch, default OFF, owner only (E) | Missing | Automation switches with full change log; rollout stage per workflow |
| Draft-first approval gate for outbound email (E) | 0020 guards automation send attempts at the database level; no service uses it | Gate service: switch ON → checklist ticked → draft approved; registered email + verified record required; bank mail ignored |
| Task board (S-19), My Work, reminders | Missing | Tasks with Open/In progress/Forwarded/Done, linked sub-tasks on forward, reminders via notification channel |
| Audit trail searchable by user, date, module, record (S-25, owner only) | Append-only `audit_logs`, filters by entity only; readable by Manager/Accounts too | Full filters; restrict to Owner via the matrix |
| Department labels (Sales, Operations, Accounts, Customer Support) | Missing | Routing label on classified email and enquiries (not roles) |
| Admin manual-response exception list (A-19) | Missing | List of customers/products that never get automated drafts; contents PENDING |

## F2 Customer and CRM

| Requirement | Today | Gap |
|---|---|---|
| Name, GSTIN (validated), addresses, contacts | Done; GSTIN format + state check | Ship-to addresses (multiple) |
| Duplicate check on GSTIN, phone, name; merge with approval | Detection exists (GSTIN/PAN/name/phone) and needs a reason | Merge request through the exception queue |
| Credit limit, payment terms, owner and backup, territory, dealership and brand | Credit + terms + owner | Backup owner, territory, dealership/brand structure, customer group |
| Four pricing classes (E) | Missing | rate-contract / medium-discount / dealer / new |
| Routing state new/existing/potential/Do Not Quote (E, D-04) | Missing | Separate from pricing class; Do Not Quote → Admin review |
| BR-03 salesperson binding | Missing | Bind on quote send; other salespeople blocked |
| Automate flag; registered email(s); credit-exempt (owner only) | Missing | Fields + enforcement |
| Tally ledger id as match key, never name | Read layer matches by exact company + name | Store ledger id; match on id only for new links |
| Onboarding "Pending approval" blocks billing | Missing | Customer approval state |
| Rate contracts: exclusive, date-based, expired never used | Missing (price lists are not customer-specific) | Rate contract table + pricing strategy |
| Activity / call / note log, pipeline | Missing | Activities + pipeline stages |
| Customer 360 (history, quotes, orders, dues for finance, part mapping) | Mostly done (`src/crm-modules.js`); invoices explicitly unavailable | Purchase history, activities, rate contracts on the 360 |
| Potential-customer threshold (A-06) | Missing | Rule that starts empty |

## F3 Enquiry auto-capture

Today only manual enquiries exist. Everything in F3 is a gap: channel adapters (email IMAP/Gmail/Graph, WhatsApp native/Zootop), signed webhooks with replay protection, idempotent intake keyed on provider + mailbox + message id, raw `.eml`/attachment storage with SHA-256, outbox, bank/spam filtering (ignored with a reason, never deleted), threading, sender → customer matching order, workload assignment with owner/backup/reason, replaceable extractor with field confidence, review queue that can never reach a quote, Inquiry Inbox (S-03), integrations settings (S-23) with a 2–5 minute poll interval. Migrations 0018–0020 already provide `email_accounts`, `email_threads`, `email_messages`, `source_documents`, `extraction_runs`, `extracted_fields`, `document_reviews`, `reminders`, `notifications` and approval tables, so F3 reuses them rather than adding parallel tables.

**Blocked on client:** provider and mailbox scope, WhatsApp route (Zootop vs native) and number, acknowledgement wording, category definitions and sample emails (A-01), bank-alert sender list, SLA hours/holidays, alias/domain approval.

## F4 Items, pricing and quotation

| Requirement | Today | Gap |
|---|---|---|
| Items from Tally; never create items Tally lacks (BR-17) | Items can be created freely in CRM; Tally link optional | Quote lines restricted to Tally-linked items; import never creates unknown items |
| Price order: rate contract → slab → price-list version valid on date | Price lists with tiers exist; no engine | PricingEngine of ordered strategies |
| Landed cost, margin flag green/blue/red per line (BR-02) | Margin floor vs owner cost (gross margin) | Cost basis rule (BLOCKED, BR-02a) that blocks until set; three-colour flag |
| Discount levels 1–3, Level 3 approval | Missing | Ranges empty until set (BLOCKED) |
| Check order: Do Not Quote → price → stock (free = in hand − allocated) → lead time | Missing | Ordered checks in the quote service |
| Customer-facing quote/PDF without LP or discount | PDF shows public fields; discount column still shown | Customer-facing layout: code, qty, unit rate, total, stock remarks, HSN |
| Expiry/lapse, revisions, follow-up reminders | Versions + explicit expiry exist | Configurable lapse rule; follow-up reminders |
| Stock-only reply draft for configured customer groups | Missing | Groups list PENDING |
| Higher-price rule never overrides a rate contract | Missing | Strategy-level rule (PENDING confirmation) |
| Bulk price-list import 12–15k SKUs, idempotent, flagged rows | Missing | Import with validation report, no overwrite/duplicates, benchmark |
| Quote states Draft / Pending approval / Approved / Sent / Converted / Lapsed | Draft / Pending / Approved / Sent / Won / Lost / Expired / Cancelled | Map Converted ↔ order created, Lapsed ↔ Expired |

## Cross-cutting

- **Architecture:** existing modules mix SQL, validation and routing. New work uses controller → service → repository with constructor injection under `src/modules/`, while existing routes keep working. Versioned `/api/v1` routes are added alongside.
- **Frontend:** `apps/web` is a placeholder. New screens are built there; `public/` stays until each screen has parity.
- **Roles:** the PDF lists 9 roles, while the meetings show 5 internal roles. Only the 4 existing roles are seeded. The matrix is editable so the client can add roles once confirmed. No "sales manager" or "admin" role is invented.
