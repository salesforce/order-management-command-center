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
/* Third-tab routing, view/range controls, shortcuts, integrated workflow and the two standard viewport sizes. */
import assert from 'node:assert/strict';
import { loadPlaywright, WIDE, NARROW } from "../../../../tools/browser-kit.mjs";
import { serviceTest, customer, range, search, text, AVERY } from "./service-kit.mjs";
const pw = await loadPlaywright();

serviceTest(pw, 'Service Console is the third view with queue-specific controls', async ({ page, step }) => {
  assert.equal(await page.locator('#mode button').nth(2).textContent(), 'Service Console');
  assert.equal(await page.locator('#mode [aria-pressed="true"]').getAttribute('data-m'), 'service');
  assert.ok(await page.locator('#range').isVisible()); assert.ok(await page.locator('#range [data-v="all"]').isVisible());
  for (const selector of ['#period', '#dash', '#limits', '.grid', '#kpis']) assert.ok(await page.locator(selector).isHidden(), selector);
  await range(page, 'all'); await step(() => page.locator('#mode [data-m="console"]').click());
  assert.equal(await page.locator('#range [aria-pressed="true"]').getAttribute('data-v'), '90d');
  assert.ok(await page.locator('#range [data-v="all"]').isHidden());
  await step(() => page.locator('#mode [data-m="service"]').click());
  assert.equal(new URL(page.url()).hash, '#service');
});

serviceTest(pw, 'customer deep link reload and malformed links resolve safely', async ({ page, url }) => {
  await page.goto(`${url}/?demo=1#service/${AVERY}`);
  await page.locator('.chd h2').waitFor(); assert.equal(await text(page, '.chd h2'), 'Avery Chen');
  await page.reload(); await page.locator('.chd h2').waitFor();
  assert.equal(await text(page, '.chd h2'), 'Avery Chen');
  await page.evaluate(() => { location.hash = '#service/not-an-id'; });
  await page.locator('#c360 [data-cust]').first().waitFor();
  assert.equal(await page.locator('.chd').count(), 0);
  assert.equal(await page.locator('#mode [aria-pressed="true"]').getAttribute('data-m'), 'service');
});

serviceTest(pw, 'queue search record drawer Clear and tab return form one workflow', async ({ page, step }) => {
  await page.locator('#queue').focus(); await page.keyboard.press('ArrowDown'); await step(() => page.keyboard.press('Enter'));
  await page.locator('.chd h2').waitFor();
  await page.locator('#queue').focus(); await page.keyboard.press('/');
  assert.ok(await page.locator('#svcSearch').evaluate((e) => e === document.activeElement));
  await search(page, 'avery'); await page.keyboard.press('Enter');
  assert.equal(await text(page, '.chd h2'), 'Avery Chen');
  await step(() => page.locator('.ocard [data-order]').first().click());
  assert.ok(await page.locator('#drawer .hd').isVisible()); await page.keyboard.press('Escape');
  await page.locator('#mode [data-m="dashboard"]').click(); await step(() => page.locator('#mode [data-m="service"]').click());
  assert.equal(await text(page, '.chd h2'), 'Avery Chen');
  assert.equal(new URL(page.url()).hash, `#service/${AVERY}`);
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  assert.equal(new URL(page.url()).hash, '#service');
});

for (const viewport of [WIDE, NARROW]) serviceTest(pw, `${viewport.width}px queue and customer fit and scroll independently`, async ({ page }) => {
  await customer(page);
  const layout = await page.evaluate(() => {
    const root = document.querySelector('#service'), q = document.querySelector('#queue'), c = document.querySelector('#c360');
    return { page: document.documentElement.scrollWidth <= innerWidth, view: root.scrollWidth <= root.clientWidth + 1, queue: q.scrollWidth <= q.clientWidth + 1, customer: c.scrollWidth <= c.clientWidth + 1 };
  });
  assert.deepEqual(layout, { page: true, view: true, queue: true, customer: true });
  const before = await page.locator('#queue').evaluate((e) => e.scrollTop);
  await page.locator('#c360').evaluate((e) => { e.scrollTop = e.scrollHeight; });
  assert.ok(await page.locator('#c360').evaluate((e) => e.scrollTop > 0));
  assert.equal(await page.locator('#queue').evaluate((e) => e.scrollTop), before);
  await page.locator('#queue').evaluate((e) => { e.scrollTop = e.scrollHeight; });
  assert.ok(await page.locator('#queue').evaluate((e) => e.scrollTop > 0));
}, { viewport });
