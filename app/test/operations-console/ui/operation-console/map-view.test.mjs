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
 * Operations Console map, in demo mode
 *
 * Purpose
 *   Seven short browser tests of the map itself. kpis-range.test.mjs already checks Demand across all ranges, theme.test.mjs
 *   checks the themes, and console-geo.test.mjs checks the projection. These use the default 90 days and one product.
 *
 * Steps and assertions
 *   1. Read the initial network, then choose each data layer: location labels/shapes, selected button, legend, counts and marks.
 *   2. Hover a state and focus its legend row; select a location with mouse, Enter and Space: tooltips, card, dimming and clearing.
 *   3. Turn Flows off and on: routes and packets disappear and return; locations, bubbles and legend stay the same.
 *   4. Zoom with buttons and wheel, drag, reset, then use + and 0: the view changes and resets without selecting a location.
 *   5. Enter/leave full screen with the button and F: the panel fills the window, then restores its layout and selected layer.
 *   6. Search one SKU in Inventory and clear it: source, quantities and location rings match demoInventory; flows stay hidden.
 *   7. Audit the map panel on every layer: no accessibility findings (the page's h1 is outside this panel).
 *   Every test also checks that the page never throws, calls /api/ or sends a non-GET, and closes its session in a finally.
 *
 * Expected quantities come from the demo payload, not the renderer. Customers uses the page's city dataset to generate its
 * sample payload too. Each test keeps its own console-map-<name>.webm; settings are shared in app/tools/browser-kit.mjs.
 *   HEADLESS=1 node --test app/test/operations-console/ui/operation-console/map-view.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { demoData, DEMO_PRODUCTS, demoInventory } from "../../../../public/operations-console/console-demo.js";
import { STATES } from "../../../../public/operations-console/console-geo.js";
import { UI, WIDE, loadPlaywright, openSession, until } from "../../../../tools/browser-kit.mjs";

const pw = await loadPlaywright();
const AUDIT = fileURLToPath(new URL("../../../../tools/a11y-audit.js", import.meta.url));
const data = demoData('90d');
const n = (v) => Number(v).toLocaleString('en-US');
const sum = (rows) => rows.reduce((s, r) => s + r.n, 0);
const sorted = (rows) => [...rows].sort((a, b) => b.n - a.n);
const LAYERS = ['Demand', 'Customers', 'Fulfillment', 'Exceptions', 'Cases', 'Inventory'];
const layer = (page, name) => page.locator('#layers').getByRole('button', { name, exact: true });
const location = (page, name) => page.locator('#map').getByRole('button', { name: new RegExp(`^${name},`) });
const view = (page) => page.locator('#map').evaluate((svg) => svg.getAttribute('viewBox').split(' ').map(Number));
const rowsOf = (page, selector) => page.locator(selector).evaluateAll((rows) => rows.map((r) => [...r.querySelectorAll(':scope > span')].map((s) => s.textContent.trim())));

// The same session/cleanup and safety assertions for each independent, named recording.
function mapTest(name, video, run) {
  test(`Map: ${name}`, { skip: UI.skip(pw), timeout: 20000 }, async () => {
    const s = await openSession(pw, `console-map-${video}`, { viewport: WIDE });
    try {
      s.page.setDefaultTimeout(5000);
      assert.ok(await until(s.page, '#app:not(.hide) #map [data-node]', 15000), 'the map drew');
      await run(s);
      assert.deepEqual(s.problems, []);
    } finally { await s.close(); }
  });
}

const readLegend = (page) => page.evaluate(() => {
  const el = document.querySelector('#legend');
  return {
    heading: el.querySelector('.lt').textContent,
    rows: [...el.querySelectorAll('.row[data-state], .row[data-city]')].map((r) => [r.dataset.state || r.querySelector('b').textContent, r.querySelector('.num').textContent]),
    more: [...el.querySelectorAll('.row.muted')].map((r) => r.textContent.trim()).find((t) => /more (states|cities)/.test(t)) || null,
    states: [...document.querySelectorAll('#map [data-state]')].map((g) => g.dataset.state).sort(),
    cities: document.querySelectorAll('#map [data-city]').length,
  };
});

mapTest('network and layer legends match the sample data', 'layers', async ({ page, step }) => {
  assert.equal(await page.locator('#netSub').textContent(), `${data.network.data.length} locations · ${n(sum(data.flows.data))} FOs routed last 90 days`);
  assert.equal(await page.locator('#mapwrap').locator('..').locator('..').locator('h2').evaluate((h) => h.firstChild.textContent.trim()), 'Fulfillment network');
  assert.deepEqual(await page.locator('#layers button').allTextContents(), LAYERS);
  const nodes = await page.locator('#map [data-node]').evaluateAll((els) => els.map((el) => ({ name: el.getAttribute('aria-label'), shape: el.querySelector('.core').localName })));
  assert.deepEqual(nodes, data.network.data.map((l) => ({ name: `${l.name}, ${l.type === 'Store' ? 'store' : 'distribution center'}, ${Math.round(l.assigned / l.cap * 100)}% of capacity`, shape: l.type === 'Store' ? 'rect' : 'circle' })));

  const flows = new Map();
  for (const f of data.flows.data) flows.set(f.state, (flows.get(f.state) || 0) + f.n);
  // Build expected city totals from the fixture's coordinates: aliases such as New York / NYC are one place.
  const cities = await page.evaluate(async () => {
    const coords = {}, places = new Map();
    for (const [state, entries] of Object.entries(window.US_CITIES)) for (const entry of entries.split('|')) {
      const words = entry.split(' '), point = words.splice(-2).join(',');
      coords[`${state}|${words.join(' ')}`] = point;
    }
    const sample = (await import(new URL('operations-console/console-demo.js', document.baseURI).href)).demoData('90d');
    for (const c of sample.customers.data.cities) {
      const point = coords[`${c.state}|${c.city}`], id = point || c.state;
      if (!places.has(id)) places.set(id, { key: point ? c.city : 'Other', n: 0, spend: 0 });
      const p = places.get(id); p.n += c.n; p.spend += c.spend;
    }
    return [...places.values()].sort((a, b) => b.n - a.n || b.spend - a.spend);
  });
  const cases = data.cases.data.list.filter((r) => STATES[r.key]);
  const checks = [
    ['Demand', 'Delivery groups by ship-to state', data.demand.data],
    ['Customers', 'Customers by bill-to city', cities],
    ['Fulfillment', 'Fulfillment orders by ship-to state', [...flows].map(([key, n]) => ({ key, n }))],
    ['Exceptions', 'Open process exceptions by bill-to state', data.exByState.data],
    ['Cases', 'Cases by order ship-to / bill-to or account state', cases],
  ];
  for (const [name, heading, entries] of checks) {
    if (name !== 'Demand') await step(() => layer(page, name).click());
    const got = await readLegend(page), want = sorted(entries), unit = name === 'Customers' ? 'cities' : 'states';
    assert.equal(await layer(page, name).getAttribute('aria-pressed'), 'true', name);
    assert.equal(await page.locator('#layers [aria-pressed="true"]').count(), 1, name);
    assert.equal(got.heading, heading, name);
    assert.deepEqual(got.rows, want.slice(0, 10).map((r) => [r.key, n(r.n)]), name);
    assert.equal(got.more, want.length > 10 ? `+${want.length - 10} more ${unit}` : null, name);
    if (name === 'Customers') assert.equal(got.cities, cities.length, name);
    else assert.deepEqual(got.states, entries.map((r) => r.key).sort(), name);
  }
});

mapTest('tooltips and location focus work with mouse and keyboard', 'focus', async ({ page, step }) => {
  const state = data.demand.data[0], l = data.network.data.find((l) => l.name === 'Dallas DC');
  const tip = page.locator('#tip'), card = page.locator('#focus'), node = location(page, l.name);
  // Hover inside the bubble, away from the route endpoints that meet at its center.
  const bubble = page.locator(`#map [data-state="${state.key}"] .bub`), box = await bubble.boundingBox();
  await step(() => bubble.hover({ position: { x: box.width / 3, y: box.height / 3 } }));
  const checkTip = async () => {
    assert.ok(await tip.isVisible());
    assert.equal(await tip.locator('b').first().textContent(), STATES[state.key][0]);
    assert.match(await tip.textContent(), new RegExp(`Delivery groups${state.n}\\b`));
  };
  await checkTip();
  await step(() => page.locator(`#legend [data-state="${state.key}"]`).focus());
  await checkTip();
  await step(() => node.locator('.core').click());
  const checkSelected = async () => {
    assert.ok(await card.isVisible());
    assert.equal(await card.locator('b').first().textContent(), l.name);
    assert.equal(await node.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#map [data-node][aria-pressed="true"]').count(), 1);
    assert.deepEqual(await rowsOf(page, '#focus .r'), [
      ['Open FOs', n(l.openFOs)], ['Routed last 90 days', n(sum(data.flows.data.filter((f) => f.loc === l.id)))],
      ['Capacity used', `${Math.round(l.assigned / l.cap * 100)}% (${n(l.assigned)}/${n(l.cap)})`],
      ...sorted(data.flows.data.filter((f) => f.loc === l.id)).slice(0, 4).map((f) => [STATES[f.state][0], n(f.n)]),
    ]);
  };
  await checkSelected();
  assert.equal(await page.locator('#map [data-node].dim').count(), data.network.data.length - 1);
  assert.ok(await page.locator('#map g.dim > .flow').count() > 0, 'other locations’ routes are subdued');
  await step(() => card.getByRole('button', { name: 'Clear focus' }).click());
  assert.equal(await card.isVisible(), false);
  assert.equal(await page.locator('#map [data-node][aria-pressed="true"], #map g.dim').count(), 0);

  // Tab from the preceding location, so this checks the real tab order as well as Enter and Space.
  await location(page, data.network.data[0].name).focus();
  await page.keyboard.press('Tab');
  assert.ok(await node.evaluate((el) => el === document.activeElement));
  for (const key of ['Enter', 'Space']) {
    await step(() => page.keyboard.press(key));
    await checkSelected();
    assert.ok(await node.evaluate((el) => el === document.activeElement), `${key}: focus survives the redraw`);
    await step(() => page.keyboard.press('Escape'));
    assert.equal(await card.isVisible(), false, `${key}: Escape clears focus`);
    assert.equal(await node.getAttribute('aria-pressed'), 'false');
  }
});

mapTest('Flows removes and restores routes without changing the data', 'flows', async ({ page, step }) => {
  const routes = () => page.locator('#map .flow').evaluateAll((els) => els.map((el) => el.getAttribute('d')));
  const before = await routes(), legend = await readLegend(page), packets = await page.locator('#map .pkt').count();
  assert.ok(before.length > 0 && packets > 0, 'flows and packets are drawn');
  for (const on of [false, true]) {
    await step(() => page.getByRole('checkbox', { name: 'Flows' }).setChecked(on));
    assert.deepEqual(await routes(), on ? before : []);
    assert.equal(await page.locator('#map .pkt').count(), on ? packets : 0);
    assert.equal(await page.locator('#map [data-node]').count(), data.network.data.length);
    assert.deepEqual(await readLegend(page), legend);
  }
});

mapTest('zoom, pan and reset change the view without selecting a location', 'navigation', async ({ page, step }) => {
  const initial = await view(page), zoom = page.locator('#zoom');
  assert.ok(await zoom.getByRole('button', { name: 'Zoom out', exact: true }).isDisabled());
  assert.ok(await zoom.getByRole('button', { name: 'Reset zoom', exact: true }).isDisabled());
  await step(() => zoom.getByRole('button', { name: 'Zoom in', exact: true }).click());
  assert.ok((await view(page))[2] < initial[2]);
  await step(() => zoom.getByRole('button', { name: 'Zoom out', exact: true }).click());
  assert.deepEqual(await view(page), initial);
  const box = await page.locator('#map').boundingBox();
  await step(async () => { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, -200); });
  const beforeDrag = await view(page);
  assert.ok(beforeDrag[2] < initial[2], 'wheel zooms in');
  await step(async () => {
    await page.mouse.move(box.x + box.width * .45, box.y + box.height * .45);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .45 - 60, box.y + box.height * .45 - 30, { steps: 4 });
    await page.mouse.up();
  });
  const afterDrag = await view(page);
  assert.notDeepEqual(afterDrag.slice(0, 2), beforeDrag.slice(0, 2), 'drag moves the view');
  assert.equal(afterDrag[2], beforeDrag[2], 'drag keeps the zoom');
  assert.equal(await page.locator('#map [data-node][aria-pressed="true"]').count(), 0, 'drag selects no location');
  await step(() => zoom.getByRole('button', { name: 'Reset zoom', exact: true }).click());
  assert.deepEqual(await view(page), initial);
  await step(() => page.keyboard.press('+'));
  assert.ok((await view(page))[2] < initial[2], '+ zooms in');
  await step(() => page.keyboard.press('0'));
  assert.deepEqual(await view(page), initial, '0 resets the view');
  assert.ok(await zoom.getByRole('button', { name: 'Zoom out', exact: true }).isDisabled());
  assert.ok(await zoom.getByRole('button', { name: 'Reset zoom', exact: true }).isDisabled());
});

mapTest('full screen preserves the layer and restores the layout', 'fullscreen', async ({ page, step }) => {
  await step(() => layer(page, 'Fulfillment').click());
  const panel = page.locator('#mapwrap').locator('..').locator('..'), button = page.getByRole('button', { name: 'Full screen', exact: true });
  const original = await panel.boundingBox(), legend = await readLegend(page);
  for (const key of [null, 'f']) {
    const toggle = () => key ? page.keyboard.press(key) : button.click();
    await step(toggle);
    assert.equal(await button.getAttribute('aria-pressed'), 'true');
    const full = await panel.evaluate((el) => {
      const b = el.getBoundingClientRect();
      return { active: document.fullscreenElement === el || el.classList.contains('maxi'), x: b.x, y: b.y, w: b.width, h: b.height, vw: innerWidth, vh: innerHeight };
    });
    assert.ok(full.active && Math.abs(full.x) < 1 && Math.abs(full.y) < 1);
    assert.ok(Math.abs(full.w - full.vw) < 1 && Math.abs(full.h - full.vh) < 1, 'map panel fills the window');
    assert.ok(await page.locator('#legend').isVisible(), 'the legend stays with the map');
    await step(toggle);
    assert.equal(await button.getAttribute('aria-pressed'), 'false');
    const restored = await panel.boundingBox();
    for (const k of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(restored[k] - original[k]) < 1, `${k} restored`);
    assert.equal(await layer(page, 'Fulfillment').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await readLegend(page), legend);
  }
});

mapTest('Inventory searches a SKU, shows its quantities, and clears it', 'inventory', async ({ page, step }) => {
  const product = DEMO_PRODUCTS[0], inventory = demoInventory(product, '90d'), search = page.getByRole('searchbox', { name: 'Search products' });
  await step(() => layer(page, 'Inventory').click());
  assert.ok(await search.isVisible());
  assert.ok(await search.evaluate((el) => el === document.activeElement));
  assert.match(await page.locator('#legend').textContent(), /Search a product/);
  await step(() => search.fill(product.StockKeepingUnit));
  assert.ok(await until(page, '#pres button[role="option"]'));
  const option = page.getByRole('listbox', { name: 'Products', exact: true }).getByRole('option');
  assert.equal(await option.count(), 1);
  assert.ok((await option.textContent()).includes(product.Name) && (await option.textContent()).includes(product.StockKeepingUnit));
  await step(() => option.click());
  const legend = await page.locator('#legend').textContent();
  for (const label of [product.Name, inventory.source, inventory.measure]) assert.ok(legend.includes(label), label);
  assert.equal(await page.locator('#netSub').textContent(), `${product.Name} · ${inventory.locations.length} locations · ${inventory.source}`);
  assert.deepEqual(await rowsOf(page, '#legend [role="list"][aria-label="Locations"] .lrow'), inventory.locations.slice(0, 8).map((l) => [l.name, n(l.qty)]));
  const mapped = inventory.locations.filter((l) => data.network.data.some((net) => net.id === l.id));
  const ringNames = await page.locator('#map [data-pm]').evaluateAll((marks) => marks.map((mark) => document.querySelector(`#map [data-node="${mark.dataset.pm}"]`).getAttribute('aria-label').split(',')[0]).sort());
  assert.deepEqual(ringNames, mapped.map((l) => l.name).sort());
  assert.equal(await page.locator('#map .flow').count(), 0);
  assert.equal(await layer(page, 'Inventory').getAttribute('aria-pressed'), 'true');
  await step(() => page.getByRole('button', { name: 'Clear product', exact: true }).click());
  assert.equal(await search.inputValue(), '');
  assert.equal(await page.locator('#map [data-pm]').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Clear product', exact: true }).count(), 0);
  assert.match(await page.locator('#legend').textContent(), /Search a product/);
});

mapTest('every layer passes the accessibility audit', 'a11y', async ({ page, step }) => {
  await page.addScriptTag({ path: AUDIT });
  for (const name of LAYERS) {
    if (name !== 'Demand') await step(() => layer(page, name).click());
    const found = await page.evaluate(() => window.a11yAudit(document.querySelector('#mapwrap').closest('.zone')));
    // The page's one h1 is outside the panel, so a check of the panel alone cannot see it.
    const issues = Object.fromEntries(Object.entries(found.issues).filter(([rule]) => rule !== 'heading-h1-missing'));
    assert.deepEqual(issues, {}, `${name}: ${JSON.stringify(issues).slice(0, 600)}`);
    assert.equal(await page.locator('#map [data-node]:not([tabindex="0"]), #map [data-node]:not([role="button"])').count(), 0, name);
    assert.equal(await page.locator('#legend [role="listitem"]:not([tabindex="0"])').count(), 0, `${name}: legend rows take focus`);
  }
});
