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
import fs from "../../support/source-view.mjs";
import os from 'node:os';
import path from 'node:path';
import { coverageSource, mapFileCoverage, saveBrowserCoverage, browserLcov } from "../../../tools/browser-coverage.mjs";
import { legacyModule } from '../../../public/source-layout.js';

const ORIGIN = 'http://localhost:5178';
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-coverage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const publicDir = path.join(root, 'app', 'public'); fs.mkdirSync(publicDir, { recursive: true });
  fs.writeFileSync(path.join(publicDir, 'view.js'), 'const value = 1;\nexport { value };\n');
  return { root, publicDir };
}
const loc = (line, endLine = line) => ({ start: { line, column: 0 }, end: { line: endLine, column: 8 } });

test('legacy facades do not add false coverage to their canonical implementation', (t) => {
  const { root, publicDir } = fixture(t);
  fs.mkdirSync(path.join(publicDir, 'shared/transport'), { recursive: true });
  fs.writeFileSync(path.join(publicDir, 'shared/transport/om-http.js'), '');
  fs.mkdirSync(path.join(publicDir, 'operations-console'));
  const source = 'export const S = {};'; fs.writeFileSync(path.join(publicDir, 'operations-console/console-state.js'), source);
  assert.equal(coverageSource({ url: ORIGIN + '/console-state.js', source: legacyModule('console-state.js') }, ORIGIN, root), null);
  assert.equal(coverageSource({ url: ORIGIN + '/operations-console/console-state.js', source }, ORIGIN, root).file, path.join(publicDir, 'operations-console/console-state.js'));
});

test('browser module URLs map to repository files despite ports, queries and test wrappers', (t) => {
  const { root, publicDir } = fixture(t);
  const entry = { url: ORIGIN + '/view.js?v=42', source: 'const value = 1;\nexport { value };\n// test wrapper\n' };
  assert.deepEqual(coverageSource(entry, ORIGIN, root), { file: path.join(publicDir, 'view.js'), lineOffset: 0, maxLine: 3 });
  assert.deepEqual(coverageSource({ ...entry, url: 'http://localhost:12345/view.js' }, 'http://localhost:12345', root), coverageSource(entry, ORIGIN, root));
});

test('inline JavaScript maps back to its original HTML lines', (t) => {
  const { root, publicDir } = fixture(t), source = '\nconst emoji = "😀";\nwindow.ready = true;\n';
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<!doctype html>\n<body>\n<script type="module">' + source + '</script>\n</body>');
  assert.deepEqual(coverageSource({ url: ORIGIN + '/?demo=1#limits', source }, ORIGIN, root), { file: path.join(publicDir, 'index.html'), lineOffset: 2, maxLine: 4 });
});

test('external, injected, absent and non-JavaScript resources cannot add application coverage', (t) => {
  const { root, publicDir } = fixture(t);
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<body>sample</body>');
  fs.writeFileSync(path.join(root, 'outside.js'), 'private');
  for (const entry of [
    { url: 'https://example.com/view.js', source: 'foreign' },
    { url: ORIGIN + '/', source: 'injected code' },
    { url: ORIGIN + '/missing.js', source: 'missing' },
    { url: ORIGIN + '/tokens.css', source: 'body{}' },
    { url: ORIGIN + '/%2e%2e%2f%2e%2e%2foutside.js', source: 'private' },
    { url: '', source: 'anonymous' },
    { url: ORIGIN + '/view.js' },
  ]) assert.equal(coverageSource(entry, ORIGIN, root), null, entry.url);
});

test('mapping retains actual statement, function and branch counters, including uncovered code', () => {
  const data = {
    path: '/script', statementMap: { 0: loc(1), 1: loc(2), 2: loc(5) }, s: { 0: 3, 1: 0, 2: 20 },
    fnMap: { 0: { name: 'view', line: 1, decl: loc(1), loc: loc(1, 2) }, 1: { name: 'wrapper', line: 5, decl: loc(5), loc: loc(5) } }, f: { 0: 2, 1: 20 },
    branchMap: { 0: { type: 'if', line: 1, loc: loc(1, 2), locations: [loc(1), loc(2)] }, 1: { type: 'if', line: 5, loc: loc(5), locations: [loc(5)] } }, b: { 0: [3, 0], 1: [20] },
  };
  const original = structuredClone(data), out = mapFileCoverage(data, { file: '/app/public/index.html', lineOffset: 10, maxLine: 3 });
  assert.deepEqual(out.s, { 0: 3, 1: 0 });
  assert.deepEqual(out.f, { 0: 2 });
  assert.deepEqual(out.b, { 0: [3, 0] });
  assert.deepEqual(out.statementMap, { 0: loc(11), 1: loc(12) });
  assert.deepEqual(out.fnMap[0], { name: 'view', line: 11, decl: loc(11), loc: loc(11, 12) });
  assert.deepEqual(out.branchMap[0], { type: 'if', line: 11, loc: loc(11, 12), locations: [loc(11), loc(12)] });
  assert.equal(out.path, '/app/public/index.html');
  assert.deepEqual(data, original, 'mapping one session must not mutate another session’s counters');
});

test('parallel sessions retain separate execution reports without overwriting each other', (t) => {
  const { root } = fixture(t), dir = path.join(root, 'raw');
  saveBrowserCoverage(dir, ORIGIN, [{ url: ORIGIN + '/view.js', functions: [] }]);
  saveBrowserCoverage(dir, ORIGIN, [{ url: ORIGIN + '/other.js', functions: [] }]);
  const files = fs.readdirSync(dir);
  assert.equal(files.length, 2);
  const reports = files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  assert.ok(reports.every((r) => r.origin === ORIGIN));
  assert.deepEqual(reports.map((r) => r.entries[0].url).sort(), [ORIGIN + '/other.js', ORIGIN + '/view.js']);
});

test('an empty browser run fails rather than writing a misleading LCOV report', async (t) => {
  const { root } = fixture(t), output = path.join(root, 'ui.lcov');
  await assert.rejects(browserLcov(root, output), /no browser execution data/);
  assert.equal(fs.existsSync(output), false);
});
