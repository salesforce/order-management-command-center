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
/* Conversation metadata, full text, speaker alignment, preserved expansion, loading and safe recovery. */
import assert from 'node:assert/strict';
import { loadPlaywright } from "../../../../tools/browser-kit.mjs";
import { serviceTest, sample, customer, fixture, release, text, AVERY } from "./service-kit.mjs";
const pw = await loadPlaywright();
const chatButton = (page) => page.locator('#c360 [data-chat]').first();

serviceTest(pw, 'conversation metadata entries speakers options and linked records', async ({ page, step }) => {
  const d = await sample(page, 'demoCustomer', AVERY), chat = d.chats[0], thread = await sample(page, 'demoChat', chat.Id, d);
  await customer(page);
  const row = chatButton(page).locator('xpath=ancestor::tr');
  for (const value of [chat.Name, chat.Status, chat.Owner.Name]) assert.ok((await row.innerText()).includes(value));
  assert.equal(await chatButton(page).getAttribute('aria-expanded'), 'false');
  await step(() => chatButton(page).click());
  assert.equal(await chatButton(page).getAttribute('aria-expanded'), 'true');
  const messages = page.locator('#c360 .thread > div');
  assert.equal(await messages.count(), thread.entries.length);
  for (const [i, entry] of thread.entries.entries()) {
    const content = await messages.nth(i).innerText();
    assert.ok(content.includes(entry.text));
    if (entry.kind !== 'system') assert.ok(content.includes(entry.who));
    for (const label of entry.buttons || []) assert.ok(content.includes(label));
  }
  assert.equal(await page.locator('.thread .msg.cust').count(), thread.entries.filter((e) => e.who === 'Avery').length);
  assert.ok(await row.locator('[data-order]').count());
  if (chat.CaseId) {
    await step(() => row.locator('[data-rec^="Case:"]').click());
    assert.equal(await text(page, '#drawer .hd .muted'), 'Case');
  }
});

serviceTest(pw, 'expanded conversation survives queue refresh and collapses accessibly', async ({ page }) => {
  await customer(page); await chatButton(page).click();
  await page.locator('.thread .msg').first().waitFor();
  await page.locator('#refresh').click();
  assert.equal(await chatButton(page).getAttribute('aria-expanded'), 'true');
  assert.ok(await page.locator('.thread').isVisible());
  await chatButton(page).focus(); await page.keyboard.press('Space');
  assert.equal(await chatButton(page).getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('.thread').count(), 0);
  assert.ok(await chatButton(page).evaluate((e) => e === document.activeElement));
});

serviceTest(pw, 'conversation loading failure retry and unavailable text', async ({ page, step }) => {
  const d = await sample(page, 'demoCustomer', AVERY), id = d.chats[0].Id;
  await customer(page); await fixture(page, 'chat', id, { hold: true, error: 'Conversation read failed' });
  await chatButton(page).click(); await page.getByText('Loading conversation…', { exact: true }).waitFor();
  await release(page, 'chat', id);
  assert.equal(await text(page, '#c360 .perr'), 'Conversation read failed');
  await chatButton(page).click(); await fixture(page, 'chat', id, { value: { entries: [] } });
  await step(() => chatButton(page).click());
  assert.ok((await text(page)).includes('The transcript is empty.'));
  await chatButton(page).click(); await fixture(page, 'chat', id, { value: {} }); await chatButton(page).click();
  assert.ok((await text(page)).includes("This org doesn't store transcript text."));
});

serviceTest(pw, 'collapsed or previous-customer conversation replies stay hidden', async ({ page }) => {
  const d = await sample(page, 'demoCustomer', AVERY), id = d.chats[0].Id;
  await customer(page); await fixture(page, 'chat', id, { hold: true }); await chatButton(page).click();
  await page.getByText('Loading conversation…', { exact: true }).waitFor();
  await chatButton(page).click(); await release(page, 'chat', id);
  assert.equal(await page.locator('.thread').count(), 0);
  await fixture(page, 'chat', id, { hold: true }); await chatButton(page).click();
  await customer(page, 'DACC00000000001'); await release(page, 'chat', id);
  assert.equal(await text(page, '.chd h2'), 'Northwind B2B');
  assert.equal(await page.locator('.thread').count(), 0);
});
