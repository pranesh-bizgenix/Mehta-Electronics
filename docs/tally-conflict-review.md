# Order sync evidence and conflict review (P18–P19)

## Order status

Migration `0037_tally_order_evidence_links.sql` associates existing sync job items, conflicts and reconciliations with a CRM sales order using explicit foreign keys. No association is seeded or guessed from a customer/order name or voucher number. Orders list/detail read these stored associations. A successful job also needs exactly one stable source identity in the same company before showing **In Tally**. Open conflicts, stored reconciliation mismatches and failed attempts are distinct states. Last source import/attempt and an allowed error projection are shown; other roles do not receive financial error details.

**Not yet synced** means no verified order-specific successful source match; its note explicitly states that actual presence in Tally is unknown. Existing independent Tally orders are not silently attached to CRM orders. Tally posting remains disabled and requires Prem's separate mapping/direction decisions.

## Review

Open `/tally/conflicts` from navigation or a CRM order conflict link. Every endpoint requires session/permission and exactly one imported company. The comparison action accepts 1–100 explicitly selected linked customers, vendors or items. Source GUID/Master ID must be unambiguous. Comparison never links CRM by name, copies all ledgers, or changes business values.

The implementation stores evidence in the existing `tally_conflicts` and `tally_reconciliations` tables. Customer/vendor name and GSTIN, and item HSN/UOM, use the established linked-master fields. Other categories remain inspectable by financial roles but cannot be resolved without their confirmed mappings. Historical evidence is separate from current linked values. Missing/incomplete latest master collections block use of an older retained record as verified current evidence.

Owner sets `tally.conflict_winners` in `/rules`; it starts empty. Each category explicitly chooses `TALLY` or `CRM`. Missing category policy blocks resolution. A reviewer needs sync permission and the category's CRM update permission and must be different from the detector. Policy version and current source/CRM/link fingerprint must match the reviewed evidence. Source cache, links and CRM row are locked during resolution. Accepting Tally changes only reviewed CRM fields through existing validation/audit paths; retaining CRM records a reason and never writes back to Tally. Missing source fields cannot clear CRM values.

Re-comparison explicitly supersedes obsolete comparison evidence with an audit event; it does not approve a business value or silently resolve the new differences. No automatic resolution or hard delete is implemented.

## Recovery

Migration `0038_tally_read_recovery.sql` adds audited read requests and upload associations. Recovery queues a refresh of company collections containing the requested record through the existing authenticated connector, then normal import/indexing. It does not directly access Tally from the server, use another listener, or claim that a requested record exists. Repeated pending requests for one conflict are deduplicated.

The prepared connector 1.2.0 receives pending IDs in its existing heartbeat. Only IDs known before collection starts travel with that durable package. The app rejects foreign connector/company requests. A request stays pending during upload; only successful indexing with the requested dataset delivered marks it indexed. Missing required evidence, incomplete indexing and finalize errors are failures. An indexed collection does not automatically resolve its conflict or prove an absent source record was deleted. Older retained records remain history.

The prepared package was rebuilt and its 40-file manifest rehashed/validated. No connector was installed or restarted. Requests on the actual machine require the later reviewed connector update and real heartbeat/delivery acceptance. A permanently incomplete queued package can require operator recovery before a subsequent fresh collection; retries do not fabricate success.

Known imported company GUIDs now reject missing/different GUIDs on upload start and during indexing. An initially unknown GUID may be recorded from authenticated source evidence with audit; a known identity is never replaced by matching only the company name.

## Verification

Focused real-handler rollback tests cover company/role/CSRF denials, unset policy, stable-link comparison, duplicate detection, independent approval, policy version, stale evidence, audited CRM-only resolution, superseded comparisons, request deduplication, heartbeat delivery, wrong-profile rejection, pending versus indexed, missing requested dataset failure, retained-history blocking and company GUID mismatch. Existing order/rule regressions and pure connector verification also ran. See the implementation log for final command counts.

One backup attempt failed for lack of disk space; its partial archive was removed by the existing backup helper. A verified generated Next build cache was cleared, leaving source files and all completed backups intact. A subsequent guarded backup succeeded and the existing migration runner applied `0038`. No alternate database or schema was used.

Unverified: browser interaction, actual Windows service delivery/recovery, real source compatibility, independently concurrent sessions and production queue crash behaviour. Prem-dependent mappings, write directions, sales order posting and invoice ownership remain blocked (P20–P23); no defaults were adopted.
