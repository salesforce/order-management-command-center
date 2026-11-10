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
/* Empty/filtered/capped queues, partial data, load recovery, unavailable objects and customer/search failures. */
import assert from 'node:assert/strict';
import { loadPlaywright } from "../../../../tools/browser-kit.mjs";
import { serviceTest, sample, customer, queueFixture, fixture, queueKeys, search, range, text, AVERY } from "./service-kit.mjs";
const pw = await loadPlaywright();

serviceTest(pw, 'empty filtered and truncated queues have distinct messages', async ({ page }) => {
  const d = await sample(page, 'demoService', '90d');
  await queueFixture(page, { value: { ...d, items: [] } });
  assert.equal(await text(page, '#queue'), 'Nothing open in this range.');
  await queueFixture(page, { value: { ...d, items: d.items.filter((x) => x.kind === 'exception'), truncated: true } });
  assert.ok((await text(page, '#qSub')).includes(`showing the newest ${(await queueKeys(page)).length}`));
  await page.locator('#qTabs [data-k="Cases"]').click();
  assert.equal(await text(page, '#queue'), 'Nothing matches these filters.');
});

serviceTest(pw, 'missing objects invalid categories and partial errors preserve readable rows', async ({ page }) => {
  const d = await sample(page, 'demoService', '90d');
  await page.locator('#qTabs [data-k="Cases"]').click(); await page.locator('#qCat').selectOption('Billing');
  const items = d.items.filter((x) => x.kind === 'exception' && x.category === 'Routing');
  await queueFixture(page, { value: { ...d, items, objects: { Case: false, ProcessException: true }, errors: ['Cases are unavailable'] } });
  assert.equal(await page.locator('#qTabs [data-k="Cases"]').count(), 0);
  assert.equal(await page.locator('#qTabs [data-k][aria-pressed="true"]').textContent(), 'All');
  assert.equal(await page.locator('#qCat').inputValue(), '');
  assert.deepEqual(await queueKeys(page), items.map((x) => x.key));
  assert.ok((await text(page, '#queue')).includes('Cases are unavailable'));
});

serviceTest(pw, 'failed range retains the previous queue and Retry applies the new range', async ({ page }) => {
  const before = await queueKeys(page);
  await page.evaluate(() => { window.__serviceUI.queueFixture = { error: 'Queue read unavailable' }; });
  await range(page, '7d');
  assert.deepEqual(await queueKeys(page), before);
  assert.equal(await text(page, '#qSub'), `${before.length} open · last 90 days`);
  assert.ok((await text(page, '#banner')).includes('Queue read unavailable'));
  await page.evaluate(() => { window.__serviceUI.queueFixture = null; });
  await page.locator('#banner [data-retry]').click();
  await page.locator('#banner').waitFor({ state: 'hidden' });
  assert.deepEqual(await queueKeys(page), (await sample(page, 'demoService', '7d')).items.map((x) => x.key));
});

serviceTest(pw, 'customer not found and read failure recover through Back', async ({ page }) => {
  for (const [status, message] of [[404, 'That customer was not found in this org.'], [500, 'Customer read unavailable']]) {
    await fixture(page, 'customer', AVERY, { error: 'Customer read unavailable', status });
    await customer(page, AVERY, { wait: false });
    assert.equal(await text(page, '#c360 .perr'), message);
    await page.locator('#c360 [data-clear]').click();
    assert.equal(new URL(page.url()).hash, '#service');
    await fixture(page, 'customer', AVERY, {}); await customer(page);
    assert.equal(await text(page, '.chd h2'), 'Avery Chen');
  }
});

serviceTest(pw, 'empty customer sections and unavailable objects remain explicit', async ({ page }) => {
  const d = await sample(page, 'demoCustomer', AVERY);
  await fixture(page, 'customer', AVERY, { value: { ...d, attention: { cases: [], exceptions: [] }, orders: [], cases: [], returns: { list: [], refunded: 0, credited: 0 }, chats: [] } });
  await customer(page);
  const content = await text(page, '#c360');
  for (const value of ['Nothing open for this customer.', 'No orders.', 'No returns.', 'No chat transcripts.', 'Refunded $0', 'Credit memos $0']) assert.ok(content.includes(value));
  await fixture(page, 'customer', AVERY, { value: { ...d, attention: { cases: [], exceptions: [] }, orders: null, cases: null, returns: null, chats: null, objects: {} } });
  await customer(page);
  for (const name of ['Orders', 'Returns & refunds', 'Conversations']) assert.equal(await page.getByRole('heading', { name, exact: true }).count(), 0);
  assert.doesNotMatch(await text(page, '#c360'), /undefined|NaN|Invalid Date/);
  await page.locator('#agentBtn').click();
  assert.ok((await text(page, '#agentPanel .agent-ctx')).includes('Orders unavailable'), 'unreadable orders are not reported as zero orders');
});

serviceTest(pw, 'search failure renders safely and the next query recovers', async ({ page }) => {
  await fixture(page, 'search', 'broken', { error: 'Search unavailable <sample>' });
  await search(page, 'broken');
  assert.equal(await text(page, '#svcResults .perr'), 'Search unavailable <sample>');
  await search(page, 'avery');
  assert.deepEqual(await page.locator('#svcResults b').allTextContents(), (await sample(page, 'demoSearch', 'avery')).map((h) => h.name));
  assert.equal(await page.locator('#svcResults .perr').count(), 0);
});

serviceTest(pw, 'an expired customer session returns to sign-in', async ({ page }) => {
  await fixture(page, 'customer', AVERY, { error: 'Session expired', status: 401 });
  await customer(page, AVERY, { wait: false });
  await page.locator('#gate:not(.hide)').waitFor();
  assert.ok(await page.locator('#app').isHidden());
  assert.ok((await text(page, '#gate')).includes('Session expired'));
});
