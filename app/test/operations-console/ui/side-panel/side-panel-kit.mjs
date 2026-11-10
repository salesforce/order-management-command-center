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
// Shared drawer sessions and sample reads. Only the transport is replaced: the drawer's real async read paths, rendering,
// navigation and event handlers run unchanged. No test hooks enter app/public and no request reaches Salesforce.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { UI, T0, WIDE, openSession, until } from "../../../../tools/browser-kit.mjs";

export const usd = (v) => v == null ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
export const n = (v) => Number(v).toLocaleString('en-US');
export const text = async (page, selector = '#drawer') => (await page.locator(selector).innerText()).replace(/\s+/g, ' ').trim();
export const sample = (page, name, ...args) => page.evaluate(async ({ name, args }) => (await import(new URL('operations-console/console-demo.js', document.baseURI).href))[name](...args), { name, args });
export const orders = (page) => page.evaluate(async () => { const { S } = await import(new URL('console-state.js', document.baseURI).href); return S.data.orderPool || S.data.stream.data; });
export const payload = (page) => page.evaluate(async () => (await import(new URL('console-state.js', document.baseURI).href)).S.data);
export const fixture = (page, kind, id, value) => page.evaluate(({ key, value }) => { window.__drawerUI.fixtures[key] = value; }, { key: `${kind}:${id}`, value });
export const release = (page, kind, id) => page.evaluate((key) => { window.__drawerUI.gates[key](); delete window.__drawerUI.gates[key]; }, `${kind}:${id}`);
export async function open(page, obj, id, { wait = true } = {}) {
  await page.evaluate(({ obj, id }) => { void window.__drawerUI.openAny(obj, id); }, { obj, id });
  if (wait) await page.locator('#drawer:not(.hide) #closeDrawer').waitFor();
}
export const view = async (page, name) => { await page.getByRole('tab', { name, exact: true }).click(); await page.locator('#oTabs [aria-selected="true"]').filter({ hasText: name }).waitFor(); };
export const rows = async (page, heading) => page.getByRole('heading', { name: heading, exact: true }).locator('xpath=following-sibling::table[1]').locator('tbody tr').evaluateAll((es) => es.map((e) => [...e.cells].map((c) => c.textContent.replace(/\s+/g, ' ').trim())));
export const facts = (page) => page.locator('#drawer .facts > div').evaluateAll((es) => Object.fromEntries(es.map((e) => { const label = e.querySelector('span'); return [label.textContent, e.textContent.slice(label.textContent.length).trim()]; })));
export async function streamRow(page, tab = 'orders') {
  await page.locator(`#stTabs [data-t="${tab}"]`).click();
  return page.locator('#stream tbody tr[data-id]').first();
}

export function panelTest(pw, name, run, options = {}) {
  test(`Side panel: ${name}`, { skip: UI.skip(pw), timeout: 25000 }, async () => {
    const s = await openSession(pw, `side-panel-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`, {
      viewport: WIDE, time: T0, ...options,
      setup: async (page) => {
        await page.route(/\/console-drawers\.js(?:\?.*)?$/, async (route) => {
          const response = await route.fetch();
          const original = await response.text(), transport = /DEMO \? demo(?:Order|History|Record|Account)\([^)]*\) : await j\(/g;
          assert.equal([...original.matchAll(transport)].length, 4, 'all four drawer reads use the controlled async transport');
          const source = original.replace(transport, 'await j(');
          await route.fulfill({ response, body: source + `
const realCreateDrawers = createDrawers;
createDrawers = (page) => {
  const state = { fixtures: {}, gates: {}, reads: [] };
  const read = async (url) => {
    const path = new URL(url, location.href).pathname.split('/').filter(Boolean);
    const kind = path[1] === 'record' ? path[2] : path[3] === 'history' ? 'history' : path[1];
    const id = decodeURIComponent(path[path[1] === 'record' ? 3 : 2]), key = kind + ':' + id;
    state.reads.push(key);
    const f = state.fixtures[key];
    if (f?.hold) await new Promise((resolve) => { state.gates[key] = resolve; });
    if (f?.error) throw new Error(f.error);
    return structuredClone(f?.value ?? (kind === 'order' ? demoOrder(id) : kind === 'history' ? demoHistory(id) : kind === 'account' ? demoAccount(id) : demoRecord(kind, id)));
  };
  const api = realCreateDrawers({ ...page, j: read });
  globalThis.__drawerUI = Object.assign(state, api);
  return api;
};` });
        });
      },
    });
    try {
      s.page.setDefaultTimeout(5000);
      assert.ok(await until(s.page, '#app:not(.loading):not(.hide) #kpis > .kpi', 15000), 'sample page loaded');
      await run(s);
      assert.deepEqual(s.problems, [], 'no page errors, API calls or writes');
    } finally { await s.close(); }
  });
}

const auditPath = fileURLToPath(new URL("../../../../tools/a11y-audit.js", import.meta.url));
export async function audit(page) {
  await page.addScriptTag({ path: auditPath });
  const issues = await page.evaluate(() => {
    const { issues } = window.a11yAudit(document.querySelector('#drawer'));
    delete issues['heading-h1-missing']; // The page's h1 is outside this dialog; audit only the drawer here.
    return issues;
  });
  assert.deepEqual(issues, {}, JSON.stringify(issues));
}
