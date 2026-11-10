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
/* Queue rows, the three filters, grouped exceptions, keyboard selection, fallbacks, scrolling and every date range. */
import assert from 'node:assert/strict';
import { loadPlaywright } from "../../../../tools/browser-kit.mjs";
import { RANGE_LABEL } from "../../../../public/operations-console/console-labels.js";
import { serviceTest, sample, queueKeys, text, range, queueFixture, n } from "./service-kit.mjs";
const pw = await loadPlaywright();

serviceTest(pw, 'queue rows match priority order ownership and grouped exception counts', async ({ page }) => {
  const d = await sample(page, 'demoService', '90d');
  assert.deepEqual(await queueKeys(page), d.items.map((x) => x.key));
  assert.equal(await text(page, '#qSub'), `${d.items.length} open · last 90 days`);
  for (const x of d.items) {
    const exact = page.locator('#queue [data-q]').nth(d.items.indexOf(x)), content = await exact.innerText();
    assert.ok(content.includes(x.order ? `Order ${x.order.number}` : x.number));
    assert.ok(content.includes(x.account?.name || 'No customer'));
    assert.equal(await exact.locator('.sev').textContent(), x.kind === 'case' ? 'Case' : 'Exception');
    assert.ok(content.includes(x.owner.name));
    assert.equal(await exact.locator('.edge').getAttribute('title'), `${x.priority} priority`);
    if (x.count > 1) assert.ok(content.includes(`×${n(x.count)}`));
    for (const f of x.fromExceptions) assert.ok(content.includes(`${f.category} ×${f.count}`));
    assert.match(await exact.locator('.w').innerText(), /^\d+[mhd] ago/);
  }
});

serviceTest(pw, 'kind owner and category filters combine and retain keyboard focus', async ({ page, step }) => {
  const d = await sample(page, 'demoService', '90d');
  for (const [kind, owner, category] of [['Cases', 'Assigned', 'Billing'], ['Exceptions', 'Unassigned', ''], ['All', 'Anyone', 'Fulfillment'], ['All', 'Anyone', '']]) {
    await step(() => page.locator(`#qTabs [data-k="${kind}"]`).click());
    await page.locator(`#qTabs [data-o="${owner}"]`).click(); await page.locator('#qCat').focus(); await page.locator('#qCat').selectOption(category);
    const expected = d.items.filter((x) => (kind === 'All' || (kind === 'Cases') === (x.kind === 'case')) && (owner === 'Anyone' || (owner === 'Assigned') === x.owner.person) && (!category || x.category === category));
    assert.deepEqual(await queueKeys(page), expected.map((x) => x.key));
    assert.equal(await page.locator('#qTabs [data-k][aria-pressed="true"]').textContent(), kind);
    assert.equal(await page.locator('#qTabs [data-o][aria-pressed="true"]').textContent(), owner);
    assert.ok(await page.locator('#qCat').evaluate((e) => e === document.activeElement));
  }
});

serviceTest(pw, 'queue arrows j k Enter and Space select open and clamp at both ends', async ({ page, step }) => {
  const d = await sample(page, 'demoService', '90d'), queue = page.locator('#queue');
  await queue.focus(); await page.keyboard.press('ArrowUp');
  assert.equal(await queue.getAttribute('aria-activedescendant'), `q-${d.items[0].key}`);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('k'); await page.keyboard.press('j');
  assert.equal(await queue.getAttribute('aria-activedescendant'), `q-${d.items[1].key}`);
  await step(() => page.keyboard.press('Enter'));
  assert.equal(await text(page, '#c360 .chd h2'), d.items[1].account.name);
  const picked = page.locator('#c360 .ocard.picked');
  assert.ok((await picked.innerText()).includes(d.items[1].order.number));
  for (let i = 0; i < d.items.length + 2; i++) await page.keyboard.press('ArrowDown');
  assert.equal(await queue.getAttribute('aria-activedescendant'), `q-${d.items.at(-1).key}`);
  await queue.focus(); await step(() => page.keyboard.press('Space'));
  assert.equal(await page.locator('#queue [aria-selected="true"]').count(), 1);
});

serviceTest(pw, 'records without customers fall back to order or case drawers', async ({ page, step }) => {
  const d = await sample(page, 'demoService', '90d');
  const order = d.items.find((x) => !x.account && x.order);
  const bare = { ...d.items.find((x) => x.kind === 'case'), key: 'bare-case', account: null, order: null };
  await queueFixture(page, { value: { ...d, items: [order, bare] } });
  await step(() => page.locator('#queue [data-q]').first().click());
  assert.equal(await text(page, '#drawer .hd b'), order.order.number); await page.keyboard.press('Escape');
  await step(() => page.locator('#queue [data-q]').last().click());
  assert.equal(await text(page, '#drawer .hd .muted'), 'Case');
  assert.ok(await page.locator('#c360 .chd').isHidden());
});

serviceTest(pw, 'all seven ranges refresh the queue and retain the selected customer', async ({ page }) => {
  await page.locator('#queue [data-q]').first().click();
  const customer = await text(page, '#c360 .chd h2'), hash = new URL(page.url()).hash;
  for (const key of ['today', 'all', '7d', '1y', '30d', '6m', '90d']) {
    await range(page, key);
    const expected = await sample(page, 'demoService', key);
    assert.deepEqual(await queueKeys(page), expected.items.map((x) => x.key), key);
    assert.equal(await text(page, '#qSub'), `${expected.items.length} open · ${RANGE_LABEL[key]}`);
    assert.equal(await page.locator('#range [aria-pressed="true"]').count(), 1);
    assert.equal(await text(page, '#c360 .chd h2'), customer);
    assert.equal(new URL(page.url()).hash, hash);
  }
});

serviceTest(pw, 'queue scrolling and filtering keep the selected option valid', async ({ page }) => {
  const queue = page.locator('#queue');
  await queue.focus();
  for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowDown');
  assert.ok(await queue.evaluate((e) => e.scrollTop > 0));
  assert.ok(await page.locator('#queue [aria-selected="true"]').evaluate((e) => { const a = e.getBoundingClientRect(), b = e.parentElement.getBoundingClientRect(); return a.top >= b.top - 1 && a.bottom <= b.bottom + 1; }));
  const selected = await page.locator('#queue [aria-selected="true"] .sev').textContent();
  await page.locator(`#qTabs [data-k="${selected === 'Case' ? 'Exceptions' : 'Cases'}"]`).click();
  assert.equal(await queue.getAttribute('aria-activedescendant'), null);
  assert.equal(await page.locator('#queue [aria-selected="true"]').count(), 0);
});
