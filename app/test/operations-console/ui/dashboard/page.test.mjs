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
/* Page behavior: enter/leave Dashboard, all domain routes and shortcuts, customer/order drawers, product handoff and layout. */
import assert from 'node:assert/strict';
import { loadPlaywright, WIDE, NARROW } from "../../../../tools/browser-kit.mjs";
import { dashTest, chooseDomain, choosePeriod, data, n, text } from "./dashboard-kit.mjs";
const pw = await loadPlaywright();
const domains = ['orders', 'customers', 'fulfillment', 'payments', 'service', 'returns', 'products', 'policies'];

dashTest(pw, 'orders', 'view controls routes and all eight keyboard shortcuts', async ({ page, step }) => {
  assert.equal(await page.locator('#mode [aria-pressed="true"]').getAttribute('data-m'), 'dashboard');
  assert.ok(await page.locator('#period').isVisible());
  assert.ok(await page.locator('#range').isHidden());
  assert.ok(await page.locator('.grid').isHidden());
  assert.deepEqual(await page.locator('#dTabs [role="tab"]').evaluateAll((es) => es.map((e) => e.firstChild.textContent)), ['Orders', 'Customers', 'Fulfillment', 'Payments', 'Service', 'Returns', 'Products', 'Policies']);
  const d = await data(page), expectedCounts = [d.tiles.data.orders.cur, d.customers.data.count.cur, d.tiles.data.fos.cur, null, d.tiles.data.exceptions.cur, d.tiles.data.returns.cur, d.prodTotals.data.cur.n, null];
  assert.deepEqual(await page.locator('#dTabs button').evaluateAll((es) => es.map((e) => e.querySelector('small')?.textContent ?? null)), expectedCounts.map((v) => v == null ? null : n(v)));
  for (const [i, domain] of domains.entries()) {
    await step(() => page.keyboard.press(String(i + 1)));
    assert.equal(await page.locator('#dTabs [aria-selected="true"]').getAttribute('data-t'), domain);
    assert.equal(await page.locator('#dTabs [aria-selected="true"]').count(), 1);
    assert.equal(new URL(page.url()).hash, `#dashboard/${domain}`);
    assert.equal(await page.locator('#dash').evaluate((e) => e.scrollTop), 0, 'switching domain scrolls to its start');
  }
  await page.reload();
  await page.locator('#pPolReturn').waitFor();
  assert.equal(await page.locator('#dTabs [aria-selected="true"]').getAttribute('data-t'), 'policies');
  const customerTab = page.locator('#dTabs [data-t="customers"]');
  await customerTab.focus(); await page.keyboard.press('Enter');
  assert.ok(await customerTab.evaluate((e) => e === document.activeElement));
  await step(() => page.locator('#mode [data-m="console"]').click());
  assert.ok(await page.locator('#dash').isHidden());
  assert.ok(await page.locator('#range').isVisible());
  assert.ok(await page.locator('#period').isHidden());
  await step(() => page.locator('#mode [data-m="dashboard"]').click());
  assert.equal(new URL(page.url()).hash, '#dashboard/customers');
});

dashTest(pw, 'customers', 'account rankings open matching drawers by mouse Enter and Space', async ({ page, step }) => {
  const d = await data(page);
  for (const [id, key, action] of [['pTopSpend', 'bySpend', 'click'], ['pTopOrders', 'byOrders', 'Enter'], ['pTopRet', 'returners', 'Space']]) {
    const row = page.locator(`#${id} tr[data-acct]`).first(), account = d.customers.data[key][0];
    if (action === 'click') await step(() => row.click());
    else { await row.focus(); await step(() => page.keyboard.press(action)); }
    await page.locator('#drawer:not(.hide) #closeDrawer').waitFor();
    assert.ok((await text(page, '#drawer')).includes(account.name), 'the chosen customer opened');
    assert.match(await text(page, '#drawer'), /Lifetime|lifetime/);
    assert.ok(await page.locator('#drawer').evaluate((e) => e.contains(document.activeElement)));
    await page.keyboard.press('Escape');
    assert.ok(await page.locator('#drawer').isHidden());
    assert.ok(await row.evaluate((e) => e === document.activeElement), 'focus returns to its row');
    assert.equal(new URL(page.url()).hash, '#dashboard/customers');
  }
});

dashTest(pw, 'payments', 'outstanding orders open and close matching order drawers', async ({ page, step }) => {
  for (const [id, action] of [['pUnpaid', 'click'], ['pUnrefunded', 'Enter'], ['pUnpaid', 'Space']]) {
    const row = page.locator(`#${id} tr[data-order]`).first(), number = await row.locator('td').nth(1).innerText();
    if (action === 'click') await step(() => row.click());
    else { await row.focus(); await step(() => page.keyboard.press(action)); }
    await page.locator('#drawer:not(.hide) #closeDrawer').waitFor();
    assert.ok((await text(page, '#drawer')).includes(number), 'drawer shows the clicked order number');
    await step(() => page.locator('#closeDrawer').click());
    assert.ok(await page.locator('#drawer').isHidden());
    assert.ok(await row.evaluate((e) => e === document.activeElement));
  }
});

dashTest(pw, 'products', 'top product opens its own inventory with the mouse', async ({ page, step }) => {
  const row = page.locator('#pProdTop tr[data-prod]').first(), product = await row.getAttribute('data-pname');
  await step(() => row.click());
  await page.locator('#layers [data-l="inventory"].on').waitFor();
  assert.equal(await page.locator('#pq').inputValue(), product);
  assert.ok((await text(page, '#legend')).includes(product));
  assert.ok(await page.locator('#drawer').isHidden());
});

dashTest(pw, 'customers', 'whole page workflow reaches product inventory and returns to Dashboard', async ({ page, step }) => {
  await step(() => choosePeriod(page, 'ytd'));
  await step(() => page.locator('#pTopSpend tr[data-acct]').first().click());
  await page.locator('#drawer:not(.hide) #closeDrawer').waitFor();
  await step(() => page.keyboard.press('Escape'));
  await step(() => chooseDomain(page, 'products'));
  const row = page.locator('#pProdDemand tr[data-prod]').first(), product = await row.getAttribute('data-pname');
  await row.focus(); await step(() => page.keyboard.press('Space'));
  await page.locator('#layers [data-l="inventory"].on').waitFor();
  assert.ok(await page.locator('#dash').isHidden());
  assert.equal(await page.locator('#pq').inputValue(), product);
  assert.ok((await text(page, '#legend')).includes(product));
  await step(() => page.locator('#mode [data-m="dashboard"]').click());
  assert.equal(await text(page, '#dTitle'), 'Year to date');
  assert.equal(await page.locator('#dTabs [aria-selected="true"]').getAttribute('data-t'), 'products');
  assert.ok(await page.locator('#drawer').isHidden());
});

for (const viewport of [WIDE, NARROW]) dashTest(pw, 'orders', `${viewport.width}px layout scrolls every domain without page overflow`, async ({ page }) => {
  for (const domain of domains) {
    await chooseDomain(page, domain);
    if (domain === 'policies') await page.locator('#pPolReturn').waitFor();
    const got = await page.locator('#dash').evaluate((e) => {
      const grid = e.querySelector('#dGrid'), r = e.getBoundingClientRect();
      return { page: document.documentElement.scrollWidth <= innerWidth, dash: e.scrollWidth <= e.clientWidth + 1, columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length, panels: [...grid.querySelectorAll('.zone')].every((z) => z.getBoundingClientRect().left >= r.left - 1 && z.getBoundingClientRect().right <= r.right + 1) };
    });
    assert.ok(got.page && got.dash && got.panels, `${domain}: panels fit the viewport`);
    assert.equal(got.columns, viewport.width < 1250 ? 1 : domain === 'customers' ? 2 : 3);
    const last = page.locator('#dGrid .zone').last();
    await last.scrollIntoViewIfNeeded();
    assert.ok(await last.isVisible());
    assert.ok(await page.locator('#dash').evaluate((e) => e.scrollTop > 0), `${domain}: can scroll to last panel`);
  }
}, { viewport });
