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
// Asks Agentforce the same questions on the console, through the real page and the real agent, and checks each answer against
// the console's reads. Run it before and after changing the agent (its instructions or its reasoning model) and compare.
// Nothing is submitted: the agent's actions are all reads. See docs/agent-model.md.
//
// Usage, with node app/server.mjs running on the org (not ?demo=1):
//   node app/tools/agent-check.mjs --label gpt-4o [--base http://localhost:5178] --order <OrderSummaryId>
//                                  [--only console] [--out <dir>]
//   node app/tools/agent-check.mjs --compare <run.json>…   (a Markdown table, one column per run)
//   node app/tools/agent-check.mjs --rescore <run.json>…   (checks saved replies again, after a check changes)
// Needs Playwright: PLAYWRIGHT=<path to playwright-core's index.mjs> if it isn't installed where Node finds it. Its own
// Chromium, not channel 'chrome': Chrome 156 closed the page on Salesforce's cross-site sign-in redirect.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

const need = (ok, why) => (ok ? null : why);
// Each question with what a good answer has. A check gets { text, hash } and returns why it failed, or null.
const CASES = ({ order }) => [
  { name: 'console', url: '/', prompts: [
    { q: `What is the status of order summary ${order.number}?`, check: (r) => need(r.text.includes(order.number) && r.text.includes(order.status), `names the order and its status (${order.status})`) },
    { q: 'Which locations have the most open fulfillment orders?', check: (r) => need(/fulfil?lment/i.test(r.text) && /\d/.test(r.text), 'ranks locations with counts') },
  ] },
];

const GUARD = 'named an action that isn\'t a read';
// The order the questions are about, read through the server.
async function records(opt) {
  if (!opt.order) throw new Error('--order is required');
  const read = async (p) => { const r = await fetch(opt.base + p); if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); };
  const o = (await read(`/api/order/${opt.order}`)).order;
  return CASES({ order: { id: opt.order, number: o.OrderNumber, status: o.Status } });
}

async function run(opt) {
  if (!opt.label) throw new Error('--label is required (the model or change being tested)');
  const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright-core');
  const cases = await records(opt);
  mkdirSync(opt.out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (const c of cases.filter((x) => !opt.only || x.name === opt.only)) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(opt.base + c.url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(12000); // the page's reads, so Agentforce's context has the screen
    await page.locator('#agentBtn').click();
    // A question asked while Agentforce is still typing waits in the panel's queue, so each question waits until it isn't:
    // its time is then its own answer's.
    const idle = async () => { await page.waitForTimeout(1500); await page.locator('#agentPanel .typing').waitFor({ state: 'detached', timeout: 180000 }); };
    for (const p of c.prompts) {
      await idle();
      const started = Date.now();
      const mine = (r) => { try { return JSON.parse(r.request().postData() || '{}').text?.startsWith(p.q); } catch { return false; } };
      const res = page.waitForResponse((r) => r.url().endsWith('/api/agent/message') && r.request().method() === 'POST' && mine(r), { timeout: 180000 });
      await page.locator('#agentPanel textarea').fill(p.q);
      await page.locator('#agentPanel form.agent-in button[type=submit]').click();
      let reply = { text: '' }, sent = '', error = null;
      try { const got = await res; sent = JSON.parse(got.request().postData()).text; reply = await got.json(); } catch (err) { error = err.message; }
      await page.waitForTimeout(4000); // the reply renders
      const r = { text: reply.text || '', hash: await page.evaluate(() => location.hash) };
      const shown = await page.locator('#agentPanel .agent-msgs .agent-m').last().innerText().catch(() => ''); // the reply as shown
      const fail = error || (!r.text.trim() ? 'empty reply' : reply.guardHit ? GUARD : p.check(r));
      results.push({ case: c.name, q: p.q, ms: Date.now() - started, ok: !fail, fail, text: r.text, hash: r.hash, shown, sent });
      console.log(`${fail ? 'FAIL' : 'ok  '} [${c.name}] ${p.q} (${((Date.now() - started) / 1000).toFixed(0)} s)${fail ? ` — ${fail}` : ''}`);
    }
    await page.screenshot({ path: path.join(opt.out, `${opt.label}-${c.name}.png`) });
    await page.close();
  }
  await browser.close();
  const file = path.join(opt.out, `${opt.label}.json`);
  writeFileSync(file, JSON.stringify({ label: opt.label, at: new Date().toISOString(), base: opt.base, results }, null, 1));
  console.log(`${results.filter((x) => x.ok).length}/${results.length} passed → ${file}`);
}

// Saved runs checked again with the checks as they are now: the reply, the screen after it and what the page sent.
async function rescore(files, opt) {
  const cases = await records(opt);
  for (const file of files) {
    const run = JSON.parse(readFileSync(file, 'utf8'));
    for (const x of run.results) {
      const p = cases.find((c) => c.name === x.case)?.prompts.find((y) => y.q === x.q);
      if (!p || !x.sent || x.fail === GUARD) continue; // a question no longer asked, an error, or the guard: as it was
      const fail = !x.text.trim() ? 'empty reply' : p.check({ text: x.text, hash: x.hash });
      if ((fail || null) !== (x.fail || null)) console.log(`${run.label}: ${x.q} ${x.ok ? 'ok' : 'FAIL'} → ${fail ? `FAIL — ${fail}` : 'ok'}`);
      Object.assign(x, { ok: !fail, fail });
    }
    writeFileSync(file, JSON.stringify({ ...run, rescoredAt: new Date().toISOString() }, null, 1));
  }
}

// Runs side by side, one column each: each question's result and time.
function compare(files) {
  const runs = files.map((f) => JSON.parse(readFileSync(f, 'utf8')));
  const mark = (x) => (x ? (x.ok ? 'ok' : `FAIL (${x.fail})`) + ` ${(x.ms / 1000).toFixed(0)} s` : '—');
  console.log(`| Question | ${runs.map((r) => r.label).join(' | ')} |\n|---|${runs.map(() => '---').join('|')}|`);
  for (const x of runs[0].results) console.log(`| ${x.q} | ${runs.map((r) => mark(r.results.find((y) => y.case === x.case && y.q === x.q))).join(' | ')} |`);
  console.log(`| **Passed** | ${runs.map((r) => `${r.results.filter((x) => x.ok).length}/${r.results.length}`).join(' | ')} |`);
}

export async function main(args = process.argv.slice(2)) {
  const { values: opt, positionals } = parseArgs({ args, allowPositionals: true, options: {
    label: { type: 'string' }, base: { type: 'string', default: 'http://localhost:5178' }, out: { type: 'string', default: path.join(os.tmpdir(), 'agent-check') },
    order: { type: 'string' }, compare: { type: 'boolean' }, rescore: { type: 'boolean' }, only: { type: 'string' },
  } });
  if (opt.compare) { compare(positionals); return; }
  if (opt.rescore) { await rescore(positionals, opt); return; }
  await run(opt);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
import { fileURLToPath } from 'node:url';
