/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/*
 * Console theme button
 *
 * Purpose
 *   The theme chosen in the Theme menu (Standard, Salesforce Light, Salesforce Dark) has to reach the whole Operations Console,
 *   and the button has to say what it is. The test opens no record: the side panel (the drawer) stays closed.
 *
 * Steps
 *   1. Open /?demo=1, wait for the KPI cards, choose the map's Demand layer.
 *   2. Hover the Theme button.
 *   3. Pick Standard, Salesforce Light, Salesforce Dark, then Standard again. Each pick: open the menu, click the theme.
 *   4. After Dark, reload the page.
 *
 * Assertions
 *   - Hover: the button's title and accessible name are "Theme" (headless Chrome doesn't draw the native tooltip, so the title is
 *     what is checked); on hover its outline turns to the accent colour and its icon to full text colour.
 *   - Menu: it opens (aria-expanded), lists the three themes, closes on a pick, and focus returns to the Theme button.
 *   - Choice: <html data-theme> is absent for Standard and slds-light / slds-dark otherwise; the choice is saved for the next
 *     visit; Dark is still applied after a reload.
 *   - Tokens: the page's background, panel, text, accent and line colours are the chosen theme's, as tokens.css has them (the
 *     file is read by the test, so no colour is typed in), and the page backdrop is drawn from the theme's background.
 *   - Components: the top bar, Theme button, range buttons, KPI cards, panels and their titles, and the map legend each wear the
 *     right token.
 *   - No leaks: of every colour drawn anywhere on the page (text, fill, strokes, borders; 400+), none belongs only to another
 *     theme, so no hard-coded colour or stale component is left behind.
 *   - The drawer is closed, and the page never throws, calls /api/ or sends a non-GET.
 *
 * Not covered: other map layers, drawers, and the Dashboard, Service and Limits modes.
 *   node --test app/test/operations-console/ui/operation-console/theme.test.mjs     (window, video and server are set for all UI tests in browser-kit.mjs)
 */
import assert from 'node:assert/strict';
import { readFileSync } from "../../../support/source-view.mjs";
import { test } from 'node:test';
import { UI, WIDE, loadPlaywright, openSession, until } from "../../../../tools/browser-kit.mjs";

const pw = await loadPlaywright();

// ---------- the themes, from tokens.css ----------
// Standard is the base block; each Salesforce theme overrides part of it. Only plain hex colours are compared.
const css = readFileSync(new URL("../../../../public/shared/ui/tokens.css", import.meta.url), 'utf8');
const block = (open) => css.slice(css.indexOf(open) + open.length, css.indexOf('\n}', css.indexOf(open)));
const hexes = (text) => Object.fromEntries([...text.matchAll(/(--[\w-]+):\s*#([0-9a-fA-F]{3,6})\b/g)].map(([, name, h]) => [name, rgb(h)]));
function rgb(h) {
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}
const standard = hexes(block(':root{'));
const THEMES = [
  { menu: 'Standard', attr: null, tokens: standard },
  { menu: 'Salesforce Light', attr: 'slds-light', tokens: { ...standard, ...hexes(block(':root[data-theme="slds-light"]{')) } },
  { menu: 'Salesforce Dark', attr: 'slds-dark', tokens: { ...standard, ...hexes(block(':root[data-theme="slds-dark"]{')) } },
];
const colours = (t) => new Set(Object.values(t.tokens));

// ---------- what each component should wear ----------
// [what it is, selector, computed property, token]. The page resolves the token itself, so a component token that points to
// another (--card-bg is --panel) is followed; the token's own value for the theme is checked separately against tokens.css.
const COMPONENTS = [
  ['top bar line', '.top', 'borderBottomColor', '--line'],
  ['Theme button', '#theme .theme-btn', 'backgroundColor', '--btn-bg'],
  ['Theme button outline', '#theme .theme-btn', 'borderTopColor', '--btn-line'],
  ['range buttons', '#range', 'backgroundColor', '--panel'],
  ['pressed range button', '#range button[aria-pressed="true"]', 'backgroundColor', '--raise'],
  ['pressed range text', '#range button[aria-pressed="true"]', 'color', '--ink'],
  ['KPI card', '#kpis .kpi', 'backgroundColor', '--card-bg'],
  ['KPI card line', '#kpis .kpi', 'borderTopColor', '--card-line'],
  ['KPI label', '#kpis .kpi .l', 'color', '--muted'],
  ['KPI value', '#kpis .kpi .v', 'color', '--ink'],
  ['panel', '.zone', 'backgroundColor', '--card-bg'],
  ['panel title', '.zone > h2', 'color', '--ink2'],
  ['panel title line', '.zone > h2', 'borderBottomColor', '--line'],
  ['map legend line', '#legend', 'borderLeftColor', '--line'],
  ['map legend note', '#legend .lt', 'color', '--muted'],
];

// Reads, in the page, every colour of a component as the browser computes it, and what a token resolves to.
const probe = (page, components) => page.evaluate((list) => {
  const resolve = (tok, prop) => { const d = document.createElement('i'); d.style[prop] = `var(${tok})`; document.body.append(d); const c = getComputedStyle(d)[prop]; d.remove(); return c; };
  return {
    attr: document.documentElement.getAttribute('data-theme'),
    saved: localStorage.getItem('omc.theme'),
    tokens: Object.fromEntries(['--bg', '--panel', '--ink', '--signal', '--line'].map((t) => [t, resolve(t, 'color')])),
    components: list.map(([what, sel, prop, tok]) => {
      const e = document.querySelector(sel);
      return [what, e ? getComputedStyle(e)[prop] : null, resolve(tok, /background/i.test(prop) ? 'backgroundColor' : 'color')];
    }),
    backdrop: getComputedStyle(document.body).backgroundImage,
    // Every colour on the page: text, fill and borders of each element that is drawn, with a name to find it by.
    seen: [...document.body.querySelectorAll('*')].filter((e) => e.getClientRects().length && !e.closest('svg defs')).flatMap((e) => {
      const cs = getComputedStyle(e), name = e.tagName.toLowerCase() + (e.id ? `#${e.id}` : '') + (typeof e.className === 'string' && e.className ? `.${e.className.trim().split(/\s+/).join('.')}` : '');
      const out = [['color', cs.color], ['backgroundColor', cs.backgroundColor]];
      if (e instanceof SVGElement) out.push(['fill', cs.fill], ['stroke', cs.stroke]);
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) if (parseFloat(cs[`border${side}Width`]) > 0) out.push([`border${side}Color`, cs[`border${side}Color`]]);
      return out.filter(([, v]) => /^rgb/.test(v)).map(([prop, v]) => [name, prop, v]);
    }),
  };
}, components);

test('Console theme button changes every component', { skip: UI.skip(pw) }, async () => {
  const s = await openSession(pw, 'console-theme', { viewport: WIDE });
  const { page, step } = s;
  const btn = page.locator('#theme .theme-btn'), menu = page.locator('#theme .theme-menu');
  try {
    assert.ok(await until(page, '#app:not(.hide) #kpis > .kpi', 15000), 'the Console drew');
    await step(() => page.locator('#layers button[data-l="demand"]').click());

    // Hovering the button: it is named "Theme" (the title is the tooltip the browser shows; headless Chrome doesn't draw it), and
    // it answers the pointer with its hover look: the outline turns to the accent and the icon to full ink.
    await step(() => btn.hover());
    assert.equal(await btn.getAttribute('title'), 'Theme', 'the button says Theme on hover');
    assert.equal(await btn.getAttribute('aria-label'), 'Theme', 'the button is named Theme');
    const hover = await btn.evaluate((e) => { const cs = getComputedStyle(e), d = document.createElement('i'); d.style.cssText = 'color:var(--signal);background:var(--ink)'; document.body.append(d); const ds = getComputedStyle(d); const r = { line: cs.borderTopColor, color: cs.color, signal: ds.color, ink: ds.backgroundColor }; d.remove(); return r; });
    assert.equal(hover.line, hover.signal, 'hovering the Theme button outlines it in the accent');
    assert.equal(hover.color, hover.ink, 'hovering the Theme button brings its icon to full ink');

    // Standard first, as the page opens; then Light, Dark, and back to Standard.
    const picks = [THEMES[0], THEMES[1], THEMES[2], THEMES[0]];
    const palettes = THEMES.map(colours);
    for (const [i, theme] of picks.entries()) {
      const label = theme.menu;
      await step(() => btn.click());
      assert.equal(await btn.getAttribute('aria-expanded'), 'true', 'the menu opens');
      assert.deepEqual(await page.locator('#theme .theme-menu button').allTextContents(), THEMES.map((t) => t.menu), 'the menu lists the three themes');
      await step(() => page.locator(`#theme .theme-menu button:text-is("${label}")`).click());
      assert.equal(await btn.getAttribute('aria-expanded'), 'false', 'picking a theme closes the menu');
      assert.ok(await menu.evaluate((e) => e.classList.contains('hide')), 'the menu is hidden');
      assert.ok(await btn.evaluate((e) => e === document.activeElement), 'focus goes back to the Theme button');

      const got = await probe(page, COMPONENTS);
      assert.equal(got.attr, theme.attr, `${label}: the page's data-theme`);
      assert.equal(got.saved, theme.attr || 'standard', `${label}: the choice is saved for the next visit`);
      // The theme's own colours reached the page...
      for (const [tok, name] of [['--bg', 'page background'], ['--panel', 'panel'], ['--ink', 'text'], ['--signal', 'accent'], ['--line', 'line']]) assert.equal(got.tokens[tok], theme.tokens[tok], `${label}: ${name} (${tok}) is the theme's, as tokens.css has it`);
      assert.ok(got.backdrop.includes(theme.tokens['--bg']), `${label}: the page backdrop is drawn from the theme's background`);
      // ...and every component wears them.
      for (const [what, actual, want] of got.components) assert.equal(actual, want, `${label}: ${what}`);
      // Nothing shows another theme's colour. A colour that is in some other theme's palette and not in this one is a leak: a
      // hard-coded value, or a component that kept the old theme.
      const mine = palettes[THEMES.indexOf(theme)], others = new Set(THEMES.filter((t) => t !== theme).flatMap((t) => [...colours(t)]));
      const leaks = got.seen.filter(([, , v]) => others.has(v) && !mine.has(v));
      assert.deepEqual(leaks.slice(0, 8), [], `${label}: ${leaks.length} colours belong only to another theme`);
      assert.ok(got.seen.length > 400, `${label}: the whole page was checked (${got.seen.length} colours)`);
      assert.ok(await page.locator('#drawer').evaluate((e) => e.classList.contains('hide')), 'no side panel is open');

      if (i === 2) { // Dark is kept across a reload
        await page.reload();
        assert.ok(await until(page, '#app:not(.hide) #kpis > .kpi', 15000), 'the Console drew again');
        assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'slds-dark', 'Dark is still there after a reload');
      }
    }
    assert.deepEqual(s.problems, []);
  } finally { await s.close(); }
});
