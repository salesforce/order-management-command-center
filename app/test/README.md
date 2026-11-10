# Test ownership

Run the existing suite with `node --test "app/test/**/*.test.mjs"`.
Implementation changes still require the relevant browser and integration checks from CLAUDE.md.

New tests belong under `operations-console/`, `shared/`, `architecture/` or `integration/`. App suites use `unit/`, `integration/` and `ui/` as needed. Shared fixtures and
harnesses live in `support/`. Keep one assertion suite per behavior; source-path moves are recorded
in the baseline inventory.

CI treats tests under a `ui/` folder as browser tests even when they import a local harness.
Legacy tests importing `browser-kit.mjs` remain browser tests too. Other suites run in the unit
job; fake-browser unit tests need no Chrome. Both lists remain recursive and disjoint.

`architecture/refactor-baseline.json` records the pre-refactor test inventory, ownership and
legacy export/read names at its source commit. Keep that baseline intact. For a one-to-one move,
add an explicit old-to-new entry to `moves`, keep its owner and remove the old suite. New suites
go in an owner folder. Mixed-test splits need their own reviewed case mapping before moving.

`architecture/case-baseline.json` records all 1,809 cases executed on main at `9ce36e5`.
CI records actual executions with `support/case-reporter.mjs`; `tools/shared/check-case-parity.mjs`
rejects missing, failing or skipped baseline cases. New cases supplement the baseline.
Record case reports with `TZ=UTC`, as both CI jobs do: two existing names include timestamps
constructed from local calendar dates. Their UTC identities were captured from unchanged main;
the test fixtures and assertions remain unchanged.

Architecture checks enforce import direction, provider composition and unchanged implementation
bodies. Contracts compare recorded responses and requests, HTTP/assets, auth, coverage
and deployments. Browser tests execute in CI with `REQUIRE_UI=1`; a missing browser fails setup.

Visual parity uses `node app/tools/golden.mjs --base-ref <baseline> --pixels` with the console's
themes and viewports. SVG animation clocks are fixed; DOM, computed styles, focus and pixels are
compared without rewriting baselines. Intentionally excluded internal tests remain explicit in
the inventory and `.gitattributes`.
