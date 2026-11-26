# Prem's business decision sheet

Prepared 6 November 2026 from the supplied Master Prompt v2, Part D, and the current CRM rule catalogue. This is a discussion sheet, not a record of live confirmed settings. No client answer is supplied by the developer.

## How to use this sheet

1. Prem or the authorised Owner answers each question and records why.
2. Open **Business decisions** (`/decisions`) in the CRM. Review the evidence and affected workflow before entering an answer.
3. An answer imported from a sheet becomes **Entered**, and continues to block the dependent workflow. Owner must review and confirm it separately.
4. When Owner enters an agreed answer directly, they can explicitly select **Confirm it on save** and give a reason. This is the user-authorised Owner confirmation exception.
5. Clear an answer to block the workflow again. Previous versions and their reasons remain in history.

**Proposed means unconfirmed.** It is never a usable business setting. A confirmed decision still does not implement unfinished software, activate messaging, switch on Tally writes, issue an invoice or approve a transaction.

The companion `prem-decision-sheet.csv` is a static discussion copy with blank answers and blank versions. Its suggestion statuses are planning labels, not a database snapshot. For a sheet that can be imported, export the **latest live sheet** from `/decisions`; it includes the required current versions. Fill only `answer` and, where relevant, `evidence_source`. Keep the other columns unchanged. An empty answer leaves a row unchanged.

The live CSV expects typed answers: text in quotation marks, whole counts as whole numbers, and amounts or percentages as quoted decimal strings. The CRM provides ordinary fields for common tier, role, amount and period answers so staff need not compose structured answers for those settings.

## Current questions

Every row below is decided by **Prem / authorised Owner**. Options are limited to three per row. “Provide details” means no recommendation or number is assumed. Existing document examples are not adopted as global terms.

| Setting key | Plain question | Options (at most three) | Evidence or unconfirmed suggestion | What the answer unlocks |
|---|---|---|---|---|
| `intake.department_owners` | Who should own and back up incoming requests for each company and department? | Provide active primary and backup users | Sales assignment stays unchanged; no staff assignment is invented | New Operations, Accounts and Customer Support request assignment |
| `sla.policy` | Which working days, working hours, timezone and deadlines should staff follow? | Provide the agreed schedule | No confirmed schedule; Owner supplies details | Business-hours deadlines and escalation |
| `escalation.policy` | How long after a deadline should the backup and reporting manager be alerted? | Provide both delays | No evidenced number | In-app escalation |
| `tasks.reminder_interval_minutes` | How often should an unfinished task be brought back to its owner? | Choose one interval | F1 gives a 2–3 hour range only; no single interval is proposed | Task reminder timing |
| `discount.levels` | What discount range belongs to each of the three levels? | Provide all three ranges | No evidenced limits; Prem must provide the numbers | Quotation discount checks |
| `quotation.approval_levels` | Which quotations need which independent approver? | Level 3 only; Levels 2 and 3; Owner-defined conditions | Source statements conflict; no approval scheme recommended | Quotation submission and review |
| `quotation.approval_reviewer_policy` | May the same eligible independent employee complete several quotation approval stages? | Different reviewer for each stage; Same eligible reviewer may complete several stages | No reviewer-reuse policy or approval order assumed | Quotations requiring multiple approval stages |
| `credit.default_limit_new_customer` | What credit limit, if any, should a new customer start with? | Provide an explicit INR limit | No evidenced amount; Prem must provide a number | Customer onboarding without a separately entered limit |
| `customers.potential_threshold` | When does purchase history make a customer a potential customer? | Count orders; Count invoices | Owner must provide the count and period | Potential-customer routing |
| `audit.retention_days` | How long must audit records be kept? | Provide the retention period | No evidenced duration; this does not authorise deletion | Audit archival policy |
| `credit.validation` | Should credit exposure include open orders, and how fresh must the balance be? | Debit balance; Debit balance plus open orders | Owner must also decide source age and unavailable-balance review | Non-exempt order credit approval |
| `warranty.policy` | What combined warranty period, fault coverage and first-response target should claims use? | Provide the agreed policy | Related period and response proposals below are unconfirmed and must agree | Warranty approval and response reporting |
| `payments.authorisation` | What maximum amount and checks are required before a payment request can be approved? | Provide amount and checklist | No evidenced limit; approving a request never transfers money | CRM payment authorisation |
| `email.poll_interval_minutes` | How often may the separate mailbox integration check for new mail? | Choose one interval | 23 Oct gives a 2–5 minute range only; integration and switches stay unchanged | Teammate-owned mailbox configuration |
| `price_lists.retirement_policy` | Who may independently approve retiring or replacing a price list? | Item reviewer; Quotation reviewer; Purchasing reviewer | Owner must confirm the existing permission and instructions | Reviewed price retirement and replacement |
| `stock.availability` | Which verified Tally fields show reservations, and how old may stock evidence be? | Confirm the source mapping | Tally expert must identify actual source fields; no reservation total is assumed | Verified free-stock and reserved-stock checks |
| `price_lists.approval_policy` | Who may independently approve a new price list becoming active? | Item reviewer; Quotation reviewer; Purchasing reviewer | Owner must confirm the existing permission and instructions | Reviewed import approval and activation |
| `discount.role_limits` | What is the maximum discount each defined staff role may offer? | Provide a limit for each permitted role | No limits or new role privileges are assumed | Quotation submission and approval |
| `credit.tiers` | Which customers qualify for each credit tier, and what is its INR limit? | Provide names, criteria and limits | No tier limits or eligibility rules are assumed | Non-exempt order credit approval |
| `credit.grace_days` | How many extra days, if any, are allowed before credit is blocked? | Provide an explicit whole number | Zero is valid only if Owner explicitly confirms it | Non-exempt order credit approval |
| `complaints.bands` | How should complaints be grouped and what response target applies to each group? | Provide exact bands and boundaries | F13's under-3 / 4–7 / 7+ day hints have unclear boundaries; no bands are filled | Complaint progression and resolution |
| `procurement.principal_ordering` | When and how may staff place orders with principals? | Provide the ordering instructions | No supplier threshold or timing assumed | Supplier PO review and issue |
| `reminders.limits` | How many reminders are allowed, how far apart, and when must they stop? | Provide count, interval and stopping rules | No stop limits are evidenced; external sending remains OFF | Reminder policy, without activating sending |
| `kpi.weights` | How much should each agreed staff performance measure count? | Provide measures and weights | No weights assumed; confirmed percentages must total 100 | Weighted reporting once its calculation is implemented |
| `tally.conflict_winners` | Which source wins a reviewed customer, vendor or item difference? | Tally; CRM retained record | BR-18 suggests Tally as source of truth; Owner must confirm each category | Reviewed read-side conflict resolution |
| `margin.floor_percent` | What is the minimum acceptable gross margin? | Provide a percentage | No evidenced margin; Prem must provide a number | Quotation creation, approval and order verification |
| `customers.new_existing_threshold` | How should a new customer be distinguished from an existing customer? | Count orders; Count invoices | Owner must provide the threshold and period; this is separate from potential status | Automatic customer classification |
| `quotation.cost_basis` | Which cost should be used to check quotation margin? | Recorded item cost; Approved supplier net cost | No cost basis is assumed | Margin policy |
| `quotation.default_validity_days` | How many days should a quotation remain valid? | Provide the number of days | No document-specific period is adopted as a default | Default quotation validity |
| `invoice.authority` | Where must the statutory invoice be created? | Tally; CRM with a separate approved adapter | **PROPOSED: Tally creates it**, citing F10 and section 13 in Master Prompt v2 D3; not confirmed | Existing-invoice link and document workflow |
| `warranty.period` | How long is the warranty, and which date starts it? | Billing date; Purchase date | **PROPOSED: one year from billing date**, citing 27 Oct MoM draft / F13 in D3 | Warranty eligibility |
| `warranty.scope` | Which faults are covered by warranty? | Technical faults only; Owner-defined coverage | **PROPOSED: technical faults only**, citing BR-16 in D3 | Warranty eligibility |
| `sla.first_response_hours` | How soon must staff provide the first response? | 48 hours; Same day; Owner-defined target | **PROPOSED: 48 hours**, citing 27 Oct draft; conflicts with “same day” in the build pack | First-response reporting |
| `supplier.first_reminder_minutes` | How long after a supplier request should a follow-up task become due? | Confirm the proposed interval; Provide another interval | **PROPOSED: 30 minutes**, citing 23 Oct action item 13 in D3 | Supplier in-app follow-up |
| `reminder.before_date_days` | How many days before a due date should a reminder become due? | Confirm the proposed lead time; Provide another lead time | **PROPOSED: 7 days**, citing BR-11 in D3 | Reminder due dates |
| `delivery.followup_days_after_dispatch` | How many days after dispatch should staff follow up on delivery? | Confirm the proposed delay; Provide another delay | **PROPOSED: 12 days**, citing unconfirmed 27 Oct draft in D3 | Delivery follow-up tasks |
| `sales.alert_hours` | When should a sales alert become due, and should it repeat? | One-time alert; Repeating alert | D3 cites 5 hours, but repetition is unresolved; no complete answer proposed | Sales in-app alerts |
| `extraction.total_tolerance_inr` | What exact rupee difference may a PO total reconciliation tolerate? | Confirm the proposed tolerance; Provide another tolerance | **PROPOSED: INR 1.00**, citing non-functional requirements in D3; not a universal rounding rule | Deterministic PO reconciliation |
| `credit.tier_labels` | Which credit-period labels may staff choose? | Provide the labels | F7 source not established here; no 0/30/60/90 labels are assumed | Credit-tier choices |
| `credit.exception_authority` | Who may authorise a credit exception, and with what checks? | Name an existing permitted reviewer | No approver or exemption authority assumed | Credit exception review |
| `kpi.formulas` | Which confirmed business events and formulas define each performance measure? | Provide the calculation per measure | No formulas assumed | KPI calculation once implemented |
| `incentive.formula` | How should staff incentives be calculated? | Provide the formula | No formula or payroll change assumed | Incentive reporting once implemented |
| `admin.identity` | Who is Admin and what may that person approve? | Define the responsibility | Admin is undefined; entering this answer creates no role or permission | Admin-specific workflows once defined |
| `gst.provider` | Which provider is authorised for GST, IRN and e-Way documents? | Name the approved provider | No provider or external URL assumed; statutory adapters stay disabled | Later statutory integration review |
| `warehouse.application` | Should store staff use an installable web app or a native app? | Installable web app; Native app | No platform preference assumed | Warehouse mobile release decision |
| `tally.write.categories` | Which write category may be considered for a later Tally release? | Sales orders; Purchase orders; Party ledgers | **PROPOSED: sales orders only**, citing 2 Nov in D3; actual write switches stay OFF | Write-release review only |
| `tally.write.items` | Where must item masters be created? | Only in Tally | **PROPOSED: no CRM item-master writes**, citing BR-17 in D3 | Item-authority review only |
| `tally.conflict.winner` | Which system is authoritative when linked records conflict? | Tally; CRM with separate release review | **PROPOSED: Tally**, citing BR-18 in D3; no automatic conflict resolution is enabled | Tally conflict policy review |

## Sources and unresolved scope

The proposed suggestions above are copied from the user's explicit Master Prompt v2 D3 evidence list. The referenced MoM/F/BR labels describe that evidence; they do not claim that every underlying source has been independently confirmed. A range is a hint, not a selected value. Missing credit-tier source material leaves its labels empty.

The current register is a first delivery. Other open decisions still need separate integration and validation: the full quotation letterhead/seller-state and margin-basis policy; customer assignment and exemptions; rate-contract/class/export/SEZ handling; transporter/state lead times; complete Tally mappings, numbering, identities, approval/conflict modes and retry limits; delivery-acknowledgement timing (7–12 days is a range only); portal identity/sharing; and target-host security, backup and deployment policies. Existing dedicated screens and guarded write configuration continue to enforce their own requirements. This document does not mark those workflows complete.

## Before confirming

- Read the question, source and named workflow. Resolve conflicting statements with Prem.
- Give a reason and evidence reference. Imported text is always reviewed before use.
- Check the live version; if someone changed the answer, refresh and review again.
- A second Owner improves account coverage. No new real account, password or business value is created by preparing this sheet.
