# ControlDesk workspace redesign

The main application server was stopped for this work and is intentionally left stopped.

The redesign uses a cool slate canvas, white surfaces, indigo actions and restrained status colours. Shared tokens in `apps/web/styles/tokens.css` and presentation rules in `workspace.css` apply across the existing application. Printed quotation styling and stored business/Tally data are outside this change.

## Changes

- Compact sidebar, clearer active states, an expandable Administration section and a consistent workspace header. CRM, Tally and connector settings remain in the same application.
- Consistent Inter typography, softer borders, modest corner radii and a predictable spacing scale.
- Visible field labels, readable input sizes, accessible focus/error states and aligned search/filter controls. Primary actions are distinguished from refresh and secondary tools.
- Quieter tables, clearer status badges, responsive record cards, smaller empty states and consistent dialogs/drawers.
- Four primary dashboard metrics, compact operational indicators and consolidated health information. Independent document counts are not displayed as conversion percentages above 100%.
- Tally overview separated into sync health, source cards, browsable entity counts, partial valuation and imported datasets. Delivered values, missing-source states and field permissions are preserved.
- Connector address and profile status arranged as two desktop panels, stacked on mobile; setup guidance uses progressive disclosure and disabling a connector is separated from routine actions.
- Owner customer-policy controls are expandable so they do not dominate everyday complaint/collection work.
- Quotation editor approval steps fit small screens; its line-entry table has valid accessible children.

## Verification

`scripts/verify-ui-redesign.mjs` exercises the real combined HTTP/UI application with synthetic and anonymised fixtures in a random `test_<random>` schema inside the existing database. It cleans up the schema and preview server. It never seeds production data or changes real connector credentials.

The review covers 21 application screens at 1440 px and 390 px in light/dark mode, plus login and customer-form captures. It checks page overflow, JavaScript errors, accessibility (including colour contrast), keyboard dismissal and mobile navigation. Results: `output/ui-redesign/verification.json`; screenshots are in the same directory.

Production build, TypeScript and design-token validation pass. The targeted Tally field/formatting checks pass (12 tests). Detailed visual results are recorded in the JSON report rather than inferred from a successful build.
