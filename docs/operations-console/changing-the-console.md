# Changing the Operations Console

Use this workflow with an AI coding tool that can read your checkout. No particular provider or private skill is required.
Start with [AGENTS.md](../../AGENTS.md) and the console rules at the top of [CLAUDE.md](../../CLAUDE.md).

The console has four top-level modes: Operations Console (the map), Dashboard, Service Console and Limits. Shared drawers,
the Data map dialog and the assistant are additional surfaces. Service Console is a read-only mode of this page.

## 1. Set the scope

Say whether the task is documentation-only, a visual change or a functional change, and name what may change. For a
documentation-only task, edit Markdown outside production directories only. Production comments and type annotations are
production-file edits too. Leave tests, fixtures, configuration, assets, dependencies, builds and CI unchanged. Explain a
limitation that needs a broader change rather than implementing it.

The [interface reference](console-interfaces.md) describes the current code. The
[recipes](console-customization-recipes.md) describe potential, separately authorized customer changes. Reading a recipe
does not authorize its implementation.

## 2. See the current page

From the repository root:

```sh
node app/server.mjs
```

Open `http://localhost:5178/?demo=1`. No Salesforce sign-in is needed. Inspect the relevant view in Standard, SLDS light and
SLDS dark, using the theme menu at the top right. The existing design reference is `http://localhost:5178/design/`.
It displays tokens and example components; it is not an editable theme or layout builder.

Record the view/tab, panel heading or existing element ID, theme, viewport and selected range/period. Keep reference
screenshots on synthetic data. For a visual change, describe the intended hierarchy, spacing and behavior as well as
providing a picture. A screenshot cannot define a chart's data semantics.

## 3. Give the AI a precise brief

Fill in this template. The tool should find the owning code using the interface reference, state its understanding and
identify the affected files. It should ask about missing information that materially changes the result and otherwise
proceed within the authorized scope.

```text
Read AGENTS.md, CLAUDE.md's console rules, docs/console-interfaces.md and the relevant
recipe in docs/console-customization-recipes.md.

Scope: [documentation-only / visual / functional; permitted files or areas].
Target: [mode, Dashboard tab, panel title/ID, or drawer; sample-data steps to reach it].
Current result: [...]. Desired result: [...].
Reference: [theme, viewport, approved sketch or screenshot, if relevant].
Behavior/data: [source, filters, units, interactions, empty/error states, if relevant].
Preserve: [existing functionality, appearance, URLs, calculations and other boundaries].

Use the existing design tokens and read-only data routes. Preserve privacy, schema
tolerance, keyboard focus, CSV consistency and the existing refresh/caching behavior.
Identify affected files
and checks. Do not refactor surrounding code or weaken checks to make the task pass.
For an implementation change, add/update the relevant tests and demo data, run the
existing checks and report browser execution/skips. For documentation-only work,
change no production or test files; review links and the diff and run existing checks.
```

The optional edit artifact from `app/tools/build-artifact.mjs` can identify elements on sample data. Its picker supports
Change, Move and Remove and copies a text request; it does not edit the checkout. Its current text mentions Claude Code
and a private `build-oms-console` skill. Without that private setup, identify the element in your local preview and use the
brief above with your coding tool. Verify copied selectors against the current source, since position-based paths can
change after a redraw. The runtime assistant panel answers questions about data; it is not a source-code editor.

## 4. Verify the result

For an authorized implementation, reload the sample page. Compare the requested change with the reference and check the
other themes, wide/narrow layouts, keyboard activation/focus, filters, exports and failure states it affects. For a
documentation-only task, verify the scope through the diff; adding a source hook, type or test is outside that scope.

Run existing checks from the repository root. The public Actions workflow uses Node 22; use a compatible development
runtime for these commands. ESLint is fetched as development tooling and is not an application dependency.

```sh
npx eslint@10 .
node --test "app/test/**/*.test.mjs"
```

The existing syntax check reads each `.js` as a module:

```sh
for f in app/*.mjs app/tools/*.mjs; do node --check "$f" || exit 1; done
for f in app/public/*.js app/tools/*.js; do
  node --input-type=module --check < "$f" || exit 1
done
```

### Browser execution and coverage

The full test command discovers nested suites too. A missing Playwright skips browser tests unless `REQUIRE_UI=1` is set;
an installed driver also needs a usable Chrome/Chromium binary. To require UI execution, replace the path below with your
installed `playwright-core/index.mjs`. Do not add a dependency or change repository configuration just to run it.

```sh
HEADLESS=1 RECORD=0 REQUIRE_UI=1 \
  PLAYWRIGHT=/absolute/path/to/playwright-core/index.mjs \
  node --test "app/test/**/*.test.mjs"
```

[`browser-kit.mjs`](../../app/tools/browser-kit.mjs) documents `CHROME_PATH` for an existing browser binary, `BROWSER=chrome`
for installed Chrome, and the other settings. These tests use synthetic data and need no org. Report the final pass,
failure and skip counts; a green run with skipped browser suites is not evidence of UI verification.

The public [Actions workflow](../../.github/workflows/test.yml) runs syntax, lint and the full test command. It installs
the pinned playwright-core and Chromium and sets `REQUIRE_UI=1`, so a missing browser fails the run.
[`ci-test-files.mjs`](../../app/tools/ci-test-files.mjs) sorts the test files into unit and browser groups by their direct
import of `browser-kit.mjs`; it does not run the tests itself.

Node unit coverage and Chromium browser coverage are supported. Browser execution data is collected when
`UI_COVERAGE_DIR` is set and converted by [`browser-coverage.mjs`](../../app/tools/browser-coverage.mjs); the internal pipeline
imports `coverage/lcov.info` and `coverage/ui.lcov`. A normal local test run does not automatically produce both reports.
See [ADR 0009](../adr/0009-ci.md). No coverage or CI changes are needed for documentation-only work.

### Finding a failure

| Check or symptom | Where to look |
|---|---|
| Raw styling values, missing tokens or contrast | `themes.test.mjs`, `tokens-ratchet.test.mjs`, `console-guard.test.mjs`; [token reference](../shared/design-tokens.md) |
| A new console module has no import test, or a source path is not scanned | `console-guard.test.mjs`, `console-source.mjs`; keep the existing source/build constraints |
| A figure, panel or CSV disagrees | Relevant view suite under `app/test/operations-console/ui/`, its demo payload and `csv-export.test.mjs` |
| Loading, range labels or failures | `load-banner.test.mjs`, `load-harness.mjs`, and the relevant view's UI suite |
| Data reaches the assistant unexpectedly | `agent-context.test.mjs` and the explicit `AGENT` opt-in |
| A query appears in UI code, or the console imports writes | `console-guard.test.mjs`; queries belong in the read model, never the page |

Fix an implementation when it breaks an existing requirement. Update a test only for an authorized behavior change, and
explain the changed expectation. For documentation-only work, record an existing failure without changing code or tests.

## 5. Review and open a pull request

Check `git diff --check` and inspect every changed path with `git diff --name-status origin/main`. A documentation-only
diff must contain only the agreed Markdown files outside production directories. Do not put documentation or scratch files
under `app/public/`: top-level files there are served and included in the console bundle.

Open the PR against `main`, as a draft when requested. Explain the problem, the final change and its scope. Report checks
actually run, browser skips or execution, and manual verification. For documentation-only work, state that production,
configuration, test and build files are unchanged and why no test was added. Follow the existing PR template and check the
required CI results before merge; a reviewer and owner handle approval and merging.
