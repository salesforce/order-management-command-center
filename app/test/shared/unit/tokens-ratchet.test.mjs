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
// Letter-spacing, line-height, font-stretch, z-index and opacity: tokens.css has tokens for them (--label-track, --lh-body,
// --stretch-title, --z-*), but the console still types some by hand. Those are listed below as they are today, so nothing about
// how the page looks has to change. The list only shrinks: a new raw value fails, and so does a number that's gone down (lower it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from "../../support/source-view.mjs";
import { html, consoleText } from "../../support/console-source.mjs";
import { rawScale } from "../../support/console-guard.mjs";

// `prop:value` → how many times the console writes it.
const BASELINE = {
  'font-stretch:78%': 1, 'font-stretch:80%': 4, 'font-stretch:82%': 1, 'font-stretch:85%': 4,
  'letter-spacing:.01em': 1, 'letter-spacing:.03em': 1, 'letter-spacing:.06em': 1, 'letter-spacing:.07em': 3, 'letter-spacing:.08em': 4, 'letter-spacing:.12em': 1,
  'line-height:1': 3, 'line-height:1.2': 1, 'line-height:1.25': 1, 'line-height:1.45': 1, 'line-height:16px': 1,
  'z-index:1': 2, 'z-index:2': 1, 'z-index:3': 1, 'z-index:4': 1, 'z-index:6': 1, 'z-index:11': 1, 'z-index:30': 1, 'z-index:50': 1,
  'opacity:.12': 1, 'opacity:.14': 1, 'opacity:.3': 1, 'opacity:.35': 1, 'opacity:.4': 1, 'opacity:.7': 2, 'opacity:.8': 1, 'opacity:.85': 1, 'opacity:.9': 1,
};
const USE = {
  'letter-spacing': '--label-track, --th-track or --section-track', 'line-height': '--lh-tight or --lh-body', 'font-stretch': '--stretch-title or --stretch-figure',
  'z-index': 'a --z-* token', opacity: 'a token from tokens.css, or ask for one',
};

const count = (list) => list.reduce((c, k) => ({ ...c, [k]: (c[k] || 0) + 1 }), {});

test('the check finds hand-typed values and lets tokens and plain values through', () => {
  assert.deepEqual(rawScale('a{letter-spacing:.08em;line-height:1.45;font-stretch:85%;z-index:11;opacity:.7}'),
    ['letter-spacing:.08em', 'line-height:1.45', 'font-stretch:85%', 'z-index:11', 'opacity:.7']);
  assert.deepEqual(rawScale('a{letter-spacing:var(--label-track);line-height:var(--lh-body);font-stretch:var(--stretch-title);z-index:var(--z-drawer);opacity:1}'), []);
  assert.deepEqual(rawScale('a{letter-spacing:0;line-height:normal;z-index:0;z-index:auto;opacity:0;line-height:calc(1em + 2px)}'), []);
  assert.deepEqual(rawScale('<i style="z-index:7;opacity:.5">'), ['z-index:7', 'opacity:.5']);
});

test('the console types no new letter-spacing, line-height, font-stretch, z-index or opacity by hand', () => {
  const sheet = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const inline = [...consoleText.slice(html.indexOf('</style>')).matchAll(/style="([^"]*)"/g)].map((m) => `{${m[1]}}`).join('');
  const now = count([...rawScale(sheet), ...rawScale(inline)]);
  const added = Object.keys(now).filter((k) => (now[k] || 0) > (BASELINE[k] || 0));
  assert.deepEqual(added, [], added.map((k) => `${k}: use ${USE[k.split(':')[0]]}`).join('; '));
  const gone = Object.keys(BASELINE).filter((k) => (now[k] || 0) < BASELINE[k]);
  assert.deepEqual(gone, [], `${gone.join(', ')}: fewer now. Lower or delete these in BASELINE`);
});

// A token that's in tokens.css should be on the design page (app/public/design/index.html) and in docs/shared/design-tokens.md, or
// a person looking for it won't find it. These are the ones missing today; the list only shrinks, so a new token is documented.
const NOT_ON_DESIGN_PAGE = (
  '--scrim --shade --img-bg --sp-1 --sp-11 --radius-xl --radius-2xl --radius-pill --radius-round --r --fs-2xs --fs-lg --fs-xl ' +
  '--fs-2xl --fs-3xl --fs-hero --fw-normal --fw-medium --fw-bold --fw-black --stretch-title --dur-med --dur-slow --ease-pop ' +
  '--ease-settle --z-raised --z-float --z-scrim --z-drawer --z-agent --z-menu --z-toast --z-full --tint-on --tint-row --chart-hover ' +
  '--chart-mark-line '
).trim().split(' ');
const NOT_IN_DOC = (
  '--d2 --d3 --d4 --d5 --ramp2 --ramp3 --st2 --st3 --st-o2 --radius-sm --radius-md --radius-lg --radius-xl --radius-2xl --radius-pill ' +
  '--radius-round --fs-2xs --fs-xs --fs-sm --fs-md --fs-base --fs-body --fs-lg --fs-xl --fs-2xl --fs-3xl --fs-4xl --fs-kpi --fs-hero ' +
  '--fw-medium --fw-semibold --fw-display --fw-bold --fw-black --btn-primary-ink --btn-danger-ink --btn-sm-size --btn-lg-size ' +
  '--tag-square-pad --tag-square-radius --tag-square-bg --tag-square-weight '
).trim().split(' ');

const read = (p) => readFileSync(new URL(`../../../../${p}`, import.meta.url), 'utf8');
const tokenNames = (css) => [...new Set([...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]))];
const mentions = (text, name) => new RegExp(`${name.replace(/-/g, '\\-')}(?![\\w-])`).test(text);

test('every token in tokens.css is on the design page and in the doc, except the ones listed', () => {
  const names = tokenNames(read('app/public/tokens.css')), page = read('app/public/design/index.html'), doc = read('docs/shared/design-tokens.md');
  for (const [where, text, known] of [['the design page (app/public/design/index.html)', page, NOT_ON_DESIGN_PAGE], ['docs/shared/design-tokens.md', doc, NOT_IN_DOC]]) {
    const missing = names.filter((n) => !mentions(text, n) && !known.includes(n));
    assert.deepEqual(missing, [], `${missing.join(', ')}: add to ${where}`);
    const now = known.filter((n) => mentions(text, n) || !names.includes(n));
    assert.deepEqual(now, [], `${now.join(', ')}: now there (or gone from tokens.css). Delete from the list in tokens-ratchet.test.mjs`);
  }
});
