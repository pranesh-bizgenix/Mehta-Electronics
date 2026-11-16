# Scoped automation service credentials

## Delivered boundary

Owner manages credentials at `/users/automation-credentials`, linked from Users
and roles. Provisioning requires an actual active operational owner and different
backup, explicit scopes and imported company IDs, expiry, per-minute rate limit,
optional literal IP/CIDR allowlist and a reason. No account, credential or default
scope is seeded. The Owner's normal session, CSRF, permission and configured MFA
gates apply to these management routes.

| Method | Owner route | Action |
|---|---|---|
| GET | /api/v1/automation-credentials | Latest 100 metadata records; never hashes/tokens |
| POST | /api/v1/automation-credentials | Explicit provision, one-time token response |
| POST | /api/v1/automation-credentials/:id/rotate | New secret and generation; old secret invalid immediately |
| POST | /api/v1/automation-credentials/:id/revoke | Irreversible revocation and generation change |

The only implemented machine operation at this checkpoint is
`GET /api/v1/automation/switches?companyId=...`. It reads existing switch state,
requires `automation.read`, supports strict bounded pagination, and reports API
version `1.0.0`. `freshness: []` means this is live configuration, not a Tally
dataset. It never changes a switch. All other machine operations remain PLANNED
in the OpenAPI contract; service credentials cannot invoke staff send, approval,
settings or connector routes, even if a staff cookie accompanies the bearer token.
Staff cookies alone cannot authenticate this machine operation.

## Secret and principal model

Each token contains a credential UUID and 32 random bytes. Only its SHA-256 digest
is stored, with constant-time verification. No raw token is stored in a database,
audit event, fixture or repo file. The UI holds the initial/rotated token only in
ephemeral component state and lets Owner copy or hide it. It is never put in local
storage. A replay returns metadata with `token: null`; lost secrets require an
explicit rotation, not a readback of the original token.

The authenticated principal has `kind: AUTOMATION_SERVICE`, credential identity,
generation, required scope, selected company and operational owner/backup. It has
no staff user ID or role. Service auth does not use localhost review access or
connector tokens and never installs staff permissions. Auth audit identifies the
credential explicitly with nullable staff actor; it does not pretend the service
was the Owner or operational assignee.

Creation UUIDs and rotation/revocation request keys make retries safe. Changed
reuse or stale expected generation is refused. Rotation keeps scopes, companies,
owner/backup, IP policy and expiry unchanged; reconfiguration requires a new
credential and revocation of the old one. Expired credentials cannot be renewed
by rotation. Inactive/demoted provisioners make their credentials unavailable.

## Scope, IP and rate enforcement

Scopes are exactly `automation.read`, `automation.write.drafts` and
`automation.write.intake`. No approve, send, delete or setting-write scope exists.
Granting a not-yet-implemented scope does not create a usable endpoint. Company
access uses actual FK-backed scope rows, not the caller's display name or a role.

IP policies accept literal addresses/subnets only. IPv4-mapped peers normalise to
IPv4; no DNS lookup or external API call occurs. Matching uses the socket peer,
never an untrusted X-Forwarded-For header. Behind a reverse proxy the peer is the
proxy: deployment must account for that explicitly; end-client IP enforcement
through a trusted proxy has not been implemented or accepted here.

Successful authentication is rate limited in fixed one-minute windows using
persisted accepted-auth events under a credential row lock, so rotation/restart
does not silently reset the configured rate. Refused requests are audited but
do not count as accepted. A bounded in-process failed-peer abuse counter limits
100 failures/minute and retains at most 10,000 peer entries; it is a security
cache, not a database. Valid traffic is governed by the Owner's explicit rate.
The machine read returns Retry-After on 429.

Known-credential refusals, accepted authentication and lifecycle actions have
append-only events plus audit entries. The credential change, event and audit
commit together. Audit failure rolls back and prevents successful authentication
or issuance. Malformed authentication is refused before database credential
lookup; failed-peer protection applies. No raw authorization header is retained.

## Database and verification

Migration `0048_automation_service_credentials.sql` adds three isolated tables:
`automation_service_credentials`, immutable `automation_service_companies` and
append-only `automation_service_credential_events`. No original automation/email
table, role permission, endpoint or switch is altered. Owner/config/actor checks,
FKs, indexes, status/scopes checks, provenance and no-hard-delete guards are applied.

Applied through the existing runner after a fresh verified backup:
`mehta_electronics_local-2026-11-06T07-54-07-342Z-c9ff7886.dump`.
The original automation baseline is unchanged; a separate credentials addendum
protects the three new tables/43 columns and five route guard entries. Runtime
tests exercise the switch envelope and version header; the remaining planned
machine responses have not been accepted.

Focused tests cover scope/metadata validation, one-time hashed secrets, immutable
retry identity, rotation, revocation, expiry, IP/company isolation, configured and
failed-peer rate limits, audit rollback, Owner session/CSRF, all four management
routes and service refusal on staff/connector routes. They use the sole database
inside rollback transactions. See the current audit checkpoint for full gate counts.

Not verified: rendered-browser provisioning, deployment TLS/proxy behavior,
independent-session rate contention or the external engineer's real credential
round-trip. No real credential/user was provisioned, no server was started, no
connector installed, no Tally contacted, and no message sent by this work.
