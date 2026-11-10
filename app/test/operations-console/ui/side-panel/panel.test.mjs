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
/* Shared shell, keyboard/focus, parent-page state, viewport geometry and all three themes. */
import assert from 'node:assert/strict';
import { loadPlaywright, WIDE } from "../../../../tools/browser-kit.mjs";
import { panelTest, orders, open, streamRow, view, text, audit } from "./side-panel-kit.mjs";
const pw = await loadPlaywright();

panelTest(pw, 'open close controls reset content view and navigation', async ({ page, step }) => {
  const [a, b] = await orders(page);
  for (const close of [() => page.locator('#closeDrawer').click(), () => page.keyboard.press('Escape'), () => page.locator('#scrim').click({ position: { x: 10, y: 10 } })]) {
    const row = await streamRow(page);
    await step(() => row.click());
    assert.equal(await page.getByRole('dialog', { name: 'Record details' }).count(), 1);
    assert.ok(await page.locator('#scrim').isVisible());
    await view(page, 'Timeline');
    await page.locator('#drawer .hx-box').first().waitFor();
    await step(close);
    assert.ok(await page.locator('#drawer').isHidden());
    assert.ok(await page.locator('#scrim').isHidden());
    assert.ok(await row.evaluate((e) => e === document.activeElement));
  }
  await open(page, 'OrderSummary', b.Id);
  assert.equal(await text(page, '#drawer .hd b'), b.OrderNumber);
  assert.notEqual(a.Id, b.Id);
  assert.equal(await page.getByRole('tab', { selected: true }).textContent(), 'Details');
  assert.equal(await page.locator('#dBack').count(), 0);
  assert.equal(await page.locator('#drawer').evaluate((e) => e.classList.contains('wide')), false);
});

panelTest(pw, 'keyboard opens records traps focus and restores a redrawn trigger', async ({ page, step }) => {
  for (const key of ['Enter', 'Space']) {
    const row = await streamRow(page);
    await row.focus();
    await step(() => page.keyboard.press(key));
    assert.ok(await page.locator('#drawer').evaluate((e) => e.contains(document.activeElement)));
    const controls = page.locator('#drawer button, #drawer a[href], #drawer [tabindex="0"]');
    await controls.last().focus(); await page.keyboard.press('Tab');
    assert.ok(await controls.first().evaluate((e) => e === document.activeElement));
    await page.keyboard.press('Shift+Tab');
    assert.ok(await controls.last().evaluate((e) => e === document.activeElement));
    await row.evaluate((e) => e.replaceWith(e.cloneNode(true))); // as a background refresh replaces the trigger
    await page.keyboard.press('Escape');
    assert.ok(await row.evaluate((e) => e === document.activeElement));
    if (key === 'Enter') await page.locator('#stTabs [data-t="orders"]').click(); // restore the cloned row's real click handler
  }
});

panelTest(pw, 'redrawing the focused control keeps focus in the open drawer or data map', async ({ page }) => {
  await open(page, 'OrderSummary', (await orders(page))[0].Id);
  for (const layer of ['#drawer', '#modal']) {
    if (layer === '#modal') {
      await page.locator('#mode [data-m="dashboard"]').click();
      await page.locator('#dataMapBtn').click();
    }
    const control = page.locator(`${layer} button`).first();
    await control.focus();
    await control.evaluate((e) => e.replaceWith(e.cloneNode(true)));
    await page.waitForFunction((selector) => document.activeElement === document.querySelector(selector), layer);
    assert.ok(await page.locator(layer).isVisible());
    await page.keyboard.press('Escape');
    assert.ok(await page.locator(layer).isHidden());
  }
});

panelTest(pw, 'drill and close preserve Dashboard period domain and scroll', async ({ page, step }) => {
  await page.locator('#mode [data-m="dashboard"]').click();
  await page.locator('#dTabs [data-t="customers"]').click();
  await page.locator('#period [data-v="ytd"]').click();
  const row = page.locator('#pTopSpend tr[data-acct]').first();
  await row.waitFor(); await row.scrollIntoViewIfNeeded();
  const before = await page.locator('#dash').evaluate((e) => e.scrollTop), hash = new URL(page.url()).hash;
  await step(() => row.click());
  await page.locator('#drawer .hd').waitFor();
  await step(() => page.locator('#drawer [data-rec^="OrderSummary:"]').first().click());
  await page.locator('#dBack').click();
  await page.keyboard.press('Escape');
  assert.equal(new URL(page.url()).hash, hash);
  assert.equal(await page.locator('#period [aria-pressed="true"]').getAttribute('data-v'), 'ytd');
  assert.equal(await page.locator('#dTabs [aria-selected="true"]').getAttribute('data-t'), 'customers');
  assert.equal(await page.locator('#dash').evaluate((e) => e.scrollTop), before);
  assert.ok(await row.evaluate((e) => e === document.activeElement));
});

for (const viewport of [WIDE, { width: 390, height: 844 }]) panelTest(pw, `${viewport.width}px drawer and timeline fit and scroll`, async ({ page }) => {
  await open(page, 'OrderSummary', (await orders(page))[0].Id);
  for (const name of ['Details', 'Timeline']) {
    await view(page, name);
    if (name === 'Timeline') await page.locator('#drawer .hx-box').first().waitFor();
    const got = await page.locator('#drawer').evaluate((e) => { const r = e.getBoundingClientRect(); return { inside: r.left >= -1 && r.right <= innerWidth + 1, fits: e.scrollWidth <= e.clientWidth + 1 }; });
    assert.ok(got.inside && got.fits, `${name}: ${JSON.stringify(got)}`);
    await page.locator('#drawer').evaluate((e) => { e.scrollTop = e.scrollHeight; });
    assert.ok(await page.locator('#drawer').evaluate((e) => e.scrollTop > 0), 'long content scrolls');
    await page.locator('#closeDrawer').scrollIntoViewIfNeeded();
    assert.ok(await page.locator('#closeDrawer').evaluate((e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }));
  }
}, { viewport });

for (const theme of ['standard', 'slds-light', 'slds-dark']) panelTest(pw, `${theme} drawer themes and accessibility`, async ({ page }) => {
  const id = (await orders(page))[0].Id;
  await open(page, 'OrderSummary', id);
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), theme === 'standard' ? null : theme);
  const colors = await page.locator('#drawer').evaluate((e) => { const probe = document.createElement('i'); probe.style.background = 'var(--panel)'; e.append(probe); const token = getComputedStyle(probe).backgroundColor; probe.remove(); return [getComputedStyle(e).backgroundColor, token]; });
  assert.equal(colors[0], colors[1]);
  for (const name of ['Details', 'Activity', 'Timeline']) {
    await view(page, name);
    if (name !== 'Details') await page.locator(name === 'Activity' ? '.hx-act' : '.hx-tl').waitFor();
    await audit(page);
  }
  await open(page, 'Account', 'DACC00000000000'); await audit(page);
}, { theme });
