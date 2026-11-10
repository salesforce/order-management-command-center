# Existing console interfaces

This reference describes the implementation as it exists. It adds no component API, registry, lifecycle or configuration
mechanism. Use it with the [customization walkthrough](changing-the-console.md) and
[recipes](console-customization-recipes.md). The source links are authoritative if the code later changes.

## Views, tabs, panels and components

| Term | Existing implementation |
|---|---|
| Top-level mode | `console`, `dashboard`, `service` or `limits` in [`index.html`](../../app/public/operations-console/index.html); a button, page container, loading path and URL behavior |
| Dashboard tab | An entry in `DOMAINS`, selected by `S.dtab` and rendered by `views` in [`console-dash-view.js`](../../app/public/operations-console/console-dash-view.js) |
| Panel | A section within a view; Dashboard sections often use `panel()` and an existing body ID such as `pOrders` |
| Component | A smaller piece of markup or drawing, such as a KPI, table, chart, gauge or status label; there is no universal component base class |
| Shared surface | Drawers, the Data map dialog and the assistant; these are not additional entries in `MODES` |

The Dashboard tabs are Orders, Customers, Fulfillment, Payments, Service, Returns, Products and Policies. Service Console
is the `service` mode of the console. It is read-only like every other mode.

## Ownership and factory contracts

[`index.html`](../../app/public/operations-console/index.html) owns sign-in, loading, navigation, the address bar, polling and assistant wiring.
It creates each view factory once. The factory receives a `page` object of explicitly supplied functions/constants,
closes over its own state, and returns the functions its callers use. Shared state is the plain mutable `S` object from
[`console-state.js`](../../app/public/operations-console/console-state.js); it has no automatic rendering or subscription mechanism.

| Factory | Page-facing functions, selected from its returned object |
|---|---|
| [`createMapView(page)`](../../app/public/operations-console/console-map-view.js) | `render`, `renderMap`, `loadInventory`, `clearProduct`, `zoomBy`, `toggleFull`, `resetZoom`, formatting helpers |
| [`createDashView(page)`](../../app/public/operations-console/console-dash-view.js) | `dp`, `renderDash`, `setDTab`, `hideDTip` |
| [`createDrawers(page)`](../../app/public/operations-console/console-drawers.js) | `openOrder`, `openRecord`, `openAny`, `closeDrawer`, `closeModal`, `enterLayer`, `drawerFacts`, shared helpers |
| [`createServiceView(page)`](../../app/public/operations-console/console-service-view.js) | `renderQueue`, `openQueueItem`, `moveQueue`, `loadCustomer`, `clearCustomer` |
| [`createLimitsView(page)`](../../app/public/operations-console/console-limits-view.js) | `limLoad`, `limApply`, `limEnter`, `limLeave`, `limSync`, `everyMs`, `pollMs`, metering/context helpers |

Read the factory's initial destructuring and final return alongside its call in `index.html` for the complete contract.
For example, Limits receives `mode: () => S.mode` and `live: () => S.live`, so it reads current state rather than a startup
copy. Functions supplied by a view created later use a wrapper such as `openOrder: (...a) => openOrder(...a)` to avoid
reading an uninitialized binding. Preserve that order and the no-import-cycle constraint. [ADR 0006](../adr/0006-console-views-as-factories.md)
explains the arrangement.

Typical shared state groups are:

| State | Examples and meaning |
|---|---|
| Loaded results | `S.data` for the map, `S.dash` for Dashboard, `S.svc` for the service queue, `S.cust` for the open customer |
| Selection | `S.mode`, `S.range`, `S.store`, `S.channel`, `S.dtab`, `S.layer`, `S.focusKey`, service queue filters and `S.custId` |
| Work in flight | Customer, inventory and page load sequence counters prevent an older answer painting over a newer selection |
| Assistant | `S.agent`, `S.agentAsk`; context is built from the current view and permitted facts |

Updating `S` alone does not redraw a view. Follow the existing handler's render calls. `keepFocus(paint)` in
[`console-kit.js`](../../app/public/operations-console/console-kit.js) restores focus by element ID or a data key under an identified parent
after replacement markup. IDs and data attributes therefore participate in behavior as well as tests and CSS.

## Dashboard panel contract

[`console-panels.js`](../../app/public/operations-console/console-panels.js) exports this current positional interface:

```js
panel(id, title, src, body, csv, cls = '', agent = false)
```

| Argument | Current meaning |
|---|---|
| `id` | Stable, caller-supplied body ID; also the CSV/assistant store key and `data-csv`/`data-ask` target |
| `title` | Heading HTML supplied by the caller; plain heading text is stored for assistant context |
| `src` | Source label, escaped by the helper and displayed beside the heading |
| `body` | Rendered HTML supplied by the caller; escape record values with `esc()` before interpolation |
| `csv` | A truthy `{ cols: [...], rows: [[...], ...] }` descriptor, or a falsy value when no export is available |
| `cls` | Additional section classes, including existing layout classes `span2` and `span3` |
| `agent` | Strict boolean opt-in; the exported `AGENT` constant is `true` |

`panel()` returns an HTML string with a `.zone` section and a `.dbody` child carrying `id`. It also updates `csvStore[id]`
and `askStore[id]`; a falsy CSV descriptor deletes the old CSV entry. It does not fetch data, attach the button handlers or
create a separately mounted component. `paintDash()` renders the sections, draws charts that need DOM elements and binds
CSV, Ask and row navigation handlers afterwards.

The Orders tab's existing `pOrders` panel is a worked example: it uses `OrderSummary.OrderedDate`, the already-loaded
`ordersSeries` result, calendar buckets shared by the chart and CSV, and `span2`. Its behavior and export are checked by
[`dashboard/orders.test.mjs`](../../app/test/operations-console/ui/dashboard/orders.test.mjs). Inspect that example rather than
inventing a new panel shape.

CSV rows stay raw in the store; [`console-csv.js`](../../app/public/operations-console/console-csv.js) escapes cells when exporting. Keep column
order, units and filters consistent with the displayed data. Do not preformat raw data in ways that change its meaning.

The Ask button is rendered even without the `agent` opt-in. Row sharing is controlled separately by `agentRows()` and
`agentPanelFacts()`. Whole-tab summaries omit `_id` columns, while the asked-panel branch reads its columns directly.
Neither behavior makes arbitrary CSV data safe to share. Review the rows before opting in: customer names, email,
telephone numbers and addresses must not enter those facts. The explicit expectations live in
[`agent-context.test.mjs`](../../app/test/integration/contracts/agent-context.test.mjs).

## Data and sample-data contracts

UI code calls the page's `j(url, opts)` for reads instead of constructing SOQL. The page selects the local, hosted or
in-org transport, and [`data/core.js`](../../app/public/operations-console/data/core.js) and the providers it selects implement the read model. See
[ARCHITECTURE.md](../../ARCHITECTURE.md) for transport and route ownership. The factories are not an additional data-provider
framework.

| Existing path | Result consumer / sample counterpart |
|---|---|
| `/api/console?range=...[&store=...&channel=...]` | `S.data`; `demoData(range, scope)` |
| `/api/dashboard?period=...[&store=...&channel=...]` | `S.dash`; `demoDash(period, scope)` |
| `/api/filters` | `S.scopes` (the Store and Sales channel pickers); `demoFilters()` |
| `/api/service/queue?range=...` | `S.svc`; `demoService(range)` |
| `/api/service/customer/<id>` | `S.cust`; `demoCustomer(id, focusOrder)` |
| `/api/order/<id>`, `/api/record/<object>/<id>` | Shared drawers; `demoOrder(id)`, `demoRecord(object, id)` |
| `/api/limits` | Limits' `lim.d`; internal `demoLimits()` in [`console-limits-view.js`](../../app/public/operations-console/console-limits-view.js) |

The sample generators are in [`console-demo.js`](../../app/public/operations-console/console-demo.js) except where noted. A future data change
must keep the live and sample shapes aligned, including timestamps, range/period labels and failure states. Use synthetic
records for examples; never copy production customer responses into prompts or fixtures.

The Store and Sales channel filters (`?store=` a WebStore Id, `?channel=` a SalesChannel Id) apply to the Operations Console and
Dashboard. `scoper()` in `read-runtime.js` adds each object's condition through its path to `OrderSummary` (`SCOPE_PATH` in
`om-core-util.js`; Invoice and CreditMemo by a `ReferenceEntityId` semi-join, Case through the org's lookup). A panel whose object
can't reach an order fails with `UNSCOPED` instead of counting every store; locations and stock aren't filtered. Each payload
echoes the `scope` it was read with.

Read-model helpers `pick()` and `has()` tolerate org schema differences. A panel query wrapped in `safe()` produces
`{ ok: true, data }` (with `capped: true` when detected) or `{ ok: false, error }`. Dashboard's `dp()` returns successful
data or `null`, and its error/availability renderers distinguish missing information from a real zero. Preserve capped,
unavailable, empty and failed results as different states. Adding one visible card does not justify a new per-card fetch
when the route already provides its data.

## Existing navigation and lifecycle

There is no general view registry or automatic mount/dispose lifecycle. Navigation is coordinated by these existing
parts; a future new mode needs an explicit review of all of them.

| Part | Current responsibility |
|---|---|
| Markup and `MODES` in `index.html` | Mode buttons/containers and recognized initial modes |
| `DOMAINS` and Dashboard's `views` | Tab labels/order, validation and render functions; `setDTab()` selects a tab |
| `syncMode()` / `setMode()` | Container visibility, range/period controls, Limits entry/exit, drawer/tooltip handling, loading and context |
| Initial hash parsing and `hashchange` | Dashboard tab, Limits and service customer routes |
| `load()`, `loadFailed()` and view-name mapping | Endpoint selection, applying results, timestamps, error labels and retry |
| `viewShortcuts()` / `dashboardShortcut()` in `console-drawers.js` | Top-level keyboard navigation and numeric Dashboard shortcuts |
| Assistant context selection in `index.html` | Facts for the active view and any permitted open-drawer facts |

Current URLs are `#dashboard/<domain>`, `#limits` and `#service[/<accountId>]`; the normal pathname/query represents the map.
Drawers and the Data map are overlays. A visible label change must not silently rename these identifiers or URLs.

`load()` clears the short cache, advances a sequence counter and fetches the requested range/period. Only its newest
answer can paint. A failed refresh keeps the previous data and its labels and explains the failure in a banner. Dashboard
tab selection can repaint the loaded payload without fetching another whole dashboard. Customer loading has its own
sequence guard. Views keep their factory state while the page exists; switching modes does not generically dispose them.

Automatic refresh starts off. The default interval, when enabled, is one minute for other modes and five minutes for
Limits, subject to the stored choice and Limits' idle adjustment. Hidden-page/missed-poll behavior and the distinction
between a local meter read and an org API call are part of existing behavior. Limits' one-second UI tick and animation
frame do not mean one Salesforce API request each second. Its `limEnter`, `limLeave`, `limSync`, `limLoad` and `limApply`
coordinate the existing meter and drawing; do not replace them as a prerequisite for documenting or styling a component.

[`console-jcache.js`](../../app/public/operations-console/console-jcache.js) deduplicates in-flight eligible drawer reads and retains validated
results for 30 seconds, up to 40 entries. Eligibility is explicit in `J_ROUTES`; errors are not cached. `load()` and
`showGate()` clear it. It is not a general dashboard cache or a reason to add requests when rearranging panels.

## Configuration and layout as they exist

| Setting | Existing source and meaning |
|---|---|
| Theme | `tokens.css`; `omc.theme` in local storage. Recognized `slds-light` / `slds-dark` select those themes; otherwise Standard. Shared with the design reference page |
| Layout | CSS/markup in `index.html`, with per-view markup and Dashboard panel order/classes in `console-dash-view.js`. `span2` spans two grid columns; `span3` spans the full row; existing media rules collapse these |
| Range and period | `S.range` starts at `90d`, page `period` at `mtd`; allowed labels are in `console-labels.js`. Loaded payload labels remain authoritative after a failed refresh |
| Refresh preferences | `omc.every.<mode>`, with `omc.limitsEvery` for Limits; intervals selected from the existing list in `console-limits-view.js` |
| Limits chart window | `omc.limitsWindow`, interpreted by the same view and its existing `LIM_WINDOWS` values |
| Org/authentication settings | `om-config.js`, transport modules and local server configuration described in the README; these are not presentation settings |

There is no persisted panel-order schema, theme editor or layout import/export feature. The design page displays tokens
and examples; it does not configure the console. Use [design-tokens.md](../shared/design-tokens.md) for the current token catalogue
and styling rules.

## Source discovery and packaging constraints

Console implementations live under `app/public/operations-console/`; common transports, tokens and agent code live under
`app/public/shared/`. [`console-source.mjs`](../../app/test/support/console-source.mjs) follows canonical module references
for guard tests. Root JavaScript files are compatibility facades. The artifact builder supports a defined set of
import/export forms and no cycles. The in-org builders resolve each app's dependency graph and emit the stable,
flat deployment names, splitting inline scripts for CSP. See [ARCHITECTURE.md](../../ARCHITECTURE.md).

A new folder or import form can require scanner/build work; it is not an automatic extension point. Keep documentation
under `docs/` or the existing root Markdown files, outside the shipped public files. A documentation-only task must not
change a scanner, builder, CI step or runtime file to make an example work.
