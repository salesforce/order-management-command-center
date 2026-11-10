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
// Unit tests use a fake browser, so dynamically load the kit without classifying this file as a real UI suite in CI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from "../../support/source-view.mjs";
import os from 'node:os';
import path from 'node:path';

const { openSession, UI } = await import("../../../tools/browser-kit.mjs");

function sessionFixture(t, failAt) {
  const previous = { baseUrl: UI.baseUrl, videos: UI.videos, headed: UI.headed }, oldCoverage = process.env.UI_COVERAGE_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-session-'));
  Object.assign(UI, { baseUrl: 'http://browser-fixture.invalid', videos: null, headed: false });
  process.env.UI_COVERAGE_DIR = dir;
  t.after(() => {
    Object.assign(UI, previous);
    if (oldCoverage === undefined) delete process.env.UI_COVERAGE_DIR;
    else process.env.UI_COVERAGE_DIR = oldCoverage;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const original = new Error(`${failAt} failed`), coverageError = new Error('coverage stop failed'), cleanup = [], logged = [];
  t.mock.method(console, 'error', (...args) => logged.push(args.join(' ')));
  const page = {
    coverage: {
      async startJSCoverage() {},
      async stopJSCoverage() { cleanup.push('coverage'); throw coverageError; },
    },
    on() {}, video() { return null; },
    async goto() { if (failAt === 'navigation') throw original; },
  };
  const ctx = { async route() {}, async addInitScript() {}, async newPage() { return page; }, async close() { cleanup.push('context'); } };
  const browser = { async newContext() { return ctx; }, async close() { cleanup.push('browser'); } };
  const pw = { chromium: { async launch() { if (failAt === 'launch') throw original; return browser; } } };
  const options = { async setup() { if (failAt === 'setup') throw original; } };
  return { pw, options, original, coverageError, cleanup, logged };
}

for (const failAt of ['setup', 'navigation']) test(`browser session preserves the ${failAt} error when coverage cleanup also fails`, async (t) => {
  const f = sessionFixture(t, failAt);
  await assert.rejects(openSession(f.pw, 'failed-session', f.options), (e) => e === f.original);
  assert.deepEqual(f.cleanup, ['coverage', 'context', 'browser']);
  assert.equal(f.logged.length, 1);
  assert.match(f.logged[0], /coverage stop failed/);
});

test('normal session close still fails when coverage cannot be collected', async (t) => {
  const f = sessionFixture(t);
  const session = await openSession(f.pw, 'finished-session', f.options);
  await assert.rejects(session.close(), (e) => e === f.coverageError);
  assert.deepEqual(f.cleanup, ['coverage', 'context', 'browser']);
  assert.deepEqual(f.logged, []);
});

test('a launch failure stays the reported error before coverage starts', async (t) => {
  const f = sessionFixture(t, 'launch');
  await assert.rejects(openSession(f.pw, 'launch-failed', f.options), (e) => e === f.original);
  assert.deepEqual(f.cleanup, []);
  assert.deepEqual(f.logged, []);
});
