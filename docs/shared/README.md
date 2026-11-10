# Shared modules

Use this area for code the console and its hosts share. Shared browser modules cannot import the console, Node, tests, tools or compatibility facades.

| Area | Canonical source |
|---|---|
| Read runtime, domain reads and query definitions | `app/public/shared/data/` |
| Auth, HTTP, GraphQL and meter | `app/public/shared/transport/` |
| Tokens and design reference | `app/public/shared/ui/`, `shared/design/` |
| Agent client and panel | `app/public/shared/agent/` |
| Artwork | `app/public/shared/assets/` |
| Node HTTP infrastructure and CLI connection | `app/node/shared/` |
| Build, browser and regression tools | `app/tools/shared/` |

Tests follow the same owners under `app/test/shared/`. Contracts and distributions live under `app/test/integration/`; shared fixtures live under `app/test/support/`.

Read [design tokens](design-tokens.md), [agent model](agent-model.md), [Apex limits](apex-limits.md) and [in-org troubleshooting](gotchas/in-org.md).

`app/public/source-layout.js` declares source paths and stable legacy deployment names. Hosts serve
legacy JavaScript URLs as re-export facades, sharing the canonical module's live state. Builders
assemble the existing flat distributions. Root facades support old consumers. Console code imports
canonical modules.

The classic accessibility script keeps its implementation at `app/tools/a11y-audit.js`: users paste
it directly into a browser console, so an ES-module facade would change that contract. It is shared-owned
and has one implementation.
