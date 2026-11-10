# Design tokens

`app/public/shared/ui/tokens.css` holds every colour and every component value Salesforce Order Management Operations Console uses. The console and the design page link it, so they look the same in all three themes. `app/public/shared/design/` shows each token live in each theme. Locally that's `http://localhost:5178/design/`; it's also on the hosted page.

## Rules

- **Style with tokens, never with raw values.** Spacing (`gap`, `margin`, `padding`), font sizes and weights, radii, transitions and tints come from the scale below; a value between two steps snaps to the nearer one. A page's `<style>` keeps raw only what's layout: grids, widths, heights and positions, `0` and 1px hairlines, negative offsets, `calc()`, spacing above 24px other than 32px (a page's padding, an indent to a column), animation loops, and blends of two colours past `--tint-line`. No hex or `rgb()` colour lives outside the theme blocks in `tokens.css`. `themes.test.mjs` checks the console page: colours and undeclared `var()`s in their stylesheets, and the scale (`offScale()`) in their stylesheets and `style="…"` attributes.
- **A new colour is a new token in all three theme blocks**, and it must pass the contrast tests: 4.5:1 for text on every surface (`--bg`, `--panel`, `--panel2`, `--raise`), 3:1 for data colours and control borders.
- **Component tokens refer to theme colours.** They hold no colour of their own: `--btn-primary-bg:var(--signal)`. Change a component's look in one place, and every page follows.
- **Tones are mixed, not added.** A tinted fill, outline or alert takes its tone with `color-mix(in srgb, var(--tone) var(--tint-fill), transparent)`, using `--tint-fill` (16%), `--tint-line` (45%), `--tint-on` (13%, a selected state), `--tint-alert` (10%) or `--tint-row` (8%).
- **Text on a tint mixes in ink.** A tinted fill lowers the contrast of whatever sits on it. Tone text on one is `color-mix(in srgb, var(--tone) var(--tint-ink), var(--ink))` (`--tint-ink` is 70%), and `--muted` steps up to `--ink2`. Each page has one `:is(…)` rule for the tinted surfaces that hold text.
- **Fade colour, never text.** Something out of focus turns grey (`filter:grayscale(1)`) and `--muted`; `opacity` would fade its text below 4.5:1.
- **Page-local custom properties are fine** when an element passes its colour to its children: `--c` (a lane's or series' colour), `--k` (a key's), `--promo-*`.

## Themes

Standard (no `data-theme`) is the console's own dark theme. `slds-light` and `slds-dark` follow SLDS 2 (Cosmos). A page sets `data-theme` on `<html>` before first paint, from `localStorage` `omc.theme`.

| Group | Tokens | Use |
|---|---|---|
| Surfaces | `--bg` `--panel` `--panel2` `--raise` | page, card, inset or hover, selected or raised |
| Lines | `--line` `--line2` | divider; control outline (3:1) |
| Text | `--ink` `--ink2` `--muted` `--on-accent` | body, secondary, quietest at 4.5:1, text on a filled accent |
| Accents | `--signal` `--signal2` `--green` `--amber` `--red` `--agent` | action, good, warning, bad, Agentforce |
| Neutral fills | `--chip` `--chip2` | tags, tracks |
| Overlays | `--scrim` `--shade` `--bg-grad` | behind a drawer, shadow colour, backdrop glow |
| Chart series | `--d1` … `--d6` | categorical, always in this order |
| Order steps | `--st1` … `--st4`, `--st-done` `--st-fail` `--st-warn` `--st-run`, `--st-o1` … `--st-o3` | a record's status, early to late, then outcomes, then anything else |
| Sequential | `--ramp1` … `--ramp4` | amounts, low to high |
| Map | `--land` `--land-line` `--lbl` `--lbl-ink` | land, outline, labels on dark and light fills |
| Brand | `--brand-grad` `--img-bg` | logo mark; a product photo's backdrop |
| Font | `--font` | Archivo in Standard, the system font in the Salesforce themes |

## Scale

| Group | Tokens |
|---|---|
| Space | `--sp-1` 2px · `--sp-2` 4 · `--sp-3` 6 · `--sp-4` 8 · `--sp-5` 10 · `--sp-6` 12 · `--sp-7` 14 · `--sp-8` 16 · `--sp-9` 20 · `--sp-10` 24 · `--sp-11` 32; `--gutter` 20 (a page's edge) |
| Radius | `--radius-xs` 3 (bar end) · `-sm` 5 (square tag) · `-md` 8 (control) · `-lg` 10 (popover, note) · `-xl` 12 (card, also `--r`) · `-2xl` 16 (dialog) · `-pill` · `-round` |
| Type size | `--fs-3xs` 10.5 · `-2xs` 11 · `-xs` 11.5 · `-sm` 12 · `-md` 12.5 (controls) · `-base` 13 (dense tables) · `-body` 14 · `-lg` 16 · `-xl` 18 · `-2xl` 20 · `-3xl` 22 · `-4xl` 24 · `-kpi` 30 · `-hero` 48 |
| Weight | `--fw-normal` 400 · `-medium` 500 · `-semibold` 600 · `-display` 650 · `-bold` 700 · `-black` 800 |
| Type, other | `--lh-tight` `--lh-body`, `--stretch-title` `--stretch-figure` (Archivo's width), `--font-mono` |
| Labels | `--label-size` `--label-track` (KPI, field), `--th-size` `--th-track` (table header), `--section-size` `--section-track` (card heading) |
| Elevation | `--shadow-1` menu · `--shadow-2` popover, tooltip · `--shadow-3` dialog |
| Motion | `--dur-fast` .15s · `--dur-med` .25s · `--dur-slow` .7s; `--ease-out` `--ease-pop` `--ease-settle`. Turn animation off under `prefers-reduced-motion`. |
| Layers | `--z-raised` 1 · `--z-float` 5 · `--z-header` 9 · `--z-scrim` 10 · `--z-drawer` 11 · `--z-agent` 12 · `--z-menu` 20 · `--z-toast` 30 · `--z-full` 50 |
| Focus | `--focus-ring` `--focus-offset`: the same ring on everything that takes focus. Under `forced-colors` (Windows high contrast) the ring turns `Highlight`, and selected chips, tabs and options turn `Highlight` / `HighlightText` (the block at the end of `tokens.css`) |
| Next step | `--next-ring` `--next-offset` `--next-glow` `--next-pulse`: a ring around what to press next, in `--agent`, with a halo that pulses out from it (shown on the design page) |

## Components

| Component | Tokens | Notes |
|---|---|---|
| Button | `--btn-pad` `--btn-radius` `--btn-weight` `--btn-bg` `--btn-line` `--btn-hover-line`; `--btn-primary-bg/-ink`; `--btn-danger-bg/-ink`; `--btn-ghost-ink`; `--btn-sm-pad/-size`; `--btn-lg-pad/-size`; `--btn-disabled-opacity` | One primary per view, for the next step. Danger changes or cancels something. |
| Pill (status) | `--tag-size` `--tag-pad` `--tag-radius` `--tag-bg` `--tag-ink` | A dot (`<s>`, `--dot-size`) in the status colour, or toned with `--tint-fill`. |
| Badge (a fact) | the tag tokens, `--badge-line` | Outlined; toned with `--tint-line`. |
| Chip (a filter) | `--chip-size` `--chip-pad` `--chip-line` | `.on` takes the primary button's fill (console) or `--tint-on` (Service). |
| Square tag | `--tag-square-size/-pad/-radius/-bg/-weight` | Severity, kind, count. |
| Field | `--field-bg` `--field-line` `--field-focus` `--field-radius` `--field-pad` | Inputs, selects, textareas. |
| Card | `--card-bg` `--card-line` `--card-radius` `--card-pad` | Zones, KPIs, record cards. |
| Popover | `--pop-bg` `--pop-line` `--pop-radius` `--pop-shadow` | Menus, tooltips, search results. |
| Table | `--th-ink` `--th-weight` `--cell-pad` `--row-line` `--row-hover` | |
| Chart | `--chart-grid` `--chart-axis` `--chart-axis-size` `--chart-track` `--chart-bar` `--chart-bar-radius` `--chart-hover` `--chart-mark-line` `--chart-key` `--chart-key-radius` | Series colours are `--d1` … `--d6`, statuses `--st*`, amounts `--ramp*`, set from script as `'var(--d1)'`. |

## Builds

- **Edit view and live console:** `build-artifact.mjs` inlines `tokens.css` as a `<style>` where the page links it (an artifact is one file).
- **In-org UI bundles:** `build-ui-bundle.mjs` versions the link (`tokens.css?v=…`) as it does scripts. `design/` isn't in the bundle.
- **Local server:** serves `/tokens.css` and `/design/`.

## As an artifact

`node app/tools/build-artifact.mjs --tokens` builds the reference page as one self-contained file, `app/artifact/om-design-tokens.html`. It inlines `tokens.css`, fetches nothing, and opens from `file://` too. Claude Code sessions on this Mac can't publish artifacts, because managed settings force Bedrock. There are two ways in:

- **Cowork:** the `om-console-live` skill (`node app/tools/build-live-artifact.mjs --skill`, see `docs/live-artifact.md`) carries the page. Ask Cowork to *publish the Order Management design tokens*. It needs no connector and gets no `mcp_tools`.
- **Anywhere else that takes an HTML artifact** (claude.ai, a Claude Code session on the Anthropic API): hand it the built file as it is.

Rebuild and republish after changing `tokens.css` or `design/`. The page shows what the file held when it was built.
