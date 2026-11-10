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
// How a page reads the org (om-mode.js), and the two switches the builds set.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modeOf } from "../../../public/shared/transport/om-mode.js";

const at = (url, signingIn = false) => { const u = new URL(url); return { search: u.search, hostname: u.hostname, signingIn }; };
const which = (m) => (m.demo ? 'demo' : m.platform ? 'platform' : m.browser ? 'browser' : 'server');

test('the address decides the mode', () => {
  assert.equal(which(modeOf(at('http://localhost:5178/'))), 'server');
  assert.equal(which(modeOf(at('http://127.0.0.1:5178/'))), 'server');
  assert.equal(which(modeOf(at('http://localhost:5178/?demo=1'))), 'demo');
  assert.equal(which(modeOf(at('http://localhost:5178/?auth=browser'))), 'browser');
  assert.equal(which(modeOf(at('https://pages.example.com/om-command-console/'))), 'browser');
  assert.equal(which(modeOf(at('https://pages.example.com/om-command-console/?demo=1'))), 'demo');
  assert.equal(which(modeOf(at('https://acme--c.my.salesforce.app/'))), 'platform');
  assert.equal(which(modeOf(at('https://acme--c.my.salesforce.app/?demo=1'))), 'demo');
  assert.equal(which(modeOf(at('https://example.test/?auth=server'))), 'server');
});

test('Salesforce sends a localhost sign-in back without ?auth=browser, so one under way keeps browser mode', () => {
  assert.equal(which(modeOf(at('http://localhost:5178/?code=abc', true))), 'browser');
  assert.equal(which(modeOf(at('http://localhost:5178/?code=abc&auth=server', true))), 'server');
});

test('the builds force sample data (the edit view) or the inside-Salesforce path (the live console)', () => {
  assert.equal(which(modeOf(at('https://claude.ai/artifact'), 'demo')), 'demo');
  assert.equal(which(modeOf(at('https://claude.ai/artifact'), 'platform')), 'platform');
  assert.equal(which(modeOf(at('https://claude.ai/artifact?demo=1'), 'platform')), 'demo');
  assert.equal(modeOf(at('http://localhost:5178/?auth=browser')).auth, 'browser');
});
