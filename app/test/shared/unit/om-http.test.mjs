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
// The read-only POST rule (om-http.js readOnlyPost): the only POSTs the reads may send are the ones that change nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readOnlyPost } from "../../../public/shared/transport/om-http.js";

test('the delivery estimate is a read-only POST', () => {
  assert.equal(readOnlyPost('/commerce/delivery/estimation-setup/alpine/estimate/estimate-date', {}), true);
});

test('the pickup estimate is a read-only POST, and nothing near it is', () => {
  assert.equal(readOnlyPost('/commerce/delivery/estimation-setup/alpine/estimate/bopis', {}), true);
  for (const p of ['/commerce/delivery/estimation-setup/alpine/estimate/bopis/x', '/commerce/delivery/estimation-setup/a/b/estimate/bopis',
    '/commerce/delivery/estimation-setup/alpine/estimate/bopis?x=1', '/commerce/delivery/location-graph/uploads']) assert.equal(readOnlyPost(p, {}), false, p);
});
