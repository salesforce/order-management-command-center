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
import { createSourceView } from '../../public/source-layout.js';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'om-source-view-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (name, text = '') => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text);
    return file;
  };
  return { root, put, view: createSourceView(fs, path) };
}
test('the source view reads and writes legacy module names through canonical files', (t) => {
  const f = fixture(t);
  f.put('source-layout.js'); f.put('shared/transport/om-http.js');
  const actual = f.put('operations-console/console-state.js', "import './console-kit.js';\nexport const state = {};");
  const legacy = path.join(f.root, 'console-state.js');
  assert.equal(f.view.readFileSync(legacy, 'utf8'), "import './console-kit.js';\nexport const state = {};");
  f.view.writeFileSync(legacy, "import './om-http.js';");
  assert.equal(fs.readFileSync(actual, 'utf8'), "import '../shared/transport/om-http.js';");
  assert.equal(fs.existsSync(legacy), false);
});
test('materialized source views retain tool, context and original-file fallback precedence', (t) => {
  const f = fixture(t);
  f.put('public/source-layout.js'); f.put('public/shared/transport/om-http.js'); f.put('public/legacy-source-view.json');
  const legacy = f.put('tools/golden.mjs', 'original'), context = f.put('test/support/legacy-context/tools/golden.mjs', 'context');
  const tool = f.put('test/support/legacy-tools/shared/golden.mjs', 'tool');
  assert.equal(f.view.readFileSync(legacy, 'utf8'), 'tool');
  fs.rmSync(tool); assert.equal(f.view.readFileSync(legacy, 'utf8'), 'context');
  fs.rmSync(context); assert.equal(f.view.readFileSync(legacy, 'utf8'), 'original');
  f.put('tools/shared/golden.mjs', 'canonical');
  assert.equal(f.view.readFileSync(legacy, 'utf8'), 'canonical');
});
