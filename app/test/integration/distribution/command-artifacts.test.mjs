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
import { buildHtml } from '../../../tools/operations-console/build-artifact.mjs';
import { buildLiveHtml, buildConsoleHtml, buildSkill, PAGES, STATIC_PAGES } from '../../../tools/operations-console/build-live-artifact.mjs';

test('every Command artifact and the Cowork skill build without Service or combined composition sources', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'om-command-artifacts-')), publicDir = path.join(root, 'public');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(new URL('../../../public/', import.meta.url), publicDir, { recursive: true });
  for (const directory of ['service', 'service-center', 'composition']) fs.rmSync(path.join(publicDir, directory), { recursive: true, force: true });
  const pages = [buildHtml(publicDir)];
  for (const local of [false, true]) pages.push(buildLiveHtml({ publicDir, local }), buildConsoleHtml({ publicDir, local }));
  const skill = buildSkill({ publicDir, dir: path.join(root, 'artifact'), zip: false });
  for (const name of [...Object.values(PAGES), ...Object.values(STATIC_PAGES)]) pages.push(fs.readFileSync(path.join(skill.out, name), 'utf8'));
  for (const page of pages) {
    assert.match(page, /<!doctype html>/i);
    assert.doesNotMatch(page, /__omcDef\('(?:om-core|om-core-cs|om-core-find|om-core-commerce|om-action-facts|om-actions)\.js'/);
  }
  for (const name of ['SKILL.md', 'configure.py']) assert.ok(fs.statSync(path.join(skill.out, name)).isFile(), name);
});
