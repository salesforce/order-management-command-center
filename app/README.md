# Salesforce Order Management Operations Console — local app

A local, read-only console for an Order Management org. It uses the sf CLI for auth and has no npm dependencies.

```bash
node app/server.mjs          # → http://localhost:5178
```

- **Sign in:** open http://localhost:5178 and pick Production, Sandbox, or a My Domain URL. This runs `sf org login web --alias om-console` without `--set-default`, so your other orgs and defaults stay as they are.
- **Blocked-org guard:** the server refuses any org whose username or instance URL matches `CONFIG.blocked` in `public/om-config.js` (empty by default) or a pattern in the `OM_BLOCKED` environment variable (comma-separated regular expressions).
- **Sample data:** http://localhost:5178/?demo=1
- **Env vars:** `PORT` (default 5178), `OM_ORG_ALIAS` (default `om-console`).
- **Terminal alternative:** `sf org login web --alias om-console --instance-url https://test.salesforce.com`

## Browser-only mode (GitHub Pages)

`app/public/` also runs with no server, from any static host (for GitHub Pages, publish it as the `gh-pages` branch). Anywhere but localhost the page signs in with OAuth 2.0 + PKCE in the browser and runs the same queries itself; `?auth=browser` forces this mode on localhost and `?auth=server` forces the sf CLI mode. The queries live in the read providers (`public/operations-console/data/`, `public/shared/data/`) and `om-reads.js`, shared by `server.mjs` and the browser transport.

- The token is kept in `sessionStorage` (this tab only) and refreshed with the refresh token when it expires. **Disconnect** revokes it.
- The target org needs:
  - an External Client App with PKCE required, no secret, scopes `api` and `refresh_token`, and this page's URL as a callback (`http://localhost:5178/` too, for local testing)
  - a CORS allowlist entry for this page's origin, with **Enable CORS for OAuth endpoints** on

  Put the consumer key and My Domain in `public/om-config.js` (`clientId`, `domain`), or leave them empty and enter them on the sign-in screen.
- To publish: `git subtree split --prefix app/public -b gh-pages && git push origin gh-pages`.

## Three modes

Press <kbd>V</kbd> or use the **Operations Console / Dashboard / Service Console** switch. The Dashboard lives at `#dashboard`, and each tab has its own link (`#dashboard/customers`).

- **Operations Console** is live operations, refreshed every minute once **Live** is on. The range is Today, 7 days, 30 days, 90 days, 6 months or 1 year. It shows:
  - KPI tiles, including Returns
  - the fulfillment map
  - the exception queue
  - the status board
  - the **Activity stream**, with tabs for Orders, Fulfillment, Shipments, Returns and Cases
  Clicking a row opens that record in the drawer: Order Summary, Case, Process Exception, Fulfillment Order, Shipment or Return Order. Each drawer shows its details, linked records (order, case, fulfillment order) and related lists (lines, shipments, exceptions). Click any of those to drill in, use **← Back** to return, or use **Open in Salesforce**. The order drawer also lists the order's returns and cases.
- **Dashboard** is performance for a period: Today, MTD, QTD, YTD, 6 months, 1 year or All time. Each tile compares against the prior period over the same elapsed time. Every panel has a CSV export, and **Data map** lists the object and SOQL behind each panel. The KPI tiles stay on top, and the panels are split into tabs (press <kbd>1</kbd>–<kbd>6</kbd> to switch):
  - **Orders:** orders per bucket, channel mix, average basket (items and lines per order, unit price, discount rate), cancellations (rate, value, reasons, before/after fulfillment, most-cancelled products), order changes by type
  - **Customers:** customers who ordered in the period (new, repeat, spend and orders per customer, top-10 share of spend, person vs business accounts), then the top 10 accounts by spend, the 10 most frequent shoppers and the top 10 returners. Every row shows orders, spend, returns and return rate, and clicking one opens the account's [customer value](#customer-value) drawer. Canceled orders don't count as spend.
  - **Fulfillment:** speed (order → routed, routed → closed, typical and p90), open backlog by age, location scorecard (volume, fulfilled / rejected / cancelled / open, routing time), status and ship-from mix, location groups, carrier performance
  - **Payments:** authorized → captured → invoiced → refunded, capture and refund rates, open invoice balance, failed payments
  - **Service:** exceptions by category, backlog age and time to resolve, Cases (volume, time to close, origin, status, type)
  - **Returns:** returns per bucket, drivers, most-returned products, days to return, return rate by channel and product, outcome (exchanges, refunds, repayment method)

  Duration panels (speed, time to resolve, days to return, carriers) compute percentiles from the newest 2,000 records in the period. Backlog-age panels are a snapshot of what's open now.

- **Service Console** is a read-only team queue with a customer 360. See [Service](#service).

**Agentforce** is on every view: click Agentforce (bottom right) or press <kbd>A</kbd>; <kbd>Esc</kbd> closes it. Each view keeps its own chat and session, and Dashboard panels have an **Ask** button. In Service, opening the panel on a customer asks for a short brief once per customer. Questions carry record Ids or view filters only. If a reply reports a non-read action, an amber banner says so. Hosted sign-ins from before this feature need to sign in again to turn it on.

## Service

Press <kbd>V</kbd> until **Service Console** is selected (`#service`, or `#service/<accountId>` for one customer). The left side is the team queue and the right side is the customer 360. Nothing on this tab writes to the org.

- **Queue:** open Cases plus open ProcessExceptions, filtered by Cases / Exceptions, Anyone / Assigned / Unassigned and category. The range adds **All open** (no date filter). It shows the newest 300 exception groups and 200 cases, and says so when it's cut off.
  - Exceptions are grouped by order and category, since one order can have thousands of identical rows. The count comes from `GROUP BY` (with Priority in the grouping), and the row takes the highest priority in the group. Unknown or blank priority ranks as Low.
  - Only exceptions with `CaseId = null` get their own row. Exceptions attached to a case show on that case's row ("from exception").
  - Automated Process and queue owners count as unassigned. Only a named person counts as assigned.
  - Rows sort by priority, then newest first.
- **Search:** `GET /api/service/search?q=` looks up name, email, phone and order number with SOQL `LIKE`. It needs 2 or more characters and returns one row per account, up to 10. Order-number matches rank first, then an exact email, then everything else.
- **Customer 360:** `GET /api/service/customer/:id` (`?order=` highlights the order a queue row pointed at, even if it's not in the latest 10). Sections:
  - **Needs attention:** open cases and open exceptions grouped by order
  - **Orders:** the latest 10, one card each:
    - header: number, status, total, date, channel, delivery method and ship-to (OrderDeliveryGroupSummary)
    - a stage bar (Created → Approved → Fulfilling → Fulfilled); an order with fulfillment orders shows at least Fulfilling, since the order status can lag
    - open exceptions as chips coloured by priority; click one to open it
    - **Items:** product lines from OrderItemSummary (`TypeCode = 'Product'`, so delivery charges are left out) with quantity, total, and cancelled / returned / fulfilled counts; the first 6 show
    - **Fulfillment:** each fulfillment order with from → to, delivery method, its items (FulfillmentOrderLineItem), and shipments with carrier, tracking link and due or delivered date. An open FO whose `LastModifiedDate` is 2+ days old is flagged "No update in Nd"
  - **Cases:** open first, then recent closed ones, found by account or by order
  - **Returns & refunds:** recent return orders, refunded total and credit memos
  - **Chats:** live chat transcripts linked by account, contact, case or order. **Conversation** expands the transcript in place: `GET /api/service/chat/:id` reads `Body` for that one chat and parses it into system lines, messages and bot menu buttons

  Click a row to open its drawer. Objects the org doesn't have (Shipment, LiveChatTranscript, ReturnOrder, OrderItemSummary, OrderDeliveryGroupSummary, FulfillmentOrderLineItem) are skipped instead of failing the customer.
- **Keys:** <kbd>V</kbd> switches views, <kbd>/</kbd> focuses search, <kbd>j</kbd> / <kbd>k</kbd> move down and up the queue, and <kbd>Enter</kbd> opens the selected row.

## The map

The map is the real US outline (lower 48 plus Alaska and Hawaii insets), pre-projected into `public/geo.js`. Nothing loads at runtime. Layers: **Demand** (delivery groups by ship-to state), **Customers** (distinct accounts with an order in range, by `OrderSummary.BillingCity`/`BillingState`. Cities are placed from `public/cities.js` (about 1,250 US cities) and the org's Location addresses; unknown cities are pooled, dashed, at the state center. The tooltip lists each city's top three spenders), **Fulfillment** (FOs by ship-to state), **Exceptions** (open ProcessExceptions by bill-to state), **Cases** (Cases created in range, placed by the related OrderSummary/Order ship-to or bill-to state, else `Account.BillingState`, using whichever lookups the org has; the tooltip shows open vs closed and the top origin/type, and the legend says which path placed them). Arcs animate FulfillmentOrder flows from `FulfilledFromLocation` to `FulfilledToState`. Hover a state or location for details, click a location to focus it, and press <kbd>Space</kbd> to turn auto-refresh on or off. Scroll, double-click, the **+ / − / ⟲** buttons or <kbd>+</kbd> <kbd>−</kbd> <kbd>0</kbd> zoom the map (up to 32×, enough to separate neighbouring cities), **⛶** or <kbd>F</kbd> makes the map panel full screen (<kbd>Esc</kbd> exits), and dragging pans it. Markers and labels keep their screen size while zoomed, so crowded locations spread apart, and the zoom survives refreshes.

The **Inventory** layer shows a product search (top right of the map) that matches Product2 `Name`, `ProductCode` or `StockKeepingUnit` (`GET /api/products?q=`, LIKE input escaped server-side). Picking a product calls `GET /api/inventory?id=&range=` and shades states on the blue ramp, rings stocking locations by quantity and dims the rest; the legend names the source used and why earlier ones were skipped. Sources, first match wins:
1. `ProductItem` (QuantityOnHand by location)
2. Omnichannel Inventory availability for the SKU at OCI-synced locations and location groups (`ExternalReference`). This is the one allowlisted POST (`get-availability`), which is read-only.
3. Orders: FulfillmentOrderLineItem units by ship-from location and ship-to state in range, else OrderItemSummary units by delivery state

<kbd>Esc</kbd> or **Clear product** clears the product; any other layer chip leaves Inventory. A Case finds its order through the same OrderSummary lookup the map uses.

The outline is built from `countries-50m.json` in [world-atlas](https://github.com/topojson/world-atlas) 2.0.2 (ISC), made from [Natural Earth](https://www.naturalearthdata.com/) (public domain). To regenerate it: `node app/tools/build-geo.mjs countries-50m.json`.

## Customer value

The **Customer** name in an Order Summary, Return Order or Case drawer opens the account (`GET /api/account/:id`). Nothing is cached or stored: each time you open it, about four Composite calls work out these figures:
- **Spend and orders:** lifetime spend, number of orders, average order, last 12 months, first and last order, canceled orders. Canceled orders are left out of spend.
- **Returns:** how many, the amount, the return rate as a share of spend, units returned, and a "why they return" breakdown by `ReasonForReturn`.
- **Rank against every other shopper:** by spend and by number of orders, plus rank among everyone who has returned something. Ranks come from `GROUP BY AccountId HAVING` counts, so they're exact up to 2000 accounts ahead and shown as "2000+" past that.
- **Badges:** top spender, top by orders, top returner or high return rate, never returned, and active, cooling (no order in over 180 days) or lapsed (none in over 365 days).
- **Loyalty:** program, tier and points from `LoyaltyProgramMember`, `LoyaltyMemberTier` and `LoyaltyMemberCurrency`. If the org doesn't have Loyalty Management, the drawer says so.
- **Recent activity:** recent orders and returns, open and closed cases, and account details.

Panels query OrderSummary, FulfillmentOrder, Shipment, ReturnOrder / ReturnOrderLineItem, ProcessException, Location, OrderDeliveryGroupSummary, OrderItemSummary, OrderItemSummaryChange, PaymentAuthorization, Payment, Invoice, Refund, CreditMemo, Case, Account, LocationGroupAssignment, the Loyalty Management objects (if enabled), and `Agent_Proposal__c` (if deployed). Each query only selects fields the org actually has, With **Live** on, Console and Dashboard panels refresh once a minute, and not while the page is out of focus.

## Reads (`/api/read/<name>`)

`public/om-reads.js` defines reads: fixed sets of queries written as data, where no query depends on another's rows. `GET /api/read/<name>?…` runs one in all three modes and returns `{ read, params, instanceUrl, results }`. Each result is `{ rows, capped? }`, `{ data }` (a Connect GET), `{ skipped }` (the org lacks the object, a key field or a lookup) or `{ error }`. Fields the org doesn't have are dropped, as everywhere else.

| Read | Parameters | What it covers |
|---|---|---|
| `whoami` | `user` (username or Id) | profile, role, permission sets |
| `capabilities` | none | what the org has (counts of orders, OCI locations, delivery setups, stores, entitlements, agents, policies, recent admins), for the plugin's setup |
| `briefing` | — | today vs yesterday, open backlog, stuck FOs (total, by location, oldest and newly stuck), latest exceptions |
| `exceptions` | `range` | open exceptions by category, status and order; oldest and newest; closed in the window |
| `performance` | `period` (`today`, `week`, `lastweek`, `month`, `lastmonth`, `quarter`, `year`) | the period vs the one before: orders, units, fulfillment, shipments, returns, exceptions, cases |
| `order` | `order` (number or Id) | the order timeline's queries, plus its customer and delivery groups |
| `customer-search` | `q` | accounts, contacts and orders matching a name, email, phone or order number |
| `customer` | `account` (Id) | orders, spend, open fulfillment, shipments, returns, refunds, cases, exceptions, chats |
| `case` | `case` (number or Id) | the case and its order, exceptions, returns, chats, emails, comments |
| `service-queue` | `range` | open cases and exceptions by age, priority and owner |
| `service-performance` | `period` | cases opened and closed against the prior period, by owner, channel and type; closed cases for time to close; missed milestones; returns and refunds |
| `fulfillment-backlog` | `range`, `location` (optional, name or Id) | open FOs by location, status and delivery method; aging; stuck; FO exceptions |
| `locations` | `q` (optional) | locations and their open FOs |
| `location` | `location`, `period` | one location vs the prior period |
| `routing` | `fo` (Id; a number finds the FO but not the explanation) | the FO and its routing explanation |
| `product-search` | `q` | products by name, code or SKU |
| `inventory` | `product` (SKU, code or Id), `range` | on hand, shipped (fulfilled or picked up) and in flight by location, demand by state |

Order and case numbers match with or without leading zeros. Search text is escaped and capped at 80 characters. "Open" and "stuck" are defined once in `om-reads.js` (`OPEN_PE`, `OPEN_FO`, `STUCK`). Skills built on these reads copy the same queries, so changing a read changes what those skills ask.
