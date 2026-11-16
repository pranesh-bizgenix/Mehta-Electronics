# HUMAN runbook: guarded Tally CREATE verification

**Not executed by development. All production switches remain OFF.** This runbook authorizes no new database/server/port and no business defaults. Use the existing app, existing sole PostgreSQL database and existing connector only.

## Before any release

- [ ] Prem confirms categories and party-ledger authority; nothing is enabled by default.
- [ ] Tally expert confirms version/edition, local XML-import availability, exact company name/GUID and supported current-company/identity/read-back exports.
- [ ] Tally expert verifies CREATE collision behavior and agrees an exclusive/controlled acceptance window; preflight plus import is not atomic inside Tally.
- [ ] Prem approves voucher type names/IDs, numbering, field mappings, tax/posting/discount rules, ledger/godown/unit IDs, key field, approval mode, conflict winners and all thresholds. Missing values block; consult BLOCKED-PREM in `tally-two-way-sync.md`.
- [ ] A different eligible reviewer is available. No creator/last editor approves their own business document or push.
- [ ] Resolve existing UNKNOWN jobs before release. Preserve encrypted journals and audit evidence.
- [ ] Confirm production authentication/MFA and database backup/restore procedures separately. Localhost review login bypass is not production authentication approval.
- [ ] Run and retain the listed regression/build commands. Review current migration/backups; no alternate PostgreSQL database may be created or restored for this task.

## Tally operator preparation (human only)

1. Back up the real **Tally company data** using the approved Tally procedure. Record operator, timestamp, company identity and backup location privately. Do not put real client data into Git.
2. First use a **Tally company copy** prepared by its authorized operator. This is not permission to create/copy any PostgreSQL database. Import that Tally company's actual identity/masters through the existing connector and scope all mappings to that company.
3. Stage connector binaries without replacing the running installation. Record hashes, back up the existing service folder, review the existing Administrator/update/rollback procedure, and have the authorized operator perform any installation/restart. Do not treat a local source build as a published verified installer.
4. Verify normal read sync works before the write experiment. Record successful heartbeat, selected company, source freshness and read counts.

## Mapping and dry-run review

1. Open `/tally/write` as Owner, with the exact test company selected in the header.
2. Save a draft mapping. Use imported stable keys/GUIDs for party/items/ledgers/voucher types/godowns/units. Do not match by name alone.
3. Have the Tally expert review every mapping, posting sign, tax component, quantity/unit/rate/discount format, date transformation, reference field and read-back field. Approve a new immutable version and select it explicitly.
4. Enter only the confirmed settings and reason. Keep dry-run-only TRUE. Enable only the chosen category and master for this controlled review; completeness gates must pass. This is an operator action, not part of development's current changes.
5. Choose an approved locked test CRM document. Build the dry-run preview. Compare the approved source snapshot and exact CREATE XML. Independently check lines, exact amounts/taxes, party, company, date, numbering and idempotency reference. A preview is not evidence that Tally accepted it.
6. Confirm no Tally CREATE occurred and no confirmed link was fabricated. Review immutable mapping/job hashes, validation report and audit events.

## One controlled live CREATE on the copied Tally company

1. Get explicit Prem authorization for one category/document. Confirm the Tally window's current name/GUID and ensure no conflicting voucher/party already exists.
2. Select live mode for that category only; explicitly acknowledge it and record the reason. Keep all other categories OFF. Independent approval is still required by the confirmed mode, and always for new party ledgers.
3. Review/approve the queued snapshot. Ensure the creator/last editor is not the push approver. An old dry-run row requires explicit independent review before it can become live.
4. Observe one claim, exact current-company probe, pre-send key/collision lookup and authorization. The connector must issue no more than one CREATE for that job.
5. Verify the raw import response reports CREATED=1, ALTERED=0, DELETED=0, ERRORS=0, with no line errors. Then verify the read-back stable GUID/master ID, key, headers, lines, quantities, rates, discounts, godown, accounting entries and exact totals.
6. Inspect the voucher/ledger manually in Tally. Confirm no existing record changed. Confirm the CRM link appears only after CONFIRMED. For sales orders, verify dispatch remains blocked until the current approved version has a confirmed Tally entry when the category is active.
7. Let unchanged normal read sync deliver the new source record. Run the Owner's mapped comparison. MATCH requires complete delivered evidence; differences/incomplete fields must enter conflict review, never auto-resolve.
8. Turn master OFF and retain the evidence. Repeat the copied-company procedure independently for each additionally authorized category.

## Failure drills and kill switch

- Wrong/closed company: expect no CREATE and a clear held/pre-send failure.
- Unavailable Tally: expect clear pre-send failure; review before retry, within configured attempts/backoff.
- Import LINEERROR/unexpected counts: retain response; do not infer success or blindly resend.
- Lost response or crash after authorization: expect UNKNOWN. Request read-back-only; never manually send the stored XML again.
- Matching read-back: CONFIRMED without another CREATE. Missing/incomplete collection evidence is not proof of absence.
- Proved key absence: independent Owner manually inspects Tally, records reason and resolves to HELD; a fresh approval is needed. Do not clear a journal to bypass this.
- Breaker: category pauses at its confirmed threshold; Owner investigates and resumes explicitly. This does not approve queued work.
- Kill switch: turn master OFF. No new authorization should be issued; pending/unsent rows are held. Already released network POSTs cannot be recalled; inspect all in-flight/UNKNOWN entries.

## Production sign-off (separate human decision)

- [ ] Copied-company evidence approved by Prem and Tally expert for each category.
- [ ] Backup and connector binary rollback rehearsed by an authorized operator.
- [ ] Exact production company/mappings reviewed independently; no copied-company IDs reused.
- [ ] Production dry-run XML reviewed against approved source documents and actual commercial policy.
- [ ] One controlled production test document authorized, sent, inspected and verified through read-back and subsequent normal import.
- [ ] Company separation, permission, MFA, audit, monitoring, UNKNOWN recovery and kill switch verified.
- [ ] Independent-session concurrency/load/resource-contention testing and agreed operating window completed; current rollback tests are not that certification.
- [ ] Owner explicitly enables **one** production category and records monitoring responsibility. Other categories stay OFF until separately approved.
- [ ] Signature/date/evidence locations recorded privately. No client document, token, bank data or business price is committed to the repository.

Until these checks are complete, describe the feature as **disabled infrastructure awaiting confirmed mappings and live acceptance**, not working production two-way sync.
