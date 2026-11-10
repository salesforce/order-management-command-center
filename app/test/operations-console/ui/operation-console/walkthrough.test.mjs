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
/*
 * Operations Console walkthrough in demo mode
 *
 * Purpose
 *   One end-to-end pass over the Console the way a person uses it: open /?demo=1 in Chrome, click and type, and check what the page
 *   shows. It proves the page boots offline, the range buttons, map layers, keyboard focus, list tabs and drawers are wired, and it
 *   keeps a video of the run. Needs Playwright and a browser; without them the test skips.
 *
 * Steps
 *   1. Open /?demo=1 and wait for the KPI cards.
 *   2. Click the 7d range button.
 *   3. Click the Exceptions map layer.
 *   4. Focus a map location (Dallas DC) with the keyboard, press Enter, then Escape.
 *   5. Click the Payment tab of the Exception queue.
 *   6. Click the first exception row (the drawer opens), then press Escape.
 *   7. Click the first Activity stream row (the drawer opens), then press Escape.
 *
 * Assertions
 *   - The Console draws, and the first KPI card reads "Orders 312 last 90 days" (the default range).
 *   - After 7d it reads "Orders 24 last 7 days": the sample data follows the range.
 *   - The Exceptions layer's legend starts "Open process exceptions by bill-to state".
 *   - Enter on Dallas DC fills the focus card ("Dallas DC ... Open FOs 135").
 *   - The Payment tab lists as many rows as the 7d sample data has Payment exceptions (read from demoData, not typed in).
 *   - The exception row opens a "Process Exception PE-<n>" drawer; the stream row opens an "Order Summary <n>" drawer.
 *   - The page never throws, never calls /api/, and sends nothing but GETs.
 *
 * Running
 *   node --test app/test/operations-console/ui/operation-console/*.test.mjs       the video is app/artifact/ui-test-videos/console-walkthrough.webm
 *   HEADLESS=1 node --test ...                       the same without the visible browser window
 *   BASE_URL=http://localhost:5178 node --test ...   against the app you already run (node app/server.mjs)
 *   How it runs (window or not, video, server) is set for every UI test in UI / openSession in app/tools/browser-kit.mjs. The first
 *   run needs Playwright's browser and its small ffmpeg once: node <playwright-core>/cli.js install chromium ffmpeg
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoData } from "../../../../public/operations-console/console-demo.js";
import { UI, loadPlaywright, openSession, until } from "../../../../tools/browser-kit.mjs";

const pw = await loadPlaywright();

test('Operations Console walkthrough in demo mode', { skip: UI.skip(pw) }, async () => {
  const s = await openSession(pw, 'console-walkthrough');
  const { page, step } = s;
  const texts = (sel) => page.evaluate((q) => [...document.querySelectorAll(q)].map((e) => e.textContent.replace(/\s+/g, ' ').trim()), sel);
  const click = (sel, i = 0) => step(() => page.locator(sel).nth(i).click());

  try {
    assert.ok(await until(page, '#app:not(.hide) #kpis > *', 15000), 'the Console drew');
    await page.waitForTimeout(600);
    assert.equal(await page.locator('#app .brand h1').innerText(), 'Salesforce Order Management Operations Console');
    assert.equal(await page.title(), 'Salesforce Order Management Operations Console');
    assert.doesNotMatch(await page.locator('body').innerText(), /\bSOM\b|Command Center/);
    assert.equal((await texts('#kpis > *'))[0], 'Orders312last 90 days');

    await click('#range button[data-v="7d"]');
    assert.equal((await texts('#kpis > *'))[0], 'Orders24last 7 days'); // the sample data scales with the range

    await click('#layers button', 3); // Exceptions
    assert.match((await texts('#legend'))[0], /^Open process exceptions by bill-to state/);

    await step(() => page.locator('#map [data-node]').nth(1).focus());
    await step(() => page.keyboard.press('Enter')); // focus Dallas DC
    assert.match((await texts('#focus'))[0], /Dallas DC.*Open FOs135/);
    await step(() => page.keyboard.press('Escape'));

    await click('#exTabs button', 2); // Payment
    assert.equal((await texts('#exList .item')).length, demoData('7d').exceptions.data.filter((e) => e.Category === 'Payment').length); // 7d is the range chosen above
    await click('#exList .item[data-id]');
    assert.match((await texts('#drawer'))[0], /^Process ExceptionPE-\d+ /);
    await step(() => page.keyboard.press('Escape'));

    await click('#stream tbody tr[data-id]');
    assert.match((await texts('#drawer'))[0], /^Order Summary\d+ /);
    await step(() => page.keyboard.press('Escape'));

    assert.deepEqual(s.problems, []);
  } finally { await s.close(); }
});
