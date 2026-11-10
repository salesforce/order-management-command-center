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
// A delayed local Salesforce connection check must leave the sign-in controls available.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPlaywright, openSession, UI, until } from '../../../tools/browser-kit.mjs';

const pw = await loadPlaywright();

test('local sign-in stays visible while the connection status request is pending', { skip: UI.skip(pw) }, async () => {
  let pendingStatus;
  const session = await openSession(pw, 'local-connection-pending', {
    path: '/',
    setup: (page) => page.route('**/api/status', (route) => { pendingStatus = route; }),
  });
  try {
    assert.ok(await until(session.page, '#gate:not(.hide)'), 'show sign-in before Salesforce connection status resolves');
    assert.ok(pendingStatus, 'the connection status request is still intercepted');
    assert.equal(await session.page.locator('#app').isVisible(), false);
    assert.equal(await session.page.locator('#gateErr').isVisible(), false);
    assert.equal(await session.page.locator('#gate h1').innerText(), 'Connect your Order Management org');
  } finally {
    await pendingStatus?.abort().catch(() => {});
    await session.close();
  }
});
