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
import { assembleProviders, createReadRuntime } from '../../public/shared/data/read-runtime.js';
import { createCore as command } from '../../public/operations-console/data/core.js';

test('providers initialize once and resolve lazy cross-provider dependencies before routing', () => {
  const kit = {}, made = [];
  const areas = assembleProviders(kit, [
    { name: 'first', needs: ['answer'], make(k) { made.push('first'); return { read: () => k.answer(), routes: [['/read', () => k.read()]] }; } },
    { name: 'second', make() { made.push('second'); return { answer: () => 42, routes: [] }; } },
  ]);
  assert.deepEqual(made, ['first', 'second']);
  assert.equal(areas[0].routes[0][1](), 42);
});
test('duplicate providers, exports and routes, and missing declared dependencies fail assembly', () => {
  const make = () => ({ routes: [] });
  assert.throws(() => assembleProviders({}, [make, make]), /Duplicate read provider/);
  assert.throws(() => assembleProviders({ occupied: true }, [{ name: 'a', make: () => ({ occupied: false }) }]), /Duplicate read export/);
  assert.throws(() => assembleProviders({}, ['a', 'b'].map((name) => ({ name, make: () => ({ routes: [['/same', () => {}]] }) }))), /Duplicate read route/);
  assert.throws(() => assembleProviders({}, [{ name: 'a', needs: ['absent'], make }]), /Missing read dependency/);
});
test('provider validation uses kit exports and connects no partial reads after a route collision', () => {
  const kit = { seed: () => 7 };
  assembleProviders(kit, [{ name: 'without-routes', needs: ['seed'], make: (k) => ({ answer: () => k.seed() }) }]);
  assert.equal(kit.answer(), 7);
  const untouched = {};
  assert.throws(() => assembleProviders(untouched, [
    { name: 'first', make: () => ({ first: true, routes: [[/^\/same$/, () => {}]] }) },
    { name: 'second', make: () => ({ second: true, routes: [[/^\/same$/, () => {}]] }) },
  ]), /Duplicate read route/);
  assert.deepEqual(untouched, {});
});
test('an empty runtime and Command profile reset without initializing Service hooks or making requests', async () => {
  let calls = 0;
  const request = async () => { calls++; throw new Error('Unexpected request'); };
  createReadRuntime({ request, createReader: () => () => {} }, []).reset();
  const core = command({ request, instanceUrl: () => 'https://example.invalid' });
  core.reset();
  for (const route of ['/api/cs/stores', '/api/cs/order/0Or000000000001', '/api/cs/bundle/0Or000000000001']) {
    await assert.rejects(() => core.route(route), (e) => e.code === 404);
  }
  assert.equal(core.policyFacts, undefined);
  assert.equal(core.paymentFacts, undefined);
  assert.equal(calls, 0);
});
