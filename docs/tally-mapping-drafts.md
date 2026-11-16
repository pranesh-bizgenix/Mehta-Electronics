# Retained Tally mapping drafts

This review flow operates inside the existing ControlDesk listener and the sole permitted database. It reads retained company records; it does not contact Tally, enable a write category or create an outbox job.

## Review flow

1. Open `/tally/write`, select the actual source company and category, then use **Generate and review a mapping draft**.
2. Inspect actual retained voucher-type names, optional flags, date formats, reference/narration presence and imported master identities. Counts are labelled separately by source entity. A voucher may exist in both vouchers and quotations, so these are not an automatically deduplicated company total.
3. Source inspection is bounded to 150 records per entity. The screen reports the full retained count, inspected count and truncation explicitly. Bodies larger than 64 KiB are omitted from field inspection and labelled, while their immutable identities and hashes remain evidence. One SQL snapshot supplies the company, counts, bounded records and receipts. It never describes a sample as complete source coverage.
4. Review the candidate field paths and stable source keys with the Tally expert. Enter the agreed mapping. No numbering authority, tax interpretation, posting signs, idempotency field, read-back method or business value is chosen automatically. An empty object may be retained as an incomplete draft.
5. Save a DRAFT version with reason. Its company identity, immutable record IDs, payload/session IDs, content hashes, counts and latest receipt evidence are retained in `tw_mapping_evidence`. Every explicitly selected voucher/group/godown/ledger/unit/item/party source is additionally bound to its current immutable record/hash, even outside the bounded inspection sample. Missing or unstable selected sources block promotion. Review batches support up to 500 explicit unique source bindings and 512 KiB retained evidence. No real source value belongs in committed fixtures or logs.
6. Choose an independently approved, locked CRM document and request the mapping-only XML preview. It accepts DRAFT or approved mappings while all write switches are OFF. Missing mapping requirements are listed and XML stays absent. A complete mapping uses the same exact CREATE builder and read-back validation as the guarded write infrastructure.
7. A different active Owner reviews the exact retained DRAFT and records the named Tally expert and review reference. Promotion creates a new approved child version; the draft remains unchanged. Source drift or edited configuration requires a fresh draft and review.

Approval does not select the mapping for a category, enable a category, turn on the master switch, claim a job, send XML, or create a Tally record. All original live-write and business-approval gates remain required.

## Endpoints

All use the existing session and CSRF protection. Owner plus `tally.write.manage` is required; no role receives new permissions.

| Endpoint | Purpose |
|---|---|
| `GET /api/tally-write/mapping-candidates?companyId=&category=` | Retained-company candidates, counts, source evidence and fingerprint |
| `POST /api/tally-write/mapping-drafts` | Save explicit mapping configuration as an evidenced DRAFT |
| `GET /api/tally-write/mappings/:id/evidence?companyId=` | Inspect source and expert review provenance |
| `POST /api/tally-write/mappings/:id/review-preview` | Mapping-only XML or named blockers; never queue or send |
| `POST /api/tally-write/mappings/:id/review-approve` | Independent Owner/expert promotion into a new approved child |

Draft and approval mutations require an explicit request UUID, reason, selected company/category and reviewed source fingerprint. Repeating the exact request returns the earlier version; reuse for another action is refused. The earlier manual mapping endpoint still saves DRAFT versions, but direct approval without the reviewed parent, expert and independent Owner is refused.

## Integrity and release limits

Migration `0052_tally_mapping_review_evidence.sql` adds an independent append-only evidence table and guards. It changes no retained source records, policy values or write switches. Approved versions require expert evidence; existing mapping versions remain immutable. Historical approved versions without the newer review evidence must be reviewed again before new activation or execution.

The new mapping-only preview is separate from the earlier outbox preview. The earlier endpoint keeps its switch and approved-mapping gates. The new endpoint cannot enable that producer, and its returned XML is a review artifact only.

Read-side source files, connector collection/scheduling/token handling and DPAPI files remain protected by the existing hash regression. Tests use synthetic source identities and approved CRM fixtures inside rolled-back transactions. No live Tally version, native import behaviour, expert sign-off, browser acceptance or production deployment is certified by these tests.

## Verification

The pure candidate tests are `test/tally-mapping-candidates.test.js`. Rollback/HTTP/replay/approval/evidence tests are `test/tally-mapping-review.test.js`; `test/tally-write-sources.test.js` also exercises a retained DRAFT XML preview using actual canonical CRM rows and source identities with all switches OFF. Existing write service/transport/HTTP/baseline suites remain part of the final regression. The implementation log records completed terminal results; this document does not substitute planned commands for verification.
