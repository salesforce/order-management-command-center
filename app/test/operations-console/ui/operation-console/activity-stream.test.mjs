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
 * Console Activity stream
 *
 * Purpose
 *   The Activity stream is the console's list of what changed lately: five tabs (Orders, Fulfillment, Shipments, Returns, Cases),
 *   each its own kind of record with its own columns, and every row opens that record. The test loads the console on sample data
 *   and checks each tab's columns and rows against the sample data, that rows open the right drawer with the mouse and the
 *   keyboard, that the chosen tab survives a range change, and that the panel passes the accessibility audit.
 *   (kpis-range.test.mjs checks the stream's tab counts and row counts for every range, and scrolling; this one reads the rows.)
 *
 * Steps
 *   1. Open /?demo=1 and wait for the KPI cards.
 *   2. Click each tab in turn (Orders, Fulfillment, Shipments, Returns, Cases) and read its heading, columns and rows.
 *   3. On each tab, click the first row, read the drawer, press Escape. Then do the same from the keyboard: Enter on a tab,
 *      Enter on a row, Escape, then Space on a row.
 *   4. Choose the Fulfillment tab, then the 7 days range.
 *   5. On every tab, scroll the panel with the mouse wheel to its last row, then return to the top and focus the last row.
 *   6. Run app/tools/a11y-audit.js on the panel for every tab.
 *
 * Assertions
 *   - Panel: the heading is "Activity stream", the subtitle names the range, there are five tabs with their counts, and exactly one
 *     (the clicked one) is pressed.
 *   - Columns: each tab has its own, in order, ending in Updated; the number columns (Total, Value) are right-aligned.
 *   - Rows: each tab lists every record the sample data has for it (50 at most), in the data's order, and every cell is what the
 *     data holds: number, status, customer, channel, money, location, ship-to, carrier and tracking, delivery (ETA or Delivered),
 *     subject, type and origin, order. Updated reads "now" or "N m/h/d ago" and never goes down the list: newest first.
 *   - Rows are focusable (tabindex 0) and carry the record's Id.
 *   - Opening: the first row of each tab opens a drawer of its kind (Order Summary, Fulfillment Order, Shipment, Return Order,
 *     Case) titled with the row's number; Escape closes it and focus is back on the row. Enter and Space on a row open it too;
 *     Enter on a tab pressed selects it and keeps focus on it.
 *   - Range: after the 7 days range the Fulfillment tab is still the pressed one, its rows are the 7 days' sample data, and the
 *     other tabs' counts changed with it.
 *   - Scrolling (window fixed at 1440x900): every tab has more rows than fit, so the panel overflows; the wheel takes it to the end,
 *     where the last row is the last record of the sample data and lies fully inside the panel; the column headings stay pinned
 *     to the top of the panel the whole way; and focusing the last row from the top scrolls it into view.
 *   - Accessibility: a11yAudit() on the panel reports nothing, for every tab.
 *   - The page never throws, calls /api/ or sends a non-GET.
 *
 * Expected values are built from demoData(), not typed in, so editing the sample data doesn't break the test.
 *
 * Not covered: the highlight a row gets when a refresh brings it in new (it needs a second payload and the animation is off in
 * tests), and an org that has no such object or returns an error (the demo never does).
 *   node --test app/test/operations-console/ui/operation-console/activity-stream.test.mjs     (window, video and server are set for all UI tests in browser-kit.mjs)
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { demoData } from "../../../../public/operations-console/console-demo.js";
import { RANGE_LABEL } from "../../../../public/operations-console/console-labels.js";
import { UI, WIDE, loadPlaywright, openSession, until } from "../../../../tools/browser-kit.mjs";

const pw = await loadPlaywright();
const AUDIT = fileURLToPath(new URL("../../../../tools/a11y-audit.js", import.meta.url));

const usd = (v) => Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const ship = (name, city, st) => [name, [city, st].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
const STREAM_ROWS = 50; // what a stream tab holds at most

// The tabs in the order the page shows them: the stream key in the data, the label, the columns, the drawer a row opens, and
// how a record becomes the cells of its row (the last column, Updated, is checked on its own).
const TABS = [
  { t: 'orders', key: 'stream', label: 'Orders', kind: 'Order Summary', number: (r) => r.OrderNumber, num: 4,
    head: ['Order', 'Status', 'Customer', 'Channel', 'Total', 'Updated'],
    cells: (r) => [r.OrderNumber, r.Status, r.Account?.Name || '', r.SalesChannel?.SalesChannelName || '', usd(r.GrandTotalAmount)] },
  { t: 'fo', key: 'foStream', label: 'Fulfillment', kind: 'Fulfillment Order', number: (r) => r.FulfillmentOrderNumber,
    head: ['Fulfillment order', 'Status', 'From', 'Ship to', 'Order', 'Updated'],
    cells: (r) => [r.FulfillmentOrderNumber, r.Status, r.FulfilledFromLocation?.Name || '', ship(r.FulfilledToName, r.FulfilledToCity, r.FulfilledToState), r.OrderSummary?.OrderNumber || ''] },
  { t: 'sh', key: 'shStream', label: 'Shipments', kind: 'Shipment', number: (r) => r.ShipmentNumber,
    head: ['Shipment', 'Status', 'Carrier · tracking', 'Ship to', 'Delivery', 'Updated'],
    // The delivery date depends on the day the page runs, so only its kind is fixed here: Delivered or ETA, then a month and a day.
    cells: (r) => [r.ShipmentNumber, r.Status, `${r.Provider || ''} ${r.TrackingNumber || ''}`.trim(), ship(r.ShipToName, r.ShipToCity, r.ShipToState),
      r.ActualDeliveryDate ? /^Delivered [A-Z][a-z]{2} \d{1,2}$/ : r.ExpectedDeliveryDate ? /^ETA [A-Z][a-z]{2} \d{1,2}$/ : ''] },
  { t: 'ro', key: 'roStream', label: 'Returns', kind: 'Return Order', number: (r) => r.ReturnOrderNumber, num: 4,
    head: ['Return', 'Status', 'Customer', 'Order', 'Value', 'Updated'],
    cells: (r) => [r.ReturnOrderNumber, r.Status, r.Account?.Name || '', r.OrderSummary?.OrderNumber || '', usd(r.GrandTotalAmount)] },
  { t: 'cs', key: 'caseStream', label: 'Cases', kind: 'Case', number: (r) => r.CaseNumber,
    head: ['Case', 'Status', 'Subject', 'Type · origin', 'Order', 'Updated'],
    cells: (r) => [`${r.CaseNumber}${r.Priority === 'High' ? ' · High' : ''}`, r.Status, r.Subject || '', [r.Type, r.Origin].filter(Boolean).join(' · '), r.OrderSummary?.OrderNumber || ''] },
];
const rowsOf = (data, tab) => data[tab.key].data.slice(0, STREAM_ROWS);

// Reads the panel off the page: heading, subtitle, tabs, the open tab's columns, and each row's id, tabindex, cells and Updated.
const read = (page) => page.evaluate(() => {
  const text = (e) => e.textContent.replace(/\s+/g, ' ').trim();
  const zone = document.querySelector('#stream').closest('.zone');
  return {
    heading: text(zone.querySelector('h2').firstChild),
    sub: text(document.querySelector('#stSub')),
    tabs: [...document.querySelectorAll('#stTabs button')].map((b) => ({ text: text(b), pressed: b.getAttribute('aria-pressed') })),
    head: [...document.querySelectorAll('#stream thead th')].map((th) => ({ text: text(th), right: th.classList.contains('num') })),
    rows: [...document.querySelectorAll('#stream tbody tr')].map((tr) => ({
      id: tr.dataset.id, tabindex: tr.getAttribute('tabindex'),
      cells: [...tr.children].map((td) => ({ text: text(td), right: td.classList.contains('num') })),
    })),
  };
});
// "now", "7m ago", "3h ago", "2d ago" as minutes.
const AGO = /^(?:now|(\d+)([mhd]) ago)$/;
const minutes = (s) => { const m = AGO.exec(s); return m ? (m[1] ? Number(m[1]) * { m: 1, h: 60, d: 1440 }[m[2]] : 0) : NaN; };

const drawerTitle = (page) => page.locator('#drawer').evaluate((d) => d.innerText.replace(/\s+/g, ' ').trim());
const focused = (page) => page.evaluate(() => ({ tag: document.activeElement.tagName, id: document.activeElement.dataset.id || null, t: document.activeElement.dataset.t || null }));
const open = (page) => page.locator('#drawer').evaluate((d) => !d.classList.contains('hide'));

async function openTab(step, page, tab) {
  await step(() => page.locator(`#stTabs button[data-t="${tab.t}"]`).click());
  await until(page, `#stTabs button[data-t="${tab.t}"][aria-pressed="true"]`);
}

test('Activity stream: every tab has its own columns and rows from the sample data', { skip: UI.skip(pw) }, async () => {
  const s = await openSession(pw, 'console-activity-stream', { viewport: WIDE });
  const { page, step } = s;
  try {
    assert.ok(await until(page, '#app:not(.hide) #kpis > .kpi', 15000), 'the Console drew');
    const data = demoData('90d');
    const counts = TABS.map((tab) => `${tab.label} ${rowsOf(data, tab).length}${data[tab.key].data.length >= STREAM_ROWS ? '+' : ''}`);

    for (const tab of TABS) {
      await openTab(step, page, tab);
      const got = await read(page), rows = rowsOf(data, tab);
      assert.equal(got.heading, 'Activity stream');
      assert.equal(got.sub, `updated ${RANGE_LABEL['90d']}, newest first`);
      assert.deepEqual(got.tabs.map((b) => b.text), counts, `${tab.label}: the tabs and their counts`);
      assert.deepEqual(got.tabs.map((b) => b.pressed), TABS.map((o) => String(o === tab)), `${tab.label}: only this tab is pressed`);
      assert.deepEqual(got.head.map((h) => h.text), tab.head.map((h) => h), `${tab.label}: columns`);
      assert.deepEqual(got.head.map((h) => h.right), tab.head.map((_, i) => i === tab.num), `${tab.label}: which column is right-aligned`);

      assert.equal(got.rows.length, rows.length, `${tab.label}: one row for each record`);
      got.rows.forEach((row, i) => {
        assert.equal(row.id, rows[i].Id, `${tab.label} row ${i + 1}: the record's Id`);
        assert.equal(row.tabindex, '0', `${tab.label} row ${i + 1}: reachable by keyboard`);
        assert.equal(row.cells.length, tab.head.length, `${tab.label} row ${i + 1}: a cell for each column`);
        tab.cells(rows[i]).forEach((want, c) => {
          const have = row.cells[c].text;
          if (want instanceof RegExp) assert.match(have, want, `${tab.label} row ${i + 1}, ${tab.head[c]}`);
          else assert.equal(have, want, `${tab.label} row ${i + 1}, ${tab.head[c]}`);
        });
        assert.equal(row.cells[row.cells.length - 1].right, false, `${tab.label} row ${i + 1}: Updated is left-aligned`);
        if (tab.num !== undefined) assert.equal(row.cells[tab.num].right, true, `${tab.label} row ${i + 1}: ${tab.head[tab.num]} is right-aligned`);
      });
      // Newest first: how long ago never goes down the list.
      const ago = got.rows.map((r) => minutes(r.cells[r.cells.length - 1].text));
      assert.ok(ago.every((m) => !Number.isNaN(m)), `${tab.label}: Updated reads "now" or "N m/h/d ago": ${got.rows.map((r) => r.cells[r.cells.length - 1].text).join(', ')}`);
      assert.deepEqual(ago, [...ago].sort((a, b) => a - b), `${tab.label}: newest first`);
    }
    assert.deepEqual(s.problems, []);
  } finally { await s.close(); }
});

test('Activity stream: rows open their record with the mouse and the keyboard', { skip: UI.skip(pw) }, async () => {
  const s = await openSession(pw, 'console-activity-stream-open', { viewport: WIDE });
  const { page, step } = s;
  try {
    assert.ok(await until(page, '#app:not(.hide) #kpis > .kpi', 15000), 'the Console drew');
    const data = demoData('90d');
    const row = (tab, i = 0) => page.locator('#stream tbody tr[data-id]').nth(i);

    // The mouse: the first row of every tab opens a drawer of its kind, titled with its number; Escape closes it, focus returns.
    for (const tab of TABS) {
      await openTab(step, page, tab);
      const rec = rowsOf(data, tab)[0];
      assert.equal(await open(page), false, `${tab.label}: no drawer yet`);
      await step(() => row(tab).click());
      await until(page, '#drawer:not(.hide)');
      assert.match(await drawerTitle(page), new RegExp(`^${tab.kind} ${tab.number(rec)}\\b`), `${tab.label}: the drawer is for ${tab.kind} ${tab.number(rec)}`);
      await step(() => page.keyboard.press('Escape'));
      assert.equal(await open(page), false, `${tab.label}: Escape closes the drawer`);
      assert.deepEqual(await focused(page), { tag: 'TR', id: rec.Id, t: null }, `${tab.label}: focus is back on the row`);
    }

    // The keyboard, on the Fulfillment tab: Enter on a tab selects it and keeps focus there; Enter and Space on a row open it.
    const fo = TABS[1], recs = rowsOf(data, fo);
    await step(() => page.locator('#stTabs button[data-t="orders"]').click());
    await step(() => page.locator('#stTabs button[data-t="fo"]').focus());
    await step(() => page.keyboard.press('Enter'));
    await until(page, '#stTabs button[data-t="fo"][aria-pressed="true"]');
    assert.deepEqual(await focused(page), { tag: 'BUTTON', id: null, t: 'fo' }, 'Enter on a tab keeps focus on it');

    for (const [key, i] of [['Enter', 0], [' ', 1]]) {
      await step(() => row(fo, i).focus());
      await step(() => page.keyboard.press(key));
      await until(page, '#drawer:not(.hide)');
      assert.match(await drawerTitle(page), new RegExp(`^Fulfillment Order ${recs[i].FulfillmentOrderNumber}\\b`), `${key === ' ' ? 'Space' : key} opens row ${i + 1}`);
      await step(() => page.keyboard.press('Escape'));
      assert.deepEqual(await focused(page), { tag: 'TR', id: recs[i].Id, t: null }, `row ${i + 1}: focus is back on it`);
    }
    assert.deepEqual(s.problems, []);
  } finally { await s.close(); }
});

test('Activity stream: the chosen tab stays through a range change', { skip: UI.skip(pw) }, async () => {
  const s = await openSession(pw, 'console-activity-stream-range', { viewport: WIDE });
  const { page, step } = s;
  try {
    assert.ok(await until(page, '#app:not(.hide) #kpis > .kpi', 15000), 'the Console drew');
    const fo = TABS[1], want = demoData('7d');
    await openTab(step, page, fo);
    await step(() => page.locator('#range button[data-v="7d"]').click());
    const sub = `updated ${RANGE_LABEL['7d']}, newest first`;
    for (const end = Date.now() + 5000; Date.now() < end && (await read(page)).sub !== sub;) await page.waitForTimeout(50);
    const got = await read(page);
    assert.equal(got.sub, sub, 'the subtitle follows the range');
    assert.deepEqual(got.tabs.map((b) => b.pressed), TABS.map((o) => String(o === fo)), 'Fulfillment is still the pressed tab');
    assert.deepEqual(got.head.map((h) => h.text), fo.head, 'its columns are still Fulfillment\'s');
    assert.deepEqual(got.rows.map((r) => r.id), rowsOf(want, fo).map((r) => r.Id), 'its rows are the 7 days\' sample data');
    assert.deepEqual(got.tabs.map((b) => b.text), TABS.map((tab) => `${tab.label} ${rowsOf(want, tab).length}${want[tab.key].data.length >= STREAM_ROWS ? '+' : ''}`), 'every tab\'s count follows the range');
    assert.deepEqual(s.problems, []);
  } finally { await s.close(); }
});

// The panel is `#stream`, the scrolling box. Where its rows and headings are, against the box, in the page's pixels.
const geometry = (page) => page.locator('#stream').evaluate((box) => {
  const b = box.getBoundingClientRect(), last = [...box.querySelectorAll('tbody tr')].pop().getBoundingClientRect(), th = box.querySelector('th').getBoundingClientRect();
  return { top: box.scrollTop, over: box.scrollHeight > box.clientHeight + 1, atEnd: box.scrollTop + box.clientHeight >= box.scrollHeight - 1,
    lastInside: last.top >= b.top - 1 && last.bottom <= b.bottom + 1, headGap: Math.abs(th.top - b.top) };
});

test('Activity stream: every tab scrolls to its last row, with the headings pinned', { skip: UI.skip(pw) }, async () => {
  const s = await openSession(pw, 'console-activity-stream-scroll', { viewport: WIDE });
  const { page, step } = s;
  try {
    assert.ok(await until(page, '#app:not(.hide) #kpis > .kpi', 15000), 'the Console drew');
    const data = demoData('90d'), box = page.locator('#stream');
    for (const tab of TABS) {
      await openTab(step, page, tab);
      const rows = rowsOf(data, tab), last = rows[rows.length - 1];
      assert.ok(rows.length > 3, `${tab.label}: the sample data has more rows than fit`);
      // The panel keeps its scroll position when the tab changes (the page doesn't reset it), so start each tab from the top.
      await box.evaluate((e) => { e.scrollTop = 0; });
      const before = await geometry(page);
      assert.equal(before.over, true, `${tab.label}: ${rows.length} rows overflow the panel`);

      await box.hover();
      await step(() => page.mouse.wheel(0, 5000));
      for (const end = Date.now() + 3000; Date.now() < end && !(await geometry(page)).atEnd;) await page.waitForTimeout(50);
      const end = await geometry(page);
      assert.equal(end.atEnd, true, `${tab.label}: the wheel reaches the end`);
      assert.equal(end.lastInside, true, `${tab.label}: the last row is fully inside the panel`);
      assert.ok(end.headGap <= 1, `${tab.label}: the headings stay pinned to the top (${end.headGap}px off)`);
      assert.equal(await page.locator('#stream tbody tr').last().getAttribute('data-id'), last.Id, `${tab.label}: the last row is the last record`);

      // From the top again, the keyboard: focusing the last row brings it into view.
      await box.evaluate((e) => { e.scrollTop = 0; });
      assert.equal((await geometry(page)).lastInside, false, `${tab.label}: back at the top the last row is out of sight`);
      await page.locator('#stream tbody tr').last().focus();
      const focus = await geometry(page);
      assert.equal(focus.lastInside, true, `${tab.label}: focusing the last row scrolls it into view`);
      assert.ok(focus.headGap <= 1, `${tab.label}: the headings are still pinned after the focus`);
    }
    assert.deepEqual(s.problems, []);
  } finally { await s.close(); }
});

test('Activity stream: no accessibility findings on any tab', { skip: UI.skip(pw) }, async () => {
  const s = await openSession(pw, 'console-activity-stream-a11y', { viewport: WIDE });
  const { page, step } = s;
  try {
    assert.ok(await until(page, '#app:not(.hide) #kpis > .kpi', 15000), 'the Console drew');
    await page.addScriptTag({ path: AUDIT });
    for (const tab of TABS) {
      await openTab(step, page, tab);
      const found = await page.evaluate(() => window.a11yAudit(document.querySelector('#stream').closest('.zone')));
      // The page's one h1 is outside the panel, so a check of the panel alone can't see it.
      const issues = Object.fromEntries(Object.entries(found.issues).filter(([rule]) => rule !== 'heading-h1-missing'));
      assert.deepEqual(issues, {}, `${tab.label}: ${JSON.stringify(issues).slice(0, 600)}`);
    }
    assert.deepEqual(s.problems, []);
  } finally { await s.close(); }
});
