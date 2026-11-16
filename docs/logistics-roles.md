# Logistics roles and access boundaries

Migration `0034_logistics_roles.sql` adds two system roles. Admin is not defined
or seeded; role creation/renaming to Admin is refused until its scope is defined.
The existing Owner, Manager, Executive and Accounts role rows, permission
definitions and grants are unchanged. The before/after comparison is retained in
`output/logistics-roles/before-matrix.json` and `after-matrix.json`.

## Proposed matrix implemented

| Capability | Logistics lead | Store staff |
| --- | --- | --- |
| Open `/logistics` | Yes | Yes |
| Read operational orders | All CRM workflow orders | Explicitly assigned orders only |
| Assign/revoke Store staff on an order | Yes | No |
| Read receiving POs and GRN review | Operational fields only | GRNs linked to assigned orders only; no general PO/review access |
| Create GRN / enter received, accepted and rejected quantities | Yes | No |
| Independently post GRN | Yes; existing maker/checker and exception gates | No |
| Dispatch / confirm delivery | Yes; existing approval, version and proof gates | No |
| Write received item codes and photos on open GRN | Yes | Only on assigned orders |
| Append observed dispatch item codes and photos | Yes | Only on assigned orders |
| Cost, margin, prices, totals, credit balances or Tally financial data | No | No |
| Approve commercial exceptions, sales orders, quotations or supplier POs | No | No |

The lead receives `logistics.read`, `logistics.orders.read`,
`logistics.grn.read`, `logistics.grn.manage`, `logistics.grn.post`,
`logistics.dispatch.manage`, `logistics.assignment.manage` and
`logistics.evidence.write`. Store staff receive `logistics.read`,
`logistics.orders.assigned` and `logistics.evidence.write`.

These roles have an operational permission ceiling in both RBAC providers and
the matrix service: even an attempted financial grant, wildcard or incorrect
database grant cannot expose other capabilities. Users & roles disables cells
outside that ceiling; the server also rejects escalation. Existing roles retain
their previous editing behavior and grants. No generic `purchasing.read` or
`orders.read` permission is granted to the new roles because those APIs include
commercial documents/amounts.

## How to use

1. Owner creates a user using the existing user API/form or changes an existing
   user's role in **Users & roles → People**. The role selector and matrix show
   the new roles. `OPERATIONS` remains an optional department label.
2. New logistics users land at **Logistics & store**. Lead selects an order and
   assigns a Store staff user with a reason. Store staff start with no orders;
   department, creator and other users' assignments do not imply access.
3. Lead receives an issued PO through the receiving list, enters quantities and
   any actual received item code, then records a GRN. Store staff can add photos
   and received item codes to that open GRN when it belongs to an assigned order.
4. A received-code update changes only `payload.lines[index].actualPartCode` and
   increments the GRN version. Prices, quantities, tax and totals remain untouched.
   A previous review becomes stale; part-code differences use the existing
   exception acknowledgement and independent-review checks. Photos and code
   observations remain in the immutable evidence history with audit metadata.
5. A different lead or existing authorised reviewer posts the GRN. Price/tax
   differences are shown to logistics as `COMMERCIAL_REVIEW_REQUIRED`; logistics
   cannot post those exceptions. An existing purchasing reviewer must resolve them.
6. Lead dispatches approved order quantities and confirms delivery only after
   retaining the existing delivery proof. Store staff can append observations
   during preparation or on an open shipment. These observations do not rewrite
   the original customer PO or count automatically as reviewed delivery proof.

The Users screen is `/users`, the logistics workspace is `/logistics`, and the
new endpoints use relative `/api/crm/logistics/...` routes. The existing router
performs session, CSRF and permission checks before every handler. Store staff
cannot use general purchasing, order-document, price or Tally APIs. Operational
DTOs whitelist allowed fields instead of returning raw snapshots/history.

## Retention and integrity

- Assignment changes have a reason, creator/updater and audit events. Revocation
  archives the assignment. Store reads/writes and photo downloads recheck access;
  writes recheck and lock the assignment in the same transaction.
- Evidence accepts only an item code and/or a PNG/JPEG photo (existing 10 MB
  upload limit), version, line reference and reason; dispatch may reference a
  belonging open shipment. Unknown fields are rejected. Photo bytes and hashes
  stay in the existing database, with no cloud storage or new service.
- Only existing record/line IDs can be referenced. GRN evidence is available to
  Store staff only when its supplier PO links to an assigned CRM order. Unlinked
  POs can still be received/reviewed by lead but cannot accept store evidence.
- Posted GRN, delivered/cancelled orders and delivered shipments reject new
  evidence. SQL triggers prohibit deletion/truncation of assignment records and
  any update/deletion/truncation of retained evidence.
- Automation switches, outbound workflows and the read-only connector are untouched.

## Verification

- Backup command completed before migration: 218,812,779-byte verified archive.
  An attempt made while the backup was incomplete was correctly blocked; the
  completed backup allowed the existing runner to apply only migration 0034.
- Live read-only before/after comparison passed for every original role row,
  grant and permission definition. `db:verify`: 34 checksums, 0 pending.
- The focused regression command runs `test/logistics-roles.test.js`, the five
  converted workflow suites, `test/transaction-helper.test.js` and
  `test/database-guard.test.js`: **32 passed, 0 failed, 0 skipped**. All use rollback transactions or protocol spies;
  HTTP authorization checks invoke the existing handler without another listener.
- New tests cover user creation/role changes, undefined Admin, financial-grant
  refusal, wrong-assignment reads and photos, revocation, field injection,
  invalid/stale evidence, code-only changes, GRN self-review and explicit exception
  acknowledgement, commercial-exception denial, dispatch versions and delivery proof.
- The full guarded run reports 132 tests: **75 passed, 11 failed, 46 cancelled,
  0 skipped**. Remaining failures/cancellations still originate from the disabled
  legacy database/schema fixtures; they were not hidden. Its final full residue
  scan passed. The log is `output/logistics-roles/full-test-run.log`.
- Syntax lint, web TypeScript, design-token checks, production build and tracked
  diff whitespace checks passed. Post-regression read-only checks found no fixture
  users, assignments or evidence rows and confirmed original grants still match.

The running application/connector was not restarted, and browser appearance has
not been manually verified. Restart the existing application to load the updated
backend/UI. No extra listener, business seed records or Admin role was created.
