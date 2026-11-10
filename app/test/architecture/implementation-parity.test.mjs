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
import { createHash } from 'node:crypto';

const baseline = JSON.parse(fs.readFileSync(new URL('./implementation-baseline.json', import.meta.url)));
const sonarPatches = JSON.parse(fs.readFileSync(new URL('./sonar-compatibility-patches.json', import.meta.url)));
const normalize = (s) => s.replace(/((?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"])(\.{1,2}\/[^'"]+\.js)(['"])/g, '$1<MODULE>$3');
// Keep the original hashes: undo only the exact, reviewed Sonar patches before comparing to main.
function baselineSource(source, patches = []) {
  for (const { before, after } of patches) {
    assert.ok(after && before !== after);
    assert.equal(source.split(after).length, 2, 'a compatibility patch matches exactly once');
    source = source.replace(after, () => before);
  }
  return source;
}
test('every unmixed UI, action, rule, read, style and asset keeps its baseline implementation', () => {
  assert.ok(Object.keys(baseline.files).length > 30);
  for (const [old, { source, sha256 }] of Object.entries(baseline.files)) {
    const data = fs.readFileSync(new URL('../../public/' + source, import.meta.url));
    const hash = createHash('sha256').update(/\.(?:js|html)$/.test(old) ? normalize(baselineSource(data.toString(), sonarPatches[old]?.patches)) : data).digest('hex');
    assert.equal(hash, sha256, `${old}: implementation changed beyond its module location`);
  }
});
test('Sonar compatibility patches are explicit and cannot hide unrelated source changes', () => {
  assert.equal(Object.keys(sonarPatches).length, 4);
  for (const [old, entry] of Object.entries(sonarPatches)) {
    assert.ok(baseline.files[old], old);
    assert.match(entry.rule, /^javascript:S(2189|6324|5852)$/);
    assert.ok(entry.reason && entry.patches.length);
  }
  const patches = [{ before: 'old cursor', after: 'new cursor' }];
  assert.equal(baselineSource('new cursor; return 2', patches), 'old cursor; return 2');
  assert.throws(() => baselineSource('unrelated change', patches));
  assert.throws(() => baselineSource('new cursor new cursor', patches));
});
test('implementation parity normalization cannot conceal changed action, query, markup or token values', () => {
  assert.equal(normalize("import { x } from './old.js';"), normalize("import { x } from '../new/x.js';"));
  for (const [a, b] of [['return 1', 'return 2'], ['SELECT Id FROM Account', 'SELECT Name FROM Account'], ['<p>A</p>', '<p>B</p>'], ['--space:1px', '--space:2px']]) assert.notEqual(normalize(a), normalize(b));
});
