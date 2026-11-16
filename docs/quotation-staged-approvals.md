# Staged quotation approvals

## Owner configuration

`quotation.approval_levels` retains its existing array of name, permission and
appliesTo. Each entry may now have an explicit positive `sequence` number. Names
and supplied sequence numbers must be unique. The matching conditions remain
ALL, DISCOUNT_LEVEL_2, DISCOUNT_LEVEL_3 and BELOW_MARGIN_FLOOR.

When more than one entry matches a quotation, every matching entry needs a unique
sequence. Owner must also confirm `quotation.approval_reviewer_policy`:

```json
{"reuse":"DISTINCT_REVIEWERS or ALLOW_REUSE","instructions":"Owner-confirmed instructions"}
```

The example describes the shape, not a saved value. No sequence, role hierarchy,
reviewer reuse decision or approval value is seeded. A quotation with one matching
stage retains its existing single independent review behavior and does not need
the new reviewer policy.

## Review flow

Submitting creates a fresh UUID round and UUID stage identities in the existing
private quotation snapshot. Intermediate approvals retain PENDING_APPROVAL. Only
the final required stage changes the quotation to APPROVED. Return removes active
progress; immutable events retain the previous round. Resubmission creates new
identities even if the quotation's commercial version has not changed.

Each reviewer must currently be an active employee in an active role with
`quotations.read`, `quotations.approve` and the stage's configured permission. Shared
reviewer eligibility also excludes leave, a current lock, a required password
change and missing MFA enrolment when enforcement and the role require it. These
records and current permission grants are share-locked during the decision. The original creator
and latest commercial revision author cannot approve. Earlier reviewers are
revalidated when progressing and before issuing or converting an approved quote.
Distinct reviewers are enforced when Owner explicitly selects that policy.

Pricing rules bind both canonical and decision-register versions. A review also
binds public terms and line identities, captured costs, quotation policy revision,
margin decision, contracts and retained price-level source selections. A changed
source, withdrawn/reconfirmed decision or ineligible earlier reviewer blocks the
round. Save a revised draft and submit for fresh review when its captured pricing
rules or commercial sources changed.

Existing single-stage quotations without a retained round keep the earlier
single-stage behavior while their existing source/version checks remain valid.
They are never treated as evidence of a completed multi-stage plan.

## API and retry behavior

Use the existing `POST /api/crm/quotations/:id/actions`. Multi-stage APPROVE adds:

- `roundId`: the current round UUID;
- `stageId`: the current pending stage UUID;
- `requestKey`: a UUID retained for retries of that exact command.

The existing version, reason and below-floor acknowledgement remain required as
applicable. A receipt in the immutable approval event binds actor, quotation,
version, round, stage, reason and exception acknowledgement. Identical retries do
not advance another stage. Changed key reuse is rejected. A retry from an earlier
returned round returns the current record with `replayed: true` and never approves
the new round. Existing single-stage clients may continue without the additional
fields; the native editor supplies them.

Snapshot progress, event and audit commit in the existing quotation transaction
and advisory lock. Audit failure rolls back stage completion and retry receipt.
No new table or migration is needed.

## Screen and privacy

The quotation editor shows required step counts, completed/pending/waiting steps,
and an Approve button only for the server's eligible pending step. It retains the
same request UUID on a retry. Intermediate approval history refreshes even though
status and commercial version remain unchanged.

Public progress contains generic step numbers, round/stage identities and the
current caller's eligibility. It does not expose stage permission names, cost,
margin, below-floor conditions or source fingerprints. Existing financial
projections remain permission controlled. Customer PDFs retain their existing
public fields and draft watermark; incomplete stages cannot authorize issue or
sales-order conversion. No sender, switch or delivery gate is changed.

## Verification

`test/quotation-approval-plan.test.js` exercises explicit ordering, absent policy,
round/source binding, exact commands, maker exclusion, current permissions and
public projection without a database. `test/quotation-staged-approval.test.js`
uses the sole database rollback helper for complete/partial rounds, retry/replay,
return/resubmit, policy withdrawal/reconfirmation, reviewer deactivation, audit
failure and HTTP permission/CSRF/privacy checks. The existing quotation suites
remain the regression for single-stage behavior. See the task verification log
for commands actually run; this document is not browser/client acceptance.
