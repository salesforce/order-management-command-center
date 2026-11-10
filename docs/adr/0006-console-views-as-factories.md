# 0006. Console views are factories over one shared state object

- Status: Accepted
- Date: 2026-10-26

## Context

Even with its pure parts out (ADR 0005), the console's page script was about 1,800 lines. Its views wrote shared page state
through top-level `let`s: `S.mode`, `S.data`, `S.dash`, `S.cust`, `S.focusKey`, and more, 29 in all. A view can't leave the
page while it writes the page's variables: an ES module can't assign another module's binding.

Two constraints:

- **No framework, no build** (CONTRIBUTING).
- **No import cycles.** The edit-view artifact's loader (`__omcDef` / `__omcImport`) runs each module once, in order, and a
  cycle would deadlock it.

## Decision

- **One state object.** `console-state.js` exports `S = {}`. Every top-level `let` that more than one part of the page reads
  became a key of `S`, set where the `let` was. The rewrite used TypeScript's own reference finder, so a local or parameter
  with the same name was left alone, and writes, `++` and shorthand properties were rewritten too. A `let` only one part
  uses stayed a `let` and moved with that part.
- **A view is a factory.** `export function createXView(page)` destructures what it needs from `page` (the page's functions
  and the other views'), holds the view's code unchanged inside it, and returns what the rest of the page calls. The page
  calls each factory once, where the view's code used to be, so setup runs in the same order as before.
- **Late binding between views.** A name from a view made later is passed as a wrapper, `name: (...a) => name(...a)`, so
  nothing reads it before it exists. The page also owns what spans views: `load()`, the modes, the agent wiring, and the
  address-bar router (`hashchange`).
- The modules are:
  - `console-map-view.js`: the Operations Console;
  - `console-dash-view.js`: the Dashboard;
  - `console-drawers.js`: the order, record and customer-value drawers;
  - `console-service-view.js`: the Service Console;
  - `console-limits-view.js`: the Limits view.

  `index.html`'s script is now about 330 lines.

How the move was checked:

- a TypeScript check that every name resolves and nothing is used before it's declared;
- template literals compared before and after (none changed);
- all tests;
- a scripted walk of every view, tab, drawer, layer, search and route in demo mode, which matched the walk taken before the
  move.

## Consequences

- A view's own state lives in the view, and shared state is visibly shared (`S.x`).
- Adding a view means a factory, a call in the page, and its names in the call's arguments. The TypeScript check flags a
  name passed before it exists.
- The factories close over their state. They're not components and don't re-render themselves: each view still paints
  through its own `renderX()` / `paintX()` under `keepFocus()`.
- Text tests that matched code at the start of a line now allow for the two-space indent inside a factory.
