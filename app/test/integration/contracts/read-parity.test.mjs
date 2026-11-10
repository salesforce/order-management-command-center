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
import { createCore } from '../../../public/operations-console/data/core.js';
import { recordedRead, withFixedDate } from '../../support/read-parity.mjs';

const baseline = JSON.parse(fs.readFileSync(new URL('./fixtures/read-parity.json', import.meta.url)));
test('read-parity fixtures declare UTC and restore the host environment after a failure', async () => {
  assert.equal(baseline.timeZone, 'UTC');
  const clock = globalThis.Date, timezone = process.env.TZ;
  await assert.rejects(withFixedDate(async () => {
    assert.equal(process.env.TZ, 'UTC');
    assert.equal(new Date().getHours(), 12);
    throw new Error('fixture failure');
  }), /fixture failure/);
  assert.equal(globalThis.Date, clock); assert.equal(process.env.TZ, timezone);
});
for (const { url, mode, expected } of baseline.cases) {
  test(`baseline read response and outbound call order: ${mode} ${url}`, async () => {
    const actual = await withFixedDate(() => recordedRead(createCore, url, mode));
    assert.deepEqual(actual, expected);
  });
}
// OM Service Console's reads (/api/cs/*) are not part of the console's read profile: each is an unknown route, answered
// without a single call to the org, in every mode.
const SERVICE_READS = [
  '/api/cs/record/OrderSummary/0Or000000000001', '/api/cs/bundle/0Or000000000001', '/api/cs/find?q=avery', '/api/cs/find?recent=1',
  '/api/cs/customer-form', '/api/cs/me?username=test@example.com', '/api/cs/me?username=bad%20user', '/api/cs/duplicates?name=Avery',
  '/api/cs/stores?account=001000000000001', '/api/cs/products?q=shirt&store=0ZE000000000001&account=001000000000001', '/api/cs/placed?ref=ref-123',
  '/api/cs/availability?store=0ZE000000000001&skus=sku-1', '/api/cs/product/01t000000000001?store=0ZE000000000001&account=001000000000001',
  '/api/cs/ordered-products?limit=2', '/api/cs/ordered-products?limit=2001',
  '/api/cs/picture/01t000000000001?store=0ZE000000000001&account=001000000000001', '/api/cs/estimates?methods=bad',
  '/api/cs/delivery/0Or000000000001?methods=bad', '/api/cs/similar/0Or000000000001?store=0ZE000000000001',
  '/api/cs/pickup?account=001000000000001&skus=sku-1:1', '/api/cs/addresses/001000000000001', '/api/cs/cart/0Or000000000001',
  '/api/cs/conversations/0Or000000000001', '/api/cs/order/0Or000000000001', '/api/cs/cases/0Or000000000001', '/api/cs/exceptions/0Or000000000001',
  '/api/cs/years/0Or000000000001', '/api/cs/routing/0Or000000000001', '/api/cs/conversation/chat/0Or000000000001',
  '/api/cs/conversation/messaging/0Or000000000001', '/api/cs/conversation/email/0Or000000000001', '/api/cs/conversation/case/0Or000000000001'];
for (const mode of ['normal', 'missing-objects', 'expired']) {
  test(`the console profile serves none of OM Service Console's reads: ${mode}`, async () => {
    for (const url of SERVICE_READS) assert.deepEqual(await withFixedDate(() => recordedRead(createCore, url, mode)), { code: 404, error: 'Not found', calls: [] }, url);
  });
}
