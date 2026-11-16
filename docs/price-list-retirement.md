# Price-list retirement and replacement

## Flow

Open `/items/price-retirement` from Items and dated price lists. Choose an active
list and explicitly choose RETIRE or SUPERSEDE. SUPERSEDE requires a different,
independently approved active replacement that is valid today, has the same
currency, and still matches its approved product revisions and units.

Preview shows the retained source, replacement reference, active tier count,
uncovered product/minimum-quantity tiers (first 100 details), policy version and
levels that currently use the old list. Matching tiers do not establish equal
prices or equivalent terms. Submit the exact preview with a reason. Prices are
unchanged while the request is pending.

An eligible independent reviewer approves or rejects with a reason. Approval
archives the old canonical list and its retained import review; the original
entries, dates, prices, discounts, uploaded bytes and prior approval history stay
intact. It records an ARCHIVE import event, approval decision and audit event in
one transaction. Rejection leaves the source active. An audit failure rolls back
the complete action. There is no hard delete, automatic reactivation or silent
rewriting of old prices.

Replacement is an explicit retained reference. **It does not change level source
mappings or quotation lines.** Owner reviews those separately in `/items/price-levels`.
The old list becomes ineligible; old bound quotation prices must be revised and
reviewed through the existing workflow. This does not overwrite previously
retained document bytes.

## Policy and access (BLOCKED-PREM)

`price_lists.retirement_policy` starts absent. Owner must confirm a supported
existing reviewer permission and instructions in `/rules`. Missing configuration
returns `Not set: price_lists.retirement_policy` and blocks the flow. No value is
seeded and no permission is granted. Confirm actual retirement decisions and
replacement terms with Prem before operational use.

Read access requires both `items.read` and `items.list_price.read`. Changes also
require `items.update`; decisions additionally require the configured reviewer
permission. The request maker and the original source-list maker cannot decide
their own request. For reviewed imports that maker is the retained importer,
not the canonical row's activation operator. Session, CSRF, reason and server
permission checks apply through the existing routes. Existing role grants are
unchanged; no Admin role or Tally financial access is added.

## Integrity and concurrency

The existing generic `approval_requests` and append-only `approval_decisions`
tables are reused under the exclusive `PRICE_LIST_DISPOSITION` request type.
No migration or new table is needed. The snapshot contains the command, original
reason, preview fingerprint and impact; references are validated against actual
canonical list and source rows on both request and approval. Existing tables'
generic JSON payload conventions remain unchanged.

Fingerprints cover the canonical source and replacement, exact retained tiers,
current product revisions, approval linkage, linked level revisions and policy
version. Approval reevaluates all of them. Policy or impact changes require a
fresh request; rejection can retain the changed evidence in the decision history.
Retained snapshot integrity is checked before replay or decision. UUID request
IDs make exact request retries replay safely, including after approval; changed
reuse fails. A completed decision cannot run again.

The service takes the existing global quotation lock, all three level locks,
the rule lock, then sorted source row locks. This follows quotation/level lock
order; quote validation cannot silently interleave with retirement. Existing
approval requests are row locked during decision. Independent-session contention
and browser acceptance remain release checks; rollback tests are not presented
as a live concurrency or production acceptance result.

Approved level-price resolution now also requires the canonical product revision,
part code and unit to match the retained activated import row. Product changes
require a newly reviewed source revision; an old price cannot silently move from
one unit to another.

## Verification

`test/price-disposition.test.js` covers the empty policy block, independent
approval, source/level impact staleness, request replay, unchanged price rows,
archived source/blocked old price binding, retained replacement identity,
rejection, atomic rollback on audit failure and HTTP session/CSRF/financial access.
`test/price-levels.test.js` includes an approved-product-unit change regression.
See the final checkpoint in `prompt-pack-completion-audit.md` for commands/counts.
No real list is retired by tests; all fixture mutations roll back.
