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
// The Limits view's arithmetic (its page is in index.html): levels against a limit, when a limit fills at the current rate,
// the request-flow layout, and the rows and gauges from /api/limits. Pure: no DOM, no state.

export const LIM_WARN = 0.8;
export const LIM_ROWS = 50000;
export const LIM_SRC = ['console', 'dashboard', 'service', 'limits'];
export const LIM_SRC_NAME = ['Ops Console', 'Dashboard', 'Service', 'This tab'];
export const LIM_GW_NAME = ['Apex REST', 'GraphQL', 'UI API'];
export const LIM_G2O = [1, 0, 0];
export const LIM_SY = [46, 110, 174, 238];
export const LIM_GY = [70, 140, 210];
export const LIM_OY = [90, 190];
export const limFrac = (used, max) => (max > 0 && used != null && Number.isFinite(used) ? used / max : null);
export const limLevel = (f) => (f == null ? 'none' : f >= 1 ? 'over' : f >= LIM_WARN ? 'warn' : 'ok');
export const LIM_RANK = { none: 0, ok: 0, warn: 1, over: 2 };
// Which limits just got worse. A limit with no earlier level was already there when the page opened, so it isn't a crossing.
export function limCross(prev, next) {
  const out = [];
  for (const [key, level] of Object.entries(next)) if (key in prev && LIM_RANK[level] > LIM_RANK[prev[key]]) out.push({ key, level });
  return out;
}
// Where today's count lands at midnight (local) if calls keep arriving at perMin.
export function limProject(used, perMin, now = new Date()) {
  const end = new Date(now); end.setHours(24, 0, 0, 0);
  const minsLeft = Math.max(0, (end - now) / 60000);
  return { minsLeft, eod: Math.round(used + Math.max(0, perMin) * minsLeft) };
}
export const limFullIn = (used, max, perMin) => (used >= max ? 0 : perMin > 0 ? (max - used) / perMin / 60 : null); // hours
export const odoDigits = (n) => Math.max(0, Math.floor(Number(n) || 0)).toLocaleString('en-US').split('');
export const limBar = (rows, max = LIM_ROWS) => { const f = Math.min(1, Math.max(0, (rows || 0) / max)); return { f, cls: f >= 0.9 ? 'red' : f >= 0.6 ? 'amber' : 'ok' }; };
export const limCalls = (entries, now, ms = 60000) => entries.reduce((n, e) => n + (e.t > now - ms && e.t <= now ? 1 : 0), 0);
export const limTrend = (cur, prev) => (cur > prev * 1.1 + 0.5 ? '▲' : cur < prev * 0.9 - 0.5 ? '▼' : '■');
// Calls the org counted that this console didn't make: the counter's growth minus our own calls in the same span.
export const limRest = (prevUsed, used, own) => (used < prevUsed ? 0 : Math.max(0, used - prevUsed - own));
export const limAmt = (n, unit = '') => (unit === 'licences' ? `${Math.round(n).toLocaleString('en-US')} ${Math.round(n) === 1 ? 'licence' : 'licences'}` : unit === 'MB' && Math.abs(n) >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${Math.round(n).toLocaleString('en-US')}${unit ? ' ' + unit : ''}`);
export const limGate = (kind) => (kind === 'graphql' ? 1 : kind === 'ui-api' || kind === 'connect' ? 2 : 0); // gateway: Apex REST, GraphQL, UI API
export const limSrcIdx = (s) => Math.max(0, LIM_SRC.indexOf(s));
export const limNice = (v) => { if (!(v > 0)) return 1; const p = 10 ** Math.floor(Math.log10(v)), m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; };
export const LIM_NAMES = { DailyApiRequests: 'Daily API requests', DataStorageMB: 'Data storage', FileStorageMB: 'File storage', DailyAsyncApexExecutions: 'Daily async Apex' };
export const limLabel = (k) => LIM_NAMES[k] || k.replace(/MB$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
export const LIM_OM = /Order\s*Summary/i;
// Everything with a ceiling, in one list: org limits, entitlements and licences.
export function limRows(d) {
  const rows = [], order = d?.orderSummary?.data;
  const add = (group, name, used, max, unit, key) => { const f = limFrac(used, max); rows.push({ group, key, name, used, max, unit, f, level: limLevel(f) }); };
  for (const [k, v] of Object.entries(d?.org?.data || {})) if (v && v.Max > 0) add('Org limit', limLabel(k), v.Max - v.Remaining, v.Max, /MB$/.test(k) ? 'MB' : '', k);
  for (const e of d?.entitlements?.data || []) {
    const om = LIM_OM.test(`${e.Setting || ''} ${e.MasterLabel || ''}`);
    add('Entitlement', e.MasterLabel, e.AmountUsed ?? (om ? order?.count ?? order?.used ?? null : null), e.CurrentAmountAllowed, '', `ent:${e.MasterLabel}`);
  }
  for (const u of d?.licenses?.data?.user || []) add('User licence', u.Name, u.UsedLicenses, u.TotalLicenses, 'licences', `ul:${u.Name}`);
  for (const p of d?.licenses?.data?.permissionSet || []) add('Permission set licence', p.MasterLabel, p.UsedLicenses, p.TotalLicenses, 'licences', `pl:${p.MasterLabel}`);
  return rows;
}
export function limGauges(d) {
  const rows = limRows(d), by = (k) => rows.find((r) => r.key === k), om = rows.find((r) => r.group === 'Entitlement' && LIM_OM.test(r.name));
  return [by('DailyApiRequests'), by('DataStorageMB'), by('FileStorageMB'), om, by('DailyAsyncApexExecutions')].filter((r) => r && r.f != null);
}
// Where a request is on its source → gateway → org trip, u from 0 to 1: leg one is a curve out of the source, then a straight run through
// the gateway box, then a curve into the org node.
export function limPoint(si, gi, oi, u) {
  const cub = (x0, y0, x1, y1, t) => { const xm = (x0 + x1) / 2, a = (1 - t) ** 3, b = 3 * (1 - t) ** 2 * t, c = 3 * (1 - t) * t ** 2, e = t ** 3; return [a * x0 + (b + c) * xm + e * x1, (a + b) * y0 + (c + e) * y1]; };
  if (u < 0.4) return cub(150, LIM_SY[si], 300, LIM_GY[gi], u / 0.4);
  if (u < 0.6) return [300 + 120 * ((u - 0.4) / 0.2), LIM_GY[gi]];
  return cub(420, LIM_GY[gi], 570, LIM_OY[oi], (u - 0.6) / 0.4);
}
// perSecond: meter buckets {t, n}; rest: [{t, n}] calls other clients made. 90 bins of 10 s ending at the next 10 s mark.
export function limBins(perSecond, rest, now, bins = 90, binMs = 10000) {
  const end = Math.floor(now / binMs) * binMs + binMs, start = end - bins * binMs;
  const out = Array.from({ length: bins }, (_, i) => ({ t: start + i * binMs, own: 0, rest: 0 }));
  for (const s of perSecond) { const i = Math.floor((s.t - start) / binMs); if (i >= 0 && i < bins) out[i].own += s.n; }
  for (const r of rest) { const i = Math.floor((r.t - start) / binMs); if (i >= 0 && i < bins) out[i].rest += r.n; }
  return { start, end, bins: out };
}
