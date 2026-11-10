# AGENTS.md

Instructions for AI coding tools (Codex, Cursor, Copilot, Claude Code and others). You can be working for someone who doesn't know how the code is organised, so follow the rules and tell them what you did in plain words.

**Read the section "Changing the Operations Console? Start here" at the top of [CLAUDE.md](CLAUDE.md).** It says where each part of the console lives and the rules every change follows. The short version:

1. Try the page on sample data: `node app/server.mjs`, then open `http://localhost:5178/?demo=1`. No Salesforce sign-in is needed.
2. Style with the design tokens in `app/public/shared/ui/tokens.css` only. Never write a colour, a spacing, a font size or a radius by hand.
3. Every implementation change comes with a test in `app/test/`. A new `console-*.js` file the page loads, with no test that imports it, fails the suite. For documentation-only work, run existing checks without changing tests.
4. Run `node --test "app/test/**/*.test.mjs"` before you say you're done, and show the result.
5. The console is read-only. Don't write queries in the page and don't add a write layer. Its only POSTs are sign-in and Agentforce's agent calls.

New to the repo? [docs/operations-console/changing-the-console.md](docs/operations-console/changing-the-console.md) walks through a change from start to finish.

New tests use the owner folders in [app/test/README.md](app/test/README.md). Existing test paths stay valid during the refactor.

For AI-assisted customization, use that walkthrough as the starting point, then read the
[existing interfaces](docs/operations-console/console-interfaces.md) and the relevant
[customization recipe](docs/operations-console/console-customization-recipes.md). They describe the current implementation; they do not
authorize a change beyond the user's request. For a documentation-only request, edit Markdown outside production
directories only. Do not edit production files even to add comments or types, and do not change tests, configuration,
dependencies, builds or CI. Report a limitation that requires those changes instead of expanding the task.
