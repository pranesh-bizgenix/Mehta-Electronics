# ADR-0003: Migrate the frontend with compatibility gates

- **Status:** Proposed; approval pending
- **Date:** 2026-10-17

## Context

The existing browser UI and Node API support working customer/item, enquiry, quotation, order, account, audit, dashboard, and Tally-read workflows. The working tree also contains substantial local modifications that must be preserved.

## Decision proposed

Do not replace the current UI or refactor backend business behavior in one cutover. First document the API and workflow behavior; then add the Next.js frontend against the existing API; verify role-based parity; switch users through a reversible routing/configuration change only after acceptance. Keep the old UI available through the agreed stabilization window. All edits occur on the current feature branch and must avoid touching unrelated pre-existing changes.

## Alternatives considered

1. Big-bang rewrite: high regression and data-loss risk.
2. Parallel UI calling existing backend: incremental and preserves one business authority, at the cost of temporary dual UI operation.
3. Rewrite backend together with UI: larger change surface and conflicts with preserving the current built-in-server architecture.

## Consequences and risks

- Characterization tests and contract documentation are required before UI changes.
- Temporary duplicate UI maintenance is required.
- Routing, session cookie scope, CSRF, and deployment need integration testing.
- Do not alter or remove the old UI until parity, accessibility, security, and rollback gates pass.

## Approval record

Pending: product owner approval of coexistence/cutover and technical owner approval of deployment routing.
