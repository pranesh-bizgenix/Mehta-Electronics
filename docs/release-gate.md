# ControlDesk release gate — Master Prompt v2

Updated 6 November 2026. **Not ready for a supervised pilot or production yet.**
Implementation and acceptance gates remain incomplete. This working artifact is
not a certification; detailed evidence lives in `prompt-pack-completion-audit.md`.

## Done with bounded evidence

- Last completed full checkpoint (decision register and production safeguards):
  320 passed, zero failed/skipped, clean initial/final whole-database residue scans.
  Lint, explicit web typecheck and production build passed.
- Schema inventory at migration 0050: 204 relations, 2,870 columns, 43 documented
  exceptions, zero unresolved findings. Read-only preflight: 29 checks, zero findings.
- Reviewed price imports/manual entry, configured net price levels, retained
  contract binding, stock evidence/log/daily analysis, and independently reviewed
  price retirement have specific source and rollback tests. These are bounded
  feature checkpoints, not proof that every client workflow is complete.

## Part A and Part D readiness

- Automation contract/manifest and initial existing-metadata compatibility freeze
  are implemented and focused-tested. Owner service credentials and switch-state reads are implemented;
  remaining machine endpoints, templates, timeline, response snapshots and the full mock client remain partial.
- Owner decision register, versioned confirmation/rejection/clear, CSV review/import/
  export, printable sheet and dashboard are implemented and regression-tested.
  Existing rules, quotations, orders and purchasing require bound confirmation.
  Historical values remain unconfirmed candidates. No value is confirmed by the agent.
  Retained-record Tally mapping drafts and ordered quotation approval stages are
  implemented and included in the current integrated verification. Mapping approval
  still requires a different active Owner and named Tally expert; no category is enabled.
- Proposed values from the new prompt are evidence candidates only. Credit tier
  labels remain empty unless the specified F7 source is actually available.
- Named LLD and Notion-export paths remain unavailable. The supplied 70-page client
  plan and process/architecture diagrams were reviewed and are retained as evidence;
  complete document-specific and runtime acceptance remains outstanding.

## Awaiting confirmation — workflow groups

The final register must enumerate every key and live status. Current unresolved
groups include pricing/cost basis/discount/approval, customer thresholds/assignment,
credit/exemptions/payment authorisation, warranty/complaint/SLA rules, reminder
intervals and limits, KPI/incentives/audit retention, invoice/statutory authority,
Tally mappings/direction/conflict decisions, device/Admin identity and automation
confidence/mailbox/shadow/bank-report policies. Empty and proposed values block
dependent workflows; document examples are not confirmation.

## Needs a human

- Owner confirms decision-register entries and actual staff/reviewer coverage.
- Named Tally expert reviews draft mappings; authorised operator installs connector
  and performs live verification separately. This v2 task never contacts live Tally.
- Confirm hosting/HTTPS/secrets, MFA enforcement and recovery.
- Run real-staff/browser/client-document acceptance and review accessibility.
- Authorise the live-database load-test window before any such run.
- Authorise and perform a backup restore drill consistent with the sole-database rule.
- Complete a real integration acceptance round-trip with the automation engineer.

## Known risks

- Stages in v2 remain incomplete; existing generic screens/tables do not prove their
  full workflows. Stock request-to-order/quote/purchase integration is still partial.
- Historical item-profile defaults/provenance still need review without inventing
  missing values or silently rewriting real history.
- New machine routes must not inherit staff sessions, localhost review access,
  connector credentials or approval/send/settings privileges.
- Compatibility baseline currently covers metadata/route guards; actual new response
  and end-to-end automation contracts still need runtime tests.
- All automation and live Tally write switches remain OFF. No load-test approval or
  connector installation is implied by this checklist.


Latest completed checkpoint (7 November 2026): full tests **353/0/0** and both
whole-database residue scans PASS; syntax lint, web typecheck, 40-route production
build and five built-browser decision checks PASS. Schema audit at migration 0055:
207 tables, 2,915 columns, 43 documented exceptions and zero open findings;
schema and workflow preflights report zero findings. This includes the decision
register, mapping review/dry-run, staged quotation approvals, bounded large-payload
download, secure Owner startup, and company/source-bound dispatch stock consumption.
The remaining CRM stages and human/live release gates below are incomplete. No real
credential, business decision, write category, connector installation or Tally write
was provisioned or enabled.
