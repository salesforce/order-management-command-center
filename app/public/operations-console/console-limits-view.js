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
// The console's Limits view (mode "limits"), a live control room for the org's limits: the request flow, the gauges, a
// streaming chart and the call ledger. index.html makes it once (createLimitsView) and calls what it returns; its arithmetic
// is console-limits.js.
import { DEMO, PLATFORM, BROWSER } from '../shared/transport/om-mode.js';
import { $, esc, num, pct } from './console-kit.js';
import { ringArc } from './console-geo.js';
import { csvText } from './console-csv.js';
import { limTopHtml, limAccessHtml, limAllHtml } from './console-limits-ref.js';
import { LIM_ROWS, LIM_SRC, LIM_SRC_NAME, LIM_GW_NAME, LIM_G2O, LIM_SY, LIM_GY, LIM_OY, limCross, limProject, limFullIn, odoDigits, limBar, limCalls, limTrend, limRest, limAmt, limGate, limSrcIdx, limNice, limRows, limGauges, limPoint, limBins } from './console-limits.js';
import { dur } from './console-charts.js';
import { isAuthFailure } from './console-banner.js';

// page: what the view reads of the console (mode(), live()) and the console's functions it calls (j, browserAuth, showGate, syncEvery).
export function createLimitsView(page) {
  const { j, browserAuth, showGate, syncEvery } = page;
  // ===================== LIMITS VIEW: a live control room (mode "limits") =====================
  // Three feeds drive it: the per-call meter (om-meter.js: every call this console makes, from every open tab), the org's own
  // counter (a small /limits?only=api heartbeat when nothing else has reported lately) and a full refresh once a minute.
  // Nothing here runs outside the Limits mode, and nothing reads or shows record data: only counts, timings and limits.
  // Chart windows: the meter keeps per-second data for 15 minutes and per-minute data for an hour, so 1h reads the minutes.
  const LIM_WINDOWS = {
    300: { name: '5 minutes', sub: 'calls per 5 s', src: 'perSecond', bins: 60, binMs: 5000, ticks: [['−5m', 0], ['−4m', 0.2], ['−3m', 0.4], ['−2m', 0.6], ['−1m', 0.8], ['now', 1]] },
    900: { name: '15 minutes', sub: 'calls per 10 s', src: 'perSecond', bins: 90, binMs: 10000, ticks: [['−15m', 0], ['−10m', 1 / 3], ['−5m', 2 / 3], ['now', 1]] },
    3600: { name: 'hour', sub: 'calls per minute', src: 'perMinute', bins: 60, binMs: 60000, ticks: [['−60m', 0], ['−45m', 0.25], ['−30m', 0.5], ['−15m', 0.75], ['now', 1]] },
  };
  const limWindow = () => { try { return LIM_WINDOWS[localStorage.getItem('omc.limitsWindow')] || LIM_WINDOWS[900]; } catch { return LIM_WINDOWS[900]; } };

  const SVGNS = 'http://www.w3.org/2000/svg';
  const LIM_KINDS = ['apex', 'batch', 'graphql', 'ui-api', 'connect', 'action'];
  const lim = {
    d: null, built: false, samples: [], rest: [], recent: [], levels: {}, fresh: new Set(), seenRows: new Set(), api: null,
    lastSample: 0, lastBeat: 0, lastActive: Date.now(), beating: false, parts: [], hit: {}, shown: {}, gaugeSig: '', gaugeVal: {},
    since: 0, tick: null, raf: 0, timer: 0, ticks: 0, auto: false, entered: false, demoApi: 124, demoNext: 0, search: '', snap: null,
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
  let M = null, meterP = null;

  // ---- meter: one per page. Inside Salesforce and hosted it is shared with the other tabs; locally it mirrors the server's log.
  function meterInit() {
    return (meterP ||= (async () => {
      try {
        const mod = await import('../shared/transport/om-meter.js');
        if (BROWSER) {
          // om-browser.js records its own calls; tag them with the view they came from.
          M = (await browserAuth()).meter; const rec = M.record.bind(M);
          M.record = (e) => rec({ ...e, source: e.source || page.mode() });
        } else M = mod.createMeter(PLATFORM ? {} : { storage: null, bc: null });
        M.subscribe(limOnEntry);
        if (DEMO) limSeedDemo();
      } catch (e) { M = null; console.warn('The request meter did not load:', e); }
      return M;
    })());
  }
  const meterRecord = (e) => { M?.record({ ...e, source: e.source || page.mode() }); };

  // ---- live feed
  function limSample(used, max, t = Date.now()) {
    const prev = lim.samples[lim.samples.length - 1];
    if (prev && t < prev.t) return;
    if (prev && used !== prev.used) {
      const own = lim.recent.filter((e) => e.t > prev.t && e.t <= t).length, n = limRest(prev.used, used, own);
      if (n > 0) lim.rest.push({ t, n });
    }
    lim.samples.push({ t, used }); if (lim.samples.length > 600) lim.samples.shift();
    if (lim.rest.length > 900) lim.rest.splice(0, lim.rest.length - 900);
    lim.api = { used, max }; lim.lastSample = Date.now();
    const x = lim.d?.org?.data?.DailyApiRequests; if (x && x.Max === max) x.Remaining = max - used;
  }
  // Calls per minute the org is seeing: the counter's growth over the last five minutes, else our own calls.
  function limRate() {
    const now = Date.now(), s = lim.samples.filter((x) => x.t > now - 300000);
    if (s.length >= 2 && s[s.length - 1].t - s[0].t >= 30000) return Math.max(0, (s[s.length - 1].used - s[0].used) / ((s[s.length - 1].t - s[0].t) / 60000));
    return limCalls(lim.recent, now, 300000) / 5;
  }
  function limOnEntry(e) {
    lim.recent.push(e); if (lim.recent.length > 3000) lim.recent.splice(0, 1000);
    if (e.source !== 'limits') lim.lastActive = Date.now();
    if (e.apex?.api != null && e.apex.apiMax) limSample(e.apex.api, e.apex.apiMax, e.t);
    if (page.mode() !== 'limits' || !lim.built) return;
    if (page.live() && Date.now() - e.t < 5000 && !document.hidden) { limSpawn(e); limPing(); }
    limSchedule();
  }
  // How often Live asks the org: the counter check and the full refresh. The choice is kept in this browser; idle views ask half as often.
  const EVERY = [300, 900, 1800, 3600], EVERY_KEY = { limits: 'omc.limitsEvery' }, EVERY_DEFAULT = { limits: 300 };
  const everyMs = (m = page.mode()) => { const d = (EVERY_DEFAULT[m] || 300) * 1000; try { const v = Number(localStorage.getItem(EVERY_KEY[m] || `omc.every.${m}`)); return EVERY.includes(v) ? v * 1000 : d; } catch { return d; } };
  const limEvery = () => everyMs('limits');
  const limInterval = () => limEvery() * (Date.now() - lim.lastActive > 600000 ? 2 : 1);
  const pollMs = () => page.mode() === 'limits' ? limInterval() : everyMs();
  async function limBeat() {
    lim.beating = true; lim.lastBeat = Date.now();
    try { const x = (await j('/api/limits?only=api'))?.org?.data?.DailyApiRequests; if (x?.Max) limSample(x.Max - x.Remaining, x.Max); }
    catch (e) { if (isAuthFailure(e)) showGate({ error: e.message }); }
    finally { lim.beating = false; limSchedule(); }
  }
  async function limPollServer() {
    try {
      const r = await j(`/api/meter?since=${lim.since}`);
      for (const e of r.entries || []) { lim.since = Math.max(lim.since, e.t); M?.record({ ...e, source: e.source || 'limits' }); }
    } catch { /* the next tick asks again */ }
  }
  function limTick() {
    if (page.mode() !== 'limits') return;
    const now = Date.now(); lim.ticks++;
    lim.recent = lim.recent.filter((e) => e.t > now - 300000);
    if (DEMO) limDemoStream(now);
    else if (!PLATFORM && !BROWSER && lim.ticks % 2 === 0) limPollServer();
    if (page.live() && !document.hidden && !DEMO && !lim.beating && now - Math.max(lim.lastSample, lim.lastBeat) >= limInterval()) limBeat();
    limPaintChart(); limPaintLive(); // no API calls: repaints what the meter already holds
  }
  // Starts or stops what only runs while the view is up: the one-second tick and the animation frame.
  function limSync() {
    const on = page.mode() === 'limits';
    if (on && !lim.tick) lim.tick = setInterval(limTick, 1000);
    else if (!on && lim.tick) { clearInterval(lim.tick); lim.tick = null; }
    $('#limits').classList.toggle('frozen', !page.live());
    if (on) { limPill(); limKick(); }
  }
  const limActive = () => page.mode() === 'limits' && page.live() && !document.hidden && !lim.reduced;
  function limKick() { if (!lim.raf && limActive()) lim.raf = requestAnimationFrame(limFrame); }
  function limEnter() {
    if (lim.entered) return; lim.entered = true;
    meterInit(); // Live is opt-in here too: passive costs no API calls beyond the one load, and still shows what other tabs do
  }
  function limLeave() {
    if (!lim.entered) return; lim.entered = false;
    limSync();
  }
  function limPill() {
    if (page.mode() !== 'limits') return;
    const hb = limInterval();
    $('#live span').textContent = page.live() ? `Live · ~${Math.round(3600000 / hb).toLocaleString()} calls/h` : 'Passive';
    $('#live').title = page.live() ? `Live: this tab asks the org for its limits every ${hb / 60000} min unless another call has just reported them, about ${Math.round(3600000 / hb)} calls an hour of your daily allowance. Change it with Auto-refresh in the top bar. Space turns Live off.`
      : 'Passive: no calls to the org. This view still shows what the console, in this and other tabs, is doing. Space turns Live on.';
  }
  async function limLoad() {
    await meterInit();
    if (DEMO) return demoLimits();
    if (!PLATFORM && !BROWSER) await limPollServer();
    return j('/api/limits');
  }
  function limApply(d) {
    limBuild(); lim.d = d;
    const x = d?.org?.data?.DailyApiRequests; if (x?.Max) limSample(x.Max - x.Remaining, x.Max);
    limPaintRef(); limPaintLive(); limPaintChart(); limSync();
  }
  function limSchedule() { if (!lim.timer && page.mode() === 'limits') lim.timer = setTimeout(() => { lim.timer = 0; limPaintLive(); }, 250); }
  function limitsContext() {
    const g = lim.d ? limGauges(lim.d) : [];
    return { view: 'limits', label: `Org limits · ${page.live() ? 'live' : 'paused'}`,
      facts: g.map((r) => `${r.name}: ${num(r.used)} of ${num(r.max)}${r.unit ? ' ' + r.unit : ''} (${Math.round(r.f * 100)}%)`), fields: { live: page.live() } };
  }

  // ---- build once
  function limBuild() {
    if (lim.built) return; lim.built = true;
    const edges = [], node = (x, cy, w, h, id, label, sub) => `<g class="lfn"><rect id="${id}" x="${x}" y="${cy - h / 2}" width="${w}" height="${h}" rx="9"/><text x="${x + w / 2}" y="${cy + (sub ? -2 : 4)}" text-anchor="middle" class="lft">${esc(label)}</text>${sub ? `<text id="${id}t" x="${x + w / 2}" y="${cy + 13}" text-anchor="middle" class="lfs"></text>` : ''}</g>`;
    LIM_SRC.forEach((_, si) => LIM_GW_NAME.forEach((__, gi) => edges.push(`<path id="lfe-${si}-${gi}" class="lfe" d="M150,${LIM_SY[si]}C225,${LIM_SY[si]} 225,${LIM_GY[gi]} 300,${LIM_GY[gi]}"/>`)));
    LIM_GW_NAME.forEach((_, gi) => edges.push(`<path id="lfg-${gi}" class="lfe" d="M420,${LIM_GY[gi]}C495,${LIM_GY[gi]} 495,${LIM_OY[LIM_G2O[gi]]} 570,${LIM_OY[LIM_G2O[gi]]}"/>`));
    $('#lFlow').innerHTML = `<g>${edges.join('')}</g>`
      + LIM_SRC_NAME.map((n, si) => node(30, LIM_SY[si], 120, 38, `lfn-s${si}`, n, true)).join('')
      + LIM_GW_NAME.map((n, gi) => node(300, LIM_GY[gi], 120, 38, `lfn-g${gi}`, n, true)).join('')
      + node(570, LIM_OY[0], 120, 50, 'lfn-pool', 'Daily API pool', true) + node(570, LIM_OY[1], 120, 50, 'lfn-gov', 'Apex governor', true)
      + '<g id="lfParts"></g>';
    $('#lKeys').innerHTML = LIM_KINDS.map((k) => `<span class="lk k-${k}"><i></i>${k}</span>`).join('');
    $('#lSearch').oninput = (e) => { lim.search = e.target.value.toLowerCase(); limPaintRef(); };
    $('#lCsv').onclick = limCsv;
    $('#lWin').onchange = (e) => { try { localStorage.setItem('omc.limitsWindow', e.target.value); } catch { /* the choice just isn't kept */ } limPaintChart(); };
    $('#lOdo').innerHTML = '';
  }

  // ---- header strip, odometer
  let odoSig = '';
  function limPaintOdo(n) {
    const ch = odoDigits(n), sig = ch.map((c) => (c === ',' ? ',' : 'd')).join(''), el = $('#lOdo');
    if (sig !== odoSig) { // a new digit appeared: rebuild without rolling
      odoSig = sig;
      el.innerHTML = ch.map((c) => (c === ',' ? '<span class="odsep">,</span>' : `<span class="od"><span class="oc">${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((x) => `<i>${x}</i>`).join('')}</span></span>`)).join('');
      el.querySelectorAll('.oc').forEach((c) => { c.style.transition = 'none'; });
    }
    [...el.querySelectorAll('.oc')].forEach((c, i) => { c.style.transform = `translateY(-${Number(ch.filter((x) => x !== ',')[i]) * 10}%)`; });
    requestAnimationFrame(() => el.querySelectorAll('.oc').forEach((c) => { c.style.transition = ''; }));
    el.setAttribute('aria-label', `${Math.floor(n)} API calls today`);
  }
  function limPing() { const d = $('#lDot'); d.classList.remove('ping'); void d.offsetWidth; d.classList.add('ping'); }
  function limPaintHead() {
    const now = Date.now(), api = lim.api, own = limCalls(lim.recent, now), prev = limCalls(lim.recent, now - 60000);
    const rest = lim.rest.filter((r) => r.t > now - 60000).reduce((s, r) => s + r.n, 0);
    if (api) { limPaintOdo(api.used); $('#lOdoSub').textContent = `of ${num(api.max)} · ${pct(api.used / api.max)} used`; }
    else { $('#lOdoSub').textContent = 'Waiting for the first reading…'; }
    $('#lRate').innerHTML = `${own}<small> /min ${limTrend(own, prev)}</small>`;
    $('#lRateSub').textContent = `this console · rest of org ${rest}/min`;
    $('#lState').textContent = page.live() ? '' : 'paused';
    const hb = limInterval();
    $('#lCost').textContent = page.live() ? `Asks the org every ${hb >= 120000 ? `${hb / 60000} min` : `${hb / 1000} s`} · ~${Math.round(3600000 / hb)} calls/h` : 'Passive · no calls to the org';
    syncEvery();
    limPill();
  }

  // ---- alerts
  function limPaintAlerts() {
    const rows = limRows(lim.d), next = {};
    for (const r of rows) next[r.key] = r.level;
    for (const c of limCross(lim.levels, next)) lim.fresh.add(c.key);
    lim.levels = next;
    const bad = rows.filter((r) => r.level === 'over' || r.level === 'warn').sort((a, b) => b.f - a.f);
    const msg = (r) => (r.level === 'over' ? `${esc(r.name)} ${Math.round(r.f * 100)}%: ${esc(limAmt(r.used - r.max, r.unit))} over` : `${esc(r.name)} at ${Math.round(r.f * 100)}%: ${esc(limAmt(r.max - r.used, r.unit))} left`);
    const err = lim.d && lim.d.org && !lim.d.org.ok ? `<div class="perr">Org limits unavailable: ${esc(lim.d.org.error)}</div>` : '';
    $('#lAlerts').innerHTML = err + bad.slice(0, 5).map((r) => `<div class="lal ${r.level}${lim.fresh.has(r.key) ? ' new' : ''}"><i></i><span>${msg(r)}</span></div>`).join('')
      + (bad.length > 5 ? `<div class="lal more"><span>and ${bad.length - 5} more in the reference below</span></div>` : '');
  }

  // ---- request flow
  function limPaintFlow() {
    const now = Date.now(), rec = lim.recent.filter((e) => e.t > now - 60000), sg = LIM_SRC.map(() => [0, 0, 0]), gn = [0, 0, 0], sn = [0, 0, 0, 0];
    for (const e of rec) { const si = limSrcIdx(e.source), gi = limGate(e.kind); sg[si][gi]++; gn[gi]++; sn[si]++; }
    const w = (n) => (n ? 1.5 + Math.min(7, Math.log2(1 + n) * 1.3) : 1);
    const edge = (id, n) => { const el = $(id); el.style.strokeWidth = w(n); el.classList.toggle('on', n > 0); };
    sg.forEach((row, si) => row.forEach((n, gi) => edge(`#lfe-${si}-${gi}`, n)));
    gn.forEach((n, gi) => { edge(`#lfg-${gi}`, n); $(`#lfn-g${gi}t`).textContent = `${n}/min`; });
    sn.forEach((n, si) => { $(`#lfn-s${si}t`).textContent = `${n}/min`; });
    $('#lfn-poolt').textContent = lim.api ? `${num(lim.api.used)} / ${num(lim.api.max)}` : '—';
    const peak = lim.snap?.totals?.peakRows || 0;
    $('#lfn-govt').textContent = `peak ${num(peak)} / ${num(LIM_ROWS)} rows`;
  }
  function limSpawn(e) {
    if (lim.reduced || lim.parts.length > 60) return;
    const bad = e.status >= 400 || e.status === 0, el = document.createElementNS(SVGNS, 'circle');
    el.setAttribute('class', `lp k-${e.kind}${bad ? ' bad' : ''}`);
    el.setAttribute('r', (2.5 + Math.min(4, Math.log10(1 + (e.apex?.rows ?? e.rows ?? 0)) * 1.1)).toFixed(1));
    $('#lfParts').append(el);
    const gi = limGate(e.kind);
    lim.parts.push({ el, si: limSrcIdx(e.source), gi, oi: LIM_G2O[gi], t0: performance.now(), bad });
    limKick();
  }
  function limFrame(ts) {
    lim.raf = 0;
    for (let i = lim.parts.length - 1; i >= 0; i--) {
      const p = lim.parts[i], u = (ts - p.t0) / 1100;
      if (u >= 1) { lim.hit[p.oi === 1 ? 'gov' : 'pool'] = ts; p.el.remove(); lim.parts.splice(i, 1); continue; }
      const e = u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) ** 2, [x, y] = limPoint(p.si, p.gi, p.oi, e);
      p.el.setAttribute('cx', x.toFixed(1)); p.el.setAttribute('cy', y.toFixed(1));
      if (p.bad) p.el.style.opacity = (0.4 + 0.6 * Math.abs(Math.sin(u * 14))).toFixed(2);
    }
    for (const k of ['pool', 'gov']) { const a = Math.max(0, 1 - (ts - (lim.hit[k] || -1e9)) / 450), n = $(`#lfn-${k}`); if (n) n.style.strokeOpacity = (0.35 + 0.65 * a).toFixed(2); }
    let moving = false;
    for (const g of document.querySelectorAll('#lGauges .lg')) {
      const k = g.dataset.k, to = lim.gaugeVal[k] ?? 0, from = lim.shown[k] ?? 0, d = to - from;
      if (Math.abs(d) < 0.002) { if (from !== to) { lim.shown[k] = to; limArc(g, to); } continue; }
      lim.shown[k] = from + d * 0.12; limArc(g, lim.shown[k]); moving = true;
    }
    if (lim.parts.length || moving) limKick();
  }
  const limArc = (g, f) => g.querySelector('.lga').setAttribute('d', f > 0.002 ? ringArc(60, 60, 46, f) : '');

  // ---- gauges
  function limPaintGauges() {
    const list = limGauges(lim.d), sig = list.map((r) => r.key).join('|'), box = $('#lGauges');
    if (sig !== lim.gaugeSig) {
      lim.gaugeSig = sig; lim.shown = {};
      box.innerHTML = list.map((r) => `<div class="lg" data-k="${esc(r.key)}" role="img"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="46" class="lgt"/><path class="lga" d=""/></svg><div class="lgc"><b class="lgp"></b></div><div class="lgl">${esc(r.name)}</div><div class="lgv"></div><div class="lgr"></div></div>`).join('');
    }
    const rate = limRate();
    for (const r of list) {
      const g = box.querySelector(`[data-k="${CSS.escape(r.key)}"]`); if (!g) continue;
      const to = Math.min(1, r.f), changed = lim.gaugeVal[r.key] != null && Math.abs(lim.gaugeVal[r.key] - to) > 0.0005;
      lim.gaugeVal[r.key] = to; if (lim.reduced || !limActive()) { lim.shown[r.key] = to; limArc(g, to); }
      g.className = `lg lv-${r.level}${changed ? ' glow' : ''}`; if (changed) setTimeout(() => g.classList.remove('glow'), 900);
      g.querySelector('.lgp').textContent = `${Math.round(r.f * 100)}%`;
      g.querySelector('.lgv').textContent = `${limAmt(r.used, r.unit)} of ${limAmt(r.max, r.unit)}`;
      let sub = r.level === 'over' ? `${limAmt(r.used - r.max, r.unit)} over the limit` : `${limAmt(r.max - r.used, r.unit)} left`;
      if (r.key === 'DailyApiRequests') {
        const pj = limProject(r.used, rate), full = limFullIn(r.used, r.max, rate);
        sub = rate < 0.05 ? 'Quiet right now' : full != null && full * 60 < pj.minsLeft ? `At the current rate: full in ${dur(full)}` : `At the current rate: ${pct(pj.eod / r.max)} by midnight`;
      }
      g.querySelector('.lgr').textContent = sub;
      g.setAttribute('aria-label', `${r.name}: ${Math.round(r.f * 100)}%, ${g.querySelector('.lgv').textContent}`);
    }
    limKick();
  }

  // ---- streaming chart + the day strip
  function limPaintChart() {
    if (!lim.built || !M) return;
    const now = Date.now(), snap = lim.snap = M.snapshot(), w = limWindow(), b = limBins(snap[w.src], lim.rest, now, w.bins, w.binMs);
    const X0 = 40, W = 548, Y0 = 12, H = 138, bw = W / b.bins.length, max = limNice(Math.max(3, ...b.bins.map((x) => x.own + x.rest)));
    const y = (v) => Y0 + H - (v / max) * H, xAt = (t) => X0 + ((t - b.start) / (b.end - b.start)) * W;
    const bars = b.bins.map((x) => {
      const hOwn = (x.own / max) * H, hRest = (x.rest / max) * H, bx = xAt(x.t).toFixed(1);
      return (x.own ? `<rect x="${bx}" y="${(Y0 + H - hOwn).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${hOwn.toFixed(1)}" class="cb own"/>` : '')
        + (x.rest ? `<rect x="${bx}" y="${(Y0 + H - hOwn - hRest).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${hRest.toFixed(1)}" class="cb rest"/>` : '');
    }).join('');
    const grid = [0, 0.5, 1].map((f) => `<line x1="${X0}" x2="${X0 + W}" y1="${y(max * f).toFixed(1)}" y2="${y(max * f).toFixed(1)}" class="cg"/><text x="${X0 - 6}" y="${(y(max * f) + 4).toFixed(1)}" text-anchor="end" class="ct">${Math.round(max * f)}</text>`).join('');
    const ax = w.ticks.map(([l, f]) => `<text x="${(X0 + W * f).toFixed(0)}" y="${Y0 + H + 16}" text-anchor="${f === 1 ? 'end' : f === 0 ? 'start' : 'middle'}" class="ct">${l}</text>`).join('');
    $('#lChart').innerHTML = `<defs><clipPath id="lcClip"><rect x="${X0}" y="${Y0 - 2}" width="${W}" height="${H + 4}"/></clipPath></defs>${grid}${ax}<g clip-path="url(#lcClip)"><g id="lcPlot">${bars}</g></g>`;
    if (!lim.reduced && page.live() && w.binMs <= 10000) { // the whole plot slides left by one second's worth of time, then eases back as the next second arrives
      const g = $('#lcPlot'), px = W / ((b.end - b.start) / 1000);
      g.style.transition = 'none'; g.style.transform = `translateX(${px.toFixed(2)}px)`; void g.getBoundingClientRect();
      g.style.transition = 'transform 1s linear'; g.style.transform = 'translateX(0)';
    }
    $('#lChartWin').textContent = w.name; $('#lChartSub').textContent = w.sub; $('#lWin').value = String(Object.keys(LIM_WINDOWS).find((k) => LIM_WINDOWS[k] === w));
    // Today so far, and where it lands at midnight at the current rate.
    const a = lim.api;
    if (a) {
      const pj = limProject(a.used, limRate()), top = Math.max(a.max, pj.eod * 1.02), sx = (v) => 6 + (v / top) * 588;
      $('#lDay').innerHTML = `<rect x="6" y="14" width="588" height="12" rx="6" class="dtrack"/><rect x="6" y="14" width="${Math.max(2, sx(a.used) - 6).toFixed(1)}" height="12" rx="6" class="dused"/>`
        + `<rect x="${sx(a.used).toFixed(1)}" y="14" width="${Math.max(0, sx(pj.eod) - sx(a.used)).toFixed(1)}" height="12" class="dproj"/>`
        + `<line x1="${sx(a.max).toFixed(1)}" x2="${sx(a.max).toFixed(1)}" y1="6" y2="34" class="dmax"/><text x="${Math.min(594, sx(a.max)).toFixed(1)}" y="46" text-anchor="end" class="ct">daily max ${num(a.max)}</text>`;
      $('#lDaySub').textContent = `Today ${num(a.used)} · at this rate ${num(pj.eod)} (${pct(pj.eod / a.max)}) by midnight`;
    }
  }

  // ---- ledger + session stats
  function limPaintLedger() {
    const snap = lim.snap || M?.snapshot(); if (!snap) { $('#lLedger').innerHTML = '<div class="empty">The request meter is not available in this build.</div>'; return; }
    const shortPath = (e) => `${e.path.replace(/^\/services\/(?:apexrest|data\/v[\d.]+)/, '')}${e.object ? ' · ' + e.object : ''}`;
    const row = (e, tag) => {
      const rows = e.apex?.rows, bar = rows != null ? limBar(rows, e.apex.rowsMax || LIM_ROWS) : null, key = `${e.t}|${e.path}|${e.ms}`, isNew = lim.seenRows.size && !lim.seenRows.has(key);
      return `<div class="lr${isNew && !tag ? ' in' : ''}${e.status >= 400 || e.status === 0 ? ' bad' : ''}"><span class="kp k-${esc(e.kind)}">${esc(e.kind)}</span><span class="ls">${esc(e.source || '—')}</span><span class="lpth" title="${esc(shortPath(e))}">${tag ? `<em>${tag}</em> ` : ''}${esc(shortPath(e))}</span><span class="lms">${num(e.ms)} ms</span>`
        + `<span class="lrw">${rows != null ? num(rows) : e.rows != null ? num(e.rows) : ''}</span><span class="mbar" title="${rows != null ? `${num(rows)} of ${num(e.apex.rowsMax || LIM_ROWS)} Apex query rows` : ''}">${bar ? `<i class="${bar.cls}" style="width:${Math.max(2, bar.f * 100).toFixed(0)}%"></i>` : ''}</span></div>`;
    };
    const list = snap.entries.slice(0, 30);
    $('#lLedger').innerHTML = (snap.heaviest ? row(snap.heaviest, 'Heaviest') : '') + (snap.slowest && snap.slowest !== snap.heaviest ? row(snap.slowest, 'Slowest') : '')
      + (list.map((e) => row(e)).join('') || '<div class="empty">No calls yet. Open the Dashboard in another tab and refresh it.</div>');
    if (lim.seenRows.size > 800) lim.seenRows.clear();
    for (const e of snap.entries) lim.seenRows.add(`${e.t}|${e.path}|${e.ms}`);
    if (!lim.seenRows.size) lim.seenRows.add('init');
  }
  function limPaintStats() {
    const snap = lim.snap; if (!snap) { $('#lStats').innerHTML = ''; return; }
    const t = snap.totals, k = snap.byKind, gq = k.graphql?.n || 0, ap = (k.apex?.n || 0) + (k.batch?.n || 0) + (k.action?.n || 0), all = Math.max(1, t.n);
    const tile = (l, v, s, cls = '') => `<div class="lst ${cls}"><div class="l">${esc(l)}</div><div class="v">${v}</div><div class="s">${esc(s)}</div></div>`;
    $('#lStats').innerHTML = `<div class="lsg">${tile('Console calls', num(t.n), 'last hour, all tabs')}${tile('Latency', `${num(t.p50)}<small> / ${num(t.p95)} ms</small>`, 'p50 / p95')}`
      + `${tile('Errors', num(t.errors), t.n ? `${pct(t.errors / t.n)} of calls` : 'none yet', t.errors ? 'bad' : '')}${tile('Peak Apex rows', num(t.peakRows), `of ${num(LIM_ROWS)} per transaction`, limBar(t.peakRows).cls === 'ok' ? '' : limBar(t.peakRows).cls)}</div>`
      + `<div class="lmix"><div class="l">GraphQL vs Apex</div><div class="mixbar"><i class="gq" style="width:${(100 * gq / all).toFixed(1)}%"></i><i class="ap" style="width:${(100 * ap / all).toFixed(1)}%"></i></div>`
      + `<div class="s"><span class="lk k-graphql"><i></i>GraphQL ${num(gq)}</span> <span class="lk k-apex"><i></i>Apex ${num(ap)}</span> <span class="muted">other ${num(t.n - gq - ap)}</span></div></div>`;
  }
  function limPaintLive() {
    if (page.mode() !== 'limits' || !lim.built) return;
    if (M) lim.snap = M.snapshot();
    limPaintHead(); limPaintAlerts(); limPaintGauges(); limPaintFlow(); limPaintLedger(); limPaintStats();
  }

  // ---- reference (collapsed): closest to the limit, then everything
  function limPaintRef() {
    const rows = limRows(lim.d), acc = lim.d?.access || [];
    $('#lTop').innerHTML = limTopHtml(rows);
    $('#lAccess').innerHTML = limAccessHtml(acc);
    $('#lAll').innerHTML = limAllHtml(rows, acc, lim.search);
    const jobs = lim.d?.jobs?.ok ? lim.d.jobs.data : [];
    $('#lJobs').textContent = jobs.length ? `Async Apex today: ${jobs.map((x) => `${x.n} ${x.status.toLowerCase()} ${x.type}`).join(', ')}` : '';
  }
  function limCsv() {
    const rows = limRows(lim.d);
    const csv = csvText([['type', 'name', 'used', 'limit', 'percent'], ...rows.map((r) => [r.group, r.name, r.used, r.max, r.f == null ? '' : Math.round(r.f * 100)])]);
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'om-limits.csv' });
    a.click(); URL.revokeObjectURL(a.href);
  }

  // ---- sample data: figures from a demo org and a large org, plus a stream of calls so the view moves like the real thing
  function demoLimits() {
    const used = lim.demoApi, lim1 = (max, left) => ({ Max: max, Remaining: left });
    return { at: new Date().toISOString(),
      org: { ok: true, data: { DailyApiRequests: lim1(100000, 100000 - used), DataStorageMB: lim1(10640, -15636), FileStorageMB: lim1(2000, 1995), DailyAsyncApexExecutions: lim1(250000, 249931),
        DailyBulkApiBatches: lim1(15000, 14990), HourlyPublishedPlatformEvents: lim1(250000, 249980), SingleEmail: lim1(5000, 4980), MassEmail: lim1(5000, 5000), ConcurrentAsyncGetReportInstances: lim1(200, 200), StreamingApiConcurrentClients: lim1(2000, 2000) } },
      entitlements: { ok: true, data: [
        { MasterLabel: 'Lightning Order Management Order Summary Entitlements', Setting: 'setting/force.com/orgValue.LOMOrderSummaryTotal', Frequency: 'Once', CurrentAmountAllowed: 20000, AmountUsed: null, UsageDate: null },
        { MasterLabel: 'API Request Limit per Month', Setting: 'setting/force.com/orgValue.Provisioned30DayApiRequests', Frequency: 'Monthly', CurrentAmountAllowed: 3000000, AmountUsed: 412000, UsageDate: null }] },
      licenses: { ok: true, data: { user: [{ Name: 'Salesforce', TotalLicenses: 20, UsedLicenses: 18 }, { Name: 'Salesforce Platform', TotalLicenses: 25, UsedLicenses: 6 }],
        permissionSet: [{ MasterLabel: 'Order Management', TotalLicenses: 20, UsedLicenses: 9 }, { MasterLabel: 'Operations Console', TotalLicenses: 20, UsedLicenses: 0 }] } },
      jobs: { ok: true, data: [{ status: 'Completed', type: 'Queueable', n: 7 }, { status: 'Failed', type: 'Queueable', n: 1 }] },
      orderSummary: { ok: true, data: { count: 1730822 } },
      access: ['Org limits', 'Entitlements', 'User licences', 'Permission set licences', 'Async Apex jobs', 'Order summary count'].map((name) => ({ name, state: 'ok', note: '' })) };
  }
  const limPick = (a) => a[Math.floor(Math.random() * a.length)];
  const DEMO_CALLS = [['apex', '/services/apexrest/somconsole/query', 'OrderSummary'], ['batch', '/services/apexrest/somconsole/batch', null], ['graphql', '/services/data/v68.0/graphql', 'OrderSummary'],
    ['graphql', '/services/data/v68.0/graphql', 'FulfillmentOrder'], ['ui-api', '/services/data/v68.0/ui-api/records', 'Account'], ['apex', '/services/apexrest/somconsole/query', 'ReturnOrder'], ['action', '/services/apexrest/somservice/action', null]];
  function limDemoCall(t, source, heavy) {
    const [kind, path, object] = limPick(DEMO_CALLS), apexy = kind === 'apex' || kind === 'batch' || kind === 'action';
    const rows = apexy ? (heavy && kind === 'batch' ? 30000 + Math.floor(Math.random() * 19000) : Math.floor(Math.random() * 6000)) : Math.floor(Math.random() * 1999);
    return { t, kind, path, method: kind === 'graphql' || kind === 'action' ? 'POST' : 'GET', ms: Math.round((kind === 'graphql' ? 900 : 90) + Math.random() * (kind === 'graphql' ? 5000 : 500)), status: Math.random() < 0.04 ? 500 : 200, rows, object, source,
      apex: apexy ? { rows, rowsMax: LIM_ROWS, queries: 2 + Math.floor(Math.random() * 6), queriesMax: 100, cpu: Math.round(rows / 20), cpuMax: 10000, heap: rows * 300, heapMax: 6000000, api: lim.demoApi, apiMax: 100000 } : null };
  }
  function limSeedDemo() {
    const now = Date.now();
    for (let i = 0; i < 140; i++) {
      const t = now - Math.floor(Math.random() * 840000), src = limPick(['console', 'dashboard', 'dashboard', 'service']);
      M.record(limDemoCall(t, src, Math.random() < 0.03));
      if (i % 9 === 0) lim.rest.push({ t, n: 1 + Math.floor(Math.random() * 3) });
    }
  }
  function limDemoStream(now) {
    if (now < lim.demoNext || !M) return;
    lim.demoNext = now + 2000 + Math.random() * 4000;
    const n = 1 + Math.floor(Math.random() * 6), src = limPick(['console', 'dashboard', 'dashboard', 'service']), heavy = Math.random() < 0.15;
    for (let i = 0; i < n; i++) setTimeout(() => { lim.demoApi += 1; M.record(limDemoCall(Date.now(), src, heavy)); }, i * 140);
    setTimeout(() => { lim.demoApi += Math.floor(Math.random() * 4); limSample(lim.demoApi, 100000); }, n * 140 + 50); // calls from the rest of the org
  }
  document.addEventListener('visibilitychange', () => { if (page.mode() === 'limits') { limSync(); limKick(); } });
  addEventListener('pointerdown', () => { lim.lastActive = Date.now(); }, { passive: true });
  return { lim, meterInit, meterRecord, EVERY_KEY, everyMs, pollMs, limSync, limEnter, limLeave, limPill, limLoad, limApply, limitsContext, limPaintHead };
}
