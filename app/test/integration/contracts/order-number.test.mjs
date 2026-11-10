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
import { fakeOrg } from "../../support/fake-org.mjs";

const rows = [{ Id: '1Os000000000001AAA', OrderNumber: '00035807' }];
const org = () => fakeOrg({ queries: [[/FROM OrderSummary WHERE OrderNumber IN \('(35807', '|)00035807'\)/, rows], [/FROM OrderSummary/, []]] });

test('finds an order by number, with or without leading zeros', async () => {
  assert.deepEqual(await org().core.route('/api/order-number/00035807'), rows[0]);
  assert.deepEqual(await org().core.route('/api/order-number/35807'), rows[0]);
});

test('a missing order is a 404 and non-digits are a 400', async () => {
  await assert.rejects(org().core.route('/api/order-number/99999999'), (e) => e.code === 404);
  await assert.rejects(org().core.route("/api/order-number/1' OR '1'='1"), (e) => e.code === 400);
});

test('an org without OrderSummary is a 404, with no query sent', async () => {
  const o = fakeOrg({ objects: [], queries: [] });
  await assert.rejects(o.core.route('/api/order-number/1'), (e) => e.code === 404);
  assert.equal(o.soql().length, 0);
});

test('extra leading zeros still find the order, and an exact match wins over a padded one', async () => {
  const both = [{ Id: '1Os000000000002AAA', OrderNumber: '00035807' }, { Id: '1Os000000000003AAA', OrderNumber: '35807' }];
  const o = fakeOrg({ queries: [[/FROM OrderSummary WHERE OrderNumber IN/, both]] });
  assert.equal((await o.core.route('/api/order-number/35807')).Id, '1Os000000000003AAA');
  assert.equal((await o.core.route('/api/order-number/00035807')).Id, '1Os000000000002AAA');
  const pad = fakeOrg({ queries: [[/OrderNumber IN \('0000035807', '00035807'(, '35807')?\)/, [both[0]]]] });
  assert.equal((await pad.core.route('/api/order-number/0000035807')).Id, '1Os000000000002AAA');
});
