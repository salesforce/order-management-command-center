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
/* Customer identity, attention groups, summary badges, entry points and linked-record navigation. */
import assert from 'node:assert/strict';
import { loadPlaywright } from "../../../../tools/browser-kit.mjs";
import { serviceTest, sample, customer, text, AVERY, fixture, release } from "./service-kit.mjs";
const pw = await loadPlaywright();

serviceTest(pw, 'customer header and all summary badges match its payload', async ({ page, step }) => {
  const d = await sample(page, 'demoCustomer', AVERY);
  await step(() => customer(page));
  assert.equal(await text(page, '.chd h2'), d.account.Name);
  const content = await text(page, '.chd');
  for (const v of [d.account.PersonEmail, d.account.Phone, `${d.account.BillingCity}, ${d.account.BillingState}`]) assert.ok(content.includes(v));
  const exceptions = d.attention.exceptions.reduce((n, e) => n + e.count, 0);
  const flying = d.orders.filter((o) => ['Created', 'Approved', 'Activated', 'Allocated', 'Pickpack', 'Fulfilling', 'Partially Fulfilled', 'Waiting to Fulfill'].includes(o.Status)).length;
  const badges = await page.locator('#c360 > .chips').first().locator('.badge').allTextContents();
  assert.deepEqual(badges, [`${d.attention.cases.length} open ${d.attention.cases.length === 1 ? 'case' : 'cases'}`, `${exceptions.toLocaleString('en-US')} open ${exceptions === 1 ? 'exception' : 'exceptions'}`, `${flying} ${flying === 1 ? 'order' : 'orders'} in flight`, `${d.returns.list.length} return in progress`]);
  await step(() => page.getByRole('button', { name: 'Customer value', exact: false }).click());
  assert.equal(await text(page, '#drawer .hd b'), d.account.Name);
  await page.keyboard.press('Escape'); assert.ok(await page.locator('.chd').isVisible());
});

serviceTest(pw, 'attention groups contain the right cases exceptions and order links', async ({ page, step }) => {
  const d = await sample(page, 'demoCustomer', AVERY);
  await customer(page);
  const groups = page.locator('#c360 .agrp'), expected = new Set([...d.attention.cases.map((x) => x.order?.id || ''), ...d.attention.exceptions.map((x) => x.order?.id || '')]);
  assert.equal(await groups.count(), expected.size);
  for (const c of d.attention.cases) {
    const row = page.locator(`#c360 .agrp [data-rec="Case:${c.Id}"]`);
    for (const v of [c.CaseNumber, c.Subject, c.Status]) assert.ok((await row.innerText()).includes(v));
  }
  for (const x of d.attention.exceptions) {
    const row = page.locator(`#c360 .agrp [data-rec="ProcessException:${x.id}"]`);
    assert.ok((await row.innerText()).includes(x.category));
    if (x.count > 1) assert.equal(await row.locator('.badge').textContent(), `×${x.count.toLocaleString('en-US')}`);
  }
  const target = page.locator('#c360 .agrp [data-rec]').first(), type = (await target.getAttribute('data-rec')).split(':')[0];
  await step(() => target.click());
  assert.equal(await text(page, '#drawer .hd .muted'), type === 'Case' ? 'Case' : 'Process Exception');
});

serviceTest(pw, 'most-open customers rank correctly and Clear returns to the queue overview', async ({ page, step }) => {
  const d = await sample(page, 'demoService', '90d'), by = new Map();
  for (const x of d.items) if (x.account?.id) { const c = by.get(x.account.id) || { ...x.account, n: 0 }; c.n++; by.set(c.id, c); }
  const top = [...by.values()].sort((a, b) => b.n - a.n).slice(0, 5);
  assert.deepEqual(await page.locator('#c360 [data-cust]').evaluateAll((es) => es.map((e) => [e.dataset.cust, e.querySelector('b').textContent])), top.map((c) => [c.id, c.name]));
  const first = page.locator('#c360 [data-cust]').first(); await first.focus(); await step(() => page.keyboard.press('Space'));
  assert.equal(await text(page, '.chd h2'), top[0].name);
  await step(() => page.getByRole('button', { name: 'Clear', exact: true }).click());
  assert.equal(new URL(page.url()).hash, '#service');
  assert.equal(await page.locator('#c360 .chd').count(), 0);
  assert.equal(await page.locator('#c360 [data-cust]').count(), top.length);
});

serviceTest(pw, 'newest customer wins after a delayed success or failure and Clear cancels loading', async ({ page }) => {
  for (const error of [null, 'Old customer failed']) {
    await fixture(page, 'customer', AVERY, { hold: true, error });
    await customer(page, AVERY, { wait: false }); await page.getByText('Loading customer…', { exact: true }).waitFor();
    await customer(page, 'DACC00000000001');
    await release(page, 'customer', AVERY);
    assert.equal(await text(page, '.chd h2'), 'Northwind B2B');
  }
  await fixture(page, 'customer', AVERY, { hold: true }); await customer(page, AVERY, { wait: false });
  await page.evaluate(() => window.__serviceUI.clearCustomer());
  await release(page, 'customer', AVERY);
  assert.equal(await page.locator('#c360 .chd').count(), 0);
  assert.equal(new URL(page.url()).hash, '#service');
});
