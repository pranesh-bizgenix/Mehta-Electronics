# CRM traceability (F1–F4)

Source: *Mehta ControlDesk – Client Requirements & Development Plan* (compiled 29 Oct 2026), F1–F4. Each row maps a requirement or task from the plan to code, tests and status.

**Status values:** **Done** = implemented and covered by a test. **Done (configurable)** = built, but the business value is an empty owner-set rule that blocks its workflow until it is set. **Blocked** = waiting on a client decision; nothing is guessed.

Test command (uses temporary schemas inside `DATABASE_URL`; no extra databases):

```powershell
$env:RUN_CRM_MODULE_DB_TEST='1'; $env:RUN_TALLY_READ_DB_TEST='1'; $env:RUN_QUOTATION_DB_TEST='1'; $env:RUN_SALES_ORDER_DB_TEST='1'; $env:RUN_PROCUREMENT_DB_TEST='1'
node --test --test-concurrency=1 test/*.test.js apps/web/test/*.mjs
node scripts/verify-foundation-ui.mjs
```

## F1 Platform foundation

| Requirement / task (plan) | Code | Test | Status |
|---|---|---|---|
| Password login, rate limiting (existing) | `src/app.js` login route | `test/crm.test.js` authentication suite | Done |
| OTP / 2FA, mandatory for owner and admin | `src/modules/mfa/*`, enforcement in `src/app.js` handler, `roles.requires_mfa` (0021) | `foundation.test.js` "owner must enrol…", "owner can reset…"; `verify-foundation-ui.mjs` | Done for Owner. **Blocked:** "Admin" is not a defined role (PDF F1: Admin PENDING). Any role can be flagged to require MFA once created |
| Recovery codes | `MfaService.confirmEnrolment` / `verifySession` | `foundation.test.js` single-use check | Done |
| JWT (task list) | — | — | Not used: the existing opaque, hashed, HttpOnly session cookie with CSRF meets the same need and is already tested. Revisit only if mobile/portal (F15) needs bearer tokens |
| Users, roles, field-level privacy; backend enforces every row | `src/modules/access/*`, `src/rbac.js` provider, `permissions.action='F'` rows; screen `apps/web/app/(app)/users` | `foundation.test.js` "every v1 endpoint enforces the matrix per role", "matrix edits apply immediately…" | Done. Seeded with the existing 4 roles only. **Blocked:** the 9-role list vs 5 roles seen in meetings (Q-4); the proposed matrix (Logistics lead, Store staff, Sales) is not seeded |
| Audit log and soft-delete framework | `audit_logs` writes in every service; append-only and no-delete triggers (0021) | `foundation.test.js` append-only/delete rejections | Done |
| Audit searchable by user, date, module, record (S-25, owner only) | `src/modules/admin/audit-service.js`, `apps/web/app/(app)/audit` | `foundation.test.js` "owner searches by user, date, module and record" | Done. `audit.read` was removed from Manager/Accounts defaults to match the proposed matrix; the owner can grant it back |
| Rules engine and rules screen (margin floor, credit, TAT, approval levels) | `src/modules/rules/*`, `apps/web/app/(app)/rules` | `foundation.test.js` "rules start empty…" | Done (configurable). All values start empty. The margin floor reuses the existing quotation policy |
| Rules screen values for unconfirmed business rules, empty until set | `rule-definitions.js` (`discount.levels`, `quotation.approval_levels`, `customers.potential_threshold`, `audit.retention_days`, …) | same | Done (configurable). **Blocked values:** discount ranges, approval hierarchy conflict, potential-customer threshold (A-06), audit retention (A-23), SLA hours and holidays |
| Owner and backup on every record, due time, status | `work_items` (0021), `src/modules/work/*`, record sync job for enquiries, quotations and orders, tasks | `foundation.test.js` escalation and reassignment tests | Done |
| SLA clock with policy version, timezone, business hours | `sla-calculator.js`, `WorkService.open` | `foundation.test.js` unit "SLA due time counts only business minutes" | Done (configurable) |
| Escalation owner → backup → manager by scheduler | `WorkService.escalateOverdue`, `Scheduler`, `job_logs` | `foundation.test.js` "overdue records escalate…" | Done (configurable). Runs only when the `sla_escalation` switch is ON and `escalation.policy` is set. **Blocked:** escalation timing (PDF F1 PENDING) |
| Move all open work to backup in one action | `UserAdminService.reassignAll` | `foundation.test.js` "reassign all open work and tasks…" | Done |
| Exception queue and approval screens; maker-checker | `src/modules/exceptions/*`, `apps/web/app/(app)/exceptions` | `foundation.test.js` "raising is idempotent, maker-checker…" | Done. **Blocked:** who checks when the owner is the creator (PDF F1 open question). Today a second person with `exceptions.decide` must decide |
| Backdating is controlled and logged | `BACKDATE` exception + `WorkService.applyBackdate` | same test | Done |
| Independent ON/OFF switch per workflow, default OFF, owner turns ON, log who/when/old/new | `src/modules/automation/*`, `apps/web/app/(app)/automation` | `foundation.test.js` "only the owner turns automation ON…" | Done. **Blocked:** whether anyone besides Prem may switch ON, and switch scope (per mailbox or brand) |
| Rollout stage setting per workflow | `automation_switches.rollout_stage` | same | Done |
| Draft-first approval gate for outgoing email; three gates (switch → checklist → approval) | `src/modules/outbound/*` gates, `apps/web/app/(app)/messages` | `foundation.test.js` "every gate must pass…" | Done. The database also refuses unapproved send attempts (0020) |
| No email without verified CRM record and registered email | `VerifiedRecordGate`, `RegisteredEmailGate` | same | Done. Registered emails currently come from active customer contacts; F2 adds explicit registered emails |
| Bank emails ignored, no reply | `NOT_BANK` gate is written but not yet wired | — | Lands in F3 with bank sender rules. **Blocked:** bank sender list |
| Link emails, drafts, approvals and sent messages to the CRM record | `email_drafts` customer/enquiry/quotation links, `email_send_attempts`, audit entries | same | Done for outbound. Inbound arrives in F3 |
| Department field on classified email, queues and filters | `department` on users, work items, exceptions, tasks; exception filter | — | Partly done; classified-email department arrives in F3 |
| Admin-managed manual-response exception list | `manual_response_exceptions` table and `ManualResponseGate` | gate covered by the outbound test | Done (data model and gate). **Blocked:** list contents (A-19); no editing screen yet |
| Task board S-19: states, forwarding to a linked sub-task, reminders | `src/modules/tasks/*`, `apps/web/app/(app)/tasks` | `foundation.test.js` task board tests; `verify-foundation-ui.mjs` | Done (configurable). **Blocked:** reminder interval (2–3 h vs 5 h) and WhatsApp task creation |
| My Work list with due times | `GET /api/v1/me/work`, `apps/web/app/(app)/work` | `foundation.test.js`, UI check | Done |
| Every screen: loading, empty, error, unauthorized, validation, duplicate submit, long text, narrow | `apps/web/components/ui.tsx` | `verify-foundation-ui.mjs` (overflow, double click, unauthorized) | Done for F1 screens; full audit in Slice 5 |
| Security: secrets in env, no stack traces, upload limits | `src/core/errors.js`, `APP_ENCRYPTION_KEY` | unit "error bodies never expose…" | Done |
| Idempotency keys on retryable writes | `src/core/http.js`, `idempotency_keys` | `foundation.test.js` "idempotency keys replay…" | Done |
| APIs `/auth/verify-otp`, `/users`, `/roles`, `/users/:id/reassign`, `/me/work`, `/rules`, `/exceptions`, `/approvals/:id/decide`, `/audit-logs` | Under `/api/v1/…` | above | Done |

## F2 Customer and CRM

Pending: Slice 2.

## F3 Enquiry auto-capture

Pending: Slice 3.

## F4 Items, pricing and quotation

Pending: Slice 4.
