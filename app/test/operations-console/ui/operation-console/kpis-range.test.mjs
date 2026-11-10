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
 * Console panels follow the range buttons
 *
 * Purpose
 *   In demo mode every panel of the Operations Console has to react when the time range changes. The test clicks each range and
 *   checks the panels against what the sample data holds for it. It opens no record: the side panel (the drawer) stays closed.
 *
 * Steps
 *   1. Open /?demo=1, wait for the KPI cards, and choose the map's Demand layer. Check the default (90 days).
 *   2. Click each range out of order (1y, 7d, today, 6m, 30d, 90d), so a number has to go down as well as up.
 *   3. After each click, wait for the panels to redraw, read them off the page, and wheel-scroll the Exception queue and the
 *      Activity stream.
 *
 * Assertions, for every range
 *   - KPI cards: label, value and the line under it (Orders, Order value, Open exceptions, Waiting, Stuck, Payment holds, Returns).
 *   - Map Demand layer: the legend rows and counts, the "+N more states" line, and one bubble per state.
 *   - Exception queue: subtitle, every tab and its count, and the rows; one row per open exception.
 *   - Activity stream: subtitle, the five tab counts (50 at most), and the rows; as many as the range's orders, 50 at most.
 *   - Status board: subtitle and both stacks (Order Summaries, Fulfillment Orders): total, the numbers under the bar, the bar's
 *     pieces (hover text and width). The numbers add up to the total, Orders matches the Orders card, Fulfillment is positive
 *     and no more than the Orders card.
 *   - Change: Orders, Order value, Open exceptions, Payment holds and Returns differ from the previous range; so do the Demand
 *     rows, the exception row count and both board stacks. Waiting and Stuck do not change (they are right-now counts).
 *   - Scrolling (window fixed at 1440x900): a panel with more than 3 rows overflows and the wheel scrolls it to its last row; one
 *     with 3 or fewer does not overflow.
 *   - Exactly one range button is pressed, the drawer is closed, and the page never throws, calls /api/ or sends a non-GET.
 *
 * Expected values are built from demoData(), not typed in, so editing the sample data doesn't break the test; a panel that
 * doesn't update, or updates wrongly, does.
 *   node --test app/test/operations-console/ui/operation-console/kpis-range.test.mjs     (window, video and server are set for all UI tests in browser-kit.mjs)
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoData } from "../../../../public/operations-console/console-demo.js";
import { RANGE_LABEL } from "../../../../public/operations-console/console-labels.js";
import { UI, WIDE, loadPlaywright, openSession, until } from "../../../../tools/browser-kit.mjs";

const pw = await loadPlaywright();

const n = (v) => Number(v).toLocaleString('en-US');
const usd = (v) => Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const biggest = (rows) => rows.map((r) => [r.key, r.n]).sort(([, x], [, y]) => y - x); // biggest first; a tie keeps the data's order, as the page's legend does
const STREAM_ROWS = 50; // what a stream tab holds at most

// What renderKpis() in console-map-view.js writes for a range's data: label, value and the line under it, in card order.
function kpiCards(d, when) {
  const k = d.kpis.data;
  return [
    ['Orders', n(k.orders), when],
    ['Order value', usd(k.value), `${usd(k.value / k.orders)} average`],
    ['Open exceptions', n(k.openExceptions), `raised ${when}`],
    ['Waiting on you', n(k.waiting), 'agent proposals to decide'],
    ['Stuck > 2h', n(k.stuck), 'Allocated/Pickpack · right now'],
    ['Payment holds', n(k.paymentHolds), `open, raised ${when}`],
    ['Returns', n(k.returns), k.returns ? `${usd(k.returnValue)} · ${when}` : `none ${when}`],
  ];
}
// Everything the page should show for a range, in the shape `read()` below gives it back from the page.
function expected(range) {
  const d = demoData(range), when = RANGE_LABEL[range], states = biggest(d.demand.data), ex = d.exceptions.data;
  const tab = (rows) => `${rows.length}${rows.length === STREAM_ROWS ? '+' : ''}`;
  const board = (rows) => {
    const total = rows.reduce((s, r) => s + r.n, 0), sorted = biggest(rows);
    return { total: n(total), keys: Object.fromEntries(sorted.map(([k, v]) => [k, n(v)])),
      segments: sorted.map(([k, v]) => `${k}: ${n(v)} (${Math.round((v / total) * 100)}%)`), weights: sorted.map(([, v]) => String(v)) }; // the bar's pieces: tooltip and width share
  };
  return {
    cards: kpiCards(d, when),
    demand: { rows: states.slice(0, 10).map(([k, v]) => [k, n(v)]), more: states.length > 10 ? `+${states.length - 10} more states` : null, bubbles: states.length },
    exceptions: { sub: `${ex.length} open · raised ${when}`, tabs: ['All', ...new Set(ex.map((e) => e.Category))].map((c) => `${c} ${c === 'All' ? ex.length : ex.filter((e) => e.Category === c).length}`), rows: ex.length },
    stream: { sub: `updated ${when}, newest first`, tabs: [`Orders ${tab(d.stream.data)}`, `Fulfillment ${tab(d.foStream.data)}`, `Shipments ${tab(d.shStream.data)}`, `Returns ${tab(d.roStream.data)}`, `Cases ${tab(d.caseStream.data)}`], rows: d.stream.data.length },
    board: { sub: when, orders: board(d.statusBoard.data.orders), fulfillment: board(d.statusBoard.data.fulfillment) },
  };
}

// The same, read off the page.
const read = (page) => page.evaluate(() => {
  const text = (e) => e.textContent.replace(/\s+/g, ' ').trim();
  const stack = (el) => ({ total: text(el.querySelector('h3 b')), segments: [...el.querySelectorAll('.stack i')].map((i) => i.title), weights: [...el.querySelectorAll('.stack i')].map((i) => i.style.flexGrow), keys: Object.fromEntries([...el.querySelectorAll('.keys span')].map((s) => [[...s.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join('').trim(), text(s.querySelector('b'))])) });
  const sb = [...document.querySelectorAll('#board .sb > div')];
  return {
    cards: [...document.querySelectorAll('#kpis > .kpi')].map((c) => ['.l', '.v', '.s'].map((q) => text(c.querySelector(q)))),
    demand: {
      rows: [...document.querySelectorAll('#legend .row[data-state]')].map((r) => [r.dataset.state, text(r.querySelector('.num'))]),
      more: [...document.querySelectorAll('#legend .row.muted')].map(text).find((t) => /more states/.test(t)) || null,
      bubbles: document.querySelectorAll('#map g[data-state]').length,
    },
    exceptions: { sub: text(document.querySelector('#exSub')), tabs: [...document.querySelectorAll('#exTabs button')].map(text), rows: document.querySelectorAll('#exList .item').length },
    stream: { sub: text(document.querySelector('#stSub')), tabs: [...document.querySelectorAll('#stTabs button')].map(text), rows: document.querySelectorAll('#stream tbody tr').length },
    board: { sub: text(document.querySelector('#sbSub')), orders: sb[0] && stack(sb[0]), fulfillment: sb[1] && stack(sb[1]) },
  };
});
const FITS = 3; // rows either panel shows without scrolling in the window below (a 3-row panel just fits; 7 rows overflow it)
// Strict, with the window size fixed: a panel with more than FITS rows has to overflow and scroll to its last row under the wheel,
// and one with FITS rows or fewer must not overflow.
async function checkScroll(page, sel, rows, what) {
  const box = page.locator(sel), over = await box.evaluate((e) => e.scrollHeight > e.clientHeight + 1);
  assert.equal(over, rows > FITS, `${what} has ${rows} rows and ${rows > FITS ? 'scrolls' : "doesn't need to scroll"}`);
  if (!over) return;
  const atEnd = () => box.evaluate((e) => e.scrollTop > 0 && e.scrollTop + e.clientHeight >= e.scrollHeight - 1);
  await box.hover();
  await page.mouse.wheel(0, 5000);
  for (const end = Date.now() + 3000; Date.now() < end && !(await atEnd());) await page.waitForTimeout(50);
  assert.ok(await atEnd(), `${what} scrolls to its last row`);
  await box.evaluate((e) => { e.scrollTop = 0; }); // back to the top for the next range
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Out of order on purpose: down from 1 year to today, then up again.
const ORDER = ['1y', '7d', 'today', '6m', '30d', '90d'];

test('Console panels update with every range button', { skip: UI.skip(pw) }, async () => {
  const s = await openSession(pw, 'console-kpis-range', { viewport: WIDE });
  const { page, step } = s;
  try {
    assert.ok(await until(page, '#app:not(.hide) #kpis > .kpi', 15000), 'the Console drew');
    await step(() => page.locator('#layers button[data-l="demand"]').click()); // the layer whose legend and bubbles are checked
    assert.deepEqual(await read(page), expected('90d'), 'the default range is 90 days');

    let before = await read(page);
    for (const range of ORDER) {
      await step(() => page.locator(`#range button[data-v="${range}"]`).click());
      const want = expected(range);
      // The panels are redrawn once the range's data arrives: wait for them rather than a fixed pause.
      for (const end = Date.now() + 5000; Date.now() < end && !same(await read(page), want);) await page.waitForTimeout(50);
      const got = await read(page);
      assert.deepEqual(got.cards, want.cards, `KPI cards for ${range}`);
      assert.deepEqual(got.demand, want.demand, `map Demand legend and bubbles for ${range}`);
      assert.deepEqual(got.exceptions, want.exceptions, `Exception queue for ${range}`);
      assert.deepEqual(got.stream, want.stream, `Activity stream for ${range}`);
      assert.deepEqual(got.board, want.board, `Status board for ${range}`);
      // The panels agree with the cards they sit under: one exception row per open exception, as many orders in the stream as the
      // range has (a stream tab holds 50), and a board that adds up to the Orders card.
      const k = demoData(range).kpis.data;
      assert.equal(got.exceptions.rows, k.openExceptions, `one Exception queue row per open exception on ${range}`);
      assert.equal(got.stream.rows, Math.min(STREAM_ROWS, k.orders), `the Activity stream lists the range's orders on ${range}`);
      assert.equal(got.board.orders.total, got.cards[0][1], `Order Summaries by status add up to the Orders card on ${range}`);
      // The numbers under each bar add up to the total above it, and each piece of the bar is as wide as its number.
      const count = (t) => Number(t.replace(/,/g, ''));
      for (const [name, st] of [['Order Summaries', got.board.orders], ['Fulfillment Orders', got.board.fulfillment]]) {
        assert.equal(Object.values(st.keys).reduce((sum, v) => sum + count(v), 0), count(st.total), `${name} numbers under the bar add up to its total on ${range}`);
        assert.deepEqual(st.weights, Object.values(st.keys).map(count).map(String), `${name} bar pieces are as wide as their numbers on ${range}`);
      }
      // No card counts Fulfillment Orders, so the check is against the Orders card: the sample data has fewer fulfillment orders than orders.
      assert.ok(count(got.board.fulfillment.total) > 0 && count(got.board.fulfillment.total) <= count(got.cards[0][1]), `Fulfillment Orders total is positive and no more than the Orders card on ${range}`);
      assert.equal(await page.locator(`#range button[data-v="${range}"]`).getAttribute('aria-pressed'), 'true', `${range} is the pressed button`);
      assert.equal(await page.locator('#range button[aria-pressed="true"]').count(), 1, 'one range is pressed');

      // Going to another range moves what is counted in it; the same numbers would mean the panel ignored the click.
      for (const i of [0, 1, 2, 5, 6]) assert.notEqual(got.cards[i][1], before.cards[i][1], `${got.cards[i][0]} changed on ${range}`);
      assert.notDeepEqual(got.demand.rows, before.demand.rows, `Demand changed on ${range}`);
      assert.notEqual(got.exceptions.rows, before.exceptions.rows, `Exception rows changed on ${range}`);
      assert.notDeepEqual(got.board.orders, before.board.orders, `Orders by status changed on ${range}`);
      assert.notDeepEqual(got.board.fulfillment, before.board.fulfillment, `Fulfillment Orders by status changed on ${range}`);
      assert.deepEqual([got.cards[3][1], got.cards[4][1]], [before.cards[3][1], before.cards[4][1]], 'Waiting on you and Stuck do not follow the range');

      // The Exception queue and the Activity stream are panels of their own height: with more rows than fit, the wheel scrolls each
      // to its last row; with few rows, there is nothing to scroll. The window is fixed (1440×900) so that holds on every range.
      await checkScroll(page, '#exList', got.exceptions.rows, `the Exception queue on ${range}`);
      await checkScroll(page, '#stream', got.stream.rows, `the Activity stream on ${range}`);

      assert.ok(await page.locator('#drawer').evaluate((e) => e.classList.contains('hide')), 'no side panel is open');
      before = got;
    }
    assert.deepEqual(s.problems, []);
  } finally { await s.close(); }
});
