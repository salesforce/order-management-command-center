# CLAUDE.md

Guidance for AI coding agents working in this repo. Read [README.md](README.md) for what the app is, [ARCHITECTURE.md](ARCHITECTURE.md) for how its modules fit, and [CONTRIBUTING.md](CONTRIBUTING.md) for the rules and the checklists for adding a route or a view. This file covers what's easy to get wrong.

## Changing the Operations Console? Start here

The Operations Console is six views plus Agentforce, the agent panel, all on `app/public/operations-console/index.html`'s page. A change to any of them follows the rules below. Start with the provider-neutral [customization walkthrough](docs/operations-console/changing-the-console.md), then use the [existing interfaces](docs/operations-console/console-interfaces.md) and [task recipes](docs/operations-console/console-customization-recipes.md). Those references document the current code; future customization examples require their own authorization. A documentation-only request permits no production-file edits, including comments or types.

| Part | Where it lives |
|---|---|
| Operations Console (the map) | `console-map-view.js` |
| Dashboard | `console-dash-view.js` (charts in `console-charts.js`) |
| Service Console (queue and customer) | `console-service-view.js` |
| Limits | `console-limits-view.js`, `console-limits.js` |
| Drawers (order, fulfillment, record) | `console-drawers.js` |
| Data map | `index.html` (`#dataMapBtn`) |
| Agentforce, the agent panel | `agent-panel.js` |

1. **Try it on sample data.** `node app/server.mjs`, then open `http://localhost:5178/?demo=1`. No sign-in, no org. Look at it in all three themes.
2. **Design tokens only.** Every colour, space, font size, weight, radius and transition comes from `app/public/shared/ui/tokens.css` (`docs/shared/design-tokens.md` lists them; `app/public/shared/design/` shows them). Never type `#fff`, `12px` or `red` into a style. `themes.test.mjs` and `console-guard.test.mjs` fail when you do, and list the offending text and file; `tokens-ratchet.test.mjs` does the same for letter-spacing, line-height, font-stretch, z-index and opacity and names the token to use. If no token fits, say so and ask; don't invent a value.
3. **Every implementation change comes with a test**, in `app/test/` (any folder; CI runs them all). Documentation-only work uses the existing checks without changing tests:
   - new logic, a helper or a new `console-*.js` file: a unit test that imports it. `console-guard.test.mjs` fails on a console file the page loads that no test imports;
   - a number, label or layout the user sees: update its UI test under `app/test/operations-console/ui/` (`operation-console/` for the map view, `dashboard/` for Dashboard, `service-console/` for Service Console, `limits/` for Limits, `side-panel/` for shared record drawers). They skip locally without Playwright, so check by reading them: `rg "<the label>" app/test`;
   - a query or a route: a test against `fakeOrg()` (`app/test/support/fake-org.mjs`).

   Put new suites in an owner folder following [app/test/README.md](app/test/README.md); existing paths remain valid during migration.
4. **A new number, card or panel needs sample data** in `console-demo.js`, so `?demo=1` keeps working, and an `EXPECTED_AGENT` entry in `agent-context.test.mjs` if the agent may read it.
5. **Data comes only from routes.** Queries live in the read providers and `om-reads.js`. The page calls `j('/api/…')`; never write `SELECT` in it.
6. **Read-only.** The console sends no change to Salesforce: it never mentions `om-actions.js` (`console-guard.test.mjs` fails if it does), and its only POSTs are sign-in and Agentforce's agent calls.
7. **Before you say it's done:** `node --test "app/test/**/*.test.mjs"`, and show the result. Tell the person what you changed and which test covers it, in plain words.

## Architecture in one paragraph

`app/public/operations-console/index.html` is the whole UI. It calls `j('/api/…')`:
- **Locally** (localhost), that's a `fetch` to `app/server.mjs`, which gets a token from the `sf` CLI (alias `om-console`).
- **Hosted** (GitHub Pages, any other host, or `?auth=browser`), `j` calls `route()` in `app/public/operations-console/transport/browser.js` instead. That file signs in with OAuth 2.0 + PKCE and keeps the token in `sessionStorage`.

- **Inside Salesforce** (served from `*.my.salesforce.app`, a Multi-Framework app opened from the App Launcher), `j` calls `route()` in `app/public/operations-console/transport/platform.js`. The page uses the user's own session, which can't call `/services/data/…/query`, so reads go to the read-only `SomConsoleRead` Apex REST class (`org/console-app`). Same-tick row reads are batched to its `/batch` (5 at most). Aggregate SOQL is translated by `om-graphql.js` to UI API GraphQL aggregates, because Apex caps a transaction at 50,000 scanned rows; see `docs/shared/apex-limits.md`. With `?reads=graphql` on the console's address (a prototype), plain row reads and describes go to GraphQL too, merged per tick, with Apex as the fallback. `app/tools/build-ui-bundle.mjs` builds the UIBundle from `app/public`: it moves inline scripts into files (the CSP allows only `'self'`) and adds `?v=` to every script. See the plugin's `references/multi-framework.md`.

All modes use `shared/data/read-runtime.js` with the providers that `operations-console/data/core.js` selects.
The shared runtime owns the read-only guard, batching, schema caches and route dispatch. Root facades keep
existing imports working. [ARCHITECTURE.md](ARCHITECTURE.md) maps the modules. `?demo=1` uses the console's
sample data. Shared `om-mode.js` selects demo, local, browser or platform mode.

**The console's page.** `index.html`'s `<script type="module">` keeps loading, the modes, the address bar and the agent wiring. Its views are factories over one shared state object, `S` (`console-state.js`): `console-map-view.js` (Operations Console), `console-dash-view.js`, `console-drawers.js`, `console-service-view.js` and `console-limits-view.js`. Its pure parts are the other `console-*.js` modules. A view's own state stays in the view; anything two parts read is a key of `S`.

**Edit view.** `app/tools/build-artifact.mjs` builds `app/artifact/om-console.html` (git-ignored) for the plugin's "point at what to change" step, published as a Claude Code artifact. It's one self-contained page:
- **Sample data only:** `DEMO` is forced on, and the page never fetches anything.
- **Everything inlined:** scripts, ES modules (through a small `__omcDef`/`__omcImport` loader) and images.
- **Edit mode** from `app/tools/artifact-picker.js`: pick an element, choose Change, Move or Remove, and "Copy as prompt".

`public/` isn't changed. The build stops with `build-artifact: …` when the page changes in a way it doesn't expect: `om-mode.js`'s `FORCE` line (which `forceMode()` switches), a new import/export form, or a missing image. Fix the build when that happens; don't loosen its checks.

**Live console.** `app/tools/build-live-artifact.mjs` builds Salesforce Order Management Operations Console as a live Cowork artifact (git-ignored, in `app/artifact/`), read through each viewer's own Salesforce (Headless 360) connector. The edit view keeps sample data.
- `--console` builds the real `index.html` with `PLATFORM` on and `tools/om-cowork.js` in `om-platform.js`'s place. Agentforce is hidden: its chat needs POSTs. Without the flag it builds the smaller `briefing` page (`artifact-live.*`). The build stops when either switched line changes (`om-mode.js`'s `FORCE`, and the page's `om-platform.js` import); fix the build then.
- `graphql-batch.js` batches same-tick reads into GraphQL GETs: translatable aggregates in one document (at most 10 data fetchers), and describes as one `objectInfos`. Everything else goes one by one. One unknown field fails a whole GraphQL request, so objects UI API doesn't know (Refund) are kept out of batches. A read whose part of a batch fails goes again on its own.
- `artifact-connector.js` sends each GET as one `dispatch_readonly` call and reads the answer (`{ status_code, body, url }`). `apiVersion()` is null, so nothing is batched into `/composite`. Every POST is refused before it leaves the page, and an org matching `CONFIG.blocked` (`om-config.js`) is refused too.
- `om-cowork.js` exports `createPlatform({ onRequest })`, as `om-platform.js` does, and reports every connector call to the Org Limits view's meter.
- `artifact-call.js` calls `window.cowork.callMcpTool` by the full tool name, which `cowork-skill/configure.py` writes into `#omc-tools` when the page is published. It paces calls under Cowork's 30 a minute.
- `--skill` builds the Cowork skill that publishes both pages (`cowork-skill/SKILL.md`). Its `mcp_tools` allowlist is `dispatch_readonly` only, never `dispatch`. The skill also carries the design tokens page (`build-artifact.mjs --tokens`), which calls no tool and is published with no `mcp_tools`.
- Locally, `node app/tools/serve-live.mjs` serves both pages built with `--local`: `artifact-call-local.js` takes `artifact-call.js`'s place, and the server answers `dispatch_readonly` calls with the sf CLI's sign-in. It answers only GETs of `/query`, `/sobjects/X/describe`, `/graphql` (a `query` document only), and the Org Limits view's `/limits` and `/tooling/query`.
- See `docs/operations-console/live-artifact.md`.

The Agentforce panel (`app/public/shared/agent/agent-panel.js`, bottom right) also goes through `j()`: `POST /api/agent/session`, `POST /api/agent/message` and `DELETE /api/agent/session/:id`. The server (agent token from `/agentforce/bootstrap/nameduser`) and `transport/browser.js` (the OAuth token, which needs `chatbot_api sfap_api`) both hand those to `createAgent()` in `app/public/shared/agent/om-agent.js`. The agent's Id comes from `GET /api/agent/info` in `shared/data/om-core-org.js`. Its source is in `org/agent/`.

The console has no lookups. Its Agentforce gets what's open instead: a fulfillment order's drawer sends its routing explanation (`routingFacts()` in `console-drawers.js`), and a product on the map's Inventory layer sends its stock by location (`productFacts()` in `index.html`).

## Invariants — do not break

- **Read-only.** No DML and no POSTs except the `READ_ONLY_POSTS` allowlist, `READ_ONLY_POST_RE` (Order Management's Estimate Delivery Date calculation and its pickup estimate) and `/composite` requests that `readOnlyPost()` in `om-http.js` has checked contain only GET queries and describes. This is a safety property, not a style choice.
- **`SomConsoleRead` (Apex) stays read-only.** It runs one `SELECT`, one SOSL `FIND` or a describe as the user, with `AccessLevel.USER_MODE`, plus a few read-only lookups the page can't make itself (stock and a delivery estimate in `SomConsoleConnect`, Order Management's product search and details). Its describe also says `createable`, the record types, and each picklist's active values. Without those values, in-org status pickers come up empty. It also reports the org's limits (`GET /somconsole/limits`, from `OrgLimits`, no query), says whether `SomConsoleConnect` is deployed (`GET /somconsole/features`), and stamps every response with an `X-SomConsole-Limits` header for the live Limits view. It contains no DML and no callouts. The queries come from the read model; don't write queries in Apex. Production deploys run `SomConsoleReadTest` (`--test-level RunSpecifiedTests`).
- **Agent calls are the one exception to read-only.** Only `om-agent.js` makes them, and only the three Agent API calls in its `ALLOWED` list. The read model must never import it. The agent itself has only read actions; never add a write action to `org/agent/`. Its own two, Run Query and Describe Object (`SomAgentQuery` and `SomAgentDescribe` in `org/agent`), run a SOQL `SELECT` the agent writes, or a describe, as the user (`USER_MODE`), on the Order Management objects in `SomAgentQuery.OBJECTS` only (lookup paths included), never a personal field or `FIELDS()`, with no DML (`agent-query.test.mjs`). The context line sent with each question carries record Ids and view state only, never names, emails, phone numbers or addresses.
- **Bundles go together.** A bundle, a set or an add-on (`OrderItemSummaryRelationship` rows from a main line to its parts, and `MainOrderItemSummaryId` on each part) is one item everywhere. `om-bundles.js` (imports nothing) is the one model: `bundlesOf()` groups the lines. An org without the fields reads as it always has.
- **Batching.** `soql()` and `describe()` go through `get()`, which packs GETs issued in the same tick into `/composite` calls (5 queries + 20 describes each; one call against the org's daily limit). Don't loosen `READ_URL` to let other resources in.
- **Queries live only in the read providers (`operations-console/data/*`, `shared/data/*`) and `om-reads.js`.** If you need data, add it to its provider and a row in that provider's `routes`. Don't duplicate SOQL in the Node host or the transports.
- **Reads (`om-reads.js`) are data, not code.** Each read is a fixed set of queries served at `/api/read/<name>`; no query may depend on another's rows. Skills built on these reads copy the same queries, so a change here changes what those skills ask. `orderHistory()` runs the `order` read, and it reads no personal data: keep names, emails, phones and addresses in the read's `customer`/`deliveryGroups` queries, which it skips. Connect-GET reads (`api:`) may use several Id tokens and URL-encoded `{q}`/`{sku}`.
- **Schema tolerance.** Every field goes through `pick()`, every object through `has()`, and every panel through `safe()`. Orgs differ: `Agent_Proposal__c`, Shipment, Case lookups and OCI may be missing. 404s from `describe` on missing objects are expected.
- **Blocked-org guard.** `CONFIG.blocked` in `om-config.js` (empty by default; a deployment lists the orgs it refuses) is checked with `isBlocked()` (`om-http.js`) on every sign-in path. Keep it. Its refusal is `blockedRefusal()`: a 409 marked `orgBlocked: true`, which the server carries in its error body (`ERROR_FIELDS`).
  The page shows the sign-in screen for that mark or a 401 (`isAuthFailure()` in `console-banner.js`), never for a 409 alone.
- **Relative URLs in `public/`.** A hosted copy may be served from a subpath (GitHub Pages serves from `/<repo>/`). `src="/geo.js"` or `location.href = '/'` breaks the hosted build.
- **No dependencies, no build.** Browsers import the ES modules directly, and Node imports the read model from `public/`.
- **Sample data stays in sync.** A new panel needs matching fields in `demoData()` / `demoDash()` / `demoExtra()` in `console-demo.js`.
- **Design tokens live in `app/public/shared/ui/tokens.css`**: the three themes' colours, then scale and component tokens (buttons, tags, fields, cards, popovers, tables, charts). Style with them, never with raw values: spacing, font sizes and weights, radii, transitions and tints included, not only colours. A page's `<style>` keeps only layout, and no colour outside the theme blocks (`themes.test.mjs` checks the page's colours and their scale, `style="…"` attributes included, with `offScale()`). A new colour goes in all three theme blocks and must pass the contrast tests. `app/public/shared/design/` shows them all; see `docs/shared/design-tokens.md`.
- **Accessibility.** The console meets WCAG 2.2 AA as far as a page can check itself, in all three themes. `a11y.test.mjs` and `themes.test.mjs` check what they can from the text; `app/tools/a11y-audit.js` checks the rendered page (see Verifying changes); the rest is a check by hand.
  - **Structure.** Each page has a banner (`<header class="top">`), a `<main>` and an h1. `#app` is a `<div>`, because a header inside a `<section>` is no banner. The console's `<main>` is `display:contents`, so the grid lays out its children as before. The sign-in screen is a `<main>` of its own. Headings go down one level at a time.
  - **Contrast.** Every theme's text tokens reach 4.5:1 on every surface, and `--line2` reaches 3:1. Placeholders use `--muted`. A tinted fill costs contrast, so:
    - tone text on a tint mixes in `--ink`: `color-mix(in srgb,var(--tone) var(--tint-ink),var(--ink))`;
    - `--muted` text on a tint steps up to `--ink2`. Each page's `:is(…)` rule does this, and links too, for the tinted surfaces it lists. A new tinted surface with text goes in that list.
  - **Fade colour, never text.** What recedes (a filtered timeline box, a map location out of focus, a row out of focus, stale totals) turns grey (`filter:grayscale(1)`) and `--muted`. It doesn't get `opacity`, which fades its text below 4.5:1 while it's still clickable.
  - **Targets are at least 24 px** (2.5.8), or spaced so a 24 px circle around them is clear. The map's locations get a hit circle (`hitR`) sized to the map's scale.
  - **Everything that opens on a click opens from the keyboard.** Use a `<button>` or an `<a>`. A row or map mark that has to stay a `<tr>`, `<div>` or `<g>` gets `tabindex="0"`; a `<div>` also gets `role="button"`, and focusable rows that only reveal details are list items in a `role="list"`. The console's keydown then clicks it on Enter or Space, and `recAttr()` adds the `tabindex` to record rows.
  - **What hover shows, focus shows.** A tooltip opens on focus too, at the element (`tipAt()`, `showDTip()`). On the map, the locations are buttons and the list of states beside it takes focus.
  - **Every chart has a name.** A chart is `role="img"` with an `aria-label` that sums it up. Use `aria-hidden="true"` for a legend key that sits beside its own text. A column chart is one tab stop: ← → step through its columns and read each one into `#dlive`.
  - **Everything has a name.** Every field, icon-only button, image and dialog is named (`aria-label`, a `<label>`, `alt`). Chips and segmented buttons say which one is selected with `aria-pressed` (`pressed()` sets it with `.on`); tabs use `aria-selected`.
  - **Focus is never lost.** A console panel that redraws goes through `keepFocus()`: `renderX()` calls `paintX()`, then focus goes back to the same element. The drawer and the Data map are layers (`enterLayer()` / `leaveLayer()`): they take focus when they open, keep Tab inside, and give focus back when they close.
  - **The ring stays.** Never remove `--focus-ring` without drawing another in its place. Only a container that script focuses (`tabindex="-1"`) shows none.
  - **System settings are honoured.** Motion stops under `prefers-reduced-motion`, the map's flows included. `tokens.css`'s `forced-colors` block keeps the selection and the ring visible in Windows high contrast, in system colours only.

## Gotchas already hit

- **Mode detection:** on localhost, Salesforce redirects back to `/?code=…` *without* `?auth=browser`. Browser mode therefore also turns on when `sessionStorage` has `omc.pkce` or `omc.auth`. If you touch `BROWSER` in `om-mode.js`, keep that.
- **Refresh tokens rotate:** each refresh returns a new `refresh_token`, and the old one stops working. `refresh()` stores the new one and skips refreshing when the failed request used a token that's already been replaced (`staleToken`). Many panels query at once, so concurrent 401s are normal.
- **`safe()` swallows errors** inside panels. That's why `route()` in `browser-runtime.js` rechecks the session afterwards, and why the server calls `requireConn()` before `core.route()`. That way a dead session shows the sign-in screen instead of a page of failed panels.
- **The OAuth redirect URI must match exactly:** `location.origin + location.pathname` without `index.html`. Register a callback for each place the page runs: `http://localhost:5178/` and your hosted copy's address. A new host or port needs a new callback in the External Client App.
- **The `sf` CLI redacts `accessToken`** in `org display`, so `server.mjs` calls `org auth show-access-token`.
- **Focus events need a focused window.** In the Browser pane or a headless run, `el.focus()` moves `document.activeElement` but fires no `focus` event until the page itself has focus, so tooltips on focus seem broken. Click into the page first, and check that `document.hasFocus()` is true.
- **A hidden Browser pane doesn't paint.** CSS transitions don't finish there, so colours measured right after a theme switch are halfway (a Standard button read with Light's background). Timers are throttled too, so a long scripted walk through views can outlast an eval's 30 seconds: start it, keep the result on `window`, and read it later.
- **What the org does in-org** is in [`docs/shared/gotchas/in-org.md`](docs/shared/gotchas/in-org.md): the app domain's session, what Apex can and can't call, Apex name case. Read it before you change `platform-runtime.js`, the Apex in `org/`, or a new API in-org.

## Connecting your org

Local mode needs only the `sf` CLI. The hosted and Cowork modes need an admin to set up the org once:
- **External Client App** with OAuth 2.0 + PKCE and no secret, scopes `api refresh_token` (add `chatbot_api sfap_api` for Agentforce), and a callback for each place the page runs (see the redirect URI gotcha above). Its consumer key is a public client id, not a secret: put it in `CONFIG.clientId` in `app/public/shared/transport/om-config.js`, or leave that empty and type it on the sign-in screen.
- **CORS:** allowlist the hosted copy's origin (and `http://localhost:5178` for `?auth=browser`), with CORS for OAuth endpoints on.
- **`app/public/shared/transport/om-config.js`** is this deployment's settings: `clientId`, `domain` (the org the sign-in screen uses when the My Domain field is empty) and `blocked` (orgs to refuse).
- **Headless 360 MCP** (the Cowork live console): a second External Client App for the MCP, PKCE, no secret, scopes MCP + refresh token. See `docs/operations-console/live-artifact.md`.

Treat org configuration changes as outward-facing: confirm with the user before deploying metadata to an org.

## Verifying changes

- Syntax, one file at a time: `node --check` on each `.mjs`, and `node --input-type=module --check < file.js` on each `.js` in `app/public` and `app/tools`. Plain `node --check` reads a `.js` file there as CommonJS and passes an ES module with a syntax error, and given several files it checks only the first.
- Lint: `npx eslint@10 .` (ESLint's recommended rules in `eslint.config.mjs`, no plugins or installed packages). A browser global the pages start using goes in its `BROWSER` list.
- The browser UI tests run in public CI too, with `REQUIRE_UI=1` and `playwright-core` at the exact version in `app/tools/playwright-core.version` (internal CI fetches the same one); locally they skip without `PLAYWRIGHT`, so run them with it when you change the UI (CONTRIBUTING, Testing).
- `.github/workflows/test.yml` runs the syntax check, the lint and every test under `app/test` on each pull request. Run all three yourself before you push.
- `node --test "app/test/**/*.test.mjs"`
- Run the server (`node app/server.mjs`) and exercise `?demo=1`, the local sf mode, and `?auth=browser`.
- For a UI change, Tab through the views you touched in the console with `?demo=1`. Check three things: whatever opens on a click opens with Enter, the focus ring shows at every step, and no redraw drops focus to the page (`document.activeElement` stays off `<body>`).
- Then run `app/tools/a11y-audit.js` on each view you touched, in all three themes; it should report nothing. Paste the file into the browser's console (or load it as a `<script>` from a local static server on `app/tools`), turn transitions off first (`*{transition:none!important}`), and call `a11yAudit()`. It checks names, roles, ARIA references, keyboard reach, contrast (gradients included), headings, landmarks and target size. It can't check focus order, what a screen reader says, or forced colours.
- In-org Apex: `sf project deploy validate` (check-only) from `org/console-app` with `--test-level RunSpecifiedTests --tests SomConsoleReadTest --tests SomConsoleConnectTest --tests SomConsoleAgentTest` compiles and tests without changing the org. A real deploy needs the user's yes.
- After changing the agent (`org/agent`'s instructions, or its reasoning model), run `node app/tools/agent-check.mjs --label <name>` against the org before and after, and `--compare` the two. It asks Agentforce the same questions on the console through the real page and checks each answer's steps, submitting nothing. See `docs/shared/agent-model.md`.
- For refactors of the read model, diff old vs new server JSON across `/api/console`, `/api/dashboard`, `/api/order/:id` and `/api/record/:obj/:id`. Only the `at` / `prevTo` / "now" timestamps may differ.
- For a headless check of hosted mode, use Playwright with the installed Chrome (`channel: 'chrome'`):
  1. Get a UI session from `sf org open --target-org om-console --url-only`.
  2. Open `?auth=browser`, enter the org's My Domain and click `[data-env="borg"]`.
  3. The approval page forwards on by itself after a few seconds.
  4. Assert that data arrives with zero `localhost:5178/api/` requests.

## Publishing

The user must ask before you push or publish. A hosted copy serves `app/public/` as static files from any host; never publish one with real customer data baked in.
