# 0005. The console's page script is an ES module, and builds switch its mode in one place

- Status: Accepted
- Date: 2026-10-26

## Context

`index.html` carried the whole console in one classic `<script>`, about 4,000 lines. Its pure parts (labels, charts, CSV,
the limits arithmetic, the demo generators) were marked with `// x:pure begin/end` comments. Tests cut them out of the
page's text and evaluated the text they cut.

The builds rewrote the page's text to set its mode:

- the edit-view artifact turned `DEMO` on;
- the live artifact turned `PLATFORM` on.

Each build matched one line of the script. Any change to that line broke the build.

Static serving listed every module by name in three places:

- `server.mjs`;
- `build-ui-bundle.mjs`'s `SHARED`;
- the sync that copies the reads into skills.

## Decision

- The page script is `<script type="module">`. It imports its pure parts from `console-*.js` modules, which tests import
  directly.
- The mode comes from `om-mode.js`: `modeOf({ search, hostname, signingIn }, force)` returns `DEMO`, `AUTH`, `PLATFORM` and
  `BROWSER`. The file's one switch is `const FORCE = null;`. A build that needs a mode rewrites that one line through
  `forceMode()` in `build-artifact.mjs`, and stops if the line isn't there.
- The edit-view bundler inlines the page script as one more module (`__omcImport('index.html')`).
- `build-ui-bundle.mjs` keeps `type="module"` when it moves inline scripts into files.
- `server.mjs` serves any top-level `.js` in `app/public` (`/^\/([\w-]+\.js)$/`).

## Consequences

- No test cuts code out of the page by markers any more. Text checks that must see the console's code read
  `console-source.mjs` (the page plus its modules). The few that still evaluate a function from the page's text (the load
  harness, the CSV download) cut it by its signature.
- A module script runs deferred and in strict mode. The page already waited for the DOM, and nothing relied on sloppy mode
  (the TypeScript name check found no undeclared assignment).
- A new module is served, bundled and synced without being listed anywhere. The other side: anything at the top of
  `app/public` gets served and bundled, a scratch file included, so keep scratch files out of it.
