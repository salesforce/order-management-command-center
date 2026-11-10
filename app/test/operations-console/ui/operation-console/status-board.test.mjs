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
 * Console Status board
 *
 * Purpose
 *   The Status board shows how many Order Summaries and Fulfillment Orders are in each status for the chosen range, as two stacked
 *   bars with a key under each. It is read-only. kpis-range.test.mjs checks its numbers on every range; this test checks what
 *   the person sees: the bars are drawn in proportion, every status keeps its own colour, nothing on it is hover-only or
 *   clickable by mistake, and the panel passes the accessibility audit. It runs in the default theme; how the board looks in
 *   each theme is for theme.test.mjs.
 *
 * Steps
 *   1. Open /?demo=1 and wait for the KPI cards.
 *   2. For each range (90 days, 7 days, today, 1 year): click it, wait for the board to redraw, and read the two bars and keys.
 *   3. Click a bar piece and a key: nothing opens. Press Tab through the page and see whether anything on the board takes focus.
 *   4. Read the colour of every piece and swatch against the token its status should use.
 *   5. Run app/tools/a11y-audit.js on the panel.
 *
 * Assertions
 *   - Panel: heading "Status board", subtitle names the range, and the two bars come in order: "Order Summaries by status", then
 *     "Fulfillment Orders by status". Each title carries the total, which is the sum of the statuses.
 *   - Key: one line per status, biggest first, as name then count, the counts as the sample data has them.
 *   - Bar: one piece per status, in the key's order; each piece's width is its share of the bar (within 1%), the pieces together
 *     fill the bar, and the two bars are the same width and fit the panel with no sideways scrolling.
 *   - Not hover-only: each piece's tooltip (name, count, percent) is also on screen as its key line, and the percents are
 *     the rounded shares and add up to about 100.
 *   - Read-only: clicking a piece or a key opens no drawer; nothing in the panel takes a Tab stop.
 *   - Colour: a status is drawn in its own token (Created --st1, Approved and Allocated --st2, Pickpack --st3, Fulfilled
 *     --st-done, Cancelled --st-fail), the piece and its key swatch agree, and the same status has the same colour in both bars.
 *     The colour of a status is never the only thing that names it: every swatch sits next to its name.
 *   - Accessibility: a11yAudit() on the panel reports nothing.
 *   - The page never throws, calls /api/ or sends a non-GET.
 *
 * Expected values are built from demoData(), not typed in, so editing the sample data doesn't break the test. The status-to-token
 * table below is typed in on purpose: it is the board's promise that a status keeps its hue.
 *
 * Not covered: a board with no records ("No records in range") or with an error, which the sample data never produces (use a unit
 * test of stackBar()); and a status the page has no hue for (it takes one of three fallback colours).
 *   node --test app/test/operations-console/ui/operation-console/status-board.test.mjs     (window, video and server are set for all UI tests in browser-kit.mjs)
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { demoData } from "../../../../public/operations-console/console-demo.js";
import { RANGE_LABEL } from "../../../../public/operations-console/console-labels.js";
import { UI, WIDE, loadPlaywright, openSession, until } from "../../../../tools/browser-kit.mjs";

const pw = await loadPlaywright();
const AUDIT = fileURLToPath(new URL("../../../../tools/a11y-audit.js", import.meta.url));

const n = (v) => Number(v).toLocaleString('en-US');
const biggest = (rows) => [...rows].sort((a, b) => b.n - a.n); // a tie keeps the data's order, as the page does
const TITLES = ['Order Summaries by status', 'Fulfillment Orders by status'];
const BARS = (d) => [d.statusBoard.data.orders, d.statusBoard.data.fulfillment];
// What a status is drawn in. Created is the first step of the blue ramp, Allocated and Approved the second, Pickpack the third;
// the finished and failed statuses keep their reserved hues.
const TOKEN = { Created: '--st1', Approved: '--st2', Allocated: '--st2', Pickpack: '--st3', Fulfilled: '--st-done', Cancelled: '--st-fail' };

// Reads both bars off the page: title, total, each piece (tooltip, width, flex weight, colour) and each key line (name, count, swatch).
const read = (page) => page.evaluate(() => {
  const text = (e) => e.textContent.replace(/\s+/g, ' ').trim();
  const box = document.querySelector('#board');
  return {
    heading: text(box.closest('.zone').querySelector('h2').firstChild),
    sub: text(document.querySelector('#sbSub')),
    scrollsSideways: box.scrollWidth > box.clientWidth + 1,
    bars: [...box.querySelectorAll('.sb > div')].map((bar) => ({
      title: text(bar.querySelector('h3 span')), total: text(bar.querySelector('h3 b')),
      width: bar.querySelector('.stack').getBoundingClientRect().width,
      pieces: [...bar.querySelectorAll('.stack i')].map((i) => ({ tip: i.title, width: i.getBoundingClientRect().width, weight: i.style.flexGrow, colour: getComputedStyle(i).backgroundColor })),
      keys: [...bar.querySelectorAll('.keys span')].map((k) => ({ name: [...k.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join('').trim(), count: text(k.querySelector('b')), swatch: getComputedStyle(k.querySelector('s')).backgroundColor, text: text(k) })),
    })),
  };
});

test('Status board: bars drawn in proportion, keyed by name and count, read-only, on every range', { skip: UI.skip(pw) }, async () => {
  const s = await openSession(pw, 'console-status-board', { viewport: WIDE });
  const { page, step } = s;
  try {
    assert.ok(await until(page, '#app:not(.hide) #kpis > .kpi', 15000), 'the Console drew');
    for (const range of ['90d', '7d', 'today', '1y']) {
      await step(() => page.locator(`#range button[data-v="${range}"]`).click());
      const sub = RANGE_LABEL[range], lists = BARS(demoData(range)).map(biggest);
      for (const end = Date.now() + 5000; Date.now() < end && (await read(page)).sub !== sub;) await page.waitForTimeout(50);
      const got = await read(page);
      assert.equal(got.heading, 'Status board');
      assert.equal(got.sub, sub, `${range}: the subtitle names the range`);
      assert.deepEqual(got.bars.map((b) => b.title), TITLES, `${range}: the two bars, in order`);
      assert.equal(got.scrollsSideways, false, `${range}: the panel doesn't scroll sideways`);
      assert.ok(Math.abs(got.bars[0].width - got.bars[1].width) < 1, `${range}: the two bars are the same width`);

      got.bars.forEach((bar, b) => {
        const list = lists[b], total = list.reduce((sum, r) => sum + r.n, 0), where = `${range}, ${TITLES[b]}`;
        assert.equal(bar.total, n(total), `${where}: the title's total is the sum of the statuses`);
        assert.deepEqual(bar.keys.map((k) => [k.name, k.count]), list.map((r) => [r.key, n(r.n)]), `${where}: the key, biggest first`);
        assert.deepEqual(bar.pieces.map((p) => p.tip.split(':')[0]), list.map((r) => r.key), `${where}: the pieces follow the key's order`);

        // A piece is its status's share of the bar. (A status with no records is a 4px sliver, so only the others are measured.)
        const live = bar.pieces.map((p, i) => ({ ...p, n: list[i].n })).filter((p) => p.n > 0);
        const drawn = live.reduce((sum, p) => sum + p.width, 0), live_n = live.reduce((sum, p) => sum + p.n, 0);
        live.forEach((p) => assert.ok(Math.abs(p.width / drawn - p.n / live_n) < 0.01, `${where}: ${p.tip} is ${(p.width / drawn * 100).toFixed(1)}% of the bar, expected ${(p.n / live_n * 100).toFixed(1)}%`));
        assert.ok(drawn > bar.width * 0.97 && drawn <= bar.width, `${where}: the pieces fill the bar (${drawn.toFixed(0)} of ${bar.width.toFixed(0)}px)`);

        // Nothing is on the tooltip alone: its name, count and rounded percent are the key's.
        const tips = bar.pieces.map((p) => /^(.+): ([\d,]+) \((\d+)%\)$/.exec(p.tip));
        assert.ok(tips.every(Boolean), `${where}: every tooltip reads "Status: count (percent%)": ${bar.pieces.map((p) => p.tip).join(' | ')}`);
        tips.forEach(([, name, count, pct], i) => {
          assert.deepEqual([name, count], [bar.keys[i].name, bar.keys[i].count], `${where}: the tooltip and the key say the same`);
          assert.equal(Number(pct), Math.round((list[i].n / total) * 100), `${where}: ${name}'s percent`);
        });
        const sumPct = tips.reduce((sum, t) => sum + Number(t[3]), 0);
        assert.ok(sumPct >= 97 && sumPct <= 103, `${where}: the percents add up to about 100 (${sumPct})`);
      });
    }

    // Read-only: a click on a piece or a key opens nothing, and nothing in the panel takes a Tab stop.
    await step(() => page.locator('#range button[data-v="90d"]').click());
    await step(() => page.locator('#board .stack i').first().click());
    await step(() => page.locator('#board .keys span').first().click());
    assert.equal(await page.locator('#drawer').evaluate((d) => d.classList.contains('hide')), true, 'clicking the board opens no drawer');
    assert.equal(await page.locator('#board').evaluate((b) => b.querySelectorAll('a, button, input, select, textarea, [tabindex]').length), 0, 'nothing on the board takes focus');
    assert.deepEqual(s.problems, []);
  } finally { await s.close(); }
});

test('Status board: each status is drawn in its own colour, in the bar and in the key', { skip: UI.skip(pw) }, async () => {
  const s = await openSession(pw, 'console-status-board-colour', { viewport: WIDE });
  const { page } = s;
  try {
    assert.ok(await until(page, '#app:not(.hide) #kpis > .kpi', 15000), 'the Console drew');
    // Resolve a token to the colour the browser paints, through a probe element in the page.
    const paint = (token) => page.evaluate((t) => {
      const probe = document.createElement('i');
      probe.style.backgroundColor = `var(${t})`;
      document.body.append(probe);
      const c = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return c;
    }, token);
    const got = await read(page), seen = {};
    for (const bar of got.bars) {
      for (const [i, key] of bar.keys.entries()) {
        const want = TOKEN[key.name];
        if (!want) continue; // a status with no reserved hue takes a fallback colour
        const colour = await paint(want);
        assert.equal(bar.pieces[i].colour, colour, `${bar.title}: ${key.name} is drawn in ${want}`);
        assert.equal(key.swatch, colour, `${bar.title}: ${key.name}'s key swatch is ${want}`);
        assert.equal(seen[key.name] ?? colour, colour, `${key.name} has the same colour in both bars`);
        seen[key.name] = colour;
      }
      bar.keys.forEach((k) => assert.ok(k.name && k.text.includes(k.name), `${bar.title}: a swatch always sits next to its name`));
    }
    assert.ok(Object.keys(seen).length >= 3, `the sample data uses several of the reserved statuses (${Object.keys(seen).join(', ')})`);
    assert.deepEqual(s.problems, []);
  } finally { await s.close(); }
});

test('Status board: no accessibility findings', { skip: UI.skip(pw) }, async () => {
  const s = await openSession(pw, 'console-status-board-a11y', { viewport: WIDE });
  const { page } = s;
  try {
    assert.ok(await until(page, '#app:not(.hide) #kpis > .kpi', 15000), 'the Console drew');
    await page.addScriptTag({ path: AUDIT });
    const found = await page.evaluate(() => window.a11yAudit(document.querySelector('#board').closest('.zone')));
    // The page's one h1 is outside the panel, so a check of the panel alone can't see it.
    const issues = Object.fromEntries(Object.entries(found.issues).filter(([rule]) => rule !== 'heading-h1-missing'));
    assert.deepEqual(issues, {}, JSON.stringify(issues).slice(0, 600));
    assert.deepEqual(s.problems, []);
  } finally { await s.close(); }
});
