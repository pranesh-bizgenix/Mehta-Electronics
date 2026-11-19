> Update - 18 November 2026: Owner may now approve a quotation they created or last edited, using the explicit Owner self-approval checkbox and a reason. Manager and other roles still require an independent reviewer. This exception applies only to quotations; older self-approval rejection steps below must be read with this exception.

# Role access: business rules and manual testing

Updated 17 November 2026. Scope: the six baseline roles, permission administration, staff access and the tested login/API/screen boundaries. Live business workflow approvals also depend on record ownership, workflow status, configured policies and independent reviewers.

## Understand the rules

Each person has one login and one role. The role supplies permissions such as customers.read or quotations.approve. Permissions are checked by the server on every request. Hiding a button helps the user, but is never the security check. Departments, reporting owners and backups route work; they do not grant permissions.

The Owner changes a shared role. A change to Accounts affects every Accounts user, not only the account open in another browser. Existing sessions use the changed permissions on their next API request. The screen refreshes session hints on focus and every 30 seconds while visible. If a protected page is already open, its next request must be refused after permission removal.

| Role | Main responsibility | Baseline limits |
|---|---|---|
| Owner | Manage staff, roles, configuration and all modules | Still follows independent approval and workflow rules; cannot deactivate the Owner role or remove the last active Owner |
| Manager | Prepare and review sales, quotations, orders and purchasing; view staff | Cannot create/edit staff or manage role grants; cannot pair/revoke a connector; quotation cost visibility is allowed |
| Executive | Prepare customer, enquiry, quotation and order work | Cannot approve quotations, administer staff/roles, access Tally administration or view quotation costs |
| Accounts | Review customer dues, collections and permitted Tally data; update customers | Cannot prepare quotations/orders, manage purchasing or administer staff/roles; no quotation cost permission by default |
| Logistics lead | Read operational orders, assign Store staff, manage goods receipt/dispatch and evidence | No sales administration, prices, quotation costs, margins or Tally financial access |
| Store staff | See orders assigned to them and add operational evidence | Cannot see unassigned orders, assign staff, approve/dispatch orders or view financial data |

The Owner can change delegable permissions. The current Users & roles matrix and your session permissions are authoritative if they differ from this baseline table. Owner-only permissions cannot be delegated. Logistics/Store permissions remain limited to their operational allowlists even if an invalid database grant exists. A newly created custom role has zero permissions. Calling a role Admin does not grant access.

Approval permission does not permit self-approval. For example, an Executive can prepare a quotation, and a different eligible Manager or Owner can approve it. An Owner who prepared the quotation must use another eligible reviewer. Assignment to a reporting owner is not approval authority. Pricing/stock/business configuration can still block a correctly authorized action.

A staff account with INACTIVE/LOCKED status cannot authenticate. Changing a staff role or deactivating the staff account revokes its sessions. A role cannot be deactivated while it has active staff. The last active Owner cannot be removed. New staff must change their temporary password before accessing business APIs. Account and role changes retain history rather than deleting the person.

Permission edits require an authenticated authorized session, a valid CSRF token and an audit reason. A permission change and its audit entry commit together. Cache refresh checks for a stable version, and role edits serialize through commit so two concurrent changes cannot leave an older grant cached as current. If a stable snapshot cannot be read, that request fails and can be retried.

## Prepare the manual test

1. Run the CRM once from the repository root: `npm.cmd run dev`. Open http://127.0.0.1:3000. If it says another server is running, use that existing address.
2. Open the private credentials file at `verification-output/role-access/credentials.md`. Do not copy passwords into screenshots, tickets, Git or this guide. Use the existing six VERIFY- accounts. Do not rerun the provisioning script to reset them.
3. Use separate browser profiles for simultaneous Owner and Accounts testing. Two normal tabs in one profile share a login cookie. Close all private windows between roles if you use private browsing.
4. Open Developer Tools, select Network, filter Fetch/XHR, and preserve the log. Inspect the status and response of the relevant API. Never export cookies or authentication headers to a shared file.
5. For new business records use the local development database, prefix names/reasons VERIFY-, and clean up the fixtures. Do not create artificial quotes, orders or customers in RDS to exercise this guide. The six existing demonstration accounts are intentionally retained.
6. Permission edits affect everyone in the role. Use a controlled test period and restore the original checkbox immediately. Record its starting state before changing it.

## Login and menu checks for each role

Repeat these steps separately for all six accounts.

1. Sign in with that role's email and current password. Confirm the account menu shows the same role. A login must not silently become Owner.
2. If asked to change a temporary password, complete Settings > Change password before testing business screens. A business API must be refused until that change is complete.
3. Owner/Manager/Executive/Accounts should have the dashboard. Logistics lead and Store staff should use Logistics & store.
4. Open Users & roles directly at `/users`. Owner can administer; Manager can view staff; Executive/Accounts/Logistics lead/Store staff must see Access restricted. Their staff API must return 403.
5. Open `/users?tab=roles`. Only a role with access.read should receive the permission matrix. The baseline Owner has it. Other baseline accounts must receive 403 from GET `/api/v1/roles`.
6. Open `/tally/connector`. Owner has connector administration. Manager and Accounts may have Tally read/sync permissions, but cannot pair/revoke the Windows connector.
7. Sign out. Refresh a protected API or page. The old session must no longer authorize it; the API returns 401.

## Verify immediate permission changes and audit

This is the acceptance flow automated by `scripts/verify-role-access.mjs`.

1. In browser A sign in as Owner. Open Administration > Users & roles > Role permissions.
2. In browser B sign in as Accounts. Open Customers and confirm it loads. Leave this session signed in.
3. In browser A find the customers permission section. Record whether Accounts > View customers is checked. It is checked in the baseline.
4. Uncheck that one checkbox. There is no separate Save button. Wait for the success message and completed PUT `/api/v1/roles/ACCOUNTS/permissions/customers.read` response (200).
5. In browser B refresh Customers. Expect Access restricted. GET `/api/customers?pageSize=1` must return 403. Signing out and back in must not be required for enforcement.
6. In browser A check the same box again. Wait for response 200. In browser B refresh Customers; access should return with the existing session.
7. In browser A inspect Permission and role history. Expect REVOKE and GRANT entries for Accounts/customers.read, the acting person, timestamp and exact reason. The audit trail must agree.
8. Leave the checkbox in its original state. This test must not leave Accounts access changed.

## Protected actions

| Test | Steps | Expected result |
|---|---|---|
| Owner role protection | Owner > Role permissions > Edit Owner | Status/two-factor controls protected; direct deactivate request returns 409 |
| Reserved permission | Inspect users.create for Accounts | Disabled; a direct grant request returns 409 |
| Logistics restriction | Inspect quotation cost read for Store staff | Disabled; a direct grant request returns 403 |
| Missing CSRF | In controlled API testing omit CSRF from a role PUT | 403; permission and audit data unchanged |
| Missing reason | Owner API request supplies granted but no reason | 422; no saved change |
| Non-Owner administration | Manager/Executive/Accounts/Logistics/Store send role PUT | 403; no saved change |
| Last Owner | On local test data attempt to demote the last active Owner | Refused; at least one active Owner remains |
| Inactive role assignment | On local test data deactivate an unused custom role, then try assigning staff to it | Refused even if an old browser still lists it |
| Custom role | Owner creates VERIFY- custom role with a reason on local test data | Starts without access; grant only the required permissions; retained audit |

## Staff lifecycle checks on local test data

1. Owner opens People > Add staff. Enter a VERIFY- name and email, choose a role, assign a different active reporting owner, and optionally a different backup. Set a strong temporary password and provide a reason.
2. Sign in as the new person in another browser. Expect the required first password change. Business requests before that must fail.
3. While the staff session is open, use Owner to change its role with a reason. Its existing session must stop authorizing requests. Sign in again and verify only the new role's access.
4. Deactivate that test staff account. Existing sessions must be revoked and new login refused. Its account and audit history remain.
5. Try deactivating a role with active staff. It must be refused. Move/deactivate the test staff first, then deactivate the unused role.
6. Restore any existing staff settings changed for testing. Archive test accounts with a reason; do not hard-delete audit history. Report retained fixtures explicitly.

## Record-level checks on local test data

1. Prepare a VERIFY- quotation as Executive. An eligible different Manager/Owner reviews it. Executive must not be able to approve by changing the API request. If Manager prepares a quotation, that same Manager must not self-approve.
2. In a quotation that has configured costs, compare Manager and Executive details. Manager may see the pricing/cost section. Executive must not receive private pricing in the JSON response, even if the browser hides it.
3. Assign one VERIFY- order to Store staff A. A may see its operational details and add permitted evidence. Store staff B must be refused access to that order's details and evidence URLs. Neither may receive prices, totals, costs, credit or margins.
4. Remove A's assignment. Its next order detail/evidence request must be refused.
5. Logistics lead may manage the operational assignment/dispatch/GRN steps their permissions permit, but the stock/workflow rules must still validate quantities and state.

These record tests require properly configured local workflow fixtures. A permission is not a substitute for valid business setup.

## Production operation

`npm.cmd start` runs in production mode. Production now refuses LOCAL_REVIEW_ACCESS=true and requires MFA_ENABLED=true. Set an application encryption key privately as described in `.env.example`, serve over HTTPS, enroll required accounts through the existing two-factor screens and store recovery codes securely. Do not switch the live environment or enroll/reset other people's devices simply to run a demonstration.

The current development acceptance uses password login with its existing MFA setting. A local dev browser pass does not certify deployed TLS, a real authenticator device, recovery procedures, penetration testing or all business workflows. Check the acceptance report for exact evidence and outstanding release gates. The observed Next.js advisory was addressed by updating 16.4.2 to 16.4.6. The post-update production dependency audit reported zero known vulnerabilities; this is not a penetration-test certificate.

## Run the automated acceptance

From the repository root, `node scripts/verify-role-access.mjs` uses the private six-account credentials. It exercises real browser login, allowed and blocked API routes, direct restricted pages, a temporary Accounts permission removal/restoration through the UI, audit evidence and logout. It restores permission membership in finally and writes results/screenshots under `verification-output/role-access/2026-11-17/`. Do not run it during other administrators' role edits; compare its cleanup result before treating it as a pass.

Use the focused unit command from the acceptance report for cache, lifecycle, production configuration and matrix protection checks. Database workflow suites remain limited to the local database. Set LOCAL_TEST_DATABASE_URL privately if available; never repoint the deployment DATABASE_URL to make tests run.

## Authorized RDS acceptance on 17 November

The user separately authorized running the remaining staff and approval checks on RDS. This is a controlled engineering procedure, not permission for ordinary testers to create live business records. `verification-output/role-access/rds-browser-verification.mjs` requires `VERIFY_AUTHORIZED_RDS_ROLLBACK=true`, checks the exact RDS endpoint/database/SSL and uses the existing rollback harness. It temporarily serves real screens and handlers on the same port 3000. It never commits its outer transaction. Test policy values are visible only to this isolated transaction and are not business decisions. Cleanup independently checks created fixture IDs after rollback. Database sequences can advance.

For normal manual review, use the six existing accounts and the read-only/menu checks first. New staff should be real individual users with their own email, named reporting owner and temporary password. Never use the shared demonstration accounts as production staff identities.

### Practical staff creation and password test

1. Sign in as Owner and open Administration > Users & roles > People.
2. Click Create staff. Enter full name, unique email and a role. Select a different active reporting owner; select a different backup if available.
3. Enter a strong temporary password. Review the independent-reviewer coverage warnings. A warning is not an approval or proof that setup is ready.
4. Confirm creation with a specific reason. Check the saved role, reporting owner, backup and Password change pending badge.
5. In a different browser profile sign in as that staff member. The application should take them to the password-change screen before business pages are usable.
6. Change the temporary password to a different strong password. Confirm the success message and Password ready state. The password must never appear in API staff responses or audit history.
7. As Owner change the staff role with a reason. The staff member must sign in again; the old session must no longer work.
8. Deactivate the verification staff when finished. Confirm login is denied, and retain the account/audit history rather than deleting it.

### Practical independent approval test

1. Use configured verification data to prepare a quotation as Executive. Save a draft, update its terms and submit it for review.
2. The maker must not be able to approve their own quotation. A hidden button alone is not sufficient: the server must also reject their approval request.
3. Open the same quotation as a different eligible Manager. Confirm the saved quantities, rates and terms, then approve with a reason.
4. Confirm APPROVED is retained after refresh and in the database. If the configured policy has multiple stages, the quotation must stay pending until every required stage is complete.
5. For customer onboarding, the person who submitted the customer must not approve their own billing activation. A different eligible reviewer should approve it, with different submitted_by and decided_by values recorded.
6. A missing policy, pending customer review or unavailable independent reviewer must remain visible as a real prerequisite; role permission alone must not bypass it.

Customer review independence includes both the original creator and the latest submitter. Another person's edit does not make the original creator eligible to approve or reject their own original onboarding request. Test this on isolated verification data, then use a third eligible reviewer for a genuine independent decision.
