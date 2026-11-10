# 0003. Rules that two places enforce live in leaf modules that import nothing

- Status: Accepted
- Date: 2026-10-26

## Context

Several rules run in more than one place, and they have to give the same answer in each:

- **Customer fields.** The read model and the tests use the same list.
- **Status rules.** What a fulfillment order or a return may move to.
- **Read-only POSTs.** The read model's guard and every transport's sender.
- **Bundles.** How a bundle's lines group, wherever an order is shown.

When those rules sat inside `om-core.js`, a page that needed one imported the whole file. Copies of the rules drifted.

## Decision

Rules shared by two places live in leaf modules that import nothing:

| Module | Holds |
|---|---|
| `om-rules.js` | `CUSTOMER_FIELDS`, `customerRecords`; `STATUS_RE`, `WAREHOUSE_STATUS`, `RETURN_NOT_SET`; `dueLines` |
| `om-http.js` | `isBlocked`, `blockedRefusal`, timeouts, `errorText`, `READ_ONLY_POSTS`, `readOnlyPost`, and the request/answer helpers every transport uses |
| `om-config.js` | the deployment's settings: the hosted sign-in's consumer key and org, and the orgs it refuses |
| `om-bundles.js` | the bundle model (it predates this record) |
| `om-mode.js` | which sign-in mode a page runs in, from its address (ADR 0005); the one leaf that reads the page |

The modules that used to hold these rules re-export them, so importers didn't change. `leaf-modules.test.mjs` checks two
things: each leaf imports nothing, and the old homes hand on the leaf's copy rather than one of their own.

## Consequences

- The page and the tests import the same function. There's nothing to keep in step but the Apex copy.
- A leaf can't reach the network or the DOM, so it's tested directly in Node.
- A rule that needs data reads it as an argument. The callers fetch the facts.
