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
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { staticSite } from '../../../tools/shared/static-site.mjs';

const PUBLIC = new URL('../../../public/', import.meta.url);
const CLI = fileURLToPath(new URL('../../../tools/shared/static-site.mjs', import.meta.url));

function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'om-static-site-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const source = path.join(temp, 'public'), output = path.join(temp, 'site'); fs.mkdirSync(source);
  return { source, output, put(name, text) { const p = path.join(source, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); } };
}
test('hosted deployment preserves stable entry URLs, canonical singleton imports and the selected configuration', (t) => {
  const f = fixture(t), sources = { 'index.html': 'operations-console/index.html', 'state.js': 'operations-console/state.js', 'om-config.js': 'shared/transport/om-config.js' };
  f.put('source-layout.js', 'export const PUBLIC_SOURCES = ' + JSON.stringify(sources) + ';');
  f.put('operations-console/index.html', '<script type="module">import "./state.js";</script>');
  f.put('operations-console/state.js', 'export const state = {};'); f.put('shared/transport/om-config.js', 'export const CONFIG = {};');
  staticSite(f.source, f.output, { configuration: 'export const CONFIG = {domain:"fixture"};' });
  const read = (file) => fs.readFileSync(path.join(f.output, file), 'utf8');
  assert.match(read('index.html'), /operations-console\/state.js/);
  assert.equal(read('state.js'), 'export * from "./operations-console/state.js";\n');
  assert.equal(read('operations-console/state.js'), fs.readFileSync(path.join(f.source, 'operations-console/state.js'), 'utf8'));
  assert.match(read('om-config.js'), /shared\/transport\/om-config.js/);
  assert.match(read('shared/transport/om-config.js'), /fixture/);
  assert.equal(fs.existsSync(path.join(f.output, 'operations-console/index.html')), false);
  assert.equal(fs.existsSync(path.join(f.output, 'source-layout.js')), false);
  assert.equal(fs.readFileSync(path.join(f.source, 'shared/transport/om-config.js'), 'utf8'), 'export const CONFIG = {};');
});
test('publishing a pre-refactor revision preserves its flat structure', (t) => {
  const f = fixture(t); f.put('index.html', 'original'); f.put('om-config.js', 'old');
  staticSite(f.source, f.output, { configuration: 'internal' });
  assert.equal(fs.readFileSync(path.join(f.output, 'index.html'), 'utf8'), 'original');
  assert.equal(fs.readFileSync(path.join(f.output, 'om-config.js'), 'utf8'), 'internal');
});
test('a missing or unsafe declared asset fails assembly', (t) => {
  const f = fixture(t); f.put('source-layout.js', 'export const PUBLIC_SOURCES = {"index.html":"../private.html"};');
  assert.throws(() => staticSite(f.source, f.output), /unsafe asset path/);
  for (const sources of [{ '../outside.js': 'safe.js' }, { 'safe.js': '/private.js' }, { '': 'safe.js' }]) {
    f.put('source-layout.js', 'export const PUBLIC_SOURCES = ' + JSON.stringify(sources) + ';');
    assert.throws(() => staticSite(f.source, f.output), /unsafe asset path/);
  }
});

test('the public CLI produces uploadable entries and keeps the deployment configuration without changing source files', (t) => {
  const f = fixture(t), config = fs.readFileSync(new URL('shared/transport/om-config.js', PUBLIC), 'utf8');
  const result = spawnSync(process.execPath, [CLI, f.output], { cwd: f.source, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  for (const file of ['index.html', 'design/index.html', 'tokens.css']) {
    assert.ok(fs.statSync(path.join(f.output, file)).isFile(), file);
  }
  for (const dir of ['service', 'service-center', 'composition']) assert.equal(fs.existsSync(path.join(f.output, dir)), false, dir);
  assert.match(fs.readFileSync(path.join(f.output, 'index.html'), 'utf8'), /operations-console\/transport\/browser.js/);
  assert.equal(fs.readFileSync(path.join(f.output, 'shared/transport/om-config.js'), 'utf8'), config);
  assert.equal(fs.readFileSync(new URL('shared/transport/om-config.js', PUBLIC), 'utf8'), config);
  assert.equal(fs.existsSync(new URL('index.html', PUBLIC)), false, 'no generated entry is written into public/');
  assert.equal(fs.existsSync(path.join(f.output, 'source-layout.js')), false);
});

test('the public CLI refuses missing arguments and a nonempty destination without overwriting files', (t) => {
  const f = fixture(t);
  const usage = spawnSync(process.execPath, [CLI], { encoding: 'utf8' });
  assert.notEqual(usage.status, 0); assert.match(usage.stderr, /Usage:/);
  fs.mkdirSync(f.output); fs.writeFileSync(path.join(f.output, 'keep.txt'), 'keep');
  const refused = spawnSync(process.execPath, [CLI, f.output], { encoding: 'utf8' });
  assert.notEqual(refused.status, 0); assert.match(refused.stderr, /must be empty/);
  assert.deepEqual(fs.readdirSync(f.output), ['keep.txt']);
  assert.equal(fs.readFileSync(path.join(f.output, 'keep.txt'), 'utf8'), 'keep');
});
