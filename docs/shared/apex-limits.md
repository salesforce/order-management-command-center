# Apex limits in the in-org console

Inside Salesforce (`*.my.salesforce.app`) reads go through the `SomConsoleRead` Apex REST class, so Apex governor
limits apply. Local and hosted modes call the REST API and are not affected. This page lists the limits we have hit,
the ones we could hit, and how the console avoids them.
What each kind of call costs against the org's daily API requests, measured in-org, is in
[API requests: what counts](#api-requests-what-counts); Order Management's hourly Connect limit follows it.

## Limit we hit: 50,000 query rows per transaction

`System.LimitException: Too many query rows: 50001`, from `SomConsoleRead.query` (`Database.query`), via `batch`.

- A non-aggregate query counts the rows it returns. An **aggregate query counts every row it scans**, not the groups it
  returns. `COUNT(Id)` over a year of orders on a 1.7M-order org scans about 145k rows and fails alone.
- `/batch` runs up to 5 reads in **one transaction**, so row counts add up. A `LimitException` cannot be caught: it
  fails every read in the batch, so healthy panels show the error too.
- Seen on a large production org (1,730,923 OrderSummary): 1 year fails everywhere, 6 months fails on the activity
  stream and exception queue. The demo org (about 1.7k orders) never hits it.

### How the console avoids it

| Mechanism | Where |
|---|---|
| Aggregate SOQL is translated to UI API GraphQL aggregates (`POST /services/data/v68.0/graphql`), which have no Apex row cap | `om-graphql.js`, called from `om-platform.js` `request()` |
| `HAVING` is emulated: group, order by the aggregate, `first` up to 1999, filter in the client | `om-graphql.js` |
| `ORDER BY COUNT_DISTINCT(lookup)` is sorted in the client from one page of up to 1999 groups | `om-graphql.js` |
| Apex-bound aggregates and `GROUP BY` queries go as their own `GET /query`, never in a batch | `om-platform.js` |
| Non-aggregate row queries stay batched (they count returned rows, at most 2000 each) | `om-platform.js`, `MAX_BATCH` 5 |
| Apex limit text becomes: "This range has too many records for the in-org console. Pick a shorter range, or open the console locally." Raw text stays in `detail` | `om-platform.js` |

GraphQL errors are not retried through Apex, with one exception: `FieldUndefined` (the object, such as `Refund`, is not in
GraphQL's schema) and `SObjectException` (the server cannot run that shape, such as a `GROUP BY` through relationships on
`Case`) are deterministic, so the query runs once on Apex, alone. Any other GraphQL error is shown as it is.

## Limits we can still hit

| What | Why | Effect |
|---|---|---|
| **Map city panel** (`COUNT_DISTINCT(AccountId) … GROUP BY BillingState, BillingCity ORDER BY …`) with **1,999 or more cities** | A sort over a partial page would be wrong, so `map()` throws `incomplete` and the query falls back to Apex, which scans too many rows | That panel only shows the friendly error |
| **Dashboard orders and returns over time**, only for **All time**, series over about 100 buckets (day grain over ~100 days, hour grain over ~4 days), an unreadable user time zone, or unsupported shapes | Translated otherwise: buckets are computed in the user's time zone and counted one aggregate per bucket (GraphQL has no time zone option, so native date grouping would be off by 7-8 h). All time has no lower bound to bucket from | Those cases stay on Apex, alone, and fail on a large range |
| Aggregates ordered by `SUM/MAX/MIN` of a lookup field | Not translatable | Apex, alone; fails on a large range |
| Any aggregate `translate()` rejects (OFFSET, `LIMIT` without `GROUP BY`, multi-key or odd `ORDER BY`, date functions) | Falls back to Apex | Fails alone on a large range |
| Row queries at `LIMIT 2000` | Seven on the dashboard, batched at most 5 per call, about 10k rows | Safe today. More row queries per panel set could add up past 50k |

## Other limits to know

| Limit | Value | Note |
|---|---|---|
| GraphQL `first` | 2000 max, but `first:2000` with a lookup `groupBy` such as `AccountId` fails (misleading `SObjectException`) once 2000+ groups exist, so the cap is **1999** | Seen on a large production org |
| GraphQL groups per query | `offset + first` at most 4000 | Queries grouped by `AccountId` are already limited |
| GraphQL latency | 1-25 s; grouping by `Account.Name` takes 16-20 s on 1.7M rows | GraphQL POST uses the 60 s timeout |
| Queries per Apex transaction | 100 | `/batch` of 5 stays far below |
| Heap (6 MB sync) | 6 MB | Another reason for the small batch |
| Non-aggregate scans | Only returned rows count | Out of scope; row queries stay `LIMIT`ed |

## Other limits, by likelihood on a 1.7M-order org

Full analysis (where each is hit, current and recommended mitigation, **verify** markers) is in the spec section "Other
Salesforce limits we can run into, and mitigations". Summary:

| Limit | Value | Risk here | Mitigation now / next |
|---|---|---|---|
| Daily API requests | 100,000 plus a per-licence amount (Enterprise: 1,000 per Salesforce licence; Unlimited and Performance: 5,000), plus add-ons; Developer Edition 15,000. A rolling 24 hours. See [API requests: what counts](#api-requests-what-counts) | Low in-org on a demo org: only Apex REST counts, about 6 calls a console load and 8 a Dashboard load, measured. Higher locally and hosted, where every `/composite` counts | Live is opt-in. Next: dedupe, TTL cache. Where GraphQL doesn't count, read through GraphQL rather than Apex REST |
| Concurrent long-running Apex requests | Transactions over 5 s (callout time excluded): 10 for orgs up to 1,000 licences, one more per 100 licences, at most 50. The error code isn't confirmed | Agentforce replies hold a request 15-20 s | Next: friendly message plus one retry; one Agentforce question in flight per user |
| Concurrent API requests | 25 requests running 20 s or more in production and sandboxes, 5 in Developer and Trial orgs. Error `REQUEST_LIMIT_EXCEEDED`. Covers REST and Apex REST; whether in-org GraphQL is covered, **verify** | Slow `Account.Name` group-bys, four to six at once | Next: cap in-flight GraphQL reads at 4; group by `AccountId`, fetch names separately |
| Heap (sync) | 6 MB | `batch()` re-serializes 5 results of up to 2000 rows | `MAX_BATCH` 5. Next: stop the deserialize, narrow selects, measure |
| CPU (sync) | 10,000 ms | `batch()` JSON work; `describe()` on wide objects. Not measured | Next: measure; cache `describe` in the browser |
| SOQL length | 100,000 characters | Id lists (300 ids is about 7k) | `translate()` refuses over 20,000 |
| REST URL length | **verify** (16 KB recalled; 8 KB at proxies) | 300-id `IN` as a lone `GET` is about 9-10 KB encoded | Next: send SOQL over about 2,000 characters via `/batch` |
| `QUERY_TIMEOUT`, non-selective scans | Index and selectivity rules, **verify** | `OrderedDate` filters, period `all`, `NOT IN (SELECT ... FROM Invoice)` | Next: custom index on `OrderSummary.OrderedDate`, Query Plan, rewrite the anti-join. Apex path answers `BAD_REQUEST`, so the timeout text is shown raw |
| GraphQL size and cost | 10 subqueries per request (30 behind a gate), up to 2,000 records each; child-to-parent 5 levels, parent-to-child one level. Cost-based protection only observes for now; enforcement is planned | Low | Keep documents at 10 subqueries or fewer (`graphql-batch.js` does) |
| Session expiry | Org session timeout, **verify** | Wallboards on Live | Next: stop Live on a double 401 |
| Permissions, FLS, sharing | n/a | Non-admins see smaller totals or empty panels (`.catch(() => [])` hides failures) | Next: access check and "No access to X" |
| Agentforce (Agentforce) | Usage allowance, **verify** | Low to medium | One question per user at a time |

Priority order: request fan-out (cache, dedupe, cap), `Account.Name` group-bys, named Apex errors, `batch()` heap,
safe Live defaults, long SOQL via `/batch`, `describe` cache, access gaps. For 1 year and `all` analytics that need exact
answers (repeat and new customers), plan Data Cloud or CRM Analytics.

## API requests: what counts

Unlike a Lightning component, the in-org app has no Aura path. Aura calls (an LWC's `@AuraEnabled` Apex) never reach the
API counter. The app calls REST endpoints with the user's session instead, and each kind of endpoint is counted its own way.
Measured on a demo org (Enterprise production, 20.1M a day) on 2026-10-27, in the deployed app.

| Call | Locally and hosted | In-org (app domain) |
|---|---|---|
| REST `/query`, `/describe` | 1 each | Not reachable (401) |
| `/composite` | 1 for up to 25 subrequests | Not reachable (401) |
| Apex REST (`SomConsoleRead`) | 1 each | **1 each, measured.** The app domain gets no exemption |
| UI API GraphQL `query` | 1 each (unused there) | **Didn't count on a demo org, measured.** Depends on an org setting, below |
| `ConnectApi` inside Apex | n/a | Not the daily counter, but Order Management's hourly limit, below |

**The burst test.** From inside the app, each burst was followed by four quiet minutes, with the counter read once a minute:

| Burst | Counter rise per minute after it | Counted |
|---|---|---|
| None (control) | 49, 77, 62, 34 | Other traffic |
| 200 Apex REST calls (`limits?only=api`) | **256**, 23, 49, 8 | About 200: once per call |
| 200 GraphQL queries, 1 subquery each | 47, 9, 12, 4 | About 0 |
| 40 GraphQL queries, 5 subqueries each | 10, 37, 53, 14 | About 0 (the later rise came too late to be ours) |

**One load, measured.** Two loads of each view made exactly the same calls:

| View | Calls the page makes | Apex REST (counted) | GraphQL (not counted on a demo org) | Other |
|---|---|---|---|---|
| Operations Console, 90 days | 25 | 6: 4 `/batch`, 2 `/query` | 16 | CSRF read, `chatter/users/me`, Salesforce's `ui-telemetry` POST |
| Dashboard, month to date | 102 | 8: 5 `/batch`, 3 `/query` | 90 | 4, as above |

Locally, the same views cost about 8 and 14 `/composite` calls (an estimate from the tests' fake org, which returns no
rows). So on an org like the demo org, in-org is the cheapest mode. A Dashboard on Live every 5 minutes costs about 100
calls an hour per open tab.

**Why GraphQL can differ by org.** In core (264), the counter is `APIRequestFilter.filterRequest()`. REST and Apex REST
always go through it. `LightningRequestHandler` marks app-domain requests (and Lightning ones) with a bypass, but only the
Connect framework's limiters read that flag. UI API and GraphQL take the bypass when the org counts Connect requests with
the Enterprise API limiter (gate `ui.services.connect.useEnterpriseApiRateLimitForConnectRequests.enabled`, or an org
preference). Otherwise `UiApiRateLimiterImpl` counts them, and GraphQL's own docs say each subquery counts. Before
moving reads to GraphQL to save calls in another org, run the burst test there.

**How to measure.** `SomConsoleRead` stamps `api=<used>/<max>` on every response (`X-SomConsole-Limits`). Read it only
from bursts:
- **Lag:** the counter takes up to a minute to show a call.
- **Jumps:** readings seconds apart can differ by 10, because they're served from different servers. Take the highest of
  3 quick readings.
- **Other traffic:** it's a rolling 24 hours, so as calls arrive, yesterday's drop off. Other traffic swung from 5 to 77
  a minute. Small blocks of 10 calls, or single loads, sit inside that noise.
- **Tooling:** use a burst of a few hundred calls of one kind, then four minutes of readings. The managed Google Chrome
  closes itself on `*.my.salesforce.app`, so drive Playwright's own headless shell.

### Row reads through GraphQL (prototype)

Row queries and describes can go through UI API GraphQL too, so they would not count against the daily limit on an org
like the demo org. It is a prototype. It was compared live on the demo org (see "Measured live" below).

**Turn it on.** Add `?reads=graphql` to the console's address, on the app-domain address itself, for example
`https://<org>--c.my.salesforce.app/app/c__SOM_Console?reads=graphql`. The Order Management tab frames the app's address,
so the switch has to be on the address that is framed. Without it, nothing changes. The option is `graphqlReads` in `createPlatform()` (`om-platform.js`), off by default.

**What moves, and what stays.**

| Read | With `?reads=graphql` |
|---|---|
| Row queries that `translateRows` (`om-graphql.js`) understands | GraphQL `query` |
| Describes | GraphQL `objectInfos` |
| Aggregates | GraphQL, as before |
| Search (SOSL), stock, delivery estimates, product lookups, duplicate checks | Apex, as before |
| `/limits`, `/features`, Agentforce | Apex, as before |

**Fallback.** Apex answers a read that GraphQL cannot run:
- A query `translateRows` does not understand goes to Apex without a GraphQL call.
- A field or object missing from GraphQL's schema (`FieldUndefined`, `SObjectException`, a validation error) sends that read to Apex.
- An object GraphQL does not know (Refund, a custom object it hides) is remembered for the page (`noGraphql`).
- A field GraphQL refuses is remembered for the page too (`noGraphqlPaths`), as the object and path the error names. A later read that uses that field, or anything under it, goes straight to Apex.
- A read whose own document would trip the query-only guard (user text with "mutation" in a `LIKE`) goes to Apex.
- Any other error is thrown, as it is.

**Merging.** Reads issued in the same tick share a request. Up to 10 row reads go as one document (aliases `r0`, `r1`,
and so on), and up to 20 describes as one `objectInfos`. A lone read goes as its own document.
- When a shared document is refused for a field or an object the error names, only the reads that use it go to Apex. The rest are sent again together, once. This runs only when the answer has no data.
- Any other failure of a shared request sends each read in it again alone, and each follows the fallback rules above.

**Measured live.** On 2026-10-27, on a demo org, in the deployed app with this branch's code served in its place (nothing deployed):
- The Operations Console data was identical. The only differences are row shape: no `attributes.url`, none of the Apex serializer's implicit lookup keys (`AccountId` when only `Account.Name` was selected) or relationship `Id`s, and explicit `null`s where Apex omits nulls. That matches the REST `/query` shape local and hosted modes use.
- The Dashboard was identical except the order of its `sources` list.
- Apex calls per load:

| View | Switch off | Switch on |
|---|---|---|
| Operations Console, 90 days | 6 | 3 |
| Dashboard, month to date | 8 | 4 |

It is not 2 and 3 because two describes that `objectInfos` cannot answer still go to Apex alone: `Agent_Proposal__c` (not in the org, so Apex's 404 says so) and `Refund` (not in UI API).

**Not verified yet.** The drawer routes (`/api/order`, `/api/record`), the Service view, products and inventory. A full 10-read shared document (only 8 and 7 were seen live).

**Console only.** GraphQL's describe returns fields, relationships and `createable`. It has no picklist values or record
types. The console doesn't read those through it, so `?reads=graphql` is safe there.

## Order Management's hourly Connect limit

Order Management's Connect APIs have their own limit, apart from the daily one: org value `OMConnAPIFmlyReqLimit`, per org
per hour, metered by each method's cost (core 264, `commerce-ordermanagement-connect-api` families).

| Licence | Per hour |
|---|---|
| Lightning Order Management (`LightningOrderManagementOMAPILimit`) | 2,000 |
| Salesforce Order Management (`SalesforceOrderManagementStdAPILimit`, `…1COMAPILimit`) | 60,000 |
| Default | 3,000 |

- **Families it covers:** `OrderSummaryFamily`, `RepricingFamily`, `OrderPaymentSummaryFamily` and `RegisterGuestBuyerFamily`. Fulfillment orders have their own (`FllConnAPIFmlyReqLimit`). Not checked: return orders, carts, exchanges, Omnichannel Inventory.
- **Apex counts too.** The console's `ConnectApi.Repricing` and inventory reads in `SomConsoleRead` are metered even in-org: the app domain's bypass is switched off inside Apex (`ApexResourceWrapper`).
- **Locally and hosted,** Connect REST calls draw on the same family limits.
- **Not confirmed:** the error when it's exceeded. Connect REST documents a 503 for rate limits.

## If it still fails

1. Pick a shorter range (30 or 90 days), or open the console locally (REST API, no cap).
2. Check the panel's `detail` for the raw Apex message.
3. To fix a panel, translate its query in `om-graphql.js` (needs a GraphQL equivalent), or split it per calendar
   bucket count as `series` does.
