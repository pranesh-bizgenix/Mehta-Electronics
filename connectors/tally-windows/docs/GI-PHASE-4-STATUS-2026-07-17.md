# GI Phase 4 — Guided Pilot Release Control

Date: 17 July 2026  
Branch: `codex/gi-launch-candidate`

## Outcome

Phase 4 turns the launch candidate into an operable founder-led pilot:

- a public, non-sensitive health endpoint verifies application and database;
- GitHub checks production every 15 minutes;
- tenant backup artifacts can be restored into isolated temporary tables and
  verified without touching the live rows;
- Control Center exposes deployment, identity, evidence, delivery, recovery,
  secrets and scope-freeze gates;
- one exact workshop takes a client from Tally identity to signed controls,
  approved action and outcome evidence;
- unsupported product expansion is frozen during the proof period.

## Live Tally acceptance

On 17 July 2026, `localhost:9000` was reachable and GI discovered the exact
open company `Ghanshyam Masala and Foods Beverages LLP` with GUID ending
`25b063ab`.

The current-period sync transported data but was quarantined. Receivables
differed from debtor ledgers by 54.96%, payables differed from creditor ledgers
by 29.51%, and Trial Balance/Stock controls were incomplete. The active QA
company was not replaced. This proves transport and fail-closed publication;
it does not prove the Ghanshyam books reconciled.

## External acceptance still required

Code cannot create client consent, provider credentials or accountant sign-off.
Before the first external action:

1. configure one production email or WhatsApp account;
2. send a low-risk owner-approved test and confirm its audit event;
3. conduct the workshop with each design partner's accountant;
4. keep reconciliation green for two consecutive weeks.

GI remains management-use analysis, not an audit opinion.
