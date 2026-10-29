# UI audit (before redesign)

**Captured:** 29 Oct 2026 with `node scripts/ui-capture-legacy.mjs` (demo dataset, throwaway `test_` schema).
**Screenshots:** [output/ui-before/](../output/ui-before/). Every screen of the existing vanilla SPA at 1440 px and 390 px, plus a dark-mode dashboard. The newer Next.js F1 screens are in [output/foundation/](../output/foundation/).
**Script results:** no page errors and no horizontal overflow at either width.

## Cross-cutting problems

| # | Problem | Where | Impact |
|---|---|---|---|
| 1 | **Two visual languages.** The vanilla SPA (`public/`, port 3000) and the Next.js F1 screens (port 3001) use different shells, navigation, buttons and tables. Users jump between apps through a sidebar link. | Everywhere | Feels like two products; navigation is lost on switch |
| 2 | **Money is not formatted.** Credit limits show `350000.000000`; totals elsewhere use `₹41,033.91`. No Indian grouping, inconsistent decimals, money columns left-aligned. | Customers, Items, Price lists, Quotations | Hard to read; looks unfinished |
| 3 | **No tabular numerals.** Digits in amount and quantity columns do not line up. | All tables | Scanning totals is slow |
| 4 | **Two searches on one list.** A server "Search" form plus a "Filter loaded rows… local filter" box, both above the table. | Customers, Items, Enquiries, Quotations, Orders, Audit | Confusing; the local filter misses unloaded pages |
| 5 | **No global search or command palette.** To open a customer or quotation you navigate, filter, then click "View". | Shell | Slow for daily work |
| 6 | **Static breadcrumb.** Every page shows "MEHTA / WORKSPACE" regardless of location. | All pages | No sense of place |
| 7 | **Header controls compete with the title.** "TALLY: READ ONLY" and "Dark mode" buttons sit beside every page title; on phones "Dark mode" takes its own row. | All pages | Wasted space; dark mode not persisted per user |
| 8 | **No counts or badges in navigation.** Open exceptions, SLA breaches and drafts awaiting approval are invisible until a page is opened. | Shell | Decisions are missed |
| 9 | **No skeleton loading.** Pages flash empty, then fill. | All lists | Perceived slowness |
| 10 | **Empty states are a single grey sentence.** E.g. "No quotations match. Create a draft or start from an enquiry." without an action button. | Quotations, Orders, Purchasing | No clear next step |
| 11 | **Row actions are text links.** "View" in the last column; no hover actions, no bulk actions. | Lists | Weak affordance |
| 12 | **Mobile tables lose information.** At 390 px the enquiry table keeps two columns and silently drops status, owner and actions; filters take the whole first screen. | All lists | Phone users cannot act |
| 13 | **Hidden navigation on phones.** The menu button sits next to the page title; there is no persistent top bar. | Shell @390 | Hard to discover |
| 14 | **Guidance text in the work area.** Policy reminders ("The owner must configure the margin policy…") are permanent paragraphs above lists instead of contextual notices. | Quotations, Customers | Noise |
| 15 | **Dashboard first fold is about connection state.** The owner sees "Not connected / Waiting for a usable Tally snapshot" before any business numbers; the 4 workflow counts sit below the fold. No "needs your decision" inbox or recent activity. | Overview | Owner value hidden |
| 16 | **No charts.** Pipeline, conversion, margin protection and SLA are not visualised. | Overview | Trends invisible |
| 17 | **Inconsistent type scale.** Several heading sizes and uppercase eyebrow labels mixed with sentence-case labels; the Overview uses a second display heading inside the page. | All pages | Visual noise |
| 18 | **Tooltips and truncation missing.** Long GSTINs, names and audit values wrap or overflow cells. | Audit, Tally | Ragged tables |
| 19 | **Focus and touch targets.** Several controls (column chooser, pager, table sort) are below 44 px on phones; focus rings rely on browser defaults in the SPA. | Lists | Accessibility |
| 20 | **Hard-coded colours.** `public/*.css` mixes tokens with literal hex values; the Next.js F1 styles define tokens but not full 50–900 scales, elevation, motion or z-index layers. | Styles | Theming and dark mode drift |

## Screen notes

- **Login:** a centred card with a fixed tagline; no brand panel. The new two-factor step works but inherits the old card styling.
- **Customers:** the list is clear but money is raw and there is no 360 header (outstanding dues, owner, pricing class, open quotes). Detail opens as tabs in the same page with no activity timeline.
- **Items / price lists:** tiers are edited in a long modal form; no list-price privacy indicator.
- **Enquiries:** seven filter controls above the table; no inbox/detail split; status changes happen in modals.
- **Quotations:** list plus a modal-heavy editor. No live totals panel beside the lines, no margin flags per line (green/blue/red), no approval stepper, and no PDF preview beside the editor.
- **Sales orders and dispatch:** verification flags are shown as text lists; dispatch and proof upload use plain file inputs with no drop zone or progress.
- **Purchasing:** six record types behind one tab strip; comparison tables are dense without highlighting the winner.
- **Tally & reconciliation:** good data, but long tables with mojibake-repair tooltips are hard to scan; no summary cards.
- **Tally Connector:** status tiles are large and text-heavy; actions are not ordered by the setup flow.
- **Users / Audit:** duplicated by the new Next.js screens (Users & roles, Audit trail) with different behaviour.

## Redesign decisions taken from this audit

1. One application: every screen moves into `apps/web`; each legacy screen is deleted in the commit that replaces it.
2. One design-token file (colour scales 50–900, semantic colours, 8 px spacing, radii, elevation, type, motion, z-index); a check fails the build if a component uses a literal colour.
3. Shared money/quantity formatting (Indian grouping, tabular numerals, right-aligned).
4. One server-side search per list (debounced), saved filters, a column chooser and a density toggle in the shared data table. The "loaded rows" local filter goes.
5. App shell with grouped, collapsible sidebar and live badges; a top bar with command palette (Ctrl/Cmd+K), company/period selector, notifications, theme and user menu; real breadcrumbs.
6. Owner dashboard: decision numbers and the "needs your decision" inbox first; connection health becomes a compact status chip.
