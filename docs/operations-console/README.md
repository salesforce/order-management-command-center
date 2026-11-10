# Operations Console

Owns the Operations Console, Dashboard, Limits, data map, drawers and read-only Service Console tab.

- Code: `app/public/operations-console/`.
- Tests: `app/test/operations-console/{unit,integration,ui}/`; browser journeys are grouped by view.
- Tools: `app/tools/operations-console/`; existing root commands remain supported.
- [Customization walkthrough](changing-the-console.md), [interfaces](console-interfaces.md), [recipes](console-customization-recipes.md), [live artifacts](live-artifact.md).

Import this app's modules or shared browser-safe modules. Never import a write layer or the aggregate compatibility modules. Query through the app's read profile; keep the UI read-only.

Try `node app/server.mjs` and `http://localhost:5178/?demo=1`. The dedicated read-only host is `node app/node/operations-console/server.mjs`.
