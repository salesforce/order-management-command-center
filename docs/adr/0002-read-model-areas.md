# 0002. The read model is a base plus area modules, joined by a kit and a route table

- Status: Accepted
- Date: 2026-10-26

## Context

`om-core.js` held every query the apps make: the console, the dashboard, the Service Console, records, Commerce, org
limits. It had grown past 3,000 lines with one `route()` made of a long `if` chain. Four transports load it:

- the local server;
- the hosted page;
- the in-org app;
- the Cowork artifact.

Anything that touched it risked the others. The read-only guard, `/composite` batching and `pick()` all lived in the same
closure as the queries.

## Decision

- `om-core.js` is the base:
  - the transport guard (`api()` refuses any POST `readOnlyPost()` doesn't allow);
  - batching (`get()`, `flush()`, `send()`);
  - `soql`, `allRows`, `describe`, `has`, `pick`, `safe`, `read`;
  - `ROUTES`, the route table.
- Each area is a module `om-core-<area>.js` exporting `xReads(k)`. It takes a **kit** `k` (the base's functions, and every
  area's reads once they're made) and returns its reads plus `routes: [[pattern, handler], …]`. A pattern is a path or a
  regex whose groups are its parameters, and a handler takes `(match, q, url)`.
- Areas are made in one list. Their reads are merged into the kit. A call into another area is late-bound,
  `(...a) => k.other(...a)`, so the order areas are made in doesn't matter.
- `route()` walks the table: the first matching pattern answers.
- `om-core.js` re-exports everything it exported before, so importers didn't change.

The split was verified by running the old and the new `createCore` side by side on 130 routes against a recording transport:
identical JSON and identical call sequences (1,252 calls).

## Consequences

- A new read is a function in its area plus a row in that area's `routes`. Shared plumbing stays in the base.
- The read-only guard is in one place that areas can't bypass: they only see `k.soql`, `k.describe` and the rest, never
  `request`.
- Area modules are plain closures over the kit, not classes. Tests keep calling `createCore(…).route(path)`.
- Queries still live only in `om-core*.js` and `om-reads.js`. CLAUDE.md's rule now names the area files.
