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
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tool = (file, args = []) => execFileSync(process.execPath, [fileURLToPath(new URL('../../../tools/' + file, import.meta.url)), ...args], { encoding: 'utf8' });
test('both golden entry points retain all console scenarios without loading a browser', () => {
  const names = tool('shared/golden.mjs', ['--list']);
  assert.equal(tool('golden.mjs', ['--list']), names);
  const rows = names.trim().split('\n');
  assert.equal(rows.length, 79); assert.equal(new Set(rows).size, 79);
  assert.equal(rows.filter((row) => row.startsWith('service-center.')).length, 0);
  for (const name of ['console.initial', 'dash.orders.mtd', 'service.initial', 'limits.initial', 'gate.browser', 'route.mode-cycle']) assert.ok(rows.includes(name), name);
});
test('both Agentforce comparison entry points preserve saved-run results and require no org connection', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-agent-entry-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const files = ['first', 'second'].map((label, i) => {
    const file = path.join(dir, label + '.json');
    fs.writeFileSync(file, JSON.stringify({ label, results: [{ case: 'console', q: 'Status?', ms: 1000, ok: !i, fail: i ? 'missing status' : null }] }));
    return file;
  });
  const table = tool('shared/agent-check.mjs', ['--compare', ...files]);
  assert.equal(tool('agent-check.mjs', ['--compare', ...files]), table);
  assert.match(table, /\| Question \| first \| second \|/);
  assert.match(table, /\| Status\? \| ok 1 s \| FAIL \(missing status\) 1 s \|/);
  assert.match(table, /\| \*\*Passed\*\* \| 1\/1 \| 0\/1 \|/);
});
