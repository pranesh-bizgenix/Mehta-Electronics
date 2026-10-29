# Automation data model

**Status:** Proposed persistence model. The meeting confirms approval-before-send and conservative handling of missing data. Full email/provider behavior, workflow rules, and service-level timing remain pending.

## Confirmed behavior boundary

- An automated customer response generated from CRM records is a draft until an authorized employee approves it.
- If the required CRM context is absent or ambiguous, automation asks for the missing information rather than sending an answer as fact.
- The discussed automation scope explicitly excludes bank-email handling.
- Existing CRM APIs support some outbound quotation email, but the generic inquiry/order/invoice/warranty email automations discussed in the meeting are not thereby implemented.

## Proposed normalized entities

| Entity | Purpose | Key integrity requirements |
|---|---|---|
| `email_accounts` | Authorized mailbox/provider configuration metadata | Store secret references only; access scopes are explicit and revocable. |
| `email_threads` | Provider thread identity linked to CRM context | Provider/thread identity unique within account; message history retained. |
| `email_messages` | Received/sent message metadata and safe content reference | Provider message ID unique within account; retain direction and timestamps. |
| `workflow_definitions` | Named trigger and owner | Stable internal key; activation is explicit. |
| `workflow_versions` | Immutable versioned conditions/templates/config | Unique `(definition_id, version)`; execution pins exact version. |
| `workflow_executions` | One trigger instance with input snapshot/hash, status, retry count, idempotency key | Unique idempotency scope prevents duplicate responses. |
| `workflow_steps` | Durable step outcomes, timing, sanitized error, retry metadata | Append-only attempt history; never hide failures behind success defaults. |
| `approval_requests` | Human approval for one exact message/action payload and record version | Payload fingerprint/version must still match at send time. |
| `approval_decisions` | Approve/reject/return action, actor, reason, timestamp | Append-only; requestor cannot approve own action when policy requires segregation. |
| `email_drafts` | Recipient, template/context snapshot, safe attachment references, approval state | No sendable state without current approval; edits invalidate approval. |
| `email_send_attempts` | Provider result, message ID, attempt, idempotency and uncertain outcome | Retry must reconcile provider state; never treat timeout as definite failure/success. |
| `reminders` | Assigned CRM follow-up and due time | SLA/time interval and escalation rules need approval. |
| `notifications` | Delivery/in-app state for user reminders | Delivery evidence and retry metadata retained. |

Use foreign keys to the concrete supported CRM entity types, or separate typed linking tables. A generic `entity_type + entity_id` pair without FK enforcement is not sufficient for audit-critical links.

## Draft-to-send lifecycle

`TRIGGERED → CONTEXT_CHECKED → DRAFTED → PENDING_APPROVAL → APPROVED → SENDING → SENT`

Alternative terminal/error states: `NEEDS_INFORMATION`, `REJECTED`, `CANCELLED`, `FAILED_RETRYABLE`, `OUTCOME_UNKNOWN`. Exact naming is proposed, not an API contract.

Required sequence:

1. Resolve customer and business record from authenticated/provider identity using an explicit mapping.
2. Evaluate versioned workflow conditions and required data; no response if context is missing or ambiguous.
3. Create an immutable context snapshot and draft; separate internal pricing fields from the customer-facing payload.
4. Request approval for exact recipients, body, attachments, linked record versions, and template version.
5. At send, verify approval is current and content fingerprint unchanged.
6. Use provider idempotency/reconciliation; persist response and outcome. An unknown provider result is visible and requires reconciliation.
7. Store a sanitized audit event and retain the full approved draft history under access control.

## Pending workflow definitions

Candidate workflows from the meeting include inquiry/quotation, customer PO intake, pending-order/partial-fulfilment replies, invoice/transport details, warranty/customer support, and salesperson reminders/KPIs. Their triggers, authorized customer identities, templates, eligible attachment types, timing thresholds, and escalation policies require samples and acceptance tests. Bank-email processing is excluded from the discussed scope.
