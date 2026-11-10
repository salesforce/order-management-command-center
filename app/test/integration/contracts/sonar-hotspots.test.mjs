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
// Regression coverage for the reported unbounded regex uses in the console and shared code (the others were in OM Service
// Console, which this release doesn't ship).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CSV_NUMBER, csvCell } from '../../../public/operations-console/console-csv.js';
import { plainText, parseTranscript } from '../../../public/shared/data/om-core-util.js';

const patches = JSON.parse(fs.readFileSync(new URL('../../architecture/sonar-compatibility-patches.json', import.meta.url)));
const read = (file) => fs.readFileSync(new URL('../../../' + file, import.meta.url), 'utf8');
function original(file, source) {
  for (const { before, after } of patches[file].patches) {
    assert.equal(source.split(after).length, 2);
    source = source.replace(after, () => before);
  }
  return source;
}
const utilSource = original('om-core-util.js', read('public/shared/data/om-core-util.js'));
const previousUtil = new Function('ID_RE', utilSource.replace(/^import .*;$/gm, '').replace(/^export /gm, '') + '\nreturn { plainText, parseTranscript };')(/^[a-zA-Z0-9]{15,18}$/);
function* combinations(alphabet, maximum, prefix = '') {
  yield prefix;
  if (prefix.length < maximum) for (const char of alphabet) yield* combinations(alphabet, maximum, prefix + char);
}

test('CSV numbers retain decimal and exponent syntax and reject formula text on large inputs', () => {
  const before = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;
  for (const text of combinations(['0', '1', '.', '+', '-', 'e', ' '], 5))
    assert.equal(CSV_NUMBER.test(text), before.test(text), JSON.stringify(text));
  for (const text of ['1E+100', '-.25e-20', '10.', '+10.0', '00.1', '1e9999']) assert.equal(CSV_NUMBER.test(text), true, text);
  const digits = '1'.repeat(200000);
  assert.equal(CSV_NUMBER.test(digits), true);
  assert.equal(CSV_NUMBER.test('-' + digits + 'x'), false);
  assert.equal(CSV_NUMBER.test(digits + 'e'), false);
  assert.ok(csvCell('-' + digits + 'x').startsWith('"\''));
});

test('HTML and transcript parsing match the original on malformed tags, whitespace and buttons', () => {
  const fragments = ['', 'hello', '<b>hello</b>', '<unclosed', '<<<>x>', '<>x<>', '&lt;b&gt;&amp;', '&#x1f600;', 'a<p>system</p>b', 'one<br>two', '\ud800x\udfff'];
  for (const text of fragments) assert.equal(plainText(text), previousUtil.plainText(text), text);
  for (const a of ['4s', ' 4s  ', ' ', '\t \u00a0', '00:01', 'x)y', '', '\r\n', 'a \n b']) {
    for (const who of ['Name', ' Name  ', '', ' ', '\t\t', 'A:B', '(me)', 'x)y', '😀']) {
      for (const body of ['hello', ' hello', '\thello', '\nhello', '', '{ChatWindowButton:Yes,No}', 'first<br>continuation', '<p>System</p>', '&lt;b&gt;x&lt;/b&gt;']) {
        const text = `(${a})${who}:${body}`;
        assert.deepEqual(parseTranscript(text), previousUtil.parseTranscript(text), JSON.stringify(text));
      }
    }
  }
  for (const text of ['() Name: x', '(4s)Name:', '(4s)Name', '(  ) : x', '(4s) A: first<br>second<br>(5s) B: reply', null, undefined])
    assert.deepEqual(parseTranscript(text), previousUtil.parseTranscript(text));
  const malformed = '<'.repeat(200000);
  assert.equal(plainText(malformed), malformed);
  assert.deepEqual(parseTranscript('(' + ' '.repeat(200000) + ') Name: hello'), [{ kind: 'message', at: ' ', who: 'Name', text: 'hello' }]);
  const noColon = '(4s) ' + 'name '.repeat(40000);
  assert.deepEqual(parseTranscript(noColon), [{ kind: 'system', text: noColon.trim() }]);
});
