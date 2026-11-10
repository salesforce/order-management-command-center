# Salesforce Order Management Operations Console

[![Tests](https://github.com/salesforce/order-management-operations-console/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/salesforce/order-management-operations-console/actions/workflows/test.yml?query=branch%3Amain)

A read-only operations console for Salesforce **Order Management**. It shows live orders, fulfillment, exceptions, returns, payments and cases, with a US fulfillment map and a period dashboard. It has no npm dependencies and no build step.

It is built for the people who run an Order Management org day to day. An operations or fulfillment lead watches the Operations Console during the day: KPI tiles, a live map of where demand comes from and which locations ship it, the exception queue and an activity stream, with any order, fulfillment order, shipment or return a click away. A commerce or merchandising manager uses the Dashboard to compare a period with the one before it: channel mix, average basket, cancellations, top customers and returners, and why products come back. Finance follows payments from authorization to refund, and an admin or developer sees in **Data map** exactly which SOQL is behind every panel. It only reads, so it changes nothing in the org it connects to, and it runs on your machine with the sf CLI or as a static page that signs in with OAuth.

**Sample data:** add `?demo=1` to any URL.

| Operations Console | Dashboard | Service Console |
|---|---|---|
| Live operations (turn on **Live** or press Space to refresh every minute): KPIs, fulfillment network map (demand, customers, fulfillment, exceptions, cases, inventory layers), exception queue, activity stream, status board. Click any record to drill in, and click an order's customer to see their value: spend, returns, and rank against other shoppers. | Performance for Today, MTD, QTD, YTD, 6 months, 1 year or All time, against the prior period. Tabs for Orders, Customers (top accounts by spend and orders vs top returners), Fulfillment, Payments, Service and Returns. Every panel exports CSV, and **Data map** lists the SOQL behind it. | A read-only team queue of open cases and exceptions, with exceptions grouped by order, and a customer 360 with search (name, email, phone or order number). Each order shows its stage, line items, ship-to and fulfillment orders (items, shipments, tracking, and a flag on open FOs with no update in 2+ days). Chats expand to the full conversation. Routes: `/api/service/queue`, `/api/service/search`, `/api/service/customer/:id`, `/api/service/chat/:id`. |

Full feature reference: [`app/README.md`](app/README.md).

## Three ways to run it

| Mode | How | Auth | Use it for |
|---|---|---|---|
| **Hosted** (GitHub Pages) | Open the live URL | OAuth 2.0 + PKCE in the browser | Sharing with anyone who can log into the org |
| **Local** | `node app/server.mjs`, then open http://localhost:5178 | `sf` CLI (its own `om-console` alias) | Any org you can reach with the CLI, including sandboxes |
| **Demo share** | `node app/share.mjs`, then open http://&lt;your-host&gt;:5179 | None | Showing sample data on your network |

Requirements: Node 18+ for the local modes, plus the [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli) for **Local**.

```bash
node app/server.mjs                                    # http://localhost:5178
open "http://localhost:5178/?demo=1"                   # sample data, no org
open "http://localhost:5178/?auth=browser"             # test the hosted (PKCE) mode locally
```

## How it works

```
app/public/operations-console/index.html ── the UI (vanilla ES modules, SVG map, no framework)
        │  j('/api/…')
        ├─ local:     fetch → app/server.mjs ── sf CLI token ─────────────────────────────┐
        ├─ hosted:    app/public/operations-console/transport/browser.js ── OAuth PKCE ───┤
        └─ in-org:    app/public/operations-console/transport/platform.js ── session ─────┤
                         (reads through SomConsoleRead)                                    ▼
                 app/public/operations-console/data/core.js + app/public/shared/data/*  (every SOQL query, one copy)
                                                                                          │
                                                                                          ▼
                                               Salesforce REST API  /services/data/vXX.X
```

[ARCHITECTURE.md](ARCHITECTURE.md) maps every module and how a request flows through them. [docs/adr/](docs/adr/README.md)
records why it's split the way it is.

- **One read model.** `operations-console/data/core.js` and the read providers it selects build every query and response, and the server, the browser and the in-org app all load them. The same URL returns the same JSON in every mode.
- **Schema-tolerant.** Each query only selects fields the org's `describe` reports, so optional objects (Shipment, Case, OCI, custom lookups) degrade one panel instead of breaking the page.
- **Read-only.** The only POSTs it sends are Omnichannel Inventory's `get-availability` lookup and Composite calls that bundle GET queries (so a refresh costs a handful of API calls, not dozens). A check in the shared read runtime (`readOnlyPost()` in `om-http.js`) enforces both.
- **Blocked orgs are refused.** Every sign-in path refuses the orgs `CONFIG.blocked` lists (`app/public/shared/transport/om-config.js`, empty by default).
- **Agentforce is the one exception.** Agentforce, bottom right (or <kbd>A</kbd>), opens a chat with Agentforce (the OM Console Assistant agent in Setup). Its questions go to the Agent API through `om-agent.js`, the only file allowed to make those calls, and the agent has read actions only. Each question carries the view's record Ids or filters, never customer names or contact details. See [org/agent/README.md](org/agent/README.md).

## Configure

Run it locally first: `node app/server.mjs`, then open http://localhost:5178 (or http://localhost:5178/?demo=1 for sample data). Local mode signs in through the `sf` CLI and needs nothing set up in the org.

To host the console on any static host (GitHub Pages included), or sign in from the browser, an admin sets up the org once:

1. **External Client App** (Setup → External Client App Manager):
   - OAuth on, scopes `api` and `refresh_token` (add `chatbot_api` and `sfap_api` for Agentforce)
   - **Require PKCE** on, **Require secret** off
   - Callback URL: the hosted page's address (and `http://localhost:5178/` to try `?auth=browser` locally)
2. **CORS** (Setup → CORS):
   - Allowlist the hosted page's origin
   - Tick **Enable CORS for OAuth endpoints**

Then set your deployment's values in [`app/public/shared/transport/om-config.js`](app/public/shared/transport/om-config.js):

| Setting | What it does |
|---|---|
| `clientId` | The External Client App's consumer key. Leave it empty and the sign-in screen asks for it. |
| `domain` | The org the sign-in screen signs in to when its My Domain field is empty (`https://login.salesforce.com` as shipped). Leave it empty and the screen asks. |
| `blocked` | Patterns of usernames and org addresses every sign-in path refuses. Empty refuses nothing. |

For static hosting, generate the deployment files after setting these values:

```sh
node app/tools/shared/static-site.mjs app/artifact/site
```

Use an empty output directory, and upload **its contents** to your host. This preserves the existing
`/`, `/design/` and asset URLs, including when hosted under a subpath. `app/public/`
contains the organized sources and is not the upload directory. The command keeps your configuration,
leaves the sources untouched and needs no internal publishing setup. Generated files stay out of Git.

The local server (sf CLI) also refuses the orgs in `OM_BLOCKED`: comma-separated regular expressions, matched like
`blocked`, for example `OM_BLOCKED='@example\.com$,//example[.-]' node app/server.mjs`. A pattern that isn't valid stops the server
from starting.

The in-org app, its read-only Apex endpoint and the agent are in `org/`; each folder's README says how to deploy it. Replace `yourdomain` in their metadata with your org's My Domain first.

The token is kept in `sessionStorage`, so it lasts for that browser tab only, and it's refreshed automatically. **Disconnect** revokes it. The consumer key is a public client ID, not a secret.

## Turn on Agentforce

The Agentforce panel is optional. The console works fully without it. When the page loads, it checks whether the org has the console's agent (`OM_Console_Assistant_Classic`) with an Active version. If not, the Agentforce button and the pages' Ask buttons don't show. That check only reads; it starts no session and uses no credits.

**Agentforce is billed.** Each conversation uses the org's Flex Credits (or Einstein Requests in older orgs). Check what your org has, and what it has used, in Setup → Digital Wallet before you turn the panel on. When an org runs out, the panel says so and links here.

An admin turns it on once per org:

1. **Turn on Agentforce** in Setup (Einstein and Agentforce Agents), if it isn't on.
2. **Deploy the agent** from [`org/agent`](org/agent/README.md): its Apex actions and `SOM_Agent_Access`, then its topics. Its README has the commands. Deploying changes the org, so ask first if it's shared.
3. **Activate it:** Setup → Agentforce Agents → OM Console Assistant → Activate.
4. **Connect the app:** on the agent's Connections tab, add **Salesforce Order Management Operations Console** under API.
5. **Grant access:** assign `SOM_Agent_Access` to each person who uses the panel.
6. **Hosted or browser sign-in only:** add the `chatbot_api` and `sfap_api` scopes to the External Client App (see Configure), then sign in again. Local mode (sf CLI) needs no extra scope.

Reload the console; the Agentforce button shows bottom right (or press <kbd>A</kbd>). If a question fails, the panel names what's missing:

| The panel says | Fix |
|---|---|
| Agentforce isn't available right now | Steps 1 and 3: Agentforce is on, and the agent is active. |
| This app isn't connected to the agent | Step 4. |
| Sign in again to turn on Agentforce | Step 6, then sign in again. |
| Agentforce has no credits left in this org | Setup → Digital Wallet: add Flex Credits, or wait for the next period. |

To turn the panel off again, deactivate the agent (or don't deploy it). The button then stays hidden.

## Repo layout

```
ARCHITECTURE.md     how the pieces fit together
app/
  server.mjs        local server: sf CLI auth, static files, /api/* → the read model
  share.mjs         demo-only server (sample data, no org access)
  node/             the Node hosts behind server.mjs and share.mjs
  public/
    operations-console/
      index.html    the console: its markup, styles, and the page script (loading, modes, address bar, agent)
      console-*.js  the console's views (map, dashboard, drawers, service, limits), its shared state and its pure helpers
      data/         the console's read providers; core.js selects them
      transport/    hosted (browser.js) and in-org (platform.js) transports
      geo.js        pre-projected US outline (generated)
      cities.js     US city coordinates for the Customers map layer (hand-maintained)
    shared/
      data/         the read runtime, shared reads (orders, customers, org, om-reads.js) and leaf rules (om-rules.js, om-bundles.js)
      transport/    what every transport shares: om-http.js, om-mode.js, om-config.js, om-graphql.js, om-meter.js
      agent/        the Agentforce panel and the Agent API calls behind it (om-agent.js)
      ui/tokens.css design tokens
      design/       the design tokens page
    *.js            compatibility entry points that re-export the modules above
  test/             node --test suites, the fake org, the fake DOM, the Apex source reader
  tools/            builds (edit view, live artifact, in-org bundles, static site), the map outline, the a11y audit
org/                Salesforce metadata: the in-org console app, its read-only Apex, the Order Management app, the agent
docs/
  operations-console/  changing and customizing the console, its interfaces, the live artifact
  shared/           design tokens, the agent's model, Apex limits, what the org does in-org
  adr/              architecture decision records
```

## Testing

Run every test from the repository root:

```bash
node --test "app/test/**/*.test.mjs"
```

Browser UI tests (under a scoped `ui/` folder or importing `app/tools/browser-kit.mjs`) need [playwright-core](https://playwright.dev) and a browser; without them they skip. Public CI installs playwright-core at the exact version in `app/tools/playwright-core.version`, plus Chromium, and runs them on every pull request. To run them yourself, install that version outside the repo, which keeps no `package.json`, and point `PLAYWRIGHT` at it. [CONTRIBUTING](CONTRIBUTING.md#testing) has the details. New tests follow the ownership guidance in [app/test/README.md](app/test/README.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). To customize the console with an AI coding tool, start with
[Changing the Operations Console](docs/operations-console/changing-the-console.md). It links the existing interfaces, task recipes and
verification commands; the workflow does not require a private skill or a particular AI provider. Coding agents should
read [AGENTS.md](AGENTS.md) and the console rules in [CLAUDE.md](CLAUDE.md). Report security issues as
[SECURITY.md](SECURITY.md) says, not in a public issue. Everyone taking part follows the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Credits

The US map outline (`app/public/operations-console/geo.js`) is built from [world-atlas](https://github.com/topojson/world-atlas) (ISC) `countries-50m.json`, made with [Natural Earth](https://www.naturalearthdata.com/) (public domain). Third-party copyright and license notices are in [NOTICE](NOTICE).
