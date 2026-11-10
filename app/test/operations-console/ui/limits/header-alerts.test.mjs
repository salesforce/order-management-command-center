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
/* Header/alerts: real odometer digits, console/rest rates, passive cost, sorted warnings and threshold crossings. */
import assert from 'node:assert/strict';
import { loadPlaywright } from "../../../../tools/browser-kit.mjs";
import { limitsTest, n, text, apply, rows, amount } from "./limits-kit.mjs";
const pw = await loadPlaywright();

limitsTest(pw, 'API odometer shows the counter allowance and accessible value', async ({ page, step, data }) => {
  await step(() => page.locator('#lOdo').scrollIntoViewIfNeeded());
  const x = data.org.data.DailyApiRequests, used = x.Max - x.Remaining;
  assert.equal(await page.locator('#lOdo').getAttribute('role'), 'img');
  assert.equal(await page.locator('#lOdo').getAttribute('aria-label'), `${used} API calls today`);
  const digits = await page.locator('#lOdo .oc').evaluateAll((es) => es.map((e) => Number(e.style.transform.match(/-([\d.]+)%/)[1]) / 10).join(''));
  assert.equal(digits, String(used));
  assert.equal(await text(page, '#lOdoSub'), `of ${n(x.Max)} · ${Math.round(used / x.Max * 100)}% used`);
  const d = structuredClone(data); d.org.data.DailyApiRequests = { Max: 1000000, Remaining: 876544 };
  await apply(page, { data: d });
  assert.equal(await page.locator('#lOdo').getAttribute('aria-label'), '123456 API calls today');
  assert.equal(await text(page, '#lOdo .odsep'), ',');
});

limitsTest(pw, 'rates distinguish this console the rest of the org and passive cost', async ({ page, step }) => {
  await step(() => page.locator('#lRate').scrollIntoViewIfNeeded());
  assert.equal(await text(page, '#lRate'), '6 /min ▲');
  assert.equal(await text(page, '#lRateSub'), 'this console · rest of org 3/min');
  assert.equal(await text(page, '#lCost'), 'Passive · no calls to the org');
  assert.equal(await text(page, '#lState'), 'paused');
  assert.equal(await text(page, '#live span'), 'Passive');
  await apply(page, { entries: [], rest: [], samples: [] });
  assert.equal(await text(page, '#lRate'), '0 /min ■');
  assert.equal(await text(page, '#lRateSub'), 'this console · rest of org 0/min');
});

limitsTest(pw, 'alerts show every over-limit and warning in severity order', async ({ page, step, data }) => {
  await step(() => page.locator('#lAlerts').scrollIntoViewIfNeeded());
  const expected = rows(data).filter((r) => r.f >= .8).sort((a, b) => b.f - a.f);
  assert.deepEqual(await page.locator('#lAlerts .lal').allTextContents(), expected.map((r) => r.f >= 1 ? `${r.name} ${Math.round(r.f * 100)}%: ${amount(r.used - r.max, r.unit)} over` : `${r.name} at ${Math.round(r.f * 100)}%: ${amount(r.max - r.used, r.unit)} left`));
  assert.deepEqual(await page.locator('#lAlerts .lal').evaluateAll((es) => es.map((e) => e.classList.contains('over') ? 'over' : 'warn')), expected.map((r) => r.level));
  assert.equal(await page.locator('#lAlerts').getAttribute('aria-live'), 'polite');
  assert.equal(await page.locator('#lAlerts .new').count(), 0, 'initial warnings are not new crossings');
});

limitsTest(pw, 'alert crossings overflow and recovery stay accurate', async ({ page, data }) => {
  const d = structuredClone(data);
  d.org.data = { DailyApiRequests: { Max: 100, Remaining: 21 } }; d.entitlements.data = []; d.licenses.data = {};
  await apply(page, { data: d, samples: [] });
  assert.equal(await page.locator('#lAlerts .lal').count(), 0);
  d.org.data.DailyApiRequests.Remaining = 20;
  await apply(page, { data: d, samples: [], resetLevels: false });
  assert.equal(await text(page, '#lAlerts .lal.new'), 'Daily API requests at 80%: 20 left');
  d.org.data.DailyApiRequests.Remaining = -10;
  await apply(page, { data: d, samples: [], resetLevels: false });
  assert.equal(await text(page, '#lAlerts .lal.over.new'), 'Daily API requests 110%: 10 over');
  for (let i = 0; i < 6; i++) d.org.data[`ExtraLimit${i}`] = { Max: 100, Remaining: 5 + i };
  await apply(page, { data: d });
  assert.equal(await page.locator('#lAlerts .lal:not(.more)').count(), 5);
  assert.equal(await text(page, '#lAlerts .more'), 'and 2 more in the reference below');
  Object.values(d.org.data).forEach((x) => x.Remaining = x.Max);
  await apply(page, { data: d });
  assert.equal(await page.locator('#lAlerts .lal').count(), 0);
});
