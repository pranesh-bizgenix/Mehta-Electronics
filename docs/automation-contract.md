# Automation contract v1

**Status: design contract; endpoints marked PLANNED are not yet operational.**
Source: the user's 6 November 2026 Master Prompt v2, Part A. This contract is
inside the existing ControlDesk application and uses relative `/api/...` paths.
The separate automation engineer calls ControlDesk. ControlDesk does not call
an automation service, ingest a mailbox, classify with an LLM, or send messages.

The machine-readable OpenAPI 3.0.3 contract is `automation-openapi.yaml` (JSON
syntax, which is valid YAML 1.2). Its source is
`src/modules/automation-api/contract.js`; tests compare the generated document
with the source. API version is `1.0.0`, reported by the eventual runtime in
`X-ControlDesk-API-Version`. The document alone does not add HTTP handlers.

## Authentication boundary (A2 implemented; operational acceptance pending)

Use a separate bearer credential with hashed token material, rotation,
revocation, expiry, rate limits and an optional Owner-configured IP allowlist.
Bind it to explicit allowed company IDs and a real operational owner/backup.
Do not reuse staff sessions, connector tokens or their refresh credentials.
Never expose a reusable token through an ordinary read response or log it.
Credential provisioning and audit are staff/Owner operations, not service scopes.

Only these service scopes exist:

| Scope | Allows | Never allows |
|---|---|---|
| automation.read | Allowlisted, company-scoped operational reads | Cost, margin, list price, discount, secrets, approval or settings edits |
| automation.write.drafts | A draft/queue request through all CRM gates | Approval, sending, direct state/price/stock changes |
| automation.write.intake | Untrusted classified metadata and internal review/task/draft enquiry requests | Mailbox access, classification/extraction execution, Tally writes or business master edits |

An `automation.read` **staff permission already exists**. The identical scope
label does not make its staff session and a service credential interchangeable.
Reject service tokens on every staff-only/connector route, including existing
`GET /api/v1/automation` and `PATCH /api/v1/automation/:key`. Never turn a token's
scopes into a staff role or fall back to localhost review access.

## Endpoint and response conventions

See the endpoint table below and OpenAPI for request fields. Every request has
exactly one company ID, validated against both the database and credential scope.
GETs use `companyId` in the query; POSTs use it in the body. Reads are paginated,
bounded at 100 rows and return dataset freshness. Missing data stays null.
Freshness must include source timestamp, last successful sync, age and status;
an observation/import time must not masquerade as the source timestamp.

The versioned envelope contains `data` (an array, including single-result
responses), `companyId`, `freshness`, and `pagination` with page, pageSize and
hasMore. A request is never allowed to mix company evidence. Stable source IDs
and company identity govern links, never a name-only match.

Customer matches are candidates, never automatic links. Return evidence methods
(GSTIN/email/name), and a nullable confidence: do not invent a calibrated score
when none exists. Name similarity alone cannot identify a business record.
Part lookup uses actual canonical item and approved mappings. Prices use the
same customer contract/level resolution as quotations; availability uses the
same stock-evidence evaluator as `/items/stock-checks`. Return only net prices
and operational quantities, not list price, discount, cost or margin. Unknown
or unconfirmed rules return an explicit block, never an inferred business value.

Invoice, dispatch and ticket reads validate the requested customer's actual
relationships. A document handle is opaque and company/customer scoped; it is
not a filesystem path or public/external URL. Document access must recheck the
credential and relationship at download time. No arbitrary URL fetch is allowed.

## Untrusted writes and replay

Only the six POST operations in the catalog exist (including read-only price
preview). Five write operations require `Idempotency-Key` (8–200 characters)
and a reason. Replay identity includes credential, API version, method/path,
company and canonical payload hash. Exact replay returns the retained result;
changed reuse returns 409. Claim, queue mutation, audit and saved response must
be atomic. Revocation and scope/company checks still apply to a replay.

Intake is **metadata supplied by the other engineer**, not a mailbox integration:
provider/message/thread IDs, sender, declared intents and confidence, extracted
identifier candidates, opaque attachment references and review reason. All are
untrusted. Unknown fields are rejected; text stays literal, bounded and safely
rendered; no instruction in body, subject or attachment is executed. Validate
every referenced record on the server. Do not accept an external attachment URL,
an approval flag, a role, a confirmed setting, an invoice authority or an arbitrary
target table from the caller.

Missing or low confidence, unmatched records, unknown intents or incomplete
ownership route to human review. Confidence threshold, mailbox-check interval,
due-time policies and routing decisions come from the decision register. Missing
settings cannot produce an invented score, staff owner or due date: the receipt
reports unresolved owner/backup/due fields and named blockers, and dispatch to an
operational queue remains blocked until eligible routing is confirmed.

Switches remain OFF. Intake/review metadata can be retained without producing a
customer-facing draft. Empty shadow-mode configuration is safe review-only;
explicit shadow mode also creates no customer-facing draft. A draft request
blocked by switches, shadow mode, confidence, customer/category eligibility,
registered recipient, approved active template or missing placeholders becomes
review-required and must not bypass a gate. Enquiries are draft-only. Tasks and
review items are internal, not messages or business approvals.

## Send protection and templates (existing gates retained; extensions pending)

No automation endpoint approves or sends. Service credentials cannot invoke staff
send routes. Existing send gates stay intact. Eventual CRM integration must check
workflow switch, customer/category enablement, registered recipients, approved
active template version, filled placeholders, independent approver, unchanged
body/attachment/recipient approval fingerprint and duplicate outbound identity.
Keep template versions and approvals retained; changing a version invalidates an
old approval. Bank-alert senders are blocked except a separately confirmed bank
report rule that can route only to Accounts intake. Empty rule means no exception.
This task does not implement sending, SMTP, email/WhatsApp intake, AI or Make.

## Errors, limits and observability

Use existing safe `{ error, code, details?, correlationId? }` errors, never stack
traces, credentials or source documents. 401 means credential failure; 403 means
scope/company refusal; 409 means changed replay or blocked workflow; 413 means
size limit; 422 means field validation; 429 means rate limit (Retry-After); 503
means temporarily unavailable. Operational rate/body/attachment bounds, raw-data
retention and redacted audit evidence must be enforced by runtime tests before
release; this design document is not evidence that enforcement is implemented.

## Compatibility freeze (A9, partial)

`test/fixtures/automation/compatibility-v1.json` captures actual metadata from
`mehta_electronics_local`: 20 existing tables, 234 columns, their constraints
(including status domains), indexes/triggers, 80 permission definitions and
25 existing staff endpoint guards. No business rows, tokens or document values
are included. The generated inventory below lists those members explicitly.

The rollback test rejects removal/change of captured members and allows new
members. Future migrations and routes must be additive. Do not silently regenerate
this baseline to hide an incompatible change. New API/data structures get an
addendum and tests; old response fields/types and meanings remain supported.
Runtime response snapshots and a complete mock automation round-trip remain A10
work; the current metadata tests do not claim that coverage.

## Requirements gaps and risks

- `docs/ControlDesk-LLD-Business-Logic.md`, `docs/notion/`, and `docs/diagrams/`
  are absent. Exact alignment with the Notion “Email automation orchestration”
  and diagram field names remains unverified. Available evidence is the exported
  requirements register plus the user's latest prompt. Do not call this mismatch-free.
- Runtime service auth/routes, template registry, timeline, response snapshots,
  decision register and external engineer acceptance are not delivered by A1.
- Existing staff idempotency is keyed to a staff user; machine credentials need
  their own namespace and must not impersonate staff to reuse it.
- Proposed decisions are not usable. Keep Tally write switches OFF, never contact
  live Tally under this v2 task, and leave Owner/expert/live acceptance separate.

## Changelog

- **1.0.0 design, 6 November 2026:** initial endpoint/scope/envelope design and
  metadata compatibility baseline. All new machine operations are PLANNED.

## Endpoint catalog (implementation status in OpenAPI)

| Method | Path | Scope |
|---|---|---|
| GET | /api/v1/automation/customers/match | automation.read |
| GET | /api/v1/automation/items | automation.read |
| POST | /api/v1/automation/price-availability/preview | automation.read |
| GET | /api/v1/automation/orders/{id} | automation.read |
| GET | /api/v1/automation/invoices | automation.read |
| GET | /api/v1/automation/documents/{handle} | automation.read |
| GET | /api/v1/automation/dispatches | automation.read |
| GET | /api/v1/automation/tickets/{id} | automation.read |
| GET | /api/v1/automation/templates | automation.read |
| GET | /api/v1/automation/switches | automation.read |
| GET | /api/v1/automation/settings | automation.read |
| POST | /api/v1/automation/intake | automation.write.intake |
| POST | /api/v1/automation/drafts | automation.write.drafts |
| POST | /api/v1/automation/review-items | automation.write.intake |
| POST | /api/v1/automation/tasks | automation.write.intake |
| POST | /api/v1/automation/enquiries | automation.write.intake |

## Frozen existing metadata inventory

### Tables and columns

| Table | Existing columns |
|---|---|
| approval_decisions | id, approval_request_id, decision, decided_by, reason, payload_fingerprint, decided_at, decision_metadata |
| approval_requests | id, request_type, requested_by, payload_fingerprint, record_version, payload_snapshot, status, expires_at, created_at |
| automation_switch_events | id, workflow_key, field, old_value, new_value, reason, changed_by, changed_at |
| automation_switches | workflow_key, enabled, rollout_stage, updated_by, updated_at |
| business_rule_values | id, rule_key, version, value, is_cleared, reason, created_by, created_at |
| customer_message_checklist | customer_id, category, ticked, updated_by, updated_at, reason |
| email_accounts | id, provider, mailbox_address, provider_account_id, secret_reference, granted_scopes, status, connected_at, revoked_at, created_at, updated_at, created_by |
| email_draft_documents | email_draft_id, source_document_id, created_at, created_by |
| email_drafts | id, workflow_execution_id, customer_id, enquiry_id, quotation_id, sales_order_id, recipient_addresses, cc_addresses, subject, body_reference, content_fingerprint, linked_record_version, approval_request_id, status, created_at, updated_at, created_by, updated_by, context_state, workflow_key, message_category, body_text, gate_result |
| email_messages | id, email_account_id, thread_id, provider_message_id, direction, sender_address, recipient_addresses, cc_addresses, parsed_headers, safe_body_reference, received_at, sent_at, status, created_at |
| email_send_attempts | id, email_draft_id, approval_decision_id, attempt_number, idempotency_key, status, provider_message_id, provider_response, error_detail, started_at, completed_at |
| email_threads | id, email_account_id, provider_thread_id, customer_id, enquiry_id, quotation_id, sales_order_id, subject, status, first_message_at, last_message_at, created_at, updated_at, invoice_id |
| exception_cases | id, exception_type, entity_type, entity_id, summary, details, fingerprint, status, department, raised_by, record_creator_id, approval_request_id, decided_by, decided_at, decision_reason, backdate_to, created_at, updated_at |
| job_logs | id, job_name, run_at, finished_at, status, message, detail |
| manual_response_exceptions | id, customer_id, item_id, reason, status, created_by, created_at, archived_by, archived_at, archive_reason |
| notifications | id, user_id, reminder_id, channel, delivery_state, payload, idempotency_key, attempt_count, last_error, scheduled_at, delivered_at, created_at |
| task_events | id, task_id, event, old_value, new_value, reason, actor_user_id, created_at |
| tasks | id, title, description, status, source, department, owner_user_id, backup_user_id, due_at, parent_task_id, forwarded_to_task_id, entity_type, entity_id, next_reminder_at, reminder_count, completed_at, version, created_by, updated_by, created_at, updated_at, is_deleted, deleted_reason |
| work_item_events | id, work_item_id, event, from_user_id, to_user_id, detail, reason, actor_user_id, created_at |
| work_items | id, entity_type, entity_id, title, department, owner_user_id, backup_user_id, assignment_reason, status, started_at, due_at, sla_state, sla_rule_version, sla_timezone, escalation_level, escalated_to_user_id, last_escalated_at, escalation_blocked_reason, closed_at, created_by, updated_by, created_at, updated_at, is_deleted, deleted_reason |

### Existing enum/check domains

| Table | Constraint | Existing definition |
|---|---|---|
| approval_decisions | approval_decisions_decision_metadata_check | CHECK ((jsonb_typeof(decision_metadata) = 'object'::text)) |
| approval_decisions | approval_decisions_payload_fingerprint_check | CHECK ((payload_fingerprint ~ '^[0-9a-f]{64}$'::text)) |
| approval_requests | approval_requests_payload_fingerprint_check | CHECK ((payload_fingerprint ~ '^[0-9a-f]{64}$'::text)) |
| approval_requests | approval_requests_payload_snapshot_check | CHECK ((jsonb_typeof(payload_snapshot) = 'object'::text)) |
| approval_requests | s0_approval_requests_status_check | CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'WITHDRAWN'::text, 'EXPIRED'::text, 'CANCELLED'::text]))) |
| automation_switch_events | automation_switch_events_field_check | CHECK ((field = ANY (ARRAY['enabled'::text, 'rollout_stage'::text]))) |
| automation_switch_events | automation_switch_events_reason_check | CHECK ((length(TRIM(BOTH FROM reason)) >= 3)) |
| automation_switches | automation_switches_rollout_stage_check | CHECK ((rollout_stage = ANY (ARRAY['DRAFT_AND_APPROVAL'::text, 'SELECTIVE'::text]))) |
| business_rule_values | business_rule_values_check | CHECK ((is_cleared OR (value IS NOT NULL))) |
| business_rule_values | business_rule_values_reason_check | CHECK ((length(TRIM(BOTH FROM reason)) >= 3)) |
| business_rule_values | business_rule_values_rule_key_check | CHECK ((rule_key ~ '^[a-z][a-z0-9_.]+$'::text)) |
| business_rule_values | business_rule_values_version_check | CHECK ((version > 0)) |
| customer_message_checklist | customer_message_checklist_category_check | CHECK ((category ~ '^[a-z][a-z0-9_]+$'::text)) |
| customer_message_checklist | customer_message_checklist_reason_check | CHECK ((length(TRIM(BOTH FROM reason)) >= 3)) |
| email_accounts | email_accounts_granted_scopes_check | CHECK ((jsonb_typeof(granted_scopes) = 'array'::text)) |
| email_drafts | email_drafts_cc_addresses_check | CHECK ((jsonb_typeof(cc_addresses) = 'array'::text)) |
| email_drafts | email_drafts_content_fingerprint_check | CHECK ((content_fingerprint ~ '^[0-9a-f]{64}$'::text)) |
| email_drafts | email_drafts_context_state_check | CHECK ((context_state = ANY (ARRAY['UNVERIFIED'::text, 'READY'::text, 'NEEDS_INFORMATION'::text]))) |
| email_drafts | email_drafts_recipient_addresses_check | CHECK ((jsonb_typeof(recipient_addresses) = 'array'::text)) |
| email_messages | email_messages_cc_addresses_check | CHECK ((jsonb_typeof(cc_addresses) = 'array'::text)) |
| email_messages | email_messages_parsed_headers_check | CHECK ((jsonb_typeof(parsed_headers) = 'object'::text)) |
| email_messages | email_messages_recipient_addresses_check | CHECK ((jsonb_typeof(recipient_addresses) = 'array'::text)) |
| exception_cases | exception_cases_check | CHECK (((status = 'OPEN'::text) OR ((decided_by IS NOT NULL) AND (decided_at IS NOT NULL) AND (length(TRIM(BOTH FROM COALESCE(decision_reason, ''::text))) >= 3)))) |
| exception_cases | exception_cases_check1 | CHECK (((decided_by IS NULL) OR ((decided_by <> raised_by) AND (decided_by IS DISTINCT FROM record_creator_id)))) |
| exception_cases | exception_cases_department_check | CHECK ((department = ANY (ARRAY['SALES'::text, 'OPERATIONS'::text, 'ACCOUNTS'::text, 'CUSTOMER_SUPPORT'::text]))) |
| exception_cases | exception_cases_exception_type_check | CHECK ((exception_type ~ '^[A-Z][A-Z_]+$'::text)) |
| exception_cases | exception_cases_fingerprint_check | CHECK ((fingerprint ~ '^[0-9a-f]{64}$'::text)) |
| exception_cases | exception_cases_status_check | CHECK ((status = ANY (ARRAY['OPEN'::text, 'APPROVED'::text, 'REJECTED'::text, 'WITHDRAWN'::text]))) |
| job_logs | job_logs_status_check | CHECK ((status = ANY (ARRAY['RUNNING'::text, 'SUCCEEDED'::text, 'FAILED'::text, 'SKIPPED'::text]))) |
| manual_response_exceptions | manual_response_exceptions_check | CHECK (((customer_id IS NULL) <> (item_id IS NULL))) |
| manual_response_exceptions | manual_response_exceptions_reason_check | CHECK ((length(TRIM(BOTH FROM reason)) >= 3)) |
| manual_response_exceptions | manual_response_exceptions_status_check | CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'ARCHIVED'::text]))) |
| notifications | notifications_attempt_count_check | CHECK ((attempt_count >= 0)) |
| notifications | notifications_payload_check | CHECK ((jsonb_typeof(payload) = 'object'::text)) |
| notifications | s0_notifications_delivery_state_check | CHECK ((delivery_state = ANY (ARRAY['PENDING'::text, 'DELIVERED'::text, 'FAILED'::text, 'READ'::text]))) |
| tasks | tasks_check | CHECK (((NOT is_deleted) OR (length(TRIM(BOTH FROM COALESCE(deleted_reason, ''::text))) >= 3))) |
| tasks | tasks_check1 | CHECK (((status <> 'FORWARDED'::text) OR (forwarded_to_task_id IS NOT NULL))) |
| tasks | tasks_department_check | CHECK ((department = ANY (ARRAY['SALES'::text, 'OPERATIONS'::text, 'ACCOUNTS'::text, 'CUSTOMER_SUPPORT'::text]))) |
| tasks | tasks_source_check | CHECK ((source = ANY (ARRAY['MANUAL'::text, 'AUTO'::text]))) |
| tasks | tasks_status_check | CHECK ((status = ANY (ARRAY['OPEN'::text, 'IN_PROGRESS'::text, 'FORWARDED'::text, 'DONE'::text]))) |
| tasks | tasks_title_check | CHECK ((length(TRIM(BOTH FROM title)) > 0)) |
| work_items | work_items_check | CHECK (((backup_user_id IS NULL) OR (owner_user_id IS NULL) OR (backup_user_id <> owner_user_id))) |
| work_items | work_items_check1 | CHECK (((NOT is_deleted) OR (length(TRIM(BOTH FROM COALESCE(deleted_reason, ''::text))) >= 3))) |
| work_items | work_items_department_check | CHECK ((department = ANY (ARRAY['SALES'::text, 'OPERATIONS'::text, 'ACCOUNTS'::text, 'CUSTOMER_SUPPORT'::text]))) |
| work_items | work_items_entity_type_check | CHECK ((entity_type ~ '^[A-Z][A-Z_]+$'::text)) |
| work_items | work_items_escalation_level_check | CHECK (((escalation_level >= 0) AND (escalation_level <= 2))) |
| work_items | work_items_sla_state_check | CHECK ((sla_state = ANY (ARRAY['NOT_CONFIGURED'::text, 'RUNNING'::text, 'BREACHED'::text, 'MET'::text, 'STOPPED'::text]))) |
| work_items | work_items_status_check | CHECK ((status = ANY (ARRAY['OPEN'::text, 'IN_PROGRESS'::text, 'WAITING'::text, 'DONE'::text, 'CANCELLED'::text]))) |

### Existing permissions

| Key | Resource | Action | Owner only |
|---|---|---|---|
| access.manage | access | W | true |
| access.read | access | R | false |
| audit.read | audit | R | false |
| automation.disable | automation | W | false |
| automation.enable | automation | W | true |
| automation.read | automation | R | false |
| collections.approve | collections | A | false |
| collections.read | collections | R | false |
| collections.write | collections | W | false |
| contracts.approve | contracts | A | false |
| contracts.manage | contracts | W | false |
| customers.approve | customers | A | false |
| customers.controls | customers | W | true |
| customers.create | customers | W | false |
| customers.credit_exempt | customers | W | true |
| customers.do_not_quote | customers | W | false |
| customers.dues.read | customers | F | false |
| customers.duplicates | customers | R | false |
| customers.read | customers | R | false |
| customers.update | customers | W | false |
| dashboard.read | dashboard | R | false |
| enquiries.create | enquiries | W | false |
| enquiries.read | enquiries | R | false |
| enquiries.update | enquiries | W | false |
| exceptions.decide | exceptions | A | false |
| exceptions.raise | exceptions | W | false |
| exceptions.read | exceptions | R | false |
| items.create | items | W | false |
| items.list_price.read | items | F | false |
| items.read | items | R | false |
| items.update | items | W | false |
| logistics.assignment.manage | logistics | W | false |
| logistics.dispatch.manage | logistics | W | false |
| logistics.evidence.write | logistics | W | false |
| logistics.grn.manage | logistics | W | false |
| logistics.grn.post | logistics | A | false |
| logistics.grn.read | logistics | R | false |
| logistics.orders.assigned | logistics | R | false |
| logistics.orders.read | logistics | R | false |
| logistics.read | logistics | R | false |
| operations.approve | operations | A | true |
| operations.read | operations | R | false |
| operations.write | operations | W | false |
| orders.create | orders | W | false |
| orders.credit.review | orders | A | true |
| orders.dispatch | orders | W | false |
| orders.read | orders | R | false |
| orders.review | orders | A | false |
| orders.update | orders | W | false |
| outbound.approve | outbound | A | false |
| outbound.checklist.manage | outbound | W | true |
| outbound.read | outbound | R | false |
| purchasing.approve | purchasing | A | false |
| purchasing.read | purchasing | R | false |
| purchasing.write | purchasing | W | false |
| quotations.approve | quotations | A | false |
| quotations.cost.manage | quotations | W | true |
| quotations.cost.read | quotations | F | false |
| quotations.create | quotations | W | false |
| quotations.policy.manage | quotations | W | true |
| quotations.read | quotations | R | false |
| quotations.send | quotations | W | false |
| quotations.status | quotations | W | false |
| quotations.update | quotations | W | false |
| rules.manage | rules | W | true |
| rules.read | rules | R | false |
| tally.connector.manage | tally | W | true |
| tally.read | tally | R | false |
| tally.sync | tally | W | false |
| tally.write.approve | tally_write | A | false |
| tally.write.manage | tally_write | W | true |
| tally.write.read | tally_write | F | false |
| tasks.assign | tasks | A | false |
| tasks.read | tasks | R | false |
| tasks.write | tasks | W | false |
| users.create | users | W | true |
| users.read | users | R | false |
| users.update | users | W | true |
| work.read | work | R | false |
| work.reassign | work | W | false |

### Existing staff endpoints (never machine-token access)

| Method | Path | Staff permission |
|---|---|---|
| GET | /api/v1/automation | automation.read |
| GET | /api/v1/customers/:id/message-checklist | outbound.read |
| GET | /api/v1/exceptions | exceptions.read |
| GET | /api/v1/exceptions/:id | exceptions.read |
| GET | /api/v1/me/work | work.read |
| GET | /api/v1/messages/drafts | outbound.read |
| GET | /api/v1/messages/drafts/:id | outbound.read |
| GET | /api/v1/tasks | tasks.read |
| GET | /api/v1/tasks/:id | tasks.read |
| GET | /api/v1/work-items/:id | work.read |
| PATCH | /api/v1/automation/:key | automation.read |
| POST | /api/v1/approvals/:id/decide | exceptions.decide |
| POST | /api/v1/exceptions | exceptions.raise |
| POST | /api/v1/messages/drafts | outbound.read |
| POST | /api/v1/messages/drafts/:id/approve | outbound.approve |
| POST | /api/v1/messages/drafts/:id/reject | outbound.approve |
| POST | /api/v1/messages/send | outbound.approve |
| POST | /api/v1/tasks | tasks.write |
| POST | /api/v1/tasks/:id/archive | tasks.write |
| POST | /api/v1/tasks/:id/forward | tasks.write |
| POST | /api/v1/tasks/:id/status | tasks.write |
| POST | /api/v1/work-items/:id/reassign | work.reassign |
| POST | /api/v1/work-items/:id/status | work.read |
| PUT | /api/v1/customers/:id/message-checklist/:category | outbound.checklist.manage |
| PUT | /api/v1/messages/drafts/:id | outbound.read |


## Runtime delivery update - 6 November 2026

Owner credential management and the read-only switch-state operation are implemented; see automation-service-credentials.md. The other 15 machine operations remain PLANNED. The original metadata freeze is unchanged; credentials-addendum-v1.json protects three new tables/43 columns and five route guard entries. Runtime tests cover the first machine envelope/version and Owner lifecycle; complete A3-A10 acceptance remains partial. No service credential, user or business setting is seeded.
