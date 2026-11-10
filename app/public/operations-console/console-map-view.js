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
// Salesforce Order Management Operations Console's Operations Console view: KPIs, the fulfillment network map (layers, focus, zoom and pan), product search with
// its inventory layer, exceptions and the activity stream. Page state is S (console-state.js); the console's other functions
// come in on `page`.
import { keepFocus, $, ago, esc, num, money, pct, tipAt } from './console-kit.js';
import { S } from './console-state.js';
import { RANGE_LABEL, scopeQuery } from './console-labels.js';
import { toAbbr, STATES, proj, RAMP, LAYERS, rampAt, ringArc } from './console-geo.js';
import { na } from './console-charts.js';
import { DEMO } from '../shared/transport/om-mode.js';
import { DEMO_PRODUCTS, demoInventory } from './console-demo.js';

// page: the console's functions and constants this part uses.
export function createMapView(page) {
  const { REDUCED, j, openAny, openRecord, rangeText, syncTitle } = page;
  // ---------- render ----------
  function render() { keepFocus(() => { buildGeo(); renderNotice(); renderKpis(); renderMap(); renderExceptions(); renderBoard(); renderStream(); }); S.agent?.contextChanged(); syncTitle(); }
  function renderNotice() {
    const k = S.data.kpis.ok ? S.data.kpis.data : {}, el = $('#notice');
    if (k.orders !== 0 || !S.data.latestOrder) return el.classList.add('hide');
    const fit = ['today', '7d', '30d', '90d', '6m', '1y'].find((r) => Date.now() - new Date(S.data.latestOrder) < { today: 0, '7d': 7, '30d': 30, '90d': 90, '6m': 182, '1y': 365 }[r] * 864e5);
    el.classList.remove('hide');
    el.innerHTML = `<b>No orders ${rangeText()}.</b> The newest Order Summary in this org is from ${new Date(S.data.latestOrder).toLocaleDateString()} (${ago(S.data.latestOrder)}).${fit ? `<button data-v="${fit}">Show ${RANGE_LABEL[fit]}</button>` : ''}`;
    el.querySelector('button')?.addEventListener('click', (e) => $(`#range [data-v="${e.target.dataset.v}"]`).click());
  }
  // A panel's error, or a note when one of its queries hit Salesforce's 2,000-row cap (large orgs), so the numbers aren't read as complete.
  const perr = (p) => p && !p.ok ? `<div class="perr">${esc(p.error)}</div>` : p?.capped ? '<div class="pcap">Based on the first 2,000 rows Salesforce returns, so the full figure may be higher.</div>' : '';
  const rows = (p) => (p && p.ok ? p.data : []);

  function renderKpis() {
    const k = S.data.kpis.ok ? S.data.kpis.data : {};
    const cells = [
      ['Orders', num(k.orders), 'good', rangeText()],
      ['Order value', money(k.value), 'good', k.orders ? `${money(k.value / k.orders)} average` : ''],
      ['Open exceptions', num(k.openExceptions), k.openExceptions > 0 ? 'warn' : '', k.openExceptions ? `raised ${rangeText()}` : `none raised ${rangeText()}`],
      ['Waiting on you', S.data.objects.Agent_Proposal__c ? num(k.waiting) : '—', 'agent', S.data.objects.Agent_Proposal__c ? 'agent proposals to decide' : 'Agent_Proposal__c not deployed'],
      ['Stuck > 2h', num(k.stuck), k.stuck > 0 ? 'bad' : '', 'Allocated/Pickpack · right now'],
      ['Payment holds', num(k.paymentHolds), k.paymentHolds > 0 ? 'warn' : '', `open, raised ${rangeText()}`],
      ['Returns', S.data.objects.ReturnOrder === false ? '—' : num(k.returns), '', S.data.objects.ReturnOrder === false ? 'ReturnOrder not in this org' : k.returns ? `${money(k.returnValue)} · ${rangeText()}` : `none ${rangeText()}`],
    ];
    $('#kpis').innerHTML = cells.map(([l, v, c, s]) => `<div class="kpi ${c}"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${esc(s)}</div></div>`).join('') + (S.data.kpis.ok ? '' : `<div class="kpi" style="grid-column:1/-1">${perr(S.data.kpis)}</div>`);
  }

  // City coordinates: public/cities.js, plus the org's own Location addresses. Keys are "ST|normalized name".
  const cityKey = (a, name) => a + '|' + String(name || '').toLowerCase().replace(/\./g, '').replace(/\bsaint\b/g, 'st').replace(/\s+/g, ' ').trim();
  const CITY = {};
  Object.entries(window.US_CITIES || {}).forEach(([a, list]) => list.split('|').forEach((e) => { const t = e.split(' '), lon = +t.pop(), lat = +t.pop(); CITY[cityKey(a, t.join(' '))] = [lat, lon, t.join(' ')]; }));
  // Customer cities → map points. Cities the table doesn't know are pooled at their state's center (drawn dashed); no state → `other`.
  function placeCities(locs) {
    const pts = {}, known = { ...CITY };
    locs.forEach((l) => { const a = toAbbr(l.state); if (a && l.city && l.lat != null) known[cityKey(a, l.city)] ||= [l.lat, l.lon, l.city]; });
    let other = 0;
    (S.data.customers?.ok ? S.data.customers.data?.cities || [] : []).forEach((c) => {
      const a = toAbbr(c.state); if (!a) { other += c.n; return; }
      const ll = c.city && known[cityKey(a, c.city)], id = ll ? `${ll[0]},${ll[1]}` : a + '|*'; // same coordinates = same place ("New York" / "NYC")
      const p = pts[id] ||= { id, a, city: ll ? ll[2] : null, approx: !ll, ll: ll || [STATES[a][1], STATES[a][2]], n: 0, orders: 0, spend: 0, top: [], names: new Set() };
      p.n += c.n; p.orders += c.orders; p.spend += c.spend; if (!ll && c.city) p.names.add(c.city.trim());
      p.top = [...p.top, ...c.top].sort((x, y) => y.spend - x.spend).slice(0, 3);
    });
    const list = Object.values(pts).sort((x, y) => y.n - x.n || y.spend - x.spend);
    list.forEach((p, i) => { p.i = i; [p.x, p.y] = proj(p.ll[1], p.ll[0]); p.label = p.city ? `${p.city}, ${p.a}` : `Other ${p.a} cities`; });
    return { list, other, approx: list.filter((p) => p.approx).reduce((s, p) => s + p.n, 0) };
  }

  // Derive everything the map needs once per refresh.
  function buildGeo() {
    const sum = (list) => { const o = {}; let other = 0; list.forEach((d) => { const a = toAbbr(d.key ?? d.state); if (a) o[a] = (o[a] || 0) + d.n; else other += d.n; }); return { by: o, other }; };
    const locs = rows(S.data.network);
    // Many OM orgs co-locate several locations in one metro; cluster nodes within 18px so labels stay legible.
    const clusters = [], clusterOf = {};
    locs.forEach((l) => {
      const [x, y] = proj(l.lon, l.lat);
      let c = clusters.find((k) => Math.hypot(k.x - x, k.y - y) < 18);
      if (!c) clusters.push(c = { key: 'c' + clusters.length, x, y, items: [] });
      c.items.push(l); clusterOf[l.id] = c;
    });
    clusters.forEach((c) => {
      c.cap = c.items.reduce((s, l) => s + (l.cap || 0), 0); c.used = c.items.reduce((s, l) => s + (l.assigned ?? 0), 0);
      c.open = c.items.reduce((s, l) => s + l.openFOs, 0); c.load = c.cap ? c.used / c.cap : null;
      c.store = c.items.every((l) => /store|retail/i.test(l.type || ''));
      c.label = c.items.length === 1 ? c.items[0].name : `${c.items[0].city || c.items[0].name} · ${c.items.length} locations`;
      c.out = {}; c.shipped = 0;
    });
    const flows = {};
    rows(S.data.flows).forEach((f) => {
      const c = clusterOf[f.loc], a = toAbbr(f.state); if (!c || !a) return;
      const k = c.key + '>' + a; flows[k] = flows[k] || { c, a, n: 0 }; flows[k].n += f.n;
      c.out[a] = (c.out[a] || 0) + f.n; c.shipped += f.n;
    });
    const fulfill = {}; Object.values(flows).forEach((f) => fulfill[f.a] = (fulfill[f.a] || 0) + f.n);
    const cu = S.data.customers?.ok ? S.data.customers.data?.states || [] : [], custInfo = {};
    cu.forEach((d) => { const a = toAbbr(d.key); if (!a) return; const x = custInfo[a] ||= { orders: 0, spend: 0 }; x.orders += d.orders; x.spend += d.spend; });
    const cl = S.data.cases?.ok ? S.data.cases.data?.list || [] : [], caseInfo = {};
    cl.forEach((d) => { const a = toAbbr(d.key); if (!a) return; const x = caseInfo[a] ||= { open: 0, closed: 0, origin: {}, type: {} }; x.open += d.open; x.closed += d.closed; ['origin', 'type'].forEach((f) => Object.entries(d[f] || {}).forEach(([k, n]) => x[f][k] = (x[f][k] || 0) + n)); });
    S.geo = { demand: sum(rows(S.data.demand)), fulfill: { by: fulfill, other: 0 }, risk: sum(rows(S.data.exByState)), customers: sum(cu), custInfo, cities: placeCities(locs), cases: sum(cl), caseInfo, clusters, clusterOf, flows: Object.values(flows) };
    if (S.focusKey && !clusters.some((c) => c.key === S.focusKey)) S.focusKey = null;
  }

  // Product overlay: quantities per map cluster, per state (via the location's state, or the fallback's ship-to states), and what can't be drawn.
  function prodGeo() {
    const inv = S.prod?.inv; if (!inv) return null;
    const byId = Object.fromEntries(rows(S.data.network).map((l) => [l.id, l])), cq = {}, by = {}, unmapped = [];
    inv.locations.forEach((l) => {
      const c = l.id && S.geo.clusterOf[l.id];
      if (c) { const x = cq[c.key] ||= { c, qty: 0, items: [] }; x.qty += l.qty; x.items.push(l); } else unmapped.push(l);
      const a = !inv.states.length && toAbbr(byId[l.id]?.state); if (a) by[a] = (by[a] || 0) + l.qty;
    });
    let other = 0; inv.states.forEach((d) => { const a = toAbbr(d.key); if (a) by[a] = (by[a] || 0) + d.n; else other += d.n; });
    return { by, other, cq, unmapped, qmx: Math.max(1, ...Object.values(cq).map((x) => x.qty)) };
  }

  function renderMap() { keepFocus(paintMap); }
  function paintMap() {
    const pg = prodGeo(), L = pg ? { label: S.prod.p.Name, color: RAMP[2], what: `${S.prod.inv.measure} by state` } : LAYERS[S.layer], inv = S.layer === 'inventory', m = pg ? pg.by : inv ? {} : S.geo[S.layer].by, mx = Math.max(1, ...Object.values(m));
    $('#layers').innerHTML = Object.entries(LAYERS).map(([k, v]) => `<button class="chip ${k === S.layer ? 'on' : ''}" data-l="${k}" aria-pressed="${k === S.layer}">${v.label}</button>`).join('');
    $('#layers').querySelectorAll('button').forEach((b) => b.onclick = () => { const to = b.dataset.l; if (to === S.layer) return; S.layer = to; if (S.prod) return clearProduct(); renderMap(); if (to === 'inventory') $('#pq').focus(); });
    $('#psearch').classList.toggle('hide', !inv);
    const focus = S.geo.clusters.find((c) => c.key === S.focusKey);
    const R = (v) => 5 + 21 * Math.sqrt(v / mx);

    const land = window.US_GEO ? `<path class="land-glow" d="${US_GEO.l48}"/><path class="land" d="${US_GEO.l48}"/><path class="land" d="${US_GEO.ak}"/><path class="land" d="${US_GEO.hi}"/>
    <path class="inset" d="M20,500H200V600H20Z M205,535H320V600H205Z"/>` : '';

    const cities = S.layer === 'customers' && !pg ? S.geo.cities.list : null, cmx = Math.max(1, ...(cities || []).map((p) => p.n));
    const cityBubbles = !cities ? '' : [...cities].sort((a, b) => b.n - a.n).map((p) => {
      const r = 3 + 15 * Math.sqrt(p.n / cmx), t = p.n / cmx, dim = focus && !focus.out[p.a] ? 'dim' : '';
      return `<g data-city="${p.i}" class="zs ${dim}" data-x="${p.x}" data-y="${p.y}"><circle class="bub${p.approx ? ' approx' : ''}" cx="${p.x}" cy="${p.y}" r="${r}" fill="${L.color}" fill-opacity="${p.approx ? .2 : .35 + .55 * t}"/>${p.i < 8 ? `<text class="bl out" x="${p.x}" y="${p.y - r - 3}">${esc(p.city || p.a + ' · other')}</text>` : ''}</g>`;
    }).join('');
    const bubbles = cities ? cityBubbles : Object.entries(m).filter(([a]) => STATES[a]).sort((a, b) => b[1] - a[1]).map(([a, v]) => {
      const [x, y] = proj(STATES[a][2], STATES[a][1]), r = R(v), t = v / mx;
      const dim = focus && !pg && !focus.out[a] ? 'dim' : '', fill = pg ? rampAt(t) : L.color, ink = pg && t < .5 ? ' ink' : '';
      return `<g data-state="${a}" class="zs ${dim}" data-x="${x}" data-y="${y}"><circle class="bub" cx="${x}" cy="${y}" r="${r}" fill="${fill}" fill-opacity="${pg ? .85 : .35 + .55 * t}"/>${r >= 11 ? `<text class="bl${ink}" x="${x}" y="${y + 3.5}">${a}</text>` : `<text class="bl out" x="${x}" y="${y - r - 3}">${a}</text>`}</g>`;
    }).join('');

    const fmx = Math.max(1, ...S.geo.flows.map((f) => f.n));
    const flows = $('#flowsOn').checked && !inv ? S.geo.flows.map((f, i) => {
      const [x2, y2] = proj(STATES[f.a][2], STATES[f.a][1]), { x: x1, y: y1 } = f.c, d = Math.hypot(x2 - x1, y2 - y1);
      if (d < 6) return '';
      const cx = (x1 + x2) / 2 - (y2 - y1) * .22, cy = (y1 + y2) / 2 - Math.abs(x2 - x1) * .12 - d * .08;
      const path = `M${x1},${y1}Q${cx},${cy} ${x2},${y2}`, w = 1 + 3 * Math.sqrt(f.n / fmx), dur = (1.6 + d / 180).toFixed(2);
      const dots = Math.min(4, 1 + Math.round(3 * f.n / fmx)), dim = focus && focus.key !== f.c.key ? 'dim' : '';
      return `<g class="${dim}"><path id="fl${i}" class="flow" d="${path}" stroke-width="${w}" stroke-opacity="${.18 + .35 * Math.sqrt(f.n / fmx)}"/>${Array.from({ length: dots }, (_, k) => `<circle class="pkt" r="${w > 2.5 ? 2.6 : 2}" data-r="${w > 2.5 ? 2.6 : 2}"><animateMotion dur="${dur}s" begin="${(-k * dur / dots).toFixed(2)}s" repeatCount="indefinite" keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines=".4 0 .6 1"><mpath href="#fl${i}"/></animateMotion></circle>`).join('')}</g>`;
    }).join('') : '';

    // Label only the busiest clusters so the map stays readable; the rest are on hover.
    const labelled = new Set([...S.geo.clusters].sort((a, b) => pg ? (pg.cq[b.key]?.qty ?? -1) - (pg.cq[a.key]?.qty ?? -1) : (b.shipped + b.open) - (a.shipped + a.open)).slice(0, 6).filter((c) => !pg || pg.cq[c.key]).map((c) => c.key));
    // Stocking locations get a ring sized by quantity, drawn under the node so the node keeps its hover/click.
    const marks = pg ? Object.values(pg.cq).sort((a, b) => b.qty - a.qty).map((x) => `<circle class="pmark zs" data-x="${x.c.x}" data-y="${x.c.y}" data-pm="${x.c.key}" cx="${x.c.x}" cy="${x.c.y}" r="${16 + 16 * Math.sqrt(x.qty / pg.qmx)}" fill="${RAMP[3]}" fill-opacity=".16" stroke="${RAMP[3]}" stroke-width="1.5" stroke-opacity=".8"/>`).join('') : '';
    // Each location gets a hit circle at least 25 px across on screen (WCAG 2.5.8), however small the map is drawn.
    const ctm = $('#map').getScreenCTM(), hitR = ctm?.a > 0 ? Math.max(20, 12.5 / (ctm.a / zoomOf())) : 20;
    const nodes = S.geo.clusters.map((c) => {
      const cls = `node ${c.store ? 'store' : 'dc'} ${c.load > .85 ? 'strain' : ''} ${c.key === S.focusKey ? 'sel' : ''} ${focus && focus.key !== c.key ? 'dim' : ''} ${pg && !pg.cq[c.key] ? 'faint' : ''}`;
      const r = 5 + Math.min(4, c.items.length - 1);
      const core = c.store ? `<rect class="core" x="${c.x - r}" y="${c.y - r}" width="${2 * r}" height="${2 * r}" rx="2.5"/>` : `<circle class="core" cx="${c.x}" cy="${c.y}" r="${r}"/>`;
      const sub = pg ? `${num(pg.cq[c.key]?.qty ?? 0)} ${S.prod.inv.measure.toLowerCase()}` : c.load != null ? `${pct(c.load)} of capacity` : `${num(c.open)} open FOs`;
      const flip = c.x > 800, say = `${c.label}, ${c.store ? 'store' : 'distribution center'}, ${sub}`;
      return `<g class="${cls} zs" data-x="${c.x}" data-y="${c.y}" data-node="${c.key}" tabindex="0" role="button" aria-pressed="${c.key === S.focusKey}" aria-label="${esc(say)}"><circle class="hitc" cx="${c.x}" cy="${c.y}" r="${hitR.toFixed(1)}"/><circle class="halo" cx="${c.x}" cy="${c.y}" r="20"/><circle class="ringbg" cx="${c.x}" cy="${c.y}" r="14"/>${c.load != null ? `<path d="${ringArc(c.x, c.y, 14, c.load)}" class="ring"/>` : ''}${core}
      ${labelled.has(c.key) || c.key === S.focusKey ? `<text x="${c.x}" y="${c.y}" dx="${flip ? -20 : 20}" dy="1" text-anchor="${flip ? 'end' : 'start'}">${esc(c.label)}</text><text x="${c.x}" y="${c.y}" dx="${flip ? -20 : 20}" dy="15" text-anchor="${flip ? 'end' : 'start'}" class="cap">${sub}</text>` : ''}</g>`;
    }).join('');

    const svg = $('#map');
    hideTip(); // the hovered element is about to be replaced
    svg.innerHTML = land + bubbles + flows + marks + nodes;
    // Only the locations are controls; the land, bubbles and flows are drawing, and the list beside the map says the same.
    for (const el of svg.children) if (!el.matches('[data-node]')) el.setAttribute('aria-hidden', 'true');
    if (!S.live || REDUCED.matches) svg.pauseAnimations();
    applyView();
    svg.querySelectorAll('[data-state]').forEach((g) => { g.onmousemove = (e) => showTip(e, stateTip(g.dataset.state)); g.onmouseleave = hideTip; });
    svg.querySelectorAll('[data-city]').forEach((g) => { g.onmousemove = (e) => showTip(e, cityTip(S.geo.cities.list[g.dataset.city])); g.onmouseleave = hideTip; });
    svg.querySelectorAll('[data-pm]').forEach((g) => { g.onmousemove = (e) => showTip(e, nodeTip(S.geo.clusters.find((c) => c.key === g.dataset.pm))); g.onmouseleave = hideTip; });
    svg.querySelectorAll('[data-node]').forEach((g) => {
      g.onmousemove = (e) => showTip(e, nodeTip(S.geo.clusters.find((c) => c.key === g.dataset.node)));
      g.onmouseleave = hideTip;
      g.onfocus = () => { if (g.dataset.node !== S.focusKey) showTip(tipAt(g), nodeTip(S.geo.clusters.find((c) => c.key === g.dataset.node))); }; // the focused one is in its panel
      g.onblur = hideTip;
      g.onclick = (e) => { e.stopPropagation(); S.focusKey = S.focusKey === g.dataset.node ? null : g.dataset.node; hideTip(); renderMap(); };
    });
    svg.onclick = () => { if (S.focusKey && !panned) { S.focusKey = null; renderMap(); } };

    const locN = rows(S.data.network).length;
    $('#netSub').textContent = pg ? `${S.prod.p.Name} · ${S.prod.inv.locations.length} location${S.prod.inv.locations.length === 1 ? '' : 's'} · ${S.prod.inv.source}` : `${locN} location${locN === 1 ? '' : 's'} · ${num(S.geo.flows.reduce((s, f) => s + f.n, 0))} FOs routed ${rangeText()}`;
    renderFocus(focus);
    if (S.prod) renderProdLegend(pg, m, mx);
    else if (inv) $('#legend').innerHTML = `<div class="lt">${esc(L.what)}</div>` + (S.data.objects.Product2 === false ? `<div class="pnote">${na('Product2')}</div>` : `<div class="empty">Search a product (top right of the map) by name, code or SKU to see where it's stocked.</div>`);
    else renderLegend(L, m, mx);
  }

  function renderLegend(L, m, mx) {
    if (S.layer === 'customers') return renderCityLegend(L);
    const list = Object.entries(m).sort((a, b) => b[1] - a[1]), other = S.geo[S.layer].other;
    const cd = S.layer === 'cases' && S.data.cases?.ok ? S.data.cases.data : null;
    const caseNote = S.layer !== 'cases' ? '' : S.data.objects.Case === false || (S.data.cases?.ok && !cd) ? `<div class="pnote">${na('Case')}</div>`
      : cd ? (cd.newest && !list.length ? `<div class="pnote">No cases created ${rangeText()}. Newest case: <b>${new Date(cd.newest).toLocaleDateString()}</b> (${ago(cd.newest)}).</div>` : '')
        + (Object.keys(cd.via || {}).length ? `<div class="pnote">State from ${Object.entries(cd.via).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<b>${esc(k)}</b> ${num(n)}`).join(' · ')}</div>` : '') : '';
    $('#legend').innerHTML = perr(S.data.network) + perr(S.data[{ demand: 'demand', fulfill: 'flows', risk: 'exByState', cases: 'cases' }[S.layer]]) +
      `<div class="lt">${esc(L.what)}</div>` + caseNote +
      (list.length ? `<div role="list" aria-label="${esc(L.what)}">${list.slice(0, 10).map(([a, v]) => `<div class="row" role="listitem" data-state="${a}"><b>${a}</b><div class="bar"><i style="width:${Math.max(3, 100 * v / mx)}%;background:${L.color}"></i></div><span class="num">${num(v)}</span></div>`).join('')}</div>`
        + (list.length > 10 ? `<div class="row muted"><span></span><span>+${list.length - 10} more states</span><span></span></div>` : '')
        + (other ? `<div class="row muted"><span>—</span><span>outside US / blank</span><span class="num">${num(other)}</span></div>` : '')
        : `<div class="empty">Nothing in range.</div>`) +
      `<div class="keyset">
      <div><svg width="26" height="18" aria-hidden="true"><circle cx="9" cy="9" r="5" fill="${L.color}" fill-opacity=".45"/><circle cx="19" cy="9" r="8" fill="${L.color}" fill-opacity=".85"/></svg>size = count</div>
      <div><svg width="26" height="18" aria-hidden="true"><circle cx="9" cy="9" r="5" fill="var(--green)"/><rect x="16" y="4" width="10" height="10" rx="2" fill="var(--signal)"/></svg>DC · store hub</div>
      <div><svg width="26" height="18" aria-hidden="true"><circle cx="13" cy="9" r="7" fill="none" stroke="var(--chip2)" stroke-width="3"/><path d="${ringArc(13, 9, 7, .7)}" fill="none" stroke="var(--green)" stroke-width="3"/></svg>capacity used</div>
      <div><svg width="26" height="18" aria-hidden="true"><path d="M2,14Q13,0 24,12" fill="none" stroke="var(--signal)" stroke-width="2" stroke-opacity=".6"/></svg>fulfillment flow</div>
    </div>`;
    $('#legend').querySelectorAll('.row[data-state]').forEach((r) => legendRow(r, `[data-state="${r.dataset.state}"]`, (on) => highlightState(r.dataset.state, on), () => stateTip(r.dataset.state)));
  }
  // A row in the list beside the map lights its bubble on hover; it takes focus too, and then shows that bubble's tooltip.
  function legendRow(r, mark, light, tip) {
    r.tabIndex = 0;
    r.onmouseenter = () => light(true); r.onmouseleave = () => light(false);
    r.onfocus = () => { light(true); const b = $(`#map ${mark}`); if (b) showTip(tipAt(b), tip()); };
    r.onblur = () => { light(false); hideTip(); };
  }
  function renderCityLegend(L) {
    const { list, other, approx } = S.geo.cities, mx = Math.max(1, ...list.map((p) => p.n));
    $('#legend').innerHTML = perr(S.data.network) + perr(S.data.customers) + `<div class="lt">${esc(L.what)}</div>` +
      (S.data.customers?.ok && !S.data.customers.data ? `<div class="pnote">${na('OrderSummary.BillingCity')}</div>` : '') +
      (list.length ? `<div role="list" aria-label="${esc(L.what)}">${list.slice(0, 10).map((p) => `<div class="row crow" role="listitem" data-city="${p.i}"><div><b>${esc(p.city || 'Other')}</b>, ${p.a}<div class="bar"><i style="width:${Math.max(3, 100 * p.n / mx)}%;background:${L.color}"></i></div></div><span class="num">${num(p.n)}</span></div>`).join('')}</div>`
        + (list.length > 10 ? `<div class="row muted"><span></span><span>+${list.length - 10} more cities</span><span></span></div>` : '')
        + (other ? `<div class="row muted"><span>—</span><span>outside US / blank</span><span class="num">${num(other)}</span></div>` : '')
        + (approx ? `<div class="pnote">${num(approx)} customer${approx === 1 ? ' is' : 's are'} in cities the map doesn't know; they're pooled at the state center (dashed).</div>` : '')
        : `<div class="empty">No customers ordered ${rangeText()}.</div>`) +
      `<div class="keyset">
      <div><svg width="26" height="18" aria-hidden="true"><circle cx="9" cy="9" r="4" fill="${L.color}" fill-opacity=".45"/><circle cx="19" cy="9" r="7" fill="${L.color}" fill-opacity=".85"/></svg>size = customers</div>
      <div><svg width="26" height="18" aria-hidden="true"><circle cx="13" cy="9" r="7" fill="${L.color}" fill-opacity=".2" stroke="var(--ink2)" stroke-dasharray="3 2"/></svg>other cities in state</div>
      <div><svg width="26" height="18" aria-hidden="true"><circle cx="9" cy="9" r="5" fill="var(--green)"/><rect x="16" y="4" width="10" height="10" rx="2" fill="var(--signal)"/></svg>DC · store hub</div>
    </div>`;
    const hl = (i, on) => { const c = $(`#map [data-city="${i}"] circle`); if (c) c.style.stroke = on ? 'var(--ink)' : ''; };
    $('#legend').querySelectorAll('.row[data-city]').forEach((r) => legendRow(r, `[data-city="${r.dataset.city}"]`, (on) => hl(r.dataset.city, on), () => cityTip(S.geo.cities.list[r.dataset.city])));
  }
  function cityTip(p) {
    return `<b>${esc(p.city ? `${p.city}, ${STATES[p.a][0]}` : `Other cities in ${STATES[p.a][0]}`)}</b>
    ${p.approx && p.names.size ? `<div class="muted" style="font-size:var(--fs-sm)">${[...p.names].slice(0, 5).map(esc).join(' · ')}${p.names.size > 5 ? ' …' : ''} · placed at state center</div>` : ''}
    <div class="r"><span>Customers</span><span>${num(p.n)}</span></div>
    <div class="r"><span>Orders</span><span>${num(p.orders)}</span></div>
    <div class="r"><span>Spend</span><span>${money(p.spend)}</span></div>
    ${p.top.length ? `<h3>Top customers</h3>${p.top.map((t) => `<div class="r"><span>${esc(t.name || 'Account')}</span><span>${money(t.spend)} · ${num(t.orders)}</span></div>`).join('')}` : ''}`;
  }
  function renderProdLegend(pg, m, mx) {
    const el = $('#legend'), p = S.prod.p, inv = S.prod.inv, head = `<div class="lt">Product</div><div class="pnote"><b>${esc(p.Name)}</b>${p.StockKeepingUnit || p.ProductCode ? `<br>${esc([p.StockKeepingUnit && 'SKU ' + p.StockKeepingUnit, p.ProductCode && p.ProductCode !== p.StockKeepingUnit && p.ProductCode].filter(Boolean).join(' · '))}` : ''}</div>`;
    const clear = `<button class="pclear" id="pclear">Clear product</button>`;
    if (!inv) { el.innerHTML = head + (S.prod.err ? `<div class="perr">${esc(S.prod.err)}</div>` : `<div class="empty">Loading inventory…</div>`) + clear; return ($('#pclear').onclick = clearProduct); }
    const bars = (list, qmx, what) => `<div role="list" aria-label="${esc(what)}">${list.map(([k, v, tip]) => `<div class="lrow" role="listitem"${tip ? ` data-state="${tip}"` : ''}><span>${esc(k)}</span><span class="num">${num(v)}</span><div class="bar"><i style="width:${Math.max(3, 100 * v / qmx)}%;background:${RAMP[2]}"></i></div></div>`).join('')}</div>`;
    const locs = inv.locations, lmx = Math.max(1, ...locs.map((l) => l.qty)), states = Object.entries(m).sort((a, b) => b[1] - a[1]);
    el.innerHTML = head +
      `<div class="pnote">Source <span class="pill">${esc(inv.source)}</span> · ${esc(inv.measure)}${inv.source === 'Orders' ? ` · ${RANGE_LABEL[inv.range] || rangeText()}` : ' · right now'}</div>` +
      (inv.tried.length ? `<div class="pnote">${inv.tried.map((t) => `${esc(t.source)}: ${esc(t.note)}`).join('<br>')}</div>` : '') +
      (inv.source === 'Orders' && inv.available === false ? `<div class="pnote">${na('FulfillmentOrderLineItem / OrderItemSummary')}</div>` : '') +
      `<div class="lt">Locations${inv.checked ? ` · ${inv.checked} checked` : ''}</div>` +
      (locs.length ? bars(locs.slice(0, 8).map((l) => [l.name, l.qty]), lmx, 'Locations') + (locs.length > 8 ? `<div class="pnote">+${locs.length - 8} more locations</div>` : '') : `<div class="empty">No location quantities.</div>`) +
      (pg.unmapped.length ? `<div class="pnote">Not on the map (no coordinates or virtual): ${pg.unmapped.slice(0, 5).map((l) => `<b>${esc(l.name)}</b> ${num(l.qty)}`).join(' · ')}${pg.unmapped.length > 5 ? ' …' : ''}</div>` : '') +
      (inv.groups?.length ? `<div class="lt">Location groups</div>` + bars([...inv.groups].sort((a, b) => b.qty - a.qty).map((g) => [g.name, g.qty]), Math.max(1, ...inv.groups.map((g) => g.qty)), 'Location groups') : '') +
      `<div class="lt">States${inv.stateBasis ? ` · ${esc(inv.stateBasis)}` : inv.states.length ? '' : ' · by location state'}</div>` +
      (states.length ? bars(states.slice(0, 8).map(([a, v]) => [STATES[a][0], v, a]), mx, 'States') : `<div class="empty">No state data.</div>`) +
      (pg.other ? `<div class="pnote">Outside US / blank: ${num(pg.other)}</div>` : '') +
      `<div class="keyset"><div><svg width="26" height="18" aria-hidden="true">${RAMP.map((c, i) => `<rect x="${i * 6.5}" y="5" width="6" height="8" fill="${c}"/>`).join('')}</svg>state quantity</div>
      <div><svg width="26" height="18" aria-hidden="true"><circle cx="13" cy="9" r="7" fill="${RAMP[3]}" fill-opacity=".16" stroke="${RAMP[3]}" stroke-width="1.5"/></svg>ring = location qty</div></div>` + clear;
    $('#pclear').onclick = clearProduct;
    el.querySelectorAll('[data-state]').forEach((r) => legendRow(r, `[data-state="${r.dataset.state}"]`, (on) => highlightState(r.dataset.state, on), () => stateTip(r.dataset.state)));
  }

  // ---------- product search ----------
  let pqTimer = null, pqSeq = 0, pqList = [], pqAt = -1;
  function renderResults(r) {
    const el = $('#pres'); pqList = r.list || []; pqAt = -1; el.classList.remove('hide');
    el.innerHTML = r.available === false ? `<div class="empty">${na('Product2')}</div>` : r.error ? `<div class="perr">${esc(r.error)}</div>`
      : pqList.length ? pqList.map((p, i) => `<button role="option" data-i="${i}"><b>${esc(p.Name)}</b><small>${esc([p.StockKeepingUnit && 'SKU ' + p.StockKeepingUnit, p.ProductCode !== p.StockKeepingUnit && p.ProductCode, p.Family].filter(Boolean).join(' · '))}</small></button>`).join('') : `<div class="empty">No matching products.</div>`;
    el.querySelectorAll('button').forEach((b) => b.onmousedown = (e) => { e.preventDefault(); pickProduct(pqList[+b.dataset.i]); });
  }
  $('#pq').oninput = () => {
    clearTimeout(pqTimer); const q = $('#pq').value.trim();
    if (q.length < 2) return $('#pres').classList.add('hide');
    pqTimer = setTimeout(async () => {
      const seq = ++pqSeq;
      try {
        const r = DEMO ? { available: true, list: DEMO_PRODUCTS.filter((p) => [p.Name, p.ProductCode, p.StockKeepingUnit].some((v) => v.toLowerCase().includes(q.toLowerCase()))) } : await j(`/api/products?q=${encodeURIComponent(q)}`);
        if (seq === pqSeq) renderResults(r);
      } catch (e) { if (seq === pqSeq) renderResults({ error: e.message }); }
    }, 220);
  };
  $('#pq').onkeydown = (e) => {
    const open = !$('#pres').classList.contains('hide'), btns = [...$('#pres').querySelectorAll('button')];
    if (e.key === 'Escape') { e.stopPropagation(); if (open) $('#pres').classList.add('hide'); else if (S.prod) clearProduct(); else $('#pq').blur(); }
    else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && open && btns.length) { e.preventDefault(); pqAt = (pqAt + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length; btns.forEach((b, i) => b.classList.toggle('on', i === pqAt)); btns[pqAt].scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'Enter' && open && pqList.length) { e.preventDefault(); pickProduct(pqList[Math.max(0, pqAt)]); }
  };
  $('#pq').onfocus = () => { if ($('#pq').value.trim().length >= 2 && $('#pres').innerHTML) $('#pres').classList.remove('hide'); };
  $('#pq').onblur = () => setTimeout(() => $('#pres').classList.add('hide'), 120);
  function pickProduct(p) {
    if (!p) return;
    $('#pq').value = p.Name; $('#pres').classList.add('hide'); $('#pq').blur();
    S.focusKey = null; S.layer = 'inventory'; S.prod = { p, inv: null }; renderMap(); loadInventory();
  }
  async function loadInventory() {
    const seq = ++S.invSeq, p = S.prod.p;
    S.prod.inv = null; S.prod.err = null; if (S.geo) renderMap();
    try {
      const inv = DEMO ? demoInventory(p, S.range) : await j(`/api/inventory?id=${encodeURIComponent(p.Id)}&range=${S.range}${scopeQuery({ store: S.store, channel: S.channel })}`);
      if (seq !== S.invSeq || S.prod?.p !== p) return;
      S.prod.inv = inv;
    } catch (e) { if (seq !== S.invSeq || S.prod?.p !== p) return; S.prod.err = e.message; }
    if (S.geo) renderMap();
    S.agent?.contextChanged(); // the product's stock goes to Agentforce (index.html productFacts())
  }
  function clearProduct() { S.prod = null; S.invSeq++; $('#pq').value = ''; $('#pres').classList.add('hide'); renderMap(); S.agent?.contextChanged(); }

  // ---------- map zoom & pan ----------
  // Zoom moves the viewBox, so it survives renderMap() re-renders. Markers and labels are scaled back by 1/zoom
  // so they keep their on-screen size and zooming in spreads crowded locations apart instead of just enlarging them.
  const MAP_W = 975, MAP_H = 610, MAX_ZOOM = 32;
  let view = { x: 0, y: 0, w: MAP_W }, panned = false;
  const zoomOf = () => MAP_W / view.w;
  function applyView() {
    const svg = $('#map'), z = zoomOf(), h = view.w * MAP_H / MAP_W;
    view.x = Math.max(0, Math.min(MAP_W - view.w, view.x)); view.y = Math.max(0, Math.min(MAP_H - h, view.y));
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${h}`);
    svg.querySelectorAll('.zs').forEach((g) => { const { x, y } = g.dataset; g.setAttribute('transform', z === 1 ? '' : `translate(${x},${y}) scale(${1 / z}) translate(${-x},${-y})`); });
    svg.querySelectorAll('.pkt').forEach((c) => c.setAttribute('r', c.dataset.r / z));
    $('#zoom [data-z="in"]').disabled = z >= MAX_ZOOM; $('#zoom [data-z="out"]').disabled = $('#zoom [data-z="reset"]').disabled = z <= 1;
  }
  // Map a screen point to map units (the SVG letterboxes, so use its CTM rather than the element rect).
  function mapPoint(cx, cy) { const m = $('#map').getScreenCTM().inverse(); return { x: m.a * cx + m.c * cy + m.e, y: m.b * cx + m.d * cy + m.f }; }
  function zoomBy(f, at) {
    const nw = Math.max(MAP_W / MAX_ZOOM, Math.min(MAP_W, view.w / f));
    if (nw === view.w) return;
    const h = view.w * MAP_H / MAP_W, p = at || { x: view.x + view.w / 2, y: view.y + h / 2 }, k = nw / view.w;
    view = { x: p.x - (p.x - view.x) * k, y: p.y - (p.y - view.y) * k, w: nw };
    hideTip(); applyView();
  }
  // Full screen: the map panel (with its legend) via the Fullscreen API; browsers without it get a fixed overlay (.maxi).
  const mapZone = () => $('#mapwrap').closest('.zone');
  const isFull = () => document.fullscreenElement === mapZone() || mapZone().classList.contains('maxi');
  function toggleFull() {
    const z = mapZone();
    const maxi = () => { if (!document.fullscreenElement) { z.classList.add('maxi'); syncFull(); } };
    if (document.fullscreenElement) document.exitFullscreen();
    else if (z.classList.contains('maxi')) { z.classList.remove('maxi'); syncFull(); }
    else if (z.requestFullscreen) {
      // Some embeds never settle the promise, so fall back to filling the window if nothing happens.
      z.requestFullscreen().catch(maxi);
      setTimeout(maxi, 400);
    } else maxi();
  }
  function syncFull() {
    if (document.fullscreenElement) mapZone().classList.remove('maxi');
    const b = $('#zoom [data-z="full"]'), on = isFull();
    b.setAttribute('aria-pressed', on); b.title = on ? 'Exit full screen (F / Esc)' : 'Full screen (F)'; hideTip();
  }
  document.addEventListener('fullscreenchange', syncFull);
  function resetZoom() { view = { x: 0, y: 0, w: MAP_W }; hideTip(); applyView(); }
  (() => {
    const svg = $('#map');
    svg.addEventListener('wheel', (e) => { e.preventDefault(); zoomBy(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0025)), mapPoint(e.clientX, e.clientY)); }, { passive: false });
    svg.addEventListener('dblclick', (e) => { if (!e.target.closest('[data-node]')) zoomBy(e.shiftKey ? 0.5 : 2, mapPoint(e.clientX, e.clientY)); });
    let drag = null;
    svg.addEventListener('pointerdown', (e) => { if (e.button === 0) { drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, s: svg.getScreenCTM().a }; panned = false; } });
    svg.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (!panned && Math.hypot(dx, dy) < 4) return; // small jitter is still a click
      if (!panned) { panned = true; svg.setPointerCapture(e.pointerId); svg.classList.add('panning'); hideTip(); }
      view.x = drag.vx - dx / drag.s; view.y = drag.vy - dy / drag.s; applyView();
    });
    const end = () => { drag = null; svg.classList.remove('panning'); };
    svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
    // A drag that ends on a location must not also focus it.
    svg.addEventListener('click', (e) => { if (panned) { e.stopPropagation(); panned = false; } }, true);
    $('#zoom').onclick = (e) => { const z = e.target.closest('button')?.dataset.z; if (z === 'full') toggleFull(); else if (z === 'reset') resetZoom(); else if (z) zoomBy(z === 'in' ? 2 : 0.5); };
  })();

  function highlightState(a, on) { const c = $(`#map [data-state="${a}"] circle`); if (c) c.style.stroke = on ? 'var(--ink)' : ''; }

  function stateTip(a) {
    const d = S.geo.demand.by[a] || 0, dT = Object.values(S.geo.demand.by).reduce((s, v) => s + v, 0);
    const f = S.geo.fulfill.by[a] || 0, r = S.geo.risk.by[a] || 0;
    const servers = S.geo.flows.filter((x) => x.a === a).sort((x, y) => y.n - x.n).slice(0, 4);
    const cu = S.geo.customers.by[a] || 0, ui = S.geo.custInfo[a];
    const cn = S.geo.cases.by[a] || 0, ci = S.geo.caseInfo[a], top = (o) => Object.entries(o || {}).sort((x, y) => y[1] - x[1])[0];
    const pv = S.prod?.inv ? prodGeo().by[a] || 0 : null;
    return `<b>${esc(STATES[a][0])}</b>
    ${pv != null ? `<div class="r"><span>${esc(S.prod.inv.measure)}</span><span>${num(pv)}</span></div><div class="muted" style="font-size:var(--fs-sm)">${esc(S.prod.p.Name)} · ${esc(S.prod.inv.source)}</div><h3>Operations</h3>` : ''}
    <div class="r"><span>Delivery groups</span><span>${num(d)}${dT ? ` · ${pct(d / dT)}` : ''}</span></div>
    <div class="r"><span>Fulfillment orders</span><span>${num(f)}</span></div>
    ${S.data.customers?.data ? `<div class="r"><span>Customers</span><span>${num(cu)}${ui ? ` · ${money(ui.spend)}` : ''}</span></div>` : ''}
    <div class="r"><span>Open exceptions</span><span style="${r ? 'color:var(--amber)' : ''}">${num(r)}</span></div>
    ${S.data.objects.Case !== false ? `<div class="r"><span>Cases</span><span>${num(cn)}${ci ? ` · ${num(ci.open)} open / ${num(ci.closed)} closed` : ''}</span></div>` : ''}
    ${ci && (top(ci.origin) || top(ci.type)) ? `<div class="r"><span>Top origin · type</span><span>${esc(top(ci.origin)?.[0] || '—')} · ${esc(top(ci.type)?.[0] || '—')}</span></div>` : ''}
    ${servers.length ? `<h3>Served by</h3>${servers.map((s) => `<div class="r"><span>${esc(s.c.label)}</span><span>${num(s.n)}</span></div>`).join('')}` : ''}`;
  }
  function nodeTip(c) {
    const top = Object.entries(c.out).sort((a, b) => b[1] - a[1]).slice(0, 4), pq = S.prod?.inv ? prodGeo().cq[c.key] : null;
    const pRows = !S.prod?.inv ? '' : `<h3>${esc(S.prod.p.Name)}</h3>` + (pq ? pq.items.map((l) => `<div class="r"><span>${esc(pq.items.length > 1 ? l.name : S.prod.inv.measure)}</span><span>${num(l.qty)}</span></div>`).join('')
      + (S.prod.inv.source === 'Omnichannel Inventory' && pq.items.length === 1 ? ['onHand', 'On hand', 'reserved', 'Reserved', 'ato', 'Available to order', 'inTransit', 'In transit'].reduce((s, k, i, arr) => i % 2 ? s : s + `<div class="r"><span>${arr[i + 1]}</span><span>${num(pq.items[0][k])}</span></div>`, '') : '')
      : `<div class="r"><span>${esc(S.prod.inv.measure)}</span><span>0</span></div>`);
    return `<b>${esc(c.label)}</b>
    ${c.items.length > 1 ? `<div class="muted" style="font-size:var(--fs-sm)">${c.items.slice(0, 5).map((l) => esc(l.name)).join(' · ')}${c.items.length > 5 ? ' …' : ''}</div>` : `<div class="muted" style="font-size:var(--fs-sm)">${esc(c.items[0].type || 'Location')}${c.items[0].city ? ` · ${esc(c.items[0].city)}, ${esc(c.items[0].state || '')}` : ''}</div>`}
    ${pRows}${pRows ? '<h3>Operations</h3>' : ''}<div class="r"><span>Open FOs</span><span>${num(c.open)}</span></div>
    <div class="r"><span>Routed ${rangeText()}</span><span>${num(c.shipped)}</span></div>
    ${c.load != null ? `<div class="r"><span>Capacity used</span><span style="${c.load > .85 ? 'color:var(--amber)' : ''}">${pct(c.load)} (${num(c.used)}/${num(c.cap)})</span></div>` : ''}
    ${top.length ? `<h3>Ships to</h3>${top.map(([a, n]) => `<div class="r"><span>${esc(STATES[a][0])}</span><span>${num(n)}</span></div>`).join('')}` : ''}`;
  }
  function renderFocus(c) {
    const el = $('#focus');
    if (!c) return el.classList.add('hide');
    el.classList.remove('hide');
    el.innerHTML = `<button class="x" aria-label="Clear focus">✕</button>${nodeTip(c)}${c.items.length > 1 ? `<h3>Locations</h3>${c.items.slice(0, 8).map((l) => `<div class="r"><span>${esc(l.name)}</span><span>${num(l.openFOs)} open</span></div>`).join('')}` : ''}`;
    el.querySelector('.x').onclick = () => { S.focusKey = null; renderMap(); };
  }
  function showTip(e, html) {
    const t = $('#tip'), w = $('#mapwrap').getBoundingClientRect();
    t.innerHTML = html; t.classList.remove('hide');
    const x = e.clientX - w.left, y = e.clientY - w.top, tw = t.offsetWidth, th = t.offsetHeight;
    t.style.left = `${x + 16 + tw > w.width ? x - tw - 12 : x + 16}px`;
    t.style.top = `${Math.max(6, Math.min(y - 10, w.height - th - 6))}px`;
  }
  function hideTip() { $('#tip').classList.add('hide'); }

  function renderExceptions() { keepFocus(paintExceptions); }
  function paintExceptions() {
    const list = rows(S.data.exceptions);
    const cats = ['All', ...new Set(list.map((e) => e.Category || 'Uncategorized'))];
    if (!cats.includes(S.exFilter)) S.exFilter = 'All';
    $('#exTabs').innerHTML = cats.map((c) => `<button class="chip ${c === S.exFilter ? 'on' : ''}" data-c="${esc(c)}" aria-pressed="${c === S.exFilter}">${esc(c)} ${c === 'All' ? list.length : list.filter((e) => (e.Category || 'Uncategorized') === c).length}</button>`).join('');
    $('#exTabs').querySelectorAll('button').forEach((b) => b.onclick = () => { S.exFilter = b.dataset.c; renderExceptions(); });
    const shown = list.filter((e) => S.exFilter === 'All' || (e.Category || 'Uncategorized') === S.exFilter);
    $('#exSub').textContent = S.data.objects.ProcessException ? `${list.length}${list.length === 100 ? '+' : ''} open · raised ${rangeText()}` : 'ProcessException not in this org';
    $('#exList').innerHTML = perr(S.data.exceptions) + (shown.length ? shown.map((e) => `
    <div class="item" data-id="${esc(e.Id || '')}"${e.Id ? ' role="button" tabindex="0"' : ''}>
      <i class="edge ${esc(e.Severity)}"></i>
      <span class="sev ${esc(e.Severity)}">${esc(e.Severity || e.Priority || '—')}</span>
      <div style="min-width:0"><div class="t">${esc(e.Category || 'Exception')} · ${esc(e.OrderSummary?.OrderNumber || e.AttachedTo?.Name || e.ProcessExceptionNumber || '')}</div><div class="s">${esc(e.Message || e.Description || '')}</div></div>
      <div style="text-align:right"><span class="pill">${esc(e.Status)}</span><div class="muted" style="font-size:var(--fs-sm);margin-top:var(--sp-2)">${ago(e.CreatedDate)}</div></div>
    </div>`).join('') : `<div class="empty">No open exceptions.</div>`);
    $('#exList').querySelectorAll('.item').forEach((el) => el.onclick = () => el.dataset.id && openRecord('ProcessException', el.dataset.id));
  }

  // Lifecycle is ordinal: in-flight stages step one blue ramp (validated --ordinal on the panel surface); done/cancelled keep the reserved status hues and are always text-labelled.
  const COLORS = { Draft:'var(--st1)', Created:'var(--st1)', Approved:'var(--st2)', 'Waiting to Fulfill':'var(--st2)', Allocated:'var(--st2)', Assigned:'var(--st2)', Pickpack:'var(--st3)', Fulfilling:'var(--st3)', 'Partially Fulfilled':'var(--st3)', Shipped:'var(--st4)', Fulfilled:'var(--st-done)', Delivered:'var(--st-done)', Closed:'var(--st-done)', Cancelled:'var(--st-fail)', Canceled:'var(--st-fail)', Rejected:'var(--st-fail)',
    Submitted:'var(--st2)', 'Pending Exchange':'var(--st3)', Received:'var(--st4)', Exception:'var(--st-warn)', New:'var(--st1)', Triaged:'var(--st2)', Paused:'var(--st3)', Resolved:'var(--st-done)', 'In Transit':'var(--st3)', 'Out for Delivery':'var(--st4)' };
  const FALLBACK = ['var(--st-o1)','var(--st-o2)','var(--st-o3)'];
  const statusColor = (k, i = 0) => COLORS[k] || FALLBACK[i % FALLBACK.length];
  function stackBar(title, list) {
    const total = list.reduce((s, r) => s + r.n, 0), sorted = [...list].sort((a, b) => b.n - a.n);
    return `<div><h3><span>${title}</span><b>${num(total)}</b></h3>
    <div class="stack">${sorted.length ? sorted.map((r, i) => `<i style="flex:${r.n} 1 0;background:${statusColor(r.key, i)}" title="${esc(r.key)}: ${num(r.n)} (${pct(r.n / total)})"></i>`).join('') : '<i style="flex:1;background:var(--raise)"></i>'}</div>
    <div class="keys">${sorted.length ? sorted.map((r, i) => `<span><s style="background:${statusColor(r.key, i)}"></s>${esc(r.key)}<b>${num(r.n)}</b></span>`).join('') : '<span class="muted">No records in range</span>'}</div></div>`;
  }
  function renderBoard() {
    const b = S.data.statusBoard.ok ? S.data.statusBoard.data : { orders: [], fulfillment: [] };
    $('#sbSub').textContent = rangeText();
    $('#board').innerHTML = perr(S.data.statusBoard) + `<div class="sb">${stackBar('Order Summaries by status', b.orders)}${stackBar('Fulfillment Orders by status', b.fulfillment)}</div>`;
  }

  // One panel, four streams: each tab is its own object, same range, newest activity first. Rows open the parent order.
  const place = (name, city, st) => esc([name, [city, st].filter(Boolean).join(', ')].filter(Boolean).join(' · '));
  const pill = (st, i) => `<span class="pill"><s style="background:${statusColor(st, i)}"></s>${esc(st || '')}</span>`;
  const shortDate = (d) => d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
  const STREAMS = {
    orders: { label: 'Orders', key: 'stream', obj: 'OrderSummary', noun: 'Order Summaries', num: 4,
      head: ['Order', 'Status', 'Customer', 'Channel', 'Total'],
      cells: (o, i) => [`<b>${esc(o.OrderNumber)}</b>`, pill(o.Status, i), esc(o.Account?.Name || ''), `<span class="muted">${esc(o.SalesChannel?.SalesChannelName || '')}</span>`, money(o.GrandTotalAmount)] },
    fo: { label: 'Fulfillment', key: 'foStream', obj: 'FulfillmentOrder', noun: 'Fulfillment Orders',
      head: ['Fulfillment order', 'Status', 'From', 'Ship to', 'Order'],
      cells: (r, i) => [`<b>${esc(r.FulfillmentOrderNumber)}</b>`, pill(r.Status, i), esc(r.FulfilledFromLocation?.Name || ''), `<span class="muted">${place(r.FulfilledToName, r.FulfilledToCity, r.FulfilledToState)}</span>`, esc(r.OrderSummary?.OrderNumber || '')] },
    sh: { label: 'Shipments', key: 'shStream', obj: 'Shipment', noun: 'Shipments',
      head: ['Shipment', 'Status', 'Carrier · tracking', 'Ship to', 'Delivery'],
      cells: (r, i) => [`<b>${esc(r.ShipmentNumber)}</b>`, pill(r.Status, i), `${esc(r.Provider || '')}${r.TrackingNumber ? ` <span class="muted mono">${esc(r.TrackingNumber)}</span>` : ''}`, `<span class="muted">${place(r.ShipToName, r.ShipToCity, r.ShipToState)}</span>`, r.ActualDeliveryDate ? `Delivered ${shortDate(r.ActualDeliveryDate)}` : r.ExpectedDeliveryDate ? `<span class="muted">ETA ${shortDate(r.ExpectedDeliveryDate)}</span>` : ''] },
    ro: { label: 'Returns', key: 'roStream', obj: 'ReturnOrder', noun: 'Return Orders', num: 4,
      head: ['Return', 'Status', 'Customer', 'Order', 'Value'],
      cells: (r, i) => [`<b>${esc(r.ReturnOrderNumber)}</b>`, pill(r.Status, i), esc(r.Account?.Name || ''), esc(r.OrderSummary?.OrderNumber || ''), money(r.GrandTotalAmount)] },
    cs: { label: 'Cases', key: 'caseStream', obj: 'Case', noun: 'Cases',
      head: ['Case', 'Status', 'Subject', 'Type · origin', 'Order'],
      cells: (r, i) => [`<b>${esc(r.CaseNumber)}</b>${r.Priority === 'High' ? ' <span class="muted">· High</span>' : ''}`, pill(r.Status, i), esc(r.Subject || ''), `<span class="muted">${esc([r.Type, r.Origin].filter(Boolean).join(' · '))}</span>`, esc(r.OrderSummary?.OrderNumber || '')] },
  };
  function renderStream() { keepFocus(paintStream); }
  function paintStream() {
    const first = S.seen.size === 0, cfg = STREAMS[S.streamTab], p = S.data[cfg.key], list = rows(p);
    $('#stSub').textContent = `updated ${rangeText()}, newest first`;
    $('#stTabs').innerHTML = Object.entries(STREAMS).map(([k, c]) => `<button class="chip ${k === S.streamTab ? 'on' : ''}" data-t="${k}" aria-pressed="${k === S.streamTab}">${c.label} ${rows(S.data[c.key]).length}${rows(S.data[c.key]).length === 50 ? '+' : ''}</button>`).join('');
    $('#stTabs').querySelectorAll('button').forEach((b) => b.onclick = () => { S.streamTab = b.dataset.t; renderStream(); });
    const fresh = new Set();
    for (const c of Object.values(STREAMS)) for (const r of rows(S.data[c.key])) { const key = r.Id + r.LastModifiedDate; if (!first && !S.seen.has(key)) fresh.add(key); S.seen.add(key); }
    $('#stream').innerHTML = perr(p) + (list.length ? `<table><thead><tr>${cfg.head.map((h, i) => `<th class="${i === cfg.num ? 'num' : ''}">${h}</th>`).join('')}<th>Updated</th></tr></thead><tbody>${list.map((r, i) => {
    const cells = cfg.cells(r, i);
    return `<tr class="${fresh.has(r.Id + r.LastModifiedDate) ? 'fresh' : ''}" ${r.Id ? `data-id="${esc(r.Id)}" tabindex="0"` : ''}>${cells.map((c, j) => `<td class="${j === cfg.num ? 'num' : ''}">${c}</td>`).join('')}<td class="muted">${ago(r.LastModifiedDate)}</td></tr>`;
  }).join('')}</tbody></table>` : `<div class="empty">${S.data.objects[cfg.obj] === false ? `${cfg.obj} is not available in this org.` : `No ${cfg.noun} updated ${rangeText()}.${S.data.streamNewest?.[cfg.obj] ? ` The newest is from ${new Date(S.data.streamNewest[cfg.obj]).toLocaleDateString()} (${ago(S.data.streamNewest[cfg.obj])}).` : S.data.streamNewest && cfg.obj in S.data.streamNewest ? ' This org has none yet.' : ''}`}</div>`);
    $('#stream').querySelectorAll('tbody tr[data-id]').forEach((tr) => tr.onclick = () => openAny(cfg.obj, tr.dataset.id));
  }

  return { render, perr, rows, renderMap, loadInventory, clearProduct, zoomBy, mapZone, toggleFull, resetZoom, statusColor, stackBar, place, pill, shortDate };
}
