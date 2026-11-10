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
import { APP_URL } from "../../public/source-layout.js";
// CI only: lists every test file under app/test, split into the two kinds the pipeline runs in different containers.
// Tests under ui/ or importing tools/browser-kit.mjs drive a real browser ("ui"); every other one is a "unit" test. Tests can sit in any
// folder under app/test, so a new folder needs no change to the pipeline.
// Usage: node ci-test-files.mjs unit|ui     (prints one path per line, relative to the repo root; fails if the list is empty)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL("..", APP_URL));
// An import statement (at the start of a line, possibly over several lines) of tools/browser-kit.mjs.
const USES_BROWSER = /^import\s[^;]*?['"][^'"]*browser-kit(?:\.mjs)?['"]/m;

// { unit: [...], ui: [...] }: every *.test.mjs under `dir`, each in exactly one list, sorted.
export function testFiles(dir = path.join(ROOT, 'app', 'test')) {
  const out = { unit: [], ui: [] };
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.test.mjs')) {
        const scopedUI = path.relative(dir, p).split(path.sep).slice(0, -1).includes('ui');
        out[scopedUI || USES_BROWSER.test(fs.readFileSync(p, 'utf8')) ? 'ui' : 'unit'].push(path.relative(ROOT, p));
      }
    }
  };
  walk(dir);
  out.unit.sort(); out.ui.sort();
  return out;
}

export async function main() {

  const kind = process.argv[2], files = testFiles()[kind];
  if (!files?.length) { console.error(`ci-test-files: no "${kind}" tests found (usage: ci-test-files.mjs unit|ui)`); process.exit(1); }
  console.log(files.join('\n'));

}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
