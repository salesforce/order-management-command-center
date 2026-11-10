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
import vm from 'node:vm';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, statSync, rmSync } from "../../support/source-view.mjs";
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { LOADER, bundleModule, buildHtml, buildArtifact, buildTokensHtml, MAX_BYTES } from "../../../tools/build-artifact.mjs";

const PUBLIC = fileURLToPath(new URL("../../../public/", import.meta.url));
const TOOL = fileURLToPath(new URL("../../../tools/build-artifact.mjs", import.meta.url));
const tmp = () => mkdtempSync(path.join(tmpdir(), 'omc-artifact-'));

test('modules become __omcDef scripts: imports go through the loader, exports are returned', () => {
  const src = "import { a, b as c } from './x.js';\nexport const K = 1;\nexport let n = 2;\nexport function f() { return import('./y.js'); }\nexport async function g() {}\nexport class C {}\nconst local = 3;";
  const { code, deps } = bundleModule('m.js', src);
  assert.deepEqual(deps.sort(), ['x.js', 'y.js']);
  assert.match(code, /^__omcDef\('m\.js', async \(\) => \{\n'use strict';\n/);
  assert.match(code, /const \{ a, b: c \} = await __omcImport\('x\.js'\);/);
  assert.match(code, /return __omcImport\('y\.js'\);/);
  assert.match(code, /\nconst K = 1;\nlet n = 2;\nfunction f\(\)/);
  assert.match(code, /\nasync function g\(\) \{\}\nclass C \{\}\nconst local = 3;/);
  assert.match(code, /return \{ K, n, f, g, C \};\n\}\);$/);
});

test('import and export forms the loader does not support stop the build, naming the module', () => {
  assert.throws(() => bundleModule('d.js', 'export default 1;'), /build-artifact: d\.js: unsupported export/);
  assert.throws(() => bundleModule('s.js', "import * as x from './x.js';"), /build-artifact: s\.js: unsupported import/);
  assert.throws(() => bundleModule('e.js', 'const a = 1;\nexport { a as b };'), /build-artifact: e\.js: unsupported export/);
  assert.throws(() => bundleModule('r.js', "export { a } from './x.js';"), /build-artifact: r\.js: unsupported export/);
  assert.throws(() => bundleModule('n.js', 'const a = 1;\nexport { a, z };'), /build-artifact: n\.js: exports z, which it doesn't declare or import/);
  assert.throws(() => bundleModule('u.js', 'const here = new URL(".", import.meta.url);'), /build-artifact: u\.js: import\.meta/);
});

test('export { … } lists names the module declares or imports, as om-core does with two of om-reads', async () => {
  const ctx = vm.createContext({});
  ctx.window = ctx;
  vm.runInContext(LOADER, ctx);
  vm.runInContext(bundleModule('x.js', 'export const A = 1;\nexport const B = 2;').code, ctx);
  const m = bundleModule('m.js', "import { A, B as Bee } from './x.js';\nexport { A, Bee };\nconst c = 3;\nexport { c };");
  assert.deepEqual(m.exports, ['A', 'Bee', 'c']);
  vm.runInContext(m.code, ctx);
  assert.deepEqual({ ...(await vm.runInContext("__omcImport('m.js')", ctx)) }, { A: 1, Bee: 2, c: 3 });
});

test('bundled modules run once and import each other through the loader', async () => {
  const ctx = vm.createContext({});
  ctx.window = ctx;
  vm.runInContext(LOADER, ctx);
  vm.runInContext(bundleModule('x.js', 'globalThis.runs = (globalThis.runs || 0) + 1;\nexport const v = 41;').code, ctx);
  vm.runInContext(bundleModule('m.js', "import { v } from './x.js';\nexport const w = v + 1;").code, ctx);
  assert.equal((await vm.runInContext("__omcImport('m.js')", ctx)).w, 42);
  await vm.runInContext("__omcImport('x.js')", ctx);
  assert.equal(ctx.runs, 1);
  await assert.rejects(vm.runInContext("__omcImport('om-browser.js')", ctx), /om-browser\.js is not in the edit view/);
});

test('the edit view is one self-contained page: sample data, every script, module and image inlined, the picker added', () => {
  const out = path.join(tmp(), 'om-console.html');
  const { bytes } = buildArtifact({ out });
  const html = readFileSync(out, 'utf8');
  assert.equal(bytes, statSync(out).size);
  assert.ok(bytes <= MAX_BYTES, `${bytes} bytes`);
  assert.match(html, /const FORCE = 'demo';/); // om-mode.js, the page's mode: sample data whatever the address
  assert.doesNotMatch(html, /const FORCE = null;/);
  assert.doesNotMatch(html, /<script[^>]*\ssrc="(?!https?:)/);
  assert.doesNotMatch(html, /\bimport\(\s*['"]\.\//);
  assert.doesNotMatch(html, /\bfrom\s*['"]\.\//);
  assert.doesNotMatch(html, /\bsrc="[\w.-]+\.(webp|png|jpe?g|gif|svg)"/);
  assert.doesNotMatch(html, /<link rel="stylesheet" href="tokens\.css">/);
  assert.ok(html.includes(readFileSync(path.join(PUBLIC, 'tokens.css'), 'utf8')), 'the design tokens are inlined');
  assert.ok(html.indexOf('--btn-pad:') < html.indexOf('button{cursor:pointer'), 'the tokens come before the page styles that use them');
  for (const m of ['agent-panel', 'om-agent']) assert.match(html, new RegExp(`__omcDef\\('${m}\\.js'`), m);
  assert.doesNotMatch(html, /__omcDef\('om-(core|browser|platform)\.js'/);
  assert.match(html, /__omcImport\('agent-panel\.js'\)/);
  assert.match(html, /OMC_EDIT/);
  assert.match(html, /#logout\{display:none\}/);
  assert.match(html, /fonts\.googleapis\.com/); // the one external host artifacts allow
  assert.ok(html.indexOf('<meta charset="utf-8">') < 1024, 'the charset declaration stays in the first 1024 bytes');
});

test('the design tokens page is one file too: tokens.css inlined, nothing local left, and it calls nothing', () => {
  const html = buildTokensHtml(), css = readFileSync(path.join(PUBLIC, 'tokens.css'), 'utf8');
  assert.ok(html.includes(css));
  assert.doesNotMatch(html, /<link rel="stylesheet" href="(?!https?:)/);
  assert.doesNotMatch(html, /\bfetch\(|callMcpTool|XMLHttpRequest/);
  assert.ok(html.indexOf(css) < html.indexOf('.btn{cursor:pointer'), 'the tokens come before the styles that use them');
  const dir = tmp(), page = readFileSync(path.join(PUBLIC, 'design', 'index.html'), 'utf8');
  try {
    cpSync(PUBLIC, dir, { recursive: true });
    writeFileSync(path.join(dir, 'design', 'index.html'), page.replace('href="../tokens.css"', 'href="../other.css"'));
    assert.throws(() => buildTokensHtml(dir), /build-artifact: expected the link to \.\.\/tokens\.css/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a CRLF checkout (git on Windows) builds the same', () => {
  const dir = tmp();
  cpSync(PUBLIC, dir, { recursive: true });
  for (const f of ['index.html', 'agent-panel.js', 'om-agent.js', 'geo.js', 'cities.js']) {
    const p = path.join(dir, f);
    writeFileSync(p, readFileSync(p, 'utf8').replace(/\r?\n/g, '\r\n'));
  }
  const html = buildHtml(dir);
  assert.match(html, /const FORCE = 'demo';/);
  assert.match(html, /__omcDef\('agent-panel\.js'/);
  assert.match(html, /const \{ isReadAction \} = await __omcImport\('om-agent\.js'\);/);
  assert.ok(html.indexOf('<meta charset="utf-8">') < 1024);
});

test('an export that would be lost, or an import of a name that is not exported, stops the build', () => {
  assert.throws(() => bundleModule('a.js', 'export const A = 1, B = 2;'), /build-artifact: a\.js: one name per export/);
  assert.doesNotThrow(() => bundleModule('b.js', "export const L = ['x', 'y'];\nexport const f = (a, b) => g(a, b);\nexport const U = 'https://x.example/a,b'; // a, b\nexport const O = {\n  a: 1,\n};"));
  const dir = tmp();
  cpSync(PUBLIC, dir, { recursive: true });
  const p = path.join(dir, 'agent-panel.js');
  writeFileSync(p, readFileSync(p, 'utf8').replace("import { isReadAction } from './om-agent.js';", "import { isReadAction, notThere } from './om-agent.js';"));
  assert.throws(() => buildHtml(dir), /build-artifact: agent-panel\.js imports notThere from om-agent\.js, which doesn't export it/);
});

test('local assets the build cannot inline stop it, instead of breaking under the artifact CSP', () => {
  for (const [snippet, what] of [['<link rel="icon" href="favicon.png">', /a local <link href>/], ['<div style="background:url(bg.png)"></div>', /a local url\(\)/],
    ['<img srcset="a.png 2x">', /a srcset/], ["<img src='x.png'>", /a local src/], ['<img src="img/x.png">', /a local src/], ["<script>img.src = 'x.png';</script>", /a \.src set to a local file/]]) {
    const dir = tmp();
    cpSync(PUBLIC, dir, { recursive: true });
    const p = path.join(dir, 'index.html');
    writeFileSync(p, readFileSync(p, 'utf8').replace(/<\/body>(?![\s\S]*<\/body>)/, `${snippet}\n</body>`));
    assert.throws(() => buildHtml(dir), what, snippet);
  }
});

test('public/ is not changed by the build', () => {
  const before = readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  buildArtifact({ out: path.join(tmp(), 'a.html') });
  assert.equal(readFileSync(path.join(PUBLIC, 'index.html'), 'utf8'), before);
});

test('a console change the build does not expect stops it, naming what is missing', () => {
  const dir = tmp();
  cpSync(PUBLIC, dir, { recursive: true });
  const page = path.join(dir, 'index.html'), original = readFileSync(page, 'utf8'), mode = path.join(dir, 'om-mode.js'), modeSrc = readFileSync(mode, 'utf8');
  writeFileSync(mode, modeSrc.replace('const FORCE = null;', "const FORCE = location.hash === '#demo' ? 'demo' : null;"));
  assert.throws(() => buildHtml(dir), /build-artifact: expected the mode switch/);
  writeFileSync(mode, modeSrc);
  writeFileSync(page, original.replace('<script type="module">', '<script>'));
  assert.throws(() => buildHtml(dir), /build-artifact: expected the console's <script type="module">/);
  writeFileSync(page, original);
  const panel = path.join(dir, 'agent-panel.js');
  writeFileSync(panel, readFileSync(panel, 'utf8').replace('${AGENT_ICON}', '<img src="missing.webp" alt="">'));
  assert.throws(() => buildHtml(dir), /build-artifact: agent-panel\.js points at missing\.webp, which isn't in public\//);
});

test('the command line writes the file and says where; a failure exits 1 with the reason', () => {
  const out = path.join(tmp(), 'cli.html');
  const ok = spawnSync('node', [TOOL, out], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /^Built .*cli\.html \(\d+ KB, sample data only\)/);
  assert.ok(statSync(out).size > 100000);
  const bad = spawnSync('node', [TOOL, path.join(TOOL, 'not-a-dir', 'x.html')], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.ok(bad.stderr.trim().length > 0);
});

const PICKER = fileURLToPath(new URL("../../../tools/operations-console/artifact-picker.js", import.meta.url));
const picker = () => { const ctx = vm.createContext({}); vm.runInContext(readFileSync(PICKER, 'utf8'), ctx); return ctx.OMC_EDIT; };
// A minimal element: enough for pathOf and labelOf, which only walk parentElement/children and read attributes.
const el = (tag, attrs = {}, kids = [], text = '') => {
  const n = { tagName: tag.toUpperCase(), children: kids, parentElement: null, textContent: text || kids.map((k) => k.textContent).join(' '),
    className: tag === 'path' ? { baseVal: attrs.class || '' } : attrs.class || '', getAttribute: (k) => attrs[k] ?? null };
  kids.forEach((k) => { k.parentElement = n; });
  return n;
};

test('picks become a prompt to paste back, one numbered line per pick with its exact anchor', () => {
  const { formatPrompt } = picker();
  const zone = (panel, id) => ({ view: 'Operations Console', panel, id, path: '', label: '' });
  const text = formatPrompt([
    { action: 'change', at: { view: 'Operations Console', panel: 'Status board', id: 'board', path: 'div.sb > div:nth-of-type(2) > h3', label: 'Fulfillment Orders by status' }, note: ' show percentages\n next to the counts ' },
    { action: 'move', at: zone('Activity stream', 'stream'), to: { where: 'before', at: zone('Exception queue', 'exList') }, note: '' },
    { action: 'remove', at: { view: 'Dashboard (Fulfillment)', panel: 'Carrier performance', id: 'pCarrier', path: '', label: '' }, note: "we don't track carriers" },
  ]);
  assert.equal(text, [
    'Salesforce Order Management Operations Console edits from the edit view (sample data). Apply them with the build-oms-console skill. Use only the design tokens in app/public/shared/ui/tokens.css, and add or update a test; run the whole suite (node --test "app/test/**/*.test.mjs") before saying it is done.',
    '1. CHANGE · Operations Console › Status board [#board] › div.sb > div:nth-of-type(2) > h3 · "Fulfillment Orders by status"',
    '   Note: show percentages next to the counts',
    '2. MOVE · Operations Console › Activity stream [#stream] → before Operations Console › Exception queue [#exList]',
    '3. REMOVE · Dashboard (Fulfillment) › Carrier performance [#pCarrier]',
    "   Note: we don't track carriers",
  ].join('\n'));
});

test('paths run from the panel down, with nth-of-type only where siblings share a tag, and at most 4 steps', () => {
  const { pathOf } = picker();
  const h3 = el('h3', {}, [], 'Fulfillment Orders by status');
  const board = el('div', { id: 'board', class: 'body' }, [el('div', { class: 'sb' }, [el('div', {}, [el('h3', {}, [], 'Order Summaries')]), el('div', {}, [h3])])]);
  assert.equal(pathOf(board, h3), 'div.sb > div:nth-of-type(2) > h3');
  // SVG: className is an SVGAnimatedString, so classes come from getAttribute; state classes (on, hide) are left out.
  const state = el('path', { class: 'st on' });
  const map = el('svg', { id: 'map', class: 'map' }, [el('g', { class: 'states' }, [el('path', { class: 'st' }), state])]);
  assert.equal(pathOf(map, state), 'g.states > path.st:nth-of-type(2)');
  const deep = el('b');
  let top = deep; for (let i = 0; i < 5; i++) top = el('div', { class: `l${i}` }, [top]);
  const panel = el('section', { class: 'zone' }, [top]);
  assert.equal(pathOf(panel, deep), '… div.l2 > div.l1 > div.l0 > b');
});

test('labels prefer aria-label and title, collapse whitespace, and stop at 60 characters', () => {
  const { labelOf } = picker();
  assert.equal(labelOf(el('button', { 'aria-label': 'Zoom in', title: 'Zoom in (+)' }, [], '+')), 'Zoom in');
  assert.equal(labelOf(el('button', { title: 'Download this panel as CSV' }, [], 'CSV')), 'Download this panel as CSV');
  assert.equal(labelOf(el('td', {}, [], '  Order\n   00004210  ')), 'Order 00004210');
  // Text from separate elements gets a space between: <h3><span>Fulfillment Orders by status</span><b>268</b></h3>.
  const txt = (s) => ({ nodeType: 3, textContent: s }), node = (...childNodes) => ({ nodeType: 1, childNodes });
  const h3 = { ...node(node(txt('Fulfillment Orders by status')), node(txt('268'))), getAttribute: () => null };
  assert.equal(labelOf(h3), 'Fulfillment Orders by status 268');
  const long = labelOf(el('div', {}, [], 'x'.repeat(200)));
  assert.equal(long.length, 60);
  assert.ok(long.endsWith('…'));
});
