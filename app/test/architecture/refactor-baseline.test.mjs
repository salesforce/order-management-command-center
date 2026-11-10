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
import { existsSync, readFileSync } from 'node:fs';
import { testFiles } from "../../tools/ci-test-files.mjs";
import { inventoryProblems } from "./inventory-kit.mjs";

const root = new URL("../../../", import.meta.url);
const baseline = JSON.parse(readFileSync(new URL("./refactor-baseline.json", import.meta.url), 'utf8'));

test('the baseline records a source revision, unique test paths and declared export exclusions', () => {
  assert.match(baseline.sourceCommit, /^[a-f0-9]{40}$/);
  assert.ok(Object.keys(baseline.testOwners).length > 90);
  assert.deepEqual(Object.keys(baseline.testOwners), Object.keys(baseline.testOwners).sort());
  for (const file of baseline.sourceOnlyTests) assert.ok(file in baseline.testOwners, file);
  assert.equal(new Set(baseline.readNames).size, baseline.readNames.length);
});

test('every pre-refactor test remains present or has an explicit owned move', () => {
  const { unit, ui } = testFiles();
  // All three markers are removed by the existing public git-archive contract. Losing one source marker cannot mask tests.
  const publicExport = ['.gitattributes', '.strata.yml', 'app/tools/internal/'].every((p) => !existsSync(new URL(p, root)));
  assert.deepEqual(inventoryProblems(baseline, [...unit, ...ui], { publicExport }), []);
});

for (const [file, expected] of Object.entries(baseline.compatibilityExports)) {
  test(`legacy compatibility exports remain available: ${file}`, async () => {
    const module = await import(new URL(file, root));
    for (const [name, kind] of Object.entries(expected)) assert.equal(typeof module[name], kind, `${file}: ${name}`);
  });
}

test('the existing named reads remain available to CLI and plugin consumers', async () => {
  const { READS } = await import("../../public/shared/data/om-reads.js");
  for (const name of baseline.readNames) assert.ok(Object.hasOwn(READS, name), name);
});

const original = 'app/test/old.test.mjs';
const moved = 'app/test/shared/unit/old.test.mjs';
const sample = (extra = {}) => ({ testOwners: { [original]: 'shared' }, sourceOnlyTests: [], moves: {}, ...extra });

test('removing a baseline test cannot be hidden by adding another test', () => {
  const problems = inventoryProblems(sample(), ['app/test/shared/unit/new.test.mjs']);
  assert.ok(problems.some((p) => p.includes(`Baseline test missing: ${original}`)));
});

test('new tests need a scoped owner while existing flat tests remain compatible', () => {
  assert.deepEqual(inventoryProblems(sample(), [original, 'app/test/operations-console/unit/new.test.mjs']), []);
  assert.ok(inventoryProblems(sample(), [original, 'app/test/unowned.test.mjs']).some((p) => p.includes('New tests need an owner')));
});

test('an explicit move requires its target and forbids a duplicate old suite', () => {
  const baseline = sample({ moves: { [original]: moved } });
  assert.deepEqual(inventoryProblems(baseline, [moved]), []);
  assert.ok(inventoryProblems(baseline, []).some((p) => p.includes('Baseline test missing')));
  assert.ok(inventoryProblems(baseline, [original, moved]).some((p) => p.includes('old path')));
});

test('moves cannot change owners, lose a suite by merging files, or refer to unknown tests', () => {
  assert.ok(inventoryProblems(sample({ moves: { [original]: 'app/test/service-center/unit/old.test.mjs' } }), ['app/test/service-center/unit/old.test.mjs']).some((p) => p.includes('must stay with shared')));
  const merged = sample({ testOwners: { [original]: 'shared', 'app/test/second.test.mjs': 'shared' }, moves: { [original]: moved, 'app/test/second.test.mjs': moved } });
  assert.ok(inventoryProblems(merged, [moved]).some((p) => p.includes('Multiple baseline tests')));
  assert.ok(inventoryProblems(sample({ moves: { 'app/test/unknown.test.mjs': moved } }), [original]).some((p) => p.includes('unknown baseline test')));
});

test('archive exclusions are explicit and cannot hide a missing public test', () => {
  const internal = "app/test/integration/contracts/internal.test.mjs";
  const baseline = sample({ testOwners: { [original]: 'shared', [internal]: 'integration' }, sourceOnlyTests: [internal] });
  assert.deepEqual(inventoryProblems(baseline, [original], { publicExport: true }), []);
  assert.ok(inventoryProblems(baseline, [original]).some((p) => p.includes(internal)));
  assert.ok(inventoryProblems(baseline, [], { publicExport: true }).some((p) => p.includes(original)));
  assert.ok(inventoryProblems(baseline, [original, internal], { publicExport: true }).some((p) => p.includes('leaked into public export')));
});

test('duplicate discovery and invalid ownership fail the inventory guard', () => {
  assert.ok(inventoryProblems(sample(), [original, original]).some((p) => p.includes('more than once')));
  assert.ok(inventoryProblems(sample({ testOwners: { [original]: 'unknown' } }), [original]).some((p) => p.includes('Unknown owner')));
});
