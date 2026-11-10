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
// Dashboard browser tests use the same sessions, recordings and read-only checks as the map tests.
// Expectations come from raw sample payloads under a fixed UTC clock, never from the rendered panel or CSV store.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from "../../../support/source-promises.mjs";
import { csvText } from "../../../../public/operations-console/console-csv.js";
import { UI, T0, WIDE, openSession, until } from "../../../../tools/browser-kit.mjs";

export const n = (v) => v == null ? '—' : Number(v).toLocaleString('en-US');
export const usd = (v) => v == null ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
export const pct = (v) => `${Math.round(v * 100)}%`;
export const rate = (a, b) => !b || a == null ? '—' : `${(a / b * 100).toFixed(a / b < .1 ? 1 : 0)}%`;
export const hours = (h) => h == null ? '—' : h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${h.toFixed(h < 10 ? 1 : 0)} h` : `${(h / 24).toFixed(h < 240 ? 1 : 0)} d`;
export const sum = (rows, key = 'n') => rows.reduce((s, r) => s + r[key], 0);
export const kv = (rows) => [['name', 'value'], ...rows.map((r) => [r.key, r.n])];
export const data = (page, period = 'mtd') => page.evaluate(async (p) => (await import(new URL('operations-console/console-demo.js', document.baseURI).href)).demoDash(p), period);
export const policies = (page) => page.evaluate(async () => (await import(new URL('operations-console/console-demo.js', document.baseURI).href)).demoPolicies());
export const text = async (page, sel) => (await page.locator(sel).innerText()).replace(/\s+/g, ' ').trim();

export function dashTest(pw, domain, name, run, options = {}) {
  test(`Dashboard ${domain}: ${name}`, { skip: UI.skip(pw), timeout: 30000 }, async () => {
    const s = await openSession(pw, `dashboard-${domain}-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`, { path: `/?demo=1#dashboard/${domain}`, viewport: WIDE, time: T0, ...options });
    try {
      s.page.setDefaultTimeout(5000);
      assert.ok(await until(s.page, '#app:not(.loading):not(.hide) #dGrid .dbody', 15000), 'Dashboard loaded');
      if (domain === 'policies') await s.page.locator('#pPolReturn').waitFor();
      await run(s);
      assert.deepEqual(s.problems, [], 'no page errors, API calls or writes');
    } finally { await s.close(); }
  });
}

// One independent test and video per component. The domain's period case rechecks every component's values after going up
// to YTD and back to MTD; exports are checked once per panel, not repeated for every period.
export function panelTests(pw, domain, panels) {
  for (const [id, title, source, check, csv] of panels) {
    dashTest(pw, domain, title, async ({ page, step }) => {
      const d = await data(page), b = domain === 'policies' ? await policies(page) : null;
      await step(() => page.locator(`#${id}`).scrollIntoViewIfNeeded());
      const heading = page.locator(`#${id}`).locator('..').locator('h2');
      assert.equal(await heading.evaluate((e) => e.firstChild.textContent.trim()), title);
      assert.equal(await heading.locator('.src').textContent(), source);
      assert.equal(await heading.locator(`[data-ask="${id}"]`).count(), 1);
      await check(page, d, b);
      await checkCsv(page, id, 'mtd', csv(d, b));
    });
  }
  dashTest(pw, domain, 'all components follow the period', async ({ page }) => {
    const policyRows = domain === 'policies' ? await page.locator('#dGrid tbody').allTextContents() : null;
    for (const p of ['ytd', 'mtd']) {
      await choosePeriod(page, p);
      const d = await data(page, p), b = domain === 'policies' ? await policies(page) : null;
      for (const [, , , check] of panels) await check(page, d, b);
      assert.equal(await page.locator('#dTabs [aria-selected="true"]').getAttribute('data-t'), domain);
      if (policyRows) assert.deepEqual(await page.locator('#dGrid tbody').allTextContents(), policyRows, 'policies are independent of period');
    }
  });
}

export async function choosePeriod(page, period) {
  await page.locator(`#period [data-v="${period}"]`).click();
  await page.waitForFunction((p) => !document.querySelector('#app').classList.contains('loading') && document.querySelector(`#period [data-v="${p}"]`).getAttribute('aria-pressed') === 'true', period);
  assert.equal(await page.locator('#period [aria-pressed="true"]').count(), 1);
}
export async function chooseDomain(page, domain) {
  await page.locator(`#dTabs [data-t="${domain}"]`).click();
  assert.equal(await page.locator('#dTabs [aria-selected="true"]').getAttribute('data-t'), domain);
}
// Only states absent from ordinary sample data are injected. Actual UI tab navigation causes the redraw.
export async function patch(page, domain, fields, policyBook) {
  await page.evaluate(async ({ fields, policyBook }) => {
    const { S } = await import(new URL('console-state.js', document.baseURI).href);
    Object.assign(S.dash, fields);
    if (policyBook) S.policyBook = policyBook;
  }, { fields, policyBook });
  await chooseDomain(page, domain === 'orders' ? 'returns' : 'orders');
  await chooseDomain(page, domain);
}

export async function stats(page, id, expected) {
  const got = await page.locator(`#${id} .mini > div`).evaluateAll((rows) => rows.map((r) => [r.querySelector('span').textContent, r.querySelector('b').textContent]));
  assert.deepEqual(got, expected, `${id}: every statistic`);
}
export async function bars(page, selector, rows, { fmt = n, share = true } = {}) {
  const got = await page.locator(selector).evaluateAll((hosts) => hosts.flatMap((e) => [...e.querySelectorAll('.hb > .row, :scope.hb > .row')]).map((r) => ({ key: r.querySelector('.lab').textContent, value: r.querySelector('.val').firstChild.textContent, sub: r.querySelector('small')?.textContent.trim() || '', width: parseFloat(r.querySelector('.bar i').style.width) })));
  const total = sum(rows), max = Math.max(1e-9, ...rows.map((r) => r.n));
  assert.deepEqual(got.map(({ width, ...r }) => r), rows.map((r) => ({ key: r.key, value: fmt(r.n), sub: r.s != null ? r.s.trim() : share && total ? pct(r.n / total) : '' })), `${selector}: labels, values and secondary values`);
  got.forEach((r, i) => assert.ok(Math.abs(r.width - Math.max(1.5, rows[i].n / max * 100)) < .001, `${selector}: ${r.key} bar scales with its value`));
  if (!rows.length) assert.match(await text(page, selector), /Nothing in this period/);
}
export async function table(page, id, headers, rows) {
  assert.deepEqual(await page.locator(`#${id} thead th`).allTextContents(), headers, `${id}: headers`);
  const got = await page.locator(`#${id} tbody tr`).evaluateAll((rs) => rs.map((r) => [...r.cells].map((c) => c.textContent.replace(/\s+/g, ' ').trim())));
  assert.deepEqual(got, rows.map((r) => r.map(String)), `${id}: every row and cell, in order`);
}
export async function stack(page, selector, rows) {
  const sorted = [...rows].sort((a, b) => b.n - a.n), total = sum(rows);
  const got = await page.locator(`${selector} .stack`).evaluate((el) => ({ total: el.parentElement.querySelector('h3 b').textContent, segments: [...el.children].map((e) => [e.title, +e.style.flexGrow]), keys: [...el.parentElement.querySelectorAll('.keys span')].map((e) => e.textContent) }));
  assert.equal(got.total, n(total));
  assert.deepEqual(got.segments, sorted.map((r) => [`${r.key}: ${n(r.n)} (${pct(r.n / total)})`, r.n]), `${selector}: counts, shares and widths`);
  assert.deepEqual(got.keys, sorted.map((r) => r.key + n(r.n)));
}

// An independent UTC calendar fills missing buckets with zero, including the current partial hour/day/month.
export function calendar(d, field) {
  const series = d[field].data, by = Object.fromEntries(series.map((r) => [r.key, r.n])), end = new Date(T0), rows = [];
  if (d.grain === 'hour') for (let h = 0; h <= end.getUTCHours(); h++) rows.push({ key: String(h), long: `${h % 12 || 12}:00 ${h < 12 ? 'AM' : 'PM'}`, n: by[h] || 0 });
  else {
    const start = new Date(d.from || `${series[0]?.key || end.toISOString().slice(0, 7)}-01`);
    if (d.grain === 'month') start.setUTCDate(1);
    for (const at = start; at <= end; d.grain === 'day' ? at.setUTCDate(at.getUTCDate() + 1) : at.setUTCMonth(at.getUTCMonth() + 1)) {
      const key = at.toISOString().slice(0, d.grain === 'day' ? 10 : 7);
      rows.push({ key, long: at.toLocaleDateString('en-US', d.grain === 'day' ? { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' } : { timeZone: 'UTC', month: 'short', year: 'numeric' }), n: by[key] || 0 });
    }
  }
  return rows;
}
export async function chart(page, selector, rows, unit) {
  const svg = page.locator(`${selector} svg.chart`);
  assert.equal(await svg.getAttribute('role'), 'img');
  assert.equal(await svg.getAttribute('tabindex'), '0');
  assert.ok((await svg.getAttribute('aria-label')).startsWith(`${unit} over time`), 'chart has a useful accessible name');
  assert.ok((await svg.getAttribute('aria-label')).includes(`${n(sum(rows))} in all`));
  assert.deepEqual(await svg.locator('.hit').evaluateAll((es) => es.map((e) => e.dataset.say)), rows.map((r) => `${r.long || r.key}: ${n(r.n)}`), `${selector}: every bucket, including gaps`);
  const heights = await svg.locator('.col').evaluateAll((es) => es.map((e) => e.getBBox().height)), counts = rows.filter((r) => r.n).map((r) => r.n);
  assert.equal(heights.length, counts.length, 'only nonzero buckets draw bars');
  heights.forEach((h, i) => assert.ok(Math.abs(h / Math.max(...heights) - counts[i] / Math.max(...counts)) < .001, 'column height scales with count'));
}

export async function checkCsv(page, id, period, rows) {
  const pending = page.waitForEvent('download');
  await page.locator(`[data-csv="${id}"]`).click();
  const download = await pending;
  try {
    assert.equal(download.suggestedFilename(), `om-${id.slice(1).toLowerCase()}-${period}.csv`);
    const got = await readFile(await download.path(), 'utf8');
    // CSV escaping has separate unit tests. Expected rows come from the payload, not the page's CSV store.
    assert.equal(got, csvText(rows), `${id}: exported content, headers and raw precision`);
  } finally { await download.delete(); }
}
