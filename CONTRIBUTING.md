# Contributing

Thanks for helping out. The console is deliberately small, with no dependencies and no build step. Please keep it that way.
[ARCHITECTURE.md](ARCHITECTURE.md) shows how the pieces fit, and [docs/adr/](docs/adr/README.md) says why they're split as
they are.

For an AI-assisted console change, follow [the walkthrough](docs/operations-console/changing-the-console.md), with its
[interface reference](docs/operations-console/console-interfaces.md) and [task recipes](docs/operations-console/console-customization-recipes.md). Establish the
permitted scope first. Documentation-only work changes Markdown outside production directories; it does not authorize
refactoring, comments/types in production files, new features, styling, or changes to tests, configuration, builds or CI.
Use the existing checks and review the documentation diff; do not add a test merely to satisfy a documentation change.

## Governance model

**Salesforce Sponsored.** The intent and goal of open sourcing this project is to increase the contributor and user base.
However, only Salesforce employees will be given `admin` rights and will be the final arbiters of what contributions are
accepted or not.

**Maintainers.** [@yogeshreddy83](https://github.com/yogeshreddy83) and [@rkatyalneu](https://github.com/rkatyalneu), who review pull
requests and merge them once CI and the CLA check pass. The team that owns the code is in `CODEOWNERS`.

## Setup

```bash
git clone <this repository's URL> om-command-console
cd om-command-console
node app/server.mjs          # http://localhost:5178, then pick an org on the sign-in screen
```

You need Node 18+ and the Salesforce CLI (`sf`). The server uses its own alias, `om-console`, and never sets a default org,
so your other orgs stay as they are. Use `?demo=1` to work on the UI without an org.

## Where changes go

| You want to… | Edit |
|---|---|
| Add or change a query, panel data, or a drawer's related lists | the read provider that serves it: `app/public/operations-console/data/` (console, dashboard, queue) or `app/public/shared/data/` (orders, customers, display facts, org) |
| Change batching, `pick()`, `describe()` or the read-only guard | `app/public/shared/data/read-runtime.js` (the base) and `om-http.js` |
| Add or change a read (`/api/read/<name>`) | `app/public/shared/data/om-reads.js`. Plugins may reuse these queries, so a change changes what they ask |
| Change how a console view looks or behaves | its module: `console-map-view.js`, `console-dash-view.js`, `console-drawers.js`, `console-service-view.js`, `console-limits-view.js` |
| Change loading, the modes, the address bar or the agent wiring | the page script in `app/public/operations-console/index.html` |
| Change a pure console helper (labels, charts, CSV, the limits arithmetic) | its `console-*.js` module |
| Change the console's sample data | `app/public/operations-console/console-demo.js` |
| Change which mode a page runs in (demo, local, hosted, in-org) | `app/public/shared/transport/om-mode.js` |
| Change local sign-in or static serving | `app/node/shared/host.mjs`, `app/node/shared/sf-conn.mjs` |
| Change hosted sign-in (PKCE, token refresh) | `app/public/shared/transport/browser-runtime.js` |
| Change a rule more than one place uses (customer fields, status rules) | `app/public/shared/data/om-rules.js`, and the Apex copy (the sync test says which) |
| Change the map outline | run `node app/tools/build-geo.mjs countries-50m.json` with world-atlas 2.0.2's file (don't hand-edit `geo.js`) |
| Place a missing customer city on the map | add `Name lat lon` to its state in `app/public/operations-console/cities.js` |

### Checklists for adding things

**A read model route**:
1. A function in its read provider. Read fields through `pick()`, objects through `has()`, and wrap a panel in
   `safe()`.
2. A row in that provider's `routes`: `['/api/x', (m, q) => …]` for a fixed path, or `[/^\/api\/x\/(\w+)$/, (m) => …]` with its
   parameters as groups. `q(key)` reads the query string. Check every Id (`okId()`) before it reaches a query.
3. For a new provider, its module and an entry in `PROVIDERS` in `operations-console/data/core.js`.
4. A test against `fakeOrg()` (`app/test/support/fake-org.mjs`; any POST fails it).

**A console panel**:
1. Its data, as a route above.
2. Its drawing, in the view's module. Use `panel()` from `console-panels.js` if its rows go to CSV or to the agent.
3. Its sample data in `console-demo.js`, so `?demo=1` keeps working.
   `demoData(range)` scales with the range buttons (`RANGE_DAYS`, `rangeScale()`): orders, money and returns with the days,
   open exceptions and holds with their square root, Waiting and Stuck not at all. A new panel follows the same rule, and its
   rows are as many as the number above them says (a stream tab holds 50 at most), so a list never disagrees with its card.
   `app/test/operations-console/unit/console-demo-range.test.mjs` checks these rules, and `app/test/operations-console/ui/operation-console/kpis-range.test.mjs` checks the page shows them.
4. If the agent may read its rows, add it to `EXPECTED_AGENT` in `agent-context.test.mjs`, with a reason. Rows with customer
   details never go to the agent.

**A console view**: a factory `createXView(page)` in its own `console-*-view.js` over the shared state `S`
(`console-state.js`), called once from the page where its code would sit. Pass it the page's functions it calls, and wrap
any from a view made after it: `name: (...a) => name(...a)`. See ADR 0006.
The [interface reference](docs/operations-console/console-interfaces.md) lists the current navigation and loading touchpoints; adding a view
requires an explicitly authorized implementation change.

## Rules

- **Read-only.** Never add a write to the console or to its read model. The only POSTs allowed there are `READ_ONLY_POSTS` and
  GET-only `/composite` batches, both checked by `readOnlyPost()` in `om-http.js`, and it must stay that way.
- **Schema-tolerant queries.** Select fields through `pick()` and check objects with `has()`. Wrap each panel in `safe()`
  so one missing object fails one panel, not the page.
- **One copy of every query and every rule.** Queries live only in the read providers and `om-reads.js`. A rule two
  places enforce lives in a leaf module that imports nothing (`om-rules.js`, `om-http.js`, …; `leaf-modules.test.mjs`).
  Don't add org logic to `server.mjs` or the browser transport.
- **JSDoc on shared exports.** A function exported from `om-reads.js`, `om-rules.js`, `om-http.js` or `sf-conn.mjs` gets a
  JSDoc block: a one-line summary, `@param`s and `@returns`. Say why, not what; no JSDoc on private helpers.
- **Escape user input.** `likeEsc()` for text in LIKE, `ID_RE` for record IDs, and `esc()` for anything rendered into
  HTML.
- **No dependencies, no bundler, no import cycles.** Plain ES modules that browsers load directly. The edit-view artifact's
  loader can't run a cycle.
- **Relative paths in `public/`.** A hosted copy may live under a subpath (GitHub Pages serves from `/<repo>/`), so a
  leading `/` breaks it.
- **Nothing scratch at the top of `app/public`.** Every top-level file there is served and put in the in-org
  bundles.
- **Keep the blocked-org guard** (`CONFIG.blocked` in `om-config.js`, checked with `isBlocked()`) on every sign-in path, refusing with `blockedRefusal()` (the local server adds the `OM_BLOCKED` environment variable's patterns, `envBlocked()` in `sf-conn.mjs`): its `orgBlocked` mark (or a 401) is what shows the sign-in screen, never a 409 alone.
- **A license header on every new file that takes comments** (code, CSS, HTML, XML metadata, YAML): the Apache-2.0
  header, which `node app/tools/license-headers.mjs --write` adds in the right place for its format.
  `license-headers.test.mjs` fails on a file without it.

## Testing

Run `node --test "app/test/**/*.test.mjs"` from the repository root to discover every test recursively, including the nested browser suites.

New suites use the owner folders in [app/test/README.md](app/test/README.md). The migration inventory keeps every existing suite accounted for; explicit moves are recorded instead of replacing the baseline.

Tests use a fake org (any POST fails the test). They include:

- the JavaScript ↔ Apex sync checks (`apex-sync.test.mjs`), which read the `.cls` files;
- the accessibility and theme checks that can be read from the source.
- browser tests under `app/test/operations-console/ui/`: `operation-console/` holds the Operations Console view's tests; `dashboard/` has one suite per domain (all 38 panels and their CSVs), plus KPI/period, page/navigation, shared-control, edge-state, theme and accessibility coverage. Each domain also checks all its panels after changing to YTD and back to MTD. Dashboard tests fix the date in UTC so calendar buckets and comparisons stay repeatable. CI runs tests recursively and identifies browser suites by a scoped `ui/` folder or a direct import of `app/tools/browser-kit.mjs` (`app/tools/ci-test-files.mjs`). A scoped UI suite may import a local helper without repeating the browser-kit import. The Console's tests open `/?demo=1`, so they need no org, and record a named video of each (settings shared in `app/tools/browser-kit.mjs`: `HEADLESS`, `RECORD`, `BASE_URL`). `HEADLESS=1` hides the window, `BASE_URL` points them at a running server; see the header of `walkthrough.test.mjs`.

The `limits/` suites cover the header and alerts, each gauge, request flow, streaming chart and daily projection, ledger and session, reference/search/CSV, page controls, and all three themes with the same accessibility audit. A paused browser clock and known meter entries make polling, hidden-page behavior and live updates repeatable without waiting for real refresh intervals. Fixtures capture the existing Limits factory through a test-only module wrapper; no hooks are added to the application.

The shared `side-panel/` suites cover drawer lifecycle and keyboard focus, order details and history, each supported record type, routing/map focus, customer value and loyalty, empty/error/loading states, delayed responses, and layout/accessibility in all three themes. A test-only module wrapper substitutes sample reads for the drawer's real asynchronous transport and captures its public factory; it adds no application hooks. Map and Dashboard suites retain the checks that their rows open the correct drawers.

Browser execution depends on the environment: missing Playwright skips these suites unless `REQUIRE_UI=1` is set.
The public Actions workflow provisions the pinned Playwright version and Chromium and requires browser execution with
`REQUIRE_UI=1`. The walkthrough explains an explicit browser-required run and the existing coverage paths.

The `service-console/` suites cover the third console tab: queue rows, filters, ownership and all seven date ranges; name/email/phone/order search; customer identity and attention groups; order, item, fulfillment, return and conversation components; routes, shortcuts, layout, failure recovery and all three themes. Test-only module wrappers supply controlled sample reads for customer/search/chat and queue failures. They exercise the actual asynchronous view without Salesforce calls, and the shared side-panel suite covers the contents of the drawers those components open.

**Browser tests in CI.** Public CI (`.github/workflows/test.yml`) runs the browser tests on every pull request, with none skipped
(`REQUIRE_UI=1` fails the run if Playwright or the browser is missing). It installs `playwright-core` at the exact version in
`app/tools/playwright-core.version`, outside the repo, and Chromium with it; internal CI fetches the same version
(`app/tools/ci-fetch-playwright.mjs`). To run them locally:

```bash
npm install --prefix /tmp/pw --no-package-lock --ignore-scripts "playwright-core@$(cat app/tools/playwright-core.version)"
node /tmp/pw/node_modules/playwright-core/cli.js install chromium
PLAYWRIGHT=/tmp/pw/node_modules/playwright-core/index.mjs HEADLESS=1 node --test "app/test/**/*.test.mjs"
```

To move to a newer Playwright, change the one number in `playwright-core.version`; both CIs follow it.

Lint with `npx eslint@10 .` (ESLint's recommended rules, set in `eslint.config.mjs`; npx fetches ESLint, and the console keeps no
npm dependencies). On every pull request `.github/workflows/test.yml` runs the syntax check, the lint and every test under
`app/test`; it needs to be green ([docs/operations-console/changing-the-console.md](docs/operations-console/changing-the-console.md) says how to read a red one). Run the checks yourself before you push. Then check your
change like this:

1. **Sample data:** open `http://localhost:5178/?demo=1` and click through Operations Console, Dashboard, Service Console,
   Limits, the map layers, the drawers and product search.
2. **Keyboard and contrast:** Tab through what you touched, then run `app/tools/a11y-audit.js` on it in all three themes
   (CLAUDE.md, Verifying changes).
3. **Local mode:** sign in to a real OM org and do the same.
4. **Hosted mode, locally:** open `http://localhost:5178/?auth=browser`. This uses the in-browser PKCE flow against the org in
   `om-config.js` or the one you enter (register `http://localhost:5178/` as a callback in its External Client App). Check that:
   - sign-in comes back to the console
   - a reload keeps you signed in
   - **Disconnect** returns to the sign-in screen
5. **Read model refactors:** run the old and new server side by side on different ports (`PORT=5190 …`). Diff the JSON from
   `/api/console`, `/api/dashboard`, `/api/order/<id>` and `/api/record/<Object>/<id>`. Only the timestamps should differ.
6. **Syntax:** check all application and tooling modules recursively, including nested app/shared folders.
   Every `.js` and `.mjs` is parsed as an ES module without executing its code:

   ```bash
   node app/tools/check-syntax.mjs
   ```

## Commits and pull requests

- Commit subjects are short and imperative, describing what the change does ("Add Inventory map layer and Cases activity
  stream"). Use the body to explain why.
- A change that sets a structural rule gets an ADR in `docs/adr/`. Keep personal notes and scratch
  files out of commits. `.gitignore` excludes the old local planning docs and `.claude/`.
- Fork the repository, push a branch to your fork and open a pull request against `main`. The template asks which test you
  added and which modes you tested. A maintainer reviews it; CI must be green before it merges. On a first-time contributor's pull request, CI waits for a
  maintainer to approve the run (GitHub's default for forks); that is expected, not a failure.
- **Contributor License Agreement.** Before we can merge your first pull request, you sign the
  [Salesforce CLA](https://cla.salesforce.com/sign-cla). The CLA check on the pull request links to it; you sign it once
  for every Salesforce open source project. Commit with an email that is verified on your GitHub account, or the check
  can't match you to your signature.
- **License.** By contributing your code, you agree to license your contribution under the terms of the project
  [LICENSE](LICENSE.txt) and to sign the [Salesforce CLA](https://cla.salesforce.com/sign-cla).
- **Security issues** don't go in a public issue or pull request: see [SECURITY.md](SECURITY.md).
- Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Publishing a hosted copy

`app/public/` is static files: serve it from any host. For GitHub Pages, split it out of `main` after your change is merged:

```bash
git subtree split --prefix app/public -b gh-pages
git push origin gh-pages
```

Register the hosted address as a callback in your org's External Client App and allowlist its origin in CORS (README,
Configure). Never publish a copy with real customer data baked in.
