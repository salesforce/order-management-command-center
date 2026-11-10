---
name: om-console-live
description: Publish Salesforce Order Management Operations Console, the Order Management operations console (KPIs, fulfillment network map, exceptions, orders, fulfillment, returns and cases; dashboard and service tabs), or its smaller daily briefing, as a Cowork artifact that reads live data, read-only, through the user's own Salesforce connector. Also publishes the OM design tokens page (colours, buttons, tags, charts and the rest, in each theme), which needs no connector. Use when the user asks to open, install, publish, set up, rebuild or refresh Salesforce Order Management Operations Console, the OM live console, the OM live briefing, or the OM design tokens.
---

# Salesforce Order Management Operations Console, live

This skill's folder holds three finished pages:

| Page | Artifact id | Title | Publish it when the user asks for |
|---|---|---|---|
| `om-console.html` | `om-console-live` | Salesforce Order Management Operations Console | Salesforce Order Management Operations Console, the console, the live console (the default) |
| `om-live-briefing.html` | `om-live-briefing` | Salesforce Order Management Operations Console · Live briefing | the briefing, the daily briefing |
| `om-design-tokens.html` | `om-design-tokens` | OM design tokens | the design tokens, the design system, the style guide (see below: it reads nothing) |

**The design tokens page reads nothing.** It shows the apps' colours, type, spacing, buttons, tags, fields, tables and charts with sample values, and calls no tool. To publish or rebuild it, skip steps 1 to 4 and 6. Present `om-design-tokens.html` from this skill's folder as it is, as an HTML artifact with the id and title above, and give it no `mcp_tools` at all. If it exists, update it. The rest of this skill is about the other two pages.

To read the org, a page needs the full name of the user's own Salesforce connector tool `dispatch_readonly`, which differs between connector installs. You write that name into the page and put the same name, and only that name, on the artifact's `mcp_tools` allowlist.

The pages only read. They send `GET` requests to `/services/data/v66.0/query` (SOQL `SELECT`s), `/services/data/v66.0/sobjects/<Object>/describe`, `/services/data/v66.0/graphql` with a GraphQL `query` document (no mutations), and, for the console's Org Limits view, `/services/data/v66.0/limits` and `/services/data/v66.0/tooling/query`. They refuse anything else, and never need `dispatch`. The console batches its reads into GraphQL, so it makes about 20 calls per load, under Cowork's 30 a minute.

## What the user is asking for

- **Publish, install, set up or open** a page for the first time: follow steps 1 to 6 for it.
- **Rebuild** (republish, update) it: follow steps 1 to 6 again. Always configure the page from this skill's folder, never the published copy (`configure.py` refuses a configured page). In step 5, update the existing artifact.
- **Refresh** it, or show live data: follow "Refreshing" at the end.

## 1. Find the connector tool

Look through your tools for a Salesforce connector: a group of tools sharing one prefix that includes `…__discover`, `…__describe`, `…__dispatch` and `…__dispatch_readonly`. You need the full name of the last one, for example `mcp__<connector-id>__dispatch_readonly`. The allowlist matches the full name; the bare `dispatch_readonly` is rejected.

- **None:** tell the user no Salesforce connector is connected, then stop until they have one. The pages need a Headless 360 **custom connector**, because hosted MCP servers don't allow dynamic client registration:
  1. In the org, `headless-360` must be Active under Setup → Integrations → API Catalog → MCP Servers.
  2. The org needs an External Client App with the callback `https://claude.ai/api/mcp/auth_callback`, the scopes `mcp_api` and `refresh_token`, PKCE, and no secret.
  3. A Claude organization Owner adds a custom connector with the server URL `https://api.salesforce.com/platform/mcp/v1/platform/headless-360` (sandboxes and test pods differ), and the app's consumer key as its own OAuth client ID.
  4. The user connects it under Customize → Connectors and signs in to their Order Management org.
- **Sign-in fails:** `redirect_uri_mismatch` means the app lacks the claude.ai callback. `invalid_client` means a "Require secret" box is on. After any change to the app, wait 5–10 minutes before trying again.
- **More than one:** check each one in step 2 and ask the user which org to use.

## 2. Confirm the org

Call that connector's `dispatch_readonly` with each of these, in turn:

```json
{"url": "/services/data/v66.0/query", "method": "GET",
 "queryParams": {"q": "SELECT Id, Name FROM Organization"}}
```

```json
{"url": "/services/data/v66.0/query", "method": "GET",
 "queryParams": {"q": "SELECT COUNT() FROM OrderSummary"}}
```

```json
{"url": "/services/data/v66.0/graphql", "method": "GET",
 "queryParams": {"queryInput": "{\"query\":\"query{uiapi{aggregate{OrderSummary{edges{node{aggregate{Id{count{value}}}}}}}}}\"}"}}
```

- The first answer's `url` shows the org's domain. If it is an org the pages refuse (`CONFIG.blocked` in `om-config.js`), stop: these pages won't run against a blocked org.
- If the second query fails with `INVALID_TYPE`, the org has no Order Management: tell the user and stop.
- The third checks that the connector passes GraphQL. If it fails, the console still works, one call per read, but a first load can take a few minutes under Cowork's limit: tell the user, and offer the briefing instead.
- Tell the user the org's name and domain.

## 3. Tell the user what it may call

Tell the user, before publishing:

- the one tool name the artifact will be allowed to call;
- that `dispatch_readonly` only accepts `GET`, and the page sends only SOQL and Tooling API queries, describes, `/limits` and GraphQL queries, so it can't change anything in the org;
- that Cowork asks before the page's first call, and that each viewer sees only what their own Salesforce access allows.

Go on when they agree.

## 4. Configure the page

Write the configured copy into a folder you can write to, such as the session's working folder, not into this skill's folder:

```bash
python3 <skill folder>/configure.py <skill folder>/<page> \
  mcp__<connector-id>__dispatch_readonly <writable folder>/<page>
```

`<page>` is `om-console.html` or `om-live-briefing.html`. The script checks the tool name and that the page hasn't been configured already. On an error, report its message and stop.

## 5. Publish

Present the configured page as an HTML artifact with the id and title from the table above, and set its `mcp_tools` to exactly the one full tool name from step 1. Never add `dispatch`. If an artifact with that id exists, update it rather than creating another.

## 6. Tell the user what to expect

Ask them to open or reload the artifact and allow the page's first call (tick "Don't ask again" so each read doesn't wait on the dialog). Then:

- **The console** shows the org's name at the top right and fills its panels within a few seconds. Agentforce (the agent) is off in this copy: its chat needs calls the read-only tool can't make.
- **The briefing**'s status pill at the top right reads "Live".
- **A sign-in screen or "Not connected"**, with a note that no connector was configured: the page was published without step 4. Configure it and publish again.
- **An error saying the tool is not in this artifact's `mcp_tools` allowlist:** the allowlist and the name in the page differ. Publish again with the name from step 1 on both.
- **"Not in this org", or an empty panel:** normal where an object is missing (Shipment, Agent_Proposal__c).
- **"Artifact MCP rate limit exceeded":** Cowork allows 30 calls a minute. The page paces and retries; ask them to wait a minute and press Refresh.

## Refreshing

The pages read the org each time they open and when the user presses Refresh. You can't press it, so check the setup and have the user reload:

1. Find the connector tool and confirm the org (steps 1 and 2).
2. If the artifact doesn't exist yet, offer to publish it (steps 3 to 6) and stop.
3. If you published it in this conversation and the tool name has changed since (the connector was reinstalled), rebuild it.
4. Otherwise ask the user to reload it or press Refresh, and tell them what to expect (step 6).
