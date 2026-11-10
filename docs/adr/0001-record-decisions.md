# 0001. Record architecture decisions here

- Status: Accepted
- Date: 2026-10-26

## Context

Until now, the reasons behind this repo's structure lived in two places:

- CLAUDE.md's invariants and gotchas;
- commit messages.

Those say what to keep true. They rarely say what else was considered, or why a module boundary sits where it does. A
contributor who wants to move a boundary has to work that out again.

## Decision

Structural decisions get a short record in `docs/adr/`, numbered, in the format in [README.md](README.md). CLAUDE.md keeps
the rules and the gotchas. ARCHITECTURE.md describes the current shape. A record explains one choice.

## Consequences

- A boundary that looks odd (late-bound wrappers between console views, say) has a record to check before it's moved.
- Records go stale only by being replaced: a change that reverses one adds a record and marks the old one Superseded.
