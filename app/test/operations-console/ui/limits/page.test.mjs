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
/* Page flows: direct URLs, switch/return, passive/Live controls, fast-forwarded polling, refresh/retry, motion and layouts. */
import assert from 'node:assert/strict';
import { loadPlaywright, WIDE, NARROW } from "../../../../tools/browser-kit.mjs";
import { limitsTest, text, reference } from "./limits-kit.mjs";
const pw = await loadPlaywright();

for (const path of ['/?demo=1#limits', '/?demo=1&mode=limits']) limitsTest(pw, `${path.includes('mode=') ? 'query parameter' : 'hash'} opens Limits with the right controls`, async ({ page, step }) => {
  assert.equal(await page.locator('#mode [aria-pressed="true"]').getAttribute('data-m'), 'limits');
  for (const sel of ['#range', '#period', '#dash', '#service', '.grid']) assert.ok(await page.locator(sel).isHidden(), `${sel} is hidden in Limits`);
  assert.equal(await page.locator('#every').inputValue(), 'off');
  assert.equal(await text(page, '#live span'), 'Passive');
  await step(() => page.locator('#mode [data-m="console"]').click());
  assert.ok(await page.locator('#limits').isHidden()); assert.ok(await page.locator('#range').isVisible());
  await step(() => page.locator('#mode [data-m="limits"]').click());
  assert.equal(new URL(page.url()).hash, '#limits');
  assert.ok(await page.locator('#limits').isVisible());
  await page.reload(); await page.locator('#lAll table').waitFor({ state: 'attached' });
  assert.equal(await page.locator('#mode [aria-pressed="true"]').getAttribute('data-m'), 'limits');
}, { path, fixture: false });

limitsTest(pw, 'auto-refresh options update cost persist the interval and keep Live opt-in', async ({ page, step }) => {
  assert.deepEqual(await page.locator('#every option').evaluateAll((es) => es.map((e) => e.value)), ['off', '300', '900', '1800', '3600']);
  for (const seconds of [300, 900, 1800, 3600]) {
    await step(() => page.locator('#every').selectOption(String(seconds)));
    assert.equal(await text(page, '#live span'), `Live · ~${3600 / seconds} calls/h`);
    assert.equal(await text(page, '#lCost'), `Asks the org every ${seconds >= 120 ? `${seconds / 60} min` : `${seconds} s`} · ~${3600 / seconds} calls/h`);
    assert.equal(await page.evaluate(() => localStorage.getItem('omc.limitsEvery')), String(seconds));
    assert.ok(!(await page.locator('#limits').evaluate((e) => e.classList.contains('frozen'))));
  }
  await page.locator('#every').selectOption('off');
  assert.equal(await text(page, '#live span'), 'Passive');
  await page.reload(); await page.locator('#lAll table').waitFor({ state: 'attached' });
  assert.equal(await page.locator('#every').inputValue(), 'off');
  await step(() => page.locator('#live').click());
  assert.equal(await page.locator('#every').inputValue(), '3600');
  await page.locator('#limits').evaluate((e) => { e.tabIndex = -1; e.focus(); });
  await step(() => page.keyboard.press('Space'));
  assert.equal(await text(page, '#live span'), 'Passive');
});

limitsTest(pw, 'Live polling pauses while hidden resumes and stops after leaving Limits', async ({ page }) => {
  await page.locator('#every').selectOption('300');
  const count = () => page.evaluate(() => globalThis.__limitsLoads);
  const before = await count();
  await page.clock.fastForward(300001);
  assert.equal(await count(), before + 1, 'one elapsed interval triggers a full refresh');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.clock.fastForward(300001);
  assert.equal(await count(), before + 1, 'hidden page does not poll');
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  assert.equal(await count(), before + 2, 'returning runs the missed refresh');
  await page.locator('#mode [data-m="dashboard"]').click();
  const ticks = await page.evaluate(() => globalThis.__limitsUI.lim.ticks);
  await page.clock.fastForward(300001);
  assert.equal(await count(), before + 2);
  assert.equal(await page.evaluate(() => globalThis.__limitsUI.lim.ticks), ticks, 'Limits tick is stopped outside its view');
});

limitsTest(pw, 'Refresh keeps last good readings on failure and Retry recovers', async ({ page, step }) => {
  const before = await page.locator('#lGauges .lgv').allTextContents();
  await page.evaluate(() => globalThis.__failLimits = true);
  await step(() => page.locator('#refresh').click());
  assert.match(await text(page, '#banner'), /Showing the last good load/);
  assert.match(await text(page, '#banner'), /Limits fixture unavailable/);
  assert.equal(await text(page, '#updated'), 'Refresh failed');
  assert.deepEqual(await page.locator('#lGauges .lgv').allTextContents(), before);
  await page.evaluate(() => { globalThis.__failLimits = false; globalThis.__limitsUI.lim.demoApi = 250; });
  await step(() => page.locator('#banner [data-retry]').click());
  assert.ok(await page.locator('#banner').isHidden());
  assert.equal(await page.locator('#lOdo').getAttribute('aria-label'), '250 API calls today');
});

limitsTest(pw, 'page walkthrough supports keyboard reference search and Dashboard return', async ({ page, step }) => {
  await step(() => page.locator('#every').selectOption('3600'));
  assert.match(await text(page, '#live span'), /^Live/);
  assert.equal(await page.locator('#every').inputValue(), '3600');
  const summary = page.locator('#lRef > summary');
  await summary.focus(); await step(() => page.keyboard.press('Enter'));
  assert.notEqual(await page.locator('#lRef').getAttribute('open'), null);
  await page.keyboard.press('Tab');
  assert.ok(await page.locator('#lSearch').evaluate((e) => e === document.activeElement));
  assert.notEqual(await page.locator('#lSearch').evaluate((e) => getComputedStyle(e).outlineStyle), 'none');
  await step(() => page.locator('#lSearch').fill('Order Management'));
  assert.ok(await page.locator('#lAll tbody tr').count() > 0);
  await summary.focus(); await step(() => page.keyboard.press('Space'));
  assert.equal(await page.locator('#lRef').getAttribute('open'), null);
  assert.match(await text(page, '#live span'), /^Live/);
  assert.equal(await page.locator('#every').inputValue(), '3600');
  await step(() => page.locator('#mode [data-m="dashboard"]').click());
  await page.locator('#dTiles .kpi').first().waitFor();
  await step(() => page.locator('#mode [data-m="limits"]').click());
  assert.equal(new URL(page.url()).hash, '#limits');
  assert.equal(await page.locator('#lSearch').inputValue(), 'Order Management');
  assert.ok(await page.locator('#drawer').isHidden());
});

limitsTest(pw, 'unavailable request meter leaves org readings and reference usable', async ({ page, step }) => {
  assert.match(await text(page, '#lLedger'), /request meter is not available in this build/);
  assert.equal(await text(page, '#lStats'), '');
  assert.equal(await page.locator('#lGauges .lg').count(), 5);
  await step(() => reference(page));
  assert.ok(await page.locator('#lAll tbody tr').count() > 0);
}, { meter: false, fixture: false });

limitsTest(pw, 'Live request particles travel and finish when motion is enabled', async ({ page, step }) => {
  await page.locator('#live').click();
  await page.evaluate(() => globalThis.__limitsUI.meterRecord({ t: Date.now(), kind: 'graphql', source: 'dashboard', path: '/services/data/v68.0/graphql', ms: 30, status: 200 }));
  assert.equal(await page.locator('#lfParts circle.k-graphql').count(), 1);
  const first = await page.locator('#lfParts circle').getAttribute('cx');
  await page.clock.fastForward(450);
  assert.notEqual(await page.locator('#lfParts circle').getAttribute('cx'), first);
  await page.clock.fastForward(900);
  assert.equal(await page.locator('#lfParts circle').count(), 0);
  await step(() => page.locator('#live').click());
  assert.ok(await page.locator('#limits').evaluate((e) => e.classList.contains('frozen')));
}, { motion: 'no-preference' });

for (const viewport of [WIDE, NARROW]) limitsTest(pw, `${viewport.width}px layout fits and scrolls to the reference`, async ({ page, step }) => {
  await step(() => reference(page));
  const layout = await page.locator('#limits').evaluate((e) => ({ page: document.documentElement.scrollWidth <= innerWidth, fits: e.scrollWidth <= e.clientWidth + 1, columns: getComputedStyle(e.querySelector('.lrow')).gridTemplateColumns.split(' ').length, reference: getComputedStyle(e.querySelector('.lrefb')).gridTemplateColumns.split(' ').length }));
  assert.ok(layout.page && layout.fits);
  assert.equal(layout.columns, viewport.width < 1250 ? 1 : 2);
  assert.equal(layout.reference, viewport.width < 1250 ? 1 : 2);
  await page.locator('#lAll tbody tr').last().scrollIntoViewIfNeeded();
  assert.ok(await page.locator('#limits').evaluate((e) => e.scrollTop > 0));
}, { viewport });
