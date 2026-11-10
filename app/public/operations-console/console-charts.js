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
// The dashboard's chart pieces, as HTML strings for its panels: horizontal bars, stat rows, the empty and "not in this org"
// notes, durations and changes against the prior period, and a column chart over a period filled with empty buckets.
import { esc, num, pct } from './console-kit.js';

export function hbars(list, { color = 'var(--signal)', fmt = num, unit = '', share = true } = {}) {
  if (!list || !list.length) return '<div class="empty" style="padding:var(--sp-3) 0">Nothing in this period.</div>';
  const total = share ? list.reduce((s, r) => s + (r.n || 0), 0) : 0, mx = Math.max(1e-9, ...list.map((r) => r.n || 0));
  return `<div class="hb" role="list">${list.map((r) => { const sm = r.s != null ? r.s : total ? pct((r.n || 0) / total) : '';
    // A row says its label and value; one whose tooltip adds more (r.tip) takes focus so the keyboard can open it.
    return `<div class="row" role="listitem"${r.tip ? ' tabindex="0"' : ''} data-tip="${esc(`<b>${esc(r.key)}</b><div class='r'><span>${unit || 'Count'}</span><span>${fmt(r.n)}</span></div>${total ? `<div class='r'><span>Share</span><span>${pct((r.n || 0) / total)}</span></div>` : ''}${r.tip || ''}`)}">
    <span class="lab" title="${esc(r.key)}">${esc(r.key)}</span><div class="bar"><i style="width:${Math.max(1.5, 100 * (r.n || 0) / mx)}%;background:${color}"></i></div><span class="val">${fmt(r.n)}${sm ? `<small>${esc(sm)}</small>` : ''}</span></div>`; }).join('')}</div>`;
}
export const dur = (h) => h == null ? '—' : h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${h.toFixed(h < 10 ? 1 : 0)} h` : `${(h / 24).toFixed(h < 240 ? 1 : 0)} d`;
export const pct1 = (v) => v == null || !isFinite(v) ? '—' : `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;
export const ratio = (a, b) => (b ? (a || 0) / b : null);
export function mdelta(c, p) {
  if (c == null || p == null) return '';
  if (!p) return c ? 'new vs prior' : '';
  const x = (c - p) / p; return `${x > 0.005 ? '▲' : x < -0.005 ? '▼' : '■'} ${Math.abs(Math.round(x * 100))}% vs prior`;
}
export const stats = (list) => `<div class="mini">${list.map(([l, v, s]) => `<div><span>${l}</span><b>${v}</b>${s ? `<small>${s}</small>` : ''}</div>`).join('')}</div>`;
export const na = (obj) => `<div class="empty" style="padding:var(--sp-3) 0">${esc(obj)} is not available in this org.</div>`;
// Fill the period with empty buckets so gaps read as zero, not as missing axis ticks. `from` is the period's start (the dashboard's).
export function buckets(series, grain, from) {
  const by = Object.fromEntries((series || []).map((r) => [r.key, r.n])), out = [], now = new Date();
  const pad = (n) => String(n).padStart(2, '0'), MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  if (grain === 'hour') for (let h = 0; h <= now.getHours(); h++) out.push({ key: String(h), label: `${(h % 12) || 12}${h < 12 ? 'a' : 'p'}`, long: `${(h % 12) || 12}:00 ${h < 12 ? 'AM' : 'PM'}`, n: by[h] || 0 });
  else if (grain === 'day') for (let d = new Date(from); d <= now; d = new Date(d.setDate(d.getDate() + 1))) { const k = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; out.push({ key: k, label: `${MON[d.getMonth()]} ${d.getDate()}`, long: d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }), n: by[k] || 0 }); }
  else {
    const keys = Object.keys(by).sort(), s0 = from ? new Date(from) : keys.length ? new Date(+keys[0].slice(0, 4), +keys[0].slice(5) - 1, 1) : now;
    for (let d = new Date(s0.getFullYear(), s0.getMonth(), 1); d <= now; d = new Date(d.setMonth(d.getMonth() + 1))) { const k = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; out.push({ key: k, label: d.getMonth() === 0 || !out.length ? `${MON[d.getMonth()]} '${String(d.getFullYear()).slice(2)}` : MON[d.getMonth()], long: `${MON[d.getMonth()]} ${d.getFullYear()}`, n: by[k] || 0 }); }
  }
  return out;
}
export const niceMax = (v) => { if (v <= 4) return 4; const p = 10 ** Math.floor(Math.log10(v)), f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };
export function columns(el, list, { color = 'var(--d1)', unit = 'orders', h = 190 } = {}) {
  const W = Math.max(280, el.clientWidth), L = 34, B = 22, T = 8, iw = W - L - 6, ih = h - T - B;
  const mx = niceMax(Math.max(0, ...list.map((b) => b.n))), step = iw / Math.max(1, list.length), gap = Math.min(2, step * .25), bw = Math.max(1, step - gap);
  const y = (v) => T + ih - ih * v / mx, every = Math.ceil(list.length / Math.max(2, Math.floor(iw / 58)));
  const ticks = [0, mx / 2, mx].map((v) => `<line class="grid-l" x1="${L}" x2="${W - 6}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${num(Math.round(v))}</text>`).join('');
  const cols = list.map((b, i) => {
    const x = L + i * step + gap / 2, top = y(b.n), hh = T + ih - top, r = Math.min(4, bw / 2, hh);
    const bar = b.n ? `<path class="col" fill="${color}" d="M${x},${T + ih}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${T + ih}Z"/>` : '';
    const lab = i % every === 0 ? `<text class="ax" x="${x + bw / 2}" y="${h - 6}" text-anchor="middle">${esc(b.label)}</text>` : '';
    return `${bar}${lab}<rect class="hit" x="${L + i * step}" y="${T}" width="${step}" height="${ih}" data-tip="${esc(`<b>${esc(b.long)}</b><div class='r'><span>${unit}</span><span>${num(b.n)}</span></div>`)}" data-say="${esc(`${b.long}: ${num(b.n)}`)}"/>`;
  }).join('');
  // One tab stop: the label sums the chart up, and ← → (Home, End) step through the columns (chartKeys below).
  const total = list.reduce((s, b) => s + (b.n || 0), 0), peak = list.reduce((a, b) => (b.n > (a?.n ?? -1) ? b : a), null);
  const say = list.length ? `${unit} over time, ${list[0].long} to ${list[list.length - 1].long}: ${num(total)} in all${peak?.n ? `, the most ${num(peak.n)} on ${peak.long}` : ''}. Arrow keys read each column.` : `${unit} over time: none`;
  el.innerHTML = `<svg class="chart" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" role="img" tabindex="0" aria-label="${esc(say)}">${ticks}${cols}<line x1="${L}" x2="${W - 6}" y1="${T + ih}" y2="${T + ih}" stroke="var(--line2)"/></svg>`;
}
