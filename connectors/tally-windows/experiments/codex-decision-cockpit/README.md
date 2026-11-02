# Codex Decision Cockpit

A separate, dependency-free management cockpit inside the GI repository. It keeps the visual prototype isolated while reading an authenticated, management-safe summary from the existing GI application.

## Run

Start the existing GI core first:

```bash
pnpm dev
```

Then start the cockpit in a second terminal:

```bash
cd experiments/codex-decision-cockpit
node server.mjs
```

Open `http://127.0.0.1:4173`.

The cockpit requests `/api/live-brief`; its local server forwards the current GI session to `http://127.0.0.1:3122/api/cockpit`. Company books remain behind the existing GI authentication boundary.

## Data flow

```text
Tally / Tally Engine / upload
            ↓
Existing GI parser and canonical dataset
            ↓
KPIs + nine deterministic insight packs
            ↓
Authenticated /api/cockpit summary
            ↓
Decision Cockpit on :4173
```

## What to review

- Owner Brief: the three ranked decisions for the week.
- Collections: invoice-level prioritization and human-approved WhatsApp action.
- Evidence: accounting formula, reconciliation and source rows.
- Outcomes: cash recovered and actions verified against later Tally receipts.

When an authenticated dataset is available, the Owner Brief replaces demo values with live GI metrics and explicitly resets outcome tracking to a baseline. When it is unavailable, the interface clearly shows demo, offline, empty or sign-in-required state. The remaining secondary screens still use synthetic data and are intended for product judgment, not financial decisions.
