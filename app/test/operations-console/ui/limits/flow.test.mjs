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
/* Request flow: every source/gateway route, counts and widths, the API pool/governor destinations, and live updates. */
import assert from 'node:assert/strict';
import { loadPlaywright } from "../../../../tools/browser-kit.mjs";
import { limitsTest, text, calls, NOW, apply } from "./limits-kit.mjs";
const pw = await loadPlaywright();

limitsTest(pw, 'request flow maps all sources and gateways with proportional active routes', async ({ page, step }) => {
  await step(() => page.locator('#lFlow').scrollIntoViewIfNeeded());
  assert.deepEqual(await page.locator('#lFlow .lft').allTextContents(), ['Ops Console', 'Dashboard', 'Service', 'This tab', 'Apex REST', 'GraphQL', 'UI API', 'Daily API pool', 'Apex governor']);
  assert.deepEqual(await page.locator('#lKeys .lk').allTextContents(), ['apex', 'batch', 'graphql', 'ui-api', 'connect', 'action']);
  const sources = ['console', 'dashboard', 'service', 'limits'], gate = (kind) => kind === 'graphql' ? 1 : ['ui-api', 'connect'].includes(kind) ? 2 : 0;
  const recent = calls().filter((e) => e.t > NOW - 60000);
  for (const [si, source] of sources.entries()) {
    assert.equal(await text(page, `#lfn-s${si}t`), `${recent.filter((e) => e.source === source).length}/min`);
    for (let gi = 0; gi < 3; gi++) {
      const count = recent.filter((e) => e.source === source && gate(e.kind) === gi).length;
      const edge = page.locator(`#lfe-${si}-${gi}`);
      assert.equal(await edge.evaluate((e) => e.classList.contains('on')), count > 0);
      assert.equal(await edge.evaluate((e) => +e.style.strokeWidth > 1), count > 0);
    }
  }
  const widths = [];
  for (let gi = 0; gi < 3; gi++) {
    assert.equal(await text(page, `#lfn-g${gi}t`), `${recent.filter((e) => gate(e.kind) === gi).length}/min`);
    assert.ok((await page.locator(`#lfg-${gi}`).getAttribute('d')).endsWith(gi === 0 ? '570,190' : '570,90'));
    widths.push(await page.locator(`#lfg-${gi}`).evaluate((e) => +e.style.strokeWidth));
  }
  assert.ok(widths[0] > widths[2] && widths[2] > widths[1], 'more calls draw wider routes');
  assert.equal(await text(page, '#lfn-poolt'), '124 / 100,000');
  assert.equal(await text(page, '#lfn-govt'), 'peak 46,000 / 50,000 rows');
  assert.equal(await page.locator('#lFlow').getAttribute('role'), 'img');
  assert.equal(await page.locator('#lfParts circle').count(), 0, 'reduced motion draws no travelling particles');
});

limitsTest(pw, 'empty meter keeps flow routes quiet', async ({ page }) => {
  await apply(page, { entries: [], samples: [], rest: [] });
  assert.equal(await page.locator('#lFlow .lfe.on').count(), 0);
  assert.deepEqual((await page.locator('#lFlow .lfs').allTextContents()).slice(0, 7), Array(7).fill('0/min'));
  assert.equal(await text(page, '#lfn-govt'), 'peak 0 / 50,000 rows');
});

limitsTest(pw, 'meter arrivals update the flow while passive', async ({ page, step }) => {
  await step(async () => {
    await page.evaluate(() => globalThis.__limitsUI.meterRecord({ t: Date.now(), kind: 'graphql', source: 'console', path: '/services/data/v68.0/graphql', ms: 20, status: 200 }));
    await page.clock.runFor(300);
  });
  assert.equal(await text(page, '#lfn-s0t'), '2/min');
  assert.equal(await text(page, '#lfn-g1t'), '2/min');
  assert.equal(await text(page, '#lRate'), '7 /min ▲');
  assert.equal(await text(page, '#live span'), 'Passive', 'observing arrivals does not enable polling');
});
