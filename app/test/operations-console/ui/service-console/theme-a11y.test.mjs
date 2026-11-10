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
/* All themes audit the queue, populated customer, expanded conversation and active search results. */
import assert from 'node:assert/strict';
import { loadPlaywright } from "../../../../tools/browser-kit.mjs";
import { serviceTest, customer, search, audit } from "./service-kit.mjs";
const pw = await loadPlaywright();
for (const theme of ['standard', 'slds-light', 'slds-dark']) serviceTest(pw, `${theme} theme tokens and component accessibility`, async ({ page }) => {
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), theme === 'standard' ? null : theme);
  await audit(page); await customer(page); await audit(page);
  await page.locator('#c360 [data-chat]').first().click(); await page.locator('.thread .msg').first().waitFor(); await audit(page);
  await search(page, 'avery'); await audit(page);
  const tokens = await page.evaluate(() => {
    const resolve = (token, property) => { const e = document.createElement('i'); e.style[property] = `var(${token})`; document.body.append(e); const value = getComputedStyle(e)[property]; e.remove(); return value; };
    return [['#service', 'color', '--ink'], ['#service .zone', 'backgroundColor', '--card-bg'], ['#svcSearch', 'backgroundColor', '--panel2'], ['#qCat', 'backgroundColor', '--panel'], ['#qCat', 'color', '--ink'], ['#c360 .fob', 'backgroundColor', '--panel2'], ['.thread .cust', 'backgroundColor', '--panel2'], ['#svcResults', 'backgroundColor', '--pop-bg']].map(([selector, property, token]) => [selector, getComputedStyle(document.querySelector(selector))[property], resolve(token, property)]);
  });
  for (const [selector, got, want] of tokens) assert.equal(got, want, selector);
  await page.reload(); await page.locator('#qTabs [data-k]').first().waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('omc.theme')), theme);
}, { theme });
