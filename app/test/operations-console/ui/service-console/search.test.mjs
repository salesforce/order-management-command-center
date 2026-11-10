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
/* Search fields, matching rows, debounce/Enter, keyboard selection, dismissal and no-match behavior. */
import assert from 'node:assert/strict';
import { loadPlaywright } from "../../../../tools/browser-kit.mjs";
import { serviceTest, sample, search, text, AVERY, fixture, release } from "./service-kit.mjs";
const pw = await loadPlaywright();

for (const [kind, query] of [['name', 'avery'], ['email', 'avery@example.com'], ['phone', '5125550110'], ['order number', '0004210']]) serviceTest(pw, `customer search by ${kind} shows matching payload and opens the result`, async ({ page, step }) => {
  const expected = await sample(page, 'demoSearch', query);
  assert.ok(expected.length, 'known sample query has matches');
  await search(page, query);
  assert.deepEqual(await page.locator('#svcResults [data-hit] b').allTextContents(), expected.map((h) => h.name));
  assert.deepEqual(await page.locator('#svcResults .right').allTextContents(), expected.map((h) => h.matched));
  await step(() => page.locator('#svcResults [data-hit]').first().click());
  assert.equal(await text(page, '#c360 .chd h2'), expected[0].name);
  assert.equal(new URL(page.url()).hash, `#service/${expected[0].accountId}`);
  assert.ok(await page.locator('#svcResults').isHidden());
  if (expected[0].orderId) assert.ok(await page.locator('.ocard.picked').getByRole('button', { name: new RegExp(query) }).count());
});

serviceTest(pw, 'search minimum length blank and no matches', async ({ page }) => {
  await page.locator('#svcSearch').fill('a');
  assert.ok(await page.locator('#svcResults').isHidden());
  assert.equal(await page.evaluate(() => window.__serviceUI.reads.filter((x) => x.startsWith('search:')).length), 0);
  await search(page, 'zz-no-such-customer');
  assert.equal(await text(page, '#svcResults'), 'No customers match.');
  await page.locator('#svcSearch').fill(' ');
  assert.ok(await page.locator('#svcResults').isHidden());
});

serviceTest(pw, 'search arrows wrap and Enter chooses the highlighted result', async ({ page, step }) => {
  const hits = [
    { accountId: AVERY, name: 'Avery Chen', matched: 'Name' },
    { accountId: 'DACC00000000001', name: 'Northwind B2B', matched: 'Name' },
  ];
  await fixture(page, 'search', 'two', { value: hits }); await search(page, 'two');
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.locator('#svcResults .on').getAttribute('data-hit'), '1');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('#svcResults .on').getAttribute('data-hit'), '0');
  await page.keyboard.press('ArrowDown'); await step(() => page.keyboard.press('Enter'));
  assert.equal(await text(page, '#c360 .chd h2'), 'Northwind B2B');
});

serviceTest(pw, 'Enter searches before debounce and Escape then blur dismiss results', async ({ page, step }) => {
  await page.locator('#svcSearch').fill('avery');
  await step(() => page.keyboard.press('Enter'));
  assert.equal(await text(page, '#c360 .chd h2'), 'Avery Chen');
  await search(page, 'avery@example.com'); await page.keyboard.press('Escape');
  assert.ok(await page.locator('#svcResults').isHidden());
  assert.ok(await page.locator('#svcSearch').evaluate((e) => e === document.activeElement));
  assert.equal(await page.locator('#svcSearch').inputValue(), 'avery@example.com', 'Escape dismisses the result list without clearing the query');
  await page.keyboard.press('Escape');
  assert.ok(await page.locator('#svcSearch').evaluate((e) => e !== document.activeElement));
  await page.locator('#svcSearch').focus(); assert.ok(await page.locator('#svcResults').isVisible());
  await page.locator('#queue').focus(); assert.ok(await page.locator('#svcResults').isHidden());
});

serviceTest(pw, 'late search success and failure cannot replace the newer query', async ({ page }) => {
  const expected = (await sample(page, 'demoSearch', 'avery')).map((h) => h.name);
  for (const error of [null, 'Earlier search failed']) {
    await fixture(page, 'search', 'old', { hold: true, error, value: [{ accountId: AVERY, name: 'Old result', matched: 'Name' }] });
    await page.locator('#svcSearch').fill('old');
    await page.waitForFunction(() => !!window.__serviceUI.gates['search:old']);
    await search(page, 'avery');
    await release(page, 'search', 'old');
    assert.deepEqual(await page.locator('#svcResults b').allTextContents(), expected);
    assert.equal(await page.locator('#svcResults .perr').count(), 0);
  }
});
