# Salesforce Order Management Operations Console, live in Cowork

Salesforce Order Management Operations Console as a Cowork artifact, with live data pulled through each viewer's own **Salesforce** (Headless 360) connector every time the page opens. There are two pages:

- **The full console** (`om-console.html`): the real `index.html`, with all three tabs. Agentforce is off.
- **The daily briefing** (`om-live-briefing.html`): the smaller page this started with, which runs the `briefing` read.

Both are read-only:
- the artifact is allowed to call one tool, `dispatch_readonly`, which only accepts `GET`;
- the pages send only SOQL queries, describes, GraphQL `query` documents and, for the console's Org Limits view, `/limits` and Tooling API queries. They refuse any POST before the call leaves the page.

The edit view (`build-artifact.mjs`) stays separate and keeps sample data only. The approach follows an earlier Cowork artifact, which is where the connector's call and answer shapes come from.

## How it reads

- **The console page:** `build-live-artifact.mjs --console` changes two lines:
  - it turns on the "inside Salesforce" mode (`PLATFORM`), which has no sign-in of its own, by switching `om-mode.js`'s `FORCE` line (`forceMode()`);
  - it imports `app/tools/om-cowork.js` in `om-platform.js`'s place, with the same interface: `route()`, `status()`, `instanceUrl()`.

  It also hides Agentforce, whose chat needs the Agent API's POSTs, and adds the `#omc-tools` block. The page is otherwise inlined as the edit view is (`inlineConsole()` in `build-artifact.mjs`).
- **One core:** both pages run the same `createCore()` as every other path, with `apiVersion()` null, so nothing is batched into `/composite` (a POST).
- **Batching** (`app/tools/graphql-batch.js`): reads issued at the same moment go out as one GraphQL GET, `/graphql?queryInput={"query": …}`. `dispatch_readonly` carries it like any other GET.
  - **Aggregates:** every aggregate that `om-graphql.js` `translate()` turns into one document is merged into one request. Each field gets a unique alias, and the answer is split back for each query's `map()`.
  - **Describes:** these become one `objectInfos`, answered in the REST describe's shape.
  - **The rest:** record queries go one call each, and so do time series, which as GraphQL would take one document per 5 buckets.
- **The connector call:**
  - `artifact-connector.js` sends each GET as `dispatch_readonly({ method: 'GET', url: '/services/data/v66.0/…', queryParams })`. It reads the answer, `{ status_code, body, url }`, learns the org's address from `url`, and refuses an org in `CONFIG.blocked` (`om-config.js`).
  - `artifact-call.js` calls `window.cowork.callMcpTool` with the full tool name, written into the page when it's published. It paces calls at 24 a minute (Cowork allows 30), and retries a rate-limited call after 2, 4 and 8 seconds.

### What batching does on a demo org (2026-10-15)

| Tab | Calls, one per read | Calls, batched | First load |
|---|---|---|---|
| Console | 39 | 18 (6 GraphQL, 11 queries, 1 describe) | about 1.5 s |
| Dashboard | about 79 | 26 (12 GraphQL, 13 queries, 1 describe) | about 5 s |

The answers match the plain REST read, panel by panel, except for four things:
- timestamps;
- the order of tied rows (no SOQL order either);
- REST's `attributes: {type: 'AggregateResult'}` tag on aggregate rows;
- the "now" in the SOQL text a panel shows.

Measured through the console's own built modules, with a stand-in `window.cowork` that sends each call to the org with the sf CLI's sign-in.

What the org taught the batcher:
- **10 data fetchers per request.** At most 10 top-level fields: "The number of data fetchers in the query is 11, exceed the data fetcher limitation 10".
- **One unknown field fails the whole request.** It's a validation error, with no data for any field: `FieldUndefined@[uiapi/aggregate/Refund]`. So an object that `objectInfos` has no info for is kept out of batches. A batch that fails validation sends the objects it names as SOQL, and goes again once without them.
- **"No ObjectInfo" isn't always "missing".** `objectInfos` says it both for objects the org lacks and for ones UI API doesn't support, such as Refund. So that object asks the REST describe, and only its 404 means missing.
- **`objectInfos` covers what describe does.** It lists every field and relationship the REST describe does, on the 15 objects checked, plus UI-only ones (`CloneSourceId`) the console never asks for.

Not yet proven: that Headless 360 passes `/graphql` through, since the org was reached with the sf CLI here. The skill checks it (step 2). If it doesn't, the batcher stops trying GraphQL after the first refusal, and the console reads one call at a time: the same data, but a first load of a few minutes under Cowork's limit.

## Connect Cowork to the org: a custom connector

The pages call whatever Headless 360 connector the viewer has in Claude. Hosted MCP servers don't support dynamic client registration, so Claude must sign in with an OAuth app the org knows: a **custom connector** that uses the org's own External Client App. Claude's directory also lists a Salesforce connector, but whether it can sign in to an org like the demo org hasn't been checked.

**In the org** (once per org; External Client Apps are per org):
1. **Turn on the server:** under Setup → Integrations → API Catalog → MCP Servers, open the Salesforce servers and make sure **headless-360** is Active.
2. **Set up an External Client App** for Claude:
   - OAuth on;
   - the callback `https://claude.ai/api/mcp/auth_callback`, one URL per line next to any others the app already has;
   - scopes *Access Salesforce hosted MCP servers (mcp_api)* and *Perform requests at any time (refresh_token, offline_access)*;
   - PKCE required, no secret for the web server or refresh token flow, and JWT access tokens for named users.

   A change can take 5–10 minutes to apply.
   - **Your org's External Client App for the MCP** (PKCE, no secret): its consumer key is the OAuth client ID Claude uses. It's a public client ID, not a secret.
   - **Its callbacks:** `http://localhost:33418/callback` for Claude Code's `/mcp`, and `https://claude.ai/api/mcp/auth_callback` for claude.ai and Cowork.

**In Claude:**
1. **Add the connector:** a Claude organization Owner adds a custom connector for the team (Claude's guide: "Get started with custom connectors using remote MCP").
   - **Server URL:** see the table below.
   - **OAuth client:** the app's consumer key, as the connector's own OAuth client ID. There's no secret.
2. **Connect it:** each user connects it under Customize → Connectors and signs in to the org as themselves.

| Org | Remote MCP server URL |
|---|---|
| Production | `https://api.salesforce.com/platform/mcp/v1/platform/headless-360` |
| Sandbox | `https://api.salesforce.com/platform/mcp/v1/d/{mydomain}--{sandboxname}/sandbox/platform/headless-360` (confirm this format) |

If sign-in fails:
- **`redirect_uri_mismatch`:** the app's callback list lacks the exact URL Claude sends.
- **`invalid_client` or "invalid client credentials":** a "Require secret" box is on, or a recent change hasn't applied yet.
- In both cases, wait 5–10 minutes after any change before trying again.

Recommended tool permissions: `dispatch_readonly` always allowed, `dispatch` needing approval. These pages never call `dispatch` at all.

## Publish it from Cowork

1. **Build the skill:**
   ```bash
   node app/tools/build-live-artifact.mjs --skill
   ```
   This writes `app/artifact/om-console-live/` (`SKILL.md`, `configure.py`, both unconfigured pages and the design tokens page) and `app/artifact/om-console-live-skill.zip`.
2. **Turn on code execution:** Settings → Capabilities → **Code execution and file creation**.
3. **Connect the org:** connect the Headless 360 custom connector (above) under Customize → Connectors, and sign in to the Order Management org.
4. **Upload the skill:** under Customize → Skills, upload the zip, then select **Turn on**.
5. **Ask for it in Cowork:** *publish Salesforce Order Management Operations Console*, or *publish the Order Management live briefing*. The skill then:
   - finds your connector's `dispatch_readonly`;
   - checks the org (not a blocked org, has Order Management, passes GraphQL);
   - tells you what the page may call;
   - writes the tool name in with `configure.py`;
   - publishes the page with `mcp_tools` set to that one name.
6. **Open the artifact and allow the first call.** Tick "Don't ask again".

To update after a change: rebuild the zip, upload it again, and ask Cowork to "rebuild Salesforce Order Management Operations Console".

Not yet checked: whether Cowork sessions have `python3`.

## Run it locally

The same pages on your machine, with live data, without Cowork:

```bash
node app/tools/serve-live.mjs
```

Then open `http://localhost:5192` for the console, or `/briefing` for the briefing.

- **How it reads:** `serve-live.mjs` stands in for the connector. It answers each `dispatch_readonly` call in the connector's shape, using the `sf` CLI's sign-in for the `om-console` alias. `OM_ORG_ALIAS` and `PORT` work as they do for `server.mjs`.
- **The pages:** they're built with `--local`, so `artifact-call-local.js` takes `artifact-call.js`'s place. That's the only difference.
- **What reaches the org:** only GETs of a SOQL or Tooling API query, a describe, `/limits`, or a GraphQL `query` document (never a mutation). Anything else is refused with a 400.

## Claude Code artifacts

Claude Code can also publish artifacts with connector calls ([docs](https://code.claude.com/docs/en/artifacts#pull-live-data-with-mcp-connectors)). That needs a session signed in to claude.ai on the Anthropic API; this Mac's managed settings force Bedrock. If that path is taken up, `artifact-call.js` is the one file to change.

## What viewers see

- **Their own data:** each viewer's own connector and Salesforce access decide what they see.
- **Outside Cowork:** opened in a browser, the page has no `window.cowork`. The console shows its sign-in screen with the reason, and the briefing says to open it in Cowork.
- **No data is stored in the page:** it ships with no data and reads the org each time it opens or Refresh is pressed. Cowork caches read-only answers for 5 minutes.
