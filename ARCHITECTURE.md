# Architecture

How Salesforce Order Management Operations Console is put together: the modules, how a request flows through them, and where each kind of change
goes.

- [README.md](README.md) says what the console does.
- [CONTRIBUTING.md](CONTRIBUTING.md) has the rules and the checklists for adding things.
- [CLAUDE.md](CLAUDE.md) holds the invariants that must not break.
- [docs/operations-console/console-interfaces.md](docs/operations-console/console-interfaces.md) describes the console's
  current component contracts, navigation, lifecycle and configuration, with source links. It introduces no new runtime
  interfaces.
- [docs/adr/](docs/adr/README.md) records why the structure is what it is.

## One console, one read model

Canonical sources live in `app/public/operations-console/` and `app/public/shared/`. The console's `data/core.js` selects
its read providers; its `transport/` composes the shared OAuth or platform runtime. The shared read runtime receives the
providers and owns batching, schema caches and reset behavior.

Node hosts live in `app/node/`; `node app/server.mjs` starts the console's local host. Tests, guides and tools follow the
same owners. Start at [docs/README.md](docs/README.md). Root module and tool entry files are compatibility interfaces,
except the classic `app/tools/a11y-audit.js`, which remains directly pasteable. New code imports canonical modules.

| | Salesforce Order Management Operations Console (`app/public/operations-console/index.html`) |
|---|---|
| For | Operations: the network, the queues, the dashboard, org limits |
| Writes | Never |
| Reads | `/api/console`, `/api/dashboard`, `/api/service/*`, `/api/order/*`, `/api/account/*`, `/api/record/*`, `/api/limits`, `/api/read/<name>` |
| Agent | Agentforce panel (`shared/agent/agent-panel.js`) |

The console is plain ES modules, loaded by the browser as they are. There are no dependencies and no build step. The
builds in `app/tools/` only package the same files for other hosts.

```
   the page                        the transport                                         the org
 ┌───────────────────────┐      ┌────────────────────────────────────────────────┐
 │ index.html            │ j()  │ local:   server.mjs + sf-conn.mjs              │
 │                       │─────▶│ hosted:  operations-console/transport/browser.js│      REST /services/data
 │ ?demo=1: demo data,   │      │ in-org:  operations-console/transport/platform.js│────▶ GraphQL (aggregates)
 │ nothing leaves        │      │ Cowork:  tools/operations-console/om-cowork.js │       Apex REST (SomConsoleRead)
 └───────────────────────┘      └────────────────────────┬───────────────────────┘
                                                         │ every one runs
                                                         ▼
                       createCore({ request, instanceUrl, apiVersion })    operations-console/data/core.js + shared/data/*
                       createAgent(…)                                      shared/agent/om-agent.js (Agentforce only)
```

## Modes and transports

`om-mode.js` decides, once per page, how it reaches the org. Nothing else reads the address bar for this.

| Mode | When | Transport | Notes |
|---|---|---|---|
| `DEMO` | `?demo=1`, or a build that forces it (the edit view) | none | `console-demo.js` answers every route in the same shapes |
| local | localhost, no `?auth=browser` | `fetch('/api/…')` to `server.mjs` | The server gets a token from the `sf` CLI and runs `createCore` itself |
| `BROWSER` | any other host, `?auth=browser`, or a PKCE sign-in under way | `transport/browser.js` | OAuth 2.0 + PKCE, token in `sessionStorage`, rotating refresh tokens |
| `PLATFORM` | `*.my.salesforce.app`, or a build that forces it (the live artifact) | `transport/platform.js` | The user's own session. Reads go through `SomConsoleRead` and GraphQL (row reads and describes too with `?reads=graphql`, off by default) |

Every transport implements the same `request(path, post?)`. The shared parts live in
[`shared/transport/om-http.js`](app/public/shared/transport/om-http.js):

- the blocked-org check (`isBlocked`, over `CONFIG.blocked` from `om-config.js`);
- timeouts;
- error text;
- the read-only POST check (`readOnlyPost`);
- the request and answer helpers.

That's why the same URL gives the same JSON in every mode.

The request meter and GraphQL translator also live in `app/public/shared/transport/`.
Their original root filenames remain compatibility entry points to the same module exports.
[Shared-module ownership](app/public/shared/README.md) describes imports and packaging.

## The read model

`shared/data/read-runtime.js` is the base (ADR 0002). `createCore()` builds:

- **`api()`**, the only door to `request`. It refuses any POST `readOnlyPost()` doesn't allow.
- **`get()` / `flush()` / `send()`**, which pack the GETs issued in one tick into `/composite` calls (5 queries and
  20 describes each).
- **`soql`, `allRows`** (paging past 2,000 rows), **`describe`, `has`, `pick`** (only fields the org has), **`safe`** (one
  failed panel, not a failed page) and **`read`** (the fixed query sets of `om-reads.js`).
- **The kit `k`**, handed to each provider, and the route table `route(url)` walks.

Each provider is one module. It returns its reads and its routes:

| Module | Serves |
|---|---|
| `operations-console/data/console-reads.js` | `/api/console`: KPIs, the network map, exceptions, the activity stream; `/api/filters` |
| `operations-console/data/om-core-dashboard.js` | `/api/dashboard`: the period panels, product rates, the Data map's sources |
| `operations-console/data/queue-reads.js` | `/api/service/queue`: the team queue |
| `shared/data/customer-reads.js` | `/api/service/search`, `/api/service/customer/:id`, `/api/service/chat/:id`: customer search, the 360, chats |
| `shared/data/order-reads.js` | `/api/order/*`, `/api/order-number/*`, `/api/account/*`, `/api/record/*`, `/api/products`, `/api/inventory` |
| `shared/data/display-facts.js` | `/api/policies`: the facts the Dashboard shows |
| `shared/data/om-core-org.js` | The agent's Id, which features are on, org limits |
| `shared/data/om-reads.js` | `/api/read/<name>`: fixed query sets, shared with skills built on them (data, not code) |

Inside Salesforce, aggregate SOQL becomes UI API GraphQL aggregates (`om-graphql.js`), because Apex caps a transaction at
50,000 scanned rows ([docs/shared/apex-limits.md](docs/shared/apex-limits.md)).

Rules that more than one place uses live in leaf modules that import nothing (ADR 0003): `om-rules.js` (status rules,
customer fields), `om-bundles.js` (bundles), `om-http.js`, `om-config.js` and `om-mode.js`.

## The console page

`index.html` holds the markup, the styles (layout only: colours and scale come from `tokens.css`) and a
`<script type="module">` of about 330 lines (ADRs 0005, 0006). The page script owns:

- loading (`load()`, polling, the banner);
- the four modes and switching between them;
- the address bar;
- sign-in and the gate;
- the agent's wiring.

Everything else is a module:

| Module | What |
|---|---|
| `console-state.js` | `S`, the state two or more parts read: the loaded data, the picks, the focus, the open customer |
| `console-map-view.js` | Operations Console: KPIs, the network map (layers, focus, zoom), product search, exceptions, the stream |
| `console-dash-view.js` | Dashboard: tiles, tabs, panels, CSV, the Data map, policies |
| `console-drawers.js` | The order drawer (Details, Activity, Timeline), the record drawers, a customer's value |
| `console-service-view.js` | Service Console: the team queue, customer search, the 360 |
| `console-limits-view.js` | Limits: gauges, the call ledger, the meter, Live |
| `console-kit.js`, `-labels.js`, `-charts.js`, `-panels.js`, `-csv.js`, `-banner.js`, `-geo.js`, `-jcache.js`, `-limits.js` | Shared helpers: escaping and formatting, labels from the loaded payload, charts, panel and CSV stores, the request cache, the limits arithmetic; `panel()` and the request cache keep state |
| `console-demo.js` | The sample data |

A view is a factory, `createXView(page)`, called once by the page. It takes the page's functions it needs on `page`, and
returns what the page calls. A function from a view made later is passed as a wrapper. Each view paints through
`renderX()` → `keepFocus(paintX)`, so a redraw never drops focus.

For a customer change, follow the [customization walkthrough](docs/operations-console/changing-the-console.md) and its
[task recipes](docs/operations-console/console-customization-recipes.md). There is no general view registry, layout configuration schema or
mount/dispose API: the interface reference shows the existing functions an AI tool must inspect before proposing edits.

## Builds

None of these is needed to run the console.

| Build | Makes | How it changes the page |
|---|---|---|
| `build-artifact.mjs` | The edit view (`app/artifact/om-console.html`): one file, sample data, the element picker | Inlines every module through a small loader, and forces `DEMO` (`forceMode('demo')`) |
| `build-live-artifact.mjs` | The live Cowork artifact | Forces `PLATFORM` and swaps in `om-cowork.js`, which reads through the viewer's connector (GETs only) |
| `build-ui-bundle.mjs` | The in-org UIBundles (`org/*/uiBundles`, git-ignored) | Moves inline scripts into files (the CSP allows only `'self'`) and adds `?v=` to every script |
| `build-geo.mjs` | `geo.js`, the map outline | |

A build that meets something it doesn't expect stops with its name and the reason. Fix the build, don't loosen it.

## Tests and CI

`node --test "app/test/**/*.test.mjs"` runs on Node alone. On each pull request `.github/workflows/test.yml` runs it, after a syntax
check of every file. A pipeline that runs the unit and browser tests apart tells them by their imports, not their folder
(`app/tools/ci-test-files.mjs`).

- **The read model:** routes against `fake-org.mjs`, a fake org where any POST fails.
- **JavaScript ↔ Apex:** `apex-source.mjs` reads the `.cls` files, and `apex-sync.test.mjs` compares them with the
  JavaScript.
- **The pages:**
  - the console's helpers imported directly;
  - `load()` run against stubs (`load-harness.mjs`);
  - the agent's steps parsed and applied.
- **What the source shows:** accessibility, themes and contrast, leaf modules importing nothing, the console never loading
  a write layer.

What the tests can't see is checked by hand (CLAUDE.md, Verifying changes): a keyboard walk, `tools/a11y-audit.js` in all
three themes, the local and hosted sign-ins, and `sf project deploy validate` for the Apex.
