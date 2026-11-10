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
// Operations Console's order drawer lists a bundle's parts under it. The rows come from the page's own drawerItems() (console-kit.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { drawerItems } = await import("../../../public/operations-console/console-kit.js");

test('the drawer lists a bundle’s parts under it, and other items as they are', () => {
  const items = [{ Id: 'K', Name: 'Summit camp kit', Quantity: 2, TotalPrice: 498, TypeCode: 'Product', Status: 'ORDERED' }, { Id: 'X', Name: 'Merino tee', Quantity: 1, TotalPrice: 48 },
    { Id: 'T', Name: 'Trailhead 2 tent', Quantity: 2, TotalPrice: 0, MainOrderItemSummaryId: 'K' }, { Id: 'F', Name: 'Fuel canister', Quantity: 4, TotalPrice: 0, MainOrderItemSummaryId: 'K' }];
  const rows = drawerItems(items).match(/<tr[^>]*>.*?<\/tr>/g);
  assert.deepEqual(rows.map((r) => [/class="bpart"/.test(r), r.match(/<td>(?:<span[^>]*>[^<]*<\/span>)?([^<]+)/)?.[1].trim()]),
    [[false, 'Summit camp kit'], [true, 'Trailhead 2 tent'], [true, 'Fuel canister'], [false, 'Merino tee']]);
  assert.match(rows[0], /Bundle/);
  assert.doesNotMatch(rows[3], /Bundle/);
});

test('without bundle links the drawer lists the items as before', () => {
  const rows = drawerItems([{ Id: 'A', Name: 'Shell', Quantity: 1, TotalPrice: 129 }, { Id: 'B', Name: 'Cap', Quantity: 1, TotalPrice: 29 }]).match(/<tr[^>]*>.*?<\/tr>/g);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => !/bpart|Bundle/.test(r)));
});
