# Role-based access decisions and verification

16 November 2026. User requested completing role-based access and explicitly permitted assumptions rather than waiting for client approval. These are provisional engineering decisions, not statements that Prem approved them.

| Role | Baseline responsibility |
|---|---|
| Owner | Protected full access, account/role administration and business settings. Role stays active and requires MFA; runtime enforcement still follows MFA_ENABLED. |
| Manager | Existing sales and purchasing supervision grants, including reviews; no owner-only administration. |
| Executive | Existing sales/customer/enquiry/quotation/order preparation grants; no approval or cost privileges added. |
| Accounts | Existing accounting/dues and permitted stored-Tally visibility; no owner-only administration. |
| Logistics lead | Existing narrow operational allowlist: logistics, GRN, dispatch, assignment and evidence. No financial/Tally data. |
| Store staff | Existing assigned-order and evidence-only logistics allowlist. |

The exact effective permission catalogue remains database-backed and editable by the Owner. Existing per-record assignment scopes, financial redaction, maker-checker and CSRF remain authoritative. Departments route work and do not grant access. No permission grants or business rules were changed on RDS by this implementation.

## Decisions and reasons

- Keep the six existing roles rather than inventing new department-wide grants.
- Allow Owner-created custom roles, including the name Admin, starting with zero permissions. A label grants no privilege; this replaces the earlier requirement to wait for client confirmation of an Admin label.
- Filter unknown and owner-only grants for non-Owners at enforcement time, not just in the permission editor. Wildcard access belongs only to the actual Owner role.
- Apply the Logistics/Store allowlists both to effective permissions and to matrix display.
- Refresh the shared permission cache only after a successful access-change transaction. Failed commits cannot publish tentative grants.
- Inactive roles cannot authenticate or retain a usable staff session.
- Lock the selected role inside staff creation/reassignment and role lifecycle changes so a stale UI preview cannot assign a now-inactive role.
- Add role-name, description, MFA and lifecycle editing plus visible change history in the existing Users & roles screen. Owner protections and active-user deactivation checks stay on the server.
- Refresh session permission hints on focus, return to the tab and every 30 seconds while visible. Server checks remain effective per request; UI refresh is not the security boundary.
- Hide protected screen content for direct URLs as well as navigation links. Business endpoints independently enforce their permissions.
- Provide an explicit interactive first-Owner command. Startup never seeds privileged accounts or passwords.
- User separately requested six persistent role-testing logins on RDS. They are clearly named VERIFY-, audited, have unique random passwords and initially require a password change. They are not automatically cleaned up as transaction fixtures; retain until the user deactivates them.
- Keep passwords in `verification-output/role-access/credentials.md`, excluded from Git, rather than source, logs or this document. Disable LOCAL_REVIEW_ACCESS so the selected login cannot silently become Owner.
- Block automated database test fixtures against RDS; they require local mehta_electronics_local on loopback. Existing RDS test accounts are an explicit user-authorized provisioning action, not a database test-suite fixture.

## Verification

- 41 focused protocol/pure tests passed: permission policies, commit failure, role protections, first-Owner setup, database guards, backup gates and permission checkbox policy.
- Syntax lint passed; web TypeScript check passed after the UI changes.
- `verification-output/role-access/account-verification.json` records six active accounts, password-hash matches, assigned roles and effective permissions without storing passwords.
- Real browser and HTTP login verification is recorded per role in `verification-output/role-access/browser-results.json`; only recorded completed roles count as passes. No full automated database suite was run against RDS.
- No schema migrations were added for this work. RDS remains at the original 58 migration checksums.

## Operational limits

The accounts are role-demonstration identities, not a final staff roster. Actual client prices, credit and workflow rules remain unset. Test logins do not certify live Tally sync, business readiness, independent concurrent edits or production MFA enforcement.

The production build, syntax lint and TypeScript checks passed. The dev tool also reported a Next.js dependency security advisory; dependency upgrades were not included in these access changes. This advisory is not a claim that a specific exploit was reproduced.

## Completed role-login verification

All six real browser logins passed against the configured RDS database. Each login returned its own role. Owner role settings/history and the edit dialog rendered; Manager staff access was read-only relative to Owner administration. Executive, Accounts, Logistics lead and Store staff were denied the staff API and protected users screen. The permission-matrix API allowed Owner and denied all five other baseline roles.

Initial password changes were exercised through the real UI. Owner's change completed in an earlier browser attempt before its selector failure; the final run reused that changed password. The five other roles completed their initial change in the successful run. The local credentials file contains current passwords, not the original temporary ones. `account-verification.json` is the earlier pre-change snapshot; `final-verification.json` is authoritative for current password/setup state.

Browser results and screenshots: `verification-output/role-access/`. Failed attempts are retained as diagnostics, not passes. Early failures were driver label/heading selectors and an interrupted/stale dev server. All six final checks passed after correction/restart. No business workflow data was created by these login checks.

These results prove the tested login/navigation/API boundaries, not every business action in every module. Automated database suites remain restricted to the local dev database. Fine-grained service policies, rollback cache behavior and concurrent-role lifecycle validation have protocol regression tests; independent live contention and production MFA acceptance are not claimed.

## 17 November hardening and acceptance

The user requested completing role access for all six roles and explaining the business logic and manual testing. The additional access-cache fix prevents a grant read before a concurrent commit from being published under the newer event version. Cache loads share one task, bracket reads with version checks and refuse the request after repeated churn. Matrix writes take a transaction advisory lock through commit, keeping max(event.id) meaningful across concurrent role changes. The matrix view uses a consistent permission snapshot.

The permission UI uses the confirmed response to update its checkboxes/history and rejects overlapping save requests. Production startup now requires MFA_ENABLED=true and a valid 32-byte application encryption key, in addition to refusing local review access. Development configuration was not changed.

A dependency audit confirmed GHSA-mfr8-8qww-v76h in Next.js 16.4.2. The web package and lockfile were patched to 16.4.6. Post-update audit reported zero known vulnerabilities, and the production build/package passed. No database migrations were added.

The first expanded browser run passed all six role boundaries but its checkbox uncheck helper asserted before the asynchronous save completed. The exact permission membership was restored in finally and independently checked. That attempt is retained as a failed diagnostic. The corrected driver clicks, waits for the actual response and verifies access from another existing session. Latest acceptance, cleanup and lifecycle evidence is under verification-output/role-access/2026-11-17/; only its final status is authoritative.

Manual business explanation and test steps: docs/role-access-manual-testing.md. These baseline grants are existing provisional engineering decisions, not newly invented client approvals. Full database workflow regression remains restricted to the local test database; no local test connection has been supplied at this checkpoint.

Final 17 Nov acceptance: all six recorded role boundary cases passed; the corrected focused UI permission-save flow passed 22 HTTP assertions, and the separate staff lifecycle flow passed 11. The combined report records 125 HTTP assertions across scoped runs and 25 unit tests. Both earlier failed full attempts are retained as diagnostics, including the late browser-save cleanup race and its audited restoration. Final checks confirm original role-permission membership and Manager role/status were restored. No business fixtures, accounts or migrations were created. Production build passed and the patched dependency audit reports zero known vulnerabilities. Device MFA/HTTPS and the full local database workflow suite remain outside this acceptance. See verification-output/role-access/2026-11-17/REPORT.md and summary.json.

17 November 2026 - renewed end-to-end request: the user explicitly directed verification in RDS rather than waiting for local credentials. A separate, explicit VERIFY_AUTHORIZED_RDS_ROLLBACK=true operational helper permits only the previously authorized exact RDS endpoint, postgres database and required SSL. Ordinary withTestTransaction and the generic test runner remain local-only. Operational fixture changes use the existing managed savepoint harness and an unconditional outer rollback; schema changes and raw transaction escape remain forbidden. No migrations are part of this work. Test policy values are temporary fixture inputs, not adopted client decisions. PostgreSQL sequences may advance even when fixture rows roll back.

The new complete six-role acceptance passed 104 HTTP checks in one execution, including UI permission save/revoke/restore, current-session enforcement, audit, staff role/status session revocation and final restoration. The separate navigation acceptance passed for all six roles. Prior failed diagnostic attempts remain preserved. New evidence is under verification-output/role-access/2026-11-17/final-rerun/.

Approval integrity defect: quotationReviewer previously trusted all_permissions for any role, while the central access provider reserved wildcard access for Owner. Corrected this inconsistency and added a regression proving a Manager with corrupt all_permissions metadata still needs explicit quotation grants. This does not imply that corruption was present in the live RDS roles. The defect was reproduced with controlled unit inputs.

Staff confirmation readiness: code review found that opening the confirmation dialog restarted reviewer coverage even with unchanged staff inputs. The preview now depends on the effective proposed status instead of every confirmation-mode change. ReasonDialog supports disabling confirmation while required coverage is unavailable, retaining the server-side checks and audit reason requirement. No action or prerequisite is auto-approved.

The initial RDS browser fixture attempt timed out waiting 90 seconds for a quotation response. The separate failed attempt is retained. It was stopped without committing, and a new independent read confirmed fixture accounts, customers, item and company were absent. The focused retry excludes unrelated order/stock fixture setup and uses longer browser timeouts. Managed transaction settings are captured/restored in one SQL call each instead of six serial calls; per-statement savepoints, commit containment, DDL rejection and unconditional outer rollback are retained. This is verification harness behavior, not a relaxation of product authorization or approval gates. Order integration is outside this focused retry and is not claimed from it.

Customer maker-checker defect: decideCustomerOnboarding previously checked only submitted_by. After a different editor resubmitted a request, the original creator could become eligible to decide their own original request. It now refuses both created_by and submitted_by. Two service regressions cover original creator after another editor and current submitter, with no decision writes. A separate authorized RDS rollback check exercises the original-creator-after-resubmission case against the actual database. No existing review was changed retroactively.

Quotation post-save navigation defect observed in the RDS browser retry: the API returned saved quotation ID 3 and an independent API read confirmed DRAFT version 1, while the browser remained on /quotations/new for the full navigation wait. The post-create transition now uses same-origin document replacement to open the persisted record. This preserves replacement history and the idempotent create key, and does not retry creation. The RSC/client-router root cause has not been established; the observed symptom must be rechecked through the actual create/edit/submit/independent-approval browser flow before being marked fixed.

### 18 November follow-up verification
Staff creation, forced password change, customer self-approval refusal, independent customer approval and duplicate review passed through real UI/API and RDS rollback fixtures. The initial quotation browser sequence reloaded before submission completed; it now waits for the action response. Full-page creation navigation can discard Playwright's response body, so creation checks HTTP 201 and the persisted numeric record URL instead. Next's production renderer changes NODE_ENV; cleanup captures the approved database URL before renderer setup rather than reloading production MFA configuration. No product MFA guard was changed. Failed attempts remain separate from passing evidence. Independent reads confirmed interrupted fixtures absent and all six existing role accounts active.


## 18 November 2026 - user-requested Owner quotation self-approval exception

The user explicitly instructed: "make it owner himself can also approve his quotation". This supersedes earlier unconditional quotation maker-checker statements in this log. It does not change customer onboarding, purchasing, staff administration or other approval workflows.

An eligible account whose current database role is OWNER may approve a quotation it created or last edited. It must still hold the stage permission, pass active-account/MFA checks, acknowledge Owner self-approval and supply a reason. Manager and every other role remain unable to approve their own quotations; a request claiming role OWNER is not trusted. Margin, cost, validity, source bindings, staged review order and distinct-reviewer rules remain enforced.

Completed self-review evidence records ownerSelfApproval=true. The quotation event/audit includes an Owner exception marker. Later approval validation requires the marked reviewer to remain an eligible Owner; historical unmarked self-review is not silently accepted. This is the user's application policy decision, not independent review or evidence of Prem's commercial sign-off. Quotation 8 is left pending for manual approval; rollback fixtures are used for functional acceptance.
