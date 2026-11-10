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
// Guards for changes to the Operations Console that no other test would notice: a colour typed into a style string, a query written in
// the page, a new console file with no test. Each check is shown to fire on a made-up file, then run on the real console.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { html, modules, MODULES, ARTWORK_FILES, consoleCode } from "../../support/console-source.mjs";
import { colourLiterals, queriesIn, untested, testTexts, jsRefs } from "../../support/console-guard.mjs";

test('a colour typed into a style string, attribute or script is found; tokens are not', () => {
  for (const bad of [
    '<i style="color:#ff00aa">', '<i style="x;background:red">', 'const s = `padding:0;color:rgb(255,0,170)`', '<rect fill="#abc"/>',
    'el.style.background = "hsl(10 50% 50%)"', 'border-color: #fff', 'box-shadow:0 0 0 1px red', "el.style.color = 'blue'",
    '<i style="color:crimson">', 'background:lightgray', 'color: oklch(60% 0.2 30)', 'color:hwb(10 20% 30%)', "el.style.setProperty('color', 'red')",
    "ctx.fillStyle = '#fff'", 'ctx.strokeStyle = "rgb(1,2,3)"', "g.addColorStop(0, '#abc')", '--tone:#123456', '<i style="border:1px solid tomato">',
  ]) assert.equal(colourLiterals(bad).length, 1, bad);
  for (const ok of [
    '<i style="color:var(--ink);background:color-mix(in srgb,var(--signal) 20%,transparent)">', 'color:var(--red)', 'background:var(--bad)',
    '<svg fill="#fff">', 'href="#main"', '<rect fill="url(#fade)"/>', '// was color:#fff, now a token', '/* background: red */', '<!-- fill="red" -->',
    'background:url(art/red.png)', 'color:var(--tone, var(--ink))', 'ctx.fillStyle = grad', 'el.style.color = "var(--ink)"', 'const colored = 1, redraw = 2', 'width:10px;margin:0',
  ]) assert.deepEqual(colourLiterals(ok), [], ok);
});

test('the console writes no colour of its own: every colour is a token', () => {
  const found = Object.entries({ 'index.html': html, ...modules }).flatMap(([file, text]) => colourLiterals(text).map((c) => `${file}: ${c}`));
  assert.deepEqual(found, [], 'a colour typed by hand: use a token from tokens.css (var(--ink), var(--signal)…), or add a colour to all three themes');
});

test('a query is found in the page, but not words that happen to be SQL-like', () => {
  assert.equal(queriesIn("j('/query?q=SELECT Id FROM Account')").length, 2);
  assert.equal(queriesIn('const q = `SELECT Id, Name FROM Order WHERE Id = 1`').length, 1);
  assert.equal(queriesIn('const q = `SELECT Id,\n  Name\n FROM Order WHERE Id = 1`').length, 1, 'across lines');
  assert.equal(queriesIn('const q = `SELECT ${fields} FROM ${obj}`').length, 1, 'with a template');
  for (const route of ['/queryAll?q=x', '/tooling/query?q=x', 'FIND {smith} IN NAME FIELDS']) assert.equal(queriesIn(`j(\`${route}\`)`).length, 1, route);
  assert.deepEqual(queriesIn("j(`/api/service/search?q=${q}`)"), [], 'our own search route is not a query');
  assert.deepEqual(queriesIn('Select the product from the list; choose one from stock'), []);
});

test('the console asks for data only through its API routes: no query is written in the page or its views', () => {
  assert.deepEqual(queriesIn(consoleCode), []);
});

test('a console file with no test is found', () => {
  assert.deepEqual(untested(['console-a.js', 'console-b.js'], ["import { a } from '../public/console-a.js'", "// console-b.js is mentioned here"]), ['console-b.js']);
  const imported = ['import { a } from "../public/console-a.js"', 'await import(`../public/console-a.js?copy=${n}`)', "import('../public/console-a.js?v=2')", "import '../public/console-a.js'", "import{a}from'../public/console-a.js'"];
  for (const t of imported) assert.deepEqual(untested(['console-a.js'], [t]), [], t);
  for (const t of ["// import { a } from '../public/console-a.js'", "/* import('../public/console-a.js') */", "import { a } from '../public/console-abjs'", "import { a } from '../public/xconsole-a.js'"]) assert.deepEqual(untested(['console-a.js'], [t]), ['console-a.js'], t);
});

test('every .js the console names is one the guards scanned (no import form or folder slips past)', () => {
  const known = new Set([...MODULES, ...ARTWORK_FILES]);
  const unseen = Object.entries({ 'index.html': html, ...modules }).flatMap(([file, text]) => jsRefs(text)
    .filter((r) => !r.split('/').at(-1).startsWith('om-') && !known.has(r.replace(/^\.?\//, '')))
    .map((r) => `${file} names ${r}`));
  assert.deepEqual(unseen, [], 'the tests read only flat ./name.js files in app/public: put the file there, or teach console-source.mjs to follow this import');
});

test('the console never mentions the write layer', () => {
  const found = Object.entries({ 'index.html': html, ...modules }).filter(([, text]) => /om-actions/.test(text.replace(/\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->|(^|[^:\w"'`])\/\/.*$/gm, '$1'))).map(([file]) => file);
  assert.deepEqual(found, [], 'the console is read-only: it never loads a write layer (om-actions.js)');
});

// Console files that no test imports. The views draw into the page, so browser tests under operations-console/ui/ and source checks exercise them,
// and some tests read their source as text. A reason is required, and the list only shrinks: add a test that imports the
// file, then delete its entry.
const NO_OWN_TEST = {
  'console-map-view.js': 'the map and its KPI row: only the browser tests (operations-console/ui/operation-console/) drive it',
  'console-dash-view.js': 'the Dashboard: source checks read it; operations-console/ui/dashboard/ drives every panel in the browser',
  'console-limits-view.js': 'Limits: limits-view.test.mjs reads its source; operations-console/ui/limits/ drives its components and page flows',
  'console-service-view.js': 'the Service Console queue, search and customer: operations-console/ui/service-console/ drives each component and the full page',
  'console-state.js': 'the one shared state object `S`: no logic to test on its own',
};
test('every console file has a test, or is listed with a reason', () => {
  const files = MODULES.filter((f) => !f.startsWith('om-') && !['cities.js', 'geo.js'].includes(f)); // geo.js and cities.js are map data
  const missing = untested(files, testTexts()).filter((f) => !(f in NO_OWN_TEST));
  assert.deepEqual(missing, [], `${missing.join(', ')}: add a test that imports it (app/test/<name>.test.mjs), or list it in NO_OWN_TEST with a reason`);
  const stale = Object.keys(NO_OWN_TEST).filter((f) => !untested(files, testTexts()).includes(f));
  assert.deepEqual(stale, [], `${stale.join(', ')} now has a test: remove it from NO_OWN_TEST`);
});
