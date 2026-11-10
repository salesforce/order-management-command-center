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
import { caseParity } from '../../tools/shared/check-case-parity.mjs';

const options = { files: { 'old.test.mjs': [[0, 'same name'], [0, 'same name'], [1, 'nested']] }, moves: { 'old.test.mjs': 'owned/new.test.mjs' } };
const records = ['same name', 'same name', 'nested'].map((name, i) => ({ file: 'owned/new.test.mjs', name, nesting: i === 2 ? 1 : 0, passed: true, skipped: false }));
test('case parity retains duplicate names, nesting and moved registration files', () => {
  assert.deepEqual(caseParity(records, options), { baseline: 3, executed: 3, added: 0 });
});
test('a replacement case cannot conceal a lost baseline case behind the same count', () => {
  assert.throws(() => caseParity([records[0], records[2], { ...records[1], name: 'replacement' }], options), /Missing baseline case/);
});
test('skipped, failing and incorrectly nested baseline cases fail the gate', () => {
  for (const change of [{ skipped: true }, { passed: false }, { nesting: 1 }, { file: 'wrong.test.mjs' }]) {
    assert.throws(() => caseParity([{ ...records[0], ...change }, ...records.slice(1)], options), /did not pass|Missing baseline case/);
  }
});
test('the case gate rejects a failing added case even when every baseline case passed', () => {
  assert.throws(() => caseParity([...records, { ...records[0], name: 'added', passed: false }], options), /Case did not pass: owned\/new.test.mjs: added/);
});
