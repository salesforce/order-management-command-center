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
// Shared sessions, fixed sample data and controllable customer/search/chat reads. The real view and event handlers run;
// only its transport is substituted. No application hooks or Salesforce calls are needed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { UI, T0, WIDE, openSession, until } from "../../../../tools/browser-kit.mjs";
export const AVERY = 'DACC00000000000', BUSINESS = 'DACC00000000001';
export const n = (v) => Number(v).toLocaleString('en-US');
export const usd = (v) => v == null ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
export const text = async (page, selector = '#service') => (await page.locator(selector).innerText()).replace(/\s+/g, ' ').trim();
export const sample = (page, name, ...args) => page.evaluate(async ({ name, args }) => (await import(new URL('operations-console/console-demo.js', document.baseURI).href))[name](...args), { name, args });
export const queueKeys = (page) => page.locator('#queue [data-q]').evaluateAll((es) => es.map((e) => e.dataset.q));
export const fixture = (page, kind, id, value) => page.evaluate(({ key, value }) => { window.__serviceUI.fixtures[key] = value; }, { key: `${kind}:${id}`, value });
export const release = (page, kind, id) => page.evaluate((key) => { window.__serviceUI.gates[key](); delete window.__serviceUI.gates[key]; }, `${kind}:${id}`);
export async function customer(page, id = AVERY, { focusOrder = null, wait = true } = {}) {
  await page.evaluate(({ id, focusOrder }) => { void window.__serviceUI.loadCustomer(id, { focusOrder }); }, { id, focusOrder });
  if (wait) await page.waitForFunction(async () => { const { S } = await import(new URL('console-state.js', document.baseURI).href); return !S.custBusy && !!document.querySelector('#c360 .chd h2'); });
}
export async function search(page, q) {
  const before = await page.evaluate(() => window.__serviceUI.reads.length);
  await page.locator('#svcSearch').fill(q);
  await page.waitForFunction(({ q, before }) => window.__serviceUI.reads.slice(before).includes(`search:${q}`), { q, before });
  await page.locator('#svcResults:not(.hide) [data-hit], #svcResults:not(.hide) .empty, #svcResults:not(.hide) .perr').first().waitFor();
}
export async function range(page, value) {
  await page.locator(`#range [data-v="${value}"]`).click();
  await page.waitForFunction((v) => !document.querySelector('#app').classList.contains('loading') && document.querySelector(`#range [data-v="${v}"]`).getAttribute('aria-pressed') === 'true', value);
}
export async function queueFixture(page, value) {
  await page.evaluate((value) => { window.__serviceUI.queueFixture = value; }, value);
  await page.locator('#refresh').click();
  await page.waitForFunction(() => !document.querySelector('#app').classList.contains('loading'));
}

export function serviceTest(pw, name, run, options = {}) {
  test(`Service Console: ${name}`, { skip: UI.skip(pw), timeout: 25000 }, async () => {
    const s = await openSession(pw, `service-console-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`, {
      path: '/?demo=1#service', viewport: WIDE, time: T0, ...options,
      setup: async (page) => {
        await page.route(/\/operations-console\/console-demo\.js(?:\?.*)?$/, async (route) => {
          const response = await route.fetch();
          await route.fulfill({ response, body: (await response.text()) + `
const rawServiceQueue = demoService;
demoService = (range) => {
  const f = globalThis.__serviceUI?.queueFixture;
  if (f?.error) throw new Error(f.error);
  return structuredClone(f?.value ?? rawServiceQueue(range));
};` });
        });
        await page.route(/\/operations-console\/console-service-view\.js(?:\?.*)?$/, async (route) => {
          const response = await route.fetch(), original = await response.text();
          const transport = /DEMO \? demo(?:Customer|Chat|Search)\([^)]*\)\s*: await j\(/g;
          assert.equal([...original.matchAll(transport)].length, 3, 'customer/search/chat exercise the async read paths');
          // Retain source line numbers so browser coverage maps to the real module.
          await route.fulfill({ response, body: original.replace(transport, (match) => '\n'.repeat(match.split('\n').length - 1) + 'await j(') + `
const realServiceView = createServiceView;
createServiceView = (page) => {
  const state = { fixtures: {}, gates: {}, reads: [], queueFixture: null };
  const read = async (url) => {
    const u = new URL(url, location.href), [, , kind, id] = u.pathname.split('/').filter(Boolean);
    const value = kind === 'search' ? u.searchParams.get('q') : decodeURIComponent(id), key = kind + ':' + value;
    state.reads.push(key);
    const f = state.fixtures[key];
    if (f?.hold) await new Promise((resolve) => { state.gates[key] = resolve; });
    if (f?.error) throw Object.assign(new Error(f.error), { status: f.status || 500 });
    return structuredClone(f?.value ?? (kind === 'customer' ? demoCustomer(value, u.searchParams.get('order')) : kind === 'search' ? demoSearch(value) : demoChat(value, S.cust)));
  };
  const api = realServiceView({ ...page, j: read });
  globalThis.__serviceUI = Object.assign(state, api);
  return api;
};` });
        });
      },
    });
    try {
      s.page.setDefaultTimeout(5000);
      assert.ok(await until(s.page, '#app:not(.loading):not(.hide) #service:not(.hide) #qTabs [data-k]', 15000), 'Service Console loaded');
      await run(s);
      assert.deepEqual(s.problems, [], 'no page errors, API calls or writes');
    } finally { await s.close(); }
  });
}

const auditPath = fileURLToPath(new URL("../../../../tools/a11y-audit.js", import.meta.url));
export async function audit(page) {
  await page.addScriptTag({ path: auditPath });
  const issues = await page.evaluate(() => {
    const { issues } = window.a11yAudit(document.querySelector('#service'));
    delete issues['heading-h1-missing']; // The console's page heading is outside the view.
    return issues;
  });
  assert.deepEqual(issues, {}, JSON.stringify(issues));
}
