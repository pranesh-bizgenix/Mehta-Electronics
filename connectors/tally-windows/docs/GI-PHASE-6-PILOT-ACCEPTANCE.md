# GI Phase 6 — Pilot Acceptance and Opening Day

Date: 17 July 2026  
Owner: Bizgenix founder-led onboarding  
Product position: guided Growth Intelligence pilot

## CTO decision

The product is publicly deployed and the software release is ready. Do not add
another feature phase before completing one real-company acceptance cycle.

Production:

- URL: `https://growth-intelligence-three.vercel.app`
- Vercel project: `bizgenix-gi`
- Release commit: `95683bdbcfc28270444eee17c3e907eaf979b891`
- Managed PostgreSQL: healthy
- Release mode: `guided_pilot`
- Scope freeze: enabled

## The two remaining gates

### 1. One complete reconciled Tally company

The Tally Windows computer must have:

- the intended company open;
- Tally HTTP/XML server enabled on port 9000;
- the outbound GI Engine running with the production GI URL;
- current-FY-through-today rolling dates;
- Sales Register, Purchase Register, Trial Balance, Day Book, Bills
  Receivable, Bills Payable, Cash/Bank and Stock Summary available.

GI must show the exact company and GUID, publish one dataset version only after
the evidence gate passes, and keep every unexplained material difference
quarantined.

### 2. One owner-approved delivery channel

Choose exactly one for the first pilot:

- WhatsApp using the client-approved Bizgenix/Periskope/Meta account; or
- email using the client-approved Resend/custom provider.

Store credentials through GI’s encrypted provider settings. Send one low-risk
test to the owner, record approval and confirm delivery. Do not enable
autonomous customer outreach.

## Opening-day run

1. Sign the guided-pilot scope and data responsibilities.
2. Open the exact company in Tally and start the outbound Engine.
3. Confirm company name/GUID and full sync receipt in Data Spine.
4. Reconcile applicable Tally control reports with GI.
5. Review the three highest-priority management decisions.
6. Approve and send one test action through the chosen channel.
7. Record accountant sign-off, exceptions, owners and follow-up date.
8. Repeat the sync after new entries and prove the same company version changes
   coherently across all 13 modules.

## Launch decision

- **Go:** founder-led design-partner pilot after the two gates above pass.
- **Hold:** any unexplained accounting mismatch, wrong company identity,
  unreachable Tally Engine or untested delivery provider.
- **Not yet offered:** unattended self-service, audit opinion, autonomous
  write-back, billing automation or accounting-grade guarantee.

## Immediate operational result

On 17 July 2026 the direct LAN check to the previously known Tally address
`localhost:9000` timed out. This is an availability/network condition, not a
GI deployment failure. Use the outbound Engine from the Tally PC for the pilot;
it is the production architecture and does not require the cloud app to reach a
private LAN address.
