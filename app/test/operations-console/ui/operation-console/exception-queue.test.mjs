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
 * Console Exception queue
 *
 * Purpose
 *   The Exception queue lists the open process exceptions as rows, with one tab for All and one for each category. A row opens the
 *   exception in the side panel. The test loads the console on sample data and checks the panel's labels (heading, subtitle, tabs,
 *   the parts of every row), that the list scrolls to its last row on every tab, and that the side panel opens from a row and
 *   closes again on every tab, however it is closed. What is inside the side panel is not checked here (the drawers have their
 *   own tests). kpis-range.test.mjs checks the subtitle, tab counts and row counts for every range.
 *
 * Steps
 *   1. Open /?demo=1 and wait for the KPI cards.
 *   2. Click each tab in turn (All, then each category) and read the heading, subtitle, tabs and rows.
 *   3. On each tab, wheel-scroll the list to its last row, then back to the top, then focus the last row.
 *   4. On each tab, click the first row and close the side panel with its ✕ button; do it again closing with Escape, and again
 *      closing with a click on the dimmed page behind it.
 *   5. On one tab, open a row with Enter, close it, open the next with Space. Select a tab with Enter.
 *   6. Run app/tools/a11y-audit.js on the panel.
 *
 * Assertions
 *   - Labels: the heading is "Exception queue"; the subtitle is "N open · raised <range>"; the tabs are All and then each category
 *     in the order the data first has it, each as "<name> <count>", the counts adding up to All's; only the chosen tab is pressed.
 *   - Rows: each tab lists exactly its category's exceptions (All lists them all), in the data's order, and each row is labelled
 *     with its severity, "<Category> · <order number>", its message, its status and how long ago it was raised ("now", "Nm/h/d
 *     ago", never going down the list: newest first). Rows are focusable, named as buttons, and carry the record's Id.
 *   - Scrolling (window fixed at 1440x900): the list takes the wheel to its last row, which lies fully inside the list, while the
 *     tabs above stay where they are; focusing the last row from the top scrolls it into view. A tab with too few rows to
 *     overflow shows them all.
 *   - Side panel: on every tab a click on the first row opens it with the dimmed page behind it; ✕, Escape and a click on the
 *     dimmed page each close it and take the dimming away; focus is back on the row, and the chosen tab is still the chosen tab.
 *   - Keyboard: Enter and Space on a row open the side panel; Enter on a tab selects it and keeps focus on it.
 *   - Accessibility: a11yAudit() on the panel reports nothing, on every tab.
 *   - The page never throws, calls /api/ or sends a non-GET.
 *
 * Expected values are built from demoData(), not typed in, so editing the sample data doesn't break the test.
 *
 * Not covered: anything inside the side panel; the panel with no exceptions ("No open exceptions.") or with an error, which the
 * sample data never produces; how it looks in each theme (theme.test.mjs).
 *   node --test app/test/operations-console/ui/operation-console/exception-queue.test.mjs     (window, video and server are set for all UI tests in browser-kit.mjs)
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { demoData } from "../../../../public/operations-console/console-demo.js";
import { RANGE_LABEL } from "../../../../public/operations-console/console-labels.js";
import { UI, WIDE, loadPlaywright, openSession, until } from "../../../../tools/browser-kit.mjs";

const pw = await loadPlaywright();
const AUDIT = fileURLToPath(new URL("../../../../tools/a11y-audit.js", import.meta.url));

// The tabs as the page builds them: All, then each category in the order the data first has it.
const tabsOf = (list) => {
  const cat = (e) => e.Category || 'Uncategorized';
  return ['All', ...new Set(list.map(cat))].map((name) => ({ name, rows: name === 'All' ? list : list.filter((e) => cat(e) === name) }));
};

// Reads the panel off the page: heading, subtitle, tabs, and each row's id, role, tabindex and labels.
const read = (page) => page.evaluate(() => {
  const text = (e) => e.textContent.replace(/\s+/g, ' ').trim();
  return {
    heading: text(document.querySelector('#exTabs').closest('.zone').querySelector('h2').firstChild),
    sub: text(document.querySelector('#exSub')),
    tabs: [...document.querySelectorAll('#exTabs button')].map((b) => ({ text: text(b), name: b.dataset.c, pressed: b.getAttribute('aria-pressed') })),
    rows: [...document.querySelectorAll('#exList .item')].map((el) => ({
      id: el.dataset.id, role: el.getAttribute('role'), tabindex: el.getAttribute('tabindex'),
      severity: text(el.querySelector('.sev')), title: text(el.querySelector('.t')), message: text(el.querySelector('.s')),
      status: text(el.querySelector('.pill')), ago: text(el.querySelector('.pill').nextElementSibling),
    })),
  };
});
// "now", "7m ago", "3h ago", "2d ago" as minutes.
const AGO = /^(?:now|(\d+)([mhd]) ago)$/;
const minutes = (s) => { const m = AGO.exec(s); return m ? (m[1] ? Number(m[1]) * { m: 1, h: 60, d: 1440 }[m[2]] : 0) : NaN; };

async function openTab(step, page, name) {
  await step(() => page.locator(`#exTabs button[data-c="${name}"]`).click());
  await until(page, `#exTabs button[data-c="${name}"][aria-pressed="true"]`);
}
const rowAt = (page, i = 0) => page.locator('#exList .item[data-id]').nth(i);
const isOpen = (page) => page.locator('#drawer').evaluate((d) => !d.classList.contains('hide'));
const dimmed = (page) => page.locator('#scrim').evaluate((s) => !s.classList.contains('hide'));
const focused = (page) => page.evaluate(() => ({ id: document.activeElement.dataset.id || null, c: document.activeElement.dataset.c || null }));
// Opens a row's side panel and waits until it has drawn (its ✕ is there), so a close never races its content.
async function openRow(step, page, i = 0, how = 'click') {
  assert.equal(await isOpen(page), false, 'no side panel yet');
  if (how === 'click') await step(() => rowAt(page, i).click());
  else { await step(() => rowAt(page, i).focus()); await step(() => page.keyboard.press(how)); }
  await until(page, '#drawer:not(.hide) #closeDrawer');
  assert.equal(await dimmed(page), true, 'the page behind is dimmed');
}

test('Exception queue: labels of the heading, tabs and rows, on every tab', { skip: UI.skip(pw) }, async () => {
  const s = await openSession(pw, 'console-exception-queue', { viewport: WIDE });
  const { page, step } = s;
  try {
    assert.ok(await until(page, '#app:not(.hide) #kpis > .kpi', 15000), 'the Console drew');
    const list = demoData('90d').exceptions.data, tabs = tabsOf(list);
    assert.ok(tabs.length > 2, 'the sample data has more than one category');
    assert.equal(tabs[0].rows.length, tabs.slice(1).reduce((sum, t) => sum + t.rows.length, 0), 'the categories add up to All');

    for (const tab of tabs) {
      await openTab(step, page, tab.name);
      const got = await read(page);
      assert.equal(got.heading, 'Exception queue');
      assert.equal(got.sub, `${list.length} open · raised ${RANGE_LABEL['90d']}`);
      assert.deepEqual(got.tabs.map((b) => b.text), tabs.map((t) => `${t.name} ${t.rows.length}`), `${tab.name}: the tabs and their counts`);
      assert.deepEqual(got.tabs.map((b) => b.pressed), tabs.map((t) => String(t === tab)), `${tab.name}: only this tab is pressed`);

      assert.deepEqual(got.rows.map((r) => r.id), tab.rows.map((e) => e.Id), `${tab.name}: the category's exceptions, in the data's order`);
      got.rows.forEach((row, i) => {
        const e = tab.rows[i], where = `${tab.name} row ${i + 1}`;
        assert.equal(row.role, 'button', `${where}: named as a button`);
        assert.equal(row.tabindex, '0', `${where}: reachable by keyboard`);
        assert.equal(row.severity, e.Severity, `${where}: severity`);
        assert.equal(row.title, `${e.Category} · ${e.OrderSummary.OrderNumber}`, `${where}: category and order`);
        assert.equal(row.message, e.Message, `${where}: message`);
        assert.equal(row.status, e.Status, `${where}: status`);
      });
      // Newest first: how long ago never goes down the list.
      const ago = got.rows.map((r) => minutes(r.ago));
      assert.ok(ago.every((m) => !Number.isNaN(m)), `${tab.name}: the age reads "now" or "N m/h/d ago": ${got.rows.map((r) => r.ago).join(', ')}`);
      assert.deepEqual(ago, [...ago].sort((a, b) => a - b), `${tab.name}: newest first`);
    }
    assert.deepEqual(s.problems, []);
  } finally { await s.close(); }
});

// `#exList` is the scrolling box; the tab strip sits above it. Where the rows and the tabs are, against the box, in the page's pixels.
const geometry = (page) => page.locator('#exList').evaluate((box) => {
  const b = box.getBoundingClientRect(), last = [...box.querySelectorAll('.item')].pop().getBoundingClientRect();
  return { top: box.scrollTop, over: box.scrollHeight > box.clientHeight + 1, atEnd: box.scrollTop + box.clientHeight >= box.scrollHeight - 1,
    lastInside: last.top >= b.top - 1 && last.bottom <= b.bottom + 1, tabsY: document.querySelector('#exTabs').getBoundingClientRect().top };
});

test('Exception queue: every tab scrolls to its last row, with the tabs staying put', { skip: UI.skip(pw) }, async () => {
  const s = await openSession(pw, 'console-exception-queue-scroll', { viewport: WIDE });
  const { page, step } = s;
  try {
    assert.ok(await until(page, '#app:not(.hide) #kpis > .kpi', 15000), 'the Console drew');
    const tabs = tabsOf(demoData('90d').exceptions.data), box = page.locator('#exList');
    for (const tab of tabs) {
      await openTab(step, page, tab.name);
      const last = tab.rows[tab.rows.length - 1];
      await box.evaluate((e) => { e.scrollTop = 0; }); // the list may keep its scroll position when the tab changes
      const before = await geometry(page);
      if (tab.name === 'All') assert.equal(before.over, true, `All: ${tab.rows.length} rows overflow the list`);

      await box.hover();
      await step(() => page.mouse.wheel(0, 5000));
      for (const end = Date.now() + 3000; Date.now() < end && !(await geometry(page)).atEnd;) await page.waitForTimeout(50);
      const end = await geometry(page);
      assert.equal(end.atEnd, true, `${tab.name}: the wheel reaches the end`);
      assert.equal(end.lastInside, true, `${tab.name}: the last row is fully inside the list`);
      assert.equal(end.tabsY, before.tabsY, `${tab.name}: the tabs stay where they were`);
      assert.equal(await page.locator('#exList .item').last().getAttribute('data-id'), last.Id, `${tab.name}: the last row is the last exception`);

      // From the top again, the keyboard: focusing the last row brings it into view (a list that fits shows it already).
      await box.evaluate((e) => { e.scrollTop = 0; });
      if (before.over) assert.equal((await geometry(page)).lastInside, false, `${tab.name}: back at the top the last row is out of sight`);
      await page.locator('#exList .item').last().focus();
      assert.equal((await geometry(page)).lastInside, true, `${tab.name}: focusing the last row scrolls it into view`);
    }
    assert.deepEqual(s.problems, []);
  } finally { await s.close(); }
});

test('Exception queue: the side panel opens from a row and closes again on every tab', { skip: UI.skip(pw) }, async () => {
  const s = await openSession(pw, 'console-exception-queue-open', { viewport: WIDE });
  const { page, step } = s;
  try {
    assert.ok(await until(page, '#app:not(.hide) #kpis > .kpi', 15000), 'the Console drew');
    const tabs = tabsOf(demoData('90d').exceptions.data);
    const CLOSERS = [
      ['its ✕ button', () => page.locator('#closeDrawer').click()],
      ['Escape', () => page.keyboard.press('Escape')],
      ['a click on the dimmed page', () => page.locator('#scrim').click({ position: { x: 20, y: 20 } })],
    ];

    for (const tab of tabs) {
      await openTab(step, page, tab.name);
      for (const [how, close] of CLOSERS) {
        await openRow(step, page, 0);
        await step(close);
        const where = `${tab.name}, closed with ${how}`;
        assert.equal(await isOpen(page), false, `${where}: the side panel is gone`);
        assert.equal(await dimmed(page), false, `${where}: the page is no longer dimmed`);
        assert.deepEqual(await focused(page), { id: tab.rows[0].Id, c: null }, `${where}: focus is back on the row`);
        assert.equal(await page.locator(`#exTabs button[data-c="${tab.name}"]`).getAttribute('aria-pressed'), 'true', `${where}: the tab is still chosen`);
        assert.equal(await page.locator('#exList .item').count(), tab.rows.length, `${where}: the list is as it was`);
      }
    }

    // The keyboard, on the last category: Enter on a tab selects it and keeps focus there; Enter and Space on a row open it.
    const tab = tabs[tabs.length - 1];
    await step(() => page.locator('#exTabs button[data-c="All"]').click());
    await step(() => page.locator(`#exTabs button[data-c="${tab.name}"]`).focus());
    await step(() => page.keyboard.press('Enter'));
    await until(page, `#exTabs button[data-c="${tab.name}"][aria-pressed="true"]`);
    assert.deepEqual(await focused(page), { id: null, c: tab.name }, 'Enter on a tab keeps focus on it');
    for (const [key, i] of [['Enter', 0], [' ', 1]]) {
      await openRow(step, page, i, key);
      await step(() => page.keyboard.press('Escape'));
      assert.equal(await isOpen(page), false, `${key === ' ' ? 'Space' : key}: closed again`);
      assert.deepEqual(await focused(page), { id: tab.rows[i].Id, c: null }, `${key === ' ' ? 'Space' : key}: focus is back on row ${i + 1}`);
    }
    assert.deepEqual(s.problems, []);
  } finally { await s.close(); }
});

test('Exception queue: no accessibility findings on any tab', { skip: UI.skip(pw) }, async () => {
  const s = await openSession(pw, 'console-exception-queue-a11y', { viewport: WIDE });
  const { page, step } = s;
  try {
    assert.ok(await until(page, '#app:not(.hide) #kpis > .kpi', 15000), 'the Console drew');
    await page.addScriptTag({ path: AUDIT });
    for (const tab of tabsOf(demoData('90d').exceptions.data)) {
      await openTab(step, page, tab.name);
      const found = await page.evaluate(() => window.a11yAudit(document.querySelector('#exTabs').closest('.zone')));
      // The page's one h1 is outside the panel, so a check of the panel alone can't see it.
      const issues = Object.fromEntries(Object.entries(found.issues).filter(([rule]) => rule !== 'heading-h1-missing'));
      assert.deepEqual(issues, {}, `${tab.name}: ${JSON.stringify(issues).slice(0, 600)}`);
    }
    assert.deepEqual(s.problems, []);
  } finally { await s.close(); }
});
