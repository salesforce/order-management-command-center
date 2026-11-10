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
// Exercise module identity and a generated hosted subpath in a real browser, without a Salesforce connection.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadPlaywright, launchChrome, newContext, openOn, until, serve } from '../../../tools/browser-kit.mjs';

const pw = await loadPlaywright(), skip = pw ? false : 'Playwright is needed';
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
async function sameState(page) {
  return page.evaluate(async () => {
    const old = await import(new URL('console-state.js', document.baseURI).href);
    const canonical = await import(new URL('operations-console/console-state.js', document.baseURI).href);
    return old.S === canonical.S && !!old.S.data;
  });
}
test('legacy and canonical browser URLs share the running page state', { skip }, async () => {
  const server = await serve(ROOT), browser = await launchChrome(pw), context = await newContext(browser);
  try {
    const page = await context.newPage();
    await openOn(page, server.url + '/?demo=1');
    assert.ok(await until(page, '#app:not(.hide):not(.loading) .kpi'));
    assert.equal(await sameState(page), true);
    assert.equal(await page.locator('#app .brand h1').innerText(), 'Salesforce Order Management Operations Console');
    assert.match(await page.title(), /^Salesforce Order Management Operations Console$/);
    assert.doesNotMatch(await page.locator('body').innerText(), /\bSOM\b|Command Center/);
  } finally { await context.close(); await browser.close(); server.stop(); }
});
test('the hosted console resolves all modules under a subpath and use the canonical configuration', { skip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-hosted-')), site = path.join(dir, 'site');
  execFileSync(process.execPath, [path.join(ROOT, 'app/tools/shared/static-site.mjs'), site]);
  fs.writeFileSync(path.join(site, 'shared/transport/om-config.js'), 'export const CONFIG = {clientId:"fixture",domain:"https://fixture.my.salesforce.com",blocked:[]};');
  const prefix = '/preview/v1/';
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://local').pathname;
    const relative = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : '../refused';
    const name = relative.endsWith('/') || !relative ? relative + 'index.html' : relative;
    const file = path.resolve(site, name);
    if (!file.startsWith(site + path.sep)) { res.writeHead(404); return res.end(); }
    try {
      const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.webp': 'image/webp' };
      const body = fs.readFileSync(file);
      res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }); res.end(body);
    } catch { res.writeHead(404); res.end(); }
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const browser = await launchChrome(pw), context = await newContext(browser);
  try {
    const page = await context.newPage(), errors = [], missing = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('favicon.ico')) missing.push(r.url()); });
    const base = `http://localhost:${server.address().port}${prefix}`;
    await openOn(page, base + '?demo=1');
    assert.ok(await until(page, '#app:not(.hide):not(.loading) .kpi'));
    assert.equal(await sameState(page), true);
    assert.equal(await page.locator('#app .brand h1').innerText(), 'Salesforce Order Management Operations Console');
    assert.match(await page.title(), /^Salesforce Order Management Operations Console$/);
    assert.doesNotMatch(await page.locator('body').innerText(), /\bSOM\b|Command Center/);
    assert.equal(await page.evaluate(async () => (await import(new URL('om-config.js', document.baseURI).href)).CONFIG.clientId), 'fixture');
    assert.deepEqual(errors, []); assert.deepEqual(missing, []);
  } finally {
    await context.close(); await browser.close();
    await new Promise((resolve) => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true });
  }
});
