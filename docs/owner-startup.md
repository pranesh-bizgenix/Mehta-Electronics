# Existing Owner required at startup

ControlDesk never creates an Owner or seeds a password at startup. The configuration
and example environment file do not supply bootstrap credentials. Historical
`SEED_OWNER_EMAIL` and `SEED_OWNER_PASSWORD` variables have no startup effect.

After the existing guarded migration runner, startup checks for an existing user
whose role is OWNER, user status is ACTIVE and role status is ACTIVE. A missing
account, inactive/locked Owner, inactive role or only non-Owner staff causes
`ACTIVE_OWNER_REQUIRED` before document backfill or the app listener starts. The
check reads the ID only; it does not fetch or log account credentials or create,
edit or reactivate anyone. Existing login, password change, MFA, permissions and
the authorised development-only localhost review mode remain unchanged.

## Operator procedure

1. Use only the configured `mehta_electronics_local` database and the existing
   startup commands. Do not create another database or overwrite the real `.env`.
2. If startup reports `ACTIVE_OWNER_REQUIRED`, stop. Confirm the intended host and
   database with the deployment owner, without copying credentials into logs.
3. Obtain an explicitly approved first-Owner provisioning or account recovery
   procedure from the deployment owner/security engineer. This repository has no
   first-account creation CLI; changing historical seed variables will not help.
   Do not invent a user, email, password or approval record.
4. Once an authorised active Owner exists, start normally and sign in with that
   account. The existing Owner provisions staff through `/users`; established
   session, CSRF, permission, first-password-change and MFA gates still apply.

This guard does not certify real staff/reviewer coverage or deployment readiness.
`test/owner-startup.test.js` verifies refusal, existing access and absence of
database mutations using protocol spies without connecting to any database.
