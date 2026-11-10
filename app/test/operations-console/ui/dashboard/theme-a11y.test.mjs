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
/* Theme tokens and the existing accessibility audit cover every domain, not a full period × theme cross product. */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadPlaywright } from "../../../../tools/browser-kit.mjs";
import { dashTest, chooseDomain } from "./dashboard-kit.mjs";
const pw = await loadPlaywright();
const audit = fileURLToPath(new URL("../../../../tools/a11y-audit.js", import.meta.url));
const domains = ['orders', 'customers', 'fulfillment', 'payments', 'service', 'returns', 'products', 'policies'];
for (const theme of ['standard', 'slds-light', 'slds-dark']) dashTest(pw, 'orders', `${theme} tokens and accessibility on every domain`, async ({ page }) => {
  await page.addScriptTag({ path: audit });
  await page.locator('#theme .theme-btn').click();
  await page.locator(`#theme [data-theme-v="${theme}"]`).click();
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), theme === 'standard' ? null : theme);
  for (const domain of domains) {
    await chooseDomain(page, domain);
    if (domain === 'policies') await page.locator('#pPolReturn').waitFor();
    const found = await page.evaluate(() => window.a11yAudit(document.querySelector('#dash')));
    assert.deepEqual(found.issues, {}, `${theme}/${domain}: ${JSON.stringify(found.issues)}`);
    const components = await page.evaluate(() => {
      const resolve = (token, property) => { const e = document.createElement('i'); e.style[property] = `var(${token})`; document.body.append(e); const value = getComputedStyle(e)[property]; e.remove(); return value; };
      return [['#dash', 'color', '--ink'], ['#dTiles .kpi', 'backgroundColor', '--card-bg'], ['#dTiles .kpi .v', 'color', '--ink'], ['#dGrid .zone', 'backgroundColor', '--card-bg'], ['#dGrid .zone > h2', 'borderBottomColor', '--line'], ['#dTabs .on', 'color', '--ink']].map(([selector, property, token]) => [selector, getComputedStyle(document.querySelector(selector))[property], resolve(token, property)]);
    });
    for (const [component, got, want] of components) assert.equal(got, want, `${theme}/${domain}: ${component} uses its token`);
  }
  await page.reload();
  await page.locator('#pPolReturn').waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('omc.theme')), theme);
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), theme === 'standard' ? null : theme);
});
