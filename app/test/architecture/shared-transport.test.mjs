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
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, cpSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { build, SOURCE_MODULES, flattenScoped, uniqueFiles } from "../../tools/build-ui-bundle.mjs";
import { bundleModule, LOADER } from "../../tools/build-artifact.mjs";
import { sourcePath } from '../../public/source-layout.js';

const PUBLIC = new URL("../../public/", import.meta.url);
// Recorded from 9ce36e5bd630e35653a51181371923ce329301d2; HTTP and meter hashes refreshed only for approved product-name comments.
const HASHES = {
  'om-http.js': '9d983a0ce7579b9ea7cf2e83479e5ebe3c0ce39290aed3ad6d188d4ef28e1939',
  'om-meter.js': 'ab59714c6c7351af668a15bee71b12428a546986fde0620cef2fe27ee910948d',
  'om-graphql.js': '42f4a6f6beb3d4f0439f37f3882d72f6b59535b49d3a36a0ca92b459c6553b8b',
};
const temporary = (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'om-scoped-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('virtual source directories resolve only when every child has the same canonical owner', () => {
  const files = { 'tools/one.mjs': 'tools/shared/one.mjs', 'tools/two.mjs': 'tools/operations-console/two.mjs', 'console/a.js': 'operations-console/a.js', 'console/b.js': 'operations-console/b.js' };
  assert.equal(sourcePath('tools', files), 'tools');
  assert.equal(sourcePath('console', files), 'operations-console');
  assert.equal(sourcePath('tools/one.mjs', files), 'tools/shared/one.mjs');
  assert.equal(sourcePath('unknown', files), 'unknown');
  assert.equal(sourcePath('constructor', files), 'constructor');
});

for (const [legacy, hash] of Object.entries(HASHES)) {
  test(`shared extraction preserves the implementation and module identity: ${legacy}`, async () => {
    const file = SOURCE_MODULES[legacy];
    const implementation = readFileSync(new URL(file, PUBLIC), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(createHash('sha256').update(implementation).digest('hex'), hash);
    const old = await import(new URL(legacy, PUBLIC)), canonical = await import(new URL(file, PUBLIC));
    assert.deepEqual(Object.keys(old), Object.keys(canonical));
    for (const name of Object.keys(old)) assert.equal(old[name], canonical[name], name);
  });
}

test('nested imports flatten to one versioned module name without rewriting external imports', () => {
  assert.equal(flattenScoped("import { readBody } from './shared/transport/om-http.js'; import('../shared/transport/om-meter.js'); import 'node:fs';"),
    "import { readBody } from './om-http.js'; import('./om-meter.js'); import 'node:fs';");
  assert.throws(() => uniqueFiles([['x.js', 'one/x.js'], ['x.js', 'two/x.js']]), /filename collision: x\.js/);
});

test('artifact imports resolve relative to each nested module and initialize its shared dependency once', async () => {
  const ctx = vm.createContext({}); ctx.window = ctx;
  vm.runInContext(LOADER, ctx);
  const shared = bundleModule('shared/transport/x.js', 'globalThis.runs = (globalThis.runs || 0) + 1;\nexport const value = 7;');
  const a = bundleModule('operations-console/a.js', "import { value } from '../shared/transport/x.js';\nexport const read = () => value;\nexport const lazy = () => import('../shared/transport/x.js');");
  const b = bundleModule('operations-console/b.js', "import { value } from '../shared/transport/x.js';\nexport const read = () => value;");
  for (const mod of [shared, a, b]) vm.runInContext(mod.code, ctx);
  const first = await ctx.__omcImport('operations-console/a.js'), second = await ctx.__omcImport('operations-console/b.js');
  assert.equal(first.read(), 7); assert.equal(second.read(), 7);
  assert.equal((await first.lazy()).value, 7);
  assert.equal(ctx.runs, 1);
  assert.throws(() => bundleModule('shared/x.js', "import { x } from '../../private.js';"), /escapes the public source tree/);
});

test('console UIBundle contains canonical implementations and resolves every flattened import', (t) => {
  const root = temporary(t), publicDir = path.join(root, 'public'), bundle = path.join(root, 'bundle');
  cpSync(PUBLIC, publicDir, { recursive: true });
  const count = build({ publicDir, bundle }), src = path.join(bundle, 'src'), files = readdirSync(src);
  assert.equal(files.length, count);
  for (const legacy of Object.keys(HASHES)) {
    assert.equal(readFileSync(path.join(src, legacy), 'utf8'), readFileSync(new URL(SOURCE_MODULES[legacy], PUBLIC), 'utf8'));
  }
  for (const file of files.filter((f) => /\.(js|html)$/.test(f))) {
    const code = readFileSync(path.join(src, file), 'utf8');
    const refs = [...code.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)['"](\.{1,2}\/[^'"]+\.js)(?:\?[^'"]*)?['"]/g)];
    for (const [, ref] of refs) {
      assert.ok(!ref.includes('/shared/'), `${file}: ${ref} is not flattened`);
      assert.ok(files.includes(ref.slice(2)), `${file}: ${ref} is missing`);
    }
  }
});
