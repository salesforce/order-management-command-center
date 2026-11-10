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
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from "../../support/source-view.mjs";
import { consoleText, MODULES } from "../../support/console-source.mjs";

// Accessibility, read from the pages and scripts as text (there is no DOM here): names for what a screen reader meets,
// keyboard access to everything the mouse can open, a focus ring nothing hides, and the system's contrast and motion
// settings honoured. The check by hand (Tab through each view) is in CLAUDE.md under Verifying changes.
const read = (f) => readFileSync(new URL(`../../../public/${f}`, import.meta.url), 'utf8');
const tokens = read('tokens.css');
// The console: the page and the console-*.js modules its script imports (console-source.mjs).
const html = consoleText;
const FILES = Object.fromEntries(['index.html', ...MODULES, 'agent-panel.js'].map((f) => [f, read(f)]));
const sheet = (page) => page.slice(page.indexOf('<style>'), page.indexOf('</style>'));
const lineOf = (s, i) => s.slice(0, i).split('\n').length;
// The props object of an h('tag', { … }) call, braces balanced (props hold nested objects such as data: { … }).
function props(s, at) {
  const i = s.indexOf('{', at); if (i < 0 || s.slice(at, i).includes(')')) return '';
  for (let d = 0, k = i; k < s.length; k++) { if (s[k] === '{') d++; else if (s[k] === '}' && --d === 0) return s.slice(i, k + 1); }
  return '';
}
const hCalls = (s, tag) => [...s.matchAll(new RegExp(`h\\('${tag}'`, 'g'))].map((m) => ({ at: m.index, p: props(s, m.index) }));

test('the page starts with a skip link the script handles', () => {
  assert.match(html.slice(html.indexOf('<body>'), html.indexOf('<body>') + 120), /^<body>\n<a class="skip" id="skip" href="#app"(?: data-i18n="page\.skip")?>Skip to content<\/a>/);
  assert.match(html, /\$\('#skip'\)\.onclick = /);
});

test('every <svg> is named for a screen reader, or hidden from it', () => {
  const bad = [];
  for (const [f, s] of Object.entries(FILES)) for (const m of s.matchAll(/<svg\b[^>]*>/g)) {
    const named = /role="(img|group)"/.test(m[0]) && /aria-label(ledby)?="/.test(m[0]);
    if (!named && !/aria-hidden="true"/.test(m[0])) bad.push(`${f}:${lineOf(s, m.index)}`);
  }
  assert.deepEqual(bad, []);
});

test('every image has alt text (empty when it is decoration)', () => {
  const bad = [];
  for (const [f, s] of Object.entries(FILES)) {
    for (const m of s.matchAll(/<img\b[^>]*>/g)) if (!/\balt=/.test(m[0])) bad.push(`${f}:${lineOf(s, m.index)}`);
    for (const c of hCalls(s, 'img')) if (!/\balt\b/.test(c.p)) bad.push(`${f}:${lineOf(s, c.at)}`);
  }
  assert.deepEqual(bad, []);
});

test('a button that shows only a symbol or an icon has an aria-label', () => {
  const bad = [];
  for (const [f, s] of Object.entries(FILES)) {
    for (const m of s.matchAll(/<button\b([^>]*)>\s*([^\w\s<>${}]{1,2}|<svg[\s\S]*?<\/svg>)\s*<\/button>/g)) if (!/aria-label/.test(m[1])) bad.push(`${f}:${lineOf(s, m.index)}`);
    for (const m of s.matchAll(/h\('button', (\{[^}]*\}), '([^\w\s']{1,2})'\)/g)) if (!/aria-label/.test(m[1])) bad.push(`${f}:${lineOf(s, m.index)}`);
  }
  assert.deepEqual(bad, []);
});

test('every form field has a label', () => {
  const bad = [];
  for (const [f, s] of Object.entries(FILES)) {
    for (const m of s.matchAll(/<(input|select|textarea)\b[^>]*>/g)) {
      const before = s.slice(Math.max(0, m.index - 400), m.index), id = m[0].match(/\bid="([^"]+)"/)?.[1];
      const ok = /aria-label(ledby)?=/.test(m[0]) || before.lastIndexOf('<label') > before.lastIndexOf('</label>') || (id && s.includes(`for="${id}"`));
      if (!ok) bad.push(`${f}:${lineOf(s, m.index)}`);
    }
    // In h() calls: an aria-label, a label the field sits in (opened on this line or the one before), or one
    // whose for: names the field's id.
    for (const tag of ['input', 'select', 'textarea']) for (const c of hCalls(s, tag)) {
      const two = s.slice(s.lastIndexOf('\n', s.lastIndexOf('\n', c.at) - 1) + 1, c.at), id = c.p.match(/\bid: '([^']+)'/)?.[1];
      if (!/'aria-label(ledby)?'/.test(c.p) && !/h\('label'/.test(two) && !(id && s.includes(`for: '${id}'`))) bad.push(`${f}:${lineOf(s, c.at)}`);
    }
  }
  assert.deepEqual(bad, []);
});

// Removing the ring is allowed where something else shows focus: a container that only script focuses, and the big search
// field, whose box draws the ring around it.
test('no stylesheet hides the focus ring without drawing another', () => {
  const allowed = { '[tabindex="-1"]:focus-visible': null, '.field input': /\.field:focus-within\{[^}]*outline:var\(--focus-ring\)/ };
  for (const [name, page] of [['console', html]]) {
    for (const m of sheet(page).matchAll(/([^{}\n]+)\{[^}]*outline:\s*(none|0)\b[^}]*\}/g)) {
      const sel = m[1].trim();
      assert.ok(Object.hasOwn(allowed, sel), `${name}: ${sel} removes the focus ring`);
      if (allowed[sel]) assert.match(sheet(page), allowed[sel], `${name}: ${sel} needs its replacement ring`);
    }
  }
  assert.match(sheet(html), /\.hx-ev:focus-visible\{outline:var\(--focus-ring\)/);
});

test('console: what opens on a click can be reached and opened from the keyboard', () => {
  // Rows that open a record or the customer 360 take focus; Enter or Space clicks them.
  assert.match(html, /const recAttr = \(obj, id\) => id \? `data-rec="\$\{obj\}:\$\{esc\(id\)\}" tabindex="0"`/);
  for (const row of [/data-id="\$\{esc\(r\.Id\)\}" tabindex="0"/, /<div class="item" data-id="\$\{esc\(e\.Id \|\| ''\)\}"\$\{e\.Id \? ' role="button" tabindex="0"' : ''\}>/,
    /data-order="\$\{esc\(r\.id\)\}" tabindex="0"/, /<tr data-acct="\$\{esc\(r\.id\)\}" tabindex="0"/, /data-prod="\$\{esc\(r\.id\)\}" data-pname="\$\{esc\(r\.key\)\}" tabindex="0"/,
    /<tr data-cust="\$\{esc\(c\.id\)\}" tabindex="0"/]) assert.match(html, row);
  assert.match(html, /\(e\.key === 'Enter' \|\| e\.key === ' '\) && !e\.defaultPrevented && t\.getAttribute\?\.\('tabindex'\) === '0' && !t\.matches\(NATIVE\)/);
  // The map's locations are buttons with a name, and show their tooltip on focus; the map is a group of them, not a picture.
  assert.match(html, /data-node="\$\{c\.key\}" tabindex="0" role="button" aria-pressed="\$\{c\.key === S\.focusKey\}" aria-label="\$\{esc\(say\)\}"/);
  assert.match(html, /<svg class="map" id="map"[^>]*role="group" aria-label="[^"]+"/);
  assert.match(html, /g\.onfocus = \(\) => \{ if \(g\.dataset\.node !== S\.focusKey\) showTip\(tipAt\(g\)/);
  // A card that opens a record says it's a button; a table row stays a row (the browser reports it as clickable).
  assert.match(html, /<div class="item" role="button" \$\{recAttr\('ProcessException', e\.Id\)\}>/);
  assert.match(html, /<div class="fob" role="button" \$\{recAttr\('FulfillmentOrder', f\.Id\)\}>/);
  // The states' list beside the map is a list; each row takes focus and shows its state's tooltip.
  assert.match(html, /function legendRow\(r, mark, light, tip\) \{\n\s+r\.tabIndex = 0;/);
  assert.equal([...html.matchAll(/=> legendRow\(r, /g)].length, 3);
  assert.equal([...html.matchAll(/<div role="list" aria-label="\$\{esc\((L\.what|what)\)\}">/g)].length, 3, 'state, city and product legends');
  assert.match(html, /<div class="hb" role="list">/);
  // Each location's hit circle is at least 25 px across on screen (2.5.8).
  assert.match(html, /hitR = ctm\?\.a > 0 \? Math\.max\(20, 12\.5 \/ \(ctm\.a \/ zoomOf\(\)\)\) : 20;/);
  // The team queue is a listbox: one tab stop, arrow keys, the selected row as its active descendant.
  assert.match(html, /id="queue" role="listbox" tabindex="0"/);
  assert.match(html, /setAttribute\('aria-activedescendant', `q-\$\{S\.qSel\}`\)/);
});

test('console: a column chart is one tab stop with a summary, and the arrow keys read its columns', () => {
  assert.match(html, /<svg class="chart"[^`]*role="img" tabindex="0" aria-label="\$\{esc\(say\)\}"/);
  assert.match(html, /\{ ArrowLeft: i - 1, ArrowRight: i \+ 1, Home: 0, End: Infinity \}\[e\.key\]/);
  assert.match(html, /<div id="dlive" class="sr-only" aria-live="polite"><\/div>/);
  assert.match(html, /\$\('#dlive'\)\.textContent = h\.dataset\.say/);
});

test('console: re-renders keep focus where it was', () => {
  for (const name of ['Map', 'Exceptions', 'Stream', 'Dash', 'Customer', 'Hx']) assert.match(html, new RegExp(`function render${name}\\(\\) \\{ keepFocus\\(paint${name}\\); \\}\\n\\s*function paint${name}\\(\\) \\{`));
  assert.match(html, /function render\(\) \{ keepFocus\(\(\) => \{/);
});

test('console: a chip or segmented button says whether it is selected', () => {
  const chips = [...html.matchAll(/<button class="chip \$\{[^}]*\? 'on' : ''\}"[^>]*>/g)];
  assert.ok(chips.length >= 4, 'chip templates');
  for (const m of chips) assert.match(m[0], /aria-pressed="\$\{/, m[0]);
  assert.doesNotMatch(html, /\$\('#(mode|range|period)'\)\.querySelectorAll\('button'\)\.forEach\(\(x\) => x\.classList\.toggle\('on'/);
  assert.match(html, /const pressed = \(b, on\) => \{ b\.classList\.toggle\('on', on\); b\.setAttribute\('aria-pressed', on\); \};/);
});

test('dialogs are named; the console moves focus into its drawer and Data map, and back out', () => {
  for (const [f, s] of Object.entries(FILES)) for (const m of s.matchAll(/<[a-z]+\b[^>]*role="dialog"[^>]*>/g)) assert.match(m[0], /aria-label(ledby)?="/, `${f}: ${m[0]}`);
  assert.match(html, /<div id="modal" class="modal hide" role="dialog" aria-modal="true" aria-label="Data map">/);
  assert.equal([...html.matchAll(/\$\('#scrim'\)\.classList\.remove\('hide'\); enterLayer\(d\);/g)].length, 3, 'order, record and account drawers');
  assert.match(html, /enterLayer\(\$\('#modal'\)\)/);
  assert.match(html, /function closeDrawer\(\) \{[^\n]*leaveLayer\(\$\('#drawer'\)\); \}/);
  assert.match(html, /function closeModal\(\) \{[^\n]*leaveLayer\(\$\('#modal'\)\); \}/);
  // Focus after a drawer or Data map redraw is exercised in operations-console/ui/side-panel/panel.test.mjs.
});

test('motion stops under prefers-reduced-motion, the map\'s flows included', () => {
  assert.match(html, /on && !REDUCED\.matches \? svg\.unpauseAnimations\(\) : svg\.pauseAnimations\(\)/);
  assert.match(html, /if \(!S\.live \|\| REDUCED\.matches\) svg\.pauseAnimations\(\);/);
  assert.match(sheet(html), /@media \(prefers-reduced-motion:reduce\)\{[^\n]*\.live i\{animation:none\}/);
});

test('tokens.css keeps the selection and the focus ring under forced colours, in system colours only', () => {
  const i = tokens.indexOf('@media (forced-colors:active){'); assert.ok(i > 0, 'forced-colors block');
  const body = tokens.slice(i, tokens.indexOf('\n}', i));
  assert.match(body, /\[aria-pressed="true"\],\[aria-selected="true"\]/);
  assert.match(body, /background:Highlight;color:HighlightText/);
  assert.match(body, /:focus-visible\{outline-color:Highlight\}/);
  assert.doesNotMatch(body, /var\(--|#[0-9a-f]{3}/i);
});

// ---------- page structure, contrast on tints, and dimming ----------
const design = read('design/index.html');
const PAGES = [['console', html], ['design', design]];

test('a banner, a main and an h1 a screen reader can jump to', () => {
  assert.match(html, /<main id="gate" class="gate hide">/, 'the sign-in screen is the main content while it shows');
  assert.match(html, /<div id="app" class="app hide">\n {2}<header class="top">/, '#app is a div, so its header is the banner (inside a <section> it would not be)');
  assert.match(html, /<\/header>\n {2}<main id="content">/);
  assert.match(sheet(html), /\.app>main\{display:contents\}/, "the console's <main> is a landmark only; the grid lays out its children");
  assert.match(html, /<div class="brand">.*<h1>Salesforce Order Management Operations Console<\/h1><\/div>/);
});

test('placeholders use --muted, which reaches 4.5:1 on a field in every theme', () => {
  assert.match(sheet(html), /::placeholder\{color:var\(--muted\);opacity:1\}/);
});

// A tinted fill (color-mix of a tone into transparent or a surface) costs contrast: a tone's own colour as text on it falls
// under 4.5:1, so tone text mixes in --ink (--tint-ink). See tokens.css.
const TONES = /^var\(--(red|amber|green|signal|signal2|agent|st-[\w-]+)\)$/;
test('no tone colour is used as plain text on a tinted fill', () => {
  const bad = [];
  for (const [name, page] of PAGES) {
    const css = sheet(page).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/background(?:-color)?:color-mix\(in srgb,var\(--[\w-]+\) var\(--tint-[\w-]+\),(transparent|var\(--[\w-]+\))\)/.test(body)) continue;
      const fg = body.match(/(?:^|;)color:([^;]+)/)?.[1].trim();
      if (fg && TONES.test(fg)) bad.push(`${name}: ${sel.trim()} {color:${fg}}`);
    }
  }
  assert.deepEqual(bad, []);
  assert.match(sheet(html), /:is\([^{]+\) :is\(\.muted,\.ls\)\{color:var\(--ink2\)\}/, 'quiet text on a tinted fill steps up to --ink2');
  assert.match(tokens, /--tint-ink:70%;/);
});

// Fading a box with opacity fades its text too. What recedes turns grey (filter) and quiet (--muted) instead. Opacity under
// .7 is left only where there's no text to read: disabled controls, decoration, the map's drawing (hidden from screen
// readers), the Agentforce button while the agent is off, and animation frames.
test('nothing with text to read is faded with opacity', () => {
  const ALLOWED = /:disabled|^\.node \.halo$|^\.node:focus-visible \.halo$|^#map \.dim$|^\.agent-btn\.off (canvas|img)$|^\.years i$|^\d+%(,\d+%)*$/;
  const bad = [];
  for (const [name, page] of PAGES) {
    const css = sheet(page).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) for (const m of body.matchAll(/(?:^|;)opacity:\s*(0?\.\d+)/g)) {
      if (parseFloat(m[1]) < 0.7 && !ALLOWED.test(sel.trim())) bad.push(`${name}: ${sel.trim()} opacity:${m[1]}`);
    }
  }
  assert.deepEqual(bad, []);
  assert.match(sheet(html), /#map \.node\.faint,#map \.node\.dim\{opacity:1!important;filter:grayscale\(1\)\}/);
});
