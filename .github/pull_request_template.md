## What changed, in a sentence or two


## Checklist (delete the lines that don't apply)

- [ ] **Test:** I added or changed a test for this (under `app/test/`). If I didn't, because nothing here needs one, I say why: 
- [ ] **Sample data:** I tried it at `http://localhost:5178/?demo=1` and it looks right in all three themes (Standard, SLDS light, SLDS dark)
- [ ] **Design tokens only:** every colour, space, font size, radius and transition comes from `app/public/shared/ui/tokens.css` (see `docs/shared/design-tokens.md`)
- [ ] **New number, card or panel:** it has sample data in `console-demo.js`, and `EXPECTED_AGENT` in `agent-context.test.mjs` if the agent may read it
- [ ] **Keyboard:** whatever I added opens with Enter or Space, and shows a focus ring
- [ ] **Read-only:** nothing I added sends a change to Salesforce

CI runs the syntax check and every test on this pull request; it must be green. See `docs/operations-console/changing-the-console.md`.
