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
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { testFiles } from "../../tools/ci-test-files.mjs";

test('scoped UI suites stay browser tests when they import a local helper instead of browser-kit directly', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'om-discovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = {
    'operations-console/ui/dashboard/page.test.mjs': "import { openPage } from './page-kit.mjs';",
    'service-center/ui/orders/page.test.mjs': "import { openOrder } from './order-kit.mjs';",
    'integration/ui/auth.test.mjs': "import { run } from './auth-kit.mjs';",
    'shared/unit/runtime.test.mjs': "import 'node:test';",
    'architecture/imports.test.mjs': "import 'node:test';",
    'operations-console/ui/dashboard/page-kit.mjs': 'export {};',
  };
  for (const [file, text] of Object.entries(files)) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
  const result = testFiles(root);
  const names = (list) => list.map((file) => path.relative(root, path.resolve(file)).split(path.sep).join('/'));
  assert.deepEqual(names(result.ui), ['integration/ui/auth.test.mjs', 'operations-console/ui/dashboard/page.test.mjs', 'service-center/ui/orders/page.test.mjs']);
  assert.deepEqual(names(result.unit), ['architecture/imports.test.mjs', 'shared/unit/runtime.test.mjs']);
  assert.equal(new Set([...result.unit, ...result.ui]).size, 5);
});
