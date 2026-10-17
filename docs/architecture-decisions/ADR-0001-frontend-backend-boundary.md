# ADR-0001: Separate Next.js frontend from the Node.js HTTP backend

- **Status:** Proposed; approval pending
- **Date:** 2026-10-17

## Context

The requested target specifies Next.js, React, TypeScript, and App Router for the frontend, while also requiring Node.js ES modules and the built-in HTTP server as the authoritative business backend. The current application serves static browser assets and API routes from one Node process.

## Decision proposed

Add a Next.js frontend as a separate application. Keep all business operations, authorization, workflows, and persistence in the existing Node.js built-in HTTP backend. The browser calls the backend through versioned/documented HTTP contracts. Do not add Express or use Next.js API routes/Server Actions as a business backend.

## Alternatives considered

1. Keep the current static UI: lowest migration cost, but does not meet the requested frontend stack.
2. Move business operations to Next.js routes/actions: simpler deployment coupling, but conflicts with the explicit separate-backend requirement.
3. Add a separate Next.js UI while retaining the Node backend: meets the stated boundary and allows gradual UI replacement.

## Consequences and risks

- Existing behavior can remain available during UI migration.
- Two applications add build, deployment, proxy, CORS/cookie, and observability complexity.
- A shared contract package can reduce drift, but backend runtime validation remains mandatory.
- Same-origin proxying is a candidate to simplify session cookies and CORS; deployment architecture approval is required.
- Do not cut over until all current workflows have parity evidence and rollback has been rehearsed.

## Approval record

Pending: sponsor/product owner and technical owner, with date and deployment assumptions.
