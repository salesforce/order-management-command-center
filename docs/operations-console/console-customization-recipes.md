# Console customization recipes for AI coding tools

These recipes help specify future customer changes. They are documentation, not implemented capabilities or authorization
to change the application. Follow the requested scope: a documentation-only task may describe these steps but must not
execute production edits. Start with the [workflow](changing-the-console.md),
[existing interfaces](console-interfaces.md) and console rules in [CLAUDE.md](../../CLAUDE.md).

Use the workflow's brief for every recipe: target, current/desired result, permitted changes, reference, data semantics,
preserved behavior and verification. Ask the tool to inspect the current source first and identify gaps that need a
decision. The examples below assume sample data; replace bracketed text with your own specification.

## Improve a light theme without losing visual hierarchy

Specify the exact view and region, the light theme, viewport and states. Explain which surface should dominate, what is
primary versus supporting text, how dense the layout should be, and which colors convey status. An approved screenshot
or sketch helps define composition; identify the properties it illustrates rather than asking to copy an external system.

**Inspect:** `index.html` for the page's rules, the owning view for markup, `tokens.css` and
[design-tokens.md](../shared/design-tokens.md) for semantic values, and the existing `/design/` reference. The Standard theme and
the two SLDS themes all need consideration. Shared token changes also affect the design reference page.

**Example request:** "In Dashboard → Orders, improve the light-theme hierarchy of [panels] to match [reference]. Preserve
the displayed data, panel order, dimensions and interactions. Use existing surface, text, border, spacing and type tokens.
Identify any shared-token change separately before editing; keep the other themes outside the change."

**Evidence:** before/after on the same sample data, theme and viewport; empty/error/focus states; contrast, keyboard and
the relevant theme/accessibility suites. A reference palette alone does not show whether the whole page is coherent.

## Change panel orientation, order or size

Clarify whether "vertical" means stacking cards, changing a chart's direction, or moving a view's sections. Name the panels
by heading and existing ID, their destination, the desired widths and the narrow-screen behavior. Specify what should
happen to reading/tab order and long content.

**Inspect:** `index.html`'s grid/media rules and the owning view's section order. Dashboard uses `dgrid`, `span2`, `span3`
and an extra `c2` class on Customers; it has no saved layout configuration. Visual-only ordering must not disagree with
keyboard or screen-reader order.

**Example request:** "On Dashboard → Orders, place Cancellations (`pCancel`) below [target panel] and make it [width].
At [narrow viewport], stack [specified order]. Preserve the IDs, figures, CSV rows, Ask context, filters and fetches."

**Evidence:** wide/narrow layouts, keyboard focus after redraw, chart resizing, exports and navigation. Persisted drag/drop
layout editing is a new feature requiring separate scope; rearranging markup does not provide it.

## Add a KPI, table or Dashboard panel

Specify the question it answers, its unit, source, grouping, period/timezone, denominator, sort order, row cap and any
drilldown. Say whether it reuses existing route data or needs a new read. Define empty, unavailable, partial and error
states; missing information must not become zero.

**Inspect:** the owning `console-*-view.js`, its area's `om-core-*.js`, existing `safe()` results and `console-demo.js`.
For a Dashboard example, inspect `pOrders` and `dashboard/orders.test.mjs`. `panel()` is a rendering/export helper, not a
fetching API. Reuse the existing payload where possible.

**Example request:** "Add [panel] to [view/tab] after [existing ID], showing [defined metric] from [existing data or proposed
read]. Use [existing component] as the rendering pattern. CSV should contain [raw columns]. Do not share its rows with
the assistant unless explicitly reviewed and approved."

**Evidence:** correct figures/units, demo and live shape agreement, schema absence and failure states, CSV consistency,
focus, and the existing context allowlist if sharing is authorized. A new console helper needs an importing unit test;
a visible panel needs its UI coverage. Queries stay in the read model.

## Add a tab or top-level view

Decide whether the request is a Dashboard domain tab, one of the page's top-level modes, or an internal drawer tab. Name
its stable ID, visible label, position, URL, data needs and keyboard behavior. Keep existing links working.

**Inspect:** the [navigation touchpoints](console-interfaces.md#existing-navigation-and-lifecycle). A Dashboard tab has
both `DOMAINS` and a renderer in `views`; a top-level mode also has containers, switching, loading/error behavior, routing,
refresh rules and assistant context. The current numeric Dashboard shortcuts cover keys 1–9; if there are more tabs,
specify how users reach the remaining ones. There is no automatic registry to register a view into.

**Example request:** "Add [Dashboard tab/top-level view] with ID [id], label [label], after [existing item]. On direct load
and navigation it should [behavior]. Reuse the existing factory pattern and preserve existing routes, shortcuts, saved
preferences and refresh behavior. Identify all necessary integration points before implementing."

**Evidence:** direct links, reload, mode/tab switching, keyboard navigation, data failures, state retention, demo data,
assistant context and packaging compatibility. Do not turn a small tab request into a registry/framework migration.

## Display a customer-specific field or metric

Provide the object/relationship and field API name, field type, label, formatting, permissions and the desired missing
field behavior. For example, `Example_Field__c` is a placeholder, not a field that this application already reads. State
whether the request is display-only or changes a calculation/filter/export.

**Inspect:** the area's read-model module, `pick()`, `has()`, `safe()`, the response consumed by the view, and the
corresponding sample generator. Keep reads through `j('/api/…')` and query definitions in `om-core*.js` or `om-reads.js`.

**Example request:** "In [panel/drawer], show [object.field] as [label/format]. If unavailable or not readable, show
[specified state]. Preserve the current calculations and API-request pattern unless an additional read is approved.
Use synthetic sample values, and do not add personal data to assistant context."

**Evidence:** field present, absent, unreadable and null; correct relationship selection and formatting; preserved
calculations/CSV semantics. Use read-model tests with `fakeOrg()` and the relevant view suite when implementation is
authorized. Do not require the tool to access a real customer org just to explain the code.

## Specify a funnel before implementing it

There is no dedicated reusable funnel renderer in `console-charts.js`. Start with a specification and an approved sketch,
then decide whether implementation is in scope. Existing charts and token references are useful patterns, but a Figma
reference alone does not determine how the numbers should be interpreted.

Define:

- Whether stages represent the same cohort progressing over time, or mutually exclusive current-state buckets. Current
  status counts alone cannot establish conversion rates.
- Stage order, time window, entry/cohort rules, unit and the denominator for each rate. State whether stage counts must
  decrease and how repeated events, exclusions and missing stages are handled.
- Whether width or area encodes the count; orientation, alignment, labels, spacing, and how the drawing responds to size.
- Reference dimensions and theme, tooltip/keyboard behavior, drilldowns, CSV columns and accessible text.
- Empty, zero-denominator, single-stage, long-label, large-value and inconsistent-input examples.

**Example request:** "First document a funnel specification for [question], using [available data] and [reference].
Explain any unavailable cohort data instead of inferring conversion. Do not implement a renderer until the semantics and
geometry are agreed. If implementation is subsequently authorized, preserve other panels and use design tokens."

**Evidence for a later implementation:** approved data/geometry examples, proportions and rate calculations, matching
chart/CSV values, focus/accessibility, all themes and responsive layouts. Keep a visual reference separate from the data
fixture so both appearance and meaning can be checked.

## Change a shared drawer or customer detail

Specify the entry point (map, Dashboard or Service Console), record type, section/tab and field/interaction. State how
the drawer opens/closes, where focus returns and how loading/failure states should behave.

**Inspect:** `console-drawers.js` for order/record drawers; `console-service-view.js` for the customer 360;
`console-jcache.js` for eligible cached reads; the relevant read-model and sample functions. A shared drawer change can
affect several views. Keep `openOrder`, `openRecord`, `enterLayer` and their existing sequence/focus handling intact.

**Example request:** "In the [record type] drawer's [section], show [detail] beside [existing field]. Preserve all other
sections, Escape/Back behavior, focus restoration, cache eligibility, URLs and assistant privacy. Test entry from [views]."

**Evidence:** the shared `side-panel/` suites, all affected entry points, rapid selection changes, delayed/failed reads,
empty results, keyboard focus and narrow layouts. The console stays read-only.

## Rename labels or prepare localization

Separate visible wording from mode/tab/panel IDs, data keys, routes and storage keys. Specify the affected labels and
whether the request includes formatting and locale support. The console has inline labels and helpers and no
language packs.

**Example request:** "Rename [visible heading] to [new text] in [view]. Keep the element ID, route, CSV columns, query and
storage keys unchanged. Identify any assistant-context label or test assertion affected by that wording."

**Evidence:** all occurrences in the intended view, long text, accessible names, direct links and exports. A complete
translation system or rebranding needs its own scope and permissions for any new names, fonts, icons or artwork.

## Requests that need further implementation scope

The present console has no general view registry, persisted layout schema, editable theme builder, reusable funnel API
or source-editing workspace bridge. The optional picker copies text, and public CI does not enforce browser execution on
its own. Document these limits accurately. For a documentation-only request, record the gap and the required decision;
do not add a runtime mechanism, dependency, test hook, build change or CI setting to make a recipe work.
