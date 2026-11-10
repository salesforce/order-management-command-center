# Shared browser modules

The console and the Node host use the same transport implementations:

| Module | Responsibility |
|---|---|
| `transport/om-http.js` | Request options, error shapes, blocked-org checks and read-only POST rules |
| `transport/om-meter.js` | Request accounting, cross-tab delivery and privacy filtering |
| `transport/om-graphql.js` | Read-only SOQL-to-GraphQL translation |

Import these canonical paths in application code. The old `app/public/om-*.js` entry points
delegate to these modules for existing integrations; they contain no second implementation.
Shared modules must not import the console's views, Node code or compatibility entry points.

The Salesforce builders flatten these paths when packaging and reject filename collisions.
Artifact imports resolve from their importing module's folder. Local and demo hosts serve the
same source tree. Tests under `app/test/architecture/` protect implementation hashes, export
identity and the deployment bundles.

Other shared concerns will move here as their dependency and distribution checks are added.
