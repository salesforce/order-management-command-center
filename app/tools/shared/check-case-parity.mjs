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
// Compare executed tests with the immutable pre-refactor baseline. Counts alone can hide lost cases.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_URL } from '../../public/source-layout.js';

const ARCHITECTURE = new URL('test/architecture/', APP_URL);
const baseline = JSON.parse(fs.readFileSync(new URL('case-baseline.json', ARCHITECTURE)));
const inventory = JSON.parse(fs.readFileSync(new URL('refactor-baseline.json', ARCHITECTURE)));
const ROOT = new URL('../', APP_URL);
const publicExport = ['.gitattributes', '.strata.yml', 'app/tools/internal/'].every((p) => !fs.existsSync(new URL(p, ROOT)));
const baselineFiles = Object.fromEntries(Object.entries(baseline.files).filter(([file]) => !(publicExport && inventory.sourceOnlyTests.includes(file))));
const kits = ['dashboard/dashboard-kit.mjs', 'limits/limits-kit.mjs', 'service-console/service-kit.mjs', 'side-panel/side-panel-kit.mjs'];
const supportMoves = Object.fromEntries(kits.map((p) => ['app/test/om-command-center/' + p, 'app/test/operations-console/ui/' + p]));
export const baselineMoves = { ...inventory.moves, ...supportMoves };

const caseKey = (file, nesting, name) => JSON.stringify([file, nesting, name]);
function executedCases(records, errors) {
  const actual = new Map();
  for (const record of records) {
    if (!record.passed || record.skipped) errors.push(`Case did not pass: ${record.file}: ${record.name}`);
    const id = caseKey(record.file, record.nesting, record.name);
    actual.set(id, (actual.get(id) || 0) + 1);
  }
  return actual;
}

export function caseParity(records, { files = baselineFiles, moves = baselineMoves } = {}) {
  const errors = [], actual = executedCases(records, errors);
  let expected = 0;
  for (const [file, cases] of Object.entries(files)) for (const [nesting, name] of cases) {
    expected++;
    const id = caseKey(moves[file] || file, nesting, name), left = actual.get(id) || 0;
    if (!left) errors.push(`Missing baseline case: ${moves[file] || file}: ${name}`);
    else actual.set(id, left - 1);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return { baseline: expected, executed: records.length, added: records.length - expected };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const reports = process.argv.slice(2);
  if (!reports.length) throw new Error('Usage: check-case-parity.mjs <case-report.json> [...]');
  const result = caseParity(reports.flatMap((file) => JSON.parse(fs.readFileSync(file, 'utf8'))));
  console.log(`Case parity: ${result.baseline} baseline cases retained; ${result.added} additional cases; no failures or skips.`);
}
