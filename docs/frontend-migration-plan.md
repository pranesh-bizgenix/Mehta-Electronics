# Frontend migration plan

## Goal and invariant

Introduce Next.js, React, TypeScript, and App Router without moving authoritative business logic from the separate Node.js ES-module backend using the built-in HTTP server. The existing UI/API stays usable until replacement workflows are verified and accepted. This is a proposal; routing and deployment choices require approval.

## Stages and gates

### 0. Characterize current behavior

- Record every current API route, method, auth/CSRF requirement, request/response shape, status/error shape, pagination/filter behavior, and permission.
- Capture role-based workflow tests for login/password change, users, customers/duplicates, items, enquiries/revisions, quotations/revisions/PDF/email/status, order conversion/status, audit, dashboard, Tally status/sync/reconciliation.
- Generate API documentation from routes actually present, not planned endpoints.
- **Gate:** characterization evidence and current checks pass or existing failures are recorded with owner and plan.

### 1. Define frontend/backend contract and deployment path

- Select a same-origin reverse proxy or an explicitly configured cross-origin setup after deployment and cookie requirements are known.
- Define runtime-validated request/response schemas; share TypeScript types where useful without trusting compile-time types at the server boundary.
- Preserve current endpoints initially; add a version prefix only additively after compatibility tests exist.
- **Gate:** security review of cookies, CSRF, CORS, redirects, headers, and proxy trust; API contract approved.

### 2. Establish Next.js foundation

- Add a separate `apps/web/` application with TypeScript, App Router, semantic and accessible shared components, environment validation, and a typed API client.
- Keep user/session tokens out of unsafe browser storage. Preserve HttpOnly/SameSite/CSRF protections; select cookie topology before implementation.
- Provide loading, empty, validation, authorization, server-error, and network-error states.
- **Gate:** reproducible frontend build, accessibility baseline, authenticated API integration, and role-denial tests.

### 3. Migrate existing screens by workflow

Suggested order: auth/shell; dashboard; customers/items; enquiries; quotations/PDF/email; orders; users; audit/Tally. This sequence follows current UI capabilities and is not a claim about proposal priorities. Each new screen must use existing backend operations until independently approved backend changes are made.

- Keep old UI routable during each screen rollout.
- Use real API data only; no mock success or fabricated metrics.
- Test permission-hidden controls and backend denial for every action.
- **Gate per screen:** behavior parity, responsive/accessibility review, role tests, error-state review, acceptance evidence.

### 4. Controlled cutover

- Route a pilot role/team to the new UI while retaining a quick route back to the old UI.
- Monitor errors and compare business records created through each UI using the same backend.
- Stop/rollback on data discrepancy, authorization gap, CSRF/session failure, or critical workflow regression.
- Remove old frontend only after sponsor acceptance, operational stability window, support/training readiness, and explicit approval.

## Compatibility and data safeguards

- Both frontends call one backend and one SQLite database; no parallel business-rule implementation.
- Do not rename or change API behavior incidentally during screen migration.
- Preserve backend permissions even when the UI hides actions.
- Avoid API contract changes mixed into visual migration.
- Avoid database schema changes in frontend releases.
- Keep legacy frontend assets and release routing available until rollback window closes.

## Decisions needed before Stage 2

Frontend hosting and runtime; reverse proxy/same-origin policy; cookie domain and secure settings; base path/domain; supported browsers/devices; accessibility target; monitoring; pilot roles; acceptance authority; rollback window; and whether a separate deployment artifact/repository is required.
