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
// The CI helper that splits app/test into unit and browser tests (app/tools/ci-test-files.mjs): every test file runs in exactly
// one of the pipeline's two steps, in whatever folder it sits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from "../../support/source-view.mjs";
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const TEST_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
import { testFiles } from "../../../tools/ci-test-files.mjs";

test('every test file under app/test is in exactly one list', () => {
  const all = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.test.mjs')) all.push(path.relative(REPO_ROOT, p)); } };
  walk(TEST_ROOT);
  const { unit, ui } = testFiles();
  assert.deepEqual([...unit, ...ui].sort(), all.sort());
  assert.equal(new Set([...unit, ...ui]).size, unit.length + ui.length);
});

test('a test that imports the browser kit is a UI test, wherever it sits', () => {
  const { unit, ui } = testFiles();
  for (const name of ['activity-stream', 'exception-queue', 'kpis-range', 'map-view', 'status-board', 'theme', 'walkthrough'])
    assert.ok(ui.includes(`app/test/operations-console/ui/operation-console/${name}.test.mjs`), name);
  for (const name of ['orders', 'customers', 'fulfillment', 'payments', 'service', 'returns', 'products', 'policies', 'kpis-periods', 'page', 'controls', 'states', 'theme-a11y'])
    assert.ok(ui.includes(`app/test/operations-console/ui/dashboard/${name}.test.mjs`), `Dashboard ${name}`);
  for (const name of ['header-alerts', 'gauges', 'flow', 'charts', 'ledger-session', 'reference', 'page', 'theme-a11y'])
    assert.ok(ui.includes(`app/test/operations-console/ui/limits/${name}.test.mjs`), `Limits ${name}`);
  for (const name of ['panel', 'order-details', 'order-history', 'record-details', 'customer', 'states'])
    assert.ok(ui.includes(`app/test/operations-console/ui/side-panel/${name}.test.mjs`), `Side panel ${name}`);
  for (const name of ['queue', 'search', 'customer', 'orders', 'conversations', 'page', 'states', 'theme-a11y'])
    assert.ok(ui.includes(`app/test/operations-console/ui/service-console/${name}.test.mjs`), `Service Console ${name}`);
  assert.ok(unit.includes("app/test/shared/unit/themes.test.mjs") && !ui.includes("app/test/shared/unit/themes.test.mjs"));
  assert.ok(unit.includes("app/test/integration/contracts/browser-session.test.mjs"), 'fake-browser lifecycle tests need no Chrome');
  for (const f of ui) assert.ok(f.split(path.sep).slice(0, -1).includes('ui') || /^import\s[^;]*browser-kit/m.test(fs.readFileSync(f, 'utf8')), f);
});

test('tests in a new folder are found without changing the pipeline', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-test-files-'));
  fs.mkdirSync(path.join(dir, 'a', 'b'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'x.test.mjs'), "import 'node:test';");
  fs.writeFileSync(path.join(dir, 'a', 'b', 'y.test.mjs'), "import { UI } from '../../../tools/browser-kit.mjs';");
  fs.writeFileSync(path.join(dir, 'a', 'helper.mjs'), 'export {};');
  fs.writeFileSync(path.join(dir, 'a', 'z.test.mjs'), "import {\n  UI,\n  serve,\n} from '../../tools/browser-kit.mjs';");
  fs.writeFileSync(path.join(dir, 'a', 'w.test.mjs'), "// mentions browser-kit in a comment only\nimport 'node:test';");
  fs.mkdirSync(path.join(dir, 'operations-console', 'dashboard'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'operations-console', 'dashboard', 'dashboard.test.mjs'), "import { UI } from '../../../tools/browser-kit.mjs';");
  fs.mkdirSync(path.join(dir, 'operations-console', 'limits'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'operations-console', 'limits', 'header-alerts.test.mjs'), "import { UI } from '../../../tools/browser-kit.mjs';");
  const { unit, ui } = testFiles(dir);
  assert.deepEqual(unit.map((f) => path.basename(f)), ['w.test.mjs', 'x.test.mjs']);
  assert.deepEqual(ui.map((f) => path.basename(f)), ['y.test.mjs', 'z.test.mjs', 'dashboard.test.mjs', 'header-alerts.test.mjs'], 'nested Dashboard/Limits tests and multi-line imports count; a comment does not');
});
