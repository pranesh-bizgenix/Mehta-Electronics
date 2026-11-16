# Owner decision register

## Scope

The CRM now has an Owner-only `/decisions` screen and versioned `/api/v1/decisions` endpoints. This is the decision-management increment of Part D; it does not complete the invoice adapter, Tally mapping generator, credit/KPI engines or later CRM stages.

The catalog contains 46 existing and additional questions. Definitions provide validation shapes and evidenced suggestions; they do not seed live policy values. Historical rule/policy values are retained as unconfirmed candidates. No value is automatically confirmed on application startup or migration.

## Lifecycle

- `EMPTY`: no usable answer.
- `PROPOSED`: an unconfirmed suggestion; never usable. Source suggestions are displayed separately from stored answers.
- `ENTERED`: an answer awaiting Owner confirmation. A CSV import always produces this state, even if its status column says CONFIRMED.
- `CONFIRMED`: Owner reviewed the answer with a reason, and any existing canonical rule or quotation policy still matches its saved revision and hash.
- `REJECTED`: retained rejected candidate, unusable until explicitly re-entered and reviewed.

Only a real active Owner with `rules.manage` can access or mutate the register. Mutable grants alone cannot make another role an Owner. Direct Owner input has an explicit confirm-on-save choice, reflecting the user's approved exception; importing is always a separate review step. Business transactions retain their independent maker-checker rules.

## Existing screens and workflows

Existing Rules writes append the original rule history and a bound Owner confirmation in the same transaction. Clearing appends an empty decision. Quotation Policy and Letterhead saves bind the margin decision inside the existing quotation transaction. These adapters do not confirm old values merely because they exist.

`RuleService.get/require`, shared `workflowRule`, and the order credit-policy reader now require a matching confirmed decision. Unconfirmed candidates cannot flow through the old raw rule reader. Quotation creation/progression, generated document approval, sales-order verification and supplier-PO progression also check margin confirmation. The quotation policy API exposes a boolean confirmation state without exposing margin/cost to Sales, and the editor explains the confirmation block.

Importing or rejecting a candidate leaves the retained canonical rule unchanged but blocks its operational use. Explicit Clear appends a canonical clear for generic rules. Clearing margin retains the full quotation policy for review; its operational gate blocks until Owner confirms a current policy again. Changing canonical source versions invalidates old binding. A detected source change cannot be confirmed blindly using the old register version; Owner must review/re-enter it.

Every successful command and audit commits together. Request UUIDs bind the Owner, operation and canonical payload hash. Exact retries replay; a changed payload with the same key refuses. Expected versions and sorted advisory locks protect stale and bulk writes; a later bulk failure rolls the whole command back. This is tested with rollback transactions, not proof of independently contending production sessions.

## API

All routes use existing session, CSRF-on-write, MFA and permission handling. No service credential or connector principal can edit decisions.

| Method | Relative path | Purpose |
|---|---|---|
| GET | `/api/v1/decisions` | Current questions, status, evidence, blocked workflows and summary |
| GET | `/api/v1/decisions/sheet` | Download the current CSV with versions |
| GET | `/api/v1/decisions/:key/history` | Retained versions and reasons |
| POST | `/api/v1/decisions/:key/enter` | Stage or explicitly confirm direct Owner input |
| POST | `/api/v1/decisions/:key/decide` | Confirm, reject or clear a reviewed answer |
| POST | `/api/v1/decisions/bulk-decide` | Atomic selected-key review |
| POST | `/api/v1/decisions/preview-import` | Parse/validate a CSV and show a no-write diff |
| POST | `/api/v1/decisions/import` | Revalidate the preview and stage ENTERED answers |

Mutations require a reason, requestKey and current expectedVersion, except import which carries the preview fingerprint and per-row exported versions. Stable errors include `RULE_NOT_CONFIGURED`, `DECISION_VERSION_CHANGED`, `DECISION_SOURCE_CHANGED`, `DECISION_EXTERNAL_POLICY_REQUIRED`, `DECISION_REJECTED` and `IDEMPOTENCY_KEY_REUSED`.

## Files, bounds and evidence

- `docs/prem-decision-sheet.md` and `.csv` are discussion templates, not live confirmation exports. The static CSV has blank answers and versions; export a current sheet in the application before importing.
- CSV input is limited to 256 KiB and 200 rows, with unique known headers/keys, strict literal JSON answers, exact decimal strings, stale-version checks and spreadsheet-formula protection on export.
- Structured values have depth/node/UTF-8 byte bounds and reject reserved prototype keys. No text is executed.
- New decision commands accept reasons up to 1,000 characters. The trusted adapter for existing quotation-policy saves preserves their existing 3-to-2,000-character limit and internal whitespace, so adding the register does not narrow a previously valid policy request. Reasons and the policy, decision history and audit commit together or all roll back.
- `decision_register` itself is immutable version history; `decision_register_requests` holds immutable replay receipts. Actual Owner, transaction reason, contiguous versions and confirmation actor are checked on insert. Updates, deletes and truncate are denied.
- Migration 0049 creates the isolated tables without seeds. Migration 0050 corrects that new function to match the existing users.status lifecycle; the applied 0049 checksum is retained.
- Migration 0051 expands only the new decision-history reason constraint to preserve the existing quotation-policy contract. It does not widen the new decision API limit or seed values. The focused compatibility regression includes a long multiline reason and a decision-audit failure; recorded command results remain in the implementation log.
- Verified backups: `mehta_electronics_local-2026-11-06T10-23-23-060Z-af416add.dump` and `mehta_electronics_local-2026-11-06T10-28-51-411Z-d67ae069.dump` under git-ignored backups. Existing migration runner used; no second database.

## Security increment

Production configuration now refuses `LOCAL_REVIEW_ACCESS=true` before opening the database. Local review also refuses production independently when a caller constructs a configuration directly. Development loopback review remains available. The task does not modify `.env`; deployment must explicitly use normal authentication.

Both audit-list aliases now enforce an Owner ceiling in addition to the existing audit permission. Permission definitions/grants remain unchanged. MFA enrollment/recovery and all send/Tally write gates remain in place.

## Verification and limits

Focused tests cover every catalog key blocking without confirmation, exact values/CSV bounds, lifecycle, replay/conflicts, source drift, import preservation, atomic audit/bulk rollback, sessions/CSRF/roles, margin withdrawal through existing workflows, production-local-review refusal and both audit aliases. New frontend pure tests cover input parsing, safe links and typed requests. Record final integrated counts in the implementation log after completion; initial verification caught the users-column mismatch and prompted 0050.

Rendered browser/device/print acceptance, independently concurrent sessions, target hosting and real staff/business-policy confirmation remain unverified. No listener was started, no automation/Tally write was enabled, no real policy/credential/user was seeded and no commit was made by this increment. Current-live register counts must be read from the actual screen; none are invented here.
