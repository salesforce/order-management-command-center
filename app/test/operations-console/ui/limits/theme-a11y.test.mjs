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
/* The same browser audit and theme-token checks as Dashboard, with the expanded reference and warning/over states. */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadPlaywright } from "../../../../tools/browser-kit.mjs";
import { limitsTest, reference, apply } from "./limits-kit.mjs";
const pw = await loadPlaywright(), audit = fileURLToPath(new URL("../../../../tools/a11y-audit.js", import.meta.url));
for (const theme of ['standard', 'slds-light', 'slds-dark']) limitsTest(pw, `${theme} theme tokens and whole-view accessibility`, async ({ page, step, data }) => {
  const d = structuredClone(data); d.org.data.FileStorageMB = { Max: 1000, Remaining: 200 };
  await apply(page, { data: d });
  await page.locator('#theme .theme-btn').click();
  await step(() => page.locator(`#theme [data-theme-v="${theme}"]`).click());
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), theme === 'standard' ? null : theme);
  await reference(page); await page.addScriptTag({ path: audit });
  const found = await page.evaluate(() => window.a11yAudit(document.querySelector('#app')));
  assert.deepEqual(found.issues, {}, `${theme}: ${JSON.stringify(found.issues)}`);
  const components = await page.evaluate(() => {
    const token = (t, p) => { const e = document.createElement('i'); e.style[p] = `var(${t})`; document.body.append(e); const v = getComputedStyle(e)[p]; e.remove(); return v; };
    return [['#lOdo', 'color', '--ink'], ['#lGauges .lg', 'backgroundColor', '--card-bg'], ['#lGauges .lv-warn .lga', 'stroke', '--amber'], ['#lGauges .lv-over .lga', 'stroke', '--red'], ['#lFlow .lfe.on', 'stroke', '--signal'], ['#lChart .cb.rest', 'fill', '--d2'], ['#lLedger .mbar i.red', 'backgroundColor', '--red'], ['#lRef', 'backgroundColor', '--card-bg']].map(([s, p, t]) => [s, getComputedStyle(document.querySelector(s))[p], token(t, p)]);
  });
  for (const [name, got, want] of components) assert.equal(got, want, `${theme}: ${name}`);
  await page.reload(); await page.locator('#lAll table').waitFor({ state: 'attached' });
  assert.equal(await page.evaluate(() => localStorage.getItem('omc.theme')), theme);
});
