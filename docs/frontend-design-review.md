# Frontend design review

Delivered on `feature/base-building`. Open the [before/after gallery](../output/design-review/index.html) to compare every screen. All images use explicitly synthetic preview fixtures, not live company records.

## Scope

The existing static application receives a shared presentation layer. The deep green sidebar now has grouped navigation and local SVG icons; the workspace uses a consistent type scale, eight-pixel spacing, rounded surfaces, restrained shadows, and visible keyboard focus. Theme selection persists locally and defaults to the operating system preference. Mobile navigation opens as a drawer with a scrim, keyboard focus containment, Escape dismissal, and focus restoration. Reduced-motion preferences are respected.

`public/app.js` is unchanged. No backend, connector implementation, endpoint, database table, or migration was modified. The Tally Connector screen receives CSS styling only: its content, controls, handlers, and calls are retained. The preview never activates pairing, setup, synchronization, or upload controls.

## Components

`public/ui-components.js` exports AppShell, Sidebar, PageHeader, DataTable, StatCard, StatusBadge, FormField, Modal, Toast, Tabs, and ConfirmDialog. Existing markup and event handlers are retained. Native dialogs supply modal keyboard behavior. Tabs and ConfirmDialog are reusable primitives with browser checks; they are not inserted into existing business actions.

DataTable enhances the ordinary page tables with sticky headers, keyboard sorting, loaded-row filtering, a column picker, and local pagination for more than 20 loaded rows. Existing master-table API sort controls and existing server pagination remain in place. Local filtering/sorting is labeled explicitly and never implies searching the entire server dataset. Table action columns are not sortable. Original empty states remain; a separate no-match state handles local filtering.

Skeletons and retry feedback cover navigation and the existing search/pagination buttons without wrapping `fetch` or changing request payloads. The Overview keeps its own saved-snapshot loader. Connector content is excluded from behavioral enhancement. Slow loads offer retry after 20 seconds without claiming the request was cancelled.

No new runtime dependency, font download, image download, or third-party network service is required by the production UI.

## Before and after

| Page | Before | After | Mobile after |
|---|---|---|---|
| Overview | [Before](../output/design-review/dashboard-before.png) | [After](../output/design-review/dashboard-after.png) | [Mobile](../output/design-review/dashboard-mobile.png) |
| Customers | [Before](../output/design-review/customers-before.png) | [After](../output/design-review/customers-after.png) | [Mobile](../output/design-review/customers-mobile.png) |
| Items | [Before](../output/design-review/items-before.png) | [After](../output/design-review/items-after.png) | [Mobile](../output/design-review/items-mobile.png) |
| Enquiries | [Before](../output/design-review/enquiries-before.png) | [After](../output/design-review/enquiries-after.png) | [Mobile](../output/design-review/enquiries-mobile.png) |
| Quotations | [Before](../output/design-review/quotations-before.png) | [After](../output/design-review/quotations-after.png) | [Mobile](../output/design-review/quotations-mobile.png) |
| Sales orders | [Before](../output/design-review/orders-before.png) | [After](../output/design-review/orders-after.png) | [Mobile](../output/design-review/orders-mobile.png) |
| Users | [Before](../output/design-review/users-before.png) | [After](../output/design-review/users-after.png) | [Mobile](../output/design-review/users-mobile.png) |
| Tally & reconciliation | [Before](../output/design-review/tally-before.png) | [After](../output/design-review/tally-after.png) | [Mobile](../output/design-review/tally-mobile.png) |
| Tally Connector | [Before](../output/design-review/tally-connector-before.png) | [After](../output/design-review/tally-connector-after.png) | [Mobile](../output/design-review/tally-connector-mobile.png) |
| Audit log | [Before](../output/design-review/audit-before.png) | [After](../output/design-review/audit-after.png) | [Mobile](../output/design-review/audit-mobile.png) |

Additional captures: [form](../output/design-review/form-after.png), [dark Users](../output/design-review/users-dark.png), [dark Overview](../output/design-review/dashboard-dark.png), [loading](../output/design-review/loading-after.png), [error](../output/design-review/error-after.png), [empty](../output/design-review/empty-after.png).

## Validation

Run from the repository root:

```powershell
node --check public/ui-components.js
node --check scripts/preview-design.mjs
node scripts/preview-design.mjs
git diff --check
```

The preview requires the installed Playwright dependency and local Chrome. It serves public assets on a temporary loopback port and intercepts every API request with fixtures. It never starts the backend, opens a database, or contacts Tally. Baseline HTML comes from the parent of the initial UI commit; unchanged application rendering code is shared between before and after.

Passed checks:

- All ten page renders, with zero browser runtime errors and no normal-load error notifications.
- Desktop 1440px, tablet 820px, mobile 390px; no page-level horizontal overflow. Wide tables scroll inside their own containers.
- Simulated mobile 4G: 120ms latency, 200,000 bytes/second download, 90,000 bytes/second upload. This is a browser simulation, not a field performance measurement.
- Same normal-page GET endpoint sets before and after for all ten pages, including the Connector status display. All preview API requests are asserted to be GET.
- Local filtering and no-match display, sorting, column visibility, and 45-row pagination.
- Native modal Escape dismissal, persistent dark mode, error/retry, skeleton and empty states.
- Keyboard tab selection and confirmation cancellation.

See [verification.json](../output/design-review/verification.json) for captured endpoint sets and the check record. These checks validate frontend presentation using fixtures; they do not assert live backend integration or execute business mutations. Existing business calls remain in the unchanged `public/app.js`.

## Complete changed-file inventory

Application and review sources:

- `public/index.html` — load the presentation layer and add shell accessibility/theme controls.
- `public/design-system.css` — shared visual system, dark theme, responsive layouts, and component states.
- `public/ui-components.js` — network-free reusable UI components and progressive enhancement.
- `scripts/preview-design.mjs` — isolated fixture browser review and capture generator.
- `docs/frontend-design-review.md` — this review, scope, evidence, and inventory.

Review artifacts (each is a new file under `output/design-review/`):

- `index.html`
- `verification.json`
- `dashboard-before.png`
- `dashboard-after.png`
- `dashboard-mobile.png`
- `dashboard-dark.png`
- `customers-before.png`
- `customers-after.png`
- `customers-mobile.png`
- `items-before.png`
- `items-after.png`
- `items-mobile.png`
- `enquiries-before.png`
- `enquiries-after.png`
- `enquiries-mobile.png`
- `quotations-before.png`
- `quotations-after.png`
- `quotations-mobile.png`
- `orders-before.png`
- `orders-after.png`
- `orders-mobile.png`
- `users-before.png`
- `users-after.png`
- `users-mobile.png`
- `users-dark.png`
- `tally-before.png`
- `tally-after.png`
- `tally-mobile.png`
- `tally-connector-before.png`
- `tally-connector-after.png`
- `tally-connector-mobile.png`
- `audit-before.png`
- `audit-after.png`
- `audit-mobile.png`
- `form-after.png`
- `loading-after.png`
- `error-after.png`
- `empty-after.png`

The pre-existing local modification to `apps/web/next-env.d.ts` is excluded from this work and its commits.
