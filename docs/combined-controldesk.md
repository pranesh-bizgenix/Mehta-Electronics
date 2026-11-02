# One ControlDesk application

CRM, imported Tally data, reconciliation and connector configuration now share one HTTP server, one origin, one authenticated session and the existing database. The default address is **http://127.0.0.1:3000**. Port 3001 is no longer needed.

## Start

From `Mehta-Electronics`:

```powershell
npm.cmd run dev
```

For production:

```powershell
npm.cmd run build
npm.cmd start
```

Root and `apps/web` start/dev commands now launch the same combined application. For a new installation, install root and web dependencies once. Existing `.env` and `DATABASE_URL` are retained; no additional database or connection string is introduced.

## Where to work

| Need | Screen in the same application |
|---|---|
| Customers, enquiries, quotations, customer POs | Sales sidebar |
| Products, supplier offers, purchase POs, goods receipt | Supply sidebar |
| All imported masters, source fields, history and reconciliation | Tally & reconciliation — `/tally` |
| Pairing, Engine setup, profile selection, connection guidance and sync history | Tally connector — `/tally/connector` |

The connector page replaces the old interface link; the account menu and command palette no longer offer another set of screens. Legacy navigation code also uses relative application links instead of sending users to port 3001.

## Connector setup

Choose **Configure connector**, then select the software actually installed on the Tally PC. The Bizgenix Windows connector uses a temporary pairing code. The existing Node.js Tally Engine uses its setup token and organisation ID. These are agent-specific authentication methods for the same ControlDesk application, not two CRMs.

Enter the exact company name from TallyPrime. Copy the ControlDesk address shown on the screen. Complete the Windows application's **Connect and Start Service** step; creating or typing a code alone does not complete pairing. On a different PC, `127.0.0.1` refers to that other PC: use the reachable deployed HTTPS ControlDesk address.

The UI distinguishes awaiting pairing, expired code, no heartbeat, offline, Tally unavailable, no company, awaiting first sync and connected. It supports all retained profiles rather than silently displaying only the first. A completed import is required before claiming data is synced. Disabling a profile retains its imported records.

Credentials are displayed only in the issuance dialog, never saved into browser preferences, reports or screenshots. Existing `/api/connectors/*`, `/api/ingest/*` and `/api/tally-connector/*` contracts on port 3000 are preserved. Existing agent profiles/tokens do not need to be replaced merely because the UI is combined. No agent was reconfigured or credentials generated against business data during verification.

## Implementation and verification

`src/controldesk-server.js` hosts the existing API handler and Next UI on a single listener using the [documented Next custom-server API](https://nextjs.org/docs/app/guides/custom-server). `src/server.js` starts and stops them together. Development builds use `.next-dev`; production uses `.next`. The build packages the web application alongside the existing API. The quotation print stylesheet remains available at its existing path.

`scripts/verify-combined-controldesk.mjs` runs against a random `test_<random>` schema within the existing database and drops it afterwards. It checks same-origin CRM/Tally navigation, one shared login, real native pairing, bearer-authenticated heartbeat, exact-company binding, audited issuance, role denials, and desktop/mobile light/dark screenshots. Output: `output/combined-controldesk/verification.json`. Test credentials are not printed or included in screenshots.

This change does not issue Tally writes, replay imported payloads, create another database, seed demo business data, activate email/WhatsApp or turn on automation switches. The existing Owner/Accounts server enforcement for imported financial fields remains in place.

Verified on 2 November 2026: full suite 90 passed, zero failed, five optional database checks skipped; production build, TypeScript and design-token checks passed. Combined-server browser checks passed in production and development. Production checks also covered both connector setup methods and rejection of a heartbeat for the wrong company. Four connector screenshots cover 1440/390 px in light/dark mode, without credentials. See `output/combined-controldesk/verification.json` and `verification-dev.json`.
