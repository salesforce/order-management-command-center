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
// Salesforce Order Management Operations Console's drawers: an order (Details, Activity and Timeline), the record drawers (Case, Process Exception, Fulfillment
// Order, Shipment, Return Order and the rest), and a customer's value. Page state is S (console-state.js); the console's
// other functions come in on `page`.
import { $, money, esc, drawerItems, num, ago, keepFocus, pct, focusSel, NATIVE } from './console-kit.js';
import { DEMO } from '../shared/transport/om-mode.js';
import { demoOrder, demoHistory, demoRecord, demoAccount } from './console-demo.js';
import { S } from './console-state.js';
import { na } from './console-charts.js';

// A fulfillment order's drawer, as Agentforce gets it: its number, status and location, then its routing explanation (routingView's
// facts), the location that won and why, the rules that decided it and what it could fill. Never the ship-to.
export const routingFacts = (r, x) => {
  const head = `Open in the drawer: fulfillment order ${r.FulfillmentOrderNumber || r.Id} (Id ${r.Id}), ${r.Status || 'no status'}${r.FulfilledFromLocation?.Name ? `, at ${r.FulfilledFromLocation.Name}` : ''}`;
  if (!x) return [head, 'Its routing: Order Management gave no routing explanation for it'];
  const why = x.whyTip || x.why, rules = (x.rules || []).slice(0, 6).map((y) => `${y.label} ${num(y.score)}${y.isOverride ? ' (override)' : ''}`), lines = (x.lines || []).slice(0, 8).map((y) => `${y.sku} ${y.filled} of ${y.requested}`);
  return [head, `Its routing: ${x.location || 'its location'} won${why ? ` (${String(why).replace(/\.$/, '')})` : ''}${x.score != null ? `, score ${num(x.score)}` : ''}${x.filled ? `, filled ${x.filled}` : ''}`,
    rules.length && `Its routing rules: ${rules.join(', ')}`, lines.length && `Its routing by item: ${lines.join(', ')}`].filter(Boolean);
};

// page: the console's functions and constants this part uses.
export function createDrawers(page) {
  const { DOMAINS, MODES, clearProduct, j, mapZone, moveQueue, openQueueItem, pill, place, renderMap, resetZoom, setDTab, setLive, setMode,
    shortDate, statusColor, toggleFull, zoomBy } = page;
  // ---------- order drawer ----------
  const STEPS = ['Created', 'Approved', 'Fulfilling', 'Fulfilled'];
  // Only the most recently opened drawer may paint. Closing also invalidates outstanding reads, including a reopened Id.
  let drawerSeq = 0;
  const isStale = (mine) => mine !== drawerSeq;
  const stepOf = (s) => /cancel/i.test(s) ? -1 : /fulfilled|shipped|delivered|closed|complete/i.test(s) && !/partial/i.test(s) ? 3 : /fulfil|pick|pack|alloc|assign|partial|waiting/i.test(s) ? 2 : /approved|activated/i.test(s) ? 1 : 0;
  function salesforceLink(url) {
    return url ? `<p style="margin-top:var(--sp-10)"><a href="${esc(url)}" target="_blank" rel="noopener">Open in Salesforce ↗</a></p>` : '';
  }
  function drawerTable(rows, head = '') { return `<table>${head}<tbody>${rows}</tbody></table>`; }
  function drawerError(d, e) {
    d.classList.remove('wide');
    d.innerHTML = `<div class="perr">${esc(e.message)}</div><button id="closeDrawer">Close</button>`;
    setDrawerFacts([]);
  }
  function factList(facts, attrs = '') {
    if (!facts.length) return '';
    const items = facts.map(([k, x]) => `<div><span>${k}</span>${factVal(x)}</div>`).join('');
    return `<div class="facts"${attrs}>${items}</div>`;
  }
  function orderDetails(o) {
    const os = o.order;
    const items = o.items.length ? '<table><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Canceled</th><th class="num">Total</th></tr></thead><tbody>' + drawerItems(o.items) + '</tbody></table>' : '<div class="muted">None</div>';
    const cases = o.cases ? '<h3>Cases</h3>' + caseRows(o.cases) : '';
    return `
      ${orderSteps(os.Status || '')}
      <div class="facts"><div><span>Total</span>${money(os.GrandTotalAmount)}</div><div><span>Ordered</span>${os.OrderedDate ? new Date(os.OrderedDate).toLocaleString() : '—'}</div><div><span>Channel</span>${esc(os.SalesChannel?.SalesChannelName || '—')}</div>
        <div><span>Customer</span>${acctLink(os.AccountId, os.Account?.Name)}</div><div><span>Email</span>${esc(os.BillingEmailAddress || '—')}</div><div><span>Bill to</span>${esc([os.BillingCity, os.BillingState].filter(Boolean).join(', ') || '—')}</div></div>
      <h3>Line items</h3>${items}
      ${orderFulfillments(o.fulfillmentOrders)}
      <h3>Process exceptions</h3>${exItems(o.exceptions)}
      ${cases}
      ${orderReturns(o.returns)}
      ${salesforceLink(o.recordUrl)}`;
  }
  function orderStepClass(st, i) {
    if (st < 0) return i === 0 ? 'cur' : '';
    if (i < st) return 'done';
    return i === st ? 'cur' : '';
  }
  function orderSteps(status) {
    const st = stepOf(status);
    const steps = STEPS.map((label, i) => `<div class="${orderStepClass(st, i)}">${st < 0 && i === 0 ? 'Cancelled' : label}</div>`).join('');
    return `<div class="steps ${st < 0 ? 'cancel' : ''}">${steps}</div>`;
  }
  function orderFulfillments(list) {
    const rows = list.map((f) => {
      const to = f.FulfilledToState ? ` → ${esc([f.FulfilledToCity, f.FulfilledToState].filter(Boolean).join(', '))}` : '';
      const focus = f.FulfilledFromLocationId ? `<button class="linkbtn" data-loc="${esc(f.FulfilledFromLocationId)}">Focus on map</button>` : '';
      return `<tr ${recAttr('FulfillmentOrder', f.Id)}><td><b>${esc(f.FulfillmentOrderNumber)}</b><div class="muted">${esc(f.FulfilledFromLocation?.Name || '')}${to}</div></td><td><span class="pill"><s style="background:${statusColor(f.Status)}"></s>${esc(f.Status)}</span></td><td class="num">${focus}</td></tr>`;
    }).join('');
    const body = list.length ? drawerTable(rows) : '<div class="muted">Not routed yet</div>';
    return '<h3>Fulfillment orders</h3>' + body;
  }
  function orderReturnLine(l) {
    const reason = l.ReasonForReturn ? ` — ${esc(l.ReasonForReturn)}` : '';
    return `${num(l.QuantityReturned)} × ${esc(l.Product2?.Name || 'item')}${reason}`;
  }
  function orderReturnRow(r) {
    const lines = r.lines.map(orderReturnLine).join('<br>') || 'No product lines';
    return `<tr ${recAttr('ReturnOrder', r.Id)}><td><b>${esc(r.ReturnOrderNumber)}</b><div class="muted">${lines}</div></td><td><span class="pill"><s style="background:${statusColor(r.Status)}"></s>${esc(r.Status)}</span></td><td class="num">${money(r.GrandTotalAmount)}</td><td class="muted">${ago(r.CreatedDate)}</td></tr>`;
  }
  function orderReturns(list) {
    if (!list) return '';
    const body = list.length ? drawerTable(list.map(orderReturnRow).join('')) : '<div class="muted">No returns on this order.</div>';
    return '<h3>Returns</h3>' + body;
  }
  async function openOrder(id) {
    const mine = ++drawerSeq;
    dCur = { obj: 'OrderSummary', id }; setDrawerFacts([]);
    const d = $('#drawer'); d.classList.remove('hide'); $('#scrim').classList.remove('hide'); enterLayer(d);
    d.innerHTML = '<div class="muted">Loading…</div>';
    try {
      const o = DEMO ? demoOrder(id) : await j(`/api/order/${encodeURIComponent(id)}`);
      if (isStale(mine)) return;
      const os = o.order;
      oDetails = orderDetails(o);
      d.innerHTML = `${dHead('Order Summary', os.OrderNumber, os.Status)}
      <div class="seg-ctl otabs" id="oTabs" role="tablist" aria-label="Order view">${[['details', 'Details'], ['activity', 'Activity'], ['timeline', 'Timeline']].map(([v, l]) => `<button role="tab" data-v="${v}">${l}</button>`).join('')}</div>
      <div id="oBody"></div>`;
      d.querySelectorAll('#oTabs button').forEach((b) => b.onclick = () => showOrderView(id, b.dataset.v));
      showOrderView(id, S.oView);
    } catch (e) {
      if (isStale(mine)) { return; }
      drawerError(d, e);
    }
    $('#closeDrawer').onclick = closeDrawer;
  }
  function closeDrawer() { drawerSeq++; $('#drawer').classList.add('hide'); $('#drawer').classList.remove('wide'); $('#scrim').classList.add('hide'); dStack = []; dCur = null; S.oView = 'details'; setDrawerFacts([]); leaveLayer($('#drawer')); }

  // ---------- order history: Activity and Timeline ----------
  // Read-only views of /api/order/:id/history, loaded the first time either tab opens for an order. Colour encodes the kind of
  // record; products are marked by initials so they stay readable on top of it. Back from a drilled record returns to the same view.
  const HX_LANES = [['order', 'Order', 'var(--signal)'], ['change', 'Changes', 'var(--d5)'], ['fo', 'Fulfillment', 'var(--d1)'], ['exc', 'Exceptions', 'var(--st-warn)'],
    ['ship', 'Shipments', 'var(--d6)'], ['money', 'Money', 'var(--d3)'], ['case', 'Cases', 'var(--d2)'], ['ret', 'Returns', 'var(--d4)']];
  const hxLane = Object.fromEntries(HX_LANES.map(([k, label, c]) => [k, { label, c }]));
  S.oView = 'details'; let oDetails = '', hx = null, hxProd = null, hxSel = null, hxZoom = 'all';
  const hxIni = (name) => (String(name).match(/[A-Za-z0-9]+/g) || ['?']).filter((w) => !/^(the|and|of|a)$/i.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const hxDur = (ms) => ms < 3600e3 ? `${Math.max(1, Math.round(ms / 60e3))} min` : ms < 48 * 3600e3 ? `${+(ms / 3600e3).toFixed(ms < 36e6 ? 1 : 0)} h` : `${Math.round(ms / 864e5)} days`;
  const hxTime = (d) => new Date(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const hxDay = (d, long = true) => long ? new Date(d).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) : `${new Date(d).toLocaleDateString(undefined, { weekday: 'short' })} ${new Date(d).getDate()}`;
  const hxDayKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${x.getMonth() + 1}-${x.getDate()}`; };
  const hxSigned = (v) => v == null ? '' : v < 0 ? `−${money(-v)}` : money(v);
  const hxStart = (e) => +new Date(e.start);
  // Open records run to now; finished ones to their end; points (money, the order itself) have no length.
  const hxEnd = (e) => e.end ? +new Date(e.end) : e.tone === 'open' || e.tone === 'warn' ? Math.max(Date.now(), hxStart(e)) : hxStart(e);
  const hxShows = (e) => !hxProd || e.lane === 'order' || e.products.some((p) => p.key === hxProd);
  const hxProduct = (k) => hx.data.products.find((p) => p.key === k);
  const hxChips = (list, full) => list.map((p) => hxChip(p, full)).join('');
  function hxChip(p, full) {
    const x = hxProduct(p.key); if (!x) return '';
    const active = hxProd === p.key ? ' on' : '', initials = esc(hxIni(x.name));
    if (full) {
      const qty = p.qty > 1 ? ` <span class="muted">× ${num(p.qty)}</span>` : '';
      return `<span class="hx-chip${active}"><span class="hx-ini">${initials}</span>${esc(x.name)}${qty}</span>`;
    }
    const titleQty = p.qty > 1 ? ` × ${p.qty}` : '', qty = p.qty > 1 ? `<small>${num(p.qty)}</small>` : '';
    return `<span class="hx-ini${active}" title="${esc(x.name)}${titleQty}">${initials}${qty}</span>`;
  }
  const hxTook = (e) => e.end && +new Date(e.end) > hxStart(e) ? `took ${hxDur(+new Date(e.end) - hxStart(e))}` : !e.end && (e.tone === 'open' || e.tone === 'warn') ? `open for ${hxDur(Date.now() - hxStart(e))}` : '';

  async function showOrderView(id, view) {
    const mine = drawerSeq;
    S.oView = view;
    const d = $('#drawer'), body = $('#oBody'); if (!body) return;
    d.classList.toggle('wide', view === 'timeline');
    d.querySelectorAll('#oTabs button').forEach((b) => { b.classList.toggle('on', b.dataset.v === view); b.setAttribute('aria-selected', b.dataset.v === view); });
    if (view === 'details') { body.onclick = body.onkeydown = null; body.innerHTML = oDetails; wireDrawer(d); return; }
    if (hx?.id !== id) {
      body.innerHTML = '<div class="muted hx-empty">Putting the order history together…</div>';
      try {
        const data = DEMO ? demoHistory(id) : await j(`/api/order/${encodeURIComponent(id)}/history`);
        if (isStale(mine) || S.oView !== view || dCur?.id !== id || !$('#oBody')) return;
        hx = { id, data }; hxProd = null; hxSel = null; hxZoom = 'all';
      } catch (e) {
        if (!isStale(mine) && S.oView === view && dCur?.id === id) {
          body.innerHTML = `<div class="perr">${esc(e.message)}</div>`;
        }
        return;
      }
    }
    renderHx();
  }
  function renderHx() { keepFocus(paintHx); }
  function paintHx() {
    const body = $('#oBody'), h = hx.data;
    if (!h.events.length) { body.innerHTML = '<div class="muted hx-empty">No records on this order yet.</div>'; return; }
    body.innerHTML = hxBar(h) + (S.oView === 'activity' ? hxActivity(h) : hxTimeline(h));
    body.onkeydown = hxKeydown;
    body.onclick = hxClick;
  }
  function hxKeydown(ev) {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('li[data-ev]')) { ev.preventDefault(); ev.target.click(); }
  }
  function setHxFilter(t) {
    if (t.dataset.p !== undefined) hxProd = t.dataset.p && t.dataset.p !== hxProd ? t.dataset.p : null;
    else if (t.dataset.z) hxZoom = t.dataset.z;
    else if (t.dataset.unsel !== undefined) hxSel = null;
    else if (t.dataset.sel) hxSel = t.dataset.sel;
    else return false;
    return true;
  }
  function selectHxEvent(id) {
    if (S.oView !== 'activity') { hxSel = hxSel === id ? null : id; return false; }
    const e = hx.data.events.find((x) => x.id === id); if (!e) return true;
    if (e.obj === 'OrderSummary') showOrderView(hx.id, 'details');
    else if (e.obj && REC[e.obj]) drill(e.obj, e.id);
    else { hxSel = e.id; showOrderView(hx.id, 'timeline'); }
    return true;
  }
  function hxClick(ev) {
    const t = ev.target.closest('[data-p],[data-z],[data-ev],[data-sel],[data-open],[data-unsel]'); if (!t) return;
    if (!setHxFilter(t)) {
      if (t.dataset.open) { const [o, i] = t.dataset.open.split(':'); return o === 'OrderSummary' ? showOrderView(hx.id, 'details') : drill(o, i); }
      if (selectHxEvent(t.dataset.ev)) return;
    }
    renderHx();
    if (t.dataset.ev || t.dataset.sel) $('#oBody .hx-det')?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  function hxBar(h) {
    const ev = h.events, a = Math.min(...ev.map(hxStart)), b = Math.max(...ev.map(hxEnd)), open = ev.filter((e) => !e.end && (e.tone === 'open' || e.tone === 'warn')).length;
    return `<div class="hx-bar">
    <p class="hx-span"><b>${num(ev.length)}</b> records over <b>${b > a ? hxDur(b - a) : 'one moment'}</b>${open ? `, <b>${num(open)}</b> still open` : ', all closed'}</p>
    <div class="hx-pf" role="group" aria-label="Show one product"><button data-p="" class="${hxProd ? '' : 'on'}" aria-pressed="${!hxProd}">All products</button>${h.products.map((p) => `<button data-p="${esc(p.key)}" class="${hxProd === p.key ? 'on' : ''}${p.qty && p.canceled >= p.qty ? ' gone' : ''}" aria-pressed="${hxProd === p.key}" title="${p.qty && p.canceled >= p.qty ? 'Cancelled' : money(p.price)}"><span class="hx-ini">${esc(hxIni(p.name))}</span>${esc(p.name)}${p.qty > 1 ? ` <span class="muted">× ${num(p.qty)}</span>` : ''}</button>`).join('')}</div>
  </div>`;
  }
  function hxActivity(h) {
    const ev = h.events.filter(hxShows), days = [];
    for (const e of ev) {
      const k = hxDayKey(e.start); let g = days.at(-1);
      if (g?.k !== k) { g = { k, at: e.start, list: [] }; days.push(g); }
      g.list.push(e);
    }
    return `<div class="hx-act">${days.map(hxActivityDay).join('')}</div>`;
  }
  function hxActivityDay(g) {
    return `<section class="hx-day"><header><b>${esc(hxDay(g.at))}</b><span>${g.list.length} ${g.list.length === 1 ? 'record' : 'records'}</span></header><ol>${g.list.map(hxActivityEvent).join('')}</ol></section>`;
  }
  function hxActivityEvent(e) {
    const L = hxLane[e.lane] || hxLane.order, took = hxTook(e);
    return `<li class="hx-ev" data-ev="${esc(e.id)}" style="--c:${L.c}" tabindex="0"><time datetime="${esc(e.start)}">${esc(hxTime(e.start))}</time><i class="hx-dot ${esc(e.tone)}"></i>
      <div class="hx-main"><div class="hx-t">${esc(e.title)}${e.ref ? ` <span class="hx-ref">${esc(e.ref)}</span>` : ''}</div>
        <div class="hx-sub"><span class="hx-kind">${L.label}</span>${e.status ? pill(e.status) : ''}${e.sub ? `<span>${esc(e.sub)}</span>` : ''}${took ? `<span class="${/^open/.test(took) ? 'hx-open' : ''}">${took}</span>` : ''}</div>
        ${e.products.length ? `<div class="hx-chips">${hxChips(e.products, true)}</div>` : ''}</div>
      <div class="hx-amt${e.amount < 0 ? ' neg' : ''}">${hxSigned(e.amount)}</div></li>`;
  }
  function hxWindow(h) {
    const ev = hxZoom === 'all' ? h.events : h.events.filter((e) => hxDayKey(e.start) === hxZoom);
    if (!ev.length) { hxZoom = 'all'; return hxWindow(h); }
    let a = Math.min(...ev.map(hxStart)), b = Math.max(...ev.map(hxEnd));
    if (hxZoom !== 'all') { const d0 = new Date(ev[0].start); d0.setHours(0, 0, 0, 0); b = Math.min(b, +d0 + 864e5); const pad = Math.max((b - a) * 0.06, 30 * 60e3); return [Math.max(+d0, a - pad), Math.min(+d0 + 864e5, b + pad)]; }
    const pad = Math.max((b - a) * 0.03, 30 * 60e3); return [a - pad, b + pad];
  }
  function hxTicks(a, b) {
    const span = b - a, out = [];
    if (span > 36 * 3600e3) {
      const step = Math.max(1, Math.ceil(span / 864e5 / 9)), t = new Date(a); t.setHours(0, 0, 0, 0);
      for (let tick = t.setDate(t.getDate() + 1); tick < b; tick = t.setDate(t.getDate() + step)) out.push([tick, hxDay(t, false)]);
    } else {
      const step = (span <= 6 * 3600e3 ? 1 : span <= 14 * 3600e3 ? 2 : 3) * 3600e3, t = new Date(a); t.setMinutes(0, 0, 0);
      for (let x = +t + 3600e3; x < b; x += 3600e3) if (new Date(x).getHours() % (step / 3600e3) === 0) out.push([x, hxTime(x)]);
    }
    return out;
  }
  function hxTimeline(h) {
    const [a, b] = hxWindow(h), span = b - a, X = (t) => (t - a) / span * 100;
    const trackW = Math.min(1060, innerWidth) - 44 - 112, minW = Math.min(70, 156 / trackW * 100), gap = 6 / trackW * 100;
    const vis = h.events.filter((e) => hxEnd(e) >= a && hxStart(e) <= b);
    const sel = hxSel && h.events.find((e) => e.id === hxSel), lit = new Set(sel ? [sel.id, ...sel.rel] : []);
    const ticks = hxTicks(a, b), now = Date.now();
    const grid = ticks.map(([t]) => `<i class="hx-gl" style="left:${X(t)}%"></i>`).join('') + (now > a && now < b ? `<i class="hx-now" style="left:${X(now)}%"></i>` : '');
    const days = [...new Map(h.events.map((e) => [hxDayKey(e.start), e.start])).entries()];
    const layout = { X, minW, gap, sel, lit, grid };
    const lanes = HX_LANES.filter(([k]) => vis.some((e) => e.lane === k)).map((lane) => hxTimelineLane(lane, vis, layout)).join('');
    const zoom = [['all', 'Whole order'], ...days.slice(0, 8).map(([k, d]) => [k, hxDay(d, false)])].map(([k, l]) => `<button data-z="${esc(k)}" class="${hxZoom === k ? 'on' : ''}">${esc(l)}</button>`).join('');
    return `<div class="hx-tools"><div class="seg-ctl" role="group" aria-label="Zoom">${zoom}</div>
      <span class="muted">Select a record to see what it touched</span></div>
    <div class="hx-tl${sel ? ' picking' : ''}"><div class="hx-axis"><div></div><div class="hx-track">${ticks.map(([t, l]) => `<span style="left:${X(t)}%">${esc(l)}</span>`).join('')}</div></div>${lanes}</div>
    ${sel ? hxDetail(sel, h) : ''}`;
  }
  function hxBoxGeometry(e, ends, { X, minW, gap }) {
    const s = X(hxStart(e)), en = X(hxEnd(e)), w = Math.max(Math.min(en, 100) - Math.max(s, 0), minW), x = Math.max(0, Math.min(Math.max(s, 0), 100 - w));
    let r = ends.findIndex((v) => v + gap <= x); if (r < 0) { r = ends.push(0) - 1; }
    ends[r] = x + w;
    const ds = (Math.max(s, 0) - x) / w * 100, dw = Math.max(0, (Math.min(en, 100) - Math.max(s, 0)) / w * 100);
    return { x, w, r, ds, dw };
  }
  function hxBoxClasses(e, sel, lit) {
    return [e.tone, e.end && hxEnd(e) === hxStart(e) ? 'point' : '', !e.end && (e.tone === 'open' || e.tone === 'warn') ? 'live' : '', sel && e.id === sel.id ? 'sel' : '', sel && e.id !== sel.id && lit.has(e.id) ? 'rel' : '', !hxShows(e) ? 'dim' : ''].filter(Boolean).join(' ');
  }
  function hxTimelineBox(e, label, ends, layout) {
    const { x, w, r, ds, dw } = hxBoxGeometry(e, ends, layout), { sel, lit } = layout;
    const cls = hxBoxClasses(e, sel, lit);
    return `<button class="hx-box ${cls}" data-ev="${esc(e.id)}" style="left:${x}%;width:${w}%;top:${r * 74 + 8}px" aria-pressed="${!!sel && e.id === sel.id}" title="${esc([e.title, e.status, hxTook(e)].filter(Boolean).join(', '))}">
        <i class="hx-dur" style="left:${ds}%;width:${dw}%"></i>
        <span class="hx-b1"><b>${esc(e.ref || label)}</b>${e.status ? `<span class="hx-st"><s style="background:${statusColor(e.status)}"></s>${esc(e.status)}</span>` : ''}</span>
        <span class="hx-b2">${esc(e.title)}</span>
        <span class="hx-b3">${hxChips(e.products, false)}${e.amount != null ? `<em${e.amount < 0 ? ' class="neg"' : ''}>${hxSigned(e.amount)}</em>` : ''}</span></button>`;
  }
  function hxTimelineLane([k, label, c], vis, layout) {
    const ends = [], { grid } = layout;
    const boxes = vis.filter((e) => e.lane === k).sort((p, q) => hxStart(p) - hxStart(q)).map((e) => hxTimelineBox(e, label, ends, layout));
    return `<div class="hx-lane" style="--c:${c}"><div class="hx-ln"><s></s>${label}<span>${boxes.length}</span></div><div class="hx-track" style="height:${Math.max(1, ends.length) * 74 + 14}px">${grid}${boxes.join('')}</div></div>`;
  }
  function hxDetailProducts(products) {
    if (!products.length) return '';
    const rows = products.map((p) => {
      const x = hxProduct(p.key) || {}, qty = p.qty != null ? `× ${num(p.qty)}` : '';
      return `<tr style="cursor:default"><td><span class="hx-ini">${esc(hxIni(x.name || '?'))}</span> ${esc(x.name || 'Item')}</td><td class="num">${qty}</td><td class="num">${money(x.price)}</td></tr>`;
    }).join('');
    return '<h3>Products</h3>' + drawerTable(rows);
  }
  function hxDetail(e, h) {
    const L = hxLane[e.lane] || hxLane.order, took = hxTook(e), rel = e.rel.map((r) => h.events.find((x) => x.id === r)).filter(Boolean);
    const facts = [['Started', `${hxDay(e.start, false)}, ${hxTime(e.start)}`], ['Finished', e.end && hxEnd(e) > hxStart(e) ? `${hxDay(e.end, false)}, ${hxTime(e.end)}` : !e.end && took ? 'Still open' : ''],
      [/^open/.test(took) ? 'Open for' : 'Took', took.replace(/^(took|open for) /, '')], ['Amount', hxSigned(e.amount)], ['Note', e.sub]].filter(([, v]) => v);
    const noun = e.obj === 'OrderSummary' ? 'order details' : REC[e.obj]?.noun.toLowerCase();
    return `<div class="hx-det" style="--c:${L.c}">
    <div class="hx-dh"><div><span class="muted">${L.label}</span><b>${esc(e.ref || e.title)}</b>${e.status ? pill(e.status) : ''}<div class="hx-dt">${esc(e.title)}</div></div>
      <div class="hx-da">${noun ? `<button class="linkbtn" data-open="${esc(e.obj)}:${esc(e.id)}">Open ${esc(noun)}</button>` : ''}<button class="linkbtn" data-unsel aria-label="Clear selection">✕</button></div></div>
    <div class="facts">${facts.map(([k, v]) => `<div><span>${k}</span>${esc(v)}</div>`).join('')}</div>
    ${hxDetailProducts(e.products)}
    ${rel.length ? `<h3>Related</h3><div class="hx-rel">${rel.map((r) => `<button data-sel="${esc(r.id)}" style="--c:${(hxLane[r.lane] || L).c}"><s></s><b>${esc(r.ref || r.title)}</b> ${esc(r.title)}</button>`).join('')}</div>` : ''}
  </div>`;
  }

  // ---------- record drawers (Case, Process Exception, Fulfillment Order, Shipment, Return Order) ----------
  // Links inside a drawer drill down and remember where they came from, so Back walks the trail.
  let dStack = [], dCur = null;
  // What the open record drawer tells Agentforce (index.html puts it first in the context's facts): a fulfillment order's routing
  // explanation, which the agent can't read with its own actions (routingFacts above).
  let drawerFacts = [];
  function setDrawerFacts(list) { drawerFacts = list; S.agent?.contextChanged(); }
  const openAny = (obj, id) => obj === 'OrderSummary' ? openOrder(id) : obj === 'Account' ? openAccount(id) : openRecord(obj, id);
  function drill(obj, id) { if (dCur) { dStack.push(dCur); } openAny(obj, id); }
  function back() { const p = dStack.pop(); if (p) openAny(p.obj, p.id); }
  const recAttr = (obj, id) => id ? `data-rec="${obj}:${esc(id)}" tabindex="0"` : 'style="cursor:default"';
  const dHead = (noun, number, status) => `<div class="hd"><div>${dStack.length ? '<button class="linkbtn" id="dBack" style="margin-bottom:var(--sp-3)">← Back</button>' : ''}<div class="muted">${esc(noun)}</div><b>${esc(number || '—')}</b>${status ? ` <span class="pill" style="vertical-align:4px"><s style="background:${statusColor(status)}"></s>${esc(status)}</span>` : ''}</div><button id="closeDrawer" aria-label="Close">✕</button></div>`;
  const when = (d) => d ? new Date(d).toLocaleString() : '';
  const exItems = (list) => list?.length ? list.map((e) => `<div class="item" role="button" ${recAttr('ProcessException', e.Id)}><i class="edge ${esc(e.Severity)}"></i><span class="sev ${esc(e.Severity)}">${esc(e.Severity || '—')}</span><div><div class="t">${esc(e.Category || 'Exception')}${e.ProcessExceptionNumber ? ` <span class="muted">· ${esc(e.ProcessExceptionNumber)}</span>` : ''}</div><div class="s">${esc(e.Message || '')}</div></div><span class="pill">${esc(e.Status)}</span></div>`).join('') : '<div class="muted">None</div>';
  const caseRows = (list) => list.length ? `<table><tbody>${list.map((c) => `<tr ${recAttr('Case', c.Id)}><td><b>${esc(c.CaseNumber)}</b><div class="muted">${esc(c.Subject || '')}</div></td><td>${pill(c.Status)}</td><td class="muted">${esc(c.Priority || '')}</td><td class="muted">${ago(c.CreatedDate)}</td></tr>`).join('')}</tbody></table>` : '<div class="muted">No cases on this order.</div>';
  const prodCell = (l) => `${esc(l.Product2?.Name || 'Item')}${l.Product2?.ProductCode ? `<div class="muted mono">${esc(l.Product2.ProductCode)}</div>` : ''}`;
  // Fact values are plain text and get escaped; H() marks one that is already markup (money, place, links).
  const H = (html) => html ? { html } : null, factVal = (v) => v?.html ?? esc(v);
  // A customer name that opens their customer-value drawer.
  const acctLink = (id, name) => id ? `<button class="acct" data-acct="${esc(id)}" title="Customer value">${esc(name || 'Customer')} →</button>` : esc(name || '—');
  const orderLink = (r) => r.OrderSummaryId ? ['Order Summary', 'OrderSummary', r.OrderSummaryId, r.OrderSummary?.OrderNumber, r.OrderSummary?.Status] : null;
  // Routing explanation: the winning reason and score, each rule's share of it, and how much of each line this location could fill.
  const routingView = (x) => {
    const facts = [['Location', x.location], ['Reason', x.whyTip || x.why], ['Score', x.score != null && num(x.score)], ['Units filled', x.filled]].filter(([, v]) => v);
    const top = Math.max(...x.rules.map((r) => Number(r.score) || 0), 1);
    return `${facts.length ? `<div class="facts">${facts.map(([k, v]) => `<div><span>${k}</span>${esc(v)}</div>`).join('')}</div>` : ''}
    ${x.rules.length ? `<table><thead><tr><th>Rule</th><th class="num">Score</th></tr></thead><tbody>${x.rules.map((r) => `<tr style="cursor:default"><td>${esc(r.label)}${r.isOverride ? ' <span class="pill">override</span>' : ''}<div style="height:3px;margin-top:var(--sp-2);border-radius:var(--radius-xs);background:var(--signal);opacity:.7;width:${Math.max(0, (Number(r.score) || 0) / top * 100)}%"></div></td><td class="num">${num(r.score)}</td></tr>`).join('')}</tbody></table>` : ''}
    ${x.lines.length ? `<table><thead><tr><th>SKU</th><th class="num">Filled</th><th class="num">Requested</th></tr></thead><tbody>${x.lines.map((l) => `<tr style="cursor:default"><td class="mono">${esc(l.sku)}</td><td class="num">${num(l.filled)}</td><td class="num">${num(l.requested)}</td></tr>`).join('')}</tbody></table>` : ''}
    ${x.scoreTip ? `<div class="muted" style="font-size:var(--fs-xs);margin-top:var(--sp-3)">${esc(x.scoreTip)}</div>` : ''}`;
  };
  const REC = {
    Case: { noun: 'Case', num: (r) => r.CaseNumber,
      facts: (r) => [['Priority', r.Priority], ['Type', r.Type], ['Origin', r.Origin], ['Reason', r.Reason], ['Customer', r.Account?.Name && H(acctLink(r.AccountId, r.Account.Name))], ['Contact', r.Contact?.Name || r.SuppliedEmail], ['Owner', r.Owner?.Name], ['Opened', when(r.CreatedDate)], ['Closed', when(r.ClosedDate)]],
      text: (r) => [['Subject', r.Subject], ['Description', r.Description]],
      links: (r) => [orderLink(r)],
      related: { exceptions: ['Process exceptions', exItems] } },
    ProcessException: { noun: 'Process Exception', num: (r) => r.ProcessExceptionNumber,
      facts: (r) => [['Category', r.Category], ['Severity', r.Severity], ['Priority', r.Priority], ['Attached to', [r.AttachedTo?.Type, r.AttachedTo?.Name].filter(Boolean).join(' · ')], ['Owner', r.Owner?.Name], ['External ref', r.ExternalReference], ['Raised', when(r.CreatedDate)], ['Updated', when(r.LastModifiedDate)]],
      text: (r) => [['Message', r.Message], ['Description', r.Description]],
      links: (r) => [orderLink(r), r.CaseId && ['Case', 'Case', r.CaseId, r.Case?.CaseNumber, r.Case?.Status, r.Case?.Subject],
        REC[r.AttachedTo?.Type] && r.AttachedToId !== r.OrderSummaryId && [REC[r.AttachedTo.Type].noun, r.AttachedTo.Type, r.AttachedToId, r.AttachedTo.Name]] },
    FulfillmentOrder: { noun: 'Fulfillment Order', num: (r) => r.FulfillmentOrderNumber,
      facts: (r) => [['Type', r.Type], ['From', r.FulfilledFromLocation?.Name], ['Ship to', H(place(r.FulfilledToName, r.FulfilledToCity, r.FulfilledToState))], ['Delivery', r.DeliveryMethod?.Name], ['Total', r.GrandTotalAmount != null && H(money(r.GrandTotalAmount))], ['Created', when(r.CreatedDate)]],
      links: (r) => [orderLink(r)],
      extra: (r) => r.FulfilledFromLocationId ? `<p><button class="linkbtn" data-loc="${esc(r.FulfilledFromLocationId)}">Focus ${esc(r.FulfilledFromLocation?.Name || 'location')} on map</button></p>` : '',
      related: { routing: ['Why this location', routingView],
        lines: ['Line items', (l) => l.length ? `<table><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Ordered</th><th class="num">Total</th></tr></thead><tbody>${l.map((i) => `<tr style="cursor:default"><td>${prodCell(i)}</td><td class="num">${num(i.Quantity)}</td><td class="num">${num(i.OriginalQuantity)}</td><td class="num">${money(i.TotalPrice)}</td></tr>`).join('')}</tbody></table>` : '<div class="muted">None</div>'],
        shipments: ['Shipments', (l) => l.length ? `<table><tbody>${l.map((h) => `<tr ${recAttr('Shipment', h.Id)}><td><b>${esc(h.ShipmentNumber)}</b><div class="muted">${esc([h.Provider, h.TrackingNumber].filter(Boolean).join(' · '))}</div></td><td>${pill(h.Status)}</td><td class="muted">${h.ActualDeliveryDate ? `Delivered ${shortDate(h.ActualDeliveryDate)}` : h.ExpectedDeliveryDate ? `ETA ${shortDate(h.ExpectedDeliveryDate)}` : ''}</td></tr>`).join('')}</tbody></table>` : '<div class="muted">Not shipped yet</div>'],
        exceptions: ['Process exceptions', exItems] } },
    Shipment: { noun: 'Shipment', num: (r) => r.ShipmentNumber,
      facts: (r) => [['Carrier', r.Provider], ['Tracking', r.TrackingNumber && H(/^https:\/\//i.test(r.TrackingUrl || '') ? `<a href="${esc(r.TrackingUrl)}" target="_blank" rel="noopener">${esc(r.TrackingNumber)} ↗</a>` : `<span class="mono">${esc(r.TrackingNumber)}</span>`)], ['Ship to', H(place(r.ShipToName, r.ShipToCity, r.ShipToState))], ['ETA', when(r.ExpectedDeliveryDate)], ['Delivered', when(r.ActualDeliveryDate)], ['Created', when(r.CreatedDate)]],
      links: (r) => [orderLink(r), r.FulfillmentOrderId && ['Fulfillment Order', 'FulfillmentOrder', r.FulfillmentOrderId, r.FulfillmentOrder?.FulfillmentOrderNumber, r.FulfillmentOrder?.Status]],
      related: { items: ['Items', (l) => l.length ? `<table><thead><tr><th>Item</th><th class="num">Qty</th></tr></thead><tbody>${l.map((i) => `<tr style="cursor:default"><td>${prodCell(i)}</td><td class="num">${num(i.Quantity)}</td></tr>`).join('')}</tbody></table>` : '<div class="muted">None</div>'] } },
    ReturnOrder: { noun: 'Return Order', num: (r) => r.ReturnOrderNumber,
      facts: (r) => [['Customer', r.Account?.Name && H(acctLink(r.AccountId, r.Account.Name))], ['Value', r.GrandTotalAmount != null && H(money(r.GrandTotalAmount))], ['Created', when(r.CreatedDate)], ['Updated', when(r.LastModifiedDate)]],
      text: (r) => [['Description', r.Description]],
      links: (r) => [orderLink(r)],
      related: { lines: ['Return lines', (l) => { l = l.filter((i) => !i.TypeCode || i.TypeCode === 'Product'); return l.length ? `<table><thead><tr><th>Item</th><th class="num">Returned</th><th>Reason</th></tr></thead><tbody>${l.map((i) => `<tr style="cursor:default"><td>${prodCell(i)}</td><td class="num">${num(i.QuantityReturned ?? i.QuantityExpected)}</td><td class="muted">${esc(i.ReasonForReturn || '')}</td></tr>`).join('')}</tbody></table>` : '<div class="muted">No product lines</div>'; }],
        exceptions: ['Process exceptions', exItems] } },
  };

  function recordLinks(links) {
    if (!links.length) return '';
    const rows = links.map(([noun, obj, id, number, status, sub]) => {
      const text = sub ? `<div class="muted">${esc(sub)}</div>` : '';
      return `<tr ${recAttr(obj, id)}><td><div class="muted">${esc(noun)}</div><b>${esc(number || id)}</b>${text}</td><td class="num">${status ? pill(status) : ''}</td></tr>`;
    }).join('');
    return '<h3>Linked records</h3>' + drawerTable(rows);
  }
  function recordDetails(v, r, related, recordUrl) {
    const facts = v.facts(r).filter(([, x]) => x), links = (v.links?.(r) || []).filter(Boolean);
    const text = (v.text?.(r) || []).filter(([, x]) => x).map(([k, x]) => `<div style="margin-top:var(--sp-7)"><div class="muted" style="font-size:var(--fs-xs)">${k}</div><div style="white-space:pre-wrap">${esc(x)}</div></div>`).join('');
    const sections = Object.entries(v.related || {}).filter(([k]) => related[k]).map(([k, [title, render]]) => `<h3>${title}</h3>${render(related[k])}`).join('');
    return `${dHead(v.noun, v.num(r), r.Status)}
      ${text}
      ${factList(facts)}
      ${recordLinks(links)}
      ${v.extra?.(r) || ''}
      ${sections}
      ${salesforceLink(recordUrl)}`;
  }
  async function openRecord(obj, id) {
    const v = REC[obj]; if (!v) return;
    const mine = ++drawerSeq;
    dCur = { obj, id };
    const d = $('#drawer'); d.classList.remove('hide', 'wide'); $('#scrim').classList.remove('hide'); enterLayer(d);
    d.innerHTML = '<div class="muted">Loading…</div>';
    try {
      const { record: r, related = {}, recordUrl } = DEMO ? demoRecord(obj, id) : await j(`/api/record/${obj}/${encodeURIComponent(id)}`);
      if (isStale(mine)) return;
      d.innerHTML = recordDetails(v, r, related, recordUrl);
      wireDrawer(d);
      setDrawerFacts(obj === 'FulfillmentOrder' ? routingFacts(r, related.routing) : []);
    } catch (e) {
      if (isStale(mine)) { return; }
      drawerError(d, e);
    }
    $('#closeDrawer').onclick = closeDrawer;
  }
  // ---------- customer value drawer ----------
  // Everything is computed when the drawer opens (GET /api/account/:id): spend and orders, returns, and where this customer
  // ranks among all shoppers and all returners, so a big spender and a big returner read differently at a glance.
  const rankTxt = (r, who) => r ? `#${r.capped ? '2000+' : num(r.pos)} of ${num(r.of)} ${who}` : '—';
  const topPct = (r) => r && !r.capped ? Math.max(1, Math.ceil(r.pos / r.of * 100)) : null;
  function returnBadges(rp, rt) {
    if ((rp != null && rp <= 10) || rt?.rate >= .25) return [['warn', rp != null && rp <= 10 ? `Top ${rp}% returner` : `Returns ${pct(rt.rate)} of spend`]];
    return [];
  }
  function lastOrderBadges(last) {
    if (!last) return [];
    const days = (Date.now() - new Date(last)) / 864e5;
    if (days > 365) return [['warn', 'Lapsed · no order in 12 months']];
    if (days > 180) return [['warn', 'Cooling · no order in 6 months']];
    return [['', 'Active']];
  }
  function valueBadges(a) {
    const v = a.value, rt = a.returns, out = [], sp = topPct(v?.rank.spend), op = topPct(v?.rank.orders), rp = topPct(rt?.rank);
    if (sp != null && sp <= 10) out.push(['good', `Top ${sp}% by spend`]);
    if (op != null && op <= 10) out.push(['good', `Top ${op}% by orders`]);
    out.push(...returnBadges(rp, rt));
    if (v?.orders && rt && !rt.n) out.push(['good', 'Never returned']);
    out.push(...lastOrderBadges(v?.last));
    const tier = a.loyalty?.members?.flatMap((m) => m.tiers)[0];
    if (tier) out.push(['good', `${tier.LoyaltyTier?.Name || tier.Name} tier`]);
    return out.length ? `<div class="badges">${out.map(([c, t]) => `<span class="badge ${c}">${esc(t)}</span>`).join('')}</div>` : '';
  }
  const rankRow = (label, r, who, warn) => `<tr style="cursor:default"><td>${label}<div class="rankbar ${warn ? 'warn' : ''}"><i style="width:${r ? Math.max(2, (1 - (r.pos - 1) / r.of) * 100) : 0}%"></i></div></td><td class="num">${rankTxt(r, who)}</td><td class="num muted">${topPct(r) != null ? `top ${topPct(r)}%` : ''}</td></tr>`;
  function loyaltyView(l, objects) {
    if (!objects.LoyaltyProgramMember) return '<div class="muted">Loyalty Management isn\'t enabled in this org.</div>';
    if (l?.error) return `<div class="perr">${esc(l.error)}</div>`;
    if (!l?.members.length) return '<div class="muted">Not a loyalty member.</div>';
    return l.members.map((m) => `<div class="facts">${[['Program', m.Program?.Name], ['Member #', m.MembershipNumber], ['Status', m.MemberStatus], ['Tier', m.tiers.map((t) => t.LoyaltyTier?.Name || t.Name).join(', ')], ['Enrolled', m.EnrollmentDate && new Date(m.EnrollmentDate).toLocaleDateString()], ['Type', m.MemberType]].filter(([, x]) => x).map(([k, x]) => `<div><span>${k}</span>${esc(x)}</div>`).join('')}</div>
    ${m.points.length ? `<table><thead><tr><th>Currency</th><th class="num">Balance</th><th class="num">Earned</th><th class="num">Redeemed</th></tr></thead><tbody>${m.points.map((p) => `<tr style="cursor:default"><td>${esc(p.Name)}</td><td class="num"><b>${num(p.PointsBalance)}</b></td><td class="num">${num(p.TotalPointsAccrued)}</td><td class="num">${num(p.TotalPointsRedeemed)}</td></tr>`).join('')}</tbody></table>` : ''}`).join('');
  }
  function returnRate(rt) {
    if (rt.rate != null) return `${pct(rt.rate)} <span class="muted">of spend</span>`;
    if (rt.perOrder != null) return `${pct(rt.perOrder)} of orders`;
    return '—';
  }
  function returnKpis(v, rt) {
    const amount = rt?.amount != null ? ` <span class="muted">· ${money(rt.amount)}</span>` : '';
    return [
      rt && ['Returns', H(`${num(rt.n)}${amount}`)],
      rt && ['Return rate', H(returnRate(rt))],
      v && rt?.amount != null && ['Net of returns', H(money(v.spend - rt.amount))],
      rt?.units != null && ['Units returned', num(rt.units)],
    ].filter(Boolean);
  }
  function accountKpis(a) {
    const v = a.value, rt = a.returns;
    return [
      v && ['Lifetime spend', H(money(v.spend))], v && ['Orders', num(v.orders)], v && ['Avg order', H(money(v.aov))],
      v?.last12 && ['Last 12 months', H(`${money(v.last12.amount)} <span class="muted">· ${num(v.last12.n)} orders</span>`)],
      ...returnKpis(v, rt),
      v && ['Last order', v.last ? `${shortDate(v.last)} · ${ago(v.last)}` : '—'], v && ['First order', v.first ? new Date(v.first).toLocaleDateString() : '—'],
      v && ['Canceled orders', num(v.canceled)], a.cases && ['Cases', `${num(a.cases.open)} open · ${num(a.cases.closed)} closed`],
    ].filter(Boolean);
  }
  function accountComparison(v, rt) {
    if (!v) return '';
    const returns = rt ? rankRow('By number of returns', rt.rank, 'returners', true) : '';
    const empty = rt && !rt.n ? '<div class="muted" style="font-size:var(--fs-xs);margin-top:var(--sp-3)">No returns, so not ranked among returners.</div>' : '';
    return `<h3>Compared with other customers <span class="muted">last 12 months</span></h3><table><tbody>${rankRow('By spend', v.rank.spend, 'shoppers')}${rankRow('By number of orders', v.rank.orders, 'shoppers')}${returns}</tbody></table>${empty}`;
  }
  function accountOrders(list) {
    if (!list) return '';
    const rows = list.map((o) => `<tr ${recAttr('OrderSummary', o.Id)}><td><b>${esc(o.OrderNumber)}</b><div class="muted">${esc(o.SalesChannel?.SalesChannelName || '')}</div></td><td>${pill(o.Status)}</td><td class="num">${money(o.GrandTotalAmount)}</td><td class="muted">${ago(o.OrderedDate || o.CreatedDate)}</td></tr>`).join('');
    const body = list.length ? drawerTable(rows) : '<div class="muted">No orders.</div>';
    return '<h3>Recent orders</h3>' + body;
  }
  function accountReturns(rt) {
    if (!rt?.recent?.length) return '';
    const rows = rt.recent.map((r) => {
      const order = r.OrderSummary?.OrderNumber ? `Order ${esc(r.OrderSummary.OrderNumber)}` : '';
      return `<tr ${recAttr('ReturnOrder', r.Id)}><td><b>${esc(r.ReturnOrderNumber)}</b><div class="muted">${order}</div></td><td>${pill(r.Status)}</td><td class="num">${money(r.GrandTotalAmount)}</td><td class="muted">${ago(r.CreatedDate)}</td></tr>`;
    }).join('');
    return '<h3>Recent returns</h3>' + drawerTable(rows);
  }
  function accountInfo(ac) {
    return [['Type', ac.IsPersonAccount ? 'Person account' : ac.Type], ['Rating', ac.Rating], ['Industry', ac.Industry], ['Email', ac.PersonEmail], ['Phone', ac.Phone || ac.PersonMobilePhone],
        ['Bill to', [ac.BillingCity, ac.BillingState].filter(Boolean).join(', ')], ['Annual revenue', ac.AnnualRevenue != null && H(money(ac.AnnualRevenue))], ['Owner', ac.Owner?.Name], ['Created', ac.CreatedDate && new Date(ac.CreatedDate).toLocaleDateString()]].filter(([, x]) => x);
  }
  function returnReasons(rt) {
    if (!rt?.reasons?.length) return '';
    const rows = rt.reasons.slice(0, 6).map((r) => `<tr style="cursor:default"><td>${esc(r.key)}</td><td class="num">${num(r.n)}</td><td class="num">${num(r.units)}</td></tr>`).join('');
    return '<h3>Why they return</h3>' + drawerTable(rows, '<thead><tr><th>Reason</th><th class="num">Lines</th><th class="num">Units</th></tr></thead>');
  }
  function accountDetails(a) {
    const ac = a.account, v = a.value, rt = a.returns;
    const kpis = accountKpis(a), info = accountInfo(ac);
    const unavailable = !a.objects.OrderSummary ? `<div class="muted" style="margin-top:var(--sp-7)">${na('OrderSummary')}</div>` : '';
    const account = info.length ? '<h3>Account</h3>' + factList(info, ' style="margin-top:0"') : '';
    return `${dHead('Customer', ac.Name)}
      ${valueBadges(a)}
      ${unavailable}
      ${factList(kpis)}
      ${accountComparison(v, rt)}
      <h3>Loyalty</h3>${loyaltyView(a.loyalty, a.objects)}
      ${returnReasons(rt)}
      ${accountOrders(a.recentOrders)}
      ${accountReturns(rt)}
      ${account}
      ${salesforceLink(a.recordUrl)}`;
  }
  async function openAccount(id) {
    const mine = ++drawerSeq;
    dCur = { obj: 'Account', id }; setDrawerFacts([]);
    const d = $('#drawer'); d.classList.remove('hide', 'wide'); $('#scrim').classList.remove('hide'); enterLayer(d);
    d.innerHTML = '<div class="muted">Working out customer value…</div>';
    try {
      const a = DEMO ? demoAccount(id) : await j(`/api/account/${encodeURIComponent(id)}`);
      if (isStale(mine)) return;
      d.innerHTML = accountDetails(a);
      wireDrawer(d);
    } catch (e) {
      if (isStale(mine)) { return; }
      drawerError(d, e);
    }
    $('#closeDrawer').onclick = closeDrawer;
  }

  function wireDrawer(d) {
    d.querySelectorAll('[data-rec]').forEach((el) => el.onclick = (e) => { if (e.target.closest('button,a')) { return; } const [o, i] = el.dataset.rec.split(':'); drill(o, i); });
    d.querySelectorAll('[data-acct]').forEach((b) => b.onclick = () => drill('Account', b.dataset.acct));
    d.querySelectorAll('[data-loc]').forEach((b) => b.onclick = () => {
      const c = S.geo.clusters.find((k) => k.items.some((l) => l.id === b.dataset.loc || l.id.slice(0, 15) === b.dataset.loc.slice(0, 15)));
      closeDrawer(); if (c) { S.focusKey = c.key; renderMap(); }
    });
    const bk = d.querySelector('#dBack'); if (bk) bk.onclick = back;
  }
  function closeModal() { $('#modal').classList.add('hide'); $('#scrim').classList.add('hide'); leaveLayer($('#modal')); }
  $('#scrim').onclick = () => { closeDrawer(); closeModal(); };
  // The drawer and the Data map open over the page, behind the scrim: focus moves to them, Tab stays inside while it's
  // there, and closing puts focus back where it was (or on its counterpart, if a refresh redrew it meanwhile).
  const layerFrom = new Map();
  function enterLayer(el) {
    if (!layerFrom.has(el)) { const a = document.activeElement; layerFrom.set(el, { el: a, sel: a && a !== document.body ? focusSel(a) : null }); }
    el.tabIndex = -1; el.focus({ preventScroll: true });
  }
  function leaveLayer(el) {
    const from = layerFrom.get(el); if (!from) return;
    layerFrom.delete(el);
    (from.el?.isConnected && from.el !== document.body ? from.el : from.sel && document.querySelector(from.sel))?.focus({ preventScroll: true });
  }
  function trapLayerTab(e) {
    const el = [...layerFrom.keys()].find((x) => !x.classList.contains('hide') && x.contains(document.activeElement)); if (!el) return;
    const f = [...el.querySelectorAll(`${NATIVE},[tabindex="0"]`)].filter((x) => !x.disabled && x.getClientRects().length);
    if (!f.length) return;
    const at = document.activeElement, first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (at === first || at === el)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
  }
  // A layer redraws its own content (a tab, a drill-down, Back). If that took the focused control away, focus goes to the
  // layer instead of falling out to the page behind it.
  function observeLayerFocus(el) {
    new MutationObserver(() => {
      if (layerFrom.has(el) && !el.classList.contains('hide') && (!document.activeElement || document.activeElement === document.body)) el.focus({ preventScroll: true });
    }).observe(el, { childList: true, subtree: true });
  }
  observeLayerFocus($('#drawer'));
  observeLayerFocus($('#modal'));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') return trapLayerTab(e);
    // Enter or Space on a focusable row or mark (tabindex="0", not a native control) clicks it. This runs before the shortcuts
    // below, so Space opens the row rather than switching auto-refresh.
    const t = e.target;
    if ((e.key === 'Enter' || e.key === ' ') && !e.defaultPrevented && t.getAttribute?.('tabindex') === '0' && !t.matches(NATIVE)) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (!e.repeat) t.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }
  });
  function viewShortcuts(e) {
    if ((e.key === 'v' || e.key === 'V') && !e.metaKey && !e.ctrlKey && !$('#app').classList.contains('hide') && !e.target.closest('input,select,textarea')) setMode(MODES[(MODES.indexOf(S.mode) + 1) % MODES.length]);
    if ((e.key === 'a' || e.key === 'A') && !e.metaKey && !e.ctrlKey && !e.altKey && !$('#app').classList.contains('hide') && !e.target.closest('input,select,textarea')) S.agent?.toggle();
  }
  function escapeShortcut() {
    if (S.agent?.isOpen()) S.agent.close(); else if (mapZone().classList.contains('maxi')) toggleFull(); else if (!$('#modal').classList.contains('hide')) closeModal(); else if (!$('#drawer').classList.contains('hide')) closeDrawer(); else if (S.focusKey) { S.focusKey = null; renderMap(); } else if (S.prod) clearProduct();
  }
  function mapShortcut(e) {
    if (S.mode === 'console' && ['+', '=', '-', '_', '0', 'f', 'F'].includes(e.key) && !e.metaKey && !e.ctrlKey && !$('#app').classList.contains('hide') && !e.target.closest('input,select,textarea') && $('#drawer').classList.contains('hide') && $('#modal').classList.contains('hide') && !$('#mapwrap').closest('.hide')) { if (e.key === 'f' || e.key === 'F') toggleFull(); else if (e.key === '0') resetZoom(); else zoomBy(e.key === '+' || e.key === '=' ? 2 : 0.5); }
  }
  function dashboardShortcut(e) {
    if (S.mode === 'dashboard' && /^[1-9]$/.test(e.key) && e.key <= DOMAINS.length && !e.metaKey && !e.ctrlKey && !e.altKey && !e.target.closest('input,select,textarea') && $('#drawer').classList.contains('hide') && $('#modal').classList.contains('hide')) setDTab(DOMAINS[e.key - 1][0]);
  }
  function serviceShortcuts(e) {
    if (S.mode === 'service' && (e.key === 'j' || e.key === 'k' || e.key === 'Enter') && !e.metaKey && !e.ctrlKey && !e.altKey && !$('#app').classList.contains('hide') && !e.target.closest('input,select,textarea,button,a') && $('#drawer').classList.contains('hide') && $('#modal').classList.contains('hide')) { e.preventDefault(); if (e.key === 'Enter') { if (S.qSel) openQueueItem(S.qSel); } else moveQueue(e.key === 'j' ? 1 : -1); }
    if (e.key === '/' && S.mode === 'service' && !e.metaKey && !e.ctrlKey && !$('#app').classList.contains('hide') && !e.target.closest('input,select,textarea') && $('#drawer').classList.contains('hide') && $('#modal').classList.contains('hide')) { e.preventDefault(); $('#svcSearch').focus(); }
  }
  function shortcuts(e) {
    if (e.defaultPrevented) return; // a control handled the key itself (the timeline's rows, the queue, a chart)
    viewShortcuts(e);
    if (e.key === 'Escape') escapeShortcut();
    mapShortcut(e);
    dashboardShortcut(e);
    serviceShortcuts(e);
    if (e.key === ' ' && !$('#app').classList.contains('hide') && !e.target.closest('input,select,textarea,button,summary')) { e.preventDefault(); setLive(!S.live); }
  }
  document.addEventListener('keydown', shortcuts);

  return { STEPS, stepOf, openOrder, closeDrawer, openAny, recAttr, caseRows, acctLink, openRecord, closeModal, enterLayer, drawerFacts: () => drawerFacts };
}
