# Architecture decision records

Each file records one decision about how this repo is built: the problem, what we chose, and what follows from it. A
record isn't rewritten when things change. A new one replaces it, and the old one's status says so.

[ARCHITECTURE.md](../../ARCHITECTURE.md) is how the pieces fit together today. These records are why.

| # | Decision | Status |
|---|---|---|
| [0001](0001-record-decisions.md) | Record architecture decisions here | Accepted |
| [0002](0002-read-model-areas.md) | The read model is a base plus area modules, joined by a kit and a route table | Accepted |
| [0003](0003-pure-rule-modules.md) | Rules that two places enforce live in leaf modules that import nothing | Accepted |
| [0005](0005-console-page-is-a-module.md) | The console's page script is an ES module, and builds switch its mode in one place | Accepted |
| [0006](0006-console-views-as-factories.md) | Console views are factories over one shared state object | Accepted |
| [0009](0009-ci.md) | Every pull request runs the syntax check and the tests | Accepted |

## Format

```markdown
# NNNN. Title, as the decision

- Status: Proposed | Accepted | Superseded by NNNN
- Date: YYYY-MM-DD

## Context
What made a decision necessary: the forces, the constraints, what had gone wrong.

## Decision
What we do now, in the present tense.

## Consequences
What follows, good and bad: what's easier, what's harder, and what to watch.
```

Add one when a change sets a rule a later change could break without knowing it: a new module boundary, a new invariant,
or a choice between two reasonable designs.
