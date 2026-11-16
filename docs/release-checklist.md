# ControlDesk release checklist

**Working checklist, not release approval.** Updated 6 November 2026. S2 remains partial and S3–S10 completion has not been proven. The active goal retains the full staged requirements. Refer to `prompt-pack-completion-audit.md` for per-requirement evidence and historical gates.

## Requirements and implementation evidence

- [ ] Reconcile every explicit S0–S10 requirement with current source, tests and runtime evidence; do not treat reserved tables or generic screens as completed workflows.
- [ ] Resolve the missing named LLD/prompt-pack specification paths, or obtain an explicit replacement source of authority. Existing attachments/registers alone do not prove coverage of absent specifications.
- [ ] Accept the implemented S2 quotation source binding, level selection and contract identity continuity; accept manual/import approval consistency; complete reviewed supersession; accept the stock-check/history/daily implementation and confirm real reservation source mappings and fulfillment integration.
- [ ] Complete and verify all remaining S3–S10 items in order, with uncertain business values empty and blocked.
- [ ] Re-run S0 integrity/performance/workflow-matrix audits against the final schema and regenerate `db-schema-reference.md`.
- [ ] Regenerate the final read-only system report and mark each requirement DONE / PARTIAL / BLOCKED-PREM / OUT-OF-SCOPE using authoritative evidence.

## Database and recovery

- [ ] Verify the live database is exactly `mehta_electronics_local` on the target host and every database entry path uses the identity guard.
- [ ] Verify a non-empty, intact fresh backup before production pending migrations; use the existing runner. No development override in production.
- [ ] Confirm backup scheduling, retention, access controls and a human-approved recovery exercise consistent with the sole-database restriction. A dump file alone does not prove a successful recovery.
- [ ] Run the final whole suite and verify both global ZZTEST residue scans are clean. No persistent fixture rows or sample passwords.
- [ ] Review final query plans and the separately authorised load-test window. No live-writing load test is authorised by this checklist.

## Authentication and operational access

- [ ] Disable local review access for deployment and verify normal session/CSRF/permission checks over the deployed route boundaries. The approved loopback review exception is not a hosted authentication mode.
- [ ] Confirm real staff accounts, reporting/backup owners, independent eligible reviewers and Owner account coverage without creating guessed users/passwords.
- [ ] Confirm MFA enforcement and recovery with Owner; verify restricted roles cannot obtain costs, margins or Tally financial fields.
- [ ] Confirm host networking/HTTPS, secret provisioning, logging/redaction, document access and audit retention. Do not introduce a second app listener or external API URL.

## Pricing and client decisions

- [ ] Owner confirms quotation policy, costs, required business rules and all price-level meanings/calculations. Keep missing settings empty; verify their named block messages.
- [ ] Owner confirms import mappings, effective dates, currencies, source precedence and supersession. No automatic adoption of example document values as policy.
- [ ] Independently review real price imports; verify customer output contains net prices without list-price/discount disclosure.
- [ ] Accept real PDF price-list layouts and review repeated headers/exclusions. Verify target-host Python and the pinned offline pypdf dependency; OCR is not supplied.
- [ ] Exercise expiration, changed products/costs/rules, replaced contracts and revised price sources at draft, submit, approve and send boundaries. Preserve the original approved identities.

## Tally and teammate boundary

- [ ] Obtain separate authorisation for connector installation/update and perform documented live read-side acceptance per company/dataset. No installation has been done by this development work.
- [ ] Verify selected-company identity, counts, missing vouchers, freshness and read-only recovery with actual connector evidence.
- [ ] Keep all Tally write switches OFF until all BLOCKED-PREM mappings/numbering/identities/approval/conflict settings and live acceptance are explicitly resolved. Dry-run tests do not authorise live writes.
- [ ] Review unknown-result recovery and duplicate protection against the actual Tally version before considering live activation.
- [ ] Agree the handoff boundary with the engineer responsible for messaging/intake/extraction/sending. This repository task does not enable email/WhatsApp/SMTP/Make automation or weaken send/approval gates.

## Acceptance and final gate

- [ ] Run the real browser and responsive/accessibility acceptance against the final artifact, including new import/configuration screens.
- [ ] Complete the end-to-end business walkthrough with the client and document decisions/gaps without fabricated data.
- [ ] Final lint, web typecheck, full tests, production build, schema tests and zero-residue gate all pass on the final state.
- [ ] Review remaining risks, operational runbooks and release rollback; obtain explicit deployment/release authorisation.

Most recent completed checkpoint before price-level configuration: PDF state **271 passed / 0 failed / 0 skipped**, both residue scans clean, lint/typecheck/build passed. The subsequent price-level state has its own logs (`s2-levels-*`); record its final terminal result in the implementation log. Neither checkpoint is whole-system production certification.

Final configuration checkpoint: full suite 273 passed / 0 failed / 0 skipped, both whole-database residue scans clean; lint, web typecheck and production build pass (s2-levels-* logs). This does not complete quotation source binding, all S2 work or release acceptance.


Quotation-source checkpoint update: explicit level preview/apply and retained contract/level identity validation are now implemented, with focused rollback and HTTP response-boundary tests. Equal-priced source replacements and changed level meanings invalidate old approvals rather than silently repricing. Live concurrency and rendered client acceptance remain unchecked. Source implementation/test evidence is in docs/price-levels.md and s2-source-* logs. This does not enable any Tally write or messaging automation.


Manual-entry follow-up: /items/manual-price-list now uses retained preview/independent activation, with no form numeric defaults; old direct activation/edit requests are blocked. Canonical list APIs and item projections enforce existing list-price permission. Historical rows without retained review evidence are labelled rather than silently adopted. Existing version retirement/supersession and legacy profile provenance remain pending. Browser/client/old-client migration acceptance is still unchecked.
