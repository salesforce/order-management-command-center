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
import { consoleText } from "../../support/console-source.mjs";

// Reads the console page and tokens.css as text: the theme blocks (in tokens.css) must pass contrast, and no
// colour may live outside them.
const read = (f) => readFileSync(new URL(`../../../public/${f}`, import.meta.url), 'utf8');
// The console is its page and the console-*.js modules its script imports (console-source.mjs): their colours and inline styles count.
const html = consoleText, tokens = read('tokens.css');
const sheet = (page) => page.slice(page.indexOf('<style>'), page.indexOf('</style>'));
const style = sheet(html);
const THEMES = [':root', ':root[data-theme="slds-light"]', ':root[data-theme="slds-dark"]'];
const vars = (body) => Object.fromEntries([...body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const block = (sel) => { const i = tokens.indexOf(sel + '{'); assert.ok(i >= 0, `missing ${sel}`); return tokens.slice(i, tokens.indexOf('}', i)); };
const blocks = () => {
  const standard = vars(block(':root'));
  return { standard, light: { ...standard, ...vars(block(':root[data-theme="slds-light"]')) }, dark: { ...standard, ...vars(block(':root[data-theme="slds-dark"]')) } };
};
const lum = (h) => { h = h.replace('#', ''); if (h.length === 3) h = [...h].map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0); };
const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const hex = (t, v) => { let x = t[v]; for (let k = 0; x && x.startsWith('var(') && k < 5; k++) x = t[x.slice(6, -1)]; assert.match(x || '', /^#[0-9a-f]{3,6}$/i, `--${v} is not a hex colour: ${x}`); return x; };

const TEXT = ['ink', 'ink2', 'muted', 'signal', 'green', 'amber', 'red', 'agent'];
for (const name of ['light', 'dark']) {
  test(`${name}: text colours reach 4.5:1 on --panel`, () => {
    const t = blocks()[name];
    for (const v of TEXT) assert.ok(cr(hex(t, v), hex(t, 'panel')) >= 4.5, `--${v} ${cr(hex(t, v), hex(t, 'panel')).toFixed(2)}`);
    for (const v of ['signal', 'amber']) assert.ok(cr(hex(t, 'on-accent'), hex(t, v)) >= 4.5, `--on-accent on --${v} ${cr(hex(t, 'on-accent'), hex(t, v)).toFixed(2)}`);
  });
}

// Every theme's text reaches 4.5:1 on every surface, and its control borders 3:1 (WCAG 1.4.3, 1.4.11). Light and Dark's
// --muted, --signal, --green, --amber and --red were moved off the Salesforce values just enough to get there.
const SURFACES = ['bg', 'panel', 'panel2', 'raise'];
for (const name of ['standard', 'light', 'dark']) {
  test(`${name}: text colours reach 4.5:1 on every surface`, () => {
    const t = blocks()[name];
    for (const v of TEXT) for (const s of SURFACES) assert.ok(cr(hex(t, v), hex(t, s)) >= 4.5, `--${v} on --${s} ${cr(hex(t, v), hex(t, s)).toFixed(2)}`);
  });
  test(`${name}: control borders (--line2) reach 3:1 on every surface`, () => {
    const t = blocks()[name];
    for (const s of SURFACES) assert.ok(cr(hex(t, 'line2'), hex(t, s)) >= 3, `--line2 on --${s} ${cr(hex(t, 'line2'), hex(t, s)).toFixed(2)}`);
  });
}
test('standard: --muted reaches 4.5:1 on a tag (--chip)', () => {
  const t = blocks().standard;
  assert.ok(cr(hex(t, 'muted'), hex(t, 'chip')) >= 4.5, `--muted on --chip ${cr(hex(t, 'muted'), hex(t, 'chip')).toFixed(2)}`);
});
test('the sign-in field uses the control border, not the divider line', () => {
  assert.match(style, /\.gate input\{[^}]*border:1px solid var\(--field-line\)/);
  assert.match(tokens, /--field-line:var\(--line2\)/);
});

test('Standard keeps its values', () => {
  const s = blocks().standard;
  assert.deepEqual([s.bg, s.panel, s.ink, s.signal, s.amber, s['on-accent'], s.chip, s.chip2, s['bg-grad'], s.land, s['land-line']],
    ['#0B1322', '#121D30', '#E8EEF8', '#4FB3FF', '#F5B544', '#07121F', '#22334F', '#2B3F62', '#13233D', '#15243C', '#35507A']);
});

const colours = (css) => css.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi) || [];
test('tokens.css: no hard-coded colours outside the theme blocks', () => {
  let rest = tokens.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const sel of THEMES) { const i = rest.indexOf(sel + '{'); assert.ok(i >= 0, sel); rest = rest.slice(0, i) + rest.slice(rest.indexOf('}', i) + 1); }
  assert.deepEqual(colours(rest), []);
});
for (const [name, page] of [['console', html]]) {
  test(`${name}: links tokens.css and keeps no colours or theme blocks of its own`, () => {
    assert.match(page.slice(0, page.indexOf('<style>')), /<link rel="stylesheet" href="tokens\.css">/);
    assert.deepEqual(colours(sheet(page)), []);
    for (const sel of THEMES.slice(1)) assert.ok(!sheet(page).includes(sel + '{'), `${sel} belongs in tokens.css`);
  });
}
// Every token a page uses must be declared: in tokens.css, or on the page's own elements (--c, --k, --promo-*).
const declared = (css) => new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
for (const [name, page] of [['console', html]]) {
  test(`${name}: every var() in the stylesheet is declared`, () => {
    const known = new Set([...declared(tokens), ...declared(page)]);
    const used = new Set([...sheet(page).matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
    assert.deepEqual([...used].filter((v) => !known.has(v)), []);
  });
}

// Spacing, type, weights, radii, transitions and tints come from tokens.css's scale. A page keeps raw only what's layout:
// 0, 1px hairlines, negative offsets, calc(), spacing above 24px other than 32px (a page's padding, an indent to a column),
// sizes and positions, animation loops, and blends of two colours past --tint-line.
const decls = (css) => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/[{;]\s*([a-z-]+)\s*:\s*([^;{}]+)/g)].map((m) => [m[1], m[2].trim()]);
function offScale(css) {
  const out = [];
  for (const [prop, val] of decls(css)) {
    if (/calc\(/.test(val)) continue;
    const raw = (why) => out.push(`${prop}:${val} (${why})`);
    if (/^(gap|row-gap|column-gap|margin(-[a-z]+)?|padding(-[a-z]+)?)$/.test(prop)) {
      if ([...val.matchAll(/(^|[\s(])(\d*\.?\d+)px\b/g)].some((m) => Number(m[2]) > 1 && (Number(m[2]) <= 24 || Number(m[2]) === 32))) raw('--sp-*');
    } else if (prop === 'font-size' || prop === 'font') { if (/\d(px|rem|em)\b/.test(val)) raw('--fs-*'); }
    else if (prop === 'font-weight') { if (/^\d+$/.test(val)) raw('--fw-*'); }
    else if (/^border(-[a-z]+)*-radius$/.test(prop)) { if (/(^|\s)\d*\.?\d+(px|%)/.test(val) && !/^0(px)?$/.test(val)) raw('--radius-*'); }
    else if (/^transition(-duration)?$/.test(prop)) { if (/(^|[\s,])\d*\.?\d+m?s\b/.test(val)) raw('--dur-*'); }
    for (const m of val.matchAll(/color-mix\(in srgb,\s*var\(--[\w-]+\)\s+(\d+)%/g)) {
      const p = Number(m[1]), line = /^(border|outline|box-shadow)/.test(prop);
      if (p <= 24 || (line && p <= 50)) raw('--tint-*');
    }
  }
  return out;
}
test('the scale check catches raw values and lets layout through', () => {
  assert.deepEqual(offScale('a{gap:6px;padding:7px 10px;font-size:13.5px;font-weight:600;border-radius:9px;transition:left .15s;background:color-mix(in srgb,var(--green) 12%,transparent)}').length, 7);
  assert.deepEqual(offScale('a{gap:var(--sp-3);margin:0 0 1px;padding-left:44px;margin-top:-30px;width:32px;top:2px;font-size:var(--fs-md);border-radius:0;animation:spin .8s linear;border-color:color-mix(in srgb,var(--green) 60%,transparent)}'), []);
});
// The markup's and script's style="…" attributes count too.
const inline = (page) => [...page.slice(page.indexOf('</style>')).matchAll(/style="([^"]*)"/g)].map((m) => `{${m[1]}}`).join('');
for (const [name, page] of [['console', html]]) {
  test(`${name}: spacing, type, radii, motion and tints use the tokens`, () => {
    assert.deepEqual(offScale(sheet(page)), []);
    assert.deepEqual(offScale(inline(page)), []);
  });
}

const DATA = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'st1', 'st2', 'st3', 'st4', 'st-done', 'st-fail', 'st-warn', 'st-run', 'st-o1', 'st-o2', 'st-o3'];
for (const name of ['light', 'dark']) {
  test(`${name}: data colours reach 3:1 on --panel`, () => {
    const t = blocks()[name];
    for (const v of DATA) assert.ok(cr(hex(t, v), hex(t, 'panel')) >= 3, `--${v} ${cr(hex(t, v), hex(t, 'panel')).toFixed(2)}`);
  });
  test(`${name}: map labels reach 4.5:1 on their fills`, () => {
    const t = blocks()[name];
    for (const v of ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'ramp3', 'ramp4']) assert.ok(cr(hex(t, 'lbl'), hex(t, v)) >= 4.5, `--lbl on --${v} ${cr(hex(t, 'lbl'), hex(t, v)).toFixed(2)}`);
    for (const v of ['ramp1', 'ramp2']) assert.ok(cr(hex(t, 'lbl-ink'), hex(t, v)) >= 4.5, `--lbl-ink on --${v} ${cr(hex(t, 'lbl-ink'), hex(t, v)).toFixed(2)}`);
  });
}

test('no hex colour literals in the page script or markup, except the logo stroke', () => {
  const at = html.indexOf('<script type="module">', html.indexOf('</style>'));
  const isId = (m) => html.includes(`id="${m.replace(/^=?['"`]#|['"`]$/g, '')}"`); // '#c360' is a selector, not a colour
  assert.deepEqual((html.slice(at).match(/['"`]#[0-9a-f]{3,8}['"`]|="#[0-9a-f]{3,8}"/gi) || []).filter((m) => !isId(m)), []);
  assert.deepEqual((html.slice(html.indexOf('</style>'), at).match(/#[0-9a-f]{3,8}\b/gi) || []).filter((c) => c !== '#fff'), []);
});

test('head script applies the saved theme before styles, and tolerates junk', () => {
  const head = html.slice(0, html.indexOf('<style>'));
  const m = head.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, 'inline theme script must come before <style>');
  const run = (stored, throws = false) => {
    const el = { dataset: {}, removeAttribute(k) { delete this.dataset[k.replace('data-', '')]; } };
    const w = { localStorage: { getItem: () => { if (throws) throw new Error('denied'); return stored; } } };
    new Function('window', 'document', 'localStorage', m[1])(w, { documentElement: el }, w.localStorage);
    return [el.dataset.theme, w.omcTheme()];
  };
  assert.deepEqual(run('slds-dark'), ['slds-dark', 'slds-dark']);
  assert.deepEqual(run('slds-light'), ['slds-light', 'slds-light']);
  assert.deepEqual(run('purple'), [undefined, 'standard']);
  assert.deepEqual(run(null), [undefined, 'standard']);
  assert.deepEqual(run('x', true), [undefined, 'standard']);
});

test('both theme controls offer the three themes', () => {
  for (const id of ['theme', 'gateTheme']) {
    const i = html.indexOf(`id="${id}"`); assert.ok(i > 0, id);
    const ctl = html.slice(i, html.indexOf('</div>', i));
    assert.deepEqual([...ctl.matchAll(/data-theme-v="([\w-]+)"/g)].map((x) => x[1]), ['standard', 'slds-light', 'slds-dark']);
  }
});
